import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/confirmation_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/onboarding_launcher.dart' show onboardingDestinations;
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/confirmation_screens.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_kit.dart';

/// The probation decision on the team side, all a manager or head of
/// department does for a joiner in the app since 24 Nov (HR assigns the rest
/// on the dashboard): the Actions card's data on `/lifecycle/me`, the
/// manager's confirmation review and the head of department's approval, each
/// its own screen, against the shapes backend/src/services/lifecycle/teamApp.ts
/// writes.
///
/// `flutter test --dart-define=SCREENSHOTS=<dir> test/lifecycle_confirmation_test.dart`
/// also writes both screens at 360 and 412 wide (and at text scale 1.3) to `<dir>`.

const _screenshots = String.fromEnvironment('SCREENSHOTS');

class _NoOnboardingApi implements OnboardingApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

OnboardingShell _shell() => OnboardingShell(
  api: _NoOnboardingApi(),
  profileAction: const SizedBox(width: 30, height: 30),
  onNotifications: () {},
  viewerName: 'Meera Joshi',
  now: () => DateTime(2026, 11, 30, 10),
);

final _joiner = {'journeyId': 'j2', 'userId': 'u-sana', 'name': 'Sana Khan', 'first': 'Sana', 'initials': 'SK', 'designation': 'Support executive', 'department': 'Operations'};
final _facts = [
  {'label': 'Monthly goals', 'value': 'Met in 2 of 3 months'},
  {'label': 'Check-ins', 'value': 'Week 1 and Month 1 sent'},
  {'label': 'Attendance', 'value': 'On time on 94% of days'},
  {'label': 'Leave taken', 'value': '2 days'},
];

class _FakeApi implements ConfirmationApi {
  Map<String, dynamic> reviewJson = {'joiner': _joiner, 'facts': _facts, 'approverName': 'Anita Desai'};
  Map<String, dynamic> approvalJson = {
    'joiner': _joiner,
    'state': 'ready',
    'recommendation': {'byName': 'Meera Joshi', 'outcome': 'confirm', 'kpis': 'Met most of them', 'strengths': 'Calm with customers', 'next': 'Weekly reports', 'at': '2026-11-29T10:00:00.000Z'},
    'facts': _facts.take(3).toList(),
  };
  final sent = <Map<String, Object?>>[];

  @override
  Future<ConfirmationReview> review(String journeyId) async => ConfirmationReview.fromJson(reviewJson);

  @override
  Future<ConfirmationReview> sendReview(String journeyId, {required String outcome, int? extendMonths, required String kpis, required String strengths, required String next}) async {
    sent.add({'journeyId': journeyId, 'outcome': outcome, 'extendMonths': extendMonths, 'kpis': kpis, 'strengths': strengths, 'next': next});
    reviewJson = {...reviewJson, 'sent': {'outcome': outcome, 'extendMonths': ?extendMonths, 'kpis': kpis, 'strengths': strengths, 'next': next, 'at': '2026-11-30T10:00:00.000Z'}};
    return ConfirmationReview.fromJson(reviewJson);
  }

  @override
  Future<ConfirmationApproval> approval(String journeyId) async => ConfirmationApproval.fromJson(approvalJson);

  @override
  Future<ConfirmationApproval> answerApproval(String journeyId, String action, {int? extendMonths, String? comment}) async {
    sent.add({'journeyId': journeyId, 'action': action, 'extendMonths': extendMonths, 'comment': comment});
    approvalJson = {...approvalJson, 'state': action == 'approve' ? 'approved' : 'extended', 'answer': {'outcome': action == 'approve' ? 'approved' : 'extended', 'comment': ?comment}};
    return ConfirmationApproval.fromJson(approvalJson);
  }
}

Future<void> _pump(WidgetTester tester, Widget screen, {double width = 393, double scale = 1}) async {
  tester.view.physicalSize = Size(width * 3, 852 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
      home: MediaQuery.withClampedTextScaling(minScaleFactor: scale, maxScaleFactor: scale, child: screen),
    ),
  );
  await tester.pumpAndSettle();
}

/// Scrolls the screen's list until [finder] is built and on screen.
Future<void> _reveal(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 200, scrollable: find.byType(Scrollable).first);
  await tester.pump();
}

Future<void> _capture(WidgetTester tester, String name) async {
  if (_screenshots.isEmpty) return;
  await expectLater(find.byType(MaterialApp), matchesGoldenFile(Uri.file('$_screenshots/$name.png')));
}

void main() {
  setUpAll(() async {
    for (final (family, file) in [
      ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
      ('Plus Jakarta Sans', 'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf'),
    ]) {
      await (FontLoader(family)..addFont(rootBundle.load(file))).load();
    }
  });

  group('what waits on me (/lifecycle/me)', () {
    test('confirmations: the review and the approval, each with its title; none is an empty list', () {
      final me = LifecycleMe.fromJson({
        'enabled': true,
        'confirmations': [
          {'journeyId': 'j2', 'kind': 'review', 'name': 'Sana Khan', 'title': 'Confirmation review for Sana'},
          {'journeyId': 'j3', 'kind': 'approval', 'name': 'Dev Arora', 'title': 'Approve Dev’s confirmation'},
          {'kind': 'review', 'name': 'No journey'},
        ],
      });
      expect(me.confirmations.map((c) => [c.journeyId, c.kind, c.title]), [
        ['j2', ConfirmationKind.review, 'Confirmation review for Sana'],
        ['j3', ConfirmationKind.approval, 'Approve Dev’s confirmation'],
      ]);
      expect(LifecycleMe.fromJson({'enabled': true}).confirmations, isEmpty);
      expect(me.withProgress(null).confirmations.length, 2);
    });

    test('the pushes: the review and the approval open their screens; the old team page is gone', () {
      expect(onboardingDestinations, containsAll(['lifecycle_confirmation_review', 'lifecycle_confirmation_approval']));
      for (final gone in ['lifecycle_joiner', 'lifecycle_joiner_setup', 'lifecycle_starter_task_done', 'lifecycle_probation_review']) {
        expect(onboardingDestinations, isNot(contains(gone)));
      }
    });
  });

  group('the manager’s confirmation review', () {
    testWidgets('the joiner, their probation, the recommendation and three answers; Send to the approver', (tester) async {
      final api = _FakeApi();
      await _pump(tester, ConfirmationReviewScreen(shell: _shell(), api: api, journeyId: 'j2'));
      expect(find.text('Sana’s confirmation review'), findsOneWidget);
      expect(find.text('Support executive · Operations'), findsOneWidget);
      expect(find.text('THEIR PROBATION'), findsOneWidget);
      expect(find.text('On time on 94% of days'), findsOneWidget);
      await _reveal(tester, find.text('Send to Anita'));
      expect(find.text('Send to Anita'), findsOneWidget);

      // All three answers are needed.
      await tester.tap(find.text('Send to Anita'));
      await tester.pump();
      expect(find.text('How they did against their KPIs and goals is needed'), findsOneWidget);
      expect(api.sent, isEmpty);

      await _reveal(tester, find.byKey(const ValueKey('confirmation-seg-extend')));
      await tester.tap(find.byKey(const ValueKey('confirmation-seg-extend')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('confirmation-choice-2 months')));
      for (final (i, text) in ['Met most of them', 'Calm with customers', 'Weekly reports'].indexed) {
        await _reveal(tester, find.byKey(ValueKey('confirmation-field-$i')));
        await tester.enterText(find.byKey(ValueKey('confirmation-field-$i')), text);
      }
      await _reveal(tester, find.text('Send to Anita'));
      await tester.tap(find.text('Send to Anita'));
      await tester.pumpAndSettle();
      expect(api.sent.single, {'journeyId': 'j2', 'outcome': 'extend', 'extendMonths': 2, 'kpis': 'Met most of them', 'strengths': 'Calm with customers', 'next': 'Weekly reports'});
      expect(find.text('Sent to Anita to approve'), findsOneWidget);
      // Sent: what went, read only, no form.
      expect(find.text('You recommended: Extend by 2 months'), findsOneWidget);
      expect(find.text('Waiting for Anita Desai to approve.'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
      expect(find.text('Sent'), findsOneWidget);
    });

    for (final (width, scale) in [(360.0, 1.0), (412.0, 1.0), (360.0, 1.3)]) {
      testWidgets('lays out at $width wide, text scale $scale', (tester) async {
        final api = _FakeApi()..reviewJson = {'joiner': {..._joiner, 'name': 'Venkatanarasimharajuvaripeta Subrahmanyam', 'first': 'Venkatanarasimharajuvaripeta'}, 'facts': _facts, 'approverName': 'Anita Desai'};
        await _pump(tester, ConfirmationReviewScreen(shell: _shell(), api: api, journeyId: 'j2'), width: width, scale: scale);
        expect(tester.takeException(), isNull);
        await _capture(tester, 'confirmation-review-${width.toInt()}${scale == 1 ? '' : '-text130'}');
      });
    }

    testWidgets('a failed read says so and tries again', (tester) async {
      await _pump(tester, ConfirmationReviewScreen(shell: _shell(), api: _FailingApi(), journeyId: 'j2'));
      expect(find.text('Try again'), findsOneWidget);
    });
  });

  group('the head of department’s approval', () {
    testWidgets('the recommendation, the answers and the facts; Approve', (tester) async {
      final api = _FakeApi();
      await _pump(tester, ConfirmationApprovalScreen(shell: _shell(), api: api, journeyId: 'j2'));
      expect(find.text('Sana’s confirmation'), findsOneWidget);
      expect(find.text('Recommended yesterday by Meera'), findsOneWidget);
      expect(find.text('Meera Joshi recommends: Confirm'), findsOneWidget);
      expect(find.text('Calm with customers'), findsOneWidget);
      expect(find.text('To approve'), findsOneWidget);
      await _reveal(tester, find.text('Approve'));
      await tester.tap(find.text('Approve'));
      await tester.pumpAndSettle();
      expect(api.sent.single['action'], 'approve');
      expect(find.text('Confirmation approved'), findsOneWidget);
      expect(find.text('Approved'), findsOneWidget);
      expect(find.text('Approve'), findsNothing);
    });

    testWidgets('Extend: pick the months, then Extend by', (tester) async {
      final api = _FakeApi();
      await _pump(tester, ConfirmationApprovalScreen(shell: _shell(), api: api, journeyId: 'j2'));
      await _reveal(tester, find.text('Extend'));
      await tester.tap(find.text('Extend'));
      await tester.pump();
      await _reveal(tester, find.byKey(const ValueKey('confirmation-choice-1 month')));
      await tester.tap(find.byKey(const ValueKey('confirmation-choice-1 month')));
      await tester.pump();
      await _reveal(tester, find.text('Extend by 1 month'));
      await tester.tap(find.text('Extend by 1 month'));
      await tester.pumpAndSettle();
      expect([api.sent.single['action'], api.sent.single['extendMonths']], ['extend', 1]);
      expect(find.text('Extended'), findsOneWidget);
    });

    testWidgets('waiting for the manager: says so, nothing to answer', (tester) async {
      final api = _FakeApi()..approvalJson = {'joiner': _joiner, 'state': 'waiting', 'facts': <dynamic>[]};
      await _pump(tester, ConfirmationApprovalScreen(shell: _shell(), api: api, journeyId: 'j2'));
      expect(find.text('Waiting for the manager’s review'), findsOneWidget);
      expect(find.text('Approve'), findsNothing);
    });

    for (final (width, scale) in [(360.0, 1.0), (412.0, 1.0), (360.0, 1.3)]) {
      testWidgets('lays out at $width wide, text scale $scale', (tester) async {
        await _pump(tester, ConfirmationApprovalScreen(shell: _shell(), api: _FakeApi(), journeyId: 'j2'), width: width, scale: scale);
        expect(tester.takeException(), isNull);
        await _capture(tester, 'confirmation-approval-${width.toInt()}${scale == 1 ? '' : '-text130'}');
      });
    }
  });

  test('HTTP: the review and the approval at /lifecycle/team/joiners/:id/{review,confirmation}', () async {
    final asked = <String>[];
    final client = MockClient((request) async {
      asked.add('${request.method} ${request.url.path} ${request.body}');
      final review = request.url.path.endsWith('/review');
      return http.Response(
        jsonEncode(review ? {'joiner': _joiner, 'facts': _facts} : {'joiner': _joiner, 'state': 'approved', 'facts': <dynamic>[]}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final api = HttpConfirmationApi(
      session: AuthSession(token: 'tok', user: AuthUser.fromJson({'userId': 'meera', 'name': 'Meera Joshi', 'email': 'm@sowaka.test', 'role': 'manager', 'org': 'sowaka'})),
      baseUrl: 'https://api.test',
      client: client,
    );
    expect((await api.review('j2')).joiner.first, 'Sana');
    await api.sendReview('j2', outcome: 'confirm', kpis: 'a', strengths: 'b', next: 'c');
    expect((await api.answerApproval('j2', 'approve', comment: ' Agreed ')).state, 'approved');
    expect(asked, [
      'GET /lifecycle/team/joiners/j2/review ',
      'POST /lifecycle/team/joiners/j2/review {"outcome":"confirm","kpis":"a","strengths":"b","next":"c"}',
      'POST /lifecycle/team/joiners/j2/confirmation {"action":"approve","comment":"Agreed"}',
    ]);
  });
}

class _FailingApi extends _FakeApi {
  @override
  Future<ConfirmationReview> review(String journeyId) async => throw const OnboardingApiException(OnboardingApiException.offline);
}
