// The Games tab's catalog as the server sends it: every field read, rows the
// app cannot use skipped rather than crashing it, thumbnails decoded once,
// and a leaderboard handed to a page without anyone's id.
import 'dart:convert';
import 'dart:ui' show Color;

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/games/data/games_models.dart';

Map<String, dynamic> _row(Map<String, dynamic> overrides) => {
  'key': 'odd-one-out',
  'name': 'Odd One Out',
  'kind': 'web',
  ...overrides,
};

void main() {
  test('a web entry reads every field', () {
    final games = parseGameCatalog({
      'success': true,
      'games': [
        {
          'key': 'odd-one-out',
          'name': 'Odd One Out',
          'tagline': "Spot the tile that's different",
          'description': 'A 45-second sprint.',
          'instructions': 'Tap the odd tile.',
          'kind': 'web',
          'accentColor': '#5E45D6',
          'backgroundColor': '#15122B',
          'order': 20,
          'thumbnail': 'https://cdn.example.test/odd.jpg',
          'scoring': {'higherIsBetter': true, 'label': 'points'},
          'hasPage': true,
          'version': '2026-10-09T10:00:00.000Z',
        },
      ],
    });
    expect(games, hasLength(1));
    final game = games.single;
    expect(game.key, 'odd-one-out');
    expect(game.name, 'Odd One Out');
    expect(game.tagline, "Spot the tile that's different");
    expect(game.description, 'A 45-second sprint.');
    expect(game.instructions, 'Tap the odd tile.');
    expect(game.kind, GameKind.web);
    expect(game.accentColor, const Color(0xFF5E45D6));
    expect(game.backgroundColor, const Color(0xFF15122B));
    expect(game.order, 20);
    expect(game.thumbnail, 'https://cdn.example.test/odd.jpg');
    expect(game.scoring!.higherIsBetter, isTrue);
    expect(game.scoring!.label, 'points');
    expect(game.hasPage, isTrue);
    expect(game.hasWebPage, isTrue);
    expect(game.version, '2026-10-09T10:00:00.000Z');
  });

  test('a native entry needs no page and keeps no score', () {
    final game = GameCatalogEntry.tryParse({
      'key': 'gratitude-garden',
      'name': 'Gratitude Garden',
      'kind': 'native',
      'scoring': null,
      'hasPage': false,
    })!;
    expect(game.kind, GameKind.native);
    expect(game.scoring, isNull);
    expect(game.hasWebPage, isFalse);
    expect(game.tagline, '');
    expect(game.accentColor, isNull);
  });

  test('rows the app cannot use are skipped, the rest kept in order', () {
    final games = parseGameCatalog({
      'games': [
        _row({'key': 'b', 'name': 'B'}),
        _row({'key': '', 'name': 'No key'}),
        _row({'key': 'c', 'name': ''}),
        _row({'key': 'd', 'name': 'From the future', 'kind': 'vr'}),
        'not a row',
        _row({'key': 'a', 'name': 'A', 'kind': 'native'}),
      ],
    });
    expect(games.map((g) => g.key), ['b', 'a']);
    expect(parseGameCatalog({'games': 'nope'}), isEmpty);
    expect(parseGameCatalog({}), isEmpty);
  });

  test('a hosted game opens only over https, and bad colours are ignored', () {
    final insecure = GameCatalogEntry.tryParse(
      _row({'hostedUrl': 'http://example.test/game', 'accentColor': 'teal'}),
    )!;
    expect(insecure.hostedUrl, isNull);
    expect(insecure.hasWebPage, isFalse);
    expect(insecure.accentColor, isNull);
    final hosted = GameCatalogEntry.tryParse(
      _row({'hostedUrl': 'https://example.test/game'}),
    )!;
    expect(hosted.hasWebPage, isTrue);
    expect(parseHexColor('#80FFFFFF'), const Color(0x80FFFFFF));
  });

  test('a thumbnail is a URL, an asset, or a data URI decoded once', () {
    expect(GameThumbnail.of(null), isA<NoThumbnail>());
    expect(GameThumbnail.of('ftp://x'), isA<NoThumbnail>());
    expect(
      GameThumbnail.of('https://cdn.example.test/a.png'),
      isA<NetworkThumbnail>(),
    );
    expect(
      GameThumbnail.of('assets/games/gratitude-garden.jpg'),
      isA<AssetThumbnail>(),
    );
    final bytes = [137, 80, 78, 71, 1, 2, 3];
    final uri = 'data:image/png;base64,${base64Encode(bytes)}';
    final first = GameThumbnail.of(uri);
    expect(first, isA<MemoryThumbnail>());
    expect((first as MemoryThumbnail).bytes, bytes);
    expect(identical(GameThumbnail.of(uri), first), isTrue);
    final svg = GameThumbnail.of(
      'data:image/svg+xml;base64,${base64Encode(utf8.encode('<svg/>'))}',
    );
    expect((svg as SvgThumbnail).svg, '<svg/>');
    expect(GameThumbnail.of('data:image/png;base64,%%%'), isA<NoThumbnail>());
  });

  test('a leaderboard reaches the page with names and scores, never ids', () {
    final board = GameLeaderboard.fromJson({
      'success': true,
      'score': 4200,
      'improved': true,
      'scoring': {'higherIsBetter': true, 'label': 'points'},
      'leaderboard': [
        {'rank': 1, 'userId': 'u-1', 'playerName': 'Neha Iyer', 'score': 9100, 'isMe': false},
        {'rank': 2, 'userId': 'u-2', 'playerName': 'Tanvi Shah', 'score': 4200, 'isMe': true},
      ],
      'me': {'rank': 2, 'score': 4200, 'achievedAt': '2026-10-09T10:00:00.000Z'},
    });
    final page = board.toPageJson(company: 'Sowaka');
    expect(page['company'], 'Sowaka');
    expect(page['label'], 'points');
    expect(page['me'], {'rank': 2, 'score': 4200});
    expect(page['score'], 4200);
    expect(page['improved'], isTrue);
    expect(page['entries'], [
      {'rank': 1, 'name': 'Neha Iyer', 'score': 9100, 'me': false},
      {'rank': 2, 'name': 'Tanvi Shah', 'score': 4200, 'me': true},
    ]);
    expect(jsonEncode(page), isNot(contains('u-1')));

    final empty = GameLeaderboard.fromJson({'leaderboard': [], 'me': null});
    expect(empty.toPageJson(company: 'Sowaka')['me'], isNull);
    expect(empty.toPageJson(company: 'Sowaka').containsKey('score'), isFalse);
  });
}
