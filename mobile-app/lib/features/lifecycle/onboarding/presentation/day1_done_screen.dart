/// "Day 1, done!" (the 20 Nov New joiner artifact, End of Day 1): after the
/// joiner's punch-out on their joining date. The plant, the server's counts
/// (people met, things done) and the first punch-in, "How was today?"
/// (Great, Okay, Tough: saved on the journey, where HR sees it on the joiner
/// panel) and what tomorrow brings.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import '../onboarding_launcher.dart';
import 'onboarding_kit.dart';
import 'plant.dart';

/// Opens "Day 1, done!" over the Actions tab, when the app is signed in.
Future<void> openDay1Done(BuildContext context) async {
  final shell = currentOnboardingShell();
  if (shell == null) return;
  await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => Day1DoneScreen(shell: shell)));
}

/// Saves a "How was today?" answer; the one the server kept.
typedef SaveDay1Feeling = Future<String?> Function(String answer);

class Day1DoneScreen extends StatefulWidget {
  const Day1DoneScreen({super.key, required this.shell, this.saveFeeling});

  final OnboardingShell shell;

  /// Where an answer goes; the server's (`PUT /lifecycle/onboarding/day1-feeling`) when null.
  final SaveDay1Feeling? saveFeeling;

  @override
  State<Day1DoneScreen> createState() => _Day1DoneScreenState();
}

class _Day1DoneScreenState extends State<Day1DoneScreen> {
  OnboardingHome? _home;
  String? _error;

  /// The answer shown picked: the server's, then the one just tapped.
  String? _feeling;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final home = await widget.shell.api.fetchHome();
      if (!mounted) return;
      setState(() {
        _home = home;
        _feeling ??= home.day1?.feeling;
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _pick(String answer) async {
    final before = _feeling;
    if (before == answer) return;
    setState(() => _feeling = answer);
    try {
      final save = widget.saveFeeling ?? _serverSave;
      final kept = await save(answer);
      if (mounted && kept != null && kept != _feeling) setState(() => _feeling = kept);
    } catch (error) {
      if (!mounted) return;
      setState(() => _feeling = before);
      showAppToast(context, '$error');
    }
  }

  Future<String?> _serverSave(String answer) async {
    final api = widget.shell.api;
    if (api is! HttpOnboardingApi) return answer;
    return api.saveDay1Feeling(answer);
  }

  @override
  Widget build(BuildContext context) {
    final home = _home;
    return OnbScaffold(
      shell: widget.shell,
      title: 'Onboarding',
      body: home == null
          ? OnbLoadState(error: _error, onRetry: _load)
          : ListView(
              key: const ValueKey('day1-done'),
              padding: const EdgeInsets.all(16),
              children: [
                OnbCelebrationCard(
                  eyebrow: 'DAY 1 COMPLETE',
                  title: 'Day 1, done!',
                  titleSize: 36,
                  subtitle: 'Your plant has sprouted',
                  art: Plant(stage: home.plant.stage, size: 120, water: 3),
                ),
                const SizedBox(height: 14),
                OnbRise(
                  delay: 80,
                  child: Row(
                    children: [
                      _Stat(key: const ValueKey('day1-people'), value: '${home.day1?.peopleMet ?? 0}', label: 'people met'),
                      const SizedBox(width: 8),
                      _Stat(key: const ValueKey('day1-things'), value: '${home.day1?.thingsDone ?? home.progress.done}', label: 'things done'),
                      const SizedBox(width: 8),
                      const _Stat(value: '1st', label: 'punch-in'),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                OnbRise(
                  delay: 160,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Semantics(
                        header: true,
                        child: const Text(
                          'How was today?',
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          for (final (i, f) in _feelings.indexed) ...[
                            if (i > 0) const SizedBox(width: 8),
                            Expanded(
                              child: _FeelingButton(
                                feeling: f,
                                picked: _feeling == f.key,
                                onTap: () => unawaited(_pick(f.key)),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                OnbCard(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  child: const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'TOMORROW',
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 0.88, color: OnbColors.primary),
                      ),
                      SizedBox(height: 4),
                      Text(
                        'Your Week-1 tasks open',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text),
                      ),
                      SizedBox(height: 4),
                      Text('Slide to punch in when you arrive', style: OnbText.label),
                    ],
                  ),
                ),
              ],
            ),
    );
  }
}

typedef _Feeling = ({String key, String label, IconData icon, Color tint, Color color});

const List<_Feeling> _feelings = [
  (key: 'great', label: 'Great', icon: Icons.sentiment_satisfied_alt_outlined, tint: OnbColors.successTint, color: OnbColors.successText),
  (key: 'okay', label: 'Okay', icon: Icons.sentiment_neutral_outlined, tint: OnbColors.amberTint, color: OnbColors.amber),
  (key: 'tough', label: 'Tough', icon: Icons.sentiment_dissatisfied_outlined, tint: OnbColors.rustTint, color: OnbColors.rust),
];

class _FeelingButton extends StatelessWidget {
  const _FeelingButton({required this.feeling, required this.picked, required this.onTap});

  final _Feeling feeling;
  final bool picked;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    inMutuallyExclusiveGroup: true,
    checked: picked,
    button: true,
    label: feeling.label,
    excludeSemantics: true,
    child: Material(
      key: ValueKey('day1-feeling-${feeling.key}'),
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: picked ? feeling.color : OnbColors.line, width: picked ? 2 : 1),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          height: 84,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(color: feeling.tint, shape: BoxShape.circle),
                child: Icon(feeling.icon, size: 22, color: feeling.color),
              ),
              const SizedBox(height: 6),
              Text(feeling.label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: OnbColors.text)),
            ],
          ),
        ),
      ),
    ),
  );
}

class _Stat extends StatelessWidget {
  const _Stat({super.key, required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) => Expanded(
    child: OnbCard(
      radius: 16,
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(value, style: const TextStyle(fontSize: 26, height: 1.15, fontWeight: FontWeight.w800, color: OnbColors.primary)),
          const SizedBox(height: 2),
          Text(label, style: OnbText.label.copyWith(fontSize: 11)),
        ],
      ),
    ),
  );
}
