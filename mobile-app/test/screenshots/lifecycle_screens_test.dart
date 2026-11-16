// PNGs of every employee-lifecycle screen in the app, for review: the joiner
// (A1–A12), probation (PB1–PB3), the manager (M0–M3 and the set-up page),
// the person leaving and their manager (R0–R8b), and the Payroll lock.
//
// No phone or simulator: each screen is drawn by Flutter's test renderer at
// 393 × 852 (3x) with the app's own fonts and theme, against a fake server
// that answers from test/fixtures/lifecycle/*.json (the backend's
// `npm run lifecycle:fixtures`, i.e. what the real server sends). States the
// fixtures do not hold are built from the same shapes.
//
// Nothing here asserts. A screen that overflows or throws is still drawn and
// its problems go to results.json beside the PNGs: those are real app bugs.
//
//   tool/lifecycle_screens.sh [out-dir]
//
// or by hand:
//
//   flutter test test/screenshots --tags screenshots \
//     --dart-define=SCREENS_OUT=<dir>
//
// Without SCREENS_OUT every test here is skipped, so the normal suite never
// runs it.
@Tags(['screenshots'])
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
// ignore: depend_on_referenced_packages
import 'package:local_auth_platform_interface/local_auth_platform_interface.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/lifecycle/offboarding/offboarding.dart' as off;
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/onboarding_launcher.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/joiner_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/joiner_setup_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/probation_review_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/starter_review_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/meeting_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/notes_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/intro_post_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_home_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/people_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/probation_screens.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/starter_task_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/survey_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/week1_reels_screen.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/week_done_screen.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';
import 'package:mobile_app/features/notifications/presentation/notification_inbox_screen.dart';
import 'package:mobile_app/features/payroll/presentation/payroll_lock.dart';
import 'package:mobile_app/main.dart' show sowakaTheme;
import 'package:mobile_app/services/api_client.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _out = String.fromEnvironment('SCREENS_OUT');
const _skip = _out == '' ? 'Screenshots: run tool/lifecycle_screens.sh (sets SCREENS_OUT)' : null;

// ───────────────────────────────────────────────────────────────── phone

const _width = 393.0;
const _height = 852.0;
const _dpr = 3.0;

/// iPhone 15/16: the Dynamic Island's status bar and the home indicator.
const _top = 59.0;
const _bottom = 34.0;

void _phone(WidgetTester tester, {double height = _height}) {
  tester.view.physicalSize = Size(_width * _dpr, height * _dpr);
  tester.view.devicePixelRatio = _dpr;
  final inset = FakeViewPadding(top: _top * _dpr, bottom: _bottom * _dpr);
  tester.view.padding = inset;
  tester.view.viewPadding = inset;
}

/// The app's theme, with the phone's colour-emoji font as the fallback a
/// device has built in (the test renderer has no system fonts).
ThemeData _theme() {
  final base = sowakaTheme();
  return base.copyWith(
    textTheme: base.textTheme.apply(fontFamilyFallback: const ['Apple Color Emoji']),
    primaryTextTheme: base.primaryTextTheme.apply(fontFamilyFallback: const ['Apple Color Emoji']),
  );
}

// ───────────────────────────────────────────────────────────────── people

const _joinerUser = AuthUser(
  id: 'isha',
  email: 'isha.verma@sowaka.test',
  name: 'Isha Verma',
  role: 'employee',
  company: 'Sowaka',
  org: 'sowaka',
  designation: 'Product Designer',
  department: 'Design',
  managerName: 'Meera Iyer',
  employeeId: 'SW118',
);
const _joiner = AuthSession(token: 'isha-token', user: _joinerUser);

const _managerUser = AuthUser(
  id: 'mgr',
  email: 'meera.iyer@sowaka.test',
  name: 'Meera Iyer',
  role: 'manager',
  company: 'Sowaka',
  org: 'sowaka',
  designation: 'Design Lead',
  department: 'Design',
  employeeId: 'SW031',
);
const _manager = AuthSession(token: 'mgr-token', user: _managerUser);

const _leaverUser = AuthUser(
  id: 'ravi',
  email: 'ravi.menon@sowaka.test',
  name: 'Ravi Menon',
  role: 'employee',
  company: 'Sowaka',
  org: 'sowaka',
  designation: 'Senior Designer',
  department: 'Design',
  managerName: 'Meera Iyer',
  employeeId: 'SW042',
);
const _leaver = AuthSession(token: 'ravi-token', user: _leaverUser);

Map<String, dynamic> _member(
  String id,
  String name, {
  String designation = 'Product Designer',
  bool reportsToViewer = false,
  bool isSelf = false,
  bool isManager = false,
}) => {
  'userId': id,
  'name': name,
  'department': 'Design',
  'designation': designation,
  'reportsToViewer': reportsToViewer,
  'inViewerChain': reportsToViewer,
  'isSelf': isSelf,
  'isManager': isManager,
  'email': '${name.split(' ').first.toLowerCase()}@sowaka.test',
  'parameters': <dynamic>[],
  'history': <dynamic>[],
};

// ───────────────────────────────────────────────────────────────── fixtures

final _fixtureText = <String, String>{};

/// A fresh copy of test/fixtures/lifecycle/[name].json. The scratch company
/// the backend made them in is shown as Sowaka.
Map<String, dynamic> fx(String name) {
  final text = _fixtureText.putIfAbsent(name, () {
    return File('test/fixtures/lifecycle/$name.json')
        .readAsStringSync()
        .replaceAll('Fixture Works', 'Sowaka')
        .replaceAll('@fixture.test', '@sowaka.test')
        .replaceAll('el-fixtures', 'sowaka');
  });
  return (jsonDecode(text) as Map).cast<String, dynamic>();
}

List<Map<String, dynamic>> _list(Object? raw) => [for (final item in raw as List? ?? const []) (item as Map).cast<String, dynamic>()];

String _iso(DateTime local) => local.toUtc().toIso8601String();

/// The joiner's first day (local midnight), as the fixtures have it.
DateTime get _tj {
  final tj = DateTime.parse(fx('onboarding_home')['tj'] as String);
  return DateTime(tj.year, tj.month, tj.day);
}

DateTime _at(int dayOffset, int hour, [int minute = 0]) => DateTime(_tj.year, _tj.month, _tj.day + dayOffset, hour, minute);

// ───────────────────────────────────────────────────────────────── server

typedef _Reply = FutureOr<Object?> Function(http.Request request, Object? body);

/// Answers the app's calls from fixtures. Each test sets its routes; the
/// first route whose method matches and whose pattern is found in the path
/// answers. Anything else gets an empty success (lists empty), or 404 under
/// /lifecycle.
class _Server {
  final routes = <(String, RegExp, _Reply)>[];
  final calls = <String>[];

  void on(String method, String pattern, Object? reply) {
    routes.insert(0, (method, RegExp(pattern), reply is _Reply ? reply : (_, _) => reply));
  }

  Future<http.Response> handle(http.Request request) async {
    final path = request.url.path;
    calls.add('${request.method} $path');
    Object? body;
    final type = request.headers['content-type'] ?? '';
    if (type.startsWith('application/json') && request.body.isNotEmpty) {
      try {
        body = jsonDecode(request.body);
      } catch (_) {}
    }
    for (final (method, pattern, reply) in routes) {
      if (method == request.method && pattern.hasMatch(path)) {
        final answer = await reply(request, body);
        if (answer is http.Response) return answer;
        return _json(answer);
      }
    }
    if (path.contains('/lifecycle/')) return _json({'error': 'Not available'}, 404);
    // Images and media: nothing to show.
    if (RegExp(r'\.(png|jpe?g|webp|gif|svg|mp4)$').hasMatch(path) || path.contains('/media/')) {
      return http.Response('', 404);
    }
    return _json({
      'success': true,
      'leaves': <dynamic>[],
      'overtime': <dynamic>[],
      'regularizations': <dynamic>[],
      'claims': <dynamic>[],
      'types': <dynamic>[],
      'records': <dynamic>[],
      'posts': <dynamic>[],
      'notifications': <dynamic>[],
      'items': <dynamic>[],
      'balance': <String, dynamic>{},
      'nextCursor': null,
      'total': 0,
    });
  }
}

http.Response _json(Object? body, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

_Server _server = _Server();
final http.Client _router = MockClient((request) => _server.handle(request));

// ───────────────────────────────────────────────────────────────── phone lock

/// The phone's lock, as `local_auth` reports it.
class _FakeLocalAuth extends LocalAuthPlatform {
  bool hasLock = true;
  bool approve = false;

  @override
  Future<bool> authenticate({
    required String localizedReason,
    required Iterable<AuthMessages> authMessages,
    AuthenticationOptions options = const AuthenticationOptions(),
  }) async => approve;

  @override
  Future<bool> isDeviceSupported() async => hasLock;

  @override
  Future<bool> deviceSupportsBiometrics() async => hasLock;

  @override
  Future<List<BiometricType>> getEnrolledBiometrics() async => const [BiometricType.face];

  @override
  Future<bool> stopAuthentication() async => true;
}

final _localAuth = _FakeLocalAuth();

// ───────────────────────────────────────────────────────────────── shots

final _shotKey = GlobalKey();
final _nav = GlobalKey<NavigatorState>();
final _results = <Map<String, Object?>>[];
final _taken = <String>{};

class _Shots {
  _Shots(this.tester, this.scenario);
  final WidgetTester tester;
  final String scenario;
  final _pending = <String>[];

  void onError(FlutterErrorDetails details) {
    final text = details.exceptionAsString().trim();
    if (text.contains('HTTP request failed') || text.contains('NetworkImageLoadException') || text.contains('statusCode: 404')) {
      return;
    }
    final where = RegExp(r'(package:mobile_app/[\w/]+\.dart):(\d+)').firstMatch(details.toString());
    _pending.add('${where == null ? '' : '[${where.group(1)}:${where.group(2)}] '}${text.split('\n').first}');
  }

  /// The vertical list that scrolls the most: the page's own.
  ScrollableState? _page() {
    ScrollableState? best;
    for (final element in find.byType(Scrollable).evaluate()) {
      final state = (element as StatefulElement).state as ScrollableState;
      final position = state.position;
      if (state.axisDirection != AxisDirection.down || !position.hasContentDimensions || !position.hasViewportDimension) continue;
      if (position.viewportDimension < 300) continue;
      if (best == null || position.maxScrollExtent > best.position.maxScrollExtent) best = state;
    }
    return best;
  }

  Future<void> _write(String file) async {
    await tester.runAsync(() async {
      final boundary = _shotKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: _dpr);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      image.dispose();
      File('$_out/$file').writeAsBytesSync(bytes!.buffer.asUint8List());
    });
  }

  /// `<CODE>-<state>.png`, and `-full` beside it when the page runs on below
  /// the fold (unless [full] is false: sheets, dialogs, reels).
  Future<void> call(String code, String state, {bool full = true, String note = ''}) async {
    await _images();
    await tester.pump();
    final exception = tester.takeException();
    if (exception != null) _pending.add('exception: ${'$exception'.split('\n').first}');
    final name = state.isEmpty ? code : '$code-$state';
    if (!_taken.add(name)) throw StateError('two shots named $name');
    await _write('$name.png');
    final files = ['$name.png'];
    final page = full ? _page() : null;
    final extra = page?.position.maxScrollExtent ?? 0;
    if (page != null && extra > 24 && page.position.pixels == 0) {
      final tall = (_height + extra).clamp(_height, 6000.0);
      _phone(tester, height: tall);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      await _images();
      await tester.pump();
      await _write('$name-full.png');
      files.add('$name-full.png');
      _phone(tester);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
    }
    final record = {'shot': name, 'files': files, 'scenario': scenario, 'note': note, 'problems': [..._pending]};
    _results.add(record);
    // ignore: avoid_print
    print('shot $name${_pending.isEmpty ? '' : '  PROBLEMS: ${_pending.join(' | ')}'}');
    _pending.clear();
  }

  Future<void> _images() async {
    await tester.runAsync(() async {
      for (final element in find.byType(Image).evaluate()) {
        try {
          await precacheImage((element.widget as Image).image, element).timeout(const Duration(seconds: 2));
        } catch (_) {}
      }
      await Future<void>.delayed(const Duration(milliseconds: 30));
    });
  }

  void finish(Object? failure) {
    if (_pending.isEmpty && failure == null) return;
    _results.add({'shot': '$scenario (after the last shot)', 'scenario': scenario, 'problems': [..._pending], 'failure': failure?.toString()});
    // ignore: avoid_print
    print('after $scenario: ${_pending.join(' | ')} ${failure ?? ''}');
    _pending.clear();
  }
}

/// One test per scenario; a failure is recorded, not thrown, so the other
/// screens still get their pictures.
void _scenario(String name, Future<void> Function(WidgetTester tester, _Shots shot) body) {
  testWidgets(name, skip: _skip != null, (tester) async {
    final shot = _Shots(tester, name);
    final before = FlutterError.onError;
    FlutterError.onError = shot.onError;
    _server = _Server();
    _localAuth
      ..hasLock = true
      ..approve = false;
    SharedPreferences.setMockInitialValues({});
    LifecycleMeStore.instance.clear();
    off.OffboardingStore.reset();
    PayrollLockSession.instance.lock();
    Object? failure;
    try {
      _phone(tester);
      await body(tester, shot);
    } catch (error, stack) {
      failure = '$error\n${stack.toString().split('\n').take(8).join('\n')}';
    } finally {
      shot.finish(failure);
      FlutterError.onError = before;
    }
    await tester.pumpWidget(const SizedBox.shrink());
    for (final end in _atEnd) {
      end();
    }
    _atEnd.clear();
    await tester.pump(const Duration(seconds: 40));
    tester.takeException();
    tester.view.reset();
  });
}

final _atEnd = <void Function()>[];

/// Replies landing, routes moving, images decoding.
Future<void> _settle(WidgetTester tester, {int rounds = 6}) async {
  for (var i = 0; i < rounds; i++) {
    await tester.pump(const Duration(milliseconds: 120));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 25)));
  }
  await tester.pump(const Duration(milliseconds: 400));
  await tester.pump(const Duration(milliseconds: 400));
}

Future<void> _tap(WidgetTester tester, Finder finder, {bool scroll = true}) async {
  if (finder.evaluate().isEmpty && scroll) {
    await tester.scrollUntilVisible(finder, 200, scrollable: _mainScrollable());
  }
  await tester.ensureVisible(finder.first);
  await tester.pump(const Duration(milliseconds: 100));
  await tester.tap(finder.first, warnIfMissed: false);
  await _settle(tester);
}

Finder _mainScrollable() {
  final all = find.byWidgetPredicate((w) => w is Scrollable && w.axisDirection == AxisDirection.down).evaluate().toList();
  Element? best;
  var bestHeight = 0.0;
  for (final element in all) {
    final box = element.renderObject;
    if (box is RenderBox && box.hasSize && box.size.height > bestHeight) {
      best = element;
      bestHeight = box.size.height;
    }
  }
  return best == null ? find.byType(Scrollable).first : find.byElementPredicate((e) => identical(e, best));
}

Future<void> _scrollTo(WidgetTester tester, Finder finder) async {
  if (finder.evaluate().isEmpty) {
    await tester.scrollUntilVisible(finder, 200, scrollable: _mainScrollable());
  }
  await tester.ensureVisible(finder.first);
  await _settle(tester, rounds: 2);
}

Future<void> _scrollTop(WidgetTester tester) async {
  for (final element in find.byType(Scrollable).evaluate()) {
    final state = (element as StatefulElement).state as ScrollableState;
    if (state.position.hasPixels && state.position.pixels != 0) state.position.jumpTo(0);
  }
  await tester.pump();
}

Widget _app(Widget home) => RepaintBoundary(
  key: _shotKey,
  child: MaterialApp(
    navigatorKey: _nav,
    debugShowCheckedModeBanner: false,
    theme: _theme(),
    // Reduce motion: every entrance animation at its end state.
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(disableAnimations: true),
      child: child!,
    ),
    home: home,
  ),
);

// ───────────────────────────────────────────────────────────────── onboarding shell

/// The header's avatar, as the signed-in shell draws it.
Widget _avatar(String name) => Container(
  width: 30,
  height: 30,
  alignment: Alignment.center,
  decoration: const BoxDecoration(color: Color(0xFFE0F2FE), shape: BoxShape.circle),
  child: Text(name.substring(0, 1), style: const TextStyle(fontFamily: 'Plus Jakarta Sans', fontWeight: FontWeight.w700, fontSize: 13, color: Color(0xFF0571A6))),
);

/// What the signed-in shell hands the onboarding screens, at a chosen time.
OnboardingShell _shell(AuthSession session, DateTime now) => OnboardingShell(
  api: HttpOnboardingApi(session: session, baseUrl: 'https://api.sowaka.test', client: _router),
  profileAction: _avatar(session.user.name),
  onNotifications: () {},
  tabs: visibleTabs(const []),
  selectedTab: session.user.role == 'manager' ? ManagerTab.manage : ManagerTab.quick,
  onSelectTab: (_) {},
  registerFace: (_) async => false,
  changePhoto: (_) async => null,
  openPost: (_) {},
  viewerName: session.user.name,
  viewerDesignation: session.user.designation,
  viewerDepartment: session.user.department,
  now: () => now,
);

/// [page] pushed over a blank root, as the shell pushes it.
Future<void> _push(WidgetTester tester, Widget page) async {
  await tester.pumpWidget(_app(const Scaffold(body: SizedBox.expand())));
  unawaited(_nav.currentState!.push(MaterialPageRoute<void>(builder: (_) => page)));
  await _settle(tester);
}

// ───────────────────────────────────────────────────────────────── the signed-in app

/// The real signed-in app (ManagerScreen) as [session], every call answered
/// by [_server] (its own services all go through [ApiClient.shared]).
Future<ManagerBloc> _boot(WidgetTester tester, AuthSession session, List<Map<String, dynamic>> team) async {
  final workspace = {
    'success': true,
    'team': team,
    'recognitionCandidates': <dynamic>[],
    'nominations': <dynamic>[],
    'recognitionHistory': <dynamic>[],
    'myParameters': <dynamic>[],
    'growthHistory': <dynamic>[],
    'holidays': <dynamic>[],
    'myOrgChart': <dynamic>[],
    'weekoffDays': [0],
    'shift': <String, dynamic>{},
    'approverName': 'Meera Iyer',
    'hasManager': session.user.id != 'mgr',
    'teamLevel': 2,
    'managerScore': 0,
  };
  _server.on('GET', r'/manager/workspace$', workspace);
  ConnectApiService.testClient = _router;
  _atEnd.add(() => ConnectApiService.testClient = null);
  final bloc = ManagerBloc(
    session: session,
    service: ManagerApiService(session: session, baseUrl: 'https://api.sowaka.test', client: _router),
  );
  await tester.runAsync(() => bloc.add(const LoadManagerDashboard()));
  await tester.pumpWidget(_app(ManagerScreen(session: session, bloc: bloc)));
  await _settle(tester, rounds: 8);
  _atEnd.add(bloc.dispose);
  return bloc;
}

Future<void> _openOwnProfile(WidgetTester tester) async {
  await tester.tap(find.byWidgetPredicate((w) => w.runtimeType.toString() == '_ProfileAvatarAction').first);
  await _settle(tester);
}

Future<void> _tab(WidgetTester tester, ManagerBloc bloc, ManagerTab tab) async {
  bloc.add(ChangeManagerTab(tab));
  await _settle(tester);
}

/// A profile's underline tab, scrolled into view.
Future<void> _profileTab(WidgetTester tester, String label) async {
  final tab = find.text(label);
  if (tab.evaluate().isEmpty) return;
  final target = tab.evaluate().toList()
    ..sort((a, b) => tester.getTopLeft(find.byWidget(a.widget)).dy.compareTo(tester.getTopLeft(find.byWidget(b.widget)).dy));
  final finder = find.byWidget(target.first.widget);
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder, warnIfMissed: false);
  await _settle(tester);
}

// ───────────────────────────────────────────────────────────────── main

void main() {
  setUpAll(() async {
    if (_skip != null) return;
    Directory(_out).createSync(recursive: true);
    // Every service's default client is ApiClient.shared, made on first use:
    // made here, it is the fake server for the whole run.
    http.runWithClient(() => ApiClient.shared, () => _router);
    off.OffboardingApi.testOverride = (session) => off.OffboardingApi(session: session, baseUrl: 'https://api.sowaka.test', client: _router);
    LocalAuthPlatform.instance = _localAuth;
    await _loadFonts();
  });

  tearDownAll(() {
    if (_skip != null) return;
    File('$_out/results.json').writeAsStringSync(const JsonEncoder.withIndent('  ').convert(_results));
  });

  _joinerScreens();
  _probationScreens();
  _managerScreens();
  _leaverScreens();
  _shellHooks();
}

Future<void> _loadFonts() async {
  Future<ByteData> file(String path) async => ByteData.sublistView(File(path).readAsBytesSync());
  for (final (family, path) in [
    ('Plus Jakarta Sans', 'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf'),
    ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
    ('Manrope', 'assets/fonts/manrope/Manrope-Variable.ttf'),
    ('Anton', 'assets/fonts/anton/Anton-Regular.ttf'),
    ('Figtree', 'assets/fonts/figtree/Figtree-Variable.ttf'),
    ('Lilita One', 'assets/fonts/lilita_one/LilitaOne-Regular.ttf'),
    ('Lexend', 'assets/fonts/lexend/Lexend-Variable.ttf'),
    ('PressStart2P', 'assets/fonts/press_start/PressStart2P-Regular.ttf'),
    ('La Belle Aurore', 'assets/fonts/la_belle_aurore/LaBelleAurore-Regular.ttf'),
  ]) {
    await (FontLoader(family)..addFont(rootBundle.load(path))).load();
  }
  // Material's own fonts from the Flutter install: the icons, and Roboto for
  // text with no family of its own.
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '/opt/homebrew/share/flutter';
  final material = '$flutterRoot/bin/cache/artifacts/material_fonts';
  await (FontLoader('MaterialIcons')..addFont(file('$material/MaterialIcons-Regular.otf'))).load();
  final roboto = FontLoader('Roboto');
  for (final weight in ['Regular', 'Medium', 'Bold', 'Light']) {
    roboto.addFont(file('$material/Roboto-$weight.ttf'));
  }
  await roboto.load();
  // Cupertino icons, from the package.
  final cupertino = Directory('${Platform.environment['HOME']}/.pub-cache/hosted/pub.dev')
      .listSync()
      .whereType<Directory>()
      .where((d) => d.path.split('/').last.startsWith('cupertino_icons-'))
      .map((d) => '${d.path}/assets/CupertinoIcons.ttf')
      .where((p) => File(p).existsSync())
      .toList();
  if (cupertino.isNotEmpty) {
    await (FontLoader('packages/cupertino_icons/CupertinoIcons')..addFont(file(cupertino.last))).load();
  }
  // A phone draws emoji from its own colour-emoji font.
  const emoji = '/System/Library/Fonts/Apple Color Emoji.ttc';
  if (File(emoji).existsSync()) {
    await (FontLoader('Apple Color Emoji')..addFont(file(emoji))).load();
  }
}

// ═════════════════════════════════════════════════════════════════ joiner

/// The day the fixtures were made: the joiner is in week 1 (Tj + 6) and the
/// starter task, notes and survey are all there. Screens fed straight from
/// the fixtures are shown the next morning.
DateTime get _fixtureMorning => _at(7, 10);

void _joinerRoutes() {
  _server
    ..on('GET', r'/lifecycle/me$', fx('me_joiner'))
    ..on('GET', r'/lifecycle/onboarding/starter-tasks$', fx('starter_tasks_get'))
    ..on('GET', r'/lifecycle/onboarding/notes$', fx('notes_get'));
}

void _joinerScreens() {
  _scenario('A2 onboarding home, day 1', (tester, shot) async {
    _joinerRoutes();
    _server
      ..on('GET', r'/lifecycle/onboarding$', _homeDay1())
      ..on('GET', r'/lifecycle/onboarding/starter-tasks$', {'tasks': <dynamic>[]})
      ..on('GET', r'/lifecycle/onboarding/notes$', {'notes': <dynamic>[]});
    await _push(tester, OnboardingHomeScreen(shell: _shell(_joiner, _at(0, 10, 35))));
    await shot('A2', 'day1');
    await _tap(tester, find.byKey(const ValueKey('journey-toggle')));
    await shot('A2', 'day1-journey', full: false);
    await _tap(tester, find.byKey(const ValueKey('journey-toggle')));
    await _tap(tester, find.byKey(const ValueKey('done-toggle')));
    await shot('A2', 'day1-done', full: false);
    // The tour opens a sheet; a locked item says when it opens.
    await _scrollTop(tester);
    final tour = find.textContaining('Sowaka tour');
    await _tap(tester, tour);
    await shot('A2', 'tour-sheet', full: false);
    await tester.tapAt(const Offset(20, 120));
    await _settle(tester);
    await _tap(tester, find.textContaining('check-in').first);
    await shot('A2', 'locked-task-sheet', full: false);
  });

  _scenario('A2 onboarding home, day 4', (tester, shot) async {
    _joinerRoutes();
    _server
      ..on('GET', r'/lifecycle/onboarding$', _homeDay4())
      ..on('GET', r'/lifecycle/onboarding/starter-tasks$', _starterTasks(done: false))
      ..on('GET', r'/lifecycle/onboarding/notes$', _notes());
    await _push(tester, OnboardingHomeScreen(shell: _shell(_joiner, _at(3, 10))));
    await shot('A2', 'day4');
    await _tap(tester, find.byKey(const ValueKey('journey-toggle')));
    await shot('A2', 'day4-journey', full: false);
    await _tap(tester, find.byKey(const ValueKey('journey-toggle')));
    await _tap(tester, find.byKey(const ValueKey('done-toggle')));
    await shot('A2', 'day4-done', full: false);
  });

  _scenario('A2 onboarding home, from the fixtures as sent', (tester, shot) async {
    _joinerRoutes();
    _server.on('GET', r'/lifecycle/onboarding$', fx('home_with_meeting'));
    await _push(tester, OnboardingHomeScreen(shell: _shell(_joiner, _at(6, 18))));
    await shot('A2', 'server-as-sent', note: 'home_with_meeting.json unchanged, at the time it was made');
  });

  _scenario('A3 meeting', (tester, shot) async {
    _joinerRoutes();
    var meeting = _meeting();
    _server
      ..on('GET', r'/lifecycle/onboarding/meetings/', (_, _) => meeting)
      ..on('POST', r'/lifecycle/onboarding/meetings/', (_, body) {
        meeting = {...meeting, 'met': (body as Map?)?['met'] ?? 'yes'};
        return meeting;
      });
    await _push(tester, MeetingScreen(shell: _shell(_joiner, _at(0, 10, 35)), meetingId: 'fx-meeting'));
    await shot('A3', 'before');
    await _push(tester, MeetingScreen(shell: _shell(_joiner, _at(0, 11, 40)), meetingId: 'fx-meeting'));
    await shot('A3', 'after');
    await _tap(tester, find.byKey(const ValueKey('meeting-yes')));
    await shot('A3', 'after-done');
  });

  _scenario('A4 week-1 reels', (tester, shot) async {
    _joinerRoutes();
    var week1 = _week1(fx('week1_get'));
    _server
      ..on('GET', r'/lifecycle/onboarding/week1$', (_, _) => week1)
      ..on('PUT', r'/lifecycle/onboarding/week1$', (_, body) {
        final step = (body as Map?)?['step'];
        week1 = _week1(switch (step) {
          'policies' => fx('week1_put_policies'),
          'tax' => fx('week1_put_tax'),
          'bank_pf' => fx('week1_put_tax')
            ..['bankPf'] = {'confirmedAt': _iso(_at(3, 10, 5))}
            ..['steps'] = {'policies': true, 'tax': true, 'bank_pf': true, 'goals': false},
          _ => fx('week1_done'),
        });
        return week1;
      });
    await _push(tester, Week1ReelsScreen(shell: _shell(_joiner, _at(3, 10))));
    await shot('A4', '1-policies', full: false);
    await _tap(tester, find.byKey(const ValueKey('policies-agree')));
    await shot('A4', '1-policies-ticked', full: false);
    await _tap(tester, find.text('Agree and continue'));
    await shot('A4', '2-tax', full: false);
    await _tap(tester, find.text('Confirm choice'));
    await shot('A4', '3-bank-pf', full: false);
    await _tap(tester, find.text('All correct'));
    await shot('A4', '4-goals', full: false);
    await _tap(tester, find.text('Got it'));
    await shot('A4', 'done', full: false);
  });

  _scenario('A5 intro post', (tester, shot) async {
    _joinerRoutes();
    var intro = fx('intro_put');
    _server
      ..on('GET', r'/lifecycle/onboarding/intro$', (_, _) => intro)
      ..on('PUT', r'/lifecycle/onboarding/intro$', (_, _) => intro)
      ..on('POST', r'/lifecycle/onboarding/intro/post$', (_, _) => intro = fx('intro_post'));
    await _push(tester, IntroPostScreen(shell: _shell(_joiner, _at(3, 10))));
    await shot('A5', 'questions');
    await _tap(tester, find.byKey(const ValueKey('intro-preview')));
    await shot('A5', 'preview');
    await _tap(tester, find.byKey(const ValueKey('intro-post')));
    await shot('A5', 'posted');
  });

  _scenario('A5 intro post, empty', (tester, shot) async {
    _joinerRoutes();
    _server.on('GET', r'/lifecycle/onboarding/intro$', fx('intro_get'));
    await _push(tester, IntroPostScreen(shell: _shell(_joiner, _at(3, 10))));
    await shot('A5', 'questions-empty');
  });

  _scenario('A6 people to meet', (tester, shot) async {
    _joinerRoutes();
    final people = _people();
    _server
      ..on('GET', r'/lifecycle/onboarding/people$', (_, _) => {'people': people, 'meetBy': fx('people_get')['meetBy']})
      ..on('POST', r'/lifecycle/onboarding/people/', (request, body) {
        final id = request.url.pathSegments.last == 'met' || request.url.pathSegments.last == 'not_yet'
            ? request.url.pathSegments[request.url.pathSegments.length - 2]
            : request.url.pathSegments.last;
        for (final person in people) {
          if (person['id'] == id && (body as Map?)?['action'] != 'not_yet') person['metAt'] = _iso(_at(3, 15));
        }
        return {'people': people};
      });
    await _push(tester, PeopleToMeetScreen(shell: _shell(_joiner, _at(3, 10))));
    await shot('A6', 'first', full: false);
    await _tap(tester, find.byKey(const ValueKey('we-met')));
    await shot('A6', 'second', full: false);
    for (final person in people) {
      person['metAt'] ??= _iso(_at(5, 15));
    }
    await _push(tester, PeopleToMeetScreen(shell: _shell(_joiner, _at(5, 16))));
    await shot('A6', 'done', full: false);
  });

  _scenario('A7 day-7 survey', (tester, shot) async {
    _joinerRoutes();
    _server
      ..on('GET', r'/lifecycle/onboarding/survey$', fx('survey_get'))
      ..on('POST', r'/lifecycle/onboarding/survey$', fx('survey_post'));
    await _push(tester, SurveyScreen(shell: _shell(_joiner, _at(6, 18))));
    await shot('A7', 'q1', full: false);
    await _tap(tester, find.byKey(const ValueKey('scale-4')));
    await shot('A7', 'q1-answered', full: false);
    await _tap(tester, find.byKey(const ValueKey('survey-next')));
    await _tap(tester, find.byKey(const ValueKey('choice-mostly')));
    await shot('A7', 'q2', full: false);
    await _tap(tester, find.byKey(const ValueKey('survey-next')));
    await _tap(tester, find.byKey(const ValueKey('scale-5')));
    await shot('A7', 'q3', full: false);
    await _tap(tester, find.byKey(const ValueKey('survey-next')));
    await tester.enterText(find.byKey(const ValueKey('survey-fix')), 'The laptop arrived at noon, so I lost the first morning.');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await _settle(tester, rounds: 2);
    FocusManager.instance.primaryFocus?.unfocus();
    await _settle(tester, rounds: 2);
    await shot('A7', 'q4', full: false);
    await _tap(tester, find.byKey(const ValueKey('survey-next')));
    await shot('A7', 'thanks', full: false);
  });

  _scenario('A8 week 1 done', (tester, shot) async {
    final home = fx('home_with_meeting')
      ..['stage'] = 'settling_in'
      ..['dayLabel'] = 'Week 2'
      ..['plant'] = {'stage': 2, 'water': 0, 'leaves': 3, 'droop': false};
    await _push(tester, WeekDoneScreen(shell: _shell(_joiner, _at(7, 9)), home: OnboardingHome.fromJson(home), peopleMet: 6));
    await shot('A8', '', full: false);
  });

  _scenario('A9 starter task', (tester, shot) async {
    _joinerRoutes();
    var tasks = _starterTasks(done: false);
    _server
      ..on('GET', r'/lifecycle/onboarding/starter-tasks$', (_, _) => tasks)
      ..on('POST', r'/lifecycle/onboarding/starter-tasks/', (_, _) => tasks = _starterTasks(done: true));
    final id = _list(tasks['tasks']).single['id'] as String;
    await _push(tester, StarterTaskScreen(shell: _shell(_joiner, _at(3, 10)), taskId: id));
    await shot('A9', 'todo');
    await tester.enterText(find.byKey(const ValueKey('starter-note')), 'First version is in the folder. I kept the half-day option on one screen; happy to talk it through Friday.');
    FocusManager.instance.primaryFocus?.unfocus();
    await _settle(tester, rounds: 2);
    await _tap(tester, find.byKey(const ValueKey('starter-mark-done')));
    await shot('A9', 'done');
  });

  _scenario('A10 notes from the 1:1', (tester, shot) async {
    _joinerRoutes();
    var notes = _notes();
    _server
      ..on('GET', r'/lifecycle/onboarding/notes$', (_, _) => notes)
      ..on('POST', r'/lifecycle/onboarding/notes/', (_, _) => notes = _notes(replied: true));
    await _push(tester, NotesScreen(shell: _shell(_joiner, _at(3, 10))));
    await shot('A10', 'unread');
    await tester.enterText(find.byKey(const ValueKey('note-reply')), 'Thanks, Meera!');
    await _tap(tester, find.byKey(const ValueKey('note-send')));
    FocusManager.instance.primaryFocus?.unfocus();
    await _settle(tester, rounds: 2);
    await shot('A10', 'replied');
  });

  _scenario('A12 notifications', (tester, shot) async {
    for (final (user, session, code) in [('isha', _joiner, 'A12'), ('mgr', _manager, 'A12-manager'), ('ravi', _leaver, 'A12-leaver')]) {
      _server = _Server()..on('GET', r'/notifications$', {'notifications': _inbox(user)});
      await tester.pumpWidget(_app(NotificationInboxScreen(session: session, client: _router, now: () => _fixtureMorning)));
      await _settle(tester);
      await shot(code, '');
    }
  });
}

// ═════════════════════════════════════════════════════════════════ probation

void _probationScreens() {
  _scenario('PB1 monthly check-in', (tester, shot) async {
    _joinerRoutes();
    _server.on('GET', r'/lifecycle/onboarding/probation$', _probation());
    _server.on('POST', r'/lifecycle/onboarding/probation/', {'ok': true});
    final shell = _shell(_joiner, _at(27, 10));
    await _push(tester, ProbationScreen(shell: shell));
    await shot('PB1', 'months');
    final month = ProbationView.fromJson(_probation()).months.first;
    await _push(tester, CheckinReelScreen(shell: shell, month: month, managerName: 'Meera Iyer'));
    await shot('PB1', '1-feeling', full: false);
    await _tap(tester, find.byKey(const ValueKey('feeling-3')));
    await shot('PB1', '1-feeling-picked', full: false);
    await _tap(tester, find.byKey(const ValueKey('checkin-next')));
    await tester.enterText(find.byKey(const ValueKey('checkin-win')), 'Shipped the first version of the leave request redesign.');
    FocusManager.instance.primaryFocus?.unfocus();
    await _settle(tester, rounds: 2);
    await shot('PB1', '2-win', full: false);
    await _tap(tester, find.byKey(const ValueKey('checkin-next')));
    await tester.enterText(find.byKey(const ValueKey('checkin-ask')), 'Access to the analytics dashboard.');
    FocusManager.instance.primaryFocus?.unfocus();
    await _settle(tester, rounds: 2);
    await shot('PB1', '3-ask', full: false);
    await _tap(tester, find.byKey(const ValueKey('checkin-next')));
    await shot('PB1', 'sent', full: false);
  });

  _scenario('PB2 manager monthly review', (tester, shot) async {
    final detail = _managerJoiner(withCheckin: true);
    final journeyId = (detail['joiner'] as Map)['journeyId'] as String;
    _server
      ..on('GET', r'/lifecycle/manager/joiners/[^/]+$', detail)
      ..on('PUT', r'/lifecycle/manager/joiners/', {'ok': true});
    await _push(tester, ProbationReviewScreen(shell: _shell(_manager, _at(28, 10)), journeyId: journeyId, month: 1));
    await shot('PB2', 'review');
    await _tap(tester, find.byKey(const ValueKey('rating-4')));
    await tester.enterText(find.byKey(const ValueKey('month-review')), 'Great start. The leave redesign landed well; next, run the first user test.');
    FocusManager.instance.primaryFocus?.unfocus();
    await _settle(tester, rounds: 2);
    await shot('PB2', 'review-filled');
  });

  _scenario('PB3 confirmation reveal', (tester, shot) async {
    _joinerRoutes();
    var reveal = fx('reveal_ready');
    _server
      ..on('GET', r'/lifecycle/onboarding/reveal$', (_, _) => reveal)
      ..on('POST', r'/lifecycle/onboarding/reveal/seen$', (_, _) => reveal = fx('reveal_seen'));
    final shell = _shell(_joiner, _at(182, 10));
    await _push(tester, RevealScreen(shell: shell));
    await shot('PB3', 'before-tap', full: false);
    await _tap(tester, find.byKey(const ValueKey('reveal-tap')));
    await shot('PB3', 'revealed', full: false);
    reveal = fx('reveal_not_ready');
    await _push(tester, RevealScreen(shell: shell));
    await shot('PB3', 'not-decided', full: false);
  });
}

// ═════════════════════════════════════════════════════════════════ manager

void _managerScreens() {
  _scenario('M2 joiner, manager view', (tester, shot) async {
    final detail = _managerJoiner();
    final journeyId = (detail['joiner'] as Map)['journeyId'] as String;
    _server
      ..on('GET', r'/lifecycle/manager/joiners/[^/]+$', detail)
      ..on('GET', r'/connect/audience-lists/people$', {'people': _directory()})
      ..on('POST', r'/lifecycle/manager/', {'ok': true})
      ..on('PUT', r'/lifecycle/manager/', {'ok': true});
    final shell = _shell(_manager, _fixtureMorning);
    await _push(tester, JoinerScreen(shell: shell, journeyId: journeyId));
    await shot('M2', '');
    // M2a: the starter task sheet.
    await _tap(tester, find.byKey(const ValueKey('assign-starter')));
    await tester.enterText(find.byKey(const ValueKey('starter-title')), 'Audit the leave flow for accessibility');
    await tester.pump();
    await _tap(tester, find.byKey(const ValueKey('due-friday')), scroll: false);
    FocusManager.instance.primaryFocus?.unfocus();
    await _settle(tester, rounds: 2);
    await shot('M2', 'starter-task-sheet', full: false);
    Navigator.of(tester.element(find.byKey(const ValueKey('starter-title')))).pop();
    await _settle(tester);
    // M2b: the 1:1 note sheet.
    await _tap(tester, find.byKey(const ValueKey('add-note')));
    await tester.enterText(find.byKey(const ValueKey('note-text')), 'Settling in well. Wants to sit in on user interviews. Pair with Kiran on the design system this week.');
    FocusManager.instance.primaryFocus?.unfocus();
    await _settle(tester, rounds: 2);
    await shot('M2', 'note-sheet', full: false);
    Navigator.of(tester.element(find.byKey(const ValueKey('note-text')))).pop();
    await _settle(tester);
    // The set-up page.
    await _tap(tester, find.byKey(const ValueKey('open-setup')));
    await shot('M2', 'setup');
    await _tap(tester, find.byKey(const ValueKey('setup-add-person')));
    await shot('M2', 'setup-people-picker', full: false);
  });

  _scenario('M2 set-up after the goals lock', (tester, shot) async {
    final detail = _managerJoiner()..['goalsLocked'] = true;
    (detail['joiner'] as Map)['goalsLocked'] = true;
    final journeyId = (detail['joiner'] as Map)['journeyId'] as String;
    await _push(tester, JoinerSetupScreen(shell: _shell(_manager, _at(9, 10)), journeyId: journeyId, detail: JoinerDetail.fromJson(detail)));
    await shot('M2', 'setup-goals-locked');
  });

  _scenario('M3 starter task done, manager', (tester, shot) async {
    final detail = _managerJoiner(reply: false);
    final journeyId = (detail['joiner'] as Map)['journeyId'] as String;
    final taskId = _list(detail['starterTasks']).single['id'] as String;
    _server
      ..on('GET', r'/lifecycle/manager/joiners/[^/]+$', detail)
      ..on('POST', r'/lifecycle/manager/starter-tasks/', fx('manager_starter_task_reply'));
    await _push(tester, StarterReviewScreen(shell: _shell(_manager, _fixtureMorning), journeyId: journeyId, starterTaskId: taskId));
    await shot('M3', '');
    await tester.enterText(find.byKey(const ValueKey('starter-reply')), 'Nice start! Let’s go through it on Friday.');
    FocusManager.instance.primaryFocus?.unfocus();
    await _settle(tester, rounds: 2);
    await shot('M3', 'reply-typed');
  });
}

// ═════════════════════════════════════════════════════════════════ leaver (in the signed-in app)

final _leaverTeam = [
  _member('mgr', 'Meera Iyer', designation: 'Design Lead', isManager: true),
  _member('ravi', 'Ravi Menon', designation: 'Senior Designer', isSelf: true),
];

final _managerTeam = [
  _member('mgr', 'Meera Iyer', designation: 'Design Lead', isSelf: true),
  _member('isha', 'Isha Verma', reportsToViewer: true),
  _member('ravi', 'Ravi Menon', designation: 'Senior Designer', reportsToViewer: true),
  _member('arjun', 'Arjun Sen', designation: 'Senior Designer', reportsToViewer: true),
  _member('vani', 'Vani Pillai', designation: 'Visual Designer', reportsToViewer: true),
];

void _leaverRoutes({required String me, required String resignation}) {
  _server
    ..on('GET', r'/lifecycle/me$', fx(me))
    ..on('GET', r'/lifecycle/resignation$', fx(resignation))
    ..on('GET', r'/lifecycle/offboarding$', fx('offboarding_get'))
    ..on('GET', r'/lifecycle/manager/resignations$', {'resignations': <dynamic>[]});
}

void _leaverScreens() {
  _scenario('R0 R1 resign', (tester, shot) async {
    _leaverRoutes(me: 'me_before_resigning', resignation: 'resignation_get_none');
    _server.on('POST', r'/lifecycle/resignation$', fx('resignation_post'));
    await _boot(tester, _leaver, _leaverTeam);
    await _openOwnProfile(tester);
    await _scrollTo(tester, find.byKey(const ValueKey('resign-entry-row')));
    await shot('R0', 'work-detail-resign', full: false);
    await _tap(tester, find.byKey(const ValueKey('resign-entry-row')));
    await shot('R1', 'empty');
    await _tap(tester, find.byKey(const ValueKey('resign-reason')));
    await shot('R1', 'reason-list', full: false);
    await _tap(tester, find.byKey(const ValueKey('resign-reason-Better opportunity')));
    await tester.enterText(find.byKey(const ValueKey('resign-note')), 'Thank you for three great years.');
    FocusManager.instance.primaryFocus?.unfocus();
    await _settle(tester, rounds: 2);
    await shot('R1', 'filled');
    await _tap(tester, find.byKey(const ValueKey('resign-continue')));
    await shot('R1b', 'confirm-sheet', full: false);
  });

  _scenario('R2a resignation with the manager', (tester, shot) async {
    _leaverRoutes(me: 'me_with_manager', resignation: 'resignation_get_with_manager');
    await _boot(tester, _leaver, _leaverTeam);
    await _openOwnProfile(tester);
    await _profileTab(tester, 'Resignation');
    await shot('R2a', 'with-manager');
    final withdraw = find.byKey(const ValueKey('resignation-withdraw'));
    await _tap(tester, withdraw);
    await shot('R2a', 'withdraw-confirm', full: false);
  });

  _scenario('R2a resignation with HR', (tester, shot) async {
    _leaverRoutes(me: 'me_with_manager', resignation: 'resignation_get_with_hr');
    await _boot(tester, _leaver, _leaverTeam);
    await _openOwnProfile(tester);
    await _profileTab(tester, 'Resignation');
    await shot('R2a', 'with-hr');
  });

  _scenario('R2b on notice', (tester, shot) async {
    _leaverRoutes(me: 'me_on_notice', resignation: 'resignation_get_accepted');
    await _boot(tester, _leaver, _leaverTeam);
    await _openOwnProfile(tester);
    await _profileTab(tester, 'Resignation');
    await shot('R2b', 'on-notice');
  });

  _scenario('R3 off-boarding page, R3b handover, R5 exit interview', (tester, shot) async {
    _leaverRoutes(me: 'me_on_notice', resignation: 'resignation_get_accepted');
    var page = fx('offboarding_get');
    (page['interview'] as Map)['open'] = false;
    _server
      ..on('GET', r'/lifecycle/offboarding$', (_, _) => page)
      ..on('POST', r'/lifecycle/offboarding/interview$', (_, _) {
        page = fx('offboarding_get_after_interview');
        return fx('exit_interview_post');
      });
    final bloc = await _boot(tester, _leaver, _leaverTeam);
    await _tab(tester, bloc, ManagerTab.quick);
    await _scrollTo(tester, find.byKey(const ValueKey('offboarding-card')));
    await shot('R3', 'action-tile', full: false);
    await _tap(tester, find.byKey(const ValueKey('offboarding-card')));
    await shot('R3', '');
    await _tap(tester, find.byKey(const ValueKey('off-task-handover')));
    await shot('R3b', 'handover');
    await tester.pageBack();
    await _settle(tester);
    await _tap(tester, find.byKey(const ValueKey('off-task-exit-interview')));
    await shot('R5', 'locked');
    await tester.pageBack();
    await _settle(tester);
  });

  _scenario('R5 exit interview open and sent', (tester, shot) async {
    _leaverRoutes(me: 'me_on_notice', resignation: 'resignation_get_accepted');
    var page = fx('offboarding_get');
    _server
      ..on('GET', r'/lifecycle/offboarding$', (_, _) => page)
      ..on('POST', r'/lifecycle/offboarding/interview$', (_, _) {
        page = fx('offboarding_get_after_interview');
        return fx('exit_interview_post');
      });
    final bloc = await _boot(tester, _leaver, _leaverTeam);
    await _tab(tester, bloc, ManagerTab.quick);
    await _tap(tester, find.byKey(const ValueKey('offboarding-card')));
    await shot('R3', 'interview-open');
    await _tap(tester, find.byKey(const ValueKey('off-task-exit-interview')));
    await shot('R5', 'open');
    for (final key in ['exit-reason-growth', 'exit-working-4', 'exit-manager-3', 'exit-come-back-maybe']) {
      final finder = find.byKey(ValueKey(key));
      if (finder.evaluate().isEmpty) await _scrollTo(tester, finder);
      await _tap(tester, finder);
    }
    await _scrollTo(tester, find.byKey(const ValueKey('exit-change')));
    await tester.enterText(find.byKey(const ValueKey('exit-change')), 'Clearer growth paths for designers, and fewer last-minute priority changes.');
    FocusManager.instance.primaryFocus?.unfocus();
    await _settle(tester, rounds: 2);
    await _scrollTop(tester);
    await shot('R5', 'open-filled');
    await _tap(tester, find.byKey(const ValueKey('exit-interview-send')));
    await _scrollTop(tester);
    await shot('R5', 'sent');
    await tester.pageBack();
    await _settle(tester);
    await shot('R3', 'interview-sent');
  });

  _scenario('R3b handover before the checklist', (tester, shot) async {
    _leaverRoutes(me: 'me_on_notice', resignation: 'resignation_get_accepted');
    _server.on('GET', r'/lifecycle/offboarding$', fx('offboarding_get_before_checklist'));
    final bloc = await _boot(tester, _leaver, _leaverTeam);
    await _tab(tester, bloc, ManagerTab.quick);
    await _tap(tester, find.byKey(const ValueKey('offboarding-card')));
    await shot('R3', 'before-checklist');
    await _tap(tester, find.byKey(const ValueKey('off-task-handover')));
    await shot('R3b', 'before-checklist');
  });

  _scenario('R4 payslips held, and the Payroll lock', (tester, shot) async {
    _leaverRoutes(me: 'me_on_notice', resignation: 'resignation_get_accepted');
    _payrollRoutes();
    final bloc = await _boot(tester, _leaver, _leaverTeam);
    await _tab(tester, bloc, ManagerTab.quick);
    final payroll = find.text('Payroll');
    // Locked: the phone's lock was cancelled.
    await _tap(tester, payroll);
    await shot('PAY-lock', 'locked', full: false);
    // Unlocked: Past payslips, November held.
    _localAuth.approve = true;
    await _tap(tester, find.byKey(const ValueKey('payroll-unlock')), scroll: false);
    await _scrollTo(tester, find.text('Past payslips'));
    await _tap(tester, find.text('Past payslips'));
    await shot('R4', 'payslips-held');
    final held = find.byWidgetPredicate((w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('payslip-row-'));
    if (held.evaluate().isNotEmpty) {
      await _tap(tester, held.first);
      await shot('R4', 'payslip-held-detail');
    }
  });

  _scenario('Payroll lock, no screen lock on the phone', (tester, shot) async {
    _localAuth.hasLock = false;
    _server.on('GET', r'/lifecycle/me$', fx('me_joiner'));
    final bloc = await _boot(tester, _joiner, [
      _member('mgr', 'Meera Iyer', designation: 'Design Lead', isManager: true),
      _member('isha', 'Isha Verma', isSelf: true),
    ]);
    await _tab(tester, bloc, ManagerTab.quick);
    await _tap(tester, find.text('Payroll'));
    await shot('PAY-lock', 'set-a-screen-lock', full: false);
  });

  _scenario('R6 account closed', (tester, shot) async {
    final refusal = fx('auth_request_otp_closed');
    final body = (refusal['body'] as Map).cast<String, dynamic>();
    final info = await off.accountClosedFor(statusCode: refusal['status'] as int, message: '${body['message'] ?? body['error'] ?? ''}', body: body, email: 'ravi@sowaka.test');
    await tester.pumpWidget(_app(off.AccountClosedScreen(info: info ?? const off.AccountClosedInfo(), onBackToSignIn: () {}, openMail: (_) async {})));
    await _settle(tester);
    await shot('R6', '', full: false);
  });
}

// ═════════════════════════════════════════════════════════════════ hooks in the signed-in app

void _shellHooks() {
  _scenario('A1 Action tile, A1b profile Onboarding tab', (tester, shot) async {
    _joinerRoutes();
    _server.on('GET', r'/lifecycle/onboarding$', fx('home_with_meeting'));
    final bloc = await _boot(tester, _joiner, [
      _member('mgr', 'Meera Iyer', designation: 'Design Lead', isManager: true),
      _member('isha', 'Isha Verma', isSelf: true),
    ]);
    await _tab(tester, bloc, ManagerTab.quick);
    await _scrollTo(tester, find.byKey(const ValueKey('onboarding-card')));
    await shot('A1', 'action-tile', full: false);
    await _scrollTop(tester);
    await _openOwnProfile(tester);
    await shot('A1b', 'profile-onboarding-tab');
  });

  _scenario('M0 Team tab, new joiners', (tester, shot) async {
    _server
      ..on('GET', r'/lifecycle/me$', fx('me_before_resigning'))
      ..on('GET', r'/lifecycle/manager/joiners$', fx('manager_joiners'))
      ..on('GET', r'/lifecycle/manager/resignations$', {'resignations': <dynamic>[]})
      ..on('GET', r'/lifecycle/manager/joiners/[^/]+$', _managerJoiner());
    final bloc = await _boot(tester, _manager, _managerTeam);
    await _tab(tester, bloc, ManagerTab.manage);
    await shot('M0', 'team-tab');
    final joiners = find.byKey(const ValueKey('new-joiners'));
    if (joiners.evaluate().isNotEmpty) {
      await _scrollTo(tester, joiners);
      await shot('M0', 'new-joiners-section', full: false);
    }
  });

  _scenario('R7 Requests, a resignation', (tester, shot) async {
    _server
      ..on('GET', r'/lifecycle/me$', fx('me_before_resigning'))
      ..on('GET', r'/lifecycle/manager/joiners$', {'joiners': <dynamic>[]})
      ..on('GET', r'/lifecycle/manager/resignations$', fx('manager_resignations_with_manager'))
      ..on('POST', r'/lifecycle/manager/resignations/', fx('manager_resignation_action'));
    final bloc = await _boot(tester, _manager, _managerTeam);
    await _tab(tester, bloc, ManagerTab.manage);
    bloc.add(const ShowTeamSection(TeamSection.requests));
    await _settle(tester);
    await shot('R7', 'requests');
    final change = find.byWidgetPredicate((w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('resignation-change-day-'));
    if (change.evaluate().isNotEmpty) {
      await _tap(tester, change.first);
      await shot('R7', 'change-last-day-picker', full: false);
    }
  });

  _scenario('R8b manager, the leaver\'s Resignation tab', (tester, shot) async {
    _server
      ..on('GET', r'/lifecycle/me$', fx('me_before_resigning'))
      ..on('GET', r'/lifecycle/manager/joiners$', {'joiners': <dynamic>[]})
      ..on('GET', r'/lifecycle/manager/resignations$', fx('manager_resignations_accepted'))
      ..on('GET', r'/lifecycle/manager/leavers/[^/]+$', fx('manager_leaver'))
      ..on('PUT', r'/lifecycle/manager/leavers/', fx('manager_leaver_handover_put'))
      ..on('POST', r'/lifecycle/manager/leavers/', fx('manager_leaver_handover_done'));
    final bloc = await _boot(tester, _manager, _managerTeam);
    await _tab(tester, bloc, ManagerTab.manage);
    await _tap(tester, find.text('Ravi Menon'));
    await _profileTab(tester, 'Resignation');
    await shot('R8b', 'resignation-tab');
    final done = find.byKey(const ValueKey('manager-mark-handover-done'));
    if (done.evaluate().isNotEmpty) {
      await _tap(tester, done);
      await shot('R8b', 'mark-done-confirm', full: false);
    }
  });

  _scenario('R8b manager, before the checklist', (tester, shot) async {
    _server
      ..on('GET', r'/lifecycle/me$', fx('me_before_resigning'))
      ..on('GET', r'/lifecycle/manager/joiners$', {'joiners': <dynamic>[]})
      ..on('GET', r'/lifecycle/manager/resignations$', fx('manager_resignations_accepted'))
      ..on('GET', r'/lifecycle/manager/leavers/[^/]+$', fx('manager_leaver_before_checklist'));
    final bloc = await _boot(tester, _manager, _managerTeam);
    await _tab(tester, bloc, ManagerTab.manage);
    await _tap(tester, find.text('Ravi Menon'));
    await _profileTab(tester, 'Resignation');
    await shot('R8b', 'before-checklist');
  });
}

// ───────────────────────────────────────────────────────────────── data

/// The meeting with the manager at 11:00 on [day].
Map<String, dynamic> _meeting({int day = 0}) {
  final meeting = fx('meeting_get');
  meeting['startsAt'] = _iso(_at(day, 11));
  meeting['endsAt'] = _iso(_at(day, 11, 30));
  meeting['place'] = 'Room 4B, Floor 4';
  return meeting;
}

/// Day 1, 10:35: the pre-boarding items done in the portal, the manager's
/// meeting at 11:00, the survey not open yet.
Map<String, dynamic> _homeDay1() {
  final home = fx('onboarding_home');
  final today = _list(home['today']);
  final later = _list(home['later']);
  final done = <Map<String, dynamic>>[];
  for (final task in [...today]) {
    task['late'] = false;
    if (task['phase'] == 'pre_boarding') {
      task['status'] = 'done';
      task['doneAt'] = _iso(_at(-3, 19, 12));
      today.remove(task);
      done.add(task);
    } else if (task['systemKey'] == 'day7_survey') {
      task['status'] = 'locked';
      today.remove(task);
      later.insert(0, task);
    }
  }
  final meeting = _meeting();
  final upNext = (fx('home_with_meeting')['upNext'] as Map).cast<String, dynamic>()
    ..['late'] = false
    ..['meeting'] = meeting;
  home
    ..['dayLabel'] = 'Day 1'
    ..['plant'] = {'stage': 1, 'water': 0, 'leaves': 0, 'droop': false}
    ..['upNext'] = upNext
    ..['today'] = today
    ..['later'] = later
    ..['done'] = done
    ..['meetings'] = [meeting]
    ..['progress'] = {'done': done.length, 'total': done.length + today.length};
  return home;
}

/// Day 4, 10:00: the first meetings and the face done, the starter task and
/// shared notes in, the intro post up next, the survey not open yet.
Map<String, dynamic> _homeDay4() {
  final home = fx('home_with_meeting');
  final today = <Map<String, dynamic>>[];
  final later = _list(home['later']);
  final done = <Map<String, dynamic>>[];
  final doneAt = {
    'about_you': _at(-3, 19, 12),
    'meet_us': _at(-2, 21, 4),
    'meet_manager': _at(0, 11, 30),
    'register_face': _at(1, 9, 30),
    'app_tour': _at(0, 15, 10),
  };
  Map<String, dynamic>? intro;
  for (final task in [..._list(home['today']), ..._list(home['done'])]) {
    task['late'] = false;
    final key = task['systemKey'] as String;
    if (doneAt.containsKey(key)) {
      done.add(task
        ..['status'] = 'done'
        ..['doneAt'] = _iso(doneAt[key]!));
    } else if (key == 'day7_survey') {
      later.insert(0, task..['status'] = 'locked');
    } else if (key == 'intro_post') {
      intro = task..['status'] = 'todo';
    } else if (key == 'one_on_one_notes' || key == 'starter_task') {
      // Shown from the starter tasks and notes themselves.
    } else {
      task['status'] = 'todo';
      today.add(task);
    }
  }
  home
    ..['dayLabel'] = 'Week 1'
    ..['plant'] = {'stage': 1, 'water': 2, 'leaves': 0, 'droop': false}
    ..['upNext'] = intro
    ..['today'] = today
    ..['later'] = later
    ..['done'] = done
    ..['meetings'] = [_meeting()..['met'] = 'yes']
    ..['progress'] = {'done': done.length, 'total': done.length + today.length + 1};
  return home;
}

/// The starter task, assigned on day 2, due on day 8.
Map<String, dynamic> _starterTasks({required bool done}) {
  final tasks = fx(done ? 'starter_task_done' : 'starter_tasks_get');
  for (final task in _list(tasks['tasks'])) {
    task['assignedAt'] = _iso(_at(1, 10, 20));
    task['note'] = 'Start with the research notes in the shared folder. A rough first version is fine; we’ll go through it together on Friday.';
    if (done) {
      task['doneAt'] = _iso(_at(3, 18, 10));
      task['doneNote'] = 'First version is in the folder. I kept the half-day option on one screen; happy to talk it through Friday.';
    }
  }
  return {'tasks': tasks['tasks']};
}

/// Meera's shared note from the first 1:1.
Map<String, dynamic> _notes({bool replied = false}) {
  final notes = fx(replied ? 'note_action' : 'notes_get');
  for (final note in _list(notes['notes'])) {
    note['sharedAt'] = _iso(_at(0, 17, 40));
    note['createdAt'] = _iso(_at(0, 17, 40));
    if (replied) {
      note['seenAt'] = _iso(_at(3, 10, 2));
      for (final reply in _list(note['replies'])) {
        reply['at'] = _iso(_at(3, 10, 2));
      }
    }
  }
  return notes;
}

/// The week-1 reels as the server sends them, with bank and PF on file (the
/// scratch company had none).
Map<String, dynamic> _week1(Map<String, dynamic> week1) => week1
  ..['bank'] = {'masked': '···· ···· 4417', 'ifsc': 'HDFC0001234', 'name': 'HDFC Bank'}
  ..['pf'] = {'uan': '1000 ···· 2231'};

/// people_get's two, and four more of the same shape.
List<Map<String, dynamic>> _people() => [
  ..._list(fx('people_get')['people']),
  {'id': 'pm-3', 'userId': 'arjun', 'name': 'Arjun Sen', 'designation': 'Engineering lead', 'why': 'Builds what you design. Agree early on how you hand off work.'},
  {'id': 'pm-4', 'userId': 'sara', 'name': 'Sara Khan', 'designation': 'Product manager', 'why': 'Decides what the team builds next and why.'},
  {'id': 'pm-5', 'userId': 'rohit', 'name': 'Rohit Verma', 'designation': 'Customer support lead', 'why': 'Hears every user complaint first. Great source of design ideas.'},
  {'id': 'pm-6', 'userId': 'meeraj', 'name': 'Meera Joshi', 'designation': 'Research', 'why': 'Runs user interviews you can sit in on from month 2.'},
];

List<Map<String, dynamic>> _directory() => [
  for (final (id, name, role) in [
    ('p1', 'Kiran Shah', 'Designer'),
    ('p2', 'Tara Bose', 'Researcher'),
    ('arjun', 'Arjun Sen', 'Senior Designer'),
    ('vani', 'Vani Pillai', 'Visual Designer'),
    ('sara', 'Sara Khan', 'Product manager'),
    ('rohit', 'Rohit Verma', 'Customer support lead'),
  ])
    {'userId': id, 'id': id, 'name': name, 'designation': role, 'department': 'Design'},
];

/// The pushes the server sends [userId], as inbox rows: the newest first,
/// the first two unread.
List<Map<String, dynamic>> _inbox(String userId) {
  final pushes = [for (final p in _list(fx('push_payloads')['pushes'])) if (p['userId'] == userId) p];
  final rows = <Map<String, dynamic>>[];
  for (var i = 0; i < pushes.length; i++) {
    final push = pushes[pushes.length - 1 - i];
    final data = (push['data'] as Map).cast<String, dynamic>();
    rows.add({
      'id': 'n$i',
      'title': push['title'],
      'body': push['body'],
      'type': data['type'] ?? 'lifecycle',
      'data': data,
      'createdAt': _iso(_fixtureMorning.subtract(Duration(minutes: 10 + i * 95))),
      'readAt': i < 2 ? null : _iso(_fixtureMorning),
    });
  }
  return rows;
}

/// The joiner's probation, month 1's goals set by the manager.
Map<String, dynamic> _probation() {
  final probation = fx('probation_get');
  final goals = _list(fx('manager_probation_month')['months']).first['goals'];
  final months = _list(probation['months']);
  months.first
    ..['goals'] = [for (final g in goals as List) (g as Map)['text']]
    ..['goalsSetAt'] = _iso(_at(1, 10));
  probation['months'] = months;
  return probation;
}

/// The manager's view of the joiner; [withCheckin] adds the joiner's month-1
/// check-in, [reply] keeps the manager's reply on the starter task.
Map<String, dynamic> _managerJoiner({bool withCheckin = false, bool reply = true}) {
  final detail = fx('manager_joiner');
  if (!reply) {
    for (final task in _list(detail['starterTasks'])) {
      task.remove('managerReply');
    }
  }
  final probation = (detail['probation'] as Map?)?.cast<String, dynamic>();
  if (probation != null) {
    final months = _list(probation['months']);
    final goals = _list(fx('manager_probation_month')['months']).first['goals'] as List;
    months.first['goals'] = [for (final g in goals) (g as Map)['text']];
    if (withCheckin) {
      months.first['checkinEmployee'] = {
        'text': 'A win: Shipped the first version of the leave request redesign.\nWould help: Access to the analytics dashboard.',
        'rating': 3,
        'at': _iso(_at(27, 18)),
      };
    }
    probation['months'] = months;
    detail['probation'] = probation;
  }
  return detail;
}

/// Payroll for the leaver: November held, October paid.
void _payrollRoutes() {
  Map<String, dynamic> slip(String period, {bool held = false}) => {
    'run': {'id': 'run-$period', 'period': period, 'status': 'paid', 'paidAt': '$period-28T09:00:00.000Z'},
    'payslip': {
      'id': 'slip-$period',
      'period': period,
      'employeeName': 'Ravi Menon',
      if (held) 'held': {'reason': 'notice', 'since': fx('offboarding_get')['noticeFrom']},
      'earnings': [
        {'code': 'BASIC', 'name': 'Basic', 'fullPaise': 6200000, 'paidPaise': 6200000},
        {'code': 'HRA', 'name': 'House rent allowance', 'fullPaise': 3100000, 'paidPaise': 3100000},
        {'code': 'SPECIAL', 'name': 'Special allowance', 'fullPaise': 3100000, 'paidPaise': 3100000},
      ],
      'deductions': [
        {'code': 'PF', 'name': 'Provident fund', 'paise': 180000},
        {'code': 'TDS', 'name': 'Income tax', 'paise': 1560000},
        {'code': 'PT', 'name': 'Professional tax', 'paise': 20000},
      ],
      'grossPaise': 12400000,
      'netPayablePaise': 10640000,
      'reimbursementsPaise': 0,
      'inputs': {'workingDays': 30, 'payableDays': 30, 'lopDays': 0},
    },
  };
  _server
    ..on('GET', r'/payroll/me/salary$', {
      'success': true,
      'salary': {
        'period': '2026-11',
        'label': 'November 2026',
        'view': 'current',
        'currentPeriod': '2026-11',
        'previousPeriod': '2026-10',
        'released': false,
        'payslipId': null,
        'periodFrom': '2026-11-01',
        'periodTo': '2026-11-30',
        'unpaidDays': {'period': '2026-11', 'count': 0, 'locked': false},
        'payslips': {'count': 3, 'from': '2026-09', 'to': '2026-11'},
        'daysPaid': 16,
        'daysInPeriod': 30,
        'baseDays': 30,
        'grossPaise': 12400000,
        'takeHomePaise': 10640000,
        'lines': <dynamic>[],
        'lop': {'days': 0},
        'notSetUp': null,
      },
    })
    ..on('GET', r'/payslips/mine$', {
      'success': true,
      'company': {'name': 'Sowaka', 'address': 'Bengaluru'},
      'payslips': [slip('2026-11', held: true), slip('2026-10'), slip('2026-09')],
    });
  // Held shows only where the lifecycle is on.
  LifecycleMeStore.instance.value = LifecycleMe.fromJson(fx('me_on_notice'));
}
