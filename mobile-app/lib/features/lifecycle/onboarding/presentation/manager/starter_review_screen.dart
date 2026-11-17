import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../shared/app_toast.dart';
import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart';
import '../links.dart';
import '../onboarding_kit.dart';
import 'joiner_screen.dart' show showStarterTaskSheet;

/// M3 · the starter task, done (6Zs §5.4): when, how early, the joiner's
/// note and link; reply, or give another task.
class StarterReviewScreen extends StatefulWidget {
  const StarterReviewScreen({
    super.key,
    required this.shell,
    required this.journeyId,
    this.starterTaskId,
    this.initial,
    this.joinerName,
  });

  final OnboardingShell shell;
  final String journeyId;
  final String? starterTaskId;
  final StarterTask? initial;
  final String? joinerName;

  @override
  State<StarterReviewScreen> createState() => _StarterReviewScreenState();
}

class _StarterReviewScreenState extends State<StarterReviewScreen> {
  StarterTask? _task;
  String? _name;
  String? _error;
  final _reply = TextEditingController();
  bool _busy = false;

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    _task = widget.initial;
    _name = widget.joinerName;
    if (_task == null || _name == null) unawaited(_load());
  }

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final detail = await _shell.api.fetchJoiner(widget.journeyId);
      if (!mounted) return;
      final tasks = detail.starterTasks;
      setState(() {
        _name = detail.joiner.name;
        _task = (widget.starterTaskId == null
                ? tasks.where((t) => t.done).lastOrNull
                : tasks.where((t) => t.id == widget.starterTaskId).firstOrNull) ??
            _task;
        _error = _task == null ? 'This task isn’t here any more.' : null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    }
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    try {
      await _shell.api.replyStarterTask(_task!.id, _reply.text.trim());
      if (mounted) Navigator.of(context).pop();
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _another() async {
    final first = (_name ?? 'them').split(' ').first;
    final sent = await showStarterTaskSheet(context, _shell, widget.journeyId, first);
    if (sent == true && mounted) {
      showAppToast(context, 'Sent to $first');
      Navigator.of(context).pop();
    }
  }

  /// "2 days early", "on the day", "1 day late".
  static String timing(StarterTask task) {
    final done = task.doneAt, due = task.dueAt;
    if (done == null || due == null) return '';
    final days = calendarDaysBetween(done, due);
    if (days == 0) return 'on the day';
    if (days > 0) return days == 1 ? '1 day early' : '$days days early';
    return days == -1 ? '1 day late' : '${-days} days late';
  }

  @override
  Widget build(BuildContext context) {
    final task = _task;
    final name = _name ?? 'New joiner';
    final first = name.split(' ').first;
    if (task == null) {
      return OnbScaffold(shell: _shell, title: name, body: OnbLoadState(error: _error, onRetry: _load));
    }
    final when = [if (task.doneAt != null) onbDayTime(task.doneAt!), timing(task)].where((s) => s.isNotEmpty).join(' · ');
    return OnbScaffold(
      shell: _shell,
      title: name,
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
        children: [
          OnbCard(
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
                      Text(task.done ? '$first marked it done' : 'Not done yet', style: OnbText.bodyStrong.copyWith(color: OnbColors.doneText)),
                      if (when.isNotEmpty) Text(when, key: const ValueKey('starter-timing'), style: OnbText.label),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const Text('STARTER TASK', style: OnbText.eyebrow),
          const SizedBox(height: 4),
          Text(task.title, style: OnbText.h1),
          if (task.doneNote != null) ...[
            const SizedBox(height: 14),
            OnbCard(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  OnbAvatar(name: name, size: 32),
                  const SizedBox(width: 10),
                  Expanded(child: Text(task.doneNote!, style: OnbText.body)),
                ],
              ),
            ),
          ],
          for (final link in RegExp(r'https?://\S+').allMatches(task.doneNote ?? '').map((m) => m.group(0)!))
            OnbLink(label: '🔗 $link', onTap: () => openExternalLink(context, link)),
          const SizedBox(height: 18),
          if (task.managerReply != null) ...[
            const Text('YOUR REPLY', style: OnbText.eyebrow),
            const SizedBox(height: 6),
            Text(task.managerReply!, style: OnbText.body),
          ] else ...[
            Text('Reply to $first', style: OnbText.bodyStrong),
            const SizedBox(height: 6),
            OnbTextArea(
              fieldKey: const ValueKey('starter-reply'),
              controller: _reply,
              hint: 'Nice start! Let’s go through it on Friday.',
              onChanged: (_) => setState(() {}),
            ),
          ],
        ],
      ),
      footer: OnbFooter(
        children: [
          Row(
            children: [
              Expanded(child: OnbSecondaryButton(label: 'Give another task', onTap: _another)),
              if (task.managerReply == null) ...[
                const SizedBox(width: 10),
                Expanded(
                  child: OnbPrimaryButton(
                    key: const ValueKey('starter-send'),
                    label: 'Send',
                    busy: _busy,
                    onTap: _reply.text.trim().isEmpty ? null : _send,
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
