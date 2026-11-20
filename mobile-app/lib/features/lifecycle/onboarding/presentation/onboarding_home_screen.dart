import 'dart:async';

import 'package:flutter/material.dart';

import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import '../../../manager/data/manager_models.dart' show ManagerTab;
import '../onboarding_launcher.dart';
import '../timeline/lens_selection.dart';
import '../timeline/stage_hero.dart';
import '../timeline/stage_lens.dart';
import 'first_punch.dart';
import 'onboarding_kit.dart';
import 'onboarding_tiles.dart';
import 'tour_lessons.dart';

/// The joiner's onboarding home (new-joiner artifact, Main · view home), as
/// drawn: the stage hero (plant, YOU ARE HERE and the stage, the stage row),
/// on Day 1 before the first punch-in "Your first punch-in", after it (and
/// through Week 1) today's Sowaka tour lesson, then the tiles, each opening
/// its own tab. Tapping a stage looks ahead or back through the same tiles;
/// the tabs they open keep the lens ([onbLensSelection]).
class OnboardingHomeScreen extends StatefulWidget {
  const OnboardingHomeScreen({super.key, required this.shell});

  final OnboardingShell shell;

  @override
  State<OnboardingHomeScreen> createState() => _OnboardingHomeScreenState();
}

class _OnboardingHomeScreenState extends State<OnboardingHomeScreen> {
  OnboardingHome? _home;
  String? _error;

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    // Opening onboarding starts on her own stage.
    onbLensSelection.value = null;
    onbLensSelection.addListener(_lensMoved);
    unawaited(_first());
  }

  @override
  void dispose() {
    onbLensSelection.removeListener(_lensMoved);
    super.dispose();
  }

  void _lensMoved() {
    if (mounted) setState(() {});
  }

  /// Last time's home from the device at once; the live read replaces it.
  Future<void> _first() async {
    final kept = await _shell.api.fromDevice((api) => api.fetchHome());
    if (kept != null && mounted && _home == null) setState(() => _home = kept);
    await _load();
  }

  Future<void> _load() async {
    try {
      final home = await _shell.api.fetchHome();
      if (!mounted) return;
      setState(() {
        _home = home;
        _error = null;
      });
      // The tile's count follows what was just read.
      unawaited(LifecycleMeStore.instance.refresh(_shell.api));
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    }
  }

  Future<void> _playLesson(TourLesson lesson) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => TourLessonScreen(lesson: lesson, onDone: (key) => reportTourLessonDone(_shell, key)),
      ),
    );
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final home = _home;
    return OnbScaffold(
      shell: _shell,
      title: 'Onboarding',
      offline: home != null && _error != null,
      body: home == null
          ? OnbLoadState(error: _error, onRetry: _load)
          : RefreshIndicator(onRefresh: _load, child: _body(home)),
    );
  }

  Widget _body(OnboardingHome home) {
    final now = _shell.now();
    final lens = StageLens.of(home, now, selected: onbLensSelection.value);
    final mine = lens.mode == LensMode.now;
    // Day 1, before the first punch-in: learn it on the Actions tab (J1).
    final firstPunch = mine && home.needsFirstPunchOn(now) && (_shell.tabs.isEmpty || _shell.tabs.contains(ManagerTab.quick));
    // After it, and through Week 1: today's lesson (tomorrow's on Day 1).
    final lesson = todaysTourLesson(home.tourDone);
    final tourCard = mine && !firstPunch && lesson != null && lens.current <= 1;
    final lessonsDone = joinerTourLessons.where((l) => home.tourDone.contains(l.key)).length;
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        OnbRise(
          child: StageHero(
            lens: lens,
            plant: home.plant,
            onPick: (i) => onbLensSelection.value = i == lens.current ? null : i,
          ),
        ),
        if (firstPunch) ...[
          const SizedBox(height: 20),
          OnbRise(delay: 60, child: FirstPunchCard(onTap: () => FirstPunchTour.start(context, _shell))),
        ],
        if (tourCard) ...[
          const SizedBox(height: 20),
          OnbRise(
            delay: 60,
            child: OnbBanner(
              key: const ValueKey('tour-card'),
              icon: Icons.play_arrow_rounded,
              gradient: OnbColors.tourGradient,
              eyebrow: 'SOWAKA TOUR · ${lens.current == 0 ? 'TOMORROW' : 'TODAY'}',
              title: lesson.title,
              subtitle: '${lesson.length} · $lessonsDone of ${joinerTourLessons.length} done',
              titleSize: 17,
              onTap: () => _playLesson(lesson),
            ),
          ),
        ],
        const SizedBox(height: 20),
        OnbRise(delay: 60, child: OnbTileGrid(shell: _shell, home: home, lens: lens, onChanged: _load)),
      ],
    );
  }
}

/// How far into the current stage the joiner is, for the bar's fill: a
/// seventh a day in week 1; through month 1 by days; through months 2 to
/// the one before last by months; halfway otherwise.
double stageFill({String? stage, DateTime? tj, required DateTime today, int months = 6}) {
  if (tj == null) return 0.5;
  final joined = dateOnly(tj);
  switch (stage) {
    case 'welcome_week1':
      return week1Fill(tj: tj, today: today);
    case 'settling_in':
      final end = addMonths(joined, 1);
      final total = calendarDaysBetween(joined.add(const Duration(days: 7)), end);
      return total <= 0 ? 0.5 : (calendarDaysBetween(joined.add(const Duration(days: 7)), today) / total).clamp(0.05, 1.0);
    case 'growing_gains':
      final span = (months - 2).clamp(1, 12);
      var month = 1;
      while (!dateOnly(today).isBefore(addMonths(joined, month))) {
        month++;
      }
      return ((month - 1) / span).clamp(0.05, 1.0);
    default:
      return 0.5;
  }
}

/// The six-stage bar: done green, the current one filled to how far in, the
/// rest grey; each named under it.
class JourneyBar extends StatelessWidget {
  const JourneyBar({super.key, required this.stages, required this.currentFill, required this.dayLabel});

  final List<JourneyStage> stages;
  final double currentFill;
  final String dayLabel;

  String get _semantics {
    final parts = <String>[];
    for (final stage in stages) {
      if (stage.isDone) {
        parts.add('${stage.label.toLowerCase()} done');
      } else if (stage.isCurrent) {
        parts.add('now in ${stage.label.toLowerCase()} ($dayLabel)');
      } else {
        parts.add(stage.label.toLowerCase());
      }
    }
    return 'Journey: ${parts.join(', ')}';
  }

  @override
  Widget build(BuildContext context) => Semantics(
    label: _semantics,
    child: ExcludeSemantics(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final (index, stage) in stages.indexed) ...[
            if (index > 0) const SizedBox(width: 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(3),
                    child: SizedBox(
                      height: 6,
                      child: LinearProgressIndicator(
                        value: stage.isDone ? 1 : (stage.isCurrent ? currentFill : 0),
                        backgroundColor: OnbColors.line,
                        color: stage.isDone ? OnbColors.green : OnbColors.primary,
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    stage.label,
                    maxLines: 2,
                    style: OnbText.label.copyWith(
                      fontSize: 10,
                      fontWeight: stage.isCurrent ? FontWeight.w600 : FontWeight.w400,
                      color: stage.isCurrent ? OnbColors.primary : OnbColors.text3,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    ),
  );
}

/// "Full journey": every stage as a path node — done green, current in the
/// brand ring, the rest grey.
Future<void> showJourneySheet(BuildContext context, List<JourneyStage> stages, String dayLabel) => showOnbSheet<void>(
  context,
  builder: (context) => SingleChildScrollView(
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Your journey', style: OnbText.h1),
        const SizedBox(height: 16),
        for (final (index, stage) in stages.indexed)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Column(
                children: [
                  Container(
                    width: stage.isCurrent ? 32 : 26,
                    height: stage.isCurrent ? 32 : 26,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: stage.isDone ? OnbColors.green : Colors.white,
                      border: stage.isDone
                          ? null
                          : Border.all(color: stage.isCurrent ? OnbColors.primary : OnbColors.lineDark, width: stage.isCurrent ? 5 : 2),
                    ),
                    child: stage.isDone ? const Icon(Icons.check_rounded, size: 16, color: Colors.white) : null,
                  ),
                  if (index < stages.length - 1)
                    Container(width: 2, height: 26, color: stage.isDone ? OnbColors.green : OnbColors.line),
                ],
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(stage.label, style: OnbText.bodyStrong),
                      Text(
                        stage.isDone ? 'Done' : (stage.isCurrent ? 'You are here · $dayLabel' : 'Coming up'),
                        style: OnbText.label,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
      ],
    ),
  ),
);
