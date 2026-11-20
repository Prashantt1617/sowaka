// Day 1's first punch-in, from the 20 Nov New joiner artifact (lane J1):
// the server's `firstPunch`, the "Your first punch-in" card on the home, the
// spotlight that asks the Actions tab for it, and "You're in!".
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/day1_done_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/first_punch.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_home_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_kit.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'lifecycle_onboarding_test.dart' show FakeOnboardingApi, pumpPage, shellFor, task;

OnboardingHome dayOne({Map<String, dynamic>? firstPunch, Map<String, dynamic>? day1}) => OnboardingHome.fromJson(dayOneJson(firstPunch: firstPunch, day1: day1));

Map<String, dynamic> dayOneJson({Map<String, dynamic>? firstPunch, Map<String, dynamic>? day1}) => {
  'journeyId': 'j1',
  'stage': 'welcome_week1',
  'tj': '2026-12-01',
  'upNext': task('face', 'Register your face', systemKey: 'register_face'),
  'today': [
    task('face', 'Register your face', systemKey: 'register_face'),
    task('tour', 'Take the Sowaka tour', systemKey: 'app_tour'),
  ],
  'firstPunch': ?firstPunch,
  'day1': ?day1,
};

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FirstPunchTour.requested.value = false;
  });

  final day1 = DateTime(2026, 12, 1, 9);

  group('firstPunch', () {
    test('Day 1 before a punch-in needs it; after one, on Week 1, or from an old server it does not', () {
      expect(dayOne(firstPunch: {'faceEnrolled': false}).needsFirstPunchOn(day1), isTrue);
      final punched = dayOne(firstPunch: {'at': DateTime(2026, 12, 1, 10, 42).toIso8601String(), 'faceEnrolled': true});
      expect(punched.firstPunch?.faceEnrolled, isTrue);
      expect(punched.firstPunch?.at, isNotNull);
      expect(punched.needsFirstPunchOn(day1), isFalse);
      expect(dayOne(firstPunch: {'faceEnrolled': false}).needsFirstPunchOn(DateTime(2026, 12, 2, 9)), isFalse);
      expect(dayOne().needsFirstPunchOn(day1), isFalse);
    });
  });

  group('the home on Day 1', () {
    testWidgets('"Your first punch-in" sits under the hero; the face task is not a task while it shows', (tester) async {
      final api = FakeOnboardingApi()..home = dayOne(firstPunch: {'faceEnrolled': false});
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, day1)));
      expect(find.byKey(const ValueKey('first-punch-card')), findsOneWidget);
      expect(find.text('Your first punch-in'), findsOneWidget);
      expect(find.text('Learn to punch in'), findsOneWidget);
      expect(find.byKey(const ValueKey('up-next')), findsNothing);
      expect(find.text('Register your face'), findsNothing);
      // The tour card waits for the first punch-in.
      expect(find.byKey(const ValueKey('tour-card')), findsNothing);
    });

    testWidgets('after the first punch-in the card is gone; the tour card says tomorrow\'s lesson', (tester) async {
      final api = FakeOnboardingApi()
        ..home = OnboardingHome.fromJson({
          ...dayOneJson(firstPunch: {'at': DateTime(2026, 12, 1, 8, 50).toIso8601String(), 'faceEnrolled': true}),
          'tour': {'done': ['punch']},
        });
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, day1)));
      expect(find.byKey(const ValueKey('first-punch-card')), findsNothing);
      final card = find.byKey(const ValueKey('tour-card'));
      expect(find.descendant(of: card, matching: find.text('SOWAKA TOUR · TOMORROW')), findsOneWidget);
      expect(find.descendant(of: card, matching: find.text('Fix a missed punch')), findsOneWidget);
      expect(find.descendant(of: card, matching: find.text('1 min · 1 of 4 done')), findsOneWidget);
    });

    testWidgets('tapping it goes to the Actions tab and asks for the spotlight', (tester) async {
      final api = FakeOnboardingApi()..home = dayOne(firstPunch: {'faceEnrolled': false});
      ManagerTab? picked;
      final shell = OnboardingShell(
        api: api,
        profileAction: const SizedBox(width: 30, height: 30),
        onNotifications: () {},
        tabs: const [ManagerTab.connect, ManagerTab.quick],
        selectedTab: ManagerTab.quick,
        onSelectTab: (tab) => picked = tab,
        now: () => day1,
      );
      await pumpPage(tester, OnboardingHomeScreen(shell: shell));
      await tester.tap(find.byKey(const ValueKey('first-punch-card')));
      await tester.pump();
      expect(picked, ManagerTab.quick);
      expect(FirstPunchTour.requested.value, isTrue);
    });

    testWidgets('no card where the company has no Actions tab', (tester) async {
      final api = FakeOnboardingApi()..home = dayOne(firstPunch: {'faceEnrolled': false});
      final shell = OnboardingShell(
        api: api,
        profileAction: const SizedBox(width: 30, height: 30),
        onNotifications: () {},
        tabs: const [ManagerTab.connect],
        selectedTab: ManagerTab.connect,
        onSelectTab: (_) {},
        now: () => day1,
      );
      await pumpPage(tester, OnboardingHomeScreen(shell: shell));
      expect(find.byKey(const ValueKey('first-punch-card')), findsNothing);
    });
  });

  group('the spotlight', () {
    testWidgets('dims all but the target, which stays usable; the dim and Later dismiss', (tester) async {
      final target = GlobalKey();
      var show = true;
      var punched = 0;
      var later = 0;
      await pumpPage(
        tester,
        StatefulBuilder(
          builder: (context, setState) => Scaffold(
            body: OnbSpotlight(
              show: show,
              target: target,
              onDismiss: () => setState(() => show = false),
              callout: PunchSpotlightCallout(onLater: () => later++, onTry: () => punched++),
              child: Column(
                children: [
                  const SizedBox(height: 100),
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: SizedBox(
                      key: target,
                      height: 120,
                      width: double.infinity,
                      child: ElevatedButton(onPressed: () => punched++, child: const Text('Slide to Punch In')),
                    ),
                  ),
                  const Expanded(child: SizedBox()),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('punch-spotlight')), findsOneWidget);
      expect(find.text('Your face is checked as you slide.'), findsOneWidget);
      // The bubble sits under the target.
      expect(
        tester.getTopLeft(find.byKey(const ValueKey('punch-spotlight'))).dy,
        greaterThan(tester.getBottomLeft(find.byKey(target)).dy),
      );
      // The target, through the hole.
      await tester.tap(find.text('Slide to Punch In'));
      expect(punched, 1);
      await tester.tap(find.byKey(const ValueKey('punch-spotlight-try')));
      expect(punched, 2);
      await tester.tap(find.byKey(const ValueKey('punch-spotlight-later')));
      expect(later, 1);
      // A tap on the dim closes it.
      await tester.tapAt(const Offset(200, 40));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('punch-spotlight')), findsNothing);
    });
  });

  group("You're in!", () {
    testWidgets('the time and day, Face registered, the face task ticked, Back to onboarding', (tester) async {
      final api = FakeOnboardingApi()..home = dayOne(firstPunch: {'faceEnrolled': true});
      await pumpPage(
        tester,
        YoureInScreen(shell: shellFor(api, day1), at: DateTime(2026, 12, 1, 10, 42)),
      );
      expect(find.text('YOUR FIRST PUNCH-IN'), findsOneWidget);
      expect(find.text('You’re in!'), findsOneWidget);
      expect(find.text('10:42 AM · 1 December'), findsOneWidget);
      expect(find.text('Face registered'), findsOneWidget);
      expect(find.text('From tomorrow, just slide to punch in'), findsOneWidget);
      expect(find.text('Attendance'), findsOneWidget);
      expect(api.calls, contains('task:face:done'));
      expect(find.byKey(const ValueKey('back-to-onboarding')), findsOneWidget);
    });

    testWidgets('without a face on record there is no Face registered note and nothing is ticked', (tester) async {
      final api = FakeOnboardingApi()..home = dayOne(firstPunch: {'faceEnrolled': false});
      await pumpPage(
        tester,
        YoureInScreen(shell: shellFor(api, day1), at: DateTime(2026, 12, 1, 10, 42), faceRegistered: false),
      );
      expect(find.text('You’re in!'), findsOneWidget);
      expect(find.text('Face registered'), findsNothing);
      expect(find.text('Punched in'), findsNothing);
      expect(api.calls, isNot(contains('task:face:done')));
    });
  });

  group('Day 1, done!', () {
    testWidgets('the server\'s counts, the first punch-in, How was today? and tomorrow', (tester) async {
      final api = FakeOnboardingApi()..home = dayOne(day1: {'peopleMet': 3, 'thingsDone': 6});
      final saved = <String>[];
      await pumpPage(
        tester,
        Day1DoneScreen(shell: shellFor(api, day1), saveFeeling: (a) async { saved.add(a); return a; }),
      );
      expect(find.text('DAY 1 COMPLETE'), findsOneWidget);
      expect(find.text('Day 1, done!'), findsOneWidget);
      expect(find.text('Your plant has sprouted'), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('day1-people')), matching: find.text('3')), findsOneWidget);
      expect(find.text('people met'), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('day1-things')), matching: find.text('6')), findsOneWidget);
      expect(find.text('things done'), findsOneWidget);
      expect(find.text('1st'), findsOneWidget);
      expect(find.text('punch-in'), findsOneWidget);
      expect(find.text('How was today?'), findsOneWidget);
      expect(find.text('TOMORROW'), findsOneWidget);
      expect(find.text('Your Week-1 tasks open'), findsOneWidget);
      expect(find.text('Slide to punch in when you arrive'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('day1-feeling-tough')));
      await tester.pumpAndSettle();
      expect(saved, ['tough']);
      final tough = tester.widget<Material>(find.byKey(const ValueKey('day1-feeling-tough')));
      expect((tough.shape! as RoundedRectangleBorder).side.width, 2);
    });

    testWidgets('an answer already given shows picked; a failed save goes back to it', (tester) async {
      final api = FakeOnboardingApi()..home = dayOne(day1: {'peopleMet': 0, 'thingsDone': 2, 'feeling': 'great'});
      await pumpPage(
        tester,
        Day1DoneScreen(shell: shellFor(api, day1), saveFeeling: (_) async => throw Exception('Offline')),
      );
      double width(String k) => (tester.widget<Material>(find.byKey(ValueKey('day1-feeling-$k'))).shape! as RoundedRectangleBorder).side.width;
      expect(width('great'), 2);
      await tester.tap(find.byKey(const ValueKey('day1-feeling-okay')));
      await tester.pumpAndSettle();
      expect(width('great'), 2);
      expect(width('okay'), 1);
    });
  });
}
