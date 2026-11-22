/// Opening the onboarding screens from anywhere in the app: the Action tile,
/// the profile's Onboarding tab, the Team tab's New joiners, a tapped
/// notification.
///
/// The signed-in shell (`ManagerScreen`) knows the session, the header and
/// the tabs. It registers a maker of [OnboardingShell] here while it is
/// mounted, as `support_launcher.dart` does for the Support desk, so these
/// places open the screens without importing the shell.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../manager/data/manager_models.dart' show ManagerTab;
import 'data/lifecycle_me_store.dart';
import 'data/onboarding_models.dart';
import 'data/team_joiners_api.dart';
import 'joiner/joiner_checkins.dart' show joinerHomeRoute;
import 'joiner/joiner_home.dart';
import 'presentation/manager/joiner_screen.dart';
import 'presentation/manager/manager_review_screen.dart';
import 'presentation/onboarding_kit.dart';
import 'presentation/portal_page_screen.dart';

export 'data/lifecycle_me_store.dart';
export 'presentation/onboarding_kit.dart' show OnboardingShell, OnbSpotlight, OnbPulse;
export 'presentation/first_punch.dart' show FirstPunchTour, PunchSpotlightCallout, openYoureIn;
export 'presentation/portal_page_screen.dart' show PortalTab;

typedef OnboardingShellMaker = OnboardingShell Function();

OnboardingShellMaker? _maker;

void registerOnboardingShell(OnboardingShellMaker maker) => _maker = maker;

/// Only clears [maker]'s own registration.
void unregisterOnboardingShell(OnboardingShellMaker maker) {
  if (_maker == maker) _maker = null;
}

/// The shell for a screen opened now; null when nothing signed in is on
/// screen (a test, or before sign-in).
OnboardingShell? currentOnboardingShell() => _maker?.call();

Future<T?> _push<T>(BuildContext context, Widget Function(OnboardingShell shell) page, {OnboardingShell? shell}) {
  final resolved = shell ?? currentOnboardingShell();
  if (resolved == null) return Future.value();
  return Navigator.of(context).push<T>(MaterialPageRoute(builder: (_) => page(resolved)));
}

/// Actions › Onboarding, the joiner's home (Final designs, `JoinerHomeScreen`).
/// Before Day 1 (`/lifecycle/me` says `portal`) the Action tab is the
/// pre-boarding portal, so this goes there (the portal as a page over the
/// shell where there is no Action tab), never to the app's own screens.
Future<void> openOnboardingHome(BuildContext context, {OnboardingShell? shell}) {
  if (LifecycleMeStore.instance.value.onboarding?.portal ?? false) {
    final resolved = shell ?? currentOnboardingShell();
    final select = resolved?.onSelectTab;
    if (resolved != null && select != null && resolved.tabs.contains(ManagerTab.quick)) {
      select(ManagerTab.quick);
      return Future.value();
    }
    return _push(context, (s) => PortalPageScreen(shell: s), shell: shell);
  }
  final resolved = shell ?? currentOnboardingShell();
  if (resolved == null) return Future.value();
  return Navigator.of(context).push<void>(
    MaterialPageRoute(settings: const RouteSettings(name: joinerHomeRoute), builder: (_) => JoinerHomeScreen(shell: resolved)),
  );
}

/// M2, a joiner's week as their manager sees it.
/// [summary]: the Team tab's row, so M2's card paints at once.
Future<void> openJoiner(BuildContext context, String journeyId, {OnboardingShell? shell, JoinerSummary? summary}) =>
    _push(context, (s) => JoinerScreen(shell: s, journeyId: journeyId, summary: summary), shell: shell);

/// The notification destinations these screens answer (the server sets
/// `data.destination`; see the report in docs). Unknown ones are left to the
/// shell, so the offboarding screens' own `lifecycle_*` kinds pass through.
const onboardingDestinations = {
  'lifecycle_onboarding',
  'lifecycle_meeting',
  'lifecycle_starter_task',
  'lifecycle_notes',
  'lifecycle_week1',
  'lifecycle_intro',
  'lifecycle_people',
  'lifecycle_survey',
  'lifecycle_probation',
  'lifecycle_checkin',
  'lifecycle_reveal',
  'lifecycle_week_done',
  'lifecycle_joiner',
  'lifecycle_joiner_setup',
  'lifecycle_starter_task_done',
  'lifecycle_probation_review',
};

/// Takes a tapped lifecycle notification to its screen. False when [data]
/// is not one of [onboardingDestinations] (or nothing can open it).
bool openOnboardingDestination(BuildContext context, Map<String, dynamic> data) {
  final destination = '${data['destination'] ?? ''}';
  if (!onboardingDestinations.contains(destination)) return false;
  final shell = currentOnboardingShell();
  if (shell == null) return false;
  String? read(String key) {
    final value = data[key];
    return value == null || '$value'.isEmpty ? null : '$value';
  }

  final journeyId = read('journeyId');
  final month = int.tryParse(read('month') ?? '');
  // The joiner's (Final designs): every one of theirs opens Actions › Onboarding.
  final Widget? page = switch (destination) {
    'lifecycle_joiner' || 'lifecycle_joiner_setup' when journeyId != null => JoinerScreen(
      shell: shell,
      journeyId: journeyId,
      openSetup: destination == 'lifecycle_joiner_setup',
    ),
    // The manager's side draws no starter-task reply (team-side prototype): their joiner's page.
    'lifecycle_starter_task_done' when journeyId != null => JoinerScreen(shell: shell, journeyId: journeyId),
    // "Check-in sent": the month's self check-in to review (MgrReview).
    'lifecycle_probation_review' when journeyId != null && month != null && HttpTeamJoinersApi.from(shell.api) != null => ManagerReviewScreen(
      shell: shell,
      teamApi: HttpTeamJoinersApi.from(shell.api)!,
      journeyId: journeyId,
      month: month,
    ),
    // A manager's push without a month: their joiner's page, never the joiner's own home.
    'lifecycle_probation_review' when journeyId != null => JoinerScreen(shell: shell, journeyId: journeyId),
    _ => null,
  };
  if (page == null) {
    unawaited(openOnboardingHome(context, shell: shell));
    return true;
  }
  unawaited(Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => page)));
  return true;
}
