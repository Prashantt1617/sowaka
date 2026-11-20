import 'package:mobile_app/features/lifecycle/onboarding/data/team_joiners_api.dart';

/// The manager's side (team-side canvas, MgrTeamsProto, role manager) as the
/// server sends it: `/lifecycle/team/joiners/:id` for a report, and the
/// manager's joiner (`/lifecycle/manager/joiners/:id`). Shapes as
/// backend/src/services/lifecycle/teamTasks.ts writes them.

const mgrSteps = ['Before Day 1', 'Day 1', 'Week 1', 'Month 1', 'Month 2', 'Month 3', 'Month 4', 'Month 5', 'Month 6', 'Confirmed'];

Map<String, dynamic> mgrTask(
  String id,
  String title,
  int step, {
  String kind = 'task',
  bool done = false,
  bool early = false,
  bool canTick = true,
  String? opens,
  String? reviewState,
  String? pair,
  String? note,
  String? systemKey,
  int? month,
  bool journey = false,
  List<String>? agenda,
}) => {
  'id': id, 'title': title, 'kind': kind, 'step': step, 'done': done, 'early': early, 'canTick': canTick,
  'source': journey ? 'journey' : 'team', 'opens': ?opens, 'reviewState': ?reviewState, 'pair': ?pair, 'note': ?note,
  'systemKey': ?systemKey, 'month': ?month, 'agenda': ?agenda,
};

Map<String, dynamic> joinerTaskJson(String id, String title, {String kind = 'ack', String status = 'todo', String? systemKey, String? ownerName, String? dueLabel, bool late = false}) => {
  'id': id, 'title': title, 'kind': kind, 'status': status, 'systemKey': ?systemKey, 'phase': 'first_week', 'ownerRole': 'employee',
  'surface': 'app', 'mustDo': false, 'late': late, 'ownerName': ?ownerName, 'dueLabel': ?dueLabel,
};

/// Priya on Day 1: the manager's rows now, Week 1's coming up, her own onboarding for View progress.
Map<String, dynamic> priyaDay1Page({Set<String> done = const {}, bool delayed = false}) => {
  'joiner': {
    'journeyId': 'j1', 'userId': 'u1', 'name': 'Priya Menon', 'first': 'Priya', 'designation': 'Admissions coordinator',
    'managerName': 'Sunny Kapoor', 'buddyName': 'Meera Joshi', 'tj': '2026-12-01', 'preboarding': false,
    'plant': {'leaves': 1}, 'status': delayed ? '1 task delayed' : 'On track', 'delayed': delayed ? 1 : 0,
  },
  'relation': 'report',
  'approverName': 'Haider Ali',
  'steps': mgrSteps,
  'step': 1,
  'canBrowseSteps': true,
  'tasks': [
    mgrTask('ab', 'Pick a buddy for Priya', 0, kind: 'team', done: true, canTick: false, opens: 'screen', systemKey: 'assign_buddy', journey: true, pair: 'Your buddy'),
    mgrTask('mgr_plan_week', 'Plan Priya’s first week', 0, done: true, note: 'Who they meet, what they shadow'),
    mgrTask('mm', 'Meet Priya', 1, kind: 'meet', opens: 'meeting', systemKey: 'meet_manager', journey: true, pair: 'Meet your manager', done: done.contains('mm'),
        agenda: ['How the first week will look', 'What a good first month looks like', 'How you’ll work together', 'Who to meet first']),
    mgrTask('mt', 'Introduce Priya to the team', 1, kind: 'team', systemKey: 'meet_team', journey: true, pair: 'Your team', done: done.contains('mt'), canTick: !done.contains('mt')),
    mgrTask('st', 'Give Priya a starter task', 1, canTick: false, opens: 'screen', systemKey: 'starter_task', journey: true, note: 'Something small for their first week'),
    mgrTask('mgr_buddy_check', 'Check in with Priya’s buddy', 2, kind: 'meet', early: true, opens: 'meeting', agenda: ['How Priya is settling in', 'Anything Priya is stuck on']),
    mgrTask('mgr_week_chat', 'End-of-week chat', 2, kind: 'meet', early: true, opens: 'meeting', agenda: ['Highlights of the week', 'Questions so far', 'Plan for next week']),
    mgrTask('pg', 'Set Priya’s probation goals', 2, kind: 'goal', canTick: false, opens: 'screen', systemKey: 'probation_goals', journey: true, pair: 'Your goals'),
  ],
  'progress': {
    'today': [
      joinerTaskJson('m1', 'Meet your manager', kind: 'meeting', ownerName: 'Sunny Kapoor'),
      joinerTaskJson('m2', 'Meet your buddy', kind: 'meeting', ownerName: 'Meera Joshi'),
      joinerTaskJson('t1', 'Declare your tax and investments', late: delayed),
      joinerTaskJson('t2', 'Acknowledge policies', systemKey: 'policies_ack'),
    ],
    'later': [
      joinerTaskJson('m3', 'IT helpdesk', kind: 'meeting', status: 'locked', ownerName: 'Imran Khan', dueLabel: 'Week 1'),
      joinerTaskJson('t3', 'Add your nominees', status: 'locked', dueLabel: 'Week 1'),
    ],
    'done': [joinerTaskJson('m0', 'Welcome with HR', kind: 'meeting', status: 'done', ownerName: 'Ritu Sharma')],
    'tour': {'done': ['punch']},
    'devices': [
      {'key': 'laptop', 'title': 'Laptop', 'ready': true},
      {'key': 'email', 'title': 'Email', 'ready': false},
      {'key': 'app', 'title': 'Sowaka Connect', 'ready': true},
    ],
  },
};

/// Rahul in Month 3 with his self check-in sent: the review row is ready.
Map<String, dynamic> rahulMonth3Page() => {
  ...priyaDay1Page(),
  'joiner': {
    'journeyId': 'j3', 'userId': 'u3', 'name': 'Rahul Verma', 'first': 'Rahul', 'designation': 'Admissions executive',
    'managerName': 'Sunny Kapoor', 'buddyName': 'Meera Joshi', 'tj': '2026-09-16', 'plant': {'leaves': 3}, 'status': 'On track', 'delayed': 0,
  },
  'step': 5,
  'tasks': [
    mgrTask('g3', 'Set Rahul’s Month 3 goals', 5, kind: 'goal', done: true, canTick: false, opens: 'screen', systemKey: 'monthly_goals', month: 3, journey: true),
    mgrTask('c3', 'Month-3 check-in', 5, kind: 'meet', opens: 'meeting', systemKey: 'monthly_checkin', month: 3, journey: true, pair: 'Your check-in',
        agenda: ['Progress on this month’s goals', 'What’s going well', 'What’s hard', 'Goals for next month']),
    mgrTask('r3', 'Review Rahul’s Month-3 self check-in', 5, kind: 'review', canTick: false, opens: 'review', reviewState: 'ready', systemKey: 'monthly_review', month: 3, journey: true, pair: 'Your self check-in'),
    mgrTask('mgr_mid_feedback', 'Mid-probation feedback', 5, kind: 'doc', pair: 'Feedback from your manager'),
  ],
};

/// The manager's joiner (`/lifecycle/manager/joiners/:id`) for [page]'s joiner.
Map<String, dynamic> managerJoinerJson({String journeyId = 'j1', String name = 'Priya Menon', String tj = '2026-12-01', String stage = 'welcome_week1', bool withMonth3 = false, DateTime? sentAt}) => {
  'joiner': {'journeyId': journeyId, 'userId': 'u1', 'name': name, 'designation': 'Admissions coordinator', 'tj': tj, 'stage': stage},
  'tasks': const [],
  'setup': {'people': const [], 'goals': const [], 'buddy': {'userId': 'b1', 'name': 'Meera Joshi'}},
  'welcomePost': {'canPost': true},
  if (withMonth3)
    'probation': {
      'months': [
        {
          'id': 'pm3', 'monthNo': 3,
          'goals': [{'text': 'Run 2 admission webinars'}, {'text': 'Own the Pune campus enquiries'}],
          'checkinEmployee': {
            'text': 'A win: I ran my first two webinars on my own.\nWould help: An hour with Finance to learn the fee structure.',
            'rating': 3, 'goalRatings': [3, 1],
            'win': 'I ran my first two webinars on my own, and 40 parents signed up for campus visits.',
            'ask': 'An hour with Finance to learn the fee structure.',
            'at': (sentAt ?? DateTime(2026, 12, 9, 18)).toIso8601String(),
          },
        },
      ],
    },
};

/// A team side that answers from [page] and records what was done.
class FakeTeamApi implements TeamJoinersApi {
  FakeTeamApi(this.page);

  Map<String, dynamic> page;
  final calls = <String>[];

  @override
  Future<TeamJoinerPage> fetchJoiner(String journeyId) async => TeamJoinerPage.fromJson(page);

  @override
  Future<List<TeamJoinerRow>> fetchJoiners() async => const [];

  @override
  Future<TeamJoinerPage> taskAction(String journeyId, String taskId, String action) async {
    calls.add('$action:$taskId');
    page = {
      ...page,
      'tasks': [
        for (final t in page['tasks'] as List)
          if ((t as Map)['id'] == taskId) {...t.cast<String, dynamic>(), 'done': action == 'done', if (t['source'] == 'journey') 'canTick': false} else t,
      ],
    };
    return TeamJoinerPage.fromJson(page);
  }

  @override
  Future<TeamJoinerPage> meetingDone(String journeyId, String taskId, {String? notes}) async {
    calls.add('meeting:$taskId:${notes ?? ''}');
    return taskAction(journeyId, taskId, 'done');
  }

  @override
  Future<void> reviewMonth(String journeyId, int month, {String? comment}) async => calls.add('review:$month:${comment ?? ''}');

  @override
  Future<void> sendBackMonth(String journeyId, int month, {String? comment}) async => calls.add('back:$month:${comment ?? ''}');

  @override
  Future<TeamApproval> fetchApproval(String journeyId) async => TeamApproval.fromJson(const {'state': 'waiting', 'managerName': 'Sunny Kapoor'});

  @override
  Future<TeamApproval> answerApproval(String journeyId, String action, {String? comment}) => fetchApproval(journeyId);

  @override
  Future<TeamJoinerPage> recommend(String journeyId, String outcome, {String? note}) async {
    calls.add('recommend:$outcome');
    return TeamJoinerPage.fromJson(page);
  }
}
