/// The look ahead (New joiner canvas, App · the stage strip): the joiner's
/// own lists seen from her stage or from a stage ahead. Nothing is counted
/// here that the server did not send: the rows are the server's rows,
/// grouped by their `step`, with the canvas's strips and pills.
library;

import 'joiner_models.dart';

enum LensMode { now, ahead }

/// One row of Meetings or Tasks as the canvas draws it.
class LensRow<T> {
  const LensRow({required this.item, this.head, this.pill, this.amber = false, this.locked = false, this.sub, this.done = false});

  final T item;

  /// The grey strip above it: COMING UP, IN MONTH 1, NOW · WEEK 1.
  final String? head;

  /// "From Day 1" (amber), "Week 1", "Every month".
  final String? pill;
  final bool amber;
  final bool locked;

  /// "Opens in Month 1" in place of the second line.
  final String? sub;
  final bool done;
}

class JoinerLens {
  JoinerLens(this.d, String? viewed) : viewedKey = _valid(d, viewed) ?? d.step;

  static String? _valid(JoinerOnboarding d, String? key) {
    if (key == null) return null;
    final i = d.indexOf(key);
    return i > d.indexOf(d.step) ? key : null;
  }

  final JoinerOnboarding d;

  /// The step looked at (her own when not looking ahead).
  final String viewedKey;

  int get current => d.indexOf(d.step);
  int get at => d.indexOf(viewedKey);
  LensMode get mode => at > current ? LensMode.ahead : LensMode.now;
  bool get isNow => mode == LensMode.now;

  String get here => d.labelOf(d.step);
  String get there => d.labelOf(viewedKey);

  /// "IN WEEK 1", or "ONCE CONFIRMED".
  String get inLabel => viewedKey == 'confirmed' ? 'ONCE CONFIRMED' : 'IN ${there.toUpperCase()}';

  static String opensIn(String key, String label) => key == 'confirmed' ? 'Opens once you’re confirmed' : 'Opens in $label';

  int _idx(String step) => d.indexOf(step);

  // ── Meetings ──────────────────────────────────────────────────────────────

  /// Her stage's meetings and the ones carried over (the tiles' "now").
  late final List<JoinerMeeting> meetingsNow = [
    for (final m in d.meetings)
      if (_idx(m.step) == current || (m.carriedFrom != null && !d.isConfirmed)) m,
  ];

  /// What comes later: every meeting of a later stage, a monthly one only
  /// as its next time when none is on now.
  late final List<JoinerMeeting> meetingsSoon = () {
    final monthlyNow = meetingsNow.where((m) => m.everyMonth).isNotEmpty;
    var monthlyShown = monthlyNow;
    final out = <JoinerMeeting>[];
    for (final m in d.meetings) {
      if (_idx(m.step) <= current) continue;
      if (m.everyMonth) {
        if (monthlyShown) continue;
        monthlyShown = true;
      }
      out.add(m);
    }
    return out;
  }();

  /// The stage looked at's own meetings.
  late final List<JoinerMeeting> meetingsThere = [
    for (final m in d.meetings)
      if (_idx(m.step) == at && m.carriedFrom == null && !meetingsNow.any((n) => n.id == m.id)) m,
  ];

  List<LensRow<JoinerMeeting>> get meetingRows => isNow
      ? [
          for (final m in meetingsNow.where((m) => m.carriedFrom != null))
            LensRow(item: m, pill: 'From ${d.labelOf(m.carriedFrom!)}', amber: true, done: m.met),
          for (final m in meetingsNow.where((m) => m.carriedFrom == null))
            LensRow(item: m, pill: m.everyMonth ? 'Every month' : null, done: m.met),
          for (final (k, m) in meetingsSoon.indexed)
            LensRow(
              item: m,
              head: k == 0 ? 'COMING UP' : null,
              pill: m.locked ? (m.everyMonth ? 'Every month' : null) : d.labelOf(m.step),
              locked: m.locked,
              sub: m.locked ? opensIn(m.step, d.labelOf(m.step)) : null,
              done: m.met,
            ),
        ]
      : [
          for (final (k, m) in meetingsThere.indexed)
            LensRow(
              item: m,
              head: k == 0 ? inLabel : null,
              pill: m.everyMonth ? 'Every month' : null,
              locked: m.locked,
              sub: m.locked ? opensIn(viewedKey, there) : null,
            ),
          for (final (k, m) in meetingsNow.indexed)
            LensRow(
              item: m,
              head: k == 0 ? 'NOW · ${here.toUpperCase()}' : null,
              pill: m.carriedFrom != null ? 'From ${d.labelOf(m.carriedFrom!)}' : (m.everyMonth ? 'Every month' : null),
              amber: m.carriedFrom != null,
              done: m.met,
            ),
        ];

  /// "2 of 3 met" (the server's counts); "3 meetings in Month 1" ahead.
  String get meetingsMeta {
    if (!isNow) return '${_plural(meetingsThere.length, 'meeting', 'meetings')} in $there';
    final s = d.summary;
    return s.meetingsTotal == 0 ? '' : '${s.meetingsMet} of ${s.meetingsTotal} met';
  }

  /// The tile's faces: her stage's people; ahead, that stage's.
  List<JoinerMeeting> get faces => (isNow ? meetingsNow : meetingsThere).take(3).toList();

  bool get showsMeetings => isNow ? meetingRows.isNotEmpty : meetingsThere.isNotEmpty;

  // ── Tasks ─────────────────────────────────────────────────────────────────

  late final List<JoinerTask> tasksNow = [
    for (final t in d.tasks)
      if (_idx(t.step) == current || (t.carriedFrom != null && !d.isConfirmed)) t,
  ];

  late final List<JoinerTask> tasksSoon = [for (final t in d.tasks) if (_idx(t.step) > current) t];

  late final List<JoinerTask> tasksThere = [
    for (final t in d.tasks)
      if (_idx(t.step) == at && t.carriedFrom == null && !tasksNow.any((n) => n.id == t.id)) t,
  ];

  List<LensRow<JoinerTask>> get taskRows => isNow
      ? [
          for (final t in tasksNow.where((t) => t.carriedFrom != null))
            LensRow(item: t, pill: 'From ${d.labelOf(t.carriedFrom!)}', amber: true, done: t.isDone),
          for (final t in tasksNow.where((t) => t.carriedFrom == null)) LensRow(item: t, done: t.isDone, locked: t.isLocked),
          for (final (k, t) in tasksSoon.indexed)
            LensRow(
              item: t,
              head: k == 0 ? 'COMING UP' : null,
              pill: t.isLocked ? null : d.labelOf(t.step),
              locked: t.isLocked,
              sub: t.isLocked ? opensIn(t.step, d.labelOf(t.step)) : null,
              done: t.isDone,
            ),
        ]
      : [
          for (final (k, t) in tasksThere.indexed)
            LensRow(
              item: t,
              head: k == 0 ? inLabel : null,
              locked: t.isLocked,
              sub: t.isLocked ? opensIn(viewedKey, there) : null,
            ),
          for (final (k, t) in tasksNow.indexed)
            LensRow(
              item: t,
              head: k == 0 ? 'NOW · ${here.toUpperCase()}' : null,
              pill: t.carriedFrom != null ? 'From ${d.labelOf(t.carriedFrom!)}' : null,
              amber: t.carriedFrom != null,
              done: t.isDone,
            ),
        ];

  bool get showsTasks => isNow ? taskRows.isNotEmpty : tasksThere.isNotEmpty;

  /// The Tasks tile: UP NEXT, the first to do and "n to do"; ahead, that
  /// stage's first and "n tasks".
  ({String label, String title, String meta}) get taskTile {
    if (!isNow) {
      return (label: inLabel, title: tasksThere.firstOrNull?.title ?? '', meta: _plural(tasksThere.length, 'task', 'tasks'));
    }
    final s = d.summary;
    return (label: 'UP NEXT', title: s.upNext ?? 'All done', meta: s.tasksToDo > 0 ? '${s.tasksToDo} to do' : 'All done');
  }

  /// "Tasks for you" meta.
  String get tasksMeta => isNow ? (d.summary.tasksToDo > 0 ? '${d.summary.tasksToDo} to do' : 'All done') : taskTile.meta;

  // ── Watch list ────────────────────────────────────────────────────────────

  List<JoinerWatch> _of(List<JoinerWatch> list) => [
    for (final w in list)
      if (isNow ? (_idx(w.step) == current || (_idx(w.step) < current && !w.watched)) : _idx(w.step) == at) w,
  ];

  late final List<JoinerWatch> videos = _of(d.watch);
  late final List<JoinerWatch> trainings = _of(d.trainings);

  bool get showsWatch => videos.length + trainings.length > 0;

  ({String label, String title, String meta}) get watchTile {
    final first = videos.firstOrNull ?? trainings.firstOrNull;
    final n = videos.length + trainings.length;
    final len = first?.length ?? '';
    return (label: isNow ? 'UP NEXT' : inLabel, title: first?.title ?? '', meta: [if (len.isNotEmpty) len, _plural(n, 'item', 'items')].join(' · '));
  }

  // ── Sowaka tour ───────────────────────────────────────────────────────────

  /// Day 1 and Week 1 (looked at), and Month 1 while a lesson is left.
  bool get showsTour =>
      d.tour.lessons.isNotEmpty && (at <= 1 || (isNow && d.tour.today != null && d.step == 'm1'));

  // ── Devices, profile, check-ins ───────────────────────────────────────────

  /// Day 1's, and later while something is still being set up.
  bool get showsDevices => isNow && d.devices.isNotEmpty && (d.step == 'd1' || d.devices.any((x) => !x.ready));

  /// Day 1 and Week 1.
  bool get showsProfile => isNow && d.profile.total > 0 && (d.step == 'd1' || d.step == 'w1');

  bool get showsCheckin => isNow && d.summary.checkinDueTitle != null;

  bool get showsGoals => isNow && (d.goals?.count ?? 0) > 0;

  bool get showsPunch => isNow && d.step == 'd1' && d.firstPunchAt == null;
}

String _plural(int n, String one, String many) => '$n ${n == 1 ? one : many}';

String plural(int n, String one, String many) => _plural(n, one, many);

/// "in 6 days", "in 1 day", "today".
String inDaysText(int days) => days <= 0
    ? 'today'
    : days == 1
    ? 'in 1 day'
    : 'in $days days';
