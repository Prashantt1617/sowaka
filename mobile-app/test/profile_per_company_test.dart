// Whose profile is whose. A company given Help but none of the work tabs has
// no attendance, no requests and no reporting line, so their profile carries
// the counsellor and the sessions instead. Every other company keeps exactly
// the profile it had, including one that was never given a tab list.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/help/data/help_api_service.dart';
import 'package:mobile_app/features/help/presentation/help_profile_section.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';

http.Response _ok(Map<String, dynamic> body) => http.Response.bytes(
  utf8.encode(jsonEncode({'success': true, ...body})),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

const _session = AuthSession(
  token: 'token',
  user: AuthUser(
    id: 'me',
    email: 'priya@tfsin.demo',
    name: 'Priya Nair',
    role: 'employee',
    company: 'Toyota',
    org: 'toyota',
    enabledTabs: ['connect', 'games', 'care', 'talk'],
  ),
);

Map<String, dynamic> _home({required bool matched, bool intakeDone = true}) => {
  'intakeDone': intakeDone,
  'match': matched
      ? {
          'counsellor': {
            'userId': 'ananya',
            'name': 'Ananya Rao',
            'headline': 'Workplace wellbeing',
            'slotMinutes': 40,
            'yearsExperience': 8,
            'languages': ['English'],
            'focusLabels': ['Work & career'],
            'about': 'A practical space.',
            'ageRange': 'young',
            'gender': 'woman',
          },
          'reasons': ['Experience supporting people with switching off after work'],
          'unmet': <dynamic>[],
          'source': 'intake',
        }
      : null,
  'noMatch': null,
  'upcoming': null,
  'awaitingReview': null,
  'history': <dynamic>[],
};

Future<void> _pumpSection(
  WidgetTester tester,
  Map<String, dynamic> home,
) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final client = MockClient((request) async {
    if (request.url.path.endsWith('/help/home')) return _ok(home);
    return _ok({});
  });
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: HelpProfileSection(
            session: _session,
            service: HelpApiService(
              session: _session,
              baseUrl: 'https://example.test',
              client: client,
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('which profile a company gets', () {
    test('Help without the work tabs', () {
      const toyota = ['connect', 'games', 'care', 'talk'];
      expect(profileShowsWork(toyota), isFalse);
      expect(profileShowsHelp(toyota), isTrue);
    });

    test('the work tabs keep the profile they had', () {
      const usual = ['connect', 'team', 'grow', 'actions'];
      expect(profileShowsWork(usual), isTrue);
      expect(profileShowsHelp(usual), isFalse);
    });

    test('a company given both keeps its work profile as well', () {
      const both = ['connect', 'team', 'actions', 'talk'];
      expect(profileShowsWork(both), isTrue);
      expect(profileShowsHelp(both), isTrue);
    });

    test('no list at all means the profile it has always had', () {
      expect(profileShowsWork(const []), isTrue);
      expect(profileShowsHelp(const []), isFalse);
    });
  });

  testWidgets('the Help profile shows the counsellor, as the design has it', (
    tester,
  ) async {
    await _pumpSection(tester, _home(matched: true));

    expect(find.text('Ananya Rao'), findsOneWidget);
    expect(find.text('8 yrs experience'), findsOneWidget);
    expect(find.text('View profile'), findsOneWidget);
    expect(find.text('Change'), findsOneWidget);
    expect(find.text('MY WELLBEING'), findsOneWidget);
    expect(find.text('Session history'), findsOneWidget);
    expect(find.text('MY PREFERENCES'), findsOneWidget);
    // Why they were matched is on their own page, not here.
    expect(find.textContaining('switching off after work'), findsNothing);
    // Matching happens once: having answered, nobody is asked again.
    expect(find.text('Match with a counsellor'), findsNothing);
  });

  testWidgets('before the questions, it offers to match', (tester) async {
    await _pumpSection(tester, _home(matched: false, intakeDone: false));

    // The card's title and its button say the same thing.
    expect(find.text('Match with a counsellor'), findsOneWidget);
    expect(find.text('Answer the questions'), findsOneWidget);
    expect(find.text('MY PREFERENCES'), findsNothing);
  });

  testWidgets('answered but nobody free says so, and does not ask again', (
    tester,
  ) async {
    await _pumpSection(tester, _home(matched: false));

    expect(find.text('Nobody is available yet'), findsOneWidget);
    expect(find.text('Match with a counsellor'), findsNothing);
  });
}
