import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/team_joiners_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/joiner_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/manager_review_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'lifecycle_manager_fixtures.dart';
import 'lifecycle_onboarding_test.dart' show FakeOnboardingApi, pumpPage, scrollTo, shellFor;

/// The manager's side, as the team-side canvas's Manager prototype draws it
/// (MgrTeamsProto, layout C): the person page, View all, a meeting, a review,
/// View progress and Reach out, from the team page the server sends.

Future<(FakeOnboardingApi, FakeTeamApi)> _open(WidgetTester tester, Map<String, dynamic> page, {Map<String, dynamic>? joiner, DateTime? now}) async {
  final api = FakeOnboardingApi()..joiner = JoinerDetail.fromJson(joiner ?? managerJoinerJson());
  final team = FakeTeamApi(page);
  await pumpPage(tester, JoinerScreen(shell: shellFor(api, now ?? DateTime(2026, 12, 1, 10)), journeyId: 'j1', teamApi: team));
  return (api, team);
}

Finder _in(String key, Finder f) => find.descendant(of: find.byKey(ValueKey(key)), matching: f);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('MgrProtoPriya: who she is, your tasks due now, the two tiles', (tester) async {
    final (api, team) = await _open(tester, priyaDay1Page());
    expect(find.text('Joiners'), findsWidgets);
    expect(find.text('Priya Menon'), findsOneWidget);
    expect(find.text('Reports to you'), findsOneWidget);
    expect(find.text('Buddy: Meera Joshi'), findsOneWidget);
    expect(_in('team-stage-pill', find.text('Day 1')), findsOneWidget);
    expect(find.text('Your tasks for Priya'), findsOneWidget);
    expect(_in('team-tasks-count', find.text('3 to do')), findsOneWidget);
    // Due now: the meeting (with what she sees for it), the intro, the starter task; nothing from Week 1.
    expect(find.byKey(const ValueKey('team-task-mm')), findsOneWidget);
    expect(_in('team-task-mm', find.text('Meet your manager')), findsOneWidget);
    expect(find.byKey(const ValueKey('team-task-mt')), findsOneWidget);
    expect(find.byKey(const ValueKey('team-task-st')), findsOneWidget);
    expect(find.byKey(const ValueKey('team-task-mgr_buddy_check')), findsNothing);
    expect(_in('tile-onboarding', find.text('On track')), findsOneWidget);
    expect(_in('tile-reach-out', find.text('Make Priya feel welcome')), findsOneWidget);

    // Tick the intro: the team page's own record (the engine's task).
    await tester.tap(_in('team-task-mt', find.byKey(const ValueKey('team-tick'))));
    await tester.pumpAndSettle();
    expect(team.calls, contains('done:mt'));

    // The starter task opens its sheet, not a bare tick.
    await tester.tap(find.byKey(const ValueKey('team-task-st')));
    await tester.pumpAndSettle();
    expect(find.text('Give Priya a starter task'), findsWidgets);
    expect(api.calls, isEmpty);
  });

  testWidgets('MgrAllTasks: every task now, then COMING UP, nothing the canvas does not draw', (tester) async {
    await _open(tester, priyaDay1Page());
    await tester.tap(find.byKey(const ValueKey('team-view-all')));
    await tester.pumpAndSettle();
    // The header names her; the list is the team page's.
    expect(find.text('Priya Menon'), findsOneWidget);
    expect(find.text('3 to do'), findsOneWidget);
    expect(find.text('COMING UP'), findsOneWidget);
    expect(_in('team-task-mgr_week_chat', find.text('Week 1')), findsOneWidget);
    expect(_in('team-task-pg', find.text('Opens in Week 1')), findsOneWidget);
    // Removed from this screen: the welcome row, starter replies, 1:1 notes, probation months, survey summaries.
    expect(find.text('Post a welcome'), findsNothing);
    expect(find.text('Notes from your 1:1s'), findsNothing);
    expect(find.text('Probation'), findsNothing);
  });

  testWidgets('MgrMeeting: the agenda, notes per point, Mark as done', (tester) async {
    final (api, team) = await _open(tester, priyaDay1Page());
    await tester.tap(find.byKey(const ValueKey('team-task-mm')));
    await tester.pumpAndSettle();
    expect(find.text('Agenda'), findsOneWidget);
    expect(find.text('4 things to talk about'), findsOneWidget);
    expect(find.text('With Priya Menon'), findsOneWidget);
    expect(find.text('Join the call'), findsNothing);
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('agenda-0')), matching: find.byType(TextField)), 'Shadow Neha on Tuesday');
    await scrollTo(tester, find.byKey(const ValueKey('meeting-mark-done')));
    await tester.tap(find.byKey(const ValueKey('meeting-mark-done')));
    await tester.pumpAndSettle();
    // The notes: a private 1:1 note; done: the same journey task the joiner and HR see.
    expect(api.calls, contains('note:false'));
    expect(team.calls, contains('done:mm'));
    expect(find.text('Only you can see your notes. Priya keeps their own.'), findsOneWidget);
  });

  testWidgets('the month’s check-in: Mark as done sends the notes as the manager’s side', (tester) async {
    final (api, team) = await _open(tester, rahulMonth3Page(), joiner: managerJoinerJson(name: 'Rahul Verma', tj: '2026-09-16', stage: 'growing_gains', withMonth3: true));
    await tester.tap(find.byKey(const ValueKey('team-task-c3')));
    await tester.pumpAndSettle();
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('agenda-1')), matching: find.byType(TextField)), 'Webinars went well');
    await scrollTo(tester, find.byKey(const ValueKey('meeting-mark-done')));
    await tester.tap(find.byKey(const ValueKey('meeting-mark-done')));
    await tester.pumpAndSettle();
    expect(team.calls.first, startsWith('meeting:c3:What’s going well: Webinars went well'));
    expect(api.calls, isNot(contains('note:false')));
  });

  testWidgets('MgrReview: what Rahul sent, his goals, your comments, Mark as reviewed', (tester) async {
    final (_, team) = await _open(tester, rahulMonth3Page(), joiner: managerJoinerJson(name: 'Rahul Verma', tj: '2026-09-16', stage: 'growing_gains', withMonth3: true), now: DateTime(2026, 12, 10, 10));
    expect(_in('team-task-r3', find.text('Ready to review')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('team-task-r3')));
    await tester.pumpAndSettle();
    expect(find.text('Rahul’s Month-3 self check-in'), findsOneWidget);
    expect(find.text('Sent yesterday'), findsOneWidget);
    expect(find.text('What went well this month'), findsOneWidget);
    expect(find.text('Support I need'), findsOneWidget);
    expect(find.text('Progress on goals'), findsOneWidget);
    expect(find.text('3 of 5'), findsOneWidget);
    await scrollTo(tester, find.text('Rahul sees your comments.'));
    await tester.enterText(find.byType(TextField), 'Great webinars');
    await scrollTo(tester, find.byKey(const ValueKey('review-ok')));
    await tester.tap(find.byKey(const ValueKey('review-ok')));
    await tester.pumpAndSettle();
    expect(team.calls, contains('review:3:Great webinars'));
  });

  testWidgets('MgrReview: Send back', (tester) async {
    final api = FakeOnboardingApi()..joiner = JoinerDetail.fromJson(managerJoinerJson(name: 'Rahul Verma', withMonth3: true));
    final team = FakeTeamApi(rahulMonth3Page());
    await pumpPage(tester, ManagerReviewScreen(shell: shellFor(api, DateTime(2026, 12, 10)), teamApi: team, journeyId: 'j3', month: 3));
    await scrollTo(tester, find.byKey(const ValueKey('review-send-back')));
    await tester.tap(find.byKey(const ValueKey('review-send-back')));
    await tester.pumpAndSettle();
    expect(team.calls, ['back:3:']);
  });

  test('a month’s review state, as the server words it', () {
    expect(monthReviewState(null), TeamReviewState.waiting);
    final sent = DateTime(2026, 12, 9);
    expect(monthReviewState(ProbationMonth(monthNo: 1, checkinEmployee: CheckinEntry(text: 'x', at: sent))), TeamReviewState.ready);
    expect(monthReviewState(ProbationMonth(monthNo: 1, checkinEmployee: CheckinEntry(text: 'x', at: sent), sentBackAt: sent.add(const Duration(hours: 1)))), TeamReviewState.back);
    expect(monthReviewState(ProbationMonth(monthNo: 1, checkinEmployee: CheckinEntry(text: 'x', at: sent.add(const Duration(days: 1))), sentBackAt: sent)), TeamReviewState.ready);
    expect(monthReviewState(ProbationMonth(monthNo: 1, reviewAt: sent)), TeamReviewState.reviewed);
  });

  testWidgets('MgrProgress: her own Meetings, Tasks and tour, each opening its list', (tester) async {
    await _open(tester, priyaDay1Page(delayed: true));
    expect(_in('tile-onboarding', find.text('1 task delayed')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('tile-onboarding')));
    await tester.pumpAndSettle();
    expect(find.text('Priya’s onboarding'), findsOneWidget);
    expect(find.text('DELAYED'), findsOneWidget);
    expect(find.text('Declare your tax and investments, late'), findsOneWidget);
    expect(_in('stat-meetings', find.text('1/3 met', findRichText: true)), findsOneWidget);
    expect(_in('stat-tasks', find.text('0/2 done', findRichText: true)), findsOneWidget);
    expect(_in('stat-tour', find.text('1/4 lessons', findRichText: true)), findsOneWidget);
    expect(find.text('You can see where Priya is. Survey answers and meeting notes stay private.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('stat-meetings')));
    await tester.pumpAndSettle();
    expect(find.text('1 of 3 met'), findsOneWidget);
    expect(find.text('Met'), findsOneWidget);
    expect(find.text('COMING UP'), findsOneWidget);
    expect(find.text('Meeting notes stay private to Priya.'), findsOneWidget);
  });

  testWidgets('MgrReachOut: the five ways as blocks', (tester) async {
    await _open(tester, priyaDay1Page());
    await tester.tap(find.byKey(const ValueKey('tile-reach-out')));
    await tester.pumpAndSettle();
    for (final t in ['Welcome on the feed', 'Send a game', 'Make an announcement', 'Introduce to the team', 'Message']) {
      expect(find.text(t), findsOneWidget);
    }
  });

  test('the team page reads the journey rows’ step, month and lock', () {
    final page = TeamJoinerPage.fromJson({
      ...rahulMonth3Page(),
      'tasks': [mgrTask('x', 'Add notes from your 1:1', 5, canTick: false, opens: 'screen', systemKey: 'one_on_one_notes', journey: true)..['locked'] = true],
    });
    final t = page.tasks.single;
    expect((t.systemKey, t.locked, t.opens, t.isOpenForMe), ('one_on_one_notes', true, 'screen', false));
    expect(page.progress?.devices.length, 3);
  });
}
