// The onboarding home's tiles and their simple tabs, from the 20 Nov
// new-joiner prototype (Main · view home / access / watch / profile, lane
// L2): which tiles show in each phase, what each says (her own stage: Up
// next; through the lens: In Month 1), the tour card, and Devices and
// accesses, Watch list and Your profile from the server's home.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_home_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_home_tabs.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_tiles.dart';
import 'package:mobile_app/features/lifecycle/onboarding/timeline/lens_selection.dart';
import 'package:mobile_app/features/lifecycle/onboarding/timeline/stage_lens.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'lifecycle_onboarding_test.dart' show FakeOnboardingApi, pumpPage, scrollTo, shellFor;
import 'nj_l2_homes.dart';

Finder _in(String tile, String text) => find.descendant(of: find.byKey(ValueKey(tile)), matching: find.text(text));

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    onbLensSelection.value = null;
  });

  group('the server\'s home', () {
    test('reads the watch list, the company, the profile sections and an access row', () {
      final home = njHome(NjPhase.day1);
      expect(home.companyName, 'Sowaka');
      expect(home.watch.map((v) => v.title), ['A hello from Meera Iyer', 'Life at Sowaka']);
      expect(home.watch.first.url, '/portal/media/x.y');
      expect(home.profile!.sections.length, 7);
      expect(home.profile!.done, 2);
      expect(home.profile!.percent, 29, reason: 'the portal’s round(2 / 7 × 100)');
      expect(home.devices.last.title, 'Admissions CRM access');
      expect(OnboardingHome.fromJson({'journeyId': 'j'}).profile, isNull, reason: 'an older server: no tile');
    });
  });

  group('tiles by phase', () {
    test('Day 1: all six; Week 1: no devices once all are ready; Month 1 on: no profile', () {
      ({bool meetings, bool tasks, bool tour, bool watch, bool devices, bool profile}) shown(NjPhase p) {
        final home = njHome(p);
        final t = onbTiles(home, StageLens.of(home, njNow(p)));
        return (meetings: t.meetings, tasks: t.tasks, tour: t.tour != null, watch: t.watch != null, devices: t.devices, profile: t.profile);
      }

      expect(shown(NjPhase.day1), (meetings: true, tasks: true, tour: true, watch: true, devices: true, profile: true));
      expect(shown(NjPhase.week1), (meetings: true, tasks: true, tour: true, watch: true, devices: false, profile: true));
      expect(shown(NjPhase.month1), (meetings: true, tasks: true, tour: false, watch: true, devices: false, profile: false));
      expect(shown(NjPhase.months), (meetings: true, tasks: true, tour: false, watch: false, devices: false, profile: false));
      expect(shown(NjPhase.confirmed).tour, isFalse);
    });

    testWidgets('Day 1 before the first punch-in (Main): the punch card, then the tiles as drawn', (tester) async {
      final api = FakeOnboardingApi()..home = njHome(NjPhase.day1);
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, njNow(NjPhase.day1))));
      expect(find.byKey(const ValueKey('first-punch-card')), findsOneWidget);
      expect(find.byKey(const ValueKey('tour-card')), findsNothing);
      expect(_in('tile-meetings', '0 of 3 met'), findsOneWidget);
      expect(_in('tile-tasks', 'UP NEXT'), findsOneWidget);
      // Nothing is due on Day 1 itself (the week's tasks are due by Tj + 5):
      // Up next is the week's first, and the week's open ones are to do.
      expect(_in('tile-tasks', 'Post your intro'), findsOneWidget);
      expect(_in('tile-tasks', '3 to do'), findsOneWidget);
      expect(_in('tile-tour', 'Punch in and out'), findsOneWidget);
      expect(_in('tile-tour', '1 min · 0 of 4 done'), findsOneWidget);
      expect(_in('tile-watch', 'A hello from Meera Iyer'), findsOneWidget);
      expect(_in('tile-watch', '2 videos'), findsOneWidget);
      await scrollTo(tester, find.byKey(const ValueKey('tile-profile')));
      expect(_in('tile-devices', '2 of 4 ready'), findsOneWidget);
      expect(_in('tile-profile', '2 of 7 sections done'), findsOneWidget);
      expect(_in('tile-profile', '29%'), findsOneWidget);
    });

    testWidgets('Day 1 after it (JoinerDay1Later): tomorrow\'s lesson on the tour card', (tester) async {
      final api = FakeOnboardingApi()..home = njHome(NjPhase.day1Later);
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, njNow(NjPhase.day1Later))));
      expect(find.byKey(const ValueKey('first-punch-card')), findsNothing);
      expect(_in('tour-card', 'SOWAKA TOUR · TOMORROW'), findsOneWidget);
      expect(_in('tour-card', 'Fix a missed punch'), findsOneWidget);
      expect(_in('tile-meetings', '1 of 3 met'), findsOneWidget);
    });

    testWidgets('Week 1 (NewWeek1): today\'s lesson; Confirmed (NewConfirmed): the green hero, the letter', (tester) async {
      final api = FakeOnboardingApi()..home = njHome(NjPhase.week1);
      await pumpPage(tester, OnboardingHomeScreen(shell: shellFor(api, njNow(NjPhase.week1))));
      expect(_in('tour-card', 'SOWAKA TOUR · TODAY'), findsOneWidget);
      expect(_in('tour-card', 'Leave policy and applying for leave'), findsOneWidget);

      api.home = njHome(NjPhase.confirmed);
      await pumpPage(tester, OnboardingHomeScreen(key: UniqueKey(), shell: shellFor(api, njNow(NjPhase.confirmed))));
      expect(find.text('PROBATION COMPLETE'), findsOneWidget);
      expect(find.text('Confirmed!'), findsOneWidget);
      // "Read your confirmation letter" is the reveal, an automatic task: the
      // Tasks list (L3's StageLens rule: the joiner's own only) leaves it
      // out, so no Tasks tile once confirmed (a gap in the report).
      expect(find.byKey(const ValueKey('tile-tasks')), findsNothing);
      expect(find.byKey(const ValueKey('tour-card')), findsNothing);
    });
  });

  group('the tabs', () {
    testWidgets('Devices and accesses (OnbAccess): each with Ready or Setting up', (tester) async {
      final home = njHome(NjPhase.day1);
      await pumpPage(tester, OnbDevicesScreen(shell: shellFor(FakeOnboardingApi(), njNow(NjPhase.day1)), devices: home.devices));
      expect(find.text('Your devices and accesses'), findsOneWidget);
      expect(find.text('2 of 4 ready'), findsOneWidget);
      expect(find.text('Admissions CRM access'), findsOneWidget);
      expect(find.text('Setting up'), findsNWidgets(2));
    });

    testWidgets('Watch list (OnbWatch): About the company, its Meet us videos', (tester) async {
      final home = njHome(NjPhase.day1);
      await pumpPage(tester, OnbWatchScreen(shell: shellFor(FakeOnboardingApi(), njNow(NjPhase.day1)), home: home));
      expect(find.text('About Sowaka'), findsOneWidget);
      expect(find.text('2 videos'), findsOneWidget);
      expect(find.byKey(const ValueKey('watch-company_video')), findsOneWidget);
    });

    testWidgets('Your profile (OnbProfile): the seven sections, Done / To do, the portal\'s count', (tester) async {
      final home = njHome(NjPhase.day1);
      await pumpPage(tester, OnbProfileScreen(shell: shellFor(FakeOnboardingApi(), njNow(NjPhase.day1)), profile: home.profile!));
      expect(find.text('2 of 7 sections done'), findsOneWidget);
      expect(find.text('29%'), findsOneWidget);
      expect(find.text('Done'), findsNWidgets(2));
      expect(find.text('To do'), findsNWidgets(5));

      await pumpPage(tester, OnbProfileScreen(key: UniqueKey(), shell: shellFor(FakeOnboardingApi(), njNow(NjPhase.day1)), profile: njHome(NjPhase.day1, profileDone: 7).profile!));
      expect(find.text('All done'), findsNWidgets(2));
      expect(find.text('100%'), findsOneWidget);
    });
  });
}
