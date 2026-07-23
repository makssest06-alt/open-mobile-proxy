package com.example.openmobileproxy

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.TextUtils
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.example.openmobileproxy.databinding.ActivityMainBinding
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

val Context.dataStore by preferencesDataStore(name = "settings")

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val serverUrlKey = stringPreferencesKey("server_url")
    private val deviceIdKey = stringPreferencesKey("device_id")

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted: Boolean ->
        if (isGranted) {
            LogRepository.log("Notification permission granted")
        } else {
            Toast.makeText(this, "Notifications are recommended for background work", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        loadSettings()
        checkAndRequestPermissions()

        binding.btnStartStop.setOnClickListener {
            toggleProxyService()
        }

        // Button to open Accessibility Settings
        binding.btnEnableA11y.setOnClickListener {
            LogRepository.log("Opening Accessibility Settings...")
            try {
                val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                startActivity(intent)
            } catch (e: Exception) {
                LogRepository.log("Failed to open Accessibility Settings: ${e.message}")
                Toast.makeText(this, "Please enable Accessibility Service manually in Settings", Toast.LENGTH_LONG).show()
            }
        }

        // Подписываемся на логи из LogRepository
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                LogRepository.logs.collect { message ->
                    addLogToUi(message)
                }
            }
        }
        
        LogRepository.log("App ready. Enter VPS URL and Start.")
    }

    override fun onResume() {
        super.onResume()
        // Check accessibility service status every time the user returns to the app
        updateAccessibilityStatus()
    }

    private fun updateAccessibilityStatus() {
        val enabled = isAccessibilityServiceEnabled()
        if (enabled) {
            binding.layoutA11yWarning.visibility = View.GONE
            binding.tvA11yOk.visibility = View.VISIBLE
            LogRepository.log("Accessibility Service: ✅ ENABLED")
        } else {
            binding.layoutA11yWarning.visibility = View.VISIBLE
            binding.tvA11yOk.visibility = View.GONE
            LogRepository.log("Accessibility Service: ⚠️ NOT ENABLED — IP rotation will not work!")
        }
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val enabledServices = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false

        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabledServices)
        while (splitter.hasNext()) {
            val component = splitter.next()
            val comp = ComponentName.unflattenFromString(component)
            if (comp != null && comp.packageName == packageName && comp.className == ProxyAccessibilityService::class.java.name) {
                return true
            }
        }
        return false
    }

    private fun addLogToUi(text: String) {
        val time = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        val currentLogs = binding.tvLogs.text.toString()
        binding.tvLogs.text = "[$time] $text\n$currentLogs"
    }

    private fun loadSettings() {
        lifecycleScope.launch {
            val serverUrl = dataStore.data.map { it[serverUrlKey] }.first() ?: ""
            val deviceId = dataStore.data.map { it[deviceIdKey] }.first() ?: ""
            binding.etServerUrl.setText(serverUrl)
            binding.etDeviceId.setText(deviceId)
        }
    }

    private fun toggleProxyService() {
        val url = binding.etServerUrl.text.toString().trim()
        val id = binding.etDeviceId.text.toString().trim()

        if (url.isEmpty() || id.isEmpty()) {
            Toast.makeText(this, "Please fill in all fields", Toast.LENGTH_SHORT).show()
            return
        }

        // Warn if accessibility service is not enabled
        if (!isAccessibilityServiceEnabled()) {
            Toast.makeText(this, "⚠️ Accessibility Service not enabled! IP rotation won't work.", Toast.LENGTH_LONG).show()
            LogRepository.log("WARNING: Starting without Accessibility Service — IP rotation disabled!")
        }

        lifecycleScope.launch {
            dataStore.edit { it[serverUrlKey] = url; it[deviceIdKey] = id }
        }

        val intent = Intent(this, ProxyForegroundService::class.java).apply {
            putExtra("serverUrl", url)
            putExtra("deviceId", id)
        }

        if (binding.btnStartStop.text == "Start Proxy") {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(intent)
                } else {
                    startService(intent)
                }
                binding.btnStartStop.text = "Stop Proxy"
                binding.tvStatus.text = "Status: Running"
                LogRepository.log("Starting service for $id...")
            } catch (e: Exception) {
                LogRepository.log("Start error: ${e.message}")
            }
        } else {
            stopService(intent)
            binding.btnStartStop.text = "Start Proxy"
            binding.tvStatus.text = "Status: Stopped"
            LogRepository.log("Stopping service...")
        }
    }

    private fun checkAndRequestPermissions() {
        // Уведомления (Android 13+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        // Оптимизация батареи
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                try {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivity(intent)
                } catch (e: Exception) {}
            }
        }
    }
}
