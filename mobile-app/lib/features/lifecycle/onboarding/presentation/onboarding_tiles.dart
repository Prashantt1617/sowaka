import 'dart:async';

import 'package:flutter/material.dart';

import '../../../manager/data/manager_api_service.dart';
import '../../../manager/data/manager_models.dart' show LeaveBalance, LeaveBalanceItem;
import '../../../policies/data/policies_api_service.dart';
import '../../../policies/data/policies_models.dart';
import '../../../policies/presentation/policies_ack_screen.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import 'onb_lists.dart';
import 'onboarding_kit.dart';
import 'tour_lessons.dart';

export 'onb_lists.dart' show JoinerMeetingScreen, OnbMeetingsScreen, OnbTasksScreen, TeamListScreen;

/// The new-joiner artifact's tiles ("Each tile opens its own screen"):
/// Meetings, Tasks, Sowaka tour and Devices and accesses, two to a row with
/// Devices full width, each opening its own screen. Built from the home the
/// onboarding page already read; [onChanged] reloads it after a screen.
///
/// Watch list and Your profile are drawn by the artifact too, but the server
/// has no videos list or profile sections for the app yet (see the lane
/// report); they show once it does.
class OnbTileGrid extends StatelessWidget {
  const OnbTileGrid({super.key, required this.shell, required this.home, required this.onChanged});

  final OnboardingShell shell;
  final OnboardingHome home;
  final Future<void> Function() onChanged;

  Future<void> _push(BuildContext context, Widget page) async {
    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => page));
    await onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final meetings = joinerMeetings(home);
    final nowMeetings = meetings.where((t) => !t.isLocked).toList();
    final met = nowMeetings.where((t) => t.isDone).length;
    final tasks = joinerTasks(home);
    final openTasks = tasks.where((t) => !t.isDone && !t.isLocked).toList();
    final lesson = todaysTourLesson(home.tourDone);
    final lessonsDone = joinerTourLessons.where((l) => home.tourDone.contains(l.key)).length;
    final ready = home.devices.where((d) => d.ready).length;
    final tiles = <Widget>[
      if (meetings.isNotEmpty)
        _Tile(
          key: const ValueKey('tile-meetings'),
          onTap: () => _push(context, OnbMeetingsScreen(shell: shell)),
          top: Row(
            children: [
              for (final t in nowMeetings.take(3))
                Align(widthFactor: 0.72, child: _Initials(name: t.ownerName ?? t.title, size: 36, ring: true)),
            ],
          ),
          title: 'Meetings',
          meta: nowMeetings.isEmpty ? '${meetings.length} coming up' : '$met of ${nowMeetings.length} met',
        ),
      if (tasks.isNotEmpty)
        _Tile(
          key: const ValueKey('tile-tasks'),
          onTap: () => _push(context, OnbTasksScreen(shell: shell)),
          icon: const _IconChip(icon: Icons.checklist_rounded, tint: OnbColors.violetTint, color: OnbColors.violet),
          name: 'Tasks',
          eyebrow: 'UP NEXT',
          title: openTasks.isEmpty ? 'All done' : openTasks.first.title,
          meta: openTasks.isEmpty ? 'All done' : '${openTasks.length} to do',
        ),
      _Tile(
        key: const ValueKey('tile-tour'),
        onTap: () => _push(context, OnbTourScreen.of(shell, home)),
        gradient: OnbColors.tourGradient,
        light: true,
        icon: const _IconChip(icon: Icons.explore_outlined, tint: Color(0x38FFFFFF), color: Colors.white),
        name: 'Sowaka tour',
        eyebrow: lesson == null ? 'ALL DONE' : 'UP NEXT',
        title: (lesson ?? joinerTourLessons.first).title,
        meta: '${(lesson ?? joinerTourLessons.first).length} · $lessonsDone of ${joinerTourLessons.length} done',
      ),
    ];
    return Column(
      children: [
        for (var i = 0; i < tiles.length; i += 2) ...[
          if (i > 0) const SizedBox(height: 10),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: tiles[i]),
                const SizedBox(width: 10),
                Expanded(child: i + 1 < tiles.length ? tiles[i + 1] : const SizedBox.shrink()),
              ],
            ),
          ),
        ],
        if (home.devices.isNotEmpty) ...[
          const SizedBox(height: 10),
          OnbCard(
            key: const ValueKey('tile-devices'),
            padding: const EdgeInsets.all(14),
            onTap: () => _push(context, OnbDevicesScreen(shell: shell, devices: home.devices)),
            child: Row(
              children: [
                const _IconChip(icon: Icons.laptop_outlined, tint: OnbColors.blueTint, color: OnbColors.blue, size: 48, radius: 14, iconSize: 24),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Devices and accesses', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text)),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Expanded(child: _Bar(value: ready / home.devices.length, color: OnbColors.blue)),
                          const SizedBox(width: 8),
                          Text('$ready of ${home.devices.length} ready', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: OnbColors.text2)),
                        ],
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right_rounded, color: OnbColors.icon),
              ],
            ),
          ),
        ],
      ],
    );
  }
}


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

List<Widget> _withLines(List<Widget> rows) => [
  for (final (i, r) in rows.indexed) ...[
    r,
    if (i < rows.length - 1) const Divider(height: 1, thickness: 1, color: OnbColors.line),
  ],
];

// The Meetings and Tasks screens are in onb_lists.dart.

// ─── Sowaka tour ────────────────────────────────────────────────────────────

/// Plays [lesson] straight away (the home's "SOWAKA TOUR · TODAY" card, which
/// opens today's lesson without the list): the drawing filled in from the
/// joiner's record, and Done told to the server. The lessons done after it,
/// as the server has them, or null when it could not be told.
Future<List<String>?> playTourLesson(BuildContext context, OnboardingShell shell, OnboardingHome? home, TourLesson lesson) async {
  final api = shell.api;
  LeaveBalance? balance;
  if (lesson.key == 'leave' && api is HttpOnboardingApi) {
    balance = await ManagerApiService(session: api.session).fetchLeaveBalance().then<LeaveBalance?>((b) => b).catchError((Object _) => null);
  }
  if (!context.mounted) return null;
  List<String>? done;
  await Navigator.of(context).push<void>(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => TourLessonScreen(
        lesson: lesson,
        facts: tourFactsFor(shell, home?.managerName, balance),
        onDone: (key) async => done = await reportTourLessonDone(shell, key),
      ),
    ),
  );
  return done;
}

/// What a lesson's drawing is filled in with: today, the manager's name, the balance.
TourFacts tourFactsFor(OnboardingShell shell, String? managerName, LeaveBalance? balance) {
  double? left(LeaveBalanceItem item) => item.unpaid ? null : item.remaining;
  return TourFacts(
    today: shell.now(),
    managerName: managerName,
    casual: balance == null ? null : left(balance.casual),
    sick: balance == null ? null : left(balance.sick),
    earned: balance == null ? null : left(balance.earned),
  );
}

/// "Sowaka tour · today’s lesson, play ahead, replay": each lesson with its
/// number (a tick once done), Today / Day n / Done, and Start, Play or
/// Replay. Managers also see "For managers".
class OnbTourScreen extends StatefulWidget {
  const OnbTourScreen({super.key, required this.shell, this.done = const [], this.forManager = false, this.managerName, this.leaveBalance});

  /// The tour as the onboarding home has it: lessons done, "For managers"
  /// when the server sends `tour.managerLessons`, and the manager's name.
  factory OnbTourScreen.of(OnboardingShell shell, OnboardingHome? home) => OnbTourScreen(
    shell: shell,
    done: home?.tourDone ?? const [],
    forManager: home?.tourForManager ?? false,
    managerName: home?.managerName,
  );

  final OnboardingShell shell;
  final List<String> done;
  final bool forManager;

  /// "Sent to Sunny" in a lesson's drawing; "your manager" without one.
  final String? managerName;

  /// The leave lesson's balance; read from the server (`/leaves/balance`)
  /// when not given.
  final Future<LeaveBalance?> Function()? leaveBalance;

  @override
  State<OnbTourScreen> createState() => _OnbTourScreenState();
}

class _OnbTourScreenState extends State<OnbTourScreen> {
  late List<String> _done = [...widget.done];
  LeaveBalance? _balance;

  @override
  void initState() {
    super.initState();
    unawaited(_loadBalance());
  }

  Future<void> _loadBalance() async {
    final api = widget.shell.api;
    final read = widget.leaveBalance ??
        (api is HttpOnboardingApi ? () => ManagerApiService(session: api.session).fetchLeaveBalance() : null);
    if (read == null) return;
    try {
      final balance = await read();
      if (mounted) setState(() => _balance = balance);
    } catch (_) {
      // The drawing shows "—" for a balance it could not read.
    }
  }

  TourFacts get _facts => tourFactsFor(widget.shell, widget.managerName, _balance);

  Future<void> _play(TourLesson lesson) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => TourLessonScreen(
          lesson: lesson,
          facts: _facts,
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
    this.light = false,
  });

  final VoidCallback onTap;
  final Widget? top;
  final Widget? icon;
  final String? name;
  final String? eyebrow;
  final String title;
  final String meta;
  final Gradient? gradient;
  final bool light;

  @override
  Widget build(BuildContext context) {
    final fg = light ? Colors.white : OnbColors.text;
    final sub = light ? Colors.white : OnbColors.text3;
    return Semantics(
      button: true,
      label: [name ?? title, ?eyebrow, if (name != null) title, meta].join('. '),
      child: Material(
        color: gradient == null ? Colors.white : Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: gradient == null ? const BorderSide(color: OnbColors.line) : BorderSide.none,
        ),
        clipBehavior: Clip.antiAlias,
        child: Ink(
          decoration: BoxDecoration(gradient: gradient),
          child: InkWell(
            onTap: onTap,
            child: ExcludeSemantics(
              child: Container(
                constraints: const BoxConstraints(minHeight: 140),
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
                          Text(eyebrow!, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.9, color: light ? Colors.white : OnbColors.text3)),
                          const SizedBox(height: 4),
                        ],
                        Text(
                          title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: top != null ? 16 : 15, height: 1.25, fontWeight: FontWeight.w700, color: fg),
                        ),
                        const SizedBox(height: 4),
                        Text(meta, style: TextStyle(fontSize: 12, color: sub)),
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
