import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import '../../manager/data/dashboard_cache.dart';
import 'games_home_models.dart';
import 'games_models.dart';

/// What the server said when it refused, shown to the person as it came.
class GamesApiException implements Exception {
  const GamesApiException(this.message, {this.statusCode, this.details});

  final String message;
  final int? statusCode;

  /// What a refusal carries for the page to act on, e.g. the `challengeId`
  /// of a challenge already open with the same person.
  final Map<String, dynamic>? details;

  @override
  String toString() => message;
}

/// A page the app shows inside one of its tabs, as `GET /app-pages/:key`
/// gives it: today the Games tab's home.
class AppPage {
  const AppPage({required this.version, required this.html});

  final String version;
  final String html;

  Map<String, dynamic> toJson() => {'version': version, 'html': html};

  static AppPage? fromJson(Object? json) {
    if (json is! Map) return null;
    final version = json['version'];
    final html = json['html'];
    if (html is! String || html.isEmpty) return null;
    return AppPage(version: version is String ? version : '$version', html: html);
  }
}

/// What the phone holds for an app page: [page], or null when the server last
/// said there is none for this person (the native screen, at once).
class KeptAppPage {
  const KeptAppPage(this.page);

  final AppPage? page;
}

/// The last catalog this app fetched, and whose it was, so the tab draws at
/// once on its next opening and refreshes behind. Whose matters: the app
/// outlives a sign-out.
List<GameCatalogEntry>? _lastCatalog;
String? _lastCatalogFor;

/// The last Games home fetched, and whose it was: drawn at once the next
/// time the tab is opened, while a fresh one is on its way.
GamesHome? _lastHome;
String? _lastHomeFor;

/// The last Games home fetched, as the server sent it: what the web home is
/// shown when the server cannot be reached ([GamesApiService.homeJson]).
Map<String, dynamic>? _lastHomeJson;

/// The Games home last fetched for [userId], when that is who is asking.
GamesHome? gamesHomeFor(String userId) => _lastHomeFor == userId ? _lastHome : null;

/// The last page fetched for each person and game, kept only for when the
/// server cannot be reached. Every open asks the server first, so a game
/// updated in the database is what the next round plays — the catalog's
/// version can be minutes behind.
final Map<String, String> _pages = {};

/// An app page held this run, per person and key: the page, or that there is
/// none for them (the native screen). See [GamesApiService.appPage].
final Map<String, KeptAppPage> _appPages = {};

/// The catalog last fetched for [userId], when that is who is asking.
List<GameCatalogEntry>? gamesCatalogFor(String userId) =>
    _lastCatalogFor == userId ? _lastCatalog : null;

/// The game [key] from the catalog this run last fetched, if it has one: for
/// drawing a game somewhere other than the Games tab, such as its picture on
/// the Rank tab. Null before the catalog has been read.
GameCatalogEntry? keptCatalogGame(String key) =>
    _lastCatalog?.where((game) => game.key == key).firstOrNull;

/// Forgets everything held in memory. Called when the person signs out; the
/// device copy goes with the dashboard's.
void forgetGames() {
  _lastCatalog = null;
  _lastCatalogFor = null;
  _lastHome = null;
  _lastHomeFor = null;
  _lastHomeJson = null;
  _pages.clear();
  _appPages.clear();
}

class GamesApiService {
  GamesApiService({required this.session, String? baseUrl, http.Client? client})
    : baseUrl = baseUrl ?? ApiConfig.baseUrl,
      _client = client ?? http.Client();

  final AuthSession session;
  final String baseUrl;
  final http.Client _client;

  Map<String, String> get _headers => {
    'Authorization': 'Bearer ${session.token}',
    'Content-Type': 'application/json',
  };

  String get _cacheKey => 'games-${session.user.id}';
  String get _homeCacheKey => 'games-home-${session.user.id}';

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final response = method == 'POST'
        ? await _client.post(
            uri,
            headers: _headers,
            body: jsonEncode(body ?? const {}),
          )
        : await _client.get(uri, headers: _headers);
    Map<String, dynamic> json;
    try {
      final decoded = response.body.isEmpty ? null : jsonDecode(response.body);
      json = decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
    } catch (_) {
      json = <String, dynamic>{};
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final details = json['details'];
      throw GamesApiException(
        json['message'] as String? ?? 'Something went wrong. Try again.',
        statusCode: response.statusCode,
        details: details is Map ? Map<String, dynamic>.from(details) : null,
      );
    }
    return json;
  }

  /// [url] as the page can load it: a path on this API made whole.
  String? absoluteUrl(Object? url) {
    if (url is! String || url.trim().isEmpty) return null;
    return url.startsWith('/') ? '$baseUrl$url' : url;
  }

  /// [json] with every photo and picture address in it made whole, for a
  /// page that loads them itself: `photoUrl`, `imageUrl` and the like, at
  /// any depth. Anything already whole is left as it is.
  Object? absoluteUrls(Object? json) {
    if (json is List) return [for (final item in json) absoluteUrls(item)];
    if (json is! Map) return json;
    return <String, dynamic>{
      for (final entry in json.entries)
        '${entry.key}': entry.value is String && _isPictureKey('${entry.key}')
            ? (absoluteUrl(entry.value) ?? entry.value)
            : absoluteUrls(entry.value),
    };
  }

  static bool _isPictureKey(String key) =>
      key.endsWith('Url') || key == 'url' || key == 'thumbnail' || key == 'image' || key == 'photo';

  String _appPageCacheKey(String key) => 'app-page-$key-${session.user.id}';

  /// The app page [key] as this person last had it, without the network:
  /// the page, or that there is none. Null when it was never asked for.
  Future<KeptAppPage?> appPageFromCache(String key) async {
    final held = _appPages['${session.user.id}|$key'];
    if (held != null) return held;
    final kept = await DashboardCache.read(_appPageCacheKey(key));
    final row = kept?['appPage'];
    if (row == null) return null;
    final page = row['none'] == true ? null : AppPage.fromJson(row);
    if (page == null && row['none'] != true) return null;
    final result = KeptAppPage(page);
    _appPages['${session.user.id}|$key'] = result;
    return result;
  }

  /// The app page [key] for this person, from the server, kept in memory and
  /// on the phone. Null when the server has none for them (404), which is
  /// kept too, so the next launch goes straight to the native screen. Throws
  /// when the server could not be asked or refused otherwise.
  Future<AppPage?> appPage(String key) async {
    final startedAt = DateTime.now();
    AppPage? page;
    try {
      final json = await _request('GET', '/app-pages/${Uri.encodeComponent(key)}');
      page = AppPage.fromJson(json);
      if (page == null) throw const GamesApiException('The page could not be read.');
    } on GamesApiException catch (error) {
      if (error.statusCode != 404) rethrow;
      page = null;
    }
    _appPages['${session.user.id}|$key'] = KeptAppPage(page);
    unawaited(
      DashboardCache.write(_appPageCacheKey(key), {
        'appPage': page?.toJson() ?? {'none': true},
      }, startedAt: startedAt),
    );
    return page;
  }

  /// `GET /games/home` as the server sends it, with every picture's address
  /// made whole, for the web home. Kept as [home] keeps its own, so the
  /// native tab and a game opened offline find it too.
  ///
  /// With no answer (offline, or none within [timeout]) it is the home last
  /// kept, in memory or on the phone, marked `stale: true` so the page reads
  /// it again at the next chance; with nothing kept, the failure. A refusal
  /// from the server is never covered up.
  Future<Map<String, dynamic>> homeJson({Duration? timeout}) async {
    final startedAt = DateTime.now();
    Map<String, dynamic> json;
    try {
      final asked = _request('GET', '/games/home');
      json = await (timeout == null ? asked : asked.timeout(timeout));
    } on GamesApiException {
      rethrow;
    } catch (_) {
      final kept = await keptHomeJson();
      if (kept == null) rethrow;
      return {...kept, 'stale': true};
    }
    try {
      final home = GamesHome.fromJson(json, absolute: absoluteUrl);
      _lastHome = home;
      _lastHomeFor = session.user.id;
      _lastHomeJson = json;
      _lastCatalog = home.games;
      _lastCatalogFor = session.user.id;
      unawaited(DashboardCache.write(_homeCacheKey, {'home': json}, startedAt: startedAt));
      unawaited(
        DashboardCache.write(_cacheKey, {
          'catalog': {'games': json['games'] ?? const []},
        }, startedAt: startedAt),
      );
    } catch (_) {
      // The page reads it as it came; the native copy just is not kept.
    }
    return Map<String, dynamic>.from(absoluteUrls(json) as Map);
  }

  /// The home last fetched for this person as the server sent it, with
  /// pictures made whole: from memory, else from the phone. Null when none.
  Future<Map<String, dynamic>?> keptHomeJson() async {
    Map<String, dynamic>? json = _lastHomeFor == session.user.id ? _lastHomeJson : null;
    json ??= (await DashboardCache.read(_homeCacheKey))?['home'];
    if (json == null) return null;
    return Map<String, dynamic>.from(absoluteUrls(json) as Map);
  }

  /// `GET /games/leaderboard?period=week|all` as the server sends it, with
  /// photos made whole, for the web home.
  Future<Map<String, dynamic>> pointsLeaderboardJson(String period) async {
    final json = await _request(
      'GET',
      '/games/leaderboard?period=${period == 'all' ? 'all' : 'week'}',
    );
    return Map<String, dynamic>.from(absoluteUrls(json) as Map);
  }

  /// The company's games, in order. Kept in memory and on the device.
  Future<List<GameCatalogEntry>> catalog() async {
    final startedAt = DateTime.now();
    final json = await _request('GET', '/games/catalog');
    final games = parseGameCatalog(json);
    _lastCatalog = games;
    _lastCatalogFor = session.user.id;
    unawaited(
      DashboardCache.write(_cacheKey, {'catalog': json}, startedAt: startedAt),
    );
    return games;
  }

  /// Everything the Games tab's home draws, in one round trip. The catalog in
  /// it is kept as [catalog] keeps its own, so a game opened from a
  /// notification still finds it offline.
  Future<GamesHome> home() async {
    final startedAt = DateTime.now();
    final json = await _request('GET', '/games/home');
    final home = GamesHome.fromJson(json, absolute: absoluteUrl);
    _lastHome = home;
    _lastHomeFor = session.user.id;
    _lastHomeJson = json;
    _lastCatalog = home.games;
    _lastCatalogFor = session.user.id;
    unawaited(DashboardCache.write(_homeCacheKey, {'home': json}, startedAt: startedAt));
    unawaited(
      DashboardCache.write(_cacheKey, {
        'catalog': {'games': json['games'] ?? const []},
      }, startedAt: startedAt),
    );
    return home;
  }

  /// The home as this person last saw it, without the network; else a home
  /// of the catalog last kept. Null when there is neither.
  Future<GamesHome?> homeFromCache() async {
    final held = gamesHomeFor(session.user.id);
    if (held != null) return held;
    final kept = await DashboardCache.read(_homeCacheKey);
    final json = kept?['home'];
    if (json != null) {
      try {
        return GamesHome.fromJson(json, absolute: absoluteUrl);
      } catch (_) {}
    }
    final catalog = await catalogFromCache();
    return catalog == null ? null : GamesHome.ofCatalog(catalog);
  }

  /// The company's individuals by engagement points: this week's (since
  /// Monday, India time) or all time.
  Future<PointsLeaderboard> pointsLeaderboard(PointsPeriod period) async =>
      PointsLeaderboard.fromJson(
        await _request(
          'GET',
          '/games/leaderboard?period=${period == PointsPeriod.week ? 'week' : 'all'}',
        ),
        absolute: absoluteUrl,
      );

  /// The catalog as this person last saw it, without the network. Null when
  /// there is none.
  Future<List<GameCatalogEntry>?> catalogFromCache() async {
    final held = gamesCatalogFor(session.user.id);
    if (held != null) return held;
    final kept = await DashboardCache.read(_cacheKey);
    final json = kept?['catalog'];
    if (json == null) return null;
    try {
      return parseGameCatalog(json);
    } catch (_) {
      return null;
    }
  }

  /// Where a game's page lives. The app never opens it as a link (that
  /// request could not carry the session); it is the page's address once
  /// loaded, so it has a real origin of its own.
  Uri pageUri(String key) =>
      Uri.parse('$baseUrl/play/${Uri.encodeComponent(key)}');

  /// A web game's page, fetched with the person's session.
  Future<String> page(GameCatalogEntry game) async {
    final cacheKey = '${session.user.id}|${game.key}';
    final http.Response response;
    try {
      response = await _client.get(
        pageUri(game.key),
        headers: {'Authorization': 'Bearer ${session.token}'},
      );
    } catch (_) {
      // Offline: the last copy fetched, if there is one, rather than nothing.
      final held = _pages[cacheKey];
      if (held != null) return held;
      rethrow;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      String? message;
      try {
        message = (jsonDecode(response.body) as Map<String, dynamic>)['message']
            as String?;
      } catch (_) {}
      throw GamesApiException(
        message ?? 'This game could not be opened. Try again.',
        statusCode: response.statusCode,
      );
    }
    final type = response.headers['content-type'] ?? '';
    if (!type.startsWith('text/html')) {
      throw const GamesApiException('This game could not be opened. Try again.');
    }
    final html = utf8.decode(response.bodyBytes, allowMalformed: true);
    _pages[cacheKey] = html;
    return html;
  }

  /// Records a score; the server keeps the person's best and answers with
  /// the board as it now is.
  Future<GameLeaderboard> submitScore(String key, num score) async {
    final json = await _request(
      'POST',
      '/games/${Uri.encodeComponent(key)}/score',
      body: {'score': score},
    );
    return GameLeaderboard.fromJson(json);
  }

  /// The company's top ten, and the person's own best.
  Future<GameLeaderboard> leaderboard(String key) async => GameLeaderboard.fromJson(
    await _request('GET', '/games/${Uri.encodeComponent(key)}/leaderboard'),
  );

  // ---------------------------------------------------------------- challenges
  //
  // One colleague against another in a catalog game, on the same boards.
  // What these answer goes to the game's page much as the server sent it:
  // the page, not the app, is what draws a challenge.

  /// Colleagues who can be challenged: the whole company, bar counsellors
  /// and the person themselves, by name when [query] is given. Photos come
  /// back as whole URLs.
  Future<Map<String, dynamic>> colleagues(String query, {int limit = 50}) async {
    final q = query.trim();
    final json = await _request(
      'GET',
      Uri(
        path: '/games/challenges/colleagues',
        queryParameters: {if (q.isNotEmpty) 'q': q, 'limit': '$limit'},
      ).toString(),
    );
    final rows = json['colleagues'];
    return {
      'colleagues': [
        if (rows is List)
          for (final row in rows)
            if (row is Map)
              {
                ...Map<String, dynamic>.from(row),
                'photoUrl': absoluteUrl(row['photoUrl']),
              },
      ],
    };
  }

  /// Challenges [opponentUserId] to [gameKey]; the new challenge.
  Future<Map<String, dynamic>> createChallenge(String gameKey, String opponentUserId) async =>
      _challengeOf(await _request(
        'POST',
        '/games/challenges',
        body: {'gameKey': gameKey, 'opponentUserId': opponentUserId},
      ));

  /// The person's challenges in [gameKey]: `incoming`, `outgoing`, `active`
  /// and `recent`, each a list.
  Future<Map<String, dynamic>> challenges(String gameKey) async {
    final json = await _request(
      'GET',
      Uri(path: '/games/challenges', queryParameters: {'game': gameKey}).toString(),
    );
    return {
      for (final list in const ['incoming', 'outgoing', 'active', 'recent'])
        list: json[list] is List ? json[list] as List : const <dynamic>[],
    };
  }

  Future<Map<String, dynamic>> challenge(String id) async =>
      _challengeOf(await _request('GET', '/games/challenges/${Uri.encodeComponent(id)}'));

  Future<Map<String, dynamic>> acceptChallenge(String id) async =>
      _challengeOf(await _request('POST', '/games/challenges/${Uri.encodeComponent(id)}/accept'));

  Future<Map<String, dynamic>> declineChallenge(String id) async =>
      _challengeOf(await _request('POST', '/games/challenges/${Uri.encodeComponent(id)}/decline'));

  /// A score mid-round, for the other player to see at once.
  Future<Map<String, dynamic>> reportLive(String id, num score) => _request(
    'POST',
    '/games/challenges/${Uri.encodeComponent(id)}/live',
    body: {'score': score},
  );

  /// The person's final score; the challenge after it.
  Future<Map<String, dynamic>> finishChallenge(String id, num score) async =>
      _challengeOf(await _request(
        'POST',
        '/games/challenges/${Uri.encodeComponent(id)}/finish',
        body: {'score': score},
      ));

  static Map<String, dynamic> _challengeOf(Map<String, dynamic> json) {
    final challenge = json['challenge'];
    if (challenge is! Map) {
      throw const GamesApiException('Something went wrong. Try again.');
    }
    return Map<String, dynamic>.from(challenge);
  }
}
