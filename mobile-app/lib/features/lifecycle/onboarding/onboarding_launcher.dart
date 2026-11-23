/// Opening the onboarding screens from anywhere in the app: the Action tile,
/// the profile's Onboarding tab, the Actions card of a confirmation waiting on
/// a manager or head of department, a tapped notification.
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
import 'data/confirmation_api.dart';
import 'joiner/joiner_api.dart' show HttpJoinerApi;
import 'joiner/joiner_checkins.dart' show joinerHomeRoute;
import 'joiner/joiner_details.dart' show JoinerPayrollScreen, JoinerProfileSectionScreen;
import 'joiner/joiner_home.dart';
import 'joiner/joiner_parts.dart' show JoinerController;
import 'presentation/manager/confirmation_screens.dart';
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

/// Payroll's "Set up your payroll" rows for someone with an onboarding
/// journey in the app (a joiner, Day 1 on): `bank` and `uan` open their
/// payroll details (bank account, PF and nominees), `pan` their profile's ID
/// documents (Aadhaar and PAN), the same forms the onboarding tasks open.
/// Completes once the form closes; false (nothing opened) for anyone else,
/// whose row asks HR instead.
Future<bool> openJoinerPayrollDetail(BuildContext context, String key) async {
  if (key != 'bank' && key != 'uan' && key != 'pan') return false;
  final me = LifecycleMeStore.instance.value;
  final onboarding = me.onboarding;
  if (!me.enabled || onboarding == null || onboarding.journeyId.isEmpty || onboarding.portal) return false;
  final shell = currentOnboardingShell();
  final api = shell == null ? null : HttpJoinerApi.from(shell.api);
  if (shell == null || api == null) return false;
  final c = JoinerController(shell: shell, api: api);
  try {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => key == 'pan'
            ? JoinerProfileSectionScreen(c: c, section: 'ids', title: 'ID documents')
            : JoinerPayrollScreen(c: c),
      ),
    );
  } finally {
    c.dispose();
  }
  return true;
}

/// A confirmation waiting on the viewer (the Actions card): the manager's
/// review or the head of department's approval, on its own screen.
Future<void> openPendingConfirmation(BuildContext context, PendingConfirmation pending, {OnboardingShell? shell}) {
  final resolved = shell ?? currentOnboardingShell();
  if (resolved == null) return Future.value();
  return openConfirmation(context, shell: resolved, journeyId: pending.journeyId, kind: pending.kind);
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
  'lifecycle_confirmation_review',
  'lifecycle_confirmation_approval',
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
  // The manager's confirmation review and the head of department's approval: their own screens.
  // There is no other team-side onboarding screen (HR assigns those tasks on the dashboard); a
  // teammate's other pushes about a joiner open the joiner's profile (`employee_profile`, the shell's).
  final kind = switch (destination) {
    'lifecycle_confirmation_review' => ConfirmationKind.review,
    'lifecycle_confirmation_approval' => ConfirmationKind.approval,
    _ => null,
  };
  if (kind != null) {
    if (journeyId == null) return false;
    unawaited(openConfirmation(context, shell: shell, journeyId: journeyId, kind: kind));
    return true;
  }
  // The joiner's own pushes (Final designs, lane J) all open Actions › Onboarding (JoinerHomeScreen).
  unawaited(openOnboardingHome(context, shell: shell));
  return true;
}
