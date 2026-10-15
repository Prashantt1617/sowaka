/// Secret Squad's post in the Connect feed (type `secret_squad`), read from
/// its body as `docs/secret-squad.md` ("Feed card") describes it:
///
/// ```
/// {sessionId, office, title, subtitle, kicker, rewards, rewardsNote,
///  lobbyOpensAt, startsAt, gameKey, webUrl}
/// ```
///
/// plus, when the server has them, `status` (the session's own:
/// `cancelled`, `over`, ...), `endsAt` (ISO), and `rounds`
/// (`[{huntMs, breakMs}]`), from which the card works out when the session
/// is over.
library;

/// Where the session is, as the card shows it.
enum SquadCardPhase {
  /// Counting down to the lobby: "Lobby opens in HH:MM:SS".
  countdown,

  /// The lobby is open: "Lobby open · starts in M:SS".
  lobby,

  /// Rounds are being played: "Playing now".
  playing,

  /// The session is over: "Ended".
  ended,

  /// Called off from the backend: "Cancelled".
  cancelled,
}

class SecretSquadPost {
  SecretSquadPost(Map<String, dynamic> body)
    : sessionId = _text(body['sessionId']),
      office = _text(body['office']),
      title = _text(body['title'], 'Secret Squad'),
      subtitle = _text(
        body['subtitle'],
        'Your word is a clue to find your secret squad.',
      ),
      kicker = _text(body['kicker'], 'SQUAD HUNT'),
      rewards = _text(body['rewards'], 'SURPRISE REWARDS'),
      rewardsNote = _text(body['rewardsNote'], 'For the top squads to link up'),
      gameKey = _text(body['gameKey'], 'secret-squad'),
      webUrl = _https(body['webUrl']),
      status = _text(body['status']).toLowerCase(),
      startsAt = _time(body['startsAt']),
      lobbyOpensAt =
          _time(body['lobbyOpensAt']) ??
          _time(body['startsAt'])?.subtract(defaultLobby),
      endsAt = _time(body['endsAt']) ?? _endFromRounds(body);

  /// How long the lobby is open when the post does not say (the rules'
  /// default).
  static const defaultLobby = Duration(minutes: 3);

  /// How long a session is taken to last when the post carries neither
  /// `endsAt` nor its rounds: past this the card reads "Ended" by itself.
  static const assumedLength = Duration(hours: 1);

  /// Reading a round's word before its hunt starts.
  static const dealing = Duration(seconds: 10);

  final String sessionId;
  final String office;
  final String title;
  final String subtitle;
  final String kicker;
  final String rewards;
  final String rewardsNote;
  final String gameKey;

  /// Where the web lobby is, for a phone where the game cannot open in the
  /// app. Only ever an https address.
  final String? webUrl;

  /// The session's status as the server last wrote it on the post; empty
  /// when it sends none.
  final String status;
  final DateTime? startsAt;
  final DateTime? lobbyOpensAt;

  /// When the last round ends, when the post says or its rounds tell.
  final DateTime? endsAt;

  /// Where the session is at [now]: from the server's status where it is
  /// final (cancelled, over), and from the clock otherwise, so a card left
  /// on screen moves on by itself.
  SquadCardPhase phaseAt(DateTime now) {
    if (status == 'cancelled' || status == 'canceled') {
      return SquadCardPhase.cancelled;
    }
    if (const {'over', 'ended', 'finished'}.contains(status)) {
      return SquadCardPhase.ended;
    }
    final start = startsAt;
    if (start == null) return SquadCardPhase.countdown;
    final end = endsAt ?? start.add(assumedLength);
    if (!now.isBefore(end)) return SquadCardPhase.ended;
    if (!now.isBefore(start)) return SquadCardPhase.playing;
    // The server knows the lobby is open even if this phone's clock is a
    // little behind.
    if (status == 'lobby') return SquadCardPhase.lobby;
    final opens = lobbyOpensAt ?? start.subtract(defaultLobby);
    return now.isBefore(opens)
        ? SquadCardPhase.countdown
        : SquadCardPhase.lobby;
  }

  /// What is left until [to], in whole seconds rounded up, never below zero:
  /// a countdown reads 0:01 until the very end, not 0:00 a second early.
  static Duration remaining(DateTime? to, DateTime now) {
    if (to == null) return Duration.zero;
    final ms = to.difference(now).inMilliseconds;
    if (ms <= 0) return Duration.zero;
    return Duration(seconds: (ms + 999) ~/ 1000);
  }

  /// `22:50:10`; hours as many as there are.
  static String clock(Duration left) {
    final s = left.inSeconds;
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(s ~/ 3600)}:${two(s % 3600 ~/ 60)}:${two(s % 60)}';
  }

  /// `2:14`; minutes as many as there are.
  static String shortClock(Duration left) {
    final s = left.inSeconds;
    return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
  }

  static const _days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  static const _months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  /// `Fri 17 Oct`, on this phone's calendar.
  static String dateLabel(DateTime at) {
    final local = at.toLocal();
    return '${_days[local.weekday - 1]} ${local.day} ${_months[local.month - 1]}';
  }

  /// `4:00 pm`, on this phone's clock.
  static String timeLabel(DateTime at) {
    final local = at.toLocal();
    final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
    final minute = local.minute.toString().padLeft(2, '0');
    return '$hour:$minute ${local.hour < 12 ? 'am' : 'pm'}';
  }
}

String _text(Object? value, [String fallback = '']) {
  if (value is! String) return fallback;
  final trimmed = value.trim();
  return trimmed.isEmpty ? fallback : trimmed;
}

String? _https(Object? value) {
  if (value is! String) return null;
  final uri = Uri.tryParse(value.trim());
  if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) return null;
  return uri.toString();
}

DateTime? _time(Object? value) {
  if (value is num) {
    return DateTime.fromMillisecondsSinceEpoch(value.toInt(), isUtc: true);
  }
  if (value is! String || value.trim().isEmpty) return null;
  return DateTime.tryParse(value.trim());
}

/// The end of the last round from the session's rounds, when the post
/// carries them: each is dealt, hunted, then (all but the last) a break.
DateTime? _endFromRounds(Map<String, dynamic> body) {
  final start = _time(body['startsAt']);
  final rounds = body['rounds'];
  if (start == null || rounds is! List || rounds.isEmpty) return null;
  var total = Duration.zero;
  for (var i = 0; i < rounds.length; i++) {
    final round = rounds[i];
    if (round is! Map) return null;
    final hunt = round['huntMs'];
    if (hunt is! num || hunt <= 0) return null;
    total += SecretSquadPost.dealing + Duration(milliseconds: hunt.toInt());
    final rest = round['breakMs'];
    if (i < rounds.length - 1 && rest is num && rest > 0) {
      total += Duration(milliseconds: rest.toInt());
    }
  }
  return start.add(total);
}
