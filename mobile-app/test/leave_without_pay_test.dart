// Leave without pay in the app: HR's switch on a leave type reaches the
// policy, its balance is unlimited, and an approved day of it is its own day
// on the calendar — neither leave nor absent — whether the server settled it
// or the app graded it alone.
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';

void main() {
  final policy = ShiftPolicy.fromJson(const {
    'weeklyOff': {'1': [6], '2': [6], '3': [6], '4': [6], '5': [6]},
    'leaveTypes': [
      {'key': 'casual', 'name': 'Casual Leave', 'advanceDays': 30, 'allowBackdated': true, 'backdatedDays': 3, 'unpaid': false},
      {'key': 'without_pay', 'name': 'Leave without pay', 'advanceDays': 30, 'allowBackdated': true, 'backdatedDays': 3, 'unpaid': true},
    ],
  });

  test('the policy says which type is unpaid, by key or by name', () {
    expect(policy.isUnpaidLeave('without_pay'), isTrue);
    expect(policy.isUnpaidLeave('Leave without pay'), isTrue);
    expect(policy.isUnpaidLeave('casual'), isFalse);
    expect(policy.isUnpaidLeave('Casual Leave'), isFalse);
    // An older server sends no flag: nothing is unpaid.
    expect(const ShiftPolicy().isUnpaidLeave('casual'), isFalse);
  });

  test('its balance is unlimited, and a paid one is unchanged', () {
    final balance = LeaveBalance.fromJson(const {
      'year': 2026,
      'types': [
        {'key': 'casual', 'name': 'Casual Leave', 'total': 12, 'used': 2, 'remaining': 10},
        {'key': 'without_pay', 'name': 'Leave without pay', 'total': 0, 'used': 3, 'remaining': 0, 'unlimited': true, 'unpaid': true},
      ],
    });
    expect(balance.forKey('without_pay')!.unpaid, isTrue);
    expect(balance.forKey('casual')!.unpaid, isFalse);
    expect(balance.forKey('casual')!.remaining, 10);
  });

  test('a payslip day of it counts towards its own line, not leave', () {
    final day = PayslipDay.fromJson(const {'date': '2026-09-07', 'status': 'unpaid_leave'});
    expect(day.countsFor('unpaid_leave'), isTrue);
    expect(day.countsFor('leave'), isFalse);
    expect(day.countsFor('absent'), isFalse);
  });

  group('the calendar', () {
    final month = DateTime(2026, 9);
    LeaveRequest leave(String type, String start, String end, {bool halfDay = false}) => LeaveRequest.fromJson({
      'id': type,
      'type': type,
      'typeName': type == 'casual' ? 'Casual Leave' : 'Leave without pay',
      'startDate': start,
      'endDate': end,
      'days': 1,
      'halfDay': halfDay,
      'reason': '',
      'status': 'approved',
    });
    final leaves = [
      leave('without_pay', '2026-09-07', '2026-09-08'),
      leave('without_pay', '2026-09-09', '2026-09-09', halfDay: true),
      leave('casual', '2026-09-10', '2026-09-10'),
    ];
    AttendanceDayView on(List<AttendanceDayView> days, int day) => days.firstWhere((d) => d.date.day == day);

    test('graded by the app alone', () {
      final days = buildAttendanceDays(
        month: month, records: const [], regularizations: const [], leaves: leaves, holidays: const [], overtime: const [], shift: policy,
      );
      expect(on(days, 7).kind, AttendanceKind.leaveWithoutPay);
      expect(on(days, 7).title, 'Leave without pay');
      expect(on(days, 9).title, 'Leave without pay · Half day');
      expect(on(days, 10).kind, AttendanceKind.leaveApproved);
      expect(matchesAttendanceFilter(on(days, 7), AttendanceFilter.leave), isFalse);
      expect(matchesAttendanceFilter(on(days, 7), AttendanceFilter.leaveWithoutPay), isTrue);
      expect(matchesAttendanceFilter(on(days, 10), AttendanceFilter.leave), isTrue);
    });

    test('settled by the server', () {
      final server = ServerDayStatus.parseAll(const {
        'days': [
          {'date': '2026-09-07', 'status': 'unpaid_leave', 'label': 'without_pay', 'reason': 'Leave without pay', 'source': 'rules', 'final': true},
          {'date': '2026-09-09', 'status': 'unpaid_leave', 'label': 'without_pay', 'reason': 'Leave without pay · half day', 'source': 'rules', 'final': true},
          {'date': '2026-09-10', 'status': 'on_leave', 'label': 'casual', 'source': 'rules', 'final': true},
        ],
      });
      // Even where the app knows nothing of the type, the server's word stands.
      final days = buildAttendanceDays(
        month: month, records: const [], regularizations: const [], leaves: leaves, holidays: const [], overtime: const [],
        shift: const ShiftPolicy(), serverDays: server,
      );
      expect(on(days, 7).kind, AttendanceKind.leaveWithoutPay);
      expect(on(days, 7).title, 'Leave without pay');
      expect(on(days, 9).title, 'Leave without pay · half day');
      expect(on(days, 10).kind, AttendanceKind.leaveApproved);
      expect(attendanceTagStyle(AttendanceKind.leaveWithoutPay).label, 'Leave Without Pay');
    });
  });
}
