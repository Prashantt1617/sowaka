/// What a player's screen is, at this instant.
///
/// The server sends the whole thing on every change rather than a nudge to go
/// and fetch: a round trip in the middle of a three-second clue cadence is a
/// round trip nobody has. Nothing here is derived on the phone except the
/// countdown between messages.
/// Readers that never throw. A field arriving in an unexpected shape is read
/// as empty rather than crashing the game in the middle of a round.
int _int(Object? value) => value is num ? value.toInt() : int.tryParse('$value') ?? 0;
String _str(Object? value) => value is String ? value : '';
bool _bool(Object? value) => value == true;
List<Object?> _list(Object? value) => value is List ? value : const [];
Map<String, dynamic> _map(Object? value) =>
    value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

class RelayState {
  const RelayState({
    required this.phase,
    required this.eventName,
    required this.round,
    required this.rounds,
    required this.teamName,
    required this.points,
    required this.isLeader,
    required this.leadName,
    required this.leadIsAnswering,
    required this.prompt,
    required this.questionNumber,
    required this.questionsPerRound,
    required this.pointsPerCorrect,
    required this.roundSecondsLeft,
    required this.questionSecondsLeft,
    required this.secondsUntilStart,
    required this.instructionsVideoUrl,
    required this.pieces,
    required this.teammates,
    required this.standings,
    required this.yourRank,
    required this.pointsThisRound,
    this.lastOutcome,
    this.roundOutcomes = const [],
  });

  final RelayPhase phase;
  final String eventName;
  final int round;
  final int rounds;
  final String teamName;
  final int points;

  /// Only the leader has an answer box; everyone else holds pieces.
  final bool isLeader;
  final String leadName;

  /// Drives "Your team lead is answering" while they type.
  final bool leadIsAnswering;

  final String prompt;
  final int questionNumber;
  final int questionsPerRound;

  /// Taken from the event, so "+30 points" is never the phone's own guess.
  final int pointsPerCorrect;

  /// The clock players watch: the whole round, or the break before the next.
  final int roundSecondsLeft;

  /// The per-question cap, still enforced though it is not the display.
  final int questionSecondsLeft;

  /// Counts the lobby down to kick-off.
  final int secondsUntilStart;

  final String instructionsVideoUrl;

  /// Only ever this player's share of the puzzle.
  final List<RelayPiece> pieces;
  final List<RelayTeammate> teammates;
  final List<RelayStanding> standings;
  final int yourRank;
  final int pointsThisRound;

  /// Set for a few seconds after the team gets one right, for the banner and
  /// the confetti. Everyone on the team gets it, not only the lead.
  final RelayOutcome? lastOutcome;

  /// How each closed question this round went, in order: 'correct',
  /// 'skipped' or 'timeout'. Colours the pips.
  final List<String> roundOutcomes;

  static RelayState fromJson(Map<String, dynamic> json) {
    final event = _map(json['event']);
    final team = _map(json['team']);
    return RelayState(
      phase: RelayPhase.from(_str(json['phase'])),
      eventName: _str(event['name']),
      round: _int(event['round']),
      rounds: _int(event['rounds']),
      teamName: _str(team['name']),
      points: _int(team['points']),
      isLeader: _bool(json['isLeader']),
      leadName: _str(json['leadName']),
      leadIsAnswering: _bool(json['leadIsAnswering']),
      prompt: _str(json['prompt']),
      questionNumber: _int(json['questionNumber']),
      questionsPerRound: _int(json['questionsPerRound']),
      pointsPerCorrect: _int(json['pointsPerCorrect']),
      roundSecondsLeft: _int(json['roundSecondsLeft']),
      questionSecondsLeft: _int(json['questionSecondsLeft']),
      secondsUntilStart: _int(json['secondsUntilStart']),
      instructionsVideoUrl: _str(json['instructionsVideoUrl']),
      pieces: [
        for (final piece in _list(json['pieces']))
          if (piece is Map) RelayPiece.fromJson(Map<String, dynamic>.from(piece)),
      ],
      teammates: [
        for (final mate in _list(json['teammates']))
          if (mate is Map) RelayTeammate.fromJson(Map<String, dynamic>.from(mate)),
      ],
      standings: [
        for (final row in _list(json['standings']))
          if (row is Map) RelayStanding.fromJson(Map<String, dynamic>.from(row)),
      ],
      yourRank: _int(json['yourRank']),
      pointsThisRound: _int(json['pointsThisRound']),
      lastOutcome: json['lastOutcome'] is Map ? RelayOutcome.fromJson(_map(json['lastOutcome'])) : null,
      roundOutcomes: [for (final outcome in _list(json['roundOutcomes'])) _str(outcome)],
    );
  }
}

enum RelayPhase {
  lobby,
  playing,
  breakTime,
  finished;

  static RelayPhase from(String? value) => switch (value) {
    'playing' => RelayPhase.playing,
    'break' => RelayPhase.breakTime,
    'finished' => RelayPhase.finished,
    _ => RelayPhase.lobby,
  };
}

/// One share of a puzzle, on one person's screen and nowhere else.
class RelayPiece {
  const RelayPiece({required this.label, required this.text});

  final String label;
  final String text;

  static RelayPiece fromJson(Map<String, dynamic> json) => RelayPiece(
    label: _str(json['label']),
    text: _str(json['text']),
  );
}

class RelayTeammate {
  const RelayTeammate({
    required this.name,
    required this.present,
    required this.isLeader,
    required this.hasClue,
    required this.isYou,
  });

  final String name;
  final bool present;
  final bool isLeader;

  /// Whether they are holding a piece right now — the tick beside their face.
  final bool hasClue;

  /// The viewer's own row, labelled "(You)" on the roster.
  final bool isYou;

  static RelayTeammate fromJson(Map<String, dynamic> json) => RelayTeammate(
    name: _str(json['name']),
    present: _bool(json['present']),
    isLeader: _bool(json['isLeader']),
    hasClue: _bool(json['hasClue']),
    isYou: _bool(json['isYou']),
  );
}

class RelayStanding {
  const RelayStanding({required this.rank, required this.name, required this.points});

  final int rank;
  final String name;
  final int points;

  static RelayStanding fromJson(Map<String, dynamic> json) => RelayStanding(
    rank: _int(json['rank']),
    name: _str(json['name']),
    points: _int(json['points']),
  );
}

/// How a submitted answer landed.
class RelayResult {
  const RelayResult({required this.correct, required this.skipped, required this.answer});

  final bool correct;
  final bool skipped;

  /// Revealed once the question closes, so the team learns what it was.
  final String answer;

  static RelayResult fromJson(Map<String, dynamic> json) => RelayResult(
    correct: _bool(json['correct']),
    skipped: _bool(json['skipped']),
    answer: _str(json['answer']),
  );
}

/// What the Connect post shows this particular viewer: the event, and the
/// team they are on. Asked for separately because the post is the same for
/// everyone and the team is not.
class RelayCard {
  const RelayCard({
    required this.title,
    required this.status,
    required this.startsAt,
    required this.rewardAmount,
    required this.pointsPerCorrect,
    required this.instructionsVideoUrl,
    required this.teamName,
    required this.members,
  });

  final String title;
  final String status;
  final DateTime? startsAt;
  final int rewardAmount;
  final int pointsPerCorrect;
  final String instructionsVideoUrl;
  final String? teamName;
  final List<RelayCardMember> members;

  static RelayCard fromJson(Map<String, dynamic> json) {
    final event = _map(json['event']);
    final team = json['team'] is Map ? _map(json['team']) : null;
    return RelayCard(
      title: _str(event['title']),
      status: _str(event['status']),
      startsAt: DateTime.tryParse(_str(event['startsAt']))?.toLocal(),
      rewardAmount: _int(event['rewardAmount']),
      pointsPerCorrect: _int(event['pointsPerCorrect']),
      instructionsVideoUrl: _str(event['instructionsVideoUrl']),
      teamName: team == null ? null : _str(team['name']),
      members: [
        for (final member in _list(team?['members']))
          if (member is Map)
            RelayCardMember(
              name: _str(member['name']),
              isLeader: _bool(member['isLeader']),
              isYou: _bool(member['isYou']),
            ),
      ],
    );
  }
}

class RelayCardMember {
  const RelayCardMember({required this.name, required this.isLeader, required this.isYou});

  final String name;
  final bool isLeader;
  final bool isYou;
}

/// A question the team just got right.
class RelayOutcome {
  const RelayOutcome({required this.answer, required this.points});

  final String answer;
  final int points;

  static RelayOutcome fromJson(Map<String, dynamic> json) =>
      RelayOutcome(answer: _str(json['answer']), points: _int(json['points']));
}
