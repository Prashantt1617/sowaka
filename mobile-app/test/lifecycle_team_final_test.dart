import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/team_joiners_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/joiners_tab.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/team_joiner_screens.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/team_task_screens.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_kit.dart';

/// Teams › Joiners (Onboarding · Final designs, canvas page "3 · App ·
/// teammates"): the list, the person page for the manager, the buddy and
/// the head of department, View all, View progress and its lists, Reach
/// out, and the task screens — against `/lifecycle/team/*` answers in the
/// shapes backend/src/services/lifecycle/teamApp.ts writes.

class _NoOnboardingApi implements OnboardingApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

OnboardingShell _shell(DateTime now, {String name = 'Sunny Kapoor'}) =>
    OnboardingShell(api: _NoOnboardingApi(), profileAction: const SizedBox(width: 30, height: 30), onNotifications: () {}, viewerName: name, now: () => now);

Map<String, dynamic> _row(
  String id,
  String title,
  int step, {
  String kind = 'task',
  bool done = false,
  bool locked = false,
  bool early = false,
  String? opens,
  bool canTick = false,
  String? pair,
  String? how,
  String? note,
  Map<String, String>? pill,
  List<String>? agenda,
  List<String>? notes,
  int? month,
  String? checkinId,
}) => {
  'id': id, 'title': title, 'kind': kind, 'step': step, 'stepLabel': _labels[step], 'early': early, 'done': done, 'locked': locked,
  'opens': opens, 'canTick': canTick, 'pair': ?pair, 'how': ?how, 'note': ?note, 'pill': ?pill, 'agenda': ?agenda, 'notes': ?notes,
  'month': ?month, 'checkinId': ?checkinId,
};

const _labels = ['Before Day 1', 'Day 1', 'Week 1', 'Month 1', 'Month 2', 'Month 3', 'Month 4', 'Month 5', 'Month 6', 'Confirmed'];

/// Priya on Day 1, as her manager sees her (MgrProtoPriya).
Map<String, dynamic> _priya({Set<String> done = const {}, int step = 1, bool delayed = false}) => {
  'joiner': {
    'journeyId': 'j1', 'userId': 'u1', 'name': 'Priya Shah', 'first': 'Priya', 'initials': 'PS', 'designation': 'Operations executive',
    'department': 'Operations', 'reportsTo': 'you', 'buddy': 'Meera Joshi', 'stepLabel': step == 0 ? 'Joins 1 Dec' : _labels[step], 'step': step,
    'plantStage': 1, 'preboarding': step == 0, 'tj': '2026-12-01',
    'status': {'label': delayed ? '1 task delayed' : (step == 0 ? 'Joining soon' : 'On track'), 'warn': delayed},
    if (delayed) 'delayed': {'title': 'Office Wi-Fi', 'waitingDays': 3, 'ownerLabel': 'IT'},
  },
  'relation': 'report',
  'readOnly': false,
  'card': {'title': 'Your tasks for Priya', 'toDo': 2 - done.where((d) => d == 'mgr_first_goals' || d == 'mgr_feed_intro').length},
  'tasks': [
    _row('mgr_assign_buddy', 'Assign Priya a buddy', 0, kind: 'team', done: true, opens: 'buddy', pair: 'Your buddy'),
    _row('mgr_schedule', 'Schedule Priya’s first-week meetings', 0, done: true, opens: 'schedule', pair: 'Your first-week meetings', how: 'The meetings are already created. Pick a time for each one.'),
    _row('mgr_first_goals', 'First goals', 1, kind: 'meet', opens: 'meeting', canTick: true, done: done.contains('mgr_first_goals'),
        agenda: ['The role, and what good looks like by the end of probation', 'Your plan for the first week'], notes: ['Talk about the Kanpur client']),
    _row('mgr_feed_intro', 'Introduce Priya on the feed', 1, kind: 'team', early: true, opens: 'feed', done: done.contains('mgr_feed_intro')),
    _row('mgr_read_checkin@ci-w1', 'Read Priya’s Week 1 check-in', 2, kind: 'review', locked: true, opens: null, pair: 'Week 1 check-in', checkinId: 'ci-w1'),
    _row('mgr_monthly_goals@1', 'Monthly goals', 3, kind: 'meet', locked: true, opens: 'meeting', canTick: true),
  ],
  'progress': {
    'rows': [
      {'key': 'meet', 'title': 'Meetings', 'done': 1, 'total': 3, 'unit': 'met', 'flag': {'text': '2 to go', 'tone': 'todo'}},
      {'key': 'tasks', 'title': 'Tasks', 'done': 2, 'total': 4, 'unit': 'done', 'flag': {'text': '2 not done', 'tone': 'todo'}},
      if (delayed) {'key': 'dev', 'title': 'Devices and accesses', 'done': 3, 'total': 4, 'unit': 'ready', 'flag': {'text': '1 delayed', 'tone': 'warn'}},
    ],
    if (step == 0) 'joining': {'on': '2026-12-01', 'time': '9:30 AM', 'place': 'Pune office'},
  },
  'lists': {
    'meet': [
      {'title': 'Welcome and documents', 'meta': 'Ritu Sharma', 'status': 'Met', 'tone': 'ok', 'comingUp': false},
      {'title': 'First goals', 'meta': 'Sunny Kapoor', 'status': 'Not yet', 'tone': 'todo', 'comingUp': false},
      {'title': 'How the team works', 'meta': 'Meera Joshi', 'status': 'Not yet', 'tone': 'todo', 'comingUp': false},
      {'title': 'Salary and tax', 'meta': 'Ritu Sharma', 'status': 'Week 1', 'tone': 'soon', 'comingUp': true},
    ],
    'tasks': [],
    'ci': [],
    'watch': [],
    'tour': [],
    'dev': [],
    'prof': [],
  },
  'reachOut': step == 0 ? ['welcome_message', 'announcement'] : ['feed', 'game', 'announcement', 'team_post', 'chat'],
  'schedule': [
    {'rowKey': 'hr_welcome', 'title': 'Welcome and documents', 'step': 1, 'withName': 'Ritu Sharma', 'withInitials': 'RS', 'startsAt': '2026-12-01T04:00:00.000Z'},
    {'rowKey': 'mgr_first_goals', 'title': 'First goals', 'step': 1, 'withName': 'Sunny Kapoor', 'withInitials': 'SK'},
    {'rowKey': 'buddy_team_works', 'title': 'How the team works', 'step': 1, 'withName': 'Meera Joshi', 'withInitials': 'MJ'},
    {'rowKey': 'hr_salary_tax', 'title': 'Salary and tax', 'step': 2, 'withName': 'Ritu Sharma', 'withInitials': 'RS'},
  ],
};

/// Priya as Meera, her buddy, sees her (BuddyPriya).
Map<String, dynamic> _buddyPriya() => {
  'joiner': {
    'journeyId': 'j1', 'userId': 'u1', 'name': 'Priya Shah', 'first': 'Priya', 'initials': 'PS', 'designation': 'Operations executive',
    'reportsTo': 'Sunny Kapoor', 'buddy': 'you', 'stepLabel': 'Day 1', 'step': 1, 'plantStage': 1, 'preboarding': false,
    'status': {'label': 'On track', 'warn': false},
  },
  'relation': 'buddy',
  'card': {'title': 'Help Priya with', 'toDo': 4},
  'tasks': [
    _row('buddy_team_works', 'How the team works', 1, kind: 'meet', opens: 'meeting', canTick: true),
    _row('buddy_show_around', 'Show Priya around the office', 1, kind: 'team', opens: 'around'),
    _row('buddy_punch_in', 'Tell Priya how punch-in works', 1, kind: 'help', canTick: true, pair: 'Sowaka tour: Punch in and out'),
    _row('buddy_groups', 'Add Priya to the team’s groups and channels', 1, kind: 'help', opens: 'groups',
        how: 'The team group, the office group and any channels the team uses day to day.'),
    _row('buddy_week1', 'Week 1 catch-up', 2, kind: 'meet', locked: true, opens: 'meeting', canTick: true),
  ],
  'progress': {'rows': []},
  'lists': {},
  'reachOut': ['feed', 'game', 'announcement', 'team_post', 'chat'],
};

/// Dev in Month 6, as Anita, head of department, sees him (HodApprove).
Map<String, dynamic> _hodDev({String pill = 'Ready to approve'}) => {
  'joiner': {
    'journeyId': 'j6', 'userId': 'u6', 'name': 'Dev Arora', 'first': 'Dev', 'initials': 'DA', 'designation': 'Operations executive',
    'reportsTo': 'Haider Ali', 'stepLabel': 'Month 6', 'step': 8, 'plantStage': 3, 'status': {'label': 'Confirmation due', 'warn': false},
  },
  'relation': 'line',
  'card': {'title': 'Your tasks for Dev', 'toDo': 1},
  'tasks': [
    _row('hod_approve', 'Approve Dev’s confirmation', 8, kind: 'approve', opens: pill.startsWith('Waiting') ? null : 'approval', note: 'After the manager recommends',
        pill: {'text': pill, 'tone': pill.startsWith('Waiting') ? 'grey' : 'blue'}),
  ],
  'progress': {'rows': []},
  'lists': {},
  'reachOut': ['feed', 'game', 'announcement', 'team_post', 'chat'],
};

class _FakeTeamApi implements TeamJoinersApi {
  _FakeTeamApi(this.page);

  Map<String, dynamic> page;
  final calls = <String>[];
  List<TeamJoinerRow> joiners = const [];
  Map<String, dynamic> confirmationJson = const {};
  Map<String, dynamic> checkinJson = const {};
  Map<String, dynamic> reviewJson = const {};
  List<Map<String, dynamic>> goalsJson = const [];

  TeamJoinerPage get _page => TeamJoinerPage.fromJson(page);

  void _tick(String rowId, bool done) {
    page = {
      ...page,
      'tasks': [
        for (final t in page['tasks'] as List) (t as Map)['id'] == rowId ? {...t, 'done': done} : t,
      ],
    };
  }

  @override
  Future<List<TeamJoinerRow>> fetchJoiners() async => joiners;
  @override
  Future<TeamJoinerPage> fetchPage(String journeyId) async => _page;
  @override
  Future<TeamJoinerPage> rowAction(String journeyId, String rowId, String action) async {
    calls.add('row:$rowId:$action');
    _tick(rowId, action == 'done');
    return _page;
  }

  @override
  Future<List<String>> saveNotes(String journeyId, String rowId, List<String> notes) async {
    calls.add('notes:$rowId:${notes.join('|')}');
    return notes;
  }

  @override
  Future<({List<TeamBuddyOption> options, String? current})> buddyOptions(String journeyId) async => (
    options: const [
      TeamBuddyOption(userId: 'm1', name: 'Meera Joshi', designation: 'Operations lead'),
      TeamBuddyOption(userId: 'r1', name: 'Rohan Das', designation: 'Senior operations executive'),
    ],
    current: null,
  );
  @override
  Future<TeamJoinerPage> assignBuddy(String journeyId, String buddyUserId) async {
    calls.add('buddy:$buddyUserId');
    _tick('mgr_assign_buddy', true);
    return _page;
  }

  @override
  Future<TeamJoinerPage> schedule(String journeyId, Map<String, DateTime> times) async {
    calls.add('schedule:${times.keys.join(',')}');
    return _page;
  }

  @override
  Future<TeamJoinerPage> welcomeMessage(String journeyId, String text) async {
    calls.add('welcome:$text');
    return _page;
  }

  @override
  Future<TeamJoinerPage> feedPost(String journeyId, String text) async {
    calls.add('feed:$text');
    _tick('mgr_feed_intro', true);
    return _page;
  }

  @override
  Future<List<TeamGoal>> goals(String journeyId, int month) async => goalsJson.map(TeamGoal.fromJson).toList();
  @override
  Future<List<TeamGoal>> commentOnGoals(String journeyId, int month, Map<int, String> comments) async {
    calls.add('goals:$month:${comments.values.join('|')}');
    return goalsJson.map(TeamGoal.fromJson).toList();
  }

  @override
  Future<TeamCheckin> checkin(String journeyId, String checkinId) async => TeamCheckin.fromJson(checkinJson);
  @override
  Future<TeamCheckin> markCheckinRead(String journeyId, String checkinId) async {
    calls.add('read:$checkinId');
    return TeamCheckin.fromJson({...checkinJson, 'state': 'read'});
  }

  @override
  Future<TeamReviewView> review(String journeyId) async => TeamReviewView.fromJson(reviewJson);
  @override
  Future<TeamJoinerPage> sendReview(String journeyId, {required String outcome, int? extendMonths, required String kpis, required String strengths, required String next}) async {
    calls.add('review:$outcome:${extendMonths ?? '-'}:$kpis|$strengths|$next');
    return _page;
  }

  @override
  Future<TeamConfirmation> confirmation(String journeyId) async => TeamConfirmation.fromJson(confirmationJson);
  @override
  Future<TeamConfirmation> answerConfirmation(String journeyId, String action, {int? extendMonths, String? comment}) async {
    calls.add('confirm:$action:${extendMonths ?? '-'}:${comment ?? ''}');
    return TeamConfirmation.fromJson({...confirmationJson, 'state': action == 'approve' ? 'approved' : 'extended'});
  }

  @override
  Future<TeamJoinerPage> seniorMeeting(String journeyId, {required String mode, required DateTime startsAt, List<String> journeyIds = const []}) async {
    calls.add('senior:$mode:${journeyIds.join(',')}');
    return _page;
  }
}

Future<void> _pump(WidgetTester tester, Widget page) async {
  tester.view.physicalSize = const Size(393 * 3, 852 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final navigator = GlobalKey<NavigatorState>();
  await tester.pumpWidget(
    MaterialApp(
      navigatorKey: navigator,
      builder: (context, child) => MediaQuery(data: MediaQuery.of(context).copyWith(disableAnimations: true), child: child!),
      home: const Scaffold(body: Text('root')),
    ),
  );
  navigator.currentState!.push(MaterialPageRoute<void>(builder: (_) => page));
  await tester.pumpAndSettle();
}

Future<void> _back(WidgetTester tester) async {
  tester.state<NavigatorState>(find.byType(Navigator).first).pop();
  await tester.pumpAndSettle();
}

Future<void> _scrollTo(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 200, scrollable: find.byType(Scrollable).first);
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
}

Widget _person(_FakeTeamApi api, {DateTime? now, String name = 'Sunny Kapoor'}) =>
    TeamPersonScreen(shell: _shell(now ?? DateTime(2026, 12, 1, 10), name: name), api: api, journeyId: '${(api.page['joiner'] as Map)['journeyId']}');

void main() {
  group('Teams › Joiners', () {
    testWidgets('one card, a row each: face, name, designation, relation line, stage pill; the count', (tester) async {
      final api = _FakeTeamApi(_priya())
        ..joiners = [
          TeamJoinerRow.fromJson({'journeyId': 'j1', 'name': 'Sana Khan', 'initials': 'SK', 'designation': 'Operations analyst', 'relation': 'report', 'step': 2, 'stepLabel': 'Week 1', 'plantStage': 1}),
          TeamJoinerRow.fromJson({'journeyId': 'j2', 'name': 'Priya Shah', 'initials': 'PS', 'designation': 'Operations executive', 'relation': 'buddy', 'relationLine': 'You’re the buddy', 'step': 1, 'stepLabel': 'Day 1', 'plantStage': 1}),
          TeamJoinerRow.fromJson({'journeyId': 'j3', 'name': 'Kavya Iyer', 'initials': 'KI', 'relation': 'line', 'relationLine': 'Reports to Sunny Kapoor', 'step': 0, 'stepLabel': 'Joins 1 Dec', 'preboarding': true, 'plantStage': 0}),
        ];
      await _pump(tester, Scaffold(body: JoinersTab(shell: _shell(DateTime(2026, 12, 1)), teamApi: api)));
      expect(find.byKey(const ValueKey('joiner-row-j1')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('joiner-row-j1')), matching: find.text('Week 1')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('joiner-row-j2')), matching: find.text('You’re the buddy')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('joiner-row-j3')), matching: find.text('Reports to Sunny Kapoor')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('joiner-row-j3')), matching: find.text('Joins 1 Dec')), findsOneWidget);
      expect(JoinersTab.count.value, 3);
      expect(find.text('No joiners right now'), findsNothing);
    });

    test('the Joiners pill: only with joiners in Teams (HR / IT & admin with none never see it)', () {
      expect(JoinersTab.showsPill(lifecycleOn: true, joiners: 2, open: false), isTrue);
      expect(JoinersTab.showsPill(lifecycleOn: true, joiners: 0, open: false), isFalse);
      expect(JoinersTab.showsPill(lifecycleOn: false, joiners: 2, open: false), isFalse);
      expect(JoinersTab.showsPill(lifecycleOn: true, joiners: 0, open: true), isTrue);
    });
  });

  group('the person page (MgrProtoPriya)', () {
    testWidgets('who they are, the card with what is due now, the two tiles', (tester) async {
      final api = _FakeTeamApi(_priya());
      await _pump(tester, _person(api));
      expect(find.text('Joiners'), findsOneWidget);
      expect(find.text('Reports to you'), findsOneWidget);
      expect(find.text('Buddy: Meera Joshi'), findsOneWidget);
      expect(find.text('Your tasks for Priya'), findsOneWidget);
      expect(find.text('2 to do'), findsOneWidget);
      expect(find.byKey(const ValueKey('team-row-mgr_first_goals')), findsOneWidget);
      expect(find.byKey(const ValueKey('team-row-mgr_feed_intro')), findsOneWidget);
      expect(find.byKey(const ValueKey('team-row-mgr_assign_buddy')), findsNothing, reason: 'Before Day 1 rows done: not on the card');
      expect(find.text('Priya’s onboarding'), findsOneWidget);
      expect(find.text('On track'), findsOneWidget);
      expect(find.text('View progress'), findsOneWidget);
      expect(find.text('Reach out to Priya'), findsOneWidget);
      expect(find.text('Make Priya feel welcome'), findsOneWidget);
      expect(find.text('Choose how'), findsOneWidget);
    });

    testWidgets('ticking a meeting: the shared tick, "Marked as done" with Add notes, which opens it', (tester) async {
      final api = _FakeTeamApi(_priya());
      await _pump(tester, _person(api));
      await tester.tap(find.descendant(of: find.byKey(const ValueKey('team-row-mgr_first_goals')), matching: find.byKey(const ValueKey('team-tick'))));
      await tester.pumpAndSettle();
      expect(api.calls, ['row:mgr_first_goals:done']);
      expect(find.text('Marked as done'), findsOneWidget);
      await tester.tap(find.text('Add notes'));
      await tester.pumpAndSettle();
      expect(find.text('Agenda'), findsOneWidget);
      expect(find.text('2 things to talk about'), findsOneWidget);
      expect(find.text('With Priya Shah'), findsOneWidget);
      expect(find.text('Talk about the Kanpur client'), findsOneWidget, reason: 'my own notes, kept on the server');
      expect(find.text('Only you can see your notes. Priya keeps their own.'), findsOneWidget);
    });

    testWidgets('View all: now, done, COMING UP with the lock and "Opens in Week 1"', (tester) async {
      final api = _FakeTeamApi(_priya());
      await _pump(tester, _person(api));
      await tester.tap(find.byKey(const ValueKey('team-view-all')));
      await tester.pumpAndSettle();
      expect(find.text('Priya Shah'), findsWidgets);
      expect(find.text('2 to do'), findsOneWidget);
      expect(find.text('COMING UP'), findsOneWidget);
      expect(find.text('Opens in Week 1'), findsOneWidget);
      expect(find.byIcon(Icons.lock_outline_rounded), findsOneWidget);
      expect(find.byKey(const ValueKey('team-row-mgr_monthly_goals@1')), findsNothing, reason: 'only the next step comes up');
    });

    testWidgets('a task opened from View all is titled "All tasks"', (tester) async {
      final api = _FakeTeamApi(_priya());
      await _pump(tester, _person(api));
      await tester.tap(find.byKey(const ValueKey('team-view-all')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Introduce Priya on the feed'));
      await tester.pumpAndSettle();
      expect(find.text('All tasks'), findsOneWidget);
    });

    testWidgets('View progress: the numbers, DELAYED, a list with COMING UP; back to the page', (tester) async {
      final api = _FakeTeamApi(_priya(delayed: true));
      await _pump(tester, _person(api));
      expect(find.text('1 task delayed'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('team-tile-progress')));
      await tester.pumpAndSettle();
      expect(find.text('DELAYED'), findsOneWidget);
      expect(find.text('Office Wi-Fi, waiting 3 days on IT'), findsOneWidget);
      expect(find.text('1/3 met', findRichText: true), findsOneWidget);
      expect(find.text('2 to go'), findsOneWidget);
      expect(find.text('1 delayed'), findsOneWidget);
      expect(find.text('You can see where Priya is. Meeting notes stay private.'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('team-stat-meet')));
      await tester.pumpAndSettle();
      expect(find.text('Meetings'), findsOneWidget);
      expect(find.text('1 of 3 met'), findsOneWidget);
      expect(find.text('COMING UP'), findsOneWidget);
      expect(find.text('Meeting notes stay private to Priya.'), findsOneWidget);
      await _back(tester);
      await tester.pumpAndSettle();
      expect(find.text('Your tasks for Priya'), findsOneWidget, reason: 'a list goes back to the person page');
    });

    testWidgets('before Day 1: JOINING DETAILS, Devices + Profile; reach out has two ways', (tester) async {
      final api = _FakeTeamApi(_priya(step: 0));
      await _pump(tester, _person(api));
      expect(find.text('Joins 1 Dec'), findsOneWidget);
      expect(find.text('Joining soon'), findsOneWidget);
      expect(find.text('Welcome Priya before Day 1'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('team-tile-progress')));
      await tester.pumpAndSettle();
      expect(find.text('JOINING DETAILS'), findsOneWidget);
      expect(find.text('Joins 1 Dec · 9:30 AM · Pune office'), findsOneWidget);
      await _back(tester);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('team-tile-reach')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('reach-welcome_message')), findsOneWidget);
      expect(find.text('A note before Day 1'), findsOneWidget);
      expect(find.text('Tell everyone who’s joining'), findsOneWidget);
      expect(find.byKey(const ValueKey('reach-game')), findsNothing);
    });

    testWidgets('after Day 1: the five ways, in order', (tester) async {
      final api = _FakeTeamApi(_priya());
      await _pump(tester, _person(api));
      await tester.tap(find.byKey(const ValueKey('team-tile-reach')));
      await tester.pumpAndSettle();
      final titles = ['Welcome on the feed', 'Send a game', 'Make an announcement', 'Introduce to the team', 'Message'];
      for (final t in titles) {
        expect(find.text(t), findsOneWidget);
      }
      final ys = [for (final t in titles) tester.getTopLeft(find.text(t))];
      expect(ys[0].dy <= ys[2].dy && ys[2].dy <= ys[4].dy, isTrue);
    });
  });

  group('the buddy (BuddyPriya, BuddyAround, BuddyHowTo)', () {
    testWidgets('"Help Priya with", You’re the buddy, a tick on a how-to task', (tester) async {
      final api = _FakeTeamApi(_buddyPriya());
      await _pump(tester, _person(api, name: 'Meera Joshi'));
      expect(find.text('Help Priya with'), findsOneWidget);
      expect(find.text('You’re the buddy'), findsOneWidget);
      expect(find.text('Reports to Sunny Kapoor'), findsOneWidget);
      expect(find.text('Sowaka tour: Punch in and out'), findsOneWidget);
    });

    testWidgets('the office round: six places, Done ticks it and says so', (tester) async {
      final api = _FakeTeamApi(_buddyPriya());
      await _pump(tester, _person(api, name: 'Meera Joshi'));
      await tester.tap(find.text('Show Priya around the office'));
      await tester.pumpAndSettle();
      expect(find.text('For Priya Shah'), findsOneWidget);
      for (final p in ['Their desk and the team area', 'Pantry and where people eat', 'Meeting rooms', 'Washrooms', 'Fire exits and first aid', 'The HR and IT desks']) {
        expect(find.text(p), findsOneWidget);
      }
      await tester.tap(find.byKey(const ValueKey('team-check-0')));
      await _scrollTo(tester, find.byKey(const ValueKey('team-button-Done')));
      await tester.tap(find.byKey(const ValueKey('team-button-Done')));
      await tester.pumpAndSettle();
      expect(api.calls, ['row:buddy_show_around:done']);
      expect(find.text('Marked as done'), findsOneWidget);
    });

    testWidgets('the how-to task: HR’s line, Done', (tester) async {
      final api = _FakeTeamApi(_buddyPriya());
      await _pump(tester, _person(api, name: 'Meera Joshi'));
      await tester.tap(find.byKey(const ValueKey('team-view-all')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add Priya to the team’s groups and channels'));
      await tester.pumpAndSettle();
      expect(find.text('The team group, the office group and any channels the team uses day to day.'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('team-button-Done')));
      await tester.pumpAndSettle();
      expect(api.calls, ['row:buddy_groups:done']);
      expect(find.text('Added to the groups'), findsOneWidget);
    });
  });

  group('the head of department (HodProtoSana, HodApprove, HodMeet)', () {
    Map<String, dynamic> conf() => {
      'state': 'ready',
      'recommendation': {
        'byName': 'Haider Ali', 'outcome': 'confirm', 'kpis': 'Met his monthly goals in five of six months.', 'strengths': 'Owns vendor follow-ups.',
        'next': 'Weekly report quality.', 'at': DateTime(2026, 11, 20, 10).toIso8601String(),
      },
      'facts': [
        {'label': 'Monthly goals', 'value': 'Met in 5 of 6 months'},
        {'label': 'Confirmation discussion', 'value': 'Done on 18 Nov'},
      ],
    };

    testWidgets('waiting for the manager: the pill, nothing to open', (tester) async {
      final api = _FakeTeamApi(_hodDev(pill: 'Waiting for Haider'));
      await _pump(tester, _person(api, now: DateTime(2026, 11, 22, 10), name: 'Anita Desai'));
      expect(find.text('Waiting for Haider'), findsOneWidget);
      await tester.tap(find.text('Approve Dev’s confirmation'));
      await tester.pumpAndSettle();
      expect(find.text('Your comments'), findsNothing);
    });

    testWidgets('approve: recommended by + when, the answers, the facts, comments; Approve', (tester) async {
      final api = _FakeTeamApi(_hodDev())..confirmationJson = conf();
      await _pump(tester, _person(api, now: DateTime(2026, 11, 22, 10), name: 'Anita Desai'));
      await tester.tap(find.text('Approve Dev’s confirmation'));
      await tester.pumpAndSettle();
      expect(find.text('Dev’s confirmation'), findsOneWidget);
      expect(find.text('Recommended 2 days ago by Haider'), findsOneWidget);
      expect(find.text('Ready to approve'), findsOneWidget);
      await _scrollTo(tester, find.text('Met in 5 of 6 months'));
      expect(find.text('Haider Ali recommends: Confirm'), findsOneWidget);
      await _scrollTo(tester, find.text('Haider, Dev and HR see your comments.'));
      await _scrollTo(tester, find.byKey(const ValueKey('team-button-Approve')));
      await tester.tap(find.byKey(const ValueKey('team-button-Approve')));
      await tester.pumpAndSettle();
      expect(api.calls.single, startsWith('confirm:approve:-'));
      expect(find.text('Confirmation approved'), findsOneWidget);
    });

    testWidgets('the manager recommends extending: "Approve extension" extends by their months', (tester) async {
      final c = conf();
      c['recommendation'] = <String, dynamic>{...(c['recommendation'] as Map), 'outcome': 'extend', 'extendMonths': 2};
      final api = _FakeTeamApi(_hodDev())..confirmationJson = c;
      await _pump(tester, _person(api, now: DateTime(2026, 11, 22, 10), name: 'Anita Desai'));
      await tester.tap(find.text('Approve Dev’s confirmation'));
      await tester.pumpAndSettle();
      await _scrollTo(tester, find.text('Haider Ali recommends: Extend by 2 months'));
      expect(find.text('Haider Ali recommends: Extend by 2 months'), findsOneWidget);
      await _scrollTo(tester, find.byKey(const ValueKey('team-button-Approve extension')));
      await tester.tap(find.byKey(const ValueKey('team-button-Approve extension')));
      await tester.pumpAndSettle();
      expect(api.calls.single, startsWith('confirm:approve:-'));
      expect(find.text('Probation extended by 2 months'), findsOneWidget);
      expect(find.text('Confirmation approved'), findsNothing);
    });

    testWidgets('extend: 1, 2 or 3 months, then "Extend by 2 months"; Cancel goes back', (tester) async {
      final api = _FakeTeamApi(_hodDev())..confirmationJson = conf();
      await _pump(tester, _person(api, now: DateTime(2026, 11, 22, 10), name: 'Anita Desai'));
      await tester.tap(find.text('Approve Dev’s confirmation'));
      await tester.pumpAndSettle();
      await _scrollTo(tester, find.byKey(const ValueKey('team-button-Extend')));
      await tester.tap(find.byKey(const ValueKey('team-button-Extend')));
      await tester.pumpAndSettle();
      expect(find.text('Extend probation by'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('team-choice-2 months')));
      await tester.pumpAndSettle();
      await _scrollTo(tester, find.byKey(const ValueKey('team-button-Extend by 2 months')));
      await tester.tap(find.byKey(const ValueKey('team-button-Extend by 2 months')));
      await tester.pumpAndSettle();
      expect(api.calls.single, startsWith('confirm:extend:2'));
      expect(find.text('Probation extended by 2 months'), findsOneWidget);
    });

    testWidgets('meet the new joiners: with the others this week, a time, Send invite', (tester) async {
      final page = _hodDev()
        ..['tasks'] = [_row('senior_meet', 'Meet Dev, one to one or with other new joiners', 2, kind: 'meet', opens: 'invite', pair: 'Meet someone senior')];
      (page['joiner'] as Map)['step'] = 2;
      final api = _FakeTeamApi(page)
        ..joiners = [
          TeamJoinerRow.fromJson({'journeyId': 'j6', 'name': 'Dev Arora', 'relation': 'line', 'step': 2, 'stepLabel': 'Week 1', 'designation': 'Operations executive'}),
          TeamJoinerRow.fromJson({'journeyId': 'j7', 'name': 'Sana Khan', 'relation': 'line', 'step': 1, 'stepLabel': 'Day 1', 'designation': 'Operations analyst'}),
          TeamJoinerRow.fromJson({'journeyId': 'j8', 'name': 'Rahul Verma', 'relation': 'line', 'step': 3, 'stepLabel': 'Month 1'}),
        ];
      await _pump(tester, _person(api, name: 'Anita Desai'));
      await tester.tap(find.text('Meet Dev, one to one or with other new joiners'));
      await tester.pumpAndSettle();
      expect(find.text('With other new joiners'), findsOneWidget);
      expect(find.text('New joiners this week'), findsOneWidget);
      expect(find.text('Sana Khan'), findsOneWidget);
      expect(find.text('Rahul Verma'), findsNothing, reason: 'Month 1 is not this week');
      expect(find.text('Pick a time'), findsWidgets);
      await tester.tap(find.byKey(const ValueKey('team-seg-one')));
      await tester.pumpAndSettle();
      expect(find.text('New joiners this week'), findsNothing);
    });
  });

  group('the manager’s task screens', () {
    testWidgets('a check-in: the answers, Mark as read', (tester) async {
      final page = _priya(step: 3)
        ..['tasks'] = [
          _row('mgr_read_checkin@ci-m1', 'Read Priya’s Month 1 check-in', 3, kind: 'review', opens: 'checkin', checkinId: 'ci-m1',
              pair: 'Month 1 check-in', pill: {'text': 'Ready to read', 'tone': 'blue'}),
        ];
      final api = _FakeTeamApi(page)
        ..checkinJson = {
          'title': 'Month 1 check-in', 'state': 'ready', 'sentAt': DateTime(2026, 12, 30, 9).toIso8601String(),
          'questions': [
            {'id': 'q1', 'text': 'Is the role what you were told it would be?', 'type': 'rating'},
            {'id': 'q2', 'text': 'Have you met your team?', 'type': 'yes_no'},
            {'id': 'q3', 'text': 'What has surprised you?', 'type': 'long'},
          ],
          'answers': [
            {'questionId': 'q1', 'value': 4},
            {'questionId': 'q2', 'value': 'yes'},
            {'questionId': 'q3', 'value': 'How quickly people reply on the team group.'},
          ],
        };
      await _pump(tester, _person(api, now: DateTime(2026, 12, 31, 10)));
      await tester.tap(find.text('Read Priya’s Month 1 check-in'));
      await tester.pumpAndSettle();
      expect(find.text('Priya’s Month 1 check-in'), findsOneWidget);
      expect(find.text('Sent yesterday'), findsOneWidget);
      expect(find.text('4 of 5'), findsOneWidget);
      expect(find.text('Yes'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('team-button-Mark as read')));
      await tester.pumpAndSettle();
      expect(api.calls, ['read:ci-m1']);
      expect(find.text('Marked as read'), findsOneWidget);
    });

    testWidgets('schedule: Day 1 and Week 1 closed, "n of m set", Send invites', (tester) async {
      final page = _priya(step: 0)
        ..['tasks'] = [_row('mgr_schedule', 'Schedule Priya’s first-week meetings', 0, opens: 'schedule', how: 'The meetings are already created. Pick a time for each one.')];
      final api = _FakeTeamApi(page);
      await _pump(tester, _person(api, now: DateTime(2026, 11, 22, 10)));
      await tester.tap(find.text('Schedule Priya’s first-week meetings'));
      await tester.pumpAndSettle();
      expect(find.text('The meetings are already created. Pick a time for each one.'), findsOneWidget);
      expect(find.text('1 of 3 set'), findsOneWidget);
      expect(find.text('0 of 1 set'), findsOneWidget);
      expect(find.text('First goals'), findsNothing, reason: 'closed until tapped');
      await tester.tap(find.byKey(const ValueKey('team-sched-group-1')));
      await tester.pumpAndSettle();
      expect(find.text('First goals'), findsOneWidget);
      expect(find.text('Pick a time'), findsNWidgets(2));
      // Only new or changed times are sent: with none, nothing goes and it says what to do.
      await tester.tap(find.byKey(const ValueKey('team-button-Send invites')));
      await tester.pump();
      expect(api.calls, isEmpty);
      expect(find.text('Pick a time for a meeting'), findsOneWidget);
    });

    testWidgets('a welcome message, prefilled with the joining date and the manager’s first name', (tester) async {
      final page = _priya(step: 0)..['tasks'] = [_row('mgr_welcome', 'Send Priya a welcome message', 0, kind: 'chat', early: true, opens: 'chat')];
      final api = _FakeTeamApi(page);
      await _pump(tester, _person(api, now: DateTime(2026, 11, 22, 10)));
      await tester.tap(find.text('Send Priya a welcome message'));
      await tester.pumpAndSettle();
      final text = tester.widget<TextField>(find.byType(TextField)).controller!.text;
      expect(text, 'Hi Priya, we’re so glad you’re joining us on 1 Dec. I’ll meet you on your first day to talk through your first week. See you soon! Sunny');
      await tester.tap(find.byKey(const ValueKey('team-button-Send')));
      await tester.pumpAndSettle();
      expect(api.calls.single, startsWith('welcome:Hi Priya'));
      expect(find.text('Message sent to Priya'), findsOneWidget);
    });

    testWidgets('the feed post: you, Posting to everyone, the post, Welcome, Priya!', (tester) async {
      final api = _FakeTeamApi(_priya());
      await _pump(tester, _person(api));
      await tester.tap(find.text('Introduce Priya on the feed'));
      await tester.pumpAndSettle();
      expect(find.text('Posting to everyone'), findsOneWidget);
      expect(find.text('Welcome, Priya!'), findsOneWidget);
      final text = tester.widget<TextField>(find.byType(TextField)).controller!.text;
      expect(text, 'Please welcome Priya Shah, who joins us as operations executive in the Operations team. Say hi when you see Priya around the office!');
      await _scrollTo(tester, find.byKey(const ValueKey('team-button-Post')));
      await tester.tap(find.byKey(const ValueKey('team-button-Post')));
      await tester.pumpAndSettle();
      expect(find.text('Posted on the feed'), findsOneWidget);
    });

    testWidgets('assign a buddy: pick, Assign, "Meera is Priya’s buddy"', (tester) async {
      final page = _priya(step: 0)..['tasks'] = [_row('mgr_assign_buddy', 'Assign Priya a buddy', 0, kind: 'team', opens: 'buddy', pair: 'Your buddy')];
      final api = _FakeTeamApi(page);
      await _pump(tester, _person(api, now: DateTime(2026, 11, 22, 10)));
      await tester.tap(find.text('Assign Priya a buddy'));
      await tester.pumpAndSettle();
      expect(find.text('Operations lead'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('team-button-Assign')));
      await tester.pumpAndSettle();
      expect(find.text('Pick someone first'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('team-buddy-m1')));
      await tester.tap(find.byKey(const ValueKey('team-button-Assign')));
      await tester.pumpAndSettle();
      expect(api.calls, ['buddy:m1']);
      expect(find.text('Meera is Priya’s buddy'), findsOneWidget);
    });

    testWidgets('goal comments: each goal, how it is going, the note, a comment; Send to Priya', (tester) async {
      final page = _priya(step: 3)..['tasks'] = [_row('mgr_goal_comments@1', 'Comment on Priya’s goals', 3, kind: 'goal', opens: 'goals', month: 1, pair: 'Your monthly goals')];
      final api = _FakeTeamApi(page)
        ..goalsJson = [
          {'index': 0, 'text': 'Close 20 customer tickets on your own', 'status': 'progress', 'note': '12 so far.'},
          {'index': 1, 'text': 'Shadow 3 client calls', 'status': 'well'},
        ];
      await _pump(tester, _person(api, now: DateTime(2026, 12, 31, 10)));
      await tester.tap(find.text('Comment on Priya’s goals'));
      await tester.pumpAndSettle();
      expect(find.text('After your Monthly goals talk'), findsOneWidget);
      expect(find.text('Making progress'), findsOneWidget);
      expect(find.text('Going well'), findsOneWidget);
      expect(find.text('Priya: 12 so far.'), findsOneWidget);
      await tester.enterText(find.byType(TextField).first, 'Great pace');
      await _scrollTo(tester, find.byKey(const ValueKey('team-button-Send to Priya')));
      await tester.tap(find.byKey(const ValueKey('team-button-Send to Priya')));
      await tester.pumpAndSettle();
      expect(api.calls.single, 'goals:1:Great pace|');
      expect(find.text('Comments sent to Priya'), findsOneWidget);
    });

    testWidgets('the confirmation review: facts, Confirm / Extend, three answers, Send to Anita', (tester) async {
      final page = _priya(step: 8)..['tasks'] = [_row('mgr_confirmation_review', 'Write Priya’s confirmation review', 8, kind: 'doc', opens: 'review')];
      final api = _FakeTeamApi(page)
        ..reviewJson = {
          'facts': [
            {'label': 'Monthly goals', 'value': 'Met in 5 of 6 months'},
            {'label': 'Attendance', 'value': 'On time on 94% of days'},
          ],
          'approverName': 'Anita Desai',
        };
      await _pump(tester, _person(api, now: DateTime(2027, 5, 20, 10)));
      await tester.tap(find.text('Write Priya’s confirmation review'));
      await tester.pumpAndSettle();
      expect(find.text('FOR YOUR REVIEW'), findsNothing);
      expect(find.text('For your review'), findsOneWidget);
      expect(find.text('On time on 94% of days'), findsOneWidget);
      expect(find.text('Your recommendation'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('team-seg-extend')));
      await tester.pumpAndSettle();
      expect(find.text('Extend by'), findsOneWidget);
      for (final (i, t) in ['Met most goals', 'Calm with escalations', 'The weekly report'].indexed) {
        await _scrollTo(tester, find.byKey(ValueKey('team-field-$i')));
        await tester.enterText(find.descendant(of: find.byKey(ValueKey('team-field-$i')), matching: find.byType(TextField)), t);
      }
      await _scrollTo(tester, find.byKey(const ValueKey('team-button-Send to Anita')));
      await tester.tap(find.byKey(const ValueKey('team-button-Send to Anita')));
      await tester.pumpAndSettle();
      expect(api.calls.single, 'review:extend:3:Met most goals|Calm with escalations|The weekly report');
      expect(find.text('Sent to Anita to approve'), findsOneWidget);
    });

    testWidgets('a plain task: HR’s how-to line, Mark as done', (tester) async {
      final page = _priya(step: 0)..['tasks'] = [_row('mgr_kpis', 'Set Priya’s KPIs', 0, kind: 'goal', opens: 'plain', canTick: true, pair: 'Review your KPIs', how: 'In Performance › KPIs. They review them in Week 1.')];
      final api = _FakeTeamApi(page);
      await _pump(tester, _person(api, now: DateTime(2026, 11, 22, 10)));
      await tester.tap(find.text('Set Priya’s KPIs'));
      await tester.pumpAndSettle();
      expect(find.text('In Performance › KPIs. They review them in Week 1.'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('team-button-Mark as done')));
      await tester.pumpAndSettle();
      expect(api.calls, ['row:mgr_kpis:done']);
    });
  });

  test('times as the canvas writes them', () {
    expect(teamClock(DateTime(2026, 12, 1, 9, 30)), '9:30 am');
    expect(teamClock(DateTime(2026, 12, 1, 11)), '11 am');
    expect(teamClock(DateTime(2026, 12, 1, 15)), '3 pm');
    expect(teamDayClock(DateTime(2026, 12, 2, 14)), 'Wed, 2 pm');
    expect(teamAgo(DateTime(2026, 11, 20, 18), DateTime(2026, 11, 22, 9)), '2 days ago');
    expect(teamDayMonth('2026-12-01'), '1 Dec');
  });

  test('the rows now: this step open, then done, then the next step as COMING UP', () {
    final page = TeamJoinerPage.fromJson(_priya(done: {'mgr_first_goals'}));
    final rows = teamRowsNow(page);
    expect([for (final r in rows) r.task.id], ['mgr_feed_intro', 'mgr_first_goals', 'mgr_read_checkin@ci-w1']);
    expect(rows.last.head, 'COMING UP');
  });
}
