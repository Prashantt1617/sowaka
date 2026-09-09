import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';

void main() {
  // The numbers HR saved in the E2E: a 10:00-19:00 shift, 5h half day,
  // 9h full day, 15 min late grace, 20 min early-out grace.
  final shift = ShiftPolicy.fromJson(const {
    'name': 'E2E Night Ops',
    'startTime': '10:00',
    'endTime': '19:00',
    'minHalfDayHours': 5,
    'minFullDayHours': 9,
    'lateGraceMinutes': 15,
    'earlyOutGraceMinutes': 20,
  });
  DateTime at(String hhmm) => DateTime(
    2026, 9, 9,
    int.parse(hhmm.substring(0, 2)),
    int.parse(hhmm.substring(3, 5)),
  );
  String band(String inT, String outT) {
    final worked = at(outT).difference(at(inT));
    return worked >= shift.minFullDay
        ? 'Present'
        : worked >= shift.minHalfDay
        ? 'Half day'
        : 'Short day';
  }

  test('thresholds come from the shift, not a hardcoded 6 hours', () {
    expect(shift.minHalfDay, const Duration(hours: 5));
    expect(shift.minFullDay, const Duration(hours: 9));
    expect(band('10:00', '19:00'), 'Present');
    expect(band('10:00', '18:00'), 'Half day'); // 8h — used to read Present
    expect(band('10:00', '14:00'), 'Short day'); // 4h — under the half-day mark
  });

  test('late grace is measured from the shift start', () {
    expect(shift.isLate(at('10:00')), isFalse);
    expect(shift.isLate(at('10:14')), isFalse);
    expect(shift.isLate(at('10:15')), isFalse); // exactly the grace
    expect(shift.isLate(at('10:16')), isTrue);
  });

  test('early-out grace is measured from the shift end', () {
    expect(shift.isEarlyOut(at('19:00')), isFalse);
    expect(shift.isEarlyOut(at('18:45')), isFalse);
    expect(shift.isEarlyOut(at('18:40')), isFalse); // exactly the grace
    expect(shift.isEarlyOut(at('18:39')), isTrue);
  });

  test('an overnight shift is not flagged early-out against a same-day clock', () {
    final night = ShiftPolicy.fromJson(const {'startTime': '22:00', 'endTime': '06:00'});
    expect(night.isEarlyOut(at('05:00')), isFalse);
    expect(night.isLate(at('22:30')), isTrue);
  });

  test('an org with no shift saved falls back to the documented defaults', () {
    const fallback = ShiftPolicy();
    expect(fallback.minHalfDay, const Duration(hours: 4));
    expect(fallback.minFullDay, const Duration(hours: 8));
    expect(fallback.lateGraceMinutes, 10);
    expect(ShiftPolicy.fromJson(const {}).minFullDayHours, 8);
  });

  test('the shift window is derived, not assumed to be 9 hours', () {
    expect(shift.window, const Duration(hours: 9)); // 10:00-19:00
    expect(
      ShiftPolicy.fromJson(const {'startTime': '09:30', 'endTime': '18:00'}).window,
      const Duration(hours: 8, minutes: 30),
    );
    expect(
      ShiftPolicy.fromJson(const {'startTime': '22:00', 'endTime': '06:00'}).window,
      const Duration(hours: 8),
    );
  });

  test('week-offs come from the grid, per week of the month', () {
    // 1st and 2nd Saturday off, every Sunday off. 0 = Mon .. 6 = Sun.
    final policy = ShiftPolicy.fromJson(const {
      'weeklyOff': {'1': [5, 6], '2': [5, 6], '3': [6], '4': [6], '5': [6]},
    });
    // September 2026: 5th is the 1st Saturday, 12th the 2nd, 19th the 3rd.
    expect(policy.isWeekOff(DateTime(2026, 9, 5)), isTrue);
    expect(policy.isWeekOff(DateTime(2026, 9, 12)), isTrue);
    expect(policy.isWeekOff(DateTime(2026, 9, 19)), isFalse, reason: '3rd Saturday works');
    expect(policy.isWeekOff(DateTime(2026, 9, 6)), isTrue, reason: 'Sunday');
    expect(policy.isWeekOff(DateTime(2026, 9, 7)), isFalse, reason: 'Monday');
    // A 31-day month has a 5th block covering the tail.
    expect(policy.isWeekOff(DateTime(2026, 8, 30)), isTrue, reason: '30 Aug is a Sunday');
  });

  test('half-hour thresholds survive the trip', () {
    final half = ShiftPolicy.fromJson(const {'minHalfDayHours': 4.5});
    expect(half.minHalfDay, const Duration(hours: 4, minutes: 30));
  });
}
