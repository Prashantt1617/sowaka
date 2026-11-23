import 'dart:async';
import 'dart:typed_data';

// The joiner's onboarding (Onboarding · Final designs, canvas page "1 · New
// joiner"): the home by stage with the look ahead, Meetings with Mark as
// met, Tasks with their verbs, check-ins one question per screen, goals with
// "How’s it going?", and the portal before Day 1 kept as it was. Every value
// on these screens is the fake server's (`GET /lifecycle/joiner/onboarding`).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/joiner_meetings_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/joiner/joiner_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/joiner/joiner_details.dart';
import 'package:mobile_app/features/lifecycle/onboarding/joiner/joiner_details_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/joiner/joiner_form.dart';
import 'package:mobile_app/features/lifecycle/onboarding/joiner/joiner_parts.dart';
import 'package:mobile_app/features/lifecycle/onboarding/joiner/joiner_home.dart';
import 'package:mobile_app/features/lifecycle/onboarding/joiner/joiner_lens.dart';
import 'package:mobile_app/features/lifecycle/onboarding/joiner/joiner_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/onboarding_launcher.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/portal_page_screen.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart' show ManagerTab;
import 'package:shared_preferences/shared_preferences.dart';

import 'lifecycle_onboarding_test.dart' show FakeOnboardingApi, FakePortalSurface, pumpPage, scrollTo, shellFor;

// ─── Fixtures, shaped as joinerApp.ts answers ───────────────────────────────

const _labels = {'d1': 'Day 1', 'w1': 'Week 1', 'm1': 'Month 1', 'm2': 'Month 2', 'm3': 'Month 3', 'm4': 'Month 4', 'm5': 'Month 5', 'm6': 'Month 6', 'confirmed': 'Confirmed'};

List<Map<String, dynamic>> _steps(String at) {
  final keys = _labels.keys.toList();
  final i = keys.indexOf(at);
  return [
    for (final (k, key) in keys.indexed) {'key': key, 'label': _labels[key], 'state': k < i ? 'done' : (k == i ? 'current' : 'future')},
  ];
}

Map<String, dynamic> _person(String name) => {'userId': name.toLowerCase().split(' ').first, 'name': name, 'initials': name.split(' ').map((p) => p[0]).join()};

Map<String, dynamic> _meeting(String id, String title, String role, String label, String step,
    {String? person, bool met = false, bool locked = false, String? carriedFrom, bool everyMonth = false, int? month, List<String> agenda = const ['One', 'Two']}) => {
  'id': 'team:$id',
  'title': title,
  'withRole': role,
  'roleLabel': label,
  if (person != null) 'person': _person(person),
  'step': step,
  'everyMonth': everyMonth,
  'month': ?month,
  'met': met,
  'locked': locked,
  if (locked) 'opensOn': '2026-12-08',
  'carriedFrom': ?carriedFrom,
  'agenda': agenda,
  'notes': <String>[],
};

Map<String, dynamic> _task(String id, String title, String type, String verb, String step,
    {String state = 'todo', String? meta, String? carriedFrom, Map<String, dynamic> opens = const {}, Map<String, dynamic>? progress}) => {
  'id': id,
  'title': title,
  'type': type,
  'verb': verb,
  'meta': ?meta,
  'step': step,
  'state': state,
  'carriedFrom': ?carriedFrom,
  'progress': ?progress,
  'opens': opens,
};

Map<String, dynamic> _home(String step, {bool punched = false, Map<String, dynamic> extra = const {}}) {
  final meetings = [
    _meeting('hr_welcome', 'Welcome and documents', 'hr', 'HR', 'd1', person: 'Ritu Sharma', met: step != 'd1'),
    _meeting('mgr_first_goals', 'First goals', 'manager', 'Your manager', 'd1', person: 'Sunny Kapoor', met: step != 'd1', carriedFrom: null),
    _meeting('it_laptop_help', 'Laptop and login help', 'it', 'IT & admin', 'w1', person: 'Imran Khan'),
    _meeting('mgr_monthly_goals@1', 'Monthly goals', 'manager', 'Your manager', 'm1', person: 'Sunny Kapoor', everyMonth: true, month: 1, locked: step == 'd1' || step == 'w1'),
    _meeting('mgr_monthly_goals@2', 'Monthly goals', 'manager', 'Your manager', 'm2', person: 'Sunny Kapoor', everyMonth: true, month: 2, locked: true),
  ];
  return {
    'journeyId': 'j1',
    'companyName': 'Sowaka Test',
    'firstName': 'Priya',
    'step': step,
    'steps': _steps(step),
    'hero': step == 'confirmed' ? {'eyebrow': 'PROBATION COMPLETE', 'label': 'Confirmed!'} : {'eyebrow': 'YOU ARE HERE', 'label': _labels[step]},
    'plant': {'stage': 1},
    'firstPunch': {if (punched) 'at': '2026-12-01T05:12:00.000Z', 'faceEnrolled': punched},
    'meetings': meetings,
    'tasks': [
      _task('t-sign', 'Sign your joining documents', 'sign', 'Sign', 'd1', meta: 'Appointment letter', opens: {'letters': true}),
      _task('t-pol', 'Acknowledge company policies', 'ack', 'Read', 'd1', meta: '0 of 3 done', progress: {'done': 0, 'total': 3}, opens: {'policies': true}),
      _task('t-prof', 'Complete your profile', 'do', 'Start', 'w1', opens: {'screen': 'profile'}),
      _task('t-kpi', 'Review your KPIs', 'review', 'Review', 'w1', opens: {'screen': 'kpis'}),
      _task('t-form', 'Fill in the joining form', 'other', 'Open', 'w1', opens: {'link': 'https://example.com/form'}),
    ],
    'checkins': [
      {'id': 'ci-w1', 'title': 'Week 1 check-in', 'step': 'w1', 'questions': 3, 'state': step == 'w1' ? 'open' : 'locked'},
    ],
    'watch': [
      {'id': 'v1', 'title': 'Welcome from HR', 'type': 'video', 'minutes': 1, 'step': 'd1', 'watched': false, 'bg': 'blue'},
      {'id': 'v2', 'title': 'How your department works', 'type': 'video', 'minutes': 4, 'step': 'w1', 'watched': false},
    ],
    'trainings': [
      {'id': 'tr1', 'title': 'Information security basics', 'type': 'pdf', 'minutes': 5, 'step': 'w1', 'watched': false},
    ],
    'devices': [
      {'id': 'dv1', 'title': 'Laptop', 'ready': true},
      {'id': 'dv2', 'title': 'Work email', 'ready': false},
    ],
    'tour': {'lessons': ['punch', 'missed', 'leave', 'overtime'], 'done': [if (punched) 'punch'], 'today': punched ? 'missed' : 'punch'},
    'profile': {
      'sections': [
        {'key': 'personal', 'title': 'Personal details', 'state': 'done'},
        {'key': 'contact', 'title': 'Contact and address', 'state': 'done'},
        {'key': 'bank', 'title': 'Bank account and PF', 'state': 'todo'},
      ],
      'done': 2,
      'total': 7,
      'pct': 29,
    },
    'summary': {
      'meetings': {'met': step == 'd1' ? 0 : 2, 'total': 2},
      'tasks': {'toDo': 2, 'upNext': 'Sign your joining documents'},
      'devices': {'ready': 1, 'total': 2},
      if (step == 'w1') 'checkinDue': {'id': 'ci-w1', 'title': 'Week 1 check-in'},
    },
    ...extra,
  };
}

class FakeJoinerApi implements JoinerApi {
  FakeJoinerApi(this.home);

  Map<String, dynamic> home;
  final calls = <String>[];
  Map<String, dynamic> goals = {
    'month': 3,
    'managerName': 'Sunny Kapoor',
    'nextTalk': {'on': '2027-02-01', 'inDays': 9, 'withName': 'Sunny Kapoor'},
    'current': [
      {'index': 0, 'text': 'Own the Pune office escalations', 'status': 'well', 'note': 'Handled four this month.'},
      {'index': 1, 'text': 'Train the next joiner on our tools'},
    ],
    'earlier': [
      {
        'month': 2,
        'goals': [
          {'index': 0, 'text': 'Take over the Pune ticket queue', 'status': 'well', 'comment': 'You made this queue your own.', 'commentByName': 'Sunny Kapoor'},
        ],
      },
    ],
  };

  @override
  Future<JoinerOnboarding> fetch() async => JoinerOnboarding.fromJson(home);

  @override
  Future<JoinerOnboarding?> kept() async => null;

  @override
  Future<JoinerOnboarding> taskAction(String taskId, String action) async {
    calls.add('task:$taskId:$action');
    return fetch();
  }

  @override
  Future<void> setMet(String rowId, bool met) async {
    calls.add('met:$rowId:$met');
    home = {
      ...home,
      'meetings': [for (final m in home['meetings'] as List) (m as Map)['id'] == rowId ? {...m, 'met': met} : m],
    };
  }

  @override
  Future<void> saveNotes(String rowId, List<String> notes) async => calls.add('notes:$rowId:${notes.join('|')}');

  @override
  Future<JoinerCheckin> fetchCheckin(String id) async => JoinerCheckin.fromJson({
    'id': id,
    'title': 'Week 1 check-in',
    'step': 'w1',
    'state': 'open',
    'questions': [
      {'id': 'q1', 'text': 'How smooth was your first week?', 'type': 'rating'},
      {'id': 'q2', 'text': 'Have you met your team?', 'type': 'yes_no'},
      {'id': 'q3', 'text': 'What was the most confusing part of your first week?', 'type': 'long'},
    ],
  });

  @override
  Future<JoinerCheckin> sendCheckin(String id, List<({String questionId, Object? value})> answers) async {
    calls.add('checkin:$id:${answers.map((a) => '${a.questionId}=${a.value}').join(',')}');
    return fetchCheckin(id);
  }

  /// The form task's questions (one of each type); [form] holds the answers once sent.
  Map<String, dynamic> form = {
    'taskId': 't-kit',
    'title': 'Your welcome kit',
    'questions': [
      {'id': 'q1', 'text': 'Your name on the ID card', 'type': 'short'},
      {'id': 'q2', 'text': 'Anything we should know', 'type': 'long'},
      {'id': 'q3', 'text': 'T-shirt size', 'type': 'choice', 'options': ['S', 'M', 'L']},
      {'id': 'q4', 'text': 'Date of birth', 'type': 'date'},
      {'id': 'q5', 'text': 'A photo for the ID card', 'type': 'file'},
    ],
  };

  @override
  Future<JoinerForm> fetchForm(String taskId) async => JoinerForm.fromJson({'form': form});

  @override
  Future<JoinerForm> sendForm(String taskId, Map<String, String?> answers) async {
    calls.add('form:$taskId:${answers.entries.map((a) => '${a.key}=${a.value}').join(',')}');
    form = {
      ...form,
      'answers': [for (final a in answers.entries) {'questionId': a.key, 'value': a.value}],
      'sentAt': '2026-12-01T06:00:00.000Z',
    };
    return fetchForm(taskId);
  }

  @override
  Future<({String fileId, String name})> uploadFormFile(String taskId, String filename, Uint8List bytes) async => (fileId: 'f1', name: filename);

  @override
  Future<JoinerGoals> fetchGoals() async => JoinerGoals.fromJson(goals);

  @override
  Future<JoinerGoals> saveGoal(int month, int index, {String? status, String? note}) async {
    calls.add('goal:$month:$index:${status ?? ''}:${note ?? ''}');
    final current = [
      for (final g in goals['current'] as List)
        (g as Map)['index'] == index ? {...g, 'status': status ?? g['status'], 'note': ?note} : g,
    ];
    goals = {...goals, 'current': current};
    return fetchGoals();
  }

  @override
  Future<void> markWatched(String itemId) async => calls.add('watched:$itemId');

  @override
  Future<void> lessonDone(String lesson) async => calls.add('lesson:$lesson');

  @override
  Future<JoinerTeam> fetchTeam() async => JoinerTeam.fromJson({
    'department': 'Operations',
    'people': [
      {'userId': 'sunny', 'name': 'Sunny Kapoor', 'designation': 'Operations lead', 'tag': 'manager'},
      {'userId': 'meera', 'name': 'Meera Joshi', 'designation': 'Senior counsellor', 'tag': 'buddy'},
      {'userId': 'rohit', 'name': 'Rohit Shah', 'designation': 'Counsellor'},
    ],
  });

  @override
  Future<List<JoinerLetter>> letters() async => const [];

  @override
  Future<List<JoinerLetter>> openLetter(String id) async => const [];

  @override
  Future<List<JoinerLetter>> signLetter(String id, String typedName) async => const [];

  @override
  Future<Uint8List> download(String path) async => Uint8List(0);

  /// `GET /lifecycle/joiner/profile`: personal filled before joining, contact approved by HR, the rest empty.
  Map<String, dynamic> profile = {
    'sections': [
      {'key': 'personal', 'title': 'Personal details', 'state': 'done', 'filled': true, 'editable': false},
      {'key': 'contact', 'title': 'Contact and address', 'state': 'done', 'filled': true, 'editable': false, 'locked': true},
      {'key': 'emergency', 'title': 'Emergency contact', 'state': 'todo', 'filled': false, 'editable': true},
    ],
    'values': {
      'personal': {'fullName': 'Priya Shah', 'dob': '1998-04-02', 'gender': 'Female'},
      'contact': {'mobile': '+919876500001', 'permanentSame': true, 'current': {'line': '12 MG Road', 'city': 'Pune', 'state': 'Maharashtra', 'pin': '411001'}},
    },
    'options': {'genders': ['Male', 'Female', 'Other'], 'marital': <String>[], 'qualifications': <String>[], 'relations': ['Parent', 'Partner', 'Sibling', 'Friend']},
  };

  @override
  Future<JoinerProfileDetails> fetchProfileDetails() async => JoinerProfileDetails.fromJson(profile);

  @override
  Future<JoinerProfileDetails> saveProfileSection(String section, Map<String, Object?> values) async {
    calls.add('profile:$section:${values['name']}:${values['relation']}:${values['phone']}');
    profile = {
      ...profile,
      'sections': [
        for (final s in profile['sections'] as List)
          (s as Map)['key'] == section ? {...s, 'state': 'done', 'filled': true, 'editable': false, 'savedInAppAt': '2026-12-01T06:00:00.000Z'} : s,
      ],
      'values': {...profile['values'] as Map, 'emergencyContact': values},
    };
    return fetchProfileDetails();
  }

  /// `GET /lifecycle/joiner/payroll`, prefilled from pre-boarding.
  Map<String, dynamic> payroll = {
    'bank': {'holderName': 'Priya Shah', 'bankName': 'HDFC Bank', 'ifsc': 'HDFC0001234', 'accountLast4': '9012'},
    'pf': {'firstJob': false, 'uan': '100200300400'},
    'nominees': <dynamic>[],
    'relations': ['Spouse', 'Father', 'Mother', 'Other'],
    'state': 'todo',
    'editable': true,
  };
  Map<String, Object?>? payrollSent;

  @override
  Future<JoinerPayroll> fetchPayroll() async => JoinerPayroll.fromJson(payroll);

  @override
  Future<JoinerPayroll> sendPayroll(Map<String, Object?> body) async {
    payrollSent = body;
    payroll = {...payroll, 'nominees': body['nominees'], 'state': 'pending', 'editable': false, 'taskDone': true};
    return fetchPayroll();
  }

  @override
  ({Uri uri, Map<String, String> headers})? media(String path) => null;
}

Future<FakeJoinerApi> _open(WidgetTester tester, Map<String, dynamic> home) async {
  final api = FakeJoinerApi(home);
  await pumpPage(tester, JoinerHomeScreen(shell: shellFor(FakeOnboardingApi(), DateTime(2026, 12, 1)), api: api));
  return api;
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('the look ahead (rules)', () {
    test('now: carried first, her stage, then COMING UP with a stage pill or a lock', () {
      final d = JoinerOnboarding.fromJson(_home('w1', extra: {
        'meetings': [
          _meeting('a', 'Welcome and documents', 'hr', 'HR', 'd1', carriedFrom: 'd1'),
          _meeting('b', 'Laptop and login help', 'it', 'IT & admin', 'w1'),
          _meeting('c@1', 'Monthly goals', 'manager', 'Your manager', 'm1', everyMonth: true, month: 1, locked: true),
          _meeting('c@2', 'Monthly goals', 'manager', 'Your manager', 'm2', everyMonth: true, month: 2, locked: true),
        ],
      }));
      final rows = JoinerLens(d, null).meetingRows;
      expect(rows.map((r) => r.item.title), ['Welcome and documents', 'Laptop and login help', 'Monthly goals']);
      expect(rows[0].pill, 'From Day 1');
      expect(rows[0].amber, isTrue);
      expect(rows[2].head, 'COMING UP');
      expect(rows[2].locked, isTrue);
      expect(rows[2].sub, 'Opens in Month 1');
      expect(rows[2].pill, 'Every month');
    });

    test('ahead: that stage first under IN MONTH 1, then NOW · WEEK 1', () {
      final d = JoinerOnboarding.fromJson(_home('w1'));
      final lens = JoinerLens(d, 'm1');
      expect(lens.mode, LensMode.ahead);
      final rows = lens.meetingRows;
      expect(rows.first.head, 'IN MONTH 1');
      expect(rows.first.item.title, 'Monthly goals');
      expect(rows.where((r) => r.head == 'NOW · WEEK 1'), hasLength(1));
      expect(lens.meetingsMeta, '1 meeting in Month 1');
      expect(lens.inLabel, 'IN MONTH 1');
    });

    test('a done stage cannot be looked at: the lens stays on her own', () {
      final d = JoinerOnboarding.fromJson(_home('w1'));
      expect(JoinerLens(d, 'd1').isNow, isTrue);
    });

    test('/lifecycle/me carries the tile’s words', () {
      final me = LifecycleMe.fromJson({
        'enabled': true,
        'onboarding': {
          'journeyId': 'j1',
          'tileVisible': true,
          'tile': {'title': 'Onboarding', 'subtitle': 'Today is your first day', 'badge': 'Day 1'},
        },
      });
      expect(me.onboarding!.tile!.subtitle, 'Today is your first day');
      expect(me.onboarding!.tile!.badge, 'Day 1');
      expect(me.withProgress(const TaskProgress(1, 2)).onboarding!.tile!.badge, 'Day 1');
    });
  });

  group('home', () {
    testWidgets('Day 1 before the first punch: the hero, the punch card, the tiles', (tester) async {
      await _open(tester, _home('d1'));
      expect(find.text('YOU ARE HERE'), findsOneWidget);
      expect(find.byKey(const ValueKey('stage-title')), findsOneWidget);
      expect(find.byKey(const ValueKey('first-punch-card')), findsOneWidget);
      expect(find.text('Learn to punch in'), findsOneWidget);
      expect(find.byKey(const ValueKey('tour-card')), findsNothing);
      expect(find.byKey(const ValueKey('goals-card')), findsNothing);
      expect(find.text('0 of 2 met'), findsOneWidget);
      expect(find.text('UP NEXT'), findsWidgets);
      expect(find.text('Sign your joining documents'), findsOneWidget);
      expect(find.text('2 to do'), findsOneWidget);
      await scrollTo(tester, find.byKey(const ValueKey('tile-profile')));
      expect(find.text('1 of 2 ready'), findsOneWidget);
      expect(find.text('2 of 7 sections done'), findsOneWidget);
      expect(find.byKey(const ValueKey('tile-checkins')), findsNothing);
    });

    testWidgets('Day 1 after it: tomorrow’s lesson on the tour card', (tester) async {
      await _open(tester, _home('d1', punched: true));
      expect(find.byKey(const ValueKey('first-punch-card')), findsNothing);
      expect(find.text('SOWAKA TOUR · TOMORROW'), findsOneWidget);
      expect(find.text('1 min · 1 of 4 done'), findsWidgets);
    });

    testWidgets('a stage ahead is looked at, and her own brings her back; a done one does nothing', (tester) async {
      await _open(tester, _home('w1', punched: true));
      await tester.tap(find.byKey(const ValueKey('stage-step-m1')));
      await tester.pumpAndSettle();
      expect(find.text('A LOOK AHEAD'), findsOneWidget);
      expect(find.text('1 meeting in Month 1'), findsOneWidget);
      expect(find.byKey(const ValueKey('tile-checkins')), findsNothing);
      await tester.tap(find.byKey(const ValueKey('stage-step-d1')));
      await tester.pumpAndSettle();
      expect(find.text('A LOOK AHEAD'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('stage-step-w1')));
      await tester.pumpAndSettle();
      expect(find.text('YOU ARE HERE'), findsOneWidget);
    });

    testWidgets('from Month 1: "This month’s goals" with the next talk', (tester) async {
      await _open(tester, _home('m1', punched: true, extra: {
        'goals': {'month': 1, 'count': 3, 'nextTalk': {'on': '2026-12-31', 'inDays': 6}},
      }));
      expect(find.text('This month’s goals'), findsOneWidget);
      expect(find.text('3 goals · next talk in 6 days'), findsOneWidget);
    });

    testWidgets('confirmed: PROBATION COMPLETE and the letter to read', (tester) async {
      await _open(tester, _home('confirmed', punched: true, extra: {
        'meetings': <dynamic>[],
        'tasks': [_task('letter:l1', 'Read your confirmation letter', 'ack', 'Read', 'confirmed', meta: 'From HR', opens: {'fileUrl': '/x.pdf'})],
        'summary': {'tasks': {'toDo': 1, 'upNext': 'Read your confirmation letter'}},
      }));
      expect(find.text('PROBATION COMPLETE'), findsOneWidget);
      expect(find.text('Confirmed!'), findsOneWidget);
      expect(find.text('Read your confirmation letter'), findsOneWidget);
    });
  });

  group('meetings', () {
    testWidgets('topic first, the person under it; the box toggles met; the agenda and Mark as met', (tester) async {
      final api = await _open(tester, _home('d1'));
      await tester.tap(find.byKey(const ValueKey('tile-meetings')));
      await tester.pumpAndSettle();
      expect(find.text('People to meet'), findsOneWidget);
      expect(find.text('Ritu Sharma · HR'), findsOneWidget);
      expect(find.text('COMING UP'), findsOneWidget);
      expect(find.text('Sunny Kapoor · Opens in Month 1'), findsOneWidget);
      expect(find.text('Your team'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('meeting-tick-team:hr_welcome')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('met:team:hr_welcome:true'));
      await tester.tap(find.byKey(const ValueKey('meeting-team:mgr_first_goals')));
      await tester.pumpAndSettle();
      expect(find.text('2 things to talk about'), findsOneWidget);
      expect(find.text('Only you can see your notes'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('meeting-mark-met')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('met:team:mgr_first_goals:true'));
      expect(find.byKey(const ValueKey('meeting-met')), findsOneWidget);
    });

    testWidgets('Your team: the department, Manager and Buddy, Say hi', (tester) async {
      await _open(tester, _home('d1'));
      await tester.tap(find.byKey(const ValueKey('tile-meetings')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('your-team')));
      await tester.pumpAndSettle();
      expect(find.text('Operations'), findsOneWidget);
      expect(find.text('3 people'), findsOneWidget);
      expect(find.text('Manager'), findsOneWidget);
      expect(find.text('Buddy'), findsOneWidget);
    });
  });

  group('tasks', () {
    testWidgets('each row ends in its verb; Review asks Looks good', (tester) async {
      final api = await _open(tester, _home('d1'));
      await tester.tap(find.byKey(const ValueKey('tile-tasks')));
      await tester.pumpAndSettle();
      expect(find.text('Tasks for you'), findsOneWidget);
      expect(find.text('Sign'), findsOneWidget);
      expect(find.text('0 of 3 done'), findsOneWidget);
      expect(find.text('COMING UP'), findsOneWidget);
      expect(find.text('Review'), findsOneWidget);
      expect(find.text('Open'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('task-t-kpi')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('task-confirm-t-kpi')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('task:t-kpi:looks_good'));
    });
  });

  group('forms', () {
    Future<FakeJoinerApi> openForm(WidgetTester tester, {Map<String, dynamic>? sent}) async {
      final api = FakeJoinerApi(_home('d1'));
      if (sent != null) api.form = {...api.form, ...sent};
      final c = JoinerController(shell: shellFor(FakeOnboardingApi(), DateTime(2026, 12, 1)), api: api);
      addTearDown(c.dispose);
      await pumpPage(tester, JoinerFormScreen(c: c, taskId: 't-kit', title: 'Your welcome kit'));
      return api;
    }

    testWidgets('one renderer: every question with its answer, Submit, then read-only', (tester) async {
      final api = await openForm(tester);
      for (final q in ['Your name on the ID card', 'Anything we should know', 'T-shirt size', 'Date of birth', 'A photo for the ID card']) {
        expect(find.text(q), findsOneWidget);
      }
      for (final o in ['S', 'M', 'L']) {
        expect(find.text(o), findsOneWidget);
      }
      await tester.enterText(find.byKey(const ValueKey('form-in-q1')), 'Priya Shah');
      await tester.tap(find.byKey(const ValueKey('form-in-q3-1')));
      await tester.pump();
      await tester.ensureVisible(find.byKey(const ValueKey('form-submit')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('form-submit')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('form:t-kit:q1=Priya Shah,q2=null,q3=M,q4=null,q5=null'));
      expect(find.byKey(const ValueKey('form-submit')), findsNothing);
      expect(find.byType(TextField), findsNothing);
      expect(tester.widget<Text>(find.byKey(const ValueKey('form-a-q1'))).data, 'Priya Shah');
      expect(tester.widget<Text>(find.byKey(const ValueKey('form-a-q3'))).data, 'M');
      expect(tester.widget<Text>(find.byKey(const ValueKey('form-a-q2'))).data, '—');
    });

    testWidgets('a sent form shows its date and file answers read-only', (tester) async {
      await openForm(tester, sent: {
        'answers': [
          {'questionId': 'q4', 'value': '1999-04-02'},
          {'questionId': 'q5', 'value': 'f9'},
        ],
        'sentAt': '2026-12-01T06:00:00.000Z',
        'files': {'f9': 'me.png'},
      });
      expect(find.text('2 Apr 1999'), findsOneWidget);
      expect(find.text('me.png'), findsOneWidget);
      expect(find.byKey(const ValueKey('form-submit')), findsNothing);
    });

    test('a form task opens the form (opens.form)', () {
      final d = JoinerOnboarding.fromJson(_home('d1', extra: {
        'tasks': [_task('t-kit', 'Your welcome kit', 'form', 'Start', 'd1', opens: {'form': true})],
      }));
      expect(d.tasks.single.form, isTrue);
      expect(d.tasks.single.type, 'form');
    });
  });

  group('check-ins', () {
    testWidgets('one question a screen: a rating and yes/no move on, a long answer has Next and Skip; thanks', (tester) async {
      final api = await _open(tester, _home('w1', punched: true));
      await scrollTo(tester, find.byKey(const ValueKey('tile-checkins')));
      expect(find.text('Week 1 check-in · about a minute'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('tile-checkins')));
      await tester.pumpAndSettle();
      expect(find.text('Your check-ins'), findsOneWidget);
      expect(find.text('3 questions · about a minute'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('checkin-ci-w1')));
      await tester.pumpAndSettle();
      expect(find.text('1 of 3'), findsOneWidget);
      expect(find.text('Not at all'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('rate-4')));
      await tester.pumpAndSettle();
      expect(find.text('2 of 3'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('answer-yes')));
      await tester.pumpAndSettle();
      expect(find.text('3 of 3'), findsOneWidget);
      expect(find.text('Send'), findsOneWidget);
      expect(find.text('Skip'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('checkin-skip')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('checkin:ci-w1:q1=4,q2=yes,q3=null'));
      expect(find.text('Thanks, Priya'), findsOneWidget);
      expect(find.text('Your answers are with HR and your manager.'), findsOneWidget);
    });
  });

  group('goals', () {
    testWidgets('How’s it going, a note, the next talk, earlier months collapsed', (tester) async {
      final api = FakeJoinerApi(_home('m3', punched: true, extra: {
        'goals': {'month': 3, 'count': 2, 'nextTalk': {'on': '2027-02-01', 'inDays': 9}},
      }));
      await pumpPage(tester, JoinerHomeScreen(shell: shellFor(FakeOnboardingApi(), DateTime(2027, 1, 23)), api: api));
      await tester.tap(find.byKey(const ValueKey('goals-card')));
      await tester.pumpAndSettle();
      expect(find.text('This month'), findsOneWidget);
      expect(find.text('2 goals'), findsOneWidget);
      expect(find.text('How’s it going?'), findsNWidgets(2));
      expect(find.text('Handled four this month.'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('goal-1-progress')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('goal:3:1:progress:'));
      await tester.tap(find.byKey(const ValueKey('goal-1-note-button')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('goal-1-note')), 'Two sessions so far');
      await tester.tap(find.byKey(const ValueKey('goal-1-note-button')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('goal:3:1::Two sessions so far'));
      await scrollTo(tester, find.byKey(const ValueKey('earlier-2')));
      expect(find.text('Next talk with Sunny'), findsOneWidget);
      expect(find.text('In 9 days · 1 Feb'), findsOneWidget);
      expect(find.text('You made this queue your own.'), findsNothing);
      await tester.tap(find.byKey(const ValueKey('earlier-2')));
      await tester.pumpAndSettle();
      expect(find.text('You made this queue your own.'), findsOneWidget);
    });
  });

  group('watch list, devices, profile', () {
    testWidgets('About the company with its videos, and Trainings with Read', (tester) async {
      await _open(tester, _home('w1', punched: true));
      await scrollTo(tester, find.byKey(const ValueKey('tile-watch')));
      await tester.tap(find.byKey(const ValueKey('tile-watch')));
      await tester.pumpAndSettle();
      expect(find.text('About Sowaka Test'), findsOneWidget);
      expect(find.text('Trainings'), findsOneWidget);
      expect(find.text('5 min read'), findsOneWidget);
      expect(find.text('Read'), findsOneWidget);
    });

    testWidgets('Devices: Ready or Setting up; Profile: the sections', (tester) async {
      await _open(tester, _home('d1'));
      await scrollTo(tester, find.byKey(const ValueKey('tile-devices')));
      await tester.tap(find.byKey(const ValueKey('tile-devices')));
      await tester.pumpAndSettle();
      expect(find.text('Your devices and accesses'), findsOneWidget);
      expect(find.text('Ready'), findsOneWidget);
      expect(find.text('Setting up'), findsOneWidget);
      Navigator.of(tester.element(find.text('Your devices and accesses'))).pop();
      await tester.pumpAndSettle();
      await scrollTo(tester, find.byKey(const ValueKey('tile-profile')));
      await tester.tap(find.byKey(const ValueKey('tile-profile')));
      await tester.pumpAndSettle();
      expect(find.text('Personal details'), findsOneWidget);
      expect(find.text('To do'), findsOneWidget);
      expect(find.text('29%'), findsOneWidget);
    });
  });

  group('app build 90: profile once, payroll details, KPIs', () {
    Future<FakeJoinerApi> pumpWith(WidgetTester tester, Widget Function(JoinerController c) page) async {
      final api = FakeJoinerApi(_home('w1'));
      final c = JoinerController(shell: shellFor(FakeOnboardingApi(), DateTime(2026, 12, 1)), api: api);
      addTearDown(c.dispose);
      await pumpPage(tester, page(c));
      return api;
    }

    testWidgets('a section filled before joining reads only; one HR approved says so', (tester) async {
      await pumpWith(tester, (c) => JoinerProfileSectionScreen(c: c, section: 'personal', title: 'Personal details'));
      expect(find.text('Filled in before you joined. To change anything, ask HR.'), findsOneWidget);
      expect(find.text('Priya Shah'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets('HR approved: Approved by HR, read-only', (tester) async {
      await pumpWith(tester, (c) => JoinerProfileSectionScreen(c: c, section: 'contact', title: 'Contact and address'));
      expect(find.text('Approved by HR'), findsOneWidget);
      expect(find.text('Same as current'), findsOneWidget);
      expect(find.byKey(const ValueKey('profile-save')), findsNothing);
    });

    testWidgets('an empty section is filled once, then reads only', (tester) async {
      final api = await pumpWith(tester, (c) => JoinerProfileSectionScreen(c: c, section: 'emergency', title: 'Emergency contact'));
      expect(find.byKey(const ValueKey('profile-once')), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('in-ecName')), 'Asha Shah');
      await tester.tap(find.byKey(const ValueKey('relation-Parent')));
      await tester.enterText(find.byKey(const ValueKey('in-ecPhone')), '9876500003');
      await tester.ensureVisible(find.byKey(const ValueKey('profile-save')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('profile-save')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('profile:emergency:Asha Shah:Parent:9876500003'));
      expect(find.text('Saved. To change anything, ask HR.'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets('payroll: prefilled, shares must make 100, Send to HR, then with HR', (tester) async {
      final api = await pumpWith(tester, (c) => JoinerPayrollScreen(c: c));
      expect(tester.widget<TextField>(find.byKey(const ValueKey('pay-holder'))).controller!.text, 'Priya Shah');
      expect(tester.widget<TextField>(find.byKey(const ValueKey('pay-uan'))).controller!.text, '100200300400');
      expect(find.text('Leave blank to keep the one ending 9012'), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('nominee-0-name')), 'Asha Shah');
      await tester.ensureVisible(find.byKey(const ValueKey('nominee-0-relation-Mother')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('nominee-0-relation-Mother')));
      await tester.enterText(find.byKey(const ValueKey('nominee-0-share')), '60');
      await tester.pump();
      expect(find.text('Shares: 60% of 100%'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.descendant(of: find.byKey(const ValueKey('payroll-send')), matching: find.byType(FilledButton))).onPressed, isNull);
      await tester.ensureVisible(find.byKey(const ValueKey('nominee-add')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('nominee-add')));
      await tester.pump();
      await tester.enterText(find.byKey(const ValueKey('nominee-1-name')), 'Ravi Shah');
      await tester.ensureVisible(find.byKey(const ValueKey('nominee-1-relation-Father')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('nominee-1-relation-Father')));
      await tester.enterText(find.byKey(const ValueKey('nominee-1-share')), '40');
      await tester.pump();
      expect(find.text('Shares: 100% of 100%'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const ValueKey('payroll-send')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('payroll-send')));
      await tester.pumpAndSettle();
      expect((api.payrollSent!['nominees'] as List).length, 2);
      expect((api.payrollSent!['bank'] as Map)['accountNumber'], '');
      expect(find.byKey(const ValueKey('payroll-pending')), findsOneWidget);
      await scrollTo(tester, find.text('Ravi Shah · Father · 40%'));
      expect(find.text('Ravi Shah · Father · 40%'), findsOneWidget);
    });

    testWidgets('the payroll task opens the payroll details form', (tester) async {
      final api = FakeJoinerApi(_home('w1', extra: {
        'tasks': [_task('t-pay', 'Complete your payroll details', 'do', 'Start', 'w1', meta: 'Bank account, PF and nominees', opens: {'screen': 'payroll'})],
      }));
      await pumpPage(tester, JoinerHomeScreen(shell: shellFor(FakeOnboardingApi(), DateTime(2026, 12, 1)), api: api));
      await tester.tap(find.byKey(const ValueKey('tile-tasks')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('task-t-pay')));
      await tester.pumpAndSettle();
      expect(find.byType(JoinerPayrollScreen), findsOneWidget);
    });

    testWidgets('Review your KPIs offers its page (the Grow tab) before Looks good', (tester) async {
      final opened = <String>[];
      final api = FakeJoinerApi(_home('w1'));
      final base = shellFor(FakeOnboardingApi(), DateTime(2026, 12, 1));
      final shell = OnboardingShell(
        api: base.api,
        profileAction: const SizedBox(width: 30, height: 30),
        onNotifications: () {},
        openAppScreen: (context, screen) async => opened.add(screen),
        viewerName: 'Kabir Mehta',
        now: () => DateTime(2026, 12, 1),
      );
      await pumpPage(tester, JoinerHomeScreen(shell: shell, api: api));
      await tester.tap(find.byKey(const ValueKey('tile-tasks')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('task-t-kpi')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('task-page-t-kpi')));
      await tester.pumpAndSettle();
      expect(opened, ['kpis']);
    });
  });

  group('the joining portal in the app (kept as it is)', () {
    testWidgets('Onboarding opens the portal page while the portal is open, the joiner home after', (tester) async {
      final api = FakeOnboardingApi();
      final shell = shellFor(api, DateTime(2026, 12, 2));
      OnboardingShell maker() => shell;
      registerOnboardingShell(maker);
      addTearDown(() => unregisterOnboardingShell(maker));
      addTearDown(LifecycleMeStore.instance.clear);
      PortalPage.debugSurfaceFactory = ({required onMessage, required stays, required onLoaded}) => FakePortalSurface(onMessage, stays, onLoaded);
      addTearDown(() => PortalPage.debugSurfaceFactory = null);
      late BuildContext context;
      await pumpPage(tester, Builder(builder: (c) {
        context = c;
        return const Scaffold(body: Text('shell'));
      }));
      LifecycleMeStore.instance.value = LifecycleMe.fromJson({
        'enabled': true,
        'onboarding': {'journeyId': 'j1', 'tileVisible': true, 'portal': true},
      });
      unawaited(openOnboardingHome(context));
      await tester.pumpAndSettle();
      expect(find.byType(PortalPageScreen), findsOneWidget);
      expect(find.byType(JoinerHomeScreen), findsNothing);
      Navigator.of(context).pop();
      await tester.pumpAndSettle();
      LifecycleMeStore.instance.value = LifecycleMe.fromJson({
        'enabled': true,
        'onboarding': {'journeyId': 'j1', 'tileVisible': true, 'portal': false},
      });
      unawaited(openOnboardingHome(context));
      await tester.pumpAndSettle();
      expect(find.byType(JoinerHomeScreen), findsOneWidget);
      expect(find.byType(PortalPageScreen), findsNothing);
    });

    testWidgets('with an Action tab in the bar, Onboarding goes to that tab (the portal), nothing pushed', (tester) async {
      final picked = <ManagerTab>[];
      final shell = OnboardingShell(
        api: FakeOnboardingApi(),
        profileAction: const SizedBox(width: 30, height: 30),
        onNotifications: () {},
        tabs: const [ManagerTab.connect, ManagerTab.quick],
        selectedTab: ManagerTab.connect,
        onSelectTab: picked.add,
      );
      addTearDown(LifecycleMeStore.instance.clear);
      late BuildContext context;
      await pumpPage(tester, Builder(builder: (c) {
        context = c;
        return const Scaffold(body: Text('shell'));
      }));
      LifecycleMeStore.instance.value = LifecycleMe.fromJson({
        'enabled': true,
        'onboarding': {'journeyId': 'j1', 'stage': 'pre_boarding', 'tileVisible': false, 'portal': true},
      });
      await openOnboardingHome(context, shell: shell);
      await tester.pumpAndSettle();
      expect(picked, [ManagerTab.quick]);
      expect(find.byType(PortalPageScreen), findsNothing);
      expect(find.byType(JoinerHomeScreen), findsNothing);
    });

    testWidgets('a joiner’s push opens the joiner home; offboarding’s kinds pass through', (tester) async {
      final api = FakeOnboardingApi();
      OnboardingShell maker() => shellFor(api, DateTime(2026, 12, 2));
      registerOnboardingShell(maker);
      addTearDown(() => unregisterOnboardingShell(maker));
      late BuildContext context;
      await pumpPage(tester, Builder(builder: (c) {
        context = c;
        return const Scaffold(body: Text('shell'));
      }));
      expect(openOnboardingDestination(context, {'destination': 'lifecycle_resignation'}), isFalse);
      expect(openOnboardingDestination(context, {'destination': 'lifecycle_survey'}), isTrue);
      await tester.pumpAndSettle();
      expect(find.byType(JoinerHomeScreen), findsOneWidget);
    });
  });
}
