import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' show Color;

/// A game built into the app, or a page the app loads into its own screen.
enum GameKind { web, native }

/// How a game's scores are read: which way is better, and what they count.
class GameScoring {
  const GameScoring({this.higherIsBetter = true, this.label = 'points'});

  factory GameScoring.fromJson(Map<String, dynamic> json) {
    final label = json['label'];
    return GameScoring(
      higherIsBetter: json['higherIsBetter'] != false,
      label: label is String && label.trim().isNotEmpty ? label.trim() : 'points',
    );
  }

  final bool higherIsBetter;
  final String label;

  Map<String, dynamic> toJson() => {
    'higherIsBetter': higherIsBetter,
    'label': label,
  };
}

/// One game on the Games tab, as `GET /games/catalog` describes it. Which
/// games a company gets, and everything about each, lives in the database,
/// so a new game or a changed one needs no release.
class GameCatalogEntry {
  const GameCatalogEntry({
    required this.key,
    required this.name,
    required this.kind,
    this.tagline = '',
    this.description = '',
    this.instructions = '',
    this.accentColor,
    this.backgroundColor,
    this.order = 0,
    this.thumbnail,
    this.scoring,
    this.hasPage = false,
    this.hostedUrl,
    this.version = '',
  });

  /// One row of the catalog, or null for a row this app cannot use: no key
  /// or name, or a kind it does not know. A newer server's game is skipped,
  /// never a crash.
  static GameCatalogEntry? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final json = Map<String, dynamic>.from(raw);
    final key = _string(json['key']).trim();
    final name = _string(json['name']).trim();
    final kind = switch (json['kind']) {
      'web' => GameKind.web,
      'native' => GameKind.native,
      _ => null,
    };
    if (key.isEmpty || name.isEmpty || kind == null) return null;
    final scoring = json['scoring'];
    final hosted = _string(json['hostedUrl']).trim();
    final order = json['order'];
    return GameCatalogEntry(
      key: key,
      name: name,
      kind: kind,
      tagline: _string(json['tagline']).trim(),
      description: _string(json['description']).trim(),
      instructions: _string(json['instructions']).trim(),
      accentColor: parseHexColor(json['accentColor']),
      backgroundColor: parseHexColor(json['backgroundColor']),
      order: order is num ? order.toDouble() : 0,
      thumbnail: _string(json['thumbnail']).trim().isEmpty
          ? null
          : _string(json['thumbnail']).trim(),
      scoring: scoring is Map
          ? GameScoring.fromJson(Map<String, dynamic>.from(scoring))
          : null,
      hasPage: json['hasPage'] == true,
      hostedUrl: hosted.startsWith('https://') ? hosted : null,
      version: _string(json['version']),
    );
  }

  final String key;
  final String name;
  final GameKind kind;
  final String tagline;
  final String description;
  final String instructions;
  final Color? accentColor;

  /// The page's own background, which the game's screen wears around it.
  final Color? backgroundColor;
  final double order;

  /// An https URL, a `data:image/...` URI, or a picture bundled with the app.
  final String? thumbnail;

  /// Null for a game without a leaderboard.
  final GameScoring? scoring;

  /// The page is served by the backend at `/play/<key>`.
  final bool hasPage;

  /// Or the game is hosted elsewhere, here.
  final String? hostedUrl;

  /// Changes whenever the entry does; a page fetched for another version is stale.
  final String version;

  bool get isWeb => kind == GameKind.web;

  /// A web game the app can open: it has a page somewhere.
  bool get hasWebPage => isWeb && (hasPage || hostedUrl != null);
}

/// The catalog from `{games: [...]}`, in the order given, without the rows
/// this app cannot use.
List<GameCatalogEntry> parseGameCatalog(Map<String, dynamic> json) {
  final rows = json['games'];
  if (rows is! List) return const [];
  return [
    for (final row in rows) ?GameCatalogEntry.tryParse(row),
  ];
}

String _string(Object? value) => value is String ? value : '';

/// '#RRGGBB' or '#AARRGGBB' to a colour; null for anything else.
Color? parseHexColor(Object? value) {
  if (value is! String) return null;
  final hex = value.trim().replaceFirst('#', '');
  if (!RegExp(r'^([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$').hasMatch(hex)) return null;
  final argb = int.parse(hex.length == 6 ? 'FF$hex' : hex, radix: 16);
  return Color(argb);
}

/// What a thumbnail string points at.
sealed class GameThumbnail {
  const GameThumbnail();

  static final Map<String, GameThumbnail> _decoded = {};

  /// Read once per distinct string: a data URI is decoded the first time and
  /// the bytes kept, so a rebuild never decodes it again.
  static GameThumbnail of(String? raw) {
    if (raw == null || raw.isEmpty) return const NoThumbnail();
    return _decoded[raw] ??= _parse(raw);
  }

  static GameThumbnail _parse(String raw) {
    if (raw.startsWith('https://') || raw.startsWith('http://')) {
      return NetworkThumbnail(raw);
    }
    if (raw.startsWith('assets/')) return AssetThumbnail(raw);
    final data = RegExp(
      r'^data:(image/[a-zA-Z0-9.+-]+)(;base64)?,(.*)$',
      dotAll: true,
    ).firstMatch(raw);
    if (data == null) return const NoThumbnail();
    final type = data.group(1)!.toLowerCase();
    final base64 = data.group(2) != null;
    final body = data.group(3)!;
    try {
      if (type == 'image/svg+xml') {
        return SvgThumbnail(
          base64 ? utf8.decode(base64Decode(body)) : Uri.decodeComponent(body),
        );
      }
      if (!base64) return const NoThumbnail();
      return MemoryThumbnail(base64Decode(body));
    } catch (_) {
      return const NoThumbnail();
    }
  }
}

class NoThumbnail extends GameThumbnail {
  const NoThumbnail();
}

class NetworkThumbnail extends GameThumbnail {
  const NetworkThumbnail(this.url);
  final String url;
}

class AssetThumbnail extends GameThumbnail {
  const AssetThumbnail(this.path);
  final String path;
}

class MemoryThumbnail extends GameThumbnail {
  const MemoryThumbnail(this.bytes);
  final Uint8List bytes;
}

class SvgThumbnail extends GameThumbnail {
  const SvgThumbnail(this.svg);
  final String svg;
}

/// One row of a company's leaderboard.
class GameLeaderEntry {
  const GameLeaderEntry({
    required this.rank,
    required this.playerName,
    required this.score,
    this.isMe = false,
  });

  factory GameLeaderEntry.fromJson(Map<String, dynamic> json) =>
      GameLeaderEntry(
        rank: (json['rank'] as num?)?.toInt() ?? 0,
        playerName: _string(json['playerName']),
        score: (json['score'] as num?) ?? 0,
        isMe: json['isMe'] == true,
      );

  final int rank;
  final String playerName;
  final num score;
  final bool isMe;
}

/// A company's top ten for a game, and the viewer's own best.
class GameLeaderboard {
  const GameLeaderboard({
    required this.entries,
    this.myRank,
    this.myBest,
    this.scoring = const GameScoring(),
    this.score,
    this.improved = false,
  });

  /// From `GET /games/:key/leaderboard`, or from `POST /games/:key/score`,
  /// which answers with the board as it now is.
  factory GameLeaderboard.fromJson(Map<String, dynamic> json) {
    final me = json['me'];
    final scoring = json['scoring'];
    return GameLeaderboard(
      entries: [
        for (final row in (json['leaderboard'] as List<dynamic>? ?? const []))
          if (row is Map) GameLeaderEntry.fromJson(Map<String, dynamic>.from(row)),
      ],
      myRank: me is Map ? (me['rank'] as num?)?.toInt() : null,
      myBest: me is Map ? me['score'] as num? : null,
      scoring: scoring is Map
          ? GameScoring.fromJson(Map<String, dynamic>.from(scoring))
          : const GameScoring(),
      score: json['score'] as num?,
      improved: json['improved'] == true,
    );
  }

  final List<GameLeaderEntry> entries;
  final int? myRank;
  final num? myBest;
  final GameScoring scoring;

  /// After a submission: the score as recorded, and whether it was a new best.
  final num? score;
  final bool improved;

  /// What the page is handed: names and scores, never anyone's id.
  Map<String, dynamic> toPageJson({required String company}) => {
    'entries': [
      for (final entry in entries)
        {
          'rank': entry.rank,
          'name': entry.playerName,
          'score': entry.score,
          'me': entry.isMe,
        },
    ],
    'me': myBest == null ? null : {'rank': myRank, 'score': myBest},
    'company': company,
    'label': scoring.label,
    'higherIsBetter': scoring.higherIsBetter,
    'score': ?score,
    if (score != null) 'improved': improved,
  };
}
