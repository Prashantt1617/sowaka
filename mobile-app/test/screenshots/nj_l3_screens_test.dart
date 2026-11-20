// PNGs of lane L3's screens of the new-joiner prototype (Meetings, a
// meeting, Your team, Tasks, and the lists through the lens), each saved as
// its canvas artboard's name: OnbMeetings, OnbMeeting, TeamList, OnbTasks,
// LensAheadMeetings, LensAheadTasks, NewMonth1Tasks, LensBack.
//
// Drawn by Flutter's test renderer at 393 × 852 (2x) with the app's fonts
// and theme, against fake server answers in the shapes the backend sends
// (test/lifecycle_nj_l3_fixtures.dart). Nothing asserts.
//
//   flutter test test/screenshots/nj_l3_screens_test.dart --tags screenshots \
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
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onb_lists.dart';
import 'package:mobile_app/features/lifecycle/onboarding/timeline/lens_selection.dart';
import 'package:mobile_app/main.dart' show sowakaTheme;
import 'package:shared_preferences/shared_preferences.dart';

import '../lifecycle_nj_l3_fixtures.dart';
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

void _shot(String name, OnboardingHome Function() home, DateTime now, Widget Function(FakeOnboardingApi api, DateTime now) page, {int? lens}) {
  testWidgets(name, skip: _skip != null, (tester) async {
    SharedPreferences.setMockInitialValues({});
    onbLensSelection.value = lens;
    _phone(tester);
    addTearDown(tester.view.reset);
    final api = FakeOnboardingApi()..home = home();
    await tester.pumpWidget(_app(page(api, now)));
    await _save(tester, name);
    onbLensSelection.value = null;
  });
}

void main() {
  setUpAll(() async {
    if (_skip != null) return;
    Directory(_out).createSync(recursive: true);
    await _loadFonts();
  });

  final day1 = DateTime(2026, 12, 1, 10);
  final week1 = DateTime(2026, 12, 3, 10);
  final month1 = DateTime(2026, 12, 15, 10);
  Widget meetings(FakeOnboardingApi api, DateTime now) => OnbMeetingsScreen(shell: shellFor(api, now, name: 'Priya Menon'), source: FakeMeetingsSource());
  Widget tasks(FakeOnboardingApi api, DateTime now) => OnbTasksScreen(shell: shellFor(api, now, name: 'Priya Menon'));

  _shot('OnbMeetings', njDay1, day1, meetings);
  _shot('OnbMeeting', () => njDay1(notes: const ['Ask how the CRM works']), day1, (api, now) {
    final t = api.home.today.firstWhere((t) => t.id == 'mm');
    return JoinerMeetingScreen(shell: shellFor(api, now, name: 'Priya Menon'), task: t, source: FakeMeetingsSource());
  });
  _shot('TeamList', njDay1, day1, (api, now) => TeamListScreen(shell: shellFor(api, now, name: 'Priya Menon'), source: FakeMeetingsSource(), initial: njTeam));
  _shot('OnbTasks', njDay1, day1, tasks);
  _shot('LensAheadMeetings', njWeek1, week1, meetings, lens: 2);
  _shot('LensAheadTasks', njWeek1, week1, tasks, lens: 2);
  _shot('NewMonth1Tasks', njMonth1, month1, tasks);
  _shot('LensBack', njMonth1, month1, tasks, lens: 1);
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
