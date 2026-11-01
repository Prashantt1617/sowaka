// Days before someone joined are empty on the calendar, not absent: whether
// the app graded the month alone (from the joining date) or the server
// settled it (`before_joining`).
import 'package:flutter_test/flutter_test.dart';
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
    expect(on(days, 10).title, isNot('Before joining'));
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
  });
}
