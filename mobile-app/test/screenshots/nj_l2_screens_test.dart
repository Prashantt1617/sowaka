// PNGs of lane L2's screens of the 20 Nov new-joiner prototype: the
// onboarding home in each phase and through the lens, and its simple tabs
// (Devices and accesses, Watch list, Your profile). Each file is named after
// the canvas artboard it draws (Main.png is Day 1 before the first punch-in).
//
// Drawn by Flutter's test renderer at 393 × 852 (PNGs at 2x) with the app's
// fonts and theme, against a fake server answering the home as
// appOnboarding.ts sends it (test/nj_l2_homes.dart). Nothing here asserts;
// problems (overflows, exceptions) go to nj_l2_results.json beside the PNGs.
//
//   flutter test test/screenshots/nj_l2_screens_test.dart --tags screenshots \
//     --dart-define=SCREENS_OUT=<dir>
//
// Without SCREENS_OUT every test here is skipped.
@Tags(['screenshots'])
library;

import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/lifecycle_me_store.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_home_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_home_tabs.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_kit.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_tiles.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/main.dart' show sowakaTheme;
import 'package:shared_preferences/shared_preferences.dart';

import '../lifecycle_onboarding_test.dart' show FakeOnboardingApi;
import '../nj_l2_homes.dart';

const _out = String.fromEnvironment('SCREENS_OUT');
const _skip = _out == '' ? 'Screenshots: pass --dart-define=SCREENS_OUT=<dir>' : null;

const _width = 393.0;
const _height = 852.0;
const _dpr = 2.0;

final _shotKey = GlobalKey();
final _results = <Map<String, Object?>>[];

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

OnboardingShell _shell(FakeOnboardingApi api, DateTime now) => OnboardingShell(
  api: api,
  profileAction: Container(
    width: 30,
    height: 30,
    alignment: Alignment.center,
    decoration: const BoxDecoration(color: Color(0xFFE0F2FE), shape: BoxShape.circle),
    child: const Text('I', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: Color(0xFF0571A6))),
  ),
  onNotifications: () {},
  tabs: const [ManagerTab.connect, ManagerTab.quick, ManagerTab.care],
  selectedTab: ManagerTab.quick,
  onSelectTab: (_) {},
  viewerName: 'Isha Verma',
  now: () => now,
);

Future<void> _write(WidgetTester tester, String name) async {
  await tester.runAsync(() async {
    final boundary = _shotKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await boundary.toImage(pixelRatio: _dpr);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    File('$_out/$name.png').writeAsBytesSync(bytes!.buffer.asUint8List());
  });
}

/// One artboard: [build] the page, [then] (a tap), the PNG named [name].
void _shot(String name, NjPhase phase, Widget Function(OnboardingShell shell) build, {int? profileDone, Future<void> Function(WidgetTester tester)? then}) {
  testWidgets(name, skip: _skip != null, (tester) async {
    final problems = <String>[];
    final before = FlutterError.onError;
    FlutterError.onError = (d) => problems.add(d.exceptionAsString().split('\n').first);
    try {
      SharedPreferences.setMockInitialValues({});
      LifecycleMeStore.instance.clear();
      _phone(tester);
      final api = FakeOnboardingApi()..home = njHome(phase, profileDone: profileDone);
      await tester.pumpWidget(_app(build(_shell(api, njNow(phase)))));
      await tester.pumpAndSettle(const Duration(milliseconds: 100), EnginePhase.sendSemanticsUpdate, const Duration(seconds: 5));
      if (then != null) {
        await then(tester);
        await tester.pumpAndSettle(const Duration(milliseconds: 100), EnginePhase.sendSemanticsUpdate, const Duration(seconds: 5));
      }
      await _write(tester, name);
      // The page below the fold too, when it scrolls.
      final pages = find.byType(Scrollable).evaluate().map((e) => (e as StatefulElement).state as ScrollableState)
          .where((s) => s.axisDirection == AxisDirection.down && s.position.hasContentDimensions && s.position.maxScrollExtent > 0);
      if (pages.isNotEmpty) {
        final extra = pages.map((s) => s.position.maxScrollExtent).reduce((a, b) => a > b ? a : b);
        tester.view.physicalSize = Size(_width * _dpr, (_height + extra) * _dpr);
        await tester.pumpAndSettle(const Duration(milliseconds: 100), EnginePhase.sendSemanticsUpdate, const Duration(seconds: 5));
        await _write(tester, '$name-full');
      }
    } catch (e) {
      problems.add('$e'.split('\n').first);
    } finally {
      FlutterError.onError = before;
      _results.add({'shot': '$name.png', 'problems': problems});
      // ignore: avoid_print
      print('shot $name${problems.isEmpty ? '' : '  PROBLEMS: ${problems.join(' | ')}'}');
      await tester.pumpWidget(const SizedBox.shrink());
      tester.view.reset();
    }
  });
}

Future<void> _loadFonts() async {
  Future<ByteData> file(String path) async => ByteData.sublistView(File(path).readAsBytesSync());
  for (final (family, path) in [
    ('Plus Jakarta Sans', 'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf'),
    ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
    ('Manrope', 'assets/fonts/manrope/Manrope-Variable.ttf'),
    ('Figtree', 'assets/fonts/figtree/Figtree-Variable.ttf'),
    ('Lexend', 'assets/fonts/lexend/Lexend-Variable.ttf'),
  ]) {
    await (FontLoader(family)..addFont(rootBundle.load(path))).load();
  }
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '/opt/homebrew/share/flutter';
  final material = '$flutterRoot/bin/cache/artifacts/material_fonts';
  await (FontLoader('MaterialIcons')..addFont(file('$material/MaterialIcons-Regular.otf'))).load();
  final roboto = FontLoader('Roboto');
  for (final weight in ['Regular', 'Medium', 'Bold']) {
    roboto.addFont(file('$material/Roboto-$weight.ttf'));
  }
  await roboto.load();
}

Future<void> _tapStage(WidgetTester tester, String step) async {
  final chip = find.byKey(ValueKey('stage-step-$step'));
  await tester.ensureVisible(chip);
  await tester.pumpAndSettle();
  await tester.tap(chip);
}

void main() {
  setUpAll(() async {
    if (_skip != null) return;
    Directory(_out).createSync(recursive: true);
    await _loadFonts();
  });
  tearDownAll(() {
    if (_skip != null) return;
    File('$_out/nj_l2_results.json').writeAsStringSync(const JsonEncoder.withIndent('  ').convert(_results));
  });

  // The home, phase by phase.
  _shot('Main', NjPhase.day1, (s) => OnboardingHomeScreen(shell: s));
  _shot('JoinerDay1Later', NjPhase.day1Later, (s) => OnboardingHomeScreen(shell: s));
  // The profile all done (the server has no "filled in by HR" yet: see the report).
  _shot('OnbHomeHR', NjPhase.day1, (s) => OnboardingHomeScreen(shell: s), profileDone: 7);
  _shot('NewWeek1', NjPhase.week1, (s) => OnboardingHomeScreen(shell: s));
  _shot('NewMonth1', NjPhase.month1, (s) => OnboardingHomeScreen(shell: s));
  _shot('NewMonths', NjPhase.months, (s) => OnboardingHomeScreen(shell: s));
  _shot('NewFinal', NjPhase.last, (s) => OnboardingHomeScreen(shell: s));
  _shot('NewConfirmed', NjPhase.confirmed, (s) => OnboardingHomeScreen(shell: s));
  // Through the lens: Week 1 looking at Month 1; Month 1 looking back at Week 1.
  _shot('LensAhead', NjPhase.week1, (s) => OnboardingHomeScreen(shell: s), then: (t) => _tapStage(t, 'Month 1'));
  _shot('LensBack-home', NjPhase.month1, (s) => OnboardingHomeScreen(shell: s), then: (t) => _tapStage(t, 'Week 1'));

  // The tabs.
  _shot('OnbAccess', NjPhase.day1, (s) => OnbDevicesScreen(shell: s, devices: njHome(NjPhase.day1).devices));
  _shot('OnbWatch', NjPhase.day1, (s) => OnbWatchScreen(shell: s, home: njHome(NjPhase.day1)));
  _shot('OnbProfile', NjPhase.day1, (s) => OnbProfileScreen(shell: s, profile: njHome(NjPhase.day1).profile!));
}
