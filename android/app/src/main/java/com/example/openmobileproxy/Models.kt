package com.example.openmobileproxy

import kotlinx.serialization.Serializable

@Serializable
data class RegisterRequest(
    val deviceId: String,
    val name: String,
    val userId: String
)

@Serializable
data class RegisterResponse(
    val status: String? = null,
    val deviceId: String? = null,
    val apiKey: String? = null,
    val error: String? = null
)

@Serializable
data class BaseMessage(
    val type: String
)

@Serializable
data class CommandMessage(
    val type: String,
    val command: String,
    val params: Map<String, String> = emptyMap()
)

@Serializable
data class ProxyConnectMessage(
    val type: String,
    val connId: Int
)

@Serializable
data class ProxyDisconnectMessage(
    val type: String,
    val connId: Int
)

@Serializable
data class HeartbeatMessage(
    val type: String = "heartbeat",
    val battery: Int,
    val status: String,
    val ip: String? = null
)

@Serializable
data class ProxyDisconnectAckMessage(
    val type: String = "proxy_disconnect_ack",
    val connId: Int
)
