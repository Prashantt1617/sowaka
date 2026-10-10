import 'games_models.dart';

/// What `GET /games/home` answers: everything the Games tab's home draws, in
/// one round trip.
class GamesHome {
  const GamesHome({
    this.points = 0,
    this.rank,
    this.total = 0,
    this.banner,
    this.liveContests = const [],
    this.liveRelay,
    this.challenges = const [],
    this.yourGames = const [],
    this.games = const [],
    this.playingNow = const PlayingNow(),
  });

  /// [absolute] makes a photo path on the API whole.
  factory GamesHome.fromJson(Map<String, dynamic> json, {String? Function(Object? url)? absolute}) {
    String? photo(Object? url) => absolute == null ? _stringOrNull(url) : absolute(url);
    List<T> list<T>(Object? raw, T? Function(Map<String, dynamic> row) parse) => [
      if (raw is List)
        for (final row in raw)
          if (row is Map) ?parse(Map<String, dynamic>.from(row)),
    ];
    final banner = json['banner'];
    final relay = json['liveRelay'];
    final playing = json['playingNow'];
    return GamesHome(
      points: _int(json['points']),
      rank: _intOrNull(json['rank']),
      total: _int(json['total']),
      banner: banner is Map ? ScoreBanner.fromJson(Map<String, dynamic>.from(banner), photo) : null,
      liveContests: list(json['liveContests'], (row) => LiveContest.tryParse(row, photo)),
      liveRelay: relay is Map ? LiveRelay.tryParse(Map<String, dynamic>.from(relay)) : null,
      challenges: list(json['challenges'], (row) => HomeChallenge.tryParse(row, photo)),
      yourGames: list(json['yourGames'], PlayedGame.tryParse),
      games: parseGameCatalog(json),
      playingNow: playing is Map
          ? PlayingNow.fromJson(Map<String, dynamic>.from(playing))
          : const PlayingNow(),
    );
  }

  /// The viewer's engagement points, `User.points`.
  final int points;

  /// Where they stand in the company on those points; null when unranked.
  final int? rank;
  final int total;
  final ScoreBanner? banner;
  final List<LiveContest> liveContests;
  final LiveRelay? liveRelay;
  final List<HomeChallenge> challenges;
  final List<PlayedGame> yourGames;

  /// The company's catalog, as `GET /games/catalog` lists it.
  final List<GameCatalogEntry> games;
  final PlayingNow playingNow;

  /// A home made only of a catalog: for a server from before `/games/home`,
  /// or the catalog kept on the phone while the home is on its way.
  factory GamesHome.ofCatalog(List<GameCatalogEntry> games) => GamesHome(games: games);
}

/// "Yami just beat your Odd One Out score": the latest time in the last two
/// days a colleague's best went past the viewer's own.
class ScoreBanner {
  const ScoreBanner({
    required this.gameKey,
    required this.gameName,
    required this.name,
    required this.firstName,
    this.photoUrl,
    this.score = 0,
    this.yourBest = 0,
  });

  factory ScoreBanner.fromJson(Map<String, dynamic> json, String? Function(Object?) photo) {
    final name = _string(json['name']);
    final first = _string(json['firstName']);
    return ScoreBanner(
      gameKey: _string(json['gameKey']),
      gameName: _string(json['gameName']),
      name: name,
      firstName: first.isEmpty ? name.split(' ').first : first,
      photoUrl: photo(json['photoUrl']),
      score: _int(json['score']),
      yourBest: _int(json['yourBest']),
    );
  }

  final String gameKey;
  final String gameName;
  final String name;
  final String firstName;
  final String? photoUrl;
  final int score;
  final int yourBest;
}

/// The three Connect contest formats, as the Games tab names them.
enum ContestKind { caption, photo, mostLikely }

ContestKind? _contestKind(Object? raw) => switch (raw) {
  'caption' => ContestKind.caption,
  'photo' => ContestKind.photo,
  'mostLikely' => ContestKind.mostLikely,
  _ => null,
};

class ContestFace {
  const ContestFace({required this.name, required this.initials, this.photoUrl});

  final String name;
  final String initials;
  final String? photoUrl;
}

/// A Connect contest in the viewer's feed that is still taking entries.
class LiveContest {
  const LiveContest({
    required this.id,
    required this.kind,
    required this.title,
    this.prompt = '',
    this.closesAt,
    required this.authorName,
    this.authorUserId,
    this.authorPhotoUrl,
    this.entries = 0,
    this.entrants = const [],
    this.entered = false,
  });

  static LiveContest? tryParse(Map<String, dynamic> json, String? Function(Object?) photo) {
    final id = _string(json['id']);
    final kind = _contestKind(json['type']);
    if (id.isEmpty || kind == null) return null;
    final author = json['author'] is Map
        ? Map<String, dynamic>.from(json['author'] as Map)
        : const <String, dynamic>{};
    final entrants = json['entrants'];
    return LiveContest(
      id: id,
      kind: kind,
      title: _string(json['title']),
      prompt: _string(json['prompt']),
      closesAt: _date(json['closesAt']),
      authorName: _string(author['name']),
      authorUserId: _stringOrNull(author['userId']),
      authorPhotoUrl: photo(author['photoUrl']),
      entries: _int(json['entries']),
      entrants: [
        if (entrants is List)
          for (final row in entrants)
            if (row is Map)
              ContestFace(
                name: _string(row['name']),
                initials: _string(row['initials']),
                photoUrl: photo(row['photoUrl']),
              ),
      ],
      entered: json['entered'] == true,
    );
  }

  /// The Connect post.
  final String id;
  final ContestKind kind;
  final String title;

  /// The brief: a task, or a Most Likely question.
  final String prompt;

  /// Null for a contest with no closing time.
  final DateTime? closesAt;
  final String authorName;
  final String? authorUserId;
  final String? authorPhotoUrl;
  final int entries;
  final List<ContestFace> entrants;
  final bool entered;
}

/// The company's Hint Relay, while it is on or still to come.
class LiveRelay {
  const LiveRelay({
    required this.eventId,
    required this.title,
    required this.phase,
    this.startsAt,
    this.postId,
    this.players = 0,
    this.teams = 0,
    this.teamName,
  });

  static LiveRelay? tryParse(Map<String, dynamic> json) {
    final id = _string(json['eventId']);
    if (id.isEmpty) return null;
    final phase = switch (json['phase']) {
      'live' => RelayPhaseNow.live,
      'lobby' => RelayPhaseNow.lobby,
      _ => RelayPhaseNow.upcoming,
    };
    final post = _string(json['postId']);
    final team = _string(json['teamName']);
    return LiveRelay(
      eventId: id,
      title: _string(json['title']).isEmpty ? 'Hint Relay' : _string(json['title']),
      phase: phase,
      startsAt: _date(json['startsAt']),
      postId: post.isEmpty ? null : post,
      players: _int(json['players']),
      teams: _int(json['teams']),
      teamName: team.isEmpty ? null : team,
    );
  }

  final String eventId;
  final String title;
  final RelayPhaseNow phase;
  final DateTime? startsAt;

  /// Its post in Connect, where the game is joined from.
  final String? postId;
  final int players;
  final int teams;
  final String? teamName;
}

enum RelayPhaseNow { live, lobby, upcoming }

/// A colleague challenge waiting on the viewer.
class HomeChallenge {
  const HomeChallenge({
    required this.id,
    required this.gameKey,
    required this.gameName,
    required this.incoming,
    required this.fromName,
    required this.fromFirstName,
    this.fromPhotoUrl,
    this.beat,
  });

  static HomeChallenge? tryParse(Map<String, dynamic> json, String? Function(Object?) photo) {
    final id = _string(json['id']);
    final key = _string(json['gameKey']);
    if (id.isEmpty || key.isEmpty) return null;
    final from = json['from'] is Map
        ? Map<String, dynamic>.from(json['from'] as Map)
        : const <String, dynamic>{};
    final name = _string(from['name']);
    final first = _string(from['firstName']);
    return HomeChallenge(
      id: id,
      gameKey: key,
      gameName: _string(json['gameName']),
      incoming: json['kind'] != 'your_turn',
      fromName: name,
      fromFirstName: first.isEmpty ? name.split(' ').first : first,
      fromPhotoUrl: photo(from['photoUrl']),
      beat: _intOrNull(json['beat']),
    );
  }

  final String id;
  final String gameKey;
  final String gameName;

  /// Sent to the viewer and not yet answered; otherwise accepted and waiting
  /// on the viewer's round.
  final bool incoming;
  final String fromName;
  final String fromFirstName;
  final String? fromPhotoUrl;

  /// What to beat: their round once played, else their best in the game.
  final int? beat;
}

/// A catalog game the viewer has a score in.
class PlayedGame {
  const PlayedGame({required this.key, required this.best, this.rank, this.players = 0});

  static PlayedGame? tryParse(Map<String, dynamic> json) {
    final key = _string(json['key']);
    if (key.isEmpty) return null;
    return PlayedGame(
      key: key,
      best: _int(json['best']),
      rank: _intOrNull(json['rank']),
      players: _int(json['players']),
    );
  }

  final String key;
  final int best;
  final int? rank;
  final int players;
}

/// Colleagues with game activity in the last few minutes.
class PlayingNow {
  const PlayingNow({this.count = 0, this.initials = const []});

  factory PlayingNow.fromJson(Map<String, dynamic> json) {
    final people = json['people'];
    return PlayingNow(
      count: _int(json['count']),
      initials: [
        if (people is List)
          for (final row in people)
            if (row is Map && _string(row['initials']).isNotEmpty) _string(row['initials']),
      ],
    );
  }

  final int count;
  final List<String> initials;
}

/// Which points a leaderboard ranks by.
enum PointsPeriod { week, all }

/// `GET /games/leaderboard?period=`: the company's individuals by engagement
/// points, and where the viewer stands.
class PointsLeaderboard {
  const PointsLeaderboard({required this.period, this.entries = const [], this.me});

  factory PointsLeaderboard.fromJson(
    Map<String, dynamic> json, {
    String? Function(Object? url)? absolute,
  }) {
    final rows = json['entries'];
    final me = json['me'];
    return PointsLeaderboard(
      period: json['period'] == 'week' ? PointsPeriod.week : PointsPeriod.all,
      entries: [
        if (rows is List)
          for (final row in rows)
            if (row is Map) ?PointsEntry.tryParse(Map<String, dynamic>.from(row), absolute),
      ],
      me: me is Map ? PointsStanding.fromJson(Map<String, dynamic>.from(me)) : null,
    );
  }

  final PointsPeriod period;
  final List<PointsEntry> entries;
  final PointsStanding? me;
}

class PointsEntry {
  const PointsEntry({
    required this.rank,
    required this.userId,
    required this.name,
    this.photoUrl,
    this.points = 0,
    this.department = '',
    this.moved,
  });

  static PointsEntry? tryParse(Map<String, dynamic> json, String? Function(Object?)? absolute) {
    final id = _string(json['userId']);
    if (id.isEmpty) return null;
    return PointsEntry(
      rank: _int(json['rank']),
      userId: id,
      name: _string(json['name']),
      photoUrl: absolute == null ? _stringOrNull(json['photoUrl']) : absolute(json['photoUrl']),
      points: _int(json['points']),
      department: _string(json['department']),
      moved: _intOrNull(json['moved']),
    );
  }

  final int rank;
  final String userId;
  final String name;
  final String? photoUrl;
  final int points;
  final String department;

  /// Places climbed this week, on the all-time board; null on the week's.
  final int? moved;
}

class PointsStanding {
  const PointsStanding({
    required this.rank,
    this.points = 0,
    this.weekPoints = 0,
    this.allTimePoints = 0,
    this.nextUpName,
    this.nextUpRank,
    this.gap,
  });

  factory PointsStanding.fromJson(Map<String, dynamic> json) {
    final next = json['nextUp'];
    final nextUp = next is Map ? Map<String, dynamic>.from(next) : null;
    final first = nextUp == null ? '' : _string(nextUp['firstName']);
    return PointsStanding(
      rank: _int(json['rank']),
      points: _int(json['points']),
      weekPoints: _int(json['weekPoints']),
      allTimePoints: _int(json['allTimePoints']),
      nextUpName: nextUp == null
          ? null
          : (first.isEmpty ? _string(nextUp['name']).split(' ').first : first),
      nextUpRank: nextUp == null ? null : _intOrNull(nextUp['rank']),
      gap: nextUp == null ? null : _intOrNull(nextUp['gap']),
    );
  }

  final int rank;

  /// On the board being looked at: this week's, or all time.
  final int points;
  final int weekPoints;
  final int allTimePoints;

  /// Who the viewer would pass next, their place, and the points it takes.
  final String? nextUpName;
  final int? nextUpRank;
  final int? gap;
}

String _string(Object? value) => value is String ? value.trim() : '';

String? _stringOrNull(Object? value) {
  final text = _string(value);
  return text.isEmpty ? null : text;
}

int _int(Object? value) => value is num ? value.round() : 0;

int? _intOrNull(Object? value) => value is num ? value.round() : null;

DateTime? _date(Object? value) =>
    value is String && value.isNotEmpty ? DateTime.tryParse(value)?.toLocal() : null;
