// Sowaka Engagements launching a game in the feed: the card draws the
// Sowaka mark, the title, the words and one button; there is no like or
// comment row; the button opens the game once however often it is tapped;
// and a game the company does not have says so instead of opening nothing.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/data/connect_models.dart';
import 'package:mobile_app/features/connect/presentation/connect_feed_screen.dart';
import 'package:mobile_app/features/games/data/games_api_service.dart';
import 'package:mobile_app/features/games/data/games_models.dart';

var _people = 0;

AuthSession _session() => AuthSession(
  token: 'token',
  user: AuthUser(
    id: 'u-${++_people}',
    email: 'tanvi@getsowaka.com',
    name: 'Tanvi',
    role: 'employee',
    company: 'Sowaka',
  ),
);

GamesApiService _games({required bool hasTileUp}) => GamesApiService(
  session: _session(),
  baseUrl: 'https://api.example.test',
  client: MockClient(
    (request) async => http.Response(
      jsonEncode({
        'success': true,
        'games': [
          {'key': 'odd-one-out', 'name': 'Odd One Out', 'kind': 'web', 'hasPage': true},
          if (hasTileUp) {'key': 'tile-up', 'name': 'Tile Up', 'kind': 'web', 'hasPage': true},
        ],
      }),
      200,
    ),
  ),
);

ConnectPost _post({Map<String, dynamic> extra = const {}}) => ConnectPost.fromJson({
  'id': 'p1',
  'type': 'game_launch',
  'tag': 'Games',
  'tagIcon': '🎮',
  'tagColor': '#0571A6',
  'tagTint': '#E8F3FA',
  'author': {
    'userId': '',
    'name': 'Sowaka Engagements',
    'initials': 'S',
    'designation': 'Games',
    'avatarColor': '#F5B82E',
  },
  'audience': {'label': 'Company'},
  'body': {
    'gameKey': 'tile-up',
    'gameName': 'Tile Up',
    'title': 'Tile Up is here',
    'text': 'Scrabble with your colleagues. Start a room and invite them.',
    'actionLabel': 'Play Tile Up',
    'accentColor': '#7C5CFF',
    'mediaKind': 'none',
    ...extra,
  },
  'likes': 0,
  'likedByMe': false,
  'comments': [],
  'publishedAt': DateTime.now().toIso8601String(),
});

Future<void> _pump(
  WidgetTester tester, {
  required GamesApiService service,
  required Future<void> Function(BuildContext, GameCatalogEntry) openGame,
  ConnectPost? post,
  DateTime Function()? now,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: GameLaunchPostCard(
            post: post ?? _post(),
            session: _session(),
            service: service,
            openGame: openGame,
            now: now,
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

const _screenshots = String.fromEnvironment('SCREENSHOTS');

/// The tournament's launch, dressed in its own colours.
ConnectPost _tournament({bool lock = false}) => _post(
  extra: {
    'gameKey': 'diwali-cup',
    'gameName': 'O-O-O Tournament',
    'title': 'The Odd One Out Tournament',
    'text': 'One knockout, live, with bets on the last eight. The lobby opens ten minutes before.',
    'actionLabel': 'Enter the tournament',
    'startsAt': '2026-10-29T12:30:00.000Z',
    'endsAt': '2026-10-29T14:00:00.000Z',
    if (lock) 'lockUntilStart': true,
    'theme': {
      'cardGradient': ['#15122B', '#2B1F5C'],
      'border': '#2B1F5C',
      'text': '#FFFFFF',
      'muted': '#B9B2E0',
      'timerBackground': '#FFFFFF',
      'timerText': '#5E45D6',
      'timerLabel': '#717171',
      'live': '#FF5C5C',
      'button': '#F5B82E',
      'buttonText': '#15122B',
    },
  },
);

void main() {
  testWidgets('the post is parsed as a game launch', (tester) async {
    expect(_post().type, ConnectPostType.gameLaunch);
  });

  testWidgets('the card: Sowaka, the title, the words, one button, and no likes or comments', (
    tester,
  ) async {
    await _pump(tester, service: _games(hasTileUp: true), openGame: (_, _) async {});
    expect(find.text('Sowaka Engagements'), findsOneWidget);
    expect(find.text('Tile Up is here'), findsOneWidget);
    expect(find.textContaining('Scrabble with your colleagues'), findsOneWidget);
    expect(find.text('Play Tile Up'), findsOneWidget);
    expect(find.byIcon(Icons.favorite_border_rounded), findsNothing);
    expect(find.byIcon(Icons.favorite_rounded), findsNothing);
    expect(find.textContaining('comment'), findsNothing);
    expect(find.textContaining('Like'), findsNothing);
    expect(find.byType(TextField), findsNothing);
  });

  testWidgets('tapped again and again while it opens: the game opens once', (tester) async {
    final opened = <String>[];
    // The game's screen stays open until this completes, as a real one does
    // until the person comes back.
    var open = Completer<void>();
    await _pump(
      tester,
      service: _games(hasTileUp: true),
      openGame: (_, game) {
        opened.add(game.key);
        return open.future;
      },
    );
    final play = find.byKey(const ValueKey('game-launch-play'));
    await tester.tap(play);
    await tester.pump();
    await tester.tap(play, warnIfMissed: false);
    await tester.tap(play, warnIfMissed: false);
    await tester.pump();
    expect(opened, ['tile-up']);
    // Back from the game: one more tap opens it again, once.
    open.complete();
    open = Completer<void>();
    await tester.pumpAndSettle();
    await tester.tap(play);
    await tester.pump();
    await tester.tap(play, warnIfMissed: false);
    await tester.pump();
    expect(opened, ['tile-up', 'tile-up']);
    open.complete();
    await tester.pumpAndSettle();
  });

  testWidgets('a game the company does not have says so instead of opening', (tester) async {
    final opened = <String>[];
    await _pump(
      tester,
      service: _games(hasTileUp: false),
      openGame: (_, game) async => opened.add(game.key),
    );
    await tester.tap(find.byKey(const ValueKey('game-launch-play')));
    await tester.pumpAndSettle();
    expect(opened, isEmpty);
    expect(find.text('Tile Up is not on for your company yet.'), findsOneWidget);
  });

  group('a timed launch', () {
    setUpAll(() async {
      if (_screenshots.isEmpty) return;
      for (final (family, file) in [
        ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
        ('Plus Jakarta Sans', 'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf'),
      ]) {
        await (FontLoader(family)..addFont(rootBundle.load(file))).load();
      }
    });

    Future<void> shot(WidgetTester tester, String name) async {
      if (_screenshots.isEmpty) return;
      await expectLater(find.byType(GameLaunchPostCard), matchesGoldenFile(Uri.file('$_screenshots/$name.png')));
    }

    testWidgets('before the start: the game\'s name and the countdown on top, the button open', (tester) async {
      await _pump(
        tester,
        service: _games(hasTileUp: true),
        openGame: (_, _) async {},
        post: _tournament(),
        now: () => DateTime.parse('2026-10-29T11:17:55.000Z'),
      );
      expect(find.text('O-O-O Tournament starts in'), findsOneWidget);
      expect(find.text('01h 12m 05s'), findsOneWidget);
      expect(find.text('Enter the tournament'), findsOneWidget);
      expect(find.text('LIVE'), findsNothing);
      await shot(tester, 'launch-upcoming');
    });

    testWidgets('locked until the start: the button says when it opens, and does nothing', (tester) async {
      final opened = <String>[];
      await _pump(
        tester,
        service: _games(hasTileUp: true),
        openGame: (_, game) async => opened.add(game.key),
        post: _tournament(lock: true),
        now: () => DateTime.parse('2026-10-29T11:17:55.000Z'),
      );
      expect(find.textContaining('Opens at'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('game-launch-play')));
      await tester.pumpAndSettle();
      expect(opened, isEmpty);
    });

    testWidgets('started: LIVE beside Sowaka, and the time left until the end', (tester) async {
      await _pump(
        tester,
        service: _games(hasTileUp: true),
        openGame: (_, _) async {},
        post: _tournament(),
        now: () => DateTime.parse('2026-10-29T13:00:00.000Z'),
      );
      expect(find.text('LIVE'), findsOneWidget);
      expect(find.text('Ends in'), findsOneWidget);
      expect(find.text('01h 00m 00s'), findsOneWidget);
      await shot(tester, 'launch-live');
    });

    testWidgets('over: ended, and the button is off', (tester) async {
      final opened = <String>[];
      await _pump(
        tester,
        service: _games(hasTileUp: true),
        openGame: (_, game) async => opened.add(game.key),
        post: _tournament(),
        now: () => DateTime.parse('2026-10-29T15:00:00.000Z'),
      );
      expect(find.text('This game has ended'), findsOneWidget);
      expect(find.text('Ended'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('game-launch-play')));
      await tester.pumpAndSettle();
      expect(opened, isEmpty);
      await shot(tester, 'launch-ended');
    });

    testWidgets('the colours are the post\'s own', (tester) async {
      await _pump(
        tester,
        service: _games(hasTileUp: true),
        openGame: (_, _) async {},
        post: _tournament(),
        now: () => DateTime.parse('2026-10-29T11:17:55.000Z'),
      );
      final button = tester.widget<Material>(
        find.ancestor(of: find.byKey(const ValueKey('game-launch-play')), matching: find.byType(Material)).first,
      );
      expect(button.color, const Color(0xFFF5B82E));
      final title = tester.widget<Text>(find.text('The Odd One Out Tournament'));
      expect(title.style?.color, Colors.white);
      final clock = tester.widget<Text>(find.text('01h 12m 05s'));
      expect(clock.style?.color, const Color(0xFF5E45D6));
    });

    testWidgets('an untimed launch has no timer', (tester) async {
      await _pump(tester, service: _games(hasTileUp: true), openGame: (_, _) async {});
      expect(find.byKey(const ValueKey('game-launch-timer')), findsNothing);
    });
  });
}
