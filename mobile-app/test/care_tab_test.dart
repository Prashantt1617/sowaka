// Care, against a fake server: the home shows its five activities; Move
// opens the body picker and a stretch with its countdown; Breathe runs the
// box; Write saves an entry and lists the week.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/care/data/care_api_service.dart';
import 'package:mobile_app/features/care/presentation/care_tab.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'priya',
    email: 'priya@toyota.in',
    name: 'Priya',
    role: 'employee',
    company: 'Toyota',
    org: 'toyota',
    enabledTabs: ['connect', 'care', 'talk'],
  ),
);

http.Response _ok(Map<String, dynamic> body, [int status = 200]) =>
    http.Response.bytes(utf8.encode(jsonEncode({'success': true, ...body})), status, headers: {'content-type': 'application/json; charset=utf-8'});

CareApiService _service(MockClient client) => CareApiService(session: _session, baseUrl: 'https://example.test', client: client);

Widget _app(CareApiService service) => MaterialApp(
  home: Scaffold(
    body: CareTab(session: _session, profileAction: const SizedBox.shrink(), onNotifications: () {}, onOpenHelp: () {}, service: service),
  ),
);

void _tall(WidgetTester tester) {
  tester.view.physicalSize = const Size(430, 2200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('Care home shows Write first and the four activities', (tester) async {
    _tall(tester);
    final client = MockClient((request) async => _ok({'catalog': {}}));
    await tester.pumpWidget(_app(_service(client)));
    await tester.pumpAndSettle();
    expect(find.text('A little space\nfor you.'), findsOneWidget);
    expect(find.text('Write'), findsOneWidget);
    for (final name in ['Move', 'Breathe', 'Listen', 'Sleep']) {
      expect(find.text(name), findsOneWidget);
    }
    expect(find.text('Explore it in Help'), findsOneWidget);
  });

  testWidgets('Move opens the body picker, then Neck Release plays step by step and holds on its pause', (tester) async {
    _tall(tester);
    final client = MockClient((request) async => _ok({'catalog': {}}));
    await tester.pumpWidget(_app(_service(client)));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('care-move')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Which part of your\nbody do you want\nto stretch?'), findsOneWidget);
    expect(find.text('Spine & Back'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('zone-chip-neck')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Neck Release'), findsOneWidget);
    expect(find.text('BODY · NECK'), findsOneWidget);
    // Without a clip yet, step one is its words for a few seconds.
    expect(find.text('Step 1 of 5 · swipe to move on'), findsOneWidget);
    expect(find.text('Moving on in 6'), findsOneWidget);

    // Then it moves on by itself to the hold: three breaths, fifteen seconds.
    await tester.pump(const Duration(seconds: 7));
    await tester.pump(const Duration(milliseconds: 1000));
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('Step 2 of 5 · swipe to move on'), findsOneWidget);
    expect(find.text('0:15'), findsOneWidget);
    await tester.pump(const Duration(seconds: 2));
    expect(find.text('0:13'), findsOneWidget);
  });

  testWidgets('Breathe opens the moods and Anxious runs the box, round by round', (tester) async {
    _tall(tester);
    final client = MockClient((request) async => _ok({'catalog': {}}));
    await tester.pumpWidget(_app(_service(client)));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('care-breathe')));
    await tester.pumpAndSettle();
    expect(find.text('How are you\nfeeling?'), findsOneWidget);
    expect(find.text('Can’t stop scrolling'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('mood-anxious')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Feet Press + Box Breathing'), findsOneWidget);
    expect(find.text('Round 1 of 4'), findsOneWidget);
    expect(find.text('Breathe around the box'), findsOneWidget);

    // The breath starts after a short beat: four seconds in, then hold.
    await tester.pump(const Duration(milliseconds: 700));
    expect(find.text('BREATHE IN'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
    await tester.pump(const Duration(seconds: 4));
    expect(find.text('HOLD'), findsOneWidget);
  });

  testWidgets('Write saves an entry, lists the week and says when it is mailed', (tester) async {
    _tall(tester);
    final entries = <Map<String, dynamic>>[];
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/care/catalog')) return _ok({'catalog': {'prompts': ['What is on your mind?']}});
      if (path.endsWith('/care/journal') && request.method == 'POST') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        final entry = {'id': 'e${entries.length + 1}', 'text': body['text'], 'prompt': body['prompt'], 'context': body['context'], 'createdAt': DateTime.now().toUtc().toIso8601String(), 'updatedAt': DateTime.now().toUtc().toIso8601String()};
        entries.insert(0, entry);
        return _ok({'entry': entry}, 201);
      }
      if (path.endsWith('/care/journal')) {
        return _ok({'entries': entries, 'clearsAt': DateTime.now().add(const Duration(days: 3)).toUtc().toIso8601String(), 'email': 'priya@toyota.in'});
      }
      return _ok({});
    });
    await tester.pumpWidget(_app(_service(client)));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('care-write')));
    await tester.pumpAndSettle();
    expect(find.text('What is on your mind?'), findsOneWidget);
    expect(find.textContaining('email the week’s writing to priya@toyota.in'), findsOneWidget);
    expect(find.text('Nothing yet. What you save shows here until Sunday night.'), findsOneWidget);

    await tester.tap(find.text('Start writing'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('write-field')), 'A quiet Tuesday.');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(entries.single['text'], 'A quiet Tuesday.');
    expect(entries.single['prompt'], 'What is on your mind?');
    expect(entries.single['context'], 'general');
    expect(find.text('A quiet Tuesday.'), findsOneWidget);
  });
}
