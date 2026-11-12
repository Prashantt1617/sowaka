// Payroll › Tax (R 3 / R 3b) against a fake server of its own: the year's
// tax on the new and the old regime, the month-by-month list, picking a
// regime (saved through the declaration), the declaration and proofs links
// on the old regime, the closed regime, and the "not set up" state. A layout
// that overflows fails the test.
//
// `flutter test --update-goldens --dart-define=SCREENSHOTS=<dir> test/payroll_tax_test.dart`
// also writes the screens to <dir> as 390×844 PNGs.
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

const _monthNames = [
  'April 2026',
  'May 2026',
  'June 2026',
  'July 2026',
  'August 2026',
  'September 2026',
  'October 2026',
  'November 2026',
  'December 2026',
  'January 2027',
  'February 2027',
  'March 2027',
];

/// The Tax routes, answered from memory. Every figure is invented.
class _FakeTaxServer {
  String regime = 'new';
  bool chosen = false;
  bool locked = false;
  bool notConfigured = false;

  /// The company's Form 16 switch as the server sends it; null: a server
  /// that does not send it.
  bool? form16Enabled = true;

  /// Paid each month April to September, and the monthly figure from
  /// October on, by regime: ₹8,467 × 6 + ₹7,600 × 6 = ₹96,400 on the new.
  static const _paid = 846700;
  static const _monthly = {'new': 760000, 'old': 540000};
  static const _annual = {'new': 9640000, 'old': 8320000};

  final calls = <String>[];
  final bodies = <String, Map<String, dynamic>>{};

  Map<String, dynamic> tax() => {
    'fy': '2026-27',
    'regime': regime,
    'chosen': chosen,
    'defaultRegime': 'new',
    'regimeDueOn': '2026-11-30',
    'proofsDueOn': '2027-01-31',
    'locked': locked,
    'canChangeRegime': !notConfigured && !locked,
    'notConfigured': notConfigured,
    'reason': notConfigured ? 'tax_rules_not_set_up' : null,
    'message': notConfigured
        ? 'The income tax rules for FY 2026-27 are not set up yet. Ask HR.'
        : null,
    'missing': <String>[],
    'annualTaxPaise': notConfigured ? null : _annual[regime],
    'paidSoFarPaise': _paid * 6,
    'paidThroughMonth': '2026-09',
    'monthlyNowPaise': notConfigured ? null : _monthly[regime],
    'months': [
      for (final (i, label) in _monthNames.indexed)
        {
          'period': i < 9
              ? '2026-${(i + 4).toString().padLeft(2, '0')}'
              : '2027-0${i - 8}',
          'label': label,
          'amountPaise': i < 6
              ? _paid
              : notConfigured
              ? null
              : _monthly[regime],
          'status': i < 6 ? 'paid' : 'estimate',
        },
    ],
    'estimate': true,
    if (form16Enabled != null) 'form16Enabled': form16Enabled,
  };

  Map<String, dynamic> declaration() => {
    'fy': '2026-27',
    'regime': regime,
    'chosen': chosen,
    'status': chosen ? 'saved' : 'not_started',
    'locked': locked,
    'dueOn': '2026-11-30',
    'proofsDueOn': '2027-01-31',
    'sections': <Object>[],
  };

  Future<http.Response> handle(http.Request request) async {
    final path = request.url.path;
    calls.add('${request.method} $path');
    if (request.method == 'GET' && path == '/payroll/me/tax') {
      return _json({'success': true, 'tax': tax()});
    }
    if (path == '/payroll/tax-declaration') {
      if (request.method == 'PUT') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        bodies[path] = body;
        if (locked) {
          return _json({
            'success': false,
            'message':
                'Declarations for FY 2026-27 closed on 30 Nov 2026. Ask HR.',
          }, 409);
        }
        regime = body['regime'] as String;
        chosen = true;
      }
      return _json({'success': true, 'declaration': declaration()});
    }
    if (request.method == 'GET' && path == '/payroll/investment-proofs') {
      return _json({
        'success': true,
        'proofs': {
          'fy': '2026-27',
          'regime': regime,
          'required': false,
          'locked': false,
          'dueOn': '2027-01-31',
          'items': <Object>[],
        },
      });
    }
    if (request.method == 'GET' && path == '/payroll/form16') {
      return _json({
        'success': true,
        'form16': {
          'enabled': true,
          'currentFy': '2026-27',
          'filing': {'fy': '2025-26', 'lastDate': '2026-07-31'},
          'years': [
            {
              'fy': '2026-27',
              'status': 'pending',
              'readyBy': '2027-06-15',
              'documents': <Object>[],
            },
          ],
        },
      });
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
      find.byType(PayrollTaxSummaryHarness),
      matchesGoldenFile(Uri.file('$_screenshots/$name.png')),
    );
  }

  Future<_FakeTaxServer> pumpTax(
    WidgetTester tester, [
    _FakeTaxServer? server,
  ]) async {
    tester.view.physicalSize = const Size(390 * 2, 844 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final fake = server ?? _FakeTaxServer();
    final api = PayrollApiService(
      session: _session,
      baseUrl: 'https://example.test',
      client: MockClient(fake.handle),
    );
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
        home: Scaffold(
          body: PayrollTaxSummaryHarness(
            screen: PayrollScreen(
              api: api,
              onClose: () {},
              profileAction: const SizedBox(width: 30, height: 30),
              onNotifications: () {},
              onQuickCreate: () {},
              onFixMissingPunches: (_) {},
              onRaiseTicket: () {},
            ),
          ),
        ),
      ),
    );
    await settle(tester);
    return fake;
  }

  Future<void> tap(WidgetTester tester, Finder finder) async {
    if (finder.evaluate().isEmpty) {
      await tester.scrollUntilVisible(
        finder,
        200,
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

  Color? colorOf(WidgetTester tester, String text) =>
      tester.widget<Text>(find.text(text)).style?.color;

  testWidgets('Tax on the new regime: the year, paid, a month now, the note', (
    tester,
  ) async {
    await pumpTax(tester);
    expect(find.byKey(const ValueKey('payroll-tax')), findsOneWidget);
    expect(find.text('Tax'), findsOneWidget);
    expect(find.text('TAX · FY 2026–27'), findsOneWidget);
    // The regime on the tag (Figma 4562:25092), the estimate in the line.
    expect(find.text('New regime'), findsOneWidget);
    expect(find.text('₹96,400'), findsOneWidget);
    expect(find.text('Your tax for the year · estimate'), findsOneWidget);
    expect(find.text('₹50,802'), findsOneWidget);
    expect(find.text('Paid till Sep'), findsOneWidget);
    expect(find.text('₹7,600'), findsOneWidget);
    expect(find.text('A month now'), findsOneWidget);
    expect(find.text('Month by month'), findsOneWidget);
    expect(find.text('MANAGE'), findsOneWidget);
    expect(find.text('Tax regime'), findsOneWidget);
    expect(
      find.text('New regime (default) · change by 30 Nov'),
      findsOneWidget,
    );
    expect(
      find.text(
        'On the new regime you don\'t need to declare investments or upload '
        'proofs.',
      ),
      findsOneWidget,
    );
    // On the new regime the rows stay, greyed, and open nothing.
    expect(find.text('Investment declaration'), findsOneWidget);
    expect(find.text('Investment proofs'), findsOneWidget);
    expect(find.text('Not needed on the new regime'), findsNWidgets(2));
    await tap(tester, find.byKey(const ValueKey('tax-declaration')));
    expect(find.byKey(const ValueKey('payroll-declaration')), findsNothing);
    // Form 16 is a row of its own, opening Downloads on its tab.
    expect(find.text('Download Form 16'), findsOneWidget);
    expect(find.byKey(const ValueKey('tax-regime-save')), findsNothing);
    // The months stay closed until asked for.
    expect(find.text('April 2026'), findsNothing);
    await capture(tester, 'payroll_tax_new');
  });

  testWidgets('Month by month: paid months dark, coming months grey', (
    tester,
  ) async {
    await pumpTax(tester);
    await tap(tester, find.byKey(const ValueKey('tax-months')));
    for (final name in _monthNames) {
      final row = find.text(name);
      if (row.evaluate().isEmpty) {
        await tester.scrollUntilVisible(
          row,
          100,
          scrollable: find
              .descendant(
                of: find.byType(ListView).first,
                matching: find.byType(Scrollable),
              )
              .first,
        );
      }
      expect(row, findsOneWidget);
    }
    expect(find.byKey(const ValueKey('tax-month-2026-04')), findsOneWidget);
    expect(find.byKey(const ValueKey('tax-month-2027-03')), findsOneWidget);
    expect(find.text('₹8,467'), findsNWidgets(6));
    // Six coming months, and the tile.
    expect(find.text('₹7,600'), findsNWidgets(7));
    final paid = colorOf(tester, 'September 2026');
    final coming = colorOf(tester, 'October 2026');
    expect(paid, const Color(0xFF222222));
    expect(coming, const Color(0xFF9CA3AF));
    await capture(tester, 'payroll_tax_months');

    await tap(tester, find.byKey(const ValueKey('tax-months')));
    expect(find.text('April 2026'), findsNothing);
  });

  testWidgets('Picking the old regime and Save tax regime keep it', (
    tester,
  ) async {
    final server = await pumpTax(tester);
    await tap(tester, find.byKey(const ValueKey('tax-regime')));
    expect(find.text('Old regime'), findsOneWidget);
    // The option, and the card's tag.
    expect(find.text('New regime'), findsNWidgets(2));
    expect(find.text('Default'), findsOneWidget);
    expect(find.byKey(const ValueKey('tax-regime-saved')), findsNothing);
    // Never chosen: the default can be kept as it is.
    expect(find.byKey(const ValueKey('tax-regime-save')), findsOneWidget);

    await tap(tester, find.byKey(const ValueKey('tax-regime-old')));
    expect(server.bodies, isEmpty, reason: 'a pick is not saved by itself');
    await tap(tester, find.byKey(const ValueKey('tax-regime-save')));
    final body = server.bodies['/payroll/tax-declaration']!;
    expect(body['regime'], 'old');
    expect(body['items'], isEmpty, reason: 'declared amounts are kept');
    expect(body['submit'], false);
    expect(
      server.calls.where((c) => c == 'GET /payroll/me/tax'),
      hasLength(2),
      reason: 'the year is read again on the new regime',
    );
    expect(find.text('Saved · last date to change 30 Nov'), findsOneWidget);
    expect(find.text('Old regime · change by 30 Nov'), findsOneWidget);
    expect(find.byKey(const ValueKey('tax-regime-save')), findsNothing);
    expect(find.text('₹83,200'), findsOneWidget);
    expect(find.text('Investment declaration'), findsOneWidget);
    expect(find.text('By 30 Nov'), findsOneWidget);
    expect(find.text('Investment proofs'), findsOneWidget);
    expect(find.text('Due 31 Jan'), findsOneWidget);
    expect(find.byKey(const ValueKey('tax-new-regime-note')), findsNothing);
    await capture(tester, 'payroll_tax_old_saved');

    // Back to the new regime: sent as done, nothing more to declare.
    await tap(tester, find.byKey(const ValueKey('tax-regime-new')));
    await tap(tester, find.byKey(const ValueKey('tax-regime-save')));
    expect(server.bodies['/payroll/tax-declaration']!['regime'], 'new');
    expect(server.bodies['/payroll/tax-declaration']!['submit'], true);
    expect(find.text('Not needed on the new regime'), findsNWidgets(2));
    expect(find.byKey(const ValueKey('tax-new-regime-note')), findsOneWidget);
  });

  testWidgets('Old regime: the declaration and the proofs are a tap away', (
    tester,
  ) async {
    final server = _FakeTaxServer()
      ..regime = 'old'
      ..chosen = true;
    await pumpTax(tester, server);
    expect(find.text('Old regime · change by 30 Nov'), findsOneWidget);
    expect(find.text('₹83,200'), findsOneWidget);
    expect(find.text('₹5,400'), findsOneWidget);
    expect(find.byKey(const ValueKey('tax-new-regime-note')), findsNothing);
    await capture(tester, 'payroll_tax_old');

    await tap(tester, find.byKey(const ValueKey('tax-declaration')));
    expect(find.byKey(const ValueKey('payroll-declaration')), findsOneWidget);
    Navigator.of(
      tester.element(find.byKey(const ValueKey('payroll-declaration'))),
    ).pop();
    await settle(tester);
    expect(find.byKey(const ValueKey('payroll-tax')), findsOneWidget);
    expect(
      server.calls.where((c) => c == 'GET /payroll/me/tax'),
      hasLength(2),
      reason: 'read again after the declaration',
    );

    await tap(tester, find.byKey(const ValueKey('tax-proofs')));
    expect(find.byKey(const ValueKey('payroll-proofs')), findsOneWidget);
  });

  testWidgets('After the last date the regime is shown, not changed', (
    tester,
  ) async {
    final server = _FakeTaxServer()..locked = true;
    await pumpTax(tester, server);
    expect(find.text('New regime (default) · closed 30 Nov'), findsOneWidget);
    await tap(tester, find.byKey(const ValueKey('tax-regime')));
    expect(find.byKey(const ValueKey('tax-regime-closed')), findsOneWidget);
    await tap(tester, find.byKey(const ValueKey('tax-regime-old')));
    expect(find.byKey(const ValueKey('tax-regime-save')), findsNothing);
    expect(server.bodies, isEmpty);
    expect(find.text('Old regime · closed 30 Nov'), findsNothing);
  });

  testWidgets('Tax rules not set up: said, no figures, nothing to change', (
    tester,
  ) async {
    final server = _FakeTaxServer()..notConfigured = true;
    await pumpTax(tester, server);
    expect(find.text('Not set up'), findsOneWidget);
    expect(find.byKey(const ValueKey('tax-not-set-up')), findsOneWidget);
    expect(
      find.text(
        'The income tax rules for FY 2026-27 are not set up yet. Ask HR.',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('tax-annual')), findsNothing);
    expect(find.text('New regime'), findsNothing);
    expect(find.text('Month by month'), findsNothing);
    expect(find.text('Tax regime'), findsOneWidget);
    expect(
      find.text('New regime (default) · can\'t be changed yet'),
      findsOneWidget,
    );
    await capture(tester, 'payroll_tax_not_set_up');

    await tap(tester, find.byKey(const ValueKey('tax-regime')));
    await tap(tester, find.byKey(const ValueKey('tax-regime-old')));
    expect(find.byKey(const ValueKey('tax-regime-save')), findsNothing);
    expect(server.bodies, isEmpty);
  });
  group('Form 16 switch', () {
    testWidgets('on: "Download Form 16" opens Downloads on its tab', (
      tester,
    ) async {
      final server = await pumpTax(tester);
      await tap(tester, find.byKey(const ValueKey('tax-form16')));
      expect(find.byKey(const ValueKey('payroll-downloads')), findsOneWidget);
      expect(find.byKey(const ValueKey('downloads-tabs')), findsOneWidget);
      expect(server.calls, contains('GET /payroll/form16'));
      expect(find.text('Ready by 15 Jun 2027'), findsOneWidget);
    });

    for (final (name, flag) in [
      ('off', false),
      ('not sent (an older server)', null),
    ]) {
      testWidgets('$name: no Form 16 on the page', (tester) async {
        final server = _FakeTaxServer()..form16Enabled = flag;
        await pumpTax(tester, server);
        expect(find.text('MANAGE'), findsOneWidget);
        expect(find.text('Tax regime'), findsOneWidget);
        expect(find.byKey(const ValueKey('tax-form16')), findsNothing);
        expect(find.text('Download Form 16'), findsNothing);
        expect(
          find.text('You need Form 16 to file your income tax return'),
          findsNothing,
        );
        expect(server.calls, isNot(contains('GET /payroll/form16')));
      });
    }
  });
}
