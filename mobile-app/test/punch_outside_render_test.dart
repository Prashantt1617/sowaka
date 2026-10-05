// The out-of-location screens (Figma 3345:28301 onward) against a fake server:
// the manager-approval pair and the marked-present pair, plus the request-sent
// and punched-in confirmations. A layout that overflows fails the test.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/attendance/presentation/punch_screen.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(id: 'u', email: 'u@convrse.ai', name: 'Prashant', role: 'employee', company: 'Convrse', org: 'convrse'),
);

http.Client _server({required String outcome}) => MockClient((request) async {
  if (!request.url.path.endsWith('/attendance/punch')) return http.Response('{"success":true}', 200);
  final body = jsonDecode(request.body) as Map<String, dynamic>;
  final reason = body['reason'] as String?;
  final skip = body['skipReason'] == true;
  if (reason == null && !skip) {
    return http.Response(jsonEncode({
      'success': false,
      'message': 'You are outside the approved attendance area.',
      'details': {
        'office': {'name': 'Noida office', 'city': 'Noida'},
        'location': {'distanceMeters': 18700},
        'outsideLocation': {
          'outcome': outcome,
          'reasons': ['Working from home', 'Client visit', 'Vendor meeting'],
          'reasonOptional': outcome == 'present',
        },
      },
    }), 409);
  }
  final at = DateTime(2026, 10, 5, 16, 24).toUtc().toIso8601String();
  if (outcome == 'request') {
    return http.Response(jsonEncode({
      'success': true,
      'workDate': '2026-10-05',
      'request': {
        'id': 'r1', 'workDate': '2026-10-05', 'note': reason, 'status': 'pending', 'who': 'Prashant',
        'team': '3D', 'createdAt': at, 'kind': 'out_of_location', 'title': 'Out of location',
      },
    }), 200);
  }
  return http.Response(jsonEncode({
    'success': true,
    'workDate': '2026-10-05',
    'punchIn': at,
    'outsideLocation': {'reason': reason ?? 'Work from home', 'place': '18.7 km from Noida office', 'punchType': 'in', 'at': at},
  }), 200);
});

Future<void> _pumpScreen(WidgetTester tester, String outcome) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final loader = FontLoader('Sora')..addFont(rootBundle.load('assets/fonts/sora/Sora-Variable.ttf'));
  await loader.load();
  final api = ManagerApiService(session: _session, baseUrl: 'https://example.test', client: _server(outcome: outcome));
  await tester.pumpWidget(MaterialApp(
    home: PunchScreen(api: api, type: 'in', geofenced: false, startImmediately: true, onRequestWfh: () {}, onViewAttendance: () {}),
  ));
  await tester.pump(const Duration(milliseconds: 300));
  await tester.pump(const Duration(milliseconds: 300));
}

void main() {
  testWidgets('manager approval: pick a reason, send, request sent', (tester) async {
    await _pumpScreen(tester, 'request');
    expect(find.text('Manager approval required'), findsOneWidget);
    expect(find.text("You're outside the office area"), findsOneWidget);
    await tester.tap(find.text('Client visit'));
    await tester.pump();
    await tester.tap(find.text('Send punch-in request'));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Request sent'), findsOneWidget);
    expect(find.textContaining('marked present once your manager'), findsNothing);
  });

  testWidgets('marked present: no reason needed, punched in', (tester) async {
    await _pumpScreen(tester, 'present');
    expect(find.text('Manager approval required'), findsNothing);
    expect(find.text('Your manager will review the request.'), findsNothing);
    await tester.tap(find.text('Send punch-in request'));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text("You're punched in!"), findsOneWidget);
    expect(find.text('Work from home'), findsOneWidget);
  });
}
