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
