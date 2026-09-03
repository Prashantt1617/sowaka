import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import 'manager_models.dart';

class ManagerApiService {
  ManagerApiService({
    required this.session,
    String? baseUrl,
    http.Client? client,
  }) : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
       _client = client ?? http.Client();

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;

  Future<LeaveBalance> fetchLeaveBalance() async {
    final json = await _request('GET', '/leaves/balance');
    return LeaveBalance.fromJson(json['balance'] as Map<String, dynamic>);
  }

  Future<ManagerDashboard> fetchDashboard() async {
    final workspaceFuture = _request('GET', '/manager/workspace');
    final myLeavesFuture = fetchMyLeaves();
    final managerLeavesFuture = fetchManagerLeaves();
    final balanceFuture = _request('GET', '/leaves/balance');
    final myOvertimeFuture = fetchMyOvertime();
    final overtimeFuture = fetchManagerOvertime();
    final reimbursementsFuture = fetchMyReimbursements();
    final managerReimbursementsFuture = session.user.role == 'manager'
        ? fetchManagerReimbursements()
        : Future<List<ReimbursementClaim>>.value(const []);
    final now = DateTime.now();
    final attendanceFuture = fetchAttendance(
      DateTime(now.year, now.month, 1),
      DateTime(now.year, now.month + 1, 0),
    );
    final regularizationInboxFuture = session.user.role == 'manager'
        ? fetchManagerAttendanceRegularizations()
        : Future<List<AttendanceRegularization>>.value(const []);
    final workspace = await workspaceFuture;
    final teamValues = workspace['team'] as List<dynamic>? ?? const [];
    final team = teamValues.indexed.map((entry) {
      return TeamMember.fromJson(
        entry.$2 as Map<String, dynamic>,
        entry.$1 + 1,
      );
    }).toList();
    final candidateValues =
        workspace['recognitionCandidates'] as List<dynamic>? ?? const [];
    final recognitionCandidates = candidateValues.indexed.map((entry) {
      return TeamMember.fromJson(
        entry.$2 as Map<String, dynamic>,
        entry.$1 + 1,
      );
    }).toList();
    final nominations = workspace['nominations'] as List<dynamic>? ?? const [];
    final nomineeByCategory = <String, int>{};
    final reasonByCategory = <String, String>{};
    for (final value in nominations) {
      final nomination = value as Map<String, dynamic>;
      final userId = nomination['employeeUserId'] as String?;
      final member = recognitionCandidates
          .where((item) => item.userId == userId)
          .firstOrNull;
      if (member != null) {
        nomineeByCategory[nomination['category'] as String] = member.id;
      }
      final reason = nomination['reason'] as String?;
      if (reason != null && reason.isNotEmpty) {
        reasonByCategory[nomination['category'] as String] = reason;
      }
    }
    final recognitionHistory =
        (workspace['recognitionHistory'] as List<dynamic>? ?? const [])
            .map((value) => Nomination.fromJson(value as Map<String, dynamic>))
            .toList();

    final attendanceData = await attendanceFuture;
    return ManagerDashboard(
      managerName: session.user.name,
      managerInitial: session.user.name.isEmpty ? '?' : session.user.name[0],
      managerPhotoUrl: session.user.profilePhotoUrl,
      managerTeam: session.user.company,
      approverName: workspace['approverName'] as String? ?? 'Your manager',
      managerScore: (workspace['managerScore'] as num?)?.toDouble() ?? 0,
      growthHistory: (workspace['growthHistory'] as List<dynamic>? ?? const [])
          .map((value) => GrowthRecord.fromJson(value as Map<String, dynamic>))
          .toList(),
      today: DateTime.now(),
      team: team,
      recognitionCandidates: recognitionCandidates,
      leaves: await managerLeavesFuture,
      myLeaves: await myLeavesFuture,
      awards: _awardDefinitions
          .map(
            (award) => award.copyWith(
              nomineeId: nomineeByCategory[award.key],
              reason: reasonByCategory[award.key],
            ),
          )
          .toList(),
      recognitionHistory: recognitionHistory,
      leaveBalance: LeaveBalance.fromJson(
        (await balanceFuture)['balance'] as Map<String, dynamic>,
      ),
      holidays: (workspace['holidays'] as List<dynamic>? ?? const [])
          .map(
            (value) => CompanyHoliday.fromJson(value as Map<String, dynamic>),
          )
          .toList(),
      overtime: await overtimeFuture,
      myOvertime: await myOvertimeFuture,
      myReimbursements: await reimbursementsFuture,
      reimbursements: await managerReimbursementsFuture,
      weekoffDays: (workspace['weekoffDays'] as List<dynamic>? ?? const [0])
          .map((value) => (value as num).toInt())
          .toList(),
      overtimeEnabled: workspace['overtimeEnabled'] as bool? ?? true,
      attendance: attendanceData.$1,
      regularizations: attendanceData.$2,
      managerRegularizations: await regularizationInboxFuture,
    );
  }

  Future<(List<AttendanceRecord>, List<AttendanceRegularization>)>
  fetchAttendance(DateTime from, DateTime to) async {
    final json = await _request(
      'GET',
      '/attendance/mine?from=${_dateOnly(from)}&to=${_dateOnly(to)}',
    );
    return (
      (json['records'] as List<dynamic>? ?? const [])
          .map((v) => AttendanceRecord.fromJson(v as Map<String, dynamic>))
          .toList(),
      (json['regularizations'] as List<dynamic>? ?? const [])
          .map(
            (v) => AttendanceRegularization.fromJson(v as Map<String, dynamic>),
          )
          .toList(),
    );
  }

  Future<(List<AttendanceRecord>, List<AttendanceRegularization>)>
  fetchTeamMemberAttendance(
    String employeeUserId,
    DateTime from,
    DateTime to,
  ) async {
    final json = await _request(
      'GET',
      '/attendance/team/$employeeUserId?from=${_dateOnly(from)}&to=${_dateOnly(to)}',
    );
    return (
      (json['records'] as List<dynamic>? ?? const [])
          .map((v) => AttendanceRecord.fromJson(v as Map<String, dynamic>))
          .toList(),
      (json['regularizations'] as List<dynamic>? ?? const [])
          .map(
            (v) => AttendanceRegularization.fromJson(v as Map<String, dynamic>),
          )
          .toList(),
    );
  }

  Future<AttendanceRecord> recordPunch(String type) async {
    final json = await _request(
      'POST',
      '/attendance/punch',
      body: {'type': type},
    );
    return AttendanceRecord.fromJson(json);
  }

  Future<AttendanceRegularization> submitAttendanceRegularization({
    required DateTime workDate,
    required DateTime? punchIn,
    required DateTime? punchOut,
    required String note,
  }) async {
    final json = await _request(
      'POST',
      '/attendance/regularizations',
      body: {
        'workDate': _dateOnly(workDate),
        if (punchIn != null) 'punchIn': punchIn.toUtc().toIso8601String(),
        if (punchOut != null) 'punchOut': punchOut.toUtc().toIso8601String(),
        'note': note,
      },
    );
    return AttendanceRegularization.fromJson(
      json['regularization'] as Map<String, dynamic>,
    );
  }

  Future<List<AttendanceRegularization>>
  fetchManagerAttendanceRegularizations() async {
    final json = await _request('GET', '/attendance/regularizations/inbox');
    return (json['regularizations'] as List<dynamic>? ?? const [])
        .map(
          (value) =>
              AttendanceRegularization.fromJson(value as Map<String, dynamic>),
        )
        .toList();
  }

  Future<AttendanceRegularization> decideAttendanceRegularization(
    String id,
    LeaveDecision decision,
    String managerNote,
  ) async {
    final json = await _request(
      'PATCH',
      '/attendance/regularizations/$id/decision',
      body: {'decision': decision.name, 'managerNote': managerNote},
    );
    return AttendanceRegularization.fromJson(
      json['regularization'] as Map<String, dynamic>,
    );
  }

  Future<List<LeaveRequest>> fetchMyLeaves() async {
    final json = await _request('GET', '/leaves/mine');
    return _parseLeaves(json);
  }

  Future<List<LeaveRequest>> fetchManagerLeaves() async {
    final json = await _request('GET', '/leaves/inbox');
    return _parseLeaves(json);
  }

  Future<void> saveFeedback({
    required TeamMember member,
    required FeedbackStatus status,
    required List<FeedbackParam> params,
    required String extra,
  }) async {
    await _request(
      'PUT',
      '/manager/feedback/${member.userId}',
      body: {
        'status': status.name,
        'parameters': params
            .map(
              (param) => {
                'name': param.name,
                'score': param.score,
                'note': param.note,
              },
            )
            .toList(),
        'extra': extra,
      },
    );
  }

  Future<LeaveRequest> decideLeave(
    String leaveId,
    LeaveDecision decision,
    String managerNote,
  ) async {
    final json = await _request(
      'PATCH',
      '/leaves/$leaveId/decision',
      body: {'decision': decision.name, 'managerNote': managerNote},
    );
    return LeaveRequest.fromJson(json['leave'] as Map<String, dynamic>);
  }

  Future<void> nominateAward(
    String awardKey,
    TeamMember member,
    String reason,
  ) async {
    await _request(
      'PUT',
      '/manager/recognition/$awardKey',
      body: {'employeeUserId': member.userId, 'reason': reason},
    );
  }

  Future<LeaveRequest> submitLeaveApplication({
    required String type,
    required DateTime startDate,
    required DateTime endDate,
    required String reason,
    bool halfDay = false,
  }) async {
    final json = await _request(
      'POST',
      '/leaves',
      body: {
        'type': _leaveTypeToken(type),
        'startDate': _dateOnly(startDate),
        'endDate': _dateOnly(endDate),
        'reason': reason,
        'halfDay': halfDay,
      },
    );
    return LeaveRequest.fromJson(json['leave'] as Map<String, dynamic>);
  }

  Future<List<OvertimeRequest>> fetchMyOvertime() async {
    final json = await _request('GET', '/overtime/mine');
    return _parseOvertime(json);
  }

  Future<List<OvertimeRequest>> fetchManagerOvertime() async {
    final json = await _request('GET', '/overtime/inbox');
    return _parseOvertime(json);
  }

  Future<OvertimeRequest> submitOvertime({
    required DateTime workDate,
    required DateTime startTime,
    required DateTime endTime,
    required String note,
  }) async {
    final json = await _request(
      'POST',
      '/overtime',
      body: {
        'workDate': _dateOnly(workDate),
        'startTime': startTime.toUtc().toIso8601String(),
        'endTime': endTime.toUtc().toIso8601String(),
        'note': note,
      },
    );
    return OvertimeRequest.fromJson(json['overtime'] as Map<String, dynamic>);
  }

  Future<OvertimeRequest> decideOvertimeRequest(
    String overtimeId,
    LeaveDecision decision,
    String managerNote,
  ) async {
    final json = await _request(
      'PATCH',
      '/overtime/$overtimeId/decision',
      body: {'decision': decision.name, 'managerNote': managerNote},
    );
    return OvertimeRequest.fromJson(json['overtime'] as Map<String, dynamic>);
  }

  Future<List<ReimbursementClaim>> fetchMyReimbursements() async {
    final json = await _request('GET', '/reimbursements/mine');
    return _parseReimbursements(json);
  }

  Future<List<ReimbursementClaim>> fetchManagerReimbursements() async {
    final json = await _request('GET', '/reimbursements/inbox');
    return _parseReimbursements(json);
  }

  List<ReimbursementClaim> _parseReimbursements(Map<String, dynamic> json) {
    final values = json['claims'] as List<dynamic>? ?? const [];
    return values
        .map(
          (value) => ReimbursementClaim.fromJson(value as Map<String, dynamic>),
        )
        .toList();
  }

  Future<ReimbursementClaim> submitReimbursement({
    required DateTime expenseDate,
    required String amount,
    required String category,
    required String receiptName,
    Uint8List? receiptBytes,
    required String note,
  }) async {
    if (receiptBytes != null && receiptName.isNotEmpty) {
      final request =
          http.MultipartRequest('POST', Uri.parse('$_baseUrl/reimbursements'))
            ..headers['Authorization'] = 'Bearer ${session.token}'
            ..fields.addAll({
              'expenseDate': _dateOnly(expenseDate),
              'amount': amount.replaceAll(',', ''),
              'category': category.toLowerCase(),
              'note': note,
            })
            ..files.add(
              http.MultipartFile.fromBytes(
                'receipt',
                receiptBytes,
                filename: receiptName,
              ),
            );
      final json = await _send(request);
      return ReimbursementClaim.fromJson(json['claim'] as Map<String, dynamic>);
    }
    final json = await _request(
      'POST',
      '/reimbursements',
      body: {
        'expenseDate': _dateOnly(expenseDate),
        'amount': double.tryParse(amount.replaceAll(',', '')),
        'category': category.toLowerCase(),
        'receiptName': receiptName,
        'note': note,
      },
    );
    return ReimbursementClaim.fromJson(json['claim'] as Map<String, dynamic>);
  }

  Future<String> updateProfilePhoto({
    required String path,
    required String filename,
  }) async {
    final request = http.MultipartRequest('PATCH', Uri.parse('$_baseUrl/manager/photo'))
      ..headers['Authorization'] = 'Bearer ${session.token}'
      ..files.add(
        await http.MultipartFile.fromPath('photo', path, filename: filename),
      );
    final json = await _send(request);
    return json['photoUrl'] as String;
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final request = http.Request(method, Uri.parse('$_baseUrl$path'))
      ..headers.addAll({
        'Authorization': 'Bearer ${session.token}',
        'Content-Type': 'application/json',
      });
    if (body != null) request.body = jsonEncode(body);

    return _send(request, label: '$method $path');
  }

  Future<Map<String, dynamic>> _send(
    http.BaseRequest request, {
    String? label,
  }) async {
    final streamed = await _client.send(request);
    final response = await http.Response.fromStream(streamed);
    final json = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = json['message'] as String? ?? 'Request failed';
      throw ManagerApiException(label == null ? message : '$label: $message');
    }
    return json;
  }
}

List<LeaveRequest> _parseLeaves(Map<String, dynamic> json) {
  final values = json['leaves'] as List<dynamic>? ?? const [];
  return values
      .map((value) => LeaveRequest.fromJson(value as Map<String, dynamic>))
      .toList();
}

List<OvertimeRequest> _parseOvertime(Map<String, dynamic> json) {
  final values = json['overtime'] as List<dynamic>? ?? const [];
  return values
      .map((value) => OvertimeRequest.fromJson(value as Map<String, dynamic>))
      .toList();
}

/// The UI labels leave types "Casual Leave" / "Sick Leave" / "Earned Leave",
/// but the API only accepts the bare tokens `casual` / `sick` / `earned`.
String _leaveTypeToken(String label) {
  final lower = label.trim().toLowerCase();
  for (final token in const ['sick', 'casual', 'earned']) {
    if (lower.startsWith(token)) return token;
  }
  return lower;
}

String _dateOnly(DateTime value) {
  final date = DateTime(value.year, value.month, value.day);
  return '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
}

class ManagerApiException implements Exception {
  const ManagerApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

const List<AwardNomination> _awardDefinitions = <AwardNomination>[
  AwardNomination(
    key: 'artist',
    title: 'Best Artist',
    subtitle: 'Standout craft this month',
    icon: 'palette',
  ),
  AwardNomination(
    key: 'mentor',
    title: 'Best Mentor',
    subtitle: 'Lifted others up',
    icon: 'school',
  ),
  AwardNomination(
    key: 'culture',
    title: 'Culture Champion',
    subtitle: 'Lived the team values',
    icon: 'heart',
  ),
  AwardNomination(
    key: 'rising',
    title: 'Rising Star',
    subtitle: 'Fastest growth',
    icon: 'star',
  ),
];
