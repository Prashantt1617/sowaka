// The garden screen against a fake server: the meadow draws with every
// tree named and the viewer's marked, and the timeline tab shows the notes
// rising with a Live pill.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/garden/data/garden_api_service.dart';
import 'package:mobile_app/features/garden/presentation/garden_screen.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(id: 'p', email: 'priya@toyota.in', name: 'Priya', role: 'employee', company: 'Toyota', org: 'toyota', enabledTabs: ['games']),
);

void main() {
  testWidgets('the garden draws everyone and the timeline rises', (tester) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/garden/')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'season': '2026-09',
            'daysLeft': 2,
            'people': [
              {'userId': 'p', 'name': 'Priya Nair', 'department': 'Quality', 'isMe': true},
              {'userId': 'r', 'name': 'Rohan Iyer', 'department': 'Production', 'isMe': false},
              {'userId': 's', 'name': 'Sneha Rao', 'department': 'Supply', 'isMe': false},
            ],
            'trees': {
              'r': [{'id': 'n1', 'kind': 'daisy', 'fromUserId': 'p'}],
              'p': [{'id': 'n2', 'kind': 'mango', 'fromUserId': 's'}],
            },
            'givenToday': 1,
            'dailyLimit': 3,
          }),
          200,
        );
      }
      if (path.endsWith('/garden/timeline')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'notes': [
              {
                'id': 'n2', 'kind': 'mango', 'note': 'Stayed past close to get the delivery out.',
                'from': {'userId': 's', 'name': 'Sneha Rao'}, 'to': {'userId': 'p', 'name': 'Priya Nair'},
                'createdAt': '2026-09-28T04:00:00.000Z', 'removable': true,
              },
            ],
          }),
          200,
        );
      }
      return http.Response(jsonEncode({'success': true}), 200);
    });
    final service = GardenApiService(session: _session, baseUrl: 'https://example.test', client: client);

    await tester.pumpWidget(MaterialApp(home: GardenScreen(session: _session, service: service)));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('Gratitude Garden'), findsOneWidget);
    expect(find.text('September · 2 days left'), findsOneWidget);
    expect(find.text('You'), findsOneWidget);
    expect(find.text('Rohan'), findsOneWidget);
    expect(find.text('Sneha'), findsOneWidget);
    expect(find.text('Give gratitude'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('Timeline'));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Live'), findsOneWidget);
    expect(find.text('"Stayed past close to get the delivery out."'), findsWidgets);
    // Let the ticker run a little: it must not throw while it scrolls.
    await tester.pump(const Duration(seconds: 2));
    expect(tester.takeException(), isNull);
  });
}
