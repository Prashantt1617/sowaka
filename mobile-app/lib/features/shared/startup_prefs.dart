import 'package:shared_preferences/shared_preferences.dart';

/// What this device remembers between launches about how the app should open.
///
/// The punch screen used to appear on every cold start of a day with no
/// punch, which is right for the one day someone forgets and wrong for the
/// person who has already decided not to punch from the phone. It now gets
/// exactly one showing, after which a missing punch changes only where the
/// app opens — Quick Actions, with the punch card in reach.
class StartupPrefs {
  const StartupPrefs();

  static const _punchPromptKey = 'startup.punchPromptShown';

  Future<bool> punchPromptShown() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      return preferences.getBool(_punchPromptKey) ?? false;
    } catch (_) {
      // Unreadable storage shows the prompt again rather than never: missing a
      // punch costs someone a correction request.
      return false;
    }
  }

  Future<void> markPunchPromptShown() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      await preferences.setBool(_punchPromptKey, true);
    } catch (_) {
      // Then it shows once more next launch, which is the harmless direction.
    }
  }
}
