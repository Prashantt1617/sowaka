// The Talk tab and its booking wizard, against a fake server: what the tab
// shows from the person's sessions, and that choosing a counsellor, a day and
// a slot ends in a booking the server receives.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/talk/data/talk_api_service.dart';
import 'package:mobile_app/features/talk/data/talk_models.dart';
import 'package:mobile_app/features/talk/presentation/talk_booking_screen.dart';
import 'package:mobile_app/features/talk/presentation/talk_tab.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'priya',
    email: 'priya@toyota.in',
    name: 'Priya',
    role: 'employee',
    company: 'Toyota',
    org: 'toyota',
    enabledTabs: ['connect', 'talk'],
  ),
);

Map<String, dynamic> _counsellor(String id, String name) => {
  'userId': id,
  'name': name,
  'headline': 'Workplace wellbeing',
  'slotMinutes': 50,
};

Map<String, dynamic> _sessionJson({
  required String id,
  required DateTime startsAt,
  String status = 'booked',
  bool placeholder = false,
}) => {
  'id': id,
  'counsellor': {'userId': 'k', 'name': 'Kritik', 'headline': 'Workplace wellbeing'},
  'startsAt': startsAt.toUtc().toIso8601String(),
  'endsAt': startsAt.add(const Duration(minutes: 50)).toUtc().toIso8601String(),
  'status': status,
  'joinUrl': status == 'booked' ? 'https://zoom.us/j/123' : null,
  'placeholderLink': placeholder,
};

void main() {
  testWidgets('the tab shows the two doors, what is coming and what was', (
    tester,
  ) async {
    final tomorrow = DateTime.now().add(const Duration(days: 1));
    final lastWeek = DateTime.now().subtract(const Duration(days: 7));
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/talk/sessions')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'upcoming': [
              _sessionJson(id: 's1', startsAt: tomorrow, placeholder: true),
            ],
            'past': [
              _sessionJson(id: 's0', startsAt: lastWeek, status: 'completed'),
            ],
          }),
          200,
        );
      }
      return http.Response(jsonEncode({'success': true}), 200);
    });
    final service = TalkApiService(
      session: _session,
      baseUrl: 'https://example.test',
      client: client,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TalkTab(
            session: _session,
            profileAction: const SizedBox.shrink(),
            onNotifications: () {},
            service: service,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Choose a counsellor'), findsOneWidget);
    expect(find.text('Book a slot'), findsOneWidget);
    expect(find.text('Upcoming sessions'), findsOneWidget);
    expect(find.text('Join session'), findsOneWidget);
    expect(find.text('Test link'), findsOneWidget);
    expect(find.text('Past sessions'), findsOneWidget);
    expect(find.text('Completed'), findsOneWidget);
    expect(find.text('Kritik'), findsNWidgets(2));
  });

  testWidgets('choosing a counsellor, a day and a slot books it', (
    tester,
  ) async {
    final tomorrow = DateTime.now().add(const Duration(days: 1));
    final ten = DateTime(tomorrow.year, tomorrow.month, tomorrow.day, 10);
    Map<String, dynamic>? posted;
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/talk/counsellors')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'counsellors': [_counsellor('k', 'Kritik'), _counsellor('t', 'Tanvi')],
          }),
          200,
        );
      }
      if (path.endsWith('/talk/availability')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'date': request.url.queryParameters['date'],
            'slots': [
              {
                'startsAt': ten.toUtc().toIso8601String(),
                'endsAt': ten.add(const Duration(minutes: 50)).toUtc().toIso8601String(),
                'label': '10:00',
                'counsellorIds': ['k', 't'],
              },
              {
                'startsAt': ten.add(const Duration(minutes: 50)).toUtc().toIso8601String(),
                'endsAt': ten.add(const Duration(minutes: 100)).toUtc().toIso8601String(),
                'label': '10:50',
                // Only Tanvi: choosing Kritik must hide this one.
                'counsellorIds': ['t'],
              },
            ],
          }),
          200,
        );
      }
      if (request.method == 'POST' && path.endsWith('/talk/sessions')) {
        posted = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({
            'success': true,
            'session': _sessionJson(id: 'new', startsAt: ten),
          }),
          201,
        );
      }
      return http.Response(jsonEncode({'success': true}), 200);
    });
    final service = TalkApiService(
      session: _session,
      baseUrl: 'https://example.test',
      client: client,
    );

    TalkSession? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () async {
                  result = await Navigator.of(context).push<TalkSession>(
                    MaterialPageRoute(
                      builder: (_) => TalkBookingScreen(
                        session: _session,
                        mode: TalkBookingMode.byCounsellor,
                        service: service,
                      ),
                    ),
                  );
                },
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    expect(find.text('Who would you like to talk to?'), findsOneWidget);
    await tester.tap(find.text('Kritik'));
    await tester.pumpAndSettle();

    // Kritik is free at 10:00 only; the 10:50 slot is Tanvi's alone.
    expect(find.text('Pick a slot'), findsOneWidget);
    expect(find.text('10:00 am'), findsOneWidget);
    expect(find.text('10:50 am'), findsNothing);

    await tester.tap(find.text('10:00 am'));
    await tester.pumpAndSettle();
    expect(find.text('Confirm your session'), findsOneWidget);
    await tester.tap(find.text('Confirm booking'));
    await tester.pumpAndSettle();

    expect(posted?['counsellorUserId'], 'k');
    expect(posted?['startsAt'], ten.toUtc().toIso8601String());
    expect(result?.id, 'new', reason: 'the screen hands the booking back');
  });
}
