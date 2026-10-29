// The check-in of Figma 4309:24713, screen by screen: the slider, the
// location check, "You're inside the office area", then Face ID — set up and
// verified in one go the first day, verified on the days after — with the
// turn and blink prompts and the flash, "Verified", and punched in. Also the
// failures: "Face not detected" with the day's tries left, the manager
// approval once they are spent, and a punch from outside the office. As PNGs
// only with
//   flutter test --update-goldens --dart-define=SCREENSHOTS=<dir> test/punch_face_flow_screens_test.dart
// Without SCREENSHOTS it checks the flow and writes nothing.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator_platform_interface/geolocator_platform_interface.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/attendance/presentation/punch_screen.dart';
import 'package:mobile_app/features/attendance/presentation/slide_to_punch.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/face_id/face_camera.dart';
import 'package:mobile_app/features/face_id/face_capture_layout.dart';
import 'package:mobile_app/features/face_id/face_check_screen.dart';
import 'package:mobile_app/features/face_id/face_setup_screen.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';

const _screenshots = String.fromEnvironment('SCREENSHOTS');

class _FakeCamera extends FaceCamera {
  void sees(FaceSignal next) {
    signal = next;
    challengeDone = true;
    notifyListeners();
  }

  @override
  Future<void> start() async {}
  @override
  Future<Uint8List?> capture() async =>
      Uint8List.fromList([0xff, 0xd8, 0xff, 0xe0]);
  /// As the real camera does: a new look asks the prompts again.
  @override
  Future<void> resume() async => liveness.reset();
  @override
  Future<void> pause() async {}
}

/// The phone's location, answered after a moment so the checking screen shows.
class _FakeGeolocator extends GeolocatorPlatform {
  @override
  Future<bool> isLocationServiceEnabled() async => true;
  @override
  Future<LocationPermission> checkPermission() async =>
      LocationPermission.always;
  @override
  Future<LocationPermission> requestPermission() async =>
      LocationPermission.always;
  @override
  Future<Position> getCurrentPosition({
    LocationSettings? locationSettings,
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
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
final _requests = <String>[];
Map<String, dynamic>? _punchBody;

/// Where the phone is, as the server's check answers it.
Map<String, dynamic> _where = _inside;
const _inside = {
  'geofenced': true,
  'inside': true,
  'office': {'id': 'o1', 'name': 'Sowaka Office', 'city': 'Gurugram'},
};
const _outside = {
  'geofenced': true,
  'inside': false,
  'office': {'id': 'o1', 'name': 'Sowaka Office', 'city': 'Gurugram'},
  'location': {'distanceMeters': 2400},
  'message': 'You are outside the approved attendance area.',
  'outsideLocation': {
    'outcome': 'request',
    'reasons': ['Working from home', 'Client visit', 'Out of office'],
  },
};

/// What the next selfie check answers.
Map<String, dynamic> _verify = _matched;
const _matched = {'passed': true, 'reason': 'matched', 'token': 'verify-tok'};

http.Client _server() => MockClient((request) async {
  _requests.add(request.url.path);
  final path = request.url.path;
  if (path.endsWith('/face/status')) {
    return http.Response(
      jsonEncode({
        'success': true,
        'checkAtPunch': true,
        'enrolled': true,
        'consent': {
          'version': 'v1',
          'agree':
              "By proceeding, I agree to Face ID keeping a template of my face, made from this selfie, to confirm it's me when I punch in.",
        },
        'liveness': {'mode': 'device'},
        'maxAttempts': 5,
        'failedAttempts': 0,
        'fallbackAvailable': false,
      }),
      200,
    );
  }
  if (path.endsWith('/face/enrol')) {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return http.Response(
      jsonEncode({'success': true, 'enrolled': true, 'token': 'enrol-tok'}),
      201,
    );
  }
  if (path.endsWith('/face/verify')) {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return http.Response(jsonEncode({'success': true, ..._verify}), 200);
  }
  if (path.endsWith('/face/fallback')) {
    return http.Response(
      jsonEncode({
        'success': true,
        'request': {'id': 'r1'},
      }),
      201,
    );
  }
  if (path.endsWith('/attendance/punch/check')) {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    return http.Response(jsonEncode({'success': true, ..._where}), 200);
  }
  if (path.endsWith('/attendance/punch')) {
    _punchBody = jsonDecode(request.body) as Map<String, dynamic>;
    return http.Response(
      jsonEncode({
        'success': true,
        'workDate': '2026-10-29',
        'punchIn': '2026-10-29T04:12:00.000Z',
        'officeName': 'Sowaka Office',
      }),
      200,
    );
  }
  return http.Response('{"success":true}', 200);
});

AuthSession _session({required bool enrolled}) => AuthSession(
  token: 't',
  user: AuthUser.fromJson({
    'id': 'u1',
    'email': 'ananya@sowaka.test',
    'name': 'Ananya Bisht',
    'company': 'Sowaka',
    'org': 'sowaka',
    'profilePhotoUrl': 'https://example.test/p.png',
    'interests': ['Music'],
    'faceId': {'enrolled': enrolled, 'atPunch': true},
  }),
);

int _count(String path) => _requests.where((p) => p.endsWith(path)).length;

void main() {
  setUpAll(() async {
    for (final (family, file) in [
      ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
      (
        'Plus Jakarta Sans',
        'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf',
      ),
    ]) {
      await (FontLoader(family)..addFont(rootBundle.load(file))).load();
    }
    final icons = File(
      '/opt/homebrew/share/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    );
    if (_screenshots.isNotEmpty && icons.existsSync()) {
      await (FontLoader('MaterialIcons')..addFont(
            Future.value(ByteData.sublistView(icons.readAsBytesSync())),
          ))
          .load();
    }
  });

  setUp(() {
    _requests.clear();
    _punchBody = null;
    _where = _inside;
    _verify = _matched;
    FaceCheckOutcome.enrolledThisRun = false;
    FaceCamera.create = () => _camera = _FakeCamera();
    // The prompts and the flash are driven by hand below; the fake camera
    // sends no frames for them to read.
    FaceAutoCapture.checkLiveness = true;
    GeolocatorPlatform.instance = _FakeGeolocator();
    FaceSetupScreen.successPause = const Duration(milliseconds: 1500);
    FaceCheckScreen.matchedPause = const Duration(milliseconds: 900);
  });
  tearDown(() => FaceAutoCapture.checkLiveness = false);

  Future<void> shot(WidgetTester tester, String name) async {
    if (_screenshots.isEmpty) return;
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(Uri.file('$_screenshots/$name.png')),
    );
  }

  Future<ManagerApiService> open(
    WidgetTester tester, {
    required bool enrolled,
  }) async {
    tester.view.physicalSize = const Size(393 * 2, 852 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final api = ManagerApiService(
      session: _session(enrolled: enrolled),
      baseUrl: 'https://example.test',
      client: _server(),
    );
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
        home: PunchScreen(api: api, type: 'in', geofenced: true),
      ),
    );
    await tester.pumpAndSettle();
    // The still art decoded up front, so the shots show it. The two map
    // animations (locating.png, location_inside.png) are GIFs: loaded, they
    // never stop moving and the test would never settle, so the shots leave
    // them out; the phone plays them.
    if (_screenshots.isNotEmpty) {
      final context = tester.element(find.byType(PunchScreen));
      await tester.runAsync(() async {
        for (final name in [
          'punched_in.png',
          'request_sent.png',
          'reason_1.png',
          'reason_2.png',
          'reason_3.png',
        ]) {
          await precacheImage(AssetImage('assets/icons/punch/$name'), context);
        }
        await precacheImage(const AssetImage('assets/icons/face/setup_intro.png'), context);
      });
    }
    return api;
  }

  /// The slider dragged to the end, and the location check run through to
  /// whatever the server says about where the phone is.
  Future<void> slideAndLocate(WidgetTester tester, {String? checking}) async {
    expect(find.text('Ready to start your day?'), findsOneWidget);
    expect(find.text('Slide to Punch In'), findsOneWidget);
    final slider = find.byType(SlideToPunch);
    final knob = find
        .descendant(of: slider, matching: find.byType(GestureDetector))
        .last;
    await tester.drag(knob, Offset(tester.getSize(slider).width, 0));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Checking your location…'), findsOneWidget);
    if (checking != null) await shot(tester, checking);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 250));
    await tester.pumpAndSettle();
  }

  /// A face in the oval answering the prompts: the turn, back to the camera,
  /// the blink; then the two colour flashes, each taken by the face; and the
  /// selfie takes itself. Shots of each step when [prefix].
  Future<void> answerPrompts(WidgetTester tester, {String? prefix}) async {
    final liveness = _camera.liveness;
    _camera.sees(FaceSignal.detected);
    await tester.pump();
    expect(find.text('Move your head to the left, then face the camera'), findsOneWidget);
    expect(find.byKey(const ValueKey('face-steps')), findsOneWidget);
    if (prefix != null) await shot(tester, '$prefix-turn');
    liveness.turned = true;
    _camera.sees(FaceSignal.detected);
    await tester.pump();
    expect(find.text('Move your head to the left, then face the camera'), findsOneWidget);
    liveness.faced = true;
    _camera.sees(FaceSignal.detected);
    await tester.pump();
    expect(find.text('Blink now'), findsOneWidget);
    if (prefix != null) await shot(tester, '$prefix-blink');
    liveness.blinked = true;
    _camera.sees(FaceSignal.detected);
    await tester.pump();
    expect(find.text('Hold still'), findsOneWidget);
    // Held: the page takes the first colour, the face takes it too; then the
    // second. The selfie follows.
    var light = const FaceLight(90, 128, 128);
    liveness.setLight(light);
    await tester.pump(FaceAutoCapture.hold);
    await tester.pump();
    for (var i = 0; i < 2; i++) {
      final flash = find.byKey(const ValueKey('face-flash'));
      expect(flash, findsOneWidget);
      expect((tester.widget<ColoredBox>(flash)).color, liveness.colours[i].color);
      if (prefix != null && i == 0) await shot(tester, '$prefix-flash');
      // Each colour is judged against the light before the first, so each
      // answer is from that same base, not stacked on the last.
      liveness.setLight(FaceRealness.answering(liveness.colours[i], light));
      await tester.pump(FaceAutoCapture.flash);
      await tester.pump();
      expect(find.byKey(const ValueKey('face-flash')), findsNothing);
      if (i == 0) await tester.pump(FaceAutoCapture.flashGap);
    }
    await tester.pump(const Duration(milliseconds: 400));
  }

  testWidgets(
    'first day: slider, location, inside the office, Face ID set up and verified in one go, punched in',
    (tester) async {
      await open(tester, enrolled: false);
      await shot(tester, '01-ready');
      await slideAndLocate(tester, checking: '02-checking-location');

      // Inside the office: set up and verify, the first time.
      expect(find.text("You're inside the office area"), findsOneWidget);
      expect(find.text('Sowaka Office'), findsOneWidget);
      expect(find.text('Setup & verify face id'), findsOneWidget);
      expect(_count('/attendance/punch'), 0);
      await shot(tester, '03-inside-office-first-day');
      await tester.tap(find.text('Setup & verify face id'));
      await tester.pumpAndSettle();

      // The setup page, then the camera with the prompts.
      expect(find.text('Set up your Face ID'), findsOneWidget);
      await shot(tester, '04-setup-intro');
      await tester.tap(find.text('Set up Face ID'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Position your face inside the oval'), findsOneWidget);
      await shot(tester, '05-camera-looking');
      await answerPrompts(tester, prefix: '06-setup');
      expect(_count('/face/enrol'), 1);
      expect(find.text('Verified'), findsOneWidget);
      await shot(tester, '07-setup-verified');

      // The setup is the day's check: the punch carries its token.
      await tester.pump(FaceSetupScreen.successPause);
      await tester.pumpAndSettle();
      expect(_count('/face/verify'), 0);
      expect(_punchBody?['faceToken'], 'enrol-tok');
      expect(_punchBody?['latitude'], 28.4595);
      expect(find.text("You're punched in!"), findsOneWidget);
      await shot(tester, '08-punched-in');
    },
  );

  testWidgets(
    'the days after: inside the office, Verify face id, Verified, punched in',
    (tester) async {
      await open(tester, enrolled: true);
      await slideAndLocate(tester);
      expect(find.text("You're inside the office area"), findsOneWidget);
      expect(find.text('Verify face id'), findsOneWidget);
      expect(find.text('Setup & verify face id'), findsNothing);
      await shot(tester, '11-inside-office-next-day');
      await tester.tap(find.text('Verify face id'));
      await tester.pumpAndSettle();
      expect(find.byType(FaceCheckScreen), findsOneWidget);
      await answerPrompts(tester, prefix: '12-check');
      expect(_count('/face/verify'), 1);
      expect(find.text('Verified'), findsOneWidget);
      await shot(tester, '13-check-verified');
      await tester.pump(FaceCheckScreen.matchedPause);
      await tester.pumpAndSettle();
      expect(_punchBody?['faceToken'], 'verify-tok');
      expect(find.text("You're punched in!"), findsOneWidget);
    },
  );

  testWidgets('Verify face id tapped twice opens one camera', (tester) async {
    await open(tester, enrolled: true);
    await slideAndLocate(tester);
    final verify = find.text('Verify face id');
    await tester.tap(verify);
    await tester.tap(verify, warnIfMissed: false);
    await tester.pumpAndSettle();
    expect(find.byType(FaceCheckScreen), findsOneWidget);
  });

  testWidgets(
    'no office set up yet: no inside screen, straight to Face ID, then the punch',
    (tester) async {
      _where = {'geofenced': false, 'inside': true};
      await open(tester, enrolled: true);
      await slideAndLocate(tester);
      expect(find.text("You're inside the office area"), findsNothing);
      expect(find.byType(FaceCheckScreen), findsOneWidget);
      await answerPrompts(tester);
      await tester.pump(FaceCheckScreen.matchedPause);
      await tester.pumpAndSettle();
      expect(_punchBody?['faceToken'], 'verify-tok');
    },
  );

  testWidgets(
    'a failed check: the reason and the day\'s tries left, then the prompts resume on their own; once the tries are spent, the manager approves',
    (tester) async {
      await open(tester, enrolled: true);
      await slideAndLocate(tester);
      await tester.tap(find.text('Verify face id'));
      await tester.pumpAndSettle();

      // A try ran out of time: Face not detected, no button, and the prompts
      // start over once the camera does.
      _camera.lapsed = true;
      _camera.notifyListeners();
      await tester.pump();
      expect(find.text('Face not detected'), findsOneWidget);
      expect(find.text('Try Again'), findsNothing);
      expect(find.byType(FaceCaptureButton), findsNothing);
      expect(_count('/face/verify'), 0);
      await shot(tester, '21-face-not-detected');
      _camera.lapsed = false;
      _camera.liveness.reset();
      _camera.notifyListeners();
      await tester.pump();

      // The server refuses the match: the reason, four tries left, and after
      // a moment the prompts again.
      _verify = {
        'passed': false,
        'reason': 'not_a_match',
        'message': "This doesn't match the face set up for your account.",
        'attemptsLeft': 4,
        'fallbackAvailable': false,
      };
      await answerPrompts(tester);
      await tester.pumpAndSettle();
      expect(_count('/face/verify'), 1);
      expect(find.text('Face not matched'), findsOneWidget);
      expect(find.text('4 out of 5 tries left'), findsOneWidget);
      expect(find.byType(FaceCaptureButton), findsNothing);
      await shot(tester, '22-face-not-matched-tries-left');
      await tester.pump(FaceCheckScreen.failPause);
      await tester.pump();
      expect(find.text('Face not matched'), findsNothing);

      // The fifth failure of the day: the punch goes to the manager.
      _verify = {
        'passed': false,
        'reason': 'not_a_match',
        'message': "This doesn't match the face set up for your account.",
        'attemptsLeft': 0,
        'fallbackAvailable': true,
      };
      await answerPrompts(tester);
      await tester.pumpAndSettle();
      expect(find.text('Send punch-in to manager'), findsOneWidget);
      expect(find.text('0 out of 5 tries left'), findsOneWidget);
      await shot(tester, '23-out-of-tries-manager');
      await tester.tap(find.text('Send punch-in to manager'));
      await tester.pumpAndSettle();
      expect(_count('/face/fallback'), 1);
      expect(_punchBody, isNull);
      expect(find.text('Request sent'), findsOneWidget);
      await shot(tester, '24-request-sent');
    },
  );

  testWidgets(
    'outside the office: HR\'s reasons first, then Face ID, then the request',
    (tester) async {
      _where = _outside;
      await open(tester, enrolled: true);
      await slideAndLocate(tester);
      expect(find.text("You're inside the office area"), findsNothing);
      expect(find.text('You’re outside the office area'), findsOneWidget);
      expect(find.text('Client visit'), findsOneWidget);
      expect(find.byType(FaceCheckScreen), findsNothing);
      await shot(tester, '31-outside-office');
      await tester.tap(find.text('Client visit'));
      await tester.pump();
      await tester.tap(find.text('Send punch-in request'));
      await tester.pumpAndSettle();
      expect(find.byType(FaceCheckScreen), findsOneWidget);
      await answerPrompts(tester);
      await tester.pump(FaceCheckScreen.matchedPause);
      await tester.pumpAndSettle();
      expect(_punchBody?['reason'], 'Client visit');
      expect(_punchBody?['faceToken'], 'verify-tok');
    },
  );
}
