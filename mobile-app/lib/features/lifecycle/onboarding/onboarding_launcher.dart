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

import 'data/onboarding_models.dart';
import 'presentation/manager/joiner_screen.dart';
import 'presentation/manager/probation_review_screen.dart';
import 'presentation/manager/starter_review_screen.dart';
import 'presentation/meeting_screen.dart';
import 'presentation/notes_screen.dart';
import 'presentation/onboarding_home_screen.dart';
import 'presentation/onboarding_kit.dart';
import 'presentation/onboarding_tiles.dart';
import 'presentation/people_screen.dart';
import 'presentation/probation_screens.dart';
import 'presentation/intro_post_screen.dart';
import 'presentation/starter_task_screen.dart';
import 'presentation/survey_screen.dart';
import 'presentation/task_sheet.dart';
import 'presentation/week1_reels_screen.dart';

export 'data/lifecycle_me_store.dart';
export 'presentation/onboarding_kit.dart' show OnboardingShell, OnbSpotlight, OnbPulse;
export 'presentation/first_punch.dart' show FirstPunchTour, PunchSpotlightCallout, openYoureIn;

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

/// A2, the joiner's onboarding home.
Future<void> openOnboardingHome(BuildContext context, {OnboardingShell? shell}) =>
    _push(context, (s) => OnboardingHomeScreen(shell: s), shell: shell);

/// M2, a joiner's week as their manager sees it.
/// [summary]: the Team tab's row, so M2's card paints at once.
Future<void> openJoiner(BuildContext context, String journeyId, {OnboardingShell? shell, JoinerSummary? summary}) =>
    _push(context, (s) => JoinerScreen(shell: s, journeyId: journeyId, summary: summary), shell: shell);

/// Opens a task from the joiner's home or Up next on the screen that does it.
/// Back lands where it came from; the caller reads its list again after.
Future<void> openOnboardingTask(
  BuildContext context,
  OnboardingShell shell,
  TaskView task, {
  OnboardingHome? home,
  List<StarterTask> starterTasks = const [],
}) async {
  Future<void> push(Widget page) => Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => page));
  if (task.isLocked) {
    await showTaskSheet(context, shell, task);
    return;
  }
  switch (task.systemKey) {
    case 'week1_reels':
    case 'probation_goals':
      return push(Week1ReelsScreen(shell: shell));
    case 'intro_post':
      return push(IntroPostScreen(shell: shell));
    case 'people_to_meet':
      return push(PeopleToMeetScreen(shell: shell, dueAt: task.dueAt));
    case 'day7_survey':
    case 'pulse_survey':
      return push(SurveyScreen(shell: shell));
    case 'starter_task':
      final open = starterTasks.where((t) => !t.done).firstOrNull ?? starterTasks.firstOrNull;
      if (open != null) return push(StarterTaskScreen(shell: shell, taskId: open.id, initial: open));
      await showTaskSheet(context, shell, task);
      return;
    case 'one_on_one_notes':
      return push(NotesScreen(shell: shell));
    case 'monthly_goals':
    case 'monthly_review':
      return push(ProbationScreen(shell: shell));
    case 'monthly_checkin':
      return push(ProbationScreen(shell: shell, openCheckinFor: task.month));
    case 'confirmation_reveal':
    case 'confirmation_letter':
      return push(RevealScreen(shell: shell));
    case 'register_face':
      final register = shell.registerFace;
      if (register == null) {
        await showTaskSheet(context, shell, task);
        return;
      }
      final saved = await register(context);
      if (saved) {
        try {
          await shell.api.taskAction(task.id, 'done');
        } catch (_) {
          // The server may already have ticked it from the face setup.
        }
      }
      return;
    case 'app_tour':
      return push(OnbTourScreen(shell: shell, done: home?.tourDone ?? const []));
  }
  final meetingId = task.meetingId;
  if (task.kind == 'meeting' && meetingId != null) {
    return push(MeetingScreen(shell: shell, meetingId: meetingId, task: task));
  }
  if (!context.mounted) return;
  await showTaskSheet(context, shell, task);
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
  Widget? page = switch (destination) {
    'lifecycle_meeting' when read('meetingId') != null => MeetingScreen(shell: shell, meetingId: read('meetingId')!),
    'lifecycle_starter_task' => StarterTaskScreen(shell: shell, taskId: read('starterTaskId')),
    'lifecycle_notes' => NotesScreen(shell: shell),
    'lifecycle_week1' => Week1ReelsScreen(shell: shell),
    'lifecycle_intro' => IntroPostScreen(shell: shell),
    'lifecycle_people' => PeopleToMeetScreen(shell: shell),
    'lifecycle_survey' => SurveyScreen(shell: shell),
    'lifecycle_probation' => ProbationScreen(shell: shell),
    'lifecycle_checkin' => ProbationScreen(shell: shell, openCheckinFor: month),
    'lifecycle_reveal' => RevealScreen(shell: shell),
    'lifecycle_joiner' || 'lifecycle_joiner_setup' when journeyId != null => JoinerScreen(
      shell: shell,
      journeyId: journeyId,
      openSetup: destination == 'lifecycle_joiner_setup',
    ),
    'lifecycle_starter_task_done' when journeyId != null => StarterReviewScreen(
      shell: shell,
      journeyId: journeyId,
      starterTaskId: read('starterTaskId'),
    ),
    'lifecycle_probation_review' when journeyId != null && month != null => ProbationReviewScreen(
      shell: shell,
      journeyId: journeyId,
      month: month,
    ),
    // A manager's push without a month: their joiner's page, never the joiner's own home.
    'lifecycle_probation_review' when journeyId != null => JoinerScreen(shell: shell, journeyId: journeyId),
    _ => null,
  };
  page ??= OnboardingHomeScreen(shell: shell);
  unawaited(Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => page!)));
  return true;
}
