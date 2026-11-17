import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/onboarding_models.dart';
import '../../onboarding_launcher.dart';
import '../onboarding_kit.dart';
import '../plant.dart';

/// M0 · the Team tab's New joiners (6Zs §5.4): a card per report in
/// onboarding or probation — plant, day label, what is to do today, a red
/// count when something is waiting — most urgent first. No joiners (or the
/// lifecycle off for the company) → no section at all.
class NewJoinersSection extends StatefulWidget {
  const NewJoinersSection({super.key, this.shell, this.store, this.allCount});

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
  void dispose() {
    _store.removeListener(_onStore);
    NewJoinersSection.joinersOnly.value = false;
    NewJoinersSection.joinerUserIds.value = const {};
    super.dispose();
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
    if (!_store.value.enabled || _joiners.isEmpty || shell == null) return const SizedBox.shrink();
    final now = shell.now();
    final only = NewJoinersSection.joinersOnly;
    return Padding(
      key: const ValueKey('new-joiners'),
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Direct Reports' filter pills: All n · New joiners n (black when on).
          ValueListenableBuilder<bool>(
            valueListenable: only,
            builder: (context, joinersOnly, _) => Row(
              children: [
                _FilterPill(
                  key: const ValueKey('filter-all'),
                  label: widget.allCount == null ? 'All' : 'All ${widget.allCount}',
                  selected: !joinersOnly,
                  onTap: () => only.value = false,
                ),
                const SizedBox(width: 8),
                _FilterPill(
                  key: const ValueKey('filter-joiners'),
                  label: 'New joiners ${_joiners.length}',
                  selected: joinersOnly,
                  onTap: () => only.value = true,
                ),
              ],
            ),
          ),
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

class _FilterPill extends StatelessWidget {
  const _FilterPill({super.key, required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: selected,
    child: Material(
      color: selected ? OnbColors.text : Colors.white,
      shape: StadiumBorder(side: BorderSide(color: selected ? OnbColors.text : OnbColors.line)),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          child: Text(
            label,
            style: OnbText.bodyStrong.copyWith(fontSize: 13, color: selected ? Colors.white : OnbColors.text),
          ),
        ),
      ),
    ),
  );
}

/// One joiner on the Team tab: their face with the plant on it, name, role,
/// "🌱 New joiner · Day 1" and "4 to do today" in red when there is.
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
    return Semantics(
      button: true,
      label: '${joiner.name}, ${joiner.designation ?? ''}, $day${waiting == null ? '' : ', $waiting'}',
      child: OnbCard(
        key: ValueKey('joiner-${joiner.journeyId}'),
        radius: 16,
        padding: const EdgeInsets.all(14),
        borderColor: OnbColors.brandBorder,
        onTap: onTap,
        child: ExcludeSemantics(
          child: Row(
            children: [
              SizedBox(
                width: 56,
                height: 56,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    OnbAvatar(name: joiner.name, photoUrl: joiner.photoUrl, size: 52),
                    Positioned(
                      right: -6,
                      bottom: -6,
                      child: Container(
                        padding: const EdgeInsets.all(2),
                        decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                        child: Plant.of(joiner.plant, size: 24, sway: false, showPill: false),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(joiner.name, style: OnbText.bodyStrong.copyWith(fontSize: 15)),
                    if (joiner.designation != null) Text(joiner.designation!, style: OnbText.label),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        OnbTag(
                          joiner.preboarding
                              ? '🌱 $day'
                              : joiner.stage == 'welcome_week1'
                              ? '🌱 New joiner · $day'
                              // In probation, the next thing ("🌱 Month 2 · Check-in Fri").
                              : joiner.nextEvent == null
                              ? '🌱 $day'
                              : '🌱 $day · ${joiner.nextEvent}',
                          tone: joiner.stage == 'welcome_week1' || joiner.preboarding ? OnbTone.inReview : OnbTone.done,
                        ),
                        if (waiting != null) OnbTag(waiting, tone: OnbTone.red),
                        if (joiner.plant.droop) const OnbTag('Needs water', tone: OnbTone.needsWater),
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
    );
  }
}
