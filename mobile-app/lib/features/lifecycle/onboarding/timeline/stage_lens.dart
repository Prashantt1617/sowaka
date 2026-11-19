import '../data/onboarding_models.dart';

/// The timeline (New joiner artifact, "Timeline · tap a stage to look ahead
/// or back"): one list of the joiner's things, seen through a stage.
///
/// - The stage row is Day 1, Week 1, Month 1 … Month N, Confirmed. Her own
///   stage stays filled; the one she taps is the lens.
/// - Her own stage ([LensMode.now]): what is due now first; anything left
///   over from an earlier stage on top, tagged "From Week 1"; what is due
///   later under COMING UP, tagged with its stage, still doable early.
/// - A stage ahead ([LensMode.ahead]): that stage's things first (IN MONTH 1),
///   then what is due now (NOW · WEEK 1). Something that only opens later is
///   locked: "Opens in Month 1".
/// - A stage behind ([LensMode.back]): what she did there, ticked; anything
///   still open first, "Still open".
///
/// Pure: built from the home's task lists, the journey and today's date, so
/// the tiles, the Tasks and Meetings lists and the hero read one model.

enum LensMode { now, ahead, back }

enum LensPill { none, carried, stillOpen, stage }

/// The stage row: Day 1, Week 1, Month 1 … Month [months], Confirmed.
List<String> lensSteps(int months) => [
  'Day 1',
  'Week 1',
  for (var m = 1; m <= months; m++) 'Month $m',
  'Confirmed',
];

/// The probation's length in months from the journey's stage labels
/// ("Months 2–5" → 6, "Month 2" → 3); 6 when the server names none.
int probationMonthsOf(List<JourneyStage> journey) {
  for (final stage in journey) {
    final m = RegExp(r'Months 2[–-](\d+)').firstMatch(stage.label);
    if (m != null) return int.parse(m.group(1)!) + 1;
    if (stage.label == 'Month 2') return 3;
  }
  return 6;
}

/// The probation month [date] falls in (1-based): month m runs from Tj + (m-1)
/// months up to the day before Tj + m months.
int probationMonthOf(DateTime tj, DateTime date) {
  final day = dateOnly(date);
  var m = 1;
  while (m < 48 && !day.isBefore(addMonths(dateOnly(tj), m))) {
    m++;
  }
  return m;
}

/// One row through the lens.
class LensItem {
  const LensItem({
    required this.task,
    required this.stage,
    this.head,
    this.pill = LensPill.none,
    this.pillText,
    this.locked = false,
    this.lockText,
    this.ticked = false,
  });

  final TaskView task;

  /// The step it belongs to (an index into the stage row).
  final int stage;

  /// The grey strip above it: COMING UP, IN MONTH 1, NOW · WEEK 1.
  final String? head;
  final LensPill pill;

  /// "From Week 1", "Still open", "Month 1".
  final String? pillText;

  /// Can be read but not done yet: a lock and [lockText].
  final bool locked;

  /// "Opens in Month 1", "Opens once you’re confirmed".
  final String? lockText;

  /// Done (or, looking back, done there).
  final bool ticked;

  String get id => task.id;
}

/// A tile's three lines: UP NEXT / IN MONTH 1, the thing, its count.
typedef LensTile = ({String label, String title, String meta});

class StageLens {
  StageLens._({
    required this.steps,
    required this.current,
    required this.selected,
    required this.tasks,
    required this.meetings,
    required this.tasksOfStage,
    required this.meetingsOfStage,
    required this.openNowTasks,
    required this.openNowMeetings,
  });

  /// Builds the lens on [selected] (null: her own stage) over [home].
  factory StageLens.of(OnboardingHome home, DateTime now, {int? selected}) {
    final months = probationMonthsOf(home.journey);
    final steps = lensSteps(months);
    final current = currentStepOf(home, now, months: months);
    final at = (selected ?? current).clamp(0, steps.length - 1);
    final all = <TaskView>[
      for (final t in [...home.today, ...home.later, ...home.done])
        if (t.status != 'cancelled') t,
    ];
    // Each thing once (Up next is also in today).
    final seen = <String>{};
    final unique = [for (final t in all) if (seen.add(t.id)) t];
    final staged = [for (final t in unique) (task: t, stage: stepOfTask(t, home.tj, current: current, months: months))];
    final meetings = staged.where((s) => isLensMeeting(s.task)).toList();
    final tasks = staged.where((s) => !isLensMeeting(s.task)).toList();
    final mode = at == current ? LensMode.now : (at > current ? LensMode.ahead : LensMode.back);
    List<LensItem> build(List<({TaskView task, int stage})> list) => _rows(list, steps, current, at, mode);
    List<TaskView> ofStage(List<({TaskView task, int stage})> list) => [for (final s in list) if (s.stage == at) s.task];
    List<TaskView> openNow(List<({TaskView task, int stage})> list) =>
        [for (final s in list) if (s.stage <= current && !s.task.isDone && !s.task.isLocked) s.task];
    return StageLens._(
      steps: steps,
      current: current,
      selected: at,
      tasks: build(tasks),
      meetings: build(meetings),
      tasksOfStage: ofStage(tasks),
      meetingsOfStage: ofStage(meetings),
      openNowTasks: openNow(tasks),
      openNowMeetings: openNow(meetings),
    );
  }

  final List<String> steps;

  /// Her own stage.
  final int current;

  /// The stage being looked at.
  final int selected;

  /// The Tasks list and the Meetings list, in the lens's order.
  final List<LensItem> tasks;
  final List<LensItem> meetings;

  /// Everything of the stage looked at (the tiles' counts).
  final List<TaskView> tasksOfStage;
  final List<TaskView> meetingsOfStage;

  /// What is due now: her stage's and earlier stages' open things.
  final List<TaskView> openNowTasks;
  final List<TaskView> openNowMeetings;

  LensMode get mode => selected == current ? LensMode.now : (selected > current ? LensMode.ahead : LensMode.back);
  String get here => steps[current];
  String get there => steps[selected];
  bool get isConfirmed => current == steps.length - 1;

  /// "YOU ARE HERE", "PROBATION COMPLETE", "A LOOK AHEAD", "LOOKING BACK".
  String get eyebrow => switch (mode) {
    LensMode.now => isConfirmed ? 'PROBATION COMPLETE' : 'YOU ARE HERE',
    LensMode.ahead => 'A LOOK AHEAD',
    LensMode.back => 'LOOKING BACK',
  };

  /// The hero's big line: the stage, or "Confirmed!" once she is.
  String get title => mode == LensMode.now && isConfirmed ? 'Confirmed!' : there;

  /// "Back to Week 1".
  String get backLabel => 'Back to $here';

  /// "IN MONTH 1", "ONCE CONFIRMED".
  String get inLabel => inStageLabel(there);

  /// The Tasks tile.
  LensTile get taskTile {
    switch (mode) {
      case LensMode.now:
        final left = openNowTasks.length;
        return (label: 'UP NEXT', title: openNowTasks.isEmpty ? 'All done' : openNowTasks.first.title, meta: left == 0 ? 'All done' : '$left to do');
      case LensMode.ahead:
        return (label: inLabel, title: tasksOfStage.isEmpty ? '' : tasksOfStage.first.title, meta: _plural(tasksOfStage.length, 'task', 'tasks'));
      case LensMode.back:
        final left = tasksOfStage.where((t) => !t.isDone).toList();
        return (
          label: inLabel,
          title: left.isEmpty ? 'All done' : left.first.title,
          meta: left.isEmpty ? '${_plural(tasksOfStage.length, 'task', 'tasks')} done' : '${left.length} still open',
        );
    }
  }

  /// The Meetings tile's and list's count line.
  String get meetingsMeta {
    switch (mode) {
      case LensMode.now:
        final mine = [for (final m in meetings) if (m.stage <= current) m];
        if (mine.isEmpty) return '';
        return '${mine.where((m) => m.ticked).length} of ${mine.length} met';
      case LensMode.ahead:
        return '${_plural(meetingsOfStage.length, 'meeting', 'meetings')} in $there';
      case LensMode.back:
        final left = meetingsOfStage.where((m) => !m.isDone).length;
        return left == 0 ? 'All met' : '$left still open';
    }
  }

  /// The Tasks list's count line.
  String get tasksMeta => mode == LensMode.now ? (openNowTasks.isEmpty ? 'All done' : '${openNowTasks.length} to do') : taskTile.meta;

  /// Her stage as the row's index: Day 1 on the joining day, Week 1 to
  /// Tj + 6, Month 1 to the end of month 1, then Month 2 … Month N, and
  /// Confirmed once she is.
  static int currentStepOf(OnboardingHome home, DateTime now, {required int months}) {
    final last = months + 2;
    final tj = home.tj;
    switch (home.stage) {
      case 'ready_to_perform':
        return last;
      case 'pre_boarding':
        return 0;
      case 'welcome_week1':
        if (tj != null) return calendarDaysBetween(tj, now) <= 0 ? 0 : 1;
        return home.dayLabel == 'Day 1' ? 0 : 1;
      case 'settling_in':
        return 2;
      case 'final_month':
        return months + 1;
      case 'growing_gains':
        final said = RegExp(r'^Month (\d+)$').firstMatch(home.dayLabel ?? '');
        final m = said != null ? int.parse(said.group(1)!) : (tj == null ? 2 : probationMonthOf(tj, now));
        return 1 + m.clamp(2, months);
    }
    return 0;
  }

  /// The stage a task belongs to.
  static int stepOfTask(TaskView task, DateTime? tj, {required int current, required int months}) {
    final last = months + 2;
    if (task.systemKey == 'confirmation_reveal') return last;
    if (task.phase == 'pre_boarding') return 0;
    if (task.phase == 'first_week') {
      final due = task.dueAt;
      if (tj != null && due != null) return calendarDaysBetween(tj, due) <= 0 ? 0 : 1;
      final opens = task.opensAt;
      if (tj != null && opens != null && calendarDaysBetween(tj, opens) > 0) return 1;
      return current == 0 ? 0 : 1;
    }
    // Probation: its month, else the month its date falls in.
    var month = task.month;
    if (month == null) {
      final date = task.dueAt ?? task.opensAt;
      month = tj != null && date != null ? probationMonthOf(tj, date) : 1;
    }
    return 1 + month.clamp(1, months);
  }
}

/// A meeting through the lens: a meeting, a check-in, the confirmation
/// discussion. Everything else is a task.
bool isLensMeeting(TaskView task) =>
    task.kind == 'meeting' || task.kind == 'checkin' || task.systemKey == 'confirmation_discussion' || task.meeting != null;

/// "IN MONTH 1", "ONCE CONFIRMED".
String inStageLabel(String step) => step == 'Confirmed' ? 'ONCE CONFIRMED' : 'IN ${step.toUpperCase()}';

/// "Opens in Month 1", "Opens once you’re confirmed".
String opensInLabel(String step) => step == 'Confirmed' ? 'Opens once you’re confirmed' : 'Opens in $step';

String _plural(int n, String one, String many) => '$n ${n == 1 ? one : many}';

int _byWhen(TaskView a, TaskView b) {
  final x = a.startsAt ?? a.dueAt ?? a.opensAt;
  final y = b.startsAt ?? b.dueAt ?? b.opensAt;
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return x.compareTo(y);
}

List<LensItem> _rows(List<({TaskView task, int stage})> list, List<String> steps, int current, int at, LensMode mode) {
  final sorted = [...list]..sort((a, b) => _byWhen(a.task, b.task));
  switch (mode) {
    case LensMode.now:
      // Left over from an earlier stage, then this stage's, then what is due later.
      final carried = [for (final s in sorted) if (s.stage < current && !s.task.isDone) s];
      final mine = [for (final s in sorted) if (s.stage == current) s]
        ..sort((a, b) => (a.task.isDone ? 1 : 0) - (b.task.isDone ? 1 : 0));
      // Coming up: what can be done early, and what opens in the next stage.
      final soon = [
        for (final s in sorted)
          if (s.stage > current && (!s.task.isLocked || s.stage == current + 1)) s,
      ];
      return [
        for (final s in carried)
          LensItem(task: s.task, stage: s.stage, pill: LensPill.carried, pillText: 'From ${steps[s.stage]}'),
        for (final s in mine) LensItem(task: s.task, stage: s.stage, ticked: s.task.isDone),
        for (final (k, s) in soon.indexed)
          LensItem(
            task: s.task,
            stage: s.stage,
            head: k == 0 ? 'COMING UP' : null,
            pill: s.task.isLocked ? LensPill.none : LensPill.stage,
            pillText: s.task.isLocked ? null : steps[s.stage],
            locked: s.task.isLocked,
            lockText: s.task.isLocked ? opensInLabel(steps[s.stage]) : null,
            ticked: s.task.isDone,
          ),
      ];
    case LensMode.ahead:
      final there = [for (final s in sorted) if (s.stage == at) s];
      final now = [for (final s in sorted) if (s.stage <= current && !s.task.isDone) s];
      return [
        for (final (k, s) in there.indexed)
          LensItem(
            task: s.task,
            stage: s.stage,
            head: k == 0 ? inStageLabel(steps[at]) : null,
            locked: s.task.isLocked,
            lockText: s.task.isLocked ? opensInLabel(steps[at]) : null,
            ticked: s.task.isDone,
          ),
        for (final (k, s) in now.indexed)
          LensItem(
            task: s.task,
            stage: s.stage,
            head: k == 0 ? 'NOW · ${steps[current].toUpperCase()}' : null,
            pill: s.stage < current ? LensPill.carried : LensPill.none,
            pillText: s.stage < current ? 'From ${steps[s.stage]}' : null,
          ),
      ];
    case LensMode.back:
      final there = [for (final s in sorted) if (s.stage == at) s];
      final left = [for (final s in there) if (!s.task.isDone) s];
      final done = [for (final s in there) if (s.task.isDone) s];
      return [
        for (final s in left) LensItem(task: s.task, stage: s.stage, pill: LensPill.stillOpen, pillText: 'Still open'),
        for (final s in done) LensItem(task: s.task, stage: s.stage, ticked: true),
      ];
  }
}
