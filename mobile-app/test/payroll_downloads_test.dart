// Payroll › Downloads against its own fake server: the Payslips tab (a
// group per FY, a PDF per month, a year's slips in one PDF) and the Form 16
// tab (the filing tip, this FY not ready yet, past FYs to download, a FY HR
// filed as two parts), both empty states, a failed read, and "Can't find a
// document?". A layout that overflows fails the test. Every figure is
// invented; the org is sowaka.
//
// `flutter test --update-goldens --dart-define=SCREENSHOTS=<dir> test/payroll_downloads_test.dart`
// also writes each screen to <dir> as a 390×844 PNG.
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

/// The routes Downloads reads, answered from memory.
class _FakeDownloadsServer {
  /// Released payslips, newest first, as "YYYY-MM" → credited day.
  Map<String, String> slips = {
    '2026-09': '2026-09-30',
    '2026-08': '2026-08-31',
    '2026-03': '2026-03-31',
  };

  /// The Form 16 years the server sends.
  List<Map<String, dynamic>> years = [
    {
      'fy': '2026-27',
      'status': 'pending',
      'readyBy': '2027-06-15',
      'documents': <dynamic>[],
    },
    {
      'fy': '2025-26',
      'status': 'ready',
      'readyBy': '2026-06-15',
      'documents': [
        _doc('f16-2526', '2025-26', 'combined', 'Form16_FY2025-26.pdf'),
      ],
    },
    {
      'fy': '2024-25',
      'status': 'ready',
      'readyBy': '2025-06-15',
      'documents': [
        _doc('f16-2425-a', '2024-25', 'A', 'PartA_2024-25.pdf'),
        _doc('f16-2425-b', '2024-25', 'B', 'PartB_2024-25.pdf'),
      ],
    },
  ];

  /// Form 16 answers 500 while set.
  bool form16Fails = false;

  final calls = <String>[];

  static Map<String, dynamic> _doc(
    String id,
    String fy,
    String part,
    String name,
  ) => {
    'id': id,
    'fy': fy,
    'part': part,
    'fileName': name,
    'size': 120000,
    'uploadedAt': '2026-06-02T10:00:00.000Z',
  };

  MockClient get client => MockClient((request) async {
    final url = request.url;
    calls.add(
      '${request.method} ${url.host == 'files.example.test' ? 'files:' : ''}${url.path}${url.query.isEmpty ? '' : '?${url.query}'}',
    );
    if (url.host == 'files.example.test') {
      // The signed link: no Authorization header goes to storage.
      if (request.headers.containsKey('Authorization')) {
        return http.Response('', 403);
      }
      return http.Response.bytes(
        utf8.encode('%PDF-1.7 ${url.pathSegments.last}'),
        200,
        headers: {'content-type': 'application/pdf'},
      );
    }
    if (url.path == '/payslips/mine') return _json(_payslips());
    if (url.path == '/payroll/form16') {
      if (form16Fails) {
        return _json({
          'success': false,
          'message': 'Form 16 is taking a break.',
        }, 500);
      }
      return _json({
        'success': true,
        'form16': {
          'currentFy': '2026-27',
          'filing': {'fy': '2025-26', 'lastDate': '2026-07-31'},
          'years': years,
        },
      });
    }
    final file = RegExp(r'^/payroll/form16/([^/]+)/file$').firstMatch(url.path);
    if (file != null) {
      final id = file[1]!;
      final doc = years
          .expand((y) => (y['documents'] as List).cast<Map<String, dynamic>>())
          .where((d) => d['id'] == id)
          .firstOrNull;
      if (doc == null) {
        return _json({'success': false, 'message': 'Form 16 not found'}, 404);
      }
      return _json({
        'success': true,
        'url': 'https://files.example.test/form16/$id.pdf?sig=x',
        'fileName': doc['fileName'],
      });
    }
    return _json({'success': false, 'message': 'Route not found'}, 404);
  });

  Map<String, dynamic> _payslips() => {
    'success': true,
    'company': {'name': 'Sowaka', 'address': 'Bengaluru', 'org': 'sowaka'},
    'payslips': [
      for (final MapEntry(key: period, value: paid) in slips.entries)
        {
          'run': {
            'id': 'run-$period',
            'period': period,
            'status': 'paid',
            'paidAt': '${paid}T12:00:00.000Z',
          },
          'payslip': {
            'id': 'slip-$period',
            'period': period,
            'employeeName': 'Tanvi',
            'employeeId': 'SW001',
            'designation': 'Designer',
            'department': 'Product',
            'earnings': [
              {
                'code': 'BASIC',
                'name': 'Basic',
                'fullPaise': 3600000,
                'paidPaise': 3600000,
              },
              {
                'code': 'SPECIAL',
                'name': 'Special allowance',
                'fullPaise': 3600000,
                'paidPaise': 3600000,
              },
            ],
            'deductions': [
              {'key': 'epf', 'name': 'Provident fund', 'amountPaise': 180000},
            ],
            'netPayablePaise': 7020000,
            'reimbursementsPaise': 0,
            'inputs': {
              'workingDays': 30,
              'payableDays': 30,
              'lopDays': 0,
              'overtimePaise': 0,
              'attendanceDeductions': <dynamic>[],
            },
          },
        },
    ],
  };
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

  /// What was handed to the share sheet: (file name, bytes).
  final saved = <(String, Uint8List)>[];
  setUp(saved.clear);

  Future<_FakeDownloadsServer> pumpDownloads(
    WidgetTester tester, {
    _FakeDownloadsServer? server,
    String? startTab,
    List<String>? tickets,
  }) async {
    tester.view.physicalSize = const Size(390 * 2, 844 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final fake = server ?? _FakeDownloadsServer();
    final api = PayrollApiService(
      session: _session,
      baseUrl: 'https://example.test',
      client: fake.client,
    );
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
        home: Scaffold(
          body: PayrollDownloadsScreen(
            startTab: startTab,
            savePdf: (bytes, name) async => saved.add((name, bytes)),
            payroll: PayrollScreen(
              api: api,
              onClose: () {},
              profileAction: const SizedBox(width: 30, height: 30),
              onNotifications: () {},
              onQuickCreate: () {},
              onFixMissingPunches: (_) {},
              onRaiseTicket: () => tickets?.add('desk'),
            ),
          ),
        ),
      ),
    );
    await settle(tester);
    return fake;
  }

  Finder downloads() => find.byType(PayrollDownloadsScreen);

  Future<void> capture(WidgetTester tester, String name) async {
    if (_screenshots.isEmpty) return;
    await expectLater(
      downloads(),
      matchesGoldenFile(Uri.file('$_screenshots/$name.png')),
    );
  }

  /// Taps, then waits (real time: PDFs are drawn and fonts read) until
  /// [done] or a few seconds pass.
  Future<void> tapAndWait(
    WidgetTester tester,
    Finder finder,
    bool Function() done,
  ) async {
    await tester.ensureVisible(finder);
    await tester.pump();
    await tester.tap(finder);
    for (var i = 0; i < 60 && !done(); i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
      await tester.pump();
    }
    await settle(tester);
  }

  /// The download button in a row, by the row's key.
  Finder button(String rowKey) => find.descendant(
    of: find.byKey(ValueKey(rowKey)),
    matching: find.byType(InkWell),
  );

  testWidgets(
    'Payslips: a group per FY, a PDF per month and a year in one PDF',
    (tester) async {
      final server = await pumpDownloads(tester);
      expect(server.calls, ['GET /payslips/mine?limit=24']);
      expect(find.text('Downloads'), findsOneWidget);
      expect(find.text('Payslips'), findsOneWidget);
      expect(find.text('Form 16'), findsOneWidget);
      expect(find.text('FY 2026–27'), findsOneWidget);
      expect(find.text('FY 2025–26'), findsOneWidget);
      expect(find.text('September 2026'), findsOneWidget);
      expect(find.text('Credited 30 Sep · PDF'), findsOneWidget);
      expect(find.text('Credited 31 Aug · PDF'), findsOneWidget);
      expect(find.text('Download all as one PDF'), findsOneWidget);
      expect(find.text('Download FY 2025–26 as one PDF'), findsOneWidget);
      expect(
        find.text('Can\'t find a document? Raise a ticket'),
        findsOneWidget,
      );
      // September and August are this FY's, above last FY's March.
      expect(
        tester.getTopLeft(find.text('August 2026')).dy,
        lessThan(tester.getTopLeft(find.text('FY 2025–26')).dy),
      );
      expect(
        tester.getTopLeft(find.text('March 2026')).dy,
        greaterThan(tester.getTopLeft(find.text('FY 2025–26')).dy),
      );
      expect(
        find.bySemanticsLabel('Download September 2026 payslip'),
        findsOneWidget,
      );
      await capture(tester, 'downloads_payslips');

      await tapAndWait(
        tester,
        button('download-slip-slip-2026-09'),
        () => saved.isNotEmpty,
      );
      expect(saved.map((s) => s.$1), ['payslip-2026-09.pdf']);
      expect(ascii.decode(saved.single.$2.sublist(0, 5)), '%PDF-');

      await tapAndWait(
        tester,
        find.byKey(const ValueKey('download-all-2026-27')),
        () => saved.length > 1,
      );
      expect(saved.map((s) => s.$1), [
        'payslip-2026-09.pdf',
        'payslips-FY2026-27.pdf',
      ]);
      final year = saved.last.$2;
      expect(ascii.decode(year.sublist(0, 5)), '%PDF-');
      // Two months, two pages.
      expect(
        RegExp(r'/Type\s*/Page[^s]').allMatches(latin1.decode(year)).length,
        2,
      );
      expect(find.text('Preparing…'), findsNothing);
    },
  );

  testWidgets('Form 16: the tip, this FY not ready yet, past FYs to download', (
    tester,
  ) async {
    final server = await pumpDownloads(tester);
    await tester.tap(find.text('Form 16'));
    await settle(tester);
    expect(server.calls, contains('GET /payroll/form16'));
    expect(find.byKey(const ValueKey('form16-tip')), findsOneWidget);
    expect(
      find.textContaining(
        'You need Form 16 to file your income tax return. Last date to file for FY 2025–26 ',
        findRichText: true,
      ),
      findsOneWidget,
    );
    expect(
      find.textContaining('31 Jul 2026', findRichText: true),
      findsOneWidget,
    );
    expect(find.text('FY 2026–27'), findsOneWidget);
    expect(find.text('Ready by 15 Jun 2027'), findsOneWidget);
    // This FY is shown dimmed, with nothing to press.
    expect(button('form16-2026-27'), findsNothing);
    expect(
      tester
          .widget<Opacity>(find.byKey(const ValueKey('form16-2026-27')))
          .opacity,
      lessThan(1),
    );
    expect(find.text('FY 2025–26'), findsOneWidget);
    expect(find.text('Part A and Part B · PDF'), findsNWidgets(2));
    expect(
      find.bySemanticsLabel('Download Form 16 for FY 2025–26'),
      findsOneWidget,
    );
    await capture(tester, 'downloads_form16');

    await tapAndWait(tester, button('form16-2025-26'), () => saved.isNotEmpty);
    expect(
      server.calls,
      containsAllInOrder([
        'GET /payroll/form16/f16-2526/file',
        'GET files:/form16/f16-2526.pdf?sig=x',
      ]),
    );
    expect(saved.single.$1, 'Form16_FY2025-26.pdf');
    expect(utf8.decode(saved.single.$2), startsWith('%PDF-'));

    // FY 2024-25 came as two files: a sheet asks which.
    await tester.ensureVisible(button('form16-2024-25'));
    await tester.tap(button('form16-2024-25'));
    await settle(tester);
    expect(find.text('Part A'), findsOneWidget);
    expect(find.text('Part B'), findsOneWidget);
    await capture(tester, 'downloads_form16_parts');
    await tapAndWait(
      tester,
      button('form16-part-f16-2425-b'),
      () => saved.length > 1,
    );
    expect(saved.last.$1, 'PartB_2024-25.pdf');
    expect(server.calls.last, 'GET files:/form16/f16-2425-b.pdf?sig=x');
  });

  testWidgets('opens on Form 16 when asked, and switches back to payslips', (
    tester,
  ) async {
    final server = await pumpDownloads(tester, startTab: 'form16');
    expect(server.calls, ['GET /payroll/form16']);
    expect(find.text('Ready by 15 Jun 2027'), findsOneWidget);
    await tester.tap(find.text('Payslips'));
    await settle(tester);
    expect(server.calls, [
      'GET /payroll/form16',
      'GET /payslips/mine?limit=24',
    ]);
    expect(find.text('September 2026'), findsOneWidget);
    // Each list is read once: back on Form 16, nothing is fetched again.
    await tester.tap(find.text('Form 16'));
    await settle(tester);
    expect(server.calls.length, 2);
  });

  testWidgets('empty: no payslips yet, and no Form 16 yet', (tester) async {
    final server = _FakeDownloadsServer()
      ..slips = {}
      ..years = [
        {
          'fy': '2026-27',
          'status': 'pending',
          'readyBy': '2027-06-15',
          'documents': <dynamic>[],
        },
      ];
    await pumpDownloads(tester, server: server);
    expect(
      find.text(
        'No payslips yet — they appear here once payroll has run for you.',
      ),
      findsOneWidget,
    );
    expect(find.text('Download all as one PDF'), findsNothing);
    await capture(tester, 'downloads_payslips_empty');
    await tester.tap(find.text('Form 16'));
    await settle(tester);
    expect(find.text('Ready by 15 Jun 2027'), findsOneWidget);
    expect(find.text('Part A and Part B · PDF'), findsNothing);
    expect(button('form16-2026-27'), findsNothing);
    await capture(tester, 'downloads_form16_empty');

    // A server with no years at all says so.
    server.years = [];
    await tester.pumpWidget(const SizedBox());
    await pumpDownloads(tester, server: server, startTab: 'form16');
    expect(
      find.text(
        'No Form 16 yet — HR adds it here after the financial year ends, by 15 June.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('a past FY with nothing filed says HR has not added it', (
    tester,
  ) async {
    final server = _FakeDownloadsServer()
      ..years = [
        {
          'fy': '2026-27',
          'status': 'pending',
          'readyBy': '2027-06-15',
          'documents': <dynamic>[],
        },
        {
          'fy': '2025-26',
          'status': 'missing',
          'readyBy': '2026-06-15',
          'documents': <dynamic>[],
        },
      ];
    await pumpDownloads(tester, server: server, startTab: 'form16');
    expect(find.text('Not added by HR yet'), findsOneWidget);
    expect(button('form16-2025-26'), findsNothing);
  });

  testWidgets('a failed read offers to try again', (tester) async {
    final server = _FakeDownloadsServer()..form16Fails = true;
    await pumpDownloads(tester, server: server, startTab: 'form16');
    expect(find.text('Form 16 is taking a break.'), findsOneWidget);
    server.form16Fails = false;
    await tester.tap(find.text('Try again'));
    await settle(tester);
    expect(find.text('Ready by 15 Jun 2027'), findsOneWidget);
    expect(server.calls.where((c) => c == 'GET /payroll/form16').length, 2);
  });

  group('"Can\'t find a document?"', () {
    testWidgets('raises a Support Desk ticket about the tab it is on', (
      tester,
    ) async {
      final opened = <String?>[];
      void opener({String? about}) => opened.add(about);
      registerSupportTicketOpener(opener);
      addTearDown(() => unregisterSupportTicketOpener(opener));
      await pumpDownloads(tester);
      await tester.tap(find.byKey(const ValueKey('downloads-raise-ticket')));
      await settle(tester);
      await tester.tap(find.text('Form 16'));
      await settle(tester);
      await tester.ensureVisible(
        find.byKey(const ValueKey('downloads-raise-ticket')),
      );
      await tester.tap(find.byKey(const ValueKey('downloads-raise-ticket')));
      await settle(tester);
      expect(opened, ['I can\'t find a payslip:', 'I can\'t find my Form 16:']);
    });

    testWidgets('opens the desk when no ticket can be raised from here', (
      tester,
    ) async {
      final tickets = <String>[];
      await pumpDownloads(tester, tickets: tickets);
      await tester.tap(find.byKey(const ValueKey('downloads-raise-ticket')));
      await settle(tester);
      expect(tickets, ['desk']);
    });
  });
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
