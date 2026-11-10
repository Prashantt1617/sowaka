// Actions › Payroll › EPF against its own fake server: the PF saved through
// Sowaka and the monthly split, a PF balance from the EPFO passbook (shown,
// added, updated), the UAN copied on the EPFO sheets and the links they open,
// the "not set up" line, and the "PF isn't deducted" state. Every figure is
// invented; the org is sowaka. A layout that overflows fails the test.
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

String _day(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-'
    '${d.month.toString().padLeft(2, '0')}-'
    '${d.day.toString().padLeft(2, '0')}';

/// GET /payroll/me/epf and PUT /payroll/me/epf/balance, from memory.
class _FakeEpfServer {
  bool enrolled = true;
  String? notEnrolledReason;
  String? uan = '101234567890';
  bool statutorySetUp = true;

  /// The stored passbook balance: rupees and "as on" day; null for none.
  ({int rupees, String asOn, String source})? balance;

  /// PF payroll put in after the balance's date.
  int addedSincePaise = 0;

  final calls = <String>[];
  Map<String, dynamic>? lastPut;

  Map<String, dynamic> _epf() => {
    'enrolled': enrolled,
    'notEnrolledReason': enrolled ? null : notEnrolledReason,
    'uan': uan,
    'uanLast4': uan?.substring(8),
    'uanOnRecord': uan != null,
    'savedThroughSowaka': {
      'employeePaise': enrolled ? 1080000 : 0,
      'employerEpfPaise': enrolled ? 330000 : 0,
      'months': enrolled ? 6 : 0,
      'sincePeriod': enrolled ? '2026-04' : null,
      'throughPeriod': enrolled ? '2026-09' : null,
    },
    'balance': switch (balance) {
      null => null,
      final b => {
        'balancePaise': b.rupees * 100,
        'asOn': b.asOn,
        'source': b.source,
        'updatedAt': '2026-10-01T06:00:00.000Z',
        'addedSincePaise': addedSincePaise,
        'totalPaise': b.rupees * 100 + addedSincePaise,
      },
    },
    'monthly': enrolled && statutorySetUp
        ? {
            'period': '2026-10',
            'employeePaise': 180000,
            'employerEpfPaise': 55000,
            'employerEpsPaise': 125000,
            'pfWagePaise': 1500000,
            'ratePercent': 12,
            'employerRatePercent': 12,
          }
        : null,
    'notSetUp': enrolled && !statutorySetUp
        ? {
            'reason': 'statutory_not_set_up',
            'fy': '2026-27',
            'message':
                'Your monthly PF can\'t be worked out yet: the statutory '
                'settings (PF, ESI, professional tax) for FY 2026-27 are not '
                'set up. Ask HR.',
          }
        : null,
  };

  Future<http.Response> handle(http.Request request) async {
    final path = request.url.path;
    calls.add('${request.method} $path');
    if (request.method == 'GET' && path == '/payroll/me/epf') {
      return _json({'success': true, 'epf': _epf()});
    }
    if (request.method == 'PUT' && path == '/payroll/me/epf/balance') {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      lastPut = body;
      balance = (
        rupees: (body['balancePaise'] as int) ~/ 100,
        asOn: body['asOn'] as String,
        source: 'employee',
      );
      addedSincePaise = 0;
      return _json({'success': true, 'epf': _epf()});
    }
    return _json({'success': false, 'message': 'Route not found'}, 404);
  }
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

  final opened = <Uri>[];
  final copied = <String>[];
  late Future<bool> Function(Uri) realOpen;

  setUp(() {
    opened.clear();
    copied.clear();
    realOpen = payrollOpenExternal;
    payrollOpenExternal = (uri) async {
      opened.add(uri);
      return true;
    };
  });
  tearDown(() => payrollOpenExternal = realOpen);

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 3; i++) {
      await tester.pump();
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 60)),
      );
    }
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 100));
  }

  Future<_FakeEpfServer> pumpEpf(
    WidgetTester tester, [
    _FakeEpfServer? server,
  ]) async {
    tester.view.physicalSize = const Size(390 * 2, 844 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied.add((call.arguments as Map)['text'] as String);
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    final fake = server ?? _FakeEpfServer();
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
        home: Scaffold(
          body: PayrollEpfPreview(
            screen: PayrollScreen(
              api: PayrollApiService(
                session: _session,
                baseUrl: 'https://example.test',
                client: MockClient(fake.handle),
              ),
              onClose: () {},
              profileAction: const SizedBox(width: 30, height: 30),
              onNotifications: () {},
              onQuickCreate: () {},
              onFixMissingPunches: (_) {},
            ),
          ),
        ),
      ),
    );
    await settle(tester);
    return fake;
  }

  /// `--update-goldens --dart-define=SCREENSHOTS=<dir>` writes the screen to
  /// <dir> as a 390×844 PNG; otherwise nothing.
  Future<void> capture(WidgetTester tester, String name) async {
    if (_screenshots.isEmpty) return;
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(Uri.file('$_screenshots/$name.png')),
    );
  }

  Future<void> tap(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.pump();
    await tester.tap(finder);
    await settle(tester);
  }

  String text(WidgetTester tester, String key) =>
      tester.widget<Text>(find.byKey(ValueKey(key))).data!;

  testWidgets('enrolled: PF saved through Sowaka, UAN and the monthly split', (
    tester,
  ) async {
    final server = await pumpEpf(tester);
    expect(server.calls, ['GET /payroll/me/epf']);
    expect(find.text('EPF'), findsWidgets);
    expect(find.text('PF SAVED THROUGH SOWAKA'), findsOneWidget);
    expect(find.text('Since Apr 2026'), findsOneWidget);
    // Employee ₹10,800 + employer EPF ₹3,300 over six payslips.
    expect(text(tester, 'epf-hero'), '₹14,100');
    expect(text(tester, 'epf-uan'), 'UAN 1012 3456 7890');
    expect(
      find.text(
        'Your full balance, with interest and past employers, is on '
        'EPFO.',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('epf-add-balance')), findsOneWidget);
    expect(find.text('EVERY MONTH'), findsOneWidget);
    expect(find.text('You put in'), findsOneWidget);
    expect(text(tester, 'epf-monthly-0'), '₹1,800');
    expect(find.text('Employer puts in'), findsOneWidget);
    expect(text(tester, 'epf-monthly-1'), '₹550');
    expect(find.text('Employer to pension (EPS)'), findsOneWidget);
    expect(text(tester, 'epf-monthly-2'), '₹1,250');
    expect(
      text(tester, 'epf-monthly-note'),
      '12% of ₹15,000 from you. Your employer\'s 12% is split between PF '
      'and pension.',
    );
    expect(find.text('MANAGE ON EPFO'), findsOneWidget);
    for (final name in ['Passbook', 'Nominee', 'Transfer an old PF account']) {
      expect(find.text(name), findsOneWidget);
    }
    expect(find.text('See every PF credit and interest'), findsOneWidget);
    expect(find.text('Add or change who gets your PF'), findsOneWidget);
    expect(find.byKey(const ValueKey('epf-not-enrolled')), findsNothing);
    await capture(tester, 'epf-saved');
  });

  testWidgets('a balance from the passbook, with what payroll added since', (
    tester,
  ) async {
    await pumpEpf(
      tester,
      _FakeEpfServer()
        ..balance = (rupees: 230000, asOn: '2025-09-30', source: 'hr')
        ..addedSincePaise = 235000,
    );
    expect(find.text('PF BALANCE'), findsOneWidget);
    expect(find.text('As on 30 Sep 2025'), findsOneWidget);
    expect(text(tester, 'epf-hero'), '₹2,32,350');
    expect(
      text(tester, 'epf-added-since'),
      '+ ₹2,350 added through payroll since 30 Sep 2025',
    );
    expect(find.textContaining('added by HR'), findsOneWidget);
    expect(find.byKey(const ValueKey('epf-update-balance')), findsOneWidget);
    expect(find.text('PF SAVED THROUGH SOWAKA'), findsNothing);
    await capture(tester, 'epf-balance');
  });

  testWidgets('adding the balance from the card', (tester) async {
    final server = await pumpEpf(tester);
    await tap(tester, find.byKey(const ValueKey('epf-add-balance')));
    expect(find.text('Add your PF balance'), findsOneWidget);
    expect(
      find.textContaining('Copy the total from your EPFO passbook'),
      findsOneWidget,
    );
    await tester.enterText(
      find.byKey(const ValueKey('epf-balance-amount')),
      '230000',
    );
    await tester.pump();
    await capture(tester, 'epf-balance-sheet');
    await tap(tester, find.byKey(const ValueKey('epf-balance-save')));
    final now = DateTime.now();
    expect(server.lastPut, {
      'balancePaise': 23000000,
      'asOn': _day(DateTime(now.year, now.month, now.day)),
    });
    expect(find.text('Add your PF balance'), findsNothing);
    expect(find.text('PF BALANCE'), findsOneWidget);
    expect(text(tester, 'epf-hero'), '₹2,30,000');
    expect(find.byKey(const ValueKey('epf-added-since')), findsNothing);
  });

  testWidgets('Passbook: copy the UAN, continue to EPFO, or add the balance', (
    tester,
  ) async {
    await pumpEpf(tester);
    await tap(tester, find.byKey(const ValueKey('epf-link-Passbook')));
    expect(find.text('Open EPFO passbook'), findsOneWidget);
    expect(
      find.text(
        'This opens on the EPFO website. Log in with your UAN, password and '
        'the OTP sent to your phone.',
      ),
      findsOneWidget,
    );
    expect(find.text('Your UAN'), findsOneWidget);
    expect(text(tester, 'epf-sheet-uan'), '1012 3456 7890');
    expect(find.text('Copy'), findsOneWidget);
    await tap(tester, find.byKey(const ValueKey('epf-copy-uan')));
    await capture(tester, 'epf-passbook-sheet');
    expect(copied, ['101234567890']);
    expect(find.text('Copied'), findsOneWidget);
    await tap(tester, find.byKey(const ValueKey('epf-continue')));
    expect(opened, [
      Uri.parse('https://passbook.epfindia.gov.in/MemberPassBook/login'),
    ]);
    expect(find.text('Open EPFO passbook'), findsNothing);

    // From the passbook sheet straight to the balance.
    await tap(tester, find.byKey(const ValueKey('epf-link-Passbook')));
    await tap(tester, find.byKey(const ValueKey('epf-sheet-add-balance')));
    expect(find.text('Open EPFO passbook'), findsNothing);
    expect(find.text('Add your PF balance'), findsOneWidget);
  });

  testWidgets('Nominee and transfer open the EPFO member portal', (
    tester,
  ) async {
    await pumpEpf(tester);
    await tap(tester, find.byKey(const ValueKey('epf-link-Nominee')));
    expect(find.text('Update nominee on EPFO'), findsOneWidget);
    expect(find.byKey(const ValueKey('epf-sheet-add-balance')), findsNothing);
    await tap(tester, find.byKey(const ValueKey('epf-continue')));
    await tap(
      tester,
      find.byKey(const ValueKey('epf-link-Transfer an old PF account')),
    );
    expect(find.text('Transfer PF on EPFO'), findsOneWidget);
    await tap(tester, find.byKey(const ValueKey('epf-continue')));
    final portal = Uri.parse(
      'https://unifiedportal-mem.epfindia.gov.in/memberinterface/',
    );
    expect(opened, [portal, portal]);
  });

  testWidgets('no UAN on record: said, and nothing to copy', (tester) async {
    await pumpEpf(tester, _FakeEpfServer()..uan = null);
    expect(text(tester, 'epf-uan'), 'UAN not on record yet. Ask HR to add it.');
    await tap(tester, find.byKey(const ValueKey('epf-link-Passbook')));
    expect(text(tester, 'epf-sheet-uan'), 'Not on record yet');
    expect(find.byKey(const ValueKey('epf-copy-uan')), findsNothing);
  });

  testWidgets('the year\'s statutory settings missing: no made-up split', (
    tester,
  ) async {
    await pumpEpf(tester, _FakeEpfServer()..statutorySetUp = false);
    expect(
      find.textContaining('for FY 2026-27 are not set up. Ask HR.'),
      findsOneWidget,
    );
    expect(find.text('You put in'), findsNothing);
    expect(text(tester, 'epf-hero'), '₹14,100');
  });

  testWidgets('not enrolled: PF isn\'t deducted from your salary', (
    tester,
  ) async {
    await pumpEpf(
      tester,
      _FakeEpfServer()
        ..enrolled = false
        ..notEnrolledReason = 'pf_off_for_you',
    );
    expect(find.byKey(const ValueKey('epf-not-enrolled')), findsOneWidget);
    expect(
      find.textContaining('PF isn\'t deducted from your salary'),
      findsOneWidget,
    );
    expect(find.text('EVERY MONTH'), findsNothing);
    await capture(tester, 'epf-not-enrolled');
    expect(find.text('MANAGE ON EPFO'), findsNothing);
    expect(find.byKey(const ValueKey('epf-hero')), findsNothing);
  });

  group('with the Support Desk', () {
    final abouts = <String?>[];
    void opener({String? about}) => abouts.add(about);
    setUp(() {
      abouts.clear();
      registerSupportTicketOpener(opener);
    });
    tearDown(() => unregisterSupportTicketOpener(opener));

    testWidgets('"PF question? Raise a ticket"', (tester) async {
      await pumpEpf(tester);
      // The last thing on the page: scrolled to.
      await tester.scrollUntilVisible(
        find.text('PF question? Raise a ticket'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('PF question? Raise a ticket'), findsOneWidget);
      await tap(tester, find.byKey(const ValueKey('epf-raise-ticket')));
      expect(abouts, ['PF question:']);
    });
  });
}
