import 'package:flutter/material.dart';

import '../data/onboarding_models.dart';
import '../presentation/onboarding_kit.dart';
import '../presentation/task_row.dart' show taskMeta;
import 'stage_hero.dart' show LensColors;
import 'stage_lens.dart';

/// The Tasks and Meetings lists through the lens (artifact: "Tasks for you",
/// "People to meet"): one white card, grey strips for COMING UP / IN MONTH 1 /
/// NOW · WEEK 1, a pill for "From Week 1" / "Still open" / a stage, a lock
/// and "Opens in Month 1" for what is not open yet, ticks for what is done.
class LensSection extends StatelessWidget {
  const LensSection({
    super.key,
    required this.title,
    required this.meta,
    required this.items,
    required this.now,
    required this.onOpen,
    this.meetings = false,
    this.empty,
  });

  final String title;
  final String meta;
  final List<LensItem> items;
  final DateTime now;
  final ValueChanged<TaskView> onOpen;
  final bool meetings;

  /// Said when [items] is empty; nothing drawn when null.
  final String? empty;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty && empty == null) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Semantics(
                header: true,
                child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text)),
              ),
            ),
            if (meta.isNotEmpty) Text(meta, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text2)),
          ],
        ),
        const SizedBox(height: 8),
        if (items.isEmpty)
          Text(empty!, style: OnbText.body)
        else
          Container(
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: OnbColors.line),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final (k, item) in items.indexed) ...[
                  if (item.head != null) _Head(item.head!),
                  meetings
                      ? _MeetingRow(item: item, now: now, last: k == items.length - 1, onOpen: onOpen)
                      : _TaskRow(item: item, now: now, last: k == items.length - 1, onOpen: onOpen),
                ],
              ],
            ),
          ),
      ],
    );
  }
}

class _Head extends StatelessWidget {
  const _Head(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
    decoration: const BoxDecoration(
      color: OnbColors.screen,
      border: Border(bottom: BorderSide(color: OnbColors.line)),
    ),
    child: Semantics(
      header: true,
      child: Text(text, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.88, color: OnbColors.text3)),
    ),
  );
}

/// The icon and tint a task wears in the lists (the artifact's set: a
/// document amber, policies blue, people green, a post or survey purple or
/// blue, goals blue, the confirmation green).
(IconData, Color, Color) lensIcon(TaskView task) => switch (task.systemKey) {
  'week1_reels' => (Icons.fact_check_outlined, const Color(0xFFEAF1FE), const Color(0xFF2563EB)),
  'intro_post' => (Icons.chat_bubble_outline_rounded, const Color(0xFFF3EEFF), const Color(0xFF6B4FBB)),
  'day7_survey' || 'pulse_survey' => (Icons.chat_bubble_outline_rounded, const Color(0xFFEAF1FE), const Color(0xFF2563EB)),
  'probation_goals' || 'monthly_goals' || 'starter_task' => (Icons.track_changes_rounded, const Color(0xFFEAF1FE), const Color(0xFF2563EB)),
  'confirmation_reveal' || 'confirmation_letter' => (Icons.description_outlined, LensColors.doneTint, const Color(0xFF15803D)),
  'register_face' || 'about_you' => (Icons.person_outline_rounded, LensColors.doneTint, const Color(0xFF15803D)),
  'app_tour' => (Icons.explore_outlined, const Color(0xFFFDECEC), const Color(0xFFB23500)),
  _ => switch (task.kind) {
    'survey' => (Icons.chat_bubble_outline_rounded, const Color(0xFFEAF1FE), const Color(0xFF2563EB)),
    _ => (Icons.description_outlined, LensColors.amberTint, LensColors.amberText),
  },
};

class _Pill extends StatelessWidget {
  const _Pill(this.item);

  final LensItem item;

  @override
  Widget build(BuildContext context) {
    final amber = item.pill == LensPill.carried || item.pill == LensPill.stillOpen;
    return Container(
      height: 24,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: amber ? LensColors.amberTint : OnbColors.screen,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        item.pillText ?? '',
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: amber ? LensColors.amberText : OnbColors.text2),
      ),
    );
  }
}

class _Trailing extends StatelessWidget {
  const _Trailing(this.item);

  final LensItem item;

  @override
  Widget build(BuildContext context) {
    if (item.locked) {
      return const Icon(Icons.lock_outline_rounded, size: 18, color: OnbColors.icon, semanticLabel: 'Locked');
    }
    if (item.ticked) {
      return Container(
        width: 26,
        height: 26,
        decoration: const BoxDecoration(color: LensColors.tick, shape: BoxShape.circle),
        child: const Icon(Icons.check_rounded, size: 16, color: Colors.white, semanticLabel: 'Done'),
      );
    }
    return const Icon(Icons.chevron_right_rounded, size: 20, color: OnbColors.icon);
  }
}

class _TaskRow extends StatelessWidget {
  const _TaskRow({required this.item, required this.now, required this.last, required this.onOpen});

  final LensItem item;
  final DateTime now;
  final bool last;
  final ValueChanged<TaskView> onOpen;

  @override
  Widget build(BuildContext context) {
    final task = item.task;
    final (icon, tint, fg) = lensIcon(task);
    final progress = task.progress;
    final showBar = !item.ticked && !item.locked && progress != null && progress.done > 0 && progress.done < progress.total;
    final meta = item.lockText ?? taskMeta(task, now);
    return Opacity(
      opacity: item.locked ? 0.6 : 1,
      child: InkWell(
        key: ValueKey('lens-task-${task.id}'),
        onTap: item.locked ? null : () => onOpen(task),
        child: Container(
          constraints: const BoxConstraints(minHeight: 64),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            border: last ? null : const Border(bottom: BorderSide(color: OnbColors.line)),
          ),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(10)),
                child: Icon(icon, size: 20, color: fg),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      task.title,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: item.ticked ? OnbColors.text3 : OnbColors.text,
                        decoration: item.ticked ? TextDecoration.lineThrough : null,
                      ),
                    ),
                    if (showBar) ...[
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Expanded(
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(999),
                              child: LinearProgressIndicator(
                                minHeight: 6,
                                value: progress.done / progress.total,
                                backgroundColor: OnbColors.line,
                                color: fg,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            '${(progress.done * 100 / progress.total).round()}%',
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: OnbColors.text2),
                          ),
                        ],
                      ),
                    ] else if (meta.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(meta, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                    ],
                  ],
                ),
              ),
              if (item.pill != LensPill.none) ...[const SizedBox(width: 8), _Pill(item)],
              const SizedBox(width: 8),
              _Trailing(item),
            ],
          ),
        ),
      ),
    );
  }
}

class _MeetingRow extends StatelessWidget {
  const _MeetingRow({required this.item, required this.now, required this.last, required this.onOpen});

  final LensItem item;
  final DateTime now;
  final bool last;
  final ValueChanged<TaskView> onOpen;

  @override
  Widget build(BuildContext context) {
    final task = item.task;
    final meeting = task.meeting;
    final who = meeting?.withWho ??
        meeting?.attendees.where((p) => p.role != 'joiner').map((p) => p.name).where((n) => n.isNotEmpty).firstOrNull ??
        task.ownerName;
    final photo = meeting?.attendees.where((p) => p.name == who).map((p) => p.photoUrl).nonNulls.firstOrNull;
    final sub = item.lockText ?? taskMeta(task, now);
    return Opacity(
      opacity: item.locked ? 0.6 : 1,
      child: InkWell(
        key: ValueKey('lens-meeting-${task.id}'),
        onTap: item.locked ? null : () => onOpen(task),
        child: Container(
          constraints: const BoxConstraints(minHeight: 64),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            border: last ? null : const Border(bottom: BorderSide(color: OnbColors.line)),
          ),
          child: Row(
            children: [
              OnbAvatar(name: who ?? task.title, photoUrl: photo, size: 40),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      task.title,
                      style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: item.ticked ? OnbColors.text3 : OnbColors.text),
                    ),
                    if (sub.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(sub, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                    ],
                  ],
                ),
              ),
              if (item.pill != LensPill.none) ...[const SizedBox(width: 8), _Pill(item)],
              const SizedBox(width: 8),
              _Trailing(item),
            ],
          ),
        ),
      ),
    );
  }
}
