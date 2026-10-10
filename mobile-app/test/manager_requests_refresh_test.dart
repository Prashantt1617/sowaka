// Something about a request changed — the live channel, a notification, a
// reconnection — and the app reads the request lists again, not the whole
// dashboard. The attendance calendar paged back a month keeps that month
// through every read, and a notification that is not about a request (a
// post, a support reply) reads nothing at all.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'priya',
    email: 'priya@example.test',
    name: 'Priya',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
  ),
);

String _day(DateTime date) =>
    '${date.year}-${'${date.month}'.padLeft(2, '0')}-'
    '${'${date.day}'.padLeft(2, '0')}';

const _months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

String _monthLabel(DateTime month) =>
    '${_months[month.month - 1]} ${month.year}';

http.Response _ok(Map<String, dynamic> body) =>
    http.Response(jsonEncode({'success': true, ...body}), 200);

/// A server for one employee, noting every call it is asked: one worked day
/// on the first of whichever month the attendance is read for.
ManagerBloc _bloc(List<String> calls) {
  final client = MockClient((request) async {
    final url = request.url;
    calls.add(url.hasQuery ? '${url.path}?${url.query}' : url.path);
    if (url.path.endsWith('/manager/workspace')) {
      return _ok({
        'team': <dynamic>[],
        'recognitionCandidates': <dynamic>[],
        'nominations': <dynamic>[],
        'recognitionHistory': <dynamic>[],
        'myParameters': <dynamic>[],
        'growthHistory': <dynamic>[],
        'holidays': <dynamic>[],
        'myOrgChart': <dynamic>[],
        'weekoffDays': [0],
        'shift': <String, dynamic>{},
        'overtimeEnabled': true,
        'hasManager': true,
        'teamLevel': 1,
        'managerScore': 0,
      });
    }
    if (url.path.endsWith('/attendance/mine')) {
      final from = url.queryParameters['from']!;
      return _ok({
        'records': [
          {
            'workDate': from,
            'punchIn': '${from}T04:00:00.000Z',
            'punchOut': '${from}T12:30:00.000Z',
          },
        ],
        'regularizations': <dynamic>[],
        'days': [
          {'date': from, 'status': 'present'},
        ],
      });
    }
    return _ok({
      'leaves': <dynamic>[],
      'overtime': <dynamic>[],
      'regularizations': <dynamic>[],
      'claims': <dynamic>[],
      'types': <dynamic>[],
      'balance': <String, dynamic>{},
    });
  });
  return ManagerBloc(
    session: _session,
    service: ManagerApiService(
      session: _session,
      baseUrl: 'https://example.test',
      client: client,
    ),
  );
}

void main() {
  final now = DateTime.now();
  final thisMonth = DateTime(now.year, now.month);
  final viewed = DateTime(now.year, now.month - 1);
  final viewedRange =
      'from=${_day(viewed)}&to=${_day(DateTime(viewed.year, viewed.month + 1, 0))}';

  group('with the calendar paged back a month', () {
    late List<String> calls;
    late ManagerBloc bloc;

    setUp(() async {
      calls = [];
      bloc = _bloc(calls);
      await bloc.add(const LoadManagerDashboard());
      await bloc.add(LoadAttendanceMonth(viewed));
      calls.clear();
    });

    tearDown(() => bloc.dispose());

    // Past the coalescing window and the reads behind it.
    Future<void> settle() =>
        Future<void>.delayed(const Duration(milliseconds: 900));

    void expectViewedMonthKept() {
      final dashboard = bloc.state.dashboard!;
      expect(bloc.attendanceMonth, viewed);
      expect(dashboard.attendance.single.workDate, viewed);
      expect(dashboard.serverDays.keys, [_day(viewed)]);
    }

    test('a reconnection reads the request lists for that month', () async {
      bloc.refreshRequestsNow();
      await settle();

      expect(calls, isNot(contains('/manager/workspace')));
      expect(calls, isNot(contains('/leaves/balance')));
      expect(calls, contains('/attendance/mine?$viewedRange'));
      expect(
        calls,
        containsAll(['/leaves/mine', '/overtime/mine', '/reimbursements/mine']),
      );
      expect(
        calls.where((call) => call.startsWith('/attendance/mine')),
        hasLength(1),
      );
      expectViewedMonthKept();
    });

    test('a notification that is not about a request reads nothing', () async {
      bloc.refreshRequestsNow('support_reply');
      bloc.refreshRequestsNow('connect_post');
      await settle();

      expect(calls, isEmpty);
      expectViewedMonthKept();
    });

    test('a leave change reads the leaves and nothing of attendance', () async {
      bloc.refreshRequestsNow('leave_decided');
      await settle();

      expect(calls, contains('/leaves/mine'));
      expect(calls.where((call) => call.startsWith('/attendance')), isEmpty);
      expect(calls, isNot(contains('/manager/workspace')));
    });

    test('a burst of attendance changes reads that month once', () async {
      bloc.refreshRequestsNow('correction_decided');
      bloc.refreshRequestsNow('attendance');
      bloc.refreshRequestsNow('punch_out');
      await settle();

      expect(calls, ['/attendance/mine?$viewedRange']);
      expectViewedMonthKept();
    });

    test('a full load reads that month, not this one', () async {
      await bloc.add(const LoadManagerDashboard());

      expect(calls, contains('/manager/workspace'));
      expect(calls, contains('/attendance/mine?$viewedRange'));
      expectViewedMonthKept();
    });
  });

  testWidgets('the calendar keeps its month through a reconnection, and '
      'leaving it brings this month back', (tester) async {
    tester.view.physicalSize = const Size(430, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final calls = <String>[];
    final bloc = _bloc(calls);
    await tester.runAsync(() => bloc.add(const LoadManagerDashboard()));
    final controller = QuickActionsController();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StreamBuilder<ManagerState>(
            stream: bloc.stream,
            initialData: bloc.state,
            builder: (context, snapshot) => QuickActionsScreen(
              bloc: bloc,
              dashboard: snapshot.data!.dashboard!,
              controller: controller,
              profileAction: const SizedBox(width: 30, height: 30),
              onNotifications: () {},
              onOpenComposer: () {},
            ),
          ),
        ),
      ),
    );
    controller.openCalendar();
    await tester.pumpAndSettle();
    expect(find.text(_monthLabel(thisMonth)), findsOneWidget);

    await tester.tap(find.byType(AttendanceCalendarArrow).first);
    await tester.pumpAndSettle();
    expect(find.text(_monthLabel(viewed)), findsOneWidget);
    expect(bloc.state.dashboard!.attendance.single.workDate, viewed);

    // Back from the background: the lists are read, the month stays.
    calls.clear();
    bloc.refreshRequestsNow();
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
    expect(calls, contains('/attendance/mine?$viewedRange'));
    expect(calls, isNot(contains('/manager/workspace')));
    expect(find.text(_monthLabel(viewed)), findsOneWidget);
    expect(bloc.state.dashboard!.attendance.single.workDate, viewed);

    // The page underneath reads today from the same days.
    controller.handleBack();
    await tester.pumpAndSettle();
    expect(bloc.attendanceMonth, thisMonth);
    expect(bloc.state.dashboard!.attendance.single.workDate, thisMonth);

    await tester.pumpWidget(const SizedBox.shrink());
    bloc.dispose();
    controller.dispose();
  });
}
