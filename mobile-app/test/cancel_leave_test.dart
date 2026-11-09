// Taking a leave back from the attendance calendar (Figma 2112:69787 and
// 2112:69226): a leave still to come wears its tag and offers "Cancel Leave"
// under the punch card; the sheet takes a note for the manager; once the
// server agrees the day is plain again and a toast says so. A cancelled leave
// leaves no mark on the calendar.
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
  String ymd(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  LeaveRequest leaveOn(DateTime day, String status) => LeaveRequest.fromJson({
    'id': 'lv1',
    'userId': 'tanvi',
    'type': 'casual',
    'typeName': 'Casual Leave',
    'startDate': ymd(day),
    'endDate': ymd(day),
    'days': 1,
    'reason': 'Trip',
    'status': status,
    'createdAt': '2026-09-01T09:00:00.000Z',
  });

  test('a cancelled leave leaves no mark on the day', () {
    final month = DateTime(2026, 9);
    final days = buildAttendanceDays(
      month: month,
      records: const [],
      regularizations: const [],
      leaves: [leaveOn(DateTime(2026, 9, 16), 'cancelled')],
      holidays: const [],
      overtime: const [],
      shift: const ShiftPolicy(),
    );
    final day = days.firstWhere((d) => d.date.day == 16);
    expect(day.kind, isNot(AttendanceKind.leavePending));
    expect(day.kind, isNot(AttendanceKind.leaveApproved));
    final pending = buildAttendanceDays(
      month: month,
      records: const [],
      regularizations: const [],
      leaves: [leaveOn(DateTime(2026, 9, 16), 'pending')],
      holidays: const [],
      overtime: const [],
      shift: const ShiftPolicy(),
    ).firstWhere((d) => d.date.day == 16);
    expect(pending.kind, AttendanceKind.leavePending);
  });

  testWidgets(
    'a link action is a small text link under the punch card, not a button',
    (tester) async {
      final day = AttendanceDayView(
        date: DateTime(2026, 9, 16),
        kind: AttendanceKind.leavePending,
        title: 'Leave applied',
        cellLabel: 'Leave',
      );
      var tapped = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AttendanceDayDetail(
              day: day,
              actions: [
                AttendanceDayAction(
                  label: 'Cancel Leave',
                  link: true,
                  onTap: () => tapped = true,
                ),
              ],
            ),
          ),
        ),
      );
      expect(find.text('Leave Applied'), findsOneWidget);
      expect(find.text('Punch-in'), findsOneWidget);
      expect(find.widgetWithText(TextButton, 'Cancel Leave'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Cancel Leave'), findsNothing);
      await tester.tap(find.text('Cancel Leave'));
      expect(tapped, isTrue);
    },
  );

  testWidgets('from the calendar: the sheet, the note, the server, the toast', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final now = DateTime.now();
    // A weekday a week or so away: still to come, so it can be taken back.
    var target = DateTime(now.year, now.month, now.day + 7);
    while (target.weekday >= DateTime.saturday) {
      target = DateTime(target.year, target.month, target.day + 1);
    }
    final leaveJson = <String, dynamic>{
      'id': 'lv1',
      'userId': 'tanvi',
      'type': 'casual',
      'typeName': 'Casual Leave',
      'startDate': ymd(target),
      'endDate': ymd(target),
      'days': 1,
      'reason': 'Trip',
      'status': 'pending',
      'createdAt': '2026-09-01T09:00:00.000Z',
    };
    String? cancelPath;
    String? cancelNote;
    http.Response ok(Map<String, dynamic> body) => http.Response(
      jsonEncode({'success': true, ...body}),
      200,
      headers: {'content-type': 'application/json'},
    );
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
              {
                'key': 'casual',
                'name': 'Casual Leave',
                'advanceDays': 30,
                'allowBackdated': true,
                'backdatedDays': 90,
                'unpaid': false,
              },
            ],
            'correction': {
              'triggers': [
                'Missing punch-in',
                'Missing punch-out',
                'Both punches missing',
              ],
              'backdateDays': 90,
              'punchFormat': 'In-app punch in',
              'punchMode': 'Both punches',
            },
          },
        });
      }
      if (request.method == 'POST' && request.url.path.endsWith('/cancel')) {
        cancelPath = request.url.path;
        cancelNote =
            (jsonDecode(request.body) as Map<String, dynamic>)['note']
                as String?;
        return ok({
          'leave': {
            ...leaveJson,
            'status': 'cancelled',
            'cancelNote': cancelNote,
            'cancelledAt': '2026-09-02T09:00:00.000Z',
          },
        });
      }
      return ok({
        'leaves': [leaveJson],
        'overtime': <dynamic>[],
        'regularizations': <dynamic>[],
        'claims': <dynamic>[],
        'types': <dynamic>[],
        'records': <dynamic>[],
        // Days to spend, so the plain day offers leave again afterwards.
        'balance': {
          'year': now.year,
          'casual': {'total': 12, 'used': 0, 'remaining': 12},
        },
      });
    });
    final session = AuthSession(
      token: 'token',
      user: AuthUser(
        id: 'tanvi',
        email: 'tanvi@sowaka.test',
        name: 'Tanvi Arora',
        role: 'employee',
        company: 'Sowaka',
        org: 'sowaka',
        joiningDate: '2025-01-01',
      ),
    );
    final bloc = ManagerBloc(
      session: session,
      service: ManagerApiService(
        session: session,
        baseUrl: 'https://example.test',
        client: client,
      ),
    );
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
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 30)),
        );
        await tester.pump(const Duration(milliseconds: 300));
      }
    }

    await settle();
    await tester.tap(find.text('Attendance').first);
    await settle();
    if (target.month != now.month) {
      await tester.tap(
        find.byWidgetPredicate(
          (w) => w is AttendanceCalendarArrow && w.asset.endsWith('next.svg'),
        ),
      );
      await settle();
    }
    final cell = find.descendant(
      of: find.byType(AttendanceMonthGrid),
      matching: find.text('${target.day}'),
    );
    await tester.ensureVisible(cell.first);
    await tester.tap(cell.first);
    await settle();

    // The day: its tag, its punch card, and the way back — no amber notice.
    expect(find.text('Leave Applied'), findsOneWidget);
    expect(find.text('Punch-in'), findsOneWidget);
    expect(find.textContaining('under review'), findsNothing);
    await tester.ensureVisible(find.text('Cancel Leave'));
    await tester.tap(find.text('Cancel Leave'));
    await settle();

    // The sheet: its title and its button, over the day's own link.
    expect(find.text('Cancel Leave'), findsNWidgets(3));
    expect(find.text('Add a note for your manager...'), findsOneWidget);
    await tester.enterText(find.byType(TextField).last, 'Plans changed');
    await tester.tap(find.text('Cancel Leave').last);
    await settle();

    expect(cancelPath, endsWith('/leaves/lv1/cancel'));
    expect(cancelNote, 'Plans changed');
    expect(find.text('Leave successfully canceled'), findsOneWidget);
    // The day is plain again: leave can be applied for, nothing to cancel.
    expect(find.text('Leave Applied'), findsNothing);
    expect(find.text('Cancel Leave'), findsNothing);
    expect(find.text('Apply Leave'), findsOneWidget);
  });
}
