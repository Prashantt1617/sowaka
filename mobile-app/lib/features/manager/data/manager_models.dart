/// The tabs the app can show. The order is the IndexedStack's order in the
/// shell, so new tabs go on the end; which of them a person sees, and in what
/// order, comes from [visibleTabs].
enum ManagerTab { manage, grow, connect, games, quick, care, talk }

/// The keys a company's tab list uses, as the server sends them.
const Map<String, ManagerTab> _tabByKey = {
  'connect': ManagerTab.connect,
  'team': ManagerTab.manage,
  'grow': ManagerTab.grow,
  'actions': ManagerTab.quick,
  'games': ManagerTab.games,
  'care': ManagerTab.care,
  'talk': ManagerTab.talk,
};

/// What a company gets when it has never been given a list.
const List<String> defaultTabKeys = ['connect', 'team', 'grow', 'actions'];

/// The bottom bar, in order, for a company's key list. Unknown keys are
/// skipped so an older app survives a newer server; an empty or entirely
/// unknown list falls back to the four the app has always had.
List<ManagerTab> visibleTabs(List<String> keys) {
  final tabs = <ManagerTab>[];
  for (final key in keys) {
    final tab = _tabByKey[key.trim().toLowerCase()];
    if (tab != null && !tabs.contains(tab)) tabs.add(tab);
  }
  if (tabs.isNotEmpty) return tabs;
  return [for (final key in defaultTabKeys) _tabByKey[key]!];
}

enum ManagerView { home, feedbackList }

/// The two halves of the Team tab. Held in app state rather than in the
/// widget, so a notification can land on Requests directly.
enum TeamSection { myTeam, requests }

enum FeedbackStatus { pending, saved, sent, missed }

enum LeaveDecision { pending, approved, declined }

enum TeamPresenceStatus { present, notPunchedIn }

/// One line on the feedback form.
///
/// [parameterId], [subtitle] and [description] come from the KPI parameter HR
/// assigned. The copy used to live in the app keyed on [name]; it is data now,
/// so an HR-authored parameter reads correctly instead of falling back to a
/// blank line. Both stay nullable for reviews written before KPIs were
/// configurable.
class FeedbackParam {
  const FeedbackParam({
    required this.name,
    required this.score,
    required this.note,
    this.parameterId,
    this.subtitle,
    this.description,
    this.weight,
  });

  final String name;
  final double score;
  final String note;
  final String? parameterId;
  final String? subtitle;
  final String? description;

  /// Percentage this parameter contributes to the overall score. HR sets it per
  /// template, and the weights across a set add up to 100, so the overall stays
  /// out of 5. Null on reviews written before weighting existed.
  final int? weight;

  FeedbackParam copyWith({String? name, double? score, String? note}) {
    return FeedbackParam(
      name: name ?? this.name,
      score: score ?? this.score,
      note: note ?? this.note,
      parameterId: parameterId,
      subtitle: subtitle,
      description: description,
      weight: weight,
    );
  }

  factory FeedbackParam.fromJson(Map<String, dynamic> json) {
    return FeedbackParam(
      name: json['name'] as String? ?? '',
      score: (json['score'] as num?)?.toDouble() ?? 0,
      note: json['note'] as String? ?? '',
      parameterId: json['parameterId'] as String?,
      subtitle: json['subtitle'] as String?,
      description: json['description'] as String?,
      weight: (json['weight'] as num?)?.round(),
    );
  }
}

/// What the app re-reads to keep feedback current while it runs.
class FeedbackSnapshot {
  const FeedbackSnapshot({
    required this.managerScore,
    required this.growthHistory,
    required this.team,
    this.cycleEndsOn,
  });

  final double managerScore;
  final List<GrowthRecord> growthHistory;
  final DateTime? cycleEndsOn;

  /// The review for each report this cycle, by their userId.
  final Map<String, Map<String, dynamic>> team;
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
      parameters: values
          .map((value) => FeedbackParam.fromJson(value as Map<String, dynamic>))
          .toList(),
      sentAt:
          DateTime.tryParse(json['sentAt'] as String? ?? '') ?? DateTime.now(),
      managerName: json['managerName'] as String? ?? 'Your manager',
    );
  }
}

class OrgChartNode {
  const OrgChartNode({
    required this.userId,
    required this.name,
    required this.designation,
    required this.isSelf,
    this.isReport = false,
  });

  final String userId;
  final String name;
  final String designation;
  final bool isSelf;

  /// Someone who reports to the person the chart is about. They hang below the
  /// highlighted card rather than continuing the line above it.
  final bool isReport;

  factory OrgChartNode.fromJson(Map<String, dynamic> json) => OrgChartNode(
    userId: json['userId'] as String? ?? '',
    name: json['name'] as String? ?? '',
    designation: json['designation'] as String? ?? '',
    isSelf: json['isSelf'] as bool? ?? false,
    isReport: json['isReport'] as bool? ?? false,
  );
}

class EmployeeDocument {
  const EmployeeDocument({
    required this.name,
    required this.url,
    this.type,
    this.uploadedAt,
  });

  final String name;
  final String url;
  final String? type;
  final DateTime? uploadedAt;

  factory EmployeeDocument.fromJson(Map<String, dynamic> json) =>
      EmployeeDocument(
        name: json['name'] as String? ?? 'Document',
        url: json['url'] as String? ?? '',
        type: json['type'] as String?,
        uploadedAt: DateTime.tryParse(json['uploadedAt'] as String? ?? ''),
      );
}

class TeamMember {
  const TeamMember({
    required this.id,
    required this.userId,
    required this.name,
    this.isManager = false,
    this.isSelf = false,
    this.reportsToViewer = false,
    this.inViewerChain = false,
    this.reportCount = 0,
    required this.initial,
    required this.team,
    required this.score,
    required this.next,
    required this.status,
    required this.missedMonths,
    required this.avatarIndex,
    required this.params,
    required this.extra,
    this.todayMark = 'not_in',
    this.recognitionLabel,
    this.todayStatus = TeamPresenceStatus.notPunchedIn,
    this.birthday,
    this.designation = '',
    this.photoUrl,
    this.punchIn,
    this.punchOut,
    this.email = '',
    this.employeeId,
    this.joiningDate,
    this.employmentType,
    this.managerName,
    this.orgChart = const [],
    this.documents = const [],
    this.previousScore,
    this.history = const [],
  });

  final int id;
  final String userId;
  final String name;

  /// The viewer's own manager — shown as "(Manager)" in the team list.
  /// The viewer themselves, shown as "(You)" in the list.
  final bool isSelf;

  /// Someone who reports to the viewer. It separates the team they lead from
  /// the team they belong to.
  final bool reportsToViewer;

  /// True when the viewer is anywhere above them: a report, or a report's
  /// report. Only their attendance is the viewer's to open.
  final bool inViewerChain;

  /// How many people report to them — a member who leads a team of their own
  /// is offered an expander rather than read as an individual.
  final int reportCount;

  final bool isManager;
  final String initial;
  final String team;
  final double score;
  final DateTime next;
  final FeedbackStatus status;
  final int missedMonths;
  final int avatarIndex;
  final List<FeedbackParam> params;
  final String extra;

  /// How today reads on the team card, graded by the server against this
  /// member's own shift: present, late, half_day, wfh, leave or not_in.
  final String todayMark;

  /// The recognition HR gave them — "Employee of the month" — if any.
  final String? recognitionLabel;

  final TeamPresenceStatus todayStatus;
  final DateTime? birthday;
  final String designation;
  final String? photoUrl;
  final DateTime? punchIn;
  final DateTime? punchOut;
  final String email;
  final String? employeeId;
  final DateTime? joiningDate;
  final String? employmentType;
  final String? managerName;
  final List<OrgChartNode> orgChart;
  final List<EmployeeDocument> documents;

  /// Overall score from the previous review period, when there is one.
  final double? previousScore;

  /// Every sent review for this member, oldest first.
  final List<GrowthRecord> history;

  factory TeamMember.fromJson(Map<String, dynamic> json, int id) {
    final name = json['name'] as String? ?? 'Employee';
    final values = json['parameters'] as List<dynamic>? ?? const [];
    return TeamMember(
      id: id,
      userId: json['userId'] as String? ?? '',
      name: name,
      isManager: json['isManager'] == true,
      isSelf: json['isSelf'] == true,
      reportsToViewer: json['reportsToViewer'] == true,
      // An older server says only who reports directly.
      inViewerChain:
          json['inViewerChain'] == true || json['reportsToViewer'] == true,
      reportCount: (json['reportCount'] as num?)?.toInt() ?? 0,
      initial: name.isEmpty ? '?' : name[0].toUpperCase(),
      team: json['department'] as String? ?? 'Team',
      score: (json['score'] as num?)?.toDouble() ?? 0,
      previousScore: (json['previousScore'] as num?)?.toDouble(),
      history: (json['history'] as List<dynamic>? ?? const [])
          .map((value) => GrowthRecord.fromJson(value as Map<String, dynamic>))
          .toList(),
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
      params: values
          .map((value) => FeedbackParam.fromJson(value as Map<String, dynamic>))
          .toList(),
      extra: json['extra'] as String? ?? '',
      todayMark:
          json['todayMark'] as String? ??
          (json['todayStatus'] == 'present' ? 'present' : 'not_in'),
      recognitionLabel: (json['recognitionLabel'] as String?)?.trim(),
      todayStatus: json['todayStatus'] == 'present'
          ? TeamPresenceStatus.present
          : TeamPresenceStatus.notPunchedIn,
      birthday: DateTime.tryParse(json['birthday'] as String? ?? ''),
      designation: json['designation'] as String? ?? '',
      photoUrl: json['photoUrl'] as String?,
      punchIn: DateTime.tryParse(json['punchIn'] as String? ?? '')?.toLocal(),
      punchOut: DateTime.tryParse(json['punchOut'] as String? ?? '')?.toLocal(),
      email: json['email'] as String? ?? '',
      employeeId: json['employeeId'] as String?,
      joiningDate: DateTime.tryParse(json['joiningDate'] as String? ?? ''),
      employmentType: json['employmentType'] as String?,
      managerName: json['managerName'] as String?,
      orgChart: (json['orgChart'] as List<dynamic>? ?? const [])
          .map((value) => OrgChartNode.fromJson(value as Map<String, dynamic>))
          .toList(),
      documents: (json['documents'] as List<dynamic>? ?? const [])
          .map(
            (value) => EmployeeDocument.fromJson(value as Map<String, dynamic>),
          )
          .toList(),
    );
  }

  TeamMember copyWith({
    double? score,
    FeedbackStatus? status,
    List<FeedbackParam>? params,
    String? extra,
    List<GrowthRecord>? history,
    double? previousScore,
  }) {
    return TeamMember(
      id: id,
      userId: userId,
      name: name,
      isManager: isManager,
      // Who someone is to the viewer does not change when their review does.
      // Dropping these three here once emptied the Team tab's Direct Reports
      // and the feedback list five seconds after they loaded.
      isSelf: isSelf,
      reportsToViewer: reportsToViewer,
      inViewerChain: inViewerChain,
      reportCount: reportCount,
      initial: initial,
      team: team,
      score: score ?? this.score,
      next: next,
      status: status ?? this.status,
      missedMonths: missedMonths,
      avatarIndex: avatarIndex,
      params: params ?? this.params,
      extra: extra ?? this.extra,
      todayStatus: todayStatus,
      birthday: birthday,
      designation: designation,
      photoUrl: photoUrl,
      punchIn: punchIn,
      punchOut: punchOut,
      email: email,
      employeeId: employeeId,
      joiningDate: joiningDate,
      employmentType: employmentType,
      managerName: managerName,
      orgChart: orgChart,
      documents: documents,
      previousScore: previousScore ?? this.previousScore,
      history: history ?? this.history,
    );
  }
}

class LeaveBalanceItem {
  const LeaveBalanceItem({
    required this.remaining,
    required this.total,
    this.monthly = false,
    this.period = '',
  });

  /// Days, which can be fractional — comp-off is credited in halves and a
  /// half-day leave spends half a day.
  final double remaining;
  final double total;

  /// Processed at the end of every month: what is left lapses or carries
  /// per the rule, so these are this month's days, not the year's.
  final bool monthly;

  /// The month the figures are for, as yyyy-mm, when [monthly].
  final String period;

  /// "September", for a monthly balance; empty otherwise.
  String get periodLabel {
    if (!monthly) return '';
    final month = int.tryParse(period.split('-').elementAtOrNull(1) ?? '');
    if (month == null || month < 1 || month > 12) return 'this month';
    return _monthName(month);
  }

  factory LeaveBalanceItem.fromJson(Map<String, dynamic> json) {
    return LeaveBalanceItem(
      remaining: (json['remaining'] as num?)?.toDouble() ?? 0,
      total: (json['total'] as num?)?.toDouble() ?? 0,
      monthly: json['cadence'] == 'monthly',
      period: json['period'] as String? ?? '',
    );
  }
}

String _monthName(int month) => const [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
][month - 1];

/// Trims a trailing `.0` so 12 reads as "12" and 0.5 as "0.5".
String formatDays(double value) => value == value.roundToDouble()
    ? value.toInt().toString()
    : value.toString();

class LeaveBalance {
  const LeaveBalance({
    required this.year,
    required this.sick,
    required this.casual,
    required this.earned,
    this.compOff = const LeaveBalanceItem(remaining: 0, total: 0),
    this.byKey = const {},
  });

  /// Every type on the employee's template, by key — including any HR added
  /// in the dashboard, such as an emergency leave. Empty from an older server.
  final Map<String, LeaveBalanceItem> byKey;

  /// The balance of one type by its key, or null if there is none.
  LeaveBalanceItem? forKey(String key) =>
      byKey[key] ??
      switch (key) {
        'casual' => casual,
        'sick' => sick,
        'earned' => earned,
        'comp_off' => compOff,
        _ => null,
      };

  final int year;
  final LeaveBalanceItem sick;
  final LeaveBalanceItem casual;
  final LeaveBalanceItem earned;

  /// Earned by approved overtime rather than accrued monthly.
  final LeaveBalanceItem compOff;

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
      compOff: LeaveBalanceItem.fromJson(
        json['comp_off'] as Map<String, dynamic>? ?? const {},
      ),
      byKey: {
        for (final item in json['types'] as List<dynamic>? ?? const [])
          if (item is Map<String, dynamic> && item['key'] is String)
            item['key'] as String: LeaveBalanceItem.fromJson(item),
      },
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
    this.userId = '',
    this.photoUrl,
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
    this.halfDay = false,
    this.documentName,
    this.documentUrl,
  });

  final String id;
  final String userId;

  /// The requester's own photo, when they have set one.
  final String? photoUrl;
  final String who;
  final String initial;
  final int avatarIndex;
  final String team;
  final String type;
  final DateTime start;
  final DateTime end;

  /// Leave days consumed — 0.5 for a half day, so this is fractional.
  final double days;

  /// "3" / "0.5" — trims the trailing ".0" on whole days.
  String get daysLabel =>
      days == days.roundToDouble() ? days.toInt().toString() : days.toString();
  final String reason;
  final DateTime requestedOn;
  final LeaveDecision decision;
  final String managerNote;
  final String decidedByRole; // 'admin' = overridden from the HR dashboard

  /// Half a day off — only ever true on a single-date request.
  final bool halfDay;

  /// The supporting document, when one was attached, and a short-lived signed
  /// link to it.
  final String? documentName;
  final String? documentUrl;

  bool get decidedByAdmin => decidedByRole == 'admin';

  factory LeaveRequest.fromJson(Map<String, dynamic> json) {
    final employee = json['employee'] as Map<String, dynamic>? ?? const {};
    final name = employee['name'] as String? ?? 'Employee';
    final typeValue = json['type'] as String? ?? 'casual';
    // Named as the template names it, "Emergency Leave" reading as "Emergency"
    // like "Casual" does. Older servers send only the key.
    final typeName = (json['typeName'] as String? ?? '')
        .replaceAll(RegExp(r'\s+[Ll]eave$'), '')
        .trim();
    final start = DateTime.parse(json['startDate'] as String);
    final end = DateTime.parse(json['endDate'] as String);
    return LeaveRequest(
      id: json['id'] as String? ?? '',
      userId: json['userId'] as String? ?? '',
      who: name,
      initial: name.isEmpty ? '?' : name[0].toUpperCase(),
      avatarIndex: name.hashCode.abs() % 7,
      team:
          employee['department'] as String? ??
          employee['designation'] as String? ??
          'Team',
      photoUrl: employee['photoUrl'] as String?,
      type: typeName.isNotEmpty
          ? typeName
          : typeValue.isEmpty
          ? 'Leave'
          : '${typeValue[0].toUpperCase()}${typeValue.substring(1)}',
      start: start,
      end: end,
      days:
          (json['days'] as num?)?.toDouble() ??
          (end.difference(start).inDays + 1).toDouble(),
      reason: json['reason'] as String? ?? '',
      halfDay: json['halfDay'] as bool? ?? false,
      documentName: json['documentName'] as String?,
      documentUrl: json['documentUrl'] as String?,
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
      userId: userId,
      photoUrl: photoUrl,
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
      halfDay: halfDay,
      documentName: documentName,
      documentUrl: documentUrl,
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
    this.userId = '',
    this.photoUrl,
    required this.who,
    required this.initial,
    required this.avatarIndex,
    required this.team,
    required this.workDate,
    required this.startTime,
    required this.endTime,
    required this.hours,
    required this.note,
    required this.requestedOn,
    required this.decision,
    required this.managerNote,
    this.decidedByRole = '',
    this.duration = '',
  });

  final String id;
  final String userId;

  /// The requester's own photo, when they have set one.
  final String? photoUrl;
  final String who;
  final String initial;
  final int avatarIndex;
  final String team;
  final DateTime workDate;
  final DateTime startTime;
  final DateTime endTime;
  final double hours;
  final String note;
  final DateTime requestedOn;
  final LeaveDecision decision;
  final String managerNote;
  final String decidedByRole; // 'admin' = overridden from the HR dashboard

  /// 'half_day' or 'full_day' from the server; empty from an older one.
  final String duration;

  bool get decidedByAdmin => decidedByRole == 'admin';

  /// What was applied for, in the words the form used: a half day or a full
  /// one. The hours behind it come from the org's shift policy, and are not
  /// what anybody chose.
  String get hoursLabel => halfDayClaim ? 'Half day' : 'Full day';

  /// The server grades the claim against the requester's own shift and says
  /// so; that is the day the comp-off is credited as, so it is what shows.
  /// A server that has not sent it yet is judged at six hours, as before.
  bool get halfDayClaim =>
      duration.isNotEmpty ? duration == 'half_day' : hours < 6;

  String get timeRangeLabel =>
      '${_clockLabel(startTime)} – ${_clockLabel(endTime)}';

  factory OvertimeRequest.fromJson(Map<String, dynamic> json) {
    final employee = json['employee'] as Map<String, dynamic>? ?? const {};
    final name = employee['name'] as String? ?? 'Employee';
    return OvertimeRequest(
      id: json['id'] as String? ?? '',
      userId: json['userId'] as String? ?? '',
      who: name,
      initial: name.isEmpty ? '?' : name[0].toUpperCase(),
      avatarIndex: name.hashCode.abs() % 7,
      photoUrl: employee['photoUrl'] as String?,
      team: employee['department'] as String? ?? 'Team',
      workDate: DateTime.parse(json['workDate'] as String),
      startTime:
          DateTime.tryParse(json['startTime'] as String? ?? '')?.toLocal() ??
          DateTime.parse(json['workDate'] as String),
      endTime:
          DateTime.tryParse(json['endTime'] as String? ?? '')?.toLocal() ??
          DateTime.parse(json['workDate'] as String),
      hours: (json['hours'] as num?)?.toDouble() ?? 0,
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
      duration: json['duration'] as String? ?? '',
    );
  }

  OvertimeRequest copyWith({LeaveDecision? decision, String? managerNote}) {
    return OvertimeRequest(
      id: id,
      userId: userId,
      photoUrl: photoUrl,
      who: who,
      initial: initial,
      avatarIndex: avatarIndex,
      team: team,
      workDate: workDate,
      startTime: startTime,
      endTime: endTime,
      hours: hours,
      duration: duration,
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
    this.userId = '',
    this.photoUrl,
    required this.who,
    required this.initial,
    required this.avatarIndex,
    required this.team,
    required this.category,
    required this.amount,
    required this.expenseDate,
    required this.receiptName,
    required this.note,
    required this.status,
    required this.createdAt,
    this.receiptUrl,
    this.decidedByRole = '',
    this.managerNote = '',
  });

  final String id;
  final String userId;

  /// The claimant's own photo, when they have set one.
  final String? photoUrl;
  final String who;
  final String initial;
  final int avatarIndex;
  final String team;
  final String category;
  final double amount;
  final DateTime expenseDate;
  final String receiptName;

  /// Short-lived signed link to the stored receipt, when there is one.
  final String? receiptUrl;
  final String note;
  final String status;
  final DateTime createdAt;
  final String
  decidedByRole; // reimbursements are always decided from the dashboard ('admin')

  /// The note left with the decision, so the manager and the employee can both
  /// read why a claim went the way it did.
  final String managerNote;

  bool get decidedByAdmin => decidedByRole == 'admin';

  /// Status shown to the employee, e.g. "Approved by admin" for a dashboard decision.
  String get statusLabel =>
      decidedByAdmin && (status == 'Approved' || status == 'Declined')
      ? '$status by admin'
      : status;

  factory ReimbursementClaim.fromJson(Map<String, dynamic> json) {
    final category = json['category'] as String? ?? 'other';
    final employee = json['employee'] as Map<String, dynamic>? ?? const {};
    final name = employee['name'] as String? ?? 'Employee';
    return ReimbursementClaim(
      id: json['id'] as String? ?? '',
      userId: json['userId'] as String? ?? '',
      who: name,
      initial: name.isEmpty ? '?' : name[0].toUpperCase(),
      avatarIndex: name.hashCode.abs() % 7,
      photoUrl: employee['photoUrl'] as String?,
      team: employee['department'] as String? ?? 'Team',
      category: category.isEmpty
          ? 'Other'
          : '${category[0].toUpperCase()}${category.substring(1)}',
      amount: (json['amount'] as num?)?.toDouble() ?? 0,
      expenseDate: DateTime.parse(json['expenseDate'] as String),
      receiptName: json['receiptName'] as String? ?? '',
      receiptUrl: json['receiptUrl'] as String?,
      note: json['note'] as String? ?? '',
      managerNote: json['managerNote'] as String? ?? '',
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
      userId: userId,
      photoUrl: photoUrl,
      who: who,
      initial: initial,
      avatarIndex: avatarIndex,
      team: team,
      category: category,
      amount: amount,
      expenseDate: expenseDate,
      receiptName: receiptName,
      receiptUrl: receiptUrl,
      note: note,
      status: status ?? this.status,
      managerNote: managerNote,
      createdAt: createdAt,
      decidedByRole: decidedByRole,
    );
  }
}

class ManagerDashboard {
  const ManagerDashboard({
    required this.managerName,
    required this.managerInitial,
    this.managerPhotoUrl,
    required this.managerTeam,
    required this.approverName,
    this.hasManager = true,
    this.teamLevel = 1,
    this.myParameters = const [],
    this.cycleEndsOn,
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
    this.reimbursements = const [],
    this.weekoffDays = const [0],
    this.shift = const ShiftPolicy(),
    this.reimbursementTypes = const [],
    this.myOrgChart = const [],
    this.overtimeEnabled = true,
    this.attendance = const [],
    this.regularizations = const [],
    this.managerRegularizations = const [],
  });

  final String managerName;
  final String managerInitial;
  final String? managerPhotoUrl;
  final String managerTeam;
  final String approverName;

  /// Whether anyone reviews this person. False for whoever sits at the top of
  /// the reporting tree — they have no "your feedback" to wait on, so the card
  /// for it is not shown. Defaults to true so a backend that predates the field
  /// keeps showing it, as it always did.
  final bool hasManager;

  /// How the viewer's team reads: 1 works alongside peers, 2 also leads
  /// people, 3 leads leaders and sees the teams beneath them.
  final int teamLevel;

  /// The viewer's own KPIs this cycle, with HR's subtitle and guidance for
  /// each. Shown for a month that has not been reviewed yet, so the page says
  /// what the review will cover instead of standing empty.
  final List<FeedbackParam> myParameters;

  /// The day the review cycle closes. Until then a manager can still edit a
  /// review they have already shared, which the Grow page says out loud.
  final DateTime? cycleEndsOn;
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
  final List<ReimbursementClaim> reimbursements;
  // Company config (from /manager/workspace): week-off weekdays (0=Sun..6=Sat)
  // and whether the overtime feature is enabled for this user's team.
  final List<int> weekoffDays;

  /// The shift HR configured for the org: the worked-hour thresholds a day is
  /// graded against, and the grace either side of the shift window. Set in the
  /// dashboard under Shifts › Templates — never hardcoded here.
  final ShiftPolicy shift;

  /// What the org lets people claim against, and the cap on each.
  final List<ReimbursementType> reimbursementTypes;

  /// The viewer's own reporting line, top of the chain down to them.
  final List<OrgChartNode> myOrgChart;
  final bool overtimeEnabled;
  final List<AttendanceRecord> attendance;
  final List<AttendanceRegularization> regularizations;
  final List<AttendanceRegularization> managerRegularizations;

  ManagerDashboard copyWith({
    String? managerPhotoUrl,
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
    List<ReimbursementClaim>? reimbursements,
    List<AttendanceRecord>? attendance,
    List<AttendanceRegularization>? regularizations,
    List<AttendanceRegularization>? managerRegularizations,
    ShiftPolicy? shift,
    List<GrowthRecord>? growthHistory,
    DateTime? cycleEndsOn,
  }) {
    return ManagerDashboard(
      managerName: managerName,
      managerInitial: managerInitial,
      managerPhotoUrl: managerPhotoUrl ?? this.managerPhotoUrl,
      managerTeam: managerTeam,
      approverName: approverName,
      hasManager: hasManager,
      teamLevel: teamLevel,
      myParameters: myParameters,
      cycleEndsOn: cycleEndsOn ?? this.cycleEndsOn,
      managerScore: managerScore ?? this.managerScore,
      growthHistory: growthHistory ?? this.growthHistory,
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
      reimbursements: reimbursements ?? this.reimbursements,
      weekoffDays: weekoffDays,
      shift: shift ?? this.shift,
      reimbursementTypes: reimbursementTypes,
      myOrgChart: myOrgChart,
      overtimeEnabled: overtimeEnabled,
      attendance: attendance ?? this.attendance,
      regularizations: regularizations ?? this.regularizations,
      managerRegularizations:
          managerRegularizations ?? this.managerRegularizations,
    );
  }
}

/// How the org grades a working day. Comes from the shift template HR saved in
/// the dashboard; the defaults here match what that form opens with, and only
/// apply to an org that has never saved a shift.
/// A kind of expense the org lets people claim, with its own cap.
///
/// HR owns this list; it used to be four values hardcoded in the app. The cap
/// is checked here before submitting and again on the server, so a stale list
/// cannot slip a claim past the limit.
class ReimbursementType {
  const ReimbursementType({
    required this.id,
    required this.name,
    this.description = '',
    this.maxLimit = 0,
    this.backdateDays = 30,
  });

  final String id;
  final String name;
  final String description;

  /// Rupees. Zero means uncapped.
  final double maxLimit;

  /// How far back an expense may be dated. Zero means today only.
  final int backdateDays;

  bool allows(double amount) => maxLimit <= 0 || amount <= maxLimit;

  /// The oldest date this type can still be claimed for.
  DateTime earliestClaimableFrom(DateTime today) =>
      today.subtract(Duration(days: backdateDays));

  factory ReimbursementType.fromJson(Map<String, dynamic> json) =>
      ReimbursementType(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        description: json['description'] as String? ?? '',
        maxLimit: (json['maxLimit'] as num?)?.toDouble() ?? 0,
        backdateDays: (json['backdateDays'] as num?)?.toInt() ?? 30,
      );
}

/// When one leave type may be applied for, as HR configured it.
/// What a regularisation may be raised against, straight from HR's Attendance
/// correction page: which of the four day outcomes are allowed, and how far
/// back a request may reach.
class CorrectionRules {
  const CorrectionRules({
    this.triggers = const [
      'Missing punch-in',
      'Missing punch-out',
      'Both punches missing',
    ],
    this.backdateDays = 7,
    this.punchFormat = '',
    this.punchMode = 'Both punches',
    this.absentOutcomes = const ['Full day', 'Half day', 'Leave'],
    this.halfDayOutcomes = const ['Full day'],
    this.outsideLocation = const OutsideLocationRules(),
  });

  final List<String> triggers;

  /// On a geotagged shift: what a punch from outside every office leads to,
  /// and the reasons HR lets the employee choose from.
  final OutsideLocationRules outsideLocation;
  final int backdateDays;
  final String punchFormat;

  /// Whether this employee's day is built from one punch or two. On a
  /// single-punch setup there is no punch-out to be missing, so the day is
  /// either recorded — a full day — or it is not.
  final String punchMode;

  /// What HR lets an absent day be raised as.
  final List<String> absentOutcomes;

  /// What a half day may be raised as. Fixed to a full day: there is nothing
  /// else a half day could be disputed as.
  final List<String> halfDayOutcomes;

  bool get singlePunch => punchMode == 'Single punch';

  /// What this day may be asked to become, as day-type keys the server
  /// accepts. Mirrors the rule the server enforces, so the sheet cannot offer
  /// a choice the request would be refused for.
  List<String> outcomesForMark(String mark) {
    const keys = {
      'Full day': 'full_day',
      'Half day': 'half_day',
      'Leave': 'leave',
    };
    final allowed = mark == 'Half Day'
        ? halfDayOutcomes
        : mark == 'Absent'
        ? absentOutcomes
        // Already a full day, so there is nothing to argue up to.
        : absentOutcomes.where((outcome) => outcome != 'Full day').toList();
    return allowed.map((outcome) => keys[outcome]).whereType<String>().toList();
  }

  /// The case a day falls into, named the way the policy names it. A
  /// single-punch day has only two of them, and keeps these names so a policy
  /// saved under either mode still reads.
  static String triggerFor({DateTime? punchIn, DateTime? punchOut}) {
    if (punchIn != null && punchOut != null) return 'Both punches present';
    if (punchIn == null && punchOut == null) return 'Both punches missing';
    return punchIn != null ? 'Missing punch-out' : 'Missing punch-in';
  }

  bool allows(String trigger) => triggers.contains(trigger);

  /// The earliest day a correction can still be raised for.
  DateTime earliestFrom(DateTime today) =>
      today.subtract(Duration(days: backdateDays));

  factory CorrectionRules.fromJson(Map<String, dynamic> json) =>
      CorrectionRules(
        triggers:
            (json['triggers'] as List<dynamic>? ??
                    const [
                      'Missing punch-in',
                      'Missing punch-out',
                      'Both punches missing',
                    ])
                .map((value) => value.toString())
                .toList(),
        backdateDays: (json['backdateDays'] as num?)?.toInt() ?? 7,
        punchFormat: json['punchFormat'] as String? ?? '',
        punchMode: json['punchMode'] as String? ?? 'Both punches',
        absentOutcomes:
            (json['absentOutcomes'] as List<dynamic>? ??
                    const ['Full day', 'Half day', 'Leave'])
                .map((value) => value.toString())
                .toList(),
        outsideLocation: OutsideLocationRules.fromJson(
          json['outsideLocation'] as Map<String, dynamic>? ?? const {},
        ),
        halfDayOutcomes:
            (json['halfDayOutcomes'] as List<dynamic>? ?? const ['Full day'])
                .map((value) => value.toString())
                .toList(),
      );
}

/// Whether a leave range can be applied for, and if not, why — one rule, used
/// by every apply-leave surface so none of them can drift from the policy the
/// server enforces. Returns null when the range is fine.
///
/// [holidayDates] are the company holidays this employee observes; days off in
/// the shift's week-off grid are read from [policy]. [availableDays] is the
/// balance left for this type when the caller knows it — the server counts
/// pending requests against it too, so it is the stricter authority.
String? leaveRangeProblem({
  required ShiftPolicy policy,
  required Set<String> holidayDates,
  required String typeLabel,
  required DateTime from,
  required DateTime to,
  required DateTime today,
  int maxDays = 30,
  bool halfDay = false,
  double? availableDays,
}) {
  DateTime dayOf(DateTime value) =>
      DateTime(value.year, value.month, value.day);
  String key(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-'
      '${value.month.toString().padLeft(2, '0')}-'
      '${value.day.toString().padLeft(2, '0')}';

  final start = dayOf(from);
  final end = dayOf(to);
  final now = dayOf(today);

  if (end.isBefore(start)) return 'The end date is before the start date.';
  if (end.difference(start).inDays + 1 > maxDays) {
    return 'Leave cannot exceed $maxDays days.';
  }
  if (halfDay && start != end) {
    return 'A half day can only be applied for a single date.';
  }

  if (!policy.allowsLeave(typeLabel)) {
    return '$typeLabel is not available in your organisation.';
  }

  final window = policy.windowForLeave(typeLabel);
  if (window != null) {
    final earliest = dayOf(window.earliestFrom(now));
    final latest = dayOf(window.latestFrom(now));
    // Only the limit that was crossed: a day in the past is about how far
    // back, a day ahead about how far ahead.
    if (start.isBefore(earliest)) {
      return window.allowBackdated && window.backdatedDays > 0
          ? 'Leave can only be applied up to ${window.backdatedDays} days '
                'back.'
          : 'Leave cannot be applied for a day already past.';
    }
    if (end.isAfter(latest)) {
      return 'Leave can only be applied up to ${window.advanceDays} days '
          'ahead.';
    }
  }

  // A week-off or a company holiday costs no leave, so a range made only of
  // those is not a leave request at all.
  var chargeable = 0;
  for (
    var day = start;
    !day.isAfter(end);
    day = day.add(const Duration(days: 1))
  ) {
    if (policy.isWeekOff(day) || holidayDates.contains(key(day))) continue;
    chargeable += 1;
  }
  if (chargeable == 0) {
    return start == end
        ? 'That day is a week-off or a company holiday — no leave is needed.'
        : 'Those dates are all week-offs or company holidays — no leave would '
              'be used.';
  }

  final cost = halfDay ? 0.5 : chargeable.toDouble();
  if (availableDays != null && cost > availableDays) {
    return availableDays <= 0
        ? 'You have no $typeLabel left this year.'
        : 'That is $cost days, and only '
              '${availableDays == availableDays.roundToDouble() ? availableDays.toStringAsFixed(0) : availableDays.toStringAsFixed(1)} '
              'day(s) of $typeLabel are left.';
  }
  return null;
}

class LeaveTypeWindow {
  const LeaveTypeWindow({
    required this.key,
    required this.name,
    this.advanceDays = 30,
    this.allowBackdated = true,
    this.backdatedDays = 3,
  });

  final String key;
  final String name;
  final int advanceDays;
  final bool allowBackdated;
  final int backdatedDays;

  /// The furthest ahead this type can be applied for.
  DateTime latestFrom(DateTime today) => today.add(Duration(days: advanceDays));

  /// The earliest date this type can still be applied for.
  DateTime earliestFrom(DateTime today) =>
      allowBackdated ? today.subtract(Duration(days: backdatedDays)) : today;

  factory LeaveTypeWindow.fromJson(Map<String, dynamic> json) =>
      LeaveTypeWindow(
        key: json['key'] as String? ?? '',
        name: json['name'] as String? ?? '',
        advanceDays: (json['advanceDays'] as num?)?.toInt() ?? 30,
        allowBackdated: json['allowBackdated'] as bool? ?? true,
        backdatedDays: (json['backdatedDays'] as num?)?.toInt() ?? 3,
      );
}

/// The four rules HR switches on or off for how a day is marked, exactly as
/// the server grades it. Defaults are what a server that has never sent them
/// means: only "fewer hours than a full day is a half day" is on.
class HalfDayRules {
  const HalfDayRules({
    this.minHalfDayEnabled = false,
    this.minFullDayEnabled = true,
    this.lateArrivalEnabled = false,
    this.lateArrivalMinutes = 120,
    this.earlyLeaveEnabled = false,
    this.earlyLeaveMinutes = 60,
  });

  /// Fewer hours than the half-day minimum is not a working day.
  final bool minHalfDayEnabled;

  /// Fewer hours than the full-day minimum is a half day.
  final bool minFullDayEnabled;

  /// Arriving later than this many minutes after the shift starts is a half day.
  final bool lateArrivalEnabled;
  final int lateArrivalMinutes;

  /// Leaving more than this many minutes before the shift ends is a half day.
  final bool earlyLeaveEnabled;
  final int earlyLeaveMinutes;

  factory HalfDayRules.fromJson(Map<String, dynamic> json) {
    bool flag(String key, bool fallback) {
      final value = json[key];
      return value is bool ? value : fallback;
    }

    int minutes(String key, int fallback) {
      final value = json[key];
      return value is num ? value.toInt() : fallback;
    }

    return HalfDayRules(
      minHalfDayEnabled: flag('minHalfDayEnabled', false),
      minFullDayEnabled: flag('minFullDayEnabled', true),
      lateArrivalEnabled: flag('lateArrivalEnabled', false),
      lateArrivalMinutes: minutes('lateArrivalMinutes', 120),
      earlyLeaveEnabled: flag('earlyLeaveEnabled', false),
      earlyLeaveMinutes: minutes('earlyLeaveMinutes', 60),
    );
  }
}

/// How a day with punches is marked.
enum DayMark { present, halfDay, absent }

class ShiftPolicy {
  const ShiftPolicy({
    this.name = 'General',
    this.startTime = '09:00',
    this.endTime = '18:00',
    this.minHalfDayHours = 4,
    this.minFullDayHours = 8,
    this.halfDay = const HalfDayRules(),
    this.lateMarkingEnabled = true,
    this.earlyMarkingEnabled = true,
    this.lateGraceMinutes = 10,
    this.earlyOutGraceMinutes = 10,
    this.weeklyOff = const {
      '1': [6],
      '2': [6],
      '3': [6],
      '4': [6],
      '5': [6],
    },
    this.missingPunchIn = 'Absent',
    this.missingPunchOut = 'Absent',
    this.missingBoth = 'Absent',
    this.overtimeBackdateDays = 7,
    this.leaveBalanceTracked = true,
    this.leaveTypes = const [],
    this.correction = const CorrectionRules(),
  });

  final String name;

  /// Local wall-clock "HH:MM". An end at or before the start means overnight.
  final String startTime;
  final String endTime;
  final double minHalfDayHours;
  final double minFullDayHours;
  final HalfDayRules halfDay;

  /// Whether anyone on this shift is marked late or early at all. Off keeps
  /// the minutes but marks nobody.
  final bool lateMarkingEnabled;
  final bool earlyMarkingEnabled;
  final int lateGraceMinutes;
  final int earlyOutGraceMinutes;

  /// Week of the month ('1'..'5') -> weekday indexes that are off,
  /// 0 = Mon .. 6 = Sun. Set under Shifts › Policies.
  final Map<String, List<int>> weeklyOff;

  /// What a day with a punch missing is recorded as — 'Absent', 'Half Day' or
  /// 'Present' — set by HR under Shifts › Attendance correction. The calendar
  /// marks the day as this rather than deciding for itself.
  final String missingPunchIn;
  final String missingPunchOut;
  final String missingBoth;

  /// How far back an overtime claim may reach, in days.
  final int overtimeBackdateDays;

  /// The application window for each leave type, so the pickers can be bounded
  /// rather than letting someone fill a form the server will refuse.
  final List<LeaveTypeWindow> leaveTypes;

  /// Whether this employee punches from the app at all.
  ///
  /// Their template decides it: a biometric device or an auto-punch policy
  /// records the day without them, so the app shows what arrived rather than
  /// offering a control that would do nothing.
  bool get punchesFromApp =>
      correction.punchFormat == 'Geotag (powered by Sowaka)' ||
      correction.punchFormat == 'In-app punch in';

  /// Whether this employee's leave is counted down from a balance.
  ///
  /// Off means unlimited leave: nothing to spend, so the app asks for dates
  /// and a reason rather than a type, and shows what has been applied for
  /// instead of what is left.
  final bool leaveBalanceTracked;

  /// Whether this employee is marked present without punching at all.
  ///
  /// Nobody punches on auto punch, so there are no times to show and no punch
  /// that could be missing — showing empty punch columns to these people reads
  /// as a day that went wrong rather than one that never had punches.
  bool get markedPresentAutomatically =>
      correction.punchFormat == 'Present by default (Auto Punch)';

  /// Whether this employee's day is built from a single punch. There is no
  /// punch-out to take, so none is offered and none can be missing.
  bool get singlePunchDay => correction.singlePunch;

  /// Whether the punch this employee takes is checked against an office.
  bool get punchIsGeofenced =>
      correction.punchFormat == 'Geotag (powered by Sowaka)';

  /// What a correction may be raised against, so the calendar can grey the
  /// button out rather than opening a form the server will refuse.
  final CorrectionRules correction;

  /// The leave types someone may actually apply for, by display name. HR can
  /// switch a type off in the dashboard, and the server then leaves it out of
  /// this list — so it disappears from the picker, the balance strip and the
  /// day counts here as well. An empty list means an older server that does not
  /// send the policy yet, so fall back to the four standard types.
  List<String> get applicableLeaveLabels => leaveTypes.isEmpty
      ? const ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Comp-off']
      : [for (final type in leaveTypes) type.name];

  /// Whether a leave type, by display name, is switched on.
  bool allowsLeave(String label) =>
      leaveTypes.isEmpty || windowForLeave(label) != null;

  /// The key to send for a leave type picked by name — "Emergency" or
  /// "Emergency Leave" is whatever key the template gave it, so a type HR
  /// added or renamed still reaches the server as itself.
  String leaveKeyFor(String label) {
    final known = windowForLeave(label)?.key;
    if (known != null) return known;
    final lower = label.trim().toLowerCase();
    if (lower.startsWith('comp')) return 'comp_off';
    for (final token in const ['sick', 'casual', 'earned']) {
      if (lower.startsWith(token)) return token;
    }
    return lower
        .replaceAll(RegExp(r'\bleaves?\b'), ' ')
        .replaceAll(RegExp(r'[^a-z0-9]+'), '_')
        .replaceAll(RegExp(r'^_+|_+$'), '');
  }

  /// The window for one leave type by its display name, or null if unknown.
  LeaveTypeWindow? windowForLeave(String label) {
    // By name first, with or without the word "leave": "Emergency" and
    // "Emergency Leave" are the same type, whatever its key.
    String bare(String value) =>
        value.trim().toLowerCase().replaceAll(RegExp(r'\s+leave$'), '');
    for (final type in leaveTypes) {
      if (type.key == label || bare(type.name) == bare(label)) return type;
    }
    for (final type in leaveTypes) {
      if (type.name == label ||
          type.key == label.toLowerCase().replaceAll(' ', '_')) {
        return type;
      }
      // 'Casual Leave' in the app's picker is the 'casual' type here.
      if (label.toLowerCase().startsWith(type.key.replaceAll('_', '-')) ||
          label.toLowerCase().startsWith(type.key)) {
        return type;
      }
    }
    return null;
  }

  /// How long the shift runs. An end at or before the start is overnight.
  Duration get window {
    final from = startMinutes;
    final to = endMinutes;
    if (from == null || to == null) return const Duration(hours: 9);
    final span = to - from;
    return Duration(minutes: span <= 0 ? span + 24 * 60 : span);
  }

  /// Whether [date] is a weekly off. The grid is per week of the month, so the
  /// 2nd Saturday can be off while the 1st is not; weeks are counted from the
  /// 1st in blocks of seven, and a 5th block covers the tail of a long month.
  /// Whether a weekday (0 = Mon .. 6 = Sun) is off in any week of the month —
  /// for describing the policy in words rather than grading a date.
  bool isWeekOffWeekday(int weekday) =>
      weeklyOff.values.any((days) => days.contains(weekday));

  bool isWeekOff(DateTime date) {
    final week = ((date.day - 1) ~/ 7) + 1;
    final weekday = date.weekday - 1; // Dart: Mon = 1 .. Sun = 7
    return (weeklyOff[(week > 5 ? 5 : week).toString()] ?? const []).contains(
      weekday,
    );
  }

  Duration get minHalfDay => _hours(minHalfDayHours);
  Duration get minFullDay => _hours(minFullDayHours);
  static Duration _hours(double value) =>
      Duration(minutes: (value * 60).round());

  /// How HR says a day with these punches should be recorded.
  ///
  /// On a single-punch policy there is no punch-out to be missing: the punch
  /// either arrived, and the day is a full one, or it did not.
  String markFor({DateTime? punchIn, DateTime? punchOut}) {
    if (singlePunchDay) return punchIn == null ? missingBoth : 'Present';
    if (punchIn == null && punchOut == null) return missingBoth;
    return punchIn == null ? missingPunchIn : missingPunchOut;
  }

  /// Whether this day counts as recorded: both punches, or the only one.
  bool dayIsComplete({DateTime? punchIn, DateTime? punchOut}) =>
      singlePunchDay ? punchIn != null : punchIn != null && punchOut != null;

  /// The case this day falls into, as this employee's policy names it.
  String triggerFor({DateTime? punchIn, DateTime? punchOut}) => singlePunchDay
      // One punch, so the only two cases are recorded and not recorded.
      ? (punchIn == null ? 'Both punches missing' : 'Both punches present')
      : CorrectionRules.triggerFor(punchIn: punchIn, punchOut: punchOut);

  /// Minutes past midnight for [startTime] / [endTime], or null if malformed.
  int? get startMinutes => _minutes(startTime);
  int? get endMinutes => _minutes(endTime);
  static int? _minutes(String value) {
    final parts = value.split(':');
    if (parts.length != 2) return null;
    final hour = int.tryParse(parts[0]);
    final minute = int.tryParse(parts[1]);
    if (hour == null || minute == null) return null;
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }

  /// The hours a corrected day is recorded as, from this shift's own times —
  /// the same rule the server applies when it approves a correction.
  ///
  /// A full day and a work-from-home day both run the whole shift; a half day
  /// runs from the start for as long as the policy says a half day lasts.
  /// Leave records no hours at all: it is time off, not time worked.
  (DateTime?, DateTime?) punchWindowFor(String dayType, DateTime date) {
    final start = startMinutes;
    if (start == null || dayType.isEmpty || dayType == 'leave') {
      return (null, null);
    }
    final day = DateTime(date.year, date.month, date.day);
    final from = day.add(Duration(minutes: start));
    if (dayType == 'half_day') {
      final hours = minHalfDayHours > 0 ? minHalfDayHours : 4;
      return (from, from.add(Duration(minutes: (hours * 60).round())));
    }
    if (dayType != 'full_day' && dayType != 'wfh') return (null, null);
    final end = endMinutes;
    if (end == null) return (null, null);
    // An end at or before the start means the shift runs overnight.
    return (
      from,
      day.add(Duration(minutes: end <= start ? end + 24 * 60 : end)),
    );
  }

  /// Whether [punchIn] landed after the shift start plus its grace. Never,
  /// when HR chose not to categorise anyone as late.
  bool isLate(DateTime punchIn) {
    if (!lateMarkingEnabled) return false;
    final start = startMinutes;
    if (start == null) return false;
    return punchIn.hour * 60 + punchIn.minute > start + lateGraceMinutes;
  }

  /// Whether [punchOut] came before the shift end less its grace. Overnight
  /// shifts end on the next calendar day, so they are left out rather than
  /// flagged wrongly against a same-day clock.
  bool isEarlyOut(DateTime punchOut) {
    if (!earlyMarkingEnabled) return false;
    final start = startMinutes;
    final end = endMinutes;
    if (start == null || end == null || end <= start) return false;
    return punchOut.hour * 60 + punchOut.minute < end - earlyOutGraceMinutes;
  }

  /// How the server marks a day, from the same four switchable rules — so the
  /// calendar can never disagree with what HR sees. [worked] is the time
  /// between the two punches; null when there is only one punch.
  DayMark dayMark(DateTime? punchIn, DateTime? punchOut, Duration? worked) {
    final start = startMinutes;
    final end = endMinutes;
    bool lateIn() {
      if (!halfDay.lateArrivalEnabled || punchIn == null || start == null) {
        return false;
      }
      return punchIn.hour * 60 + punchIn.minute - start >
          halfDay.lateArrivalMinutes;
    }

    bool earlyOut() {
      if (!halfDay.earlyLeaveEnabled ||
          punchOut == null ||
          start == null ||
          end == null ||
          end <= start) {
        return false;
      }
      return end - (punchOut.hour * 60 + punchOut.minute) >
          halfDay.earlyLeaveMinutes;
    }

    // One punch: no hours to grade, so only arriving late can make it half.
    if (worked == null) return lateIn() ? DayMark.halfDay : DayMark.present;
    if (halfDay.minHalfDayEnabled && worked < minHalfDay) {
      return DayMark.absent;
    }
    if (halfDay.minFullDayEnabled && worked < minFullDay) {
      return DayMark.halfDay;
    }
    if (lateIn() || earlyOut()) return DayMark.halfDay;
    return DayMark.present;
  }

  factory ShiftPolicy.fromJson(Map<String, dynamic> json) {
    double hours(String key, double fallback) {
      final value = json[key];
      return value is num ? value.toDouble() : fallback;
    }

    int minutes(String key, int fallback) {
      final value = json[key];
      return value is num ? value.toInt() : fallback;
    }

    return ShiftPolicy(
      name: json['name'] as String? ?? 'General',
      startTime: json['startTime'] as String? ?? '09:00',
      endTime: json['endTime'] as String? ?? '18:00',
      minHalfDayHours: hours('minHalfDayHours', 4),
      minFullDayHours: hours('minFullDayHours', 8),
      halfDay: HalfDayRules.fromJson(
        json['halfDay'] as Map<String, dynamic>? ?? const {},
      ),
      lateMarkingEnabled: json['lateMarkingEnabled'] as bool? ?? true,
      lateGraceMinutes: minutes('lateGraceMinutes', 10),
      earlyMarkingEnabled: json['earlyMarkingEnabled'] as bool? ?? true,
      earlyOutGraceMinutes: minutes('earlyOutGraceMinutes', 10),
      missingPunchIn: json['missingPunchIn'] as String? ?? 'Absent',
      missingPunchOut: json['missingPunchOut'] as String? ?? 'Absent',
      missingBoth: json['missingBoth'] as String? ?? 'Absent',
      weeklyOff: {
        for (final entry
            in (json['weeklyOff'] as Map<dynamic, dynamic>? ?? const {})
                .entries)
          entry.key.toString(): [
            for (final day in (entry.value as List<dynamic>? ?? const []))
              (day as num).toInt(),
          ],
      },
      overtimeBackdateDays:
          (json['overtimeBackdateDays'] as num?)?.toInt() ?? 7,
      leaveBalanceTracked: json['leaveBalanceTracked'] as bool? ?? true,
      correction: CorrectionRules.fromJson(
        json['correction'] as Map<String, dynamic>? ?? const {},
      ),
      leaveTypes: (json['leaveTypes'] as List<dynamic>? ?? const [])
          .map(
            (value) => LeaveTypeWindow.fromJson(value as Map<String, dynamic>),
          )
          .toList(),
    );
  }
}

class AttendanceRecord {
  const AttendanceRecord({
    required this.workDate,
    this.punchIn,
    this.punchOut,
    this.dayType = '',
    this.officeName,
    this.outsideLocation,
    this.request,
  });
  final DateTime workDate;
  final DateTime? punchIn;
  final DateTime? punchOut;

  /// Set when the day was punched from outside every office: the reason the
  /// employee gave and where they were.
  final OutsideLocationNote? outsideLocation;

  /// Sent back by a punch that became an out of location request instead of
  /// a recorded punch. The day is not present until the manager approves it.
  final AttendanceRegularization? request;

  /// The office a geofenced punch matched, sent back by the punch itself so
  /// the confirmation can name where you were. Null on every other read — the
  /// calendar does not carry it.
  final String? officeName;

  /// What an approved correction recorded the day as: full_day, half_day, wfh
  /// or leave. Empty on a day nobody has corrected. A day corrected to leave
  /// carries no punches by design, so without this the calendar read it as a
  /// present day with its times missing.
  final String dayType;

  /// The day type in the words the calendar uses, or empty when there is none.
  String get dayTypeLabel => switch (dayType) {
    'full_day' => 'Full Day',
    'half_day' => 'Half Day',
    'wfh' => 'Work from home',
    'client_visit' || 'office_visit' => 'Client visit',
    'leave' => 'Leave',
    _ => '',
  };

  factory AttendanceRecord.fromJson(Map<String, dynamic> json) =>
      AttendanceRecord(
        workDate: DateTime.parse(json['workDate'] as String),
        officeName: json['office'] as String?,
        punchIn: DateTime.tryParse(json['punchIn'] as String? ?? '')?.toLocal(),
        punchOut: DateTime.tryParse(
          json['punchOut'] as String? ?? '',
        )?.toLocal(),
        dayType: json['dayType'] as String? ?? '',
        outsideLocation: OutsideLocationNote.fromJson(
          json['outsideLocation'] as Map<String, dynamic>?,
        ),
        request: json['request'] is Map<String, dynamic>
            ? AttendanceRegularization.fromJson(
                json['request'] as Map<String, dynamic>,
              )
            : null,
      );
}

/// What HR decided happens when someone punches away from every office:
/// 'request' sends it to the manager, 'present' marks the day with a remark.
/// The reasons are HR's own wording, shown exactly as written.
class OutsideLocationRules {
  const OutsideLocationRules({
    this.outcome = 'request',
    this.reasons = const [],
  });

  final String outcome;
  final List<String> reasons;

  bool get marksPresent => outcome == 'present';

  factory OutsideLocationRules.fromJson(Map<String, dynamic> json) =>
      OutsideLocationRules(
        outcome: json['outcome'] as String? ?? 'request',
        reasons: (json['reasons'] as List<dynamic>? ?? const [])
            .map((value) => value.toString())
            .where((value) => value.isNotEmpty)
            .toList(),
      );
}

/// A punch taken away from every office: why, and where, in the words the
/// server already chose — "1.2 km from Gurgaon office" rather than a pin.
class OutsideLocationNote {
  const OutsideLocationNote({
    required this.reason,
    required this.place,
    this.punchType = 'in',
    this.at,
    this.latitude,
    this.longitude,
  });

  final String reason;
  final String place;
  final String punchType;
  final DateTime? at;
  final double? latitude;
  final double? longitude;

  static OutsideLocationNote? fromJson(Map<String, dynamic>? json) {
    if (json == null) return null;
    return OutsideLocationNote(
      reason: json['reason'] as String? ?? '',
      place: json['place'] as String? ?? 'Away from office',
      punchType: json['punchType'] as String? ?? 'in',
      at: DateTime.tryParse(json['at'] as String? ?? '')?.toLocal(),
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
    );
  }
}

class AttendanceRegularization {
  const AttendanceRegularization({
    required this.id,
    this.userId = '',
    this.photoUrl,
    required this.workDate,
    required this.note,
    required this.status,
    required this.who,
    required this.team,
    required this.createdAt,
    this.punchIn,
    this.punchOut,
    this.requestedPunchIn,
    this.requestedPunchOut,
    this.requestedDayType = '',
    this.managerNote = '',
    this.kind = 'correction',
    this.title,
    this.outsideLocation,
  });
  final String id;
  final String userId;

  /// 'correction' disputes how a day was graded; 'out_of_location' is a punch
  /// taken away from every office that the manager settles.
  final String kind;

  /// The heading the server chose, the same for the employee, the manager
  /// and HR — "Out of location request (Client visit)".
  final String? title;
  final OutsideLocationNote? outsideLocation;

  bool get isOutOfLocation => kind == 'out_of_location';

  /// What this request is called wherever it is listed.
  String get heading => title ?? 'Attendance Correction';

  /// The requester's own photo, when they have set one.
  final String? photoUrl;
  final DateTime workDate;
  final String note;
  final String status;
  final String who;
  final String team;
  final DateTime createdAt;

  /// What the device actually recorded for the day (may be missing).
  final DateTime? punchIn;
  final DateTime? punchOut;

  /// @deprecated The times older corrections asked to be recorded.
  final DateTime? requestedPunchIn;
  final DateTime? requestedPunchOut;

  /// What the employee is asking the day to be recorded as: full_day,
  /// half_day, wfh or leave. Empty on corrections raised before day types.
  final String requestedDayType;
  final String managerNote;

  /// The day type in the words the screens use.
  String get dayTypeLabel => switch (requestedDayType) {
    'full_day' => 'Full Day',
    'half_day' => 'Half Day',
    'wfh' => 'Work from home',
    'client_visit' || 'office_visit' => 'Client visit',
    'leave' => 'Leave',
    _ => '',
  };
  String get initial => who.isEmpty ? '?' : who[0].toUpperCase();
  int get avatarIndex => who.hashCode.abs() % 7;
  LeaveDecision get decision => switch (status) {
    'approved' => LeaveDecision.approved,
    'declined' => LeaveDecision.declined,
    _ => LeaveDecision.pending,
  };
  factory AttendanceRegularization.fromJson(
    Map<String, dynamic> json,
  ) => AttendanceRegularization(
    id: json['id'] as String? ?? '',
    userId: json['userId'] as String? ?? '',
    workDate: DateTime.parse(json['workDate'] as String),
    note: json['note'] as String? ?? '',
    status: json['status'] as String? ?? 'pending',
    who:
        (json['employee'] as Map<String, dynamic>?)?['name'] as String? ??
        'Employee',
    team:
        (json['employee'] as Map<String, dynamic>?)?['department'] as String? ??
        'Team',
    photoUrl:
        (json['employee'] as Map<String, dynamic>?)?['photoUrl'] as String?,
    createdAt:
        DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
    punchIn: DateTime.tryParse(json['punchIn'] as String? ?? '')?.toLocal(),
    punchOut: DateTime.tryParse(json['punchOut'] as String? ?? '')?.toLocal(),
    requestedPunchIn: DateTime.tryParse(
      json['requestedPunchIn'] as String? ?? '',
    )?.toLocal(),
    requestedPunchOut: DateTime.tryParse(
      json['requestedPunchOut'] as String? ?? '',
    )?.toLocal(),
    requestedDayType: json['requestedDayType'] as String? ?? '',
    managerNote: json['managerNote'] as String? ?? '',
    kind: json['kind'] as String? ?? 'correction',
    title: json['title'] as String?,
    outsideLocation: OutsideLocationNote.fromJson(
      json['outsideLocation'] as Map<String, dynamic>?,
    ),
  );
}

String _clockLabel(DateTime value) =>
    '${value.hour % 12 == 0 ? 12 : value.hour % 12}:${value.minute.toString().padLeft(2, '0')} ${value.hour >= 12 ? 'PM' : 'AM'}';

// ---------------------------------------------------------------- payslips

/// One rule's share of a month's loss of pay: how many times it fired and
/// what that cost, with the rule itself so the app can say why.
class PayslipDeductionLine {
  const PayslipDeductionLine({
    required this.label,
    required this.count,
    required this.days,
    this.trigger,
    this.every,
    this.deductDays,
  });

  final String label;
  final int count;
  final double days;
  final String? trigger;
  final int? every;
  final double? deductDays;

  /// Named from the rule, not the stored label, so older slips read current.
  String get name => switch (trigger) {
    'late' => 'Late arrivals',
    'early' => 'Early leaves',
    'absent' => 'Absent days',
    'half_day' => 'Half days',
    'leave' => 'Leave days',
    'missed_punch' => 'Missed punches',
    _ => label,
  };

  factory PayslipDeductionLine.fromJson(Map<String, dynamic> json) {
    return PayslipDeductionLine(
      label: json['label'] as String? ?? '',
      count: (json['count'] as num?)?.toInt() ?? 0,
      days: (json['days'] as num?)?.toDouble() ?? 0,
      trigger: json['trigger'] as String?,
      every: (json['every'] as num?)?.toInt(),
      deductDays: (json['deductDays'] as num?)?.toDouble(),
    );
  }
}

class PayslipAmount {
  const PayslipAmount({
    required this.name,
    required this.fullPaise,
    required this.paidPaise,
  });
  final String name;
  final int fullPaise;
  final int paidPaise;

  factory PayslipAmount.fromJson(Map<String, dynamic> json) => PayslipAmount(
    name: json['name'] as String? ?? '',
    fullPaise:
        (json['fullPaise'] as num?)?.toInt() ??
        (json['amountPaise'] as num?)?.toInt() ??
        0,
    paidPaise:
        (json['paidPaise'] as num?)?.toInt() ??
        (json['amountPaise'] as num?)?.toInt() ??
        0,
  );
}

/// A month's payslip as payroll produced it, plus the run it belongs to.
class Payslip {
  const Payslip({
    required this.id,
    required this.period,
    required this.runStatus,
    required this.employeeName,
    required this.employeeId,
    required this.designation,
    required this.department,
    required this.joiningDate,
    required this.earnings,
    required this.deductions,
    required this.netPayablePaise,
    required this.reimbursementsPaise,
    required this.overtimePaise,
    required this.workingDays,
    required this.payableDays,
    required this.lopDays,
    required this.paidLeaveDaysApplied,
    required this.lines,
  });

  final String id;
  final String period;
  final String runStatus;
  final String employeeName;
  final String employeeId;
  final String designation;
  final String department;

  /// YYYY-MM-DD, or empty.
  final String joiningDate;
  final List<PayslipAmount> earnings;
  final List<PayslipAmount> deductions;
  final int netPayablePaise;
  final int reimbursementsPaise;
  final int overtimePaise;
  final int workingDays;
  final int payableDays;
  final double lopDays;
  final double paidLeaveDaysApplied;
  final List<PayslipDeductionLine> lines;

  int get monthlyPaise => earnings.fold(0, (sum, e) => sum + e.fullPaise);
  int get lossOfPayPaise =>
      earnings.fold(0, (sum, e) => sum + (e.fullPaise - e.paidPaise));
  int get otherDeductionsPaise =>
      deductions.fold(0, (sum, d) => sum + d.fullPaise);

  factory Payslip.fromJson(
    Map<String, dynamic> run,
    Map<String, dynamic> json,
  ) {
    final inputs = json['inputs'] as Map<String, dynamic>? ?? const {};
    return Payslip(
      id: json['id'] as String? ?? '',
      period: json['period'] as String? ?? run['period'] as String? ?? '',
      runStatus: run['status'] as String? ?? 'draft',
      employeeName: json['employeeName'] as String? ?? '',
      employeeId: json['employeeId'] as String? ?? '',
      designation: json['designation'] as String? ?? '',
      department: json['department'] as String? ?? '',
      joiningDate: json['joiningDate'] as String? ?? '',
      earnings: (json['earnings'] as List<dynamic>? ?? const [])
          .map((e) => PayslipAmount.fromJson(e as Map<String, dynamic>))
          .toList(),
      deductions: (json['deductions'] as List<dynamic>? ?? const [])
          .map((e) => PayslipAmount.fromJson(e as Map<String, dynamic>))
          .toList(),
      netPayablePaise: (json['netPayablePaise'] as num?)?.toInt() ?? 0,
      reimbursementsPaise: (json['reimbursementsPaise'] as num?)?.toInt() ?? 0,
      overtimePaise: (inputs['overtimePaise'] as num?)?.toInt() ?? 0,
      workingDays: (inputs['workingDays'] as num?)?.toInt() ?? 0,
      payableDays: (inputs['payableDays'] as num?)?.toInt() ?? 0,
      lopDays: (inputs['lopDays'] as num?)?.toDouble() ?? 0,
      paidLeaveDaysApplied:
          (inputs['paidLeaveDaysApplied'] as num?)?.toDouble() ?? 0,
      lines: (inputs['attendanceDeductions'] as List<dynamic>? ?? const [])
          .map((e) => PayslipDeductionLine.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

/// One graded day of the month behind a payslip.
class PayslipDay {
  const PayslipDay({
    required this.date,
    required this.status,
    this.label,
    this.punchIn,
    this.punchOut,
    this.lateByMinutes = 0,
    this.earlyByMinutes = 0,
  });

  final DateTime date;
  final String status;
  final String? label;
  final DateTime? punchIn;
  final DateTime? punchOut;
  final int lateByMinutes;
  final int earlyByMinutes;

  factory PayslipDay.fromJson(Map<String, dynamic> json) => PayslipDay(
    date: DateTime.parse(json['date'] as String),
    status: json['status'] as String? ?? '',
    label: json['label'] as String?,
    punchIn: DateTime.tryParse(json['punchIn'] as String? ?? '')?.toLocal(),
    punchOut: DateTime.tryParse(json['punchOut'] as String? ?? '')?.toLocal(),
    lateByMinutes: (json['lateByMinutes'] as num?)?.toInt() ?? 0,
    earlyByMinutes: (json['earlyByMinutes'] as num?)?.toInt() ?? 0,
  );

  /// Whether this day counted towards a rule.
  bool countsFor(String? trigger) => switch (trigger) {
    'late' => lateByMinutes > 0 && status != 'missed_punch',
    'early' => earlyByMinutes > 0 && status != 'missed_punch',
    'absent' => status == 'absent',
    'half_day' => status == 'half_day' || status == 'missed_punch',
    'leave' => status == 'on_leave',
    'missed_punch' => status == 'missed_punch',
    _ => false,
  };
}

/// Whose name and address the slip is printed under.
class PayslipCompany {
  const PayslipCompany({required this.name, required this.address});
  final String name;
  final String address;
  factory PayslipCompany.fromJson(Map<String, dynamic> json) => PayslipCompany(
    name: json['name'] as String? ?? '',
    address: json['address'] as String? ?? '',
  );
}
