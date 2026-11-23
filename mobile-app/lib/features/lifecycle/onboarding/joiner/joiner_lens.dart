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

  /// No meetings from the server (the template has none): no Meetings tile.
  bool get showsMeetings => d.meetings.isNotEmpty && (isNow ? meetingRows.isNotEmpty : meetingsThere.isNotEmpty);

  // ── Tasks ─────────────────────────────────────────────────────────────────

  late final List<JoinerTask> tasksNow = [
    for (final t in d.tasks)
      if (_idx(t.step) == current || (t.carriedFrom != null && !d.isConfirmed)) t,
  ];

  late final List<JoinerTask> tasksSoon = [for (final t in d.tasks) if (_idx(t.step) > current) t];

  late final List<JoinerTask> tasksThere = [
    for (final t in d.tasks)
      if (_idx(t.step) == at && t.carriedFrom == null && !tasksNow.any((n) => n.id == t.id)) t,
    // The canvas's look at Confirmed: HR's letter, which exists only once it is sent.
    if (viewedKey == 'confirmed' && !isNow && !d.tasks.any((t) => t.step == 'confirmed'))
      const JoinerTask(id: 'letter:ahead', title: 'Read your confirmation letter', type: 'ack', verb: 'Read', meta: 'From HR', step: 'confirmed', state: 'locked'),
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

  /// The whole watch list (videos, pictures, text cards) in the template's
  /// order, whatever the step: the stories of "Life at …", as the portal
  /// shows them (24 Nov, HR: "it still shows only one story").
  late final List<JoinerWatch> videos = [...d.watch];

  bool get showsWatch => videos.isNotEmpty;

  /// The stage's trainings (a video or a PDF): shown only when the server
  /// sends some, under the company's own name for them.
  late final List<JoinerWatch> trainings = [
    for (final w in d.trainings)
      if (_idx(w.step) == (isNow ? current : at)) w,
  ];

  bool get showsTrainings => trainings.isNotEmpty;

  /// Where the stories open: the first not yet watched, else the first.
  int get firstStory {
    final i = videos.indexWhere((w) => !w.watched);
    return i < 0 ? 0 : i;
  }

  // ── Sowaka tour ───────────────────────────────────────────────────────────

  /// Day 1 and Week 1 (looked at), and Month 1 while a lesson is left.
  /// Shown at every step (24 Nov, HR: show it "as done state" rather than
  /// hide it): the next lesson, or all done.
  bool get showsTour => d.tour.lessons.isNotEmpty && (at <= 1 || isNow);

  // ── Devices, profile, check-ins ───────────────────────────────────────────

  /// Day 1's only, as the canvas draws it.
  bool get showsDevices => isNow && d.devices.isNotEmpty && d.step == 'd1';

  /// Day 1 and Week 1.
  /// At every step: to finish, or done (100%).
  bool get showsProfile => isNow && d.profile.total > 0;

  /// At every step while the template has check-ins: the one open now, the
  /// next one and when it opens, or all sent.
  bool get showsCheckin => isNow && (d.checkins.isNotEmpty || d.summary.checkinDueTitle != null);

  /// From Month 1, while on probation: the manager's monthly KPI reviews,
  /// read in Grow.
  bool get showsPerformance => isNow && !d.isConfirmed && current >= d.indexOf('m1') && d.indexOf('m1') >= 0;

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
