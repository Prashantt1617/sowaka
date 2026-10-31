// The Payroll screens (Actions › Payroll) against a fake server: the home,
// Change my split → Review → submit, the investment declaration with its caps
// and the regime switch, the proof upload states, and payslips → payslip.
// The last test opens Payroll from the Actions home and follows "Fix missing
// punches" into the Attendance list it reuses. A layout that overflows fails
// the test.
//
// `flutter test --update-goldens --dart-define=SCREENSHOTS=<dir> test/payroll_screens_test.dart`
// also writes every screen to <dir> as a 390×844 PNG.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/payroll/data/payroll_api_service.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';

import 'payroll_test_server.dart';

const _screenshots = String.fromEnvironment('SCREENSHOTS');

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
    // The icons, for screenshots only: tests draw them as boxes otherwise.
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

  void phone(WidgetTester tester) {
    tester.view.physicalSize = const Size(390 * 2, 844 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
  }

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

  Future<void> capture(WidgetTester tester, Finder root, String name) async {
    if (_screenshots.isEmpty) return;
    await expectLater(
      root,
      matchesGoldenFile(Uri.file('$_screenshots/$name.png')),
    );
  }

  Future<FakePayrollServer> pumpPayroll(
    WidgetTester tester, {
    FakePayrollServer? server,
    List<Object?>? fixed,
  }) async {
    phone(tester);
    final fake = server ?? FakePayrollServer();
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
        home: Scaffold(
          body: PayrollScreen(
            api: PayrollApiService(
              session: payrollSession,
              baseUrl: 'https://example.test',
              client: FakePayrollClient(fake),
            ),
            onClose: () {},
            profileAction: const SizedBox(width: 30, height: 30),
            onNotifications: () {},
            onQuickCreate: () {},
            onFixMissingPunches: (info) => fixed?.add(info),
            onRaiseTicket: () {},
            pickFile: (_) async => PayrollUpload(
              name: 'lic-receipt.pdf',
              bytes: Uint8List.fromList(utf8.encode('%PDF-1.4 test receipt')),
            ),
          ),
        ),
      ),
    );
    await settle(tester);
    return fake;
  }

  Finder payroll() => find.byType(PayrollScreen);

  Future<void> tap(WidgetTester tester, Finder finder) async {
    if (finder.evaluate().isEmpty) {
      await tester.scrollUntilVisible(
        finder,
        300,
        scrollable: find
            .descendant(
              of: find.byType(ListView).first,
              matching: find.byType(Scrollable),
            )
            .first,
      );
    }
    await tester.ensureVisible(finder);
    await tester.pump();
    await tester.tap(finder);
    await settle(tester);
  }

  testWidgets('Payroll home: the month\'s salary, to-dos and the ways in', (
    tester,
  ) async {
    final fixed = <Object?>[];
    await pumpPayroll(tester, fixed: fixed);
    expect(find.byKey(const ValueKey('payroll-home')), findsOneWidget);
    expect(find.text('Payroll'), findsOneWidget);
    expect(find.textContaining('SALARY'), findsOneWidget);
    expect(find.text('₹77,800'), findsNWidgets(2));
    expect(find.text('Gross salary'), findsOneWidget);
    expect(find.text('Loss of pay · 2 days'), findsOneWidget);
    expect(find.text('− ₹6,000'), findsOneWidget);
    expect(find.text('Income tax (TDS)'), findsOneWidget);
    expect(find.text('Fix 12 missing punches'), findsOneWidget);
    expect(find.text('Choose tax regime'), findsOneWidget);
    await capture(tester, payroll(), 'payroll_home');

    // A line opens to say what it is.
    await tap(tester, find.text('Provident fund'));
    expect(find.textContaining('12% of your basic pay'), findsOneWidget);

    // "Check unpaid days" and the to-do both hand over to Attendance.
    await tap(tester, find.byKey(const ValueKey('payroll-unpaid-days')));
    await tap(
      tester,
      find.byKey(const ValueKey('payroll-todo-missing_punches')),
    );
    expect(fixed, hasLength(2));

    await tester.drag(find.byType(ListView).first, const Offset(0, -700));
    await settle(tester);
    expect(find.text('Payslips'), findsOneWidget);
    expect(find.text('FBP'), findsOneWidget);
    await capture(tester, payroll(), 'payroll_home_scrolled');
  });

  testWidgets('home → Change my split → Review → Submit', (tester) async {
    final server = await pumpPayroll(tester);
    await tap(
      tester,
      find.byKey(const ValueKey('payroll-todo-flexible_split')),
    );
    expect(find.byKey(const ValueKey('payroll-split')), findsOneWidget);
    expect(find.text('Fuel & vehicle'), findsOneWidget);
    expect(find.text('Max ₹3,000'), findsOneWidget);
    expect(find.text('2 rejected'), findsOneWidget);
    expect(find.text('Books & periodicals'), findsOneWidget);
    final total = find.byKey(const ValueKey('split-total'));
    expect(
      tester.widget<Text>(total).textSpan!.toPlainText(),
      '₹4,500 of ₹6,000 assigned · ₹1,500 left',
    );
    await capture(tester, payroll(), 'split');

    // Nothing changed yet: nothing to review. Internet is at its limit.
    final internetPlus = tester.widget<InkWell>(
      find.descendant(
        of: find.byKey(const ValueKey('split-plus-INTERNET')),
        matching: find.byType(InkWell),
      ),
    );
    expect(internetPlus.onTap, isNull);

    await tap(tester, find.byKey(const ValueKey('split-plus-FUEL')));
    await tap(tester, find.byKey(const ValueKey('split-plus-TELEPHONE')));
    await tap(tester, find.byKey(const ValueKey('split-plus-BOOKS')));
    expect(find.text('₹3,000'), findsWidgets);
    expect(
      tester.widget<Text>(total).textSpan!.toPlainText(),
      '₹6,000 of ₹6,000 assigned · All set',
    );

    await tap(tester, find.text('Review split'));
    expect(server.bodies['/payroll/split/review'], {
      'amounts': {
        'FUEL': 300000,
        'INTERNET': 100000,
        'TELEPHONE': 150000,
        'BOOKS': 50000,
      },
    });
    expect(find.byKey(const ValueKey('payroll-split-review')), findsOneWidget);
    expect(find.text('YOUR NEW SPLIT · NOV 2026 TO MAR 2027'), findsOneWidget);
    expect(find.text('+₹500'), findsNWidgets(2));
    expect(find.text('New'), findsOneWidget);
    expect(find.textContaining('₹940 a month'), findsOneWidget);
    await capture(tester, payroll(), 'review_split');

    // The promise comes first.
    await tap(tester, find.text('Submit split'));
    expect(server.bodies.containsKey('/payroll/split'), isFalse);
    await tap(tester, find.byKey(const ValueKey('split-agree')));
    await tap(tester, find.text('Submit split'));
    expect(server.bodies['/payroll/split']!['acknowledged'], isTrue);
    expect(find.text('Split submitted'), findsOneWidget);
    await capture(tester, payroll(), 'split_submitted');

    // Closing goes home, which is read again.
    final homeReads = server.calls
        .where((c) => c == 'GET /payroll/home')
        .length;
    await tap(
      tester,
      find.ancestor(
        of: find.byWidgetPredicate(
          (w) =>
              w is SvgPicture &&
              (w.bytesLoader as SvgAssetLoader).assetName ==
                  'assets/icons/hub_close_x.svg',
        ),
        matching: find.byType(InkWell),
      ),
    );
    expect(find.byKey(const ValueKey('payroll-home')), findsOneWidget);
    expect(
      server.calls.where((c) => c == 'GET /payroll/home').length,
      homeReads + 1,
    );
  });

  testWidgets('a window that moved since Review is reviewed again', (
    tester,
  ) async {
    final server = await pumpPayroll(tester);
    await tap(tester, find.byKey(const ValueKey('payroll-fbp')));
    await tap(tester, find.byKey(const ValueKey('split-plus-FUEL')));
    await tap(tester, find.text('Review split'));
    expect(find.text('YOUR NEW SPLIT · NOV 2026 TO MAR 2027'), findsOneWidget);

    // The cutoff passes while the person reads.
    server.windowMonth = '2026-12';
    await tap(tester, find.byKey(const ValueKey('split-agree')));
    await tap(tester, find.text('Submit split'));
    expect(server.bodies['/payroll/split']!['effectiveFrom'], '2026-11');
    expect(find.text('The window has moved, review again'), findsOneWidget);
    expect(find.text('Split submitted'), findsNothing);
    expect(find.text('YOUR NEW SPLIT · DEC 2026 TO MAR 2027'), findsOneWidget);

    // Ticked again, it goes through for the new month.
    await tester.pump(const Duration(seconds: 6));
    await settle(tester);
    await tap(tester, find.byKey(const ValueKey('split-agree')));
    await tap(tester, find.text('Submit split'));
    expect(server.bodies['/payroll/split']!['effectiveFrom'], '2026-12');
    expect(find.text('Split submitted'), findsOneWidget);
  });

  testWidgets('a closed split window says why and cannot be reviewed', (
    tester,
  ) async {
    final server = FakePayrollServer()..splitOpen = false;
    await pumpPayroll(tester, server: server);
    await tap(tester, find.byKey(const ValueKey('payroll-fbp')));
    expect(find.textContaining('payroll is closed'), findsOneWidget);
    final plus = tester.widget<InkWell>(
      find.descendant(
        of: find.byKey(const ValueKey('split-plus-FUEL')),
        matching: find.byType(InkWell),
      ),
    );
    expect(plus.onTap, isNull);
  });

  testWidgets('declaration: caps, the regime switch, submit', (tester) async {
    final server = await pumpPayroll(tester);
    await tap(tester, find.byKey(const ValueKey('payroll-tax')));
    expect(find.byKey(const ValueKey('payroll-declaration')), findsOneWidget);
    expect(find.text('80C investments'), findsOneWidget);
    expect(find.text('Max ₹1,50,000'), findsOneWidget);
    expect(find.text('₹21,600'), findsOneWidget); // PF, read only
    expect(find.text('Provident fund (from payroll)'), findsOneWidget);
    await capture(tester, payroll(), 'declaration_old');

    // Over the 80C cap: said, and the declared amount still kept.
    expect(find.byKey(const ValueKey('cap-80C')), findsNothing);
    await tester.enterText(
      find.descendant(
        of: find.byKey(const ValueKey('declare-other80C')),
        matching: find.byType(TextField),
      ),
      '30000',
    );
    await tester.pump();
    expect(
      find.text('₹1,80,000 declared — only ₹1,50,000 counts.'),
      findsOneWidget,
    );
    await capture(tester, payroll(), 'declaration_over_cap');

    await tester.drag(find.byType(ListView).first, const Offset(0, -900));
    await settle(tester);
    expect(find.text('Home loan interest'), findsOneWidget);
    expect(find.text('Investment proofs'), findsOneWidget);
    await capture(tester, payroll(), 'declaration_old_scrolled');

    // The new regime asks for nothing.
    await tester.drag(find.byType(ListView).first, const Offset(0, 1500));
    await settle(tester);
    await tap(tester, find.text('New regime'));
    expect(find.textContaining('nothing to declare'), findsOneWidget);
    expect(find.text('80C investments'), findsNothing);
    await capture(tester, payroll(), 'declaration_new');

    // Back to old, and submit.
    await tap(tester, find.text('Old regime'));
    expect(find.text('80C investments'), findsOneWidget);
    await tap(tester, find.text('Submit declaration'));
    final body = server.bodies['/payroll/tax-declaration']!;
    expect(body['regime'], 'old');
    expect(body['submit'], isTrue);
    final items = body['items'] as Map<String, dynamic>;
    expect(items['other80C'], 3000000);
    expect(items['ppf'], 5000000);
    expect(items.containsKey('epf'), isFalse);
    expect(find.text('Declaration submitted'), findsOneWidget);
    expect(find.text('Old regime'), findsOneWidget);
    await capture(tester, payroll(), 'declaration_submitted');
  });

  testWidgets('declaration on the new regime sends just the regime', (
    tester,
  ) async {
    final server = await pumpPayroll(tester);
    await tap(tester, find.byKey(const ValueKey('payroll-tax')));
    await tap(tester, find.text('New regime'));
    await tap(tester, find.text('Submit declaration'));
    expect(server.bodies['/payroll/tax-declaration']!['regime'], 'new');
    expect(server.regime, 'new');
    expect(find.text('Declaration submitted'), findsOneWidget);
  });

  testWidgets('proofs: not uploaded, in review, approved, rejected; upload', (
    tester,
  ) async {
    final server = await pumpPayroll(tester);
    await tap(
      tester,
      find.byKey(const ValueKey('payroll-todo-investment_proofs')),
    );
    expect(find.byKey(const ValueKey('payroll-proofs')), findsOneWidget);
    expect(find.text('2 to upload · 1 to re-upload'), findsOneWidget);
    expect(find.text('Approved'), findsNWidgets(2));
    expect(find.text('In review'), findsOneWidget);
    expect(find.text('Rejected'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('proof-upload-lifeInsurance')),
      findsOneWidget,
    );
    await capture(tester, payroll(), 'proofs');

    // Upload: nothing to send until a file is chosen.
    await tap(tester, find.byKey(const ValueKey('proof-upload-lifeInsurance')));
    expect(find.text('Upload proof'), findsOneWidget);
    expect(find.text('Life insurance · Premium receipt'), findsOneWidget);
    InkWell submitButton() => tester.widget<InkWell>(
      find
          .ancestor(
            of: find.text('Submit for review'),
            matching: find.byType(InkWell),
          )
          .first,
    );
    expect(submitButton().onTap, isNull);
    await capture(tester, payroll(), 'proof_upload_sheet');
    await tap(tester, find.byKey(const ValueKey('proof-pick')));
    expect(find.text('lic-receipt.pdf'), findsOneWidget);
    expect(submitButton().onTap, isNotNull);
    await capture(tester, payroll(), 'proof_upload_sheet_file');
    await tap(tester, find.text('Submit for review'));
    expect(server.uploadFileField, 'proof');
    expect(server.uploadFileName, 'lic-receipt.pdf');
    expect(server.uploadFields, {'amountPaise': '2840000'});
    expect(find.text('Upload proof'), findsNothing);
    expect(find.text('In review'), findsNWidgets(2));
    await tester.drag(find.byType(ListView).first, const Offset(0, 1000));
    await settle(tester);
    expect(find.text('1 to upload · 1 to re-upload'), findsOneWidget);

    // A rejected proof says why and is re-uploaded the same way (once the
    // "sent" toast has gone).
    await tester.pump(const Duration(seconds: 6));
    await settle(tester);
    await tester.drag(find.byType(ListView).first, const Offset(0, -600));
    await settle(tester);
    expect(
      find.textContaining('This certificate is for FY 2025–26'),
      findsOneWidget,
    );
    await capture(tester, payroll(), 'proofs_scrolled');
    await tap(
      tester,
      find.byKey(const ValueKey('proof-reupload-homeLoanInterest')),
    );
    expect(find.text('Re-upload proof'), findsWidgets);
    await tap(tester, find.byKey(const ValueKey('proof-pick')));
    await tap(tester, find.text('Submit for review'));
    expect(
      server.calls.last,
      'POST /payroll/investment-proofs/homeLoanInterest',
    );
    expect(find.text('Rejected'), findsNothing);

    // An approved one opens to show what was sent.
    await tester.drag(find.byType(ListView).first, const Offset(0, 1200));
    await settle(tester);
    await tap(tester, find.byKey(const ValueKey('proof-view-ppf')));
    expect(find.text('Amount on proof'), findsOneWidget);
    expect(find.text('ppf-proof.pdf'), findsOneWidget);
    await capture(tester, payroll(), 'proof_view_sheet');
  });

  testWidgets('payslips → a payslip with its loss of pay', (tester) async {
    final server = await pumpPayroll(tester);
    await tap(tester, find.byKey(const ValueKey('payroll-payslips')));
    expect(server.calls, contains('GET /payslips/mine?limit=12'));
    expect(find.text('September 2026'), findsOneWidget);
    expect(find.text('Credited 30 Sep'), findsOneWidget);
    expect(find.text('₹83,800'), findsOneWidget);
    expect(find.text('August 2026'), findsOneWidget);
    expect(find.text('Can\'t find a payslip? Raise a ticket'), findsOneWidget);
    await capture(tester, payroll(), 'payslips');

    await tap(tester, find.text('August 2026'));
    expect(find.byKey(const ValueKey('payslip-slip-2026-08')), findsOneWidget);
    expect(find.text('₹76,600'), findsWidgets);
    expect(find.text('28 of 31 days paid'), findsOneWidget);
    expect(find.text('Loss of pay · 3 days'), findsOneWidget);
    expect(find.text('− ₹6,000'), findsOneWidget);
    expect(find.text('Income tax (TDS)'), findsOneWidget);
    await capture(tester, payroll(), 'payslip');
    await tester.drag(find.byType(ListView).first, const Offset(0, -600));
    await settle(tester);
    expect(find.text('Download payslip'), findsOneWidget);
    await capture(tester, payroll(), 'payslip_scrolled');
  });

  testWidgets('Actions › Payroll, and its missing punches in Attendance', (
    tester,
  ) async {
    phone(tester);
    final payrollServer = FakePayrollServer()
      ..missingCount = _missedDays().length;
    final bloc = ManagerBloc(
      session: payrollSession,
      service: ManagerApiService(
        session: payrollSession,
        baseUrl: 'https://example.test',
        client: _dashboardServer(),
      ),
    );
    await tester.runAsync(() => bloc.add(const LoadManagerDashboard()));
    final controller = QuickActionsController();
    addTearDown(() {
      bloc.dispose();
      controller.dispose();
    });
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
        home: Scaffold(
          body: QuickActionsScreen(
            bloc: bloc,
            dashboard: bloc.state.dashboard!,
            controller: controller,
            profileAction: const SizedBox(width: 30, height: 30),
            onNotifications: () {},
            onOpenComposer: () {},
            payroll: PayrollApiService(
              session: payrollSession,
              baseUrl: 'https://example.test',
              client: FakePayrollClient(payrollServer),
            ),
          ),
        ),
      ),
    );
    await settle(tester);
    final actions = find.byType(QuickActionsScreen);
    expect(find.byKey(const ValueKey('payroll-card')), findsOneWidget);
    expect(find.text('Payslips, salary & tax'), findsOneWidget);
    await capture(tester, actions, 'actions_home');

    await tap(tester, find.byKey(const ValueKey('payroll-card')));
    expect(find.byKey(const ValueKey('payroll-home')), findsOneWidget);

    await tap(
      tester,
      find.byKey(const ValueKey('payroll-todo-missing_punches')),
    );
    // The Attendance list, on its Missed punch heading, under Payroll's name.
    expect(find.byKey(const ValueKey('calendar')), findsOneWidget);
    expect(find.text('Missing punches'), findsOneWidget);
    expect(find.byKey(const ValueKey('calendar-note')), findsOneWidget);
    final missing = _missedDays().length;
    if (missing > 0) {
      expect(
        find.textContaining(
          '$missing ${missing == 1 ? 'day' : 'days'} to fix by',
        ),
        findsOneWidget,
      );
    }
    if (_missedDay() != null) {
      expect(find.text('Request Correction'), findsNothing);
      expect(
        find.byType(AttendanceListCard),
        findsNWidgets(_missedDays().length),
      );
    }
    await capture(tester, actions, 'missing_punches');

    // A day opens the correction it always did.
    if (_missedDay() != null) {
      await tap(tester, find.byType(AttendanceListCard).first);
      expect(find.text('Request Correction'), findsOneWidget);
      await capture(tester, find.byType(MaterialApp), 'missing_punches_day');
      Navigator.of(tester.element(find.text('Request Correction'))).pop();
      await settle(tester);
    }

    // Back returns to Payroll, not the Actions home.
    controller.handleBack();
    await settle(tester);
    expect(find.byKey(const ValueKey('payroll-home')), findsOneWidget);
    controller.handleBack();
    await settle(tester);
    expect(find.byKey(const ValueKey('payroll-card')), findsOneWidget);
  });
}

/// This month's past weekdays, and which of them have a punch missing:
/// every fourth one, three at most.
List<DateTime> _pastWeekdays() {
  final today = DateTime.now();
  return [
    for (var d = 1; d < today.day; d++)
      if (DateTime(today.year, today.month, d).weekday < DateTime.saturday)
        DateTime(today.year, today.month, d),
  ];
}

List<DateTime> _missedDays() {
  final days = _pastWeekdays();
  return [for (var i = 1; i < days.length && i < 12; i += 4) days[i]];
}

DateTime? _missedDay() => _missedDays().firstOrNull;

String _ymd(DateTime day) =>
    '${day.year}-${day.month.toString().padLeft(2, '0')}-'
    '${day.day.toString().padLeft(2, '0')}';

String _at(DateTime day, int hour, int minute) => DateTime(
  day.year,
  day.month,
  day.day,
  hour,
  minute,
).toUtc().toIso8601String();

/// Just enough of the dashboard for the Actions home and its calendar.
http.Client _dashboardServer() => FakePayrollClient(_DashboardServer());

class _DashboardServer extends FakePayrollServer {
  @override
  Future<http.Response> handle(http.Request request) async {
    final path = request.url.path;
    if (path.endsWith('/manager/workspace')) {
      return payrollJson({
        'success': true,
        'team': <dynamic>[],
        'holidays': <dynamic>[],
        'weekoffDays': [6, 0],
        'shift': {
          'name': 'Default',
          'startTime': '09:30',
          'endTime': '18:30',
          'minHalfDayHours': 4,
          'minFullDayHours': 8,
          'weeklyOff': {
            for (final week in ['1', '2', '3', '4', '5']) week: [5, 6],
          },
          'leaveTypes': [
            {'key': 'casual', 'name': 'Casual Leave', 'advanceDays': 30},
          ],
          'leaveBalanceTracked': true,
          'correction': {
            'triggers': [
              'Missing punch-in',
              'Missing punch-out',
              'Both punches missing',
            ],
            'backdateDays': 31,
            'punchFormat': 'In-app punch in',
            'punchMode': 'Both punches',
          },
        },
        'overtimeEnabled': false,
        'hasManager': true,
      });
    }
    if (path.contains('/attendance/mine')) {
      final missed = _missedDays();
      return payrollJson({
        'success': true,
        'records': [
          for (final day in _pastWeekdays())
            {
              'workDate': _ymd(day),
              'punchIn': _at(day, 9, 24),
              if (!missed.contains(day)) 'punchOut': _at(day, 18, 41),
            },
        ],
        'regularizations': <dynamic>[],
      });
    }
    if (path.startsWith('/payroll') || path.startsWith('/payslips')) {
      return super.handle(request);
    }
    return payrollJson({
      'success': true,
      'leaves': <dynamic>[],
      'overtime': <dynamic>[],
      'regularizations': <dynamic>[],
      'claims': <dynamic>[],
      'types': <dynamic>[],
      'records': <dynamic>[],
      'balance': <String, dynamic>{},
    });
  }
}
