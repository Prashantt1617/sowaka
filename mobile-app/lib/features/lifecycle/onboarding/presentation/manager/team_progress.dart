import 'package:flutter/material.dart';

import '../../data/onboarding_models.dart';
import '../../data/team_joiners_api.dart';
import '../onboarding_kit.dart';
import '../onboarding_tiles.dart' show joinerMeetings, joinerTasks;
import '../tour_lessons.dart';
import 'team_kit.dart';

/// View progress (MgrProgress, artifact 8C82Qv57Z88eV7VTVQpFGZ): the joiner's
/// onboarding, read-only, from the same lists the joiner's own tiles count
/// (the team page's `progress` is their onboarding home). Four numbers, each
/// opening its list; the joining details before Day 1; the privacy line.
/// The manager's page and the buddy's / head of department's draw it alike.

/// A list View progress opens.
enum TeamProgressList { meetings, tasks, tour, devices }

/// One number on View progress.
typedef _Stat = ({String title, int done, int total, String meta, Color bar, String flag, TeamProgressList list, bool warn});

List<_Stat> _stats(TeamJoinerPage page) {
  final home = page.progress;
  if (home == null) return const [];
  final stats = <_Stat>[];
  final meetings = joinerMeetings(home).where((t) => !t.isLocked).toList();
  if (meetings.isNotEmpty) {
    final met = meetings.where((t) => t.isDone).length;
    stats.add((title: 'Meetings', done: met, total: meetings.length, meta: 'met', bar: TeamColors.okFg, flag: met < meetings.length ? '${meetings.length - met} to go' : 'Done', list: TeamProgressList.meetings, warn: false));
  }
  final tasks = joinerTasks(home).where((t) => !t.isLocked).toList();
  if (tasks.isNotEmpty) {
    final done = tasks.where((t) => t.isDone).length;
    stats.add((title: 'Tasks', done: done, total: tasks.length, meta: 'done', bar: const Color(0xFF6B4FBB), flag: done < tasks.length ? '${tasks.length - done} not done' : 'Done', list: TeamProgressList.tasks, warn: false));
  }
  if (!page.preboarding) {
    final done = joinerTourLessons.where((l) => home.tourDone.contains(l.key)).length;
    final total = joinerTourLessons.length;
    stats.add((title: 'Sowaka tour', done: done, total: total, meta: 'lessons', bar: TeamColors.reachOut, flag: done < total ? '${total - done} to go' : 'Done', list: TeamProgressList.tour, warn: false));
  }
  // Before Day 1 (or nothing else yet): what IT and admin are setting up.
  if ((stats.isEmpty || page.preboarding) && home.devices.isNotEmpty) {
    final ready = home.devices.where((d) => d.ready).length;
    final total = home.devices.length;
    stats.add((title: 'Devices and accesses', done: ready, total: total, meta: 'ready', bar: const Color(0xFF2563EB), flag: ready < total ? '${total - ready} setting up' : 'Done', list: TeamProgressList.devices, warn: false));
  }
  return stats;
}

/// The page: "Priya’s onboarding" with its status, DELAYED when late, the
/// numbers, the joining details before Day 1, and the privacy line.
List<Widget> teamProgressPage(TeamJoinerPage page, {required ValueChanged<TeamProgressList> onOpen}) {
  final first = page.first;
  final delayed = page.delayed > 0;
  final late = [
    for (final t in joinerTasks(page.progress ?? OnboardingHome(journeyId: page.journeyId)))
      if (t.late && !t.isDone) t.title,
  ];
  final stats = _stats(page);
  return [
    TeamSectionTitle(
      '$first’s onboarding',
      trailing: TeamPill(
        page.status,
        key: const ValueKey('progress-status'),
        background: delayed ? TeamColors.warnBg : TeamColors.okBg,
        foreground: delayed ? TeamColors.warnFg : TeamColors.okFg,
        height: 26,
      ),
    ),
    if (delayed) TeamDelayBanner(late.isEmpty ? page.status : (late.length == 1 ? '${late.first}, late' : '${late.length} tasks late: ${late.take(2).join(', ')}')),
    if (stats.isNotEmpty)
      TeamListCard(
        radius: 16,
        children: [
          for (final (i, s) in stats.indexed)
            TeamStatRow(
              key: ValueKey('stat-${s.list.name}'),
              title: s.title,
              value: '${s.done}/${s.total}',
              meta: s.meta,
              fraction: s.total == 0 ? 0 : s.done / s.total,
              bar: s.bar,
              flag: s.flag,
              flagBg: s.flag == 'Done' ? TeamColors.okBg : OnbColors.screen,
              flagFg: s.flag == 'Done' ? TeamColors.okFg : OnbColors.text2,
              divider: i < stats.length - 1,
              onTap: () => onOpen(s.list),
            ),
        ],
      ),
    if (page.preboarding && page.tj != null)
      Container(
        key: const ValueKey('joining-details'),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: OnbColors.line)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('JOINING DETAILS', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.88, color: OnbColors.text3)),
            const SizedBox(height: 4),
            Text('Joins ${onbDay(page.tj!)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: TeamColors.ink)),
          ],
        ),
      ),
    TeamFootnote('You can see where $first is. Survey answers and meeting notes stay private.'),
  ];
}

/// "Week 1", "Mon 8 Dec": when a later item opens.
String _when(TaskView t) {
  final label = t.dueLabel;
  if (label != null && label.isNotEmpty) return label;
  final at = t.opensAt ?? t.dueAt;
  return at == null ? 'Later' : onbDay(at);
}

/// One of the lists: now first, then COMING UP; a status pill per row.
List<Widget> teamProgressList(TeamJoinerPage page, TeamProgressList list) {
  final home = page.progress ?? OnboardingHome(journeyId: page.journeyId);
  const ok = (TeamColors.okBg, TeamColors.okFg), todo = (OnbColors.screen, OnbColors.text2), soon = (OnbColors.screen, OnbColors.text3), warn = (TeamColors.warnBg, TeamColors.warnFg);
  final now = <(String, String?, String, (Color, Color))>[];
  final later = <(String, String?, String, (Color, Color))>[];
  String title;
  String? meta;
  String note = '';
  switch (list) {
    case TeamProgressList.meetings:
      final all = joinerMeetings(home);
      for (final t in all) {
        if (t.isLocked) {
          later.add((t.title, t.ownerName, _when(t), soon));
        } else {
          now.add((t.title, t.ownerName, t.isDone ? 'Met' : 'Not yet', t.isDone ? ok : todo));
        }
      }
      final met = all.where((t) => !t.isLocked && t.isDone).length;
      title = 'Meetings';
      meta = '$met of ${all.where((t) => !t.isLocked).length} met';
      note = 'Meeting notes stay private to ${page.first}.';
    case TeamProgressList.tasks:
      final all = joinerTasks(home);
      for (final t in all) {
        if (t.isLocked) {
          later.add((t.title, null, _when(t), soon));
        } else {
          final p = t.progress;
          final status = t.isDone ? 'Done' : (p != null ? '${p.done} of ${p.total}' : 'To do');
          now.add((t.title, null, status, t.isDone ? ok : (t.late ? warn : todo)));
        }
      }
      final left = all.where((t) => !t.isLocked && !t.isDone).length;
      title = 'Tasks';
      meta = left == 0 ? 'All done' : '$left to do';
      note = 'Survey answers go to HR only.';
    case TeamProgressList.tour:
      for (final l in joinerTourLessons) {
        final done = home.tourDone.contains(l.key);
        now.add((l.title, null, done ? 'Done' : 'Not yet', done ? ok : todo));
      }
      title = 'Sowaka tour';
    case TeamProgressList.devices:
      for (final d in home.devices) {
        now.add((d.title, null, d.ready ? 'Ready' : 'Setting up', d.ready ? ok : warn));
      }
      title = 'Devices and accesses';
      note = 'IT and admin tick these off as they set them up.';
  }
  List<Widget> rows(List<(String, String?, String, (Color, Color))> items) => [
    for (final (i, r) in items.indexed)
      TeamStatusRow(title: r.$1, meta: r.$2, status: r.$3, bg: r.$4.$1, fg: r.$4.$2, divider: i < items.length - 1),
  ];
  return [
    TeamSectionTitle(title, meta: meta),
    TeamListCard(
      radius: 16,
      children: [
        ...rows(now),
        if (later.isNotEmpty) ...[const TeamListHead('Coming up'), ...rows(later)],
      ],
    ),
    if (note.isNotEmpty) TeamFootnote(note),
  ];
}
