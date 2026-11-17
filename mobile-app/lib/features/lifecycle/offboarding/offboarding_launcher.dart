/// Where a tapped offboarding push opens. The server names it in
/// `data.destination` (backend services/lifecycle/offboarding.ts,
/// `OffboardingDestination`), as onboarding's pushes do; the shell lends the
/// ways to its own tabs and pages ([OffboardingRoutes]).
library;

import 'dart:async';

import 'offboarding_store.dart';

/// What the shell can open for an offboarding push.
class OffboardingRoutes {
  const OffboardingRoutes({
    required this.openRequests,
    required this.openOwnResignation,
    required this.openOffboarding,
    required this.openLeaver,
    this.openElsewhere,
  });

  /// Team › Requests, with [resignationId]'s card brought into view.
  final void Function(String? resignationId) openRequests;

  /// One's own profile on its Resignation tab (R2a / R2b).
  final void Function() openOwnResignation;

  /// Action › Off-boarding (R3); [section] `handover` opens R3b over it,
  /// `exit_interview` R5.
  final void Function({String? section}) openOffboarding;

  /// A report's profile on its Resignation tab (R8b).
  final void Function(String userId) openLeaver;

  /// A push with nothing to open in the app (the dashboard's clearance).
  final void Function()? openElsewhere;
}

/// Takes a tapped offboarding push to its screen, once [store] has read
/// what it says (so a tab that the push is about is there). False when
/// [data] is not an offboarding push.
bool openOffboardingDestination(
  Map<String, dynamic> data,
  OffboardingStore store,
  OffboardingRoutes routes,
) {
  final destination = '${data['destination'] ?? ''}';
  final type = '${data['type'] ?? ''}';
  // An older push of ours carries only its type; it opens the nearest place.
  final known = offboardingPushDestinations.contains(destination);
  if (!known &&
      type != 'lifecycle_offboarding' &&
      type != 'lifecycle_resignation') {
    return false;
  }
  String? read(String key) {
    final value = data[key];
    return value == null || '$value'.isEmpty ? null : '$value';
  }

  final userId = read('userId');
  final resignationId = read('resignationId');
  unawaited(
    store.refresh().whenComplete(() {
      switch (destination) {
        case 'lifecycle_resignation_request':
          routes.openRequests(resignationId);
        case 'lifecycle_resignation':
          // The tab is there while a resignation is open or an exit is under
          // way; after a withdrawal it is not, and the page is the next best.
          if (store.showsResignationTab) {
            routes.openOwnResignation();
          } else if (store.showsOffboardingPage) {
            routes.openOffboarding();
          } else {
            routes.openOwnResignation();
          }
        case 'lifecycle_offboarding':
          store.showsOffboardingPage
              ? routes.openOffboarding()
              : routes.openOwnResignation();
        case 'lifecycle_handover':
          store.showsOffboardingPage
              ? routes.openOffboarding(section: 'handover')
              : routes.openOwnResignation();
        case 'lifecycle_exit_interview':
          store.showsOffboardingPage
              ? routes.openOffboarding(section: 'exit_interview')
              : routes.openOwnResignation();
        case 'lifecycle_leaver' when userId != null:
          routes.openLeaver(userId);
        case 'lifecycle_clearance':
          routes.openElsewhere?.call();
        default:
          // Only the type: a resignation's push to a manager is about their
          // Requests; anything else of ours, about one's own exit.
          if (type == 'lifecycle_resignation' &&
              resignationId != null &&
              userId != null) {
            routes.openRequests(resignationId);
          } else if (userId != null && store.hasLeaverTab(userId)) {
            routes.openLeaver(userId);
          } else {
            routes.openOwnResignation();
          }
      }
    }),
  );
  return true;
}
