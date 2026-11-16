import 'package:flutter/material.dart';

import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import 'onboarding_kit.dart';
import 'task_row.dart';

/// A task with no screen of its own (HR's induction, the laptop, a custom
/// task HR added): what it is, who does it, when, and — when it is the
/// joiner's to tick — "Mark as done". Locked tasks say when they open.
Future<void> showTaskSheet(BuildContext context, OnboardingShell shell, TaskView task) =>
    showOnbSheet<void>(context, builder: (_) => _TaskSheet(shell: shell, task: task));

class _TaskSheet extends StatefulWidget {
  const _TaskSheet({required this.shell, required this.task});

  final OnboardingShell shell;
  final TaskView task;

  @override
  State<_TaskSheet> createState() => _TaskSheetState();
}

class _TaskSheetState extends State<_TaskSheet> {
  bool _busy = false;

  bool get _canTick {
    final task = widget.task;
    // Only what the joiner does in the app, and never a screen-driven task.
    return task.isOpen &&
        task.forEmployee &&
        task.surface != 'dashboard' &&
        const {'ack', 'tour', 'meeting', 'form', 'checkin'}.contains(task.kind);
  }

  Future<void> _done() async {
    setState(() => _busy = true);
    try {
      await widget.shell.api.taskAction(widget.task.id, 'done');
      if (mounted) Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      showAppToast(context, onboardingErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final now = widget.shell.now();
    final owner = switch (task.ownerRole) {
      'hr' => 'HR does this',
      'it' || 'admin' => 'IT and Admin do this',
      'manager' => '${task.ownerName ?? 'Your manager'} does this',
      'manager_employee' => 'You or ${task.ownerName ?? 'your manager'}',
      'finance' => 'Finance does this',
      _ => 'Yours to do',
    };
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              OnbIconTile(taskEmoji(task)),
              const SizedBox(width: 12),
              Expanded(child: Text(task.title, style: OnbText.h1)),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              if (task.mustDo) const OnbTag('MUST-DO', tone: OnbTone.mustDo),
              if (task.isDone) const OnbTag('Done', tone: OnbTone.done, icon: Icons.check_rounded),
              if (task.isLocked) const OnbTag('Locked', tone: OnbTone.locked, icon: Icons.lock_outline_rounded),
              if (task.status == 'in_review') const OnbTag('In review', tone: OnbTone.inReview),
              if (task.late && !task.isDone) const OnbTag('Needs water', tone: OnbTone.needsWater),
            ],
          ),
          if (task.helper != null) ...[const SizedBox(height: 12), Text(task.helper!, style: OnbText.body)],
          const SizedBox(height: 14),
          Text(owner, style: OnbText.bodyStrong),
          const SizedBox(height: 4),
          Text(taskMeta(task, now), style: OnbText.label),
          if (task.isLocked && task.opensAt != null) ...[
            const SizedBox(height: 4),
            Text('Opens ${onbDay(task.opensAt!)}', style: OnbText.label),
          ],
          if (task.note != null) ...[
            const SizedBox(height: 12),
            OnbCard(color: OnbColors.screen, child: Text(task.note!, style: OnbText.body)),
          ],
          const SizedBox(height: 20),
          if (_canTick)
            OnbPrimaryButton(key: const ValueKey('task-sheet-done'), label: 'Mark as done', busy: _busy, onTap: _done)
          else
            OnbSecondaryButton(label: 'Close', onTap: () => Navigator.of(context).pop()),
        ],
      ),
    );
  }
}

/// "Take the Sowaka tour": the four tabs in four cards, then Finish (done)
/// or Skip for now (skipped). Either closes the task.
Future<void> showTourSheet(BuildContext context, OnboardingShell shell, TaskView task) =>
    showOnbSheet<void>(context, builder: (_) => _TourSheet(shell: shell, task: task));

class _TourSheet extends StatefulWidget {
  const _TourSheet({required this.shell, required this.task});

  final OnboardingShell shell;
  final TaskView task;

  @override
  State<_TourSheet> createState() => _TourSheetState();
}

class _TourSheetState extends State<_TourSheet> {
  static const _stops = [
    ('🏠', 'Home', 'News, posts and shout-outs from the company. Say hi to people here.'),
    ('👥', 'Team', 'Your manager and teammates, and who is in today.'),
    ('⚡', 'Action', 'Punch in, leave, payroll, claims, the Support desk and your onboarding.'),
    ('🎮', 'Games', 'Quick games to play with your colleagues.'),
  ];

  int _at = 0;
  bool _busy = false;

  Future<void> _finish(String action) async {
    setState(() => _busy = true);
    try {
      await widget.shell.api.taskAction(widget.task.id, action);
      if (mounted) Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      showAppToast(context, onboardingErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final (emoji, title, body) = _stops[_at];
    final last = _at == _stops.length - 1;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          OnbStoryBar(count: _stops.length, current: _at),
          const SizedBox(height: 18),
          Text('THE SOWAKA TOUR · ${_at + 1} OF ${_stops.length}', style: OnbText.eyebrow),
          const SizedBox(height: 10),
          OnbIconTile(emoji, size: 56),
          const SizedBox(height: 12),
          Text(title, style: OnbText.display),
          const SizedBox(height: 6),
          Text(body, style: OnbText.body),
          const SizedBox(height: 24),
          OnbPrimaryButton(
            label: last ? 'Finish tour' : 'Next',
            busy: _busy,
            onTap: last ? () => _finish('done') : () => setState(() => _at++),
          ),
          const SizedBox(height: 8),
          Center(child: OnbLink(label: 'Skip for now', onTap: _busy ? null : () => _finish('skip'))),
        ],
      ),
    );
  }
}
