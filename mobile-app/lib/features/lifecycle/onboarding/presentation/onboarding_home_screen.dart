import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import '../onboarding_launcher.dart';
import 'notes_screen.dart';
import 'onboarding_kit.dart';
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
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait<Object?>([
        _shell.api.fetchHome(),
        _shell.api.fetchStarterTasks().then<Object?>((v) => v, onError: (_) => const <StarterTask>[]),
        _shell.api.fetchNotes().then<Object?>((v) => v, onError: (_) => const <OneOnOneNote>[]),
      ]);
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

  /// A8 shows once, on the first open after week 1 is done.
  Future<void> _maybeShowWeekDone(OnboardingHome home) async {
    if (_weekDoneChecked) return;
    _weekDoneChecked = true;
    final weekDone =
        home.stage == 'settling_in' && home.all.every((t) => t.systemKey != 'week1_done' || t.isDone);
    if (!weekDone || home.journeyId.isEmpty) return;
    final key = 'lifecycle.weekDoneSeen.${home.journeyId}';
    try {
      final prefs = await SharedPreferences.getInstance();
      if (prefs.getBool(key) == true) return;
      await prefs.setBool(key, true);
    } catch (_) {
      return;
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
      body: home == null
          ? OnbLoadState(error: _error, onRetry: _load)
          : RefreshIndicator(onRefresh: _load, child: _body(home)),
    );
  }

  Widget _body(OnboardingHome home) {
    final now = _shell.now();
    final upNext = home.upNext ?? pickUpNext([...home.today, ...home.later], now);
    final hasStarter = _starterTasks.isNotEmpty;
    final open = orderTaskList([
      for (final task in home.today)
        if (task.id != upNext?.id && !task.isDone && !(hasStarter && task.systemKey == 'starter_task')) task,
    ]);
    final later = orderTaskList([
      for (final task in home.later)
        if (task.id != upNext?.id && !task.isDone && !(hasStarter && task.systemKey == 'starter_task')) task,
    ]);
    final done = [...home.done, ...home.today.where((t) => t.isDone)];
    final dayLabel = home.dayLabelOn(now);
    final listTitle = dayLabel == 'Day 1'
        ? 'Today'
        : home.stage == 'welcome_week1'
        ? 'This week'
        : 'This month';
    final total = open.length + done.length + (upNext == null ? 0 : 1) + _starterTasks.where((t) => !t.done).length;
    final unseenNotes = _notes.where((n) => !n.seen).length;
    final latestNote = _notes.isEmpty ? null : _notes.first;
    final manager = home.managerName ?? _starterTasks.map((t) => t.assignedByName).nonNulls.firstOrNull;

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        OnbRise(child: _hereCard(home, dayLabel, now)),
        if (upNext != null) ...[
          const SizedBox(height: 14),
          OnbRise(delay: 60, child: _UpNextCard(task: upNext, now: now, onTap: () => _open(upNext))),
        ],
        const SizedBox(height: 20),
        Row(
          children: [
            Expanded(child: Text(listTitle, style: OnbText.h1)),
            Text('${done.length} of ${total == 0 ? done.length : total} done', style: OnbText.label),
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
        for (final task in _starterTasks)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OnbTaskRow(
              key: ValueKey('starter-${task.id}'),
              emoji: '🎯',
              title: 'Starter task from ${task.assignedByName ?? manager ?? 'your manager'}',
              meta: [
                task.title,
                if (task.done) 'Done' else if (task.dueAt != null) 'due ${onbRelativeDay(task.dueAt!, now)}',
              ].join(' · '),
              done: task.done,
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
        if (open.isEmpty && _starterTasks.every((t) => t.done) && upNext == null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text('Nothing left for now. Nice work.', style: OnbText.body),
          ),
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
      radius: 24,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Plant.of(home.plant, size: 46, showPill: false),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('YOU ARE HERE', style: OnbText.eyebrow),
                    const SizedBox(height: 2),
                    Text(dayLabel, key: const ValueKey('day-label'), style: OnbText.displayXl(32)),
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
                      foregroundColor: OnbColors.primary,
                      backgroundColor: OnbColors.tint,
                      shape: const StadiumBorder(),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text('Journey', style: TextStyle(fontFamily: 'Sora', fontWeight: FontWeight.w600, fontSize: 13)),
                        AnimatedRotation(
                          turns: _journeyOpen ? 0.5 : 0,
                          duration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 200),
                          child: const Icon(Icons.expand_more_rounded, size: 18),
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
              currentFill: home.stage == 'welcome_week1' && home.tj != null ? week1Fill(tj: home.tj!, today: now) : 0.5,
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
            padding: const EdgeInsets.fromLTRB(18, 16, 14, 16),
            child: ExcludeSemantics(
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('UP NEXT', style: OnbText.eyebrow.copyWith(color: Colors.white70)),
                        const SizedBox(height: 6),
                        Text(task.title, style: OnbText.display.copyWith(color: Colors.white, fontSize: 22)),
                        const SizedBox(height: 4),
                        Text(meta, style: OnbText.label.copyWith(color: Colors.white.withValues(alpha: 0.85))),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Container(
                    width: 44,
                    height: 44,
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
    padding: const EdgeInsets.all(12),
    radius: 16,
    child: Column(
      children: [
        Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(color: OnbColors.doneTint, borderRadius: BorderRadius.circular(12)),
              child: const Icon(Icons.check_rounded, color: OnbColors.doneText),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${done.length} done', style: OnbText.bodyStrong),
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
                  foregroundColor: OnbColors.primary,
                  backgroundColor: OnbColors.tint,
                  shape: const StadiumBorder(),
                  minimumSize: const Size(60, 32),
                ),
                child: Text(open ? 'Hide' : 'View'),
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
