// The whole punch-in, screen by screen, as PNGs: the slider, Face ID setup
// (the intro page, the camera looking and found, the tick), the selfie check
// (looking, found, the tick), the location check and the punch. Only with
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
  @override
  Future<void> resume() async {}
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
      latitude: 26.2389,
      longitude: 73.0243,
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

http.Client _server() => MockClient((request) async {
  _requests.add(request.url.path);
  final path = request.url.path;
  if (path.endsWith('/face/status')) {
    return http.Response(
      jsonEncode({
        'success': true,
        'checkAtPunch': true,
        'enrolled': _requests.any((p) => p.endsWith('/face/enrol')),
        'consent': {
          'version': 'v1',
          'agree':
              "By proceeding, I agree to Face ID keeping a template of my face, made from this selfie, to confirm it's me when I punch in. It is stored by AWS in Mumbai and deleted when I leave.",
        },
        'liveness': {'mode': 'device'},
        'maxAttempts': 3,
        'failedAttempts': 0,
        'fallbackAvailable': false,
      }),
      200,
    );
  }
  if (path.endsWith('/face/enrol')) {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return http.Response(jsonEncode({'success': true, 'enrolled': true}), 201);
  }
  if (path.endsWith('/face/verify')) {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return http.Response(
      jsonEncode({
        'success': true,
        'passed': true,
        'reason': 'matched',
        'token': 'verify-tok',
      }),
      200,
    );
  }
  if (path.endsWith('/attendance/punch')) {
    return http.Response(
      jsonEncode({
        'success': true,
        'workDate': '2026-10-27',
        'punchIn': '2026-10-27T04:00:00.000Z',
      }),
      200,
    );
  }
  return http.Response('{"success":true}', 200);
});

AuthSession _session() => AuthSession(
  token: 't',
  user: AuthUser.fromJson({
    'id': 'u1',
    'email': 'ananya@sowaka.test',
    'name': 'Ananya Bisht',
    'company': 'Sowaka',
    'org': 'sowaka',
    'profilePhotoUrl': 'https://example.test/p.png',
    'interests': ['Music'],
    'faceId': {'enrolled': false, 'atPunch': true},
  }),
);

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
    FaceCheckOutcome.enrolledThisRun = false;
    FaceCamera.create = () => _camera = _FakeCamera();
    GeolocatorPlatform.instance = _FakeGeolocator();
    FaceSetupScreen.successPause = const Duration(milliseconds: 1500);
    FaceCheckScreen.matchedPause = const Duration(milliseconds: 900);
  });

  Future<void> shot(WidgetTester tester, String name) async {
    if (_screenshots.isEmpty) return;
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(Uri.file('$_screenshots/$name.png')),
    );
  }

  testWidgets(
    'punch in: slider, Face ID setup, the selfie check, the location, punched in',
    (tester) async {
      tester.view.physicalSize = const Size(393 * 2, 852 * 2);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      final api = ManagerApiService(
        session: _session(),
        baseUrl: 'https://example.test',
        client: _server(),
      );
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
          home: PunchScreen(api: api, type: 'in', geofenced: true),
        ),
      );
      await tester.pumpAndSettle();
      // 1. The punch screen with its slider.
      expect(find.text('Slide to Punch In'), findsOneWidget);
      await shot(tester, '01-slider');
      // The knob is the GestureDetector inside the slider: drag it to the end.
      final slider = find.byType(SlideToPunch);
      final knob = find
          .descendant(of: slider, matching: find.byType(GestureDetector))
          .last;
      await tester.drag(knob, Offset(tester.getSize(slider).width, 0));
      await tester.pumpAndSettle();

      // 2. Face ID setup: the intro page.
      expect(find.text('Set up your Face ID'), findsOneWidget);
      expect(find.text('For a clear face capture'), findsOneWidget);
      await shot(tester, '02-setup-intro');
      await tester.tap(find.text('Set up Face ID'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      // 3. The camera, looking.
      expect(find.text('Position your face inside the oval'), findsOneWidget);
      expect(find.text('Face id successfully set up'), findsNothing);
      await shot(tester, '03-setup-camera-looking');
      _camera.sees(FaceSignal.notDetected);
      await tester.pump();
      expect(find.text('Keep your face inside the oval'), findsOneWidget);
      await shot(tester, '04-setup-camera-not-in-oval');
      // 4. A face in the oval: "Hold still", no tick yet.
      _camera.sees(FaceSignal.detected);
      await tester.pump();
      expect(find.text('Hold still'), findsOneWidget);
      expect(find.text('Face id successfully set up'), findsNothing);
      await shot(tester, '05-setup-camera-face-found');
      // The selfie takes itself; the server keeps the face; only then the tick.
      await tester.pump(FaceAutoCapture.hold);
      await tester.pump(const Duration(milliseconds: 400));
      expect(_requests.where((p) => p.endsWith('/face/enrol')), hasLength(1));
      expect(find.text('Face id successfully set up'), findsOneWidget);
      await shot(tester, '06-setup-success');

      // 5. On to the selfie check.
      await tester.pump(FaceSetupScreen.successPause);
      await tester.pumpAndSettle();
      expect(find.text('Punch-in'), findsOneWidget);
      expect(find.text('Position your face inside the oval'), findsOneWidget);
      await shot(tester, '07-check-camera-looking');
      _camera.sees(FaceSignal.detected);
      await tester.pump();
      expect(find.text('Hold still'), findsOneWidget);
      expect(find.text('Face id detected'), findsNothing);
      await shot(tester, '08-check-camera-face-found');
      await tester.pump(FaceAutoCapture.hold);
      await tester.pump(const Duration(milliseconds: 400));
      expect(_requests.where((p) => p.endsWith('/face/verify')), hasLength(1));
      expect(find.text('Face id detected'), findsOneWidget);
      await shot(tester, '09-check-matched');

      // 6. The location check, then punched in.
      await tester.pump(FaceCheckScreen.matchedPause);
      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(milliseconds: 100));
      await shot(tester, '10-location-check');
      await tester.pumpAndSettle(const Duration(milliseconds: 200));
      expect(find.text("You're punched in!"), findsOneWidget);
      await shot(tester, '11-punched-in');
    },
  );
}
