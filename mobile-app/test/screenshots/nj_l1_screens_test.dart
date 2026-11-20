// PNGs of lane L1's screens of the 20 Nov New joiner artifact, one per drawn
// state, named after the canvas artboard: the Actions tab on the joining date
// (NewActions), its punch-in spotlight (PunchTour), "You're in!"
// (JoinerPunch), "Day 1, done!" (JoinerDone, and with an answer picked) and
// the plant's stages and water (Plant).
//
// Drawn by Flutter's test renderer at 393 × 852 (PNGs at 2x) with the app's
// fonts and theme, against fake server answers. Nothing here asserts.
//
//   flutter test test/screenshots/nj_l1_screens_test.dart --tags screenshots \
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
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/lifecycle_me_store.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/day1_done_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/first_punch.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_kit.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/plant.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/features/manager_shell/presentation/app_bottom_nav.dart';
import 'package:mobile_app/features/policies/data/policies_api_service.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';
import 'package:mobile_app/main.dart' show sowakaTheme;
import 'package:shared_preferences/shared_preferences.dart';

import '../lifecycle_onboarding_test.dart' show FakeOnboardingApi;

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
  addTearDown(tester.view.reset);
}

Widget _app(Widget home, {bool still = true}) => RepaintBoundary(
  key: _shotKey,
  child: MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: sowakaTheme(),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(disableAnimations: still),
      child: child!,
    ),
    home: home,
  ),
);

Future<void> _shot(WidgetTester tester, String name) async {
  await tester.pump();
  await tester.runAsync(() async {
    final boundary = _shotKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await boundary.toImage(pixelRatio: _dpr);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    File('$_out/$name.png').writeAsBytesSync(bytes!.buffer.asUint8List());
  });
}

Future<void> _frames(WidgetTester tester, [int n = 10]) async {
  for (var i = 0; i < n; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> _loadFonts() async {
  Future<ByteData> file(String path) async => ByteData.sublistView(File(path).readAsBytesSync());
  for (final (family, path) in [
    ('Plus Jakarta Sans', 'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf'),
    ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
  ]) {
    await (FontLoader(family)..addFont(rootBundle.load(path))).load();
  }
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '/opt/homebrew/share/flutter';
  final material = '$flutterRoot/bin/cache/artifacts/material_fonts';
  await (FontLoader('MaterialIcons')..addFont(file('$material/MaterialIcons-Regular.otf'))).load();
  final roboto = FontLoader('Roboto');
  for (final weight in ['Regular', 'Medium', 'Bold', 'Light']) {
    roboto.addFont(file('$material/Roboto-$weight.ttf'));
  }
  await roboto.load();
}

// ───────────────────────────────────────────────────────────────── data

const _user = AuthUser(
  id: 'isha',
  email: 'isha.verma@sowaka.test',
  name: 'Isha Verma',
  role: 'employee',
  company: 'Sowaka',
  org: 'sowaka',
  designation: 'Product Designer',
  department: 'Design',
);
const _session = AuthSession(token: 'isha-token', user: _user);

http.Response _json(Object body) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

/// `/manager/workspace` and friends for a joiner who punches in from the app.
MockClient _managerClient() => MockClient((request) async {
  final path = request.url.path;
  if (path.endsWith('/manager/workspace')) {
    return _json({
      'success': true,
      'team': <dynamic>[],
      'recognitionCandidates': <dynamic>[],
      'nominations': <dynamic>[],
      'recognitionHistory': <dynamic>[],
      'myParameters': <dynamic>[],
      'growthHistory': <dynamic>[],
      'holidays': <dynamic>[],
      'myOrgChart': <dynamic>[],
      'weekoffDays': [0],
      'shift': {
        'name': 'Default',
        'startTime': '09:30',
        'endTime': '18:30',
        'weeklyOff': {'1': [0], '2': [0], '3': [0], '4': [0], '5': [0]},
        'leaveTypes': [
          {'key': 'casual', 'name': 'Casual Leave', 'advanceDays': 30, 'allowBackdated': true, 'backdatedDays': 30},
        ],
        'leaveBalanceTracked': true,
        'correction': {'triggers': ['Missing punch-in'], 'backdateDays': 15, 'punchFormat': 'In-app punch in', 'punchMode': 'Both punches'},
      },
      'overtimeEnabled': true,
      'hasManager': true,
      'teamLevel': 1,
      'managerScore': 0,
    });
  }
  if (path.endsWith('/leaves/balance')) {
    return _json({
      'success': true,
      'balance': {
        'year': 2026,
        'types': [
          {'key': 'casual', 'name': 'Casual Leave', 'total': 8, 'used': 0, 'remaining': 8},
        ],
      },
    });
  }
  return _json({
    'success': true,
    'leaves': <dynamic>[],
    'overtime': <dynamic>[],
    'regularizations': <dynamic>[],
    'claims': <dynamic>[],
    'types': <dynamic>[],
    'records': <dynamic>[],
    'balance': <String, dynamic>{},
  });
});

/// Three policies to acknowledge, as `GET /policies` answers.
PoliciesApiService _policies() => PoliciesApiService(
  session: _session,
  baseUrl: 'https://example.test',
  client: MockClient((_) async => _json({
    'success': true,
    'policies': [
      for (final (key, title) in [('leave', 'Leave'), ('conduct', 'Code of Conduct'), ('posh', 'POSH')])
        {'key': key, 'title': title, 'body': 'Read me.', 'order': 10, 'version': 1, 'ackRequired': true, 'updatedAt': '2026-11-10T09:30:00.000Z'},
    ],
  })),
);

LifecycleMe _day1Me() => LifecycleMe.fromJson({
  'enabled': true,
  'onboarding': {'journeyId': 'j1', 'stage': 'welcome_week1', 'dayLabel': 'Day 1', 'tileVisible': true, 'portal': false},
});

final _today = DateTime.now();

OnboardingHome _home({String? feeling}) => OnboardingHome.fromJson({
  'journeyId': 'j1',
  'stage': 'welcome_week1',
  'dayLabel': 'Day 1',
  'tj': '${_today.year}-${_today.month.toString().padLeft(2, '0')}-${_today.day.toString().padLeft(2, '0')}',
  'plant': {'stage': 1},
  'progress': {'done': 7, 'total': 12},
  'firstPunch': {'at': DateTime(_today.year, _today.month, _today.day, 10, 42).toIso8601String(), 'faceEnrolled': true},
  'day1': {'peopleMet': 5, 'thingsDone': 7, 'feeling': ?feeling},
});

OnboardingShell _shell(FakeOnboardingApi api) => OnboardingShell(
  api: api,
  profileAction: Container(
    width: 30,
    height: 30,
    alignment: Alignment.center,
    decoration: const BoxDecoration(color: Color(0xFFE0F2FE), shape: BoxShape.circle),
    child: const Text('I', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: Color(0xFF0571A6))),
  ),
  onNotifications: () {},
  tabs: visibleTabs(const []),
  selectedTab: ManagerTab.quick,
  onSelectTab: (_) {},
  viewerName: _user.name,
);

// ───────────────────────────────────────────────────────────────── shots

void main() {
  setUpAll(() async {
    if (_skip != null) return;
    TestWidgetsFlutterBinding.ensureInitialized();
    Directory(_out).createSync(recursive: true);
    await _loadFonts();
  });

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    forgetPolicies();
    LifecycleMeStore.instance.value = _day1Me();
    FirstPunchTour.requested.value = false;
  });
  tearDown(LifecycleMeStore.instance.clear);

  Future<void> actions(WidgetTester tester, {required bool tour}) async {
    _phone(tester);
    final bloc = ManagerBloc(
      session: _session,
      service: ManagerApiService(session: _session, baseUrl: 'https://example.test', client: _managerClient()),
    );
    await tester.runAsync(() => bloc.add(const LoadManagerDashboard()));
    final controller = QuickActionsController();
    addTearDown(() {
      bloc.dispose();
      controller.dispose();
    });
    if (tour) FirstPunchTour.requested.value = true;
    await tester.pumpWidget(
      _app(
        Scaffold(
          body: QuickActionsScreen(
            bloc: bloc,
            dashboard: bloc.state.dashboard!,
            controller: controller,
            profileAction: _shell(FakeOnboardingApi()).profileAction,
            onNotifications: () {},
            onOpenComposer: () {},
            policies: _policies(),
          ),
          bottomNavigationBar: AppBottomNav(tabs: visibleTabs(const []), selected: ManagerTab.quick, onSelect: (_) {}),
        ),
      ),
    );
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200)));
    await _frames(tester);
  }

  testWidgets('NewActions', skip: _skip != null, (tester) async {
    await actions(tester, tour: false);
    await _shot(tester, 'NewActions');
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('PunchTour', skip: _skip != null, (tester) async {
    await actions(tester, tour: true);
    await _shot(tester, 'PunchTour');
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('JoinerPunch', skip: _skip != null, (tester) async {
    _phone(tester);
    final api = FakeOnboardingApi()..home = _home();
    await tester.pumpWidget(_app(YoureInScreen(shell: _shell(api), at: DateTime(_today.year, _today.month, _today.day, 10, 42))));
    await _frames(tester);
    await _shot(tester, 'JoinerPunch');
  });

  testWidgets('JoinerDone', skip: _skip != null, (tester) async {
    _phone(tester);
    final api = FakeOnboardingApi()..home = _home();
    await tester.pumpWidget(_app(Day1DoneScreen(shell: _shell(api), saveFeeling: (a) async => a)));
    await _frames(tester);
    await _shot(tester, 'JoinerDone');
    await tester.tap(find.byKey(const ValueKey('day1-feeling-great')));
    await _frames(tester, 3);
    await _shot(tester, 'JoinerDone-great');
  });

  testWidgets('Plant', skip: _skip != null, (tester) async {
    _phone(tester);
    await tester.pumpWidget(
      _app(
        Scaffold(
          backgroundColor: OnbColors.screen,
          body: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Wrap(
                spacing: 12,
                runSpacing: 16,
                children: [
                  for (final (stage, water) in [(0, 0), (0, 1), (0, 2), (0, 3), (1, 0), (2, 0), (3, 0), (4, 0), (5, 0)])
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Plant(stage: stage, water: water, size: 100),
                        const SizedBox(height: 4),
                        Text(stage == 0 ? 'Seed · water $water' : PlantState.stageNames[stage], style: OnbText.label),
                      ],
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    await _frames(tester, 3);
    await _shot(tester, 'Plant');
  });
}
