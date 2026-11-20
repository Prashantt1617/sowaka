// PNGs of lane L5's screens: the manager side of the team-side canvas
// (MgrTeamsProto, role manager), each saved as its canvas artboard's name:
// MgrProtoJoiners, MgrProtoPriya (LayoutC is the same page), MgrAllTasks,
// MgrMeeting, MgrReview, MgrReachOut, MgrProgress, plus the lists View
// progress opens (MgrProgressMeetings, MgrProgressTasks).
//
// Drawn by Flutter's test renderer at 393 × 852 (2x) with the app's fonts
// and theme, against fake server answers in the shapes the backend sends
// (test/lifecycle_manager_fixtures.dart). Nothing asserts.
//
//   flutter test test/screenshots/nj_l5_screens_test.dart --tags screenshots \
//     --dart-define=SCREENS_OUT=<dir>
//
// Without SCREENS_OUT every test here is skipped.
@Tags(['screenshots'])
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/team_joiners_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/joiner_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/joiners_tab.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/manager_review_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/team_kit.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/team_meeting_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_kit.dart';
import 'package:mobile_app/main.dart' show sowakaTheme;
import 'package:shared_preferences/shared_preferences.dart';

import '../lifecycle_manager_fixtures.dart';
import '../lifecycle_onboarding_test.dart' show FakeOnboardingApi, shellFor;

const _out = String.fromEnvironment('SCREENS_OUT');
const _skip = _out == '' ? 'Screenshots: pass --dart-define=SCREENS_OUT=<dir>' : null;

const _width = 393.0;
const _height = 852.0;
const _dpr = 2.0;
final _shotKey = GlobalKey();

void _phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(_width * _dpr, _height * _dpr);
  tester.view.devicePixelRatio = _dpr;
  const inset = FakeViewPadding(top: 59 * _dpr, bottom: 34 * _dpr);
  tester.view.padding = inset;
  tester.view.viewPadding = inset;
}

Widget _app(Widget home) => RepaintBoundary(
  key: _shotKey,
  child: MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: sowakaTheme(),
    builder: (context, child) => MediaQuery(data: MediaQuery.of(context).copyWith(disableAnimations: true), child: child!),
    home: home,
  ),
);

Future<void> _save(WidgetTester tester, String name) async {
  await tester.pumpAndSettle();
  await tester.runAsync(() async {
    final boundary = _shotKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await boundary.toImage(pixelRatio: _dpr);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    File('$_out/$name.png').writeAsBytesSync(bytes!.buffer.asUint8List());
  });
  // ignore: avoid_print
  print('shot $name');
}

final _day1 = DateTime(2026, 12, 1, 10);
final _month3 = DateTime(2026, 12, 10, 10);

/// [name]: the page drawn for the manager (Sunny Kapoor), from [team]'s page and [joiner].
void _shot(String name, Widget Function(FakeOnboardingApi api, FakeTeamApi team) page, {Map<String, dynamic>? teamPage, Map<String, dynamic>? joiner, Future<void> Function(WidgetTester tester)? then}) {
  testWidgets(name, skip: _skip != null, (tester) async {
    SharedPreferences.setMockInitialValues({});
    _phone(tester);
    addTearDown(tester.view.reset);
    final api = FakeOnboardingApi()..joiner = JoinerDetail.fromJson(joiner ?? managerJoinerJson());
    final team = FakeTeamApi(teamPage ?? priyaDay1Page(), rows: mgrJoinerRows);
    await tester.pumpWidget(_app(page(api, team)));
    await tester.pumpAndSettle();
    if (then != null) await then(tester);
    await _save(tester, name);
  });
}

void main() {
  setUpAll(() async {
    if (_skip != null) return;
    Directory(_out).createSync(recursive: true);
    await _loadFonts();
  });

  final rahul = managerJoinerJson(journeyId: 'j3', name: 'Rahul Verma', tj: '2026-09-16', stage: 'growing_gains', withMonth3: true);
  JoinerScreen priya(FakeOnboardingApi api, FakeTeamApi team, {JoinerPage page = JoinerPage.main, DateTime? now}) =>
      JoinerScreen(shell: shellFor(api, now ?? _day1, name: 'Sunny Kapoor'), journeyId: 'j1', teamApi: team, page: page);

  // Teams › Joiners: the pills (Joiners the last one), one card of rows.
  _shot('MgrProtoJoiners', (api, team) => Scaffold(
    backgroundColor: OnbColors.screen,
    body: SafeArea(
      child: Column(
        children: [
          Container(
            color: Colors.white,
            child: TeamSectionPills(
              pills: [
                const TeamPillSpec(key: 'myTeam', label: 'My Team'),
                const TeamPillSpec(key: 'requests', label: 'Requests'),
                const TeamPillSpec(key: 'feedback', label: 'Feedback'),
                TeamPillSpec(key: 'joiners', label: 'Joiners', count: mgrJoinerRows.length, countColor: TeamColors.joinersCount),
              ],
              selected: 'joiners',
              onSelect: (_) {},
            ),
          ),
          Expanded(child: JoinersTab(shell: shellFor(api, _day1, name: 'Sunny Kapoor'), teamApi: team)),
        ],
      ),
    ),
  ));
  _shot('MgrProtoPriya', (api, team) => priya(api, team));
  _shot('LayoutC', (api, team) => priya(api, team));
  _shot('MgrAllTasks', (api, team) => priya(api, team, page: JoinerPage.tasks));
  _shot('MgrMeeting', (api, team) {
    final t = TeamJoinerPage.fromJson(priyaDay1Page()).tasks.firstWhere((t) => t.id == 'mm');
    return TeamMeetingScreen(
      shell: shellFor(api, _day1, name: 'Sunny Kapoor'),
      title: t.title,
      joinerName: 'Priya Menon',
      agenda: t.agenda,
      canTick: t.canTick,
      onFinish: (_, _) async {},
    );
  });
  _shot('MgrReview', (api, team) => ManagerReviewScreen(shell: shellFor(api, _month3, name: 'Sunny Kapoor'), teamApi: team, journeyId: 'j3', month: 3, title: 'Review Rahul’s Month-3 self check-in'),
      teamPage: rahulMonth3Page(), joiner: rahul);
  _shot('MgrRahul', (api, team) => JoinerScreen(shell: shellFor(api, _month3, name: 'Sunny Kapoor'), journeyId: 'j3', teamApi: team),
      teamPage: rahulMonth3Page(), joiner: rahul);
  _shot('MgrReachOut', (api, team) => priya(api, team, page: JoinerPage.reachOut));
  _shot('MgrProgress', (api, team) => priya(api, team, page: JoinerPage.progress), teamPage: priyaDay1Page(delayed: true));
  _shot('MgrProgressMeetings', (api, team) => priya(api, team, page: JoinerPage.theirMeetings));
  _shot('MgrProgressTasks', (api, team) => priya(api, team, page: JoinerPage.theirTasks));
}

Future<void> _loadFonts() async {
  Future<ByteData> file(String path) async => ByteData.sublistView(File(path).readAsBytesSync());
  await (FontLoader('Plus Jakarta Sans')..addFont(rootBundle.load('assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf'))).load();
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '/opt/homebrew/share/flutter';
  final material = '$flutterRoot/bin/cache/artifacts/material_fonts';
  await (FontLoader('MaterialIcons')..addFont(file('$material/MaterialIcons-Regular.otf'))).load();
  final roboto = FontLoader('Roboto');
  for (final weight in ['Regular', 'Medium', 'Bold', 'Light']) {
    roboto.addFont(file('$material/Roboto-$weight.ttf'));
  }
  await roboto.load();
}
