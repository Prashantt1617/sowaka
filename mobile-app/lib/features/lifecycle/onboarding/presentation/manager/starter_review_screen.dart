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
    this.joinerPhotoUrl,
  });

  final OnboardingShell shell;
  final String journeyId;
  final String? starterTaskId;
  final StarterTask? initial;
  final String? joinerName;

  /// The joiner's face beside their note, when the caller has it.
  final String? joinerPhotoUrl;

  @override
  State<StarterReviewScreen> createState() => _StarterReviewScreenState();
}

class _StarterReviewScreenState extends State<StarterReviewScreen> {
  StarterTask? _task;
  String? _name;
  String? _photo;
  String? _error;
  final _reply = TextEditingController();
  bool _busy = false;

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    _task = widget.initial;
    _name = widget.joinerName;
    _photo = widget.joinerPhotoUrl;
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
        _photo = detail.joiner.photoUrl ?? _photo;
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
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          // "Kabir marked it done · Wed 3 Dec, 6:10 PM · 2 days early".
          Container(
            key: const ValueKey('starter-done-banner'),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(color: OnbColors.doneTint, borderRadius: BorderRadius.circular(16)),
            child: Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: const BoxDecoration(color: OnbColors.green, shape: BoxShape.circle),
                  alignment: Alignment.center,
                  child: const Icon(Icons.check_rounded, size: 18, color: Colors.white),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(task.done ? '$first marked it done' : 'Not done yet', style: OnbText.bodyStrong),
                      if (when.isNotEmpty)
                        Text(when, key: const ValueKey('starter-timing'), style: OnbText.label.copyWith(color: OnbColors.text2)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          // The task, the joiner's note as a message, and what they linked.
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: OnbColors.line),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'STARTER TASK',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.9, color: OnbColors.text3),
                ),
                const SizedBox(height: 12),
                Text(
                  task.title,
                  style: const TextStyle(fontSize: 20, height: 1.25, fontWeight: FontWeight.w800, letterSpacing: -0.2, color: OnbColors.text),
                ),
                if (task.doneNote != null) ...[
                  const SizedBox(height: 12),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      OnbAvatar(name: name, photoUrl: _photo, size: 36),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          decoration: const BoxDecoration(
                            color: OnbColors.screen,
                            borderRadius: BorderRadius.only(
                              topLeft: Radius.circular(4),
                              topRight: Radius.circular(16),
                              bottomLeft: Radius.circular(16),
                              bottomRight: Radius.circular(16),
                            ),
                          ),
                          child: Text(task.doneNote!, style: OnbText.body.copyWith(color: OnbColors.text, height: 1.5)),
                        ),
                      ),
                    ],
                  ),
                ],
                for (final link in {
                  ...RegExp(r'https?://\S+').allMatches(task.doneNote ?? '').map((m) => m.group(0)!),
                })
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Material(
                      color: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: OnbColors.line)),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(14),
                        onTap: () => openExternalLink(context, link),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          child: Row(
                            children: [
                              Container(
                                width: 32,
                                height: 32,
                                decoration: BoxDecoration(color: OnbColors.tint, borderRadius: BorderRadius.circular(10)),
                                alignment: Alignment.center,
                                child: const Text('🔗', style: TextStyle(fontSize: 16)),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  Uri.tryParse(link)?.host ?? link,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: OnbColors.text),
                                ),
                              ),
                              const Text('Open', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.primary)),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          if (task.managerReply != null) ...[
            const Text('YOUR REPLY', style: OnbText.eyebrow),
            const SizedBox(height: 6),
            Text(task.managerReply!, style: OnbText.body),
          ] else ...[
            Text('Reply to $first', style: OnbText.bodyStrong.copyWith(fontSize: 13)),
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
