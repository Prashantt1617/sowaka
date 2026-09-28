// A manager's direct reports have to reach three places from one payload: the
// Team tab's department grouping, the feedback list, and the org chart. They
// once showed on the chart alone, so the two filters the other screens use
// are pinned here against a payload shaped like the server's.
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';

Map<String, dynamic> row({
  required String name,
  required String department,
  bool reportsToViewer = false,
  bool isSelf = false,
  bool isManager = false,
}) => {
  'userId': name.toLowerCase(),
  'name': name,
  'department': department,
  'designation': 'Faculty',
  'reportsToViewer': reportsToViewer,
  'isSelf': isSelf,
  'isManager': isManager,
  'parameters': <dynamic>[],
  'history': <dynamic>[],
};

void main() {
  copyKeepsEverything();
  // What the server sends a manager: the person above them, themselves, and
  // the people who report to them.
  final team = [
    row(name: 'Demo Admin', department: 'People & Culture', isManager: true),
    row(name: 'Pankaj', department: 'Faculty', isSelf: true),
    row(name: 'Haider', department: 'Faculty', reportsToViewer: true),
    row(name: 'Naveen', department: 'Faculty', reportsToViewer: true),
  ].indexed.map((e) => TeamMember.fromJson(e.$2, e.$1 + 1)).toList();

  test('both reports survive parsing with their flags', () {
    for (final name in ['Haider', 'Naveen']) {
      final member = team.firstWhere((m) => m.name == name);
      expect(member.reportsToViewer, isTrue, reason: name);
      expect(member.isSelf, isFalse, reason: name);
    }
  });

  test('the Team tab groups both under their department', () {
    final led = team.where((m) => m.reportsToViewer).toList();
    final departments = <String, List<TeamMember>>{};
    for (final m in led) {
      departments.putIfAbsent(m.team, () => []).add(m);
    }
    expect(departments.keys, ['Faculty']);
    expect(
      departments['Faculty']!.map((m) => m.name),
      containsAll(['Haider', 'Naveen']),
    );
  });

  test('the feedback list offers both, and never the viewer', () {
    final reviewable =
        team.where((m) => m.reportsToViewer && !m.isSelf).toList();
    expect(reviewable.map((m) => m.name), ['Haider', 'Naveen']);
    expect(reviewable.any((m) => m.isSelf), isFalse);
  });

  test('a manager above the viewer is never offered for review', () {
    final reviewable =
        team.where((m) => m.reportsToViewer && !m.isSelf).toList();
    expect(reviewable.map((m) => m.name), isNot(contains('Demo Admin')));
  });
}

/// Copying a request to record a decision must not quietly reset the rest of
/// it. `TeamMember` lost who a person was to the viewer this way; these three
/// carry fields the Requests list reads back out.
void copyKeepsEverything() {
  test('deciding a leave keeps its half day and its document', () {
    final leave = LeaveRequest(
      id: 'l1',
      who: 'Haider',
      initial: 'H',
      avatarIndex: 0,
      team: 'Faculty',
      type: 'casual',
      start: DateTime(2026, 9, 29),
      end: DateTime(2026, 9, 29),
      days: 0.5,
      reason: 'Dentist',
      requestedOn: DateTime(2026, 9, 28),
      decision: LeaveDecision.pending,
      managerNote: '',
      halfDay: true,
      documentName: 'note.pdf',
      documentUrl: '/media/note.pdf',
    );
    final decided = leave.copyWith(decision: LeaveDecision.approved);
    expect(decided.halfDay, isTrue);
    expect(decided.documentName, 'note.pdf');
    expect(decided.documentUrl, '/media/note.pdf');
  });

  test('deciding overtime keeps whether it was claimed as a full day', () {
    final overtime = OvertimeRequest(
      id: 'o1',
      who: 'Naveen',
      initial: 'N',
      avatarIndex: 0,
      team: 'Faculty',
      workDate: DateTime(2026, 9, 20),
      startTime: DateTime(2026, 9, 20, 10),
      endTime: DateTime(2026, 9, 20, 18),
      hours: 8,
      duration: 'full_day',
      note: 'Admissions desk',
      requestedOn: DateTime(2026, 9, 21),
      decision: LeaveDecision.pending,
      managerNote: '',
    );
    final decided = overtime.copyWith(decision: LeaveDecision.approved);
    expect(decided.duration, 'full_day');
    expect(decided.halfDayClaim, isFalse);
  });
}
