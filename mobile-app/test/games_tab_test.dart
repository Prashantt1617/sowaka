// The Games tab's home against a fake server: every section drawn from one
// `GET /games/home`, each hidden when it has nothing; what its buttons open;
// a challenge accepted before its game opens; the leaderboard's two boards
// and the rank shown only on them; the tab asking nothing of the server until
// it is looked at; the pane's looping pictures and its one-second clocks,
// each running only while the tab is looked at.
import 'dart:convert';
import 'dart:math' as math;

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
    bool reduceMotion = true,
    DateTime Function()? now,
  }) => MaterialApp(
    // The pane's pictures loop for as long as they are on screen, which
    // pumpAndSettle would wait on forever; held still here, as under the
    // phone's reduced motion. The motion has its own test below.
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(disableAnimations: reduceMotion),
      child: child!,
    ),
    home: Scaffold(
      body: GamesHomeView(
        session: _session,
        service: service,
        visible: visible,
        now: now ?? DateTime.now,
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

    // Header: the viewer's points, and their rank beside LEADERBOARD on
    // either pane.
    expect(find.text('⚡ 7,650  Pts'), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(const ValueKey('games-rank')), matching: find.text('#4')),
      findsOneWidget,
    );
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
    // The clock counts down to the second, as the feed's contest card does
    // (the seconds are the phone's own, so only their form is checked).
    expect(find.textContaining(RegExp(r'^END IN: 02:14:[0-5]\d$')), findsOneWidget);
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

  testWidgets('a contest with entries shows them in its picture, one a second', (tester) async {
    Map<String, dynamic> homeWithEntries() => {
      ..._emptyHome,
      'liveContests': [
        {
          'id': 'post-caption',
          'type': 'caption',
          'postType': 'caption_challenge',
          'title': 'Caption this',
          'prompt': 'Write the funniest caption.',
          'closesAt': DateTime.now().add(const Duration(hours: 5)).toUtc().toIso8601String(),
          'author': {'userId': 'a', 'name': 'Ananya Bisht', 'photoUrl': null},
          'entries': 2,
          'entrants': <dynamic>[],
          'entered': false,
          'previews': [
            {'name': 'Raghav Iyer', 'text': 'Monday, again', 'imageUrl': null, 'photoUrl': null},
            {'name': 'Neha Kapoor', 'text': 'Deploy on Friday', 'imageUrl': null, 'photoUrl': null},
          ],
        },
      ],
    };

    // Held still: the newest entry, in place of the illustration.
    await tester.pumpWidget(host(serviceAnswering((_) => _json(homeWithEntries()))));
    await tester.pumpAndSettle();
    expect(find.text('“Monday, again”'), findsOneWidget);
    expect(find.text('“Deploy on Friday”'), findsNothing);

    // Moving: a second later, the next one.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(
      host(serviceAnswering((_) => _json(homeWithEntries())), reduceMotion: false),
    );
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    expect(find.text('“Monday, again”'), findsOneWidget);
    await tester.pump(const Duration(seconds: 1));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('“Deploy on Friday”'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
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

      // The rank is there before the leaderboard opens: the home's.
      expect(find.byKey(const ValueKey('games-rank')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('games-tab-leaderboard')));
      await tester.pumpAndSettle();
      expect(
        requests.last.url.toString(),
        'https://api.example.test/games/leaderboard?period=week',
      );
      // The rank pill, on the open Leaderboard tab: the board's own rank.
      expect(
        find.descendant(of: find.byKey(const ValueKey('games-rank')), matching: find.text('#4')),
        findsOneWidget,
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

      // And back to the games, where the rank stays beside LEADERBOARD.
      await tester.tap(find.byKey(const ValueKey('games-tab-games')));
      await tester.pumpAndSettle();
      expect(find.text('LIVE GAMES'), findsOneWidget);
      expect(find.byKey(const ValueKey('games-rank')), findsOneWidget);
    },
  );

  testWidgets(
    "the live pictures loop on the design's 1.5 s timeline, only while there is a pane to see",
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
      await tester.pumpWidget(host(service, reduceMotion: false));
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 20));
      }

      Finder inCard(String card, Type type) =>
          find.descendant(of: find.byKey(ValueKey(card)), matching: find.byType(type)).first;
      final rock = inCard('live-relay-e1', RotationTransition);
      final land = inCard('live-contest-post-photo', ScaleTransition);
      final blink = find
          .descendant(
            of: find.byKey(const ValueKey('live-contest-post-photo')),
            matching: find.byType(FadeTransition),
          )
          .last;
      double degrees() => tester.widget<RotationTransition>(rock).turns.value * 360;
      double scale() => tester.widget<ScaleTransition>(land).scale.value;
      double opacity() => tester.widget<FadeTransition>(blink).opacity.value;

      // One loop, every 10 ms.
      final angles = <double>[], scales = <double>[], opacities = <double>[];
      for (var ms = 0; ms < 1500; ms += 10) {
        await tester.pump(const Duration(milliseconds: 10));
        angles.add(degrees());
        scales.add(scale());
        opacities.add(opacity());
      }
      // The lobby tile rocks from +5° to -10° and back.
      expect(angles.reduce(math.max), closeTo(5, 0.1));
      expect(angles.reduce(math.min), closeTo(-10, 0.1));
      // The camera lands from 1.2× over the first third, then holds at 1×.
      expect(scales.reduce(math.max), greaterThan(1.15));
      expect(scales.where((s) => s == 1.0).length, inInclusiveRange(95, 105));
      // The sparkle blinks back in over the first ~89 ms, then holds.
      expect(opacities.reduce(math.min), lessThan(0.5));
      expect(opacities.where((o) => o < 1).length, inInclusiveRange(7, 10));
      // And it is a loop: 1.5 s on, the same pose.
      final before = degrees();
      await tester.pump(const Duration(milliseconds: 1500));
      expect(degrees(), closeTo(before, 0.01));

      // On the leaderboard nothing of it is on screen: it stops.
      await tester.tap(find.byKey(const ValueKey('games-tab-leaderboard')));
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(tester.binding.hasScheduledFrame, isFalse);
      await tester.tap(find.byKey(const ValueKey('games-tab-games')));
      await tester.pump(const Duration(milliseconds: 20));
      expect(tester.binding.hasScheduledFrame, isTrue);

      // Another tab on screen: it stops, and holds where it was.
      await tester.pumpWidget(host(service, reduceMotion: false, visible: false));
      await tester.pump();
      final held = degrees();
      expect(tester.binding.hasScheduledFrame, isFalse);
      await tester.pump(const Duration(milliseconds: 700));
      expect(degrees(), held);

      // Reduced motion: every picture at its rest, nothing ticking (so the
      // pane settles), the tile at +5°, the camera full size, the sparkle in.
      await tester.pumpWidget(host(service));
      await tester.pumpAndSettle();
      for (final card in ['live-relay-e1', 'live-contest-post-photo']) {
        for (final type in [RotationTransition, ScaleTransition]) {
          expect(
            find.descendant(of: find.byKey(ValueKey(card)), matching: find.byType(type)),
            findsNothing,
          );
        }
      }
      final tile = tester.widget<Transform>(
        find
            .ancestor(
              of: find
                  .descendant(
                    of: find.byKey(const ValueKey('live-relay-e1')),
                    matching: find.byType(ClipRRect),
                  )
                  .first,
              matching: find.byType(Transform),
            )
            .first,
      );
      expect(
        math.atan2(tile.transform.storage[1], tile.transform.storage[0]) * 180 / math.pi,
        closeTo(5, 0.001),
      );
    },
  );

  testWidgets(
    'the clocks count down each second, only while the tab is looked at and the app is in front',
    (tester) async {
      DateTime now() => tester.binding.clock.now();
      final closes = now().add(const Duration(hours: 2, minutes: 14, seconds: 20));
      final service = serviceAnswering(
        (_) => _json({
          ..._fullHome(),
          'liveRelay': null,
          'liveContests': [
            {
              ...(_fullHome()['liveContests'] as List).single as Map<String, dynamic>,
              'closesAt': closes.toUtc().toIso8601String(),
            },
          ],
        }),
      );
      Future<void> pumpFor(Duration time) async {
        await tester.pump(time);
        await tester.pump();
      }

      await tester.pumpWidget(host(service, now: now));
      await pumpFor(Duration.zero);
      expect(find.text('END IN: 02:14:20'), findsOneWidget);
      await pumpFor(const Duration(seconds: 1));
      expect(find.text('END IN: 02:14:19'), findsOneWidget);
      await pumpFor(const Duration(seconds: 1));
      expect(find.text('END IN: 02:14:18'), findsOneWidget);

      // In the background the clock stops; back in front it is set right at once.
      for (final state in [
        AppLifecycleState.inactive,
        AppLifecycleState.hidden,
        AppLifecycleState.paused,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(state);
      }
      await pumpFor(const Duration(seconds: 3));
      expect(find.text('END IN: 02:14:18'), findsOneWidget);
      for (final state in [
        AppLifecycleState.hidden,
        AppLifecycleState.inactive,
        AppLifecycleState.resumed,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(state);
      }
      await pumpFor(Duration.zero);
      expect(find.text('END IN: 02:14:15'), findsOneWidget);

      // Another tab on screen: the clock stops too, with no timer left running.
      await tester.pumpWidget(host(service, now: now, visible: false));
      await pumpFor(const Duration(seconds: 2));
      expect(find.text('END IN: 02:14:15'), findsOneWidget);
      expect(tester.binding.hasScheduledFrame, isFalse);
      await tester.pumpWidget(host(service, now: now));
      await pumpFor(Duration.zero);
      expect(find.text('END IN: 02:14:13'), findsOneWidget);
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
