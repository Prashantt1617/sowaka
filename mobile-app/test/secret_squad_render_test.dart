// Secret Squad's feed card drawn with its real font (Lexend) on a 390-wide
// phone, laid out where the "Secret Squad Feed Card" design puts it: under
// an 80-high header, 20 in from the sides and 18 down. Its boxes are checked
// against the design's own measurements, and with SQUAD_SHOTS set to a
// folder each state is written there as a PNG to compare with the design.
// The game-over card is checked against the "Secret Squad · game over"
// board the same way.
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/data/connect_models.dart';
import 'package:mobile_app/features/games/presentation/qr_scanner_screen.dart';
import 'package:mobile_app/features/squad/presentation/secret_squad_post_card.dart';

const _session = AuthSession(
  token: 't',
  user: AuthUser(
    id: 'u',
    email: 'e',
    name: 'n',
    role: 'employee',
    company: 'c',
  ),
);

final _start = DateTime(2026, 10, 17, 16);
final _lobby = _start.subtract(const Duration(minutes: 3));

/// The design's standings: Priya N. first with 980, Dev J. tenth with 560,
/// and the viewer (`u`) 23rd with 410.
List<Map<String, dynamic>> _designResults({int count = 23, int? mine = 22}) {
  const top = [
    ('Priya Nair', 'PN', 980),
    ('Ananya Sharma', 'AS', 860),
    ('Rohan Mehta', 'RM', 790),
    ('Vikram Kapoor', 'VK', 740),
    ('Neha Singh', 'NS', 715),
    ('Karan Desai', 'KD', 690),
    ('Meera Joshi', 'MJ', 655),
    ('Ishaan Malhotra', 'IM', 620),
    ('Sara Rao', 'SR', 585),
    ('Dev Jain', 'DJ', 560),
  ];
  return [
    for (var i = 0; i < count; i++)
      if (i == mine)
        {
          'userId': 'u',
          'name': 'Aarav Gupta',
          'initials': 'AG',
          'photoUrl': null,
          'points': 410,
          'rank': i + 1,
        }
      else if (i < top.length)
        {
          'userId': 'p$i',
          'name': top[i].$1,
          'initials': top[i].$2,
          'photoUrl': null,
          'points': top[i].$3,
          'rank': i + 1,
        }
      else
        {
          'userId': 'p$i',
          'name': 'Player $i',
          'initials': 'P$i',
          'photoUrl': null,
          'points': 540 - i * 5,
          'rank': i + 1,
        },
  ];
}

ConnectPost _post({String? status, List<Map<String, dynamic>>? results}) =>
    ConnectPost.fromJson({
      'id': 'p',
      'type': 'secret_squad',
      'body': {
        'office': 'Gurgaon',
        'lobbyOpensAt': _lobby.toUtc().toIso8601String(),
        'startsAt': _start.toUtc().toIso8601String(),
        'endsAt': _start
            .add(const Duration(minutes: 40))
            .toUtc()
            .toIso8601String(),
        'status': ?status,
        'results': ?results,
      },
    });

final _shots = Platform.environment['SQUAD_SHOTS'];

Future<void> _fonts() async {
  for (final (family, file) in [
    ('Lexend', 'assets/fonts/lexend/Lexend-Variable.ttf'),
    ('Lilita One', 'assets/fonts/lilita_one/LilitaOne-Regular.ttf'),
  ]) {
    await (FontLoader(family)..addFont(rootBundle.load(file))).load();
  }
}

Future<void> _save(WidgetTester tester, String name) async {
  final dir = _shots;
  if (dir == null) return;
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const ValueKey('shot')),
  );
  // Tests draw shadows unblurred; the card's shadow is part of the design,
  // so the shot is painted again with them on, and they go back off before
  // the test ends.
  debugDisableShadows = false;
  try {
    void repaint(RenderObject object) {
      object.markNeedsPaint();
      object.visitChildren(repaint);
    }

    repaint(boundary);
    await tester.pump();
    await tester.runAsync(() async {
      final image = await boundary.toImage(pixelRatio: 2);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      File('$dir/$name.png').writeAsBytesSync(bytes!.buffer.asUint8List());
    });
  } finally {
    debugDisableShadows = true;
  }
}

Future<void> _card(
  WidgetTester tester, {
  required DateTime now,
  String? status,
  List<Map<String, dynamic>>? results,
  double? envelopeTime,
  bool still = false,
}) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await _fonts();
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      home: MediaQuery(
        data: MediaQueryData(
          size: const Size(390, 844),
          disableAnimations: still,
        ),
        child: RepaintBoundary(
          key: const ValueKey('shot'),
          child: ColoredBox(
            color: const Color(0xFFF4F5F9),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(
                  height: 80,
                  child: ColoredBox(color: Colors.white),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 0),
                  child: SecretSquadPostCard(
                    post: _post(status: status, results: results),
                    session: _session,
                    now: () => now,
                    envelopeTime: envelopeTime,
                  ),
                ),
                const Spacer(),
              ],
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('countdown, still: laid out as the design', (tester) async {
    await _card(
      tester,
      now: _lobby.subtract(const Duration(hours: 22, minutes: 50, seconds: 10)),
      still: true,
    );
    final card = tester.getRect(find.byType(SecretSquadPostCard));
    expect(card.left, 20);
    expect(card.top, 98);
    expect(card.width, 350);
    // The design's text boxes, measured in Chrome at 390 wide from the card's
    // corner: (left, top) of each, within a pixel and a half.
    Rect at(Finder finder) => tester.getRect(finder).shift(-card.topLeft);
    const design = {
      'SQUAD HUNT': (22.0, 24.0),
      'Secret Squad': (22.0, 49.0),
      'Your word is a clue to find your secret squad.': (22.0, 120.09),
      'Lobby opens in': (127.19, 231.59),
      '22:50:10': (110.84, 251.59),
      'SURPRISE REWARDS': (94.0, 335.59),
      'For the top squads to link up': (94.0, 355.59),
    };
    for (final MapEntry(key: text, value: (left, top)) in design.entries) {
      final box = at(find.text(text));
      expect(box.left, closeTo(left, 1.5), reason: text);
      expect(box.top, closeTo(top, 1.5), reason: text);
    }
    // The title wraps in the design too: 198 wide beside the envelope.
    expect(at(find.text('Secret Squad')).height, closeTo(65.09, 1.5));
    // The date row (182.59, 19 high) and the button (407.59, 62 high).
    expect(at(find.text('Sat 17 Oct')).top, closeTo(182.59, 1.5));
    final button = at(find.text('Let’s Play'));
    expect(button.top - 15 - 2.5, closeTo(407.59, 1.5));
    expect(button.center.dx, closeTo(175, 1));
    expect(card.height, closeTo(491.59, 2));
    expect(tester.takeException(), isNull);
    await _save(tester, 'card_countdown_still');
  });

  for (final (name, t) in [
    ('open', 2.0),
    ('word', 6.0),
    ('closing', 3.4),
    ('question', 14.0),
  ]) {
    testWidgets('countdown, envelope $name at ${t}s', (tester) async {
      await _card(
        tester,
        now: _lobby.subtract(
          const Duration(hours: 22, minutes: 50, seconds: 10),
        ),
        envelopeTime: t,
      );
      expect(tester.takeException(), isNull);
      await _save(tester, 'card_envelope_$name');
    });
  }

  for (final (name, now, status) in [
    ('lobby', _start.subtract(const Duration(minutes: 2, seconds: 14)), null),
    ('playing', _start.add(const Duration(minutes: 5)), null),
    ('ended', _start.add(const Duration(hours: 2)), null),
    ('cancelled', _lobby.subtract(const Duration(hours: 3)), 'cancelled'),
  ]) {
    testWidgets(name, (tester) async {
      await _card(tester, now: now, status: status, still: true);
      expect(tester.takeException(), isNull);
      await _save(tester, 'card_$name');
    });
  }

  group('game over', () {
    testWidgets('laid out as the design', (tester) async {
      await _card(
        tester,
        now: _start.add(const Duration(hours: 2)),
        status: 'over',
        results: _designResults(),
        envelopeTime: 4,
      );
      final card = tester.getRect(find.byType(SecretSquadPostCard));
      expect(card.width, 350);
      // Measured in Chrome at 390 wide (device scale 2, animations off),
      // from the card's corner: (left, top) of each, within a pixel and a
      // half; (null, top) where only the top is comparable.
      Rect at(Finder finder) => tester.getRect(finder).shift(-card.topLeft);
      const design = {
        'GAME OVER': (49.0, 26.0),
        'Secret Squad': (22.0, 61.0),
        'Every word found its squad.': (22.0, 132.09),
        'Top 10 players': (null, 178.34),
        'Priya N.': (null, 272.84),
        'Ananya S.': (null, 284.84),
        'Rohan M.': (null, 296.84),
        '980': (166.12, 315.34),
        '860': (267.3, 323.34),
        '790': (71.95, 329.09),
        'Vikram K.': (96.0, 379.84),
        '#23': (187.5, 501.34),
        'You': (246.11, 500.59),
      };
      for (final MapEntry(key: text, value: (left, top)) in design.entries) {
        final box = at(find.text(text));
        if (left != null) {
          expect(box.left, closeTo(left, 1.5), reason: text);
        }
        expect(box.top, closeTo(top, 1.5), reason: text);
      }
      expect(at(find.text('Secret Squad')).height, closeTo(65.09, 1.5));
      // The podium's places sit over their columns: 3 · 1 · 2.
      expect(at(find.text('Rohan M.')).center.dx, closeTo(77, 1));
      expect(at(find.text('Priya N.')).center.dx, closeTo(175, 1));
      expect(at(find.text('Ananya S.')).center.dx, closeTo(273, 1));
      // Rank 10 heads the second column's third row.
      expect(at(find.text('10')).topLeft.dx, closeTo(187, 1.5));
      expect(at(find.text('10')).top, closeTo(460.34, 1.5));
      final button = at(find.text('View Full Leaderboard'));
      expect(button.top - 14 - 2.5, closeTo(557.84, 1.5));
      expect(button.center.dx, closeTo(175, 1));
      expect(card.height, closeTo(637.34, 2));
      expect(tester.takeException(), isNull);
      await _save(tester, 'over');
    });

    testWidgets('mid-entrance', (tester) async {
      await _card(
        tester,
        now: _start.add(const Duration(hours: 2)),
        status: 'over',
        results: _designResults(),
        envelopeTime: 0.9,
      );
      expect(tester.takeException(), isNull);
      await _save(tester, 'over_entrance');
    });

    for (final (name, results) in [
      ('still', _designResults()),
      ('you_in_top_10', _designResults(mine: 5)),
      ('two_players', _designResults(count: 2, mine: 1)),
      ('five_players', _designResults(count: 5, mine: null)),
      ('no_results', null),
      ('nobody_played', const <Map<String, dynamic>>[]),
    ]) {
      testWidgets(name, (tester) async {
        await _card(
          tester,
          now: _start.add(const Duration(hours: 2)),
          status: 'over',
          results: results,
          still: true,
        );
        expect(tester.takeException(), isNull);
        await _save(tester, 'over_$name');
      });
    }
  });

  testWidgets('the scanner', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await _fonts();
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        home: RepaintBoundary(
          key: const ValueKey('shot'),
          child: QrScannerScreen(
            // A stand-in for the camera: an office, out of focus.
            previewBuilder: (context, onCode) => const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Color(0xFF5A6070),
                    Color(0xFF2C3140),
                    Color(0xFF7A7466),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Point at a colleague’s code'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await _save(tester, 'scanner');
  });
}
