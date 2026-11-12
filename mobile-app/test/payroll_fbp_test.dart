// The FBP pages (Actions › Payroll › FBP) against a small fake server: the
// month's summary (the donut, its legend, each head with the bills still to
// send and how many are approved), the split locked for the year with its
// way to HR, one head's months in every state (approved, in review,
// rejected with HR's reason, not uploaded) and the bill sheet that uploads
// or re-uploads a month. A layout that overflows fails the test.
//
// `flutter test --update-goldens --dart-define=SCREENSHOTS=<dir> test/payroll_fbp_test.dart`
// also writes every screen to <dir> as a 390×844 PNG.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/payroll/data/payroll_api_service.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';
import 'package:mobile_app/features/support/support_launcher.dart';

const _screenshots = String.fromEnvironment('SCREENSHOTS');

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'asha',
    email: 'asha@example.test',
    name: 'Asha',
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

/// The FBP routes, answered from memory. Every figure is invented; the org
/// is sowaka.
class _FakeFbpServer {
  /// No change made now can reach this FY: the split is locked.
  bool locked = false;

  /// This month's bills date, when HR set one ("2026-10-20").
  String? monthlyDueOn;

  /// An older server without the FBP routes.
  bool hasFbpRoutes = true;

  /// What the next bill upload answers instead of taking it.
  ({int status, String message})? uploadRefusal;

  final calls = <String>[];
  Map<String, String>? uploadFields;
  String? uploadFileName;
  String? uploadFileField;

  static const _reason =
      'The total on the bill isn\'t readable. Upload a clearer photo where '
      'the amount and date can be seen.';
  static const _months = [
    '2026-04',
    '2026-05',
    '2026-06',
    '2026-07',
    '2026-08',
    '2026-09',
    '2026-10',
  ];

  /// Head → each month's status, April to October.
  final status = <String, List<String>>{
    'FUEL': [
      'approved',
      'approved',
      'approved',
      'approved',
      'rejected',
      'in_review',
      'not_uploaded',
    ],
    'INTERNET': List.filled(7, 'approved'),
    'TELEPHONE': [
      'approved',
      'approved',
      'approved',
      'approved',
      'approved',
      'not_uploaded',
      'not_uploaded',
    ],
  };
  static const _names = {
    'FUEL': 'Fuel & vehicle',
    'INTERNET': 'Internet',
    'TELEPHONE': 'Telephone',
    'BOOKS': 'Books & periodicals',
  };
  static const _types = {
    'FUEL': 'Fuel',
    'INTERNET': 'Internet',
    'TELEPHONE': 'Telephone',
  };
  final amounts = <String, int>{
    'FUEL': 250000,
    'INTERNET': 100000,
    'TELEPHONE': 100000,
    'BOOKS': 0,
  };

  int _count(String code, String s) =>
      (status[code] ?? const []).where((x) => x == s).length;

  Map<String, dynamic> _plan() {
    final assigned = amounts.values.fold(0, (a, b) => a + b);
    final heads = [
      for (final code in amounts.keys)
        {
          'code': code,
          'name': _names[code],
          'amountPaise': amounts[code],
          'limitPaise': 300000,
          'months': status[code]?.length ?? 0,
          'approved': _count(code, 'approved'),
          'inReview': _count(code, 'in_review'),
          'rejected': _count(code, 'rejected'),
          'toUpload': _count(code, 'not_uploaded'),
          'needsAction':
              _count(code, 'not_uploaded') + _count(code, 'rejected'),
          'billsSetUp': _types.containsKey(code),
        },
    ];
    int sum(String key) =>
        heads.fold(0, (total, head) => total + (head[key] as int));
    return {
      'available': true,
      'fy': '2026-27',
      'period': '2026-10',
      'billsDueOn': '2027-03-31',
      'monthlyDueOn': monthlyDueOn,
      'lock': locked
          ? {
              'locked': true,
              'notConfigured': false,
              'missing': <String>[],
              'reason': 'locked_for_fy',
              'effectiveFrom': null,
              'closesOn': null,
            }
          : {
              'locked': false,
              'notConfigured': false,
              'missing': <String>[],
              'reason': null,
              'effectiveFrom': '2026-11',
              'closesOn': '2026-11-15',
            },
      'poolPaise': 600000,
      'assignedPaise': assigned,
      'unassignedPaise': 600000 - assigned,
      'declared': {
        'effectiveFrom': '2026-04',
        'submittedAt': '2026-04-08T06:00:00.000Z',
      },
      'heads': heads,
      'summary': {
        'toUpload': sum('toUpload'),
        'toReupload': sum('rejected'),
        'inReview': sum('inReview'),
        'approved': sum('approved'),
      },
      'missing': <String>[],
    };
  }

  Map<String, dynamic> _head(String code) => {
    'code': code,
    'name': _names[code],
    'fy': '2026-27',
    'period': '2026-10',
    'amountPaise': amounts[code],
    'limitPaise': 300000,
    'billsDueOn': '2027-03-31',
    'billType': _types[code],
    'uploadsBlocked': null,
    'months': [
      for (final (i, s) in (status[code] ?? const <String>[]).indexed)
        {
          'period': _months[i],
          'amountPaise': amounts[code],
          'status': s,
          'canUpload': s == 'not_uploaded' || s == 'rejected',
          'bill': s == 'not_uploaded'
              ? null
              : {
                  'id': '$code-$i',
                  'amountPaise': amounts[code],
                  'fileName': 'bill-$i.jpg',
                  'uploadedAt': s == 'rejected'
                      ? '2026-09-02T06:00:00.000Z'
                      : '${_months[i]}-21T06:00:00.000Z',
                  'decidedAt': s == 'in_review'
                      ? null
                      : s == 'rejected'
                      ? '2026-09-05T06:00:00.000Z'
                      : '${_months[i]}-25T06:00:00.000Z',
                  'reason': s == 'rejected' ? _reason : null,
                },
        },
    ],
  };

  Future<http.Response> handle(http.BaseRequest request) async {
    final path = request.url.path;
    calls.add('${request.method} $path');
    if (path == '/payroll/home') {
      return _json({
        'success': true,
        'period': '2026-10',
        'fy': '2026-27',
        'hasSalaryStructure': false,
        'todo': <dynamic>[],
        'split': {
          'open': true,
          'poolPaise': 600000,
          'assignedPaise': 450000,
          'unassignedPaise': 150000,
          'bills': {'approved': 0, 'inReview': 0, 'rejected': 0},
        },
        // The home's summary cards: the FBP one is the way into the FBP page.
        'cards': {
          'salary': null,
          'tax': {
            'fy': '2026-27',
            'notConfigured': true,
            'reason': 'tax_rules_not_set_up',
            'message': 'Not set up. Ask HR.',
          },
          'fbp': {
            'poolPaise': 600000,
            'heads': [
              for (final e in amounts.entries)
                if (e.value > 0)
                  {'code': e.key, 'name': e.key, 'amountPaise': e.value},
            ],
            'assignedPaise': 450000,
            'unassignedPaise': 150000,
            'notConfigured': false,
            'missing': <String>[],
          },
        },
      });
    }
    if (path == '/payroll/split') {
      return _json({
        'success': true,
        'split': {
          'available': true,
          'poolPaise': 600000,
          'assignedPaise': 450000,
          'unassignedPaise': 150000,
          'components': [
            for (final code in amounts.keys)
              {
                'code': code,
                'name': _names[code],
                'limitPaise': 300000,
                'amountPaise': amounts[code],
                'stepPaise': 50000,
                'bills': {'approved': 0, 'inReview': 0, 'rejected': 0},
              },
          ],
          'window': {
            'open': true,
            'effectiveFrom': '2026-11',
            'effectiveTo': '2027-03',
            'closesOn': '2026-11-15',
          },
        },
      });
    }
    if (hasFbpRoutes && path == '/payroll/me/fbp') {
      return _json({'success': true, 'fbp': _plan()});
    }
    final head = RegExp(r'^/payroll/me/fbp/([A-Z]+)$').firstMatch(path);
    if (hasFbpRoutes && head != null) {
      return _json({'success': true, 'head': _head(head[1]!)});
    }
    final bills = RegExp(r'^/payroll/me/fbp/([A-Z]+)/bills$').firstMatch(path);
    if (hasFbpRoutes && bills != null && request is http.MultipartRequest) {
      uploadFields = Map.of(request.fields);
      uploadFileName = request.files.single.filename;
      uploadFileField = request.files.single.field;
      if (uploadRefusal case final refusal?) {
        return _json({
          'success': false,
          'message': refusal.message,
        }, refusal.status);
      }
      final code = bills[1]!;
      final i = _months.indexOf(request.fields['period']!);
      status[code]![i] = 'in_review';
      return _json({'success': true, 'head': _head(code)});
    }
    return _json({'success': false, 'message': 'Route not found: $path'}, 404);
  }
}

class _FakeClient extends http.BaseClient {
  _FakeClient(this.server);

  final _FakeFbpServer server;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = await server.handle(request);
    return http.StreamedResponse(
      Stream.value(response.bodyBytes),
      response.statusCode,
      headers: response.headers,
      request: request,
    );
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
      find.byType(PayrollScreen),
      matchesGoldenFile(Uri.file('$_screenshots/$name.png')),
    );
  }

  final raised = <String>[];

  Future<_FakeFbpServer> pumpFbp(
    WidgetTester tester, {
    _FakeFbpServer? server,
    bool open = true,
  }) async {
    tester.view.physicalSize = const Size(390 * 2, 844 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    raised.clear();
    final fake = server ?? _FakeFbpServer();
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
        home: Scaffold(
          body: PayrollScreen(
            api: PayrollApiService(
              session: _session,
              baseUrl: 'https://example.test',
              client: _FakeClient(fake),
            ),
            onClose: () {},
            profileAction: const SizedBox(width: 30, height: 30),
            onNotifications: () {},
            onQuickCreate: () {},
            onFixPunchDay: (_) {},
            onRaiseTicket: () => raised.add('desk'),
            pickFile: (_) async => PayrollUpload(
              name: 'fuel-oct.pdf',
              bytes: Uint8List.fromList(utf8.encode('%PDF-1.4 fuel bill')),
            ),
          ),
        ),
      ),
    );
    await settle(tester);
    if (open) {
      // This home sends no salary card, so FBP is the carousel's second
      // (after tax): bring it in, then open it.
      await tester.tap(find.byKey(const ValueKey('payroll-dot-1')));
      await settle(tester);
      await tester.tap(find.byKey(const ValueKey('payroll-fbp')));
      await settle(tester);
    }
    return fake;
  }

  Future<void> tap(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.pump();
    await tester.tap(finder);
    await settle(tester);
  }

  Finder inRow(String key, Finder matching) =>
      find.descendant(of: find.byKey(ValueKey(key)), matching: matching);

  testWidgets('FBP: the month\'s summary, what is left to send, each head', (
    tester,
  ) async {
    await pumpFbp(tester);
    expect(find.byKey(const ValueKey('payroll-fbp-page')), findsOneWidget);
    expect(
      find.textContaining('Until a bill is approved, that FBP money is taxed'),
      findsOneWidget,
    );

    // The summary: the donut around the gross, a legend line per head.
    expect(find.text('FBP SUMMARY · OCTOBER'), findsOneWidget);
    final summary = find.byKey(const ValueKey('fbp-summary'));
    Finder inSummary(String text) =>
        find.descendant(of: summary, matching: find.text(text));
    expect(inSummary('₹6,000'), findsOneWidget);
    expect(inSummary('gross'), findsOneWidget);
    for (final (name, amount) in [
      ('Fuel & vehicle', '₹2,500'),
      ('Internet', '₹1,000'),
      ('Telephone', '₹1,000'),
      ('Not assigned', '₹1,500'),
    ]) {
      expect(inSummary(name), findsOneWidget, reason: name);
      expect(inSummary(amount), findsWidgets, reason: amount);
    }
    // A head that pays nothing is left out.
    expect(find.text('Books & periodicals'), findsNothing);
    final donut = tester.widget<CustomPaint>(
      find.byKey(const ValueKey('fbp-donut')),
    );
    final painter = donut.painter! as dynamic;
    expect(
      [for (final s in painter.slices as List) s.$1],
      [250000, 100000, 100000, 150000],
    );
    expect(
      (painter.slices as List).last.$2,
      const Color(0xFFFF5A5F),
      reason: 'Not assigned is drawn red',
    );

    expect(
      find.text('3 bills to upload · 1 to re-upload · by 31 Mar'),
      findsOneWidget,
    );

    // The split, head by head, with the bills still to send.
    expect(find.text('Declared in April'), findsOneWidget);
    expect(find.text('a month'), findsOneWidget);
    expect(
      inRow('fbp-head-FUEL', find.text('4 of 7 bills approved')),
      findsOneWidget,
    );
    expect(
      inRow('fbp-head-FUEL', find.byKey(const ValueKey('fbp-head-count'))),
      findsOneWidget,
    );
    expect(inRow('fbp-head-FUEL', find.text('2')), findsOneWidget);
    expect(
      inRow('fbp-head-INTERNET', find.text('7 of 7 bills approved')),
      findsOneWidget,
    );
    expect(
      inRow('fbp-head-INTERNET', find.byKey(const ValueKey('fbp-head-count'))),
      findsNothing,
    );
    expect(
      inRow('fbp-head-TELEPHONE', find.text('5 of 7 bills approved')),
      findsOneWidget,
    );
    expect(inRow('fbp-head-TELEPHONE', find.text('2')), findsOneWidget);
    expect(
      inRow(
        'fbp-head-unassigned',
        find.text('Paid with salary, taxed in full'),
      ),
      findsOneWidget,
    );
    expect(inRow('fbp-head-unassigned', find.text('₹1,500')), findsOneWidget);
    await capture(tester, 'fbp');

    // While the window is open: the way into Change my split.
    await tester.ensureVisible(find.byKey(const ValueKey('fbp-change-split')));
    await tester.pump();
    expect(find.text('You can change your split till 15 Nov'), findsOneWidget);
    expect(find.byKey(const ValueKey('fbp-split-locked')), findsNothing);
    await capture(tester, 'fbp_bottom');
    await tap(tester, find.byKey(const ValueKey('fbp-change-split')));
    expect(find.byKey(const ValueKey('payroll-split')), findsOneWidget);
  });

  testWidgets('FBP: this month\'s bills date, when HR set one', (tester) async {
    await pumpFbp(
      tester,
      server: _FakeFbpServer()..monthlyDueOn = '2026-10-20',
    );
    final line = tester.widget<Text>(find.byKey(const ValueKey('fbp-todo')));
    expect(line.data, '3 bills to upload · 1 to re-upload · by 20 Oct');
    expect(line.style?.color, const Color(0xFFB42318));
  });

  testWidgets('FBP: nothing left to send says so in green', (tester) async {
    final server = _FakeFbpServer()
      ..status['FUEL'] = List.filled(7, 'approved')
      ..status['TELEPHONE'] = List.filled(7, 'in_review');
    await pumpFbp(tester, server: server);
    final line = tester.widget<Text>(find.byKey(const ValueKey('fbp-todo')));
    expect(line.data, 'All bills sent for review');
    expect(line.style?.color, const Color(0xFF15803D));
    expect(find.byKey(const ValueKey('fbp-head-count')), findsNothing);
  });

  group('the split locked for the FY', () {
    final opened = <String?>[];
    void opener({String? about}) => opened.add(about);
    tearDown(() => unregisterSupportTicketOpener(opener));

    testWidgets('no summary, the lock, and the way to HR', (tester) async {
      opened.clear();
      registerSupportTicketOpener(opener);
      await pumpFbp(
        tester,
        server: _FakeFbpServer()
          ..locked = true
          ..monthlyDueOn = '2026-10-20',
      );
      expect(find.byKey(const ValueKey('fbp-summary')), findsNothing);
      expect(
        find.text('3 bills to upload · 1 to re-upload · by 20 Oct'),
        findsOneWidget,
      );
      expect(find.text('4 of 7 bills approved'), findsOneWidget);
      await tester.ensureVisible(
        find.byKey(const ValueKey('fbp-split-locked')),
      );
      await tester.pump();
      expect(find.text('Split locked for this FY'), findsOneWidget);
      expect(find.byKey(const ValueKey('fbp-change-split')), findsNothing);
      expect(find.textContaining('You can change your split'), findsNothing);
      await capture(tester, 'fbp_locked');
      await tap(tester, find.text('To change it, raise a ticket'));
      expect(opened, ['I would like to change my FBP split for FY 26–27:']);
      expect(raised, isEmpty);
    });

    testWidgets('without a signed-in shell, the desk opens', (tester) async {
      await pumpFbp(tester, server: _FakeFbpServer()..locked = true);
      await tap(tester, find.byKey(const ValueKey('fbp-raise-ticket')));
      expect(raised, ['desk']);
    });
  });

  testWidgets('a head: every month, rejected with the reason; upload', (
    tester,
  ) async {
    final server = await pumpFbp(tester);
    await tap(tester, find.byKey(const ValueKey('fbp-head-FUEL')));
    expect(find.byKey(const ValueKey('payroll-fbp-head-FUEL')), findsOneWidget);
    expect(find.text('₹2,500 a month · FY 26–27'), findsOneWidget);
    for (final month in [
      'April 2026',
      'May 2026',
      'June 2026',
      'July 2026',
      'August 2026',
      'September 2026',
      'October 2026',
    ]) {
      expect(find.text(month), findsOneWidget, reason: month);
    }
    expect(find.text('Approved'), findsNWidgets(4));
    expect(inRow('fbp-month-2026-09', find.text('In review')), findsOneWidget);
    expect(inRow('fbp-month-2026-08', find.text('Rejected')), findsOneWidget);
    expect(
      inRow('fbp-month-2026-08', find.text('Uploaded 2 Sep · rejected 5 Sep')),
      findsOneWidget,
    );
    expect(
      find.text(
        'The total on the bill isn\'t readable. Upload a clearer photo where '
        'the amount and date can be seen.',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('fbp-reupload-2026-08')), findsOneWidget);
    expect(find.text('₹2,500 taxed until uploaded'), findsOneWidget);
    expect(find.byKey(const ValueKey('fbp-upload-2026-10')), findsOneWidget);
    // Approved and in-review months can't be sent again.
    expect(find.byKey(const ValueKey('fbp-upload-2026-09')), findsNothing);
    expect(find.byKey(const ValueKey('fbp-reupload-2026-09')), findsNothing);
    await capture(tester, 'fbp_head');

    // Upload October: the sheet, the amount to start, no submit without a file.
    await tap(tester, find.byKey(const ValueKey('fbp-upload-2026-10')));
    expect(find.byKey(const ValueKey('fbp-bill-sheet')), findsOneWidget);
    expect(find.text('Upload fuel bill'), findsOneWidget);
    Finder inSheet(Finder matching) => find.descendant(
      of: find.byKey(const ValueKey('fbp-bill-sheet')),
      matching: matching,
    );
    expect(inSheet(find.text('October 2026')), findsOneWidget);
    expect(find.text('Amount on bill'), findsOneWidget);
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('fbp-bill-amount')))
          .controller!
          .text,
      '₹2,500',
    );
    expect(
      find.text(
        'Add a photo or PDF. Make sure the total and date can be read.',
      ),
      findsOneWidget,
    );
    expect(find.text('Take photo'), findsOneWidget);
    expect(find.text('Gallery'), findsOneWidget);
    expect(find.text('Choose file'), findsOneWidget);
    InkWell submit() =>
        tester.widget<InkWell>(find.byKey(const ValueKey('fbp-bill-submit')));
    expect(submit().onTap, isNull);
    await capture(tester, 'fbp_bill_sheet');

    await tap(tester, find.byKey(const ValueKey('fbp-bill-pick')));
    expect(find.byKey(const ValueKey('fbp-bill-file')), findsOneWidget);
    expect(find.text('fuel-oct.pdf'), findsOneWidget);
    expect(find.text('PDF'), findsOneWidget);
    expect(find.byKey(const ValueKey('fbp-bill-drop')), findsNothing);
    expect(submit().onTap, isNotNull);
    await capture(tester, 'fbp_bill_sheet_file');

    // The amount on the bill can differ from the month's.
    await tester.enterText(
      find.byKey(const ValueKey('fbp-bill-amount')),
      '2400',
    );
    await tester.pump();
    await tap(tester, find.byKey(const ValueKey('fbp-bill-submit')));
    expect(server.calls, contains('POST /payroll/me/fbp/FUEL/bills'));
    expect(server.uploadFields, {'period': '2026-10', 'amountPaise': '240000'});
    expect(server.uploadFileName, 'fuel-oct.pdf');
    expect(server.uploadFileField, 'proof');
    expect(find.byKey(const ValueKey('fbp-bill-sheet')), findsNothing);
    expect(find.text('Bill sent for review'), findsOneWidget);
    expect(inRow('fbp-month-2026-10', find.text('In review')), findsOneWidget);
    expect(find.byKey(const ValueKey('fbp-upload-2026-10')), findsNothing);
  });

  testWidgets('a rejected month is re-uploaded from a photo', (tester) async {
    final server = await pumpFbp(tester);
    final camera = payrollFbpCamera;
    addTearDown(() => payrollFbpCamera = camera);
    final gallery = payrollFbpGallery;
    addTearDown(() => payrollFbpGallery = gallery);
    payrollFbpGallery = (_) async => PayrollUpload(
      name: 'IMG_0100.png',
      bytes: Uint8List.fromList([0x89, 0x50, 0x4e, 0x47]),
    );
    payrollFbpCamera = (_) async => PayrollUpload(
      name: 'IMG_0042.jpg',
      bytes: Uint8List.fromList([0xff, 0xd8, 0xff, 0x00]),
    );
    await tap(tester, find.byKey(const ValueKey('fbp-head-FUEL')));
    await tap(tester, find.byKey(const ValueKey('fbp-reupload-2026-08')));
    expect(find.text('Re-upload fuel bill'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('fbp-bill-sheet')),
        matching: find.text('August 2026'),
      ),
      findsOneWidget,
    );
    await tap(tester, find.byKey(const ValueKey('fbp-bill-take-photo')));
    expect(find.text('IMG_0042.jpg'), findsOneWidget);
    expect(find.text('JPG'), findsOneWidget);

    // Removed, the box to add one is back.
    await tap(tester, find.byTooltip('Remove file'));
    expect(find.byKey(const ValueKey('fbp-bill-drop')), findsOneWidget);
    // A photo already on the phone, from the gallery.
    await tap(tester, find.byKey(const ValueKey('fbp-bill-gallery')));
    expect(find.text('IMG_0100.png'), findsOneWidget);
    expect(find.text('PNG'), findsOneWidget);
    await tap(tester, find.byTooltip('Remove file'));
    await tap(tester, find.byKey(const ValueKey('fbp-bill-take-photo')));
    await tap(tester, find.byKey(const ValueKey('fbp-bill-submit')));
    expect(server.uploadFields, {'period': '2026-08', 'amountPaise': '250000'});
    expect(inRow('fbp-month-2026-08', find.text('In review')), findsOneWidget);
    expect(find.byKey(const ValueKey('fbp-reupload-2026-08')), findsNothing);
    expect(
      find.textContaining('total on the bill isn\'t readable'),
      findsNothing,
    );
  });

  testWidgets('a refused upload stays on the sheet with the reason', (
    tester,
  ) async {
    final server = await pumpFbp(tester);
    server.uploadRefusal = (
      status: 409,
      message:
          'FBP bills for FY 2026-27 closed on 31 Mar 2027. To send one late, '
          'ask HR.',
    );
    await tap(tester, find.byKey(const ValueKey('fbp-head-TELEPHONE')));
    await tap(tester, find.byKey(const ValueKey('fbp-upload-2026-09')));
    expect(find.text('Upload telephone bill'), findsOneWidget);
    await tap(tester, find.byKey(const ValueKey('fbp-bill-pick')));
    await tap(tester, find.byKey(const ValueKey('fbp-bill-submit')));
    expect(find.byKey(const ValueKey('fbp-bill-sheet')), findsOneWidget);
    expect(find.byKey(const ValueKey('fbp-bill-error')), findsOneWidget);
    expect(find.textContaining('closed on 31 Mar 2027'), findsOneWidget);
  });

  testWidgets('a server without the FBP routes opens the split', (
    tester,
  ) async {
    await pumpFbp(tester, server: _FakeFbpServer()..hasFbpRoutes = false);
    expect(find.byKey(const ValueKey('payroll-split')), findsOneWidget);
    expect(find.byKey(const ValueKey('payroll-fbp-page')), findsNothing);
  });
}
