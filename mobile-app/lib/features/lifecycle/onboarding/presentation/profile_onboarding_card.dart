import 'dart:async';

import 'package:flutter/material.dart';

import '../data/onboarding_models.dart';
import '../onboarding_launcher.dart';
import 'onboarding_kit.dart';
import 'plant.dart';

/// A1b · My Profile › Onboarding (6Zs §5.3): the day and stage, what is
/// left today, the next item, progress, the plant, and Continue → A2.
class OnboardingProfileCard extends StatefulWidget {
  const OnboardingProfileCard({super.key, this.shell});

  /// Supplied by tests; the signed-in shell's otherwise.
  final OnboardingShell? shell;

  @override
  State<OnboardingProfileCard> createState() => _OnboardingProfileCardState();
}

class _OnboardingProfileCardState extends State<OnboardingProfileCard> {
  OnboardingHome? _home;
  bool _failed = false;

  OnboardingShell? get _shell => widget.shell ?? currentOnboardingShell();

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final shell = _shell;
    if (shell == null) return;
    try {
      final home = await shell.api.fetchHome();
      if (mounted) {
        setState(() {
          _home = home;
          _failed = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  Future<void> _continue() async {
    final shell = _shell;
    if (shell == null) return;
    await openOnboardingHome(context, shell: shell);
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final shell = _shell;
    final home = _home;
    if (shell == null || (home == null && _failed)) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Text('Your onboarding couldn’t load. Pull to try again.', style: OnbText.label),
      );
    }
    if (home == null) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 40),
        child: Center(child: CircularProgressIndicator(color: OnbColors.primary)),
      );
    }
    final now = shell.now();
    final upNext = home.upNext ?? pickUpNext(home.today, now);
    final toDo = home.today.where((t) => t.isOpen && t.forEmployee).length;
    final progress = home.progress;
    final nextLine = upNext == null
        ? null
        : upNext.startsAt == null
        ? 'Next: ${upNext.title.toLowerCase()}'
        : 'Next: ${upNext.title.toLowerCase()} at ${onbTime(upNext.startsAt!)}';
    return OnbCard(
      key: const ValueKey('profile-onboarding-card'),
      radius: 24,
      padding: const EdgeInsets.all(18),
      onTap: _continue,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${home.dayLabelOn(now)} · ${onboardingStageLabel(home.stage)}'.toUpperCase(),
                      style: OnbText.eyebrow,
                    ),
                    const SizedBox(height: 6),
                    Text(toDo == 0 ? 'All done for now' : '$toDo to do', style: OnbText.display),
                    if (nextLine != null) ...[
                      const SizedBox(height: 4),
                      Text(nextLine, style: OnbText.label),
                    ],
                  ],
                ),
              ),
              Plant.of(home.plant, size: 100),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Semantics(
                  label: 'Onboarding progress, ${progress.done} of ${progress.total} done',
                  child: ExcludeSemantics(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: progress.done / progress.total,
                        minHeight: 8,
                        backgroundColor: OnbColors.line,
                        color: OnbColors.green,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Text(progress.label, style: OnbText.label),
            ],
          ),
          const SizedBox(height: 14),
          OnbPrimaryButton(key: const ValueKey('profile-onboarding-continue'), label: 'Continue', onTap: _continue),
        ],
      ),
    );
  }
}
