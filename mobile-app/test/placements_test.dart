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

final _summaryJson = {
  'success': true,
  'clients': 4,
  'customers': 9,
  'placements': {
    'total': 6,
    'byStatus': {
      'shortlisted': 2,
      'interviewing': 1,
      'offered': 1,
      'joined': 1,
      'dropped': 1,
    },
  },
};

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
  String? joiningDate,
}) => {
  'id': id,
  'customerId': 'cu-$id',
  'customerName': customer,
  'clientId': 'cl-1',
  'clientName': 'Acme Industries',
  'position': 'Accountant',
  'status': status,
  'interviewDate': '2026-11-02',
  'joiningDate': joiningDate,
  'ctcRupees': 600000,
  'feeRupees': 50000,
  'notes': '',
  'createdAt': '2026-10-20T10:00:00.000Z',
  'updatedAt': '2026-10-20T10:00:00.000Z',
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
      'GET /placements/summary' => _json(_summaryJson),
      'GET /placements' => _json({
        'success': true,
        'placements': [
          _placement('p1', 'Asha Verma', 'interviewing'),
          _placement('p2', 'Rohit Nair', 'joined', joiningDate: '2026-10-01'),
        ],
      }),
      'GET /placements/clients' => _json({
        'success': true,
        'clients': [
          {
            'id': 'cl-1',
            'name': 'Acme Industries',
            'industry': 'Manufacturing',
            'city': 'Pune',
          },
        ],
      }),
      'GET /placements/customers' => _json({
        'success': true,
        'customers': [
          {
            'id': 'cu-1',
            'name': 'Asha Verma',
            'phone': '9876543210',
            'currentRole': 'Accountant',
          },
        ],
      }),
      'POST /placements/clients' => _json({
        'success': true,
        'client': {
          'id': 'cl-new',
          ...jsonDecode(request.body) as Map<String, dynamic>,
        },
      }, 201),
      'POST /placements/customers' => _json({
        'success': true,
        'customer': {
          'id': 'cu-new',
          ...jsonDecode(request.body) as Map<String, dynamic>,
        },
      }, 201),
      'POST /placements' => _json({
        'success': true,
        'placement': {
          'id': 'p-new',
          'customerName': 'Asha Verma',
          'clientName': 'Acme Industries',
          ...jsonDecode(request.body) as Map<String, dynamic>,
        },
      }, 201),
      _ when request.method == 'PATCH' => _json({
        'success': true,
        'placement': {
          ..._placement('p1', 'Asha Verma', 'interviewing'),
          ...jsonDecode(request.body) as Map<String, dynamic>,
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

  Future<void> tapText(WidgetTester tester, String text) async {
    final target = find.text(text).last;
    await tester.ensureVisible(target);
    // The jump lands on the next frame.
    await tester.pump();
    await tester.tap(target);
    await settle(tester);
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
      expect(find.text('Asha Verma'), findsOneWidget);
    });
  });

  group('the hub', () {
    testWidgets('draws the summary, the Add buttons and the placements', (
      tester,
    ) async {
      final fake = await pumpPlacements(tester);
      expect(fake.sentTo('GET', '/placements').single.url.query, 'mine=1');
      expect(find.text('6'), findsOneWidget); // total
      expect(find.text('4'), findsOneWidget); // clients
      expect(find.text('9'), findsOneWidget); // customers
      expect(find.text('Clients'), findsOneWidget);
      expect(find.text('Customers'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('placements-add-client')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('placements-add-customer')),
        findsOneWidget,
      );
      expect(find.text('Asha Verma'), findsOneWidget);
      expect(find.text('Accountant · Acme Industries'), findsNWidgets(2));
      // The status on its pill, after the legend's own "Interviewing".
      expect(find.text('Interviewing'), findsNWidgets(2));
      expect(find.text('Interview 2 Nov 2026'), findsOneWidget);
      expect(find.text('Joined 1 Oct 2026'), findsOneWidget);
      await capture(tester, 'placements_hub');
    });

    testWidgets('a failing summary leaves the placements', (tester) async {
      await pumpPlacements(
        tester,
        _FakePlacements({
          'GET /placements/summary': (_) =>
              _json({'success': false, 'message': 'boom'}, 500),
        }),
      );
      expect(
        find.byKey(const ValueKey('placements-summary-error')),
        findsOneWidget,
      );
      expect(find.text('The summary didn\'t load.'), findsOneWidget);
      expect(find.text('Asha Verma'), findsOneWidget);
      expect(find.text('Rohit Nair'), findsOneWidget);
      await capture(tester, 'placements_hub_summary_failed');
    });

    testWidgets('a refused list says why, and leaves the summary', (
      tester,
    ) async {
      final fake = _FakePlacements({
        'GET /placements': (_) => _json({
          'success': false,
          'message': 'Placements are not enabled for your company',
        }, 403),
      });
      await pumpPlacements(tester, fake);
      expect(
        find.byKey(const ValueKey('placements-list-error')),
        findsOneWidget,
      );
      expect(
        find.text('Placements are not enabled for your company'),
        findsOneWidget,
      );
      expect(find.text('9'), findsOneWidget);

      // Try again reads the list once more, and this time it comes.
      fake.replies.remove('GET /placements');
      final retry = find.descendant(
        of: find.byKey(const ValueKey('placements-list-error')),
        matching: find.text('Try again'),
      );
      await tester.ensureVisible(retry);
      await tester.tap(retry);
      await settle(tester);
      expect(find.text('Asha Verma'), findsOneWidget);
    });

    testWidgets('a placement opens on its detail, and its status changes', (
      tester,
    ) async {
      final fake = await pumpPlacements(tester);
      await tapText(tester, 'Asha Verma');
      expect(find.byKey(const ValueKey('placement-detail')), findsOneWidget);
      expect(find.text('₹600,000'), findsOneWidget);
      await capture(tester, 'placement_detail');

      // Nothing to send until a different status is picked.
      await tapText(tester, 'Update Status');
      expect(fake.sent.where((r) => r.method == 'PATCH'), isEmpty);

      await tester.tap(find.byKey(const ValueKey('placement-status-field')));
      await settle(tester);
      await tapText(tester, 'Joined');
      await tapText(tester, 'Update Status');
      final patch = fake.sent.singleWhere((r) => r.method == 'PATCH');
      expect(patch.url.path, '/placements/p1');
      expect(_body(patch), {'status': 'joined'});
      expect(find.text('Status changed to Joined'), findsOneWidget);
    });
  });

  group('Add client', () {
    testWidgets('needs a name, and a real email when one is given', (
      tester,
    ) async {
      final fake = await pumpPlacements(tester);
      await tapKey(tester, 'placements-add-client');
      expect(find.byKey(const ValueKey('client-form')), findsOneWidget);

      await tapText(tester, 'Add Client');
      expect(fake.sentTo('POST', '/placements/clients'), isEmpty);

      await type(tester, 'client-name', 'Acme Industries');
      await type(tester, 'client-email', 'hr@acme');
      expect(find.text('Enter a valid email address.'), findsOneWidget);
      await capture(tester, 'client_form_problem');
      await tapText(tester, 'Add Client');
      expect(fake.sentTo('POST', '/placements/clients'), isEmpty);

      await type(tester, 'client-phone', '12');
      await type(tester, 'client-email', 'hr@acme.in');
      expect(
        find.text('Enter a valid phone number, with at least 10 digits.'),
        findsOneWidget,
      );
      await type(tester, 'client-phone', '98765 43210');
      expect(find.text('Enter a valid email address.'), findsNothing);

      await tapText(tester, 'Add Client');
      final sent = fake.sentTo('POST', '/placements/clients').single;
      expect(_body(sent), {
        'name': 'Acme Industries',
        'phone': '98765 43210',
        'email': 'hr@acme.in',
      });
      expect(find.text('Client Added'), findsOneWidget);
    });

    testWidgets('shows what the server said when it refuses', (tester) async {
      await pumpPlacements(
        tester,
        _FakePlacements({
          'POST /placements/clients': (_) => _json({
            'success': false,
            'message': 'A client with this name already exists',
          }, 400),
        }),
      );
      await tapKey(tester, 'placements-add-client');
      await type(tester, 'client-name', 'Acme Industries');
      await tapText(tester, 'Add Client');
      expect(
        find.text('A client with this name already exists'),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('client-form')), findsOneWidget);
    });
  });

  group('Add customer', () {
    testWidgets('needs a name and a phone, and checks the rest', (
      tester,
    ) async {
      final fake = await pumpPlacements(tester);
      await tapKey(tester, 'placements-add-customer');
      expect(find.byKey(const ValueKey('customer-form')), findsOneWidget);

      await type(tester, 'customer-name', 'Asha Verma');
      await tapText(tester, 'Add Customer');
      expect(fake.sentTo('POST', '/placements/customers'), isEmpty);

      await type(tester, 'customer-phone', '98765');
      expect(
        find.text('Enter a valid phone number, with at least 10 digits.'),
        findsOneWidget,
      );
      await type(tester, 'customer-phone', '+91 98765 43210');
      await type(tester, 'customer-experience', 'three');
      expect(
        find.text('Enter the years of experience as a number, like 3 or 4.5.'),
        findsOneWidget,
      );
      await type(tester, 'customer-experience', '3.5');

      await type(tester, 'customer-skill', 'Tally, Excel');
      await tapText(tester, 'Add');
      expect(find.text('Tally'), findsOneWidget);
      expect(find.text('Excel'), findsOneWidget);
      await capture(tester, 'customer_form');
      await type(tester, 'customer-skill', 'GST');

      await tapText(tester, 'Add Customer');
      final sent = fake.sentTo('POST', '/placements/customers').single;
      expect(_body(sent), {
        'name': 'Asha Verma',
        'phone': '+91 98765 43210',
        'experienceYears': 3.5,
        'skills': ['Tally', 'Excel', 'GST'],
      });
      expect(find.text('Customer Added'), findsOneWidget);
    });
  });

  group('Add placement', () {
    testWidgets('needs a customer, a client and a position', (tester) async {
      final fake = await pumpPlacements(tester);
      await tapText(tester, 'Add Placement');
      expect(find.byKey(const ValueKey('placement-form')), findsOneWidget);
      expect(find.text('Shortlisted'), findsOneWidget);

      await type(tester, 'placement-position', 'Accountant');
      await tapText(tester, 'Add Placement');
      expect(fake.sentTo('POST', '/placements'), isEmpty);

      await tapText(tester, 'Select customer');
      expect(fake.sentTo('GET', '/placements/customers'), hasLength(1));
      await tapText(tester, 'Asha Verma');
      await tapText(tester, 'Select client');
      await tapText(tester, 'Acme Industries');

      await type(tester, 'placement-ctc', '6 lakh');
      expect(
        find.text('Enter the CTC in rupees, digits only.'),
        findsOneWidget,
      );
      await tapText(tester, 'Add Placement');
      expect(fake.sentTo('POST', '/placements'), isEmpty);
      await type(tester, 'placement-ctc', '6,00,000');
      await type(tester, 'placement-fee', '50000');
      await capture(tester, 'placement_form');

      await tapText(tester, 'Add Placement');
      final sent = fake.sentTo('POST', '/placements').single;
      expect(_body(sent), {
        'customerId': 'cu-1',
        'clientId': 'cl-1',
        'position': 'Accountant',
        'status': 'shortlisted',
        'ctcRupees': 600000.0,
        'feeRupees': 50000.0,
      });
      expect(find.text('Placement Added'), findsOneWidget);
      await capture(tester, 'placement_added');
    });

    testWidgets('"Add new" customer comes back with them chosen', (
      tester,
    ) async {
      final fake = await pumpPlacements(tester);
      await tapText(tester, 'Add Placement');
      await tapText(tester, 'Select customer');
      await tapText(tester, 'Add new customer');
      expect(find.byKey(const ValueKey('customer-form')), findsOneWidget);
      await type(tester, 'customer-name', 'Meera Iyer');
      await type(tester, 'customer-phone', '9123456780');
      await tapText(tester, 'Add Customer');
      expect(fake.sentTo('POST', '/placements/customers'), hasLength(1));
      expect(find.byKey(const ValueKey('placement-form')), findsOneWidget);
      expect(find.text('Meera Iyer'), findsOneWidget);
    });
  });
}
