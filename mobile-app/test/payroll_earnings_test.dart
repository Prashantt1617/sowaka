// Payroll › Earnings against a fake server of its own: the financial-year
// dropdown, the Earned card's totals, the yearly salary, the folded month
// list (unpaid days, the estimate) and where a month leads — the estimate to
// the salary summary, a past month to its payslip. A layout that overflows
// fails the test. Every figure is invented; the org is sowaka.
//
// `--dart-define=EARNINGS_SHOTS=<dir>` also saves the page, months folded and
// open, as earnings-collapsed.png and earnings-expanded.png in <dir>.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/payroll/data/payroll_api_service.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';

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

const _r = 100; // paise in a rupee

/// The Earnings routes, answered from memory as the mockup's figures.
class _EarningsServer {
  final calls = <String>[];

  /// Off: the year's estimate and yearly salary can't be worked out.
  bool setUp = true;

  /// Off: no pay at all yet.
  bool hasPay = true;

  /// Other deductions and reimbursements over the current year, in rupees.
  int otherDeductions = 0;
  int reimbursements = 0;

  static const _months = [
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
    'January',
    'February',
    'March',
  ];

  static String _period(String fy, int i) {
    final start = int.parse(fy.substring(0, 4));
    final year = i < 9 ? start : start + 1;
    return '$year-${((i + 3) % 12 + 1).toString().padLeft(2, '0')}';
  }

  static Map<String, dynamic> _month(
    String fy,
    int i, {
    required int gross,
    required int net,
    num unpaid = 0,
    bool estimate = false,
  }) {
    final period = _period(fy, i);
    return {
      'period': period,
      'label': '${_months[i]} ${period.substring(0, 4)}',
      'grossPaise': gross * _r,
      'netPaise': net * _r,
      'unpaidDays': unpaid,
      'status': estimate ? 'estimate' : 'released',
      'payslipId': estimate ? null : 'slip-$period',
    };
  }

  Map<String, dynamic> _year(String fy) {
    final current = fy == '2026-27';
    if (!hasPay) {
      return {
        'fy': '2026-27',
        'current': true,
        'fys': <String>[],
        'span': null,
        'grossPaise': 0,
        'taxPaise': 0,
        'pfPtPaise': 0,
        'otherDeductionsPaise': 0,
        'reimbursementsPaise': 0,
        'takeHomePaise': 0,
        'componentsSource': 'structure',
        'components': <dynamic>[],
        'annualTotalPaise': 0,
        'componentsNotSetUp': {
          'reason': 'no_salary_structure',
          'message': 'Your salary structure is not set up yet. Ask HR.',
        },
        'estimateNotSetUp': null,
        'months': <dynamic>[],
      };
    }
    final months = current
        ? [
            for (var i = 0; i < 7; i++)
              if (i == 4)
                _month(fy, i, gross: 112000, net: 101533, unpaid: 3)
              else if (i < 6)
                _month(fy, i, gross: 124000, net: 113533)
              else if (setUp)
                _month(fy, i, gross: 116000, net: 106400, estimate: true),
          ]
        : [
            for (var i = 0; i < 12; i++)
              _month(
                fy,
                i,
                gross: 110000,
                net: 101350,
                unpaid: i == 11 ? .5 : 0,
              ),
          ];
    final components = current
        ? [
            ('BASIC', 'Basic', 595200),
            ('HRA', 'House rent allowance', 297600),
            ('FBP', 'FBP (fuel, internet, phone)', 72000),
            ('SPECIAL', 'Special allowance', 523200),
          ]
        : [
            ('BASIC', 'Basic', 528000),
            ('HRA', 'House rent allowance', 264000),
            ('FBP', 'FBP (fuel, internet, phone)', 54000),
            ('SPECIAL', 'Special allowance', 474000),
          ];
    final showComponents = !current || setUp;
    return {
      'fy': fy,
      'current': current,
      'fys': ['2026-27', '2025-26', '2024-25'],
      'span': current ? (setUp ? 'Apr–Oct' : 'Apr–Sep') : 'Apr–Mar',
      'grossPaise': (current ? 848000 : 1320000) * _r,
      'taxPaise': (current ? 58400 : 79800) * _r,
      'pfPtPaise': (current ? 14000 : 24000) * _r,
      'otherDeductionsPaise': (current ? otherDeductions : 0) * _r,
      'reimbursementsPaise': (current ? reimbursements : 0) * _r,
      'takeHomePaise':
          (current ? 775600 - otherDeductions + reimbursements : 1216200) * _r,
      'componentsSource': current ? 'structure' : 'payslips',
      'components': [
        if (showComponents)
          for (final (code, name, rupees) in components)
            {'code': code, 'name': name, 'annualPaise': rupees * _r},
      ],
      'annualTotalPaise': showComponents
          ? (current ? 1488000 : 1320000) * _r
          : 0,
      'componentsNotSetUp': showComponents
          ? null
          : {
              'reason': 'statutory_not_set_up',
              'message':
                  'Your yearly salary can\'t be worked out yet: the statutory '
                  'settings (PF, ESI, professional tax) for FY 2026-27 are '
                  'not set up. Ask HR.',
            },
      'estimateNotSetUp': current && !setUp
          ? {
              'reason': 'statutory_not_set_up',
              'message':
                  'Your October 2026 pay can\'t be worked out yet: the '
                  'statutory settings for FY 2026-27 are not set up. Ask HR.',
            }
          : null,
      'months': months,
    };
  }

  Map<String, dynamic> _payslip(String id) {
    final period = id.replaceFirst('slip-', '');
    return {
      'success': true,
      'company': {'name': 'Sowaka', 'address': 'Bengaluru', 'org': 'sowaka'},
      'run': {
        'id': 'run-$period',
        'period': period,
        'status': 'paid',
        'paidAt': '$period-28T12:00:00.000Z',
      },
      'payslip': {
        'id': id,
        'period': period,
        'employeeName': 'Tanvi',
        'employeeId': 'SW001',
        'earnings': [
          {
            'code': 'BASIC',
            'name': 'Basic',
            'fullPaise': 4960000,
            'paidPaise': 4960000,
          },
        ],
        'deductions': [
          {'key': 'epf', 'name': 'Provident fund', 'amountPaise': 180000},
        ],
        'netPayablePaise': 11353300,
        'reimbursementsPaise': 0,
        'inputs': {
          'workingDays': 30,
          'payableDays': 30,
          'lopDays': 0,
          'overtimePaise': 0,
        },
      },
    };
  }

  late final client = MockClient((request) async {
    final url = request.url;
    calls.add(
      '${request.method} ${url.path}${url.hasQuery ? '?${url.query}' : ''}',
    );
    if (url.path == '/payroll/me/earnings') {
      final fy = url.queryParameters['fy'];
      return _json({'success': true, 'earnings': _year(fy ?? '2026-27')});
    }
    if (url.path.startsWith('/payslips/')) {
      return _json(_payslip(url.pathSegments.last));
    }
    // Payroll home under the pushed page: not part of these tests.
    return _json({'success': false, 'message': 'Not in this test'}, 404);
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
  });

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 3; i++) {
      await tester.pump();
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 60)),
      );
    }
    await tester.pump(const Duration(milliseconds: 400));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 100)),
    );
    await tester.pump(const Duration(milliseconds: 100));
  }

  /// Payroll, with Earnings pushed onto its own navigator.
  Future<_EarningsServer> pumpEarnings(
    WidgetTester tester, {
    _EarningsServer? server,
    Size size = const Size(390, 844),
  }) async {
    tester.view.physicalSize = size * 2;
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final fake = server ?? _EarningsServer();
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
        home: RepaintBoundary(
          key: const ValueKey('earnings-shot'),
          child: Scaffold(
            body: PayrollScreen(
              api: PayrollApiService(
                session: _session,
                baseUrl: 'https://example.test',
                client: fake.client,
              ),
              onClose: () {},
              profileAction: const SizedBox(width: 30, height: 30),
              onNotifications: () {},
              onQuickCreate: () {},
              onFixPunchDay: (_) {},
              onRaiseTicket: () {},
            ),
          ),
        ),
      ),
    );
    await settle(tester);
    final nav = tester.state<NavigatorState>(
      find
          .descendant(
            of: find.byType(PayrollScreen),
            matching: find.byType(Navigator),
          )
          .first,
    );
    unawaited(
      nav.push(
        MaterialPageRoute<void>(
          builder: (_) => payrollEarningsPageForTesting(),
        ),
      ),
    );
    await settle(tester);
    return fake;
  }

  Finder page() => find.byKey(const ValueKey('payroll-earnings'));

  Finder inPage(Finder finder) => find.descendant(of: page(), matching: finder);

  Future<void> reveal(WidgetTester tester, Finder finder) async {
    if (finder.evaluate().isEmpty) {
      await tester.scrollUntilVisible(
        finder,
        200,
        scrollable: find
            .descendant(of: page(), matching: find.byType(Scrollable))
            .first,
      );
    }
    await tester.ensureVisible(finder);
    await tester.pump();
  }

  Future<void> tap(WidgetTester tester, Finder finder) async {
    await reveal(tester, finder);
    await tester.tap(finder);
    await settle(tester);
  }

  final toggle = find.byKey(const ValueKey('earnings-months-toggle'));
  Finder anyMonth() => find.byWidgetPredicate(
    (w) =>
        w.key is ValueKey<String> &&
        (w.key! as ValueKey<String>).value.startsWith('earnings-month-'),
  );

  /// Unfolds "Month by month" if it is folded.
  Future<void> openMonths(WidgetTester tester) async {
    if (anyMonth().evaluate().isNotEmpty) return;
    await tap(tester, toggle);
    expect(anyMonth(), findsWidgets);
  }

  /// Picks a year from the header's dropdown.
  Future<void> pickYear(WidgetTester tester, String label) async {
    await tester.tap(find.byKey(const ValueKey('earnings-fy-picker')));
    await settle(tester);
    await tester.tap(find.text(label).last);
    await settle(tester);
  }

  Future<void> shoot(WidgetTester tester, String name) async {
    const dir = String.fromEnvironment('EARNINGS_SHOTS');
    if (dir.isEmpty) return;
    final boundary = tester.renderObject<RenderRepaintBoundary>(
      find.byKey(const ValueKey('earnings-shot')),
    );
    await tester.runAsync(() async {
      final image = await boundary.toImage(pixelRatio: 2);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      File('$dir/$name.png')
        ..createSync(recursive: true)
        ..writeAsBytesSync(bytes!.buffer.asUint8List());
    });
  }

  testWidgets('the current year: totals, the yearly salary, no bar', (
    tester,
  ) async {
    final server = await pumpEarnings(tester);
    expect(server.calls, contains('GET /payroll/me/earnings'));
    expect(inPage(find.text('Earnings')), findsWidgets);
    // The header's dropdown names the year read; the others wait in it.
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('earnings-fy-picker')),
        matching: find.text('FY 2026–27'),
      ),
      findsOneWidget,
    );
    expect(inPage(find.text('FY 2025–26')), findsNothing);
    expect(find.byKey(const ValueKey('earnings-fy-2025-26')), findsNothing);
    expect(inPage(find.text('EARNED · FY 2026–27')), findsOneWidget);
    expect(inPage(find.text('Apr–Oct')), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const ValueKey('earnings-gross'))).data,
      '₹8,48,000',
    );
    expect(inPage(find.text('Gross pay so far this year')), findsOneWidget);
    // No stacked bar or its legend: only the rows.
    expect(inPage(find.text('Take-home')), findsOneWidget);
    expect(inPage(find.text('Tax')), findsNothing);
    expect(inPage(find.text('PF and PT')), findsNothing);
    expect(inPage(find.text('Income tax (TDS)')), findsOneWidget);
    expect(inPage(find.text('− ₹58,400')), findsOneWidget);
    expect(inPage(find.text('PF and professional tax')), findsOneWidget);
    expect(inPage(find.text('− ₹14,000')), findsOneWidget);
    expect(inPage(find.text('₹7,75,600')), findsOneWidget);
    // Nothing else came off: no rows for it.
    expect(inPage(find.text('Other deductions')), findsNothing);
    expect(inPage(find.text('Reimbursements')), findsNothing);

    await reveal(tester, find.byKey(const ValueKey('earnings-annual-total')));
    expect(inPage(find.text('YEARLY SALARY')), findsOneWidget);
    for (final (name, amount) in [
      ('Basic', '₹5,95,200'),
      ('House rent allowance', '₹2,97,600'),
      ('FBP (fuel, internet, phone)', '₹72,000'),
      ('Special allowance', '₹5,23,200'),
      ('Total a year', '₹14,88,000'),
    ]) {
      expect(inPage(find.text(name)), findsOneWidget);
      expect(inPage(find.text(amount)), findsOneWidget);
    }
    // The structure: no "from the payslips" line.
    expect(inPage(find.textContaining('payslips paid in full')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('month by month: folded, then unpaid days and the estimate', (
    tester,
  ) async {
    await pumpEarnings(tester);
    await reveal(tester, toggle);
    expect(inPage(find.text('Month by month')), findsOneWidget);
    expect(anyMonth(), findsNothing);
    expect(inPage(find.text('October 2026')), findsNothing);
    await openMonths(tester);
    await reveal(tester, find.byKey(const ValueKey('earnings-month-2026-10')));
    expect(inPage(find.text('October 2026')), findsOneWidget);
    expect(inPage(find.text('Gross ₹1,16,000 · Estimate')), findsOneWidget);
    expect(inPage(find.text('₹1,06,400')), findsOneWidget);
    await reveal(tester, find.byKey(const ValueKey('earnings-month-2026-08')));
    expect(inPage(find.text('August 2026')), findsOneWidget);
    expect(
      inPage(find.text('Gross ₹1,12,000 · 3 days unpaid')),
      findsOneWidget,
    );
    expect(inPage(find.text('₹1,01,533')), findsOneWidget);
    await reveal(tester, find.byKey(const ValueKey('earnings-month-2026-04')));
    expect(inPage(find.text('April 2026')), findsOneWidget);
    expect(inPage(find.text('Gross ₹1,24,000')), findsWidgets);
    // And folded again.
    await tap(tester, toggle);
    expect(anyMonth(), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'the dropdown lists the years with pay and reads the one picked',
    (tester) async {
      final server = await pumpEarnings(tester);
      await tester.tap(find.byKey(const ValueKey('earnings-fy-picker')));
      await settle(tester);
      for (final fy in ['FY 2026–27', 'FY 2025–26', 'FY 2024–25']) {
        expect(find.text(fy), findsWidgets);
      }
      await tester.tap(find.text('FY 2025–26').last);
      await settle(tester);
      expect(server.calls.last, 'GET /payroll/me/earnings?fy=2025-26');
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('earnings-fy-picker')),
          matching: find.text('FY 2025–26'),
        ),
        findsOneWidget,
      );
      expect(inPage(find.text('EARNED · FY 2025–26')), findsOneWidget);
      expect(inPage(find.text('Apr–Mar')), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const ValueKey('earnings-gross'))).data,
        '₹13,20,000',
      );
      expect(inPage(find.text('Gross pay for the year')), findsOneWidget);
      expect(inPage(find.text('− ₹79,800')), findsOneWidget);
      expect(inPage(find.text('₹12,16,200')), findsOneWidget);
      await reveal(tester, find.byKey(const ValueKey('earnings-annual-total')));
      expect(inPage(find.text('₹5,28,000')), findsOneWidget);
      // An earlier year's salary is what its payslips paid.
      await reveal(tester, find.textContaining('payslips paid in full'));
      // Half days read as halves; no estimate in a closed year.
      await openMonths(tester);
      await reveal(
        tester,
        find.byKey(const ValueKey('earnings-month-2026-03')),
      );
      expect(inPage(find.text('March 2026')), findsOneWidget);
      expect(
        inPage(find.text('Gross ₹1,10,000 · 0.5 days unpaid')),
        findsOneWidget,
      );
      expect(inPage(find.textContaining('Estimate')), findsNothing);
      // And back.
      await tester.drag(
        find.descendant(of: page(), matching: find.byType(Scrollable)).first,
        const Offset(0, 3000),
      );
      await settle(tester);
      await pickYear(tester, 'FY 2026–27');
      expect(server.calls.last, 'GET /payroll/me/earnings?fy=2026-27');
      expect(
        tester.widget<Text>(find.byKey(const ValueKey('earnings-gross'))).data,
        '₹8,48,000',
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('the estimate opens the salary summary; a month its payslip', (
    tester,
  ) async {
    final server = await pumpEarnings(tester);
    await openMonths(tester);
    await tap(tester, find.byKey(const ValueKey('earnings-month-2026-10')));
    expect(find.byKey(const ValueKey('payroll-salary')), findsOneWidget);
    expect(server.calls.where((c) => c.startsWith('GET /payslips')), isEmpty);
    tester
        .state<NavigatorState>(
          find
              .descendant(
                of: find.byType(PayrollScreen),
                matching: find.byType(Navigator),
              )
              .first,
        )
        .pop();
    await settle(tester);
    expect(page(), findsOneWidget);

    await openMonths(tester);
    await tap(tester, find.byKey(const ValueKey('earnings-month-2026-04')));
    expect(server.calls.last, 'GET /payslips/slip-2026-04');
    expect(find.byKey(const ValueKey('payslip-slip-2026-04')), findsOneWidget);
    expect(find.text('April salary'), findsWidgets);
    expect(find.text('₹1,13,533'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('not set up: said, with no made-up estimate or salary', (
    tester,
  ) async {
    await pumpEarnings(tester, server: _EarningsServer()..setUp = false);
    expect(inPage(find.text('Apr–Sep')), findsOneWidget);
    await reveal(
      tester,
      find.textContaining('Your yearly salary can\'t be worked out yet'),
    );
    expect(inPage(find.text('Total a year')), findsNothing);
    await openMonths(tester);
    expect(
      find.byKey(const ValueKey('earnings-month-2026-09')),
      findsOneWidget,
    );
    await reveal(
      tester,
      find.textContaining('Your October 2026 pay can\'t be worked out yet'),
    );
    expect(find.byKey(const ValueKey('earnings-month-2026-10')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no pay yet: an empty page, and why the salary is missing', (
    tester,
  ) async {
    await pumpEarnings(tester, server: _EarningsServer()..hasPay = false);
    expect(inPage(find.textContaining('No pay yet')), findsOneWidget);
    expect(
      inPage(find.text('Your salary structure is not set up yet. Ask HR.')),
      findsOneWidget,
    );
    expect(inPage(find.textContaining('FY 20')), findsNothing);
    expect(find.byKey(const ValueKey('earnings-fy-picker')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('other deductions and reimbursements: rows before take-home', (
    tester,
  ) async {
    await pumpEarnings(
      tester,
      server: _EarningsServer()
        ..otherDeductions = 2000
        ..reimbursements = 5000,
    );
    expect(inPage(find.text('Other deductions')), findsOneWidget);
    expect(inPage(find.text('− ₹2,000')), findsOneWidget);
    expect(inPage(find.text('Reimbursements')), findsOneWidget);
    expect(inPage(find.text('+ ₹5,000')), findsOneWidget);
    expect(inPage(find.text('₹7,78,600')), findsOneWidget);
    double top(String text) => tester.getTopLeft(inPage(find.text(text))).dy;
    expect(top('PF and professional tax'), lessThan(top('Other deductions')));
    expect(top('Other deductions'), lessThan(top('Reimbursements')));
    expect(top('Reimbursements'), lessThan(top('Take-home')));
    expect(tester.takeException(), isNull);
  });

  testWidgets('screenshots: months folded and open', (tester) async {
    await pumpEarnings(tester, size: const Size(393, 860));
    await shoot(tester, 'earnings-collapsed');
    tester.view.physicalSize = const Size(393 * 2, 1380 * 2);
    await tester.pump();
    await tap(tester, toggle);
    expect(anyMonth(), findsNWidgets(7));
    await shoot(tester, 'earnings-expanded');
    expect(tester.takeException(), isNull);
  });
}
