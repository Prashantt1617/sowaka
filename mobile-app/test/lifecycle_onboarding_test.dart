import 'dart:async';

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
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/joiners_tab.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/team_kit.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/new_joiners_section.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/probation_review_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/meeting_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/people_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/task_row.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_home_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_kit.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/plant.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/portal_page_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/probation_screens.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/profile_onboarding_card.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/survey_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/week1_reels_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/onboarding_launcher.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/notes_screen.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart' show ManagerTab;
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

  /// What the device kept, for the kept-first paints: off unless a test turns it on.
  bool keptOnDevice = false;

  @override
  Future<T?> fromDevice<T>(Future<T> Function(OnboardingApi api) read) async => keptOnDevice ? read(this) : null;

  @override
  Future<LifecycleMe> fetchMe() async => me;

  /// What `POST /lifecycle/portal-session` answers; a failure when null.
  Uri? portalUrl = Uri.parse('https://acme.getsowaka.com/onboarding/app?c=ct#t=tok');

  @override
  Future<Uri> portalSessionUrl() async {
    calls.add('portal-session');
    final url = portalUrl;
    if (url == null) throw const OnboardingApiException('No joining portal for you', statusCode: 404);
    return url;
  }

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
  Future<List<PersonToMeet>> fetchPeople() async => peopleView.people;
  PeopleToMeetView peopleView = const PeopleToMeetView();
  @override
  Future<PeopleToMeetView> fetchPeopleView() async => peopleView;
  @override
  Future<void> markWeekDoneSeen() async => calls.add('week-done-seen');
  @override
  Future<void> postWelcome(String journeyId, String text) async => calls.add('welcome:$text');
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
  Future<void> saveCheckin(int month, String text, {int? rating, List<int>? goalRatings, String? win, String? ask}) async =>
      calls.add('checkin:$month:$rating${goalRatings == null ? '' : ':${goalRatings.join(',')}'}');
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
  Future<void> saveProbationMonth(
    String journeyId,
    int month, {
    List<String>? goals,
    CheckinEntry? checkin,
    String? review,
    List<String>? feedback,
    bool? askAck,
    List<String>? nextGoals,
  }) async => calls.add('month:$month${feedback == null ? '' : ':${feedback.join('+')}'}${nextGoals == null ? '' : ':next=${nextGoals.join('+')}'}');
  @override
  Future<List<DirectoryPerson>> fetchDirectory() async => directory;
}

class FakePortalSurface implements PortalSurface {
  FakePortalSurface(this.onMessage, this.stays, this.onLoaded);

  final void Function(String message) onMessage;
  final bool Function(Uri to) stays;
  final VoidCallback onLoaded;
  final loads = <Uri?>[];

  @override
  Future<void> load(Uri url) async {
    loads.add(url);
    onLoaded();
  }

  @override
  Future<bool> back() async => false;

  @override
  Widget build(BuildContext context) => const SizedBox.expand(key: ValueKey('fake-portal'));
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
      expect(find.text('Task 2 of 4 · 2 min'), findsOneWidget);
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
    test('editable until Tj + 7, locked from it (as the server); the server\'s flag wins', () {
      expect(probationGoalsLocked(tj: tj, now: DateTime(2026, 12, 7, 20)), isFalse);
      expect(probationGoalsLocked(tj: tj, now: DateTime(2026, 12, 8)), isTrue);
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

    testWidgets('Day 1: you are here, then the tiles only (no Up next card, no list)', (tester) async {
      final api = FakeOnboardingApi()..home = dayOne();
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, now)));

      expect(tester.widget<Text>(find.byKey(const ValueKey('stage-title'))).data, 'Day 1');
      expect(find.text('YOU ARE HERE'), findsOneWidget);
      // The prototype's home is the hero and the tiles: no Up next card, no Today list.
      expect(find.byKey(const ValueKey('up-next')), findsNothing);
      expect(find.text('Today'), findsNothing);
      expect(find.byKey(const ValueKey('done-toggle')), findsNothing);
      expect(find.byKey(const ValueKey('tile-meetings')), findsOneWidget);
      // Meetings of her stage: manager and team open, the induction done.
      expect(find.descendant(of: find.byKey(const ValueKey('tile-meetings')), matching: find.text('0 of 2 met')), findsOneWidget);
      final tasks = find.byKey(const ValueKey('tile-tasks'));
      expect(find.descendant(of: tasks, matching: find.text('UP NEXT')), findsOneWidget);
      expect(find.descendant(of: tasks, matching: find.text('Register your face')), findsOneWidget);
      // The tour has its own tile, so it is not a task.
      expect(find.descendant(of: find.byKey(const ValueKey('tile-tour')), matching: find.text('Punch in and out')), findsOneWidget);
    });

    testWidgets('the stage row sits in the card: Day 1 … Month 6, Confirmed', (tester) async {
      final api = FakeOnboardingApi()..home = dayOne();
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, now)));
      for (final step in ['Day 1', 'Week 1', 'Month 1', 'Month 6', 'Confirmed']) {
        expect(find.byKey(ValueKey('stage-step-$step')), findsOneWidget);
      }
      expect(find.bySemanticsLabel('Day 1, your stage'), findsOneWidget);
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
      expect(find.text('Question 1 of 4'), findsOneWidget);
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
    await tester.ensureVisible(find.byKey(const ValueKey('meeting-yes')));
    await tester.pumpAndSettle();
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
      // Direct Reports' filter pills: All · New joiners n; New joiners shows only them.
      expect(find.text('New joiners 1'), findsOneWidget);
      expect(find.byKey(const ValueKey('filter-all')), findsOneWidget);
      expect(NewJoinersSection.joinerUserIds.value, isEmpty, reason: 'not joined yet: no user id to leave out of the list');
      await tester.tap(find.byKey(const ValueKey('filter-joiners')));
      await tester.pump();
      expect(NewJoinersSection.joinersOnly.value, isTrue);
      await tester.tap(find.byKey(const ValueKey('filter-all')));
      await tester.pump();
      expect(find.text('Kabir Mehta'), findsOneWidget);
      expect(find.text('🌱 New joiner · Day 1'), findsOneWidget);
      expect(find.text('4 to do today'), findsOneWidget);
    });

    testWidgets('on the Team tab\'s tree (M0) the section only hands the joiners over', (tester) async {
      final store = LifecycleMeStore()..value = const LifecycleMe(enabled: true);
      final api = FakeOnboardingApi()
        ..joiners = const [
          JoinerSummary(journeyId: 'j2', name: 'Riya Joshi', userId: 'riya', stage: 'probation', dayLabel: 'Week 6'),
          JoinerSummary(journeyId: 'j1', name: 'Kabir Mehta', userId: 'kabir', stage: 'welcome_week1', dayLabel: 'Day 1', todayCount: 4),
        ];
      await pumpPage(tester, Scaffold(body: ListView(children: [NewJoinersSection(shell: shellFor(api, DateTime(2026, 12, 1, 9)), store: store, inTree: true)])));
      // The Team tab draws them on its Direct Reports tree; nothing here.
      expect(find.byKey(const ValueKey('new-joiners')), findsNothing);
      expect(find.text('Kabir Mehta'), findsNothing);
      final tree = NewJoinersSection.tree.value;
      expect(tree, isNotNull);
      expect(tree!.joiners.map((j) => j.name), ['Kabir Mehta', 'Riya Joshi'], reason: 'most urgent first');
      expect(NewJoinersSection.joinerUserIds.value, {'kabir', 'riya'});
      await tester.pumpWidget(const SizedBox.shrink());
      expect(NewJoinersSection.tree.value, isNull, reason: 'gone with the tab');
    });

    testWidgets('the Direct Reports filter pills: All n · New joiners n, black when on', (tester) async {
      await pumpPage(tester, const Scaffold(body: Center(child: JoinersFilterPills(allCount: 4, joinersCount: 2))));
      expect(find.text('All 4'), findsOneWidget);
      expect(find.text('New joiners 2'), findsOneWidget);
      expect(NewJoinersSection.joinersOnly.value, isFalse);
      await tester.tap(find.byKey(const ValueKey('filter-joiners')));
      await tester.pump();
      expect(NewJoinersSection.joinersOnly.value, isTrue);
      final on = tester.widget<Material>(find.descendant(of: find.byKey(const ValueKey('filter-joiners')), matching: find.byType(Material)));
      expect(on.color, OnbColors.text);
      await tester.tap(find.byKey(const ValueKey('filter-all')));
      await tester.pump();
      expect(NewJoinersSection.joinersOnly.value, isFalse);
    });

    testWidgets('a joiner card in probation: the week in blue, what is next in green (M0 Riya)', (tester) async {
      await pumpPage(
        tester,
        Scaffold(
          body: JoinerCard(
            joiner: const JoinerSummary(journeyId: 'j2', name: 'Riya Joshi', designation: 'UX Writer', stage: 'probation', dayLabel: 'Week 6', nextEvent: 'Check-in Fri'),
            now: DateTime(2026, 12, 1),
            onTap: () {},
          ),
        ),
      );
      expect(find.text('🌱 Week 6'), findsOneWidget);
      expect(find.text('Check-in Fri'), findsOneWidget);
      expect(find.text('🌱 Week 6 · Check-in Fri'), findsNothing);
      expect(find.byKey(const ValueKey('joiner-plant-badge')), findsOneWidget);
      expect(find.bySemanticsLabel('Riya Joshi, UX Writer, Week 6, Check-in Fri'), findsOneWidget);
    });

    testWidgets('no joiners → no section', (tester) async {
      final store = LifecycleMeStore()..value = const LifecycleMe(enabled: true);
      final api = FakeOnboardingApi();
      await pumpPage(tester, Scaffold(body: ListView(children: [NewJoinersSection(shell: shellFor(api, DateTime(2026, 12, 1)), store: store)])));
      expect(find.byKey(const ValueKey('new-joiners')), findsNothing);
    });

  });

  group('the plant', () {
    testWidgets('names its stage for screen readers, in the artifact\'s 120 × 140 box, with no pill', (tester) async {
      await pumpPage(tester, const Scaffold(body: Center(child: Plant(stage: 2, size: 150, droop: true))));
      expect(find.bySemanticsLabel('Plant at Seedling stage'), findsOneWidget);
      expect(find.text('Needs water'), findsNothing);
      expect(tester.getSize(find.byType(Plant)), const Size(150, 175));
    });

    test('a seed counts its water; a grown plant has none', () {
      expect(Plant.semanticsLabel(stage: 0, water: 2), 'Plant at Seed stage, watered 2 of 3');
      expect(Plant.semanticsLabel(stage: 1, water: 2), 'Plant at Sprout stage');
    });

    testWidgets('every stage and every water level paints', (tester) async {
      for (var stage = 0; stage <= 5; stage++) {
        for (var water = 0; water <= 3; water++) {
          await tester.pumpWidget(MaterialApp(home: Center(child: Plant(stage: stage, water: water))));
          await tester.pump(const Duration(milliseconds: 700));
          expect(tester.takeException(), isNull);
        }
      }
      await tester.pumpWidget(const SizedBox());
    });
  });

  group('reveal and check-in', () {
    test('the check-in keeps the win and the ask in one text', () {
      expect(CheckinReelScreen.checkinText(win: 'Shipped v1', ask: ''), 'A win: Shipped v1');
      expect(CheckinReelScreen.checkinText(win: 'Shipped v1', ask: 'Analytics access'), 'A win: Shipped v1\nWould help: Analytics access');
    });

    testWidgets('the month-end check-in: each goal rated, a feeling, a win and the ask; +1 leaf', (tester) async {
      final api = FakeOnboardingApi();
      await pumpPage(
        tester,
        CheckinReelScreen(
          shell: shellFor(api, DateTime(2026, 12, 30)),
          month: const ProbationMonth(monthNo: 1, goals: ['Ship the leave request redesign']),
          managerName: 'Neha',
        ),
      );
      expect(find.text('GOAL 1 OF 1'), findsOneWidget);
      expect(find.text('How did it go?'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('checkin-next')));
      await tester.pump();
      expect(find.text('GOAL 1 OF 1'), findsOneWidget, reason: 'a goal needs its rating first');
      await tester.tap(find.byKey(const ValueKey('goal-0-rating-4')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('checkin-next')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('feeling-3')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('checkin-next')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('checkin-win')), 'Shipped v1');
      await tester.enterText(find.byKey(const ValueKey('checkin-ask')), 'Access to analytics');
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('checkin-next')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('checkin:1:3:4'));
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

  test('the profile has no Onboarding tab (the prototype opens onboarding from Actions only)', () {
    expect(ownProfileTabs(hasManager: true, showsHelp: false).first, ProfileTab.workDetail);
    expect(ownProfileTabs(hasManager: true, showsHelp: false), isNot(contains(ProfileTab.onboarding)));
    expect(ownProfileTabs(hasManager: true, showsHelp: false, showsOnboarding: true), isNot(contains(ProfileTab.onboarding)));
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
    // The 1:1 notes are not in the new-joiner prototype: the push opens the home.
    expect(openOnboardingDestination(context, {'destination': 'lifecycle_notes'}), isTrue);
    await tester.pumpAndSettle();
    expect(find.byType(NotesScreen), findsNothing);
    expect(find.byType(OnboardingHomeScreen), findsOneWidget);
  });

  group('the joining portal in the app', () {
    test('/lifecycle/me says whether the tab is the portal (before Day 1 only)', () {
      final me = LifecycleMe.fromJson({
        'enabled': true,
        'onboarding': {'journeyId': 'j1', 'tileVisible': true, 'portal': true},
      });
      expect(me.onboarding!.portal, isTrue);
      expect(me.withProgress(const TaskProgress(1, 4)).onboarding!.portal, isTrue);
      expect(LifecycleMe.fromJson({'enabled': true, 'onboarding': {'journeyId': 'j1'}}).onboarding!.portal, isFalse);
    });

    testWidgets('Onboarding opens the portal page while the portal is open, the app\'s home after', (tester) async {
      final api = FakeOnboardingApi();
      final shell = shellFor(api, DateTime(2026, 12, 2));
      OnboardingShell maker() => shell;
      registerOnboardingShell(maker);
      addTearDown(() => unregisterOnboardingShell(maker));
      addTearDown(LifecycleMeStore.instance.clear);
      PortalPage.debugSurfaceFactory = ({required onMessage, required stays, required onLoaded}) =>
          FakePortalSurface(onMessage, stays, onLoaded);
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
      expect(find.byType(OnboardingHomeScreen), findsNothing);
      Navigator.of(context).pop();
      await tester.pumpAndSettle();
      LifecycleMeStore.instance.value = LifecycleMe.fromJson({
        'enabled': true,
        'onboarding': {'journeyId': 'j1', 'tileVisible': true, 'portal': false},
      });
      unawaited(openOnboardingHome(context));
      await tester.pumpAndSettle();
      expect(find.byType(OnboardingHomeScreen), findsOneWidget);
      expect(find.byType(PortalPageScreen), findsNothing);
    });

    testWidgets('with an Action tab in the bar, Onboarding goes to that tab (the portal), nothing pushed', (tester) async {
      final api = FakeOnboardingApi();
      final picked = <ManagerTab>[];
      final shell = OnboardingShell(
        api: api,
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
      expect(find.byType(OnboardingHomeScreen), findsNothing);
    });

    testWidgets('the tab asks for a session only once it is looked at, and once', (tester) async {
      final api = FakeOnboardingApi();
      PortalPage.debugSurfaceFactory = ({required onMessage, required stays, required onLoaded}) =>
          FakePortalSurface(onMessage, stays, onLoaded);
      addTearDown(() => PortalPage.debugSurfaceFactory = null);
      Widget tab(bool visible) => MaterialApp(
        home: Scaffold(
          body: PortalTab(
            key: const ValueKey('portal-tab'),
            api: api,
            visible: visible,
            profileAction: const SizedBox(width: 30, height: 30),
            onNotifications: () {},
          ),
        ),
      );
      await tester.pumpWidget(tab(false));
      await tester.pumpAndSettle();
      expect(api.calls.where((c) => c == 'portal-session'), isEmpty);
      await tester.pumpWidget(tab(true));
      await tester.pumpAndSettle();
      await tester.pumpWidget(tab(false));
      await tester.pumpWidget(tab(true));
      await tester.pumpAndSettle();
      expect(api.calls.where((c) => c == 'portal-session'), hasLength(1));
      expect(find.byKey(const ValueKey('fake-portal')), findsOneWidget);
    });

    testWidgets('the page: the app header, the portal, no title row; signed in by the session\'s address', (tester) async {
      final api = FakeOnboardingApi();
      late FakePortalSurface surface;
      await pumpPage(
        tester,
        PortalPageScreen(
          shell: shellFor(api, DateTime(2026, 12, 2)),
          surfaceFactory: ({required onMessage, required stays, required onLoaded}) =>
              surface = FakePortalSurface(onMessage, stays, onLoaded),
        ),
      );
      expect(api.calls.where((c) => c == 'portal-session'), hasLength(1));
      expect(surface.loads, [api.portalUrl]);
      expect(find.byKey(const ValueKey('fake-portal')), findsOneWidget);
      // No back + title row: the portal has its own heading.
      expect(find.text('Onboarding'), findsNothing);
      // The portal's own pages stay; another site goes outside the app.
      expect(surface.stays(Uri.parse('https://acme.getsowaka.com/onboarding/profile')), isTrue);
      expect(surface.stays(Uri.parse('blob:https://acme.getsowaka.com/1')), isTrue);
    });

    testWidgets('a session that ran out is renewed once; again at once shows the error; sign out leaves', (tester) async {
      final api = FakeOnboardingApi();
      late FakePortalSurface surface;
      await pumpPage(
        tester,
        PortalPageScreen(
          shell: shellFor(api, DateTime(2026, 12, 2)),
          surfaceFactory: ({required onMessage, required stays, required onLoaded}) =>
              surface = FakePortalSurface(onMessage, stays, onLoaded),
        ),
      );
      surface.onMessage('expired');
      await tester.pumpAndSettle();
      expect(surface.loads, hasLength(2));
      surface.onMessage('expired');
      await tester.pumpAndSettle();
      expect(surface.loads, hasLength(2));
      expect(find.textContaining('couldn’t sign you in'), findsOneWidget);
      surface.onMessage('signed-out');
      await tester.pumpAndSettle();
      expect(find.byType(PortalPageScreen), findsNothing);
      expect(find.text('root'), findsOneWidget);
    });

    testWidgets('a portal that has closed shows the error, not a blank page', (tester) async {
      final api = FakeOnboardingApi()..portalUrl = null;
      await pumpPage(
        tester,
        PortalPageScreen(
          shell: shellFor(api, DateTime(2026, 12, 2)),
          surfaceFactory: ({required onMessage, required stays, required onLoaded}) =>
              FakePortalSurface(onMessage, stays, onLoaded),
        ),
      );
      expect(find.text('No joining portal for you'), findsOneWidget);
      expect(find.byKey(const ValueKey('fake-portal')), findsNothing);
    });
  });

  // ─────────────────────────────────────────────────────────────── the coverage audit's gaps
  group('meeting times and read-only rows', () {
    test('a date-only due day (UTC midnight) is a day, never 5:30 AM', () {
      final row = view(task('ppl', 'People to meet', systemKey: 'people_to_meet', kind: 'meeting')
        ..['dueAt'] = '2026-12-31T00:00:00.000Z');
      expect(row.dueAt, DateTime(2026, 12, 31));
      expect(row.startsAt, isNull, reason: 'no meeting, no clock time');
      final meta = taskMeta(row, DateTime(2026, 12, 4, 9));
      expect(meta, isNot(contains('5:30')));
      expect(meta, startsWith('Due Thu 31 Dec'));
    });

    test('a meeting row carries its meeting: the time, the room beside the person', () {
      final row = view(task('mgr', 'Meet your manager', systemKey: 'meet_manager', kind: 'meeting', meeting: {
        'id': 'm1',
        'title': 'Meet your manager',
        'startsAt': DateTime(2026, 12, 1, 11).toIso8601String(),
        'place': 'Room 4B',
        'with': 'Neha R.',
        'attendees': [
          {'userId': 'me', 'name': 'Kabir', 'role': 'joiner'},
          {'userId': 'neha', 'name': 'Neha Rao', 'role': 'manager'},
        ],
      })..['dueAt'] = '2026-12-01T00:00:00.000Z');
      expect(row.startsAt, DateTime(2026, 12, 1, 11));
      expect(row.meetingId, 'm1');
      expect(taskMeta(row, DateTime(2026, 12, 1, 9)), '11:00 AM · Room 4B · with Neha R.');
      // Without the agenda's name: the others in it, never the joiner themself.
      final bare = view(task('mgr', 'Meet your manager', systemKey: 'meet_manager', kind: 'meeting', meeting: {
        'id': 'm1',
        'title': 'Meet your manager',
        'startsAt': DateTime(2026, 12, 1, 11).toIso8601String(),
        'attendees': [
          {'userId': 'isha', 'name': 'Isha Verma', 'role': 'joiner'},
          {'userId': 'meera', 'name': 'Meera Iyer', 'role': 'manager'},
        ],
      }));
      expect(taskMeta(bare, DateTime(2026, 12, 1, 9)), '11:00 AM · with Meera Iyer');
      expect(taskMeta(bare, DateTime(2026, 12, 1, 9), forManager: true), '11:00 AM · with Isha Verma');
    });

    testWidgets('Day 1: what others do is in Meetings (a meeting) or Devices (the laptop), never a task', (tester) async {
      final api = FakeOnboardingApi()
        ..home = OnboardingHome.fromJson({
          'journeyId': 'j1',
          'stage': 'welcome_week1',
          'tj': '2026-12-01',
          'progress': {'done': 0, 'total': 3},
          'today': [
            task('vision', 'Company vision and culture', systemKey: 'vision_culture', kind: 'meeting', ownerRole: 'hr')
              ..['readOnly'] = true
              ..['doneBy'] = 'HR',
            task('laptop', 'Set up laptop and login', systemKey: 'laptop_setup', ownerRole: 'it')
              ..['readOnly'] = true
              ..['doneBy'] = 'IT',
            task('face', 'Register your face', systemKey: 'register_face')..['helper'] = '2 min · needed to punch in',
          ],
          'devices': [
            {'key': 'laptop', 'title': 'Laptop', 'ready': false},
            {'key': 'app', 'title': 'Sowaka Connect', 'ready': true},
          ],
        });
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, DateTime(2026, 12, 1, 9))));
      expect(find.descendant(of: find.byKey(const ValueKey('tile-meetings')), matching: find.text('0 of 1 met')), findsOneWidget);
      final tasks = find.byKey(const ValueKey('tile-tasks'));
      expect(find.descendant(of: tasks, matching: find.text('Register your face')), findsOneWidget);
      expect(find.descendant(of: tasks, matching: find.text('1 to do')), findsOneWidget);
      await scrollTo(tester, find.byKey(const ValueKey('tile-devices')));
      expect(find.descendant(of: find.byKey(const ValueKey('tile-devices')), matching: find.text('1 of 2 ready')), findsOneWidget);
    });

    testWidgets('a meeting HR ticks asks no "Did you meet?"', (tester) async {
      final api = FakeOnboardingApi()
        ..meeting = Meeting.fromJson({
          'id': 'm2',
          'title': 'Welcome and induction',
          'startsAt': DateTime(2026, 12, 1, 9).toIso8601String(),
          'canConfirm': false,
          'systemKey': 'welcome_induction',
        });
      await pumpPage(tester, MeetingScreen(shell: shellFor(api, DateTime(2026, 12, 1, 10)), meetingId: 'm2'));
      expect(find.byKey(const ValueKey('did-you-meet')), findsNothing);
      expect(find.byKey(const ValueKey('meeting-not-yours')), findsOneWidget);
    });
  });

  group('home duplicates and A8', () {
    testWidgets('the 1:1 notes row is not drawn; a starter task is a task', (tester) async {
      final api = _NotesApi()
        ..home = OnboardingHome.fromJson({
          'journeyId': 'j1',
          'stage': 'welcome_week1',
          'tj': '2026-12-01',
          'upNext': task('st1', 'Redesign the leave screen', systemKey: 'starter_task'),
          'today': [
            task('st1', 'Redesign the leave screen', systemKey: 'starter_task'),
            task('notes', 'Notes from your 1:1', systemKey: 'one_on_one_notes', kind: 'form'),
            task('tour', 'Take the Sowaka tour', systemKey: 'app_tour'),
          ],
        });
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, DateTime(2026, 12, 4, 9))));
      expect(find.text('Notes from your 1:1'), findsNothing);
      expect(find.byKey(const ValueKey('up-next')), findsNothing);
      final tasks = find.byKey(const ValueKey('tile-tasks'));
      expect(find.descendant(of: tasks, matching: find.text('Redesign the leave screen')), findsOneWidget);
      expect(find.descendant(of: tasks, matching: find.text('1 to do')), findsOneWidget);
    });

    testWidgets('"Week 1, done!" is not in the prototype: never opened from the home', (tester) async {
      final api = FakeOnboardingApi()
        ..home = OnboardingHome.fromJson({
          'journeyId': 'j1',
          'stage': 'settling_in',
          'tj': '2026-12-01',
          'showWeekDone': true,
          'weekDoneStats': {'tasksDone': 9, 'peopleMet': 6, 'leaves': 3},
        });
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, DateTime(2026, 12, 9, 9))));
      expect(find.text('Week 1, done!'), findsNothing);
      expect(api.calls, isNot(contains('week-done-seen')));
    });

    testWidgets('…and not when it has been seen (any device)', (tester) async {
      final api = FakeOnboardingApi()
        ..home = OnboardingHome.fromJson({'journeyId': 'j1', 'stage': 'settling_in', 'tj': '2026-12-01', 'showWeekDone': false});
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, DateTime(2026, 12, 9, 9))));
      expect(find.text('Week 1, done!'), findsNothing);
      expect(api.calls, isNot(contains('week-done-seen')));
    });
  });

  group('M2 for the manager', () {
    testWidgets('Teams › Joiners: one card, a row each, the stage pill', (tester) async {
      final api = FakeOnboardingApi()
        ..joiners = [
          JoinerSummary(journeyId: 'j1', name: 'Kabir Mehta', designation: 'Product Designer', tj: DateTime(2026, 12, 1), stage: 'welcome_week1'),
          JoinerSummary(journeyId: 'j2', name: 'Kavya Iyer', designation: 'Admissions coordinator', tj: DateTime(2026, 12, 22), preboarding: true, stage: 'pre_boarding'),
        ];
      await pumpPage(tester, Scaffold(body: JoinersTab(shell: shellFor(api, DateTime(2026, 12, 2)))));
      expect(find.byKey(const ValueKey('joiner-row-j1')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('joiner-row-j1')), matching: find.text('Week 1')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('joiner-row-j2')), matching: find.text('Joins Tue 22 Dec')), findsOneWidget);
      expect(JoinersTab.count.value, 2);
    });

    testWidgets('the pill row: Joiners last, black when open, its count', (tester) async {
      var picked = '';
      await pumpPage(
        tester,
        Scaffold(
          body: TeamSectionPills(
            selected: 'myTeam',
            onSelect: (k) => picked = k,
            pills: const [
              TeamPillSpec(key: 'myTeam', label: 'My Team'),
              TeamPillSpec(key: 'requests', label: 'Requests', count: 3),
              TeamPillSpec(key: 'feedback', label: 'Feedback', count: 5),
              TeamPillSpec(key: 'joiners', label: 'Joiners', count: 2, countColor: TeamColors.joinersCount),
            ],
          ),
        ),
      );
      expect(find.bySemanticsLabel('Joiners, 2'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('team-pill-requests')));
      expect(picked, 'requests');
    });

  });

  group('M2 paints at once', () {
    JoinerDetail kept() => JoinerDetail.fromJson({
      'joiner': {'journeyId': 'j1', 'name': 'Kabir Mehta', 'designation': 'Product Designer', 'tj': '2026-12-01', 'stage': 'welcome_week1'},
      'tasks': [task('t1', 'Give Kabir a starter task', systemKey: 'starter_task', ownerRole: 'manager')],
      'setup': {'people': [], 'goals': []},
    });

    testWidgets('nothing kept: the Team tab\'s row paints the card while the week loads', (tester) async {
      final live = Completer<JoinerDetail>();
      final api = _SlowJoinerApi(live.future);
      const row = JoinerSummary(journeyId: 'j1', name: 'Kabir Mehta', designation: 'Product Designer', dayLabel: 'Week 1', stage: 'welcome_week1');
      await tester.pumpWidget(MaterialApp(home: JoinerScreen(shell: shellFor(api, DateTime(2026, 12, 2)), journeyId: 'j1', summary: row)));
      await tester.pump();
      expect(find.byKey(const ValueKey('mgr-hero')), findsOneWidget);
      expect(find.text('Week 1'), findsOneWidget);
      expect(find.text('Kabir Mehta'), findsOneWidget);
      live.complete(kept());
      await tester.pumpAndSettle();
      expect(find.text('Your tasks for Kabir'), findsOneWidget);
    });
  });

  group('offline: the last copy, said so', () {
    testWidgets('M2: the live read fails after the device copy painted → the note, not an error card', (tester) async {
      final api = _FailingJoinerApi()
        ..keptOnDevice = true
        ..joiner = JoinerDetail.fromJson({
          'joiner': {'journeyId': 'j1', 'name': 'Kabir Mehta', 'tj': '2026-12-01', 'stage': 'welcome_week1'},
          'tasks': [task('t1', 'Give Kabir a starter task', systemKey: 'starter_task', ownerRole: 'manager')],
          'setup': {'people': [], 'goals': []},
        });
      await pumpPage(tester, JoinerScreen(shell: shellFor(api, DateTime(2026, 12, 2)), journeyId: 'j1'));
      expect(find.text('Your tasks for Kabir'), findsOneWidget);
      expect(find.text(OnbOfflineNote.text), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('the onboarding home: the device copy with the note when offline', (tester) async {
      final api = _FailingHomeApi()..keptOnDevice = true;
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, DateTime(2026, 12, 2))));
      expect(find.byKey(const ValueKey('stage-title')), findsOneWidget);
      expect(find.text(OnbOfflineNote.text), findsOneWidget);
    });
  });

  group('PB2 and PB3', () {
    testWidgets('the review: goal by goal, On it, one-tap feedback, next month\'s goals', (tester) async {
      final api = FakeOnboardingApi()
        ..joiner = JoinerDetail.fromJson({
          'joiner': {'journeyId': 'j1', 'name': 'Ananya Rao', 'tj': '2026-11-01', 'stage': 'growing_gains'},
          'probation': {
            'months': [
              {
                'monthNo': 1,
                'goals': ['Ship the first feature'],
                'checkinEmployee': {'text': 'x', 'rating': 3, 'goalRatings': [4], 'win': 'Shipped it', 'ask': 'Access to analytics'},
              },
              {'monthNo': 2, 'goals': []},
            ],
          },
        });
      await pumpPage(tester, ProbationReviewScreen(shell: shellFor(api, DateTime(2026, 12, 2)), journeyId: 'j1', month: 1));
      expect(find.byKey(const ValueKey('their-goal-0')), findsOneWidget);
      expect(find.text('Access to analytics'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('my-goal-0-5')));
      await tester.tap(find.byKey(const ValueKey('on-it')));
      await scrollTo(tester, find.byKey(const ValueKey('feedback-Great start')));
      await tester.tap(find.byKey(const ValueKey('feedback-Great start')));
      await scrollTo(tester, find.byKey(const ValueKey('next-goal-0')));
      await tester.enterText(find.byKey(const ValueKey('next-goal-0')), 'Own the weekly report');
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('month-save')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('month:1:Great start:next=Own the weekly report'));
    });

    testWidgets('the reveal: new title, their own new CTC, KPIs, the letter', (tester) async {
      final api = _RevealApi(RevealView.fromJson({
        'ready': true,
        'outcome': 'confirm',
        'designation': 'Senior designer',
        'salary': 1450000,
        'kpis': {'name': 'Design IC', 'items': ['Design quality', 'Delivery']},
        'reportsTo': 'Neha Rao',
        'letterUrl': '/lifecycle/onboarding/letters/l1/pdf',
        'seen': true,
      }));
      await pumpPage(tester, RevealScreen(shell: shellFor(api, DateTime(2027, 6, 1)), sharePdf: (_, _) async {}));
      expect(find.text('₹14,50,000 a year'), findsOneWidget);
      await scrollTo(tester, find.byKey(const ValueKey('reveal-kpis')));
      expect(find.text('2 goals · Design IC'), findsOneWidget);
      expect(find.text('Design quality · Delivery'), findsOneWidget);
      expect(find.text('Read your letter'), findsOneWidget);
    });

    test('rupees the Indian way', () {
      expect(formatRupees(1450000), '₹14,50,000');
      expect(formatRupees(999), '₹999');
      expect(formatRupees(12345678), '₹1,23,45,678');
    });
  });

  test('the intro preview says what Connect posts', () {
    expect(IntroPost.messageFor('Designer who sketches on trains'), 'Hey everyone! Designer who sketches on trains. Excited to meet you all 🙌');
    expect(IntroPost.messageFor('Hello!'), 'Hey everyone! Hello! Excited to meet you all 🙌');
  });

  test('the tile follows the stage when the server words it', () {
    final me = LifecycleMe.fromJson({
      'enabled': true,
      'onboarding': {'journeyId': 'j1', 'tileVisible': true, 'progress': {'done': 0, 'total': 8}, 'subtitle': 'Week 6 · check-in due Fri 9 Jan'},
    });
    expect(onboardingTileSubtitle(me), 'Week 6 · check-in due Fri 9 Jan');
  });

  testWidgets('people to meet closed at the end of month 1: the unmet say Not met', (tester) async {
    final api = FakeOnboardingApi()
      ..peopleView = PeopleToMeetView.fromJson({
        'people': [
          {'id': 'a', 'userId': 'u1', 'name': 'Arjun M.', 'role': 'your buddy'},
        ],
        'meetBy': '2026-12-31',
        'closed': true,
      });
    await pumpPage(tester, PeopleToMeetScreen(shell: shellFor(api, DateTime(2027, 1, 2))));
    expect(find.text('People to meet closed'), findsOneWidget);
    expect(find.byKey(const ValueKey('not-met')), findsOneWidget);
    expect(find.byKey(const ValueKey('we-met')), findsNothing);
    expect(find.textContaining('your buddy'), findsOneWidget);
  });
}

class _NotesApi extends FakeOnboardingApi {
  @override
  Future<List<OneOnOneNote>> fetchNotes() async => [
    OneOnOneNote(id: 'n1', text: 'Settling in well', shared: true, sharedAt: DateTime(2026, 12, 1, 17), authorName: 'Neha R.'),
  ];

  @override
  Future<List<StarterTask>> fetchStarterTasks() async => [
    StarterTask(id: 'st1', title: 'Redesign the leave screen', assignedByName: 'Neha R.', dueAt: DateTime(2026, 12, 5)),
  ];
}

class _RevealApi extends FakeOnboardingApi {
  _RevealApi(this.reveal);

  final RevealView reveal;

  @override
  Future<RevealView> fetchReveal() async => reveal;
}

/// M2's live read held until the test lets it answer.
class _SlowJoinerApi extends FakeOnboardingApi {
  _SlowJoinerApi(this.live);

  final Future<JoinerDetail> live;
  bool _replaying = false;

  @override
  Future<T?> fromDevice<T>(Future<T> Function(OnboardingApi api) read) async {
    if (!keptOnDevice) return null;
    _replaying = true;
    try {
      return await read(this);
    } finally {
      _replaying = false;
    }
  }

  @override
  Future<JoinerDetail> fetchJoiner(String journeyId) => _replaying ? super.fetchJoiner(journeyId) : live;
}

/// The live read fails; the device copy (the fake's own data) answers.
class _FailingJoinerApi extends FakeOnboardingApi {
  bool _replaying = false;

  @override
  Future<T?> fromDevice<T>(Future<T> Function(OnboardingApi api) read) async {
    _replaying = true;
    try {
      return await read(this);
    } finally {
      _replaying = false;
    }
  }

  @override
  Future<JoinerDetail> fetchJoiner(String journeyId) =>
      _replaying ? super.fetchJoiner(journeyId) : Future.error(const OnboardingApiException(OnboardingApiException.offline));
}

class _FailingHomeApi extends FakeOnboardingApi {
  bool _replaying = false;

  @override
  Future<T?> fromDevice<T>(Future<T> Function(OnboardingApi api) read) async {
    _replaying = true;
    try {
      return await read(this);
    } finally {
      _replaying = false;
    }
  }

  @override
  Future<OnboardingHome> fetchHome() =>
      _replaying ? super.fetchHome() : Future.error(const OnboardingApiException(OnboardingApiException.offline));
}
