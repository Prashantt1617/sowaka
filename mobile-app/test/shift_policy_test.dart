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

  test('a leave type the org does not run is not offered anywhere', () {
    // The server sends only the types HR has switched on.
    final policy = ShiftPolicy.fromJson(const {
      'leaveTypes': [
        {'key': 'casual', 'name': 'Casual Leave', 'advanceDays': 30, 'allowBackdated': true, 'backdatedDays': 3},
        {'key': 'earned', 'name': 'Earned Leave', 'advanceDays': 90, 'allowBackdated': false, 'backdatedDays': 0},
      ],
    });
    expect(policy.applicableLeaveLabels, ['Casual Leave', 'Earned Leave']);
    expect(policy.allowsLeave('Sick Leave'), isFalse);
    expect(policy.allowsLeave('Casual Leave'), isTrue);
    expect(policy.windowForLeave('Sick Leave'), isNull);
  });

  test('an older server that sends no policy still offers the standard types', () {
    const policy = ShiftPolicy();
    expect(policy.applicableLeaveLabels, [
      'Casual Leave',
      'Sick Leave',
      'Earned Leave',
      'Comp-off',
    ]);
    expect(policy.allowsLeave('Sick Leave'), isTrue);
  });

  group('the apply-leave rule the button follows', () {
    // Casual: 30 days ahead, 3 days back. Sundays off, 2 Oct is a holiday.
    final policy = ShiftPolicy.fromJson(const {
      'weeklyOff': {'1': [6], '2': [6], '3': [6], '4': [6], '5': [6]},
      'leaveTypes': [
        {'key': 'casual', 'name': 'Casual Leave', 'advanceDays': 30, 'allowBackdated': true, 'backdatedDays': 3},
        {'key': 'earned', 'name': 'Earned Leave', 'advanceDays': 90, 'allowBackdated': false, 'backdatedDays': 0},
      ],
    });
    final holidays = {'2026-10-02'};
    final today = DateTime(2026, 9, 10);

    String? problem(DateTime from, DateTime to, {String type = 'Casual Leave', bool halfDay = false}) =>
        leaveRangeProblem(
          policy: policy,
          holidayDates: holidays,
          typeLabel: type,
          from: from,
          to: to,
          today: today,
          halfDay: halfDay,
        );

    test('a normal working day is fine', () {
      expect(problem(DateTime(2026, 9, 15), DateTime(2026, 9, 16)), isNull);
    });

    test('a day past the backdating window is refused', () {
      expect(problem(DateTime(2026, 9, 1), DateTime(2026, 9, 1)), contains('Casual Leave'));
    });

    test('a day inside the backdating window is allowed', () {
      expect(problem(DateTime(2026, 9, 8), DateTime(2026, 9, 8)), isNull);
    });

    test('a day beyond the advance window is refused', () {
      expect(problem(DateTime(2026, 11, 30), DateTime(2026, 11, 30)), isNotNull);
    });

    test('a type that cannot be backdated refuses any past day', () {
      expect(
        problem(DateTime(2026, 9, 9), DateTime(2026, 9, 9), type: 'Earned Leave'),
        contains('already past'),
      );
    });

    test('a company holiday alone is refused', () {
      expect(problem(DateTime(2026, 10, 2), DateTime(2026, 10, 2)), contains('holiday'));
    });

    test('a week-off alone is refused', () {
      // 13 Sep 2026 is a Sunday.
      expect(problem(DateTime(2026, 9, 13), DateTime(2026, 9, 13)), contains('week-off'));
    });

    test('a range that spans a week-off is fine', () {
      expect(problem(DateTime(2026, 9, 11), DateTime(2026, 9, 14)), isNull);
    });

    test('a switched-off type is refused', () {
      expect(problem(DateTime(2026, 9, 15), DateTime(2026, 9, 15), type: 'Sick Leave'), contains('not available'));
    });

    test('a half day over two dates is refused', () {
      expect(
        problem(DateTime(2026, 9, 15), DateTime(2026, 9, 16), halfDay: true),
        contains('single date'),
      );
    });

    test('an end before the start is refused', () {
      expect(problem(DateTime(2026, 9, 16), DateTime(2026, 9, 15)), contains('before the start'));
    });

    test('a range longer than the cap is refused', () {
      expect(problem(DateTime(2026, 9, 11), DateTime(2026, 10, 20)), isNotNull);
    });
  });

  test('the calendar button is off when no type accepts the day', () {
    // Sowaka today: casual 3 back / 30 ahead, earned no backdating / 90 ahead,
    // comp-off 30 ahead. Sundays off.
    final policy = ShiftPolicy.fromJson(const {
      'weeklyOff': {'1': [6], '2': [6], '3': [6], '4': [6], '5': [6]},
      'leaveTypes': [
        {'key': 'casual', 'name': 'Casual Leave', 'advanceDays': 30, 'allowBackdated': true, 'backdatedDays': 3},
        {'key': 'earned', 'name': 'Earned Leave', 'advanceDays': 90, 'allowBackdated': false, 'backdatedDays': 0},
        {'key': 'comp_off', 'name': 'Comp-off', 'advanceDays': 30, 'allowBackdated': false, 'backdatedDays': 0},
      ],
    });
    final today = DateTime(2026, 9, 10);

    // The rule the calendar's button follows: a day is applicable only if at
    // least one type accepts it.
    bool anyTypeAccepts(DateTime day) => policy.applicableLeaveLabels.any(
      (label) =>
          leaveRangeProblem(
            policy: policy,
            holidayDates: const {'2026-10-02'},
            typeLabel: label,
            from: day,
            to: day,
            today: today,
          ) ==
          null,
    );

    // 8 Aug 2026 — the day from the report: a month back, outside every window.
    expect(anyTypeAccepts(DateTime(2026, 8, 8)), isFalse);
    // A Sunday, and a company holiday.
    expect(anyTypeAccepts(DateTime(2026, 9, 13)), isFalse);
    expect(anyTypeAccepts(DateTime(2026, 10, 2)), isFalse);
    // Yesterday: casual can still be backdated three days.
    expect(anyTypeAccepts(DateTime(2026, 9, 9)), isTrue);
    // A working day next week.
    expect(anyTypeAccepts(DateTime(2026, 9, 16)), isTrue);
    // Two months out: past casual's 30 days, but earned reaches 90.
    expect(anyTypeAccepts(DateTime(2026, 11, 10)), isTrue);
  });

  group('the balance is part of the same rule', () {
    final policy = ShiftPolicy.fromJson(const {
      'weeklyOff': {'1': [6], '2': [6], '3': [6], '4': [6], '5': [6]},
      'leaveTypes': [
        {'key': 'casual', 'name': 'Casual Leave', 'advanceDays': 30, 'allowBackdated': true, 'backdatedDays': 3},
      ],
    });
    final today = DateTime(2026, 9, 10);

    String? problem(int days, {double? available, bool halfDay = false}) => leaveRangeProblem(
      policy: policy,
      holidayDates: const {},
      typeLabel: 'Casual Leave',
      from: DateTime(2026, 9, 14),
      to: DateTime(2026, 9, 14).add(Duration(days: days - 1)),
      today: today,
      availableDays: available,
      halfDay: halfDay,
    );

    test('a request inside the balance is fine', () {
      expect(problem(2, available: 5), isNull);
    });

    test('a request larger than the balance is refused', () {
      expect(problem(4, available: 2), contains('2 day(s) of Casual Leave are left'));
    });

    test('an empty balance is refused outright', () {
      expect(problem(1, available: 0), contains('no Casual Leave left'));
    });

    test('a half day costs half a day', () {
      expect(problem(1, available: 0.5, halfDay: true), isNull);
    });

    test('an unknown balance does not block anything', () {
      expect(problem(4), isNull);
    });
  });
}
