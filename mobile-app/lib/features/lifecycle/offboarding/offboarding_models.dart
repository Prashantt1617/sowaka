/// The shapes the app's offboarding reads (docs/lifecycle/CONTRACT.md,
/// "Offboarding" and `GET /lifecycle/me`; backend/src/models/lifecycle.model.ts
/// Resignation and HandoverItem). Every reader is lenient: a field the server
/// leaves out reads as absent, never as an error.
library;

String? _str(Object? value) {
  if (value is! String) return null;
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

int? _int(Object? value) => value is num ? value.toInt() : null;

Map<String, dynamic> _map(Object? value) =>
    value is Map ? value.cast<String, dynamic>() : const <String, dynamic>{};

List<Map<String, dynamic>> _maps(Object? value) => [
  if (value is List)
    for (final row in value)
      if (row is Map) row.cast<String, dynamic>(),
];

/// A calendar day ('YYYY-MM-DD'), or the day of an instant (ISO), as a local
/// date with no time. Null for anything else.
DateTime? parseDay(Object? value) {
  final text = _str(value);
  if (text == null) return null;
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(text);
  if (match != null) {
    return DateTime(
      int.parse(match.group(1)!),
      int.parse(match.group(2)!),
      int.parse(match.group(3)!),
    );
  }
  final instant = DateTime.tryParse(text)?.toLocal();
  return instant == null
      ? null
      : DateTime(instant.year, instant.month, instant.day);
}

/// `GET /lifecycle/me`: whether the lifecycle is on for this company, and
/// where this person stands in leaving it.
class LifecycleMe {
  const LifecycleMe({required this.enabled, this.offboarding});

  static const off = LifecycleMe(enabled: false);

  final bool enabled;
  final OffboardingSummary? offboarding;

  factory LifecycleMe.fromJson(Map<String, dynamic> json) {
    final enabled = json['enabled'] == true;
    final off = json['offboarding'];
    return LifecycleMe(
      enabled: enabled,
      offboarding: enabled && off is Map
          ? OffboardingSummary.fromJson(off.cast<String, dynamic>())
          : null,
    );
  }
}

/// `offboarding` of [LifecycleMe].
class OffboardingSummary {
  const OffboardingSummary({
    required this.status,
    this.journeyId,
    this.resignationId,
    this.tl,
    this.pageVisible = false,
  });

  final String status;
  final String? journeyId;
  final String? resignationId;

  /// The last working day.
  final DateTime? tl;

  /// The Off-boarding page in the Action tab (R3) is on for this exit.
  final bool pageVisible;

  bool get withdrawn => status == 'withdrawn';
  bool get closed => status == 'closed';

  factory OffboardingSummary.fromJson(Map<String, dynamic> json) =>
      OffboardingSummary(
        status: _str(json['status']) ?? '',
        journeyId: _str(json['journeyId']),
        resignationId: _str(json['resignationId']),
        tl: parseDay(json['tl']),
        pageVisible: json['pageVisible'] == true,
      );
}

/// What the manager did with a resignation before it went to HR.
class ManagerResignationAction {
  const ManagerResignationAction({
    required this.action,
    this.date,
    this.note,
    this.at,
    this.byName,
  });

  /// accept | change_day | release_early
  final String action;
  final DateTime? date;
  final String? note;
  final DateTime? at;
  final String? byName;

  factory ManagerResignationAction.fromJson(Map<String, dynamic> json) =>
      ManagerResignationAction(
        action: _str(json['action']) ?? 'accept',
        date: parseDay(json['date']),
        note: _str(json['note']),
        at: parseDay(json['at']),
        byName: _str(json['byName']),
      );
}

/// `ResignationView` = Resignation + `tl?`, `daysLeft?`, `managerName`; on the
/// manager's list also who resigned (`name`, `designation`, `photoUrl`).
class ResignationView {
  const ResignationView({
    required this.id,
    required this.userId,
    required this.status,
    required this.reason,
    required this.noticeDays,
    this.note,
    this.submittedAt,
    this.lastDayByNotice,
    this.agreedLastDay,
    this.tl,
    this.daysLeft,
    this.managerName,
    this.manager,
    this.hrAcceptedAt,
    this.withdrawnAt,
    this.name,
    this.designation,
    this.department,
    this.photoUrl,
  });

  final String id;
  final String userId;

  /// with_manager | with_hr | withdrawn | accepted
  final String status;
  final String reason;
  final String? note;
  final int noticeDays;
  final DateTime? submittedAt;
  final DateTime? lastDayByNotice;
  final DateTime? agreedLastDay;
  final DateTime? tl;
  final int? daysLeft;
  final String? managerName;
  final ManagerResignationAction? manager;
  final DateTime? hrAcceptedAt;
  final DateTime? withdrawnAt;

  // The person, on the manager's list.
  final String? name;
  final String? designation;
  final String? department;
  final String? photoUrl;

  bool get withManager => status == 'with_manager';
  bool get withHr => status == 'with_hr';
  bool get accepted => status == 'accepted';
  bool get withdrawn => status == 'withdrawn';

  /// Withdraw is offered until HR accepts.
  bool get canWithdraw => withManager || withHr;

  /// The last day as it stands: HR's, else the one the manager agreed, else
  /// the notice period's.
  DateTime? get lastDay =>
      tl ??
      agreedLastDay ??
      (manager?.action == 'accept' ? null : manager?.date) ??
      lastDayByNotice;

  /// The manager's first name, for copy like "It goes to Meera first".
  String? get managerFirstName => firstName(managerName);

  factory ResignationView.fromJson(Map<String, dynamic> json) {
    final manager = json['manager'];
    return ResignationView(
      id: _str(json['id']) ?? _str(json['_id']) ?? '',
      userId: _str(json['userId']) ?? '',
      status: _str(json['status']) ?? 'with_manager',
      reason: _str(json['reason']) ?? '',
      note: _str(json['note']),
      noticeDays: _int(json['noticeDays']) ?? 0,
      submittedAt: parseDay(json['submittedAt']),
      lastDayByNotice: parseDay(json['lastDayByNotice']),
      agreedLastDay: parseDay(json['agreedLastDay']),
      tl: parseDay(json['tl']),
      daysLeft: _int(json['daysLeft']),
      managerName: _str(json['managerName']),
      manager: manager is Map
          ? ManagerResignationAction.fromJson(manager.cast<String, dynamic>())
          : null,
      hrAcceptedAt: parseDay(json['hrAcceptedAt']),
      withdrawnAt: parseDay(json['withdrawnAt']),
      name: _str(json['name']) ?? _str(json['employeeName']),
      designation: _str(json['designation']),
      department: _str(json['department']),
      photoUrl: _str(json['photoUrl']),
    );
  }
}

/// `GET /lifecycle/resignation`.
class ResignationState {
  const ResignationState({
    required this.noticeDays,
    required this.canResign,
    this.resignation,
    this.lastDayByNotice,
    this.reasons = const [],
  });

  static const none = ResignationState(noticeDays: 0, canResign: false);

  final ResignationView? resignation;
  final int noticeDays;
  final DateTime? lastDayByNotice;
  final bool canResign;

  /// The reasons the server offers on R1 (`reasons`); empty when it sends none.
  final List<String> reasons;

  factory ResignationState.fromJson(Map<String, dynamic> json) {
    final resignation = json['resignation'];
    final reasons = json['reasons'];
    return ResignationState(
      resignation: resignation is Map
          ? ResignationView.fromJson(resignation.cast<String, dynamic>())
          : null,
      noticeDays: _int(json['noticeDays']) ?? 0,
      lastDayByNotice: parseDay(json['lastDayByNotice']),
      canResign: json['canResign'] == true,
      reasons: [
        if (reasons is List)
          for (final reason in reasons) ?_str(reason),
      ],
    );
  }
}

/// One of the manager's reports with an exit under way
/// (`GET /lifecycle/manager/leavers`): resigned and accepted, or an exit HR
/// started (retirement, end of contract) that has no resignation at all.
class LeaverSummary {
  const LeaverSummary({
    required this.userId,
    required this.name,
    this.designation,
    this.tl,
    this.daysLeft,
    this.handoverItems = 0,
    this.handoverUploaded = 0,
  });

  final String userId;
  final String name;
  final String? designation;
  final DateTime? tl;
  final int? daysLeft;
  final int handoverItems;
  final int handoverUploaded;

  factory LeaverSummary.fromJson(Map<String, dynamic> json) {
    final handover = _map(json['handover']);
    return LeaverSummary(
      userId: _str(json['userId']) ?? '',
      name: _str(json['name']) ?? '',
      designation: _str(json['designation']),
      tl: parseDay(json['tl']),
      daysLeft: _int(json['daysLeft']),
      handoverItems: _int(handover['items']) ?? 0,
      handoverUploaded: _int(handover['uploaded']) ?? 0,
    );
  }
}

/// A handover upload as the file endpoint gives it back: a short-lived link
/// (stored files), or the bytes themselves (a development server).
class HandoverFile {
  const HandoverFile({this.url, this.bytes, this.contentType, this.name});

  final String? url;
  final List<int>? bytes;
  final String? contentType;
  final String? name;
}

/// A journey task as a viewer sees it (`TaskView`, ENGINE-API.md).
class OffboardingTask {
  const OffboardingTask({
    required this.id,
    required this.title,
    required this.status,
    this.systemKey,
    this.phase,
    this.helper,
    this.ownerRole,
    this.ownerName,
    this.mustDo = false,
    this.opensAt,
    this.dueAt,
    this.dueLabel,
    this.doneAt,
    this.late = false,
  });

  final String id;
  final String? systemKey;
  final String? phase;
  final String title;
  final String? helper;
  final String? ownerRole;
  final String? ownerName;
  final bool mustDo;

  /// locked | todo | in_review | sent_back | done | skipped | cancelled
  final String status;
  final DateTime? opensAt;
  final DateTime? dueAt;
  final String? dueLabel;
  final DateTime? doneAt;
  final bool late;

  bool get done => status == 'done';
  bool get gone => status == 'skipped' || status == 'cancelled';

  factory OffboardingTask.fromJson(Map<String, dynamic> json) =>
      OffboardingTask(
        id: _str(json['id']) ?? '',
        systemKey: _str(json['systemKey']),
        phase: _str(json['phase']),
        // A clearance row (the manager's Other exit steps) names itself
        // `label` and says `done`; a journey task, `title` and `status`.
        title: _str(json['title']) ?? _str(json['label']) ?? '',
        helper: _str(json['helper']),
        ownerRole: _str(json['ownerRole']) ?? _str(json['team']),
        ownerName: _str(json['ownerName']),
        mustDo: json['mustDo'] == true,
        status:
            _str(json['status']) ?? (json['done'] == true ? 'done' : 'todo'),
        opensAt: parseDay(json['opensAt']),
        dueAt: parseDay(json['dueAt']),
        dueLabel: _str(json['dueLabel']),
        doneAt: parseDay(json['doneAt']),
        late: json['late'] == true,
      );
}

/// What was handed in against a checklist item: a file or a link.
class HandoverUpload {
  const HandoverUpload({
    required this.kind,
    this.fileId,
    this.url,
    this.name,
    this.at,
  });

  /// file | link
  final String kind;
  final String? fileId;
  final String? url;
  final String? name;
  final DateTime? at;

  bool get isLink => kind == 'link';

  /// What the chip shows: the file's name, or the link without its scheme.
  String get label {
    if (name case final value?) return value;
    final link = url ?? '';
    return link.replaceFirst(RegExp(r'^https?://'), '');
  }

  factory HandoverUpload.fromJson(Map<String, dynamic> json) => HandoverUpload(
    kind: _str(json['kind']) ?? (_str(json['url']) != null ? 'link' : 'file'),
    fileId: _str(json['fileId']),
    url: _str(json['url']),
    name: _str(json['name']),
    at: parseDay(json['at']),
  );
}

/// One line of the handover checklist the manager writes.
class HandoverItem {
  const HandoverItem({
    required this.id,
    required this.title,
    this.upload,
    this.done = false,
  });

  final String id;
  final String title;
  final HandoverUpload? upload;
  final bool done;

  bool get uploaded => upload != null;

  factory HandoverItem.fromJson(Map<String, dynamic> json) {
    final upload = json['upload'];
    return HandoverItem(
      id: _str(json['id']) ?? '',
      title: _str(json['title']) ?? '',
      upload: upload is Map
          ? HandoverUpload.fromJson(upload.cast<String, dynamic>())
          : null,
      done: json['done'] == true,
    );
  }
}

/// The handover checklist: items, the manager's note, and when it was added
/// and is due. Read from either a `handover` object or the flat fields the
/// contract lists (`handover: HandoverItem[]` + `handoverNote`).
class HandoverChecklist {
  const HandoverChecklist({
    required this.items,
    this.note,
    this.addedAt,
    this.dueAt,
    this.done = false,
    this.doneAt,
  });

  static const empty = HandoverChecklist(items: []);

  final List<HandoverItem> items;
  final String? note;
  final DateTime? addedAt;
  final DateTime? dueAt;

  /// The manager marked the handover done.
  final bool done;
  final DateTime? doneAt;

  int get uploadedCount => items.where((item) => item.uploaded).length;

  factory HandoverChecklist.fromJson(Map<String, dynamic> json) {
    final handover = json['handover'];
    final nested = handover is Map ? handover.cast<String, dynamic>() : null;
    final source = nested ?? json;
    final rows = nested != null ? nested['items'] : handover ?? json['items'];
    return HandoverChecklist(
      items: [for (final row in _maps(rows)) HandoverItem.fromJson(row)],
      note: _str(source['note']) ?? _str(json['handoverNote']),
      addedAt: parseDay(source['addedAt']) ?? parseDay(json['handoverAddedAt']),
      dueAt: parseDay(source['dueAt']) ?? parseDay(json['handoverDueAt']),
      done: source['done'] == true || json['handoverDone'] == true,
      doneAt: parseDay(source['doneAt']) ?? parseDay(json['handoverDoneAt']),
    );
  }
}

/// The exit interview's window.
class ExitInterviewState {
  const ExitInterviewState({
    this.opensAt,
    this.open = false,
    this.sent = false,
  });

  final DateTime? opensAt;
  final bool open;
  final bool sent;

  factory ExitInterviewState.fromJson(Map<String, dynamic> json) =>
      ExitInterviewState(
        opensAt: parseDay(json['opensAt']),
        open: json['open'] == true,
        sent: json['sent'] == true,
      );
}

/// A document to keep before access ends (payslips, Form 16).
class LeaverDocument {
  const LeaverDocument({required this.kind, required this.label, this.url});

  final String kind;
  final String label;
  final String? url;

  factory LeaverDocument.fromJson(Map<String, dynamic> json) => LeaverDocument(
    kind: _str(json['kind']) ?? '',
    label: _str(json['label']) ?? '',
    url: _str(json['url']),
  );
}

/// `GET /lifecycle/offboarding`: the Off-boarding page (R3).
class OffboardingPageData {
  const OffboardingPageData({
    required this.tasks,
    required this.handover,
    required this.interview,
    required this.documents,
    this.tl,
    this.daysLeft,
    this.managerName,
    this.managerPhotoUrl,
    this.acceptedAt,
    this.noticeFrom,
    this.exitType,
  });

  final DateTime? tl;
  final int? daysLeft;

  /// resignation | retirement | end_of_contract | termination | absconding
  final String? exitType;
  final List<OffboardingTask> tasks;
  final HandoverChecklist handover;
  final ExitInterviewState interview;
  final List<LeaverDocument> documents;

  /// Not in the contract's list, read when the server sends them; otherwise
  /// they come from the resignation.
  final String? managerName;

  /// The manager's face on "your manager"; null for no photo.
  final String? managerPhotoUrl;
  final DateTime? acceptedAt;
  final DateTime? noticeFrom;

  OffboardingTask? task(String systemKey) =>
      tasks.where((task) => task.systemKey == systemKey).firstOrNull;

  factory OffboardingPageData.fromJson(Map<String, dynamic> json) =>
      OffboardingPageData(
        tl: parseDay(json['tl']),
        daysLeft: _int(json['daysLeft']),
        tasks: [
          for (final row in _maps(json['tasks'])) OffboardingTask.fromJson(row),
        ],
        handover: HandoverChecklist.fromJson(json),
        interview: ExitInterviewState.fromJson(_map(json['interview'])),
        documents: [
          for (final row in _maps(json['documents']))
            LeaverDocument.fromJson(row),
        ],
        managerName: _str(json['managerName']),
        managerPhotoUrl: _str(json['managerPhotoUrl']),
        acceptedAt: parseDay(json['acceptedAt']),
        noticeFrom: parseDay(json['noticeFrom']),
        exitType: _str(json['exitType']),
      );
}

/// "Retirement", "End of contract": how an exit HR started is named.
String exitTypeLabel(String? exitType) => switch (exitType) {
  'resignation' => 'Resignation',
  'retirement' => 'Retirement',
  'end_of_contract' => 'End of contract',
  'termination' => 'Termination',
  'absconding' => 'Absconding',
  _ => 'Exit',
};

/// `GET /lifecycle/manager/leavers/:userId`: the manager's Resignation tab
/// on a report's profile (R8b). Never carries pay.
class LeaverView {
  const LeaverView({
    required this.handover,
    required this.otherSteps,
    this.resignation,
    this.status,
    this.tl,
    this.daysLeft,
    this.acceptedAt,
    this.exitType,
  });

  final ResignationView? resignation;
  final String? status;

  /// The exit's type (`status.exitType`): an exit HR started has no resignation.
  final String? exitType;
  final DateTime? tl;
  final int? daysLeft;
  final DateTime? acceptedAt;
  final HandoverChecklist handover;

  /// The steps others track (Return laptop and ID card): read-only here.
  final List<OffboardingTask> otherSteps;

  /// HR accepted: the notice is running and the checklist can be written.
  bool get onNotice =>
      resignation?.accepted == true ||
      (status != null &&
          !const {'with_manager', 'with_hr', 'withdrawn'}.contains(status));

  static const _handoverKeys = {
    'upload_handover',
    'handover_checklist',
    'mark_handover_done',
    'exit_interview',
    'save_documents',
    'offboarding_page',
    'send_resignation',
    'manager_resignation_action',
    'hr_accept_exit',
  };

  factory LeaverView.fromJson(Map<String, dynamic> json) {
    final resignation = json['resignation'];
    final view = resignation is Map
        ? ResignationView.fromJson(resignation.cast<String, dynamic>())
        : null;
    // The server sends the exit's standing as an object (exit type, when HR
    // accepted, the last day). An exit here is always accepted and under way,
    // HR-started ones (no resignation) too.
    final exit = _map(json['status']);
    final steps = json.containsKey('otherSteps')
        ? [
            for (final row in _maps(json['otherSteps']))
              OffboardingTask.fromJson(row),
          ]
        : [
            for (final row in _maps(json['tasks']))
              if (OffboardingTask.fromJson(row) case final task
                  when !_handoverKeys.contains(task.systemKey) &&
                      task.ownerRole != 'manager' &&
                      task.ownerRole != 'hr' &&
                      !task.gone)
                task,
          ];
    return LeaverView(
      resignation: view,
      status: _str(json['status']) ?? (exit.isEmpty ? null : 'accepted'),
      tl: parseDay(json['tl']) ?? parseDay(exit['tl']) ?? view?.tl,
      daysLeft: _int(json['daysLeft']) ?? _int(exit['daysLeft']) ?? view?.daysLeft,
      acceptedAt:
          parseDay(json['acceptedAt']) ??
          parseDay(exit['acceptedOn']) ??
          view?.hrAcceptedAt,
      handover: HandoverChecklist.fromJson(json),
      otherSteps: steps,
      exitType: _str(exit['exitType']),
    );
  }
}

/// The exit interview's answers (R5). Every one optional.
class ExitInterviewAnswers {
  const ExitInterviewAnswers({
    this.reason,
    this.workingHere,
    this.manager,
    this.comeBack,
    this.change,
  });

  final String? reason;
  final int? workingHere;
  final int? manager;
  final String? comeBack;
  final String? change;

  bool get isEmpty =>
      reason == null &&
      workingHere == null &&
      manager == null &&
      comeBack == null &&
      (change == null || change!.trim().isEmpty);

  Map<String, dynamic> toJson() => {
    'reason': ?reason,
    'workingHere': ?workingHere,
    'manager': ?manager,
    'comeBack': ?comeBack,
    if (change != null && change!.trim().isNotEmpty) 'change': change!.trim(),
  };
}

/// What the account-closed screen (R6) says: the company, the last day, and
/// where to write for documents. Any of them may be unknown.
class AccountClosedInfo {
  const AccountClosedInfo({this.companyName, this.lastDay, this.hrEmail});

  final String? companyName;
  final DateTime? lastDay;
  final String? hrEmail;

  factory AccountClosedInfo.fromJson(Map<String, dynamic> json) {
    final company = json['company'];
    return AccountClosedInfo(
      companyName: company is Map
          ? _str(company['name'])
          : _str(company) ?? _str(json['companyName']),
      lastDay:
          parseDay(json['lastWorkingDay']) ??
          parseDay(json['lastDay']) ??
          parseDay(json['tl']),
      hrEmail: _str(json['hrEmail']),
    );
  }

  Map<String, dynamic> toJson() => {
    if (companyName != null) 'companyName': companyName,
    if (lastDay != null)
      'lastDay':
          '${lastDay!.year.toString().padLeft(4, '0')}-${lastDay!.month.toString().padLeft(2, '0')}-${lastDay!.day.toString().padLeft(2, '0')}',
    if (hrEmail != null) 'hrEmail': hrEmail,
  };
}

/// "Meera" from "Meera Iyer".
String? firstName(String? name) {
  final value = _str(name);
  if (value == null) return null;
  return value.split(RegExp(r'\s+')).first;
}

/// "RM" from "Ravi Menon".
String initialsOf(String? name) {
  final parts = (name ?? '')
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first[0].toUpperCase();
  return (parts.first[0] + parts.last[0]).toUpperCase();
}
