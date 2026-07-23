package com.example.openmobileproxy

import android.util.Log
import kotlinx.coroutines.*
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket

class LocalSocks5Server(private val port: Int = 1080) {
    private val TAG = "Socks5Server"
    private var serverSocket: ServerSocket? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    fun start() {
        scope.launch {
            try {
                serverSocket = ServerSocket().apply {
                    reuseAddress = true
                    bind(java.net.InetSocketAddress("127.0.0.1", port), 50)
                }
                Log.d(TAG, "SOCKS5 Server started on 127.0.0.1:$port")
                while (isActive) {
                    val client = serverSocket?.accept() ?: break
                    scope.launch { handleClient(client) }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Server error", e)
            }
        }
    }

    fun stop() {
        scope.cancel()
        try {
            serverSocket?.close()
        } catch (e: Exception) {}
    }

    private suspend fun handleClient(client: Socket) {
        try {
            val input = client.getInputStream()
            val output = client.getOutputStream()

            // 1. Negotiation or Direct CONNECT (if VPS performed auth)
            val version = input.read()
            if (version != 5) {
                client.close()
                return
            }
            val byte2 = input.read()
            val byte3 = input.read()

            val atyp: Int
            var cmd = 1
            if (byte2 == 1 && byte3 == 0) {
                // Direct SOCKS5 CONNECT request (VPS already handled authentication)
                atyp = input.read()
            } else {
                // Legacy / Direct SOCKS5 handshake
                val methods = ByteArray(byte2.coerceAtLeast(1) - 1)
                if (methods.isNotEmpty()) input.read(methods)
                output.write(byteArrayOf(5, 0)) // No authentication required

                val ver = input.read()
                cmd = input.read() // 1 = CONNECT
                input.read() // RSV
                atyp = input.read()
            }

            val address: String
            val targetPort: Int

            when (atyp) {
                1 -> { // IPv4
                    val addr = ByteArray(4)
                    input.read(addr)
                    address = InetAddress.getByAddress(addr).hostAddress
                }
                3 -> { // Domain name
                    val len = input.read()
                    val addr = ByteArray(len)
                    input.read(addr)
                    address = String(addr)
                }
                else -> {
                    client.close()
                    return
                }
            }

            val portBuf = ByteArray(2)
            input.read(portBuf)
            targetPort = ((portBuf[0].toInt() and 0xff) shl 8) or (portBuf[1].toInt() and 0xff)

            if (cmd == 1) { // CONNECT
                try {
                    val target = Socket(address, targetPort)
                    output.write(byteArrayOf(5, 0, 0, 1, 0, 0, 0, 0, 0, 0)) // Success

                    val tIn = target.getInputStream()
                    val tOut = target.getOutputStream()

                    // Relay data using coroutines
                    scope.launch {
                        try {
                            coroutineScope {
                                launch { relay(input, tOut) }
                                launch { relay(tIn, output) }
                            }
                        } catch (e: Exception) {} finally {
                            try { target.close() } catch (e: Exception) {}
                            try { client.close() } catch (e: Exception) {}
                        }
                    }
                    return // Don't close client here, coroutine handles it
                } catch (e: Exception) {
                    output.write(byteArrayOf(5, 1, 0, 1, 0, 0, 0, 0, 0, 0)) // General failure
                }
            } else {
                output.write(byteArrayOf(5, 7, 0, 1, 0, 0, 0, 0, 0, 0)) // Command not supported
            }
        } catch (e: Exception) {
            // Log.e(TAG, "Client handling error", e)
        }
        try { client.close() } catch (e: Exception) {}
    }

    private suspend fun relay(input: InputStream, output: OutputStream) {
        val buffer = ByteArray(16384)
        try {
            while (true) {
                val read = withContext(Dispatchers.IO) { input.read(buffer) }
                if (read == -1) break
                withContext(Dispatchers.IO) {
                    output.write(buffer, 0, read)
                    output.flush()
                }
            }
        } catch (e: Exception) {}
    }
}
