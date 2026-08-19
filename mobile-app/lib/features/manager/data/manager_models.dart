enum ManagerTab { manage, grow, connect, games, quick }

enum ManagerView {
  home,
  feedbackList,
  feedbackRecord,
  leaveRequests,
  overtimeRequests,
}

enum FeedbackStatus { pending, saved, sent, missed }

enum LeaveDecision { pending, approved, declined }

class FeedbackParam {
  const FeedbackParam({
    required this.name,
    required this.score,
    required this.note,
  });

  final String name;
  final double score;
  final String note;

  FeedbackParam copyWith({String? name, double? score, String? note}) {
    return FeedbackParam(
      name: name ?? this.name,
      score: score ?? this.score,
      note: note ?? this.note,
    );
  }
}

class GrowthRecord {
  const GrowthRecord({
    required this.period,
    required this.overallScore,
    required this.parameters,
    required this.sentAt,
    required this.managerName,
  });

  final String period;
  final double overallScore;
  final List<FeedbackParam> parameters;
  final DateTime sentAt;
  final String managerName;

  factory GrowthRecord.fromJson(Map<String, dynamic> json) {
    final values = json['parameters'] as List<dynamic>? ?? const [];
    return GrowthRecord(
      period: json['period'] as String? ?? '',
      overallScore: (json['overallScore'] as num?)?.toDouble() ?? 0,
      parameters: values.map((value) {
        final item = value as Map<String, dynamic>;
        return FeedbackParam(
          name: item['name'] as String? ?? '',
          score: (item['score'] as num?)?.toDouble() ?? 0,
          note: item['note'] as String? ?? '',
        );
      }).toList(),
      sentAt:
          DateTime.tryParse(json['sentAt'] as String? ?? '') ?? DateTime.now(),
      managerName: json['managerName'] as String? ?? 'Your manager',
    );
  }
}

class TeamMember {
  const TeamMember({
    required this.id,
    required this.userId,
    required this.name,
    required this.initial,
    required this.team,
    required this.score,
    required this.next,
    required this.status,
    required this.missedMonths,
    required this.avatarIndex,
    required this.params,
    required this.extra,
  });

  final int id;
  final String userId;
  final String name;
  final String initial;
  final String team;
  final double score;
  final DateTime next;
  final FeedbackStatus status;
  final int missedMonths;
  final int avatarIndex;
  final List<FeedbackParam> params;
  final String extra;

  factory TeamMember.fromJson(Map<String, dynamic> json, int id) {
    final name = json['name'] as String? ?? 'Employee';
    final values = json['parameters'] as List<dynamic>? ?? const [];
    return TeamMember(
      id: id,
      userId: json['userId'] as String? ?? '',
      name: name,
      initial: name.isEmpty ? '?' : name[0].toUpperCase(),
      team: json['department'] as String? ?? 'Team',
      score: (json['score'] as num?)?.toDouble() ?? 0,
      next:
          DateTime.tryParse(json['nextDate'] as String? ?? '') ??
          DateTime.now(),
      status: switch (json['feedbackStatus']) {
        'saved' => FeedbackStatus.saved,
        'sent' => FeedbackStatus.sent,
        _ => FeedbackStatus.pending,
      },
      missedMonths: (json['missedMonths'] as num?)?.toInt() ?? 0,
      avatarIndex: (id - 1) % 7,
      params: values.map((value) {
        final param = value as Map<String, dynamic>;
        return FeedbackParam(
          name: param['name'] as String? ?? '',
          score: (param['score'] as num?)?.toDouble() ?? 0,
          note: param['note'] as String? ?? '',
        );
      }).toList(),
      extra: json['extra'] as String? ?? '',
    );
  }

  TeamMember copyWith({
    double? score,
    FeedbackStatus? status,
    List<FeedbackParam>? params,
    String? extra,
  }) {
    return TeamMember(
      id: id,
      userId: userId,
      name: name,
      initial: initial,
      team: team,
      score: score ?? this.score,
      next: next,
      status: status ?? this.status,
      missedMonths: missedMonths,
      avatarIndex: avatarIndex,
      params: params ?? this.params,
      extra: extra ?? this.extra,
    );
  }
}

class LeaveBalanceItem {
  const LeaveBalanceItem({required this.remaining, required this.total});
  final int remaining;
  final int total;

  factory LeaveBalanceItem.fromJson(Map<String, dynamic> json) {
    return LeaveBalanceItem(
      remaining: (json['remaining'] as num?)?.toInt() ?? 0,
      total: (json['total'] as num?)?.toInt() ?? 0,
    );
  }
}

class LeaveBalance {
  const LeaveBalance({
    required this.year,
    required this.sick,
    required this.casual,
    required this.earned,
  });

  final int year;
  final LeaveBalanceItem sick;
  final LeaveBalanceItem casual;
  final LeaveBalanceItem earned;

  factory LeaveBalance.fromJson(Map<String, dynamic> json) {
    return LeaveBalance(
      year: (json['year'] as num?)?.toInt() ?? DateTime.now().year,
      sick: LeaveBalanceItem.fromJson(
        json['sick'] as Map<String, dynamic>? ?? const {},
      ),
      casual: LeaveBalanceItem.fromJson(
        json['casual'] as Map<String, dynamic>? ?? const {},
      ),
      earned: LeaveBalanceItem.fromJson(
        json['earned'] as Map<String, dynamic>? ?? const {},
      ),
    );
  }
}

class CompanyHoliday {
  const CompanyHoliday({
    required this.id,
    required this.date,
    required this.name,
  });

  final String id;
  final DateTime date;
  final String name;

  factory CompanyHoliday.fromJson(Map<String, dynamic> json) {
    return CompanyHoliday(
      id: json['id'] as String? ?? '',
      date: DateTime.parse(json['date'] as String),
      name: json['name'] as String? ?? 'Holiday',
    );
  }
}

class LeaveRequest {
  const LeaveRequest({
    required this.id,
    required this.who,
    required this.initial,
    required this.avatarIndex,
    required this.team,
    required this.type,
    required this.start,
    required this.end,
    required this.days,
    required this.reason,
    required this.requestedOn,
    required this.decision,
    required this.managerNote,
    this.decidedByRole = '',
  });

  final String id;
  final String who;
  final String initial;
  final int avatarIndex;
  final String team;
  final String type;
  final DateTime start;
  final DateTime end;
  final int days;
  final String reason;
  final DateTime requestedOn;
  final LeaveDecision decision;
  final String managerNote;
  final String decidedByRole; // 'admin' = overridden from the HR dashboard

  bool get decidedByAdmin => decidedByRole == 'admin';

  factory LeaveRequest.fromJson(Map<String, dynamic> json) {
    final employee = json['employee'] as Map<String, dynamic>? ?? const {};
    final name = employee['name'] as String? ?? 'Employee';
    final typeValue = json['type'] as String? ?? 'casual';
    final start = DateTime.parse(json['startDate'] as String);
    final end = DateTime.parse(json['endDate'] as String);
    return LeaveRequest(
      id: json['id'] as String? ?? '',
      who: name,
      initial: name.isEmpty ? '?' : name[0].toUpperCase(),
      avatarIndex: name.hashCode.abs() % 7,
      team:
          employee['department'] as String? ??
          employee['designation'] as String? ??
          'Team',
      type: '${typeValue[0].toUpperCase()}${typeValue.substring(1)}',
      start: start,
      end: end,
      days: json['days'] as int? ?? end.difference(start).inDays + 1,
      reason: json['reason'] as String? ?? '',
      requestedOn:
          DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.now(),
      decision: switch (json['status']) {
        'approved' => LeaveDecision.approved,
        'declined' => LeaveDecision.declined,
        _ => LeaveDecision.pending,
      },
      managerNote: json['managerNote'] as String? ?? '',
      decidedByRole: json['decidedByRole'] as String? ?? '',
    );
  }

  LeaveRequest copyWith({LeaveDecision? decision, String? managerNote}) {
    return LeaveRequest(
      id: id,
      who: who,
      initial: initial,
      avatarIndex: avatarIndex,
      team: team,
      type: type,
      start: start,
      end: end,
      days: days,
      reason: reason,
      requestedOn: requestedOn,
      decision: decision ?? this.decision,
      managerNote: managerNote ?? this.managerNote,
      decidedByRole: decidedByRole,
    );
  }
}

class AwardNomination {
  const AwardNomination({
    required this.key,
    required this.title,
    required this.subtitle,
    required this.icon,
    this.nomineeId,
    this.reason,
  });

  final String key;
  final String title;
  final String subtitle;
  final String icon;
  final int? nomineeId;
  final String? reason;

  bool get submitted => nomineeId != null;

  AwardNomination copyWith({int? nomineeId, String? reason}) {
    return AwardNomination(
      key: key,
      title: title,
      subtitle: subtitle,
      icon: icon,
      nomineeId: nomineeId ?? this.nomineeId,
      reason: reason ?? this.reason,
    );
  }
}

/// A past recognition nomination (any cycle), for the history view.
class Nomination {
  const Nomination({
    required this.period,
    required this.category,
    required this.employeeName,
    required this.reason,
  });

  final String period;
  final String category;
  final String employeeName;
  final String reason;

  factory Nomination.fromJson(Map<String, dynamic> json) {
    return Nomination(
      period: json['period'] as String? ?? '',
      category: json['category'] as String? ?? '',
      employeeName: json['employeeName'] as String? ?? 'Teammate',
      reason: json['reason'] as String? ?? '',
    );
  }
}

class OvertimeRequest {
  const OvertimeRequest({
    required this.id,
    required this.who,
    required this.initial,
    required this.avatarIndex,
    required this.team,
    required this.workDate,
    required this.duration,
    required this.hours,
    required this.project,
    required this.note,
    required this.requestedOn,
    required this.decision,
    required this.managerNote,
    this.decidedByRole = '',
  });

  final String id;
  final String who;
  final String initial;
  final int avatarIndex;
  final String team;
  final DateTime workDate;
  final String duration;
  final double hours;
  final String project;
  final String note;
  final DateTime requestedOn;
  final LeaveDecision decision;
  final String managerNote;
  final String decidedByRole; // 'admin' = overridden from the HR dashboard

  bool get decidedByAdmin => decidedByRole == 'admin';

  factory OvertimeRequest.fromJson(Map<String, dynamic> json) {
    final employee = json['employee'] as Map<String, dynamic>? ?? const {};
    final name = employee['name'] as String? ?? 'Employee';
    return OvertimeRequest(
      id: json['id'] as String? ?? '',
      who: name,
      initial: name.isEmpty ? '?' : name[0].toUpperCase(),
      avatarIndex: name.hashCode.abs() % 7,
      team: employee['department'] as String? ?? 'Team',
      workDate: DateTime.parse(json['workDate'] as String),
      duration: json['duration'] == 'full_day' ? 'Full day' : 'Half day',
      hours: (json['hours'] as num?)?.toDouble() ?? 0,
      project: json['project'] as String? ?? '',
      note: json['note'] as String? ?? '',
      requestedOn:
          DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.now(),
      decision: switch (json['status']) {
        'approved' => LeaveDecision.approved,
        'declined' => LeaveDecision.declined,
        _ => LeaveDecision.pending,
      },
      managerNote: json['managerNote'] as String? ?? '',
      decidedByRole: json['decidedByRole'] as String? ?? '',
    );
  }

  OvertimeRequest copyWith({LeaveDecision? decision, String? managerNote}) {
    return OvertimeRequest(
      id: id,
      who: who,
      initial: initial,
      avatarIndex: avatarIndex,
      team: team,
      workDate: workDate,
      duration: duration,
      hours: hours,
      project: project,
      note: note,
      requestedOn: requestedOn,
      decision: decision ?? this.decision,
      managerNote: managerNote ?? this.managerNote,
      decidedByRole: decidedByRole,
    );
  }
}

class ReimbursementClaim {
  const ReimbursementClaim({
    required this.id,
    required this.who,
    required this.team,
    required this.category,
    required this.amount,
    required this.expenseDate,
    required this.receiptName,
    required this.note,
    required this.status,
    required this.createdAt,
    this.decidedByRole = '',
  });

  final String id;
  final String who;
  final String team;
  final String category;
  final double amount;
  final DateTime expenseDate;
  final String receiptName;
  final String note;
  final String status;
  final DateTime createdAt;
  final String decidedByRole; // reimbursements are always decided from the dashboard ('admin')

  bool get decidedByAdmin => decidedByRole == 'admin';

  /// Status shown to the employee, e.g. "Approved by admin" for a dashboard decision.
  String get statusLabel =>
      decidedByAdmin && (status == 'Approved' || status == 'Declined')
      ? '$status by admin'
      : status;

  factory ReimbursementClaim.fromJson(Map<String, dynamic> json) {
    final category = json['category'] as String? ?? 'other';
    final employee = json['employee'] as Map<String, dynamic>? ?? const {};
    return ReimbursementClaim(
      id: json['id'] as String? ?? '',
      who: employee['name'] as String? ?? 'Employee',
      team: employee['department'] as String? ?? 'Team',
      category: category.isEmpty
          ? 'Other'
          : '${category[0].toUpperCase()}${category.substring(1)}',
      amount: (json['amount'] as num?)?.toDouble() ?? 0,
      expenseDate: DateTime.parse(json['expenseDate'] as String),
      receiptName: json['receiptName'] as String? ?? '',
      note: json['note'] as String? ?? '',
      status: switch (json['status']) {
        'approved' => 'Approved',
        'declined' => 'Declined',
        'paid' => 'Paid',
        _ => 'Pending',
      },
      createdAt:
          DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.now(),
      decidedByRole: json['decidedByRole'] as String? ?? '',
    );
  }

  ReimbursementClaim copyWith({String? status}) {
    return ReimbursementClaim(
      id: id,
      who: who,
      team: team,
      category: category,
      amount: amount,
      expenseDate: expenseDate,
      receiptName: receiptName,
      note: note,
      status: status ?? this.status,
      createdAt: createdAt,
      decidedByRole: decidedByRole,
    );
  }
}

class ManagerDashboard {
  const ManagerDashboard({
    required this.managerName,
    required this.managerInitial,
    required this.managerTeam,
    required this.approverName,
    required this.managerScore,
    required this.growthHistory,
    required this.today,
    required this.team,
    required this.recognitionCandidates,
    required this.leaves,
    required this.myLeaves,
    required this.awards,
    required this.recognitionHistory,
    required this.leaveBalance,
    required this.holidays,
    required this.overtime,
    required this.myOvertime,
    required this.myReimbursements,
    this.weekoffDays = const [0],
    this.overtimeEnabled = true,
  });

  final String managerName;
  final String managerInitial;
  final String managerTeam;
  final String approverName;
  final double managerScore;
  final List<GrowthRecord> growthHistory;
  final DateTime today;
  final List<TeamMember> team;
  final List<TeamMember> recognitionCandidates;
  final List<LeaveRequest> leaves;
  final List<LeaveRequest> myLeaves;
  final List<AwardNomination> awards;
  final List<Nomination> recognitionHistory;
  final LeaveBalance leaveBalance;
  final List<CompanyHoliday> holidays;
  final List<OvertimeRequest> overtime;
  final List<OvertimeRequest> myOvertime;
  final List<ReimbursementClaim> myReimbursements;
  // Company config (from /manager/workspace): week-off weekdays (0=Sun..6=Sat)
  // and whether the overtime feature is enabled for this user's team.
  final List<int> weekoffDays;
  final bool overtimeEnabled;

  ManagerDashboard copyWith({
    List<TeamMember>? team,
    List<TeamMember>? recognitionCandidates,
    List<LeaveRequest>? leaves,
    List<LeaveRequest>? myLeaves,
    List<AwardNomination>? awards,
    List<Nomination>? recognitionHistory,
    LeaveBalance? leaveBalance,
    List<CompanyHoliday>? holidays,
    List<OvertimeRequest>? overtime,
    List<OvertimeRequest>? myOvertime,
    List<ReimbursementClaim>? myReimbursements,
  }) {
    return ManagerDashboard(
      managerName: managerName,
      managerInitial: managerInitial,
      managerTeam: managerTeam,
      approverName: approverName,
      managerScore: managerScore,
      growthHistory: growthHistory,
      today: today,
      team: team ?? this.team,
      recognitionCandidates:
          recognitionCandidates ?? this.recognitionCandidates,
      leaves: leaves ?? this.leaves,
      myLeaves: myLeaves ?? this.myLeaves,
      awards: awards ?? this.awards,
      recognitionHistory: recognitionHistory ?? this.recognitionHistory,
      leaveBalance: leaveBalance ?? this.leaveBalance,
      holidays: holidays ?? this.holidays,
      overtime: overtime ?? this.overtime,
      myOvertime: myOvertime ?? this.myOvertime,
      myReimbursements: myReimbursements ?? this.myReimbursements,
      weekoffDays: weekoffDays,
      overtimeEnabled: overtimeEnabled,
    );
  }
}
