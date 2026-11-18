// A punch the server already has must read as done, not as an error: a second
// tap after a slow first one gets "Already punched out today" (409), and the
// day's record decides. A real refusal still shows, without the request name
// ("POST /attendance/punch: ") the API adds for the logs.
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
  user: const AuthUser(id: 'u', email: 'u@convrse.ai', name: 'Satish', role: 'employee', company: 'Convrse', org: 'convrse'),
);

String _today() {
  final now = DateTime.now();
  return '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
}

int _attendanceReads = 0;

http.Client _server({required bool savedAlready, required String refusal}) => MockClient((request) async {
  final path = request.url.path;
  if (path.endsWith('/attendance/punch')) {
    return http.Response(jsonEncode({'success': false, 'message': refusal}), 409);
  }
  if (path.endsWith('/attendance/mine')) {
    _attendanceReads += 1;
    final now = DateTime.now();
    return http.Response(jsonEncode({
      'success': true,
      'records': [
        {
          'workDate': _today(),
          'punchIn': DateTime(now.year, now.month, now.day, 9, 49).toUtc().toIso8601String(),
          if (savedAlready) 'punchOut': DateTime(now.year, now.month, now.day, 19, 41).toUtc().toIso8601String(),
        },
      ],
      'regularizations': [],
    }), 200);
  }
  return http.Response('{"success":true}', 200);
});

Future<void> _pumpPunchOut(WidgetTester tester, http.Client client) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final loader = FontLoader('Sora')..addFont(rootBundle.load('assets/fonts/sora/Sora-Variable.ttf'));
  await loader.load();
  final api = ManagerApiService(session: _session, baseUrl: 'https://example.test', client: client);
  await tester.pumpWidget(MaterialApp(
    home: Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<PunchOutcome>(
              builder: (_) => PunchScreen(
                api: api, type: 'out', geofenced: false, startImmediately: true,
                onRequestWfh: () {}, onViewAttendance: () {},
              ),
            )),
            child: const Text('open'),
          ),
        ),
      ),
    ),
  ));
  await tester.tap(find.text('open'));
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 300));
  }
}

void main() {
  setUp(() => _attendanceReads = 0);

  testWidgets('"Already punched out" with the punch saved reads as punched out', (tester) async {
    await _pumpPunchOut(tester, _server(savedAlready: true, refusal: 'Already punched out today'));
    expect(_attendanceReads, greaterThan(0));
    expect(find.text("You're punched out!"), findsOneWidget);
    expect(find.textContaining('Already punched out'), findsNothing);
  });

  testWidgets('a refusal with nothing saved still shows, without the request name', (tester) async {
    await _pumpPunchOut(tester, _server(savedAlready: false, refusal: 'Your location is not precise enough yet'));
    expect(find.text("You're punched out!"), findsNothing);
    expect(find.textContaining('Your location is not precise enough yet'), findsWidgets);
    expect(find.textContaining('POST /attendance/punch'), findsNothing);
  });
}
