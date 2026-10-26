// The Actions home and its Leave, Overtime and Reimbursement screens as Figma
// 4194:21787 and 4166:19856 draw them, against a fake server: each type's
// picture, the summary bars, and the cards a request is listed on. A layout
// that overflows fails the test.
//
// `flutter test --dart-define=SCREENSHOTS=<dir> test/quick_actions_hubs_render_test.dart`
// also writes each screen to <dir> as a PNG, to hold against the design.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
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

Map<String, dynamic> _shift({required bool tracked}) => {
  'name': 'Default',
  'startTime': '09:30',
  'endTime': '18:30',
  'minHalfDayHours': 4,
  'minFullDayHours': 8,
  'weeklyOff': {
    '1': [6],
    '2': [6],
    '3': [6],
    '4': [6],
    '5': [6],
  },
  'overtimeBackdateDays': 21,
  'leaveTypes': [
    for (final (key, name) in [
      ('casual', 'Casual Leave'),
      ('sick', 'Sick Leave'),
      ('earned', 'Earned Leave'),
      ('lwp', 'LWP'),
    ])
      {
        'key': key,
        'name': name,
        'advanceDays': 30,
        'allowBackdated': true,
        'backdatedDays': 30,
      },
  ],
  'leaveBalanceTracked': tracked,
  'correction': {
    'triggers': ['Missing punch-in'],
    'backdateDays': 15,
    'punchFormat': 'In-app punch in',
    'punchMode': 'Both punches',
  },
};

http.Response _json(Object body) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

String _day(DateTime day) => DateTime.utc(
  day.year,
  day.month,
  day.day,
).toIso8601String().substring(0, 10);

MockClient _server({required bool tracked}) {
  final today = DateTime.now();
  final soon = today.add(const Duration(days: 3));
  Map<String, dynamic> leave(
    String type,
    String name,
    DateTime start,
    DateTime end,
    String status,
  ) => {
    'id': '$type-${start.day}',
    'type': type,
    'typeName': name,
    'startDate': _day(start),
    'endDate': _day(end),
    'days': end.difference(start).inDays + 1,
    'status': status,
    'reason': 'Family',
    'createdAt': today.toUtc().toIso8601String(),
  };
  Map<String, dynamic> overtime(String duration, double hours, String status) =>
      {
        'id': 'ot-$duration',
        'workDate': _day(today),
        'startTime': today.toUtc().toIso8601String(),
        'endTime': today.toUtc().toIso8601String(),
        'hours': hours,
        'duration': duration,
        'status': status,
        'note': '',
        'createdAt': today.toUtc().toIso8601String(),
      };
  Map<String, dynamic> claim(String category, int amount, String status) => {
    'id': 'claim-$category',
    'category': category,
    'amount': amount,
    'expenseDate': _day(today),
    'status': status,
    'createdAt': today.toUtc().toIso8601String(),
  };
  return MockClient((request) async {
    final path = request.url.path;
    if (path.endsWith('/manager/workspace')) {
      return _json({
        'success': true,
        'team': <dynamic>[],
        'holidays': <dynamic>[],
        'weekoffDays': [6],
        'shift': _shift(tracked: tracked),
        'overtimeEnabled': true,
        'hasManager': true,
      });
    }
    if (path.endsWith('/leaves/balance')) {
      return _json({
        'success': true,
        'balance': {
          'year': today.year,
          'types': [
            for (final (key, name, total, remaining) in [
              ('casual', 'Casual Leave', 10, 8),
              ('sick', 'Sick Leave', 8, 5),
              ('earned', 'Earned Leave', 12, 5),
            ])
              {
                'key': key,
                'name': name,
                'total': total,
                'used': total - remaining,
                'remaining': remaining,
              },
          ],
        },
      });
    }
    if (path.endsWith('/leaves/mine')) {
      return _json({
        'success': true,
        'leaves': [
          leave(
            'casual',
            'Casual Leave',
            soon,
            soon.add(const Duration(days: 1)),
            'approved',
          ),
          leave('lwp', 'LWP', soon, soon, 'pending'),
          leave('earned', 'Earned Leave', soon, soon, 'pending'),
        ],
      });
    }
    if (path.endsWith('/overtime/mine')) {
      return _json({
        'success': true,
        'overtime': [
          overtime('half_day', 2.25, 'pending'),
          overtime('full_day', 1.5, 'approved'),
        ],
      });
    }
    if (path.endsWith('/reimbursements/mine')) {
      return _json({
        'success': true,
        'claims': [
          claim('hotel', 5000, 'pending'),
          claim('transport', 2450, 'pending'),
          claim('book/course', 2450, 'pending'),
          claim('meal', 2450, 'pending'),
          claim('internet', 2450, 'approved'),
        ],
      });
    }
    if (path.contains('/attendance/mine')) {
      final punchIn = DateTime(today.year, today.month, today.day, 9, 42);
      return _json({
        'success': true,
        'records': [
          {
            'workDate': _day(today),
            'punchIn': punchIn.toUtc().toIso8601String(),
          },
        ],
        'regularizations': <dynamic>[],
      });
    }
    return _json({
      'success': true,
      'leaves': <dynamic>[],
      'overtime': <dynamic>[],
      'regularizations': <dynamic>[],
      'claims': <dynamic>[],
      'types': <dynamic>[],
      'records': <dynamic>[],
      'balance': <String, dynamic>{},
    });
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

  Future<QuickActionsController> pumpActions(
    WidgetTester tester, {
    bool tracked = true,
  }) async {
    tester.view.physicalSize = const Size(393 * 2, 852 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final bloc = ManagerBloc(
      session: _session,
      service: ManagerApiService(
        session: _session,
        baseUrl: 'https://example.test',
        client: _server(tracked: tracked),
      ),
    );
    await tester.runAsync(() => bloc.add(const LoadManagerDashboard()));
    final controller = QuickActionsController();
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
          ),
        ),
      ),
    );
    await tester.pump();
    // Images decode off the fake clock.
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 300)),
    );
    await tester.pump(const Duration(milliseconds: 300));
    addTearDown(() async {
      bloc.dispose();
      controller.dispose();
    });
    return controller;
  }

  Future<void> open(WidgetTester tester, String card) async {
    await tester.tap(find.text(card).first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 300)),
    );
    await tester.pump(const Duration(milliseconds: 100));
  }

  Future<void> capture(WidgetTester tester, String name) async {
    if (_screenshots.isEmpty) return;
    await expectLater(
      find.byType(QuickActionsScreen),
      matchesGoldenFile(Uri.file('$_screenshots/$name.png')),
    );
  }

  testWidgets('the Actions home, punched in', (tester) async {
    await pumpActions(tester);
    expect(find.text('Slide to Punch Out'), findsOneWidget);
    expect(find.text('PUNCH-IN'), findsOneWidget);
    expect(find.text('09:42 AM'), findsOneWidget);
    await capture(tester, 'home');
  });

  testWidgets('Leave: balances, policy line and requests', (tester) async {
    await pumpActions(tester);
    await open(tester, 'Leave');
    expect(find.text('8/10'), findsOneWidget);
    expect(find.text('Casual Leave'), findsWidgets);
    expect(find.text('2 Days'), findsOneWidget);
    expect(find.text('LWP'), findsOneWidget);
    await capture(tester, 'leave');
  });

  testWidgets('Leave without a balance: this year', (tester) async {
    await pumpActions(tester, tracked: false);
    await open(tester, 'Leave');
    expect(find.text('Approved Leave'), findsOneWidget);
    expect(find.text('Pending Leave'), findsOneWidget);
    await capture(tester, 'leave_year');
  });

  testWidgets('Overtime: days claimed and the requests', (tester) async {
    await pumpActions(tester);
    await open(tester, 'Overtime');
    expect(find.text('1.5 Days'), findsOneWidget);
    expect(find.text('Half-day'), findsOneWidget);
    expect(find.text('2h 15m'), findsOneWidget);
    await capture(tester, 'overtime');
  });

  testWidgets('Reimbursement: amounts and the claims', (tester) async {
    await pumpActions(tester);
    await open(tester, 'Reimbursement');
    expect(find.text('Hotel'), findsOneWidget);
    expect(find.text('₹5,000'), findsOneWidget);
    await capture(tester, 'reimbursement');
  });
}
