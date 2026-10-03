import 'package:shared_preferences/shared_preferences.dart';

/// Which finished sessions this device has already asked about.
///
/// The question comes up once. Without this it returned on every launch for
/// as long as the server kept offering the session, which is a nag rather
/// than an invitation; the card on Help home is what keeps it reachable.
class SessionPrompts {
  const SessionPrompts();

  static const _key = 'help.reviewAsked';

  /// At most this many ids are kept, newest last: enough that nobody is
  /// asked twice, small enough that the list never grows without end.
  static const _keep = 40;

  Future<bool> alreadyAsked(String sessionId) async {
    try {
      final preferences = await SharedPreferences.getInstance();
      return (preferences.getStringList(_key) ?? const []).contains(sessionId);
    } catch (_) {
      // Unreadable storage asks again rather than never: a second ask is a
      // smaller cost than losing the answer altogether.
      return false;
    }
  }

  Future<void> markAsked(String sessionId) async {
    try {
      final preferences = await SharedPreferences.getInstance();
      final asked = [
        ...(preferences.getStringList(_key) ?? const <String>[])
            .where((id) => id != sessionId),
        sessionId,
      ];
      await preferences.setStringList(
        _key,
        asked.length <= _keep ? asked : asked.sublist(asked.length - _keep),
      );
    } catch (_) {
      // Then it asks once more next launch, which is the harmless direction.
    }
  }
}
