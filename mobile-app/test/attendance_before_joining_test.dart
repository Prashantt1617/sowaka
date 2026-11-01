// Days before someone joined are empty on the calendar, not absent: whether
// the app graded the month alone (from the joining date) or the server
// settled it (`before_joining`).
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';

void main() {
  final month = DateTime(2026, 9);
  AttendanceDayView on(List<AttendanceDayView> days, int day) => days.firstWhere((d) => d.date.day == day);

  test('graded by the app alone, from the joining date', () {
    final days = buildAttendanceDays(
      month: month, records: const [], regularizations: const [], leaves: const [], holidays: const [], overtime: const [],
      shift: const ShiftPolicy(), joinedOn: DateTime(2026, 9, 10),
    );
    expect(on(days, 9).kind, AttendanceKind.future);
    expect(on(days, 9).title, 'Before joining');
    expect(on(days, 9).cellLabel, '');
    expect(on(days, 9).beforeJoining, isTrue);
    expect(on(days, 10).title, isNot('Before joining'));
    expect(on(days, 10).beforeJoining, isFalse);
    expect(on(days, 11).kind, AttendanceKind.attention);
  });

  test('settled by the server', () {
    final server = ServerDayStatus.parseAll(const {
      'days': [
        {'date': '2026-09-09', 'status': 'before_joining', 'label': 'Before joining', 'reason': 'Before joining', 'source': 'rules', 'final': true},
      ],
    });
    final days = buildAttendanceDays(
      month: month, records: const [], regularizations: const [], leaves: const [], holidays: const [], overtime: const [],
      shift: const ShiftPolicy(), serverDays: server,
    );
    expect(on(days, 9).kind, AttendanceKind.future);
    expect(on(days, 9).title.startsWith('Before joining'), isTrue);
    expect(on(days, 9).needsCorrection, isFalse);
    expect(on(days, 9).beforeJoining, isTrue);
  });

  testWidgets('a day before joining says so, with no punches and nothing to do', (tester) async {
    final day = AttendanceDayView(date: DateTime(2026, 9, 9), kind: AttendanceKind.future, title: 'Before joining', cellLabel: '', beforeJoining: true);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: AttendanceDayDetail(day: day, blockedReason: 'Before your joining date'))));
    expect(find.text('Before joining'), findsOneWidget);
    expect(find.text('Upcoming'), findsNothing);
    expect(find.text('Punch-in'), findsNothing);
    expect(find.text('Before your joining date'), findsOneWidget);
  });

  testWidgets('tapping a day before joining offers no correction; a missed day after it does', (tester) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final now = DateTime.now();
    final joined = DateTime(now.year, now.month - 1, 14);
    String ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    http.Response ok(Map<String, dynamic> body) => http.Response(jsonEncode({'success': true, ...body}), 200, headers: {'content-type': 'application/json'});
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/manager/workspace')) {
        return ok({
          'team': <dynamic>[],
          'holidays': <dynamic>[],
          'shift': {
            'name': 'Default',
            'startTime': '09:30',
            'endTime': '18:30',
            'minHalfDayHours': 4,
            'minFullDayHours': 8,
            'leaveTypes': [
              {'key': 'casual', 'name': 'Casual Leave', 'advanceDays': 30, 'allowBackdated': true, 'backdatedDays': 90, 'unpaid': false},
            ],
            'correction': {
              'triggers': ['Missing punch-in', 'Missing punch-out', 'Both punches missing'],
              'backdateDays': 90,
              'punchFormat': 'In-app punch in',
              'punchMode': 'Both punches',
            },
          },
        });
      }
      return ok({'leaves': <dynamic>[], 'overtime': <dynamic>[], 'regularizations': <dynamic>[], 'claims': <dynamic>[], 'types': <dynamic>[], 'records': <dynamic>[], 'balance': <String, dynamic>{}});
    });
    final session = AuthSession(
      token: 'token',
      user: AuthUser(id: 'tanvi', email: 'tanvi@sowaka.test', name: 'Tanvi Arora', role: 'employee', company: 'Sowaka', org: 'sowaka', joiningDate: ymd(joined)),
    );
    final bloc = ManagerBloc(session: session, service: ManagerApiService(session: session, baseUrl: 'https://example.test', client: client));
    final controller = QuickActionsController();
    addTearDown(() {
      bloc.dispose();
      controller.dispose();
    });
    await tester.runAsync(() => bloc.add(const LoadManagerDashboard()));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StreamBuilder<ManagerState>(
            stream: bloc.stream,
            initialData: bloc.state,
            builder: (context, snapshot) => QuickActionsScreen(
              bloc: bloc,
              dashboard: (snapshot.data ?? bloc.state).dashboard!,
              controller: controller,
              profileAction: const SizedBox(width: 30, height: 30),
              onNotifications: () {},
              onOpenComposer: () {},
            ),
          ),
        ),
      ),
    );
    Future<void> settle() async {
      for (var i = 0; i < 4; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
        await tester.pump(const Duration(milliseconds: 300));
      }
    }

    await settle();
    await tester.tap(find.text('Attendance').first);
    await settle();
    await tester.tap(find.byWidgetPredicate((w) => w is AttendanceCalendarArrow && w.asset.endsWith('prev.svg')));
    await settle();

    Future<void> tapDay(int day) async {
      final cell = find.descendant(of: find.byType(AttendanceMonthGrid), matching: find.text('$day'));
      await tester.ensureVisible(cell.first);
      await tester.tap(cell.first);
      await settle();
    }

    // The 9th: before joining.
    await tapDay(9);
    expect(find.text('Before joining'), findsOneWidget);
    expect(find.text('Upcoming'), findsNothing);
    expect(find.text('Request Correction'), findsNothing);
    expect(find.text('Apply Leave'), findsNothing);
    expect(find.textContaining('Before your joining date'), findsOneWidget);

    // The first weekday after joining, with no punches: still correctable.
    var missed = DateTime(joined.year, joined.month, joined.day + 1);
    while (missed.weekday >= DateTime.saturday) {
      missed = DateTime(missed.year, missed.month, missed.day + 1);
    }
    await tapDay(missed.day);
    expect(find.text('Request Correction'), findsOneWidget);
    expect(find.text('Before joining'), findsNothing);
  });
}
