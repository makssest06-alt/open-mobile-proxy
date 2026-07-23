package com.example.openmobileproxy

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.*

class ProxyAccessibilityService : AccessibilityService() {

    companion object {
        private var instance: ProxyAccessibilityService? = null
        private val scope = CoroutineScope(Dispatchers.Main + Job())

        fun toggleAirplaneMode() {
            val svc = instance
            if (svc != null) {
                svc.performToggle()
            } else {
                android.util.Log.e("ProxyA11y", "toggleAirplaneMode: Accessibility Service is NOT ACTIVE! Enable it in Settings → Accessibility → OpenMobileProxy Helper")
                LogRepository.log("❌ IP Rotation FAILED: Accessibility Service is NOT enabled! Go to Settings → Accessibility and enable 'OpenMobileProxy Helper'")
            }
        }

        fun isActive(): Boolean = instance != null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    override fun onDestroy() {
        super.onDestroy()
        instance = null
    }

    private fun performToggle() {
        android.util.Log.d("ProxyA11y", "performToggle: Triggered")
        scope.launch {
            // Open Airplane Mode settings
            val intent = Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            startActivity(intent)

            var targetNode: AccessibilityNodeInfo? = null
            for (attempt in 1..15) {
                delay(300)
                targetNode = findAirplaneModeNodeInAllWindows()
                if (targetNode != null) {
                    android.util.Log.d("ProxyA11y", "performToggle: Found target node on attempt $attempt")
                    break
                }
            }

            if (targetNode != null) {
                android.util.Log.d("ProxyA11y", "performToggle: Attempting first click on target node: ${targetNode.className}, text: ${targetNode.text}")
                val clicked = clickNodeOrParent(targetNode)
                android.util.Log.d("ProxyA11y", "performToggle: First click success: $clicked")
                
                delay(3000) // Wait in airplane mode
                
                // Re-fetch active window to get fresh node
                var freshTargetNode: AccessibilityNodeInfo? = null
                for (attempt in 1..10) {
                    freshTargetNode = findAirplaneModeNodeInAllWindows()
                    if (freshTargetNode != null) break
                    delay(200)
                }

                if (freshTargetNode != null) {
                    android.util.Log.d("ProxyA11y", "performToggle: Attempting second click to disable airplane mode")
                    clickNodeOrParent(freshTargetNode)
                } else {
                    android.util.Log.w("ProxyA11y", "performToggle: Fresh target node not found, falling back to original node reference")
                    clickNodeOrParent(targetNode)
                }
                
                delay(1500)
                android.util.Log.d("ProxyA11y", "performToggle: Going back to app")
                performGlobalAction(GLOBAL_ACTION_BACK)
            } else {
                android.util.Log.w("ProxyA11y", "performToggle: Could not find Airplane mode node, trying coordinate fallback")
                val simsNode = findNodeByTextInAllWindows(listOf("SIMs", "SIM-карты", "SIM карты", "SIM"))
                    ?: findNodeByTextInAllWindows(listOf("Internet", "Интернет", "Сеть", "Network"))
                val hotspotNode = findNodeByTextInAllWindows(listOf("Hotspot & tethering", "Точка доступа", "Модем", "Hotspot"))
                
                if (simsNode != null && hotspotNode != null) {
                    val simsRect = android.graphics.Rect()
                    val hotspotRect = android.graphics.Rect()
                    simsNode.getBoundsInScreen(simsRect)
                    hotspotNode.getBoundsInScreen(hotspotRect)
                    
                    val clickY = (simsRect.bottom + hotspotRect.top) / 2
                    val clickX = simsRect.centerX()
                    
                    android.util.Log.d("ProxyA11y", "performToggle: Midpoint click at ($clickX, $clickY) between SIMs/Internet (${simsRect.bottom}) and Hotspot (${hotspotRect.top})")
                    clickAt(clickX.toFloat(), clickY.toFloat())
                    
                    delay(3000) // Wait in airplane mode
                    
                    android.util.Log.d("ProxyA11y", "performToggle: Second click at ($clickX, $clickY) to disable airplane mode")
                    clickAt(clickX.toFloat(), clickY.toFloat())
                    
                    delay(1500)
                    android.util.Log.d("ProxyA11y", "performToggle: Going back to app")
                    performGlobalAction(GLOBAL_ACTION_BACK)
                } else {
                    android.util.Log.e("ProxyA11y", "performToggle: Bounding nodes not found (SIMs/Internet=$simsNode, Hotspot=$hotspotNode). Cannot perform coordinate click.")
                    // Fallback to back action to not leave user stuck
                    performGlobalAction(GLOBAL_ACTION_BACK)
                }
            }
        }
    }

    private fun clickNodeOrParent(node: AccessibilityNodeInfo): Boolean {
        var temp: AccessibilityNodeInfo? = node
        while (temp != null) {
            if (temp.isClickable) {
                val result = temp.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                android.util.Log.d("ProxyA11y", "clickNodeOrParent: Clicked node class=${temp.className}, result=$result")
                return result
            }
            temp = temp.parent
        }
        android.util.Log.w("ProxyA11y", "clickNodeOrParent: No clickable parent found for node class=${node.className}")
        return false
    }

    private fun findAirplaneModeNodeInAllWindows(): AccessibilityNodeInfo? {
        val activeRoot = rootInActiveWindow
        if (activeRoot != null) {
            android.util.Log.d("ProxyA11y", "Active window pkg: ${activeRoot.packageName}")
            android.util.Log.d("ProxyA11y", "--- DUMPING ACTIVE WINDOW HIERARCHY ---")
            logNodeHierarchy(activeRoot, 0)
            android.util.Log.d("ProxyA11y", "--- END ACTIVE WINDOW HIERARCHY ---")
            findAirplaneModeNodeManual(activeRoot)?.let { return it }
        } else {
            android.util.Log.d("ProxyA11y", "rootInActiveWindow is null")
        }
        
        try {
            val winList = windows
            android.util.Log.d("ProxyA11y", "Scanning ${winList.size} windows...")
            for (index in winList.indices) {
                val window = winList[index]
                val root = window.root
                if (root != null) {
                    android.util.Log.d("ProxyA11y", "Window #$index type=${window.type} pkg=${root.packageName}")
                    android.util.Log.d("ProxyA11y", "--- DUMPING WINDOW #$index HIERARCHY ---")
                    logNodeHierarchy(root, 0)
                    android.util.Log.d("ProxyA11y", "--- END WINDOW #$index HIERARCHY ---")
                    findAirplaneModeNodeManual(root)?.let { return it }
                } else {
                    android.util.Log.d("ProxyA11y", "Window #$index type=${window.type} root is null")
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("ProxyA11y", "Error retrieving windows: ${e.message}")
        }
        
        return null
    }

    private fun logNodeHierarchy(node: AccessibilityNodeInfo?, depth: Int) {
        if (node == null) return
        if (depth > 20) return // Safety limit
        val indent = "  ".repeat(depth)
        val text = node.text?.toString() ?: ""
        val desc = node.contentDescription?.toString() ?: ""
        val id = node.viewIdResourceName ?: ""
        val className = node.className?.toString() ?: ""
        android.util.Log.d("ProxyA11yTree", "$indent[$className] id=$id text='$text' desc='$desc' childCount=${node.childCount}")
        for (i in 0 until node.childCount) {
            logNodeHierarchy(node.getChild(i), depth + 1)
        }
    }

    private fun findAirplaneModeNodeManual(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        
        val text = node.text?.toString()
        val desc = node.contentDescription?.toString()
        val className = node.className?.toString() ?: ""
        
        if (node.packageName == "com.android.settings") {
            android.util.Log.d("ProxyA11yNode", "Visited: class=$className text=$text desc=$desc childCount=${node.childCount}")
        }
        
        if (text != null && (text.contains("Airplane mode", ignoreCase = true) || 
            text.contains("Авиарежим", ignoreCase = true) || 
            text.contains("В самолете", ignoreCase = true))) {
            return node
        }
        
        if (desc != null && (desc.contains("Airplane mode", ignoreCase = true) || 
            desc.contains("Авиарежим", ignoreCase = true) || 
            desc.contains("В самолете", ignoreCase = true))) {
            return node
        }
        
        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            val result = findAirplaneModeNodeManual(child)
            if (result != null) {
                return result
            }
        }
        return null
    }

    private fun findNodeByTextInAllWindows(patterns: List<String>): AccessibilityNodeInfo? {
        val activeRoot = rootInActiveWindow
        if (activeRoot != null) {
            findNodeByTextManual(activeRoot, patterns)?.let { return it }
        }
        try {
            for (window in windows) {
                val root = window.root
                if (root != null) {
                    findNodeByTextManual(root, patterns)?.let { return it }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("ProxyA11y", "Error retrieving windows in findNodeByText: ${e.message}")
        }
        return null
    }

    private fun findNodeByTextManual(node: AccessibilityNodeInfo?, patterns: List<String>): AccessibilityNodeInfo? {
        if (node == null) return null
        val text = node.text?.toString()
        val desc = node.contentDescription?.toString()
        
        if (text != null) {
            for (pattern in patterns) {
                if (text.contains(pattern, ignoreCase = true)) return node
            }
        }
        if (desc != null) {
            for (pattern in patterns) {
                if (desc.contains(pattern, ignoreCase = true)) return node
            }
        }
        
        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            val result = findNodeByTextManual(child, patterns)
            if (result != null) return result
        }
        return null
    }

    private fun clickAt(x: Float, y: Float) {
        val path = android.graphics.Path()
        path.moveTo(x, y)
        val gestureBuilder = android.accessibilityservice.GestureDescription.Builder()
        gestureBuilder.addStroke(android.accessibilityservice.GestureDescription.StrokeDescription(path, 0, 100))
        dispatchGesture(gestureBuilder.build(), object : AccessibilityService.GestureResultCallback() {
            override fun onCompleted(gestureDescription: android.accessibilityservice.GestureDescription?) {
                super.onCompleted(gestureDescription)
                android.util.Log.d("ProxyA11y", "Gesture click completed at ($x, $y)")
            }
            override fun onCancelled(gestureDescription: android.accessibilityservice.GestureDescription?) {
                super.onCancelled(gestureDescription)
                android.util.Log.e("ProxyA11y", "Gesture click cancelled at ($x, $y)")
            }
        }, null)
    }
}
