import 'dart:async';

import 'package:flutter/material.dart';
import '../timeline/stage_lens.dart';
import 'onboarding_home_tabs.dart';

import '../../../policies/data/policies_api_service.dart';
import '../../../policies/presentation/policies_ack_screen.dart';
import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import '../onboarding_launcher.dart';
import 'onboarding_kit.dart';
import 'task_row.dart' show taskMeta;
import 'tour_lessons.dart';

/// The new-joiner artifact's tiles ("Each tile opens its own screen"), in
/// its order: Meetings, Tasks, Sowaka tour and Watch list two to a row, then
/// Devices and accesses and Your profile full width. Through the timeline
/// ([lens] on another stage) the tiles say "In Month 1" instead of "Up next"
/// and show that stage's things; Devices, Watch list and Your profile are her
/// own stage's only. Built from the home the page already read; [onChanged]
/// reloads it after a screen.
class OnbTileGrid extends StatelessWidget {
  const OnbTileGrid({super.key, required this.shell, required this.home, required this.lens, required this.onChanged});

  final OnboardingShell shell;
  final OnboardingHome home;
  final StageLens lens;
  final Future<void> Function() onChanged;

  Future<void> _push(BuildContext context, Widget page) async {
    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => page));
    await onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final now = lens.mode == LensMode.now;
    final tiles = onbTiles(home, lens);
    // Faces: her own stage's meetings; through the lens, that stage's.
    final faces = now
        ? [for (final m in lens.meetings) if (m.stage <= lens.current) m.task]
        : lens.meetingsOfStage;
    final cells = <Widget>[
      if (tiles.meetings)
        _Tile(
          key: const ValueKey('tile-meetings'),
          onTap: () => _push(context, OnbMeetingsScreen(shell: shell)),
          minHeight: 132,
          top: Row(
            children: [
              for (final t in faces.take(3))
                Align(widthFactor: 0.72, child: _Initials(name: t.ownerName ?? t.meeting?.withWho ?? t.title, size: 36, ring: true)),
            ],
          ),
          title: 'Meetings',
          meta: lens.meetingsMeta,
        ),
      if (tiles.tasks)
        _Tile(
          key: const ValueKey('tile-tasks'),
          onTap: () => _push(context, OnbTasksScreen(shell: shell)),
          icon: const _IconChip(icon: Icons.checklist_rounded, tint: OnbColors.violetTint, color: OnbColors.violet),
          name: 'Tasks',
          eyebrow: lens.taskTile.label,
          title: lens.taskTile.title,
          meta: lens.taskTile.meta,
        ),
      if (tiles.tour case final tour?)
        _Tile(
          key: const ValueKey('tile-tour'),
          onTap: () => _push(context, OnbTourScreen(shell: shell, done: home.tourDone)),
          gradient: OnbColors.tourGradient,
          light: true,
          icon: const _IconChip(icon: Icons.explore_outlined, tint: Color(0x38FFFFFF), color: Colors.white),
          name: 'Sowaka tour',
          eyebrow: tour.label,
          title: tour.title,
          meta: tour.meta,
        ),
      if (tiles.watch case final watch?)
        _Tile(
          key: const ValueKey('tile-watch'),
          onTap: () => _push(context, OnbWatchScreen(shell: shell, home: home)),
          color: OnbColors.primary,
          light: true,
          subColor: OnbColors.skyText,
          icon: const _IconChip(icon: Icons.play_arrow_rounded, tint: Color(0x38FFFFFF), color: Colors.white),
          name: 'Watch list',
          eyebrow: watch.label,
          title: watch.title,
          meta: watch.meta,
        ),
    ];
    final ready = home.devices.where((d) => d.ready).length;
    final profile = home.profile;
    return Column(
      children: [
        for (var i = 0; i < cells.length; i += 2) ...[
          if (i > 0) const SizedBox(height: 10),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: cells[i]),
                const SizedBox(width: 10),
                Expanded(child: i + 1 < cells.length ? cells[i + 1] : const SizedBox.shrink()),
              ],
            ),
          ),
        ],
        if (tiles.devices) ...[
          if (cells.isNotEmpty) const SizedBox(height: 10),
          _WideTile(
            key: const ValueKey('tile-devices'),
            onTap: () => _push(context, OnbDevicesScreen(shell: shell, devices: home.devices)),
            icon: const _IconChip(icon: Icons.laptop_outlined, tint: OnbColors.blueTint, color: OnbColors.blue, size: 48, radius: 14, iconSize: 24),
            title: 'Devices and accesses',
            value: ready / home.devices.length,
            barColor: OnbColors.blue,
            barText: '$ready of ${home.devices.length} ready',
          ),
        ],
        if (tiles.profile && profile != null) ...[
          if (cells.isNotEmpty || tiles.devices) const SizedBox(height: 10),
          _WideTile(
            key: const ValueKey('tile-profile'),
            onTap: () => _push(context, OnbProfileScreen(shell: shell, profile: profile)),
            icon: const _IconChip(icon: Icons.person_outline_rounded, tint: OnbColors.amberTint, color: OnbColors.amber, size: 48, radius: 14, iconSize: 24),
            title: 'Your profile',
            meta: onbProfileMeta(profile),
            metaColor: profile.percent >= 100 ? OnbColors.successText : OnbColors.text3,
            value: profile.percent / 100,
            barColor: profile.percent >= 100 ? OnbColors.successDot : OnbColors.amber,
            barText: '${profile.percent}%',
          ),
        ],
      ],
    );
  }
}

/// Which tiles show, and the tour's and watch list's three lines (the
/// artifact's rules). Meetings and Tasks read [StageLens].
({bool meetings, bool tasks, LensTile? tour, LensTile? watch, bool devices, bool profile}) onbTiles(OnboardingHome home, StageLens lens) {
  final now = lens.mode == LensMode.now;
  final month1 = lens.steps.indexOf('Month 1');
  final lesson = todaysTourLesson(home.tourDone);
  final lessonsDone = joinerTourLessons.where((l) => home.tourDone.contains(l.key)).length;
  final count = '$lessonsDone of ${joinerTourLessons.length} done';
  // The tour runs through Day 1 and Week 1; in Month 1 only while a lesson is left.
  final tourShows = lens.selected <= 1 || (now && lesson != null && lens.current == month1);
  final shown = lesson ?? joinerTourLessons.first;
  final LensTile? tour = !tourShows
      ? null
      : switch (lens.mode) {
          LensMode.now => (label: 'UP NEXT', title: shown.title, meta: '${shown.length} · $count'),
          LensMode.ahead => (label: lens.inLabel, title: 'Fix a missed punch, leave and overtime', meta: 'A new lesson each day'),
          LensMode.back => (label: lens.inLabel, title: joinerTourLessons.first.title, meta: count),
        };
  // The Meet us videos are the first month's; the server gives them no stage, so only her own.
  final video = home.watch.where((v) => !v.seen).firstOrNull ?? home.watch.firstOrNull;
  final LensTile? watch = now && video != null && lens.current <= month1
      ? (label: 'UP NEXT', title: video.title, meta: home.watch.length == 1 ? '1 video' : '${home.watch.length} videos')
      : null;
  return (
    meetings: now ? lens.meetings.isNotEmpty : lens.meetingsOfStage.isNotEmpty,
    tasks: now ? lens.tasks.isNotEmpty : lens.tasksOfStage.isNotEmpty,
    tour: tour,
    watch: watch,
    // Day 1's, and later while something is still being set up.
    devices: now && home.devices.isNotEmpty && (lens.current == 0 || home.devices.any((d) => !d.ready)),
    // Day 1 and Week 1, as the portal's profile is filled before joining.
    profile: now && home.profile != null && lens.current <= 1,
  );
}

/// "2 of 7 sections done", or "All done".
String onbProfileMeta(OnbProfileState p) => p.percent >= 100 ? 'All done' : '${p.done} of ${p.total} sections done';

/// The joiner's meetings in the home: their timed items, done ones too.
List<TaskView> joinerMeetings(OnboardingHome home) => [
  for (final t in [...home.today, ...home.later, ...home.done])
    if (t.kind == 'meeting' && t.systemKey != 'people_to_meet') t,
];

/// The joiner's own tasks (not meetings, not the tour, which has its tile).
List<TaskView> joinerTasks(OnboardingHome home) => [
  for (final t in [...home.today, ...home.later, ...home.done])
    if (t.kind != 'meeting' && t.systemKey != 'app_tour' && !t.readOnly && t.ownerRole == 'employee') t,
];

PoliciesSource? policiesSourceFor(OnboardingShell shell) {
  final api = shell.api;
  return api is HttpOnboardingApi ? HttpPoliciesSource(PoliciesApiService(session: api.session)) : null;
}

/// Where a locked item opens: "Opens in Week 1" from its stage, else its date.
String _opensLine(TaskView t) {
  final label = t.dueLabel;
  if (label != null && label.isNotEmpty) return 'Opens · $label';
  final at = t.opensAt;
  return at == null ? 'Coming up' : 'Opens ${onbDay(at)}';
}

/// A whole-screen list in the onboarding pages, read from the home.
abstract class _HomeListState<T extends StatefulWidget> extends State<T> {
  OnboardingHome? home;
  String? error;
  OnboardingShell get shell;

  @override
  void initState() {
    super.initState();
    unawaited(_first());
  }

  Future<void> _first() async {
    final kept = await shell.api.fromDevice((api) => api.fetchHome());
    if (kept != null && mounted && home == null) setState(() => home = kept);
    await load();
  }

  Future<void> load() async {
    try {
      final h = await shell.api.fetchHome();
      if (mounted) setState(() { home = h; error = null; });
    } catch (e) {
      if (mounted) setState(() => error = onboardingErrorText(e));
    }
  }
}

// ─── Meetings ───────────────────────────────────────────────────────────────

/// "Meetings · now, then coming up": People to meet, with a tick for each
/// one met and the later ones under COMING UP with when (locked ones show a
/// lock). A row opens the meeting.
class OnbMeetingsScreen extends StatefulWidget {
  const OnbMeetingsScreen({super.key, required this.shell});
  final OnboardingShell shell;

  @override
  State<OnbMeetingsScreen> createState() => _OnbMeetingsScreenState();
}

class _OnbMeetingsScreenState extends _HomeListState<OnbMeetingsScreen> {
  final Set<String> _busy = {};

  @override
  OnboardingShell get shell => widget.shell;

  Future<void> _tick(TaskView t) async {
    if (t.isDone || t.isLocked || _busy.contains(t.id)) return;
    setState(() => _busy.add(t.id));
    try {
      final id = t.meetingId;
      if (id != null) {
        await shell.api.answerMeeting(id, 'yes');
      } else {
        await shell.api.taskAction(t.id, 'done');
      }
      await load();
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      if (mounted) setState(() => _busy.remove(t.id));
    }
  }

  Future<void> _open(TaskView t) async {
    await openOnboardingTask(context, shell, t, home: home);
    if (mounted) await load();
  }

  @override
  Widget build(BuildContext context) {
    final h = home;
    return OnbScaffold(
      shell: shell,
      title: 'Meetings',
      offline: h != null && error != null,
      body: h == null
          ? OnbLoadState(error: error, onRetry: load)
          : RefreshIndicator(
              onRefresh: load,
              child: Builder(
                builder: (context) {
                  final all = joinerMeetings(h);
                  final now = all.where((t) => !t.isLocked).toList();
                  final soon = all.where((t) => t.isLocked).toList();
                  final met = now.where((t) => t.isDone).length;
                  final rows = [...now, ...soon];
                  return ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                    children: [
                      _SectionHead(title: 'People to meet', meta: now.isEmpty ? '' : '$met of ${now.length} met'),
                      const SizedBox(height: 8),
                      if (rows.isEmpty)
                        const Text('No meetings yet.', style: OnbText.body)
                      else
                        _ListCard(
                          children: [
                            for (final (i, t) in rows.indexed) ...[
                              if (t.isLocked && (i == 0 || !rows[i - 1].isLocked)) const _ListHead('COMING UP'),
                              _MeetingRow(
                                task: t,
                                busy: _busy.contains(t.id),
                                last: i == rows.length - 1,
                                onOpen: () => _open(t),
                                onTick: () => _tick(t),
                              ),
                            ],
                          ],
                        ),
                    ],
                  );
                },
              ),
            ),
    );
  }
}

class _MeetingRow extends StatelessWidget {
  const _MeetingRow({required this.task, required this.busy, required this.last, required this.onOpen, required this.onTick});

  final TaskView task;
  final bool busy;
  final bool last;
  final VoidCallback onOpen;
  final VoidCallback onTick;

  @override
  Widget build(BuildContext context) {
    final t = task;
    final who = t.ownerName ?? t.meeting?.withWho ?? '';
    final expect = t.meeting?.expect.length ?? 0;
    final sub = t.isLocked ? _opensLine(t) : (expect > 0 ? '$expect to discuss' : (t.helper ?? ''));
    return Opacity(
      opacity: t.isLocked ? 0.6 : 1,
      child: Container(
        constraints: const BoxConstraints(minHeight: 64),
        decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: OnbColors.line))),
        padding: const EdgeInsets.only(right: 12),
        child: Row(
          children: [
            Expanded(
              child: Semantics(
                button: true,
                label: 'Open meeting: ${t.title}',
                child: InkWell(
                  key: ValueKey('meeting-${t.id}'),
                  onTap: onOpen,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    child: ExcludeSemantics(
                      child: Row(
                        children: [
                          _Initials(name: who.isEmpty ? t.title : who, size: 40),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(t.title, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: t.isDone ? OnbColors.text3 : OnbColors.text)),
                                const SizedBox(height: 2),
                                Text([if (who.isNotEmpty) who, if (sub.isNotEmpty) sub].join(' · '), style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
            if (t.isLocked)
              const SizedBox(width: 40, height: 40, child: Icon(Icons.lock_outline_rounded, size: 18, color: OnbColors.icon, semanticLabel: 'Locked'))
            else
              Semantics(
                checked: t.isDone,
                label: 'Met',
                child: InkResponse(
                  key: ValueKey('meeting-tick-${t.id}'),
                  onTap: busy ? null : onTick,
                  radius: 22,
                  child: SizedBox(
                    width: 40,
                    height: 40,
                    child: Center(child: _TickBox(on: t.isDone, busy: busy)),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

/// "Tasks · now, then coming up": Acknowledge policies first while any is
/// left, then the joiner's tasks; locked ones under COMING UP with a lock.
class OnbTasksScreen extends StatefulWidget {
  const OnbTasksScreen({super.key, required this.shell, this.policies});
  final OnboardingShell shell;

  /// Supplied by tests; the server's otherwise.
  final PoliciesSource? policies;

  @override
  State<OnbTasksScreen> createState() => _OnbTasksScreenState();
}

class _OnbTasksScreenState extends _HomeListState<OnbTasksScreen> {
  late final PoliciesSource? _policies = widget.policies ?? policiesSourceFor(widget.shell);
  ({int done, int total})? _pol;

  @override
  OnboardingShell get shell => widget.shell;

  @override
  Future<void> load() async {
    await Future.wait([super.load(), _loadPolicies()]);
  }

  Future<void> _loadPolicies() async {
    final source = _policies;
    if (source == null) return;
    try {
      final list = await source.load();
      final needed = list.where((p) => p.ackRequired).toList();
      if (mounted) setState(() => _pol = (done: needed.where((p) => p.isAcknowledged).length, total: needed.length));
    } catch (_) {
      // The row just waits for the next open.
    }
  }

  Future<void> _openPolicies() async {
    final source = _policies;
    if (source == null) return;
    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => PoliciesAckScreen(source: source, shell: shell)));
    if (mounted) await load();
  }

  Future<void> _open(TaskView t) async {
    await openOnboardingTask(context, shell, t, home: home);
    if (mounted) await load();
  }

  @override
  Widget build(BuildContext context) {
    final h = home;
    return OnbScaffold(
      shell: shell,
      title: 'Tasks',
      offline: h != null && error != null,
      body: h == null
          ? OnbLoadState(error: error, onRetry: load)
          : RefreshIndicator(
              onRefresh: load,
              child: Builder(
                builder: (context) {
                  final all = joinerTasks(h);
                  final open = all.where((t) => !t.isDone && !t.isLocked).toList();
                  final done = all.where((t) => t.isDone).toList();
                  final soon = all.where((t) => t.isLocked).toList();
                  final pol = _pol;
                  final polOpen = pol != null && pol.total > 0 && pol.done < pol.total;
                  final left = open.length + (polOpen ? 1 : 0);
                  final rows = <Widget>[
                    if (pol != null && pol.total > 0)
                      _TaskLine(
                        key: const ValueKey('task-policies'),
                        icon: Icons.fact_check_outlined,
                        tint: OnbColors.blueTint,
                        color: OnbColors.blue,
                        title: 'Acknowledge policies',
                        meta: '${pol.done} of ${pol.total} done',
                        done: !polOpen,
                        onTap: _openPolicies,
                      ),
                    for (final t in [...open, ...done]) _taskLine(t),
                    if (soon.isNotEmpty) const _ListHead('COMING UP'),
                    for (final t in soon) _taskLine(t),
                  ];
                  return ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                    children: [
                      _SectionHead(title: 'Tasks for you', meta: left == 0 ? 'All done' : '$left to do'),
                      const SizedBox(height: 8),
                      if (rows.isEmpty) const Text('Nothing to do yet.', style: OnbText.body) else _ListCard(children: _withLines(rows)),
                    ],
                  );
                },
              ),
            ),
    );
  }

  Widget _taskLine(TaskView t) {
    final (icon, tint, color) = _taskLook(t);
    final p = t.progress;
    return _TaskLine(
      key: ValueKey('task-${t.id}'),
      icon: icon,
      tint: tint,
      color: color,
      title: t.title,
      meta: t.isLocked ? _opensLine(t) : (t.helper ?? taskMeta(t, shell.now())),
      progress: p == null || t.isDone || p.total == 0 ? null : p.done / p.total,
      done: t.isDone,
      locked: t.isLocked,
      onTap: () => _open(t),
    );
  }
}

(IconData, Color, Color) _taskLook(TaskView t) => switch (t.kind) {
  'survey' => (Icons.chat_bubble_outline_rounded, OnbColors.blueTint, OnbColors.blue),
  'post' => (Icons.chat_bubble_outline_rounded, OnbColors.violetTint, OnbColors.violet),
  'checkin' || 'review' => (Icons.track_changes_rounded, OnbColors.blueTint, OnbColors.blue),
  'face' => (Icons.face_outlined, OnbColors.successTint, const Color(0xFF15803D)),
  _ => (Icons.description_outlined, OnbColors.amberTint, OnbColors.amber),
};

List<Widget> _withLines(List<Widget> rows) => [
  for (final (i, r) in rows.indexed) ...[
    r,
    if (i < rows.length - 1 && r is! _ListHead && rows[i + 1] is! _ListHead) const Divider(height: 1, thickness: 1, color: OnbColors.line),
  ],
];

class _TaskLine extends StatelessWidget {
  const _TaskLine({
    super.key,
    required this.icon,
    required this.tint,
    required this.color,
    required this.title,
    required this.meta,
    required this.onTap,
    this.progress,
    this.done = false,
    this.locked = false,
  });

  final IconData icon;
  final Color tint;
  final Color color;
  final String title;
  final String meta;
  final double? progress;
  final bool done;
  final bool locked;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Opacity(
    opacity: locked ? 0.6 : 1,
    child: Semantics(
      button: true,
      label: [title, if (meta.isNotEmpty) meta, if (done) 'done', if (locked) 'locked'].join('. '),
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 64),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: ExcludeSemantics(
            child: Row(
              children: [
                _IconChip(icon: icon, tint: tint, color: color),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: done ? OnbColors.text3 : OnbColors.text,
                          decoration: done ? TextDecoration.lineThrough : null,
                        ),
                      ),
                      if (progress != null) ...[
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            Expanded(child: _Bar(value: progress!, color: color)),
                            const SizedBox(width: 8),
                            Text('${(progress! * 100).round()}%', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: OnbColors.text2)),
                          ],
                        ),
                      ] else if (meta.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(meta, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                if (locked)
                  const Icon(Icons.lock_outline_rounded, size: 18, color: OnbColors.icon)
                else if (done)
                  Container(
                    width: 26,
                    height: 26,
                    decoration: const BoxDecoration(color: OnbColors.successDot, shape: BoxShape.circle),
                    child: const Icon(Icons.check_rounded, size: 16, color: Colors.white),
                  )
                else
                  const Icon(Icons.chevron_right_rounded, color: OnbColors.icon),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

// ─── Sowaka tour ────────────────────────────────────────────────────────────

/// "Sowaka tour · today’s lesson, play ahead, replay": each lesson with its
/// number (a tick once done), Today / Day n / Done, and Start, Play or
/// Replay. Managers also see "For managers".
class OnbTourScreen extends StatefulWidget {
  const OnbTourScreen({super.key, required this.shell, this.done = const [], this.forManager = false});

  final OnboardingShell shell;
  final List<String> done;
  final bool forManager;

  @override
  State<OnbTourScreen> createState() => _OnbTourScreenState();
}

class _OnbTourScreenState extends State<OnbTourScreen> {
  late List<String> _done = [...widget.done];

  Future<void> _play(TourLesson lesson) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => TourLessonScreen(
          lesson: lesson,
          onDone: (key) async {
            if (mounted && !_done.contains(key)) setState(() => _done = [..._done, key]);
            final server = await reportTourLessonDone(widget.shell, key);
            if (server != null && mounted) setState(() => _done = server);
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final today = todaysTourLesson(_done);
    final doneN = joinerTourLessons.where((l) => _done.contains(l.key)).length;
    return OnbScaffold(
      shell: widget.shell,
      title: 'Sowaka tour',
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          _SectionHead(title: 'Sowaka tour', meta: '$doneN of ${joinerTourLessons.length} done'),
          const SizedBox(height: 8),
          _ListCard(
            children: _withLines([
              for (final (i, l) in joinerTourLessons.indexed)
                _LessonLine(lesson: l, number: i + 1, done: _done.contains(l.key), today: l.key == today?.key, onTap: () => _play(l)),
            ]),
          ),
          if (widget.forManager) ...[
            const Padding(
              padding: EdgeInsets.fromLTRB(4, 12, 4, 8),
              child: Text('For managers', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text3)),
            ),
            _ListCard(
              children: _withLines([
                for (final (i, l) in managerTourLessons.indexed)
                  _LessonLine(lesson: l, number: i + 1, done: _done.contains(l.key), today: false, manager: true, onTap: () => _play(l)),
              ]),
            ),
          ],
        ],
      ),
    );
  }
}

class _LessonLine extends StatelessWidget {
  const _LessonLine({required this.lesson, required this.number, required this.done, required this.today, required this.onTap, this.manager = false});

  final TourLesson lesson;
  final int number;
  final bool done;
  final bool today;
  final bool manager;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (tint, fg) = done
        ? (OnbColors.successTint, OnbColors.successText)
        : today
        ? (OnbColors.primary, Colors.white)
        : (OnbColors.screen, OnbColors.text2);
    final meta = done
        ? 'Done · ${lesson.length}'
        : today
        ? 'Today · ${lesson.length}'
        : manager
        ? lesson.length
        : 'Day $number · ${lesson.length}';
    final cta = done ? 'Replay' : (today ? 'Start' : 'Play');
    return Semantics(
      button: true,
      label: '${lesson.title}. $meta. $cta',
      child: InkWell(
        key: ValueKey('lesson-${lesson.key}'),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 68),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: ExcludeSemantics(
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(12)),
                  child: done
                      ? Icon(Icons.check_rounded, size: 18, color: fg)
                      : Text('$number', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: fg)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(lesson.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text)),
                      const SizedBox(height: 2),
                      Text(meta, style: TextStyle(fontSize: 12, color: today ? OnbColors.primary : OnbColors.text3)),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  height: 32,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: today ? OnbColors.primary : Colors.white,
                    borderRadius: BorderRadius.circular(999),
                    border: today ? null : Border.all(color: done ? OnbColors.successLine : OnbColors.lineDark),
                  ),
                  child: Text(
                    cta,
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: today ? Colors.white : (done ? OnbColors.successText : OnbColors.text2)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Devices and accesses ───────────────────────────────────────────────────

/// "Devices and accesses": each with Ready or Setting up.
class OnbDevicesScreen extends StatelessWidget {
  const OnbDevicesScreen({super.key, required this.shell, required this.devices});

  final OnboardingShell shell;
  final List<OnbDevice> devices;

  static IconData _icon(String key) => switch (key) {
    'laptop' => Icons.laptop_outlined,
    'email' => Icons.mail_outline_rounded,
    'app' => Icons.phone_iphone_rounded,
    _ => Icons.key_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final ready = devices.where((d) => d.ready).length;
    return OnbScaffold(
      shell: shell,
      title: 'Devices and accesses',
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          _SectionHead(title: 'Your devices and accesses', meta: '$ready of ${devices.length} ready'),
          const SizedBox(height: 8),
          _ListCard(
            children: _withLines([
              for (final d in devices)
                Container(
                  key: ValueKey('device-${d.key}'),
                  constraints: const BoxConstraints(minHeight: 56),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  child: Row(
                    children: [
                      _IconChip(icon: _icon(d.key), tint: OnbColors.screen, color: OnbColors.text2, size: 36, radius: 10),
                      const SizedBox(width: 12),
                      Expanded(child: Text(d.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text))),
                      Container(
                        height: 26,
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: d.ready ? OnbColors.successTint : OnbColors.amberTint,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          d.ready ? 'Ready' : 'Setting up',
                          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: d.ready ? OnbColors.successText : OnbColors.amber),
                        ),
                      ),
                    ],
                  ),
                ),
            ]),
          ),
        ],
      ),
    );
  }
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

class _Tile extends StatelessWidget {
  const _Tile({
    super.key,
    required this.onTap,
    required this.title,
    required this.meta,
    this.top,
    this.icon,
    this.name,
    this.eyebrow,
    this.gradient,
    this.color,
    this.subColor,
    this.light = false,
    this.minHeight = 140,
  });

  final VoidCallback onTap;
  final Widget? top;
  final Widget? icon;
  final String? name;
  final String? eyebrow;
  final String title;
  final String meta;
  final Gradient? gradient;

  /// A filled tile (the Watch list's brand blue); white when null.
  final Color? color;

  /// The eyebrow's and meta's colour on a filled tile; white when null.
  final Color? subColor;
  final bool light;
  final double minHeight;

  @override
  Widget build(BuildContext context) {
    final fg = light ? Colors.white : OnbColors.text;
    final sub = light ? (subColor ?? Colors.white) : OnbColors.text3;
    final plain = gradient == null && color == null;
    return Semantics(
      button: true,
      label: [name ?? title, ?eyebrow, if (name != null) title, if (meta.isNotEmpty) meta].join('. '),
      child: Material(
        color: color ?? (gradient == null ? Colors.white : Colors.transparent),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: plain ? const BorderSide(color: OnbColors.line) : BorderSide.none,
        ),
        clipBehavior: Clip.antiAlias,
        child: Ink(
          decoration: BoxDecoration(gradient: gradient),
          child: InkWell(
            onTap: onTap,
            child: ExcludeSemantics(
              child: Container(
                constraints: BoxConstraints(minHeight: minHeight),
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    if (top != null)
                      top!
                    else
                      Row(
                        children: [
                          ?icon,
                          const SizedBox(width: 8),
                          Flexible(child: Text(name ?? '', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: fg))),
                        ],
                      ),
                    const SizedBox(height: 10),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (eyebrow != null) ...[
                          Text(eyebrow!, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.9, color: light ? sub : OnbColors.text3)),
                          const SizedBox(height: 4),
                        ],
                        Text(
                          title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: top != null ? 16 : 15, height: 1.25, fontWeight: FontWeight.w700, color: fg),
                        ),
                        if (meta.isNotEmpty) ...[
                          SizedBox(height: top != null ? 2 : 4),
                          Text(meta, style: TextStyle(fontSize: 12, color: sub)),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A full-width tile (Devices and accesses, Your profile): the icon, the
/// name (and a line beside it), a bar with its count, a chevron.
class _WideTile extends StatelessWidget {
  const _WideTile({
    super.key,
    required this.onTap,
    required this.icon,
    required this.title,
    required this.value,
    required this.barColor,
    required this.barText,
    this.meta,
    this.metaColor = OnbColors.text3,
  });

  final VoidCallback onTap;
  final Widget icon;
  final String title;
  final String? meta;
  final Color metaColor;
  final double value;
  final Color barColor;
  final String barText;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: [title, ?meta, barText].join('. '),
    child: ExcludeSemantics(
      child: OnbCard(
        padding: const EdgeInsets.all(14),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Row(
            children: [
              icon,
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: [
                        Expanded(child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text))),
                        if (meta != null) ...[
                          const SizedBox(width: 8),
                          Flexible(child: Text(meta!, textAlign: TextAlign.end, style: TextStyle(fontSize: 12, color: metaColor))),
                        ],
                      ],
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Expanded(child: _Bar(value: value, color: barColor)),
                        const SizedBox(width: 8),
                        Text(barText, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: OnbColors.text2)),
                      ],
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: OnbColors.icon),
            ],
          ),
        ),
      ),
    ),
  );
}

class _IconChip extends StatelessWidget {
  const _IconChip({required this.icon, required this.tint, required this.color, this.size = 32, this.radius = 10, this.iconSize = 18});

  final IconData icon;
  final Color tint;
  final Color color;
  final double size;
  final double radius;
  final double iconSize;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(radius)),
    child: Icon(icon, size: iconSize, color: color),
  );
}

const _faceTints = [
  (OnbColors.blueTint, OnbColors.blue),
  (OnbColors.successTint, Color(0xFF15803D)),
  (OnbColors.amberTint, OnbColors.amber),
  (OnbColors.violetTint, OnbColors.violet),
];

class _Initials extends StatelessWidget {
  const _Initials({required this.name, required this.size, this.ring = false});

  final String name;
  final double size;
  final bool ring;

  @override
  Widget build(BuildContext context) {
    final (tint, fg) = _faceTints[name.hashCode.abs() % _faceTints.length];
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: tint, shape: BoxShape.circle, border: ring ? Border.all(color: Colors.white, width: 2) : null),
      child: Text(OnbAvatar.initials(name), style: TextStyle(fontSize: size * 0.34, fontWeight: FontWeight.w700, color: fg)),
    );
  }
}

class _TickBox extends StatelessWidget {
  const _TickBox({required this.on, required this.busy});
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

class _Bar extends StatelessWidget {
  const _Bar({required this.value, required this.color});
  final double value;
  final Color color;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(999),
    child: SizedBox(
      height: 6,
      child: LinearProgressIndicator(value: value.clamp(0, 1), backgroundColor: OnbColors.line, color: color),
    ),
  );
}

class _SectionHead extends StatelessWidget {
  const _SectionHead({required this.title, required this.meta});
  final String title;
  final String meta;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.baseline,
    textBaseline: TextBaseline.alphabetic,
    children: [
      Expanded(
        child: Semantics(header: true, child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text))),
      ),
      Text(meta, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text2)),
    ],
  );
}

class _ListHead extends StatelessWidget {
  const _ListHead(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
    decoration: const BoxDecoration(color: OnbColors.screen, border: Border(bottom: BorderSide(color: OnbColors.line))),
    child: Text(text, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.9, color: OnbColors.text3)),
  );
}

class _ListCard extends StatelessWidget {
  const _ListCard({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
    clipBehavior: Clip.antiAlias,
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
  );
}
