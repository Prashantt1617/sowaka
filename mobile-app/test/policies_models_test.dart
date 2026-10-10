// The company's own policies as the server sends them: every field read, rows
// the app cannot show skipped, the little formatting a policy's text has
// (paragraphs, bullets, headings) read and drawn, and the service that fetches
// them reading an old server's 404 as "none of its own".
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/policies/data/policies_api_service.dart';
import 'package:mobile_app/features/policies/data/policies_models.dart';
import 'package:mobile_app/features/policies/presentation/policy_body_view.dart';

final _session = AuthSession(
  token: 'session-token',
  user: const AuthUser(
    id: 'u-2',
    email: 'tanvi@getsowaka.com',
    name: 'Tanvi Shah',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
  ),
);

Map<String, dynamic> _row(Map<String, dynamic> overrides) => {
  'key': 'leave',
  'title': 'Leave',
  'body': 'Twelve days a year.',
  ...overrides,
};

void main() {
  group('the list', () {
    test('a row reads every field', () {
      final policies = parsePolicyDocuments({
        'success': true,
        'policies': [
          {
            'key': 'leave',
            'title': 'Leave',
            'summary': 'Types, balances and how to apply',
            'body': 'Casual Leave — 12 days a year.',
            'order': 10,
            'updatedAt': '2026-10-10T09:30:00.000Z',
          },
        ],
      });
      final policy = policies.single;
      expect(policy.key, 'leave');
      expect(policy.title, 'Leave');
      expect(policy.summary, 'Types, balances and how to apply');
      expect(policy.body, 'Casual Leave — 12 days a year.');
      expect(policy.order, 10);
      expect(policy.updatedAt, DateTime.utc(2026, 10, 10, 9, 30).toLocal());
    });

    test('rows the app cannot show are skipped, the rest kept in order', () {
      final policies = parsePolicyDocuments({
        'policies': [
          _row({'key': 'overtime', 'title': 'Overtime'}),
          _row({'key': ''}),
          _row({'key': 'no-title', 'title': '  '}),
          _row({'key': 'no-body', 'body': '\n \n'}),
          'not a row',
          _row({'key': 'leave', 'order': 'soon', 'updatedAt': 'never'}),
        ],
      });
      expect(policies.map((p) => p.key), ['overtime', 'leave']);
      expect(policies.last.order, 0);
      expect(policies.last.updatedAt, isNull);
      expect(policies.last.summary, '');
      expect(parsePolicyDocuments({'policies': 'nope'}), isEmpty);
      expect(parsePolicyDocuments({}), isEmpty);
    });

    test('a kept copy reads back as it was written', () {
      final policy = PolicyDocument.tryParse(
        _row({
          'summary': 'Short',
          'order': 20,
          'updatedAt': '2026-10-10T09:30:00.000Z',
        }),
      )!;
      final again = PolicyDocument.tryParse(
        jsonDecode(jsonEncode(policy.toJson())),
      )!;
      expect(again.key, policy.key);
      expect(again.summary, 'Short');
      expect(again.order, 20);
      expect(again.updatedAt, policy.updatedAt);
    });

    test('a title reads as "<title> policy" unless it says so already', () {
      expect(policyHeading('Leave'), 'Leave policy');
      expect(policyHeading('Code of Conduct'), 'Code of Conduct policy');
      expect(policyHeading('Travel Policy'), 'Travel Policy');
      expect(policyHeading('HR policies'), 'HR policies');
      expect(policyUpdatedLabel(DateTime(2026, 10, 9)), 'Updated 9 Oct 2026');
    });
  });

  group('the text', () {
    test('a blank line ends a card, and a card keeps its line breaks', () {
      expect(parsePolicyBody('One.\nStill one.\n\n\nTwo.'), [
        const PolicyCard([PolicyLine('One.'), PolicyLine('Still one.')]),
        const PolicyCard([PolicyLine('Two.')]),
      ]);
    });

    test('"- " lines are bullets and "## " lines are headings', () {
      const body =
          '## Who can claim\n'
          'Everyone on the payroll.\n'
          '\n'
          '## Limits\n'
          'Per claim:\n'
          '- Travel: ₹25,000\n'
          '  - Meals: ₹2,000\n'
          'Ask HR for more.';
      expect(parsePolicyBody(body), [
        const PolicyHeading('Who can claim'),
        const PolicyCard([PolicyLine('Everyone on the payroll.')]),
        const PolicyHeading('Limits'),
        const PolicyCard([
          PolicyLine('Per claim:'),
          PolicyLine('Travel: ₹25,000', bullet: true),
          PolicyLine('Meals: ₹2,000', bullet: true),
          PolicyLine('Ask HR for more.'),
        ]),
      ]);
    });

    test('a heading inside a paragraph splits it', () {
      expect(parsePolicyBody('Before.\n## Middle\nAfter.'), [
        const PolicyCard([PolicyLine('Before.')]),
        const PolicyHeading('Middle'),
        const PolicyCard([PolicyLine('After.')]),
      ]);
    });

    test('nothing else is formatting, and nothing is markup', () {
      expect(parsePolicyBody('### Not a heading\n-not a bullet\n<b>bold</b>'), [
        const PolicyCard([
          PolicyLine('### Not a heading'),
          PolicyLine('-not a bullet'),
          PolicyLine('<b>bold</b>'),
        ]),
      ]);
    });

    test(
      'Windows line endings, and empty headings and bullets, are dropped',
      () {
        expect(parsePolicyBody('\r\n##\r\n- \r\nOne.\r\n\r\nTwo.\r\n'), [
          const PolicyCard([PolicyLine('One.')]),
          const PolicyCard([PolicyLine('Two.')]),
        ]);
        expect(parsePolicyBody('  \n\n '), isEmpty);
      },
    );
  });

  group('the page', () {
    Future<void> pumpBody(WidgetTester tester, String body) =>
        tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(child: PolicyBodyView(body: body)),
            ),
          ),
        );

    testWidgets('draws headings, a card per paragraph and bullets', (
      tester,
    ) async {
      await pumpBody(
        tester,
        '## Limits\n'
        'Per claim:\n'
        '- Travel: ₹25,000\n'
        '- Meals: ₹2,000\n'
        '\n'
        'Line one.\nLine two.',
      );
      final heading = tester.widget<Text>(find.text('Limits'));
      expect(heading.style!.fontWeight, FontWeight.w800);
      expect(
        tester.getSemantics(find.text('Limits')).flagsCollection.isHeader,
        isTrue,
      );
      expect(find.text('Per claim:'), findsOneWidget);
      expect(find.text('Travel: ₹25,000'), findsOneWidget);
      expect(find.text('Meals: ₹2,000'), findsOneWidget);
      expect(find.text('•'), findsNWidgets(2));
      // Lines of one paragraph stay one paragraph, with their break.
      expect(find.text('Line one.\nLine two.'), findsOneWidget);
      // Each paragraph is its own white card, as the built-in policies are.
      final cards = find.byWidgetPredicate(
        (widget) =>
            widget is Container &&
            widget.decoration is BoxDecoration &&
            (widget.decoration! as BoxDecoration).color == Colors.white,
      );
      expect(cards, findsNWidgets(2));
      // The heading sits above the first card, the bullets inside it.
      expect(
        tester.getTopLeft(find.text('Limits')).dy,
        lessThan(tester.getTopLeft(cards.first).dy),
      );
      expect(
        tester.getTopLeft(find.text('Travel: ₹25,000')).dy,
        greaterThan(tester.getTopLeft(find.text('Per claim:')).dy),
      );
    });

    testWidgets('markup shows as the text it is', (tester) async {
      await pumpBody(tester, '<script>alert(1)</script>\n- <b>bold</b>');
      expect(find.text('<script>alert(1)</script>'), findsOneWidget);
      expect(find.text('<b>bold</b>'), findsOneWidget);
    });
  });

  group('the service', () {
    late List<http.Request> requests;

    PoliciesApiService answering(http.Response Function() answer) {
      requests = [];
      return PoliciesApiService(
        session: _session,
        baseUrl: 'https://api.example.test',
        client: MockClient((request) async {
          requests.add(request);
          return answer();
        }),
      );
    }

    http.Response json(Object body, [int status = 200]) => http.Response.bytes(
      utf8.encode(jsonEncode(body)),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

    setUp(forgetPolicies);

    test(
      'reads the company\'s policies with the session, and keeps them',
      () async {
        final service = answering(
          () => json({
            'success': true,
            'policies': [
              _row({'body': 'Capped at ₹1,500 per claim.'}),
            ],
          }),
        );
        expect(companyPoliciesFor('u-2'), isNull);
        final policies = await service.policies();
        expect(
          requests.single.url.toString(),
          'https://api.example.test/policies',
        );
        expect(
          requests.single.headers['Authorization'],
          'Bearer session-token',
        );
        expect(policies.single.body, 'Capped at ₹1,500 per claim.');
        // Kept for this person, and only for them.
        expect(companyPoliciesFor('u-2')!.single.key, 'leave');
        expect(companyPoliciesFor('someone-else'), isNull);
        expect((await service.policiesFromCache())!.single.key, 'leave');
        expect(requests, hasLength(1));
        forgetPolicies();
        expect(companyPoliciesFor('u-2'), isNull);
      },
    );

    test(
      'an older server without policies (404) means none of its own',
      () async {
        final service = answering(
          () => json({
            'success': false,
            'message': 'Route not found: GET /policies',
          }, 404),
        );
        expect(await service.policies(), isEmpty);
        expect(companyPoliciesFor('u-2'), isEmpty);
      },
    );

    test('a server error is an error, and leaves what was held', () async {
      var fail = false;
      final service = answering(
        () => fail
            ? json({'success': false, 'message': 'Internal server error'}, 500)
            : json({
                'success': true,
                'policies': [_row({})],
              }),
      );
      await service.policies();
      fail = true;
      await expectLater(
        service.policies(),
        throwsA(
          isA<PoliciesApiException>().having(
            (e) => e.statusCode,
            'statusCode',
            500,
          ),
        ),
      );
      expect(companyPoliciesFor('u-2')!.single.key, 'leave');
    });

    test('an answer without a list is an error, not "none"', () async {
      final service = answering(
        () => http.Response('<html>proxy error</html>', 200),
      );
      await expectLater(
        service.policies(),
        throwsA(isA<PoliciesApiException>()),
      );
      expect(companyPoliciesFor('u-2'), isNull);
    });
  });
}
