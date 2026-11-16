import 'package:flutter/material.dart';

import '../data/onboarding_models.dart';
import 'onboarding_kit.dart';

/// The emoji a task's tile wears (6Zs §5.3 A2).
String taskEmoji(TaskView task) => switch (task.systemKey) {
  'welcome_induction' => '👋',
  'meet_manager' => '🤝',
  'vision_culture' => '🏢',
  'meet_team' => '👥',
  'laptop_setup' || 'check_logins' => '💻',
  'register_face' => '🙂',
  'app_tour' => '🧭',
  'week1_reels' => '📋',
  'intro_post' => '✍️',
  'people_to_meet' => '🤝',
  'starter_task' => '🎯',
  'one_on_one_notes' => '📝',
  'probation_goals' || 'monthly_goals' => '🎯',
  'day7_survey' || 'pulse_survey' => '💬',
  'week1_done' => '🌱',
  'monthly_checkin' => '🪴',
  'monthly_review' => '📈',
  'confirmation_discussion' || 'confirmation_letter' || 'confirmation_reveal' => '🌸',
  _ => switch (task.kind) {
    'meeting' => '📅',
    'survey' => '💬',
    'upload' => '📎',
    'sign' => '✍️',
    _ => '✅',
  },
};

/// The meeting's place and people, for its meta line.
String? _meetingWhere(TaskView task) {
  final meeting = task.meeting;
  if (meeting == null) return null;
  final people = meeting.attendees.map((p) => p.name).where((n) => n.isNotEmpty).toList();
  return [
    if (meeting.place != null) meeting.place!,
    if (people.isNotEmpty) 'with ${people.join(', ')}',
  ].join(' · ');
}

/// A row's meta line: when (the time, "Any time", the due day), where, and
/// the task's own helper.
String taskMeta(TaskView task, DateTime now) {
  if (task.isDone) {
    final at = task.doneAt;
    if (at == null) return task.status == 'skipped' ? 'Skipped' : 'Done';
    final when = calendarDaysBetween(at, now) == 0 ? onbTime(at) : '${onbDay(at).split(' ').first} · ${onbTime(at)}';
    return task.status == 'skipped' ? 'Skipped $when' : 'Done $when';
  }
  if (task.isLocked) {
    final opens = task.opensAt;
    return opens == null ? (task.dueLabel ?? 'Opens later') : 'Opens ${onbDay(opens)}';
  }
  final parts = <String>[];
  final start = task.startsAt;
  if (start != null) {
    parts.add(calendarDaysBetween(now, start) == 0 ? onbTime(start) : '${onbDay(start)} · ${onbTime(start)}');
    final where = _meetingWhere(task);
    if (where != null && where.isNotEmpty) parts.add(where);
  } else if (task.dueLabel != null) {
    parts.add(task.dueLabel!);
  } else if (task.dueAt != null && calendarDaysBetween(now, task.dueAt!) > 0) {
    parts.add('Due ${onbDay(task.dueAt!)}');
  } else {
    parts.add('Any time');
  }
  if (task.helper != null) parts.add(task.helper!);
  return parts.join(' · ');
}

/// A task row (Kit TaskRow): icon tile, title, meta and the badge on the
/// right — done tick, lock, MUST-DO, a count, Needs water, or an empty ring.
class OnbTaskRow extends StatelessWidget {
  const OnbTaskRow({
    super.key,
    required this.emoji,
    required this.title,
    required this.meta,
    this.onTap,
    this.done = false,
    this.locked = false,
    this.mustDo = false,
    this.late = false,
    this.count,
    this.trailing,
    this.semanticsHint,
  });

  OnbTaskRow.task(TaskView task, DateTime now, {Key? key, VoidCallback? onTap, String? count})
    : this(
        key: key ?? ValueKey('task-${task.id}'),
        emoji: taskEmoji(task),
        title: task.title,
        meta: taskMeta(task, now),
        onTap: onTap,
        done: task.isDone,
        locked: task.isLocked,
        mustDo: task.mustDo,
        late: task.late,
        count: count ?? task.progress?.label,
      );

  final String emoji;
  final String title;
  final String meta;
  final VoidCallback? onTap;
  final bool done;
  final bool locked;
  final bool mustDo;
  final bool late;
  final String? count;
  final Widget? trailing;
  final String? semanticsHint;

  @override
  Widget build(BuildContext context) {
    final badge = trailing ??
        (done
            ? const _Ring(done: true)
            : locked
            ? const Icon(Icons.lock_outline_rounded, size: 18, color: OnbColors.icon, semanticLabel: 'Locked')
            : late
            ? const OnbTag('Needs water', tone: OnbTone.needsWater)
            : mustDo
            ? const OnbTag('MUST-DO', tone: OnbTone.mustDo)
            : count != null
            ? OnbTag(count!, tone: OnbTone.count)
            : const _Ring(done: false));
    return Semantics(
      button: onTap != null,
      hint: semanticsHint,
      child: Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: OnbColors.line),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            child: Row(
              children: [
                Opacity(opacity: locked ? 0.55 : 1, child: OnbIconTile(emoji, size: 36)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: OnbText.bodyStrong.copyWith(
                          color: locked ? OnbColors.text3 : OnbColors.text,
                          decoration: done ? TextDecoration.lineThrough : null,
                          decorationColor: OnbColors.text3,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(meta, maxLines: 2, overflow: TextOverflow.ellipsis, style: OnbText.label),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                badge,
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Ring extends StatelessWidget {
  const _Ring({required this.done});

  final bool done;

  @override
  Widget build(BuildContext context) => Container(
    width: 22,
    height: 22,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: done ? OnbColors.green : null,
      border: done ? null : Border.all(color: OnbColors.lineDark, width: 2),
    ),
    child: done
        ? const Icon(Icons.check_rounded, size: 14, color: Colors.white, semanticLabel: 'Done')
        : Semantics(label: 'To do', child: const SizedBox.shrink()),
  );
}
