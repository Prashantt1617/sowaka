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
