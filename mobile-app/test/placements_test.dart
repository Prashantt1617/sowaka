// Actions › Placements against a fake server: the card only for a company
// with features.placements, the hub with one part failing, each form's
// checks, and a status change. A layout that overflows fails the test.
//
// `flutter test --update-goldens --dart-define=SCREENSHOTS=<dir> test/placements_test.dart`
// also writes the screens to <dir> as PNGs.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/placements/data/placements_api_service.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';

const _screenshots = String.fromEnvironment('SCREENSHOTS');

AuthSession _session({required bool placements}) => AuthSession(
  token: 'token',
  user: AuthUser.fromJson({
    'id': 'tanvi',
    'email': 'tanvi@example.test',
    'name': 'Tanvi',
    'role': 'employee',
    'company': "HR Organization's Solutions",
    'org': 'hrorgsol',
    if (placements) 'features': {'placements': true},
  }),
);

http.Response _json(Object body, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

const _shift = {
  'name': 'Default',
  'startTime': '09:30',
  'endTime': '18:30',
  'minHalfDayHours': 4,
  'minFullDayHours': 8,
  'leaveTypes': [
    {'key': 'casual', 'name': 'Casual Leave', 'advanceDays': 30},
  ],
  'leaveBalanceTracked': true,
};

Map<String, dynamic> _placement(
  String id,
  String customer,
  String status, {
  String clientId = 'cl-1',
  String clientName = 'Marwar Retail Pvt Ltd',
  String position = 'Sales executive',
  String? joiningDate,
}) => {
  'id': id,
  'customerId': 'cu-1',
  'customerName': customer,
  'clientId': clientId,
  'clientName': clientName,
  'position': position,
  'status': status,
  'interviewDate': '2026-10-28',
  'joiningDate': joiningDate,
  'ctcRupees': null,
  'notes': '',
  'createdByUserId': 'tanvi',
  'createdAt': '2026-10-24T10:00:00.000Z',
  'updatedAt': '2026-10-26T10:00:00.000Z',
  'history': [
    {
      'status': 'shortlisted',
      'at': '2026-10-25T10:00:00.000Z',
      'byUserId': 'tanvi',
    },
    {'status': status, 'at': '2026-10-26T10:00:00.000Z', 'byUserId': 'tanvi'},
  ],
};

final _marwar = {
  'id': 'cl-1',
  'name': 'Marwar Retail Pvt Ltd',
  'city': 'Ratanada, Jodhpur',
  'designations': [
    {
      'id': 'd1',
      'title': 'Store manager',
      'budgetRupees': 35000,
      'budgetPeriod': 'month',
      'description': 'Run daily store operations',
    },
    {
      'id': 'd2',
      'title': 'Sales executive',
      'budgetRupees': 18000,
      'budgetPeriod': 'month',
      'description': '',
    },
  ],
  'feeRupees': 2500,
  'feePaid': true,
  'feeReference': 'UPI 4411',
  'createdByUserId': 'tanvi',
  'createdAt': '2026-09-30T10:00:00.000Z',
};

final _blueGate = {
  'id': 'cl-2',
  'name': 'Blue Gate Hotels',
  'city': 'Sardarpura, Jodhpur',
  'designations': [],
  'feeRupees': 2500,
  'feePaid': false,
  'createdByUserId': 'tanvi',
  'createdAt': '2026-10-25T10:00:00.000Z',
};

final _arjun = {
  'id': 'cu-1',
  'name': 'Arjun Bhati',
  'phone': '+91 9876500001',
  'address': 'Shastri Nagar, Jodhpur',
  'currentRole': 'Sales executive',
  'experienceYears': 2,
  'notes': 'Field sales, Hindi and Marwari',
  'stage': 'in_process',
  'createdByUserId': 'tanvi',
  'createdAt': '2026-10-24T10:00:00.000Z',
};

final _sana = {
  'id': 'cu-2',
  'name': 'Sana Khan',
  'phone': '+91 9876500002',
  'currentRole': 'Front desk',
  'experienceYears': 0,
  'stage': 'not_placed',
  'createdByUserId': 'tanvi',
  'createdAt': '2026-10-26T10:00:00.000Z',
};

/// A fake `/placements`: [replies] answers a route first, by "METHOD path";
/// everything sent is kept in [sent].
class _FakePlacements {
  _FakePlacements([Map<String, http.Response Function(http.Request)>? replies])
    : replies = replies ?? {};

  final Map<String, http.Response Function(http.Request)> replies;
  final List<http.Request> sent = [];

  List<http.Request> sentTo(String method, String path) => [
    for (final request in sent)
      if (request.method == method && request.url.path == path) request,
  ];

  late final client = MockClient((request) async {
    sent.add(request);
    final key = '${request.method} ${request.url.path}';
    if (replies[key] case final reply?) return reply(request);
    return switch (key) {
      'GET /placements/clients' => _json({
        'success': true,
        'clients': [_marwar, _blueGate],
      }),
      'GET /placements/customers' => _json({
        'success': true,
        'customers': [_arjun, _sana],
      }),
      'GET /placements/customers/cu-1' => _json({
        'success': true,
        'customer': _arjun,
        'placements': [_placement('p1', 'Arjun Bhati', 'interviewing')],
        'clients': [_marwar],
      }),
      'GET /placements/clients/cl-1' => _json({
        'success': true,
        'client': _marwar,
        'placements': [_placement('p1', 'Arjun Bhati', 'interviewing')],
      }),
      'POST /placements/clients' => _json({
        'success': true,
        'client': {'id': 'cl-new', ..._body(request)},
      }, 201),
      'POST /placements/customers' => _json({
        'success': true,
        'customer': {'id': 'cu-new', ..._body(request)},
      }, 201),
      'POST /placements/customers/cu-1/remove' => _json({'success': true}),
      'POST /placements' => _json({
        'success': true,
        'placement': {
          'id': 'p-new',
          'customerName': 'Arjun Bhati',
          'clientName': 'Marwar Retail Pvt Ltd',
          ..._body(request),
        },
      }, 201),
      _ when request.method == 'PATCH' => _json({
        'success': true,
        'placement': {
          ..._placement('p1', 'Arjun Bhati', 'interviewing'),
          ..._body(request),
        },
      }),
      _ => _json({'success': false, 'message': 'Route not found'}, 404),
    };
  });

  PlacementsApiService api() => PlacementsApiService(
    session: _session(placements: true),
    baseUrl: 'https://example.test',
    client: client,
  );
}

Map<String, dynamic> _body(http.Request request) =>
    jsonDecode(request.body) as Map<String, dynamic>;

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

  void phoneSize(WidgetTester tester) {
    tester.view.physicalSize = const Size(393 * 2, 852 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
  }

  Future<void> settle(WidgetTester tester) async {
    await tester.pump();
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
    await tester.pump(const Duration(milliseconds: 400));
  }

  Future<_FakePlacements> pumpPlacements(
    WidgetTester tester, [
    _FakePlacements? server,
  ]) async {
    phoneSize(tester);
    final fake = server ?? _FakePlacements();
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
        home: Scaffold(
          body: PlacementsScreen(
            api: fake.api(),
            onClose: () {},
            profileAction: const SizedBox(width: 30, height: 30),
            onNotifications: () {},
            onQuickCreate: () {},
          ),
        ),
      ),
    );
    await settle(tester);
    return fake;
  }

  Future<void> type(WidgetTester tester, String key, String text) async {
    final field = find.descendant(
      of: find.byKey(ValueKey(key)),
      matching: find.byType(TextField),
    );
    await tester.ensureVisible(field);
    await tester.enterText(field, text);
    await tester.pump();
  }

  /// Taps [text] on the page in front, scrolling to it if it is below (or
  /// above) the fold; pages underneath are never found.
  Future<void> tapText(
    WidgetTester tester,
    String text, {
    bool first = false,
  }) async {
    final scrollable = find
        .byWidgetPredicate(
          (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
        )
        .hitTestable()
        .last;
    for (final delta in [300.0, -300.0]) {
      if (find.text(text).hitTestable().evaluate().isNotEmpty) break;
      try {
        await tester.scrollUntilVisible(
          find.text(text).hitTestable(),
          delta,
          scrollable: scrollable,
          maxScrolls: 20,
        );
      } on StateError {
        // Not that way.
      }
    }
    final shown = find.text(text).hitTestable();
    final target = first ? shown.first : shown.last;
    await tester.tap(target);
    await settle(tester);
  }

  /// Types into the field showing [hint], scrolling to it first.
  Future<void> typeInto(WidgetTester tester, String hint, String text) async {
    final field = find.widgetWithText(TextField, hint);
    for (final delta in [-300.0, 300.0]) {
      if (field.hitTestable().evaluate().isNotEmpty) break;
      try {
        await tester.scrollUntilVisible(
          field.hitTestable(),
          delta,
          scrollable: find
              .byWidgetPredicate(
                (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
              )
              .hitTestable()
              .last,
          maxScrolls: 20,
        );
      } on StateError {
        // Not that way.
      }
    }
    await tester.enterText(field.hitTestable(), text);
    await tester.pump();
  }

  Future<void> capture(WidgetTester tester, String name) async {
    if (_screenshots.isEmpty) return;
    await expectLater(
      find.byType(PlacementsScreen),
      matchesGoldenFile(Uri.file('$_screenshots/$name.png')),
    );
  }

  Future<void> tapKey(WidgetTester tester, String key) async {
    final target = find.byKey(ValueKey(key));
    await tester.ensureVisible(target);
    await tester.pump();
    await tester.tap(target);
    await settle(tester);
  }

  group('the feature flag', () {
    test('is off when the profile has no features, or says false', () {
      expect(AuthUser.fromJson({'id': 'a'}).placementsEnabled, isFalse);
      expect(
        AuthUser.fromJson({
          'id': 'a',
          'features': {'placements': false},
        }).placementsEnabled,
        isFalse,
      );
      expect(
        AuthUser.fromJson({'id': 'a', 'features': 'yes'}).placementsEnabled,
        isFalse,
      );
    });

    test('is on with features.placements, and kept on the device', () {
      final user = _session(placements: true).user;
      expect(user.placementsEnabled, isTrue);
      expect(AuthUser.fromJson(user.toJson()).placementsEnabled, isTrue);
      expect(user.copyWith(interests: const ['x']).placementsEnabled, isTrue);
    });

    Future<void> pumpActions(
      WidgetTester tester, {
      required bool placements,
    }) async {
      phoneSize(tester);
      final session = _session(placements: placements);
      final bloc = ManagerBloc(
        session: session,
        service: ManagerApiService(
          session: session,
          baseUrl: 'https://example.test',
          client: MockClient(
            (request) async => _json({
              'success': true,
              'shift': _shift,
              'weekoffDays': [6],
              'hasManager': true,
              'team': <dynamic>[],
              'holidays': <dynamic>[],
              'leaves': <dynamic>[],
              'overtime': <dynamic>[],
              'regularizations': <dynamic>[],
              'claims': <dynamic>[],
              'types': <dynamic>[],
              'records': <dynamic>[],
              'balance': <String, dynamic>{},
            }),
          ),
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
          home: Scaffold(
            body: QuickActionsScreen(
              bloc: bloc,
              dashboard: bloc.state.dashboard!,
              controller: controller,
              profileAction: const SizedBox(width: 30, height: 30),
              onNotifications: () {},
              onOpenComposer: () {},
              placements: _FakePlacements().api(),
            ),
          ),
        ),
      );
      await settle(tester);
    }

    testWidgets('hides the Placements card from other companies', (
      tester,
    ) async {
      await pumpActions(tester, placements: false);
      expect(find.text('Support Desk'), findsOneWidget);
      expect(find.byKey(const ValueKey('placements-card')), findsNothing);
      expect(find.text('Placements'), findsNothing);
    });

    testWidgets('shows it with the flag, and it opens the hub', (tester) async {
      await pumpActions(tester, placements: true);
      final card = find.byKey(const ValueKey('placements-card'));
      expect(card, findsOneWidget);
      await tester.ensureVisible(card);
      await tester.tap(card);
      await settle(tester);
      expect(find.byKey(const ValueKey('placements-hub')), findsOneWidget);
      expect(find.text('My candidates'), findsOneWidget);
    });
  });

  group('the hub', () {
    testWidgets('counts my candidates and clients, from the lists of mine', (
      tester,
    ) async {
      final fake = await pumpPlacements(tester);
      expect(
        fake.sentTo('GET', '/placements/customers').single.url.query,
        'mine=1',
      );
      expect(
        fake.sentTo('GET', '/placements/clients').single.url.query,
        'mine=1',
      );
      expect(find.text('My candidates'), findsOneWidget);
      expect(find.text('My clients'), findsOneWidget);
      // Candidates: 1 not placed, 1 in process, 0 joined; clients: 2 roles,
      // 1 fee paid, 1 pending.
      Finder stat(String card, String label) => find.descendant(
        of: find.byKey(ValueKey(card)),
        matching: find
            .ancestor(of: find.text(label), matching: find.byType(Column))
            .first,
      );
      expect(
        find.descendant(
          of: stat('placements-candidates', 'Joined'),
          matching: find.text('0'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: stat('placements-clients', 'Open roles'),
          matching: find.text('2'),
        ),
        findsOneWidget,
      );
      await capture(tester, 'placements-hub');
    });

    testWidgets('a list that fails says why, with Try again', (tester) async {
      await pumpPlacements(
        tester,
        _FakePlacements({
          'GET /placements/customers': (_) => _json({
            'success': false,
            'message': 'Placements is not switched on',
          }, 403),
        }),
      );
      expect(find.text('Placements is not switched on'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    });
  });

  group('candidates', () {
    testWidgets('the list opens a candidate, and their client from there', (
      tester,
    ) async {
      final fake = await pumpPlacements(tester);
      await tapText(tester, 'My candidates');
      expect(find.text('Arjun Bhati'), findsOneWidget);
      expect(find.text('Sana Khan'), findsOneWidget);
      expect(find.text('In process'), findsWidgets);
      // The filter.
      await tapText(tester, 'Not placed', first: true);
      expect(find.text('Arjun Bhati'), findsNothing);
      await tapText(tester, 'All', first: true);
      await tapText(tester, 'Arjun Bhati');
      expect(fake.sentTo('GET', '/placements/customers/cu-1'), hasLength(1));
      expect(find.text('Field sales, Hindi and Marwari'), findsOneWidget);
      expect(find.text('Shastri Nagar, Jodhpur'), findsOneWidget);
      expect(find.text('Sales executive · ₹18,000 / month'), findsOneWidget);
      expect(find.text('Interview scheduled'), findsWidgets);
      expect(find.text('Candidate added'), findsOneWidget);
      await capture(tester, 'placements-candidate');
      await tapText(tester, 'Marwar Retail Pvt Ltd');
      expect(fake.sentTo('GET', '/placements/clients/cl-1'), hasLength(1));
      expect(find.text('Store manager'), findsOneWidget);
      expect(find.text('₹35,000 / month'), findsOneWidget);
      expect(find.text('Candidates at this client'), findsOneWidget);
    });

    testWidgets('Add candidate needs a name and a 10-digit mobile', (
      tester,
    ) async {
      final fake = await pumpPlacements(tester);
      await tapText(tester, 'My candidates');
      await tapText(tester, 'Add');
      await tapText(tester, 'Save candidate');
      expect(find.text('Enter their full name.'), findsOneWidget);
      await typeInto(tester, 'As on ID proof', 'Neha Choudhary');
      await typeInto(tester, '10-digit mobile', '98765');
      await tapText(tester, 'Save candidate');
      expect(find.text('Enter a 10-digit mobile number.'), findsOneWidget);
      await typeInto(tester, '10-digit mobile', '98765 43210');
      await typeInto(tester, '0', '4');
      await typeInto(tester, 'Current or preferred role', 'Accountant');
      await tapText(tester, 'Save candidate');
      final body = _body(fake.sentTo('POST', '/placements/customers').single);
      expect(body['name'], 'Neha Choudhary');
      expect(body['phone'], '+91 9876543210');
      expect(body['experienceYears'], 4);
      expect(body['currentRole'], 'Accountant');
    });

    testWidgets('Remove asks why, and sends it', (tester) async {
      final fake = await pumpPlacements(tester);
      await tapText(tester, 'My candidates');
      await tapText(tester, 'Arjun Bhati');
      await tester.tap(find.bySemanticsLabel('Remove candidate'));
      await settle(tester);
      expect(find.text('Remove Arjun Bhati?'), findsOneWidget);
      await tapText(tester, 'Not interested');
      await tapText(tester, 'Remove candidate');
      final sent = fake.sentTo('POST', '/placements/customers/cu-1/remove');
      expect(_body(sent.single)['reason'], 'Not interested');
      expect(find.text('My candidates'), findsOneWidget);
    });
  });

  group('placements', () {
    testWidgets('Add placement picks the client, then one of its roles', (
      tester,
    ) async {
      final fake = await pumpPlacements(tester);
      await tapText(tester, 'My candidates');
      await tapText(tester, 'Arjun Bhati');
      await tapText(tester, 'Add placement');
      await tapText(tester, 'Save placement');
      expect(find.text('Select the client company.'), findsOneWidget);
      await tapText(tester, 'Select client');
      await tapText(tester, 'Marwar Retail Pvt Ltd');
      await tapText(tester, "Choose from the client's roles");
      expect(find.text('₹35,000 / month'), findsOneWidget);
      await tapText(tester, 'Store manager');
      await tapText(tester, 'Interview scheduled');
      await capture(tester, 'placements-add');
      await tapText(tester, 'Save placement');
      final body = _body(fake.sentTo('POST', '/placements').single);
      expect(body['clientId'], 'cl-1');
      expect(body['customerId'], 'cu-1');
      expect(body['position'], 'Store manager');
      expect(body['status'], 'interviewing');
    });

    testWidgets('Update status saves every field, clearing what is empty', (
      tester,
    ) async {
      final fake = await pumpPlacements(tester);
      await tapText(tester, 'My candidates');
      await tapText(tester, 'Arjun Bhati');
      await tapText(tester, 'Update status');
      await tapText(tester, 'Selected');
      await tester.tap(find.byTooltip('Clear Interview date'));
      await tester.pump();
      await tapText(tester, 'Save changes');
      final body = _body(fake.sentTo('PATCH', '/placements/p1').single);
      expect(body['status'], 'offered');
      expect(
        body.containsKey('interviewDate') && body['interviewDate'] == null,
        isTrue,
      );
    });
  });

  group('clients', () {
    testWidgets('Add client sends its roles and the fee', (tester) async {
      final fake = await pumpPlacements(tester);
      await tapText(tester, 'My clients');
      expect(find.text('Fee pending'), findsWidgets);
      await tapText(tester, 'Add');
      await tapText(tester, 'Save client');
      expect(find.text('Enter the company name.'), findsOneWidget);
      await typeInto(tester, 'Registered or trade name', 'Thar Agro Foods');
      await typeInto(tester, 'City or full address', 'Pali Road, Jodhpur');
      await typeInto(tester, 'e.g. Store manager', 'Accountant');
      await typeInto(tester, 'Amount', '22000');
      await tapText(tester, 'Payment received');
      await tapText(tester, 'Save client');
      final body = _body(fake.sentTo('POST', '/placements/clients').single);
      expect(body['name'], 'Thar Agro Foods');
      expect(body['city'], 'Pali Road, Jodhpur');
      expect(body['feePaid'], isTrue);
      expect((body['designations'] as List).single, {
        'title': 'Accountant',
        'budgetRupees': 22000.0,
        'budgetPeriod': 'month',
        'description': '',
      });
    });
  });
}
