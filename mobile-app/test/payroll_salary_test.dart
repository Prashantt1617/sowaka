// The salary summary page (Payroll › "October salary", Figma R 2) against a
// small fake server of its own: the estimate with its note, the released
// payslip with no pill, rows opening to their explanations one at a time,
// "Check unpaid days" handing over to the unpaid-days list, and the Past
// payslips row opening the payslips list. Every figure is invented; the org
// is sowaka. A layout that overflows fails the test.
//
// `flutter test --update-goldens --dart-define=SCREENSHOTS=<dir> test/payroll_salary_test.dart`
// also writes each state to <dir> as a 390×844 PNG.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/payroll/data/payroll_api_service.dart';
import 'package:mobile_app/features/payroll/data/payroll_models.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';

const _screenshots = String.fromEnvironment('SCREENSHOTS');

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'tanvi',
    email: 'tanvi@example.test',
    name: 'Tanvi',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
  ),
);

http.Response _json(Object body, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

/// GET /payroll/me/salary and /payslips/mine, answered from memory.
class _FakeSalaryServer {
  /// The payslip is out: final figures, no Estimate pill.
  bool released = false;

  /// The pay can't be worked out yet: notSetUp, no figures.
  bool notSetUp = false;

  /// The first call answers 500, once.
  bool failOnce = false;

  /// No payslip released yet: /payslips/mine is empty.
  bool noPayslips = false;

  final calls = <String>[];

  static const lopInfo =
      '1 absent day + 2 half days. One day\'s pay is ₹4,000 (₹1,24,000 ÷ 31 '
      'days in October).';
  static const pfInfo =
      '12% of your PF wage of ₹15,000 (your PF wage is ₹62,000; PF is '
      'worked out on the ₹15,000 ceiling), saved in your PF account for '
      'retirement.';

  /// The current pay period's estimate (`?view=current`): November so far.
  Map<String, dynamic> _current() => {
    ..._salary(),
    'period': '2026-11',
    'label': 'November 2026',
    'view': 'current',
    'released': false,
    'payslipId': null,
    'periodFrom': '2026-11-01',
    'periodTo': '2026-11-30',
    'daysPaid': 30,
    'daysInPeriod': 30,
    'baseDays': 30,
    'grossPaise': 12400000,
    'takeHomePaise': 11640000,
    'lines': [
      {
        'key': 'gross',
        'label': 'Gross salary',
        'amountPaise': 12400000,
        'kind': 'earning',
        'explanation': 'Your fixed monthly pay before any deductions.',
      },
      {
        'key': 'epf',
        'label': 'Provident fund',
        'amountPaise': 180000,
        'kind': 'deduction',
        'explanation': pfInfo,
      },
      {
        'key': 'income_tax',
        'label': 'Income tax (TDS)',
        'amountPaise': 560000,
        'kind': 'deduction',
        'explanation': 'Your estimated tax.',
      },
      {
        'key': 'pt',
        'label': 'Professional tax',
        'amountPaise': 20000,
        'kind': 'deduction',
        'explanation': 'A tax set by Karnataka.',
      },
    ],
    'lop': {'days': 0, 'perDayPaise': 413333},
    'unpaidDays': {
      'period': '2026-11',
      'count': 1,
      'fixBy': '2026-11-20',
      'locked': false,
    },
    'notSetUp': null,
  };

  Map<String, dynamic> _salary() => {
    'period': '2026-10',
    'label': 'October 2026',
    'view': 'previous',
    'currentPeriod': '2026-11',
    'previousPeriod': '2026-10',
    'released': released,
    'payslipId': released ? 'slip-2026-10' : null,
    'periodFrom': '2026-10-01',
    'periodTo': '2026-10-31',
    'unpaidDays': {
      'period': '2026-10',
      'count': 3,
      'fixBy': '2026-11-14',
      'locked': released,
    },
    'payslips': {'count': 6, 'from': '2026-04', 'to': '2026-09'},
    if (notSetUp) ...{
      'daysPaid': null,
      'daysInPeriod': 31,
      'baseDays': 31,
      'grossPaise': null,
      'takeHomePaise': null,
      'lines': <dynamic>[],
      'lop': null,
      'notSetUp': {
        'reason': 'statutory_not_set_up',
        'message':
            'Your October 2026 pay can\'t be worked out yet: the statutory '
            'settings (PF, ESI, professional tax) for FY 2026-27 are not set '
            'up. Ask HR.',
      },
    } else ...{
      'daysPaid': 29,
      'daysInPeriod': 31,
      'baseDays': 31,
      'grossPaise': 12400000,
      'takeHomePaise': 10640000,
      'lines': [
        {
          'key': 'gross',
          'label': 'Gross salary',
          'amountPaise': 12400000,
          'kind': 'earning',
          'explanation':
              'Your fixed monthly pay before any deductions: Basic ₹62,000 + '
              'House Rent Allowance ₹24,800 + Fixed Allowance ₹37,200.',
        },
        {
          'key': 'lop',
          'label': 'Loss of pay · 2 days',
          'amountPaise': 800000,
          'kind': 'lop',
          'explanation': lopInfo,
        },
        {
          'key': 'epf',
          'label': 'Provident fund',
          'amountPaise': 180000,
          'kind': 'deduction',
          'explanation': pfInfo,
        },
        {
          'key': 'income_tax',
          'label': 'Income tax (TDS)',
          'amountPaise': 760000,
          'kind': 'deduction',
          'explanation':
              'For this estimate, what your September 2026 payslip took '
              '(₹7,600). Payroll works out October\'s from your tax for the '
              'year.',
        },
        {
          'key': 'pt',
          'label': 'Professional tax',
          'amountPaise': 20000,
          'kind': 'deduction',
          'explanation':
              'A tax set by Karnataka: ₹200 a month for monthly pay of '
              '₹25,000 or more.',
        },
      ],
      'lop': {
        'days': 2,
        'absentDays': 1,
        'halfDays': 2,
        'missedPunchDays': 0,
        'unpaidLeaveDays': 0,
        'perDayPaise': 400000,
        'enteredByHr': false,
      },
      'notSetUp': null,
    },
  };

  Map<String, dynamic> _payslips() => {
    'success': true,
    'company': {'name': 'Sowaka', 'address': 'Bengaluru', 'org': 'sowaka'},
    'payslips': [
      if (!noPayslips)
        {
          'run': {
            'id': 'run-2026-09',
            'period': '2026-09',
            'status': 'paid',
            'paidAt': '2026-09-30T12:00:00.000Z',
          },
          'payslip': {
            'id': 'slip-2026-09',
            'period': '2026-09',
            'employeeName': 'Tanvi',
            'earnings': [
              {
                'code': 'BASIC',
                'name': 'Basic',
                'fullPaise': 6200000,
                'paidPaise': 6200000,
              },
            ],
            'deductions': <dynamic>[],
            'netPayablePaise': 10640000,
            'reimbursementsPaise': 0,
            'inputs': {'workingDays': 30, 'payableDays': 30, 'lopDays': 0},
          },
        },
    ],
  };

  http.Client get client => MockClient((request) async {
    final query = request.url.query;
    calls.add(
      '${request.method} ${request.url.path}${query.isEmpty ? '' : '?$query'}',
    );
    if (failOnce) {
      failOnce = false;
      return _json({'success': false, 'message': 'Something broke'}, 500);
    }
    return switch (request.url.path) {
      '/payroll/me/salary' => _json({
        'success': true,
        'salary': request.url.queryParameters['view'] == 'current'
            ? _current()
            : _salary(),
      }),
      '/payslips/mine' => _json(_payslips()),
      _ => _json({'success': false, 'message': 'Route not found'}, 404),
    };
  });
}

void main() {
  setUpAll(() async {
    for (final (family, file) in [
      ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
      (
        'Plus Jakarta Sans',
        'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf',
      ),
    ]) {
      await (FontLoader(family)..addFont(rootBundle.load(file))).load();
    }
    if (_screenshots.isNotEmpty) {
      final icons = File(
        '/opt/homebrew/share/flutter/bin/cache/artifacts/material_fonts/'
        'MaterialIcons-Regular.otf',
      );
      if (icons.existsSync()) {
        await (FontLoader('MaterialIcons')..addFont(
              Future.value(ByteData.sublistView(icons.readAsBytesSync())),
            ))
            .load();
      }
    }
  });

  /// Lets replies, route transitions and asset images land.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 3; i++) {
      await tester.pump();
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 60)),
      );
    }
    await tester.pump(const Duration(milliseconds: 400));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 200)),
    );
    await tester.pump(const Duration(milliseconds: 100));
  }

  Future<void> capture(WidgetTester tester, String name) async {
    if (_screenshots.isEmpty) return;
    await expectLater(
      find.byType(PayrollSalarySummaryHost),
      matchesGoldenFile(Uri.file('$_screenshots/$name.png')),
    );
  }

  Future<_FakeSalaryServer> pumpSalary(
    WidgetTester tester, {
    _FakeSalaryServer? server,
    String? period,
    List<PayrollMissingPunches?>? fixed,
  }) async {
    tester.view.physicalSize = const Size(390 * 2, 844 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final fake = server ?? _FakeSalaryServer();
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
        home: Scaffold(
          body: PayrollSalarySummaryHost(
            period: period,
            screen: PayrollScreen(
              api: PayrollApiService(
                session: _session,
                baseUrl: 'https://example.test',
                client: fake.client,
              ),
              onClose: () {},
              profileAction: const SizedBox(width: 30, height: 30),
              onNotifications: () {},
              onQuickCreate: () {},
              onFixMissingPunches: (info) => fixed?.add(info),
            ),
          ),
        ),
      ),
    );
    await settle(tester);
    return fake;
  }

  Finder text(String value) => find.text(value, findRichText: true);

  /// A line of the receipt (the summary donut repeats a few of them).
  Finder line(String value) => find.descendant(
    of: find.byKey(const ValueKey('payroll-salary-receipt')),
    matching: text(value),
  );

  /// Scrolls the salary page until [finder] is built and on screen.
  Future<void> reveal(WidgetTester tester, Finder finder) async {
    await tester.scrollUntilVisible(
      finder,
      200,
      scrollable: find
          .descendant(
            of: find.byKey(const ValueKey('payroll-salary')),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    await tester.pump();
  }

  testWidgets('estimate: the receipt, its pill and the note it opens', (
    tester,
  ) async {
    final server = await pumpSalary(tester);
    expect(server.calls, ['GET /payroll/me/salary']);
    expect(text('October salary'), findsOneWidget);
    expect(text('OCTOBER SALARY'), findsOneWidget);
    expect(text('29 of 31 days paid'), findsOneWidget);
    // On top, as the total and in the summary donut's legend.
    expect(text('₹1,06,400'), findsNWidgets(3));
    expect(text('Take-home'), findsNWidgets(2));
    for (final row in [
      'Gross salary',
      'Loss of pay · 2 days',
      'Provident fund',
      'Income tax (TDS)',
      'Professional tax',
    ]) {
      expect(line(row), findsOneWidget, reason: row);
    }
    // The gross line and the donut's centre.
    expect(text('₹1,24,000'), findsNWidgets(2));
    expect(text('− ₹8,000'), findsOneWidget);
    expect(text('− ₹1,800'), findsOneWidget);
    expect(text('− ₹7,600'), findsOneWidget);
    expect(text('− ₹200'), findsOneWidget);
    // The rows come in the receipt's order.
    final tops = [
      'Gross salary',
      'Loss of pay · 2 days',
      'Provident fund',
      'Income tax (TDS)',
      'Professional tax',
    ].map((t) => tester.getTopLeft(line(t)).dy).toList();
    expect(tops, [...tops]..sort());

    const note =
        'Based on your attendance till today. It can change if leave or '
        'punches change before payroll.';
    expect(text(note), findsNothing);
    await capture(tester, 'salary-estimate');
    await tester.tap(find.byKey(const ValueKey('payroll-salary-estimate')));
    await tester.pump();
    expect(text(note), findsOneWidget);
    await capture(tester, 'salary-estimate-note');
    await tester.tap(find.byKey(const ValueKey('payroll-salary-estimate')));
    await tester.pump();
    expect(text(note), findsNothing);
  });

  testWidgets('released: no Estimate pill, the same receipt', (tester) async {
    await pumpSalary(tester, server: _FakeSalaryServer()..released = true);
    expect(text('OCTOBER SALARY'), findsOneWidget);
    expect(find.byKey(const ValueKey('payroll-salary-estimate')), findsNothing);
    expect(text('Estimate'), findsNothing);
    expect(text('29 of 31 days paid'), findsOneWidget);
    expect(text('₹1,06,400'), findsNWidgets(3));
    await capture(tester, 'salary-released');
  });

  testWidgets('rows open to their explanation, one at a time', (tester) async {
    await pumpSalary(tester);
    expect(text(_FakeSalaryServer.lopInfo), findsNothing);
    expect(text(_FakeSalaryServer.pfInfo), findsNothing);

    await tester.tap(line('Loss of pay · 2 days'));
    await tester.pumpAndSettle();
    expect(text(_FakeSalaryServer.lopInfo), findsOneWidget);
    await capture(tester, 'salary-lop-open');

    // Opening another closes the first.
    await tester.tap(text('Provident fund'));
    await tester.pumpAndSettle();
    expect(text(_FakeSalaryServer.pfInfo), findsOneWidget);
    expect(text(_FakeSalaryServer.lopInfo), findsNothing);

    await tester.tap(text('Gross salary'));
    await tester.pumpAndSettle();
    expect(
      text(
        'Your fixed monthly pay before any deductions: Basic ₹62,000 + '
        'House Rent Allowance ₹24,800 + Fixed Allowance ₹37,200.',
      ),
      findsOneWidget,
    );
    expect(text(_FakeSalaryServer.pfInfo), findsNothing);

    // Tapped again, it closes.
    await tester.tap(text('Gross salary'));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('payroll-salary-info-gross')),
      findsNothing,
    );
  });

  testWidgets('"Check unpaid days" opens the unpaid-days list', (tester) async {
    final fixed = <PayrollMissingPunches?>[];
    await pumpSalary(tester, fixed: fixed);
    expect(text('Check unpaid days'), findsOneWidget);
    // It sits under the loss-of-pay line, above PF.
    expect(
      tester.getTopLeft(text('Check unpaid days')).dy,
      greaterThan(tester.getTopLeft(line('Loss of pay · 2 days')).dy),
    );
    expect(
      tester.getTopLeft(text('Check unpaid days')).dy,
      lessThan(tester.getTopLeft(text('Provident fund')).dy),
    );
    await tester.tap(text('Check unpaid days'));
    await tester.pump();
    expect(fixed, hasLength(1));
    expect(fixed.single?.period, '2026-10');
    expect(fixed.single?.count, 3);
    expect(fixed.single?.fixBy, DateTime(2026, 11, 14));
  });

  testWidgets('Past payslips row opens the payslips list', (tester) async {
    final server = await pumpSalary(tester);
    await reveal(tester, text('Past payslips'));
    expect(text('Past payslips'), findsOneWidget);
    expect(text('April to September 2026'), findsOneWidget);
    // Below the receipt.
    expect(
      tester.getTopLeft(text('Past payslips')).dy,
      greaterThan(
        tester
            .getTopLeft(find.byKey(const ValueKey('payroll-salary-total')))
            .dy,
      ),
    );
    await tester.tap(text('Past payslips'));
    await settle(tester);
    expect(server.calls.last, 'GET /payslips/mine?limit=12');
    expect(find.byKey(const ValueKey('payroll-payslips')), findsOneWidget);
    expect(text('September 2026'), findsOneWidget);
  });

  testWidgets('a period asked for is sent; not set up shows why', (
    tester,
  ) async {
    final server = await pumpSalary(
      tester,
      period: '2026-10',
      server: _FakeSalaryServer()..notSetUp = true,
    );
    expect(server.calls, ['GET /payroll/me/salary?period=2026-10']);
    expect(text('October salary'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('payroll-salary-not-set-up')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('payroll-salary-receipt')), findsNothing);
    // The way to the payslips stays.
    expect(text('Past payslips'), findsOneWidget);
  });

  testWidgets('a failed read says so and tries again', (tester) async {
    final server = await pumpSalary(
      tester,
      server: _FakeSalaryServer()..failOnce = true,
    );
    expect(text('Something broke'), findsOneWidget);
    await tester.tap(text('Try again'));
    await settle(tester);
    expect(server.calls, hasLength(2));
    expect(text('₹1,06,400'), findsNWidgets(3));
  });

  testWidgets('the summary donut: deductions, loss of pay, take-home', (
    tester,
  ) async {
    await pumpSalary(tester);
    final card = find.byKey(const ValueKey('payroll-salary-summary'));
    expect(card, findsOneWidget);
    Finder inCard(String value) =>
        find.descendant(of: card, matching: text(value));
    expect(inCard('SALARY SUMMARY'), findsOneWidget);
    // PF + TDS + PT; the loss of pay apart; the receipt's own take-home.
    expect(inCard('Deductions'), findsOneWidget);
    expect(inCard('−₹9,600'), findsOneWidget);
    expect(inCard('Loss of pay · 2 days'), findsOneWidget);
    expect(inCard('−₹8,000'), findsOneWidget);
    expect(inCard('₹1,06,400'), findsOneWidget);
    expect(inCard('₹1,24,000'), findsOneWidget);
    expect(inCard('gross'), findsOneWidget);
    // An estimate says so on the card too.
    expect(inCard('Estimate'), findsOneWidget);
    // Above the receipt.
    expect(
      tester.getBottomLeft(card).dy,
      lessThan(
        tester
            .getTopLeft(find.byKey(const ValueKey('payroll-salary-receipt')))
            .dy,
      ),
    );
  });

  testWidgets('Previous Month | Current Month switches the pay period', (
    tester,
  ) async {
    final fixed = <PayrollMissingPunches?>[];
    final server = await pumpSalary(tester, fixed: fixed);
    expect(text('Previous Month'), findsOneWidget);
    expect(text('Current Month'), findsOneWidget);
    expect(text('October salary'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('payroll-salary-view-current')));
    await settle(tester);
    expect(server.calls, [
      'GET /payroll/me/salary',
      'GET /payroll/me/salary?view=current',
    ]);
    expect(text('November salary'), findsOneWidget);
    expect(text('NOVEMBER SALARY'), findsOneWidget);
    expect(text('30 of 30 days paid'), findsOneWidget);
    expect(text('₹1,16,400'), findsNWidgets(3));
    // No loss of pay this month: no line, no unpaid-days link.
    expect(find.byKey(const ValueKey('payroll-salary-line-lop')), findsNothing);
    expect(text('Check unpaid days'), findsNothing);
    // The estimate on both cards, and no payslip to download.
    expect(find.byKey(const ValueKey('payroll-salary-estimate')), findsOne);
    expect(find.byKey(const ValueKey('payroll-salary-download')), findsNothing);
    await capture(tester, 'salary-current');

    // Back to October: read once, not again.
    await tester.tap(
      find.byKey(const ValueKey('payroll-salary-view-previous')),
    );
    await settle(tester);
    expect(server.calls, hasLength(2));
    expect(text('October salary'), findsOneWidget);
    expect(text('Loss of pay · 2 days'), findsNWidgets(2));
  });

  testWidgets('a released payslip can be downloaded from the header', (
    tester,
  ) async {
    await pumpSalary(tester, server: _FakeSalaryServer()..released = true);
    expect(
      find.byKey(const ValueKey('payroll-salary-download')),
      findsOneWidget,
    );
  });

  testWidgets('a month asked for has no switch', (tester) async {
    await pumpSalary(tester, period: '2026-10');
    expect(text('Previous Month'), findsNothing);
    expect(text('October salary'), findsOneWidget);
  });

  testWidgets('no payslips yet: says when the first will come', (tester) async {
    await pumpSalary(tester, server: _FakeSalaryServer()..noPayslips = true);
    await reveal(tester, text('Past payslips'));
    await tester.tap(text('Past payslips'));
    await settle(tester);
    expect(find.byKey(const ValueKey('payslips-empty')), findsOneWidget);
    expect(text('No payslips yet'), findsOneWidget);
    expect(
      text('Your first payslip will show here after October payroll.'),
      findsOneWidget,
    );
    await capture(tester, 'payslips-empty');
  });
}
