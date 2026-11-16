import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../shared/app_toast.dart';
import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart';
import '../links.dart';
import '../onboarding_home_screen.dart' show JourneyBar;
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
  const JoinerScreen({super.key, required this.shell, required this.journeyId, this.openSetup = false});

  final OnboardingShell shell;
  final String journeyId;

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

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
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
    return OnbScaffold(
      shell: _shell,
      title: detail?.joiner.name ?? 'New joiner',
      body: detail == null
          ? OnbLoadState(error: _error, onRetry: _load)
          : RefreshIndicator(onRefresh: _load, child: _body(detail)),
    );
  }

  Widget _body(JoinerDetail detail) {
    final now = _shell.now();
    final joiner = detail.joiner;
    final first = joiner.firstName;
    final mine = orderTaskList(detail.managerTasks.where((t) => !t.isClosed).toList());
    final mineDone = detail.managerTasks.where((t) => t.isDone).toList();
    final theirs = detail.joinerTasks;
    final theirsDone = theirs.where((t) => t.isDone).length;
    final late = theirs.where((t) => t.late && !t.isDone).length;
    final setup = detail.setup;
    final locked = detail.goalsLockedOn(now);
    final lockOn = probationGoalsLockDate(joiner.tj);
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        OnbCard(
          radius: 24,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Plant.of(joiner.plant, size: 56),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(onboardingStageLabel(joiner.stage).toUpperCase(), style: OnbText.eyebrow),
                        Text(joiner.dayLabelOn(now), style: OnbText.displayXl(30)),
                        Text(
                          [
                            ?joiner.designation,
                            if (joiner.tj != null) (joiner.preboarding ? 'joins ${onbDay(joiner.tj!)}' : 'joined ${onbDay(joiner.tj!)}'),
                          ].join(' · '),
                          style: OnbText.label,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if (joiner.stage == 'welcome_week1' && joiner.tj != null) ...[
                const SizedBox(height: 14),
                JourneyBar(
                  stages: const [
                    JourneyStage(key: 'pre_boarding', label: 'Pre-boarding', state: 'done'),
                    JourneyStage(key: 'welcome_week1', label: 'Week 1', state: 'current'),
                    JourneyStage(key: 'settling_in', label: 'Month 1', state: 'todo'),
                    JourneyStage(key: 'growing_gains', label: 'Months 2–5', state: 'todo'),
                    JourneyStage(key: 'final_month', label: 'Final month', state: 'todo'),
                    JourneyStage(key: 'confirmed', label: 'Confirmed', state: 'todo'),
                  ],
                  currentFill: week1Fill(tj: joiner.tj!, today: now),
                  dayLabel: joiner.dayLabelOn(now),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 20),
        const Text('Your tasks', style: OnbText.h1),
        const SizedBox(height: 10),
        if (mine.isEmpty) const Text('Nothing waiting on you.', style: OnbText.body),
        for (final task in mine)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OnbTaskRow(
              key: ValueKey('mgr-task-${task.id}'),
              emoji: taskEmoji(task),
              title: task.title,
              meta: [taskMeta(task, now), if (task.mustDo) 'must-do'].join(' · '),
              late: task.late,
              trailing: _pill(detail, task),
            ),
          ),
        if (mineDone.isNotEmpty)
          Text('Done: ${mineDone.map((t) => t.title).join(' · ')}', style: OnbText.label),
        const SizedBox(height: 20),
        Row(
          children: [
            Expanded(child: Text('Set up $first', style: OnbText.h1)),
            OnbLink(key: const ValueKey('open-setup'), label: 'Edit', onTap: () => _setup(detail)),
          ],
        ),
        const SizedBox(height: 10),
        OnbCard(
          onTap: () => _setup(detail),
          child: Column(
            children: [
              _SetupLine(
                label: 'People to meet',
                value: '${setup.people.length} of ${JoinerSetup.peopleCount}',
                done: setup.people.length >= JoinerSetup.peopleCount,
              ),
              _SetupLine(label: 'Buddy', value: setup.buddy?.name ?? 'Not chosen', done: setup.buddy != null),
              _SetupLine(label: 'Welcome note', value: setup.welcomeNote == null ? 'Not written' : 'Written', done: setup.welcomeNote != null),
              _SetupLine(
                label: 'Probation goals',
                value: [
                  '${setup.goals.length} set',
                  if (locked) 'locked' else if (lockOn != null) 'lock ${onbDay(lockOn)}',
                ].join(' · '),
                done: setup.goals.isNotEmpty,
                last: true,
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Row(
          children: [
            const Expanded(child: Text('Starter tasks', style: OnbText.h1)),
            OnbLink(key: const ValueKey('assign-starter'), label: 'Give a task', onTap: () => _assign(detail)),
          ],
        ),
        const SizedBox(height: 8),
        if (detail.starterTasks.isEmpty) Text('Something small $first can finish this week.', style: OnbText.label),
        for (final task in detail.starterTasks)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OnbTaskRow(
              key: ValueKey('mgr-starter-${task.id}'),
              emoji: '🎯',
              title: task.title,
              meta: task.done
                  ? 'Done ${task.doneAt == null ? '' : onbDayTime(task.doneAt!)}${task.managerReply == null ? ' · reply' : ''}'
                  : (task.dueAt == null ? 'To do' : 'Due ${onbDay(task.dueAt!)}'),
              done: task.done,
              onTap: task.done
                  ? () => _push(
                      StarterReviewScreen(
                        shell: _shell,
                        journeyId: widget.journeyId,
                        starterTaskId: task.id,
                        initial: task,
                        joinerName: joiner.name,
                      ),
                    )
                  : null,
            ),
          ),
        const SizedBox(height: 20),
        Row(
          children: [
            const Expanded(child: Text('Notes from your 1:1s', style: OnbText.h1)),
            OnbLink(key: const ValueKey('add-note'), label: 'Add', onTap: () => _note(detail)),
          ],
        ),
        const SizedBox(height: 8),
        if (detail.notes.isEmpty) const Text('Only you and HR see these unless you share them.', style: OnbText.label),
        for (final note in detail.notes)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OnbCard(
              radius: 16,
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text(note.createdAt == null ? '' : onbDayTime(note.createdAt!), style: OnbText.label)),
                      OnbTag(note.shared ? (note.seen ? 'Shared · seen' : 'Shared') : 'Private', tone: note.shared ? OnbTone.count : OnbTone.locked),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(note.text, style: OnbText.body),
                  for (final reply in note.replies)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text('${reply.mine ? 'You' : (reply.byName ?? first)}: ${reply.text}', style: OnbText.label),
                    ),
                ],
              ),
            ),
          ),
        if (detail.probation != null && detail.probation!.months.isNotEmpty) ...[
          const SizedBox(height: 20),
          const Text('Probation', style: OnbText.h1),
          const SizedBox(height: 8),
          for (final month in detail.probation!.months)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: OnbTaskRow(
                key: ValueKey('mgr-month-${month.monthNo}'),
                emoji: '🪴',
                title: 'Month ${month.monthNo}',
                meta: [
                  '${month.goals.length} goals',
                  month.checkinEmployee == null ? 'no check-in yet' : '$first checked in',
                  if (month.review != null) 'reviewed',
                ].join(' · '),
                done: month.review != null && month.bothCheckedIn,
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
        const SizedBox(height: 20),
        Text('$first’s own tasks', style: OnbText.h1),
        const SizedBox(height: 4),
        Text('$theirsDone of ${theirs.length} done', style: OnbText.label),
        const SizedBox(height: 4),
        Text(
          late == 0 ? 'On track.' : '$late ${late == 1 ? 'task is' : 'tasks are'} late.',
          style: OnbText.bodyStrong.copyWith(color: late == 0 ? OnbColors.doneText : OnbColors.waterText),
        ),
        if (detail.surveyCount != null && detail.surveyCount! >= 3) ...[
          const SizedBox(height: 20),
          OnbCard(
            child: Text(
              'Your team’s first-week survey: ${detail.surveyCount} answers'
              '${detail.surveyAvg == null ? '' : ', ${detail.surveyAvg!.toStringAsFixed(1)} out of 5 on average'}. Names are never shown.',
              style: OnbText.body,
            ),
          ),
        ],
      ],
    );
  }

  Widget _pill(JoinerDetail detail, TaskView task) {
    final now = _shell.now();
    if (_busyTasks.contains(task.id)) {
      return const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2));
    }
    switch (task.systemKey) {
      case 'starter_task':
        return _Pill(label: 'Assign', onTap: () => _assign(detail));
      case 'one_on_one_notes':
      case 'manager_30day_note':
        return _Pill(label: 'Add', onTap: () => _note(detail));
      case 'manager_setup':
      case 'assign_buddy':
      case 'probation_goals':
      case 'people_to_meet':
        return _Pill(label: 'Set up', onTap: () => _setup(detail));
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
    if (start != null) {
      final minutes = start.difference(now).inMinutes;
      final link = task.meeting?.link;
      if (minutes <= 10 && minutes >= -60 && link != null) {
        return _Pill(label: 'Join', filled: true, onTap: () => openExternalLink(context, link));
      }
      if (minutes > 10) return _Pill(label: onbTime(start), onTap: null);
    }
    return _Pill(label: 'Done', onTap: () => _markDone(task));
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.label, required this.onTap, this.filled = false});

  final String label;
  final VoidCallback? onTap;
  final bool filled;

  @override
  Widget build(BuildContext context) => TextButton(
    onPressed: onTap,
    style: TextButton.styleFrom(
      foregroundColor: filled ? Colors.white : OnbColors.primary,
      disabledForegroundColor: OnbColors.text3,
      backgroundColor: filled ? OnbColors.primary : OnbColors.tint,
      shape: const StadiumBorder(),
      minimumSize: const Size(56, 34),
      padding: const EdgeInsets.symmetric(horizontal: 14),
      textStyle: const TextStyle(fontFamily: 'Sora', fontSize: 12.5, fontWeight: FontWeight.w600),
    ),
    child: Text(label),
  );
}

class _SetupLine extends StatelessWidget {
  const _SetupLine({required this.label, required this.value, required this.done, this.last = false});

  final String label;
  final String value;
  final bool done;
  final bool last;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(vertical: 10),
    decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: OnbColors.line))),
    child: Row(
      children: [
        Icon(
          done ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
          size: 20,
          color: done ? OnbColors.green : OnbColors.lineDark,
        ),
        const SizedBox(width: 10),
        Expanded(child: Text(label, style: OnbText.bodyStrong)),
        Text(value, style: OnbText.label),
      ],
    ),
  );
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
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Give ${widget.firstName} a starter task', style: OnbText.h1),
          const SizedBox(height: 4),
          Text('Something small ${widget.firstName} can finish this week.', style: OnbText.label),
          const SizedBox(height: 16),
          const Text('Task', style: OnbText.bodyStrong),
          const SizedBox(height: 6),
          OnbTextArea(
            fieldKey: const ValueKey('starter-title'),
            controller: _title,
            hint: 'Redesign the leave request screen',
            minLines: 1,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 14),
          const Text('Due', style: OnbText.bodyStrong),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            children: [
              ChoiceChip(
                key: const ValueKey('due-friday'),
                label: Text(onbDay(friday)),
                selected: same(_due, friday),
                onSelected: (_) => setState(() => _due = friday),
              ),
              ChoiceChip(
                label: Text(onbDay(monday)),
                selected: same(_due, monday),
                onSelected: (_) => setState(() => _due = monday),
              ),
              ChoiceChip(
                label: Text(picked ? onbDay(_due!) : 'Pick a date'),
                selected: picked,
                onSelected: (_) => _pick(),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Text('Note for ${widget.firstName} (optional)', style: OnbText.bodyStrong),
          const SizedBox(height: 6),
          OnbTextArea(controller: _note, hint: 'Start with the research notes in the shared folder.'),
          const SizedBox(height: 10),
          OnbTextArea(controller: _link, hint: 'A link (optional)', minLines: 1),
          const SizedBox(height: 18),
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
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Notes from your 1:1', style: OnbText.h1),
        const SizedBox(height: 4),
        const Text('Only you and HR see these unless you share them.', style: OnbText.label),
        const SizedBox(height: 14),
        Semantics(
          label: '1:1 notes',
          child: OnbTextArea(
            fieldKey: const ValueKey('note-text'),
            controller: _text,
            hint: 'How it went, what you agreed…',
            minLines: 4,
            onChanged: (_) => setState(() {}),
          ),
        ),
        const SizedBox(height: 8),
        SwitchListTile(
          key: const ValueKey('note-share'),
          value: _shared,
          onChanged: (value) => setState(() => _shared = value),
          contentPadding: EdgeInsets.zero,
          activeThumbColor: OnbColors.primary,
          title: Text('Share with ${widget.firstName}', style: OnbText.bodyStrong),
          subtitle: Text(
            _shared ? '${widget.firstName} gets them, and can reply.' : 'Private to you and HR.',
            style: OnbText.label,
          ),
        ),
        const SizedBox(height: 12),
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
