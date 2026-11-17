import 'dart:async';

import 'package:flutter/material.dart';

import '../../../profile/profile_launcher.dart';
import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import 'links.dart';
import 'onboarding_kit.dart';

/// A9 · a starter task from the manager (6Zs §5.3): who it is from, how long
/// is left, the task, the manager's note and links; "Mark as done" with an
/// optional note, which tells the manager. A9b, once done, shows that note
/// and when it was sent.
class StarterTaskScreen extends StatefulWidget {
  const StarterTaskScreen({super.key, required this.shell, this.taskId, this.initial});

  final OnboardingShell shell;

  /// The task to show; null shows the latest one (a notification without an id).
  final String? taskId;
  final StarterTask? initial;

  @override
  State<StarterTaskScreen> createState() => _StarterTaskScreenState();
}

class _StarterTaskScreenState extends State<StarterTaskScreen> {
  StarterTask? _task;
  String? _error;
  bool _busy = false;
  final _note = TextEditingController();

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    _task = widget.initial;
    unawaited(_load());
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final tasks = await _shell.api.fetchStarterTasks();
      if (!mounted) return;
      final match = widget.taskId == null
          ? (tasks.where((t) => !t.done).firstOrNull ?? tasks.lastOrNull)
          : tasks.where((t) => t.id == widget.taskId).firstOrNull;
      setState(() {
        _task = match ?? _task;
        _error = match == null && _task == null ? 'This task isn’t here any more.' : null;
      });
    } catch (error) {
      if (mounted && _task == null) setState(() => _error = onboardingErrorText(error));
    }
  }

  Future<void> _done() async {
    final task = _task!;
    setState(() => _busy = true);
    try {
      final updated = await _shell.api.markStarterTaskDone(task.id, note: _note.text);
      if (!mounted) return;
      setState(() {
        _task = updated ??
            StarterTask(
              id: task.id,
              title: task.title,
              journeyId: task.journeyId,
              links: task.links,
              note: task.note,
              dueAt: task.dueAt,
              assignedAt: task.assignedAt,
              assignedByName: task.assignedByName,
              assignedByDesignation: task.assignedByDesignation,
              doneAt: _shell.now(),
              doneNote: _note.text.trim().isEmpty ? null : _note.text.trim(),
            );
      });
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final task = _task;
    if (task == null) {
      return OnbScaffold(shell: _shell, title: 'Starter task', body: OnbLoadState(error: _error, onRetry: _load));
    }
    final manager = task.assignedByName ?? 'Your manager';
    return OnbScaffold(
      shell: _shell,
      title: 'Starter task',
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
        children: [
          if (task.done) ...[
            OnbCard(
              key: const ValueKey('starter-done'),
              color: OnbColors.doneTint,
              borderColor: OnbColors.doneTint,
              child: Row(
                children: [
                  const Icon(Icons.check_circle_rounded, color: OnbColors.doneText),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Marked as done', style: OnbText.bodyStrong.copyWith(color: OnbColors.doneText)),
                        Text(
                          '$manager has been told${task.doneAt == null ? '' : ' · ${onbDayTime(task.doneAt!)}'}',
                          style: OnbText.label,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
          ],
          _TaskCard(task: task, now: _shell.now()),
          if (task.done) ...[
            if (task.doneNote != null) ...[
              const SizedBox(height: 18),
              const Text('YOUR NOTE', style: OnbText.eyebrow),
              const SizedBox(height: 6),
              Text(task.doneNote!, style: OnbText.body),
            ],
            if (task.managerReply != null) ...[
              const SizedBox(height: 18),
              Text('${manager.toUpperCase()} REPLIED', style: OnbText.eyebrow),
              const SizedBox(height: 6),
              OnbCard(color: OnbColors.tint, borderColor: OnbColors.tint, child: Text(task.managerReply!, style: OnbText.body)),
            ],
          ] else ...[
            const SizedBox(height: 18),
            const Text('When you’re done', style: OnbText.bodyStrong),
            const SizedBox(height: 8),
            OnbTextArea(
              fieldKey: const ValueKey('starter-note'),
              controller: _note,
              hint: 'Add a note or a link for $manager (optional)',
            ),
            if (task.assignedByUserId != null && canOpenPersonProfile) ...[
              const SizedBox(height: 8),
              OnbLink(
                key: const ValueKey('starter-ask'),
                label: 'Ask $manager a question',
                onTap: () => openPersonProfile(task.assignedByUserId!),
              ),
            ],
          ],
        ],
      ),
      footer: OnbFooter(
        children: [
          task.done
              ? OnbPrimaryButton(label: 'Back to onboarding', onTap: () => Navigator.of(context).pop())
              : OnbPrimaryButton(key: const ValueKey('starter-mark-done'), label: 'Mark as done', busy: _busy, onTap: _done),
        ],
      ),
    );
  }
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({required this.task, required this.now});

  final StarterTask task;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final manager = task.assignedByName ?? 'Your manager';
    final due = task.dueAt;
    final daysLeft = due == null ? null : calendarDaysBetween(now, due);
    final tag = task.done
        ? const OnbTag('Done', tone: OnbTone.done, icon: Icons.check_rounded)
        : daysLeft == null
        ? null
        : daysLeft < 0
        ? const OnbTag('Needs water', tone: OnbTone.needsWater)
        : OnbTag(
            daysLeft == 0 ? 'Due today' : (daysLeft == 1 ? '1 day left' : '$daysLeft days left'),
            tone: OnbTone.mustDo,
          );
    return OnbCard(
      radius: 20,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              OnbAvatar(name: manager, size: 36),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('FROM YOUR MANAGER', style: OnbText.eyebrow),
                    Text([manager, ?task.assignedByDesignation].join(' · '), style: OnbText.label),
                  ],
                ),
              ),
              ?tag,
            ],
          ),
          const SizedBox(height: 14),
          Text(task.title, style: OnbText.h1),
          const SizedBox(height: 4),
          Text(
            [
              if (due != null) 'Due ${onbDay(due)}',
              if (task.assignedAt != null) 'assigned ${onbDay(task.assignedAt!)}',
            ].join(' · '),
            style: OnbText.label,
          ),
          if (task.note != null) ...[
            const SizedBox(height: 12),
            Text('“${task.note}”', style: OnbText.body.copyWith(fontStyle: FontStyle.italic)),
          ],
          for (final link in task.links)
            OnbLink(label: '🔗 $link', onTap: () => openExternalLink(context, link)),
        ],
      ),
    );
  }
}
