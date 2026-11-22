/// The app's side of the employee lifecycle's onboarding: the joiner's week
/// and probation, and the manager's view of their joiners
/// (docs/lifecycle/CONTRACT.md, "App — joiner and manager"; the shapes are
/// backend/src/models/lifecycle.model.ts).
///
/// Every reader is lenient: a field the server leaves out reads as empty, so
/// an older or newer server never breaks the screens. The few rules the
/// screens apply themselves (the day label, what is up next, where the
/// week-1 reels resume, when the goals lock) are pure functions at the end,
/// used where the server has not said.
library;

// ─── Readers ────────────────────────────────────────────────────────────────

String? _str(Object? value) {
  if (value is! String) return value is num ? '$value' : null;
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

int _int(Object? value, [int fallback = 0]) => switch (value) {
  final int v => v,
  final num v => v.round(),
  final String v => int.tryParse(v) ?? fallback,
  _ => fallback,
};

double? _double(Object? value) => switch (value) {
  final num v => v.toDouble(),
  final String v => double.tryParse(v),
  _ => null,
};

bool _bool(Object? value) => value == true || value == 'true';

Map<String, dynamic> _map(Object? value) =>
    value is Map ? Map<String, dynamic>.from(value) : const <String, dynamic>{};

List<Map<String, dynamic>> _maps(Object? value) => value is List
    ? [for (final item in value) if (item is Map) Map<String, dynamic>.from(item)]
    : const [];

List<String> _strings(Object? value) => value is List
    ? [
        for (final item in value)
          ?_str(item is Map ? item['text'] : item),
      ]
    : const [];

/// An instant (ISO) or a date ('YYYY-MM-DD'), in local time. A bare date is
/// that calendar day at midnight, never shifted by the time zone.
DateTime? parseLifecycleDate(Object? value) {
  final text = _str(value);
  if (text == null) return null;
  final day = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(text);
  if (day != null) {
    return DateTime(
      int.parse(day.group(1)!),
      int.parse(day.group(2)!),
      int.parse(day.group(3)!),
    );
  }
  return DateTime.tryParse(text)?.toLocal();
}

/// A task's due or open day. The server sends a date-only rule as that day's
/// UTC midnight ("2026-12-05T00:00:00.000Z"); read as an instant that would be
/// 5:30 AM in India, so it is read as the calendar day instead and never
/// shows (or sorts) as a clock time. Anything else reads as
/// [parseLifecycleDate] does.
DateTime? parseLifecycleDay(Object? value) {
  final text = _str(value);
  if (text == null) return null;
  final midnight = RegExp(r'^(\d{4})-(\d{2})-(\d{2})T00:00(:00(\.0+)?)?(Z|\+00:00)$').firstMatch(text);
  if (midnight != null) {
    return DateTime(int.parse(midnight.group(1)!), int.parse(midnight.group(2)!), int.parse(midnight.group(3)!));
  }
  return parseLifecycleDate(text);
}

String lifecycleYmd(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-'
    '${date.month.toString().padLeft(2, '0')}-'
    '${date.day.toString().padLeft(2, '0')}';

DateTime dateOnly(DateTime value) => DateTime(value.year, value.month, value.day);

/// Whole calendar days from [from] to [to] (negative when [to] is earlier),
/// counted on dates so a clock change never makes a day 23 hours.
int calendarDaysBetween(DateTime from, DateTime to) {
  final a = DateTime.utc(from.year, from.month, from.day);
  final b = DateTime.utc(to.year, to.month, to.day);
  return b.difference(a).inDays;
}

DateTime addMonths(DateTime date, int months) {
  final monthIndex = date.month - 1 + months;
  final year = date.year + (monthIndex ~/ 12);
  final month = monthIndex % 12 + 1;
  final lastDay = DateTime(year, month + 1, 0).day;
  return DateTime(year, month, date.day > lastDay ? lastDay : date.day);
}

// ─── Plant ──────────────────────────────────────────────────────────────────

/// The joiner's plant: stage 0–5 (seed, sprout, seedling, sapling, bud,
/// bloom), water 0–3 before joining, a leaf per finished group, and droop
/// when something is overdue ("Needs water"; never red).
class PlantState {
  const PlantState({this.stage = 1, this.water = 0, this.leaves = 0, this.droop = false});

  factory PlantState.fromJson(Object? json) {
    final map = _map(json);
    return PlantState(
      stage: _int(map['stage'], 1).clamp(0, 5),
      water: _int(map['water']).clamp(0, 3),
      leaves: _int(map['leaves']).clamp(0, 99),
      droop: _bool(map['droop']),
    );
  }

  final int stage;
  final int water;
  final int leaves;
  final bool droop;

  static const stageNames = ['Seed', 'Sprout', 'Seedling', 'Sapling', 'Bud', 'Bloom'];

  String get stageName => stageNames[stage.clamp(0, 5)];
}

// ─── Stages ─────────────────────────────────────────────────────────────────

/// The joiner's stage after Tj, as the cards name it.
String onboardingStageLabel(String? stage) => switch (stage) {
  'pre_boarding' => 'Pre-boarding',
  'welcome_week1' => 'Welcome stage',
  'settling_in' => 'Settling in',
  'growing_gains' => 'Growing gains',
  'final_month' => 'Final month',
  'ready_to_perform' => 'Ready to perform',
  _ => 'Onboarding',
};

/// The stage after [stage], for "Next stage: …".
String? nextOnboardingStageLabel(String? stage) => switch (stage) {
  'pre_boarding' => 'Welcome stage',
  'welcome_week1' => 'Settling in',
  'settling_in' => 'Growing gains',
  'growing_gains' => 'Final month',
  'final_month' => 'Confirmed',
  _ => null,
};

class JourneyStage {
  const JourneyStage({required this.key, required this.label, required this.state});

  factory JourneyStage.fromJson(Map<String, dynamic> json) => JourneyStage(
    key: _str(json['key']) ?? '',
    label: _str(json['label']) ?? onboardingStageLabel(_str(json['key'])),
    state: _str(json['state']) ?? 'todo',
  );

  final String key;
  final String label;

  /// 'done' | 'current' | 'todo'.
  final String state;

  bool get isDone => state == 'done';
  bool get isCurrent => state == 'current';
}

// ─── /lifecycle/me ──────────────────────────────────────────────────────────

class OnboardingMe {
  const OnboardingMe({
    required this.journeyId,
    this.stage,
    this.dayLabel,
    this.plant = const PlantState(),
    this.tileVisible = false,
    this.progress,
    this.subtitle,
    this.portal = false,
    this.tile,
  });

  factory OnboardingMe.fromJson(Map<String, dynamic> json) => OnboardingMe(
    journeyId: _str(json['journeyId']) ?? '',
    stage: _str(json['stage']),
    dayLabel: _str(json['dayLabel']),
    plant: PlantState.fromJson(json['plant']),
    tileVisible: _bool(json['tileVisible']),
    progress: TaskProgress.maybe(json['progress']),
    subtitle: _str(json['subtitle']),
    portal: _bool(json['portal']),
    tile: OnboardingTile.maybe(json['tile']),
  );

  final String journeyId;
  final String? stage;
  final String? dayLabel;
  final PlantState plant;
  final bool tileVisible;

  /// Not in CONTRACT's `me`; read when a server sends it, else filled from
  /// the onboarding home.
  final TaskProgress? progress;

  /// The Action tile's subtitle as the server words it for the stage ("2 of
  /// 9 steps done" in week 1, "Week 6 · check-in due Fri 9 Jan" after).
  final String? subtitle;

  /// Signed in to the app BEFORE Day 1 with their pre-boarding portal open:
  /// the Action tab is the portal itself (the server says false from the
  /// joining day, IST, and the tab is the usual Actions tab again).
  final bool portal;

  /// Final designs: the Actions tile's words (`onboarding.tile`).
  final OnboardingTile? tile;

  OnboardingMe withProgress(TaskProgress? value) => OnboardingMe(
    journeyId: journeyId,
    stage: stage,
    dayLabel: dayLabel,
    plant: plant,
    tileVisible: tileVisible,
    progress: value ?? progress,
    subtitle: subtitle,
    portal: portal,
    tile: tile,
  );
}

/// Final designs (FINAL-DESIGNS.md §4.2): the joiner's Actions › Onboarding
/// tile as the server words it ("Today is your first day", badge "Day 1").
class OnboardingTile {
  const OnboardingTile({required this.title, required this.subtitle, required this.badge});

  static OnboardingTile? maybe(Object? json) {
    final map = _map(json);
    final subtitle = _str(map['subtitle']);
    if (subtitle == null) return null;
    return OnboardingTile(title: _str(map['title']) ?? 'Onboarding', subtitle: subtitle, badge: _str(map['badge']) ?? '');
  }

  final String title;
  final String subtitle;
  final String badge;
}

/// What `/lifecycle/me` says: whether the lifecycle is on for the company at
/// all, and the person's onboarding and offboarding, when they have them.
class LifecycleMe {
  const LifecycleMe({this.enabled = false, this.onboarding, this.offboarding = const {}, this.staff = const {}});

  factory LifecycleMe.fromJson(Map<String, dynamic> json) {
    final onboarding = _map(json['onboarding']);
    return LifecycleMe(
      enabled: _bool(json['enabled']),
      onboarding: onboarding.isEmpty ? null : OnboardingMe.fromJson(onboarding),
      offboarding: _map(json['offboarding']),
      staff: _map(json['staff']),
    );
  }

  static const off = LifecycleMe();

  final bool enabled;
  final OnboardingMe? onboarding;

  /// Kept as sent; the offboarding screens read it.
  final Map<String, dynamic> offboarding;

  /// HR or IT & admin for someone joining: their Actions › Onboarding tile
  /// (FINAL-DESIGNS.md §4.4 `StaffTile`), kept as sent; staff_api.dart reads it.
  final Map<String, dynamic> staff;

  /// The Action tile and the profile's Onboarding tab.
  bool get showsOnboarding =>
      enabled && onboarding != null && onboarding!.tileVisible && onboarding!.journeyId.isNotEmpty;

  LifecycleMe withProgress(TaskProgress? progress) => LifecycleMe(
    enabled: enabled,
    onboarding: onboarding?.withProgress(progress),
    offboarding: offboarding,
    staff: staff,
  );
}

class TaskProgress {
  const TaskProgress(this.done, this.total);

  static TaskProgress? maybe(Object? json) {
    final map = _map(json);
    if (!map.containsKey('total')) return null;
    final total = _int(map['total']);
    return total <= 0 ? null : TaskProgress(_int(map['done']).clamp(0, total), total);
  }

  final int done;
  final int total;

  String get label => '$done of $total';
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

/// A journey task as a viewer sees it (CONTRACT's TaskView).
class TaskView {
  const TaskView({
    required this.id,
    required this.title,
    this.systemKey,
    this.phase = 'first_week',
    this.helper,
    this.ownerRole = 'employee',
    this.ownerName,
    this.kind = 'ack',
    this.surface = 'app',
    this.mustDo = false,
    this.status = 'todo',
    this.opensAt,
    this.dueAt,
    this.dueLabel,
    this.doneAt,
    this.doneByName,
    this.note,
    this.late = false,
    this.month,
    this.meeting,
    this.meetingId,
    this.progress,
    this.readOnly = false,
    this.doneBy,
    this.canMarkDone,
    this.agenda = const [],
    this.withName,
    this.withUserId,
    this.withPhotoUrl,
    this.canTick,
    this.myNotes = const [],
    this.opens,
  });

  factory TaskView.fromJson(Map<String, dynamic> json) {
    final meeting = _map(json['meeting']);
    List<String> strings(Object? v) => v is List ? [for (final x in v) x is String ? x : ''] : const [];
    return TaskView(
      id: _str(json['id']) ?? '',
      systemKey: _str(json['systemKey']),
      phase: _str(json['phase']) ?? 'first_week',
      title: _str(json['title']) ?? 'Task',
      helper: _str(json['helper']),
      ownerRole: _str(json['ownerRole']) ?? 'employee',
      ownerName: _str(json['ownerName']),
      kind: _str(json['kind']) ?? 'ack',
      surface: _str(json['surface']) ?? 'app',
      mustDo: _bool(json['mustDo']),
      status: _str(json['status']) ?? 'todo',
      opensAt: parseLifecycleDay(json['opensAt']),
      dueAt: parseLifecycleDay(json['dueAt']),
      dueLabel: _str(json['dueLabel']),
      doneAt: parseLifecycleDate(json['doneAt']),
      doneByName: _str(json['doneByName']),
      note: _str(json['note']),
      late: _bool(json['late']),
      month: json['month'] == null ? null : _int(json['month']),
      meeting: meeting.isEmpty ? null : Meeting.fromJson(meeting),
      meetingId: _str(json['meetingId']) ?? _str(meeting['id']),
      progress: TaskProgress.maybe(json['progress']),
      readOnly: _bool(json['readOnly']),
      doneBy: _str(json['doneBy']),
      canMarkDone: json['canMarkDone'] is bool ? json['canMarkDone'] as bool : null,
      agenda: strings(json['agenda']).where((a) => a.isNotEmpty).toList(),
      withName: _str(json['withName']),
      withUserId: _str(json['withUserId']),
      withPhotoUrl: _str(json['withPhotoUrl']),
      canTick: json['canTick'] is bool ? json['canTick'] as bool : null,
      myNotes: strings(json['myNotes']),
      opens: _str(json['opens']),
    );
  }

  final String id;
  final String? systemKey;
  final String phase;
  final String title;
  final String? helper;
  final String ownerRole;
  final String? ownerName;
  final String kind;
  final String surface;
  final bool mustDo;

  /// locked | todo | in_review | sent_back | done | skipped | cancelled.
  final String status;
  final DateTime? opensAt;
  final DateTime? dueAt;
  final String? dueLabel;
  final DateTime? doneAt;
  final String? doneByName;
  final String? note;
  final bool late;
  final int? month;

  /// Up next carries its meeting; other rows may carry its id.
  final Meeting? meeting;
  final String? meetingId;

  /// "2 of 4" on a group row, when the server counts one.
  final TaskProgress? progress;

  /// Someone else does it (HR, IT, the manager): shown on the joiner's day,
  /// counted toward it, never ticked by them. [doneBy] says who ("HR").
  final bool readOnly;
  final String? doneBy;

  /// M2: whether the manager may tick it there. HR's decision tasks never.
  /// Null from an older server; [managerMayTick] then decides.
  final bool? canMarkDone;

  /// A meeting row (the joiner's Meetings): the template's agenda, who it is
  /// with, whether the joiner may mark it met (null: not a meeting row), and
  /// their own notes, one per agenda point.
  final List<String> agenda;
  final String? withName;
  final String? withUserId;
  final String? withPhotoUrl;
  final bool? canTick;
  final List<String> myNotes;

  /// A row that opens a screen of its own ('policies': Acknowledge policies).
  final String? opens;

  bool get isDone => status == 'done' || status == 'skipped';
  bool get isLocked => status == 'locked';
  bool get isOpen => status == 'todo' || status == 'sent_back';
  bool get isClosed => isDone || status == 'cancelled';

  /// The joiner does it (alone or with the manager).
  bool get forEmployee => !readOnly && (ownerRole == 'employee' || ownerRole == 'manager_employee');

  /// The manager does it (alone or with the joiner).
  bool get forManager =>
      ownerRole == 'manager' || ownerRole == 'manager_employee' || ownerRole == 'hr_manager';

  /// When a timed item (a meeting) starts: the meeting's own time (a moved
  /// one's new time), else a meeting task's due time when it has a real
  /// clock time. A date-only due day is never a time.
  DateTime? get startsAt {
    final fromMeeting = meeting?.newTime ?? meeting?.startsAt;
    if (fromMeeting != null) return fromMeeting;
    final due = dueAt;
    if (kind == 'meeting' && due != null && (due.hour != 0 || due.minute != 0)) return due;
    return null;
  }

  bool get isTimed => startsAt != null;
}

/// Whether the manager can tick [task] on M2: the server's word, else theirs
/// (alone or with the joiner), open, and not done on a screen of its own.
/// HR's tasks — the Confirmation discussion — never.
bool managerMayTick(TaskView task) {
  final said = task.canMarkDone;
  if (said != null) return said;
  if (task.ownerRole != 'manager' && task.ownerRole != 'manager_employee') return false;
  const ownScreens = {
    'starter_task', 'one_on_one_notes', 'probation_goals', 'monthly_goals', 'monthly_checkin',
    'monthly_review', 'manager_setup', 'assign_buddy',
  };
  return task.isOpen && !ownScreens.contains(task.systemKey);
}

TaskView _withMeeting(TaskView task, Meeting? meeting) => meeting == null
    ? task
    : TaskView(
        id: task.id,
        title: task.title,
        systemKey: task.systemKey,
        phase: task.phase,
        helper: task.helper,
        ownerRole: task.ownerRole,
        ownerName: task.ownerName,
        kind: task.kind,
        surface: task.surface,
        mustDo: task.mustDo,
        status: task.status,
        opensAt: task.opensAt,
        dueAt: task.dueAt,
        dueLabel: task.dueLabel,
        doneAt: task.doneAt,
        doneByName: task.doneByName,
        note: task.note,
        late: task.late,
        month: task.month,
        meeting: meeting,
        meetingId: task.meetingId ?? meeting.id,
        progress: task.progress,
        readOnly: task.readOnly,
        doneBy: task.doneBy,
        canMarkDone: task.canMarkDone,
      );

// ─── Onboarding home ────────────────────────────────────────────────────────

class OnboardingHome {
  const OnboardingHome({
    required this.journeyId,
    this.stage,
    this.dayLabel,
    this.tj,
    this.plant = const PlantState(),
    this.upNext,
    this.today = const [],
    this.later = const [],
    this.done = const [],
    this.journey = const [],
    this.managerName,
    this.serverProgress,
    this.showWeekDone = false,
    this.weekDoneStats,
    this.firstPunch,
    this.day1,
    this.tourDone = const [],
    this.tourForManager = false,
    this.policyCounts,
    this.devices = const [],
    this.watch = const [],
    this.companyName,
    this.profile,
  });

  factory OnboardingHome.fromJson(Map<String, dynamic> json) {
    final upNext = _map(json['upNext']);
    final meeting = _map(upNext['meeting']);
    final stats = _map(json['weekDoneStats']);
    final firstPunch = _map(json['firstPunch']);
    final day1 = _map(json['day1']);
    return OnboardingHome(
      journeyId: _str(json['journeyId']) ?? '',
      stage: _str(json['stage']),
      dayLabel: _str(json['dayLabel']),
      tj: parseLifecycleDate(json['tj']),
      plant: PlantState.fromJson(json['plant']),
      upNext: upNext.isEmpty
          ? null
          : _withMeeting(
              TaskView.fromJson(upNext),
              meeting.isEmpty ? null : Meeting.fromJson(meeting),
            ),
      today: _maps(json['today']).map(TaskView.fromJson).toList(),
      later: _maps(json['later']).map(TaskView.fromJson).toList(),
      done: _maps(json['done']).map(TaskView.fromJson).toList(),
      journey: _maps(json['journey']).map(JourneyStage.fromJson).toList(),
      managerName: _str(json['managerName']),
      serverProgress: TaskProgress.maybe(json['progress']),
      showWeekDone: _bool(json['showWeekDone']),
      weekDoneStats: stats.isEmpty
          ? null
          : (tasksDone: _int(stats['tasksDone']), peopleMet: _int(stats['peopleMet']), leaves: _int(stats['leaves'])),
      firstPunch: firstPunch.isEmpty
          ? null
          : FirstPunch(at: parseLifecycleDate(firstPunch['at']), faceEnrolled: _bool(firstPunch['faceEnrolled'])),
      day1: day1.isEmpty
          ? null
          : Day1Summary(peopleMet: _int(day1['peopleMet']), thingsDone: _int(day1['thingsDone']), feeling: _str(day1['feeling'])),
      tourDone: [
        for (final k in (_map(json['tour'])['done'] as List?) ?? const [])
          if (k is String && k.isNotEmpty) k,
      ],
      tourForManager: ((_map(json['tour'])['managerLessons'] as List?) ?? const []).isNotEmpty,
      policyCounts: _map(json['policies']).isEmpty
          ? null
          : (
              required: _int(_map(json['policies'])['required']),
              acknowledged: _int(_map(json['policies'])['acknowledged']),
              toAcknowledge: _int(_map(json['policies'])['toAcknowledge']),
            ),
      devices: _maps(json['devices']).map(OnbDevice.fromJson).where((d) => d.title.isNotEmpty).toList(),
      watch: _maps(json['watch']).map(OnbVideo.fromJson).where((v) => v.url.isNotEmpty).toList(),
      companyName: _str(json['companyName']),
      profile: _map(json['profile']).isEmpty ? null : OnbProfileState.fromJson(_map(json['profile'])),
    );
  }

  /// Day 1's first punch-in: when it happened (null until it has) and whether
  /// a face is on record. Null from a server that does not send it.
  final FirstPunch? firstPunch;

  /// "Day 1, done!": the server's counts and the joiner's "How was today?".
  /// Null from a server that does not send it.
  final Day1Summary? day1;

  /// "Your first punch-in" shows on Day 1 until the first punch-in, as the
  /// server's [firstPunch] says; a server without it keeps the old list.
  bool needsFirstPunchOn(DateTime now) => dayLabelOn(now) == 'Day 1' && firstPunch != null && firstPunch!.at == null;

  final String journeyId;
  final String? stage;
  final String? dayLabel;
  final DateTime? tj;
  final PlantState plant;
  final TaskView? upNext;
  final List<TaskView> today;
  final List<TaskView> later;
  final List<TaskView> done;
  final List<JourneyStage> journey;

  /// Not in CONTRACT; read when the server sends it ("Starter task from …").
  final String? managerName;

  /// The server's count of the stretch's steps — the same one the Action
  /// tile shows — when it sends one.
  final TaskProgress? serverProgress;

  /// "Week 1, done!" (A8) is due: the server's flag, so it shows once on
  /// whichever device opens first, and never again once seen.
  final bool showWeekDone;
  final ({int tasksDone, int peopleMet, int leaves})? weekDoneStats;

  /// The Sowaka tour's lessons finished (`tour.done`: punch, missed, …).
  final List<String> tourDone;

  /// The joiner manages anyone (the server sends `tour.managerLessons`): the
  /// tour also has "For managers".
  final bool tourForManager;

  /// The server's policy counts (the same as `GET /policies`): onboarding's
  /// "Acknowledge policies · n of N done"; null from an older server.
  final ({int required, int acknowledged, int toAcknowledge})? policyCounts;

  /// "Devices and accesses": what IT and HR set up, ready or not.
  final List<OnbDevice> devices;

  /// "Watch list": the Meet us videos the portal plays (the manager's video
  /// hello, the company video), as the server sends them.
  final List<OnbVideo> watch;

  /// The company's name ("About `company`").
  final String? companyName;

  /// "Your profile": the portal's Employee profile sections and their state.
  final OnbProfileState? profile;

  List<TaskView> get all => [...today, ...later, ...done];

  /// Steps done of everything the joiner has in this stretch: the server's
  /// count (one source for the tile, the home and the profile card), else
  /// counted here.
  TaskProgress get progress {
    final server = serverProgress;
    if (server != null) return server;
    final total = today.length + done.length;
    return TaskProgress(done.length, total == 0 ? 1 : total);
  }

  /// The label the server gave, or the rule's own.
  String dayLabelOn(DateTime now) =>
      dayLabel ?? (tj == null ? 'Onboarding' : onboardingDayLabel(tj: tj!, today: now));
}

/// `day1` on the onboarding home: people met and things done (the same
/// count as the tile's "steps done"), and `feeling` (great, okay, tough)
/// once answered.
class Day1Summary {
  const Day1Summary({this.peopleMet = 0, this.thingsDone = 0, this.feeling});

  final int peopleMet;
  final int thingsDone;
  final String? feeling;
}

/// `firstPunch` on the onboarding home.
class FirstPunch {
  const FirstPunch({this.at, this.faceEnrolled = false});

  final DateTime? at;
  final bool faceEnrolled;
}

/// One of "Devices and accesses": the laptop, the work email, this app.
class OnbDevice {
  const OnbDevice({required this.key, required this.title, this.ready = false});

  factory OnbDevice.fromJson(Map<String, dynamic> json) =>
      OnbDevice(key: _str(json['key']) ?? '', title: _str(json['title']) ?? '', ready: _bool(json['ready']));

  /// laptop, email, app, or any other.
  final String key;
  final String title;
  final bool ready;
}

/// One of the Watch list's videos (the portal's Meet us video).
class OnbVideo {
  const OnbVideo({required this.id, required this.title, required this.url, this.seen = false});

  factory OnbVideo.fromJson(Map<String, dynamic> json) => OnbVideo(
    id: _str(json['id']) ?? '',
    title: _str(json['title']) ?? '',
    url: _str(json['videoUrl']) ?? '',
    seen: _bool(json['seen']),
  );

  final String id;
  final String title;

  /// The portal's link: a signed `/portal/media/…` path or the company's URL.
  final String url;
  final bool seen;
}

/// The portal's Employee profile as the app shows it: each section done or
/// not, and the count ("n of 7 sections done"), the server's.
class OnbProfileState {
  const OnbProfileState({this.sections = const [], this.done = 0, this.total = 0});

  factory OnbProfileState.fromJson(Map<String, dynamic> json) {
    final sections = [
      for (final s in _maps(json['sections']))
        (key: _str(s['key']) ?? '', title: _str(s['title']) ?? '', done: _bool(s['done'])),
    ];
    return OnbProfileState(
      sections: sections,
      done: _int(json['done'], sections.where((s) => s.done).length),
      total: _int(json['total'], sections.length),
    );
  }

  final List<({String key, String title, bool done})> sections;
  final int done;
  final int total;

  /// The portal's percent: round(done / total × 100).
  int get percent => total == 0 ? 0 : (done * 100 / total).round();
}

// ─── Meetings ───────────────────────────────────────────────────────────────

class MeetingPerson {
  const MeetingPerson({required this.userId, required this.name, this.designation, this.photoUrl, this.role});

  factory MeetingPerson.fromJson(Map<String, dynamic> json) => MeetingPerson(
    userId: _str(json['userId']) ?? _str(json['id']) ?? '',
    name: _str(json['name']) ?? '',
    designation: _str(json['designation']),
    photoUrl: _str(json['photoUrl']),
    role: _str(json['role']),
  );

  final String userId;
  final String name;
  final String? designation;
  final String? photoUrl;

  /// "your manager", "your buddy", when the server says.
  final String? role;
}

class Meeting {
  const Meeting({
    required this.id,
    required this.title,
    this.startsAt,
    this.endsAt,
    this.place,
    this.link,
    this.attendees = const [],
    this.met,
    this.newTime,
    this.expect = const [],
    this.mustDo = false,
    this.systemKey,
    this.withWho,
    this.canConfirm = true,
  });

  factory Meeting.fromJson(Map<String, dynamic> json) => Meeting(
    id: _str(json['id']) ?? '',
    title: _str(json['title']) ?? 'Meeting',
    startsAt: parseLifecycleDate(json['startsAt']),
    endsAt: parseLifecycleDate(json['endsAt']),
    place: _str(json['place']),
    link: _str(json['link']),
    attendees: _maps(json['attendees']).map(MeetingPerson.fromJson).toList(),
    met: _str(json['met']),
    newTime: parseLifecycleDate(json['newTime']),
    expect: _strings(json['expect']),
    mustDo: _bool(json['mustDo']),
    systemKey: _str(json['systemKey']),
    withWho: _str(json['with']),
    canConfirm: json['canConfirm'] != false,
  );

  final String id;
  final String title;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final String? place;
  final String? link;

  /// Not in CONTRACT's Meeting (it has attendeeUserIds only); read when sent.
  final List<MeetingPerson> attendees;

  /// 'yes' | 'moved'.
  final String? met;
  final DateTime? newTime;
  final List<String> expect;
  final bool mustDo;
  final String? systemKey;

  /// Who it is with, as the Day-1 agenda names them ("Neha R.").
  final String? withWho;

  /// Whether the joiner answers "Did you meet?": false for the ones HR
  /// ticks (induction, the batch session).
  final bool canConfirm;
}

/// A person's part in a meeting, as the screens say it: "your manager",
/// "your buddy"; nothing for a colleague.
String? meetingRoleLabel(String? role) => switch (role) {
  'manager' => 'your manager',
  'buddy' => 'your buddy',
  'your manager' || 'your buddy' => role,
  _ => null,
};

// ─── Week-1 reels ───────────────────────────────────────────────────────────

enum Week1Step {
  policies('policies'),
  tax('tax'),
  bankPf('bank_pf'),
  goals('goals');

  const Week1Step(this.key);
  final String key;
}

class PolicyItem {
  const PolicyItem({
    required this.id,
    required this.title,
    required this.version,
    this.url,
    this.readMinutes,
    this.summary,
    this.body,
    this.updatedOn,
  });

  factory PolicyItem.fromJson(Map<String, dynamic> json) => PolicyItem(
    id: _str(json['id']) ?? '',
    title: _str(json['title']) ?? 'Policy',
    version: _str(json['version']) ?? '1',
    url: _str(json['url']),
    readMinutes: json['readMinutes'] == null ? null : _int(json['readMinutes']),
    summary: _str(json['summary']),
    body: _str(json['body']),
    updatedOn: parseLifecycleDate(json['updatedOn']),
  );

  final String id;
  final String title;

  /// What the acknowledgement stores (the server's version stamp); never
  /// shown as it is.
  final String version;
  final String? url;
  final int? readMinutes;
  final String? summary;

  /// The policy's text, read in the app.
  final String? body;
  final DateTime? updatedOn;
}

class Week1Data {
  const Week1Data({
    this.policies = const [],
    this.policiesAckAt,
    this.taxRegime,
    this.bankPfConfirmedAt,
    this.bankChangeRequested = false,
    this.goalsReadAt,
    this.bankMasked,
    this.bankName,
    this.ifsc,
    this.uan,
    this.goals = const [],
    this.managerName,
    this.probationMonths,
    this.goalsLockOn,
    this.managerUserId,
  });

  factory Week1Data.fromJson(Map<String, dynamic> json) {
    final policies = _map(json['policies'] is Map ? json['policies'] : null);
    final policyList = json['policyList'] ?? (json['policies'] is List ? json['policies'] : null);
    final tax = _map(json['taxRegime']);
    final bankPf = _map(json['bankPf']);
    final bank = _map(json['bank']);
    final pf = _map(json['pf']);
    // CONTRACT puts two things under `policies`: Week1Reels' acknowledgement
    // (an object) and the list to read (an array). The list wins the name;
    // the acknowledgement is read from `policiesAck` / `policiesAckAt`, or
    // `steps.policies`, whichever the server sends.
    final steps = _map(json['steps']);
    final stepDone = DateTime.fromMillisecondsSinceEpoch(0);
    return Week1Data(
      policies: _maps(policyList).map(PolicyItem.fromJson).toList(),
      policiesAckAt: parseLifecycleDate(policies['at']) ??
          parseLifecycleDate(_map(json['policiesAck'])['at']) ??
          parseLifecycleDate(json['policiesAckAt']) ??
          (_bool(steps['policies']) ? stepDone : null),
      taxRegime: _str(tax['regime']) ?? (json['taxRegime'] is String ? _str(json['taxRegime']) : null),
      bankPfConfirmedAt: parseLifecycleDate(bankPf['confirmedAt']) ??
          (_bool(steps['bank_pf']) ? stepDone : null),
      bankChangeRequested: _bool(bankPf['changeRequested']),
      goalsReadAt: parseLifecycleDate(json['goalsReadAt']) ?? (_bool(steps['goals']) ? stepDone : null),
      bankMasked: _str(bank['masked']),
      bankName: _str(bank['name']) ?? _str(bank['bankName']),
      ifsc: _str(bank['ifsc']),
      uan: _str(pf['uan']),
      goals: _strings(json['goals']),
      managerName: _str(json['managerName']),
      probationMonths: json['probationMonths'] == null ? null : _int(json['probationMonths']),
      goalsLockOn: parseLifecycleDate(json['goalsLockOn']),
      managerUserId: _str(json['managerUserId']),
    );
  }

  final List<PolicyItem> policies;
  final DateTime? policiesAckAt;

  /// 'new' | 'old', once chosen.
  final String? taxRegime;
  final DateTime? bankPfConfirmedAt;
  final bool bankChangeRequested;
  final DateTime? goalsReadAt;
  final String? bankMasked;
  final String? bankName;
  final String? ifsc;
  final String? uan;
  final List<String> goals;

  // Not in CONTRACT's week1 shape; read when sent.
  final String? managerName;
  final int? probationMonths;
  final DateTime? goalsLockOn;
  final String? managerUserId;

  bool isDone(Week1Step step) => switch (step) {
    Week1Step.policies => policiesAckAt != null,
    Week1Step.tax => taxRegime != null,
    Week1Step.bankPf => bankPfConfirmedAt != null || bankChangeRequested,
    Week1Step.goals => goalsReadAt != null,
  };

  int get doneCount => Week1Step.values.where(isDone).length;

  /// Where the reels pick up: the first step not saved; null when all four are.
  Week1Step? get resumeAt => firstUnfinishedWeek1Step(this);
}

/// The first reel not yet saved, in reel order; null when all are.
Week1Step? firstUnfinishedWeek1Step(Week1Data data) {
  for (final step in Week1Step.values) {
    if (!data.isDone(step)) return step;
  }
  return null;
}

// ─── Intro post ─────────────────────────────────────────────────────────────

class IntroPost {
  const IntroPost({
    this.photoKey,
    this.line = '',
    this.funFacts = const [],
    this.postedAt,
    this.connectPostId,
    this.likes,
    this.commentCount,
    this.comments = const [],
  });

  factory IntroPost.fromJson(Map<String, dynamic> json) {
    final intro = json['intro'] is Map ? _map(json['intro']) : json;
    return IntroPost(
      photoKey: _str(intro['photoKey']) ?? _str(intro['photoUrl']),
      line: _str(intro['line']) ?? '',
      funFacts: _strings(intro['funFacts']),
      postedAt: parseLifecycleDate(intro['postedAt']),
      connectPostId: _str(intro['connectPostId']) ?? _str(json['connectPostId']),
      likes: json['likes'] == null ? null : _int(json['likes']),
      commentCount: json['commentCount'] == null ? null : _int(json['commentCount']),
      comments: [
        for (final c in _maps(json['comments']))
          (name: _str(c['name']) ?? '', text: _str(c['text']) ?? '', at: parseLifecycleDate(c['at']), photoUrl: _str(c['photoUrl'])),
      ],
    );
  }

  /// The bubble, word for word as Connect will post it: the line gets a full
  /// stop unless it already ends a sentence (or an emoji).
  static String messageFor(String line) {
    final said = line.trim();
    // Ends a sentence: punctuation, or an emoji (any symbol past the BMP's letters).
    final last = said.isEmpty ? 0 : said.runes.last;
    final ends = RegExp(r'[.!?…)]$').hasMatch(said) || last >= 0x2190;
    return 'Hey everyone! $said${ends ? '' : '.'} Excited to meet you all 🙌';
  }

  static const maxLine = 80;
  static const maxFacts = 3;

  final String? photoKey;
  final String line;
  final List<String> funFacts;
  final DateTime? postedAt;
  final String? connectPostId;

  /// Once posted: how it is doing on Connect.
  final int? likes;
  final int? commentCount;
  /// The latest comments, each with the commenter's face (null for no photo).
  final List<({String name, String text, DateTime? at, String? photoUrl})> comments;

  bool get posted => postedAt != null;

  Map<String, dynamic> toJson() => {
    if (photoKey != null) 'photoKey': photoKey,
    'line': line.length > maxLine ? line.substring(0, maxLine) : line,
    'funFacts': funFacts.take(maxFacts).toList(),
  };
}

// ─── People to meet ─────────────────────────────────────────────────────────

class PersonToMeet {
  const PersonToMeet({
    required this.id,
    required this.userId,
    required this.name,
    this.designation,
    this.photoUrl,
    this.why,
    this.metAt,
    this.role,
  });

  factory PersonToMeet.fromJson(Map<String, dynamic> json) => PersonToMeet(
    id: _str(json['id']) ?? '',
    userId: _str(json['userId']) ?? '',
    name: _str(json['name']) ?? '',
    designation: _str(json['designation']),
    photoUrl: _str(json['photoUrl']),
    why: _str(json['why']),
    metAt: parseLifecycleDate(json['metAt']),
    role: _str(json['role']),
  );

  final String id;
  final String userId;
  final String name;
  final String? designation;
  final String? photoUrl;
  final String? why;
  final DateTime? metAt;
  final String? role;

  bool get met => metAt != null;
}

/// A6 as the server sends it: the people, the day to meet them by, and
/// whether it closed at the end of month 1 (the unmet stay, as "Not met").
class PeopleToMeetView {
  const PeopleToMeetView({this.people = const [], this.meetBy, this.closed = false, this.managerName});

  factory PeopleToMeetView.fromJson(Map<String, dynamic> json) => PeopleToMeetView(
    people: _maps(json['people']).map(PersonToMeet.fromJson).toList(),
    meetBy: parseLifecycleDate(json['meetBy']),
    closed: _bool(json['closed']),
    managerName: _str(json['managerName']),
  );

  final List<PersonToMeet> people;
  final DateTime? meetBy;
  final bool closed;
  final String? managerName;
}

// ─── Starter tasks, notes ───────────────────────────────────────────────────

class StarterTask {
  const StarterTask({
    required this.id,
    required this.title,
    this.journeyId,
    this.links = const [],
    this.note,
    this.dueAt,
    this.assignedAt,
    this.assignedByName,
    this.assignedByDesignation,
    this.assignedByUserId,
    this.assignedByPhotoUrl,
    this.doneAt,
    this.doneNote,
    this.managerReply,
  });

  factory StarterTask.fromJson(Map<String, dynamic> json) => StarterTask(
    id: _str(json['id']) ?? '',
    title: _str(json['title']) ?? 'Starter task',
    journeyId: _str(json['journeyId']),
    links: _strings(json['links']),
    note: _str(json['note']),
    dueAt: parseLifecycleDay(json['dueAt']),
    assignedAt: parseLifecycleDate(json['assignedAt']),
    assignedByName: _str(json['assignedByName']),
    assignedByDesignation: _str(json['assignedByDesignation']),
    assignedByUserId: _str(json['assignedByUserId']),
    assignedByPhotoUrl: _str(json['assignedByPhotoUrl']),
    doneAt: parseLifecycleDate(json['doneAt']),
    doneNote: _str(json['doneNote']),
    managerReply: _str(json['managerReply']),
  );

  final String id;
  final String title;
  final String? journeyId;
  final List<String> links;
  final String? note;
  final DateTime? dueAt;
  final DateTime? assignedAt;

  /// Not in CONTRACT's StarterTask (it has assignedByUserId); read when sent.
  final String? assignedByName;
  final String? assignedByDesignation;
  final String? assignedByUserId;

  /// Their face beside "From your manager"; null for no photo.
  final String? assignedByPhotoUrl;
  final DateTime? doneAt;
  final String? doneNote;
  final String? managerReply;

  bool get done => doneAt != null;
}

class NoteReply {
  const NoteReply({required this.text, this.at, this.byName, this.mine = false});

  factory NoteReply.fromJson(Map<String, dynamic> json, String? viewerId) => NoteReply(
    text: _str(json['text']) ?? '',
    at: parseLifecycleDate(json['at']),
    byName: _str(json['byName']),
    mine: viewerId != null && _str(json['byUserId']) == viewerId,
  );

  final String text;
  final DateTime? at;
  final String? byName;
  final bool mine;
}

class OneOnOneNote {
  const OneOnOneNote({
    required this.id,
    required this.text,
    this.shared = false,
    this.sharedAt,
    this.seenAt,
    this.createdAt,
    this.authorName,
    this.authorPhotoUrl,
    this.replies = const [],
  });

  factory OneOnOneNote.fromJson(Map<String, dynamic> json, {String? viewerId}) => OneOnOneNote(
    id: _str(json['id']) ?? '',
    text: _str(json['text']) ?? '',
    shared: _bool(json['shared']),
    sharedAt: parseLifecycleDate(json['sharedAt']),
    seenAt: parseLifecycleDate(json['seenAt']),
    createdAt: parseLifecycleDate(json['createdAt']),
    authorName: _str(json['authorName']),
    authorPhotoUrl: _str(json['authorPhotoUrl']),
    replies: [for (final reply in _maps(json['replies'])) NoteReply.fromJson(reply, viewerId)],
  );

  final String id;
  final String text;
  final bool shared;
  final DateTime? sharedAt;
  final DateTime? seenAt;
  final DateTime? createdAt;

  /// Not in CONTRACT's OneOnOneNote (authorUserId only); read when sent.
  final String? authorName;

  /// The author's face on the note; null for no photo.
  final String? authorPhotoUrl;
  final List<NoteReply> replies;

  bool get seen => seenAt != null;
}

// ─── Survey ─────────────────────────────────────────────────────────────────

class SurveyState {
  const SurveyState({this.kind = 'day7', this.open = false, this.sent = false, this.opensAt});

  factory SurveyState.fromJson(Map<String, dynamic> json) => SurveyState(
    kind: _str(json['kind']) ?? 'day7',
    open: _bool(json['open']),
    sent: _bool(json['sent']),
    opensAt: parseLifecycleDate(json['opensAt']),
  );

  /// day7 | m3 | m6.
  final String kind;
  final bool open;
  final bool sent;
  final DateTime? opensAt;

  String get title => switch (kind) {
    'm3' => 'Your first 3 months',
    'm6' => 'Your first 6 months',
    _ => 'Your first week',
  };

  String get periodWord => switch (kind) {
    'm3' => 'these 3 months',
    'm6' => 'these 6 months',
    _ => 'your first week',
  };
}

/// The four answers (Day-7, M3 and M6 alike): q1 and q3 emoji 1–5, q2
/// yes | mostly | no, q4 optional text.
class SurveyAnswers {
  SurveyAnswers({this.q1, this.q2, this.q3, this.q4 = ''});

  int? q1;
  String? q2;
  int? q3;
  String q4;

  bool answered(int question) => switch (question) {
    0 => q1 != null,
    1 => q2 != null,
    2 => q3 != null,
    _ => true,
  };

  Map<String, dynamic> toJson() => {
    'q1': q1,
    'q2': q2,
    'q3': q3,
    'q4': q4.trim().isEmpty ? null : q4.trim(),
  };
}

// ─── Probation ──────────────────────────────────────────────────────────────

class CheckinEntry {
  const CheckinEntry({required this.text, this.rating, this.at, this.goalRatings = const [], this.win, this.ask});

  static CheckinEntry? maybe(Object? json) {
    final map = _map(json);
    final text = _str(map['text']);
    final goals = map['goalRatings'] is List ? [for (final r in map['goalRatings'] as List) _int(r)] : const <int>[];
    if (text == null && map['rating'] == null && goals.isEmpty) return null;
    return CheckinEntry(
      text: text ?? '',
      rating: map['rating'] == null ? null : _int(map['rating']),
      at: parseLifecycleDate(map['at']),
      goalRatings: goals,
      win: _str(map['win']),
      ask: _str(map['ask']),
    );
  }

  final String text;
  final int? rating;
  final DateTime? at;

  /// 1–5 per goal, in goal order (0 = not rated).
  final List<int> goalRatings;

  /// The joiner's side: one win, and what would help ("She asked").
  final String? win;
  final String? ask;

  int? ratingFor(int goal) => goal < goalRatings.length && goalRatings[goal] > 0 ? goalRatings[goal] : null;
}

class ProbationMonth {
  const ProbationMonth({
    required this.monthNo,
    this.id = '',
    this.goals = const [],
    this.goalsSetAt,
    this.lockedAt,
    this.checkinEmployee,
    this.checkinManager,
    this.review,
    this.reviewAt,
    this.reviewFeedback = const [],
    this.askAck = false,
    this.sentBackAt,
  });

  factory ProbationMonth.fromJson(Map<String, dynamic> json) {
    final review = _map(json['review']);
    return ProbationMonth(
      id: _str(json['id']) ?? '',
      monthNo: _int(json['monthNo'] ?? json['month'], 1),
      goals: _strings(json['goals']),
      goalsSetAt: parseLifecycleDate(json['goalsSetAt']),
      lockedAt: parseLifecycleDate(json['lockedAt']),
      checkinEmployee: CheckinEntry.maybe(json['checkinEmployee']),
      checkinManager: CheckinEntry.maybe(json['checkinManager']),
      review: _str(review['text']),
      reviewAt: parseLifecycleDate(review['at']),
      reviewFeedback: _strings(review['feedback']),
      askAck: _bool(review['askAck']),
      sentBackAt: parseLifecycleDate(_map(json['sentBack'])['at']),
    );
  }

  final String id;
  final int monthNo;
  final List<String> goals;
  final DateTime? goalsSetAt;
  final DateTime? lockedAt;
  final CheckinEntry? checkinEmployee;
  final CheckinEntry? checkinManager;
  final String? review;
  final DateTime? reviewAt;

  /// One-tap feedback chips on the review, and "On it" for the ask.
  final List<String> reviewFeedback;
  final bool askAck;

  /// When the manager sent the joiner's self check-in back to send again (team side).
  final DateTime? sentBackAt;

  bool get reviewed => reviewAt != null || review != null || reviewFeedback.isNotEmpty;

  bool get bothCheckedIn => checkinEmployee != null && checkinManager != null;
}

class ProbationView {
  const ProbationView({this.months = const [], this.totalMonths, this.currentMonth, this.managerName});

  factory ProbationView.fromJson(Map<String, dynamic> json) {
    final months = _maps(json['months']).map(ProbationMonth.fromJson).toList()
      ..sort((a, b) => a.monthNo.compareTo(b.monthNo));
    return ProbationView(
      months: months,
      totalMonths: json['totalMonths'] == null && json['probationMonths'] == null
          ? null
          : _int(json['totalMonths'] ?? json['probationMonths']),
      currentMonth: json['currentMonth'] == null ? null : _int(json['currentMonth']),
      managerName: _str(json['managerName']),
    );
  }

  final List<ProbationMonth> months;
  final int? totalMonths;
  final int? currentMonth;
  final String? managerName;

  /// The month being worked on: the server's, else the last with goals, else
  /// the first.
  ProbationMonth? get current {
    if (months.isEmpty) return null;
    final number = currentMonth;
    if (number != null) {
      for (final month in months) {
        if (month.monthNo == number) return month;
      }
    }
    return months.lastWhere((m) => m.goals.isNotEmpty, orElse: () => months.first);
  }
}

class RevealView {
  const RevealView({
    this.outcome,
    this.letterUrl,
    this.designation,
    this.reportsTo,
    this.extendMonths,
    this.seen = false,
    this.salary,
    this.kpiName,
    this.kpis = const [],
  });

  factory RevealView.fromJson(Map<String, dynamic> json) {
    final kpis = _map(json['kpis']);
    return RevealView(
      outcome: _str(json['outcome']),
      letterUrl: _str(json['letterUrl']),
      designation: _str(json['designation']),
      reportsTo: _str(json['reportsTo']) ?? _str(json['reportingToName']),
      extendMonths: json['extendMonths'] == null ? null : _int(json['extendMonths']),
      seen: _bool(json['seen']) || json['revealedAt'] != null,
      salary: _double(json['salary']),
      kpiName: _str(kpis['name']),
      kpis: _strings(kpis['items']),
    );
  }

  /// confirm | extend | not_confirm.
  final String? outcome;
  final String? letterUrl;
  final String? designation;
  final String? reportsTo;
  final int? extendMonths;
  final bool seen;

  /// Their own new yearly CTC (3Rb A5 "NEW CTC"): the server sends it to the
  /// joiner only, never to the manager.
  final double? salary;
  final String? kpiName;
  final List<String> kpis;
}

/// ₹14,50,000 the Indian way.
String formatRupees(double amount) {
  final whole = amount.round().toString();
  if (whole.length <= 3) return '₹$whole';
  final last3 = whole.substring(whole.length - 3);
  var rest = whole.substring(0, whole.length - 3);
  final groups = <String>[];
  while (rest.length > 2) {
    groups.insert(0, rest.substring(rest.length - 2));
    rest = rest.substring(0, rest.length - 2);
  }
  if (rest.isNotEmpty) groups.insert(0, rest);
  return '₹${groups.join(',')},$last3';
}

// ─── Manager ────────────────────────────────────────────────────────────────

class JoinerSummary {
  const JoinerSummary({
    required this.journeyId,
    required this.name,
    this.userId,
    this.photoUrl,
    this.designation,
    this.dayLabel,
    this.stage,
    this.plant = const PlantState(),
    this.todayCount = 0,
    this.overdue = 0,
    this.preboarding = false,
    this.tj,
    this.goalsLocked,
    this.probationMonths,
    this.nextEvent,
  });

  factory JoinerSummary.fromJson(Map<String, dynamic> json) => JoinerSummary(
    journeyId: _str(json['journeyId']) ?? _str(json['id']) ?? '',
    name: _str(json['name']) ?? 'New joiner',
    userId: _str(json['userId']),
    photoUrl: _str(json['photoUrl']),
    designation: _str(json['designation']),
    dayLabel: _str(json['dayLabel']),
    stage: _str(json['stage']),
    plant: PlantState.fromJson(json['plant']),
    todayCount: _int(json['todayCount']),
    overdue: _int(json['overdue']),
    preboarding: _bool(json['preboarding']),
    tj: parseLifecycleDate(json['tj']),
    goalsLocked: json['goalsLocked'] == null ? null : _bool(json['goalsLocked']),
    probationMonths: json['probationMonths'] == null ? null : _int(json['probationMonths']),
    nextEvent: _str(json['nextEvent']),
  );

  final String journeyId;
  final String name;
  final String? userId;
  final String? photoUrl;
  final String? designation;
  final String? dayLabel;
  final String? stage;
  final PlantState plant;
  final int todayCount;
  final int overdue;
  final bool preboarding;
  final DateTime? tj;
  final bool? goalsLocked;
  final int? probationMonths;

  /// In probation, what comes next ("Check-in Fri").
  final String? nextEvent;

  String get firstName => name.split(RegExp(r'\s+')).first;

  String dayLabelOn(DateTime now) =>
      dayLabel ?? (tj == null ? onboardingStageLabel(stage) : onboardingDayLabel(tj: tj!, today: now));
}

/// Most urgent first: overdue, then things to do today, then those joining
/// soonest.
List<JoinerSummary> sortJoinersByUrgency(List<JoinerSummary> joiners) {
  final sorted = [...joiners];
  sorted.sort((a, b) {
    final overdue = b.overdue.compareTo(a.overdue);
    if (overdue != 0) return overdue;
    final today = b.todayCount.compareTo(a.todayCount);
    if (today != 0) return today;
    final at = a.tj, bt = b.tj;
    if (at != null && bt != null) return at.compareTo(bt);
    return a.name.compareTo(b.name);
  });
  return sorted;
}

class SetupPerson {
  const SetupPerson({required this.userId, this.name, this.why, this.designation, this.photoUrl});

  factory SetupPerson.fromJson(Map<String, dynamic> json) => SetupPerson(
    userId: _str(json['userId']) ?? _str(json['personUserId']) ?? '',
    name: _str(json['name']),
    why: _str(json['why']),
    designation: _str(json['designation']),
    photoUrl: _str(json['photoUrl']),
  );

  final String userId;
  final String? name;
  final String? why;
  final String? designation;
  final String? photoUrl;

  Map<String, dynamic> toJson() => {'userId': userId, if (why != null && why!.isNotEmpty) 'why': why};
}

class JoinerSetup {
  const JoinerSetup({this.people = const [], this.buddy, this.welcomeNote, this.goals = const []});

  factory JoinerSetup.fromJson(Map<String, dynamic> json) {
    final buddy = _map(json['buddy']);
    final note = _map(json['welcomeNote']);
    return JoinerSetup(
      people: _maps(json['people']).map(SetupPerson.fromJson).toList(),
      buddy: buddy.isEmpty
          ? (_str(json['buddyUserId']) == null ? null : SetupPerson(userId: _str(json['buddyUserId'])!))
          : SetupPerson.fromJson(buddy),
      welcomeNote: _str(note['text']) ?? (json['welcomeNote'] is String ? _str(json['welcomeNote']) : null),
      goals: _strings(json['goals']),
    );
  }

  static const peopleCount = 6;

  final List<SetupPerson> people;
  final SetupPerson? buddy;
  final String? welcomeNote;
  final List<String> goals;
}

class JoinerDetail {
  const JoinerDetail({
    required this.joiner,
    this.tasks = const [],
    this.setup = const JoinerSetup(),
    this.starterTasks = const [],
    this.notes = const [],
    this.meetings = const [],
    this.surveyCount,
    this.surveyAvg,
    this.surveyKind,
    this.surveys = const [],
    this.probation,
    this.journey = const [],
    this.joinerNextDue,
    this.welcomeCanPost = false,
    this.welcomePostedAt,
  });

  factory JoinerDetail.fromJson(Map<String, dynamic> json, {String? viewerId}) {
    final survey = _map(json['surveySummary']);
    final probation = _map(json['probation']);
    final nextDue = _map(json['joinerNextDue']);
    final welcome = _map(json['welcomePost']);
    final surveys = [
      for (final s in _maps(json['surveySummaries']))
        (kind: _str(s['kind']) ?? 'day7', count: _int(s['count']), avg: _double(s['avg'])),
    ];
    return JoinerDetail(
      joiner: JoinerSummary.fromJson(_map(json['joiner'])),
      tasks: _maps(json['tasks']).map(TaskView.fromJson).toList(),
      setup: JoinerSetup.fromJson(_map(json['setup'])),
      starterTasks: _maps(json['starterTasks']).map(StarterTask.fromJson).toList(),
      notes: [for (final note in _maps(json['notes'])) OneOnOneNote.fromJson(note, viewerId: viewerId)],
      meetings: _maps(json['meetings']).map(Meeting.fromJson).toList(),
      surveyCount: survey.isEmpty ? null : _int(survey['count']),
      surveyAvg: _double(survey['avg']),
      surveyKind: _str(survey['kind']),
      surveys: surveys.isNotEmpty || survey.isEmpty
          ? surveys
          : [(kind: _str(survey['kind']) ?? 'day7', count: _int(survey['count']), avg: _double(survey['avg']))],
      probation: probation.isEmpty ? null : ProbationView.fromJson(probation),
      journey: _maps(json['journey']).map(JourneyStage.fromJson).toList(),
      joinerNextDue: nextDue.isEmpty
          ? null
          : (title: _str(nextDue['title']) ?? '', dueAt: parseLifecycleDate(nextDue['dueAt'])),
      welcomeCanPost: _bool(welcome['canPost']),
      welcomePostedAt: parseLifecycleDate(welcome['postedAt']),
    );
  }

  final JoinerSummary joiner;
  final List<TaskView> tasks;
  final JoinerSetup setup;
  final List<StarterTask> starterTasks;
  final List<OneOnOneNote> notes;
  final List<Meeting> meetings;
  final int? surveyCount;
  final double? surveyAvg;
  final String? surveyKind;

  /// The team summaries, one per survey kind that 3+ different people have
  /// answered (never merged, never a name).
  final List<({String kind, int count, double? avg})> surveys;

  /// Not in CONTRACT's joiner detail; read when sent.
  final ProbationView? probation;

  /// The joiner's stages as the server names them (Months 2–5 or Month 2).
  final List<JourneyStage> journey;

  /// The joiner's next due must-do ("Week-1 tasks are due Fri 5 Dec").
  final ({String title, DateTime? dueAt})? joinerNextDue;

  /// "Post a welcome": whether the manager can still post it, or when they did.
  final bool welcomeCanPost;
  final DateTime? welcomePostedAt;

  List<TaskView> get managerTasks => tasks.where((t) => t.forManager).toList();
  List<TaskView> get joinerTasks => tasks.where((t) => t.ownerRole == 'employee').toList();

  /// Whether the manager can still change the probation goals: the server's
  /// word, else open until Tj + 7.
  bool goalsLockedOn(DateTime now) => probationGoalsLocked(
    tj: joiner.tj,
    now: now,
    lockedFlag: joiner.goalsLocked,
  );
}

/// A colleague the manager can pick as a buddy or someone to meet (the
/// company directory the Connect list picker reads).
class DirectoryPerson {
  const DirectoryPerson({required this.userId, required this.name, this.designation, this.department, this.photoUrl});

  factory DirectoryPerson.fromJson(Map<String, dynamic> json) => DirectoryPerson(
    userId: _str(json['userId']) ?? _str(json['id']) ?? '',
    name: _str(json['name']) ?? '',
    designation: _str(json['designation']),
    department: _str(json['department']),
    photoUrl: _str(json['photoUrl']),
  );

  final String userId;
  final String name;
  final String? designation;
  final String? department;
  final String? photoUrl;
}

// ─── Rules ──────────────────────────────────────────────────────────────────

/// The day label (6Zs §5.2 "Day label"): "Day 1" on the joining day only;
/// from Day 2 "Week 1", "Week 2" … until month 1 ends, then "Month 2",
/// "Month 3" …; before joining, "Joins in n days". Never "Week 1 · Day 1 of 7".
String onboardingDayLabel({required DateTime tj, required DateTime today}) {
  final joined = dateOnly(tj);
  final day = dateOnly(today);
  final days = calendarDaysBetween(joined, day);
  if (days < 0) return days == -1 ? 'Joins tomorrow' : 'Joins in ${-days} days';
  if (days == 0) return 'Day 1';
  if (day.isBefore(addMonths(joined, 1))) return 'Week ${days ~/ 7 + 1}';
  var months = 1;
  while (!day.isBefore(addMonths(joined, months + 1))) {
    months++;
  }
  return 'Month ${months + 1}';
}

/// How far through week 1 the joiner is, for the journey bar's fill: 1/7 on
/// Day 1, 4/7 on Day 4.
double week1Fill({required DateTime tj, required DateTime today}) =>
    ((calendarDaysBetween(tj, today) + 1) / 7).clamp(0.0, 1.0);

/// The probation goals lock after Tj + 7 (the manager edits until then);
/// the server's own flag wins when it sends one.
bool probationGoalsLocked({DateTime? tj, required DateTime now, bool? lockedFlag}) {
  if (lockedFlag != null) return lockedFlag;
  if (tj == null) return false;
  // The server locks on Tj + 7 itself.
  return calendarDaysBetween(tj, now) >= 7;
}

DateTime? probationGoalsLockDate(DateTime? tj) =>
    tj == null ? null : dateOnly(tj).add(const Duration(days: 7));

/// Up next (6Zs §5.2): the next timed item today if it starts within two
/// hours; otherwise must-do → due soonest → not started. Only what the
/// joiner can act on now.
TaskView? pickUpNext(List<TaskView> tasks, DateTime now) {
  final open = tasks.where((t) => t.isOpen && t.forEmployee).toList();
  if (open.isEmpty) return null;
  final soon = open.where((t) {
    final start = t.startsAt;
    if (start == null) return false;
    final minutes = start.difference(now).inMinutes;
    return minutes >= -30 && minutes <= 120;
  }).toList()
    ..sort((a, b) => a.startsAt!.compareTo(b.startsAt!));
  if (soon.isNotEmpty) return soon.first;
  final rest = [...open]..sort(_byPriority);
  return rest.first;
}

int _byPriority(TaskView a, TaskView b) {
  if (a.mustDo != b.mustDo) return a.mustDo ? -1 : 1;
  final ad = a.dueAt, bd = b.dueAt;
  if (ad != null && bd != null && ad != bd) return ad.compareTo(bd);
  if ((ad == null) != (bd == null)) return ad == null ? 1 : -1;
  // Not started before sent back for another go.
  if (a.status != b.status) return a.status == 'todo' ? -1 : 1;
  return 0;
}

/// The home's list (6Zs §5.3 A2): meetings in time order, then the untimed
/// ones ("Any time") by must-do and due date; done and locked rows are the
/// callers' to fold away.
List<TaskView> orderTaskList(List<TaskView> tasks) {
  final timed = tasks.where((t) => t.isTimed).toList()
    ..sort((a, b) => a.startsAt!.compareTo(b.startsAt!));
  final untimed = tasks.where((t) => !t.isTimed).toList();
  // A stable sort: the server's order breaks ties.
  final indexed = untimed.indexed.toList()
    ..sort((x, y) {
      final byPriority = _byPriority(x.$2, y.$2);
      return byPriority != 0 ? byPriority : x.$1.compareTo(y.$1);
    });
  return [...timed, ...indexed.map((e) => e.$2)];
}
