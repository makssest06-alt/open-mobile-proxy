package com.example.openmobileproxy

import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

object LogRepository {
    // Явно создаем область видимости для логов
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val _logs = MutableSharedFlow<String>(replay = 100)
    val logs = _logs.asSharedFlow()

    fun log(message: String) {
        Log.d("ProxyLog", message)
        // Используем явный запуск корутины через импортированную функцию launch
        scope.launch {
            try {
                _logs.emit(message)
            } catch (e: Exception) {
                // Игнорируем ошибки внутри системы логов
            }
        }
    }
}
