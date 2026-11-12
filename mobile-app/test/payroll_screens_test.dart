// The Payroll screens (Actions › Payroll) against a fake server: the home,
// Change my split → Review → submit, the investment declaration with its caps
// and the regime switch, the proof upload states, and payslips → payslip.
// The Missed punches page (Figma 4473:67442) on its own, and the last test
// opens Payroll from the Actions home, follows "Fix missing punches" onto it
// and taps a day into the Attendance correction form it reuses. A layout that overflows fails
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
import 'package:mobile_app/features/payroll/data/payroll_models.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';
import 'package:mobile_app/features/support/support_launcher.dart';

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
            onFixPunchDay: (day) => fixed?.add(day),
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

  testWidgets('Payroll home: the summary cards, to-dos and the ways in', (
    tester,
  ) async {
    final fixed = <Object?>[];
    await pumpPayroll(tester, fixed: fixed);
    expect(find.byKey(const ValueKey('payroll-home')), findsOneWidget);
    expect(find.text('Payroll'), findsOneWidget);
    expect(find.text('Fix 12 missing punches'), findsOneWidget);
    expect(find.text('To avoid loss of pay'), findsOneWidget);
    expect(find.text('Choose tax regime'), findsOneWidget);
    await capture(tester, payroll(), 'payroll_home');

    // The to-do opens Missed punches; a day there is fixed in Attendance.
    await tap(
      tester,
      find.byKey(const ValueKey('payroll-todo-missing_punches')),
    );
    expect(find.byKey(const ValueKey('payroll-missed-punches')), findsOne);
    expect(fixed, isEmpty);
    Navigator.of(
      tester.element(find.byKey(const ValueKey('payroll-missed-punches'))),
    ).pop();
    await settle(tester);

    await tester.drag(find.byType(ListView).first, const Offset(0, -700));
    await settle(tester);
    expect(find.text('Earnings'), findsOneWidget);
    expect(find.text('Support desk'), findsOneWidget);
    await capture(tester, payroll(), 'payroll_home_scrolled');
  });

  testWidgets('Payroll home: no FBP card for a salary without flexible heads', (
    tester,
  ) async {
    final server = FakePayrollServer()..hasSplit = false;
    await pumpPayroll(tester, server: server);
    expect(find.byKey(const ValueKey('payroll-card-salary')), findsOneWidget);
    expect(find.byKey(const ValueKey('payroll-card-tax')), findsOneWidget);
    expect(find.byKey(const ValueKey('payroll-fbp')), findsNothing);
    // Two cards, two dots.
    expect(find.byKey(const ValueKey('payroll-dot-1')), findsOneWidget);
    expect(find.byKey(const ValueKey('payroll-dot-2')), findsNothing);
  });

  testWidgets('Payroll home: approved overtime is a line of its own', (
    tester,
  ) async {
    final server = FakePayrollServer()..overtimePaise = 125000;
    await pumpPayroll(tester, server: server);
    expect(find.text('Overtime'), findsOneWidget);
    expect(find.text('+ ₹1,250'), findsOneWidget);
    await tap(tester, find.text('Overtime'));
    expect(find.textContaining('overtime rule'), findsOneWidget);
  }, skip: true); // The salary breakdown moved to the salary summary (R2).

  testWidgets('Payroll home: loss of pay is explained on the pay period', (
    tester,
  ) async {
    await pumpPayroll(tester);
    await tap(tester, find.text('Loss of pay · 2 days'));
    expect(
      find.textContaining(
        'Loss of pay = monthly pay ÷ 30 paid days in this pay period × '
        'days lost.',
      ),
      findsOneWidget,
    );
    expect(find.textContaining('days in the month'), findsNothing);

    // The estimate says which days it is worked out from.
    await tap(tester, find.byKey(const ValueKey('payroll-estimate')));
    expect(
      find.textContaining('in this pay period (26 Oct – 25 Nov) till today'),
      findsOneWidget,
    );
  }, skip: true); // The salary breakdown moved to the salary summary (R2).

  testWidgets('Payroll home: no base days from the server, generic words', (
    tester,
  ) async {
    await pumpPayroll(tester, server: FakePayrollServer()..baseDays = null);
    await tap(tester, find.text('Loss of pay · 2 days'));
    expect(
      find.textContaining(
        'monthly pay ÷ the paid days in this pay period × days lost',
      ),
      findsOneWidget,
    );
    expect(find.textContaining('days in the month'), findsNothing);
  }, skip: true); // The salary breakdown moved to the salary summary (R2).

  testWidgets(
    'Payroll home: no statutory settings, the salary says not set up',
    (tester) async {
      await pumpPayroll(
        tester,
        server: FakePayrollServer()..statutorySetUp = false,
      );
      expect(find.byKey(const ValueKey('payroll-home')), findsOneWidget);
      expect(find.text('Not set up'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('payroll-salary-not-set-up')),
        findsOneWidget,
      );
      expect(find.textContaining('FY 2026-27 are not set up'), findsOneWidget);
      // No made-up figures, no error page; the rest of home still shows.
      expect(find.text('See breakdown'), findsNothing);
      expect(find.text('Take-home'), findsNothing);
      expect(find.text('Estimate'), findsNothing);
      expect(find.text('Try again'), findsNothing);
      expect(find.text('Choose tax regime'), findsOneWidget);
      expect(find.text('Fix 12 missing punches'), findsOneWidget);
      await capture(tester, payroll(), 'payroll_home_not_set_up');
    },
  );

  testWidgets('home → Change my split → Review → Submit', (tester) async {
    final server = await pumpPayroll(tester);
    await tap(
      tester,
      find.byKey(const ValueKey('payroll-todo-flexible_split')),
    );
    expect(find.byKey(const ValueKey('payroll-split')), findsOneWidget);
    expect(find.text('Fuel & vehicle'), findsOneWidget);
    expect(find.text('Max ₹3,000'), findsOneWidget);
    // Bills live on the FBP page; My split shows only the heads (Figma 4473:68656).
    expect(find.text('2 rejected'), findsNothing);
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

    await tap(tester, find.text('Submit Split'));
    expect(server.bodies['/payroll/split/review'], {
      'amounts': {
        'FUEL': 300000,
        'INTERNET': 100000,
        'TELEPHONE': 150000,
        'BOOKS': 50000,
      },
    });
    expect(find.byKey(const ValueKey('payroll-split-review')), findsOneWidget);
    expect(find.text('YOUR NEW SPLIT · NOV TO MAR 2027'), findsOneWidget);
    expect(find.text('+₹500'), findsNWidgets(2));
    expect(find.text('New'), findsOneWidget);
    expect(find.textContaining('₹940 a month'), findsOneWidget);
    await capture(tester, payroll(), 'review_split');

    // The promise comes first.
    await tap(tester, find.text('Submit declaration'));
    expect(server.bodies.containsKey('/payroll/split'), isFalse);
    await tap(tester, find.byKey(const ValueKey('split-agree')));
    await tap(tester, find.text('Submit declaration'));
    expect(server.bodies['/payroll/split']!['acknowledged'], isTrue);
    expect(find.text('Declaration submitted'), findsOneWidget);
    await capture(tester, payroll(), 'split_submitted');

    // Back to FBP leaves the flow for where it was opened (here, home),
    // which is read again.
    final homeReads = server.calls
        .where((c) => c == 'GET /payroll/home')
        .length;
    await tester.tap(find.text('Back to FBP'));
    await settle(tester);
    expect(find.byKey(const ValueKey('payroll-split')), findsNothing);
    expect(find.byKey(const ValueKey('payroll-split-review')), findsNothing);
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
    await tap(tester, find.text('Submit Split'));
    expect(find.text('YOUR NEW SPLIT · NOV TO MAR 2027'), findsOneWidget);

    // The cutoff passes while the person reads.
    server.windowMonth = '2026-12';
    await tap(tester, find.byKey(const ValueKey('split-agree')));
    await tap(tester, find.text('Submit declaration'));
    expect(server.bodies['/payroll/split']!['effectiveFrom'], '2026-11');
    expect(find.text('The window has moved, review again'), findsOneWidget);
    expect(find.text('Declaration submitted'), findsNothing);
    expect(find.text('YOUR NEW SPLIT · DEC TO MAR 2027'), findsOneWidget);

    // Ticked again, it goes through for the new month.
    await tester.pump(const Duration(seconds: 6));
    await settle(tester);
    await tap(tester, find.byKey(const ValueKey('split-agree')));
    await tap(tester, find.text('Submit declaration'));
    expect(server.bodies['/payroll/split']!['effectiveFrom'], '2026-12');
    expect(find.text('Declaration submitted'), findsOneWidget);
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

  testWidgets('Payroll home: the FBP bills to-do, its counts and due pill', (
    tester,
  ) async {
    final soon = DateTime.now().add(const Duration(days: 2));
    String iso(DateTime d) =>
        '${d.year}-${d.month.toString().padLeft(2, '0')}-'
        '${d.day.toString().padLeft(2, '0')}';
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', //
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    final server = FakePayrollServer()..fbpBillsDueOn = iso(soon);
    await pumpPayroll(tester, server: server);
    final row = find.byKey(const ValueKey('payroll-todo-fbp_bills'));
    await tester.scrollUntilVisible(
      row,
      300,
      scrollable: find
          .descendant(
            of: find.byType(ListView).first,
            matching: find.byType(Scrollable),
          )
          .first,
    );
    Finder inRow(String text) =>
        find.descendant(of: row, matching: find.text(text));
    expect(inRow('Submit FBP bills'), findsOneWidget);
    expect(inRow('3 pending · 1 rejected'), findsOneWidget);
    final pill = inRow('by ${soon.day} ${months[soon.month - 1]}');
    expect(pill, findsOneWidget);
    // Two days to go: red, as the other to-dos.
    expect(tester.widget<Text>(pill).style?.color, const Color(0xFFB3261E));
  });

  testWidgets('a split locked for the FY: the lock, no Submit, a ticket', (
    tester,
  ) async {
    final server = FakePayrollServer()..splitLockedForFy = true;
    await pumpPayroll(tester, server: server);
    await tap(
      tester,
      find.byKey(const ValueKey('payroll-todo-flexible_split')),
    );
    expect(find.byKey(const ValueKey('split-locked')), findsOneWidget);
    expect(
      find.text(
        'Your split is locked for this FY. To change it, raise a ticket.',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('split-raise-ticket')), findsOneWidget);
    expect(find.byKey(const ValueKey('split-submit-split')), findsNothing);
    final plus = tester.widget<InkWell>(
      find.descendant(
        of: find.byKey(const ValueKey('split-plus-FUEL')),
        matching: find.byType(InkWell),
      ),
    );
    expect(plus.onTap, isNull);
  });

  testWidgets('a save refused as locked shows the server\'s words', (
    tester,
  ) async {
    final server = FakePayrollServer()..refuseSaveAsLocked = true;
    await pumpPayroll(tester, server: server);
    await tap(
      tester,
      find.byKey(const ValueKey('payroll-todo-flexible_split')),
    );
    await tap(tester, find.byKey(const ValueKey('split-plus-FUEL')));
    await tap(tester, find.byKey(const ValueKey('split-submit-split')));
    await tap(tester, find.byKey(const ValueKey('split-agree')));
    await tap(tester, find.byKey(const ValueKey('split-submit-declaration')));
    expect(
      find.text(
        'Your split is locked for this FY. To change it, raise a ticket.',
      ),
      findsOneWidget,
    );
    expect(find.text('The window has moved, review again'), findsNothing);
    expect(find.byKey(const ValueKey('payroll-split-review')), findsOneWidget);
  });

  // Figma 4473:68656 "My split" and 4506:22931 "Review".
  group('My split and its Review', () {
    /// Whether the InkWell under [key] can be pressed.
    bool live(WidgetTester tester, String key) =>
        tester
            .widget<InkWell>(
              find.descendant(
                of: find.byKey(ValueKey(key)),
                matching: find.byType(InkWell),
              ),
            )
            .onTap !=
        null;

    String plain(WidgetTester tester, String key) =>
        tester.widget<Text>(find.byKey(ValueKey(key))).textSpan!.toPlainText();

    String amount(WidgetTester tester, String code) =>
        tester.widget<Text>(find.byKey(ValueKey('split-amount-$code'))).data!;

    Future<FakePayrollServer> openSplit(
      WidgetTester tester, {
      FakePayrollServer? server,
    }) async {
      final fake = await pumpPayroll(tester, server: server);
      await tap(
        tester,
        find.byKey(const ValueKey('payroll-todo-flexible_split')),
      );
      expect(find.byKey(const ValueKey('payroll-split')), findsOneWidget);
      return fake;
    }

    testWidgets('steppers: limits, greyed buttons, the footer totals', (
      tester,
    ) async {
      final server = FakePayrollServer()..addLeaveTravel();
      await openSplit(tester, server: server);
      expect(find.text('Change my split'), findsOneWidget);
      expect(find.text('Leave travel (LTA)'), findsOneWidget);
      expect(find.text('Max ₹2,000'), findsOneWidget);
      await capture(tester, payroll(), 'figma_my_split');

      // At its limit Internet cannot go up; at ₹0 Books and LTA cannot go
      // down; the rest can go both ways.
      expect(live(tester, 'split-plus-INTERNET'), isFalse);
      expect(live(tester, 'split-minus-INTERNET'), isTrue);
      expect(live(tester, 'split-minus-BOOKS'), isFalse);
      expect(live(tester, 'split-minus-LTA'), isFalse);
      expect(live(tester, 'split-plus-FUEL'), isTrue);
      expect(live(tester, 'split-minus-FUEL'), isTrue);
      expect(
        plain(tester, 'split-total'),
        '₹4,500 of ₹6,000 assigned · ₹1,500 left',
      );
      // Nothing changed: nothing to submit.
      expect(live(tester, 'split-submit-split'), isFalse);

      // HR's ₹500 step, up to the limit and no further.
      await tap(tester, find.byKey(const ValueKey('split-plus-FUEL')));
      expect(amount(tester, 'FUEL'), '₹3,000');
      expect(live(tester, 'split-plus-FUEL'), isFalse);
      expect(
        plain(tester, 'split-total'),
        '₹5,000 of ₹6,000 assigned · ₹1,000 left',
      );
      expect(live(tester, 'split-submit-split'), isTrue);

      // Down to ₹0 and no further.
      await tap(tester, find.byKey(const ValueKey('split-minus-INTERNET')));
      await tap(tester, find.byKey(const ValueKey('split-minus-INTERNET')));
      expect(amount(tester, 'INTERNET'), '₹0');
      expect(live(tester, 'split-minus-INTERNET'), isFalse);
      expect(
        plain(tester, 'split-total'),
        '₹4,000 of ₹6,000 assigned · ₹2,000 left',
      );

      // More than the pool: said in the footer, and it cannot be sent.
      for (var i = 0; i < 4; i++) {
        await tap(tester, find.byKey(const ValueKey('split-plus-LTA')));
      }
      expect(amount(tester, 'LTA'), '₹2,000');
      expect(live(tester, 'split-plus-LTA'), isFalse);
      await tap(tester, find.byKey(const ValueKey('split-plus-BOOKS')));
      expect(
        plain(tester, 'split-total'),
        '₹6,500 of ₹6,000 assigned · ₹500 over',
      );
      expect(live(tester, 'split-submit-split'), isFalse);
      await tap(tester, find.byKey(const ValueKey('split-minus-LTA')));
      expect(
        plain(tester, 'split-total'),
        '₹6,000 of ₹6,000 assigned · All set',
      );
      expect(live(tester, 'split-submit-split'), isTrue);

      // Back where it started: nothing to submit again.
      await tap(tester, find.byKey(const ValueKey('split-minus-LTA')));
      await tap(tester, find.byKey(const ValueKey('split-minus-LTA')));
      await tap(tester, find.byKey(const ValueKey('split-minus-LTA')));
      await tap(tester, find.byKey(const ValueKey('split-minus-BOOKS')));
      await tap(tester, find.byKey(const ValueKey('split-plus-INTERNET')));
      await tap(tester, find.byKey(const ValueKey('split-plus-INTERNET')));
      await tap(tester, find.byKey(const ValueKey('split-minus-FUEL')));
      expect(
        plain(tester, 'split-total'),
        '₹4,500 of ₹6,000 assigned · ₹1,500 left',
      );
      expect(live(tester, 'split-submit-split'), isFalse);
    });

    testWidgets('the step is HR\'s: ₹100 moves by ₹100', (tester) async {
      final server = FakePayrollServer()..splitStepPaise = 10000;
      await openSplit(tester, server: server);
      await tap(tester, find.byKey(const ValueKey('split-plus-FUEL')));
      expect(amount(tester, 'FUEL'), '₹2,600');
      await tap(tester, find.byKey(const ValueKey('split-minus-TELEPHONE')));
      expect(amount(tester, 'TELEPHONE'), '₹900');
    });

    testWidgets('no step set: not set up, Ask HR, nothing can move', (
      tester,
    ) async {
      final server = FakePayrollServer()..splitStepPaise = 0;
      await openSplit(tester, server: server);
      expect(
        find.textContaining(
          'HR hasn\'t finished setting up the flexible split',
        ),
        findsOneWidget,
      );
      for (final code in ['FUEL', 'INTERNET', 'TELEPHONE', 'BOOKS']) {
        expect(live(tester, 'split-plus-$code'), isFalse, reason: code);
        expect(live(tester, 'split-minus-$code'), isFalse, reason: code);
      }
      expect(live(tester, 'split-submit-split'), isFalse);
    });

    testWidgets('review: deltas, New, the saving, the tick gates Submit', (
      tester,
    ) async {
      final server = await openSplit(tester);
      await tap(tester, find.byKey(const ValueKey('split-plus-FUEL')));
      await tap(tester, find.byKey(const ValueKey('split-plus-TELEPHONE')));
      await tap(tester, find.byKey(const ValueKey('split-plus-BOOKS')));
      await tap(tester, find.byKey(const ValueKey('split-submit-split')));
      expect(
        find.byKey(const ValueKey('payroll-split-review')),
        findsOneWidget,
      );
      expect(find.text('Review'), findsOneWidget);
      await capture(tester, payroll(), 'figma_review');

      // The months it runs, as the design writes them.
      expect(find.text('YOUR NEW SPLIT · NOV TO MAR 2027'), findsOneWidget);
      Finder inLine(String code, Finder what) => find.descendant(
        of: find.byKey(ValueKey('split-line-$code')),
        matching: what,
      );
      // Raised heads carry their delta, a head that was ₹0 is New, an
      // unchanged one has neither.
      expect(inLine('FUEL', find.text('+₹500')), findsOneWidget);
      expect(inLine('FUEL', find.text('₹3,000')), findsOneWidget);
      expect(inLine('TELEPHONE', find.text('+₹500')), findsOneWidget);
      expect(inLine('BOOKS', find.text('New')), findsOneWidget);
      expect(inLine('BOOKS', find.text('+₹500')), findsNothing);
      expect(inLine('INTERNET', find.byType(Container)), findsNothing);
      expect(plain(tester, 'split-review-total'), '₹6,000 a month');
      expect(
        tester
            .widget<Text>(
              find
                  .descendant(
                    of: find.byKey(const ValueKey('split-saving')),
                    matching: find.byType(Text),
                  )
                  .last,
            )
            .textSpan!
            .toPlainText(),
        'Saves about ₹940 a month in tax, once bills are approved.',
      );
      expect(
        find.text(
          'I\'ll keep bills for these heads and upload them by 31 Mar 2027.',
        ),
        findsOneWidget,
      );
      expect(
        find.text('You can change this again until 15 Nov.'),
        findsOneWidget,
      );

      // Submit stays off until the box is ticked, and off again untick.
      expect(live(tester, 'split-submit-declaration'), isFalse);
      bool ticked() => find
          .byWidgetPredicate(
            (w) =>
                w is SvgPicture &&
                (w.bytesLoader as SvgAssetLoader).assetName ==
                    'assets/icons/payroll_split_check.svg',
          )
          .evaluate()
          .isNotEmpty;
      expect(ticked(), isFalse);
      await tap(tester, find.byKey(const ValueKey('split-agree')));
      expect(ticked(), isTrue);
      expect(live(tester, 'split-submit-declaration'), isTrue);
      await capture(tester, payroll(), 'figma_review_ticked');
      await tap(tester, find.byKey(const ValueKey('split-agree')));
      expect(live(tester, 'split-submit-declaration'), isFalse);
      await tap(tester, find.byKey(const ValueKey('split-submit-declaration')));
      expect(server.bodies.containsKey('/payroll/split'), isFalse);

      // Ticked and sent: the split, the acknowledgement, the month.
      await tap(tester, find.byKey(const ValueKey('split-agree')));
      await tap(tester, find.byKey(const ValueKey('split-submit-declaration')));
      expect(server.bodies['/payroll/split'], {
        'amounts': {
          'FUEL': 300000,
          'INTERNET': 100000,
          'TELEPHONE': 150000,
          'BOOKS': 50000,
        },
        'acknowledged': true,
        'effectiveFrom': '2026-11',
      });

      // The success sheet (canvas HF4c), then on to a bill.
      expect(find.byKey(const ValueKey('split-done-sheet')), findsOneWidget);
      expect(find.text('Declaration submitted'), findsOneWidget);
      expect(
        find.text(
          'Your new split of ₹6,000 a month applies from November pay till '
          'March. Upload bills each month so these heads stay tax-free.',
        ),
        findsOneWidget,
      );
      expect(find.text('Back to FBP'), findsOneWidget);
      await capture(tester, payroll(), 'figma_review_done');
      await tester.tap(find.text('Upload a bill'));
      await settle(tester);
      expect(find.byKey(const ValueKey('split-done-sheet')), findsNothing);
      expect(find.byKey(const ValueKey('payroll-split-review')), findsNothing);
      expect(find.byKey(const ValueKey('payroll-split')), findsNothing);
      expect(find.byKey(const ValueKey('payroll-home')), findsOneWidget);
    });

    testWidgets('review without tax rules: no saving note', (tester) async {
      final server = FakePayrollServer()..reviewSavingPaise = null;
      await openSplit(tester, server: server);
      await tap(tester, find.byKey(const ValueKey('split-plus-FUEL')));
      await tap(tester, find.byKey(const ValueKey('split-submit-split')));
      expect(
        find.byKey(const ValueKey('payroll-split-review')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('split-saving')), findsNothing);
      expect(find.textContaining('Saves about'), findsNothing);
    });
  });

  group('contact HR goes to a Support Desk ticket', () {
    final opened = <String?>[];
    void opener({String? about}) => opened.add(about);
    setUp(() {
      opened.clear();
      registerSupportTicketOpener(opener);
    });
    tearDown(() => unregisterSupportTicketOpener(opener));

    testWidgets('"Can\'t find a payslip?" raises a ticket about it', (
      tester,
    ) async {
      await pumpPayroll(tester);
      await tap(tester, find.byKey(const ValueKey('payroll-payslips')));
      await tap(tester, find.byKey(const ValueKey('payslips-raise-ticket')));
      expect(opened, ['I can\'t find a payslip:']);
    }, skip: true); // Payslips open from Downloads (R5) once it lands.

    testWidgets('a page that says "Ask HR" carries the ticket link', (
      tester,
    ) async {
      await pumpPayroll(
        tester,
        server: FakePayrollServer()..taxRulesSetUp = false,
      );
      await tap(tester, find.byKey(const ValueKey('payroll-todo-tax_regime')));
      expect(find.textContaining('Ask HR.'), findsOneWidget);
      await tap(tester, find.byKey(const ValueKey('raise-ticket-link')));
      expect(opened, [
        'The income tax rules for FY 2026-27 are not set up yet. Ask HR.',
      ]);
    });

    testWidgets('the home\'s Support desk raises a new ticket', (tester) async {
      await pumpPayroll(tester);
      await tap(tester, find.byKey(const ValueKey('payroll-raise-ticket')));
      expect(opened, [null]);
    });
  });

  group(
    'Investment declaration (Figma 4484:73124, 4484:73528, 4506:23669)',
    () {
      final opened = <String?>[];
      void opener({String? about}) => opened.add(about);
      setUp(opened.clear);
      tearDown(() => unregisterSupportTicketOpener(opener));

      testWidgets('caps, the saved sheet, then back', (tester) async {
        final server = await pumpPayroll(tester);
        await tap(
          tester,
          find.byKey(const ValueKey('payroll-todo-tax_regime')),
        );
        expect(
          find.byKey(const ValueKey('payroll-declaration')),
          findsOneWidget,
        );
        expect(find.text('By 30 Nov · old regime'), findsOneWidget);
        // The regime is picked under Tax, not here.
        expect(find.byKey(const ValueKey('regime-switch')), findsNothing);
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
        expect(find.text('Interest this year'), findsOneWidget);
        await capture(tester, payroll(), 'declaration_old_scrolled');

        await tap(tester, find.byKey(const ValueKey('declaration-save')));
        final body = server.bodies['/payroll/tax-declaration']!;
        expect(body['regime'], 'old');
        expect(body['submit'], isTrue);
        final items = body['items'] as Map<String, dynamic>;
        expect(items['other80C'], 3000000);
        expect(items['ppf'], 5000000);
        expect(items.containsKey('epf'), isFalse);
        expect(find.text('Declaration saved'), findsOneWidget);
        expect(
          find.text('Make sure you upload the proofs by 31 Jan.'),
          findsOneWidget,
        );
        await capture(tester, payroll(), 'declaration_saved');

        await tap(tester, find.byKey(const ValueKey('declaration-saved-done')));
        expect(find.byKey(const ValueKey('payroll-declaration')), findsNothing);
      });

      testWidgets('on the new regime there is nothing to declare', (
        tester,
      ) async {
        final server = FakePayrollServer()..regime = 'new';
        await pumpPayroll(tester, server: server);
        await tap(
          tester,
          find.byKey(const ValueKey('payroll-todo-tax_regime')),
        );
        expect(find.text('By 30 Nov · new regime'), findsOneWidget);
        expect(find.textContaining('nothing to declare'), findsOneWidget);
        expect(find.text('80C investments'), findsNothing);
        expect(find.byKey(const ValueKey('declaration-save')), findsNothing);
        await capture(tester, payroll(), 'declaration_new');
      });

      testWidgets('closed: what was declared, ask HR, claim it back', (
        tester,
      ) async {
        registerSupportTicketOpener(opener);
        final server = FakePayrollServer()..declarationClosed = true;
        await pumpPayroll(tester, server: server);
        await tap(
          tester,
          find.byKey(const ValueKey('payroll-todo-tax_regime')),
        );
        expect(find.text('Declaration closed on 30 Nov'), findsOneWidget);
        expect(find.text('You declared ₹3,33,400 in 5 items'), findsOneWidget);
        expect(find.text('Closed'), findsOneWidget);
        // Nothing can be typed or saved any more.
        expect(find.byType(TextField), findsNothing);
        expect(find.byKey(const ValueKey('declaration-save')), findsNothing);
        expect(find.text('WHAT YOU CAN STILL DO'), findsOneWidget);
        expect(find.text('Missed it for a reason?'), findsOneWidget);
        expect(find.text('Ask HR to reopen your declaration'), findsOneWidget);
        expect(find.text('Claim it back when you file'), findsOneWidget);
        expect(
          find.text(
            'The extra tax cut now isn’t lost. Add these investments when you '
            'file your income tax return by 31 Jul 2027, and you’ll get the '
            'extra back as a refund.',
          ),
          findsOneWidget,
        );
        // HR first, then the claim (Figma 4484:73628).
        expect(
          tester.getTopLeft(find.text('Missed it for a reason?')).dy,
          lessThan(
            tester.getTopLeft(find.text('Claim it back when you file')).dy,
          ),
        );
        await capture(tester, payroll(), 'declaration_closed');

        await tap(tester, find.byKey(const ValueKey('declaration-ask-hr')));
        expect(opened, hasLength(1));
        expect(opened.single, contains('FY 2026-27'));
        expect(opened.single, contains('closed on 30 Nov'));
      });

      testWidgets('closed with nothing declared says so', (tester) async {
        final server = FakePayrollServer()..declarationClosed = true;
        server.items.updateAll((_, _) => 0);
        await pumpPayroll(tester, server: server);
        await tap(
          tester,
          find.byKey(const ValueKey('payroll-todo-tax_regime')),
        );
        expect(find.text('You didn’t declare any investments'), findsOneWidget);
      });
    },
  );

  group('Investment proofs (Figma 4484:73360, 4484:73735, 4567:25245)', () {
    final opened = <String?>[];
    void opener({String? about}) => opened.add(about);
    setUp(() {
      opened.clear();
      payrollProofCamera = (_) async => PayrollUpload(
        name: 'camera-shot.jpg',
        bytes: Uint8List.fromList(List.filled(2048, 7)),
      );
      payrollProofGallery = (_) async => PayrollUpload(
        name: 'gallery-shot.jpg',
        bytes: Uint8List.fromList(List.filled(1024, 7)),
      );
    });
    tearDown(() => unregisterSupportTicketOpener(opener));

    Future<void> openProofs(WidgetTester tester) async {
      await tap(
        tester,
        find.byKey(const ValueKey('payroll-todo-investment_proofs')),
      );
      expect(find.byKey(const ValueKey('payroll-proofs')), findsOneWidget);
    }

    Color cardColour(WidgetTester tester, String section) {
      final box = tester.widget<Container>(
        find
            .descendant(
              of: find.byKey(ValueKey('proof-section-$section')),
              matching: find.byType(Container),
            )
            .first,
      );
      return (box.decoration! as BoxDecoration).color!;
    }

    testWidgets('the list: deadline, a card per section, every status', (
      tester,
    ) async {
      await pumpPayroll(tester);
      await openProofs(tester);
      expect(
        find.text('Last date to upload all proofs is 31 Jan.'),
        findsOneWidget,
      );
      for (final title in ['80C', '80D', 'Rent (HRA)', 'Home loan']) {
        expect(find.text(title), findsOneWidget);
      }
      // 80C: approved, in review, and one to upload.
      expect(find.text('PPF'), findsOneWidget);
      expect(find.text('₹50,000'), findsNWidgets(2));
      expect(find.text('Approved'), findsNWidgets(2));
      expect(find.text('In review'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('proof-upload-lifeInsurance')),
        findsOneWidget,
      );
      expect(find.text('₹28,400'), findsOneWidget);
      expect(find.text('Health insurance · self and family'), findsOneWidget);
      // Rent is a month's amount, April to March.
      expect(find.text('₹15,000 a month · Apr to Mar'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('proof-upload-rentMonthly')),
        findsOneWidget,
      );
      expect(cardColour(tester, '80C'), Colors.white);
      await capture(tester, payroll(), 'proofs');

      // The rejected one: its card pink, HR's reason, the re-upload.
      await tester.drag(find.byType(ListView).first, const Offset(0, -600));
      await settle(tester);
      expect(find.text('Rejected'), findsOneWidget);
      expect(find.text('₹2,00,000'), findsOneWidget);
      expect(
        find.text(
          'This certificate is for FY 2025–26. Upload the one for '
          'FY 2026–27.',
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('proof-reupload-homeLoanInterest')),
        findsOneWidget,
      );
      expect(find.text('Re-upload proof'), findsOneWidget);
      // The canvas's `.it.rj`: the card stays white, the rejected row pink
      // to its edges.
      expect(cardColour(tester, '24B'), Colors.white);
      final row = tester.widget<Container>(
        find.byKey(const ValueKey('proof-homeLoanInterest')),
      );
      expect((row.decoration! as BoxDecoration).color, const Color(0xFFFFF7F7));
      await capture(tester, payroll(), 'proofs_scrolled');
    });

    testWidgets('re-upload: the sheet sends the photo and the amount on it', (
      tester,
    ) async {
      final server = await pumpPayroll(tester);
      await openProofs(tester);
      await tap(
        tester,
        find.byKey(const ValueKey('proof-reupload-homeLoanInterest')),
      );
      // The sheet, as drawn: title, what to send, the box, the amount.
      expect(find.text('Re-upload proof'), findsNWidgets(2));
      expect(
        find.text('Home loan interest · Interest certificate from the bank'),
        findsOneWidget,
      );
      expect(find.text('Interest certificate from the bank'), findsOneWidget);
      expect(find.text('Photo or PDF'), findsOneWidget);
      expect(find.text('Take photo'), findsOneWidget);
      expect(find.text('Gallery'), findsOneWidget);
      expect(find.text('Choose file'), findsOneWidget);
      expect(find.text('Amount on proof'), findsOneWidget);
      final amount = tester.widget<TextField>(
        find.byKey(const ValueKey('proof-amount')),
      );
      expect(amount.controller!.text, '₹2,00,000');
      InkWell submit() => tester.widget<InkWell>(
        find
            .ancestor(
              of: find.text('Submit for review'),
              matching: find.byType(InkWell),
            )
            .first,
      );
      expect(submit().onTap, isNull);
      await capture(tester, payroll(), 'proof_reupload_sheet');

      await tap(tester, find.byKey(const ValueKey('proof-take-photo')));
      // The file takes the box's place; × puts the box back.
      expect(find.text('camera-shot.jpg'), findsOneWidget);
      expect(find.text('JPG'), findsOneWidget);
      expect(find.text('2 KB'), findsOneWidget);
      expect(find.text('Photo or PDF'), findsNothing);
      expect(find.text('Take photo'), findsNothing);
      expect(submit().onTap, isNotNull);
      await tap(tester, find.byKey(const ValueKey('proof-remove-file')));
      expect(find.text('camera-shot.jpg'), findsNothing);
      expect(find.text('Photo or PDF'), findsOneWidget);
      expect(submit().onTap, isNull);
      // A photo already on the phone, from the gallery.
      await tap(tester, find.byKey(const ValueKey('proof-gallery')));
      expect(find.text('gallery-shot.jpg'), findsOneWidget);
      expect(submit().onTap, isNotNull);
      await tap(tester, find.byKey(const ValueKey('proof-remove-file')));
      await tap(tester, find.byKey(const ValueKey('proof-take-photo')));
      await tester.enterText(
        find.byKey(const ValueKey('proof-amount')),
        '195000',
      );
      await tester.pump();
      expect(find.text('₹1,95,000'), findsOneWidget);
      expect(submit().onTap, isNotNull);
      await capture(tester, payroll(), 'proof_reupload_sheet_file');
      await tap(tester, find.text('Submit for review'));

      expect(
        server.calls.last,
        'POST /payroll/investment-proofs/homeLoanInterest',
      );
      expect(server.uploadFileField, 'proof');
      expect(server.uploadFileName, 'camera-shot.jpg');
      expect(server.uploadFields, {'amountPaise': '19500000'});
      // Back on the list: in review again, the reason and the pink gone.
      expect(find.text('Submit for review'), findsNothing);
      expect(find.text('Rejected'), findsNothing);
      expect(find.textContaining('This certificate is for'), findsNothing);
      expect(find.text('In review'), findsNWidgets(2));
      expect(cardColour(tester, '24B'), Colors.white);
    });

    testWidgets('upload: Choose file, the declared amount, then in review', (
      tester,
    ) async {
      final server = await pumpPayroll(tester);
      await openProofs(tester);
      await tap(
        tester,
        find.byKey(const ValueKey('proof-upload-lifeInsurance')),
      );
      expect(find.text('Upload proof'), findsOneWidget);
      expect(
        find.text('Life insurance · Premium receipt from the insurer'),
        findsOneWidget,
      );
      await tap(tester, find.byKey(const ValueKey('proof-pick')));
      expect(find.text('lic-receipt.pdf'), findsOneWidget);
      await tap(tester, find.text('Submit for review'));
      expect(server.uploadFileName, 'lic-receipt.pdf');
      expect(server.uploadFields, {'amountPaise': '2840000'});
      expect(find.text('Upload proof'), findsNothing);
      expect(
        find.byKey(const ValueKey('proof-upload-lifeInsurance')),
        findsNothing,
      );
      expect(find.text('In review'), findsNWidgets(2));

      // An approved one opens to show what was sent.
      await tester.pump(const Duration(seconds: 6));
      await settle(tester);
      await tap(tester, find.byKey(const ValueKey('proof-view-ppf')));
      expect(find.text('Amount on proof'), findsOneWidget);
      expect(find.text('ppf-proof.pdf'), findsOneWidget);
      await capture(tester, payroll(), 'proof_view_sheet');
    });

    testWidgets('closed: what never made it, and what can still be done', (
      tester,
    ) async {
      registerSupportTicketOpener(opener);
      await pumpPayroll(
        tester,
        server: FakePayrollServer()..proofsClosed = true,
      );
      await openProofs(tester);
      expect(find.text('Proofs closed on 31 Jan'), findsOneWidget);
      // Life insurance and rent never sent, home loan sent back.
      expect(find.text('3 of 6 proofs weren’t submitted'), findsOneWidget);
      expect(find.text('Closed'), findsOneWidget);
      // What counted: sent proofs proved, the rest not, for the year.
      expect(find.text('WHAT COUNTED'), findsOneWidget);
      expect(find.text('DECLARED ITEM'), findsOneWidget);
      expect(find.text('NOT PROVED'), findsOneWidget);
      expect(find.text('Rent (HRA)'), findsOneWidget);
      expect(find.text('₹1,80,000'), findsOneWidget);
      expect(find.text('₹1,25,000'), findsOneWidget); // proved
      expect(find.text('₹4,08,400'), findsOneWidget); // not proved
      expect(
        find.text(
          'Your PF (₹21,600), standard deduction and approved FBP bills '
          'still count. They don’t need proofs.',
        ),
        findsOneWidget,
      );
      // Nothing can go up any more.
      expect(find.text('Upload'), findsNothing);
      expect(find.text('Re-upload proof'), findsNothing);
      await capture(tester, payroll(), 'proofs_closed');

      await tester.drag(find.byType(ListView).first, const Offset(0, -600));
      await settle(tester);
      expect(find.text('WHAT YOU CAN STILL DO'), findsOneWidget);
      expect(find.text('Claim it back when you file'), findsOneWidget);
      expect(
        find.text(
          'The extra tax isn’t lost. Claim these in your return by '
          '31 Jul 2027 with the same documents, and get it back as a refund. '
          'Your Form 16 will show only the proved items.',
        ),
        findsOneWidget,
      );
      expect(find.text('Have the proofs now?'), findsOneWidget);
      expect(
        find.text('Ask HR if they can still accept them for March pay'),
        findsOneWidget,
      );
      // HR first, then the claim (Figma 4484:73877).
      expect(
        tester.getTopLeft(find.text('Have the proofs now?')).dy,
        lessThan(
          tester.getTopLeft(find.text('Claim it back when you file')).dy,
        ),
      );
      await capture(tester, payroll(), 'proofs_closed_scrolled');

      await tap(tester, find.byKey(const ValueKey('proofs-ask-hr')));
      expect(opened, hasLength(1));
      expect(opened.single, contains('FY 2026-27'));
      expect(opened.single, contains('by 31 Jan'));
      expect(opened.single, contains('for March pay'));
    });

    testWidgets('closed with every proof in: all counted, nothing left to do', (
      tester,
    ) async {
      final server = FakePayrollServer()..proofsClosed = true;
      server.proofStatus.updateAll((_, _) => 'approved');
      await pumpPayroll(tester, server: server);
      await openProofs(tester);
      expect(find.text('All 6 proofs were submitted'), findsOneWidget);
      expect(find.text('WHAT COUNTED'), findsOneWidget);
      expect(find.text('₹5,33,400'), findsOneWidget); // all proved
      expect(find.text('₹0'), findsOneWidget); // nothing not proved
      await tester.drag(find.byType(ListView).first, const Offset(0, -600));
      await settle(tester);
      expect(find.text('WHAT YOU CAN STILL DO'), findsNothing);
      expect(find.text('Have the proofs now?'), findsNothing);
    });

    testWidgets('rent: the year\'s amount and the landlord PAN', (
      tester,
    ) async {
      final server = await pumpPayroll(tester);
      await openProofs(tester);
      await tap(tester, find.byKey(const ValueKey('proof-upload-rentMonthly')));
      expect(
        find.text('Rent · Rent receipts or the rent agreement'),
        findsOneWidget,
      );
      final amount = tester.widget<TextField>(
        find.byKey(const ValueKey('proof-amount')),
      );
      expect(amount.controller!.text, '₹1,80,000');
      expect(find.text('Landlord PAN'), findsOneWidget);
      await tap(tester, find.byKey(const ValueKey('proof-pick')));
      InkWell submit() => tester.widget<InkWell>(
        find
            .ancestor(
              of: find.text('Submit for review'),
              matching: find.byType(InkWell),
            )
            .first,
      );
      await tester.enterText(
        find.byKey(const ValueKey('proof-landlord-pan')),
        'abcde1234',
      );
      await tester.pump();
      expect(find.byKey(const ValueKey('proof-pan-error')), findsOneWidget);
      expect(submit().onTap, isNull);
      await tester.enterText(
        find.byKey(const ValueKey('proof-landlord-pan')),
        'abcde1234f',
      );
      await tester.pump();
      expect(find.byKey(const ValueKey('proof-pan-error')), findsNothing);
      await capture(tester, payroll(), 'proof_rent_sheet');
      await tap(tester, find.text('Submit for review'));
      expect(server.uploadFields, {
        'amountPaise': '18000000',
        'landlordPan': 'ABCDE1234F',
      });
      expect(
        find.byKey(const ValueKey('proof-upload-rentMonthly')),
        findsNothing,
      );
    });

    testWidgets('the sheet\'s × closes it without sending', (tester) async {
      final server = await pumpPayroll(tester);
      await openProofs(tester);
      await tap(
        tester,
        find.byKey(const ValueKey('proof-upload-lifeInsurance')),
      );
      expect(find.text('Upload proof'), findsOneWidget);
      await tap(tester, find.byKey(const ValueKey('proof-sheet-close')));
      expect(find.text('Upload proof'), findsNothing);
      expect(server.uploadFields, isNull);
      expect(
        find.byKey(const ValueKey('proof-upload-lifeInsurance')),
        findsOneWidget,
      );
    });

    testWidgets('no due date set: says so, nothing to upload yet', (
      tester,
    ) async {
      await pumpPayroll(
        tester,
        server: FakePayrollServer()..proofsDueSet = false,
      );
      await openProofs(tester);
      expect(find.byKey(const ValueKey('proofs-not-set-up')), findsOneWidget);
      expect(find.textContaining('Last date to upload'), findsNothing);
      expect(find.text('Upload'), findsNothing);
      expect(find.text('Not uploaded'), findsNWidgets(2));
      expect(find.text('Re-upload proof'), findsNothing);
    });
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
  }, skip: true); // Payslips open from Downloads (R5) once it lands.

  testWidgets('a payslip with overtime shows it as an earning', (tester) async {
    await pumpPayroll(
      tester,
      server: FakePayrollServer()..overtimePaise = 125000,
    );
    await tap(tester, find.byKey(const ValueKey('payroll-payslips')));
    await tap(tester, find.text('August 2026'));
    expect(find.text('Overtime'), findsOneWidget);
    expect(find.text('₹1,250'), findsOneWidget);
  }, skip: true); // Payslips open from Downloads (R5) once it lands.

  group('R1 Payroll home: the summary carousel', () {
    Finder card(String key) => find.byKey(ValueKey(key));

    /// The carousel's horizontal scroll offset.
    double offset(WidgetTester tester) => tester
        .state<ScrollableState>(
          find.descendant(
            of: find.byKey(const ValueKey('payroll-carousel')),
            matching: find.byType(Scrollable),
          ),
        )
        .position
        .pixels;

    /// Which dot is the wide one.
    int activeDot(WidgetTester tester) {
      for (var i = 0; i < 3; i++) {
        final dot = find.descendant(
          of: find.byKey(ValueKey('payroll-dot-$i')),
          matching: find.byType(AnimatedContainer),
        );
        if (dot.evaluate().isNotEmpty && tester.getSize(dot).width == 18) {
          return i;
        }
      }
      return -1;
    }

    /// The card in view sits on the list's 16 px margin.
    void inView(WidgetTester tester, String key) {
      expect(tester.getTopLeft(card(key)).dx, 16, reason: '$key in view');
      expect(tester.getSize(card(key)).width, 358);
    }

    Future<void> slideDone(WidgetTester tester) async {
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
    }

    testWidgets('three cards with the server\'s numbers', (tester) async {
      await pumpPayroll(tester);
      // 1 · last period's salary, an estimate.
      expect(find.text('OCTOBER SALARY'), findsOneWidget);
      expect(
        find.descendant(
          of: card('payroll-card-salary'),
          matching: find.text('Estimate'),
        ),
        findsOneWidget,
      );
      expect(find.text('29 of 31 days paid'), findsOneWidget);
      expect(find.text('₹1,24,000'), findsOneWidget); // gross, in the donut
      expect(find.text('gross'), findsOneWidget);
      expect(find.text('Take-home'), findsOneWidget);
      expect(find.text('₹1,06,400'), findsOneWidget);
      expect(find.text('Deductions'), findsOneWidget);
      expect(find.text('₹9,600'), findsOneWidget);
      expect(find.text('Loss of pay · 2 days'), findsOneWidget);
      expect(find.text('₹8,000'), findsOneWidget);
      expect(find.text('See breakdown'), findsOneWidget);
      // 2 · tax this FY.
      expect(find.text('TAX · FY 2026–27'), findsOneWidget);
      expect(find.text('New regime'), findsOneWidget);
      expect(find.text('₹58,400'), findsOneWidget);
      expect(find.text('paid so far'), findsOneWidget);
      expect(find.text('April to October'), findsOneWidget);
      // The latest paid months, newest first (Figma 4506:23826).
      Finder inMonth(String key, String text) => find.descendant(
        of: find.byKey(ValueKey(key)),
        matching: find.text(text),
      );
      expect(inMonth('payroll-tax-month-2026-10', 'October'), findsOneWidget);
      expect(inMonth('payroll-tax-month-2026-10', '₹7,600'), findsOneWidget);
      expect(inMonth('payroll-tax-month-2026-9', 'September'), findsOneWidget);
      expect(inMonth('payroll-tax-month-2026-9', '₹7,800'), findsOneWidget);
      expect(
        tester
            .getTopLeft(find.byKey(const ValueKey('payroll-tax-month-2026-10')))
            .dy,
        lessThan(
          tester
              .getTopLeft(
                find.byKey(const ValueKey('payroll-tax-month-2026-9')),
              )
              .dy,
        ),
      );
      expect(find.text('This month (October)'), findsNothing);
      expect(find.text('See tax details'), findsOneWidget);
      // 3 · the split by head, and what is not assigned.
      expect(find.text('FBP'), findsOneWidget);
      expect(find.text('Your split'), findsOneWidget);
      expect(find.text('₹6,000'), findsOneWidget);
      expect(find.text('a month'), findsOneWidget);
      expect(find.text('Fuel & vehicle'), findsOneWidget);
      expect(find.text('₹2,500'), findsOneWidget);
      expect(find.text('Internet'), findsOneWidget);
      expect(find.text('Telephone'), findsOneWidget);
      expect(find.text('₹1,000'), findsNWidgets(2));
      expect(find.text('Books & periodicals'), findsNothing); // nothing on it
      expect(find.text('Not assigned'), findsOneWidget);
      expect(find.text('₹1,500'), findsOneWidget);
      expect(find.text('Upload bills'), findsOneWidget);
      // Below: the to-dos with their count, three quick actions, the desk
      // (on a taller screen, so the list builds them all).
      tester.view.physicalSize = const Size(390 * 2, 1400 * 2);
      await tester.pump();
      expect(
        find.descendant(
          of: card('payroll-todo-count'),
          matching: find.text('4'),
        ),
        findsOneWidget,
      );
      expect(find.text('by 30 Nov'), findsWidgets);
      for (final text in [
        'Earnings',
        'Annual',
        'Downloads',
        // Form 16 hidden: the home sends no switch.
        'Payslips',
        // Tax in EPF's place; EPF is hidden for now.
        'Tax details',
        'Support desk',
        'Ask about pay, tax or FBP',
        'Raise a ticket',
      ]) {
        expect(find.text(text), findsOneWidget, reason: text);
      }
      // The order the design draws: carousel, to-dos, quick actions, desk.
      double top(Finder f) => tester.getTopLeft(f).dy;
      expect(
        top(card('payroll-card-salary')),
        lessThan(top(card('payroll-todo-missing_punches'))),
      );
      expect(
        top(card('payroll-todo-investment_proofs')),
        lessThan(top(card('payroll-qa-earnings'))),
      );
      expect(
        top(card('payroll-qa-earnings')),
        lessThan(top(card('payroll-raise-ticket'))),
      );
      expect(top(card('payroll-qa-earnings')), top(card('payroll-qa-tax')));
      expect(find.byKey(const ValueKey('payroll-qa-epf')), findsNothing);
      expect(find.text('PF balance'), findsNothing);
    });

    group('Set up your payroll (Figma 4471:66940)', () {
      final opened = <String?>[];
      void opener({String? about}) => opened.add(about);
      setUp(() {
        opened.clear();
        registerSupportTicketOpener(opener);
      });
      tearDown(() => unregisterSupportTicketOpener(opener));

      Map<String, dynamic> newJoiner() => {
        'items': [
          {
            'key': 'bank',
            'done': false,
            'dueOn': '2026-10-28',
            'required': true,
          },
          {
            'key': 'pan',
            'done': false,
            'dueOn': '2026-10-28',
            'required': true,
          },
          {
            'key': 'regime',
            'done': false,
            'dueOn': '2026-11-30',
            'required': false,
          },
          {
            'key': 'fbp',
            'done': false,
            'dueOn': '2026-11-15',
            'required': false,
          },
          {
            'key': 'uan',
            'done': true,
            'dueOn': '2026-10-28',
            'required': false,
          },
        ],
        'done': 1,
        'total': 5,
        'beforeFirstPayroll': true,
      };

      testWidgets('the checklist: progress, a row each, dates, the done tick', (
        tester,
      ) async {
        await pumpPayroll(
          tester,
          server: FakePayrollServer()..setup = newJoiner(),
        );
        tester.view.physicalSize = const Size(390 * 2, 1600 * 2);
        await tester.pump();
        expect(find.text('SET UP YOUR PAYROLL'), findsOneWidget);
        expect(
          find.descendant(
            of: card('payroll-setup-count'),
            matching: find.text('4'),
          ),
          findsOneWidget,
        );
        expect(find.text('1 of 5 done'), findsOneWidget);
        expect(find.text('Before your first payroll'), findsOneWidget);
        for (final text in [
          'Add bank account',
          'Needed to pay your salary',
          'Add PAN',
          'Tax is cut at 20% without it',
          'Choose tax regime',
          'New regime applies if you skip',
          'Declare your FBP',
          'Save tax on ₹6,000 a month',
          'Link PF account (UAN)',
        ]) {
          expect(find.text(text), findsOneWidget, reason: text);
        }
        expect(find.text('28 Oct'), findsNWidgets(2));
        expect(find.text('30 Nov'), findsOneWidget);
        expect(find.text('15 Nov'), findsOneWidget);
        // UAN is done: struck through, a tick, no date or line under it.
        expect(
          find.descendant(
            of: card('payroll-setup-uan'),
            matching: find.byKey(const ValueKey('payroll-setup-done')),
          ),
          findsOneWidget,
        );
        expect(find.text('So your PF reaches your account'), findsNothing);
        final uan = tester.widget<Text>(find.text('Link PF account (UAN)'));
        expect(uan.style?.decoration, TextDecoration.lineThrough);
        // The regime and the split are rows of the checklist, not to-dos too;
        // the other to-dos still show.
        expect(card('payroll-todo-tax_regime'), findsNothing);
        expect(card('payroll-todo-flexible_split'), findsNothing);
        expect(card('payroll-todo-missing_punches'), findsOneWidget);
        double top(Finder f) => tester.getTopLeft(f).dy;
        expect(
          top(card('payroll-setup')),
          lessThan(top(card('payroll-todo-missing_punches'))),
        );
        expect(
          top(card('payroll-todo-missing_punches')),
          lessThan(top(card('payroll-qa-earnings'))),
        );
        await capture(tester, payroll(), 'payroll_home_setup');
      });

      testWidgets('bank and PAN ask HR in a ticket; the regime opens the tax '
          'declaration', (tester) async {
        await pumpPayroll(
          tester,
          server: FakePayrollServer()..setup = newJoiner(),
        );
        await tap(tester, card('payroll-setup-bank'));
        await tap(tester, card('payroll-setup-pan'));
        expect(opened, [
          'Please add my bank account for payroll so my salary can be paid.',
          'Please add my PAN for payroll.',
        ]);
        await tap(tester, card('payroll-setup-regime'));
        expect(find.byKey(const ValueKey('payroll-home')), findsNothing);
      });

      testWidgets('all done: no checklist, the to-dos as before', (
        tester,
      ) async {
        final all = newJoiner();
        for (final item in all['items'] as List) {
          (item as Map)['done'] = true;
        }
        all['done'] = 5;
        await pumpPayroll(tester, server: FakePayrollServer()..setup = all);
        expect(find.text('SET UP YOUR PAYROLL'), findsNothing);
        expect(card('payroll-todo-tax_regime'), findsOneWidget);
      });
    });

    testWidgets('a released payslip has no Estimate tag', (tester) async {
      await pumpPayroll(
        tester,
        server: FakePayrollServer()..lastSalaryReleased = true,
      );
      expect(find.text('OCTOBER SALARY'), findsOneWidget);
      expect(find.text('Estimate'), findsNothing);
      expect(find.text('₹1,06,400'), findsOneWidget);
    });

    testWidgets('no tax rules: the tax card says so, with no figures', (
      tester,
    ) async {
      await pumpPayroll(
        tester,
        server: FakePayrollServer()..taxRulesSetUp = false,
      );
      expect(
        find.descendant(
          of: card('payroll-card-tax'),
          matching: find.text('Not set up'),
        ),
        findsOneWidget,
      );
      expect(find.text('paid so far'), findsNothing);
      expect(
        find.textContaining('tax rules for FY 2026-27 are not set up'),
        findsOneWidget,
      );
    });

    testWidgets('it moves on every 4 s, wrapping round', (tester) async {
      await pumpPayroll(tester);
      inView(tester, 'payroll-card-salary');
      expect(activeDot(tester), 0);
      await capture(tester, payroll(), 'payroll_home_card_salary');

      await tester.pump(const Duration(seconds: 4));
      await slideDone(tester);
      inView(tester, 'payroll-card-tax');
      expect(activeDot(tester), 1);
      expect(offset(tester), 374);
      await capture(tester, payroll(), 'payroll_home_card_tax');

      await tester.pump(const Duration(seconds: 4));
      await slideDone(tester);
      inView(tester, 'payroll-fbp');
      expect(activeDot(tester), 2);
      await capture(tester, payroll(), 'payroll_home_card_fbp');

      await tester.pump(const Duration(seconds: 4));
      await slideDone(tester);
      inView(tester, 'payroll-card-salary');
      expect(activeDot(tester), 0);
    });

    testWidgets('a swipe moves one card; a short one springs back', (
      tester,
    ) async {
      await pumpPayroll(tester);
      final carousel = find.byKey(const ValueKey('payroll-carousel'));
      await tester.drag(carousel, const Offset(-120, 0));
      await slideDone(tester);
      inView(tester, 'payroll-card-tax');
      expect(activeDot(tester), 1);

      await tester.drag(carousel, const Offset(-120, 0));
      await slideDone(tester);
      inView(tester, 'payroll-fbp');
      // Nothing past the last card.
      await tester.drag(carousel, const Offset(-120, 0));
      await slideDone(tester);
      inView(tester, 'payroll-fbp');

      await tester.drag(carousel, const Offset(20, 0));
      await slideDone(tester);
      inView(tester, 'payroll-fbp');

      await tester.drag(carousel, const Offset(120, 0));
      await slideDone(tester);
      inView(tester, 'payroll-card-tax');
      expect(activeDot(tester), 1);

      // A swipe starts the 4 s again: 3 s on, still on Tax.
      await tester.pump(const Duration(seconds: 3));
      await slideDone(tester);
      inView(tester, 'payroll-card-tax');
    });

    testWidgets('a dot picks its card', (tester) async {
      await pumpPayroll(tester);
      await tester.tap(find.byKey(const ValueKey('payroll-dot-2')));
      await slideDone(tester);
      inView(tester, 'payroll-fbp');
      expect(activeDot(tester), 2);
      await tester.tap(find.byKey(const ValueKey('payroll-dot-0')));
      await slideDone(tester);
      inView(tester, 'payroll-card-salary');
      expect(activeDot(tester), 0);
    });

    testWidgets('cards, to-dos and tiles open their pages', (tester) async {
      await pumpPayroll(tester);
      Future<void> opens(Finder from, String page) async {
        await tap(tester, from);
        expect(find.byKey(ValueKey(page)), findsOneWidget, reason: page);
        Navigator.of(tester.element(find.byKey(ValueKey(page)))).pop();
        await settle(tester);
        expect(find.byKey(const ValueKey('payroll-home')), findsOneWidget);
      }

      await opens(card('payroll-card-salary'), 'payroll-salary');
      await opens(card('payroll-card-tax'), 'payroll-tax');
      await opens(card('payroll-fbp'), 'payroll-split');
      await opens(card('payroll-todo-tax_regime'), 'payroll-declaration');
      await opens(card('payroll-todo-investment_proofs'), 'payroll-proofs');
      await opens(card('payroll-todo-flexible_split'), 'payroll-split');
      await opens(card('payroll-qa-earnings'), 'payroll-earnings');
      await opens(card('payroll-qa-downloads'), 'payroll-downloads');
      await opens(card('payroll-qa-tax'), 'payroll-tax');
      await opens(
        card('payroll-todo-missing_punches'),
        'payroll-missed-punches',
      );
    });

    group('the Form 16 switch', () {
      for (final (name, flag) in [
        ('not sent (an older server)', null),
        ('off', false),
      ]) {
        testWidgets('$name: Downloads is payslips only', (tester) async {
          final server = FakePayrollServer()..form16Enabled = flag;
          await pumpPayroll(tester, server: server);
          tester.view.physicalSize = const Size(390 * 2, 1400 * 2);
          await tester.pump();
          expect(
            find.descendant(
              of: card('payroll-qa-downloads'),
              matching: find.text('Payslips'),
            ),
            findsOneWidget,
          );
          expect(find.text('Payslips, F-16'), findsNothing);
          await tap(tester, card('payroll-qa-downloads'));
          expect(
            find.byKey(const ValueKey('payroll-downloads')),
            findsOneWidget,
          );
          expect(find.byKey(const ValueKey('downloads-tabs')), findsNothing);
          expect(find.text('Form 16'), findsNothing);
          expect(server.calls, isNot(contains('GET /payroll/form16')));
        });
      }

      testWidgets('on: "Payslips, F-16" and the Form 16 tab', (tester) async {
        final server = FakePayrollServer()..form16Enabled = true;
        await pumpPayroll(tester, server: server);
        tester.view.physicalSize = const Size(390 * 2, 1400 * 2);
        await tester.pump();
        expect(find.text('Payslips, F-16'), findsOneWidget);
        await tap(tester, card('payroll-qa-downloads'));
        expect(find.byKey(const ValueKey('downloads-tabs')), findsOneWidget);
        expect(find.text('Form 16'), findsOneWidget);
      });
    });
  });

  group('Missed punches (Figma 4473:67442)', () {
    String ymd(DateTime day) =>
        '${day.year}-${day.month.toString().padLeft(2, '0')}-'
        '${day.day.toString().padLeft(2, '0')}';
    final thisMonth = DateTime(DateTime.now().year, DateTime.now().month);
    final lastMonth = DateTime(thisMonth.year, thisMonth.month - 1);
    String period(DateTime month) =>
        '${month.year}-${month.month.toString().padLeft(2, '0')}';
    DateTime day(int d) => DateTime(thisMonth.year, thisMonth.month, d);
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    Map<String, dynamic> missed(
      DateTime date, {
      DateTime? punchIn,
      bool canFix = true,
      String? closedReason,
      String? closedMessage,
      String? request,
    }) => {
      'date': ymd(date),
      'weekday': weekdays[date.weekday - 1],
      'punchIn': punchIn?.toUtc().toIso8601String(),
      'punchOut': null,
      'trigger': punchIn == null ? 'Both punches missing' : 'Missing punch-out',
      'status': punchIn == null ? 'absent' : 'missed_punch',
      'label': punchIn == null ? 'Absent' : 'Missed Punch',
      'countsAs': punchIn == null ? null : 'Half Day',
      'fixBy': canFix ? ymd(date.add(const Duration(days: 7))) : null,
      'canFix': canFix,
      'closedReason': closedReason,
      'closedMessage': closedMessage,
      'request': request == null ? null : {'id': 'r1', 'status': request},
    };

    /// Four days, sent out of order: two to fix (one punched in at
    /// 10:02 AM), one already sent, one past its window.
    FakePayrollServer server() => FakePayrollServer()
      ..missingCount = 2
      ..missingDays = [
        missed(
          day(5),
          punchIn: DateTime(thisMonth.year, thisMonth.month, 5, 10, 2),
        ),
        missed(day(1)),
        missed(day(3), request: 'pending'),
        missed(
          day(2),
          canFix: false,
          closedReason: 'window_closed',
          closedMessage: 'The time to fix this day has passed',
        ),
      ];

    Finder dayCard(DateTime date) =>
        find.byKey(ValueKey('missed-punch-${ymd(date)}'));

    Future<void> openPage(WidgetTester tester) async {
      await tap(
        tester,
        find.byKey(const ValueKey('payroll-todo-missing_punches')),
      );
      expect(find.byKey(const ValueKey('payroll-missed-punches')), findsOne);
    }

    testWidgets('the to-do counts what can be fixed, one punch or many', (
      tester,
    ) async {
      await pumpPayroll(tester, server: FakePayrollServer()..missingCount = 5);
      expect(find.text('Fix 5 missing punches'), findsOneWidget);
      expect(find.text('To avoid loss of pay'), findsOneWidget);
      expect(find.text('Fix 5 unpaid days'), findsNothing);
      // The due pill and the chevron stay, as on the other to-dos.
      final todo = find.byKey(const ValueKey('payroll-todo-missing_punches'));
      expect(
        find.descendant(of: todo, matching: find.textContaining('by ')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: todo,
          matching: find.byIcon(Icons.chevron_right_rounded),
        ),
        findsOneWidget,
      );
    });

    testWidgets('one day to fix reads in the singular', (tester) async {
      await pumpPayroll(tester, server: FakePayrollServer()..missingCount = 1);
      expect(find.text('Fix 1 missing punch'), findsOneWidget);
      expect(find.text('To avoid loss of pay'), findsOneWidget);
    });

    testWidgets('the month, the line under it, a card per day', (tester) async {
      final fake = await pumpPayroll(tester, server: server());
      await openPage(tester);
      expect(
        fake.calls.last,
        'GET /payroll/missing-punches?period=${period(thisMonth)}',
      );
      expect(find.text('Missed punches'), findsOneWidget);
      expect(
        find.text(
          '${const ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][thisMonth.month - 1]} ${thisMonth.year}',
        ),
        findsOneWidget,
      );
      final monthEnd = DateTime(thisMonth.year, thisMonth.month + 1, 0);
      const short = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      expect(
        find.text(
          '2 days to fix by ${monthEnd.day} ${short[monthEnd.month - 1]}',
        ),
        findsOneWidget,
      );
      final note = tester.widget<Text>(
        find.byKey(const ValueKey('missed-punches-note')),
      );
      expect(note.style?.color, const Color(0xFFB3261E));

      // Oldest first, whatever order the server sent.
      final tops = [
        for (final d in [1, 2, 3, 5]) tester.getTopLeft(dayCard(day(d))).dy,
      ];
      expect(tops, orderedEquals([...tops]..sort()));

      // No check-in: NA in red; no check-out: a dash.
      final first = dayCard(day(1));
      expect(find.descendant(of: first, matching: find.text('1')), findsOne);
      expect(
        find.descendant(
          of: first,
          matching: find.text(weekdays[day(1).weekday - 1]),
        ),
        findsOne,
      );
      expect(
        find.descendant(of: first, matching: find.text('Check-in')),
        findsOne,
      );
      expect(
        find.descendant(of: first, matching: find.text('Check-out')),
        findsOne,
      );
      final na = tester.widget<Text>(
        find.descendant(of: first, matching: find.text('NA')),
      );
      expect(na.style?.color, const Color(0xFFC4382E));
      expect(find.descendant(of: first, matching: find.text('—')), findsOne);
      expect(
        find.descendant(
          of: first,
          matching: find.byKey(const ValueKey('missed-punch-chevron')),
        ),
        findsOne,
      );

      // A check-in at 10:02 AM, on the phone's clock.
      final fifth = dayCard(day(5));
      expect(
        find.descendant(of: fifth, matching: find.text('10:02 AM')),
        findsOne,
      );
      expect(
        find.descendant(of: fifth, matching: find.text('NA')),
        findsNothing,
      );

      // Sent for correction: its state, and it still opens.
      final third = dayCard(day(3));
      expect(find.descendant(of: third, matching: find.text('Sent')), findsOne);

      // Past its window: why, and no chevron.
      final closed = dayCard(day(2));
      expect(
        find.descendant(
          of: closed,
          matching: find.text('The time to fix this day has passed'),
        ),
        findsOne,
      );
      expect(
        find.descendant(
          of: closed,
          matching: find.byKey(const ValueKey('missed-punch-chevron')),
        ),
        findsNothing,
      );
      await capture(tester, payroll(), 'missed_punches');
    });

    testWidgets('a day to fix opens its correction; a closed one does not', (
      tester,
    ) async {
      final fixed = <Object?>[];
      final fake = await pumpPayroll(tester, server: server(), fixed: fixed);
      await openPage(tester);
      final reads = fake.calls
          .where((c) => c.contains('missing-punches'))
          .length;

      await tap(tester, dayCard(day(2)));
      expect(fixed, isEmpty);

      await tap(tester, dayCard(day(1)));
      expect(fixed, hasLength(1));
      final sent = fixed.single as MissingPunchDay;
      expect(sent.date, day(1));
      expect(sent.canFix, isTrue);
      expect(sent.punchIn, isNull);
      // Closed again: read once more, for the day's new state.
      expect(
        fake.calls.where((c) => c.contains('missing-punches')).length,
        reads + 1,
      );
    });

    testWidgets('the arrows step the months, never past this one', (
      tester,
    ) async {
      final fake = await pumpPayroll(tester, server: server());
      await openPage(tester);
      final next = find.byKey(const ValueKey('missed-punches-next'));
      expect(tester.widget<InkWell>(next).onTap, isNull);

      await tap(tester, find.byKey(const ValueKey('missed-punches-previous')));
      expect(
        fake.calls.last,
        'GET /payroll/missing-punches?period=${period(lastMonth)}',
      );
      expect(
        find.text(
          '${const ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][lastMonth.month - 1]} ${lastMonth.year}',
        ),
        findsOneWidget,
      );
      expect(tester.widget<InkWell>(next).onTap, isNotNull);

      await tap(tester, next);
      expect(
        fake.calls.last,
        'GET /payroll/missing-punches?period=${period(thisMonth)}',
      );
      expect(tester.widget<InkWell>(next).onTap, isNull);
    });

    testWidgets('nothing to fix: a grey line, and the empty state', (
      tester,
    ) async {
      await pumpPayroll(tester, server: FakePayrollServer()..missingCount = 0);
      await openPage(tester);
      final note = tester.widget<Text>(
        find.byKey(const ValueKey('missed-punches-note')),
      );
      expect(note.data, 'Nothing to fix');
      expect(note.style?.color, const Color(0xFF8E8E95));
      expect(find.text('No missed punches this month.'), findsOneWidget);
    });
  });

  testWidgets('Actions › Payroll › Missed punches › a day\'s correction', (
    tester,
  ) async {
    phone(tester);
    final payrollServer = FakePayrollServer()
      ..missingCount = _missedDays().length
      ..missingDays = [
        for (final day in _missedDays())
          {
            'date': _ymd(day),
            'punchIn': _at(day, 9, 24),
            'punchOut': null,
            'trigger': 'Missing punch-out',
            'status': 'missed_punch',
            'label': 'Missed Punch',
            'fixBy': _ymd(day.add(const Duration(days: 31))),
            'canFix': true,
            'request': null,
          },
      ];
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
    // Payroll's own page now, not the Attendance list.
    expect(find.byKey(const ValueKey('payroll-missed-punches')), findsOne);
    expect(find.byKey(const ValueKey('calendar')), findsNothing);
    final missed = _missedDays();
    await capture(tester, actions, 'missing_punches');

    // A day opens the correction form the Attendance list would.
    if (missed.isNotEmpty) {
      await tap(
        tester,
        find.byKey(ValueKey('missed-punch-${_ymd(missed.first)}')),
      );
      expect(find.text('Request Correction'), findsOneWidget);
      expect(find.text('What should this day be?'), findsOneWidget);
      await capture(tester, find.byType(MaterialApp), 'missing_punches_day');
      Navigator.of(tester.element(find.text('What should this day be?'))).pop();
      await settle(tester);
      expect(find.byKey(const ValueKey('payroll-missed-punches')), findsOne);
    }

    // Back returns to Payroll, then the Actions home.
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
