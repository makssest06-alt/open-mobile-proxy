import net from 'net';
import { WebSocket } from 'ws';

// In-memory store for active proxy servers
// Key: port, Value: net.Server
const proxyServers = new Map<number, net.Server>();
// Key: port, Value: WebSocket connection
const proxyWebSockets = new Map<number, WebSocket>();
// Key: port, Value: Proxy credentials
const proxyAuthCredentials = new Map<number, { login?: string; password?: string }>();
const portToConnIds = new Map<number, Set<number>>();

export function updateAllProxyAuthCredentials(credentials: { login?: string; password?: string }) {
    for (const [port] of proxyAuthCredentials.entries()) {
        proxyAuthCredentials.set(port, credentials);
    }
}

/**
 * Starts a TCP server on the specified port.
 * When a client connects, it authenticates SOCKS5 (RFC 1929) if required,
 * then forwards the traffic to the provided WebSocket.
 * 
 * Multiplexing protocol (Binary):
 * [4 bytes Connection ID] + [Payload]
 */
export function startProxyServer(
    port: number,
    ws: WebSocket,
    onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void,
    credentials?: { login?: string; password?: string }
) {
    proxyWebSockets.set(port, ws);
    if (credentials) {
        proxyAuthCredentials.set(port, credentials);
    }

    if (proxyServers.has(port)) {
        if (onLog) onLog('info', `Proxy server already running on port ${port}, updated active WebSocket reference`);
        return;
    }

    let connectionCounter = 1;

    const server = net.createServer((socket) => {
        socket.setTimeout(120000); // 2 minute idle timeout
        socket.on('timeout', () => { socket.destroy(); });
        let connId = connectionCounter;
        connectionCounter = (connectionCounter + 1) % 0xFFFFFFFF || 1;
        while (activeSockets.has(connId)) {
            connId = connectionCounter;
            connectionCounter = (connectionCounter + 1) % 0xFFFFFFFF || 1;
        }
        const connIdBuffer = Buffer.alloc(4);
        connIdBuffer.writeUInt32BE(connId, 0);

        const currentCreds = proxyAuthCredentials.get(port);
        const requiresAuth = Boolean(currentCreds?.login && currentCreds?.password);

        let authenticated = !requiresAuth;
        let authState: 'GREETING' | 'USER_PASS' | 'CONNECTED' = requiresAuth ? 'GREETING' : 'CONNECTED';

        const logMsg = `[Port ${port}] New connection #${connId} accepted from ${socket.remoteAddress}`;
        if (onLog) onLog('info', logMsg);
        else console.log(logMsg);

        // If no authentication is required, notify phone immediately
        if (authenticated) {
            const currentWs = proxyWebSockets.get(port);
            if (currentWs && currentWs.readyState === WebSocket.OPEN) {
                try {
                    currentWs.send(JSON.stringify({
                        type: "proxy_connect",
                        connId: connId
                    }));
                } catch (e) { /* ignore */ }
            }
        }

        socket.on('data', (data) => {
            if (!authenticated) {
                if (authState === 'GREETING') {
                    const dataStr = data.toString('utf-8');
                    // --- HTTP CONNECT / HTTP Proxy Protocol Detection ---
                    if (dataStr.startsWith('CONNECT ') || dataStr.startsWith('GET ') || dataStr.startsWith('POST ') || dataStr.startsWith('HEAD ')) {
                        // Check Proxy-Authorization: Basic <base64>
                        let httpAuthenticated = false;
                        const authMatch = dataStr.match(/Proxy-Authorization:\s*Basic\s+([A-Za-z0-9+/=]+)/i);
                        if (authMatch && authMatch[1]) {
                            try {
                                const decoded = Buffer.from(authMatch[1], 'base64').toString('utf-8');
                                const [username, password] = decoded.split(':');
                                if (username === currentCreds?.login && password === currentCreds?.password) {
                                    httpAuthenticated = true;
                                }
                            } catch (e) {}
                        } else if (!currentCreds?.login && !currentCreds?.password) {
                            httpAuthenticated = true; // No auth required
                        }

                        if (httpAuthenticated) {
                            authenticated = true;
                            authState = 'CONNECTED';
                            // Respond with HTTP 200 Connection Established for CONNECT requests
                            if (dataStr.startsWith('CONNECT ')) {
                                socket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: iProxy-OpenSource\r\n\r\n");
                            }
                            if (onLog) onLog('info', `[Port ${port}] Connection #${connId} HTTP/HTTPS proxy auth succeeded`);

                            // Notify phone of new connection
                            const activeWs = proxyWebSockets.get(port);
                            if (activeWs && activeWs.readyState === WebSocket.OPEN) {
                                try {
                                    activeWs.send(JSON.stringify({
                                        type: "proxy_connect",
                                        connId: connId
                                    }));
                                } catch (e) { /* ignore */ }
                            }
                            return;
                        } else {
                            if (onLog) onLog('warn', `[Port ${port}] Connection #${connId} HTTP proxy auth FAILED from ${socket.remoteAddress}`);
                            socket.write("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"OpenMobileProxy\"\r\n\r\n");
                            socket.destroy();
                            return;
                        }
                    }

                    // --- SOCKS5 Protocol Detection ---
                    if (data.length >= 2 && data[0] === 0x05) {
                        // Respond with 0x05 (SOCKS5), 0x02 (Username/Password authentication)
                        socket.write(Buffer.from([0x05, 0x02]));
                        authState = 'USER_PASS';
                    } else {
                        // Invalid protocol header, disconnect
                        socket.destroy();
                    }
                    return;
                }

                if (authState === 'USER_PASS') {
                    // RFC 1929 Auth request: [0x01, ulen, username, plen, password]
                    if (data.length >= 3 && data[0] === 0x01) {
                        const ulen = data[1];
                        if (data.length < 2 + ulen + 1) { socket.destroy(); return; }
                        const username = data.subarray(2, 2 + ulen).toString('utf-8');
                        const plen = data[2 + ulen];
                        if (data.length < 3 + ulen + plen) { socket.destroy(); return; }
                        const password = data.subarray(3 + ulen, 3 + ulen + plen).toString('utf-8');

                        if (username === currentCreds?.login && password === currentCreds?.password) {
                            authenticated = true;
                            authState = 'CONNECTED';
                            // Success response: [0x01, 0x00]
                            socket.write(Buffer.from([0x01, 0x00]));

                            if (onLog) onLog('info', `[Port ${port}] Connection #${connId} SOCKS5 auth succeeded for user "${username}"`);

                            // Notify phone of new authenticated connection
                            const activeWs = proxyWebSockets.get(port);
                            if (activeWs && activeWs.readyState === WebSocket.OPEN) {
                                try {
                                    activeWs.send(JSON.stringify({
                                        type: "proxy_connect",
                                        connId: connId
                                    }));
                                } catch (e) { /* ignore */ }
                            }
                        } else {
                            if (onLog) onLog('warn', `[Port ${port}] Connection #${connId} SOCKS5 auth FAILED for user "${username}" from ${socket.remoteAddress}`);
                            // Failure response: [0x01, 0x01]
                            socket.write(Buffer.from([0x01, 0x01]));
                            socket.destroy();
                        }
                    } else {
                        socket.destroy();
                    }
                    return;
                }
            }

            // Once authenticated, forward all incoming binary data to the phone
            const activeWs = proxyWebSockets.get(port);
            if (activeWs && activeWs.readyState === WebSocket.OPEN) {
                const frame = Buffer.allocUnsafe(4 + data.length);
                connIdBuffer.copy(frame, 0);
                data.copy(frame, 4);
                try {
                    activeWs.send(frame, (err) => {
                        if (err) { socket.destroy(); }
                    });
                } catch (e) { /* ignore */ }
                // Pause socket if WS buffer is getting full (>1MB)
                if (activeWs.bufferedAmount > 1024 * 1024) {
                    socket.pause();
                    const checkDrain = setInterval(() => {
                        if (!activeWs || activeWs.readyState !== WebSocket.OPEN) {
                            clearInterval(checkDrain);
                            socket.resume();
                            return;
                        }
                        if (activeWs.bufferedAmount < 512 * 1024) {
                            clearInterval(checkDrain);
                            socket.resume();
                        }
                    }, 100);
                }
            }
        });

        socket.on('close', () => {
            const closeMsg = `[Port ${port}] Connection #${connId} closed`;
            if (onLog) onLog('info', closeMsg);
            else console.log(closeMsg);

            activeSockets.delete(connId);
            portToConnIds.get(port)?.delete(connId);

            if (authenticated) {
                const activeWs = proxyWebSockets.get(port);
                if (activeWs && activeWs.readyState === WebSocket.OPEN) {
                    try {
                        activeWs.send(JSON.stringify({
                            type: "proxy_disconnect",
                            connId: connId
                        }));
                    } catch (e) { /* ignore */ }
                }
            }
        });

        socket.on('error', (err) => {
            const errMsg = `[Port ${port}] Connection #${connId} error: ${err.message}`;
            if (onLog) onLog('error', errMsg);
            else console.error(errMsg);

            activeSockets.delete(connId);
            portToConnIds.get(port)?.delete(connId);
        });

        activeSockets.set(connId, socket);
        if (!portToConnIds.has(port)) portToConnIds.set(port, new Set());
        portToConnIds.get(port)!.add(connId);
    });

    server.listen(port, '0.0.0.0', () => {
        console.log(`[Proxy] Listening on 0.0.0.0:${port}`);
    });

    server.on('error', (err) => {
        console.error(`[Proxy] Server error on port ${port}:`, err);
    });

    proxyServers.set(port, server);
}

export function stopProxyServer(port: number) {
    const server = proxyServers.get(port);
    if (server) {
        // Close only sockets belonging to this port
        const connIds = portToConnIds.get(port);
        if (connIds) {
            for (const connId of connIds) {
                try { activeSockets.get(connId)?.destroy(); } catch (e) {}
                activeSockets.delete(connId);
            }
            portToConnIds.delete(port);
        }
        server.close(() => {
            console.log(`[Proxy] Stopped listening on port ${port}`);
        });
        proxyServers.delete(port);
        proxyWebSockets.delete(port);
        proxyAuthCredentials.delete(port);
    }
}

// Global store for active TCP sockets to route incoming WebSocket binary data back to the client
// Key: connId, Value: net.Socket
export const activeSockets = new Map<number, net.Socket>();

export function handleIncomingProxyData(connId: number, data: Buffer) {
    const socket = activeSockets.get(connId);
    if (socket && !socket.destroyed) {
        const ok = socket.write(data);
        if (!ok) {
            // Socket buffer full - the 'drain' event on socket will auto-resume
        }
    }
}

export function handleProxyDisconnect(connId: number) {
    const socket = activeSockets.get(connId);
    if (socket) {
        socket.end();
        activeSockets.delete(connId);
    }
}
