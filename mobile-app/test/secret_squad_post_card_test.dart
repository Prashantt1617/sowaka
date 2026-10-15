// Secret Squad's card in the Connect feed (type `secret_squad`): where the
// session is, read from the post and the clock (countdown, lobby open,
// playing, ended, cancelled); Let's Play opening the catalog game, or the web
// lobby where the company has no such game; and the envelope holding still
// with animations off.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/bloc/connect_bloc.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/connect/data/connect_models.dart';
import 'package:mobile_app/features/connect/presentation/connect_feed_screen.dart';
import 'package:mobile_app/features/games/data/games_api_service.dart';
import 'package:mobile_app/features/games/data/games_models.dart';
import 'package:mobile_app/features/squad/data/secret_squad_post.dart';
import 'package:mobile_app/features/squad/presentation/secret_squad_post_card.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _session = AuthSession(
  token: 'token',
  user: AuthUser(
    id: 'u-tanvi',
    email: 'tanvi@getsowaka.com',
    name: 'Tanvi',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    enabledTabs: ['connect', 'games'],
  ),
);

/// 16:00 on Saturday 17 October, India time.
final _start = DateTime.utc(2026, 10, 17, 10, 30);
final _lobby = _start.subtract(const Duration(minutes: 3));

Map<String, dynamic> _body({
  String? status,
  String? webUrl = 'https://api.example.test/squad',
  Object? endsAt,
}) => {
  'sessionId': 's-1',
  'office': 'Gurgaon',
  'title': 'Secret Squad',
  'subtitle': 'Your word is a clue to find your secret squad.',
  'kicker': 'SQUAD HUNT',
  'rewards': 'SURPRISE REWARDS',
  'rewardsNote': 'For the top squads to link up',
  'lobbyOpensAt': _lobby.toIso8601String(),
  'startsAt': _start.toIso8601String(),
  'gameKey': 'secret-squad',
  'webUrl': ?webUrl,
  'status': ?status,
  'endsAt': ?endsAt,
};

ConnectPost _post(Map<String, dynamic> body) => ConnectPost.fromJson({
  'id': 'p-squad',
  'type': 'secret_squad',
  'author': {'name': 'Sowaka'},
  'body': body,
});

/// The games catalog the server hands out, with or without Secret Squad.
/// The service keeps the last catalog per person in memory, so each test's
/// is under its own person.
var _people = 0;
GamesApiService _games({required bool hasSquad, List<Uri>? asked}) =>
    GamesApiService(
      session: AuthSession(
        token: 'token',
        user: AuthUser(
          id: 'u-${++_people}',
          email: 'tanvi@getsowaka.com',
          name: 'Tanvi',
          role: 'employee',
          company: 'Sowaka',
        ),
      ),
      baseUrl: 'https://api.example.test',
      client: MockClient((request) async {
        asked?.add(request.url);
        return http.Response(
          jsonEncode({
            'success': true,
            'games': [
              {
                'key': 'odd-one-out',
                'name': 'Odd One Out',
                'kind': 'web',
                'hasPage': true,
              },
              if (hasSquad)
                {
                  'key': 'secret-squad',
                  'name': 'Secret Squad',
                  'kind': 'web',
                  'hasPage': true,
                },
            ],
          }),
          200,
        );
      }),
    );

Future<void> _pump(
  WidgetTester tester, {
  required Map<String, dynamic> body,
  required DateTime Function() now,
  GamesApiService? service,
  SquadGameOpener? openGame,
  Future<void> Function(Uri url)? openUrl,
  bool reduceMotion = false,
}) async {
  tester.view.physicalSize = const Size(390, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(
          size: const Size(390, 900),
          disableAnimations: reduceMotion,
        ),
        child: Scaffold(
          body: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              SecretSquadPostCard(
                post: _post(body),
                session: _session,
                now: now,
                service: service ?? _games(hasSquad: true),
                openGame: openGame ?? (context, game) async {},
                openUrl: openUrl ?? (url) async {},
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('where the session is', () {
    test('from the clock: countdown, lobby, playing, then ended', () {
      final squad = SecretSquadPost(
        _body(
          endsAt: _start.add(const Duration(minutes: 40)).toIso8601String(),
        ),
      );
      expect(
        squad.phaseAt(_lobby.subtract(const Duration(seconds: 1))),
        SquadCardPhase.countdown,
      );
      expect(squad.phaseAt(_lobby), SquadCardPhase.lobby);
      expect(
        squad.phaseAt(_start.subtract(const Duration(seconds: 1))),
        SquadCardPhase.lobby,
      );
      expect(squad.phaseAt(_start), SquadCardPhase.playing);
      expect(
        squad.phaseAt(_start.add(const Duration(minutes: 39))),
        SquadCardPhase.playing,
      );
      expect(
        squad.phaseAt(_start.add(const Duration(minutes: 40))),
        SquadCardPhase.ended,
      );
    });

    test(
      'the end from the rounds when the post carries them, else an hour',
      () {
        final rounds = SecretSquadPost({
          ..._body(),
          'rounds': [
            {'huntMs': 17 * 60000, 'breakMs': 120000},
            {'huntMs': 5 * 60000, 'breakMs': 120000},
          ],
        });
        // 0:10 + 17:00 + 2:00 + 0:10 + 5:00; the last break is not played.
        expect(
          rounds.endsAt,
          _start.add(const Duration(minutes: 24, seconds: 20)),
        );
        expect(SecretSquadPost(_body()).endsAt, isNull);
        expect(
          SecretSquadPost(
            _body(),
          ).phaseAt(_start.add(const Duration(minutes: 59))),
          SquadCardPhase.playing,
        );
        expect(
          SecretSquadPost(
            _body(),
          ).phaseAt(_start.add(const Duration(hours: 1))),
          SquadCardPhase.ended,
        );
      },
    );

    test('the server\'s word wins where it is final', () {
      final early = _lobby.subtract(const Duration(hours: 2));
      expect(
        SecretSquadPost(_body(status: 'cancelled')).phaseAt(early),
        SquadCardPhase.cancelled,
      );
      expect(
        SecretSquadPost(_body(status: 'over')).phaseAt(_start),
        SquadCardPhase.ended,
      );
      // The lobby is open on the server while this phone's clock is behind.
      expect(
        SecretSquadPost(
          _body(status: 'lobby'),
        ).phaseAt(_lobby.subtract(const Duration(seconds: 20))),
        SquadCardPhase.lobby,
      );
    });

    test(
      'without lobbyOpensAt the lobby opens 3 minutes before; only https lobbies',
      () {
        final squad = SecretSquadPost(
          {..._body(webUrl: 'http://insecure.test/squad')}
            ..remove('lobbyOpensAt'),
        );
        expect(squad.lobbyOpensAt, _lobby);
        expect(squad.webUrl, isNull);
      },
    );

    test('clocks, dates and times as the design writes them', () {
      expect(
        SecretSquadPost.clock(
          const Duration(hours: 22, minutes: 50, seconds: 10),
        ),
        '22:50:10',
      );
      expect(
        SecretSquadPost.shortClock(const Duration(minutes: 2, seconds: 14)),
        '2:14',
      );
      // Rounded up: a second and a bit reads 0:02.
      expect(
        SecretSquadPost.remaining(
          _start,
          _start.subtract(const Duration(milliseconds: 1200)),
        ),
        const Duration(seconds: 2),
      );
      final local = DateTime(2026, 10, 17, 16);
      expect(SecretSquadPost.dateLabel(local), 'Sat 17 Oct');
      expect(SecretSquadPost.timeLabel(local), '4:00 pm');
      expect(
        SecretSquadPost.timeLabel(DateTime(2026, 10, 17, 0, 5)),
        '12:05 am',
      );
    });
  });

  group('the card', () {
    testWidgets('counts down to the lobby, a second at a time', (tester) async {
      var now = _lobby.subtract(
        const Duration(hours: 22, minutes: 50, seconds: 10),
      );
      await _pump(tester, body: _body(), now: () => now);
      expect(find.text('SQUAD HUNT'), findsOneWidget);
      expect(find.text('Secret Squad'), findsOneWidget);
      expect(find.text('Lobby opens in'), findsOneWidget);
      expect(find.text('22:50:10'), findsOneWidget);
      expect(find.text('SURPRISE REWARDS'), findsOneWidget);
      expect(find.text('For the top squads to link up'), findsOneWidget);
      expect(find.text('Let’s Play'), findsOneWidget);
      expect(find.text(SecretSquadPost.timeLabel(_start)), findsOneWidget);
      now = now.add(const Duration(seconds: 1));
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('22:50:09'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('turns into "Lobby open · starts in" when the lobby opens', (
      tester,
    ) async {
      var now = _lobby.subtract(const Duration(seconds: 1));
      await _pump(tester, body: _body(), now: () => now);
      expect(find.text('00:00:01'), findsOneWidget);
      now = _start.subtract(const Duration(minutes: 2, seconds: 14));
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('Lobby open · starts in'), findsOneWidget);
      expect(find.text('2:14'), findsOneWidget);
      expect(find.text('Lobby opens in'), findsNothing);
    });

    testWidgets('reads "Playing now" once the session starts', (tester) async {
      await _pump(
        tester,
        body: _body(),
        now: () => _start.add(const Duration(minutes: 5)),
      );
      expect(find.text('Playing now'), findsOneWidget);
      expect(find.text('Gurgaon is hunting'), findsOneWidget);
      expect(find.text('Let’s Play'), findsOneWidget);
    });

    testWidgets('reads "Ended" after the session', (tester) async {
      await _pump(
        tester,
        body: _body(
          endsAt: _start.add(const Duration(minutes: 30)).toIso8601String(),
        ),
        now: () => _start.add(const Duration(minutes: 31)),
      );
      expect(find.text('Ended'), findsOneWidget);
      expect(find.text('Playing now'), findsNothing);
    });

    testWidgets(
      'reads "Cancelled" and Let\'s Play does nothing when called off',
      (tester) async {
        final opened = <String>[];
        final urls = <Uri>[];
        await _pump(
          tester,
          body: _body(status: 'cancelled'),
          now: () => _lobby.subtract(const Duration(hours: 1)),
          openGame: (context, game) async => opened.add(game.key),
          openUrl: (url) async => urls.add(url),
        );
        expect(find.text('Cancelled'), findsOneWidget);
        expect(find.text('This session was called off'), findsOneWidget);
        expect(find.text('Lobby opens in'), findsNothing);
        await tester.tap(find.text('Let’s Play'));
        await tester.pump(const Duration(milliseconds: 300));
        expect(opened, isEmpty);
        expect(urls, isEmpty);
      },
    );

    testWidgets('fits a narrow phone without overflowing', (tester) async {
      await _pump(
        tester,
        body: _body(),
        now: () => _lobby.subtract(const Duration(hours: 99)),
      );
      tester.view.physicalSize = const Size(320, 900);
      await tester.pump();
      expect(tester.takeException(), isNull);
    });
  });

  group('Let\'s Play', () {
    testWidgets('opens the catalog game in the app', (tester) async {
      final opened = <GameCatalogEntry>[];
      final urls = <Uri>[];
      final asked = <Uri>[];
      await _pump(
        tester,
        body: _body(),
        now: () => _lobby,
        service: _games(hasSquad: true, asked: asked),
        openGame: (context, game) async => opened.add(game),
        openUrl: (url) async => urls.add(url),
      );
      await tester.tap(find.text('Let’s Play'));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
      await tester.pump();
      expect(asked.single.path, '/games/catalog');
      expect(opened.single.key, 'secret-squad');
      expect(opened.single.hasPage, isTrue);
      expect(urls, isEmpty);
    });

    testWidgets(
      'opens the web lobby in the browser where the company has no such game',
      (tester) async {
        final opened = <GameCatalogEntry>[];
        final urls = <Uri>[];
        await _pump(
          tester,
          body: _body(),
          now: () => _lobby,
          service: _games(hasSquad: false),
          openGame: (context, game) async => opened.add(game),
          openUrl: (url) async => urls.add(url),
        );
        await tester.tap(find.text('Let’s Play'));
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)),
        );
        await tester.pump();
        expect(opened, isEmpty);
        expect(urls, [Uri.parse('https://api.example.test/squad')]);
      },
    );

    testWidgets('says so when there is neither', (tester) async {
      final urls = <Uri>[];
      await _pump(
        tester,
        body: _body(webUrl: null),
        now: () => _lobby,
        service: _games(hasSquad: false),
        openUrl: (url) async => urls.add(url),
      );
      await tester.tap(find.text('Let’s Play'));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
      await tester.pump();
      expect(urls, isEmpty);
      expect(
        find.text('Secret Squad is not open for you yet.'),
        findsOneWidget,
      );
    });
  });

  group('the envelope', () {
    testWidgets('moves through its words', (tester) async {
      await _pump(tester, body: _body(), now: () => _lobby);
      expect(find.text('MARS'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 4100));
      expect(find.text('TWIX'), findsOneWidget);
      await tester.pump(const Duration(seconds: 4));
      expect(find.text('KITKAT'), findsOneWidget);
      await tester.pump(const Duration(seconds: 4));
      expect(find.text('?'), findsOneWidget);
      expect(find.text('TOP SECRET'), findsOneWidget);
    });

    testWidgets('holds still on MARS with animations off', (tester) async {
      await _pump(tester, body: _body(), now: () => _lobby, reduceMotion: true);
      expect(find.text('MARS'), findsOneWidget);
      await tester.pump(const Duration(seconds: 5));
      expect(find.text('MARS'), findsOneWidget);
      expect(find.text('TWIX'), findsNothing);
      expect(tester.hasRunningAnimations, isFalse);
    });
  });

  group('in the feed', () {
    Future<ConnectBloc> pumpFeed(
      WidgetTester tester,
      Map<String, dynamic> post,
    ) async {
      tester.view.physicalSize = const Size(1179, 2556);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final bloc = ConnectBloc(
        session: _session,
        api: ConnectApiService(
          session: _session,
          baseUrl: 'https://example.test',
          client: MockClient((request) async {
            if (request.url.path.endsWith('/connect/feed')) {
              return http.Response(
                jsonEncode({
                  'success': true,
                  'posts': [post],
                }),
                200,
              );
            }
            return http.Response(jsonEncode({'success': true}), 200);
          }),
        ),
      );
      await bloc.load();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ConnectFeedScreen(
              session: _session,
              profileAction: const SizedBox.shrink(),
              bloc: bloc,
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 300));
      return bloc;
    }

    Map<String, dynamic> wire(String type) => {
      'id': 'p-squad',
      'type': type,
      'tag': 'Secret Squad',
      'author': {'userId': 'hr-1', 'name': 'Sowaka HR', 'initials': 'SH'},
      'audience': {'label': 'Public'},
      // Two days off, whenever this runs: the feed's card reads the clock.
      'body': {
        ..._body(),
        'lobbyOpensAt': DateTime.now()
            .add(const Duration(days: 2))
            .toUtc()
            .toIso8601String(),
        'startsAt': DateTime.now()
            .add(const Duration(days: 2, minutes: 3))
            .toUtc()
            .toIso8601String(),
        'text':
            'Secret Squad is on Friday at 4 pm. Join: https://api.example.test/squad',
      },
      'likeCount': 0,
      'liked': false,
      'commentCount': 0,
      'comments': const [],
      'publishedAt': '2026-10-15T06:00:00.000Z',
    };

    testWidgets(
      'a secret_squad post is the card, with no like or comment row',
      (tester) async {
        final bloc = await pumpFeed(tester, wire('secret_squad'));
        expect(find.byType(SecretSquadPostCard), findsOneWidget);
        expect(find.text('Lobby opens in'), findsOneWidget);
        expect(find.byKey(const ValueKey('post-like-heart')), findsNothing);
        expect(find.text('LEADERSHIP'), findsNothing);
        await tester.pumpWidget(const SizedBox.shrink());
        bloc.dispose();
      },
    );

    // What an app from before this release does with it: a type it does not
    // know is read as a leadership post (connect_models.dart, _parseType).
    testWidgets('a type this app does not know is drawn as a leadership post', (
      tester,
    ) async {
      expect(
        ConnectPost.fromJson(wire('some_future_game')).type,
        ConnectPostType.leadership,
      );
      final bloc = await pumpFeed(tester, wire('some_future_game'));
      expect(find.byType(SecretSquadPostCard), findsNothing);
      expect(find.text('Sowaka HR'), findsOneWidget);
      expect(find.text('LEADERSHIP'), findsOneWidget);
      expect(find.textContaining('Secret Squad is on Friday'), findsOneWidget);
      expect(find.byKey(const ValueKey('post-like-heart')), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      bloc.dispose();
    });
  });
}
