import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/onboarding_models.dart';
import '../../onboarding_launcher.dart';
import '../onboarding_kit.dart';
import '../plant.dart';

/// What the Team tab needs to draw the joiners inside its Direct Reports tree
/// (6Zs M0, artboard AppTeams): who they are, most urgent first, the day it is
/// for their day labels, and how to open one.
class JoinersInTree {
  const JoinersInTree({required this.joiners, required this.now, required this.open});

  final List<JoinerSummary> joiners;
  final DateTime now;
  final Future<void> Function(JoinerSummary joiner) open;
}

/// M0 · the Team tab's New joiners (6Zs §5.4): a card per report in
/// onboarding or probation — plant, day label, what is to do today, a red
/// count when something is waiting — most urgent first. No joiners (or the
/// lifecycle off for the company) → no section at all.
///
/// [inTree]: the Team tab draws the joiners itself, first on its Direct
/// Reports tree with the filter pills on that heading, as the design does;
/// this widget then only loads them and hands them over in [tree].
class NewJoinersSection extends StatefulWidget {
  const NewJoinersSection({super.key, this.shell, this.store, this.allCount, this.inTree = false});

  /// Supplied by tests; the signed-in shell's otherwise.
  final OnboardingShell? shell;
  final LifecycleMeStore? store;

  /// How many direct reports the Team tab lists, for the "All n" pill.
  final int? allCount;

  /// The joiners drawn here, by user id: the Team tab leaves them out of its
  /// own list below so nobody shows twice (6Zs §5.4 M0: joiners first).
  static final joinerUserIds = ValueNotifier<Set<String>>(const {});

  /// The "New joiners" filter pill is on: the Team tab shows only them.
  static final joinersOnly = ValueNotifier<bool>(false);

  /// The joiners for the Team tab to draw on its tree, while [inTree].
  static final tree = ValueNotifier<JoinersInTree?>(null);

  /// The joiners are drawn by the Team tab, not by this widget.
  final bool inTree;

  @override
  State<NewJoinersSection> createState() => _NewJoinersSectionState();
}

class _NewJoinersSectionState extends State<NewJoinersSection> {
  List<JoinerSummary> _joiners = const [];
  bool _loaded = false;

  LifecycleMeStore get _store => widget.store ?? LifecycleMeStore.instance;
  OnboardingShell? get _shell => widget.shell ?? currentOnboardingShell();

  @override
  void initState() {
    super.initState();
    _store.addListener(_onStore);
    unawaited(_load());
  }

  @override
  void didUpdateWidget(covariant NewJoinersSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.inTree != widget.inTree) {
      // Not during the build that changed it: the Team tab listens.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _publish();
      });
    }
  }

  @override
  void dispose() {
    _store.removeListener(_onStore);
    NewJoinersSection.joinersOnly.value = false;
    NewJoinersSection.joinerUserIds.value = const {};
    NewJoinersSection.tree.value = null;
    super.dispose();
  }

  void _publish() {
    final shell = _shell;
    NewJoinersSection.tree.value = widget.inTree && shell != null && _store.value.enabled && _joiners.isNotEmpty
        ? JoinersInTree(joiners: _joiners, now: shell.now(), open: _open)
        : null;
  }

  void _onStore() {
    if (_store.value.enabled && !_loaded) unawaited(_load());
    if (mounted) setState(() {});
  }

  Future<void> _load() async {
    final shell = _shell;
    if (shell == null || !_store.value.enabled) return;
    try {
      final joiners = await shell.api.fetchJoiners();
      if (mounted) {
        setState(() {
          _joiners = sortJoinersByUrgency(joiners);
          _loaded = true;
        });
        NewJoinersSection.joinerUserIds.value = {for (final j in joiners) ?j.userId};
        _publish();
      }
    } catch (_) {
      // Nothing to show is better than a broken Team tab.
    }
  }

  Future<void> _open(JoinerSummary joiner) async {
    final shell = _shell;
    if (shell == null) return;
    await openJoiner(context, joiner.journeyId, shell: shell);
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final shell = _shell;
    if (!_store.value.enabled || _joiners.isEmpty || shell == null || widget.inTree) {
      return const SizedBox.shrink();
    }
    final now = shell.now();
    return Padding(
      key: const ValueKey('new-joiners'),
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          JoinersFilterPills(allCount: widget.allCount, joinersCount: _joiners.length),
          const SizedBox(height: 12),
          for (final joiner in _joiners)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: JoinerCard(joiner: joiner, now: now, onTap: () => _open(joiner)),
            ),
        ],
      ),
    );
  }
}

/// Direct Reports' filter pills (M0): "All n" · "New joiners n", black when
/// on. They switch [NewJoinersSection.joinersOnly].
class JoinersFilterPills extends StatelessWidget {
  const JoinersFilterPills({super.key, this.allCount, required this.joinersCount});

  final int? allCount;
  final int joinersCount;

  @override
  Widget build(BuildContext context) {
    final only = NewJoinersSection.joinersOnly;
    return ValueListenableBuilder<bool>(
      valueListenable: only,
      builder: (context, joinersOnly, _) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _FilterPill(
            key: const ValueKey('filter-all'),
            label: 'All',
            count: allCount,
            selected: !joinersOnly,
            onTap: () => only.value = false,
          ),
          const SizedBox(width: 6),
          _FilterPill(
            key: const ValueKey('filter-joiners'),
            label: 'New joiners',
            count: joinersCount,
            selected: joinersOnly,
            onTap: () => only.value = true,
          ),
        ],
      ),
    );
  }
}

class _FilterPill extends StatelessWidget {
  const _FilterPill({super.key, required this.label, this.count, required this.selected, required this.onTap});

  final String label;
  final int? count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? Colors.white : OnbColors.text2;
    final style = OnbText.bodyStrong.copyWith(fontSize: 12, height: 1.2, color: color);
    return Semantics(
      button: true,
      selected: selected,
      label: count == null ? label : '$label $count',
      child: ExcludeSemantics(
        child: Material(
          color: selected ? OnbColors.text : Colors.white,
          shape: StadiumBorder(side: BorderSide(color: selected ? OnbColors.text : OnbColors.lineDark)),
          child: InkWell(
            customBorder: const StadiumBorder(),
            onTap: onTap,
            child: Container(
              // 32 tall, as the design draws it.
              height: 32,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              alignment: Alignment.center,
              // One text, so finders and readers see "New joiners 2"; the
              // count a little lighter, as drawn.
              child: Text.rich(
                TextSpan(
                  text: label,
                  children: [
                    if (count != null)
                      TextSpan(
                        text: ' $count',
                        style: style.copyWith(fontSize: 11, color: color.withValues(alpha: .8)),
                      ),
                  ],
                ),
                style: style,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// One joiner on the Team tab (M0): their face with the plant badge on it,
/// name, role, "🌱 New joiner · Day 1" and "4 to do today" in red when there
/// is; in probation "🌱 Week 6" and, in green, what is next ("Check-in Fri").
/// The card sits among the Team tab's own rows, so it has their size and
/// shape, with the light-blue border that marks a joiner.
class JoinerCard extends StatelessWidget {
  const JoinerCard({super.key, required this.joiner, required this.now, required this.onTap});

  final JoinerSummary joiner;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final day = joiner.dayLabelOn(now);
    final waiting = joiner.overdue > 0
        ? '${joiner.overdue} overdue'
        : joiner.todayCount > 0
        ? '${joiner.todayCount} to do today'
        : null;
    final week1 = joiner.stage == 'welcome_week1';
    final dayPill = joiner.preboarding || !week1 ? '🌱 $day' : '🌱 New joiner · $day';
    // In probation, the next thing gets its own green pill.
    final next = !joiner.preboarding && !week1 ? joiner.nextEvent : null;
    return Semantics(
      button: true,
      label: [
        joiner.name,
        if (joiner.designation != null) joiner.designation!,
        dayPill.replaceFirst('🌱 ', ''),
        ?next,
        ?waiting,
        if (joiner.plant.droop) 'Needs water',
      ].join(', '),
      child: ExcludeSemantics(
        child: Material(
          key: ValueKey('joiner-${joiner.journeyId}'),
          color: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: OnbColors.brandBorder, width: 1.5),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
              child: Row(
                children: [
                  SizedBox(
                    width: 56,
                    height: 56,
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        OnbAvatar(name: joiner.name, photoUrl: joiner.photoUrl, size: 56),
                        // The plant badge: a small green tile on the photo's
                        // corner, where a teammate's presence dot would be.
                        Positioned(
                          right: -6,
                          bottom: -6,
                          child: Container(
                            key: const ValueKey('joiner-plant-badge'),
                            width: 26,
                            height: 28,
                            decoration: BoxDecoration(
                              color: OnbColors.doneTint,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: Colors.white, width: 2),
                            ),
                            alignment: Alignment.bottomCenter,
                            // The plant fits the tile (it is drawn taller than wide).
                            child: Padding(
                              padding: const EdgeInsets.only(top: 1),
                              child: FittedBox(
                                fit: BoxFit.contain,
                                alignment: Alignment.bottomCenter,
                                child: Plant.of(joiner.plant, size: 20, sway: false, showPill: false),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          joiner.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: OnbText.bodyStrong.copyWith(fontSize: 17, fontWeight: FontWeight.w700, height: 1.5),
                        ),
                        if (joiner.designation != null)
                          Text(
                            joiner.designation!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: OnbText.label.copyWith(fontSize: 13),
                          ),
                        const SizedBox(height: 6),
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: [
                            _JoinerPill(dayPill, background: OnbColors.tint, foreground: OnbColors.primary),
                            if (next != null)
                              _JoinerPill(next, background: OnbColors.doneTint, foreground: OnbColors.doneText),
                            if (waiting != null)
                              _JoinerPill(waiting, background: OnbColors.redTint, foreground: OnbColors.redText),
                            if (joiner.plant.droop)
                              const _JoinerPill('Needs water', background: OnbColors.waterTint, foreground: OnbColors.waterText),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Icon(Icons.chevron_right_rounded, color: OnbColors.icon),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A joiner card's pill: the Team tab's square-cornered pill (as "9:45 AM"
/// and "2 requests" beside it), in the joiner's tints.
class _JoinerPill extends StatelessWidget {
  const _JoinerPill(this.label, {required this.background, required this.foreground});

  final String label;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(8)),
    child: Text(
      label,
      style: TextStyle(fontFamily: 'Sora', fontSize: 12.5, height: 16 / 12.5, fontWeight: FontWeight.w500, color: foreground),
    ),
  );
}
