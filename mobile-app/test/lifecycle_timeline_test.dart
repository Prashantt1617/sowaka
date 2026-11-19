// The timeline (New joiner artifact, "Timeline · tap a stage to look ahead or
// back", and "After Day 1 · the same screen, phase by phase"): the stage row
// from Day 1 to Confirmed, her own stage through the journey, each thing's
// stage, and the lens — now (From Week 1, COMING UP), ahead (IN MONTH 1, then
// NOW · WEEK 1, locked "Opens in Month 1"), back (Still open first, ticks).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_home_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/timeline/stage_lens.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'lifecycle_onboarding_test.dart' show FakeOnboardingApi, pumpPage, scrollTo, shellFor, task;

/// A probation task: phase probation, its month.
Map<String, dynamic> ptask(String id, String title, int month, {String status = 'todo', String kind = 'form', String? systemKey, DateTime? opensAt, DateTime? dueAt}) => {
  ...task(id, title, status: status, kind: kind, systemKey: systemKey, opensAt: opensAt, dueAt: dueAt),
  'phase': 'probation',
  'month': month,
};

const journey6 = [
  {'key': 'pre_boarding', 'label': 'Pre-boarding', 'state': 'done'},
  {'key': 'welcome_week1', 'label': 'Week 1', 'state': 'current'},
  {'key': 'settling_in', 'label': 'Month 1', 'state': 'todo'},
  {'key': 'growing_gains', 'label': 'Months 2–5', 'state': 'todo'},
  {'key': 'final_month', 'label': 'Final month', 'state': 'todo'},
  {'key': 'ready_to_perform', 'label': 'Confirmed', 'state': 'todo'},
];

/// Week 1 as the artifact draws it (Tj Tue 1 Dec 2026): IT met, Payroll to
/// meet, the week's tasks, one Day-1 task left over, and Month 1 ahead.
OnboardingHome week1({String stage = 'welcome_week1', String? dayLabel, Map<String, dynamic>? upNext}) => OnboardingHome.fromJson({
  'upNext': ?upNext,
  'journeyId': 'j1',
  'stage': stage,
  'dayLabel': ?dayLabel,
  'tj': '2026-12-01',
  'plant': {'stage': 1},
  'today': [
    task('face', 'Register your face', systemKey: 'register_face', dueAt: DateTime(2026, 12, 1)),
    task('tax', 'Declare your tax and investments', kind: 'form', dueAt: DateTime(2026, 12, 6)),
    task('pol', 'Acknowledge policies', systemKey: 'week1_reels', dueAt: DateTime(2026, 12, 6)),
    task('intro', 'Post your intro', systemKey: 'intro_post', dueAt: DateTime(2026, 12, 6)),
    task('nominees', 'Add your nominees', kind: 'form', dueAt: DateTime(2026, 12, 6)),
    task('payroll', 'Meet Payroll', kind: 'meeting', dueAt: DateTime(2026, 12, 4, 10)),
    ptask('posh', 'Complete POSH training', 1),
    ptask('campus', 'Meet your campus head', 1, kind: 'meeting'),
  ],
  'later': [
    task('day7', 'Day-7 survey', systemKey: 'day7_survey', kind: 'survey', status: 'locked', opensAt: DateTime(2026, 12, 7)),
    ptask('self', 'Your self check-in', 1, status: 'locked', opensAt: DateTime(2026, 12, 20)),
    ptask('chk1', 'Month-1 check-in', 1, kind: 'checkin', systemKey: 'monthly_checkin', status: 'locked', opensAt: DateTime(2026, 12, 25)),
    ptask('chk2', 'Month-2 check-in', 2, kind: 'checkin', systemKey: 'monthly_checkin', status: 'locked', opensAt: DateTime(2027, 1, 25)),
  ],
  'done': [
    task('welcome', 'Welcome and induction', status: 'done', ownerRole: 'hr', dueAt: DateTime(2026, 12, 1)),
    task('it', 'Meet the IT helpdesk', kind: 'meeting', status: 'done', dueAt: DateTime(2026, 12, 2, 11)),
  ],
  'journey': journey6,
});

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  final tj = DateTime(2026, 12, 1);

  group('the stage row', () {
    test('Day 1, Week 1, Month 1 … Month N, Confirmed', () {
      expect(lensSteps(6), ['Day 1', 'Week 1', 'Month 1', 'Month 2', 'Month 3', 'Month 4', 'Month 5', 'Month 6', 'Confirmed']);
      expect(lensSteps(3), ['Day 1', 'Week 1', 'Month 1', 'Month 2', 'Month 3', 'Confirmed']);
    });

    test('the probation length from the journey', () {
      expect(probationMonthsOf(week1().journey), 6);
      expect(probationMonthsOf([const JourneyStage(key: 'growing_gains', label: 'Month 2', state: 'todo')]), 3);
      expect(probationMonthsOf(const []), 6);
    });

    test('her stage: Day 1, Week 1, Month 1, Month k, the final month, Confirmed', () {
      int at(String stage, DateTime now, {String? dayLabel}) =>
          StageLens.currentStepOf(week1(stage: stage, dayLabel: dayLabel), now, months: 6);
      expect(at('welcome_week1', DateTime(2026, 12, 1, 9)), 0);
      expect(at('welcome_week1', DateTime(2026, 12, 3)), 1);
      expect(at('settling_in', DateTime(2026, 12, 15)), 2);
      expect(at('growing_gains', DateTime(2027, 2, 10), dayLabel: 'Month 3'), 4);
      expect(at('growing_gains', DateTime(2027, 2, 10)), 4);
      expect(at('final_month', DateTime(2027, 5, 10)), 7);
      expect(at('ready_to_perform', DateTime(2027, 6, 10)), 8);
    });

    test('each thing\'s stage: Day 1 by its day, the week, its probation month, the reveal', () {
      int of(Map<String, dynamic> json, {int current = 1}) => StageLens.stepOfTask(TaskView.fromJson(json), tj, current: current, months: 6);
      expect(of(task('a', 'Welcome', dueAt: DateTime(2026, 12, 1))), 0);
      expect(of(task('b', 'Reels', dueAt: DateTime(2026, 12, 6))), 1);
      expect(of(task('c', 'Survey', status: 'locked', opensAt: DateTime(2026, 12, 7))), 1);
      expect(of(task('d', 'Undated'), current: 0), 0);
      expect(of(task('d', 'Undated'), current: 3), 1);
      expect(of(ptask('e', 'Check-in', 3)), 4);
      expect(of({...task('f', 'Pulse', opensAt: DateTime(2027, 2, 1)), 'phase': 'probation'}), 4);
      expect(of({...task('g', 'Your outcome', systemKey: 'confirmation_reveal'), 'phase': 'probation'}), 8);
    });
  });

  group('the lens', () {
    final now = DateTime(2026, 12, 3, 10);

    test('her own stage: left over first, this week, then COMING UP', () {
      final lens = StageLens.of(week1(), now);
      expect(lens.mode, LensMode.now);
      expect(lens.eyebrow, 'YOU ARE HERE');
      expect(lens.title, 'Week 1');
      final rows = lens.tasks;
      expect(rows.first.id, 'face');
      expect(rows.first.pillText, 'From Day 1');
      final soon = rows.indexWhere((r) => r.head == 'COMING UP');
      final posh = rows.firstWhere((r) => r.id == 'posh');
      expect(rows.indexOf(posh), greaterThanOrEqualTo(soon));
      expect(posh.pillText, 'Month 1');
      expect(posh.locked, isFalse);
      final self = rows.firstWhere((r) => r.id == 'self');
      expect(self.locked, isTrue);
      expect(self.lockText, 'Opens in Month 1');
      // The Day-7 survey is this week's; the Month-2 check-in is too far ahead to list.
      expect(rows.indexWhere((r) => r.id == 'day7'), lessThan(soon));
      expect(lens.meetings.any((r) => r.id == 'chk2'), isFalse);
      expect(lens.taskTile.label, 'UP NEXT');
      expect(lens.meetingsMeta, '1 of 2 met');
    });

    test('a stage ahead: IN MONTH 1 first, locked ones say when, then NOW · WEEK 1', () {
      final lens = StageLens.of(week1(), now, selected: 2);
      expect(lens.mode, LensMode.ahead);
      expect(lens.eyebrow, 'A LOOK AHEAD');
      expect(lens.title, 'Month 1');
      expect(lens.backLabel, 'Back to Week 1');
      final rows = lens.tasks;
      expect(rows.first.head, 'IN MONTH 1');
      expect(rows.where((r) => r.stage == 2).map((r) => r.id).toSet(), {'posh', 'self'});
      expect(rows.firstWhere((r) => r.id == 'posh').locked, isFalse);
      expect(rows.firstWhere((r) => r.id == 'self').lockText, 'Opens in Month 1');
      final nowRow = rows.firstWhere((r) => r.head?.startsWith('NOW') ?? false);
      expect(nowRow.head, 'NOW · WEEK 1');
      expect(rows.firstWhere((r) => r.id == 'face').pillText, 'From Day 1');
      expect(lens.taskTile, (label: 'IN MONTH 1', title: 'Complete POSH training', meta: '2 tasks'));
      expect(lens.meetingsMeta, '2 meetings in Month 1');
      expect(lens.meetings.where((r) => r.stage == 2).map((r) => r.id).toSet(), {'campus', 'chk1'});
    });

    test('Confirmed ahead: ONCE CONFIRMED', () {
      final lens = StageLens.of(week1(), now, selected: 8);
      expect(lens.inLabel, 'ONCE CONFIRMED');
      expect(opensInLabel('Confirmed'), 'Opens once you’re confirmed');
    });

    test('Month 1 looking back at Week 1: still open first, the rest ticked; now, it is From Week 1', () {
      final home = week1(stage: 'settling_in');
      final month1 = DateTime(2026, 12, 15);
      final back = StageLens.of(home, month1, selected: 1);
      expect(back.mode, LensMode.back);
      expect(back.eyebrow, 'LOOKING BACK');
      // Everything of week 1 is open in this fixture but the meeting with IT.
      expect(back.tasks.first.pillText, 'Still open');
      expect(back.meetings.firstWhere((r) => r.id == 'it').ticked, isTrue);
      expect(back.meetings.firstWhere((r) => r.id == 'payroll').pillText, 'Still open');
      expect(back.meetingsMeta, '1 still open');
      final now = StageLens.of(home, month1);
      expect(now.title, 'Month 1');
      expect(now.tasks.firstWhere((r) => r.id == 'nominees').pillText, 'From Week 1');
    });

    test('Confirmed: probation complete', () {
      final lens = StageLens.of(week1(stage: 'ready_to_perform'), DateTime(2027, 6, 2));
      expect(lens.eyebrow, 'PROBATION COMPLETE');
      expect(lens.title, 'Confirmed!');
    });
  });

  group('the home through the lens', () {
    testWidgets('Week 1: tap Month 1 to look ahead, Back to Week 1 returns', (tester) async {
      final api = FakeOnboardingApi()
        ..home = week1(upNext: task('payroll', 'Meet Payroll', kind: 'meeting', dueAt: DateTime(2026, 12, 4, 10)));
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, DateTime(2026, 12, 3, 10))));
      expect(find.text('YOU ARE HERE'), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const ValueKey('stage-title'))).data, 'Week 1');
      // Her own stage's list tags what Day 1 left behind (below the tiles).
      await tester.dragUntilVisible(find.text('From Day 1'), find.byType(Scrollable).first, const Offset(0, -200));
      expect(find.text('From Day 1'), findsWidgets);

      await tester.dragUntilVisible(find.byKey(const ValueKey('stage-step-Month 1')), find.byType(Scrollable).first, const Offset(0, 200));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('stage-step-Month 1')));
      await tester.pumpAndSettle();
      expect(find.text('A LOOK AHEAD'), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const ValueKey('stage-title'))).data, 'Month 1');
      expect(find.text('Back to Week 1'), findsOneWidget);
      expect(find.text('IN MONTH 1'), findsWidgets);
      expect(find.text('2 meetings in Month 1'), findsOneWidget);
      expect(find.text('Opens in Month 1'), findsWidgets);
      await scrollTo(tester, find.byKey(const ValueKey('lens-task-posh')));
      expect(find.byKey(const ValueKey('lens-task-posh')), findsOneWidget);
      await tester.drag(find.byKey(const ValueKey('lens-body')), const Offset(0, 2000));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('lens-back')));
      await tester.pumpAndSettle();
      expect(find.text('YOU ARE HERE'), findsOneWidget);
      expect(find.byKey(const ValueKey('lens-body')), findsNothing);
    });

    testWidgets('Month 1: tap Week 1 to look back, what is still open first', (tester) async {
      final api = FakeOnboardingApi()..home = week1(stage: 'settling_in');
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, DateTime(2026, 12, 15))));
      await tester.tap(find.byKey(const ValueKey('stage-step-Week 1')));
      await tester.pumpAndSettle();
      expect(find.text('LOOKING BACK'), findsOneWidget);
      expect(find.text('Back to Month 1'), findsOneWidget);
      expect(find.text('Still open'), findsWidgets);
    });

    testWidgets('a stage with nothing planned says so', (tester) async {
      final api = FakeOnboardingApi()..home = week1();
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, DateTime(2026, 12, 3, 10))));
      await tester.ensureVisible(find.byKey(const ValueKey('stage-step-Month 4')));
      await tester.tap(find.byKey(const ValueKey('stage-step-Month 4')));
      await tester.pumpAndSettle();
      expect(find.text('Nothing planned for Month 4 yet.'), findsOneWidget);
    });

    testWidgets('Confirmed: the hero turns green, PROBATION COMPLETE', (tester) async {
      final api = FakeOnboardingApi()..home = week1(stage: 'ready_to_perform');
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, DateTime(2027, 6, 2))));
      expect(find.text('PROBATION COMPLETE'), findsOneWidget);
      expect(find.text('Confirmed!'), findsOneWidget);
    });
  });
}
