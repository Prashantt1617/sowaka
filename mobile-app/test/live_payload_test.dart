// Runs the app's own parsers over payloads captured from a real backend, so a
// deploy can be checked against the app without a device. Point
// LIVE_PAYLOAD_DIR at a folder of <env>/<user>/<endpoint>.json files.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/features/attendance/data/punch_location_service.dart';

void main() {
  final dir = Platform.environment['LIVE_PAYLOAD_DIR'];
  if (dir == null || !Directory(dir).existsSync()) {
    test('live payloads (skipped: LIVE_PAYLOAD_DIR not set)', () {});
    return;
  }
  Map<String, dynamic> load(String path) =>
      jsonDecode(File(path).readAsStringSync()) as Map<String, dynamic>;
  List<Map<String, dynamic>> list(Map<String, dynamic> json, String key) =>
      (json[key] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>();

  for (final env in Directory(dir).listSync().whereType<Directory>()) {
    for (final user in env.listSync().whereType<Directory>()) {
      final base = user.path;
      final label = '${env.path.split('/').last}/${user.path.split('/').last}';
      test('$label · workspace parses like fetchDashboard', () {
        final ws = load('$base/manager_workspace.json');
        ShiftPolicy.fromJson(ws['shift'] as Map<String, dynamic>? ?? const {});
        list(ws, 'team').indexed.map((e) => TeamMember.fromJson(e.$2, e.$1 + 1)).toList();
        list(ws, 'recognitionCandidates').indexed.map((e) => TeamMember.fromJson(e.$2, e.$1 + 1)).toList();
        list(ws, 'recognitionHistory').map(Nomination.fromJson).toList();
        list(ws, 'myParameters').map(FeedbackParam.fromJson).toList();
        list(ws, 'growthHistory').map(GrowthRecord.fromJson).toList();
        list(ws, 'holidays').map(CompanyHoliday.fromJson).toList();
        list(ws, 'myOrgChart').map(OrgChartNode.fromJson).toList();
        expect(ws['overtimeEnabled'], isA<bool>());
        expect((ws['weekoffDays'] as List<dynamic>? ?? const [0]).every((v) => v is num), isTrue);
      });
      test('$label · shift policy', () {
        final body = load('$base/manager_shift-policy.json');
        final shift = ShiftPolicy.fromJson(body['shift'] as Map<String, dynamic>? ?? const {});
        expect(shift.startTime, isNotEmpty);
        expect(shift.endTime, isNotEmpty);
      });
      test('$label · leave balance', () {
        final json = load('$base/leaves_balance.json');
        final balance = LeaveBalance.fromJson(json['balance'] as Map<String, dynamic>);
        expect(balance, isNotNull);
      });
      test('$label · leaves, overtime, reimbursements', () {
        list(load('$base/leaves_mine.json'), 'leaves').map(LeaveRequest.fromJson).toList();
        list(load('$base/leaves_inbox.json'), 'leaves').map(LeaveRequest.fromJson).toList();
        list(load('$base/overtime_mine.json'), 'overtime').map(OvertimeRequest.fromJson).toList();
        list(load('$base/overtime_inbox.json'), 'overtime').map(OvertimeRequest.fromJson).toList();
        list(load('$base/reimbursements_types.json'), 'types').map(ReimbursementType.fromJson).toList();
        list(load('$base/reimbursements_mine.json'), 'claims').map(ReimbursementClaim.fromJson).toList();
        list(load('$base/reimbursements_inbox.json'), 'claims').map(ReimbursementClaim.fromJson).toList();
      });
      test('$label · attendance', () {
        for (final f in ['attendance_mine_sep', 'attendance_mine_aug']) {
          final json = load('$base/$f.json');
          list(json, 'records').map(AttendanceRecord.fromJson).toList();
          list(json, 'regularizations').map(AttendanceRegularization.fromJson).toList();
        }
        list(load('$base/attendance_regularizations_inbox.json'), 'regularizations').map(AttendanceRegularization.fromJson).toList();
        list(load('$base/attendance_punch-locations.json'), 'offices').map(PunchOffice.fromJson).toList();
      });
      test('$label · feedback snapshot', () {
        final body = load('$base/manager_feedback-snapshot.json');
        list(body, 'growthHistory').map(GrowthRecord.fromJson).toList();
        for (final row in list(body, 'team')) {
          expect(row, isA<Map<String, dynamic>>());
        }
      });
    }
  }
}
