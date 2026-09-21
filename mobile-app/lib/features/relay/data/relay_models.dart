/// What a player's screen is, at this instant.
///
/// The server sends the whole thing on every change rather than a nudge to go
/// and fetch: a round trip in the middle of a three-second clue cadence is a
/// round trip nobody has. Nothing here is derived on the phone except the
/// countdown between messages.
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
    required this.roundSecondsLeft,
    required this.questionSecondsLeft,
    required this.secondsUntilStart,
    required this.instructionsVideoUrl,
    required this.pieces,
    required this.teammates,
    required this.standings,
    required this.yourRank,
    required this.pointsThisRound,
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

  static RelayState fromJson(Map<String, dynamic> json) {
    final event = Map<String, dynamic>.from(json['event'] as Map? ?? const {});
    final team = Map<String, dynamic>.from(json['team'] as Map? ?? const {});
    return RelayState(
      phase: RelayPhase.from(json['phase'] as String?),
      eventName: event['name'] as String? ?? '',
      round: (event['round'] as num?)?.toInt() ?? 0,
      rounds: (event['rounds'] as num?)?.toInt() ?? 0,
      teamName: team['name'] as String? ?? '',
      points: (team['points'] as num?)?.toInt() ?? 0,
      isLeader: json['isLeader'] == true,
      leadName: json['leadName'] as String? ?? '',
      leadIsAnswering: json['leadIsAnswering'] == true,
      prompt: json['prompt'] as String? ?? '',
      questionNumber: (json['questionNumber'] as num?)?.toInt() ?? 0,
      questionsPerRound: (json['questionsPerRound'] as num?)?.toInt() ?? 0,
      roundSecondsLeft: (json['roundSecondsLeft'] as num?)?.toInt() ?? 0,
      questionSecondsLeft: (json['questionSecondsLeft'] as num?)?.toInt() ?? 0,
      secondsUntilStart: (json['secondsUntilStart'] as num?)?.toInt() ?? 0,
      instructionsVideoUrl: json['instructionsVideoUrl'] as String? ?? '',
      pieces: [
        for (final piece in (json['pieces'] as List? ?? const []))
          if (piece is Map) RelayPiece.fromJson(Map<String, dynamic>.from(piece)),
      ],
      teammates: [
        for (final mate in (json['teammates'] as List? ?? const []))
          if (mate is Map) RelayTeammate.fromJson(Map<String, dynamic>.from(mate)),
      ],
      standings: [
        for (final row in (json['standings'] as List? ?? const []))
          if (row is Map) RelayStanding.fromJson(Map<String, dynamic>.from(row)),
      ],
      yourRank: (json['yourRank'] as num?)?.toInt() ?? 0,
      pointsThisRound: (json['pointsThisRound'] as num?)?.toInt() ?? 0,
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
    label: json['label'] as String? ?? '',
    text: json['text'] as String? ?? '',
  );
}

class RelayTeammate {
  const RelayTeammate({
    required this.name,
    required this.present,
    required this.isLeader,
    required this.hasClue,
  });

  final String name;
  final bool present;
  final bool isLeader;

  /// Whether they are holding a piece right now — the tick beside their face.
  final bool hasClue;

  static RelayTeammate fromJson(Map<String, dynamic> json) => RelayTeammate(
    name: json['name'] as String? ?? '',
    present: json['present'] == true,
    isLeader: json['isLeader'] == true,
    hasClue: json['hasClue'] == true,
  );
}

class RelayStanding {
  const RelayStanding({required this.rank, required this.name, required this.points});

  final int rank;
  final String name;
  final int points;

  static RelayStanding fromJson(Map<String, dynamic> json) => RelayStanding(
    rank: (json['rank'] as num?)?.toInt() ?? 0,
    name: json['name'] as String? ?? '',
    points: (json['points'] as num?)?.toInt() ?? 0,
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
    correct: json['correct'] == true,
    skipped: json['skipped'] == true,
    answer: json['answer'] as String? ?? '',
  );
}
