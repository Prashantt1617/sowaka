// Actions › View Policies against a fake server. A company with policies of
// its own sees those, in its own words; one without (or an older server that
// answers 404) sees exactly what the app has always shown: the built-in list,
// with the leave, attendance and overtime texts written from its shift rules.
// The Leave screen's "leave policy" link opens the company's leave policy when
// there is one, and the list is kept, so it shows at once and refreshes behind.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/policies/data/policies_api_service.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'yash',
    email: 'yash@example.test',
    name: 'Yash',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
  ),
);

/// A Default-shift employee's rules, as `/manager/workspace` sends them.
const _shift = {
  'name': 'Default',
  'startTime': '09:30',
  'endTime': '18:30',
  'minHalfDayHours': 4,
  'minFullDayHours': 8,
  'lateMarkingEnabled': true,
  'lateGraceMinutes': 15,
  'earlyMarkingEnabled': true,
  'earlyOutGraceMinutes': 15,
  'weeklyOff': {
    '1': [6],
    '2': [5, 6],
    '3': [6],
    '4': [5, 6],
    '5': [6],
  },
  'overtimeBackdateDays': 21,
  'leaveTypes': [
    {
      'key': 'casual',
      'name': 'Casual Leave',
      'advanceDays': 30,
      'allowBackdated': true,
      'backdatedDays': 30,
    },
    {
      'key': 'earned',
      'name': 'Earned Leave',
      'advanceDays': 90,
      'allowBackdated': true,
      'backdatedDays': 30,
    },
    {
      'key': 'comp_off',
      'name': 'Comp-off',
      'advanceDays': 30,
      'allowBackdated': false,
      'backdatedDays': 0,
    },
  ],
  'leaveBalanceTracked': true,
  'correction': {
    'triggers': [
      'Missing punch-in',
      'Missing punch-out',
      'Both punches missing',
    ],
    'backdateDays': 15,
    'punchFormat': 'Biometric',
    'punchMode': 'Both punches',
  },
};

http.Response _json(Object body, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

/// The fake server behind the dashboard. Without [balances] nobody has a
/// leave balance, so the Leave screen draws no balance cards (whose fixed
/// height the test font overflows).
MockClient _managerClient({bool balances = true}) =>
    MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/manager/workspace')) {
        return _json({
          'success': true,
          'team': <dynamic>[],
          'recognitionCandidates': <dynamic>[],
          'nominations': <dynamic>[],
          'recognitionHistory': <dynamic>[],
          'myParameters': <dynamic>[],
          'growthHistory': <dynamic>[],
          'holidays': <dynamic>[],
          'myOrgChart': <dynamic>[],
          'weekoffDays': [6],
          'shift': _shift,
          'overtimeEnabled': true,
          'hasManager': true,
          'teamLevel': 1,
          'managerScore': 0,
        });
      }
      if (path.endsWith('/leaves/balance')) {
        if (!balances) {
          return _json({'success': true, 'balance': <String, dynamic>{}});
        }
        return _json({
          'success': true,
          'balance': {
            'year': 2026,
            'types': [
              {
                'key': 'casual',
                'name': 'Casual Leave',
                'total': 12,
                'used': 2,
                'remaining': 10,
              },
              {
                'key': 'earned',
                'name': 'Earned Leave',
                'total': 18,
                'used': 0,
                'remaining': 18,
              },
              {
                'key': 'comp_off',
                'name': 'Comp-off',
                'total': 0,
                'used': 0,
                'remaining': 0,
              },
            ],
          },
        });
      }
      return _json({
        'success': true,
        'leaves': <dynamic>[],
        'overtime': <dynamic>[],
        'regularizations': <dynamic>[],
        'claims': <dynamic>[],
        'types': <dynamic>[],
        'records': <dynamic>[],
        'balance': <String, dynamic>{},
      });
    });

/// What the built-in Leave policy says for this employee — the text the app
/// has always written from their rules and balance.
const _builtInLeave = [
  'Casual Leave — 12 days a year, 10 left.\n'
      'Can be applied up to 30 days ahead, or up to 30 days after the fact.',
  'Earned Leave — 18 days a year, 18 left.\n'
      'Can be applied up to 90 days ahead, or up to 30 days after the fact.',
  'Comp-off — 0 days a year, 0 left.\n'
      'Can be applied up to 30 days ahead, and not for a day already past.',
  'Week-offs and company holidays inside a leave range are not counted '
      'against your balance.',
];

const _builtInAttendance = [
  'Your shift runs 09:30–18:30 (Default).',
  'A day counts as a full day at 8 hours and as a half day at 4.',
  'You are marked late after 15 minutes past the start, and as an early-out '
      'if you leave more than 15 minutes before the end.',
  'Week-offs: Saturday, Sunday.',
  'Punches are captured by Biometric.',
  'A correction can be raised for: missing punch-in, missing punch-out, both '
      'punches missing — up to 15 days back.',
  'Week-offs and company holidays are not up for correction; claim overtime '
      'if you worked one.',
];

const _builtInList = [
  'Leave policy',
  'Attendance policy',
  'Payroll policy',
  'POSH policy',
  'Overtime policy',
];

Map<String, dynamic> _policy(
  String key,
  String title,
  String body, {
  String summary = '',
}) => {
  'key': key,
  'title': title,
  'summary': summary,
  'body': body,
  'order': 10,
  'updatedAt': '2026-10-10T09:30:00.000Z',
};

final _companyPolicies = {
  'success': true,
  'policies': [
    _policy(
      'leave',
      'Leave',
      '## Leave types\n'
          'Casual Leave — 12 days a year.\n'
          '- Can be applied up to 30 days ahead.\n'
          '\n'
          'Week-offs inside a leave range are not counted.',
      summary: 'Types, balances and how to apply',
    ),
    _policy('code-of-conduct', 'Code of Conduct', 'Be kind.'),
  ],
};

void main() {
  late List<http.Request> policyRequests;
  late http.Response Function() answer;

  /// When set, the server holds its answer until this completes.
  Completer<void>? hold;

  PoliciesApiService policiesService() {
    return PoliciesApiService(
      session: _session,
      baseUrl: 'https://example.test',
      client: MockClient((request) async {
        policyRequests.add(request);
        await hold?.future;
        return answer();
      }),
    );
  }

  setUp(() {
    forgetPolicies();
    policyRequests = [];
    hold = null;
  });

  /// The Actions tab for [_session], its dashboard loaded from the fake server.
  Future<QuickActionsController> pumpActions(
    WidgetTester tester, {
    bool balances = true,
  }) async {
    tester.view.physicalSize = const Size(430, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final bloc = ManagerBloc(
      session: _session,
      service: ManagerApiService(
        session: _session,
        baseUrl: 'https://example.test',
        client: _managerClient(balances: balances),
      ),
    );
    await tester.runAsync(() => bloc.add(const LoadManagerDashboard()));
    final controller = QuickActionsController();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: QuickActionsScreen(
            bloc: bloc,
            dashboard: bloc.state.dashboard!,
            controller: controller,
            profileAction: const SizedBox(width: 30, height: 30),
            onNotifications: () {},
            onOpenComposer: () {},
            policies: policiesService(),
          ),
        ),
      ),
    );
    await tester.pump();
    addTearDown(() async {
      bloc.dispose();
      controller.dispose();
    });
    return controller;
  }

  Future<void> openPolicies(WidgetTester tester) async {
    await tester.tap(find.text('View Policies'));
    await tester.pumpAndSettle();
  }

  Future<void> back(
    WidgetTester tester,
    QuickActionsController controller,
  ) async {
    controller.handleBack();
    await tester.pumpAndSettle();
  }

  /// Taps "leave policy" on the Leave screen.
  Future<void> tapLeavePolicyLink(WidgetTester tester) async {
    final rich = tester.widget<RichText>(
      find.byWidgetPredicate(
        (widget) =>
            widget is RichText &&
            widget.text.toPlainText().startsWith('Read detailed leave policy'),
      ),
    );
    var tapped = false;
    rich.text.visitChildren((span) {
      if (span is TextSpan && span.recognizer is TapGestureRecognizer) {
        (span.recognizer! as TapGestureRecognizer).onTap!();
        tapped = true;
        return false;
      }
      return true;
    });
    expect(tapped, isTrue);
    await tester.pumpAndSettle();
  }

  void expectBuiltInList() {
    for (final title in _builtInList) {
      expect(find.text(title), findsOneWidget, reason: title);
    }
  }

  Future<void> expectBuiltInTexts(
    WidgetTester tester,
    QuickActionsController controller,
  ) async {
    await tester.tap(find.text('Leave policy'));
    await tester.pumpAndSettle();
    expect(find.text('As your company has it set up today.'), findsOneWidget);
    for (final paragraph in _builtInLeave) {
      expect(find.text(paragraph), findsOneWidget, reason: paragraph);
    }
    await back(tester, controller);
    await tester.tap(find.text('Attendance policy'));
    await tester.pumpAndSettle();
    for (final paragraph in _builtInAttendance) {
      expect(find.text(paragraph), findsOneWidget, reason: paragraph);
    }
    await back(tester, controller);
    await tester.tap(find.text('Overtime policy'));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'A full day is 8 hours and credits 1 day of comp-off. A half day is '
        '4 hours and credits 0.5.',
      ),
      findsOneWidget,
    );
    expect(find.text('Claims reach back up to 21 days.'), findsOneWidget);
    await back(tester, controller);
    // The built-in POSH policy keeps its own words.
    await tester.tap(find.text('POSH policy'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('zero tolerance for harassment'),
      findsOneWidget,
    );
    await back(tester, controller);
  }

  testWidgets(
    'a company with none of its own sees the built-in policies, as before',
    (tester) async {
      answer = () => _json({'success': true, 'policies': <dynamic>[]});
      final controller = await pumpActions(tester);
      await openPolicies(tester);

      expect(
        policyRequests.single.url.toString(),
        'https://example.test/policies',
      );
      expect(policyRequests.single.headers['Authorization'], 'Bearer token');
      expectBuiltInList();
      await expectBuiltInTexts(tester, controller);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('an older server (404) leaves the built-in policies too', (
    tester,
  ) async {
    answer = () => _json({'success': false, 'message': 'Route not found'}, 404);
    final controller = await pumpActions(tester);
    await openPolicies(tester);
    expectBuiltInList();
    await expectBuiltInTexts(tester, controller);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('offline with nothing kept, the built-in policies', (
    tester,
  ) async {
    answer = () => throw http.ClientException('offline');
    await pumpActions(tester);
    await openPolicies(tester);
    expectBuiltInList();
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('a company with its own policies sees those, in its own words', (
    tester,
  ) async {
    answer = () => _json(_companyPolicies);
    final controller = await pumpActions(tester);
    await openPolicies(tester);

    expect(find.text('Leave policy'), findsOneWidget);
    expect(find.text('Types, balances and how to apply'), findsOneWidget);
    expect(find.text('Code of Conduct policy'), findsOneWidget);
    // Only the company's: none of the built-in ones.
    for (final title in [
      'Attendance policy',
      'Payroll policy',
      'POSH policy',
      'Overtime policy',
    ]) {
      expect(find.text(title), findsNothing, reason: title);
    }
    expect(
      tester.getTopLeft(find.text('Leave policy')).dy,
      lessThan(tester.getTopLeft(find.text('Code of Conduct policy')).dy),
    );

    await tester.tap(find.text('Leave policy'));
    await tester.pumpAndSettle();
    expect(find.text('Leave'), findsWidgets);
    expect(find.text('Updated 10 Oct 2026'), findsOneWidget);
    expect(find.text('Leave types'), findsOneWidget);
    expect(find.text('Casual Leave — 12 days a year.'), findsOneWidget);
    expect(find.text('Can be applied up to 30 days ahead.'), findsOneWidget);
    expect(find.text('•'), findsOneWidget);
    expect(
      find.text('Week-offs inside a leave range are not counted.'),
      findsOneWidget,
    );
    // Not the text the app would have written.
    expect(find.text('As your company has it set up today.'), findsNothing);
    expect(find.textContaining('10 left'), findsNothing);

    await back(tester, controller);
    expect(find.text('Code of Conduct policy'), findsOneWidget);
    await tester.tap(find.text('Code of Conduct policy'));
    await tester.pumpAndSettle();
    expect(find.text('Be kind.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'the first opening waits for the answer instead of flashing the built-in list',
    (tester) async {
      answer = () => _json(_companyPolicies);
      hold = Completer<void>();
      await pumpActions(tester);
      await tester.tap(find.text('View Policies'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.byKey(const ValueKey('policies-loading')), findsOneWidget);
      expect(find.text('POSH policy'), findsNothing);
      hold!.complete();
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('policies-loading')), findsNothing);
      expect(find.text('Code of Conduct policy'), findsOneWidget);
      expect(find.text('POSH policy'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    '"leave policy" on the Leave screen opens the company\'s leave policy',
    (tester) async {
      answer = () => _json(_companyPolicies);
      final controller = await pumpActions(tester, balances: false);
      controller.openLeave();
      await tester.pumpAndSettle();
      // Opening the Leave screen is enough to learn whether there is one.
      expect(policyRequests, hasLength(1));

      await tapLeavePolicyLink(tester);
      expect(find.text('Leave types'), findsOneWidget);
      expect(find.text('Casual Leave — 12 days a year.'), findsOneWidget);
      // Back where the link was.
      await back(tester, controller);
      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget is RichText &&
              widget.text.toPlainText().startsWith(
                'Read detailed leave policy',
              ),
        ),
        findsOneWidget,
      );
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'with no leave policy of its own, the link opens the list as before',
    (tester) async {
      answer = () => _json({'success': true, 'policies': <dynamic>[]});
      final controller = await pumpActions(tester, balances: false);
      controller.openLeave();
      await tester.pumpAndSettle();
      await tapLeavePolicyLink(tester);
      expectBuiltInList();

      // A company with policies but none keyed 'leave': its list.
      answer = () => _json({
        'success': true,
        'policies': [_policy('code-of-conduct', 'Code of Conduct', 'Be kind.')],
      });
      await back(tester, controller);
      controller.openLeave();
      await tester.pumpAndSettle();
      await tapLeavePolicyLink(tester);
      expect(find.text('Code of Conduct policy'), findsOneWidget);
      expect(find.text('POSH policy'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'the list is kept: shown at once offline, and refreshed on open',
    (tester) async {
      answer = () => _json(_companyPolicies);
      var controller = await pumpActions(tester);
      await openPolicies(tester);
      expect(find.text('Code of Conduct policy'), findsOneWidget);
      await back(tester, controller);

      // The server is unreachable: what was read stays.
      answer = () => throw http.ClientException('offline');
      await openPolicies(tester);
      expect(find.text('Code of Conduct policy'), findsOneWidget);
      expect(find.text('POSH policy'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());

      // A fresh Actions tab, still offline, draws the kept copy at once.
      controller = await pumpActions(tester);
      await openPolicies(tester);
      expect(find.text('Code of Conduct policy'), findsOneWidget);
      expect(find.text('Leave policy'), findsOneWidget);
      await back(tester, controller);

      // Back online with an edit: the next opening shows it.
      answer = () => _json({
        'success': true,
        'policies': [
          _policy('code-of-conduct', 'Code of Conduct', 'Be kinder.'),
        ],
      });
      final before = policyRequests.length;
      await openPolicies(tester);
      expect(policyRequests.length, before + 1);
      expect(find.text('Leave policy'), findsNothing);
      await tester.tap(find.text('Code of Conduct policy'));
      await tester.pumpAndSettle();
      expect(find.text('Be kinder.'), findsOneWidget);

      // And if the company's policies are all taken away, back to the built-in.
      await back(tester, controller);
      await back(tester, controller);
      answer = () => _json({'success': true, 'policies': <dynamic>[]});
      await openPolicies(tester);
      expectBuiltInList();
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
