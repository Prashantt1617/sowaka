import 'dart:async';

import 'package:flutter/material.dart';

import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import '../../../manager/data/manager_models.dart' show ManagerTab;
import '../onboarding_launcher.dart';
import 'first_punch.dart';
import 'notes_screen.dart';
import 'onboarding_kit.dart';
import 'onboarding_tiles.dart';
import 'plant.dart';
import 'starter_task_screen.dart';
import 'task_row.dart';
import 'week_done_screen.dart';

/// A2 · the joiner's onboarding home (6Zs §5.3), in priority order: where
/// they are (plant, day label, stage, the journey bar on "Journey"), the one
/// thing up next, then every task in one list — meetings in time order,
/// untimed last as "Any time", done ones folded into "n done".
class OnboardingHomeScreen extends StatefulWidget {
  const OnboardingHomeScreen({super.key, required this.shell});

  final OnboardingShell shell;

  @override
  State<OnboardingHomeScreen> createState() => _OnboardingHomeScreenState();
}

class _OnboardingHomeScreenState extends State<OnboardingHomeScreen> {
  OnboardingHome? _home;
  List<StarterTask> _starterTasks = const [];
  List<OneOnOneNote> _notes = const [];
  String? _error;
  bool _journeyOpen = false;
  bool _doneOpen = false;
  bool _weekDoneChecked = false;

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    unawaited(_first());
  }

  /// Last time's home from the device at once; the live read replaces it.
  Future<void> _first() async {
    final kept = await _shell.api.fromDevice(_read);
    if (kept != null && mounted && _home == null) {
      setState(() {
        _home = kept[0] as OnboardingHome;
        _starterTasks = kept[1] as List<StarterTask>;
        _notes = kept[2] as List<OneOnOneNote>;
      });
    }
    await _load();
  }

  static Future<List<Object?>> _read(OnboardingApi api) => Future.wait<Object?>([
    api.fetchHome(),
    api.fetchStarterTasks().then<Object?>((v) => v, onError: (_) => const <StarterTask>[]),
    api.fetchNotes().then<Object?>((v) => v, onError: (_) => const <OneOnOneNote>[]),
  ]);

  Future<void> _load() async {
    try {
      final results = await _read(_shell.api);
      if (!mounted) return;
      final home = results[0] as OnboardingHome;
      setState(() {
        _home = home;
        _starterTasks = results[1] as List<StarterTask>;
        _notes = results[2] as List<OneOnOneNote>;
        _error = null;
      });
      // The tile's count follows what was just read.
      unawaited(LifecycleMeStore.instance.refresh(_shell.api));
      unawaited(_maybeShowWeekDone(home));
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    }
  }

  /// A8 shows once, on the first open after Tj + 7: the server says when
  /// (`showWeekDone`) and is told it was seen, so it never shows again on
  /// this or any other device.
  Future<void> _maybeShowWeekDone(OnboardingHome home) async {
    if (_weekDoneChecked || !home.showWeekDone) return;
    _weekDoneChecked = true;
    try {
      await _shell.api.markWeekDoneSeen();
    } catch (_) {
      // Shown anyway; the next open asks the server again.
    }
    if (!mounted) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => WeekDoneScreen(shell: _shell, home: home)),
    );
  }

  Future<void> _open(TaskView task) async {
    await openOnboardingTask(context, _shell, task, home: _home, starterTasks: _starterTasks);
    if (mounted) await _load();
  }

  Future<void> _openPage(Widget page) async {
    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => page));
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final home = _home;
    return OnbScaffold(
      shell: _shell,
      title: 'Onboarding',
      offline: home != null && _error != null,
      body: home == null
          ? OnbLoadState(error: _error, onRetry: _load)
          : RefreshIndicator(onRefresh: _load, child: _body(home)),
    );
  }

  Widget _body(OnboardingHome home) {
    final now = _shell.now();
    // Day 1, before the first punch-in: its own card (J1), so the face task
    // is neither Up next nor a row of its own while the card shows.
    final firstPunch = home.needsFirstPunchOn(now) && (_shell.tabs.isEmpty || _shell.tabs.contains(ManagerTab.quick));
    bool isFaceTask(TaskView? t) => firstPunch && t?.systemKey == 'register_face';
    final serverUpNext = isFaceTask(home.upNext) ? null : home.upNext;
    final upNext = serverUpNext ??
        pickUpNext([for (final t in [...home.today, ...home.later]) if (!isFaceTask(t)) t], now);
    // Each thing once: the 1:1 notes and the starter tasks have rows of their
    // own below (from their own reads), so the server's rows for them are not
    // drawn again, and whatever is Up next is not repeated in the list.
    final starterIds = {for (final t in _starterTasks) t.id};
    bool drawnElsewhere(TaskView t) =>
        t.id == upNext?.id ||
        isFaceTask(t) ||
        (_notes.isNotEmpty && t.systemKey == 'one_on_one_notes' && t.id == 'notes') ||
        (t.systemKey == 'starter_task' && starterIds.contains(t.id));
    final openStarters = [for (final t in _starterTasks) if (!t.done && t.id != upNext?.id) t];
    final dayLabel = home.dayLabelOn(now);
    final day1 = dayLabel == 'Day 1';
    final allOpen = orderTaskList([
      for (final task in home.today)
        if (!drawnElsewhere(task) && !task.isDone) task,
    ]);
    // On Day 1 "Today" is the day's items (its meetings, what is due today);
    // the rest of the week waits under This week, so the day fits above the nav.
    bool isToday(TaskView t) {
      final at = t.startsAt ?? t.dueAt;
      return at == null || calendarDaysBetween(now, at) <= 0;
    }
    final open = day1 ? allOpen.where(isToday).toList() : allOpen;
    final thisWeek = day1 ? allOpen.where((t) => !isToday(t)).toList() : const <TaskView>[];
    final later = orderTaskList([
      for (final task in home.later)
        if (!drawnElsewhere(task) && !task.isDone) task,
    ]);
    final done = [
      for (final t in [...home.done, ...home.today.where((t) => t.isDone)])
        if (!(_notes.isNotEmpty && t.id == 'notes')) t,
    ];
    final listTitle = day1
        ? 'Today'
        : home.stage == 'welcome_week1'
        ? 'This week'
        : 'This month';
    final total = open.length + done.length + (upNext == null ? 0 : 1) + openStarters.length;
    final unseenNotes = _notes.where((n) => !n.seen).length;
    final latestNote = _notes.isEmpty ? null : _notes.first;
    final manager = home.managerName ?? _starterTasks.map((t) => t.assignedByName).nonNulls.firstOrNull;

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        OnbRise(child: _hereCard(home, dayLabel, now)),
        // Day 1, before the first punch-in: learn it on the Actions tab (J1).
        if (firstPunch) ...[
          const SizedBox(height: 14),
          OnbRise(delay: 60, child: FirstPunchCard(onTap: () => FirstPunchTour.start(context, _shell))),
        ],
        // The artifact's tiles: Meetings, Tasks, Sowaka tour, Devices and accesses.
        const SizedBox(height: 14),
        OnbRise(delay: 30, child: OnbTileGrid(shell: _shell, home: home, onChanged: _load)),
        if (upNext != null) ...[
          const SizedBox(height: 14),
          OnbRise(delay: 60, child: _UpNextCard(task: upNext, now: now, onTap: () => _open(upNext))),
        ],
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: Text(listTitle, style: _A2Text.listTitle)),
            Text('${done.length} of ${total == 0 ? done.length : total} done', style: _A2Text.listMeta),
          ],
        ),
        const SizedBox(height: 10),
        if (done.isNotEmpty) ...[
          _DoneSummary(
            done: done,
            open: _doneOpen,
            now: now,
            onToggle: () => setState(() => _doneOpen = !_doneOpen),
          ),
          const SizedBox(height: 8),
        ],
        for (final task in openStarters)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OnbTaskRow(
              key: ValueKey('starter-${task.id}'),
              emoji: '🎯',
              title: 'Starter task from ${task.assignedByName ?? manager ?? 'your manager'}',
              meta: [
                task.title,
                if (task.dueAt != null) 'due ${onbRelativeDay(task.dueAt!, now).toLowerCase() == 'today' ? 'today' : onbDay(task.dueAt!)}',
              ].join(' · '),
              onTap: () => _openPage(StarterTaskScreen(shell: _shell, taskId: task.id, initial: task)),
            ),
          ),
        if (latestNote != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OnbTaskRow(
              key: const ValueKey('notes-row'),
              emoji: '📝',
              title: 'Notes from your 1:1',
              meta: [
                'Shared by ${latestNote.authorName ?? manager ?? 'your manager'}',
                if ((latestNote.sharedAt ?? latestNote.createdAt) case final at?) onbDay(at),
              ].join(' · '),
              count: unseenNotes > 0 ? '$unseenNotes new' : null,
              done: unseenNotes == 0,
              onTap: () => _openPage(NotesScreen(shell: _shell)),
            ),
          ),
        for (final task in open)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OnbTaskRow.task(task, now, onTap: () => _open(task)),
          ),
        if (open.isEmpty && openStarters.isEmpty && upNext == null && thisWeek.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text('Nothing left for now. Nice work.', style: OnbText.body),
          ),
        if (thisWeek.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text('THIS WEEK', style: OnbText.eyebrow),
          const SizedBox(height: 8),
          for (final task in thisWeek)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: OnbTaskRow.task(task, now, onTap: () => _open(task)),
            ),
        ],
        if (later.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text('LATER', style: OnbText.eyebrow),
          const SizedBox(height: 8),
          for (final task in later)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: OnbTaskRow.task(task, now, onTap: () => _open(task)),
            ),
        ],
      ],
    );
  }

  Widget _hereCard(OnboardingHome home, String dayLabel, DateTime now) {
    final stage = onboardingStageLabel(home.stage);
    final next = nextOnboardingStageLabel(home.stage);
    final journey = home.journey;
    return OnbCard(
      radius: 20,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // The plant on its tile, as drawn.
              Container(
                width: 52,
                height: 58,
                decoration: BoxDecoration(color: OnbColors.tint, borderRadius: BorderRadius.circular(14)),
                alignment: Alignment.bottomCenter,
                child: Plant.of(home.plant, size: 46, showPill: false),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('YOU ARE HERE', style: _A2Text.eyebrow),
                    const SizedBox(height: 2),
                    Text(dayLabel, key: const ValueKey('day-label'), style: _A2Text.day),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        Flexible(child: Text(stage, style: OnbText.label)),
                        if (home.plant.droop) ...[
                          const SizedBox(width: 6),
                          const OnbTag('Needs water', tone: OnbTone.needsWater),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              if (journey.isNotEmpty)
                Semantics(
                  button: true,
                  expanded: _journeyOpen,
                  child: TextButton(
                    key: const ValueKey('journey-toggle'),
                    onPressed: () => setState(() => _journeyOpen = !_journeyOpen),
                    style: TextButton.styleFrom(
                      foregroundColor: OnbColors.text,
                      backgroundColor: Colors.white,
                      shape: const StadiumBorder(side: BorderSide(color: OnbColors.lineDark)),
                      minimumSize: const Size(0, 34),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text('Journey', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 12)),
                        const SizedBox(width: 4),
                        AnimatedRotation(
                          turns: _journeyOpen ? 0.5 : 0,
                          duration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 200),
                          child: const Icon(Icons.expand_more_rounded, size: 14),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
          if (_journeyOpen && journey.isNotEmpty) ...[
            const SizedBox(height: 16),
            JourneyBar(
              stages: journey,
              currentFill: stageFill(stage: home.stage, tj: home.tj, today: now, months: _probationMonths(journey)),
              dayLabel: dayLabel,
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                if (next != null) Expanded(child: Text('Next stage: $next', style: OnbText.label)) else const Spacer(),
                OnbLink(label: 'Full journey', onTap: () => showJourneySheet(context, journey, dayLabel)),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// How many probation months the journey's stages span (Months 2–5 → 6).
int _probationMonths(List<JourneyStage> stages) {
  for (final stage in stages) {
    final m = RegExp(r'Months 2–(\d+)').firstMatch(stage.label);
    if (m != null) return int.parse(m.group(1)!) + 1;
    if (stage.label == 'Month 2') return 3;
  }
  return 6;
}

/// How far into the current stage the joiner is, for the bar's fill: a
/// seventh a day in week 1; through month 1 by days; through months 2 to
/// the one before last by months; halfway otherwise.
double stageFill({String? stage, DateTime? tj, required DateTime today, int months = 6}) {
  if (tj == null) return 0.5;
  final joined = dateOnly(tj);
  switch (stage) {
    case 'welcome_week1':
      return week1Fill(tj: tj, today: today);
    case 'settling_in':
      final end = addMonths(joined, 1);
      final total = calendarDaysBetween(joined.add(const Duration(days: 7)), end);
      return total <= 0 ? 0.5 : (calendarDaysBetween(joined.add(const Duration(days: 7)), today) / total).clamp(0.05, 1.0);
    case 'growing_gains':
      final span = (months - 2).clamp(1, 12);
      var month = 1;
      while (!dateOnly(today).isBefore(addMonths(joined, month))) {
        month++;
      }
      return ((month - 1) / span).clamp(0.05, 1.0);
    default:
      return 0.5;
  }
}

/// The brand-filled Up next card: eyebrow, the title, its meta, a round go.
class _UpNextCard extends StatelessWidget {
  const _UpNextCard({required this.task, required this.now, required this.onTap});

  final TaskView task;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final meta = [taskMeta(task, now), if (task.mustDo) 'must-do'].join(' · ');
    return Semantics(
      button: true,
      label: 'Up next: ${task.title}. $meta',
      child: Material(
        key: const ValueKey('up-next'),
        color: OnbColors.primary,
        borderRadius: BorderRadius.circular(20),
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: ExcludeSemantics(
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('UP NEXT', style: _A2Text.upNextEyebrow),
                        const SizedBox(height: 3),
                        Text(task.title, style: _A2Text.upNextTitle),
                        const SizedBox(height: 3),
                        Text(meta, style: _A2Text.upNextMeta),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Container(
                    width: 40,
                    height: 40,
                    decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                    child: const Icon(Icons.arrow_forward_rounded, color: OnbColors.primary),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// "n done": a tick, the count, what was done, and View / Hide. Open, the
/// done rows sit under it, about two at a time, scrolling inside.
class _DoneSummary extends StatelessWidget {
  const _DoneSummary({required this.done, required this.open, required this.now, required this.onToggle});

  final List<TaskView> done;
  final bool open;
  final DateTime now;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) => OnbCard(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
    radius: 16,
    child: Column(
      children: [
        Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(color: OnbColors.doneTint, borderRadius: BorderRadius.circular(10)),
              child: const Icon(Icons.check_rounded, color: OnbColors.doneText),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${done.length} done', style: OnbText.bodyStrong.copyWith(color: OnbColors.text2)),
                  Text(
                    done.map((t) => t.title).join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: OnbText.label,
                  ),
                ],
              ),
            ),
            Semantics(
              expanded: open,
              button: true,
              child: TextButton(
                key: const ValueKey('done-toggle'),
                onPressed: onToggle,
                style: TextButton.styleFrom(
                  foregroundColor: OnbColors.doneText,
                  backgroundColor: OnbColors.doneTint,
                  shape: const StadiumBorder(),
                  minimumSize: const Size(0, 26),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  textStyle: OnbText.button(context, size: 11, weight: FontWeight.w700),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(open ? 'Hide' : 'View'),
                    const SizedBox(width: 4),
                    Icon(open ? Icons.expand_less_rounded : Icons.expand_more_rounded, size: 12),
                  ],
                ),
              ),
            ),
          ],
        ),
        if (open) ...[
          const SizedBox(height: 8),
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 112),
            child: ListView(
              shrinkWrap: true,
              padding: EdgeInsets.zero,
              children: [
                for (final task in done)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(
                      children: [
                        const Icon(Icons.check_circle_rounded, size: 18, color: OnbColors.green),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            task.title,
                            style: OnbText.body.copyWith(decoration: TextDecoration.lineThrough, color: OnbColors.text3),
                          ),
                        ),
                        Text(taskMeta(task, now), style: OnbText.label),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ],
    ),
  );
}

/// The six-stage bar: done green, the current one filled to how far in, the
/// rest grey; each named under it.
class JourneyBar extends StatelessWidget {
  const JourneyBar({super.key, required this.stages, required this.currentFill, required this.dayLabel});

  final List<JourneyStage> stages;
  final double currentFill;
  final String dayLabel;

  String get _semantics {
    final parts = <String>[];
    for (final stage in stages) {
      if (stage.isDone) {
        parts.add('${stage.label.toLowerCase()} done');
      } else if (stage.isCurrent) {
        parts.add('now in ${stage.label.toLowerCase()} ($dayLabel)');
      } else {
        parts.add(stage.label.toLowerCase());
      }
    }
    return 'Journey: ${parts.join(', ')}';
  }

  @override
  Widget build(BuildContext context) => Semantics(
    label: _semantics,
    child: ExcludeSemantics(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final (index, stage) in stages.indexed) ...[
            if (index > 0) const SizedBox(width: 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(3),
                    child: SizedBox(
                      height: 6,
                      child: LinearProgressIndicator(
                        value: stage.isDone ? 1 : (stage.isCurrent ? currentFill : 0),
                        backgroundColor: OnbColors.line,
                        color: stage.isDone ? OnbColors.green : OnbColors.primary,
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    stage.label,
                    maxLines: 2,
                    style: OnbText.label.copyWith(
                      fontSize: 10,
                      fontWeight: stage.isCurrent ? FontWeight.w600 : FontWeight.w400,
                      color: stage.isCurrent ? OnbColors.primary : OnbColors.text3,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    ),
  );
}

/// "Full journey": every stage as a path node — done green, current in the
/// brand ring, the rest grey.
Future<void> showJourneySheet(BuildContext context, List<JourneyStage> stages, String dayLabel) => showOnbSheet<void>(
  context,
  builder: (context) => SingleChildScrollView(
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Your journey', style: OnbText.h1),
        const SizedBox(height: 16),
        for (final (index, stage) in stages.indexed)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Column(
                children: [
                  Container(
                    width: stage.isCurrent ? 32 : 26,
                    height: stage.isCurrent ? 32 : 26,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: stage.isDone ? OnbColors.green : Colors.white,
                      border: stage.isDone
                          ? null
                          : Border.all(color: stage.isCurrent ? OnbColors.primary : OnbColors.lineDark, width: stage.isCurrent ? 5 : 2),
                    ),
                    child: stage.isDone ? const Icon(Icons.check_rounded, size: 16, color: Colors.white) : null,
                  ),
                  if (index < stages.length - 1)
                    Container(width: 2, height: 26, color: stage.isDone ? OnbColors.green : OnbColors.line),
                ],
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(stage.label, style: OnbText.bodyStrong),
                      Text(
                        stage.isDone ? 'Done' : (stage.isCurrent ? 'You are here · $dayLabel' : 'Coming up'),
                        style: OnbText.label,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
      ],
    ),
  ),
);

/// A2's type, as the artboard sets it.
abstract final class _A2Text {
  static const eyebrow = TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.1, color: OnbColors.primary);
  static const day = TextStyle(fontSize: 26, height: 1.1, fontWeight: FontWeight.w800, letterSpacing: -0.52, color: OnbColors.text);
  static const listTitle = TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text);
  static const listMeta = TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text2);
  static const upNextEyebrow = TextStyle(fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: OnbColors.brandBorder);
  static const upNextTitle = TextStyle(fontSize: 18, height: 1.2, fontWeight: FontWeight.w700, color: Colors.white);
  static const upNextMeta = TextStyle(fontSize: 12, color: OnbColors.tint);
}
