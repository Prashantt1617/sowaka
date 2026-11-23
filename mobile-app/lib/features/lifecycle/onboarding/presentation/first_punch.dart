/// Day 1's first punch-in (New joiner canvas, AppActions tour and AppPunch):
/// the "Your first punch-in" card on the onboarding home, the Actions tab's
/// spotlight on the Attendance card ("Slide to punch in · Later · Try it
/// now"), and "You're in!" after the punch.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../../manager/data/manager_models.dart';
import '../joiner/joiner_checkins.dart' show joinerHomeRoute;
import '../onboarding_launcher.dart';
import 'onboarding_kit.dart';
import 'plant.dart';

/// The Actions tab's spotlight, asked for from the onboarding home.
abstract final class FirstPunchTour {
  /// True asks the Actions tab to spotlight its Attendance card; the tab
  /// sets it back once it shows it.
  static final requested = ValueNotifier<bool>(false);

  /// "Your first punch-in": the Actions home, spotlit, opened over the
  /// onboarding screen it was tapped on, so Later and Back return to it as
  /// it was. Completes when it closes. Without the shell's door (a test):
  /// back to the Actions tab's home, which shows the spotlight.
  static Future<void> start(BuildContext context, OnboardingShell shell) async {
    final open = shell.openAppScreen;
    if (open != null) {
      await open(context, 'punch');
      return;
    }
    final select = shell.onSelectTab;
    if (select != null) {
      select(ManagerTab.quick);
    } else {
      Navigator.of(context).popUntil((route) => route.isFirst);
    }
    requested.value = true;
  }
}

/// The blue card under the hero on Day 1, before the first punch-in.
class FirstPunchCard extends StatelessWidget {
  const FirstPunchCard({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => OnbBanner(
    key: const ValueKey('first-punch-card'),
    icon: Icons.arrow_forward_rounded,
    title: 'Your first punch-in',
    subtitle: 'Learn to punch in',
    onTap: onTap,
  );
}

/// What the spotlight's bubble says over the Attendance card.
class PunchSpotlightCallout extends StatelessWidget {
  const PunchSpotlightCallout({super.key, required this.onLater, required this.onTry});

  final VoidCallback onLater;
  final VoidCallback onTry;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: 'Learn to punch in',
    child: Column(
      key: const ValueKey('punch-spotlight'),
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text('Slide to punch in', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: OnbColors.text)),
        const SizedBox(height: 12),
        const Text('Your face is checked as you slide.', style: TextStyle(fontSize: 13, color: OnbColors.text2)),
        const SizedBox(height: 12),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            TextButton(
              key: const ValueKey('punch-spotlight-later'),
              onPressed: onLater,
              style: TextButton.styleFrom(
                foregroundColor: OnbColors.text3,
                minimumSize: const Size(0, 44),
                padding: EdgeInsets.zero,
                textStyle: OnbText.button(context, size: 14),
              ),
              child: const Text('Later'),
            ),
            FilledButton(
              key: const ValueKey('punch-spotlight-try'),
              onPressed: onTry,
              style: FilledButton.styleFrom(
                backgroundColor: OnbColors.primary,
                foregroundColor: Colors.white,
                minimumSize: const Size(0, 44),
                padding: const EdgeInsets.symmetric(horizontal: 18),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                textStyle: OnbText.button(context, size: 14),
              ),
              child: const Text('Try it now'),
            ),
          ],
        ),
      ],
    ),
  );
}

/// After the first punch-in made from the spotlight: "You're in!" over the
/// Actions tab. Back goes to Actions; "Back to onboarding" to the home.
Future<void> openYoureIn(BuildContext context, {required DateTime at, required bool faceRegistered}) async {
  final shell = currentOnboardingShell();
  if (shell == null) return;
  await Navigator.of(context).push<void>(
    MaterialPageRoute(builder: (_) => YoureInScreen(shell: shell, at: at, faceRegistered: faceRegistered)),
  );
}

class YoureInScreen extends StatefulWidget {
  const YoureInScreen({super.key, required this.shell, required this.at, this.faceRegistered = true});

  final OnboardingShell shell;
  final DateTime at;
  final bool faceRegistered;

  @override
  State<YoureInScreen> createState() => _YoureInScreenState();
}

class _YoureInScreenState extends State<YoureInScreen> {
  @override
  void initState() {
    super.initState();
    // The punch is a fact the server reads ("Punch in and out" ticks itself);
    // the Actions tile's words follow it.
    unawaited(LifecycleMeStore.instance.refresh(widget.shell.api));
  }

  /// Back to the onboarding home the punch was started from, as it was;
  /// opened fresh when it is not under this screen (the punch was made from
  /// the Actions tab).
  void _backToOnboarding() {
    final navigator = Navigator.of(context);
    var found = false;
    navigator.popUntil((route) {
      if (route.settings.name == joinerHomeRoute) found = true;
      return found || route.isFirst;
    });
    if (!found) unawaited(openOnboardingHome(navigator.context, shell: widget.shell));
  }

  @override
  Widget build(BuildContext context) => OnbScaffold(
    shell: widget.shell,
    title: 'Attendance',
    body: LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight - 32),
          child: IntrinsicHeight(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                OnbCelebrationCard(
                  eyebrow: 'YOUR FIRST PUNCH-IN',
                  title: 'You’re in!',
                  subtitle: '${onbTime(widget.at)} · ${widget.at.day} ${_monthNames[widget.at.month - 1]}',
                  art: const Plant(stage: 1, size: 150, water: 2, showPill: false),
                ),
                // Only what is true: no face on record, no "Face registered".
                if (widget.faceRegistered) ...[
                  const SizedBox(height: 14),
                  const OnbRise(
                    delay: 80,
                    child: OnbDoneNote(
                      title: 'Face registered',
                      subtitle: 'From tomorrow, just slide to punch in',
                    ),
                  ),
                ],
                const Spacer(),
                const SizedBox(height: 14),
                OnbPrimaryButton(
                  key: const ValueKey('back-to-onboarding'),
                  label: 'Back to onboarding',
                  onTap: _backToOnboarding,
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

const _monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
