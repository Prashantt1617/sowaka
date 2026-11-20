// The new-joiner prototype's Meetings (OnbMeetings), a meeting (OnbMeeting),
// Your team (TeamList) and Tasks (OnbTasks), and the same lists through the
// lens (LensAheadMeetings, LensAheadTasks, NewMonth1Tasks, LensBack).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onb_lists.dart';
import 'package:mobile_app/features/lifecycle/onboarding/timeline/lens_selection.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'lifecycle_nj_l3_fixtures.dart';
import 'lifecycle_onboarding_test.dart' show FakeOnboardingApi, pumpPage, scrollTo, shellFor;

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    onbLensSelection.value = null;
  });
  final day1 = DateTime(2026, 12, 1, 10);
  final week1 = DateTime(2026, 12, 3, 10);
  final month1 = DateTime(2026, 12, 15, 10);

  /// The row's text in order, top to bottom.
  List<String> texts(WidgetTester tester, Finder within) =>
      tester.widgetList<Text>(find.descendant(of: within, matching: find.byType(Text))).map((t) => t.data ?? '').toList();

  group('Meetings', () {
    testWidgets('Day 1: People to meet, n of m met, with whom and what to discuss, COMING UP, Your team', (tester) async {
      final api = FakeOnboardingApi()..home = njDay1();
      final source = FakeMeetingsSource();
      await pumpPage(tester, OnbMeetingsScreen(shell: shellFor(api, day1), source: source));
      expect(find.text('Meetings'), findsWidgets);
      expect(find.text('People to meet'), findsOneWidget);
      expect(find.text('0 of 3 met'), findsOneWidget);
      expect(find.text('Ritu Sharma · 4 to discuss'), findsOneWidget);
      expect(find.text('Sunny Kapoor · 4 to discuss'), findsOneWidget);
      expect(find.text('COMING UP'), findsOneWidget);
      // IT, later in Week 1, tagged with its stage and still doable early.
      expect(find.text('Week 1'), findsWidgets);
      await scrollTo(tester, find.byKey(const ValueKey('your-team')));
      expect(find.text('Your team'), findsOneWidget);
      expect(find.text('Admissions · 6 people'), findsOneWidget);
      // Nothing the prototype does not draw: no times, no Add to calendar.
      expect(find.textContaining('Add to calendar'), findsNothing);
    });

    testWidgets('the tick marks it met on the server; HR’s meeting is not the joiner’s to tick', (tester) async {
      final api = FakeOnboardingApi()..home = njDay1();
      final source = FakeMeetingsSource(onMet: (id) => api.home = njDay1(managerMet: true));
      await pumpPage(tester, OnbMeetingsScreen(shell: shellFor(api, day1), source: source));
      await tester.tap(find.byKey(const ValueKey('lens-tick-ind')));
      await tester.pumpAndSettle();
      expect(source.met, isEmpty);
      await tester.tap(find.byKey(const ValueKey('lens-tick-mm')));
      await tester.pumpAndSettle();
      expect(source.met, ['mm']);
      expect(find.text('1 of 3 met'), findsOneWidget);
    });

    testWidgets('a meeting: the agenda with a notes box each, Mark as met, notes kept for her', (tester) async {
      final api = FakeOnboardingApi()..home = njDay1(notes: const ['Ask about the CRM']);
      final source = FakeMeetingsSource(onMet: (id) => api.home = njDay1(managerMet: true));
      await pumpPage(tester, OnbMeetingsScreen(shell: shellFor(api, day1), source: source));
      await tester.tap(find.byKey(const ValueKey('lens-meeting-mm')));
      await tester.pumpAndSettle();
      expect(find.text('Meeting'), findsWidgets);
      expect(find.text('Sunny Kapoor'), findsOneWidget);
      expect(find.text('Agenda'), findsOneWidget);
      expect(find.text('4 things to talk about'), findsOneWidget);
      expect(find.text('What a good first month looks like'), findsOneWidget);
      expect(find.text('Ask about the CRM'), findsOneWidget);
      await scrollTo(tester, find.text('Only you can see your notes'));
      expect(find.text('Only you can see your notes'), findsOneWidget);
      await tester.drag(find.byType(Scrollable).first, const Offset(0, 3000));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).at(1), 'Weekly 1:1 on Fridays');
      await tester.pump(const Duration(seconds: 1));
      expect(source.notes['mm'], ['Ask about the CRM', 'Weekly 1:1 on Fridays', '', '']);

      await scrollTo(tester, find.byKey(const ValueKey('meeting-mark-met')));
      await tester.tap(find.byKey(const ValueKey('meeting-mark-met')));
      await tester.pumpAndSettle();
      expect(source.met, ['mm']);
      expect(find.byKey(const ValueKey('meeting-met')), findsOneWidget);
      expect(find.byKey(const ValueKey('meeting-met-pill')), findsOneWidget);
    });

    testWidgets('HR’s meeting opens with its agenda but no Mark as met', (tester) async {
      final api = FakeOnboardingApi()..home = njDay1();
      await pumpPage(tester, OnbMeetingsScreen(shell: shellFor(api, day1), source: FakeMeetingsSource()));
      await tester.tap(find.byKey(const ValueKey('lens-meeting-ind')));
      await tester.pumpAndSettle();
      expect(find.text('Your ID card and documents'), findsOneWidget);
      expect(find.byKey(const ValueKey('meeting-mark-met')), findsNothing);
    });

    testWidgets('Your team: the department, n people, Manager and Buddy, Say hi', (tester) async {
      final api = FakeOnboardingApi()..home = njDay1();
      await pumpPage(tester, OnbMeetingsScreen(shell: shellFor(api, day1), source: FakeMeetingsSource()));
      await scrollTo(tester, find.byKey(const ValueKey('your-team')));
      await tester.tap(find.byKey(const ValueKey('your-team')));
      await tester.pumpAndSettle();
      expect(find.text('Your team'), findsWidgets);
      expect(find.text('Admissions'), findsOneWidget);
      expect(find.text('6 people'), findsOneWidget);
      expect(texts(tester, find.byKey(const ValueKey('team-sk'))), ['SK', 'Sunny Kapoor', 'Manager', 'Admissions lead']);
      expect(texts(tester, find.byKey(const ValueKey('team-mj'))), ['MJ', 'Meera Joshi', 'Buddy', 'Senior counsellor']);
      expect(find.bySemanticsLabel('Say hi to Rohit'), findsOneWidget);
    });

    testWidgets('looking ahead from Week 1: IN MONTH 1 locked, then NOW · WEEK 1; no Your team', (tester) async {
      final api = FakeOnboardingApi()..home = njWeek1();
      onbLensSelection.value = 2;
      await pumpPage(tester, OnbMeetingsScreen(shell: shellFor(api, week1), source: FakeMeetingsSource()));
      expect(find.text('IN MONTH 1'), findsOneWidget);
      expect(find.text('1 meeting in Month 1'), findsOneWidget);
      expect(find.text('Sunny Kapoor · Opens in Month 1'), findsOneWidget);
      expect(find.text('NOW · WEEK 1'), findsOneWidget);
      expect(find.byKey(const ValueKey('your-team')), findsNothing);
    });
  });

  group('Tasks', () {
    testWidgets('Day 1: Tasks for you, n to do, Acknowledge policies 0 of 3, COMING UP with stages', (tester) async {
      final api = FakeOnboardingApi()..home = njDay1();
      await pumpPage(tester, OnbTasksScreen(shell: shellFor(api, day1)));
      expect(find.text('Tasks for you'), findsOneWidget);
      expect(find.text('2 to do'), findsOneWidget);
      expect(find.text('0 of 3 done'), findsOneWidget);
      expect(find.text('Pick a tax regime first'), findsOneWidget);
      expect(find.text('COMING UP'), findsOneWidget);
      expect(find.text('Month 1'), findsOneWidget);
      // The tour has its own tile; meetings are on Meetings.
      expect(find.text('Meet your manager'), findsNothing);
    });

    testWidgets('Week 1: a progress bar with its percent', (tester) async {
      final api = FakeOnboardingApi()..home = njWeek1();
      await pumpPage(tester, OnbTasksScreen(shell: shellFor(api, week1)));
      expect(find.byKey(const ValueKey('lens-bar-tax')), findsOneWidget);
      expect(find.text('50%'), findsOneWidget);
      expect(find.text('1 of 3 done'), findsOneWidget);
    });

    testWidgets('Month 1: what Week 1 left on top, From Week 1; done ones struck through', (tester) async {
      final api = FakeOnboardingApi()..home = njMonth1();
      await pumpPage(tester, OnbTasksScreen(shell: shellFor(api, month1)));
      final first = tester.getTopLeft(find.byKey(const ValueKey('lens-task-nominees'))).dy;
      expect(first, lessThan(tester.getTopLeft(find.byKey(const ValueKey('lens-task-crm'))).dy));
      expect(find.text('From Week 1'), findsOneWidget);
      expect(find.text('60%'), findsOneWidget);
    });

    testWidgets('looking ahead at Month 1: IN MONTH 1 first, Opens in Month 1, then NOW · WEEK 1', (tester) async {
      final api = FakeOnboardingApi()..home = njWeek1();
      onbLensSelection.value = 2;
      await pumpPage(tester, OnbTasksScreen(shell: shellFor(api, week1)));
      expect(find.text('IN MONTH 1'), findsOneWidget);
      expect(find.text('Opens in Month 1'), findsWidgets);
      expect(find.text('NOW · WEEK 1'), findsOneWidget);
    });

    testWidgets('Month 1 looking back at Week 1: still open first, the rest ticked', (tester) async {
      final api = FakeOnboardingApi()..home = njMonth1();
      onbLensSelection.value = 1;
      await pumpPage(tester, OnbTasksScreen(shell: shellFor(api, month1)));
      expect(find.text('Still open'), findsOneWidget);
      expect(find.text('1 still open'), findsOneWidget);
      final nominees = tester.getTopLeft(find.byKey(const ValueKey('lens-task-nominees'))).dy;
      expect(nominees, lessThan(tester.getTopLeft(find.byKey(const ValueKey('lens-task-intro'))).dy));
    });
  });
}
