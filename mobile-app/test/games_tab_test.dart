// The Games tab's home against a fake server: every section drawn from one
// `GET /games/home`, each hidden when it has nothing; what its buttons open;
// a challenge accepted before its game opens; the leaderboard's two boards;
// and the tab asking nothing of the server until it is looked at.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/games/data/games_api_service.dart';
import 'package:mobile_app/features/games/data/games_home_models.dart';
import 'package:mobile_app/features/games/data/games_models.dart';
import 'package:mobile_app/features/games/presentation/games_home.dart';

final _session = AuthSession(
  token: 'session-token',
  user: const AuthUser(
    id: 'me',
    email: 'tanvi@getsowaka.com',
    name: 'Tanvi Shah',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    enabledTabs: ['connect', 'games'],
  ),
);

const _oddOneOut = {
  'key': 'odd-one-out',
  'name': 'Odd One Out',
  'tagline': "Spot the tile that's different",
  'kind': 'web',
  'order': 20,
  'scoring': {'higherIsBetter': true, 'label': 'points'},
  'hasPage': true,
  'version': '1',
};

const _garden = {
  'key': 'gratitude-garden',
  'name': 'Gratitude Garden',
  'tagline': 'Grow a tree of thanks',
  'kind': 'native',
  'order': 10,
  'thumbnail': 'assets/games/gratitude-garden.jpg',
  'hasPage': false,
  'version': '1',
};

Map<String, dynamic> _fullHome() {
  final soon = DateTime.now().add(const Duration(hours: 2, minutes: 14, seconds: 20));
  return {
    'success': true,
    'points': 7650,
    'rank': 4,
    'total': 31,
    'banner': {
      'gameKey': 'odd-one-out',
      'gameName': 'Odd One Out',
      'userId': 'y',
      'name': 'Yami Gupta',
      'firstName': 'Yami',
      'photoUrl': null,
      'score': 1300,
      'yourBest': 1120,
    },
    'liveContests': [
      {
        'id': 'post-photo',
        'type': 'photo',
        'postType': 'photo_story_challenge',
        'title': 'Best photo',
        'prompt': 'Your corner of the office',
        'closesAt': soon.toUtc().toIso8601String(),
        'author': {'userId': 'a', 'name': 'Aakshay Rao', 'photoUrl': null},
        'entries': 17,
        'entrants': [
          {'name': 'Ananya Bisht', 'initials': 'AB', 'photoUrl': null},
        ],
        'entered': false,
      },
    ],
    'liveRelay': {
      'eventId': 'e1',
      'title': 'Hint Relay',
      'status': 'live',
      'phase': 'live',
      'startsAt': null,
      'postId': 'post-relay',
      'players': 52,
      'teams': 9,
      'teamName': null,
    },
    'challenges': [
      {
        'id': 'ch-1',
        'gameKey': 'odd-one-out',
        'gameName': 'Odd One Out',
        'kind': 'incoming',
        'from': {'userId': 'r', 'name': 'Raghav', 'firstName': 'Raghav', 'photoUrl': null},
        'beat': 1100,
        'expiresAt': DateTime.now().add(const Duration(hours: 20)).toUtc().toIso8601String(),
      },
    ],
    'yourGames': [
      {'key': 'odd-one-out', 'best': 1620, 'rank': 3, 'players': 128},
    ],
    'games': [_garden, _oddOneOut],
    'playingNow': {
      'count': 12,
      'people': [
        {'name': 'Harsh', 'initials': 'H'},
      ],
    },
  };
}

const _emptyHome = {
  'success': true,
  'points': 0,
  'rank': 9,
  'total': 31,
  'banner': null,
  'liveContests': [],
  'liveRelay': null,
  'challenges': [],
  'yourGames': [],
  'games': [_oddOneOut],
  'playingNow': {'count': 0, 'people': []},
};

Map<String, dynamic> _board(String period) => {
  'success': true,
  'period': period,
  'entries': [
    {
      'rank': 1,
      'userId': 'shiv',
      'name': 'Shiv Kumar',
      'points': period == 'week' ? 980 : 9800,
      'department': 'Engineering',
      if (period == 'all') 'moved': 0,
    },
    {
      'rank': 2,
      'userId': 'ananya',
      'name': 'Ananya Bisht',
      'points': period == 'week' ? 860 : 8600,
      'department': 'Design',
      if (period == 'all') 'moved': -1,
    },
    {
      'rank': 3,
      'userId': 'kabir',
      'name': 'Kabir Shah',
      'points': period == 'week' ? 790 : 7889,
      'department': 'Sales',
      if (period == 'all') 'moved': 0,
    },
    {
      'rank': 4,
      'userId': 'me',
      'name': 'Tanvi Shah',
      'points': period == 'week' ? 600 : 7650,
      'department': 'Product',
      if (period == 'all') 'moved': 2,
    },
    {
      'rank': 5,
      'userId': 'rohan',
      'name': 'Rohan Mehta',
      'points': period == 'week' ? 0 : 7310,
      'department': 'Engineering',
      if (period == 'all') 'moved': -1,
    },
  ],
  'me': {
    'rank': 4,
    'points': period == 'week' ? 600 : 7650,
    'weekPoints': 600,
    'allTimePoints': 7650,
    'nextUp': {
      'userId': 'kabir',
      'name': 'Kabir Shah',
      'firstName': 'Kabir',
      'rank': 3,
      'gap': period == 'week' ? 191 : 240,
    },
  },
};

http.Response _json(Object body, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

void main() {
  late List<http.Request> requests;

  GamesApiService serviceAnswering(http.Response Function(http.Request request) answer) {
    requests = [];
    return GamesApiService(
      session: _session,
      baseUrl: 'https://api.example.test',
      client: MockClient((request) async {
        requests.add(request);
        return answer(request);
      }),
    );
  }

  final opened = <(String, String?)>[];
  final posts = <String>[];
  final created = <ContestKind>[];

  Widget host(
    GamesApiService service, {
    bool visible = true,
    List<GameCatalogEntry> fallback = const [],
  }) => MaterialApp(
    home: Scaffold(
      body: GamesHomeView(
        session: _session,
        service: service,
        visible: visible,
        canOpen: (game) =>
            game.kind == GameKind.native ? game.key == 'gratitude-garden' : game.hasWebPage,
        fallbackGames: fallback,
        onOpenGame: (_, game, {challengeId}) async => opened.add((game.key, challengeId)),
        onOpenPost: posts.add,
        onCreateContest: (kind) async => created.add(kind),
      ),
    ),
  );

  setUp(() {
    forgetGames();
    opened.clear();
    posts.clear();
    created.clear();
  });

  Future<void> scrollTo(WidgetTester tester, Finder finder) => tester.scrollUntilVisible(
    finder,
    200,
    scrollable: find
        .descendant(
          of: find.byKey(const PageStorageKey('games-home')),
          matching: find.byType(Scrollable),
        )
        .first,
  );

  testWidgets('every section of the home, from one request, each opening what it is about', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(393 * 3, 852 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final service = serviceAnswering((request) {
      if (request.url.path.endsWith('/accept')) {
        return _json({
          'success': true,
          'challenge': {'id': 'ch-1', 'status': 'accepted'},
        });
      }
      return _json(_fullHome());
    });
    await tester.pumpWidget(host(service));
    await tester.pumpAndSettle();

    expect(requests.single.url.toString(), 'https://api.example.test/games/home');
    expect(requests.single.headers['Authorization'], 'Bearer session-token');

    // Header: the viewer's points and rank.
    expect(find.text('⚡ 7,650  Pts'), findsOneWidget);
    expect(find.text('#4'), findsOneWidget);
    // A colleague's new best, opening the game.
    expect(find.text('Yami just beat your Odd One Out score'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('games-banner')));
    expect(opened.last, ('odd-one-out', null));

    // Live: the relay first, then the contest, each opening its post.
    expect(find.text('LIVE GAMES'), findsOneWidget);
    expect(find.text('HINT RELAY'), findsOneWidget);
    expect(find.text('LIVE NOW'), findsOneWidget);
    expect(find.text('52 players playing'), findsOneWidget);
    await tester.tap(
      find.descendant(
        of: find.byKey(const ValueKey('live-relay-e1')),
        matching: find.text('Join lobby'),
      ),
    );
    expect(posts.last, 'post-relay');
    await tester.drag(find.byKey(const ValueKey('games-live')), const Offset(-360, 0));
    await tester.pumpAndSettle();
    expect(find.text('BEST PHOTO'), findsOneWidget);
    expect(find.text('Aakshay created this contest'), findsOneWidget);
    expect(find.text('Ends in 2h 14m'), findsOneWidget);
    expect(find.text('“Your corner of the office”'), findsOneWidget);
    expect(find.text('17 entries'), findsOneWidget);
    await tester.tap(
      find.descendant(
        of: find.byKey(const ValueKey('live-contest-post-photo')),
        matching: find.text('Your turn'),
      ),
    );
    expect(posts.last, 'post-photo');

    // A challenge: accepted, then the game opens on it.
    expect(find.text('CHALLENGE RECEIVED'), findsOneWidget);
    expect(find.text('Raghav challenged you in Odd One Out'), findsOneWidget);
    expect(find.text('Beat 1,100. Winner takes both scores.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('accept-ch-1')));
    await tester.pumpAndSettle();
    final accept = requests.lastWhere((request) => request.method == 'POST');
    expect(accept.url.path, '/games/challenges/ch-1/accept');
    expect(opened.last, ('odd-one-out', 'ch-1'));
    // Back from the game, the home is asked for again.
    expect(requests.last.url.path, '/games/home');

    // Your games: the best and the rank.
    await scrollTo(tester, find.byKey(const ValueKey('your-game-odd-one-out')));
    expect(find.text('YOUR GAMES'), findsOneWidget);
    expect(find.text('128 players · Best 1,620'), findsOneWidget);
    expect(find.text('#3'), findsOneWidget);

    // Explore: the community board creates contests of its three kinds.
    await scrollTo(tester, find.byKey(const ValueKey('create-mostLikely')));
    await tester.tap(find.byKey(const ValueKey('create-caption')));
    await tester.tap(find.byKey(const ValueKey('create-photo')));
    await tester.tap(find.byKey(const ValueKey('create-mostLikely')));
    await tester.pumpAndSettle();
    expect(created, [ContestKind.caption, ContestKind.photo, ContestKind.mostLikely]);
    // A contest made is live on the home: it is asked for again.
    expect(requests.where((r) => r.url.path == '/games/home').length, greaterThan(1));
    expect(find.text('12 people from your team are playing right now'), findsOneWidget);

    // Team games: the relay, joined at its post.
    await tester.tap(find.byKey(const ValueKey('explore-team')));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.byKey(const ValueKey('join-relay')));
    await tester.tap(find.byKey(const ValueKey('join-relay')));
    expect(posts.last, 'post-relay');

    // Solo games: the catalog's games this app can open, each with Play.
    await tester.tap(find.byKey(const ValueKey('explore-solo')));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.byKey(const ValueKey('play-odd-one-out')));
    expect(find.byKey(const ValueKey('explore-game-gratitude-garden')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('play-odd-one-out')));
    expect(opened.last, ('odd-one-out', null));
  });

  testWidgets('sections with nothing in them are not drawn', (tester) async {
    final service = serviceAnswering((_) => _json(_emptyHome));
    await tester.pumpWidget(host(service));
    await tester.pumpAndSettle();

    expect(find.text('⚡ 0  Pts'), findsOneWidget);
    expect(find.byKey(const ValueKey('games-banner')), findsNothing);
    expect(find.text('LIVE GAMES'), findsNothing);
    expect(find.text('CHALLENGE RECEIVED'), findsNothing);
    expect(find.text('YOUR GAMES'), findsNothing);
    expect(find.byKey(const ValueKey('games-playing-now')), findsNothing);
    expect(find.text('EXPLORE GAMES'), findsOneWidget);

    // No team game: a friendly card in its place.
    await tester.tap(find.byKey(const ValueKey('explore-team')));
    await tester.pumpAndSettle();
    expect(find.text('NO TEAM GAME YET'), findsOneWidget);
  });

  testWidgets('nothing is fetched until the tab is looked at, and what was fetched is kept', (
    tester,
  ) async {
    final service = serviceAnswering((_) => _json(_emptyHome));
    await tester.pumpWidget(host(service, visible: false));
    await tester.pump(const Duration(seconds: 1));
    expect(requests, isEmpty);

    await tester.pumpWidget(host(service));
    await tester.pumpAndSettle();
    expect(requests, hasLength(1));
    expect(find.text('EXPLORE GAMES'), findsOneWidget);
    // Held for the next opening, and the catalog in it for a notification.
    expect(gamesHomeFor('me'), isNotNull);
    expect(gamesCatalogFor('me')!.map((g) => g.key), ['odd-one-out']);
    expect(gamesHomeFor('someone-else'), isNull);
  });

  testWidgets(
    'a server from before the home shows the catalog; one from before the catalog, the garden',
    (tester) async {
      var catalog = true;
      final service = serviceAnswering((request) {
        if (request.url.path == '/games/catalog' && catalog) {
          return _json({
            'success': true,
            'games': [_oddOneOut],
          });
        }
        return _json({'success': false, 'message': 'Route not found'}, 404);
      });
      await tester.pumpWidget(host(service));
      await tester.pumpAndSettle();
      expect(requests.map((r) => r.url.path), ['/games/home', '/games/catalog']);
      await tester.tap(find.byKey(const ValueKey('explore-solo')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('explore-game-odd-one-out')), findsOneWidget);

      forgetGames();
      catalog = false;
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpWidget(host(service, fallback: [GameCatalogEntry.tryParse(_garden)!]));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('explore-solo')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('explore-game-gratitude-garden')), findsOneWidget);
    },
  );

  testWidgets('a failure offers a retry', (tester) async {
    var fail = true;
    final service = serviceAnswering(
      (_) => fail
          ? _json({'success': false, 'message': 'Session expired or invalid'}, 401)
          : _json(_emptyHome),
    );
    await tester.pumpWidget(host(service));
    await tester.pumpAndSettle();
    expect(find.text('Session expired or invalid'), findsOneWidget);

    fail = false;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('EXPLORE GAMES'), findsOneWidget);
  });

  testWidgets(
    'the leaderboard: individuals this week, then all time, and where the viewer stands',
    (tester) async {
      tester.view.physicalSize = const Size(393 * 3, 852 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final service = serviceAnswering((request) {
        if (request.url.path == '/games/leaderboard') {
          return _json(_board(request.url.queryParameters['period']!));
        }
        return _json(_fullHome());
      });
      await tester.pumpWidget(host(service));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('games-tab-leaderboard')));
      await tester.pumpAndSettle();
      expect(
        requests.last.url.toString(),
        'https://api.example.test/games/leaderboard?period=week',
      );
      expect(find.text('GOOD COMPANY'), findsOneWidget);
      expect(find.text('GREAT COMPETITION'), findsOneWidget);
      // The top three on the podium, by name, everyone else in rows.
      expect(find.byKey(const ValueKey('games-podium')), findsOneWidget);
      for (final (place, name) in [(1, 'Shiv Kumar'), (2, 'Ananya Bisht'), (3, 'Kabir Shah')]) {
        expect(
          find.descendant(of: find.byKey(ValueKey('podium-$place')), matching: find.text(name)),
          findsOneWidget,
        );
      }
      expect(find.text('980'), findsOneWidget);
      expect(find.byKey(const ValueKey('board-row-me')), findsOneWidget);
      expect(find.byKey(const ValueKey('board-row-rohan')), findsOneWidget);
      expect(find.byKey(const ValueKey('board-row-shiv')), findsNothing);
      expect(
        find.descendant(of: find.byKey(const ValueKey('board-row-me')), matching: find.text('YOU')),
        findsOneWidget,
      );
      // The viewer's place, pinned.
      expect(find.text('600 XP'), findsOneWidget);
      expect(find.text('7,650 XP all time'), findsOneWidget);
      expect(find.text('191 XP to pass Kabir for #3'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('period-all')));
      await tester.pumpAndSettle();
      expect(requests.last.url.toString(), 'https://api.example.test/games/leaderboard?period=all');
      expect(find.text('9,800'), findsOneWidget);
      expect(find.text('7,650 XP'), findsOneWidget);
      expect(find.text('↑ 600 this week'), findsOneWidget);
      expect(find.text('240 XP to pass Kabir for #3'), findsOneWidget);
      // Places moved this week.
      expect(
        find.descendant(of: find.byKey(const ValueKey('board-row-me')), matching: find.text('↑2')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('board-row-rohan')),
          matching: find.text('↓1'),
        ),
        findsOneWidget,
      );

      // Each board is fetched once; back to This week asks nothing new.
      final asked = requests.length;
      await tester.tap(find.byKey(const ValueKey('period-week')));
      await tester.pumpAndSettle();
      expect(requests.length, asked);
      expect(find.text('600 XP'), findsOneWidget);

      // And back to the games.
      await tester.tap(find.byKey(const ValueKey('games-tab-games')));
      await tester.pumpAndSettle();
      expect(find.text('LIVE GAMES'), findsOneWidget);
    },
  );

  test('the home reads the server as it answers, photos made whole', () {
    final home = GamesHome.fromJson(
      {
        ..._fullHome(),
        'banner': {..._fullHome()['banner'] as Map<String, dynamic>, 'photoUrl': '/media/yami.png'},
      },
      absolute: (url) =>
          url is String && url.startsWith('/') ? 'https://api.example.test$url' : url as String?,
    );
    expect(home.points, 7650);
    expect(home.rank, 4);
    expect(home.banner!.photoUrl, 'https://api.example.test/media/yami.png');
    expect(home.liveContests.single.kind, ContestKind.photo);
    expect(home.liveContests.single.closesAt, isNotNull);
    expect(home.liveRelay!.phase, RelayPhaseNow.live);
    expect(home.challenges.single.incoming, isTrue);
    expect(home.challenges.single.beat, 1100);
    expect(home.yourGames.single.rank, 3);
    expect(home.games.map((g) => g.key), ['gratitude-garden', 'odd-one-out']);
    expect(home.playingNow.count, 12);
    // A contest of a kind this app does not know is left out, not a crash.
    final odd = GamesHome.fromJson({
      'liveContests': [
        {'id': 'x', 'type': 'quiz'},
      ],
    });
    expect(odd.liveContests, isEmpty);
  });
}
