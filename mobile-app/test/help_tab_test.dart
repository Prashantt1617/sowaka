// Help, against a fake server: the first open asks its four questions and
// saves them; Help home shows the match, the next session and the topics;
// and booking with someone else reaches Review and confirms.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/care/data/care_api_service.dart';
import 'package:mobile_app/features/help/data/help_api_service.dart';
import 'package:mobile_app/features/help/presentation/help_tab.dart';

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

Map<String, dynamic> _counsellor(String id, String name, {String gender = 'woman'}) => {
  'userId': id,
  'name': name,
  'headline': 'Work stress and burnout',
  'slotMinutes': 50,
  'about': 'A warm, collaborative space.',
  'yearsExperience': 8,
  'languages': ['English', 'Hindi'],
  'focusAreas': ['work', 'self'],
  'focusLabels': ['Work & career', 'Myself & my feelings'],
  'ageRange': 'mid',
  'gender': gender,
};

Map<String, dynamic> _match() => {
  'counsellor': _counsellor('ananya', 'Ananya Rao'),
  'reasons': ['Experience supporting people with feeling overwhelmed', 'Sessions in English'],
  'unmet': <String>[],
  'source': 'intake',
};

Map<String, dynamic> _sessionJson({required String id, required DateTime startsAt, String status = 'booked'}) => {
  'id': id,
  'counsellor': {'userId': 'ananya', 'name': 'Ananya Rao', 'headline': 'Work stress and burnout'},
  'startsAt': startsAt.toUtc().toIso8601String(),
  'endsAt': startsAt.add(const Duration(minutes: 50)).toUtc().toIso8601String(),
  'status': status,
  'joinUrl': status == 'booked' ? 'https://zoom.us/j/123' : null,
  'placeholderLink': false,
};

http.Response _ok(Map<String, dynamic> body, [int status = 200]) =>
    http.Response.bytes(utf8.encode(jsonEncode({'success': true, ...body})), status, headers: {'content-type': 'application/json; charset=utf-8'});

Widget _app(HelpApiService service, CareApiService care) => MaterialApp(
  home: Scaffold(
    body: HelpTab(session: _session, profileAction: const SizedBox.shrink(), onNotifications: () {}, service: service, careService: care),
  ),
);

void _tall(WidgetTester tester) {
  tester.view.physicalSize = const Size(430, 2200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('the first open asks four questions, saves them and lands on Help home with the match', (tester) async {
    _tall(tester);
    var intakeDone = false;
    Map<String, dynamic>? saved;
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/help/home')) {
        return _ok({'intakeDone': intakeDone, 'match': intakeDone ? _match() : null, 'noMatch': null, 'upcoming': null, 'history': []});
      }
      if (path.endsWith('/help/intake') && request.method == 'PUT') {
        saved = jsonDecode(request.body) as Map<String, dynamic>;
        intakeDone = true;
        return _ok({'intake': saved, 'match': _match(), 'noMatch': null});
      }
      if (path.endsWith('/care/catalog')) return _ok({'catalog': {}});
      return _ok({});
    });
    await tester.pumpWidget(_app(HelpApiService(session: _session, baseUrl: 'https://example.test', client: client), CareApiService(session: _session, baseUrl: 'https://example.test', client: client)));
    await tester.pumpAndSettle();

    expect(find.text('What would you like\nto talk about?'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('option-work')));
    await tester.tap(find.byKey(const ValueKey('option-self')));
    await tester.pump();
    expect(find.text('2 selected'), findsOneWidget);
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.text('What would you like\nhelp with?'), findsOneWidget);
    // The first difficulty offered follows the topic chosen.
    expect(find.text('Switching off after work'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('option-overwhelmed')));
    await tester.pump();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.text('What would you like\nto work towards?'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('option-forward')));
    await tester.pump();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.text('Who would you feel\ncomfortable talking to?'), findsOneWidget);
    await tester.tap(find.text('English'));
    await tester.tap(find.text('Woman'));
    await tester.pump();
    await tester.tap(find.text('See my starting point'));
    await tester.pumpAndSettle();

    expect(saved?['topics'], ['work', 'self']);
    expect(saved?['needs'], ['overwhelmed']);
    expect(saved?['goal'], 'forward');
    expect(saved?['languages'], ['English']);
    expect(saved?['gender'], 'woman');
    expect(find.text('A little support,\nat your own pace.'), findsOneWidget);
    expect(find.text('Ananya Rao'), findsOneWidget);
    expect(find.text('Sessions in English'), findsOneWidget);

    await tester.tap(find.text('Go to Help'));
    await tester.pumpAndSettle();
    expect(find.text('A little support.\nA familiar face.'), findsOneWidget);
    expect(find.text('YOUR COUNSELLOR'), findsOneWidget);
    expect(find.text('Explore a topic'), findsOneWidget);
    expect(find.text('Grief & loss'), findsOneWidget);
  });

  testWidgets('Help home shows the next session with Join, and the closest counsellor when nobody fits', (tester) async {
    _tall(tester);
    final tomorrow = DateTime.now().add(const Duration(days: 1));
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/help/home')) {
        return _ok({
          'intakeDone': true,
          'match': null,
          'noMatch': {
            'counsellor': _counsellor('leena', 'Leena Iyer'),
            'unmet': ['Counsellor’s gender: Man'],
            'reasons': ['Sessions in Tamil'],
          },
          'upcoming': _sessionJson(id: 's1', startsAt: tomorrow),
          'history': [_sessionJson(id: 's0', startsAt: tomorrow.subtract(const Duration(days: 8)), status: 'completed')],
        });
      }
      if (path.endsWith('/care/catalog')) return _ok({'catalog': {}});
      return _ok({});
    });
    await tester.pumpWidget(_app(HelpApiService(session: _session, baseUrl: 'https://example.test', client: client), CareApiService(session: _session, baseUrl: 'https://example.test', client: client)));
    await tester.pumpAndSettle();

    expect(find.text('YOUR NEXT SESSION'), findsOneWidget);
    expect(find.text('Join session'), findsOneWidget);
    expect(find.text('Nobody fits every preference you set.'), findsOneWidget);
    expect(find.text('Not met: Counsellor’s gender: Man'), findsOneWidget);
    expect(find.text('Show me who is available anyway'), findsOneWidget);
    expect(find.text('Your sessions'), findsOneWidget);
  });

  testWidgets('choosing someone else, a counsellor first, reaches Review and confirms the booking', (tester) async {
    _tall(tester);
    final tomorrow = DateTime.now().add(const Duration(days: 1));
    final ten = DateTime(tomorrow.year, tomorrow.month, tomorrow.day, 10);
    Map<String, dynamic>? posted;
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/help/home')) {
        return _ok({'intakeDone': true, 'match': _match(), 'noMatch': null, 'upcoming': null, 'history': []});
      }
      if (path.endsWith('/talk/counsellors')) {
        return _ok({'counsellors': [_counsellor('ananya', 'Ananya Rao'), _counsellor('kabir', 'Kabir Mehta', gender: 'man')]});
      }
      if (path.contains('/help/counsellors/kabir')) {
        return _ok({'counsellor': _counsellor('kabir', 'Kabir Mehta', gender: 'man'), 'matched': false, 'reasons': ['Experience with work & career'], 'unmet': [], 'sessions': {'upcoming': [], 'past': []}});
      }
      if (path.endsWith('/talk/availability')) {
        return _ok({
          'date': request.url.queryParameters['date'],
          'slots': [
            {'startsAt': ten.toUtc().toIso8601String(), 'endsAt': ten.add(const Duration(minutes: 50)).toUtc().toIso8601String(), 'label': '10:00', 'counsellorIds': ['ananya', 'kabir']},
          ],
        });
      }
      if (path.endsWith('/talk/sessions') && request.method == 'POST') {
        posted = jsonDecode(request.body) as Map<String, dynamic>;
        return _ok({'session': _sessionJson(id: 'new', startsAt: ten)}, 201);
      }
      if (path.endsWith('/care/catalog')) return _ok({'catalog': {}});
      return _ok({});
    });
    await tester.pumpWidget(_app(HelpApiService(session: _session, baseUrl: 'https://example.test', client: client), CareApiService(session: _session, baseUrl: 'https://example.test', client: client)));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Choose someone else'));
    await tester.pumpAndSettle();
    expect(find.text('What would you\nlike to choose first?'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('route-counsellor')));
    await tester.pumpAndSettle();

    // The matched counsellor is left out of the list.
    expect(find.text('Kabir Mehta'), findsOneWidget);
    expect(find.text('Ananya Rao'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('counsellor-kabir')));
    await tester.pumpAndSettle();
    expect(find.text('Get to know your counsellor'.toUpperCase()), findsOneWidget);
    await tester.tap(find.text('Book with Kabir'));
    await tester.pumpAndSettle();

    expect(find.text('Pick a time'), findsOneWidget);
    await tester.tap(find.text('10:00 am'));
    await tester.pump();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.text('Review your session'.toUpperCase()), findsOneWidget);
    expect(find.text('Kabir Mehta'), findsOneWidget);
    expect(find.text('50 min · Video call'), findsOneWidget);
    await tester.tap(find.text('Confirm session'));
    await tester.pumpAndSettle();

    expect(posted?['counsellorUserId'], 'kabir');
    expect(posted?['startsAt'], ten.toUtc().toIso8601String());
    expect(find.text('You’re booked.'), findsOneWidget);
  });
}
