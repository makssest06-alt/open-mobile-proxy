package com.example.openmobileproxy

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class ProxyForegroundService : Service() {

    private val tag = "ProxyService"
    private val notificationId = 1
    private val channelId = "ProxyServiceChannel"

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .build()

    private val ipClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private val activeSocketsMap = ConcurrentHashMap<Int, Socket>()
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private var localSocks5Server: LocalSocks5Server? = null

    private var serverUrl = ""
    private var deviceId = ""
    private var apiKey = ""

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    private fun log(message: String) {
        LogRepository.log(message)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        var rawUrl = intent?.getStringExtra("serverUrl") ?: ""
        deviceId = intent?.getStringExtra("deviceId") ?: ""

        // Очистка URL от опечаток (пробелы, запятые вместо точек, лишние символы в начале)
        serverUrl = rawUrl.trim()
            .replace(",", ".")
            .replace(Regex("^[^hH]*http"), "http") // Убирает мусор перед http
            .replace(Regex("^[^0-9]*(\\d+\\.\\d+)"), "$1") // Убирает мусор перед IP если нет http
        
        if (!serverUrl.startsWith("http")) {
            serverUrl = "http://$serverUrl"
        }

        if (serverUrl.isEmpty() || deviceId.isEmpty()) {
            log("Error: Server URL or Device ID is missing")
            stopSelf()
            return START_NOT_STICKY
        }

        log("Service starting for $deviceId...")

        try {
            val notification = createNotification("OpenMobileProxy is active")

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
            } else {
                startForeground(notificationId, notification)
            }

            acquireLocks()

            if (localSocks5Server == null) {
                log("Starting local SOCKS5 server on port 1080...")
                localSocks5Server = LocalSocks5Server(1080)
                localSocks5Server?.start()
            }

            startProxyLogic()
        } catch (e: Exception) {
            log("Start error: ${e.message}")
            stopSelf()
        }

        return START_STICKY
    }

    private fun startProxyLogic() {
        serviceScope.launch {
            var registered = false
            var retryDelayMs = 2000L
            while (isActive && !registered) {
                try {
                    log("Registering device on VPS at $serverUrl...")
                    if (registerDevice()) {
                        registered = true
                        log("Registration successful. Connecting WebSocket...")
                        launch { connectWebSocketWithRetry() }
                        launch { startHeartbeat() }
                    } else {
                        log("Registration failed. Retrying in ${retryDelayMs / 1000}s...")
                        delay(retryDelayMs)
                        retryDelayMs = (retryDelayMs * 2).coerceAtMost(30000L)
                    }
                } catch (e: Exception) {
                    log("Error during registration: ${e.message}. Retrying in ${retryDelayMs / 1000}s...")
                    delay(retryDelayMs)
                    retryDelayMs = (retryDelayMs * 2).coerceAtMost(30000L)
                }
            }
        }
    }

    private suspend fun registerDevice(): Boolean = withContext(Dispatchers.IO) {
        val registerUrl = if (serverUrl.endsWith("/")) "${serverUrl}api/devices/register" else "$serverUrl/api/devices/register"
        try {
            val bodyText = json.encodeToString(RegisterRequest(deviceId, Build.MODEL, "user_1"))
            val mediaType = "application/json; charset=utf-8".toMediaType()
            val requestBody = bodyText.toRequestBody(mediaType)
            val request = Request.Builder()
                .url(registerUrl)
                .post(requestBody)
                .addHeader("x-register-token", "default-register-secret")
                .build()

            ipClient.newCall(request).execute().use { response ->
                log("HTTP Register Response: ${response.code}")
                if (response.isSuccessful) {
                    try {
                        val body = response.body?.string() ?: ""
                        val parsed = json.decodeFromString<RegisterResponse>(body)
                        if (!parsed.apiKey.isNullOrEmpty()) {
                            apiKey = parsed.apiKey
                            log("Received API key from server")
                        }
                    } catch (e: Exception) {
                        log("Warning: Could not parse registration response: ${e.message}")
                    }
                    true
                } else {
                    false
                }
            }
        } catch (e: Exception) {
            log("Network error: ${e.message}")
            false
        }
    }

    private suspend fun connectWebSocketWithRetry() {
        var delayMs = 2000L
        val wsUrl = serverUrl.replace("http://", "ws://").replace("https://", "wss://").let {
            if (it.endsWith("/")) "${it}ws/device" else "$it/ws/device"
        }

        while (serviceScope.isActive) {
            log("Attempting WebSocket connection to $wsUrl...")
            val request = Request.Builder()
                .url(wsUrl)
                .addHeader("x-device-id", deviceId)
                .addHeader("x-api-key", apiKey)
                .build()

            var wsActive = true

            val listener = object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    this@ProxyForegroundService.webSocket = webSocket
                    delayMs = 2000L
                    log("WebSocket Connected successfully!")
                    updateNotification("Proxy Online")
                }
                override fun onMessage(webSocket: WebSocket, text: String) { handleTextMessage(text) }
                override fun onMessage(webSocket: WebSocket, bytes: ByteString) { handleBinaryMessage(bytes.toByteArray()) }
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    log("WebSocket Closing: $reason")
                    this@ProxyForegroundService.webSocket = null
                    wsActive = false
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    this@ProxyForegroundService.webSocket = null
                    log("WebSocket Failed: ${t.message}")
                    updateNotification("Reconnecting...")
                    wsActive = false
                }
            }

            val ws = client.newWebSocket(request, listener)
            webSocket = ws
            
            while (wsActive && serviceScope.isActive) { delay(1000) }

            ws.close(1000, "Reconnecting")
            webSocket = null

            if (serviceScope.isActive) {
                log("Retrying WebSocket in ${delayMs/1000}s...")
                delay(delayMs)
                delayMs = (delayMs * 2).coerceAtMost(60000L)
            }
        }
    }

    private fun handleTextMessage(text: String) {
        try {
            val base = json.decodeFromString<BaseMessage>(text)
            when (base.type) {
                "command" -> {
                    val cmd = json.decodeFromString<CommandMessage>(text)
                    if (cmd.command == "toggle_airplane_mode") {
                        log("Server command: IP Rotation requested")
                        toggleAirplaneMode()
                    }
                }
                "proxy_connect" -> {
                    val conn = json.decodeFromString<ProxyConnectMessage>(text)
                    log("Proxy: Open connection [ID: ${conn.connId}]")
                    getOrCreateSocket(conn.connId)
                }
                "proxy_disconnect" -> {
                    val disc = json.decodeFromString<ProxyDisconnectMessage>(text)
                    log("Proxy: Close connection [ID: ${disc.connId}]")
                    closeSocket(disc.connId)
                }
            }
        } catch (e: Exception) {
            Log.e(tag, "JSON error: $text", e)
        }
    }

    private fun handleBinaryMessage(data: ByteArray) {
        if (data.size < 4) return
        val connId = ByteBuffer.wrap(data, 0, 4).order(ByteOrder.BIG_ENDIAN).int
        val payload = data.copyOfRange(4, data.size)

        serviceScope.launch(Dispatchers.IO) {
            try {
                val socket = getOrCreateSocket(connId)
                socket?.outputStream?.write(payload)
                socket?.outputStream?.flush()
            } catch (e: Exception) {
                closeSocket(connId)
            }
        }
    }

    private fun getOrCreateSocket(connId: Int): Socket? {
        var socket = activeSocketsMap[connId]
        if (socket == null || socket.isClosed) {
            try {
                socket = Socket()
                socket.connect(InetSocketAddress("127.0.0.1", 1080), 5000)
                activeSocketsMap[connId] = socket
                startSocketReader(connId, socket)
            } catch (e: Exception) {
                log("Internal socket error ($connId): ${e.message}")
                return null
            }
        }
        return socket
    }

    private fun startSocketReader(connId: Int, socket: Socket) {
        serviceScope.launch(Dispatchers.IO) {
            val buffer = ByteArray(16384)
            val inputStream = socket.getInputStream()
            try {
                while (serviceScope.isActive) {
                    val read = inputStream.read(buffer)
                    if (read == -1) break
                    val message = ByteArray(4 + read)
                    ByteBuffer.wrap(message).order(ByteOrder.BIG_ENDIAN).putInt(connId)
                    System.arraycopy(buffer, 0, message, 4, read)
                    webSocket?.send(message.toByteString())
                }
            } catch (e: Exception) {
                Log.e(tag, "Socket $connId read error", e)
            } finally {
                closeSocket(connId)
                webSocket?.send(json.encodeToString(ProxyDisconnectAckMessage(connId = connId)))
            }
        }
    }

    private fun closeSocket(connId: Int) {
        activeSocketsMap.remove(connId)?.let { try { it.close() } catch (e: Exception) {} }
    }

    @Volatile
    private var cachedExternalIp: String? = null
    private var heartbeatCounter = 0

    private fun startHeartbeat() {
        serviceScope.launch {
            val batteryManager = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            // Fetch IP immediately on first heartbeat
            cachedExternalIp = fetchExternalIp()
            if (cachedExternalIp != null) {
                log("External IP: $cachedExternalIp")
            }
            while (isActive) {
                if (webSocket != null) {
                    val level = try {
                        batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                    } catch (e: Exception) { 100 }
                    webSocket?.send(json.encodeToString(
                        HeartbeatMessage(type = "heartbeat", battery = level, status = "online", ip = cachedExternalIp)
                    ))
                    log("Heartbeat sent (IP: $cachedExternalIp)")
                }
                delay(20000)
                heartbeatCounter++
                // Refresh IP every 3rd heartbeat (~60s) to avoid excessive requests
                if (heartbeatCounter % 3 == 0) {
                    cachedExternalIp = fetchExternalIp()
                }
            }
        }
    }

    private suspend fun fetchExternalIp(): String? = withContext(Dispatchers.IO) {
        // Try multiple services for reliability
        val services = listOf(
            "https://api.ipify.org",
            "https://ifconfig.me/ip",
            "https://icanhazip.com"
        )
        for (url in services) {
            try {
                val request = Request.Builder().url(url)
                    .header("User-Agent", "curl/7.0")
                    .build()
                ipClient.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        val ip = response.body?.string()?.trim()
                        if (!ip.isNullOrEmpty() && ip.length < 50) {
                            return@withContext ip
                        }
                    }
                }
            } catch (e: Exception) {
                // Try next service
            }
        }
        null
    }

    private fun toggleAirplaneMode() {
        serviceScope.launch {
            if (isRooted()) {
                log("Executing IP Rotate (ROOT method)")
                toggleAirplaneModeRoot()
            } else {
                log("Executing IP Rotate (Accessibility method) — make sure Accessibility Service is enabled!")
                val isServiceActive = ProxyAccessibilityService.isActive()
                if (!isServiceActive) {
                    log("❌ ERROR: Accessibility Service is NOT running! IP rotation impossible. Enable it in phone Settings → Accessibility → OpenMobileProxy Helper")
                }
                ProxyAccessibilityService.toggleAirplaneMode()
            }
            log("Waiting for network to reconnect and fetching new IP...")
            val oldIp = cachedExternalIp
            cachedExternalIp = waitForNetworkAndFetchIp()
            if (cachedExternalIp != null) {
                log("✅ IP after rotation: $cachedExternalIp (was: $oldIp)")
                // Send immediate heartbeat with new IP
                val batteryManager = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
                val level = try {
                    batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                } catch (e: Exception) { 100 }
                webSocket?.send(json.encodeToString(
                    HeartbeatMessage(battery = level, status = "online", ip = cachedExternalIp)
                ))
            } else {
                log("⚠️ Could not determine IP after rotation (network may still be reconnecting)")
            }
        }
    }

    private suspend fun waitForNetworkAndFetchIp(maxAttempts: Int = 12, initialDelayMs: Long = 1500L): String? {
        var currentDelay = initialDelayMs
        repeat(maxAttempts) { attempt ->
            delay(currentDelay)
            val ip = fetchExternalIp()
            if (ip != null) {
                log("IP detected on attempt ${attempt + 1}: $ip")
                return ip
            }
            log("Attempt ${attempt + 1}/$maxAttempts: Network reconnecting, retrying in ${currentDelay}ms...")
            currentDelay = (currentDelay * 1.3).toLong().coerceAtMost(5000L)
        }
        return null
    }

    private fun isRooted(): Boolean = arrayOf("/system/xbin/su", "/system/bin/su", "/sbin/su", "/data/local/xbin/su").any { java.io.File(it).exists() }

    private fun toggleAirplaneModeRoot() {
        try {
            val process = Runtime.getRuntime().exec("su")
            val os = process.outputStream
            os.write("settings put global airplane_mode_on 1\nam broadcast -a android.intent.action.AIRPLANE_MODE --ez state true\n".toByteArray())
            os.flush()
            Thread.sleep(3000)
            os.write("settings put global airplane_mode_on 0\nam broadcast -a android.intent.action.AIRPLANE_MODE --ez state false\nexit\n".toByteArray())
            os.flush()
            process.waitFor()
            log("IP Rotation successful (ROOT)")
        } catch (e: Exception) {
            log("ROOT IP Rotation failed: ${e.message}")
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(channelId, "Proxy Service", NotificationManager.IMPORTANCE_LOW)
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(serviceChannel)
        }
    }

    private fun createNotification(content: String): Notification {
        val pendingIntent = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)

        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("Open Mobile Proxy")
            .setContentText(content)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(content: String) {
        try {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(notificationId, createNotification(content))
        } catch (e: Exception) {
            Log.e(tag, "Notify failed", e)
        }
    }

    private fun acquireLocks() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Proxy::WakeLock").apply {
                acquire()
            }
            val wifiManager = getSystemService(Context.WIFI_SERVICE) as WifiManager
            @Suppress("DEPRECATION")
            wifiLock = wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Proxy::WifiLock").apply { acquire() }
        } catch (e: Exception) {
            log("Locks error: ${e.message}")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        log("Proxy service stopped.")
        serviceScope.cancel()
        wakeLock?.let { if (it.isHeld) it.release() }
        wifiLock?.let { if (it.isHeld) it.release() }
        localSocks5Server?.stop()
        activeSocketsMap.values.forEach { it.close() }
        webSocket?.close(1000, "Service destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
