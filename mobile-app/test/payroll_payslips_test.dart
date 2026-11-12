// Payroll › Salary › Past payslips (Figma 4484:71811) and one payslip
// (Figma 4484:72211, "August salary") against a small fake server: the list
// of released payslips with their credited dates and net pay, the payslip as
// a receipt — earnings, loss of pay opening to its days, gross pay,
// deductions and net pay adding up — the download in the header, and both
// "Raise a ticket" ways out. Every figure is invented; the org is sowaka. A
// layout that overflows fails the test.
//
// `flutter test --update-goldens --dart-define=SCREENSHOTS=<dir> test/payroll_payslips_test.dart`
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
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';
import 'package:mobile_app/features/support/support_launcher.dart';

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

Map<String, dynamic> _earning(String name, int rupees, [int lostRupees = 0]) =>
    {
      'code': name.toUpperCase(),
      'name': name,
      'fullPaise': rupees * 100,
      'paidPaise': (rupees - lostRupees) * 100,
    };

Map<String, dynamic> _deduction(String key, String name, int rupees) => {
  'key': key,
  'name': name,
  'fullPaise': rupees * 100,
  'amountPaise': rupees * 100,
};

/// August 2026 as its run released it: ₹1,24,000 a month, 3 days of loss of
/// pay (₹12,000), PF + TDS + PT ₹10,467, net ₹1,01,533.
Map<String, dynamic> _august() => {
  'run': {
    'id': 'run-2026-08',
    'period': '2026-08',
    'status': 'paid',
    'paidAt': '2026-08-31T09:00:00.000Z',
  },
  'payslip': {
    'id': 'slip-2026-08',
    'period': '2026-08',
    'employeeName': 'Tanvi',
    'earnings': [
      _earning('Basic', 49600, 4800),
      _earning('House rent allowance', 24800, 2400),
      _earning('Fuel & vehicle', 2500),
      _earning('Internet', 1000),
      _earning('Telephone', 1000),
      _earning('Special allowance', 45100, 4800),
    ],
    'deductions': [
      _deduction('epf', 'Provident fund', 1800),
      _deduction('income_tax', 'Income tax (TDS)', 8467),
      _deduction('pt', 'Professional tax', 200),
    ],
    'netPayablePaise': 10153300,
    'reimbursementsPaise': 0,
    'inputs': {
      'workingDays': 31,
      'payableDays': 28,
      'lopDays': 3,
      'attendanceDeductions': [
        {'label': 'Absent days', 'trigger': 'absent', 'count': 3, 'days': 3},
      ],
    },
  },
};

Map<String, dynamic> _september() => {
  'run': {
    'id': 'run-2026-09',
    'period': '2026-09',
    'status': 'paid',
    'paidAt': '2026-09-30T09:00:00.000Z',
  },
  'payslip': {
    'id': 'slip-2026-09',
    'period': '2026-09',
    'employeeName': 'Tanvi',
    'earnings': [_earning('Basic', 124000)],
    'deductions': [_deduction('pt', 'Professional tax', 200)],
    'netPayablePaise': 11353300,
    'reimbursementsPaise': 0,
    'inputs': {'workingDays': 30, 'payableDays': 30, 'lopDays': 0},
  },
};

class _FakeServer {
  final calls = <String>[];

  Map<String, dynamic> _salary() => {
    'period': '2026-10',
    'label': 'October 2026',
    'view': 'previous',
    'currentPeriod': '2026-11',
    'previousPeriod': '2026-10',
    'released': false,
    'payslipId': null,
    'periodFrom': '2026-10-01',
    'periodTo': '2026-10-31',
    'unpaidDays': {'period': '2026-10', 'count': 0, 'locked': false},
    'payslips': {'count': 2, 'from': '2026-08', 'to': '2026-09'},
    'daysPaid': 31,
    'daysInPeriod': 31,
    'baseDays': 31,
    'grossPaise': 12400000,
    'takeHomePaise': 12380000,
    'lines': [
      {
        'key': 'gross',
        'label': 'Gross salary',
        'amountPaise': 12400000,
        'kind': 'earning',
        'explanation': 'Your fixed monthly pay.',
      },
      {
        'key': 'pt',
        'label': 'Professional tax',
        'amountPaise': 20000,
        'kind': 'deduction',
        'explanation': 'A tax set by Karnataka.',
      },
    ],
    'lop': {'days': 0},
    'notSetUp': null,
  };

  http.Client get client => MockClient((request) async {
    final query = request.url.query;
    calls.add(
      '${request.method} ${request.url.path}${query.isEmpty ? '' : '?$query'}',
    );
    return switch (request.url.path) {
      '/payroll/me/salary' => _json({'success': true, 'salary': _salary()}),
      '/payslips/mine' => _json({
        'success': true,
        'company': {'name': 'Sowaka', 'address': 'Bengaluru'},
        'payslips': [_september(), _august()],
      }),
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

  Finder text(String value) => find.text(value, findRichText: true);

  /// Scrolls the page on top until [finder] is built and on screen.
  Future<void> reveal(WidgetTester tester, Finder finder) async {
    await tester.scrollUntilVisible(
      finder,
      200,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.pump();
  }

  /// The salary page, then Past payslips.
  Future<_FakeServer> pumpPayslips(
    WidgetTester tester, {
    List<String>? desk,
  }) async {
    tester.view.physicalSize = const Size(390 * 2, 844 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final fake = _FakeServer();
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
        home: Scaffold(
          body: PayrollSalarySummaryHost(
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
              onFixPunchDay: (_) {},
              onRaiseTicket: desk == null ? null : () => desk.add('desk'),
            ),
          ),
        ),
      ),
    );
    await settle(tester);
    await reveal(tester, text('Past payslips'));
    await tester.tap(text('Past payslips'));
    await settle(tester);
    return fake;
  }

  testWidgets('the list: month, credited date and net pay, newest first', (
    tester,
  ) async {
    final server = await pumpPayslips(tester, desk: []);
    expect(server.calls.last, 'GET /payslips/mine?limit=12');
    expect(text('Past payslip'), findsOneWidget);
    expect(text('September 2026'), findsOneWidget);
    expect(text('Credited 30 Sep'), findsOneWidget);
    expect(text('₹1,13,533'), findsOneWidget);
    expect(text('August 2026'), findsOneWidget);
    expect(text('Credited 31 Aug'), findsOneWidget);
    expect(text('₹1,01,533'), findsOneWidget);
    expect(
      tester.getTopLeft(text('September 2026')).dy,
      lessThan(tester.getTopLeft(text('August 2026')).dy),
    );
    expect(text('Can\'t find a payslip? Raise a ticket'), findsOneWidget);
    await capture(tester, 'payslips');
  });

  testWidgets('"Can\'t find a payslip?" raises a ticket about it', (
    tester,
  ) async {
    final opened = <String?>[];
    void opener({String? about}) => opened.add(about);
    registerSupportTicketOpener(opener);
    addTearDown(() => unregisterSupportTicketOpener(opener));
    await pumpPayslips(tester);
    await tester.tap(find.byKey(const ValueKey('payslips-raise-ticket')));
    expect(opened, ['I can\'t find a payslip:']);
  });

  testWidgets('no desk, no ticket link', (tester) async {
    await pumpPayslips(tester);
    expect(find.byKey(const ValueKey('payslips-raise-ticket')), findsNothing);
  });

  testWidgets('a payslip: earnings, loss of pay, gross, deductions, net', (
    tester,
  ) async {
    await pumpPayslips(tester, desk: []);
    await tester.tap(find.byKey(const ValueKey('payslip-row-slip-2026-08')));
    await settle(tester);
    expect(find.byKey(const ValueKey('payslip-slip-2026-08')), findsOneWidget);
    expect(text('August salary'), findsOneWidget);
    expect(find.byKey(const ValueKey('payslip-download')), findsOneWidget);
    expect(text('NET PAY'), findsOneWidget);
    expect(text('Credited 31 Aug'), findsOneWidget);
    // On top and as the total.
    expect(text('₹1,01,533'), findsNWidgets(2));
    expect(text('28 of 31 days paid'), findsOneWidget);
    expect(text('EARNINGS'), findsOneWidget);
    await capture(tester, 'payslip-top');
    for (final (label, value) in [
      ('Basic', '₹49,600'),
      ('House rent allowance', '₹24,800'),
      ('Fuel & vehicle', '₹2,500'),
      ('Special allowance', '₹45,100'),
      ('Loss of pay · 3 days', '− ₹12,000'),
      ('Gross pay', '₹1,12,000'),
      ('Provident fund', '− ₹1,800'),
      ('Income tax (TDS)', '− ₹8,467'),
      ('Professional tax', '− ₹200'),
      ('Total deductions', '− ₹10,467'),
    ]) {
      await reveal(tester, text(label));
      expect(text(label), findsOneWidget, reason: label);
      expect(text(value), findsOneWidget, reason: value);
    }
    expect(text('Internet'), findsOneWidget);
    expect(text('₹1,000'), findsNWidgets(2));
    expect(text('DEDUCTIONS'), findsOneWidget);
    await reveal(tester, text('Net pay'));
    // Earnings over deductions over net pay.
    final tops = [
      'Basic',
      'Loss of pay · 3 days',
      'Gross pay',
      'Provident fund',
      'Total deductions',
      'Net pay',
    ].map((t) => tester.getTopLeft(text(t)).dy).toList();
    expect(tops, [...tops]..sort());
    await capture(tester, 'payslip');
  });

  testWidgets('loss of pay opens to the days that made it', (tester) async {
    await pumpPayslips(tester, desk: []);
    await tester.tap(find.byKey(const ValueKey('payslip-row-slip-2026-08')));
    await settle(tester);
    await reveal(tester, find.byKey(const ValueKey('payslip-lop')));
    expect(find.byKey(const ValueKey('payslip-lop-info')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('payslip-lop')));
    await tester.pumpAndSettle();
    expect(
      text(
        'Absent days: 3 → 3 days\n'
        'One day\'s pay is ₹4,000 (₹1,24,000 ÷ 31 days)',
      ),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('payslip-lop')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('payslip-lop-info')), findsNothing);
  });

  testWidgets('"doesn\'t look right?" raises a ticket about that payslip', (
    tester,
  ) async {
    final opened = <String?>[];
    void opener({String? about}) => opened.add(about);
    registerSupportTicketOpener(opener);
    addTearDown(() => unregisterSupportTicketOpener(opener));
    await pumpPayslips(tester);
    await tester.tap(find.byKey(const ValueKey('payslip-row-slip-2026-08')));
    await settle(tester);
    await reveal(tester, find.byKey(const ValueKey('payslip-raise-ticket')));
    expect(
      text('Something on this payslip doesn\'t look right?'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('payslip-raise-ticket')));
    expect(opened, [
      'Something on my August 2026 payslip doesn\'t look right:',
    ]);
  });
}
