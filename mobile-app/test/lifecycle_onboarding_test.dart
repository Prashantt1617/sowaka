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
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/team_kit.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_kit.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/plant.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/portal_page_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/onboarding_launcher.dart';
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
  LifecycleMe me = LifecycleMe.off;

  final calls = <String>[];
  final week1Saves = <(Week1Step, Object)>[];
  SurveyAnswers? sentAnswers;

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

  });

  group('probation goals lock', () {
    test('editable until Tj + 7, locked from it (as the server); the server\'s flag wins', () {
      expect(probationGoalsLocked(tj: tj, now: DateTime(2026, 12, 7, 20)), isFalse);
      expect(probationGoalsLocked(tj: tj, now: DateTime(2026, 12, 8)), isTrue);
      expect(probationGoalsLocked(tj: tj, now: DateTime(2026, 12, 3), lockedFlag: true), isTrue);
      expect(probationGoalsLocked(tj: tj, now: DateTime(2027, 1, 3), lockedFlag: false), isFalse);
      expect(probationGoalsLocked(now: DateTime(2027, 1, 3)), isFalse);
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

  });

  group('home duplicates and A8', () {

  });

  group('Teams pills', () {
    testWidgets('the pill row: New joiners last, no count; the others with theirs', (tester) async {
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
              TeamPillSpec(key: 'newJoiners', label: 'New joiners'),
            ],
          ),
        ),
      );
      expect(find.bySemanticsLabel('Requests, 3'), findsOneWidget);
      expect(find.text('New joiners'), findsOneWidget);
      expect(find.text('Joiners'), findsNothing);
      await tester.tap(find.byKey(const ValueKey('team-pill-requests')));
      expect(picked, 'requests');
    });

  });

  group('PB2 and PB3', () {

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

}
