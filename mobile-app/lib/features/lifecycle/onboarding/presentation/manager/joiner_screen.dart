import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../shared/app_toast.dart';
import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart';
import '../links.dart';
import '../onboarding_kit.dart';
import '../plant.dart';
import '../task_row.dart';
import 'joiner_setup_screen.dart';
import 'probation_review_screen.dart';
import 'starter_review_screen.dart';

/// M2 · a joiner's week as their manager sees it (6Zs §5.4): where they
/// are, the manager's own tasks with a pill each (Join / time / Assign /
/// Add / Set up), the set-up (people, buddy, welcome note, goals), the
/// starter tasks and notes, and the joiner's own progress, read-only.
class JoinerScreen extends StatefulWidget {
  const JoinerScreen({super.key, required this.shell, required this.journeyId, this.openSetup = false, this.summary});

  final OnboardingShell shell;
  final String journeyId;

  /// The Team tab's row for this joiner: the card paints from it at once.
  final JoinerSummary? summary;

  /// Opens the set-up straight away (from the "set up your joiner" push).
  final bool openSetup;

  @override
  State<JoinerScreen> createState() => _JoinerScreenState();
}

class _JoinerScreenState extends State<JoinerScreen> {
  JoinerDetail? _detail;
  String? _error;
  bool _openedSetup = false;
  final Set<String> _busyTasks = {};

  /// The done row is closed on every visit.
  bool _doneOpen = false;

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    unawaited(_first());
  }

  /// Last time's M2 from the device at once (or the Team tab's row), then live.
  Future<void> _first() async {
    final kept = await _shell.api.fromDevice((api) => api.fetchJoiner(widget.journeyId));
    if (kept != null && mounted && _detail == null) setState(() => _detail = kept);
    await _load();
  }

  Future<void> _load() async {
    try {
      final detail = await _shell.api.fetchJoiner(widget.journeyId);
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _error = null;
      });
      if (widget.openSetup && !_openedSetup) {
        _openedSetup = true;
        await _setup(detail);
      }
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    }
  }

  Future<void> _push(Widget page) async {
    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => page));
    if (mounted) await _load();
  }

  Future<void> _setup(JoinerDetail detail) =>
      _push(JoinerSetupScreen(shell: _shell, journeyId: widget.journeyId, detail: detail));

  Future<void> _assign(JoinerDetail detail) async {
    final sent = await showStarterTaskSheet(context, _shell, widget.journeyId, detail.joiner.firstName);
    if (sent == true && mounted) {
      showAppToast(context, 'Sent to ${detail.joiner.firstName}');
      await _load();
    }
  }

  Future<void> _note(JoinerDetail detail) async {
    final saved = await showOneOnOneNoteSheet(context, _shell, widget.journeyId, detail.joiner.firstName);
    if (saved == true && mounted) await _load();
  }

  Future<void> _welcome(JoinerDetail detail) async {
    final sent = await showWelcomePostSheet(context, _shell, widget.journeyId, detail.joiner.firstName);
    if (sent == true && mounted) {
      showAppToast(context, 'Posted on Connect');
      await _load();
    }
  }

  Future<void> _markDone(TaskView task) async {
    setState(() => _busyTasks.add(task.id));
    try {
      await _shell.api.managerTaskDone(widget.journeyId, task.id);
      await _load();
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busyTasks.remove(task.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    final summary = widget.summary;
    return OnbScaffold(
      shell: _shell,
      title: detail?.joiner.name ?? summary?.name ?? 'New joiner',
      offline: detail != null && _error != null,
      body: detail != null
          ? RefreshIndicator(onRefresh: _load, child: _body(detail))
          : summary != null && _error == null
          // The card from the Team tab's row while the week loads: never a blank page.
          ? ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
              children: [
                _hero(summary, _shell.now()),
                const SizedBox(height: 24),
                const Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))),
              ],
            )
          : OnbLoadState(error: _error, onRetry: _load),
    );
  }

  /// M2's one card: the plant on its tile, the stage, the big week label,
  /// the role and joining date.
  Widget _hero(JoinerSummary joiner, DateTime now) => Container(
    key: const ValueKey('mgr-hero'),
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: OnbColors.line),
    ),
    child: Row(
      children: [
        Container(
          width: 56,
          height: 64,
          decoration: BoxDecoration(color: OnbColors.tint, borderRadius: BorderRadius.circular(14)),
          alignment: Alignment.bottomCenter,
          child: Plant.of(joiner.plant, size: 50, sway: false, showPill: false),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                onboardingStageLabel(joiner.stage).toUpperCase(),
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.1, color: OnbColors.primary),
              ),
              const SizedBox(height: 2),
              Text(
                joiner.dayLabelOn(now),
                style: const TextStyle(fontSize: 26, height: 1.1, fontWeight: FontWeight.w800, letterSpacing: -0.52, color: OnbColors.text),
              ),
              const SizedBox(height: 2),
              Text(
                [
                  ?joiner.designation,
                  if (joiner.tj != null) (joiner.preboarding ? 'joins ${onbDay(joiner.tj!)}' : 'joined ${onbDay(joiner.tj!)}'),
                ].join(' · '),
                style: const TextStyle(fontSize: 12, color: OnbColors.text3),
              ),
            ],
          ),
        ),
      ],
    ),
  );

  Widget _body(JoinerDetail detail) {
    final now = _shell.now();
    final joiner = detail.joiner;
    final first = joiner.firstName;
    // "Your tasks this week": open ones, and locked ones only when they open within the week.
    bool soon(TaskView t) => !t.isLocked || (t.opensAt != null && calendarDaysBetween(now, t.opensAt!) <= 7);
    final mine = orderTaskList(detail.managerTasks.where((t) => !t.isClosed && soon(t)).toList());
    // Done this past week stay on the list, ticked green (the design's done pill).
    final mineDone = detail.managerTasks
        .where((t) => t.isDone && (t.doneAt == null || calendarDaysBetween(t.doneAt!, now) <= 7))
        .toList();
    final theirs = detail.joinerTasks;
    final theirsDone = theirs.where((t) => t.isDone).length;
    final late = theirs.where((t) => t.late && !t.isDone).length;
    final inProbation = joiner.stage != null && joiner.stage != 'pre_boarding' && joiner.stage != 'welcome_week1';
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        _hero(joiner, now),
        const SizedBox(height: 14),
        const Text('Your tasks this week', style: _MgrText.section),
        const SizedBox(height: 8),
        if (mine.isEmpty && mineDone.isEmpty && !detail.welcomeCanPost && detail.starterTasks.isEmpty)
          const Text('Nothing waiting on you.', style: OnbText.body),
        // The timed ones first, then "Post a welcome", then the rest (as drawn).
        for (final task in mine.where((t) => t.startsAt != null)) _taskRow(detail, task, now),
        // M2 "🎉 Post a welcome · Shows on the Connect feed · Write", once per joiner.
        if (detail.welcomeCanPost)
          _MgrTaskRow(
            key: const ValueKey('mgr-welcome'),
            emoji: '🎉',
            tint: OnbColors.mustTint,
            title: 'Post a welcome',
            meta: 'Shows on the Connect feed',
            pill: _Pill(key: const ValueKey('welcome-write'), label: 'Write', onTap: () => _welcome(detail)),
          ),
        for (final task in mine.where((t) => t.startsAt == null)) _taskRow(detail, task, now),
        // The starter tasks given: due, or done with the joiner's note to read (M3).
        for (final task in detail.starterTasks)
          _MgrTaskRow(
            key: ValueKey('mgr-starter-${task.id}'),
            emoji: '🎯',
            tint: _purpleTint,
            title: task.title,
            meta: task.done
                ? '$first marked it done${task.doneAt == null ? '' : ' · ${onbDay(task.doneAt!)}'}'
                : (task.dueAt == null ? 'Starter task' : 'Due by ${onbDay(task.dueAt!)}'),
            pill: task.done
                ? _Pill(
                    key: ValueKey('starter-open-${task.id}'),
                    label: task.managerReply == null ? 'Reply' : 'Done',
                    state: _PillState.done,
                    onTap: () => _push(
                      StarterReviewScreen(
                        shell: _shell,
                        journeyId: widget.journeyId,
                        starterTaskId: task.id,
                        initial: task,
                        joinerName: joiner.name,
                        joinerPhotoUrl: joiner.photoUrl,
                      ),
                    ),
                  )
                : const _Pill(label: 'Sent', onTap: null),
          ),
        // What is done folds into one row, as the joiner's home does ("2 done · View").
        if (mineDone.isNotEmpty || detail.welcomePostedAt != null)
          _DoneGroup(
            open: _doneOpen,
            onToggle: () => setState(() => _doneOpen = !_doneOpen),
            rows: [
              for (final task in mineDone)
                (
                  key: 'mgr-done-${task.id}',
                  title: task.title,
                  meta: taskMeta(task, now, forManager: true),
                  onTap: _setupKeys.contains(task.systemKey) ? () => _setup(detail) : null,
                ),
              if (detail.welcomePostedAt != null)
                (key: 'mgr-welcome-done', title: 'Post a welcome', meta: 'Posted ${onbDay(detail.welcomePostedAt!)}', onTap: null),
            ],
          ),
        const SizedBox(height: 6),
        // The joiner's own progress, read-only.
        Container(
          key: const ValueKey('joiner-progress'),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: OnbColors.line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text('$first’s own tasks', style: _MgrText.cardTitle)),
                  Text('$theirsDone of ${theirs.length} done', style: _MgrText.count),
                ],
              ),
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: LinearProgressIndicator(
                  value: theirs.isEmpty ? 0 : theirsDone / theirs.length,
                  minHeight: 6,
                  backgroundColor: OnbColors.line,
                  color: OnbColors.primary,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                [
                  late == 0 ? 'On track.' : '$late ${late == 1 ? 'task is' : 'tasks are'} late.',
                  if (detail.joinerNextDue case final next? when next.dueAt != null)
                    '${next.title} ${next.title.endsWith('s') ? 'are' : 'is'} due ${onbDay(next.dueAt!)}.',
                ].join(' '),
                key: const ValueKey('joiner-on-track'),
                style: _MgrText.meta.copyWith(color: late == 0 ? OnbColors.text3 : OnbColors.waterText),
              ),
            ],
          ),
        ),
        // Below the drawn week: what only exists later (shared notes, probation months, survey summaries).
        if (detail.notes.isNotEmpty) ...[
          const SizedBox(height: 14),
          Row(
            children: [
              const Expanded(child: Text('Notes from your 1:1s', style: _MgrText.section)),
              OnbLink(key: const ValueKey('add-note-more'), label: 'Add', onTap: () => _note(detail)),
            ],
          ),
          const SizedBox(height: 8),
          for (final note in detail.notes)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: OnbColors.line),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(child: Text(note.createdAt == null ? '' : onbDayTime(note.createdAt!), style: _MgrText.meta)),
                        OnbTag(note.shared ? (note.seen ? 'Shared · seen' : 'Shared') : 'Private', tone: note.shared ? OnbTone.count : OnbTone.locked),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(note.text, style: OnbText.body),
                    for (final reply in note.replies)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text('${reply.mine ? 'You' : (reply.byName ?? first)}: ${reply.text}', style: _MgrText.meta),
                      ),
                  ],
                ),
              ),
            ),
        ],
        if (inProbation && detail.probation != null && detail.probation!.months.isNotEmpty) ...[
          const SizedBox(height: 14),
          const Text('Probation', style: _MgrText.section),
          const SizedBox(height: 8),
          for (final month in detail.probation!.months)
            _MgrTaskRow(
              key: ValueKey('mgr-month-${month.monthNo}'),
              emoji: '🪴',
              tint: OnbColors.doneTint,
              title: 'Month ${month.monthNo}',
              meta: [
                '${month.goals.length} goals',
                month.checkinEmployee == null ? 'no check-in yet' : '$first checked in',
                if (month.review != null) 'reviewed',
              ].join(' · '),
              pill: _Pill(
                label: month.review != null && month.bothCheckedIn ? 'Done' : 'Open',
                state: month.review != null && month.bothCheckedIn ? _PillState.done : _PillState.later,
                onTap: () => _push(
                  ProbationReviewScreen(
                    shell: _shell,
                    journeyId: widget.journeyId,
                    month: month.monthNo,
                    initial: month,
                    joinerName: joiner.name,
                  ),
                ),
              ),
            ),
        ],
        // One summary per survey kind, only once 3+ different people answered it (the server's rule).
        for (final survey in detail.surveys)
          if (survey.count >= 3) ...[
            const SizedBox(height: 12),
            OnbCard(
              key: ValueKey('survey-${survey.kind}'),
              child: Text(
                'Your team’s ${surveyKindName(survey.kind)}: ${survey.count} people answered'
                '${survey.avg == null ? '' : ', ${survey.avg!.toStringAsFixed(1)} out of 5 on average'}. Names are never shown.',
                style: OnbText.body,
              ),
            ),
          ],
      ],
    );
  }

  Widget _taskRow(JoinerDetail detail, TaskView task, DateTime now) => _MgrTaskRow(
    key: ValueKey('mgr-task-${task.id}'),
    emoji: _mgrEmoji(task),
    tint: _mgrTint(task),
    title: task.title,
    meta: _mgrMeta(task, now),
    late: task.late,
    pill: _pill(detail, task),
  );

  Widget _pill(JoinerDetail detail, TaskView task) {
    final now = _shell.now();
    if (_busyTasks.contains(task.id)) {
      return const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2));
    }
    switch (task.systemKey) {
      case 'starter_task':
        return _Pill(key: const ValueKey('assign-starter'), label: 'Assign', onTap: () => _assign(detail));
      case 'one_on_one_notes':
      case 'manager_30day_note':
        return _Pill(key: ValueKey(task.systemKey == 'one_on_one_notes' ? 'add-note' : 'add-note-${task.id}'), label: 'Add', onTap: () => _note(detail));
      case 'manager_setup':
      case 'assign_buddy':
      case 'probation_goals':
      case 'people_to_meet':
        return _Pill(key: ValueKey(task.systemKey == 'manager_setup' ? 'open-setup' : 'open-setup-${task.id}'), label: 'Set up', onTap: () => _setup(detail));
      case 'monthly_goals':
      case 'monthly_checkin':
      case 'monthly_review':
        final month = task.month ?? 1;
        return _Pill(
          label: 'Open',
          onTap: () => _push(
            ProbationReviewScreen(
              shell: _shell,
              journeyId: widget.journeyId,
              month: month,
              initial: detail.probation?.months.where((m) => m.monthNo == month).firstOrNull,
              joinerName: detail.joiner.name,
            ),
          ),
        );
    }
    final start = task.startsAt;
    if (start != null && !task.isDone) {
      final minutes = start.difference(now).inMinutes;
      final link = task.meeting?.link;
      if (minutes <= 10 && minutes >= -60 && link != null) {
        return _Pill(key: ValueKey('join-${task.id}'), label: 'Join', state: _PillState.now, onTap: () => openExternalLink(context, link));
      }
      if (minutes > 10) {
        return _Pill(label: calendarDaysBetween(now, start) == 0 ? compactTime(start) : onbDay(start).split(' ').first, onTap: null);
      }
    }
    // HR's decision (the Confirmation discussion) and anything HR records: no Done here.
    if (!managerMayTick(task)) {
      return _Pill(label: task.ownerRole == 'hr_manager' || task.ownerRole == 'hr' ? 'With HR' : 'Later', onTap: null);
    }
    return _Pill(key: ValueKey('done-${task.id}'), label: 'Mark done', onTap: () => _markDone(task));
  }
}

/// "4 PM", "11:30 AM": the pill's time, as the design writes it.
String compactTime(DateTime at) {
  final full = onbTime(at);
  return full.replaceFirst(':00 ', ' ');
}

const _purpleTint = Color(0xFFEEF0FF);

/// The set-up tasks: done, their pill reopens the set-up.
const _setupKeys = {'manager_setup', 'assign_buddy', 'probation_goals', 'people_to_meet'};

/// The manager's row icon (M2): their own words for the week's tasks.
String _mgrEmoji(TaskView task) => switch (task.systemKey) {
  'meet_manager' => '🤝',
  'meet_team' || 'welcome_induction' => '👋',
  'starter_task' => '🎯',
  'one_on_one_notes' || 'manager_30day_note' => '📝',
  _ => taskEmoji(task),
};

/// The tile behind it, one tint per kind, as drawn.
Color _mgrTint(TaskView task) => switch (task.systemKey) {
  'meet_manager' => OnbColors.tint,
  'meet_team' || 'welcome_induction' => OnbColors.doneTint,
  'starter_task' || 'probation_goals' || 'monthly_goals' => _purpleTint,
  'one_on_one_notes' || 'manager_30day_note' => OnbColors.screen,
  'monthly_checkin' || 'monthly_review' => OnbColors.doneTint,
  _ => OnbColors.screen,
};

/// The row's second line: "Mon · 11:00 AM · must-do", "Due by Fri 5 Dec",
/// "After you meet"; late and done as the task list words them.
String _mgrMeta(TaskView task, DateTime now) {
  final must = task.mustDo ? ' · must-do' : '';
  final start = task.startsAt;
  if (start != null && !task.isDone) return '${onbDay(start).split(' ').first} · ${onbTime(start)}$must';
  if (task.late || task.isDone) return '${taskMeta(task, now, forManager: true)}$must';
  if (task.systemKey == 'starter_task' && task.dueAt != null) return 'Due by ${onbDay(task.dueAt!)}$must';
  if (task.systemKey == 'one_on_one_notes') return 'After you meet$must';
  return '${taskMeta(task, now, forManager: true)}$must';
}

abstract final class _MgrText {
  static const section = TextStyle(fontSize: 16, fontWeight: FontWeight.w700, height: 1.3, color: OnbColors.text);
  static const cardTitle = TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: OnbColors.text);
  static const count = TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text);
  static const title = TextStyle(fontSize: 14, fontWeight: FontWeight.w600, height: 1.3, color: OnbColors.text);
  static const meta = TextStyle(fontSize: 12, height: 1.35, color: OnbColors.text3);
}

typedef _DoneRow = ({String key, String title, String meta, VoidCallback? onTap});

/// "4 done": a ticked row whose View opens the done tasks right under it (a
/// tick, the task crossed out, when), about two rows tall and scrolling.
class _DoneGroup extends StatelessWidget {
  const _DoneGroup({required this.open, required this.onToggle, required this.rows});

  final bool open;
  final VoidCallback onToggle;
  final List<_DoneRow> rows;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Material(
          key: const ValueKey('mgr-done-group'),
          color: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: OnbColors.line)),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onToggle,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(color: OnbColors.doneTint, borderRadius: BorderRadius.circular(12)),
                    alignment: Alignment.center,
                    child: const Text('✓', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: OnbColors.doneText)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${rows.length} done', style: _MgrText.title.copyWith(color: OnbColors.text2)),
                        const SizedBox(height: 3),
                        Text(rows.map((r) => r.title).join(' · '), style: _MgrText.meta, maxLines: 1, overflow: TextOverflow.ellipsis),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Container(
                    key: const ValueKey('mgr-done-toggle'),
                    height: 30,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: const ShapeDecoration(color: OnbColors.doneTint, shape: StadiumBorder()),
                    alignment: Alignment.center,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(open ? 'Hide' : 'View', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.doneText)),
                        const SizedBox(width: 4),
                        Icon(open ? Icons.expand_less_rounded : Icons.expand_more_rounded, size: 14, color: OnbColors.doneText),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        if (open)
          Container(
            constraints: const BoxConstraints(maxHeight: 120),
            margin: const EdgeInsets.only(left: 18, top: 4),
            padding: const EdgeInsets.only(left: 12),
            decoration: const BoxDecoration(border: Border(left: BorderSide(color: OnbColors.green, width: 2))),
            child: ListView(
              shrinkWrap: true,
              padding: EdgeInsets.zero,
              children: [
                for (final row in rows)
                  InkWell(
                    key: ValueKey(row.key),
                    onTap: row.onTap,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 5, horizontal: 4),
                      child: Row(
                        children: [
                          Container(
                            width: 20,
                            height: 20,
                            decoration: const BoxDecoration(color: OnbColors.green, shape: BoxShape.circle),
                            alignment: Alignment.center,
                            child: const Icon(Icons.check_rounded, size: 13, color: Colors.white),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  row.title,
                                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: OnbColors.text3, decoration: TextDecoration.lineThrough),
                                ),
                                Text(row.meta, style: const TextStyle(fontSize: 11, color: OnbColors.icon)),
                              ],
                            ),
                          ),
                          if (row.onTap != null) const Text('Edit', style: OnbText.link),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
      ],
    ),
  );
}

/// One of the manager's tasks on M2: the tinted icon tile, the task and its
/// when, and the pill that does it.
class _MgrTaskRow extends StatelessWidget {
  const _MgrTaskRow({
    super.key,
    required this.emoji,
    required this.tint,
    required this.title,
    required this.meta,
    required this.pill,
    this.late = false,
  });

  final String emoji;
  final Color tint;
  final String title;
  final String meta;
  final Widget pill;
  final bool late;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: OnbColors.line),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(12)),
            alignment: Alignment.center,
            child: Text(emoji, style: const TextStyle(fontSize: 20)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: _MgrText.title, maxLines: 2, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 3),
                Text(
                  meta,
                  style: _MgrText.meta.copyWith(color: late ? OnbColors.redText : OnbColors.text3),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          pill,
        ],
      ),
    ),
  );
}

/// The survey's name on M2.
String surveyKindName(String kind) => switch (kind) {
  'm3' => 'month-3 pulse survey',
  'm6' => 'month-6 pulse survey',
  _ => 'first-week survey',
};

/// The pill's three looks, as drawn: now (filled blue), later (grey), done (green).
enum _PillState { now, later, done }

class _Pill extends StatelessWidget {
  const _Pill({super.key, required this.label, required this.onTap, this.state = _PillState.later});

  final String label;
  final VoidCallback? onTap;
  final _PillState state;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (state) {
      _PillState.now => (OnbColors.primary, Colors.white),
      _PillState.done => (OnbColors.doneTint, OnbColors.doneText),
      _PillState.later => (OnbColors.screen, OnbColors.text2),
    };
    return Semantics(
      button: onTap != null,
      label: label,
      child: ExcludeSemantics(
        child: Material(
          color: bg,
          shape: const StadiumBorder(),
          child: InkWell(
            customBorder: const StadiumBorder(),
            onTap: onTap,
            child: Container(
              height: 30,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              alignment: Alignment.center,
              child: Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg)),
            ),
          ),
        ),
      ),
    );
  }
}

// ─── M2a · starter task sheet ───────────────────────────────────────────────

/// M2a: a task, when it is due (this Friday, next Monday, or a date picked)
/// and an optional note. Assign → the joiner's Up next with a push. True
/// once sent.
Future<bool?> showStarterTaskSheet(BuildContext context, OnboardingShell shell, String journeyId, String firstName) =>
    showOnbSheet<bool>(
      context,
      builder: (_) => _StarterTaskSheet(shell: shell, journeyId: journeyId, firstName: firstName),
    );

/// The due dates the sheet offers: the coming Friday and the Monday after
/// it (or the next ones, when today is already past them).
(DateTime friday, DateTime monday) starterDueChoices(DateTime now) {
  final today = dateOnly(now);
  var friday = today;
  while (friday.weekday != DateTime.friday || !friday.isAfter(today)) {
    friday = friday.add(const Duration(days: 1));
  }
  var monday = friday;
  while (monday.weekday != DateTime.monday) {
    monday = monday.add(const Duration(days: 1));
  }
  return (friday, monday);
}

class _StarterTaskSheet extends StatefulWidget {
  const _StarterTaskSheet({required this.shell, required this.journeyId, required this.firstName});

  final OnboardingShell shell;
  final String journeyId;
  final String firstName;

  @override
  State<_StarterTaskSheet> createState() => _StarterTaskSheetState();
}

class _StarterTaskSheetState extends State<_StarterTaskSheet> {
  final _title = TextEditingController();
  final _note = TextEditingController();
  final _link = TextEditingController();
  DateTime? _due;
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    _note.dispose();
    _link.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final now = widget.shell.now();
    final day = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(days: 3)),
      firstDate: dateOnly(now),
      lastDate: now.add(const Duration(days: 90)),
    );
    if (day != null && mounted) setState(() => _due = day);
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    try {
      await widget.shell.api.assignStarterTask(
        widget.journeyId,
        title: _title.text.trim(),
        note: _note.text,
        links: [if (_link.text.trim().isNotEmpty) _link.text.trim()],
        dueAt: _due,
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      showAppToast(context, onboardingErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final (friday, monday) = starterDueChoices(widget.shell.now());
    bool same(DateTime? a, DateTime b) => a != null && dateOnly(a) == dateOnly(b);
    final picked = _due != null && !same(_due, friday) && !same(_due, monday);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Give ${widget.firstName} a starter task', style: _SheetText.title),
          const SizedBox(height: 4),
          Text('Something small ${widget.firstName} can finish this week.', style: _SheetText.sub),
          const SizedBox(height: 16),
          const Text('Task', style: _SheetText.label),
          const SizedBox(height: 6),
          OnbTextArea(
            fieldKey: const ValueKey('starter-title'),
            controller: _title,
            hint: 'Redesign the leave request screen',
            minLines: 1,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 14),
          const Text('Due', style: _SheetText.label),
          const SizedBox(height: 6),
          Semantics(
            label: 'Due date',
            child: Row(
              children: [
                Expanded(
                  child: _DueButton(
                    key: const ValueKey('due-friday'),
                    label: onbDay(friday),
                    selected: same(_due, friday),
                    onTap: () => setState(() => _due = friday),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _DueButton(
                    key: const ValueKey('due-monday'),
                    label: onbDay(monday),
                    selected: same(_due, monday),
                    onTap: () => setState(() => _due = monday),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _DueButton(
                    key: const ValueKey('due-pick'),
                    label: picked ? onbDay(_due!) : 'Pick a date',
                    selected: picked,
                    onTap: _pick,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Text('Note for ${widget.firstName} (optional)', style: _SheetText.label),
          const SizedBox(height: 6),
          OnbTextArea(controller: _note, hint: 'Start with the research notes in the shared folder.', minLines: 2),
          const SizedBox(height: 10),
          OnbTextArea(controller: _link, hint: 'A link (optional)', minLines: 1),
          const SizedBox(height: 16),
          OnbPrimaryButton(
            key: const ValueKey('starter-assign'),
            label: 'Assign task',
            busy: _busy,
            onTap: _title.text.trim().isEmpty || _due == null ? null : _send,
          ),
        ],
      ),
    );
  }
}

/// M2a's due choice: one of three equal buttons, the chosen one outlined blue.
class _DueButton extends StatelessWidget {
  const _DueButton({super.key, required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: selected,
    child: Material(
      color: selected ? OnbColors.tint : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: selected ? OnbColors.primary : OnbColors.line, width: selected ? 2 : 1),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: SizedBox(
          height: 44,
          child: Center(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: selected ? OnbColors.primary : OnbColors.text),
            ),
          ),
        ),
      ),
    ),
  );
}

/// The manager's sheets (M2a, M2b), as drawn: a 22 title, a grey line, small labels.
abstract final class _SheetText {
  static const title = TextStyle(fontSize: 22, fontWeight: FontWeight.w700, height: 1.25, color: OnbColors.text);
  static const sub = TextStyle(fontSize: 13, height: 1.4, color: OnbColors.text3);
  static const label = TextStyle(fontSize: 12, height: 1.3, color: OnbColors.text2);
}

// ─── M2b · 1:1 notes sheet ──────────────────────────────────────────────────

/// M2b: notes from the 1:1, private to the manager and HR unless "Share
/// with [name]" is on (then the joiner gets them, with a push). True once
/// saved.
Future<bool?> showOneOnOneNoteSheet(BuildContext context, OnboardingShell shell, String journeyId, String firstName) =>
    showOnbSheet<bool>(context, builder: (_) => _NoteSheet(shell: shell, journeyId: journeyId, firstName: firstName));

class _NoteSheet extends StatefulWidget {
  const _NoteSheet({required this.shell, required this.journeyId, required this.firstName});

  final OnboardingShell shell;
  final String journeyId;
  final String firstName;

  @override
  State<_NoteSheet> createState() => _NoteSheetState();
}

class _NoteSheetState extends State<_NoteSheet> {
  final _text = TextEditingController();
  bool _shared = false;
  bool _busy = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await widget.shell.api.addNote(widget.journeyId, _text.text.trim(), shared: _shared);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      showAppToast(context, onboardingErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Notes from your 1:1', style: _SheetText.title),
        const SizedBox(height: 4),
        const Text('Only you and HR see these unless you share them.', style: _SheetText.sub),
        const SizedBox(height: 16),
        Semantics(
          label: '1:1 notes',
          child: OnbTextArea(
            fieldKey: const ValueKey('note-text'),
            controller: _text,
            hint: 'How it went, what you agreed…',
            minLines: 5,
            onChanged: (_) => setState(() {}),
          ),
        ),
        const SizedBox(height: 16),
        // "Share with Kabir": a grey row with the switch, as drawn.
        Semantics(
          toggled: _shared,
          label: 'Share with ${widget.firstName}',
          child: ExcludeSemantics(
            child: Material(
              key: const ValueKey('note-share'),
              color: OnbColors.screen,
              borderRadius: BorderRadius.circular(14),
              child: InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: () => setState(() => _shared = !_shared),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Row(
                    children: [
                      Expanded(child: Text('Share with ${widget.firstName}', style: OnbText.bodyStrong)),
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 150),
                        width: 44,
                        height: 26,
                        decoration: BoxDecoration(color: _shared ? OnbColors.green : OnbColors.lineDark, borderRadius: BorderRadius.circular(999)),
                        child: AnimatedAlign(
                          duration: const Duration(milliseconds: 150),
                          alignment: _shared ? Alignment.centerRight : Alignment.centerLeft,
                          child: Container(
                            width: 20,
                            height: 20,
                            margin: const EdgeInsets.symmetric(horizontal: 3),
                            decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        OnbPrimaryButton(
          key: const ValueKey('note-save'),
          label: 'Save notes',
          busy: _busy,
          onTap: _text.text.trim().isEmpty ? null : _save,
        ),
      ],
    ),
  );
}

// ─── M2 · Post a welcome ────────────────────────────────────────────────────

/// "Post a welcome": the manager's own welcome for the joiner, posted to
/// Connect on the joiner's new-joiner card. Once per joiner. True once posted.
Future<bool?> showWelcomePostSheet(BuildContext context, OnboardingShell shell, String journeyId, String firstName) =>
    showOnbSheet<bool>(context, builder: (_) => _WelcomeSheet(shell: shell, journeyId: journeyId, firstName: firstName));

class _WelcomeSheet extends StatefulWidget {
  const _WelcomeSheet({required this.shell, required this.journeyId, required this.firstName});

  final OnboardingShell shell;
  final String journeyId;
  final String firstName;

  @override
  State<_WelcomeSheet> createState() => _WelcomeSheetState();
}

class _WelcomeSheetState extends State<_WelcomeSheet> {
  late final _text = TextEditingController(
    text: 'Please welcome ${widget.firstName} to the team! Say hi and help them feel at home.',
  );
  bool _busy = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _post() async {
    setState(() => _busy = true);
    try {
      await widget.shell.api.postWelcome(widget.journeyId, _text.text.trim());
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      showAppToast(context, onboardingErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Welcome ${widget.firstName}', style: OnbText.h1),
        const SizedBox(height: 4),
        Text('Shows on the Connect feed, on ${widget.firstName}’s new-joiner card. You can post it once.', style: OnbText.label),
        const SizedBox(height: 14),
        OnbTextArea(
          fieldKey: const ValueKey('welcome-text'),
          controller: _text,
          hint: 'Say hello to ${widget.firstName}…',
          minLines: 3,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 16),
        OnbPrimaryButton(
          key: const ValueKey('welcome-post'),
          label: 'Post to Connect',
          busy: _busy,
          onTap: _text.text.trim().isEmpty || _text.text.trim().length > 500 ? null : _post,
        ),
      ],
    ),
  );
}
