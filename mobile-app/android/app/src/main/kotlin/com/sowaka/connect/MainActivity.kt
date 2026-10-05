package com.sowaka.connect

import android.content.ComponentName
import android.content.pm.PackageManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Hosts Flutter, and swaps the launcher icon on request.
 *
 * Android has no alternate-icon API; the icon belongs to whichever launcher
 * component is enabled. The manifest declares one alias per company, all
 * disabled, and this enables the one asked for and disables the rest — with
 * DONT_KILL_APP, so the running app carries on. The launcher picks the change
 * up on its own schedule, which on most phones is within a few seconds.
 */
class MainActivity : FlutterActivity() {
    private val aliases = mapOf(
        "AppIconConvrse" to ".LauncherConvrse",
        "AppIconAcmt" to ".LauncherAcmt",
    )

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "sowaka/app_icon")
            .setMethodCallHandler { call, result ->
                if (call.method != "use") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                try {
                    useIcon(call.argument<String>("name"))
                    result.success(null)
                } catch (error: Exception) {
                    result.error("icon", error.message, null)
                }
            }
    }

    private fun useIcon(name: String?) {
        val wanted = aliases[name] ?: ".MainActivity"
        val pm = packageManager
        val all = aliases.values + ".MainActivity"
        // Enable the wanted one first so there is never a moment with no
        // launcher entry, then retire the others.
        setEnabled(pm, wanted, true)
        for (component in all) if (component != wanted) setEnabled(pm, component, false)
    }

    private fun setEnabled(pm: PackageManager, suffix: String, enabled: Boolean) {
        val component = ComponentName(this, "$packageName$suffix")
        val state = if (enabled) PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        if (pm.getComponentEnabledSetting(component) == state) return
        // The main activity's manifest default is enabled; "default" reads as
        // enabled for it, so asking for enabled again is a no-op there.
        if (suffix == ".MainActivity" && enabled &&
            pm.getComponentEnabledSetting(component) == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT) return
        pm.setComponentEnabledSetting(component, state, PackageManager.DONT_KILL_APP)
    }
}
