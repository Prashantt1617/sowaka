// The Games tab as the server's web page: which of the page and the native
// tab is shown (a page, a 404, no connection), the bridge's calls each doing
// what they say, the events the page is told, and a fresh pick from the bar
// resetting the page in place instead of building it again.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/games/data/games_api_service.dart';
import 'package:mobile_app/features/games/data/home_page_bridge.dart';
import 'package:mobile_app/features/games/presentation/web_games_home.dart';

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

const _base = 'https://api.example.test';
const _pageHtml = '<!doctype html><html><head><title>Games</title></head><body>GAMES</body></html>';

/// The tab's WebView, as a test sees it: what was loaded, what was run.
class _FakeSurface implements HomePageSurface {
  _FakeSurface(this.onMessage, this.onLoaded);

  final void Function(String message) onMessage;
  final VoidCallback onLoaded;
  final loads = <String>[];
  final baseUrls = <String>[];
  final scripts = <String>[];

  @override
  Future<void> load(String html, {required String baseUrl}) async {
    loads.add(html);
    baseUrls.add(baseUrl);
  }

  @override
  Future<void> run(String script) async => scripts.add(script);

  @override
  Widget build(BuildContext context) => const _FakePage(key: Key('web-page'));

  /// The events the page was told, in order: 'visible', 'reset'...
  List<String> get events => [
    for (final script in scripts)
      if (script.startsWith('window.onSowakaHome'))
        (jsonDecode(script.substring(script.indexOf('(', 30) + 1, script.lastIndexOf(')'))) as Map)['kind'] as String,
  ];
}

/// Counts how often the page's widget is built from scratch.
class _FakePage extends StatefulWidget {
  const _FakePage({super.key});

  static int created = 0;

  @override
  State<_FakePage> createState() => _FakePageState();
}

class _FakePageState extends State<_FakePage> {
  @override
  void initState() {
    super.initState();
    _FakePage.created += 1;
  }

  @override
  Widget build(BuildContext context) => const SizedBox.expand();
}

/// Stands in for the native Games tab; counts how often it starts over.
class _FakeNative extends StatefulWidget {
  const _FakeNative();

  static int created = 0;

  @override
  State<_FakeNative> createState() => _FakeNativeState();
}

class _FakeNativeState extends State<_FakeNative> {
  @override
  void initState() {
    super.initState();
    _FakeNative.created += 1;
  }

  @override
  Widget build(BuildContext context) => const SizedBox.expand(key: Key('native-home'));
}

class _Harness {
  _Harness(http.Response Function(http.Request request) answer) {
    service = GamesApiService(
      session: _session,
      baseUrl: _base,
      client: MockClient((request) async {
        requests.add(request.url.path);
        return answer(request);
      }),
    );
  }

  late final GamesApiService service;
  final requests = <String>[];
  final surfaces = <_FakeSurface>[];
  final games = <(String, String?)>[];
  final contests = <String>[];
  final posts = <String>[];
  final profiles = <String>[];
  final challengeEvents = StreamController<Map<String, dynamic>>.broadcast();
  Completer<void> gameClosed = Completer<void>();

  _FakeSurface get surface => surfaces.single;

  Widget build({bool visible = true, int resets = 0}) => MaterialApp(
    home: Scaffold(
      body: WebGamesHome(
        session: _session,
        service: service,
        visible: visible,
        resets: resets,
        challengeEvents: challengeEvents.stream,
        surfaceFactory: ({required onMessage, required onLoaded}) {
          final surface = _FakeSurface(onMessage, onLoaded);
          surfaces.add(surface);
          return surface;
        },
        nativeHome: (_) => const _FakeNative(),
        nativeGames: const ['gratitude-garden'],
        onOpenGame: (context, key, challengeId) {
          games.add((key, challengeId));
          return gameClosed.future;
        },
        onOpenContest: (context, postId) async => contests.add(postId),
        onOpenPost: posts.add,
        onOpenProfile: profiles.add,
      ),
    ),
  );
}

http.Response _json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

http.Response _page(http.Request request) {
  if (request.url.path == '/app-pages/games-home') {
    return _json({'success': true, 'version': '3', 'html': _pageHtml});
  }
  return _json({'success': false, 'message': 'Not here'}, 404);
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 20));
  }
}

void main() {
  setUp(() {
    forgetGames();
    _FakePage.created = 0;
    _FakeNative.created = 0;
  });

  group('web or native', () {
    testWidgets('a page from the server is shown in the web view, with the bridge in it', (tester) async {
      final harness = _Harness(_page);
      await tester.pumpWidget(harness.build());
      await _settle(tester);

      expect(find.byKey(const Key('web-page')), findsOneWidget);
      expect(find.byKey(const Key('native-home')), findsNothing);
      expect(harness.requests, contains('/app-pages/games-home'));
      final loaded = harness.surface.loads.single;
      expect(loaded, contains('GAMES'));
      expect(loaded, contains('$homePageChannel.postMessage'));
      expect(loaded, contains('S.userId = "me";'));
      expect(loaded, contains('S.nativeGames = ["gratitude-garden"];'));
      expect(loaded.indexOf('Content-Security-Policy'), lessThan(loaded.indexOf('<title>')));
      expect(harness.surface.baseUrls.single, '$_base/app-pages/games-home');
      // Kept for the next launch.
      expect((await harness.service.appPageFromCache('games-home'))?.page?.version, '3');
    });

    testWidgets('a 404 shows the native tab, and the page is forgotten', (tester) async {
      final harness = _Harness((_) => _json({'success': false, 'message': 'No page here'}, 404));
      await tester.pumpWidget(harness.build());
      await _settle(tester);

      expect(find.byKey(const Key('native-home')), findsOneWidget);
      expect(harness.surfaces, isEmpty);
      final kept = await harness.service.appPageFromCache('games-home');
      expect(kept, isNotNull);
      expect(kept!.page, isNull);
    });

    testWidgets('no connection and nothing kept: the native tab', (tester) async {
      final harness = _Harness((_) => throw http.ClientException('offline'));
      await tester.pumpWidget(harness.build());
      await _settle(tester);

      expect(find.byKey(const Key('native-home')), findsOneWidget);
      expect(harness.surfaces, isEmpty);
    });

    testWidgets('a page kept from before is shown at once, without waiting for the server', (tester) async {
      final first = _Harness(_page);
      await tester.pumpWidget(first.build());
      await _settle(tester);
      await tester.pumpWidget(const SizedBox.shrink());

      // The server is unreachable now: the kept page still shows.
      final second = _Harness((_) => throw http.ClientException('offline'));
      await tester.pumpWidget(second.build());
      await _settle(tester);
      expect(find.byKey(const Key('web-page')), findsOneWidget);
      expect(second.surface.loads.single, contains('GAMES'));
    });

    testWidgets('a kept page waits to load until the tab is looked at', (tester) async {
      final first = _Harness(_page);
      await tester.pumpWidget(first.build());
      await _settle(tester);
      await tester.pumpWidget(const SizedBox.shrink());

      final second = _Harness(_page);
      await tester.pumpWidget(second.build(visible: false));
      await _settle(tester);
      // Built with every other tab, but the page (which reads its data as it
      // starts) is not loaded, and the server is not asked.
      expect(second.surface.loads, isEmpty);
      expect(second.requests, isEmpty);

      await tester.pumpWidget(second.build(visible: true));
      await _settle(tester);
      expect(second.surface.loads, hasLength(1));
    });

    testWidgets('not looked at, nothing is asked of the server', (tester) async {
      final harness = _Harness(_page);
      await tester.pumpWidget(harness.build(visible: false));
      await _settle(tester);
      expect(harness.requests, isEmpty);

      await tester.pumpWidget(harness.build(visible: true));
      await _settle(tester);
      expect(harness.requests, ['/app-pages/games-home']);
      expect(find.byKey(const Key('web-page')), findsOneWidget);
    });
  });

  group('kept loaded', () {
    testWidgets('a fresh pick from the bar resets the page in place, never rebuilding it', (tester) async {
      final harness = _Harness(_page);
      await tester.pumpWidget(harness.build(resets: 0));
      await _settle(tester);
      expect(_FakePage.created, 1);

      await tester.pumpWidget(harness.build(resets: 1));
      await _settle(tester);

      expect(harness.surfaces, hasLength(1));
      expect(harness.surface.loads, hasLength(1));
      expect(_FakePage.created, 1);
      expect(harness.surface.events.last, 'reset');
    });

    testWidgets('the native tab still starts over on a fresh pick', (tester) async {
      final harness = _Harness((_) => _json({'success': false}, 404));
      await tester.pumpWidget(harness.build(resets: 0));
      await _settle(tester);
      expect(_FakeNative.created, 1);

      await tester.pumpWidget(harness.build(resets: 1));
      await _settle(tester);
      expect(_FakeNative.created, 2);
    });

    testWidgets('switching tabs away and back keeps the page and tells it hidden, then visible', (tester) async {
      final harness = _Harness(_page);
      await tester.pumpWidget(harness.build());
      await _settle(tester);
      harness.surface.onLoaded();
      await tester.pumpWidget(harness.build(visible: false));
      await tester.pumpWidget(harness.build(visible: true));
      await _settle(tester);

      expect(harness.surface.loads, hasLength(1));
      expect(_FakePage.created, 1);
      expect(harness.surface.events, containsAllInOrder(['visible', 'hidden', 'visible']));
    });

    testWidgets('a changed page is swapped in on the next show, not under the finger', (tester) async {
      // Served from disk on a developer's machine ("dev"): asked for on every show.
      var html = '$_pageHtml<!-- one -->';
      final harness = _Harness((request) => _json({'success': true, 'version': 'dev', 'html': html}));
      await tester.pumpWidget(harness.build());
      await _settle(tester);
      expect(harness.surface.loads.single, contains('one'));

      html = '$_pageHtml<!-- two -->';
      await tester.pumpWidget(harness.build(visible: false));
      await tester.pumpWidget(harness.build(visible: true));
      await _settle(tester);
      // Found while the tab is on screen: left alone for now.
      expect(harness.surface.loads, hasLength(1));

      await tester.pumpWidget(harness.build(visible: false));
      await tester.pumpWidget(harness.build(visible: true));
      await _settle(tester);
      expect(harness.surface.loads, hasLength(2));
      expect(harness.surface.loads.last, contains('two'));
      expect(harness.surfaces, hasLength(1));
      expect(_FakePage.created, 1);
    });

    testWidgets('switched off while on screen: the native tab from the next show', (tester) async {
      var on = true;
      final harness = _Harness(
        (request) => on
            ? _json({'success': true, 'version': 'dev', 'html': _pageHtml})
            : _json({'success': false, 'message': 'No page here'}, 404),
      );
      await tester.pumpWidget(harness.build());
      await _settle(tester);
      on = false;
      await tester.pumpWidget(harness.build(visible: false));
      await tester.pumpWidget(harness.build(visible: true));
      await _settle(tester);
      expect(find.byKey(const Key('web-page')), findsOneWidget);

      await tester.pumpWidget(harness.build(visible: false));
      await tester.pumpWidget(harness.build(visible: true));
      await _settle(tester);
      expect(find.byKey(const Key('native-home')), findsOneWidget);
    });
  });

  group('the bridge from the tab', () {
    testWidgets('openGame opens the game, and the page refreshes when it closes', (tester) async {
      final harness = _Harness(_page);
      await tester.pumpWidget(harness.build());
      await _settle(tester);

      harness.surface.onMessage(jsonEncode({'id': null, 'type': 'openGame', 'data': {'key': 'odd-one-out', 'challengeId': 'ch-1'}}));
      await _settle(tester);
      expect(harness.games, [('odd-one-out', 'ch-1')]);
      expect(harness.surface.events, isNot(contains('refresh')));

      harness.gameClosed.complete();
      await _settle(tester);
      expect(harness.surface.events.last, 'refresh');
    });

    testWidgets('home answers with the server JSON, pictures made whole', (tester) async {
      final harness = _Harness((request) {
        if (request.url.path == '/games/home') {
          return _json({
            'success': true,
            'points': 120,
            'challenges': [
              {'id': 'ch-1', 'gameKey': 'odd-one-out', 'from': {'name': 'Aarav', 'photoUrl': '/media/aarav.jpg'}},
            ],
            'liveContests': [
              {'id': 'p1', 'imageUrl': 'https://cdn.example/x.jpg', 'previews': [{'imageUrl': '/media/e1.jpg'}]},
            ],
            'games': <dynamic>[],
          });
        }
        return _page(request);
      });
      await tester.pumpWidget(harness.build());
      await _settle(tester);

      harness.surface.onMessage(jsonEncode({'id': 'h1', 'type': 'home', 'data': {}}));
      await _settle(tester);
      final reply = harness.surface.scripts.lastWhere((s) => s.contains('__reply'));
      expect(reply, contains('"h1", true'));
      expect(reply, contains('"photoUrl":"$_base/media/aarav.jpg"'));
      expect(reply, contains('"imageUrl":"$_base/media/e1.jpg"'));
      expect(reply, contains('"imageUrl":"https://cdn.example/x.jpg"'));
      expect(reply, contains('"points":120'));
    });

    testWidgets('a challenge the app hears is passed to the page', (tester) async {
      final harness = _Harness(_page);
      await tester.pumpWidget(harness.build());
      await _settle(tester);

      harness.challengeEvents.add({'destination': 'game_challenge', 'gameKey': 'odd-one-out', 'challengeId': 'ch-9'});
      await _settle(tester);
      final script = harness.surface.scripts.last;
      expect(script, contains('"kind":"challenge"'));
      expect(script, contains('"id":"ch-9"'));
    });
  });

  group('the bridge', () {
    late List<String> calls;
    late HomePageBridge bridge;

    setUp(() {
      calls = [];
      bridge = HomePageBridge(
        HomePageActions(
          home: () async {
            calls.add('home');
            return {'points': 5};
          },
          leaderboard: (period) async {
            calls.add('leaderboard:$period');
            return {'entries': <dynamic>[]};
          },
          acceptChallenge: (id) async {
            calls.add('accept:$id');
            if (id == 'gone') throw const GamesApiException('Challenge not found', statusCode: 404);
            return {'id': id, 'status': 'accepted'};
          },
          openGame: (key, challengeId) => calls.add('game:$key:$challengeId'),
          openContest: (postId) => calls.add('contest:$postId'),
          openPost: (postId) => calls.add('post:$postId'),
          openProfile: (userId) => calls.add('profile:$userId'),
          toast: (text) => calls.add('toast:$text'),
          haptic: (kind) => calls.add('haptic:$kind'),
        ),
      );
    });

    Future<String?> send(String type, Map<String, dynamic> data, {String? id}) =>
        bridge.handle(jsonEncode({'id': id, 'type': type, 'data': data}));

    test('each call does what it names', () async {
      expect(await send('home', {}, id: 'h1'), contains('"h1", true, {"points":5}'));
      expect(await send('leaderboard', {'period': 'all'}, id: 'h2'), contains('"h2", true'));
      await send('leaderboard', {'period': 'whatever'}, id: 'h3');
      expect(await send('acceptChallenge', {'id': 'ch-1'}, id: 'h4'), contains('"status":"accepted"'));
      expect(await send('openGame', {'key': 'odd-one-out', 'challengeId': 'ch-1'}), isNull);
      await send('openGame', {'key': 'odd-one-out'});
      expect(await send('openContest', {'postId': 'post-1'}), isNull);
      expect(await send('openPost', {'postId': 'post-2'}), isNull);
      expect(await send('openProfile', {'userId': 'u-1'}), isNull);
      expect(await send('toast', {'text': '  Challenge sent  '}), isNull);
      await send('haptic', {'kind': 'success'});
      await send('haptic', {'kind': 'boom'});
      expect(calls, [
        'home',
        'leaderboard:all',
        'leaderboard:week',
        'accept:ch-1',
        'game:odd-one-out:ch-1',
        'game:odd-one-out:null',
        'contest:post-1',
        'post:post-2',
        'profile:u-1',
        'toast:Challenge sent',
        'haptic:success',
        'haptic:light',
      ]);
    });

    test('a refusal rejects with the server message and status', () async {
      final reply = await send('acceptChallenge', {'id': 'gone'}, id: 'h9');
      expect(reply, contains('"h9", false'));
      expect(reply, contains('"message":"Challenge not found"'));
      expect(reply, contains('"status":404'));
    });

    test('nothing is done for a malformed id or an unknown call', () async {
      expect(await send('acceptChallenge', {'id': '../x'}, id: 'h1'), contains('false'));
      await send('openGame', {'key': 'x y'});
      await send('openProfile', {'userId': ''});
      await send('toast', {'text': '   '});
      expect(await send('deleteEverything', {}, id: 'h2'), contains('Unknown request'));
      expect(await bridge.handle('not json'), isNull);
      expect(calls, isEmpty);
    });

    test('the page gets window.Sowaka with the contract fields', () {
      final script = homePageBridgeScript(
        reduceMotion: true,
        userId: 'u-<me>',
        nativeGames: const ['gratitude-garden'],
      );
      expect(script, contains('S.homeVersion = 1'));
      expect(script, contains('S.reduceMotion = true'));
      expect(script, contains(r'S.userId = "u-\u003cme>";'));
      expect(script, contains('S.nativeGames = ["gratitude-garden"];'));
      expect(homePageBridgeScript(reduceMotion: false, userId: 'me'), contains('S.nativeGames = [];'));
      expect(script, contains("new CustomEvent('sowaka-ready')"));
      for (final method in ['home', 'leaderboard', 'acceptChallenge', 'openGame', 'openContest', 'openPost', 'openProfile', 'toast', 'haptic']) {
        expect(script, contains('S.$method = function'), reason: method);
      }
    });

    test('an event can never close the script it is in', () {
      final script = homeEventScript({'kind': 'challenge', 'challenge': {'name': '</script><script>alert(1)'}});
      expect(script, isNot(contains('</script>')));
    });
  });
}
