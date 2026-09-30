// The tree and the give flow against a fake server: a tree shows its notes,
// tapping one opens the card, and choosing a kind and writing a note ends
// in a request the server receives.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/garden/data/garden_api_service.dart';
import 'package:mobile_app/features/garden/data/garden_models.dart';
import 'package:mobile_app/features/garden/presentation/give_flow.dart';
import 'package:mobile_app/features/garden/presentation/tree_screen.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(id: 'p', email: 'priya@toyota.in', name: 'Priya', role: 'employee', company: 'Toyota', org: 'toyota', enabledTabs: ['games']),
);

const _rohan = GardenPerson(userId: 'r', name: 'Rohan Iyer', department: 'Production', isMe: false);

Map<String, dynamic> _note(String id, String kind, String text) => {
  'id': id,
  'kind': kind,
  'note': text,
  'from': {'userId': 's', 'name': 'Sneha Rao'},
  'to': {'userId': 'r', 'name': 'Rohan Iyer'},
  'createdAt': '2026-09-28T04:00:00.000Z',
  'removable': false,
};

void main() {
  testWidgets("a tree shows its notes and a tap opens the giver's card", (tester) async {
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/garden/trees/r')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'person': {'userId': 'r', 'name': 'Rohan Iyer', 'department': 'Production', 'isMe': false},
            'notes': [_note('n1', 'hibiscus', 'Covered the late shift for me.')],
          }),
          200,
        );
      }
      return http.Response(jsonEncode({'success': true}), 200);
    });
    final service = GardenApiService(session: _session, baseUrl: 'https://example.test', client: client);

    await tester.pumpWidget(MaterialApp(home: TreeScreen(service: service, person: _rohan, companyName: 'Toyota', leftToday: 3)));
    await tester.pumpAndSettle();

    expect(find.text("Rohan's tree"), findsOneWidget);
    expect(find.text("Add to Rohan's tree"), findsOneWidget);
    // One sprite on the canopy: the hibiscus.
    final sprite = find.byWidgetPredicate((w) => w is GestureDetector && w.onTap != null && w.behavior == HitTestBehavior.opaque);
    expect(sprite, findsWidgets);
    await tester.tap(sprite.first);
    await tester.pumpAndSettle();
    expect(find.text('Sneha Rao'), findsOneWidget);
    expect(find.textContaining('Hibiscus'), findsWidgets);
    expect(find.text('"Covered the late shift for me."'), findsOneWidget);
  });

  testWidgets('choosing a kind and writing a note sends it', (tester) async {
    // A phone, not the test binding's small default surface: the meaning
    // line sits under the picker and a lazy list does not build what is
    // below the fold.
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    Map<String, dynamic>? posted;
    final client = MockClient((request) async {
      if (request.method == 'POST' && request.url.path.endsWith('/garden/notes')) {
        posted = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(jsonEncode({'success': true, 'note': _note('new', 'apple', 'Taught me the jig.')}), 201);
      }
      return http.Response(jsonEncode({'success': true}), 200);
    });
    final service = GardenApiService(session: _session, baseUrl: 'https://example.test', client: client);

    GardenNote? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                result = await Navigator.of(context).push<GardenNote>(
                  MaterialPageRoute(builder: (_) => GiveFlowScreen(service: service, to: _rohan, companyName: 'Toyota', leftToday: 2, dailyLimit: 3)),
                );
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // Fruit, then apple: the meaning shows before you go on.
    await tester.tap(find.text('Fruit'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apple'));
    await tester.pumpAndSettle();
    expect(find.textContaining('You helped me learn something', findRichText: true), findsOneWidget);
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();

    expect(find.text('Everyone at Toyota will see this'), findsOneWidget);
    expect(find.text('2 of 3 left today'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Taught me the jig.');
    await tester.pumpAndSettle();
    await tester.tap(find.text("Add to Rohan's tree"));
    await tester.pumpAndSettle();

    expect(posted?['toUserId'], 'r');
    expect(posted?['kind'], 'apple');
    expect(posted?['note'], 'Taught me the jig.');
    expect(result?.id, 'new');
  });
}
