import 'package:flutter/material.dart';

import '../data/onboarding_models.dart';
import 'onboarding_kit.dart';
import 'plant.dart';

/// A8 · Week 1, done (6Zs §5.3): shown once, on the first open after Tj + 7.
/// The plant is a seedling now; the stats; what comes next.
class WeekDoneScreen extends StatelessWidget {
  const WeekDoneScreen({super.key, required this.shell, required this.home, this.peopleMet});

  final OnboardingShell shell;
  final OnboardingHome home;
  final int? peopleMet;

  @override
  Widget build(BuildContext context) {
    // The server's count when it sends one (the week's tasks, people met, leaves).
    final stats = home.weekDoneStats;
    final tasksDone = stats?.tasksDone ?? home.done.length + home.today.where((t) => t.isDone).length;
    final peopleTask = home.all.where((t) => t.systemKey == 'people_to_meet').firstOrNull;
    final people = peopleMet ?? stats?.peopleMet ?? peopleTask?.progress?.done;
    final goalsOn = home.tj == null ? null : dateOnly(home.tj!).add(const Duration(days: 7));
    final manager = home.managerName ?? 'Your manager';
    return OnbScaffold(
      shell: shell,
      title: 'Onboarding',
      showNav: false,
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          // The moment, on its green card, as drawn.
          OnbRise(
            child: Container(
              key: const ValueKey('week-done-hero'),
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 0),
              decoration: BoxDecoration(color: OnbColors.doneTint, borderRadius: BorderRadius.circular(28)),
              child: Column(
                children: [
                  const Text(
                    'WELCOME STAGE COMPLETE',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.1, color: OnbColors.doneText),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Week 1, done!',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 40, height: 1.05, fontWeight: FontWeight.w800, letterSpacing: -1.2, color: OnbColors.text),
                  ),
                  const SizedBox(height: 8),
                  const Text('Your plant is now a seedling', textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: OnbColors.text2)),
                  const SizedBox(height: 40),
                  Plant(stage: 2, size: 150, leaves: home.plant.leaves, droop: home.plant.droop),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              _Stat(value: '$tasksDone', label: 'tasks done'),
              const SizedBox(width: 10),
              _Stat(value: people == null ? '–' : '$people', label: 'people met'),
              const SizedBox(width: 10),
              _Stat(value: '+${stats?.leaves ?? home.plant.leaves}', label: 'leaves grown'),
            ],
          ),
          const SizedBox(height: 14),
          OnbCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'NEXT STAGE · SETTLING IN',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.1, color: OnbColors.primary),
                ),
                const SizedBox(height: 6),
                Text(
                  goalsOn == null ? 'Your month-1 goals arrive soon' : 'Your month-1 goals arrive ${onbDay(goalsOn)}',
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text),
                ),
                const SizedBox(height: 4),
                Text('$manager sets them. You’ll check in at the end of the month.', style: OnbText.label),
              ],
            ),
          ),
        ],
      ),
      footer: OnbFooter(
        children: [OnbPrimaryButton(label: 'See what’s next', onTap: () => Navigator.of(context).pop())],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) => Expanded(
    child: OnbCard(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            style: const TextStyle(fontSize: 26, height: 1.1, fontWeight: FontWeight.w800, color: OnbColors.primary),
          ),
          const SizedBox(height: 4),
          Text(label, style: OnbText.label.copyWith(color: OnbColors.text2)),
        ],
      ),
    ),
  );
}
