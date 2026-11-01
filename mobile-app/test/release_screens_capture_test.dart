// Screenshots of every screen the 1.4.0 release changes, for review: each
// screen at 390×844 and at 360×740 (both at 3x, with a status-bar and
// home-bar inset), against fake servers with made-up data in the sowaka org.
//
// Nothing here asserts: a screen that overflows or throws is recorded, not
// failed, so every screen still gets its picture. Each picture's problems
// (Flutter layout errors, exceptions, text cut short with an ellipsis or a
// line limit) go to results.json beside the PNGs.
//
// `flutter test --dart-define=SCREENS_OUT=<dir> test/release_screens_capture_test.dart`
// writes into <dir>; without it the test does nothing.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:file_picker/file_picker.dart';
// ignore: implementation_imports
import 'package:file_picker/src/platform/file_picker_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator_platform_interface/geolocator_platform_interface.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/attendance/presentation/punch_screen.dart';
import 'package:mobile_app/features/attendance/presentation/slide_to_punch.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/connect/presentation/connect_feed_screen.dart';
import 'package:mobile_app/features/face_id/face_camera.dart';
import 'package:mobile_app/features/face_id/face_capture_layout.dart';
import 'package:mobile_app/features/face_id/face_check_screen.dart';
import 'package:mobile_app/features/face_id/face_sounds.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';
import 'package:mobile_app/features/payroll/data/payroll_api_service.dart';
import 'package:mobile_app/features/profile/profile.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';
import 'package:mobile_app/features/shared/app_toast.dart';
import 'package:mobile_app/features/support/presentation/support_desk_screen.dart';
import 'package:mobile_app/features/support/support_launcher.dart';

import 'payroll_test_server.dart';
import 'support_test_helpers.dart';

const _out = String.fromEnvironment('SCREENS_OUT');

// ------------------------------------------------------------------ phones

class _Phone {
  const _Phone(this.width, this.height, this.top, this.bottom, this.keyboard);
  final double width;
  final double height;

  /// Status bar and home bar, logical px.
  final double top;
  final double bottom;

  /// The on-screen keyboard's height, for the screens typed into.
  final double keyboard;

  String get tag => width.toInt().toString();
}

const _phones = [
  // iPhone 14/15: notch status bar, home indicator.
  _Phone(390, 844, 47, 34, 336),
  // A small Android phone: plain status bar, gesture bar.
  _Phone(360, 740, 24, 16, 290),
];

const _dpr = 3.0;

void _setPhone(WidgetTester tester, _Phone phone) {
  tester.view.physicalSize = Size(phone.width * _dpr, phone.height * _dpr);
  tester.view.devicePixelRatio = _dpr;
  final inset = FakeViewPadding(top: phone.top * _dpr, bottom: phone.bottom * _dpr);
  tester.view.padding = inset;
  tester.view.viewPadding = inset;
  addTearDown(tester.view.reset);
}

/// The keyboard up, as when a field is being typed into.
void _keyboardUp(WidgetTester tester, _Phone phone) {
  tester.view.viewInsets = FakeViewPadding(bottom: phone.keyboard * _dpr);
}

/// A grey block where the keyboard would be, so a screen typed into does not
/// read as cut off at the bottom.
Widget _keyboardStandIn(BuildContext context, Widget? child) {
  final keyboard = MediaQuery.viewInsetsOf(context).bottom;
  return Stack(
    children: [
      child ?? const SizedBox(),
      if (keyboard > 0)
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          height: keyboard,
          child: const ColoredBox(
            color: Color(0xFFD1D3D9),
            child: Center(
              child: Text(
                'keyboard',
                style: TextStyle(fontFamily: 'Plus Jakarta Sans', color: Color(0xFF8E9099), fontSize: 13, decoration: TextDecoration.none),
              ),
            ),
          ),
        ),
    ],
  );
}

/// The app's own theme, as main.dart sets it.
ThemeData _theme() => ThemeData(
  fontFamily: 'Plus Jakarta Sans',
  colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0571A6), brightness: Brightness.light),
  scaffoldBackgroundColor: const Color(0xFFF7F7F9),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: Colors.white,
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: Color(0xFFE8E8F0)),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: Color(0xFFE8E8F0)),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: Color(0xFF0571A6), width: 1.5),
    ),
  ),
  textSelectionTheme: const TextSelectionThemeData(
    cursorColor: Color(0xFF0571A6),
    selectionHandleColor: Color(0xFF0571A6),
    selectionColor: Color(0x330571A6),
  ),
  useMaterial3: true,
);

// ------------------------------------------------------------------ shots

/// Every picture, in the order of the review list; the number in a file's
/// name is its place here.
const _order = [
  'faceid-intro',
  'faceid-front-1of3',
  'faceid-left-2of3',
  'faceid-right-3of3',
  'faceid-done',
  'faceid-done-onboarding',
  'facecheck-camera',
  'facecheck-punched-in',
  'payroll-home-overtime',
  'payroll-home-scrolled',
  'payroll-salary-breakdown',
  'payroll-tax-saving-split',
  'payroll-income-tax',
  'payroll-investment-proofs',
  'payroll-payslips',
  'payroll-payslip-detail',
  'payroll-payslip-detail-scrolled',
  'payroll-error-raise-ticket',
  'grow-month-picker',
  'grow-report-last-month-pending',
  'grow-feedback-form-last-month',
  'grow-short-comment-error',
  'grow-two-levels-up',
  'grow-two-levels-up-scrolled',
  'contest-entry-votes',
  'contest-voted-by-sheet',
  'contest-own-entry-delete',
  'contest-own-entry-delete-confirm',
  'contest-mention-list',
  'contest-tagged-link',
  'attendance-joined-mid-month',
  'attendance-before-joining-day',
  'attendance-lwp-type-picker',
  'attendance-lwp-apply-form',
  'support-contact-hr-toast',
  'support-new-ticket-prefilled',
];

final _results = <Map<String, Object?>>[];

/// Run once the screen is gone, before its timers are left to run out.
final _beforeEnd = <void Function()>[];

class _Shooter {
  _Shooter(this.tester, this.phone, this.scenario);
  final WidgetTester tester;
  final _Phone phone;
  final String scenario;

  /// Problems since the last picture: they belong to the next one.
  final _pending = <String>[];

  /// True inside `tester.runAsync`, which cannot be entered twice.
  bool inAsync = false;

  void onError(FlutterErrorDetails details) {
    final text = details.exceptionAsString().trim();
    // A photo or face the fake servers do not have: not a layout problem.
    if (text.contains('HTTP request failed') || text.contains('NetworkImageLoadException')) {
      _pending.add('image: ${text.split('\n').first}');
      return;
    }
    final where = RegExp(r'(lib/[\w/]+\.dart):(\d+)').firstMatch(details.toString());
    final first = text.split('\n').first;
    _pending.add('${where == null ? '' : '[${where.group(1)}:${where.group(2)}] '}$first');
  }

  Future<void> _async(Future<void> Function() work) async {
    if (inAsync) {
      await work();
    } else {
      await tester.runAsync(work);
    }
  }

  /// Texts on screen that were cut short: an ellipsis, or more lines than
  /// allowed.
  List<String> _cutShort() {
    final found = <String>[];
    final hit = find.byType(RichText).hitTestable().evaluate().toSet();
    for (final element in find.byType(RichText).evaluate()) {
      final render = element.renderObject;
      if (render is RenderParagraph && render.hasSize && render.didExceedMaxLines && hit.contains(element)) {
        found.add(render.text.toPlainText().replaceAll('\n', ' '));
      }
    }
    return found;
  }

  Future<void> call(String id, String caption) async {
    if (_out.isEmpty) return;
    // Images decode off the fake clock: wait for them.
    await _async(() async {
      for (final element in find.byType(Image).evaluate()) {
        try {
          await precacheImage((element.widget as Image).image, element).timeout(const Duration(seconds: 3));
        } catch (_) {}
      }
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pump();
    final exception = tester.takeException();
    if (exception != null) _pending.add('exception: $exception');
    final index = _order.indexOf(id);
    final number = (index < 0 ? 99 : index + 1).toString().padLeft(2, '0');
    final file = '$number-$id-${phone.tag}.png';
    final root = find.byType(MaterialApp).evaluate().first;
    await _async(() async {
      final image = await captureImage(root);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      image.dispose();
      File('$_out/$file').writeAsBytesSync(bytes!.buffer.asUint8List());
    });
    _results.add({
      'id': id,
      'number': number,
      'phone': phone.tag,
      'file': file,
      'caption': caption,
      'scenario': scenario,
      'errors': [..._pending],
      'cutShort': _cutShort(),
    });
    _pending.clear();
  }

  /// What went wrong after the last picture, kept with the scenario.
  void finish(Object? failure) {
    if (_pending.isEmpty && failure == null) return;
    _results.add({
      'id': '$scenario (after last picture)',
      'number': '--',
      'phone': phone.tag,
      'scenario': scenario,
      'errors': [..._pending],
      'failure': failure?.toString(),
    });
    _pending.clear();
  }
}

/// [body] once per phone. A failure is recorded and the test passes, so one
/// broken screen does not cost the rest their pictures.
void _scenario(String name, Future<void> Function(WidgetTester tester, _Shooter shot, _Phone phone) body) {
  for (final phone in _phones) {
    testWidgets('$name · ${phone.tag}', (tester) async {
      if (_out.isEmpty) return;
      final shot = _Shooter(tester, phone, name);
      final before = FlutterError.onError;
      FlutterError.onError = shot.onError;
      Object? failure;
      try {
        _setPhone(tester, phone);
        await body(tester, shot, phone);
      } catch (error, stack) {
        failure = '$error\n${stack.toString().split('\n').take(6).join('\n')}';
      } finally {
        shot.finish(failure);
        FlutterError.onError = before;
      }
      // Whatever the screen left running runs out here.
      await tester.pumpWidget(const SizedBox.shrink());
      for (final dispose in _beforeEnd) {
        dispose();
      }
      _beforeEnd.clear();
      await tester.pump(const Duration(seconds: 30));
      tester.takeException();
    });
  }
}

/// Replies, route transitions, SVGs and images landing.
Future<void> _settle(WidgetTester tester, {bool inAsync = false}) async {
  for (var i = 0; i < 3; i++) {
    await tester.pump(const Duration(milliseconds: 100));
    if (inAsync) {
      await Future<void>.delayed(const Duration(milliseconds: 60));
    } else {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 60)));
    }
  }
  await tester.pump(const Duration(milliseconds: 400));
  await tester.pump(const Duration(milliseconds: 100));
}

Future<void> _tapVisible(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder, warnIfMissed: false);
  await _settle(tester);
}

http.Response _ok(Map<String, dynamic> body) => http.Response.bytes(
  utf8.encode(jsonEncode({'success': true, ...body})),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

String _ymd(DateTime day) =>
    '${day.year}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';

/// A photo from the app's own assets, as a `data:` URI (no network here).
String _photo(String asset) => 'data:image/jpeg;base64,${base64Encode(File(asset).readAsBytesSync())}';

// ------------------------------------------------------------------ face

class _FakeCamera extends FaceCamera {
  @override
  Future<void> start() async => again();

  @override
  Future<void> pause() async {}

  void sees(FaceProblem next) {
    problem = next;
    signal = next == FaceProblem.none ? FaceSignal.detected : FaceSignal.notDetected;
    notifyListeners();
  }

  void bursts({double spoof = 0.96, double yaw = 0}) {
    hold();
    onBurst?.call(
      FaceBurst(
        photo: Uint8List.fromList([0xff, 0xd8, 0xff, 0xe0, 1]),
        crops: List.generate(8, (i) => Uint8List.fromList([0xff, 0xd8, 0xff, i])),
        spoofPhone: spoof,
        motionMean: 1.6,
        motionRigid: 0.42,
        yaw: yaw,
        report: 'captured ${pose.name}',
      ),
    );
  }
}

class _FakeGeolocator extends GeolocatorPlatform {
  @override
  Future<bool> isLocationServiceEnabled() async => true;
  @override
  Future<LocationPermission> checkPermission() async => LocationPermission.always;
  @override
  Future<LocationPermission> requestPermission() async => LocationPermission.always;
  @override
  Future<Position> getCurrentPosition({LocationSettings? locationSettings}) async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return Position(
      latitude: 28.4595,
      longitude: 77.0266,
      timestamp: DateTime.now(),
      accuracy: 12,
      altitude: 0,
      altitudeAccuracy: 0,
      heading: 0,
      headingAccuracy: 0,
      speed: 0,
      speedAccuracy: 0,
    );
  }
}

late _FakeCamera _camera;

http.Client _faceServer() => MockClient((request) async {
  final path = request.url.path;
  if (path.endsWith('/face/status')) {
    return _ok({
      'checkAtPunch': true,
      'enrolled': true,
      'consent': {'version': 'v4', 'agree': "Sowaka keeps a template of your face to confirm it's you when you punch in."},
      'liveness': {'mode': 'device'},
      'maxAttempts': 5,
      'failedAttempts': 0,
      'fallbackAvailable': false,
      'managerName': 'Raghav',
    });
  }
  if (path.endsWith('/face/challenge')) {
    return _ok({'id': 'ch-1', 'expiresAt': '2026-11-02T04:03:00Z'});
  }
  if (path.endsWith('/face/enrol')) {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return _ok({'enrolled': true, 'token': 'enrol-tok'});
  }
  if (path.endsWith('/face/verify')) {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return _ok({'passed': true, 'reason': 'matched', 'token': 'verify-tok'});
  }
  if (path.endsWith('/attendance/punch/check')) {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    return _ok({
      'geofenced': true,
      'inside': true,
      'office': {'id': 'o1', 'name': 'Sowaka Office, Gurugram', 'city': 'Gurugram'},
    });
  }
  if (path.endsWith('/attendance/punch')) {
    return _ok({'workDate': '2026-11-02', 'punchIn': '2026-11-02T04:02:00.000Z', 'officeName': 'Sowaka Office, Gurugram'});
  }
  return _ok({});
});

AuthUser _faceUser({required bool enrolled}) => AuthUser.fromJson({
  'id': 'u1',
  'email': 'ananya@sowaka.test',
  'name': 'Ananya Bisht',
  'company': 'Sowaka',
  'org': 'sowaka',
  'interests': ['Music'],
  'faceId': {'enrolled': enrolled, 'atPunch': true},
});

/// The home card's slider, dragged: the punch screen opens on the camera.
Future<void> _slideToPunch(WidgetTester tester, {required bool enrolled}) async {
  FaceSounds.enabled = false;
  FaceCheckOutcome.enrolledThisRun = false;
  FaceCamera.create = () => _camera = _FakeCamera();
  GeolocatorPlatform.instance = _FakeGeolocator();
  final api = ManagerApiService(
    session: AuthSession(token: 't', user: _faceUser(enrolled: enrolled)),
    baseUrl: 'https://example.test',
    client: _faceServer(),
  );
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: _theme(),
      home: Builder(
        builder: (context) => Scaffold(
          backgroundColor: const Color(0xFFF4F6F8),
          body: Center(
            child: TextButton(
              onPressed: () => Navigator.of(context).push<PunchOutcome>(
                MaterialPageRoute(builder: (_) => PunchScreen(api: api, type: 'in', geofenced: true)),
              ),
              child: const Text('Attendance'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Attendance'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
  final slider = find.byType(SlideToPunch);
  final knob = find.descendant(of: slider, matching: find.byType(GestureDetector)).last;
  await tester.drag(knob, Offset(tester.getSize(slider).width, 0));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

Future<void> _faceSettle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
  await tester.pump();
}

// ------------------------------------------------------------------ manager shell (Grow)

Map<String, dynamic> _member(
  String id,
  String name, {
  bool reportsToViewer = false,
  bool isSelf = false,
  String department = 'Design',
  String designation = 'Product Designer',
}) => {
  'userId': id,
  'name': name,
  'department': department,
  'designation': designation,
  'reportsToViewer': reportsToViewer,
  'inViewerChain': reportsToViewer,
  'isSelf': isSelf,
  'email': '$id@sowaka.test',
  'parameters': <dynamic>[],
  'history': <dynamic>[],
};

String _period(DateTime date) => '${date.year}-${date.month.toString().padLeft(2, '0')}';
final _thisMonth = _period(DateTime.now());
final _lastMonth = _period(DateTime(DateTime.now().year, DateTime.now().month - 1));
const _monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
String _short(String period) => '${_monthsShort[int.parse(period.substring(5)) - 1]} ${period.substring(0, 4)}';

final _managerSession = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'pankaj',
    email: 'pankaj@sowaka.test',
    name: 'Pankaj Mehra',
    role: 'manager',
    company: 'Sowaka',
    org: 'sowaka',
    employeeId: 'SW042',
    employmentType: 'full_time',
  ),
);

Future<ManagerBloc> _bootShell(WidgetTester tester, {List<Map<String, dynamic>> team = const []}) async {
  final workspace = {
    'team': [_member('pankaj', 'Pankaj Mehra', isSelf: true, designation: 'Design Lead'), ...team],
    'recognitionCandidates': <dynamic>[],
    'nominations': <dynamic>[],
    'myParameters': <dynamic>[],
    'growthHistory': <dynamic>[],
    'holidays': <dynamic>[],
    'myOrgChart': <dynamic>[],
    'weekoffDays': [0],
    'shift': <String, dynamic>{},
    'approverName': 'Ritika Sen',
    'hasManager': true,
    'teamLevel': 2,
  };
  final client = MockClient((request) async {
    if (request.url.path.endsWith('/manager/workspace')) return _ok(workspace);
    if (request.method == 'PUT' && request.url.path.contains('/manager/feedback/')) {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      return _ok({'feedback': {'status': body['status']}});
    }
    return _ok({
      'leaves': <dynamic>[],
      'overtime': <dynamic>[],
      'regularizations': <dynamic>[],
      'claims': <dynamic>[],
      'types': <dynamic>[],
      'records': <dynamic>[],
      'balance': <String, dynamic>{},
    });
  });
  ConnectApiService.testClient = MockClient((request) async => _ok({'posts': <dynamic>[], 'nextCursor': null, 'total': 0}));
  addTearDown(() => ConnectApiService.testClient = null);
  final bloc = ManagerBloc(
    session: _managerSession,
    service: ManagerApiService(session: _managerSession, baseUrl: 'https://example.test', client: client),
  );
  await bloc.add(const LoadManagerDashboard());
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: _theme(),
      builder: _keyboardStandIn,
      home: ManagerScreen(session: _managerSession, bloc: bloc),
    ),
  );
  await tester.pumpAndSettle(const Duration(seconds: 1));
  _beforeEnd.add(bloc.dispose);
  return bloc;
}

/// The profile's own Grow tab (the bottom bar has one too): the higher one.
Future<void> _openGrowTab(WidgetTester tester) async {
  final tabs = find.text('Grow').evaluate().toList()
    ..sort((a, b) => tester.getTopLeft(find.byWidget(a.widget)).dy.compareTo(tester.getTopLeft(find.byWidget(b.widget)).dy));
  await tester.ensureVisible(find.byWidget(tabs.first.widget));
  await tester.pumpAndSettle();
  await tester.tap(find.byWidget(tabs.first.widget));
  await tester.pumpAndSettle();
}

Future<void> _settleTap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Finder _note(String name) => find.descendant(
  of: find.byWidgetPredicate(
    (w) =>
        w.key is ValueKey<String> &&
        (w.key! as ValueKey<String>).value.startsWith('feedback-param-') &&
        (w.key! as ValueKey<String>).value.endsWith('-$name'),
  ),
  matching: find.byType(TextFormField),
);

Future<void> _rate(WidgetTester tester, Map<String, int> scores) async {
  for (final MapEntry(key: name, value: score) in scores.entries) {
    await _settleTap(tester, find.byWidgetPredicate((w) => w is Semantics && w.properties.label == 'Rate $name $score out of 5'));
    await tester.pump();
  }
}

const _long = 'Took the onboarding redesign end to end, ran three rounds of user tests and kept engineering in the loop.';

// ------------------------------------------------------------------ contest

final _viewer = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'viewer',
    email: 'tanvi@sowaka.test',
    name: 'Tanvi Arora',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    interests: [],
  ),
);

Map<String, dynamic> _entry(
  String id, {
  required String userId,
  required String name,
  required String photo,
  int votes = 0,
  String text = '',
  List<Map<String, String>> mentions = const [],
  String createdAt = '2026-10-31T06:00:00.000Z',
}) => {
  'id': id,
  'userId': userId,
  'name': name,
  'initials': name.split(' ').map((w) => w[0]).join(),
  'text': text,
  'photoUrl': photo,
  'votes': votes,
  'points': votes * 10,
  'votedByViewer': false,
  'isMine': userId == 'viewer',
  'createdAt': createdAt,
  if (mentions.isNotEmpty) 'mentions': mentions,
};

Map<String, dynamic> _contest(Map<String, String> photos) {
  final entries = [
    _entry(
      'kiran-1',
      userId: 'kiran',
      name: 'Kiran Das',
      photo: photos['a']!,
      votes: 5,
      text: 'Morning light over the studio desks before anyone came in.',
      createdAt: '2026-10-30T05:00:00.000Z',
    ),
    _entry(
      'manav-1',
      userId: 'manav',
      name: 'Manav Shah',
      photo: photos['b']!,
      votes: 2,
      text: 'Shot with @Chitra Rao on the roof after the Diwali lunch',
      mentions: [
        {'userId': 'chitra', 'name': 'Chitra Rao'},
      ],
    ),
    _entry('mine-1', userId: 'viewer', name: 'Tanvi Arora', photo: photos['c']!, votes: 1, text: 'My corner, plants and all.', createdAt: '2026-10-31T07:00:00.000Z'),
    _entry('mine-2', userId: 'viewer', name: 'Tanvi Arora', photo: photos['a']!, createdAt: '2026-10-31T08:00:00.000Z'),
  ];
  return {
    'id': 'contest',
    'type': 'photo_story_challenge',
    'tag': 'Best Photo',
    'author': {'userId': 'author', 'name': 'Ritika Sen', 'initials': 'RS'},
    'audience': {'label': 'Public'},
    'body': {
      'title': 'Best desk photo',
      'task': 'Share the best photo of your desk this Diwali week',
      'pointsPerVote': 10,
      'closesAt': DateTime.now().add(const Duration(days: 2)).toUtc().toIso8601String(),
      'entries': entries,
      'leaderboard': [
        for (final (index, entry) in entries.indexed) {...entry, 'rank': index + 1},
      ],
      'myEntryId': null,
      'myEntryIds': ['mine-1', 'mine-2'],
      'maxEntries': 5,
      'myVoteEntryId': null,
    },
    'liked': false,
    'likeCount': 12,
    'commentCount': 3,
    'comments': <dynamic>[],
    'publishedAt': '2026-10-29T06:00:00.000Z',
  };
}

MockClient _contestServer(Map<String, String> photos) => MockClient((request) async {
  final path = request.url.path;
  if (path.endsWith('/auth/teammates')) {
    return _ok({
      'teammates': [
        for (final (id, name, role, dept) in [
          ('viewer', 'Tanvi Arora', 'HR Executive', 'People'),
          ('manav', 'Manav Shah', '3D Artist', '3D'),
          ('chitra', 'Chitra Rao', 'Lead Visualiser', '3D'),
          ('chinmay', 'Chinmay Kulkarni', 'Unreal Developer', 'Engineering'),
          ('chirag', 'Chirag Bhatnagar', 'Account Manager', 'Sales'),
          ('kiran', 'Kiran Das', 'Product Designer', 'Design'),
        ])
          {'userId': id, 'name': name, 'designation': role, 'department': dept},
      ],
    });
  }
  if (RegExp(r'/connect/posts/contest/captions/([^/]+)/voters$').hasMatch(path)) {
    return _ok({
      'voters': [
        for (final (id, name, initials, role, dept, color) in [
          ('kiran', 'Kiran Das', 'KD', 'Product Designer', 'Design', '#335577'),
          ('chitra', 'Chitra Rao', 'CR', 'Lead Visualiser', '3D', '#553377'),
          ('chinmay', 'Chinmay Kulkarni', 'CK', 'Unreal Developer', 'Engineering', '#2F7D5B'),
          ('aditi', 'Aditi Venkataraman-Iyer', 'AV', 'Senior Business Development Manager', 'Sales & Partnerships', '#A0522D'),
          ('rohit', 'Rohit Nair', 'RN', 'QA Engineer', 'Engineering', '#4B5563'),
        ])
          {'userId': id, 'name': name, 'initials': initials, 'designation': role, 'department': dept, 'avatarColor': color},
      ],
    });
  }
  if (path.endsWith('/connect/posts/contest/captions')) {
    return _ok({'post': _contest(photos)});
  }
  if (path.endsWith('/connect/posts/contest')) return _ok({'post': _contest(photos)});
  return _ok({});
});

Map<String, String> _contestPhotos() => {
  'a': _photo('assets/care/sleep_background.jpg'),
  'b': _photo('assets/care/nervous_seated.jpg'),
  'c': _photo('assets/care/pose_anxious.jpg'),
};

Future<void> _openEntries(WidgetTester tester) async {
  final photos = _contestPhotos();
  final client = _contestServer(photos);
  final api = ConnectApiService(session: _viewer, baseUrl: 'https://example.test', client: client);
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: _theme(),
      builder: _keyboardStandIn,
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: TextButton(
              onPressed: () => http.runWithClient(
                () => unawaited(openContestEntries(context, _viewer, 'contest', api: api, onOpenPerson: (_) {})),
                () => client,
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await _contestSettle(tester);
}

Future<void> _contestSettle(WidgetTester tester) async {
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 300));
  }
  await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
  await tester.pump(const Duration(milliseconds: 100));
}

final _galleryCards = find.byWidgetPredicate((widget) => widget.runtimeType.toString() == '_GalleryEntryCard');

/// Opens the entry [id] full screen, trying each gallery card in turn.
Future<void> _openEntry(WidgetTester tester, String id) async {
  final count = _galleryCards.evaluate().length;
  for (var i = 0; i < count; i++) {
    final card = _galleryCards.at(i);
    await tester.ensureVisible(card);
    await tester.pump();
    await tester.tapAt(tester.getTopLeft(card) + const Offset(60, 70));
    await _contestSettle(tester);
    if (find.byKey(ValueKey('entry-voters-$id')).evaluate().isNotEmpty) return;
    if (find.byKey(const ValueKey('entry-view')).evaluate().isNotEmpty) {
      await tester.tapAt(const Offset(10, 60));
      await _contestSettle(tester);
    }
  }
  throw StateError('entry $id not found in the gallery');
}

class _FakeFilePicker extends FilePickerMacOS {
  _FakeFilePicker(this.path);
  final String path;

  @override
  Future<FilePickerResult?> pickFiles({
    String? dialogTitle,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    Function(FilePickerStatus)? onFileLoading,
    int compressionQuality = 0,
    bool allowMultiple = false,
    bool withData = false,
    bool withReadStream = false,
    bool lockParentWindow = false,
    bool readSequential = false,
    bool cancelUploadOnWindowBlur = true,
  }) async => FilePickerResult([PlatformFile(path: path, name: 'desk.jpg', size: File(path).lengthSync())]);
}

// ------------------------------------------------------------------ actions (attendance, leave)

/// Joined on the 14th of last month.
final _joined = DateTime(DateTime.now().year, DateTime.now().month - 1, 14);

AuthSession _actionsSession() => AuthSession(
  token: 'token',
  user: AuthUser(
    id: 'tanvi',
    email: 'tanvi@sowaka.test',
    name: 'Tanvi Arora',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    joiningDate: _ymd(_joined),
  ),
);

MockClient _actionsServer() {
  final lwpDay = DateTime(_joined.year, _joined.month, 27);
  String at(DateTime day, int h, int m) => DateTime(day.year, day.month, day.day, h, m).toUtc().toIso8601String();
  return MockClient((request) async {
    final path = request.url.path;
    if (path.endsWith('/manager/workspace')) {
      return _ok({
        'team': <dynamic>[],
        'holidays': [
          {'date': _ymd(DateTime(_joined.year, _joined.month, 20)), 'name': 'Diwali'},
        ],
        'weekoffDays': [6, 0],
        'shift': {
          'name': 'Default',
          'startTime': '09:30',
          'endTime': '18:30',
          'minHalfDayHours': 4,
          'minFullDayHours': 8,
          'weeklyOff': {
            for (final week in ['1', '2', '3', '4', '5']) week: [5, 6],
          },
          'leaveTypes': [
            {'key': 'casual', 'name': 'Casual Leave', 'advanceDays': 30, 'allowBackdated': true, 'backdatedDays': 7, 'unpaid': false},
            {'key': 'sick', 'name': 'Sick Leave', 'advanceDays': 30, 'allowBackdated': true, 'backdatedDays': 7, 'unpaid': false},
            {'key': 'without_pay', 'name': 'Leave without pay', 'advanceDays': 30, 'allowBackdated': true, 'backdatedDays': 7, 'unpaid': true},
          ],
          'leaveBalanceTracked': true,
          'correction': {
            'triggers': ['Missing punch-in', 'Missing punch-out', 'Both punches missing'],
            'backdateDays': 31,
            'punchFormat': 'In-app punch in',
            'punchMode': 'Both punches',
          },
        },
        'overtimeEnabled': true,
        'hasManager': true,
      });
    }
    if (path.endsWith('/leaves/balance')) {
      return _ok({
        'balance': {
          'year': DateTime.now().year,
          'types': [
            {'key': 'casual', 'name': 'Casual Leave', 'total': 2, 'used': 0, 'remaining': 2},
            {'key': 'sick', 'name': 'Sick Leave', 'total': 1.5, 'used': 0, 'remaining': 1.5},
            {'key': 'without_pay', 'name': 'Leave without pay', 'total': 0, 'used': 1, 'remaining': 0, 'unlimited': true, 'unpaid': true},
          ],
        },
      });
    }
    if (path.endsWith('/leaves/mine')) {
      return _ok({
        'leaves': [
          {
            'id': 'lwp-1',
            'type': 'without_pay',
            'typeName': 'Leave without pay',
            'startDate': _ymd(lwpDay),
            'endDate': _ymd(lwpDay),
            'days': 1,
            'halfDay': false,
            'reason': 'Family function out of town',
            'status': 'approved',
            'createdAt': at(lwpDay, 8, 0),
          },
        ],
      });
    }
    if (path.contains('/attendance/mine')) {
      final from = DateTime.parse(request.url.queryParameters['from'] ?? _ymd(_joined));
      final to = DateTime.parse(request.url.queryParameters['to'] ?? _ymd(DateTime.now()));
      final today = DateTime.now();
      final records = <Map<String, dynamic>>[];
      for (var d = _joined; d.isBefore(DateTime(today.year, today.month, today.day)); d = DateTime(d.year, d.month, d.day + 1)) {
        if (d.isBefore(from) || d.isAfter(to)) continue;
        if (d.weekday >= DateTime.saturday || d.day == 20 || d == lwpDay) continue;
        // One day with the punch-out missing.
        records.add({'workDate': _ymd(d), 'punchIn': at(d, 9, 20 + d.day % 15), if (d.day != 23) 'punchOut': at(d, 18, 35 + d.day % 20)});
      }
      return _ok({'records': records, 'regularizations': <dynamic>[]});
    }
    return _ok({
      'leaves': <dynamic>[],
      'overtime': <dynamic>[],
      'regularizations': <dynamic>[],
      'claims': <dynamic>[],
      'types': <dynamic>[],
      'records': <dynamic>[],
      'balance': <String, dynamic>{},
    });
  });
}

Future<void> _pumpActions(WidgetTester tester) async {
  final session = _actionsSession();
  final bloc = ManagerBloc(
    session: session,
    service: ManagerApiService(session: session, baseUrl: 'https://example.test', client: _actionsServer()),
  );
  await tester.runAsync(() => bloc.add(const LoadManagerDashboard()));
  final controller = QuickActionsController();
  addTearDown(() {
    bloc.dispose();
    controller.dispose();
  });
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: _theme(),
      // As the shell does: the screen rebuilt on each new state, so a month
      // paged to shows its days.
      home: Scaffold(
        body: StreamBuilder<ManagerState>(
          stream: bloc.stream,
          initialData: bloc.state,
          builder: (context, snapshot) => QuickActionsScreen(
            bloc: bloc,
            dashboard: (snapshot.data ?? bloc.state).dashboard!,
            controller: controller,
            profileAction: const SizedBox(width: 30, height: 30),
            onNotifications: () {},
            onOpenComposer: () {},
          ),
        ),
      ),
    ),
  );
  await _settle(tester);
}

// ------------------------------------------------------------------ payroll

Future<FakePayrollServer> _pumpPayroll(WidgetTester tester, FakePayrollServer server) async {
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: _theme(),
      home: Scaffold(
        body: PayrollScreen(
          api: PayrollApiService(session: payrollSession, baseUrl: 'https://example.test', client: FakePayrollClient(server)),
          onClose: () {},
          profileAction: const SizedBox(width: 30, height: 30),
          onNotifications: () {},
          onQuickCreate: () {},
          onFixMissingPunches: (_) {},
          onRaiseTicket: () {},
          pickFile: (_) async => null,
        ),
      ),
    ),
  );
  await _settle(tester);
  return server;
}

Future<void> _payrollTap(WidgetTester tester, Finder finder) async {
  if (finder.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      finder,
      300,
      scrollable: find.descendant(of: find.byType(ListView).first, matching: find.byType(Scrollable)).first,
    );
  }
  await _tapVisible(tester, finder);
}

// ------------------------------------------------------------------ main

void main() {
  setUpAll(() async {
    if (_out.isEmpty) return;
    Directory(_out).createSync(recursive: true);
    for (final (family, file) in [
      ('Plus Jakarta Sans', 'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf'),
      ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
      ('Manrope', 'assets/fonts/manrope/Manrope-Variable.ttf'),
      ('Figtree', 'assets/fonts/figtree/Figtree-Variable.ttf'),
      ('Lilita One', 'assets/fonts/lilita_one/LilitaOne-Regular.ttf'),
      ('Lexend', 'assets/fonts/lexend/Lexend-Variable.ttf'),
    ]) {
      await (FontLoader(family)..addFont(rootBundle.load(file))).load();
    }
    // Material's own fonts, from the Flutter install: icons, and Roboto for
    // any text with no family of its own.
    const cache = '/opt/homebrew/share/flutter/bin/cache/artifacts/material_fonts';
    Future<ByteData> bytes(String name) async => ByteData.sublistView(File('$cache/$name').readAsBytesSync());
    await (FontLoader('MaterialIcons')..addFont(bytes('MaterialIcons-Regular.otf'))).load();
    final roboto = FontLoader('Roboto');
    for (final weight in ['Regular', 'Medium', 'Bold', 'Light']) {
      roboto.addFont(bytes('Roboto-$weight.ttf'));
    }
    await roboto.load();
  });

  tearDownAll(() {
    if (_out.isEmpty) return;
    File('$_out/results.json').writeAsStringSync(const JsonEncoder.withIndent('  ').convert(_results));
  });

  // 1. Face ID setup ------------------------------------------------------
  _scenario('Face ID setup', (tester, shot, phone) async {
    await _slideToPunch(tester, enrolled: false);
    await _faceSettle(tester);
    await shot('faceid-intro', 'Face ID setup: intro with the three steps and consent');
    await tester.tap(find.text('Set up Face ID'));
    await _faceSettle(tester);
    await shot('faceid-front-1of3', 'Face ID setup: front photo, "1 of 3"');
    _camera.bursts();
    await tester.pump();
    await shot('faceid-left-2of3', 'Face ID setup: turn left, "2 of 3"');
    _camera.bursts(yaw: 14);
    await tester.pump();
    await shot('faceid-right-3of3', 'Face ID setup: turn right, "3 of 3"');
    _camera.bursts(yaw: -13);
    await _faceSettle(tester);
    await _faceSettle(tester);
    await shot('faceid-done', 'Face ID setup: done, "You\'re set up!" with the punch card');
    await tester.tap(find.text('Continue to Connect'));
    await _faceSettle(tester);
    await tester.pump(const Duration(seconds: 4));
  });

  _scenario('Face ID setup done, onboarding', (tester, shot, phone) async {
    await tester.pumpWidget(
      MaterialApp(debugShowCheckedModeBanner: false, theme: _theme(), home: FaceSetupDone(onDone: () {})),
    );
    await _settle(tester);
    await shot('faceid-done-onboarding', 'Face ID setup done, onboarding: no punch card, just Continue');
  });

  // 2. Daily face check ---------------------------------------------------
  _scenario('Daily face check', (tester, shot, phone) async {
    await _slideToPunch(tester, enrolled: true);
    await _faceSettle(tester);
    await shot('facecheck-camera', 'Daily Face check: camera with the tick ring');
    _camera.sees(FaceProblem.none);
    _camera.bursts();
    await tester.pump();
    await _faceSettle(tester);
    await shot('facecheck-punched-in', 'Daily Face check: matched, "Punched in" with the ring and tick');
    await tester.pump(FaceCheckScreen.matchedPause);
    await _faceSettle(tester);
    await tester.pump(const Duration(seconds: 4));
  });

  // 3. Payroll ------------------------------------------------------------
  _scenario('Payroll home', (tester, shot, phone) async {
    await _pumpPayroll(tester, FakePayrollServer()..overtimePaise = 125000);
    await shot('payroll-home-overtime', 'Payroll home: salary card with the Overtime row');
    await tester.drag(find.byType(ListView).first, const Offset(0, -700));
    await _settle(tester);
    await shot('payroll-home-scrolled', 'Payroll home, scrolled: to-dos and quick actions');
    await tester.drag(find.byType(ListView).first, const Offset(0, 1400));
    await _settle(tester);
    await _payrollTap(tester, find.text('Overtime'));
    await _payrollTap(tester, find.text('Provident fund'));
    await tester.drag(find.byType(ListView).first, const Offset(0, 1400));
    await _settle(tester);
    await shot('payroll-salary-breakdown', 'Salary breakdown: Overtime and Provident fund lines opened');
  });

  _scenario('Payroll split', (tester, shot, phone) async {
    await _pumpPayroll(tester, FakePayrollServer());
    await _payrollTap(tester, find.byKey(const ValueKey('payroll-fbp')));
    await shot('payroll-tax-saving-split', 'Tax-saving (FBP) split');
  });

  _scenario('Payroll income tax', (tester, shot, phone) async {
    await _pumpPayroll(tester, FakePayrollServer());
    await _payrollTap(tester, find.byKey(const ValueKey('payroll-tax')));
    await shot('payroll-income-tax', 'Income tax: regime and investment declaration');
  });

  _scenario('Payroll proofs', (tester, shot, phone) async {
    await _pumpPayroll(tester, FakePayrollServer());
    await _payrollTap(tester, find.byKey(const ValueKey('payroll-todo-investment_proofs')));
    await shot('payroll-investment-proofs', 'Investment proofs: to upload, in review, approved, rejected');
  });

  _scenario('Payroll payslips', (tester, shot, phone) async {
    await _pumpPayroll(tester, FakePayrollServer()..overtimePaise = 125000);
    await _payrollTap(tester, find.byKey(const ValueKey('payroll-payslips')));
    await shot('payroll-payslips', 'Payslips list, with "Can\'t find a payslip? Raise a ticket"');
    await _payrollTap(tester, find.text('August 2026'));
    await shot('payroll-payslip-detail', 'Payslip detail (August 2026) with loss of pay and overtime');
    await tester.drag(find.byType(ListView).first, const Offset(0, -600));
    await _settle(tester);
    await shot('payroll-payslip-detail-scrolled', 'Payslip detail, scrolled to Download');
  });

  _scenario('Payroll error', (tester, shot, phone) async {
    registerSupportTicketOpener(_noTicket);
    addTearDown(() => unregisterSupportTicketOpener(_noTicket));
    await _pumpPayroll(tester, FakePayrollServer()..taxRulesSetUp = false);
    await _payrollTap(tester, find.byKey(const ValueKey('payroll-tax')));
    await shot('payroll-error-raise-ticket', 'Payroll error: tax rules not set up, "Ask HR" with the Raise ticket link');
  });

  // 4. Grow and reviews ---------------------------------------------------
  _scenario('Grow, a direct report', (tester, shot, phone) async {
    final haider = {
      ..._member('haider', 'Haider Ali', reportsToViewer: true),
      'feedbackStatus': 'pending',
      'parameters': [
        {'parameterId': 'p1', 'name': 'Ownership', 'score': 0, 'note': ''},
        {'parameterId': 'p2', 'name': 'Quality of work', 'score': 0, 'note': ''},
      ],
      'previousCycle': {
        'period': _lastMonth,
        'feedbackStatus': 'pending',
        'score': 0,
        'parameters': [
          {'parameterId': 'p1', 'name': 'Ownership', 'score': 0, 'note': ''},
          {'parameterId': 'p3', 'name': 'Delivery on time', 'score': 0, 'note': ''},
          {'parameterId': 'p4', 'name': 'Collaboration with other teams', 'score': 0, 'note': ''},
        ],
        'extra': '',
      },
    };
    await _bootShell(tester, team: [haider]);
    openPersonProfile('haider');
    await tester.pumpAndSettle();
    await _openGrowTab(tester);
    await _settleTap(tester, find.text(_short(_thisMonth)));
    await tester.drag(find.byType(ListWheelScrollView), const Offset(0, 52));
    await tester.pumpAndSettle();
    await shot('grow-month-picker', 'Grow month picker (Select Month) with last month offered');
    await _settleTap(tester, find.text('Select'));
    await shot('grow-report-last-month-pending', 'Grow of a direct report: last month "Pending", "Feedback for … can still be given"');
    await _settleTap(tester, find.text('Give Feedback'));
    await shot('grow-feedback-form-last-month', 'Feedback form for last month');
    for (final (name, score, text) in [
      ('Ownership', 4, _long),
      ('Delivery on time', 3, _long),
      ('Collaboration with other teams', 5, 'Good month.'),
    ]) {
      await _rate(tester, {name: score});
      await tester.ensureVisible(_note(name));
      await tester.pumpAndSettle();
      await tester.enterText(_note(name), text);
      await tester.pump(const Duration(milliseconds: 400));
    }
    final send = find.text('Send');
    await tester.ensureVisible(send);
    await tester.pumpAndSettle();
    await tester.tap(send);
    await tester.pumpAndSettle();
    await shot('grow-short-comment-error', 'Send with a short comment: "Write at least 75 characters…"');
    await tester.pump(const Duration(seconds: 10));
    await tester.pumpAndSettle();
  });

  _scenario('Grow, two levels up', (tester, shot, phone) async {
    ProfileApiService.testClient = MockClient((request) async {
      if (request.url.path.endsWith('/profile/people/neha')) {
        return _ok({
          'person': {
            'userId': 'neha',
            'name': 'Neha Kapoor',
            'department': 'Design',
            'designation': 'Junior Visual Designer',
            'inViewerChain': true,
            'email': 'neha@sowaka.test',
            'orgChart': <dynamic>[],
            'history': [
              {
                'period': _lastMonth,
                'overallScore': 4.2,
                'parameters': [
                  {'name': 'Ownership', 'score': 4.5, 'note': 'Took the festive campaign banners end to end and shipped them two days early.'},
                  {'name': 'Quality of work', 'score': 4.0, 'note': 'Clean files and consistent type; a few rounds on the hero image.'},
                  {'name': 'Collaboration with other teams', 'score': 4.0, 'note': 'Worked closely with marketing on copy changes.'},
                ],
                'sentAt': DateTime.now().subtract(const Duration(days: 3)).toIso8601String(),
                'managerName': 'Haider Ali',
              },
            ],
          },
        });
      }
      return http.Response('{"success":false}', 404);
    });
    addTearDown(() => ProfileApiService.testClient = null);
    await _bootShell(tester, team: [_member('haider', 'Haider Ali', reportsToViewer: true)]);
    openPersonProfile('neha');
    await tester.pumpAndSettle();
    await _openGrowTab(tester);
    await shot('grow-two-levels-up', 'Grow tab seen by a manager two levels up (the report\'s report)');
    await tester.drag(find.text('Neha Kapoor').first, const Offset(0, -450));
    await tester.pumpAndSettle();
    await shot('grow-two-levels-up-scrolled', 'Grow tab two levels up, scrolled to the review');
  });

  // 5. Photo contest ------------------------------------------------------
  _scenario('Contest, votes', (tester, shot, phone) async {
    await _openEntries(tester);
    await _openEntry(tester, 'kiran-1');
    await shot('contest-entry-votes', 'Contest entry full screen: "5 votes · See who voted"');
    await tester.tap(find.byKey(const ValueKey('entry-voters-kiran-1')));
    await _contestSettle(tester);
    await shot('contest-voted-by-sheet', 'Voted by sheet');
  });

  _scenario('Contest, own entry', (tester, shot, phone) async {
    await _openEntries(tester);
    await _openEntry(tester, 'mine-1');
    await shot('contest-own-entry-delete', 'Your own entry full screen, with Delete');
    await tester.tap(find.byKey(const ValueKey('entry-delete-mine-1')));
    await _contestSettle(tester);
    await shot('contest-own-entry-delete-confirm', 'Delete your photo? confirmation');
  });

  _scenario('Contest, @ colleague list', (tester, shot, phone) async {
    final dir = Directory.systemTemp.createTempSync('release_screens');
    addTearDown(() => dir.deleteSync(recursive: true));
    final path = '${dir.path}/desk.jpg';
    File('assets/care/sleep_background.jpg').copySync(path);
    final before = FilePickerPlatform.instance;
    FilePickerPlatform.instance = _FakeFilePicker(path);
    addTearDown(() => FilePickerPlatform.instance = before);
    await _openEntries(tester);
    Future<void> realWork(bool Function() done) async {
      for (var i = 0; i < 150 && !done(); i++) {
        await Future<void>.delayed(const Duration(milliseconds: 40));
        await tester.pump(const Duration(milliseconds: 100));
      }
      for (var i = 0; i < 3; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    bool cropShowing() => find.text('Crop your photo').evaluate().isNotEmpty;
    await tester.runAsync(() async {
      shot.inAsync = true;
      await tester.tap(find.byKey(const ValueKey('entries-pinned-cta')));
      await realWork(cropShowing);
      await tester.tap(find.text('Done'));
      await realWork(() => !cropShowing() && find.byType(TextField).evaluate().isNotEmpty);
      final story = find.byType(TextField);
      await tester.showKeyboard(story);
      _keyboardUp(tester, phone);
      await tester.enterText(story, 'Diwali desk with @Chi');
      await realWork(() => find.text('Chitra Rao').evaluate().isNotEmpty);
      await shot('contest-mention-list', 'Entry text box with the "@" colleague list open (keyboard up)');
      shot.inAsync = false;
    });
  });

  _scenario('Contest, tagged name', (tester, shot, phone) async {
    await _openEntries(tester);
    await _openEntry(tester, 'manav-1');
    await shot('contest-tagged-link', 'Entry showing a tagged name (@Chitra Rao) as a link');
  });

  // 6. Attendance ---------------------------------------------------------
  _scenario('Attendance, joined mid-month', (tester, shot, phone) async {
    await _pumpActions(tester);
    await tester.tap(find.text('Attendance').first);
    await _settle(tester);
    final prev = find.byWidgetPredicate((w) => w is AttendanceCalendarArrow && w.asset.endsWith('prev.svg'));
    await tester.tap(prev);
    await _settle(tester);
    await _settle(tester);
    await shot('attendance-joined-mid-month', 'Attendance calendar: joined on the 14th, days before it empty');
    final day = find.descendant(of: find.byType(AttendanceMonthGrid), matching: find.text('9'));
    if (day.evaluate().isNotEmpty) {
      await _tapVisible(tester, day.first);
      await tester.drag(find.byType(Scrollable).first, const Offset(0, -400));
      await _settle(tester);
    }
    await shot('attendance-before-joining-day', 'Attendance: a day before joining tapped');
  });

  _scenario('Leave without pay', (tester, shot, phone) async {
    await _pumpActions(tester);
    await tester.tap(find.text('Leave').first);
    await _settle(tester);
    await _tapVisible(tester, find.text('Apply Leave').first);
    await _tapVisible(tester, find.text('Select leave type'));
    await shot('attendance-lwp-type-picker', 'Leave type picker, "Unpaid" beside Leave without pay');
    await _tapVisible(tester, find.text('Leave without pay').last);
    // Back to the top of the form, where the banner is.
    await tester.drag(find.text('LEAVE TYPE'), const Offset(0, 800));
    await _settle(tester);
    await shot('attendance-lwp-apply-form', 'Leave without pay apply form with its banner');
  });

  // 7. Support Desk -------------------------------------------------------
  _scenario('Support, contact HR toast', (tester, shot, phone) async {
    registerSupportTicketOpener(_noTicket);
    addTearDown(() => unregisterSupportTicketOpener(_noTicket));
    await _pumpActions(tester);
    await tester.tap(find.text('Overtime').first);
    await _settle(tester);
    showAppToast(
      tester.element(find.byType(QuickActionsScreen)),
      'Overtime is not enabled for your team. Speak to HR if you think it should be.',
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    await shot('support-contact-hr-toast', '"Contact HR" message with the Raise ticket action');
    await tester.pump(const Duration(seconds: 10));
  });

  _scenario('Support, new ticket', (tester, shot, phone) async {
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/support/topics')) return supportOk({'topics': supportTopics});
      return supportOk({'tickets': <dynamic>[]});
    });
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: _theme(),
        home: SupportDeskScreen(
          shell: supportShell(client, realtime: FakeSupportRealtime()),
          raiseOnOpen: true,
          raiseAbout: 'Overtime is not enabled for your team. Speak to HR if you think it should be.',
        ),
      ),
    );
    await _settle(tester);
    await shot('support-new-ticket-prefilled', 'Support Desk opened from Raise ticket: new ticket, message started');
  });
}

void _noTicket({String? about}) {}
