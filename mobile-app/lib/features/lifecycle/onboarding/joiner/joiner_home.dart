import 'dart:async';

import 'package:flutter/material.dart';

import '../data/lifecycle_me_store.dart';
import '../data/onboarding_models.dart' show PlantState;
import '../presentation/first_punch.dart' show FirstPunchTour;
import '../presentation/onboarding_kit.dart';
import '../presentation/plant.dart';
import 'joiner_api.dart';
import 'joiner_checkins.dart';
import 'joiner_lens.dart';
import 'joiner_meetings.dart';
import 'joiner_models.dart';
import 'joiner_more.dart';
import 'joiner_parts.dart';
import 'joiner_stories.dart';
import 'joiner_tasks.dart';

/// Actions › Onboarding (New joiner canvas, App · home): the stage hero
/// with the plant and the stage strip (tap a stage ahead to look at it, her
/// own to come back), "This month’s goals" from Month 1, the first punch-in
/// card on Day 1, today's Sowaka tour lesson, and the tiles, each opening its
/// screen. One answer (`GET /lifecycle/joiner/onboarding`) for all of it.
class JoinerHomeScreen extends StatefulWidget {
  const JoinerHomeScreen({super.key, required this.shell, this.api});

  final OnboardingShell shell;

  /// The tests' fake; the server's otherwise.
  final JoinerApi? api;

  @override
  State<JoinerHomeScreen> createState() => _JoinerHomeScreenState();
}

class _JoinerHomeScreenState extends State<JoinerHomeScreen> {
  late final JoinerController _c;

  @override
  void initState() {
    super.initState();
    final api = widget.api ?? HttpJoinerApi.from(widget.shell.api);
    _c = JoinerController(shell: widget.shell, api: api ?? const _NoApi());
    unawaited(_c.first().then((_) => LifecycleMeStore.instance.refresh(widget.shell.api)));
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => JoinerScaffold(
    c: _c,
    title: 'Onboarding',
    body: (d) => JoinerHomeBody(c: _c, d: d),
  );
}

class JoinerHomeBody extends StatelessWidget {
  const JoinerHomeBody({super.key, required this.c, required this.d});

  final JoinerController c;
  final JoinerOnboarding d;

  @override
  Widget build(BuildContext context) {
    final lens = JoinerLens(d, c.lens);
    final now = lens.isNow;
    final today = lessonOf(d.tour.today);
    final tourCard = now && !lens.showsPunch && today != null && (d.step == 'd1' || d.step == 'w1');
    final openScreen = c.shell.openAppScreen;
    return JPage(
      onRefresh: c.load,
      children: [
        OnbRise(child: _Hero(c: c, d: d, lens: lens)),
        // The manager's monthly KPI reviews, read-only in Grow (there are no
        // goals of the joiner's own to keep).
        if (lens.showsPerformance && openScreen != null)
          OnbRise(
            delay: 60,
            child: _PerformanceCard(
              onTap: () async {
                await openScreen(context, 'kpis');
                unawaited(c.load());
              },
            ),
          ),
        if (lens.showsPunch)
          OnbRise(
            delay: 60,
            child: _BigCard(
              key: const ValueKey('first-punch-card'),
              color: OnbColors.primary,
              icon: Icons.arrow_forward_rounded,
              iconColor: OnbColors.primary,
              title: 'Your first punch-in',
              lines: const ['Learn to punch in'],
              onTap: () async {
                await FirstPunchTour.start(context, c.shell);
                await c.load();
              },
            ),
          ),
        if (tourCard)
          OnbRise(
            delay: 60,
            child: _BigCard(
              key: const ValueKey('tour-card'),
              gradient: OnbColors.tourGradient,
              icon: Icons.play_arrow_rounded,
              iconColor: OnbColors.rust,
              eyebrow: 'SOWAKA TOUR · ${d.step == 'd1' ? 'TOMORROW' : 'TODAY'}',
              title: today.title,
              lines: ['${today.length} · ${d.tour.doneCount} of ${d.tour.lessons.length} done'],
              onTap: () => playJoinerLesson(context, c, today.key),
            ),
          ),
        OnbRise(delay: 60, child: _Tiles(c: c, d: d, lens: lens)),
      ],
    );
  }
}

// ─── The hero ───────────────────────────────────────────────────────────────

class _Hero extends StatefulWidget {
  const _Hero({required this.c, required this.d, required this.lens});

  final JoinerController c;
  final JoinerOnboarding d;
  final JoinerLens lens;

  @override
  State<_Hero> createState() => _HeroState();
}

class _HeroState extends State<_Hero> {
  final _keys = <String, GlobalKey>{};

  GlobalKey _key(String k) => _keys.putIfAbsent(k, GlobalKey.new);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _reveal(false));
  }

  @override
  void didUpdateWidget(_Hero old) {
    super.didUpdateWidget(old);
    if (old.lens.viewedKey != widget.lens.viewedKey) WidgetsBinding.instance.addPostFrameCallback((_) => _reveal(true));
  }

  /// Keeps the stage looked at in view, as the canvas shifts the row along.
  void _reveal(bool animate) {
    final ctx = _key(widget.lens.viewedKey).currentContext;
    if (ctx == null || !mounted) return;
    Scrollable.ensureVisible(ctx, alignment: 0.5, duration: animate && !MediaQuery.disableAnimationsOf(context) ? const Duration(milliseconds: 250) : Duration.zero);
  }

  /// Looking ahead shows the plant as it is at that stage.
  PlantState _plant() {
    final d = widget.d;
    final lens = widget.lens;
    if (lens.isNow) return d.plant;
    final k = lens.viewedKey;
    final last = d.steps.length >= 2 ? d.steps[d.steps.length - 2].key : '';
    final stage = switch (k) {
      'd1' || 'w1' => 1,
      'm1' => 2,
      'confirmed' => 5,
      _ when k == last => 4,
      _ => 3,
    };
    return PlantState(stage: stage, leaves: d.plant.leaves);
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.d;
    final lens = widget.lens;
    final now = lens.isNow;
    final confirmed = now && d.isConfirmed;
    final eyebrow = now ? d.heroEyebrow : 'A LOOK AHEAD';
    final title = now ? d.heroLabel : lens.there;
    return Container(
      key: const ValueKey('stage-hero'),
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: BoxDecoration(
        color: confirmed ? OnbColors.successTint : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: OnbColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Container(
                  width: 60,
                  height: 68,
                  alignment: Alignment.bottomCenter,
                  decoration: BoxDecoration(color: confirmed ? Colors.white : OnbColors.skyTint, borderRadius: BorderRadius.circular(16)),
                  child: Plant.of(_plant(), size: 54, showPill: false),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        eyebrow,
                        key: const ValueKey('stage-eyebrow'),
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 1.1,
                          color: now ? (confirmed ? OnbColors.successText : OnbColors.primary) : OnbColors.text3,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        title,
                        key: const ValueKey('stage-title'),
                        style: const TextStyle(fontSize: 28, height: 1.1, fontWeight: FontWeight.w800, letterSpacing: -0.56, color: OnbColors.text),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Semantics(
            container: true,
            label: 'Your onboarding stages',
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
              child: Row(
                children: [
                  for (final (i, s) in d.steps.indexed) ...[
                    if (i > 0) const SizedBox(width: 6),
                    _StepChip(
                      key: _key(s.key),
                      step: s,
                      selected: s.key == lens.viewedKey,
                      onTap: s.isDone ? null : () => widget.c.look(s.isCurrent ? null : s.key),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StepChip extends StatelessWidget {
  const _StepChip({super.key, required this.step, required this.selected, required this.onTap});

  final JoinerStep step;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final current = step.isCurrent;
    final done = step.isDone;
    final bg = current ? OnbColors.primary : (done ? OnbColors.successTint : Colors.white);
    final fg = current ? Colors.white : (done ? OnbColors.successText : OnbColors.text3);
    return Semantics(
      button: !done,
      selected: selected,
      label: '${step.label}${current ? ', your stage' : done ? ', done' : ''}',
      excludeSemantics: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          boxShadow: selected && !current ? const [BoxShadow(color: OnbColors.primary, spreadRadius: 2)] : null,
        ),
        child: Material(
          key: ValueKey('stage-step-${step.key}'),
          color: bg,
          shape: StadiumBorder(side: current || done ? BorderSide.none : const BorderSide(color: OnbColors.lineDark)),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Container(
              height: 36,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              alignment: Alignment.center,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (done) ...[const Icon(Icons.check_rounded, size: 12, color: OnbColors.successText), const SizedBox(width: 4)],
                  Text(step.label, style: TextStyle(fontSize: 12, fontWeight: current ? FontWeight.w700 : FontWeight.w600, color: fg)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Cards under the hero ───────────────────────────────────────────────────

class _PerformanceCard extends StatelessWidget {
  const _PerformanceCard({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'Monthly performance. Your KPI reviews from your manager',
    excludeSemantics: true,
    child: Material(
      key: const ValueKey('performance-card'),
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: const BorderSide(color: OnbColors.text, width: 1.5)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: const Padding(
          padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              JIconChip(icon: Icons.track_changes_rounded, tint: Color(0xFFFDECE7), color: OnbColors.rust),
              SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Monthly performance', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text)),
                    SizedBox(height: 2),
                    Text('Your KPI reviews from your manager', style: TextStyle(fontSize: 12, color: OnbColors.text3)),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: OnbColors.icon),
            ],
          ),
        ),
      ),
    ),
  );
}

/// The first punch-in card and the tour's lesson card: a filled card, a
/// pulsing white circle, a title.
class _BigCard extends StatelessWidget {
  const _BigCard({
    super.key,
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.lines,
    required this.onTap,
    this.eyebrow,
    this.color,
    this.gradient,
  });

  final IconData icon;
  final Color iconColor;
  final String? eyebrow;
  final String title;
  final List<String> lines;
  final VoidCallback onTap;
  final Color? color;
  final Gradient? gradient;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: [?eyebrow, title, ...lines].join('. '),
    excludeSemantics: true,
    child: Material(
      color: color ?? Colors.transparent,
      borderRadius: BorderRadius.circular(20),
      clipBehavior: Clip.antiAlias,
      child: Ink(
        decoration: BoxDecoration(gradient: gradient),
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                OnbPulse(
                  child: Container(
                    width: 52,
                    height: 52,
                    decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                    child: Icon(icon, color: iconColor, size: 26),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (eyebrow != null) ...[
                        Text(eyebrow!, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.1, color: Colors.white)),
                        const SizedBox(height: 2),
                      ],
                      Text(title, style: TextStyle(fontSize: eyebrow == null ? 18 : 17, height: 1.2, fontWeight: FontWeight.w700, color: Colors.white)),
                      for (final l in lines) ...[
                        const SizedBox(height: 2),
                        Text(l, style: TextStyle(fontSize: eyebrow == null ? 13 : 12, color: eyebrow == null ? OnbColors.skyTint : Colors.white)),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

// ─── The tiles ──────────────────────────────────────────────────────────────

class _Tiles extends StatelessWidget {
  const _Tiles({required this.c, required this.d, required this.lens});

  final JoinerController c;
  final JoinerOnboarding d;
  final JoinerLens lens;

  @override
  Widget build(BuildContext context) {
    void open(Widget page) => unawaited(pushJoiner(context, c, page));
    final now = lens.isNow;
    final tourDone = d.tour.lessons.isNotEmpty && d.tour.doneCount >= d.tour.lessons.length;
    final today = lessonOf(d.tour.today) ??
        lessonOf(d.tour.lessons.where((k) => !d.tour.done.contains(k)).firstOrNull) ??
        lessonOf(d.tour.lessons.firstOrNull);
    final tourCount = '${d.tour.doneCount} of ${d.tour.lessons.length} done';
    final task = lens.taskTile;
    final half = <Widget>[
      if (lens.showsMeetings)
        _Tile(
          key: const ValueKey('tile-meetings'),
          onTap: () => open(JoinerMeetingsScreen(c: c)),
          minHeight: 132,
          top: Row(children: [for (final m in lens.faces) Align(widthFactor: 0.72, child: meetingFace(m, size: 36, ring: true))]),
          title: 'Meetings',
          meta: lens.meetingsMeta,
        ),
      if (lens.showsTasks)
        _Tile(
          key: const ValueKey('tile-tasks'),
          onTap: () => open(JoinerTasksScreen(c: c)),
          icon: const JIconChip(icon: Icons.checklist_rounded, tint: OnbColors.violetTint, color: OnbColors.violet, size: 32, iconSize: 18),
          name: 'Tasks',
          eyebrow: task.label,
          title: task.title,
          meta: task.meta,
        ),
      if (lens.showsTour)
        _Tile(
          key: const ValueKey('tile-tour'),
          onTap: () => open(JoinerTourScreen(c: c)),
          gradient: OnbColors.tourGradient,
          light: true,
          icon: const JIconChip(icon: Icons.explore_outlined, tint: Color(0x38FFFFFF), color: Colors.white, size: 32, iconSize: 18),
          name: 'Sowaka tour',
          eyebrow: now ? (tourDone ? 'DONE' : 'UP NEXT') : lens.inLabel,
          title: now ? (tourDone ? 'All lessons done' : (today?.title ?? '')) : 'Fix a missed punch, leave and overtime',
          meta: now ? (tourDone ? tourCount : '${today?.length ?? ''} · $tourCount') : 'A new lesson each day',
        ),
      // "Life at …" (the portal's tile): the watch list as stories, opened
      // full screen on the first one not yet watched.
      if (lens.showsWatch)
        _Tile(
          key: const ValueKey('tile-watch'),
          onTap: () => unawaited(openJoinerStories(context, c, lens.videos, start: lens.firstStory)),
          color: OnbColors.primary,
          light: true,
          subColor: OnbColors.skyText,
          top: const JIconChip(icon: Icons.groups_rounded, tint: Color(0x38FFFFFF), color: Colors.white, size: 40, iconSize: 22),
          eyebrow: now ? null : lens.inLabel,
          title: d.companyName.isEmpty ? 'Life at work' : 'Life at ${d.companyName}',
          meta: plural(lens.videos.length, 'story', 'stories'),
        ),
    ];
    final ready = d.devices.where((x) => x.ready).length;
    final p = d.profile;
    // Check-ins: the open one, else the next and when it opens, else all sent.
    final dueCheckin = d.summary.checkinDueTitle;
    final nextCheckin = d.checkins.where((x) => x.state == 'locked').firstOrNull;
    final checkinsDone = dueCheckin == null && d.checkins.isNotEmpty && d.checkins.every((x) => x.state == 'sent');
    final full = <Widget>[
      if (lens.showsCheckin)
        _WideTile(
          key: const ValueKey('tile-checkins'),
          onTap: () => open(JoinerCheckinsScreen(c: c)),
          icon: const JIconChip.chat(tint: OnbColors.violetTint, color: OnbColors.violet, size: 48, radius: 14, iconSize: 24),
          title: 'Check-ins',
          meta: dueCheckin != null
              ? '$dueCheckin · about a minute'
              : checkinsDone
              ? 'All ${d.checkins.length} sent'
              : nextCheckin == null
              ? '${d.checkins.where((x) => x.state == 'sent').length} of ${d.checkins.length} sent'
              : '${nextCheckin.title}${nextCheckin.opensOn == null ? '' : ' · opens ${onbDay(nextCheckin.opensOn!)}'}',
          end: dueCheckin != null
              ? const JVerbPill('Start', filled: true)
              : checkinsDone
              ? const Icon(Icons.check_circle_rounded, color: OnbColors.successDot, size: 24)
              : null,
        ),
      // Only when the template has trainings, under the company's name for them.
      if (lens.showsTrainings)
        _WideTile(
          key: const ValueKey('tile-trainings'),
          onTap: () => open(JoinerTrainingsScreen(c: c)),
          icon: const JIconChip(icon: Icons.school_outlined, tint: Color(0xFFFDECE7), color: OnbColors.rust, size: 48, radius: 14, iconSize: 24),
          title: d.trainingsLabel,
          meta: [
            if (!now) lens.inLabel,
            plural(lens.trainings.length, 'item', 'items'),
            if (now && lens.trainings.any((t) => !t.watched)) '${lens.trainings.where((t) => !t.watched).length} to do',
          ].join(' · '),
        ),
      if (lens.showsDevices)
        _WideTile(
          key: const ValueKey('tile-devices'),
          onTap: () => open(JoinerDevicesScreen(c: c)),
          icon: const JIconChip(icon: Icons.laptop_outlined, tint: OnbColors.blueTint, color: OnbColors.blue, size: 48, radius: 14, iconSize: 24),
          title: 'Devices and accesses',
          bar: (value: ready / d.devices.length, color: OnbColors.blue, text: '$ready of ${d.devices.length} ready'),
        ),
      if (lens.showsProfile)
        _WideTile(
          key: const ValueKey('tile-profile'),
          onTap: () => open(JoinerProfileScreen(c: c)),
          icon: const JIconChip(icon: Icons.person_outline_rounded, tint: OnbColors.amberTint, color: OnbColors.amber, size: 48, radius: 14, iconSize: 24),
          title: 'Your profile',
          side: profileMeta(p),
          sideColor: p.pct >= 100 ? OnbColors.successText : OnbColors.text3,
          bar: (value: p.pct / 100, color: p.pct >= 100 ? OnbColors.successDot : OnbColors.amber, text: '${p.pct}%'),
        ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < half.length; i += 2) ...[
          if (i > 0) const SizedBox(height: 10),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: half[i]),
                const SizedBox(width: 10),
                Expanded(child: i + 1 < half.length ? half[i + 1] : const SizedBox.shrink()),
              ],
            ),
          ),
        ],
        for (final (i, w) in full.indexed) ...[if (i > 0 || half.isNotEmpty) const SizedBox(height: 10), w],
      ],
    );
  }
}

/// "2 of 7 sections done", or "All done".
String profileMeta(JoinerProfile p) => p.pct >= 100 ? 'All done' : '${p.done} of ${p.total} sections done';

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
  final Color? color;
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
      excludeSemantics: true,
      child: Material(
        color: color ?? (gradient == null ? Colors.white : Colors.transparent),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: plain ? const BorderSide(color: OnbColors.line) : BorderSide.none),
        clipBehavior: Clip.antiAlias,
        child: Ink(
          decoration: BoxDecoration(gradient: gradient),
          child: InkWell(
            onTap: onTap,
            child: Container(
              constraints: BoxConstraints(minHeight: minHeight),
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  top ??
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
                        Text(eyebrow!, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.9, color: sub)),
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
    );
  }
}

/// A full-width tile: the icon, the name (with a line under it, or beside
/// it), a bar with its count, and a chevron or a pill at the end.
class _WideTile extends StatelessWidget {
  const _WideTile({super.key, required this.onTap, required this.icon, required this.title, this.meta, this.side, this.sideColor = OnbColors.text3, this.bar, this.end});

  final VoidCallback onTap;
  final Widget icon;
  final String title;
  final String? meta;
  final String? side;
  final Color sideColor;
  final ({double value, Color color, String text})? bar;
  final Widget? end;

  @override
  Widget build(BuildContext context) {
    final b = bar;
    return Semantics(
      button: true,
      label: [title, ?meta, ?side, ?b?.text].join('. '),
      excludeSemantics: true,
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
                        if (side != null) ...[
                          const SizedBox(width: 8),
                          Flexible(child: Text(side!, textAlign: TextAlign.end, style: TextStyle(fontSize: 12, color: sideColor))),
                        ],
                      ],
                    ),
                    if (meta != null) ...[
                      const SizedBox(height: 2),
                      Text(meta!, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                    ],
                    if (b != null) ...[
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Expanded(child: JBar(value: b.value, color: b.color)),
                          const SizedBox(width: 8),
                          Text(b.text, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: OnbColors.text2)),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              end ?? const Icon(Icons.chevron_right_rounded, color: OnbColors.icon),
            ],
          ),
        ),
      ),
    );
  }
}

/// No server (a test without a fake): every call says so.
class _NoApi implements JoinerApi {
  const _NoApi();

  @override
  dynamic noSuchMethod(Invocation invocation) => Future<Never>.error(StateError('No joiner API'));
}
