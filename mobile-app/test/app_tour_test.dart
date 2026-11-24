// The Sowaka tour (24 Nov design, "Connect spotlight tour"): the start
// card, the spotlight walking the app's own widgets stop by stop (the tour
// switching tabs, Teams' sections and the profile's Help tab itself), the
// finish card, and Skip's card on the header photo. A small shell stands in
// for the app: the real bottom bar and Teams pills, marked places for the
// rest.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/app_tour/app_tour.dart';
import 'package:mobile_app/features/app_tour/app_tour_animations.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/team_kit.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/features/manager_shell/presentation/app_bottom_nav.dart';

const _allTabs = [ManagerTab.connect, ManagerTab.manage, ManagerTab.quick, ManagerTab.games];

/// What the shell showed under each stop, by the stop's title.
final _under = <String, String>{};

class _Shell extends StatefulWidget {
  const _Shell({required this.manager, this.tabs = _allTabs, this.helpCard = true});

  final bool manager;
  final List<ManagerTab> tabs;
  final bool helpCard;

  @override
  State<_Shell> createState() => _ShellState();
}

class _ShellState extends State<_Shell> {
  ManagerTab tab = ManagerTab.quick;
  TeamSection section = TeamSection.myTeam;
  bool profile = false;
  int resets = 0;

  late final host = AppTourHost(
    tabs: () => widget.tabs,
    showTab: (t, reset) => setState(() {
      if (reset || tab != t) resets++;
      tab = t;
      section = TeamSection.myTeam;
    }),
    showTeamSection: (s) => setState(() => section = s),
    openHelp: () => setState(() => profile = true),
    closeProfile: () => setState(() => profile = false),
    isManager: () => widget.manager,
    firstName: () => 'Priya',
  );

  String get where => profile ? 'profile' : (tab == ManagerTab.manage ? '${tab.name}/${section.name}' : tab.name);

  @override
  void initState() {
    super.initState();
    AppTour.register(host);
  }

  @override
  void dispose() {
    AppTour.unregister(host);
    super.dispose();
  }

  Widget _box(String label, {double height = 60}) => Container(
    height: height,
    margin: const EdgeInsets.all(16),
    alignment: Alignment.center,
    color: const Color(0xFFEEEEEE),
    child: Text(label),
  );

  Widget _page() {
    if (profile) {
      return ListView(
        children: [
          _box('My Profile', height: 200),
          if (widget.helpCard) Padding(padding: const EdgeInsets.all(16), child: AppTourHelpCard(onStart: () {})),
        ],
      );
    }
    return switch (tab) {
      ManagerTab.connect => Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              AppTourAnchor(target: AppTourTarget.avatar, child: _box('Photo', height: 30)),
            ],
          ),
          AppTourAnchor(target: AppTourTarget.connectComposer, child: _box('Start a post.....')),
        ],
      ),
      ManagerTab.manage => Column(
        children: [
          TeamSectionPills(
            selected: section.name,
            onSelect: (_) {},
            pills: [
              TeamPillSpec(key: TeamSection.myTeam.name, label: 'My Team'),
              if (widget.manager) ...[
                TeamPillSpec(key: TeamSection.requests.name, label: 'Requests', tourTarget: AppTourTarget.teamsRequests),
                TeamPillSpec(key: TeamSection.feedback.name, label: 'Feedback', tourTarget: AppTourTarget.teamsFeedback),
              ],
            ],
          ),
        ],
      ),
      ManagerTab.quick => ListView(
        children: [
          AppTourAnchor(
            target: AppTourTarget.punchCard,
            child: Column(
              children: [
                AppTourAnchor(target: AppTourTarget.attendanceTitle, child: _box('Attendance', height: 30)),
                _box('Slide to Punch In'),
              ],
            ),
          ),
          AppTourAnchor(target: AppTourTarget.actionTiles, child: _box('Leave · Overtime · Payroll', height: 240)),
        ],
      ),
      _ => _box('Games'),
    };
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(child: _page()),
    bottomNavigationBar: AppBottomNav(tabs: widget.tabs, selected: tab, onSelect: (t) => setState(() => tab = t)),
    floatingActionButton: Builder(
      builder: (context) => FloatingActionButton(
        key: const ValueKey('open-tour'),
        onPressed: () => AppTour.start(context, onComplete: () => completed++),
        child: const Icon(Icons.explore),
      ),
    ),
  );
}

var completed = 0;

Future<_ShellState> _open(WidgetTester tester, {required bool manager, List<ManagerTab> tabs = _allTabs, bool helpCard = true}) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  addTearDown(AppTour.close);
  completed = 0;
  _under.clear();
  await tester.pumpWidget(MaterialApp(home: _Shell(manager: manager, tabs: tabs, helpCard: helpCard)));
  await tester.tap(find.byKey(const ValueKey('open-tour')));
  await _settle(tester);
  return tester.state<_ShellState>(find.byType(_Shell));
}

/// The tour finds its next widget over a few frames (and its loops never
/// settle): time passes in steps.
Future<void> _settle(WidgetTester tester, {int frames = 12}) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 60));
  }
}

String _title(WidgetTester tester) => tester.widget<Text>(find.byKey(const ValueKey('app-tour-title'))).data!;
String _counter(WidgetTester tester) => tester.widget<Text>(find.byKey(const ValueKey('app-tour-counter'))).data!;

/// Start tour, then Next to the end: the titles in the order shown.
Future<List<String>> _walk(WidgetTester tester, _ShellState shell, {int frames = 12}) async {
  expect(find.text('Let’s show you around'), findsOneWidget);
  await tester.tap(find.byKey(const ValueKey('app-tour-start')));
  await _settle(tester, frames: frames);
  final titles = <String>[];
  for (var guard = 0; guard < 20 && find.byKey(const ValueKey('app-tour-title')).evaluate().isNotEmpty; guard++) {
    final title = _title(tester);
    titles.add(title);
    _under[title] = shell.where;
    await tester.tap(find.byKey(const ValueKey('app-tour-next')));
    await _settle(tester, frames: frames);
  }
  return titles;
}

void main() {
  test('13 stops for a manager, 11 for anyone else; a missing tab drops its stops', () {
    expect(appTourStopsFor(manager: true, tabs: _allTabs), hasLength(13));
    final employee = appTourStopsFor(manager: false, tabs: _allTabs);
    expect(employee, hasLength(11));
    expect(employee.map((s) => s.title), isNot(contains('Your approvals inbox')));
    expect(employee.map((s) => s.title), isNot(contains('Monthly feedback')));
    expect(appTourStopsFor(manager: true, tabs: const [ManagerTab.connect, ManagerTab.manage, ManagerTab.quick]).map((s) => s.title), isNot(contains('Games, your office game night')));
    expect(appTourStops.where((s) => s.animation != null).map((s) => s.chapter), ['HOME', 'TEAMS · REQUESTS', 'TEAMS · FEEDBACK', 'ACTIONS', 'ACTIONS · ATTENDANCE']);
  });

  testWidgets('a manager: start card, 13 stops over the tabs it opens, the finish card', (tester) async {
    final shell = await _open(tester, manager: true);
    final titles = await _walk(tester, shell);
    expect(titles, appTourStops.map((s) => s.title).toList());
    expect(_under, {
      'Connect, your company Instagram': 'connect',
      'Your stories, for work': 'connect',
      'Your teammates, all in one place': 'manage/myTeam',
      'Your approvals inbox': 'manage/requests',
      'Monthly feedback': 'manage/feedback',
      'Actions, your HR remote': 'quick',
      'Swipe to punch in': 'quick',
      'Swipe to punch out': 'quick',
      'Your work calendar': 'quick',
      'Your HR speed dial': 'quick',
      'Games, your office game night': 'games',
      'Your digital ID card': 'connect',
      'A help desk in your pocket': 'profile',
    });
    // The finish card, over Connect's home; the joiner's lessons noted once.
    expect(find.text('You’re all set, Priya'), findsOneWidget);
    expect(shell.where, 'connect');
    expect(completed, 1);
    await tester.tap(find.byKey(const ValueKey('app-tour-explore')));
    await _settle(tester, frames: 2);
    expect(AppTour.isRunning, isFalse);
    expect(find.byKey(const ValueKey('app-tour-done-card')), findsNothing);
  });

  testWidgets('anyone else: 11 stops, no Requests or Feedback, Teams in their words', (tester) async {
    final shell = await _open(tester, manager: false);
    await tester.tap(find.byKey(const ValueKey('app-tour-start')));
    await _settle(tester);
    expect(_counter(tester), '1 of 11');
    // Back appears from the second stop and returns.
    expect(find.byKey(const ValueKey('app-tour-back')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('app-tour-next')));
    await _settle(tester);
    expect(find.byKey(const ValueKey('app-tour-animation-post')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('app-tour-next')));
    await _settle(tester);
    expect(_title(tester), 'Your teammates, all in one place');
    expect(find.text('Who’s on which team, no more asking around.'), findsOneWidget);
    expect(shell.where, 'manage/myTeam');
    await tester.tap(find.byKey(const ValueKey('app-tour-back')));
    await _settle(tester);
    expect(_title(tester), 'Your stories, for work');
    expect(shell.where, 'connect');
    // On to the end.
    final rest = <String>[];
    while (find.byKey(const ValueKey('app-tour-title')).evaluate().isNotEmpty) {
      rest.add(_title(tester));
      final last = rest.length > 15;
      if (last) break;
      await tester.tap(find.byKey(const ValueKey('app-tour-next')));
      await _settle(tester);
    }
    expect(rest.first, 'Your stories, for work');
    expect(rest, isNot(contains('Your approvals inbox')));
    expect(rest.length, 10);
    expect(find.byKey(const ValueKey('app-tour-done-card')), findsOneWidget);
    // The last stop's button said Finish.
    await tester.tap(find.byKey(const ValueKey('app-tour-replay')));
    await _settle(tester);
    expect(_counter(tester), '1 of 11');
  });

  testWidgets('Skip tour: the spotlight on the header photo, Got it closes it', (tester) async {
    final shell = await _open(tester, manager: true);
    await tester.tap(find.byKey(const ValueKey('app-tour-start')));
    await _settle(tester);
    await tester.tap(find.byKey(const ValueKey('app-tour-next')));
    await _settle(tester);
    await tester.tap(find.byKey(const ValueKey('app-tour-next')));
    await _settle(tester);
    expect(shell.where, 'manage/myTeam');
    await tester.tap(find.byKey(const ValueKey('app-tour-skip')));
    await _settle(tester);
    expect(find.byKey(const ValueKey('app-tour-skipped')), findsOneWidget);
    expect(find.text('No worries, we’ll wait'), findsOneWidget);
    expect(find.text('Find the tour anytime under your profile photo › Help.'), findsOneWidget);
    expect(shell.where, 'connect');
    expect(find.byKey(const ValueKey('app-tour-counter')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('app-tour-got-it')));
    await _settle(tester, frames: 2);
    expect(AppTour.isRunning, isFalse);
    expect(completed, 0);
  });

  testWidgets('Maybe later on the start card is a skip too', (tester) async {
    await _open(tester, manager: false);
    await tester.tap(find.byKey(const ValueKey('app-tour-later')));
    await _settle(tester);
    expect(find.text('No worries, we’ll wait'), findsOneWidget);
  });

  testWidgets('a stop whose widget is not on screen is left out', (tester) async {
    final shell = await _open(tester, manager: true, tabs: const [ManagerTab.connect, ManagerTab.manage, ManagerTab.quick], helpCard: false);
    // No Games tab: 12. The Help card never shows: dropped on the way.
    final titles = await _walk(tester, shell, frames: 50);
    expect(titles, hasLength(11));
    expect(titles, isNot(contains('Games, your office game night')));
    expect(titles, isNot(contains('A help desk in your pocket')));
    expect(find.byKey(const ValueKey('app-tour-done-card')), findsOneWidget);
  });

  testWidgets('every picture plays its whole loop, at the card\'s width', (tester) async {
    for (final kind in AppTourAnimation.values) {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(
              child: SizedBox(width: 326, child: Column(children: [AppTourAnimationPanel(kind: kind), const AppTourGlobe()])),
            ),
          ),
        ),
      );
      for (var ms = 0; ms < 7200; ms += 100) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(tester.getSize(find.byType(AppTourAnimationPanel)), const Size(326, 132), reason: kind.name);
    }
  });
}
