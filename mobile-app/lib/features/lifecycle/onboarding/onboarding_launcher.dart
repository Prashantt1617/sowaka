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
import 'data/onboarding_api.dart';
import 'data/staff_api.dart';
import 'data/team_joiners_api.dart';
import 'joiner/joiner_checkins.dart' show joinerHomeRoute;
import 'joiner/joiner_home.dart';
import 'presentation/manager/team_joiner_screens.dart';
import 'presentation/onboarding_kit.dart';
import 'presentation/portal_page_screen.dart';
import 'presentation/staff/staff_screens.dart' show StaffPersonScreen, openStaffOnboarding;

export 'data/lifecycle_me_store.dart';
export 'presentation/onboarding_kit.dart' show OnboardingShell, OnbSpotlight, OnbPulse;
export 'presentation/first_punch.dart' show FirstPunchTour, PunchSpotlightCallout, openYoureIn;
export 'presentation/portal_page_screen.dart' show PortalTab;

typedef OnboardingShellMaker = OnboardingShell Function();

/// The `/lifecycle/staff/*` client a `lifecycle_staff` push opens with (tests hand in a fake).
@visibleForTesting
StaffApi? Function(OnboardingApi api) launcherStaffApi = HttpStaffApi.from;

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

/// Teams › Joiners, a joiner's page (Final designs; manager, buddy, head of department).
Future<void> openJoiner(BuildContext context, String journeyId, {OnboardingShell? shell}) {
  final resolved = shell ?? currentOnboardingShell();
  final api = resolved == null ? null : HttpTeamJoinersApi.from(resolved.api);
  if (resolved == null || api == null) return Future.value();
  return openTeamJoiner(context, shell: resolved, api: api, journeyId: journeyId);
}

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
  'lifecycle_staff',
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
  // The joiner's own pushes (Final designs, lane J) all open Actions › Onboarding (JoinerHomeScreen);
  // every manager / buddy / head-of-department push (lane T) lands on the joiner's team page.
  final teamApi = HttpTeamJoinersApi.from(shell.api);
  final Widget? page = switch (destination) {
    'lifecycle_joiner' ||
    'lifecycle_joiner_setup' ||
    'lifecycle_starter_task_done' ||
    'lifecycle_probation_review' when journeyId != null && teamApi != null =>
      TeamPersonScreen(shell: shell, api: teamApi, journeyId: journeyId),
    // HR's / IT & admin's (late-task reminders, meeting invites): their person page for that joiner.
    'lifecycle_staff' when journeyId != null && launcherStaffApi(shell.api) != null => StaffPersonScreen(
      shell: shell,
      api: launcherStaffApi(shell.api)!,
      journeyId: journeyId,
      name: read('name') ?? '',
      as: read('as') == null ? null : StaffRole.parse(read('as')),
    ),
    _ => null,
  };
  if (page == null && destination == 'lifecycle_staff') {
    unawaited(openStaffOnboarding(context, shell: shell, api: launcherStaffApi(shell.api)));
    return true;
  }
  if (page == null) {
    unawaited(openOnboardingHome(context, shell: shell));
    return true;
  }
  unawaited(Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => page)));
  return true;
}
