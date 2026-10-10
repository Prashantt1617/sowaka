/// The company ranked by engagement points (GET /profile/leaderboard).
library;

/// One person on the leaderboard. Ties share a rank: 980, 860, 860, 790 rank
/// 1, 2, 2, 4.
class LeaderboardEntry {
  const LeaderboardEntry({
    required this.userId,
    required this.name,
    required this.points,
    required this.rank,
    this.photoUrl,
  });

  final String userId;
  final String name;
  final int points;
  final int rank;

  /// Sent only for the podium and the people named — the viewer and whoever's
  /// profile it is. The list rows draw no photo.
  final String? photoUrl;

  String get firstName => name.trim().split(RegExp(r'\s+')).first;

  static LeaderboardEntry? maybe(Object? json) =>
      json is Map<String, dynamic> ? LeaderboardEntry.fromJson(json) : null;

  factory LeaderboardEntry.fromJson(Map<String, dynamic> json) =>
      LeaderboardEntry(
        userId: json['userId'] as String? ?? '',
        name: json['name'] as String? ?? '',
        points: (json['points'] as num?)?.toInt() ?? 0,
        rank: (json['rank'] as num?)?.toInt() ?? 0,
        photoUrl: (json['photoUrl'] as String?)?.trim().isNotEmpty == true
            ? json['photoUrl'] as String
            : null,
      );
}

class Leaderboard {
  const Leaderboard({
    required this.total,
    required this.viewer,
    required this.subject,
    required this.podium,
    required this.entries,
  });

  /// Everyone ranked, the viewer's company only.
  final int total;

  /// The signed-in person's own place. Null only for someone the server does
  /// not rank (a counsellor, say).
  final LeaderboardEntry? viewer;

  /// The person whose profile this is, when it is not the viewer's own.
  final LeaderboardEntry? subject;

  /// The top three, never anyone on zero points.
  final List<LeaderboardEntry> podium;

  /// Everyone, highest first.
  final List<LeaderboardEntry> entries;

  factory Leaderboard.fromJson(Map<String, dynamic> json) => Leaderboard(
    total: (json['total'] as num?)?.toInt() ?? 0,
    viewer: LeaderboardEntry.maybe(json['viewer']),
    subject: LeaderboardEntry.maybe(json['subject']),
    podium: [
      for (final row in json['podium'] as List<dynamic>? ?? const [])
        if (row is Map<String, dynamic>) LeaderboardEntry.fromJson(row),
    ],
    entries: [
      for (final row in json['entries'] as List<dynamic>? ?? const [])
        if (row is Map<String, dynamic>) LeaderboardEntry.fromJson(row),
    ],
  );
}

/// Which game or challenge a row of point activity came from.
enum PointSource {
  captionChallenge,
  photoStoryChallenge,
  mostLikely,
  hintRelay,

  /// A colleague challenge in a catalog game; the row names the game.
  gameChallenge,
  other,
}

PointSource _sourceOf(Object? value) => switch (value) {
  'caption_challenge' => PointSource.captionChallenge,
  'photo_story_challenge' => PointSource.photoStoryChallenge,
  'most_likely' => PointSource.mostLikely,
  'hint_relay' => PointSource.hintRelay,
  'game_challenge' => PointSource.gameChallenge,
  _ => PointSource.other,
};

/// One row of the credit history: a challenge or game and what it came to in
/// the month.
class PointActivity {
  const PointActivity({
    required this.source,
    required this.title,
    required this.detail,
    required this.points,
    required this.at,
    this.gameKey,
  });

  final PointSource source;
  final String title;
  final String detail;

  /// For a game challenge: the catalog game it was played in, for its picture.
  final String? gameKey;

  /// Net, and so possibly negative when points went back.
  final int points;
  final DateTime at;

  factory PointActivity.fromJson(Map<String, dynamic> json) => PointActivity(
    source: _sourceOf(json['source']),
    title: json['title'] as String? ?? 'Points',
    detail: json['detail'] as String? ?? '',
    points: (json['points'] as num?)?.toInt() ?? 0,
    at: DateTime.tryParse(json['at'] as String? ?? '')?.toLocal() ??
        DateTime.now(),
    gameKey: (json['gameKey'] as String?)?.trim().isNotEmpty == true
        ? (json['gameKey'] as String).trim()
        : null,
  );
}

/// The signed-in person's credit history for one month
/// (GET /profile/points/activity).
class PointsHistory {
  const PointsHistory({
    required this.name,
    required this.photoUrl,
    required this.rank,
    required this.points,
    required this.movement,
    required this.month,
    required this.months,
    required this.earned,
    required this.activity,
  });

  final String name;
  final String? photoUrl;
  final int? rank;
  final int points;

  /// Places climbed since the month began; negative is down.
  final int movement;

  /// 'YYYY-MM'.
  final String month;

  /// Months there is anything to show for, newest first, this month always.
  final List<String> months;

  /// Net points this month.
  final int earned;
  final List<PointActivity> activity;

  factory PointsHistory.fromJson(Map<String, dynamic> json) => PointsHistory(
    name: json['name'] as String? ?? '',
    photoUrl: (json['photoUrl'] as String?)?.trim().isNotEmpty == true
        ? json['photoUrl'] as String
        : null,
    rank: (json['rank'] as num?)?.toInt(),
    points: (json['points'] as num?)?.toInt() ?? 0,
    movement: (json['movement'] as num?)?.toInt() ?? 0,
    month: json['month'] as String? ?? '',
    months: [
      for (final month in json['months'] as List<dynamic>? ?? const [])
        '$month',
    ],
    earned: (json['earned'] as num?)?.toInt() ?? 0,
    activity: [
      for (final row in json['activity'] as List<dynamic>? ?? const [])
        if (row is Map<String, dynamic>) PointActivity.fromJson(row),
    ],
  );
}
