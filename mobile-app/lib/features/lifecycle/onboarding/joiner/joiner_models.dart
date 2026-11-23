/// The joiner's onboarding as the server answers it (docs/lifecycle/FINAL-DESIGNS.md §4.2):
/// `GET /lifecycle/joiner/onboarding` is the home and every tile's screen,
/// `GET /lifecycle/joiner/checkins/:id` one check-in, `GET /lifecycle/joiner/goals`
/// the goals. Every count, state and label is the server's; the app only
/// filters the lists by `step` for the look ahead.
library;

import '../data/onboarding_models.dart' show PlantState, parseLifecycleDate, parseLifecycleDay;

String? _str(Object? v) {
  if (v is num) return '$v';
  if (v is! String) return null;
  final t = v.trim();
  return t.isEmpty ? null : t;
}

int _int(Object? v, [int fallback = 0]) => switch (v) {
  final int x => x,
  final num x => x.round(),
  final String x => int.tryParse(x) ?? fallback,
  _ => fallback,
};

bool _bool(Object? v) => v == true || v == 'true';

Map<String, dynamic> _map(Object? v) => v is Map ? Map<String, dynamic>.from(v) : const <String, dynamic>{};

List<Map<String, dynamic>> _maps(Object? v) =>
    v is List ? [for (final x in v) if (x is Map) Map<String, dynamic>.from(x)] : const [];

List<String> _strings(Object? v) => v is List ? [for (final x in v) if (x is String) x] : const [];

/// A step on the strip: Day 1, Week 1, Month 1 … Month n, Confirmed.
class JoinerStep {
  const JoinerStep({required this.key, required this.label, required this.state});

  factory JoinerStep.fromJson(Map<String, dynamic> j) =>
      JoinerStep(key: _str(j['key']) ?? '', label: _str(j['label']) ?? '', state: _str(j['state']) ?? 'future');

  final String key;
  final String label;

  /// 'done' | 'current' | 'future'.
  final String state;

  bool get isDone => state == 'done';
  bool get isCurrent => state == 'current';
}

class JoinerPerson {
  const JoinerPerson({required this.userId, required this.name, required this.initials, this.photoUrl});

  static JoinerPerson? maybe(Object? v) {
    final j = _map(v);
    final name = _str(j['name']);
    if (name == null) return null;
    return JoinerPerson(userId: _str(j['userId']) ?? '', name: name, initials: _str(j['initials']) ?? '', photoUrl: _str(j['photoUrl']));
  }

  final String userId;
  final String name;
  final String initials;
  final String? photoUrl;

  String get firstName => name.trim().split(RegExp(r'\s+')).first;
}

class JoinerMeeting {
  const JoinerMeeting({
    required this.id,
    required this.title,
    required this.withRole,
    required this.roleLabel,
    required this.step,
    this.person,
    this.everyMonth = false,
    this.month,
    this.met = false,
    this.locked = false,
    this.opensOn,
    this.carriedFrom,
    this.agenda = const [],
    this.notes = const [],
    this.startsAt,
  });

  factory JoinerMeeting.fromJson(Map<String, dynamic> j) => JoinerMeeting(
    id: _str(j['id']) ?? '',
    title: _str(j['title']) ?? '',
    withRole: _str(j['withRole']) ?? '',
    roleLabel: _str(j['roleLabel']) ?? '',
    person: JoinerPerson.maybe(j['person']),
    step: _str(j['step']) ?? '',
    everyMonth: _bool(j['everyMonth']),
    month: j['month'] == null ? null : _int(j['month']),
    met: _bool(j['met']),
    locked: _bool(j['locked']),
    opensOn: parseLifecycleDay(j['opensOn']),
    carriedFrom: _str(j['carriedFrom']),
    agenda: _strings(j['agenda']),
    notes: _strings(j['notes']),
    startsAt: parseLifecycleDate(j['startsAt']),
  );

  /// The rowId of `/lifecycle/onboarding/meeting-rows/:rowId`.
  final String id;

  /// The topic.
  final String title;

  /// 'hr' | 'manager' | 'buddy' | 'it' | 'head_of_department'.
  final String withRole;
  final String roleLabel;
  final JoinerPerson? person;
  final String step;
  final bool everyMonth;
  final int? month;
  final bool met;
  final bool locked;
  final DateTime? opensOn;
  final String? carriedFrom;
  final List<String> agenda;
  final List<String> notes;
  final DateTime? startsAt;

  JoinerMeeting copyWith({bool? met, List<String>? notes}) => JoinerMeeting(
    id: id,
    title: title,
    withRole: withRole,
    roleLabel: roleLabel,
    person: person,
    step: step,
    everyMonth: everyMonth,
    month: month,
    met: met ?? this.met,
    locked: locked,
    opensOn: opensOn,
    carriedFrom: carriedFrom,
    agenda: agenda,
    notes: notes ?? this.notes,
    startsAt: startsAt,
  );
}

class JoinerTask {
  const JoinerTask({
    required this.id,
    required this.title,
    required this.type,
    required this.verb,
    required this.step,
    required this.state,
    this.meta,
    this.dueOn,
    this.carriedFrom,
    this.progressDone,
    this.progressTotal,
    this.screen,
    this.policies = false,
    this.letters = false,
    this.form = false,
    this.link,
    this.fileUrl,
  });

  factory JoinerTask.fromJson(Map<String, dynamic> j) {
    final progress = _map(j['progress']);
    final opens = _map(j['opens']);
    return JoinerTask(
      id: _str(j['id']) ?? '',
      title: _str(j['title']) ?? '',
      type: _str(j['type']) ?? 'other',
      verb: _str(j['verb']) ?? 'Open',
      meta: _str(j['meta']),
      step: _str(j['step']) ?? '',
      state: _str(j['state']) ?? 'todo',
      dueOn: parseLifecycleDay(j['dueOn']),
      carriedFrom: _str(j['carriedFrom']),
      progressDone: progress.isEmpty ? null : _int(progress['done']),
      progressTotal: progress.isEmpty ? null : _int(progress['total']),
      screen: _str(opens['screen']),
      policies: _bool(opens['policies']),
      letters: _bool(opens['letters']),
      form: _bool(opens['form']),
      link: _str(opens['link']),
      fileUrl: _str(opens['fileUrl']),
    );
  }

  final String id;
  final String title;

  /// 'do' | 'review' | 'ack' | 'sign' | 'other' | 'form'.
  final String type;

  /// 'Start' | 'Continue' | 'Review' | 'Read' | 'Sign' | 'Open'.
  final String verb;
  final String? meta;
  final String step;

  /// 'todo' | 'in_progress' | 'done' | 'locked'.
  final String state;
  final DateTime? dueOn;
  final String? carriedFrom;
  final int? progressDone;
  final int? progressTotal;

  /// What a tap opens.
  final String? screen;
  final bool policies;
  final bool letters;
  final bool form;
  final String? link;
  final String? fileUrl;

  bool get isDone => state == 'done';
  bool get isLocked => state == 'locked';
}

class JoinerCheckinRow {
  const JoinerCheckinRow({required this.id, required this.title, required this.step, required this.questions, required this.state, this.opensOn, this.sentAt});

  factory JoinerCheckinRow.fromJson(Map<String, dynamic> j) => JoinerCheckinRow(
    id: _str(j['id']) ?? '',
    title: _str(j['title']) ?? '',
    step: _str(j['step']) ?? '',
    questions: j['questions'] is List ? (j['questions'] as List).length : _int(j['questions']),
    state: _str(j['state']) ?? 'locked',
    opensOn: parseLifecycleDay(j['opensOn']),
    sentAt: parseLifecycleDate(j['sentAt']),
  );

  final String id;
  final String title;
  final String step;
  final int questions;

  /// 'locked' | 'open' | 'sent'.
  final String state;
  final DateTime? opensOn;
  final DateTime? sentAt;

  bool get isOpen => state == 'open';
  bool get isSent => state == 'sent';
}

class CheckinQuestion {
  const CheckinQuestion({required this.id, required this.text, required this.type, this.options = const []});

  factory CheckinQuestion.fromJson(Map<String, dynamic> j) =>
      CheckinQuestion(id: _str(j['id']) ?? '', text: _str(j['text']) ?? '', type: _str(j['type']) ?? 'long', options: _strings(j['options']));

  final String id;
  final String text;

  /// A check-in's: 'rating' | 'yes_no' | 'short' | 'long' | 'choice'; a form's: 'short' | 'long' | 'choice' | 'date' | 'file'.
  final String type;
  final List<String> options;
}

/// A "Fill in a form" task (GET `/lifecycle/joiner/forms/:taskId`): HR's
/// questions and, once sent, the answers saved to the joiner's profile (a
/// file answer is its file id, named in [files]; a date is YYYY-MM-DD).
class JoinerForm {
  const JoinerForm({required this.taskId, required this.title, required this.questions, this.answers = const {}, this.sentAt, this.files = const {}});

  factory JoinerForm.fromJson(Map<String, dynamic> json) {
    final j = _map(json['form']);
    return JoinerForm(
      taskId: _str(j['taskId']) ?? '',
      title: _str(j['title']) ?? '',
      questions: [for (final q in _maps(j['questions'])) CheckinQuestion.fromJson(q)],
      answers: {for (final a in _maps(j['answers'])) _str(a['questionId']) ?? '': _str(a['value'])},
      sentAt: _str(j['sentAt']),
      files: {for (final e in _map(j['files']).entries) e.key: '${e.value}'},
    );
  }

  final String taskId;
  final String title;
  final List<CheckinQuestion> questions;
  final Map<String, String?> answers;
  final String? sentAt;
  final Map<String, String> files;

  bool get sent => sentAt != null;
}

class JoinerCheckin {
  const JoinerCheckin({required this.row, required this.questions});

  factory JoinerCheckin.fromJson(Map<String, dynamic> j) =>
      JoinerCheckin(row: JoinerCheckinRow.fromJson(j), questions: [for (final q in _maps(j['questions'])) CheckinQuestion.fromJson(q)]);

  final JoinerCheckinRow row;
  final List<CheckinQuestion> questions;
}

class JoinerWatch {
  const JoinerWatch({required this.id, required this.title, required this.type, required this.step, this.minutes, this.url, this.text, this.bg, this.watched = false});

  factory JoinerWatch.fromJson(Map<String, dynamic> j) => JoinerWatch(
    id: _str(j['id']) ?? '',
    title: _str(j['title']) ?? '',
    type: _str(j['type']) ?? 'video',
    minutes: j['minutes'] == null ? null : _int(j['minutes']),
    url: _str(j['url']),
    text: _str(j['text']),
    bg: _str(j['bg']),
    step: _str(j['step']) ?? '',
    watched: _bool(j['watched']),
  );

  final String id;
  final String title;

  /// 'video' | 'image' | 'text' | 'pdf'.
  final String type;
  final int? minutes;
  final String? url;
  final String? text;
  final String? bg;
  final String step;
  final bool watched;

  bool get isPdf => type == 'pdf';

  /// "3 min", "5 min read"; empty without a length.
  String get length => minutes == null ? '' : (isPdf ? '$minutes min read' : '$minutes min');
}

class JoinerDevice {
  const JoinerDevice({required this.id, required this.title, required this.ready});

  factory JoinerDevice.fromJson(Map<String, dynamic> j) =>
      JoinerDevice(id: _str(j['id']) ?? '', title: _str(j['title']) ?? '', ready: _bool(j['ready']));

  final String id;
  final String title;
  final bool ready;
}

class JoinerTour {
  const JoinerTour({this.lessons = const [], this.managerLessons = const [], this.done = const [], this.today});

  factory JoinerTour.fromJson(Map<String, dynamic> j) => JoinerTour(
    lessons: _strings(j['lessons']),
    managerLessons: _strings(j['managerLessons']),
    done: _strings(j['done']),
    today: _str(j['today']),
  );

  final List<String> lessons;
  final List<String> managerLessons;
  final List<String> done;
  final String? today;

  int get doneCount => lessons.where(done.contains).length;
}

class JoinerProfileSection {
  const JoinerProfileSection({required this.key, required this.title, required this.state});

  factory JoinerProfileSection.fromJson(Map<String, dynamic> j) =>
      JoinerProfileSection(key: _str(j['key']) ?? '', title: _str(j['title']) ?? '', state: _str(j['state']) ?? 'todo');

  final String key;
  final String title;

  /// 'done' | 'todo' | 'by_hr'.
  final String state;
}

class JoinerProfile {
  const JoinerProfile({this.sections = const [], this.done = 0, this.total = 0, this.pct = 0});

  factory JoinerProfile.fromJson(Map<String, dynamic> j) => JoinerProfile(
    sections: [for (final s in _maps(j['sections'])) JoinerProfileSection.fromJson(s)],
    done: _int(j['done']),
    total: _int(j['total']),
    pct: _int(j['pct']).clamp(0, 100),
  );

  final List<JoinerProfileSection> sections;
  final int done;
  final int total;
  final int pct;
}

class JoinerSummary {
  const JoinerSummary({
    this.meetingsMet = 0,
    this.meetingsTotal = 0,
    this.tasksToDo = 0,
    this.upNext,
    this.checkinDueId,
    this.checkinDueTitle,
    this.devicesReady = 0,
    this.devicesTotal = 0,
  });

  factory JoinerSummary.fromJson(Map<String, dynamic> j) {
    final m = _map(j['meetings']);
    final t = _map(j['tasks']);
    final c = _map(j['checkinDue']);
    final d = _map(j['devices']);
    return JoinerSummary(
      meetingsMet: _int(m['met']),
      meetingsTotal: _int(m['total']),
      tasksToDo: _int(t['toDo']),
      upNext: _str(t['upNext']),
      checkinDueId: _str(c['id']),
      checkinDueTitle: _str(c['title']),
      devicesReady: _int(d['ready']),
      devicesTotal: _int(d['total']),
    );
  }

  final int meetingsMet;
  final int meetingsTotal;
  final int tasksToDo;
  final String? upNext;
  final String? checkinDueId;
  final String? checkinDueTitle;
  final int devicesReady;
  final int devicesTotal;
}

class JoinerOnboarding {
  const JoinerOnboarding({
    required this.journeyId,
    required this.companyName,
    required this.firstName,
    required this.step,
    required this.steps,
    required this.heroEyebrow,
    required this.heroLabel,
    required this.plant,
    this.firstPunchAt,
    this.faceEnrolled = false,
    this.meetings = const [],
    this.tasks = const [],
    this.checkins = const [],
    this.watch = const [],
    this.trainings = const [],
    this.trainingsLabel = 'Trainings',
    this.devices = const [],
    this.tour = const JoinerTour(),
    this.profile = const JoinerProfile(),
    this.summary = const JoinerSummary(),
  });

  factory JoinerOnboarding.fromJson(Map<String, dynamic> j) {
    final hero = _map(j['hero']);
    final punch = _map(j['firstPunch']);
    return JoinerOnboarding(
      journeyId: _str(j['journeyId']) ?? '',
      companyName: _str(j['companyName']) ?? '',
      firstName: _str(j['firstName']) ?? '',
      step: _str(j['step']) ?? 'd1',
      steps: [for (final s in _maps(j['steps'])) JoinerStep.fromJson(s)],
      heroEyebrow: _str(hero['eyebrow']) ?? 'YOU ARE HERE',
      heroLabel: _str(hero['label']) ?? '',
      plant: PlantState.fromJson(j['plant']),
      firstPunchAt: parseLifecycleDate(punch['at']),
      faceEnrolled: _bool(punch['faceEnrolled']),
      meetings: [for (final m in _maps(j['meetings'])) JoinerMeeting.fromJson(m)],
      tasks: [for (final t in _maps(j['tasks'])) JoinerTask.fromJson(t)],
      checkins: [for (final c in _maps(j['checkins'])) JoinerCheckinRow.fromJson(c)],
      watch: [for (final w in _maps(j['watch'])) JoinerWatch.fromJson(w)],
      trainings: [for (final w in _maps(j['trainings'])) JoinerWatch.fromJson(w)],
      trainingsLabel: _str(_map(j['labels'])['trainings']) ?? 'Trainings',
      devices: [for (final d in _maps(j['devices'])) JoinerDevice.fromJson(d)],
      tour: JoinerTour.fromJson(_map(j['tour'])),
      profile: JoinerProfile.fromJson(_map(j['profile'])),
      summary: JoinerSummary.fromJson(_map(j['summary'])),
    );
  }

  final String journeyId;
  final String companyName;
  final String firstName;

  /// Where they are: 'd1' | 'w1' | 'm1' … | 'confirmed'.
  final String step;
  final List<JoinerStep> steps;
  final String heroEyebrow;
  final String heroLabel;
  final PlantState plant;
  final DateTime? firstPunchAt;
  final bool faceEnrolled;
  final List<JoinerMeeting> meetings;
  final List<JoinerTask> tasks;
  final List<JoinerCheckinRow> checkins;
  final List<JoinerWatch> watch;
  final List<JoinerWatch> trainings;

  /// What the company calls its trainings (`labels.trainings`, HR can rename
  /// it); "Trainings" from a server that does not say.
  final String trainingsLabel;
  final List<JoinerDevice> devices;
  final JoinerTour tour;
  final JoinerProfile profile;
  final JoinerSummary summary;

  bool get isConfirmed => step == 'confirmed';

  /// The step's place on the strip (Day 1 is 0); -1 when unknown.
  int indexOf(String key) => steps.indexWhere((s) => s.key == key);

  String labelOf(String key) => steps.where((s) => s.key == key).map((s) => s.label).firstOrNull ?? key;

  JoinerOnboarding withMeeting(JoinerMeeting m) => JoinerOnboarding(
    journeyId: journeyId,
    companyName: companyName,
    firstName: firstName,
    step: step,
    steps: steps,
    heroEyebrow: heroEyebrow,
    heroLabel: heroLabel,
    plant: plant,
    firstPunchAt: firstPunchAt,
    faceEnrolled: faceEnrolled,
    meetings: [for (final x in meetings) x.id == m.id ? m : x],
    tasks: tasks,
    checkins: checkins,
    watch: watch,
    trainings: trainings,
    trainingsLabel: trainingsLabel,
    devices: devices,
    tour: tour,
    profile: profile,
    summary: summary,
  );
}

// ─── The Sign task's documents ──────────────────────────────────────────────

class JoinerLetter {
  const JoinerLetter({required this.id, required this.title, required this.state});

  factory JoinerLetter.fromJson(Map<String, dynamic> j) =>
      JoinerLetter(id: _str(j['id']) ?? '', title: _str(j['title']) ?? '', state: _str(j['state']) ?? 'locked');

  final String id;
  final String title;

  /// 'locked' | 'ready' | 'opened' | 'signed'.
  final String state;
}

List<JoinerLetter> joinerLettersOf(Map<String, dynamic> j) => [for (final l in _maps(j['letters'])) JoinerLetter.fromJson(l)];
