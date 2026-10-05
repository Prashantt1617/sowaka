import 'package:shared_preferences/shared_preferences.dart';

/// What this device remembers between launches about how the app should open.
///
/// Someone on a geotagged shift opens onto the punch screen the first time
/// they open the app on a working day, and only that once: after it, a
/// missing punch changes only where the app opens — Quick Actions, with the
/// punch card in reach. The showing is remembered by date, so tomorrow gets
/// its own.
class StartupPrefs {
  const StartupPrefs();

  static const _punchPromptDateKey = 'startup.punchPromptDate';

  /// Set by a sign-in or onboarding: the launch that follows it has just
  /// taken the person through enough screens, so the punch screen holds for
  /// that one launch only. The next launch of the day opens on it as usual.
  static const _punchPromptHoldKey = 'startup.punchPromptHold';

  static String _key(DateTime date) =>
      '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

  /// Whether the punch screen has already had today's showing.
  Future<bool> punchPromptShown({DateTime? today}) async {
    try {
      final preferences = await SharedPreferences.getInstance();
      return preferences.getString(_punchPromptDateKey) ==
          _key(today ?? DateTime.now());
    } catch (_) {
      // Unreadable storage shows the prompt again rather than never: missing a
      // punch costs someone a correction request.
      return false;
    }
  }

  /// Holds the punch screen for the next launch only.
  Future<void> holdPunchPromptOnce() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      await preferences.setBool(_punchPromptHoldKey, true);
    } catch (_) {
      // Then it shows on that launch, which is the harmless direction.
    }
  }

  /// Whether a hold is in place — and clears it, so it covers one launch.
  Future<bool> takePunchPromptHold() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      final held = preferences.getBool(_punchPromptHoldKey) ?? false;
      if (held) await preferences.remove(_punchPromptHoldKey);
      return held;
    } catch (_) {
      return false;
    }
  }

  Future<void> markPunchPromptShown({DateTime? today}) async {
    try {
      final preferences = await SharedPreferences.getInstance();
      await preferences.setString(
        _punchPromptDateKey,
        _key(today ?? DateTime.now()),
      );
    } catch (_) {
      // Then it shows once more next launch, which is the harmless direction.
    }
  }
}
