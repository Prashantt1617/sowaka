import '../data/onboarding_models.dart';

/// What is left of the 20 Nov tiles: two list helpers the teammates'
/// progress view (manager/team_progress.dart, lane T) still reads from the
/// older home. The joiner's own screens are in joiner/ (Final designs).

/// The joiner's meetings in the home: their timed items, done ones too.
List<TaskView> joinerMeetings(OnboardingHome home) => [
  for (final t in [...home.today, ...home.later, ...home.done])
    if (t.kind == 'meeting' && t.systemKey != 'people_to_meet') t,
];

/// The joiner's own tasks (not meetings, not the tour, which has its tile).
List<TaskView> joinerTasks(OnboardingHome home) => [
  for (final t in [...home.today, ...home.later, ...home.done])
    if (t.kind != 'meeting' && t.systemKey != 'app_tour' && !t.readOnly && t.ownerRole == 'employee') t,
];
