// Sowaka Engagements launching a game in the feed: the card draws the
// Sowaka mark, the title, the words and one button; there is no like or
// comment row; the button opens the game once however often it is tapped;
// and a game the company does not have says so instead of opening nothing.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
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

ConnectPost _post() => ConnectPost.fromJson({
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
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: GameLaunchPostCard(
            post: _post(),
            session: _session(),
            service: service,
            openGame: openGame,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

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
}
