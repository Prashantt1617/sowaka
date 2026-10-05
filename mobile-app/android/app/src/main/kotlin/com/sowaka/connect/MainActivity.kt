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
 * disabled, and this enables the one asked for and disables the rest.
 *
 * The swap waits until the app leaves the screen. Disabling the component a
 * running task was launched from makes Android drop that task on the spot,
 * even with DONT_KILL_APP — which looked like the app closing itself the
 * moment it signed in. Done in onStop the task is dropped while nobody is
 * looking at it, and the next tap on the new icon starts the app afresh.
 */
class MainActivity : FlutterActivity() {
    private val aliases = mapOf(
        "AppIconConvrse" to ".LauncherConvrse",
        "AppIconAcmt" to ".LauncherAcmt",
    )

    /** The icon asked for, held until the app is in the background. */
    private var pendingIcon: String? = null
    private var hasPendingIcon = false

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "sowaka/app_icon")
            .setMethodCallHandler { call, result ->
                if (call.method != "use") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                val name = call.argument<String>("name")
                if (isCurrent(name)) {
                    // Already wearing it: nothing to schedule.
                    hasPendingIcon = false
                } else {
                    pendingIcon = name
                    hasPendingIcon = true
                }
                result.success(null)
            }
    }

    override fun onStop() {
        super.onStop()
        if (!hasPendingIcon) return
        hasPendingIcon = false
        try {
            useIcon(pendingIcon)
        } catch (_: Exception) {
            // An icon is decoration; the app must never fail over it.
        }
    }

    /** Whether the launcher entry already is the one [name] asks for. */
    private fun isCurrent(name: String?): Boolean {
        val wanted = aliases[name] ?: ".MainActivity"
        val pm = packageManager
        val all = aliases.values + ".MainActivity"
        return all.all { component -> isEnabled(pm, component) == (component == wanted) }
    }

    private fun isEnabled(pm: PackageManager, suffix: String): Boolean {
        val state = pm.getComponentEnabledSetting(ComponentName(this, "$packageName$suffix"))
        return when (state) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
            // The main activity's manifest default is enabled; the aliases' is disabled.
            PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> suffix == ".MainActivity"
            else -> false
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
