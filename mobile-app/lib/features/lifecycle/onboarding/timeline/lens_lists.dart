import 'package:flutter/material.dart';

import '../data/onboarding_models.dart';
import '../presentation/onboarding_kit.dart';
import 'stage_lens.dart';

/// The Tasks and Meetings lists through the lens (prototype: "Tasks for you",
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
    this.onTick,
    this.busy = const {},
    this.footer,
  });

  final String title;
  final String meta;
  final List<LensItem> items;
  final DateTime now;
  final ValueChanged<TaskView> onOpen;
  final bool meetings;

  /// Said when [items] is empty; nothing drawn when null.
  final String? empty;

  /// Meetings: the tick box marks one met (rows the joiner may tick only).
  final ValueChanged<TaskView>? onTick;

  /// Rows being saved (their tick spins).
  final Set<String> busy;

  /// The last row of the card (Meetings: Your team).
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final last = footer;
    if (items.isEmpty && empty == null && last == null) return const SizedBox.shrink();
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
        if (items.isEmpty && last == null)
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
                      ? _MeetingRow(
                          item: item,
                          last: k == items.length - 1 && last == null,
                          onOpen: onOpen,
                          onTick: onTick,
                          busy: busy.contains(item.id),
                        )
                      : _TaskRow(item: item, last: k == items.length - 1 && last == null, onOpen: onOpen),
                ],
                ?last,
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

/// The icon and tint a task wears in the lists (the prototype's set: a
/// document amber, policies blue, people green, a post or survey purple or
/// blue, goals blue, the confirmation green).
(IconData, Color, Color) lensIcon(TaskView task) => switch (task.systemKey) {
  'intro_post' => (Icons.chat_bubble_outline_rounded, OnbColors.violetTint, OnbColors.violet),
  'day7_survey' || 'pulse_survey' => (Icons.chat_bubble_outline_rounded, OnbColors.blueTint, OnbColors.blue),
  'probation_goals' || 'monthly_goals' || 'starter_task' => (Icons.track_changes_rounded, OnbColors.blueTint, OnbColors.blue),
  'confirmation_reveal' || 'confirmation_letter' => (Icons.description_outlined, OnbColors.successTint, const Color(0xFF15803D)),
  'register_face' || 'about_you' => (Icons.person_outline_rounded, OnbColors.successTint, const Color(0xFF15803D)),
  _ when task.opens == 'policies' || task.systemKey == 'week1_reels' => (Icons.fact_check_outlined, OnbColors.blueTint, OnbColors.blue),
  _ => switch (task.kind) {
    'survey' => (Icons.chat_bubble_outline_rounded, OnbColors.blueTint, OnbColors.blue),
    'post' => (Icons.chat_bubble_outline_rounded, OnbColors.violetTint, OnbColors.violet),
    'checkin' || 'review' => (Icons.track_changes_rounded, OnbColors.blueTint, OnbColors.blue),
    _ => (Icons.description_outlined, OnbColors.amberTint, OnbColors.amber),
  },
};

/// "0 of 3 done" on Acknowledge policies; the task's own line otherwise.
String lensTaskMeta(TaskView task) {
  final p = task.progress;
  if (task.opens == 'policies' && p != null) return '${p.done} of ${p.total} done';
  return task.helper ?? '';
}

/// "Sunny Kapoor · 4 to discuss", or the lock's "Opens in Month 1".
String lensMeetingSub(LensItem item) {
  final task = item.task;
  final who = task.withName ?? task.meeting?.withWho ?? task.ownerName;
  final rest = item.lockText ?? (task.agenda.isEmpty ? null : '${task.agenda.length} to discuss');
  return [?who, ?rest].join(' · ');
}

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
        color: amber ? OnbColors.amberTint : OnbColors.screen,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        item.pillText ?? '',
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: amber ? OnbColors.amber : OnbColors.text2),
      ),
    );
  }
}

const _lock = Icon(Icons.lock_outline_rounded, size: 18, color: OnbColors.icon, semanticLabel: 'Locked');

class _TaskRow extends StatelessWidget {
  const _TaskRow({required this.item, required this.last, required this.onOpen});

  final LensItem item;
  final bool last;
  final ValueChanged<TaskView> onOpen;

  @override
  Widget build(BuildContext context) {
    final task = item.task;
    final (icon, tint, fg) = lensIcon(task);
    final progress = task.progress;
    final showBar = task.opens != 'policies' && !item.ticked && !item.locked && progress != null && progress.done > 0 && progress.done < progress.total;
    final meta = item.lockText ?? lensTaskMeta(task);
    return Opacity(
      opacity: item.locked ? 0.6 : 1,
      child: Semantics(
        button: !item.locked,
        label: [task.title, if (meta.isNotEmpty) meta, if (item.pillText != null) item.pillText!, if (item.ticked) 'done', if (item.locked) 'locked'].join('. '),
        child: InkWell(
          key: ValueKey('lens-task-${task.id}'),
          onTap: item.locked ? null : () => onOpen(task),
          child: ExcludeSemantics(child: Container(
            constraints: const BoxConstraints(minHeight: 64),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: OnbColors.line))),
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
                                  key: ValueKey('lens-bar-${task.id}'),
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
                if (item.locked)
                  _lock
                else if (item.ticked)
                  Container(
                    width: 26,
                    height: 26,
                    decoration: const BoxDecoration(color: OnbColors.successDot, shape: BoxShape.circle),
                    child: const Icon(Icons.check_rounded, size: 16, color: Colors.white),
                  )
                else
                  const Icon(Icons.chevron_right_rounded, size: 20, color: OnbColors.icon),
              ],
            ),
          )),
        ),
      ),
    );
  }
}

class _MeetingRow extends StatelessWidget {
  const _MeetingRow({required this.item, required this.last, required this.onOpen, this.onTick, this.busy = false});

  final LensItem item;
  final bool last;
  final ValueChanged<TaskView> onOpen;
  final ValueChanged<TaskView>? onTick;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final task = item.task;
    final who = task.withName ?? task.meeting?.withWho ?? task.ownerName ?? task.title;
    final photo = task.withPhotoUrl ?? task.meeting?.attendees.where((p) => p.name == who).map((p) => p.photoUrl).nonNulls.firstOrNull;
    final sub = lensMeetingSub(item);
    final on = item.ticked;
    final canTick = !item.locked && !on && (task.canTick ?? false) && onTick != null;
    return Opacity(
      opacity: item.locked ? 0.6 : 1,
      child: Container(
        constraints: const BoxConstraints(minHeight: 64),
        padding: const EdgeInsets.only(right: 12),
        decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: OnbColors.line))),
        child: Row(
          children: [
            Expanded(
              child: Semantics(
                button: !item.locked,
                label: ['Open meeting: ${task.title}', if (sub.isNotEmpty) sub, if (item.pillText != null) item.pillText!].join('. '),
                child: InkWell(
                  key: ValueKey('lens-meeting-${task.id}'),
                  onTap: item.locked ? null : () => onOpen(task),
                  child: ExcludeSemantics(child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    child: Row(
                      children: [
                        OnbAvatar(name: who, photoUrl: photo, size: 40),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(task.title, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: on ? OnbColors.text3 : OnbColors.text)),
                              if (sub.isNotEmpty) ...[
                                const SizedBox(height: 2),
                                Text(sub, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                              ],
                            ],
                          ),
                        ),
                        if (item.pill != LensPill.none) ...[const SizedBox(width: 8), _Pill(item)],
                      ],
                    ),
                  )),
                ),
              ),
            ),
            if (item.locked)
              const SizedBox(width: 40, height: 40, child: Center(child: _lock))
            else
              Semantics(
                checked: on,
                enabled: canTick,
                label: 'Met ${task.withName ?? task.title}',
                child: InkResponse(
                  key: ValueKey('lens-tick-${task.id}'),
                  onTap: canTick && !busy ? () => onTick!(task) : null,
                  radius: 22,
                  child: ExcludeSemantics(child: SizedBox(width: 40, height: 40, child: Center(child: LensTickBox(on: on, busy: busy)))),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The meeting row's tick: a rounded box, green with a check once met.
class LensTickBox extends StatelessWidget {
  const LensTickBox({super.key, required this.on, this.busy = false});

  final bool on;
  final bool busy;

  @override
  Widget build(BuildContext context) => Container(
    width: 26,
    height: 26,
    decoration: BoxDecoration(
      color: on ? OnbColors.successDot : Colors.white,
      borderRadius: BorderRadius.circular(8),
      border: on ? null : Border.all(color: OnbColors.lineDark, width: 2),
    ),
    child: busy
        ? const Padding(padding: EdgeInsets.all(5), child: CircularProgressIndicator(strokeWidth: 2))
        : on
        ? const Icon(Icons.check_rounded, size: 16, color: Colors.white)
        : null,
  );
}
