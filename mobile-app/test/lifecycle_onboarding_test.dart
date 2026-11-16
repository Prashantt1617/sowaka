// The app's onboarding (employee lifecycle, docs/lifecycle/CONTRACT.md "App —
// joiner and manager"): the rules the screens apply (the day label, what is
// up next and the list order, where the week-1 reels resume, when the
// probation goals lock) and the key screens over a fake API — the home, the
// reels, the survey, a meeting's "Did you meet?", the manager's set-up with
// its goal lock, the Team tab's New joiners and the profile's card.
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/joiner_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/joiner_setup_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/new_joiners_section.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/meeting_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_home_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_kit.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/plant.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/probation_screens.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/profile_onboarding_card.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/survey_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/week1_reels_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/onboarding_launcher.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/notes_screen.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart' show ProfileTab, ownProfileTabs;
import 'package:shared_preferences/shared_preferences.dart';

/// Tj in the canvas's demo: Mon 1 Dec 2026.
final tj = DateTime(2026, 12, 1);

Map<String, dynamic> task(
  String id,
  String title, {
  String? systemKey,
  String status = 'todo',
  String ownerRole = 'employee',
  String kind = 'ack',
  bool mustDo = false,
  DateTime? dueAt,
  DateTime? opensAt,
  DateTime? doneAt,
  Map<String, dynamic>? meeting,
}) => {
  'id': id,
  'title': title,
  'systemKey': ?systemKey,
  'phase': 'first_week',
  'ownerRole': ownerRole,
  'kind': kind,
  'surface': 'app',
  'mustDo': mustDo,
  'status': status,
  'late': false,
  if (dueAt != null) 'dueAt': dueAt.toIso8601String(),
  if (opensAt != null) 'opensAt': opensAt.toIso8601String(),
  if (doneAt != null) 'doneAt': doneAt.toIso8601String(),
  'meeting': ?meeting,
};

TaskView view(Map<String, dynamic> json) => TaskView.fromJson(json);

class FakeOnboardingApi implements OnboardingApi {
  OnboardingHome home = OnboardingHome.fromJson({'journeyId': 'j1', 'tj': '2026-12-01', 'stage': 'welcome_week1'});
  Week1Data week1 = const Week1Data();
  SurveyState survey = const SurveyState(kind: 'day7', open: true);
  Meeting? meeting;
  JoinerDetail? joiner;
  List<JoinerSummary> joiners = const [];
  List<DirectoryPerson> directory = const [];
  LifecycleMe me = LifecycleMe.off;

  final calls = <String>[];
  final week1Saves = <(Week1Step, Object)>[];
  SurveyAnswers? sentAnswers;
  Map<String, Object?>? savedSetup;

  @override
  String? get viewerId => 'me';

  @override
  Future<LifecycleMe> fetchMe() async => me;

  @override
  Future<OnboardingHome> fetchHome() async => home;

  @override
  Future<TaskView?> taskAction(String taskId, String action, {String? note}) async {
    calls.add('task:$taskId:$action');
    return null;
  }

  @override
  Future<Week1Data> fetchWeek1() async => week1;

  @override
  Future<Week1Data?> saveWeek1(Week1Step step, Object value) async {
    week1Saves.add((step, value));
    final now = DateTime(2026, 12, 2);
    week1 = Week1Data(
      policies: week1.policies,
      policiesAckAt: step == Week1Step.policies ? now : week1.policiesAckAt,
      taxRegime: step == Week1Step.tax ? value as String : week1.taxRegime,
      bankPfConfirmedAt: step == Week1Step.bankPf ? now : week1.bankPfConfirmedAt,
      goalsReadAt: step == Week1Step.goals ? now : week1.goalsReadAt,
      goals: week1.goals,
      bankMasked: week1.bankMasked,
    );
    return week1;
  }

  @override
  Future<IntroPost> fetchIntro() async => const IntroPost();
  @override
  Future<IntroPost> saveIntro(IntroPost intro) async => intro;
  @override
  Future<IntroPost> postIntro() async => const IntroPost();
  @override
  Future<List<PersonToMeet>> fetchPeople() async => const [];
  @override
  Future<List<PersonToMeet>?> markPerson(String id, String action) async => null;
  @override
  Future<List<StarterTask>> fetchStarterTasks() async => const [];
  @override
  Future<StarterTask?> markStarterTaskDone(String id, {String? note}) async => null;
  @override
  Future<List<OneOnOneNote>> fetchNotes() async => const [];
  @override
  Future<OneOnOneNote?> noteAction(String id, String action, {String? text}) async => null;

  @override
  Future<Meeting> fetchMeeting(String id) async => meeting!;

  @override
  Future<Meeting?> answerMeeting(String id, String met, {DateTime? newTime}) async {
    calls.add('meeting:$id:$met');
    final m = meeting!;
    meeting = Meeting(
      id: m.id,
      title: m.title,
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      place: m.place,
      attendees: m.attendees,
      met: met,
      newTime: newTime,
      systemKey: m.systemKey,
    );
    return meeting;
  }

  @override
  Future<SurveyState> fetchSurvey() async => survey;

  @override
  Future<void> sendSurvey(SurveyAnswers answers) async => sentAnswers = answers;

  @override
  Future<ProbationView> fetchProbation() async => const ProbationView();
  @override
  Future<void> saveCheckin(int month, String text, {int? rating}) async => calls.add('checkin:$month:$rating');
  @override
  Future<RevealView> fetchReveal() async => const RevealView();
  @override
  Future<void> revealSeen() async => calls.add('reveal-seen');
  @override
  Future<Uint8List> download(String url) async => Uint8List(0);

  @override
  Future<List<JoinerSummary>> fetchJoiners() async => joiners;

  @override
  Future<JoinerDetail> fetchJoiner(String journeyId) async => joiner!;

  @override
  Future<void> saveSetup(
    String journeyId, {
    List<SetupPerson>? people,
    String? buddyUserId,
    String? welcomeNote,
    List<String>? goals,
  }) async {
    savedSetup = {
      'people': people?.map((p) => p.userId).toList(),
      'buddyUserId': buddyUserId,
      'welcomeNote': welcomeNote,
      'goals': goals,
    };
  }

  @override
  Future<void> assignStarterTask(String journeyId, {required String title, List<String> links = const [], String? note, DateTime? dueAt}) async =>
      calls.add('assign:$title:${dueAt == null ? '' : lifecycleYmd(dueAt)}');
  @override
  Future<void> replyStarterTask(String id, String text) async => calls.add('reply:$id');
  @override
  Future<void> addNote(String journeyId, String text, {required bool shared}) async => calls.add('note:$shared');
  @override
  Future<void> managerTaskDone(String journeyId, String taskId) async => calls.add('mgr-done:$taskId');
  @override
  Future<void> saveProbationMonth(String journeyId, int month, {List<String>? goals, CheckinEntry? checkin, String? review}) async =>
      calls.add('month:$month');
  @override
  Future<List<DirectoryPerson>> fetchDirectory() async => directory;
}

OnboardingShell shellFor(FakeOnboardingApi api, DateTime now, {String name = 'Kabir Mehta'}) => OnboardingShell(
  api: api,
  profileAction: const SizedBox(width: 30, height: 30),
  onNotifications: () {},
  viewerName: name,
  now: () => now,
);

/// [page] pushed over a plain root, so its own Back and Save pop to it, on
/// a 393 × 852 phone with reduce motion on.
Future<void> pumpPage(WidgetTester tester, Widget page) async {
  tester.view.physicalSize = const Size(393 * 3, 852 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final navigator = GlobalKey<NavigatorState>();
  await tester.pumpWidget(
    MaterialApp(
      navigatorKey: navigator,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(disableAnimations: true),
        child: child!,
      ),
      home: const Scaffold(body: Text('root')),
    ),
  );
  navigator.currentState!.push(MaterialPageRoute<void>(builder: (_) => page));
  await tester.pumpAndSettle();
}

/// Scrolls the page's list until [finder] is built and on screen.
Future<void> scrollTo(WidgetTester tester, Finder finder) => tester.scrollUntilVisible(
  finder,
  200,
  scrollable: find.byType(Scrollable).first,
);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('day label', () {
    String label(DateTime today) => onboardingDayLabel(tj: tj, today: today);

    test('Day 1 on the joining day only, then Week 1, Week 2 … until month 1 ends', () {
      expect(label(DateTime(2026, 12, 1, 9)), 'Day 1');
      expect(label(DateTime(2026, 12, 2)), 'Week 1');
      expect(label(DateTime(2026, 12, 7, 23, 59)), 'Week 1');
      expect(label(DateTime(2026, 12, 8)), 'Week 2');
      expect(label(DateTime(2026, 12, 31)), 'Week 5');
    });

    test('Month 2, Month 3 … after month 1; never "Week 1 · Day 1 of 7"', () {
      expect(label(DateTime(2027, 1, 1)), 'Month 2');
      expect(label(DateTime(2027, 1, 31)), 'Month 2');
      expect(label(DateTime(2027, 2, 1)), 'Month 3');
      expect(label(DateTime(2027, 5, 15)), 'Month 6');
      for (var d = 0; d < 40; d++) {
        expect(label(tj.add(Duration(days: d))), isNot(contains('of 7')));
      }
    });

    test('before joining it counts down', () {
      expect(label(DateTime(2026, 11, 30)), 'Joins tomorrow');
      expect(label(DateTime(2026, 11, 24)), 'Joins in 7 days');
    });

    test('the week-1 bar fills a seventh a day', () {
      expect(week1Fill(tj: tj, today: tj), closeTo(1 / 7, 1e-9));
      expect(week1Fill(tj: tj, today: DateTime(2026, 12, 4)), closeTo(4 / 7, 1e-9));
      expect(week1Fill(tj: tj, today: DateTime(2026, 12, 20)), 1);
    });
  });

  group('up next and the list order', () {
    final now = DateTime(2026, 12, 1, 10, 0);
    final meetingAt = DateTime(2026, 12, 1, 11, 0);
    final teamAt = DateTime(2026, 12, 1, 16, 0);
    final face = view(task('face', 'Register your face', systemKey: 'register_face', dueAt: DateTime(2026, 12, 2)));
    final tour = view(task('tour', 'Take the Sowaka tour', systemKey: 'app_tour', dueAt: DateTime(2026, 12, 4)));
    final manager = view(task('mgr', 'Meet your manager', systemKey: 'meet_manager', kind: 'meeting', ownerRole: 'manager_employee', mustDo: true, meeting: {'id': 'm1', 'title': 'Meet your manager', 'startsAt': meetingAt.toIso8601String()}));
    final team = view(task('team', 'Meet your team', systemKey: 'meet_team', kind: 'meeting', mustDo: true, meeting: {'id': 'm2', 'title': 'Meet your team', 'startsAt': teamAt.toIso8601String()}));

    test('a timed item starting within two hours comes first', () {
      expect(pickUpNext([face, tour, team, manager], now)?.id, 'mgr');
    });

    test('otherwise must-do, then due soonest, then not started', () {
      // At 1 PM the manager's meeting is past its half hour; the team's is 3 h away.
      final afternoon = DateTime(2026, 12, 1, 13, 0);
      expect(pickUpNext([face, tour, team], afternoon)?.id, 'team');
      expect(pickUpNext([tour, face], afternoon)?.id, 'face');
      final sentBack = view(task('sb', 'Sent back', status: 'sent_back', dueAt: DateTime(2026, 12, 2)));
      expect(pickUpNext([sentBack, face], afternoon)?.id, 'face');
    });

    test('done, locked and other people\'s tasks are never up next', () {
      final done = view(task('d', 'Done', status: 'done', mustDo: true));
      final locked = view(task('l', 'Locked', status: 'locked', mustDo: true));
      final hr = view(task('hr', 'Welcome', ownerRole: 'hr', mustDo: true));
      expect(pickUpNext([done, locked, hr], now), isNull);
      expect(pickUpNext([done, locked, hr, tour], now)?.id, 'tour');
    });

    test('meetings in time order, then the untimed ones by must-do and due date', () {
      final order = orderTaskList([tour, team, face, manager]).map((t) => t.id).toList();
      expect(order, ['mgr', 'team', 'face', 'tour']);
    });
  });

  group('week-1 reels resume', () {
    test('at the first reel not yet saved', () {
      expect(firstUnfinishedWeek1Step(const Week1Data()), Week1Step.policies);
      expect(firstUnfinishedWeek1Step(Week1Data(policiesAckAt: tj)), Week1Step.tax);
      expect(firstUnfinishedWeek1Step(Week1Data(policiesAckAt: tj, taxRegime: 'new')), Week1Step.bankPf);
      expect(
        firstUnfinishedWeek1Step(Week1Data(policiesAckAt: tj, taxRegime: 'old', bankChangeRequested: true)),
        Week1Step.goals,
      );
      expect(
        firstUnfinishedWeek1Step(Week1Data(policiesAckAt: tj, taxRegime: 'new', bankPfConfirmedAt: tj, goalsReadAt: tj)),
        isNull,
      );
    });

    test('reads the server\'s week-1 shape: the policy list and the saved steps', () {
      final data = Week1Data.fromJson({
        'policies': [
          {'id': 'p1', 'title': 'Leave policy', 'version': '3'},
        ],
        'policiesAck': {'at': '2026-12-01T10:00:00Z'},
        'taxRegime': {'regime': 'new', 'at': '2026-12-01T10:00:00Z'},
        'bank': {'masked': '···· 4417', 'ifsc': 'HDFC0001234'},
        'pf': {'uan': '1000····2231'},
        'goals': ['Ship the leave request redesign'],
      });
      expect(data.policies.single.title, 'Leave policy');
      expect(data.resumeAt, Week1Step.bankPf);
      expect(data.bankMasked, '···· 4417');
      expect(data.goals, ['Ship the leave request redesign']);
    });

    testWidgets('open at the first unfinished reel; each Next saves and moves on', (tester) async {
      final api = FakeOnboardingApi()
        ..week1 = Week1Data(policiesAckAt: tj, bankMasked: '···· 4417', goals: const ['Own the design system docs']);
      await pumpPage(tester, Week1ReelsScreen(shell: shellFor(api, DateTime(2026, 12, 2))));

      expect(find.text('Choose your tax regime'), findsOneWidget);
      expect(find.text('TASK 2 OF 4 · 2 MIN'), findsOneWidget);
      // New is the default.
      await tester.tap(find.text('Confirm choice'));
      await tester.pumpAndSettle();
      expect(api.week1Saves.single, (Week1Step.tax, 'new'));
      expect(find.text('Check your bank and PF details'), findsOneWidget);
      expect(find.text('···· 4417'), findsOneWidget);

      await tester.tap(find.text('All correct'));
      await tester.pumpAndSettle();
      expect(find.text('Own the design system docs'), findsOneWidget);
      await tester.tap(find.text('Got it'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('week1-done')), findsOneWidget);
      expect(find.text('4/4'), findsOneWidget);
      expect(api.week1Saves.map((s) => s.$1), [Week1Step.tax, Week1Step.bankPf, Week1Step.goals]);
    });

    testWidgets('policies need the tick before Agree and continue', (tester) async {
      final api = FakeOnboardingApi()
        ..week1 = const Week1Data(policies: [PolicyItem(id: 'p1', title: 'Leave policy', version: '2')]);
      await pumpPage(tester, Week1ReelsScreen(shell: shellFor(api, DateTime(2026, 12, 2))));
      await tester.tap(find.text('Agree and continue'));
      await tester.pumpAndSettle();
      expect(api.week1Saves, isEmpty);
      await tester.tap(find.byKey(const ValueKey('policies-agree')));
      await tester.pump();
      await tester.tap(find.text('Agree and continue'));
      await tester.pumpAndSettle();
      expect(api.week1Saves.single.$1, Week1Step.policies);
      expect((api.week1Saves.single.$2 as Map)['versions'], [
        {'id': 'p1', 'version': '2'},
      ]);
      expect(find.text('Choose your tax regime'), findsOneWidget);
    });
  });

  group('probation goals lock', () {
    test('editable until Tj + 7, locked after; the server\'s flag wins', () {
      expect(probationGoalsLocked(tj: tj, now: DateTime(2026, 12, 8, 20)), isFalse);
      expect(probationGoalsLocked(tj: tj, now: DateTime(2026, 12, 9)), isTrue);
      expect(probationGoalsLocked(tj: tj, now: DateTime(2026, 12, 3), lockedFlag: true), isTrue);
      expect(probationGoalsLocked(tj: tj, now: DateTime(2027, 1, 3), lockedFlag: false), isFalse);
      expect(probationGoalsLocked(now: DateTime(2027, 1, 3)), isFalse);
    });

    JoinerDetail detailWith() => JoinerDetail.fromJson({
      'joiner': {'journeyId': 'j1', 'name': 'Kabir Mehta', 'userId': 'kabir', 'tj': '2026-12-01', 'stage': 'welcome_week1'},
      'tasks': [],
      'setup': {
        'people': [
          {'userId': 'priya', 'name': 'Priya S.', 'why': 'Your buddy'},
        ],
        'goals': ['Ship the leave request redesign'],
      },
    });

    testWidgets('before the lock the goals are fields and are saved', (tester) async {
      final api = FakeOnboardingApi()..directory = const [DirectoryPerson(userId: 'arjun', name: 'Arjun M.')];
      final detail = detailWith();
      await pumpPage(tester, JoinerSetupScreen(shell: shellFor(api, DateTime(2026, 12, 3)), journeyId: 'j1', detail: detail));
      expect(find.text('1 of 6'), findsOneWidget);
      await scrollTo(tester, find.byKey(const ValueKey('setup-goal-0')));
      expect(find.byKey(const ValueKey('setup-goal-0')), findsOneWidget);
      expect(find.text('Locked'), findsNothing);
      await tester.enterText(find.byKey(const ValueKey('setup-goal-0')), 'Ship the redesign');
      await tester.tap(find.byKey(const ValueKey('setup-save')));
      await tester.pumpAndSettle();
      expect(api.savedSetup!['goals'], ['Ship the redesign']);
      expect(api.savedSetup!['people'], ['priya']);
    });

    testWidgets('after Tj + 7 the goals read-only, never sent', (tester) async {
      final api = FakeOnboardingApi();
      await pumpPage(tester, JoinerSetupScreen(shell: shellFor(api, DateTime(2026, 12, 12)), journeyId: 'j1', detail: detailWith()));
      await scrollTo(tester, find.byKey(const ValueKey('setup-goals-note')));
      expect(find.byKey(const ValueKey('setup-goal-0')), findsNothing);
      expect(find.text('Locked'), findsOneWidget);
      expect(find.text('1. Ship the leave request redesign'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('setup-save')));
      await tester.pumpAndSettle();
      expect(api.savedSetup!.containsKey('goals'), isTrue);
      expect(api.savedSetup!['goals'], isNull);
    });
  });

  group('onboarding home', () {
    final now = DateTime(2026, 12, 1, 10, 35);
    OnboardingHome dayOne() => OnboardingHome.fromJson({
      'journeyId': 'j1',
      'stage': 'welcome_week1',
      'tj': '2026-12-01',
      'plant': {'stage': 1},
      'upNext': task('mgr', 'Meet your manager', systemKey: 'meet_manager', kind: 'meeting', mustDo: true, ownerRole: 'manager_employee', meeting: {
        'id': 'm1',
        'title': 'Meet your manager',
        'startsAt': DateTime(2026, 12, 1, 11).toIso8601String(),
        'place': 'Room 4B',
        'attendees': [
          {'userId': 'neha', 'name': 'Neha R.'},
        ],
      }),
      'today': [
        task('mgr', 'Meet your manager', systemKey: 'meet_manager', kind: 'meeting', mustDo: true),
        task('team', 'Meet your team', systemKey: 'meet_team', kind: 'meeting', mustDo: true, dueAt: DateTime(2026, 12, 1, 16)),
        task('face', 'Register your face', systemKey: 'register_face'),
        task('tour', 'Take the Sowaka tour', systemKey: 'app_tour'),
      ],
      'later': [
        task('survey', 'Your first-week survey', systemKey: 'day7_survey', status: 'locked', opensAt: DateTime(2026, 12, 7)),
      ],
      'done': [
        task('welcome', 'Welcome and induction', status: 'done', ownerRole: 'hr', doneAt: DateTime(2026, 12, 1, 10, 15)),
        task('laptop', 'Laptop and login', status: 'done', ownerRole: 'it', doneAt: DateTime(2026, 12, 1, 10, 40)),
      ],
      'journey': [
        {'key': 'pre_boarding', 'label': 'Pre-boarding', 'state': 'done'},
        {'key': 'welcome_week1', 'label': 'Week 1', 'state': 'current'},
        {'key': 'settling_in', 'label': 'Month 1', 'state': 'todo'},
        {'key': 'growing_gains', 'label': 'Months 2–5', 'state': 'todo'},
        {'key': 'final_month', 'label': 'Final month', 'state': 'todo'},
        {'key': 'confirmed', 'label': 'Confirmed', 'state': 'todo'},
      ],
    });

    testWidgets('Day 1: you are here, up next, today\'s list, done folded away', (tester) async {
      final api = FakeOnboardingApi()..home = dayOne();
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, now)));

      expect(find.byKey(const ValueKey('day-label')), findsOneWidget);
      expect(find.text('Day 1'), findsOneWidget);
      expect(find.text('Welcome stage'), findsOneWidget);
      expect(find.text('Today'), findsOneWidget);
      // Up next, with its time and place; not repeated in the list.
      final upNext = find.byKey(const ValueKey('up-next'));
      expect(find.descendant(of: upNext, matching: find.text('Meet your manager')), findsOneWidget);
      expect(find.descendant(of: upNext, matching: find.textContaining('11:00 AM · Room 4B · with Neha R.')), findsOneWidget);
      expect(find.byKey(const ValueKey('task-mgr')), findsNothing);
      // The list: the 4 PM meeting first, then the untimed ones as "Any time".
      final team = tester.getTopLeft(find.byKey(const ValueKey('task-team'))).dy;
      final face = tester.getTopLeft(find.byKey(const ValueKey('task-face'))).dy;
      expect(team, lessThan(face));
      expect(find.text('MUST-DO'), findsWidgets);
      expect(find.textContaining('Any time'), findsWidgets);
      // Two done, closed; View opens them, Hide closes.
      expect(find.text('2 done'), findsOneWidget);
      expect(find.text('View'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('done-toggle')));
      await tester.pumpAndSettle();
      expect(find.text('Hide'), findsOneWidget);
      expect(find.text('Done 10:15 AM'), findsOneWidget);
      // Later, the locked survey says when it opens.
      await scrollTo(tester, find.textContaining('Opens Mon 7 Dec'));
      expect(find.textContaining('Opens Mon 7 Dec'), findsOneWidget);
    });

    testWidgets('Journey opens the six-stage bar in the card', (tester) async {
      final api = FakeOnboardingApi()..home = dayOne();
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, now)));
      expect(find.byType(JourneyBar), findsNothing);
      await tester.tap(find.byKey(const ValueKey('journey-toggle')));
      await tester.pumpAndSettle();
      expect(find.byType(JourneyBar), findsOneWidget);
      expect(find.text('Next stage: Settling in'), findsOneWidget);
      expect(
        find.bySemanticsLabel(RegExp('Journey: pre-boarding done, now in week 1 \\(Day 1\\)')),
        findsOneWidget,
      );
    });

    testWidgets('the profile card: day and stage, to do, next, progress, Continue', (tester) async {
      final api = FakeOnboardingApi()..home = dayOne();
      await pumpPage(tester, Scaffold(body: Padding(padding: const EdgeInsets.all(16), child: OnboardingProfileCard(shell: shellFor(api, now)))));
      expect(find.text('DAY 1 · WELCOME STAGE'), findsOneWidget);
      expect(find.text('4 to do'), findsOneWidget);
      expect(find.text('Next: meet your manager at 11:00 AM'), findsOneWidget);
      expect(find.text('2 of 6'), findsOneWidget);
      expect(find.byType(Plant), findsOneWidget);
      expect(find.byKey(const ValueKey('profile-onboarding-continue')), findsOneWidget);
    });
  });

  group('Day-7 survey', () {
    testWidgets('four questions, each answered before Next; Send sends them; thanks', (tester) async {
      final api = FakeOnboardingApi();
      await pumpPage(tester, SurveyScreen(shell: shellFor(api, DateTime(2026, 12, 7))));
      expect(find.text('Your first week'), findsOneWidget);
      expect(find.text('QUESTION 1 OF 4'), findsOneWidget);
      FilledButton next() => tester.widget<FilledButton>(
        find.descendant(of: find.byKey(const ValueKey('survey-next')), matching: find.byType(FilledButton)),
      );
      expect(next().onPressed, isNull);
      await tester.tap(find.byKey(const ValueKey('scale-4')));
      await tester.pump();
      expect(next().onPressed, isNotNull);
      await tester.tap(find.byKey(const ValueKey('survey-next')));
      await tester.pumpAndSettle();

      expect(find.text('Did you have what you needed on Day 1?'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('choice-mostly')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('survey-next')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('scale-5')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('survey-next')));
      await tester.pumpAndSettle();

      expect(find.text('Send answers'), findsOneWidget);
      // The last one is optional.
      await tester.tap(find.byKey(const ValueKey('survey-next')));
      await tester.pumpAndSettle();
      expect(api.sentAnswers!.toJson(), {'q1': 4, 'q2': 'mostly', 'q3': 5, 'q4': null});
      expect(find.text('Thanks, Kabir'), findsOneWidget);
      expect(find.textContaining('never your name'), findsOneWidget);
    });

    testWidgets('the M3 pulse is the same survey under its own title; closed says when it opens', (tester) async {
      final api = FakeOnboardingApi()..survey = SurveyState(kind: 'm3', open: false, opensAt: DateTime(2027, 2, 26));
      await pumpPage(tester, SurveyScreen(shell: shellFor(api, DateTime(2027, 2, 1))));
      expect(find.text('Your first 3 months'), findsOneWidget);
      expect(find.textContaining('opens Fri 26 Feb'), findsOneWidget);
    });
  });

  FakeOnboardingApi meetingApi() => FakeOnboardingApi()
    ..meeting = Meeting(
        id: 'm1',
        title: 'Meet your manager',
        startsAt: DateTime(2026, 12, 1, 11),
        endsAt: DateTime(2026, 12, 1, 11, 30),
        place: 'Room 4B, Floor 4',
        attendees: const [MeetingPerson(userId: 'neha', name: 'Neha R.', designation: 'Design lead', role: 'your manager')],
        systemKey: 'meet_manager',
      );

  testWidgets('before a meeting: when, where, who, what to expect, Add to calendar', (tester) async {
    final api = meetingApi();
    await pumpPage(tester, MeetingScreen(shell: shellFor(api, DateTime(2026, 12, 1, 10, 35)), meetingId: 'm1'));
    expect(find.text('TODAY · IN 25 MIN'), findsOneWidget);
    expect(find.text('11:00 AM – 11:30 AM'), findsOneWidget);
    expect(find.text('Neha R.'), findsOneWidget);
    expect(find.text('Bring any questions, nothing to prepare'), findsOneWidget);
    expect(find.text('Add to calendar'), findsOneWidget);
    expect(find.byKey(const ValueKey('did-you-meet')), findsNothing);
  });

  testWidgets('once its time has come it asks "Did you meet?"; Yes ticks it', (tester) async {
    final api = meetingApi();
    await pumpPage(tester, MeetingScreen(shell: shellFor(api, DateTime(2026, 12, 1, 11, 40)), meetingId: 'm1'));
    expect(find.text('Did you meet Neha?'), findsOneWidget);
    expect(find.text('Add to calendar'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('meeting-yes')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('meeting:m1:yes'));
    expect(find.byKey(const ValueKey('meeting-done')), findsOneWidget);
  });

  group('manager', () {
    test('joiners most urgent first', () {
      final sorted = sortJoinersByUrgency([
        const JoinerSummary(journeyId: 'a', name: 'Riya'),
        const JoinerSummary(journeyId: 'b', name: 'Kabir', todayCount: 4),
        const JoinerSummary(journeyId: 'c', name: 'Dev', overdue: 1),
      ]);
      expect(sorted.map((j) => j.journeyId), ['c', 'b', 'a']);
    });

    test('the starter task\'s due choices are this Friday and the Monday after', () {
      final (friday, monday) = starterDueChoices(DateTime(2026, 12, 2)); // a Wednesday
      expect(friday, DateTime(2026, 12, 4));
      expect(monday, DateTime(2026, 12, 7));
      final (fridayAgain, _) = starterDueChoices(DateTime(2026, 12, 4)); // on a Friday: the next one
      expect(fridayAgain, DateTime(2026, 12, 11));
    });

    testWidgets('New joiners shows only while the lifecycle is on and there are joiners', (tester) async {
      final store = LifecycleMeStore();
      final api = FakeOnboardingApi()
        ..joiners = const [
          JoinerSummary(journeyId: 'j1', name: 'Kabir Mehta', designation: 'Product Designer', dayLabel: 'Day 1', stage: 'welcome_week1', todayCount: 4),
        ];
      final shell = shellFor(api, DateTime(2026, 12, 1, 9));
      await pumpPage(tester, Scaffold(body: ListView(children: [NewJoinersSection(shell: shell, store: store)])));
      expect(find.byKey(const ValueKey('new-joiners')), findsNothing);

      store.value = const LifecycleMe(enabled: true);
      await tester.pumpAndSettle();
      expect(find.text('New joiners'), findsOneWidget);
      expect(find.text('Kabir Mehta'), findsOneWidget);
      expect(find.text('🌱 New joiner · Day 1'), findsOneWidget);
      expect(find.text('4 to do today'), findsOneWidget);
    });

    testWidgets('no joiners → no section', (tester) async {
      final store = LifecycleMeStore()..value = const LifecycleMe(enabled: true);
      final api = FakeOnboardingApi();
      await pumpPage(tester, Scaffold(body: ListView(children: [NewJoinersSection(shell: shellFor(api, DateTime(2026, 12, 1)), store: store)])));
      expect(find.byKey(const ValueKey('new-joiners')), findsNothing);
    });

    testWidgets('the joiner\'s week: the manager\'s tasks with their pills; assigning a starter task', (tester) async {
      final api = FakeOnboardingApi()
        ..joiner = JoinerDetail.fromJson({
          'joiner': {'journeyId': 'j1', 'name': 'Kabir Mehta', 'designation': 'Product Designer', 'tj': '2026-12-01', 'stage': 'welcome_week1'},
          'tasks': [
            task('t1', 'Give Kabir a starter task', systemKey: 'starter_task', ownerRole: 'manager'),
            task('t2', 'Add notes from your 1:1', systemKey: 'one_on_one_notes', ownerRole: 'manager'),
            task('t3', 'Introduce Kabir to the team', systemKey: 'meet_team', ownerRole: 'manager', mustDo: true),
            task('t4', 'Register your face', systemKey: 'register_face', status: 'done'),
            task('t5', 'Week-1 tasks', systemKey: 'week1_reels'),
          ],
          'setup': {'people': [], 'goals': []},
        });
      await pumpPage(tester, JoinerScreen(shell: shellFor(api, DateTime(2026, 12, 2)), journeyId: 'j1'));
      expect(find.text('Kabir Mehta'), findsOneWidget);
      expect(find.text('Week 1'), findsWidgets);
      expect(find.text('Assign'), findsOneWidget);
      expect(find.text('Add'), findsWidgets);
      expect(find.text('0 of 6'), findsOneWidget);

      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(api.calls, contains('mgr-done:t3'));

      await tester.tap(find.text('Assign'));
      await tester.pumpAndSettle();
      expect(find.text('Give Kabir a starter task'), findsWidgets);
      await tester.enterText(find.byKey(const ValueKey('starter-title')), 'Redesign the leave request screen');
      await tester.tap(find.byKey(const ValueKey('due-friday')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('starter-assign')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('assign:Redesign the leave request screen:2026-12-04'));
      // The joiner's own progress, read-only, at the end.
      await scrollTo(tester, find.text('1 of 2 done'));
      expect(find.text('On track.'), findsOneWidget);
    });
  });

  group('the plant', () {
    testWidgets('names its stage for screen readers; droop shows Needs water, never red', (tester) async {
      await pumpPage(tester, const Scaffold(body: Center(child: Plant(stage: 2, droop: true))));
      expect(find.bySemanticsLabel('Plant at Seedling stage, needs water'), findsOneWidget);
      expect(find.text('Needs water'), findsOneWidget);
      final tag = tester.widget<Text>(find.text('Needs water'));
      expect(tag.style?.color, OnbColors.waterText);
    });

    test('a seed counts its water', () {
      expect(Plant.semanticsLabel(stage: 0, water: 2), 'Plant at Seed stage, watered 2 of 3');
    });
  });

  group('reveal and check-in', () {
    test('the check-in keeps the win and the ask in one text', () {
      expect(CheckinReelScreen.checkinText(win: 'Shipped v1', ask: ''), 'A win: Shipped v1');
      expect(CheckinReelScreen.checkinText(win: 'Shipped v1', ask: 'Analytics access'), 'A win: Shipped v1\nWould help: Analytics access');
    });

    testWidgets('the month-end check-in: a feeling, a win, the ask; +1 leaf', (tester) async {
      final api = FakeOnboardingApi();
      await pumpPage(
        tester,
        CheckinReelScreen(
          shell: shellFor(api, DateTime(2026, 12, 30)),
          month: const ProbationMonth(monthNo: 1, goals: ['Ship the leave request redesign']),
          managerName: 'Neha',
        ),
      );
      await tester.tap(find.byKey(const ValueKey('feeling-3')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('checkin-next')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('checkin-win')), 'Shipped v1');
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('checkin-next')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('checkin-next')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('checkin:1:3'));
      expect(find.text('+1 leaf'), findsOneWidget);
    });
  });

  test('/lifecycle/me drives the tile: off, on without a journey, on with one', () {
    expect(LifecycleMe.off.showsOnboarding, isFalse);
    expect(LifecycleMe.fromJson({'enabled': true}).showsOnboarding, isFalse);
    final on = LifecycleMe.fromJson({
      'enabled': true,
      'onboarding': {'journeyId': 'j1', 'stage': 'welcome_week1', 'dayLabel': 'Day 1', 'plant': {'stage': 1}, 'tileVisible': true},
    });
    expect(on.showsOnboarding, isTrue);
    expect(onboardingTileSubtitle(on), 'Day 1 · Welcome stage');
    expect(onboardingTileSubtitle(on.withProgress(const TaskProgress(2, 9))), '2 of 9 steps done');
    final hidden = LifecycleMe.fromJson({
      'enabled': false,
      'onboarding': {'journeyId': 'j1', 'tileVisible': true},
    });
    expect(hidden.showsOnboarding, isFalse);
  });

  test('the profile leads with Onboarding only while it runs', () {
    expect(ownProfileTabs(hasManager: true, showsHelp: false).first, ProfileTab.workDetail);
    expect(ownProfileTabs(hasManager: true, showsHelp: false), isNot(contains(ProfileTab.onboarding)));
    expect(ownProfileTabs(hasManager: true, showsHelp: false, showsOnboarding: true).first, ProfileTab.onboarding);
  });

  testWidgets('a tapped notification opens its onboarding screen; offboarding\'s kinds pass through', (tester) async {
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
    expect(openOnboardingDestination(context, {'destination': 'connect_post'}), isFalse);
    expect(openOnboardingDestination(context, {'destination': 'lifecycle_notes'}), isTrue);
    await tester.pumpAndSettle();
    expect(find.byType(NotesScreen), findsOneWidget);
  });
}
