// Grades every captured day with the app's own ShiftPolicy.dayMark and
// compares it with what the server (and so the HR dashboard) marked.
// Fixture: PARITY_FIXTURE=<json of {who, shift, records, server}>.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';

void main() {
  test('ACMT rules: Pankaj on 12 and 20 Aug is present, as on the dashboard', () {
    final shift = ShiftPolicy.fromJson({
      'startTime': '08:00',
      'endTime': '17:30',
      'minHalfDayHours': 4,
      'minFullDayHours': 8,
      'halfDay': {'minHalfDayEnabled': false, 'minFullDayEnabled': false, 'lateArrivalEnabled': true, 'lateArrivalMinutes': 180, 'earlyLeaveEnabled': false, 'earlyLeaveMinutes': 60},
    });
    DateTime at(int h, int m) => DateTime(2026, 8, 12, h, m);
    // 12 Aug: 07:59 → 15:48 (7.8h, left 92 min early). 20 Aug: 10:00 → 17:22 (7.4h, 120 min late).
    expect(shift.dayMark(at(7, 59), at(15, 48), const Duration(hours: 7, minutes: 49)), DayMark.present);
    expect(shift.dayMark(at(10, 0), at(17, 22), const Duration(hours: 7, minutes: 22)), DayMark.present);
    // Arriving 11:15 is past the 180-minute cutoff → half day.
    expect(shift.dayMark(at(11, 15), at(17, 30), const Duration(hours: 6, minutes: 15)), DayMark.halfDay);
    // One punch: present unless late past the cutoff.
    expect(shift.dayMark(at(9, 0), null, null), DayMark.present);
    expect(shift.dayMark(at(12, 0), null, null), DayMark.halfDay);
  });

  test('a server that sends no halfDay keeps the old "under a full day is half" rule', () {
    final shift = ShiftPolicy.fromJson({'startTime': '09:00', 'endTime': '18:00', 'minHalfDayHours': 4, 'minFullDayHours': 8});
    expect(shift.dayMark(DateTime(2026, 8, 1, 9), DateTime(2026, 8, 1, 16), const Duration(hours: 7)), DayMark.halfDay);
    expect(shift.dayMark(DateTime(2026, 8, 1, 9), DateTime(2026, 8, 1, 17, 30), const Duration(hours: 8, minutes: 30)), DayMark.present);
  });

  final path = Platform.environment['PARITY_FIXTURE'];
  if (path == null) return;
  test('every day with two punches grades the same as the server', () {
    final people = (jsonDecode(File(path).readAsStringSync()) as List).cast<Map<String, dynamic>>();
    var compared = 0;
    final mismatches = <String>[];
    for (final person in people) {
      final shift = ShiftPolicy.fromJson(person['shift'] as Map<String, dynamic>);
      final server = (person['server'] as Map).cast<String, String>();
      for (final raw in (person['records'] as List).cast<Map<String, dynamic>>()) {
        final inAt = DateTime.tryParse(raw['punchIn'] as String? ?? '')?.toLocal();
        final outAt = DateTime.tryParse(raw['punchOut'] as String? ?? '')?.toLocal();
        if (inAt == null || outAt == null) continue;
        final date = raw['workDate'] as String;
        final expected = server[date];
        if (expected == null || !const {'present', 'half_day', 'absent'}.contains(expected)) continue;
        final mark = shift.dayMark(inAt, outAt, outAt.difference(inAt));
        final got = switch (mark) { DayMark.present => 'present', DayMark.halfDay => 'half_day', DayMark.absent => 'absent' };
        compared++;
        if (got != expected) mismatches.add('${person['who']} $date app=$got server=$expected');
      }
    }
    // ignore: avoid_print
    print('compared $compared days; mismatches: ${mismatches.length}');
    expect(mismatches, isEmpty);
    expect(compared, greaterThan(0));
  });
}
