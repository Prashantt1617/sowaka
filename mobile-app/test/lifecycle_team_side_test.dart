import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/team_joiners_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/team_side_screens.dart';

/// Teams › Joiners for the buddy and the head of department, and View all
/// (the Team side artifact: BuddyPriya, HodProtoSana, MgrAllTasks, HodApprove).

const _steps = ['Before Day 1', 'Day 1', 'Week 1', 'Month 1', 'Month 2', 'Month 3', 'Confirmed'];

Map<String, dynamic> _task(String id, String title, int step, {String kind = 'help', bool done = false, bool early = false, bool canTick = true, String? opens, String? reviewState, String? pair}) => {
  'id': id, 'title': title, 'kind': kind, 'step': step, 'done': done, 'early': early, 'canTick': canTick, 'source': 'team',
  'opens': ?opens, 'reviewState': ?reviewState, 'pair': ?pair,
  if (kind == 'meet') 'agenda': ['How the first week went'],
};

Map<String, dynamic> _buddyPage({Set<String> done = const {}}) => {
  'joiner': {'journeyId': 'j1', 'name': 'Priya Menon', 'first': 'Priya', 'designation': 'Admissions coordinator', 'managerName': 'Sunny Kapoor', 'status': 'On track', 'delayed': 0},
  'relation': 'buddy',
  'steps': _steps,
  'step': 1,
  'canBrowseSteps': true,
  'tasks': [
    _task('buddy_meet', 'Meet Priya on Day 1', 1, kind: 'meet', opens: 'meeting', pair: 'Your buddy', done: done.contains('buddy_meet')),
    _task('buddy_show_around', 'Show Priya around the office', 1, kind: 'team', done: done.contains('buddy_show_around')),
    _task('buddy_week1', 'Week-1 check-in', 2, kind: 'meet', opens: 'meeting'),
    _task('buddy_tools', 'Help Priya set up their work tools', 2, early: true),
    _task('buddy_month1', 'Month-1 catch-up', 3, kind: 'meet', opens: 'meeting'),
  ],
};

Map<String, dynamic> _hodPage() => {
  'joiner': {'journeyId': 'j2', 'name': 'Dev Arora', 'first': 'Dev', 'managerName': 'Haider Ali', 'status': 'On track', 'delayed': 0},
  'relation': 'line',
  'approverName': 'Rahul Head',
  'approverIsYou': true,
  'steps': _steps,
  'step': 5,
  'canBrowseSteps': false,
  'tasks': [
    _task('hod_meet', 'Meet Dev', 2, kind: 'meet', opens: 'meeting', done: true),
    _task('hod_approve', 'Approve Dev’s confirmation', 5, kind: 'approve', canTick: false, opens: 'approval', reviewState: 'ready'),
  ],
};

class _FakeApi implements TeamJoinersApi {
  _FakeApi(this.page);

  Map<String, dynamic> page;
  final done = <String>{};
  final calls = <String>[];

  @override
  Future<TeamJoinerPage> fetchJoiner(String journeyId) async => TeamJoinerPage.fromJson(page);

  @override
  Future<List<TeamJoinerRow>> fetchJoiners() async => const [];

  @override
  Future<TeamJoinerPage> taskAction(String journeyId, String taskId, String action) async {
    calls.add('$action:$taskId');
    action == 'done' ? done.add(taskId) : done.remove(taskId);
    page = _buddyPage(done: done);
    return TeamJoinerPage.fromJson(page);
  }

  @override
  Future<TeamApproval> fetchApproval(String journeyId) async => TeamApproval.fromJson({
    'state': 'ready',
    'managerName': 'Haider Ali',
    'recommendation': {'byName': 'Haider Ali', 'outcome': 'confirm', 'note': 'Dev has met his goals.', 'at': DateTime.now().subtract(const Duration(days: 2)).toIso8601String()},
    'facts': [
      {'label': 'Self-review', 'value': 'Sent', 'ok': true},
      {'label': 'Confirmation discussion', 'value': 'Done', 'ok': true},
    ],
  });

  @override
  Future<TeamApproval> answerApproval(String journeyId, String action, {String? comment}) async {
    calls.add('approval:$action');
    return fetchApproval(journeyId);
  }

  @override
  Future<TeamJoinerPage> recommend(String journeyId, String outcome, {String? note}) async {
    calls.add('recommend:$outcome:${note ?? ''}');
    return TeamJoinerPage.fromJson(page);
  }
}

Future<void> _pump(WidgetTester tester, _FakeApi api) async {
  tester.view.physicalSize = const Size(393 * 3, 852 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(home: TeamJoinerScreen(api: api, journeyId: 'j1')));
  await tester.pumpAndSettle();
}

void main() {
  test('pages carry the joiner’s account and the approver', () {
    final page = TeamJoinerPage.fromJson({..._hodPage(), 'joiner': {..._hodPage()['joiner'] as Map<String, dynamic>, 'userId': 'u-dev'}, 'readOnly': true, 'approverIsYou': false});
    expect(page.userId, 'u-dev');
    expect(page.readOnly, isTrue);
    expect(page.approverName, 'Rahul Head');
    final row = TeamJoinerRow.fromJson({'journeyId': 'j', 'userId': 'u1', 'name': 'Priya', 'relation': 'line', 'approverName': 'Rahul Head', 'approverIsYou': true});
    expect([row.userId, row.approverName, row.approverIsYou], ['u1', 'Rahul Head', true]);
  });

  test('rows: now, then the next step as COMING UP (locked unless it can be done early)', () {
    final page = TeamJoinerPage.fromJson(_buddyPage());
    final rows = teamRowsFor(page);
    expect(rows.map((r) => r.task.id), ['buddy_meet', 'buddy_show_around', 'buddy_week1', 'buddy_tools']);
    expect(rows[2].head, 'COMING UP');
    expect(rows[2].locked, isTrue);
    expect(rows[2].sub, 'Opens in Week 1');
    expect(rows[3].locked, isFalse);
    expect(rows[3].pill, 'Week 1');
    final ahead = teamRowsFor(page, at: 3);
    expect(ahead.first.head, 'IN MONTH 1');
    expect(ahead.last.head, isNull);
    expect(ahead.where((r) => r.head == 'NOW · DAY 1'), hasLength(1));
  });

  testWidgets('the buddy’s page: Help Priya with, ticks, View all', (tester) async {
    final api = _FakeApi(_buddyPage());
    await _pump(tester, api);
    expect(find.text('Help Priya with'), findsOneWidget);
    expect(find.text('You’re the buddy'), findsOneWidget);
    expect(find.text('Show Priya around the office'), findsOneWidget);
    expect(find.text('Priya’s onboarding'), findsOneWidget);
    expect(find.text('Reach out to Priya'), findsOneWidget);

    await tester.tap(find.descendant(of: find.byKey(const ValueKey('team-task-buddy_show_around')), matching: find.byKey(const ValueKey('team-tick'))));
    await tester.pumpAndSettle();
    expect(api.calls, ['done:buddy_show_around']);

    await tester.tap(find.text('View all'));
    await tester.pumpAndSettle();
    expect(find.text('All tasks'), findsOneWidget);
    expect(find.text('COMING UP'), findsOneWidget);
    expect(find.text('Opens in Week 1'), findsOneWidget);
    expect(find.text('1 to do'), findsOneWidget);

    await tester.tap(find.text('Month 1').first);
    await tester.pumpAndSettle();
    expect(find.text('IN MONTH 1'), findsOneWidget);
    expect(find.text('A look ahead'), findsOneWidget);
  });

  testWidgets('the head of department approves a confirmation', (tester) async {
    final api = _FakeApi(_hodPage());
    await _pump(tester, api);
    expect(find.text('Your tasks for Dev'), findsOneWidget);
    expect(find.text('Reports to Haider Ali'), findsOneWidget);
    expect(find.text('Ready to approve'), findsOneWidget);
    expect(find.text('You approve Dev’s confirmation after the manager recommends.'), findsOneWidget);

    await tester.tap(find.text('Approve Dev’s confirmation'));
    await tester.pumpAndSettle();
    expect(find.text('Dev’s confirmation'), findsOneWidget);
    expect(find.text('Haider Ali recommends: Confirm'), findsOneWidget);
    expect(find.text('Recommended 2 days ago by Haider'), findsOneWidget);
    expect(find.text('Self-review'), findsOneWidget);

    await tester.tap(find.text('Approve'));
    await tester.pumpAndSettle();
    expect(api.calls, contains('approval:approve'));
  });

  testWidgets('the manager recommends: pick one, add why, send', (tester) async {
    final mgr = {
      ..._hodPage(),
      'relation': 'report',
      'approverName': 'Rahul Head',
      'approverIsYou': false,
      'tasks': [_task('mgr_recommend', 'Recommend Dev’s confirmation', 5, kind: 'review', canTick: false, opens: 'recommend')],
    };
    final api = _FakeApi(mgr);
    final page = TeamJoinerPage.fromJson(mgr);
    final task = page.tasks.single;
    expect(task.opens, 'recommend');
    tester.view.physicalSize = const Size(393 * 3, 852 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: RecommendScreen(api: api, page: page, task: task)));
    await tester.pumpAndSettle();
    expect(find.text('Recommend Dev’s confirmation'), findsOneWidget);
    expect(find.textContaining('Rahul Head approves it'), findsOneWidget);
    // Nothing picked: Send does nothing.
    await tester.tap(find.text('Send recommendation'));
    await tester.pump();
    expect(api.calls, isEmpty);
    await tester.tap(find.byKey(const ValueKey('recommend-extend')));
    await tester.pump();
    await tester.enterText(find.byType(TextField).first, 'Needs another month on the CRM');
    await tester.tap(find.text('Send recommendation'));
    await tester.pumpAndSettle();
    expect(api.calls, ['recommend:extend:Needs another month on the CRM']);
  });

  test('a recommendation already made comes back on the row', () {
    final t = TeamTask.fromJson({..._task('mgr_recommend', 'Recommend', 5, kind: 'review', canTick: false, opens: 'recommend'), 'done': true, 'recommended': {'outcome': 'confirm', 'note': 'Great'}});
    expect([t.recommended, t.recommendedNote], ['confirm', 'Great']);
  });
}
