package com.example.openmobileproxy

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        Log.d("BootReceiver", "Device booted — checking if proxy service should auto-start")

        try {
            val serverUrlKey = stringPreferencesKey("server_url")
            val deviceIdKey = stringPreferencesKey("device_id")

            // Read saved settings (blocking is OK in BroadcastReceiver, it has 10s window)
            val serverUrl = runBlocking {
                context.dataStore.data.map { it[serverUrlKey] }.first()
            } ?: ""
            val deviceId = runBlocking {
                context.dataStore.data.map { it[deviceIdKey] }.first()
            } ?: ""

            if (serverUrl.isNotEmpty() && deviceId.isNotEmpty()) {
                Log.d("BootReceiver", "Auto-starting proxy service for $deviceId at $serverUrl")
                val serviceIntent = Intent(context, ProxyForegroundService::class.java).apply {
                    putExtra("serverUrl", serverUrl)
                    putExtra("deviceId", deviceId)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
                LogRepository.log("Auto-started proxy after device reboot")
            } else {
                Log.d("BootReceiver", "No saved settings found, skipping auto-start")
            }
        } catch (e: Exception) {
            Log.e("BootReceiver", "Failed to auto-start service: ${e.message}", e)
        }
    }
}
