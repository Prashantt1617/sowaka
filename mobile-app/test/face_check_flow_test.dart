// The face check of the revised flow (boards D1–D6 and S1–S5), screen by
// screen against a fake server and a camera that needs no device: the slide
// opens the camera at once while the location check runs, the gate's words,
// a burst sent with its crops and the challenge, "Punched in" and back to the
// card with a toast; a mismatch with the tries left, the server unsure, the
// day's tries spent and the punch sent to the manager, outside the office;
// and setup: the intro, three photos with the arrow, all three sent, the
// done screen. Also the burst's micro-motion and the copy table.
//
// `flutter test --update-goldens --dart-define=SCREENSHOTS=<dir> test/face_check_flow_test.dart`
// also writes each board as a PNG to <dir>.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui';

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
import 'package:mobile_app/features/face_id/face_id_models.dart';
import 'package:mobile_app/features/face_id/face_setup_screen.dart';
import 'package:mobile_app/features/face_id/face_sounds.dart';
import 'package:mobile_app/features/face_id/face_spoof_check.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';

const _screenshots = String.fromEnvironment('SCREENSHOTS');

/// A front camera that needs no device: the test says what the gate sees,
/// and hands over finished bursts.
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

  /// A burst as the real camera finishes one: held, then handed over.
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
        report: 'captured ${pose.name} med$spoof',
      ),
    );
  }
}

/// The phone's location, answered after a moment.
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
final _requests = <String>[];
Map<String, dynamic>? _punchBody;
String? _verifyBody;
String? _enrolBody;
String? _fallbackBody;

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
Map<String, dynamic> _where = _inside;

const _matched = {'passed': true, 'reason': 'matched', 'token': 'verify-tok'};
List<Map<String, dynamic>> _verifyReplies = [];
bool _fallbackOnStatus = false;

http.Client _server() => MockClient((request) async {
  final path = request.url.path;
  _requests.add(path);
  if (path.endsWith('/face/status')) {
    return http.Response(
      jsonEncode({
        'success': true,
        'checkAtPunch': true,
        'enrolled': true,
        'consent': {'version': 'v4', 'agree': "Sowaka keeps a template of your face to confirm it's you when you punch in."},
        'liveness': {'mode': 'device'},
        'maxAttempts': 5,
        'failedAttempts': 0,
        'fallbackAvailable': _fallbackOnStatus,
        'managerName': 'Raghav',
      }),
      200,
    );
  }
  if (path.endsWith('/face/challenge')) {
    return http.Response(jsonEncode({'success': true, 'id': 'ch-${_count('/face/challenge')}', 'expiresAt': '2026-10-30T10:33:00Z'}), 201);
  }
  if (path.endsWith('/face/enrol')) {
    _enrolBody = String.fromCharCodes(request.bodyBytes);
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return http.Response(jsonEncode({'success': true, 'enrolled': true, 'token': 'enrol-tok'}), 201);
  }
  if (path.endsWith('/face/verify')) {
    _verifyBody = String.fromCharCodes(request.bodyBytes);
    await Future<void>.delayed(const Duration(milliseconds: 300));
    final reply = _verifyReplies.isEmpty ? _matched : _verifyReplies.removeAt(0);
    return http.Response(jsonEncode({'success': true, ...reply}), 200);
  }
  if (path.endsWith('/face/fallback')) {
    _fallbackBody = request.body;
    return http.Response(jsonEncode({'success': true, 'request': {'id': 'r1'}}), 201);
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
        'workDate': '2026-10-30',
        'punchIn': '2026-10-30T10:30:00.000Z',
        'officeName': 'Sowaka Office',
      }),
      200,
    );
  }
  return http.Response('{"success":true}', 200);
});

int _count(String path) => _requests.where((p) => p.endsWith(path)).length;

AuthUser _user({required bool enrolled}) => AuthUser.fromJson({
  'id': 'u1',
  'email': 'ananya@sowaka.test',
  'name': 'Ananya Bisht',
  'company': 'Sowaka',
  'org': 'sowaka',
  'profilePhotoUrl': 'https://example.test/p.png',
  'interests': ['Music'],
  'faceId': {'enrolled': enrolled, 'atPunch': true},
});

/// One text field of a multipart body.
String? _field(String body, String name) => RegExp('name="$name"\r\n(?:[^\r\n]*\r\n)*?\r\n([^\r\n]*)').firstMatch(body)?.group(1);
bool _hasFile(String body, String name) => body.contains('name="$name"; filename=');

final _heading = find.byKey(const ValueKey('face-heading'));
String _headline(WidgetTester tester) => tester.widget<Text>(_heading).data!;
String? _line(WidgetTester tester) {
  final line = find.byKey(const ValueKey('face-line'));
  return line.evaluate().isEmpty ? null : tester.widget<Text>(line).data;
}

/// The host: a card with a button that opens the punch as the home card's
/// slider does, and shows the toast the way the hosts do.
class _Host {
  PunchOutcome? outcome;
  bool closed = false;
}

void main() {
  setUpAll(() async {
    for (final (family, file) in [
      ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
      ('Plus Jakarta Sans', 'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf'),
      ('Roboto', 'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf'),
    ]) {
      await (FontLoader(family)..addFont(rootBundle.load(file))).load();
    }
    final icons = File('/opt/homebrew/share/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
    if (_screenshots.isNotEmpty && icons.existsSync()) {
      await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())))).load();
    }
  });

  setUp(() {
    _requests.clear();
    _punchBody = null;
    _verifyBody = null;
    _enrolBody = null;
    _fallbackBody = null;
    _where = _inside;
    _verifyReplies = [];
    _fallbackOnStatus = false;
    FaceSounds.enabled = false;
    FaceCheckOutcome.enrolledThisRun = false;
    FaceCamera.create = () => _camera = _FakeCamera();
    GeolocatorPlatform.instance = _FakeGeolocator();
  });

  Future<void> shot(WidgetTester tester, String name) async {
    if (_screenshots.isEmpty) return;
    await expectLater(find.byType(MaterialApp), matchesGoldenFile(Uri.file('$_screenshots/$name.png')));
  }

  /// The card, then the slider dragged: the punch screen opens and goes
  /// straight to the camera.
  Future<_Host> slide(WidgetTester tester, {required bool enrolled}) async {
    tester.view.physicalSize = const Size(390 * 2, 844 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final api = ManagerApiService(
      session: AuthSession(token: 't', user: _user(enrolled: enrolled)),
      baseUrl: 'https://example.test',
      client: _server(),
    );
    final host = _Host();
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        home: Builder(
          builder: (context) => Scaffold(
            backgroundColor: const Color(0xFFF4F6F8),
            body: Center(
              child: TextButton(
                onPressed: () async {
                  host.outcome = await Navigator.of(context).push<PunchOutcome>(
                    MaterialPageRoute(builder: (_) => PunchScreen(api: api, type: 'in', geofenced: true)),
                  );
                  host.closed = true;
                  if (context.mounted) showPunchToast(context, host.outcome);
                },
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
    return host;
  }

  Future<void> settle(WidgetTester tester, [Duration by = const Duration(milliseconds: 400)]) async {
    await tester.pump();
    await tester.pump(by);
    await tester.pump();
  }

  test('the profile keeps both flags across a save', () {
    final again = AuthUser.fromJson(_user(enrolled: false).toJson());
    expect([again.faceIdEnrolled, again.faceIdAtPunch], [false, true]);
  });

  testWidgets('daily: the camera opens at once, the burst goes with its crops, punched in, back to the card with a toast', (tester) async {
    final host = await slide(tester, enrolled: true);
    // The camera is up before the location check has answered.
    expect(find.byType(FaceCameraView), findsOneWidget);
    expect(_headline(tester), 'Look at the camera');
    expect(_line(tester), 'Hold the phone at eye level.');
    expect(find.text('Front camera'), findsNothing);
    expect(find.byKey(const ValueKey('face-steps')), findsNothing);
    await settle(tester);
    expect(find.text('Sowaka Office'), findsOneWidget);
    expect(_count('/face/challenge'), 1);
    await shot(tester, 'D2-look');

    _camera.sees(FaceProblem.closer);
    await tester.pump();
    expect(_headline(tester), 'Move a little closer');
    expect(_line(tester), 'Your face should fill most of the oval.');
    await shot(tester, 'D5-closer');

    _camera.sees(FaceProblem.none);
    _camera.bursts();
    await tester.pump();
    expect(_headline(tester), 'Checking…');
    await settle(tester, const Duration(milliseconds: 400));
    final body = _verifyBody!;
    expect(_field(body, 'challengeId'), 'ch-1');
    expect(_field(body, 'spoofPhone'), '0.960');
    expect(_field(body, 'motionMean'), '1.60');
    expect([for (var i = 0; i < 8; i++) _hasFile(body, 'crop$i')], everyElement(isTrue));
    expect(_hasFile(body, 'photo'), isTrue);
    expect(body.contains('lit0') || body.contains('baseline'), isFalse);
    expect(_punchBody?['faceToken'], 'verify-tok');
    expect(_punchBody?['latitude'], 28.4595);

    expect(_headline(tester), 'Punched in');
    final at = DateTime.parse('2026-10-30T10:30:00.000Z');
    expect(_line(tester), punchedLine(at));
    expect(find.byKey(const ValueKey('face-tick')), findsOneWidget);
    await shot(tester, 'D3-punched-in');

    await tester.pump(FaceCheckScreen.matchedPause);
    await settle(tester);
    await settle(tester);
    expect(host.closed, isTrue);
    expect(host.outcome?.punched, isTrue);
    expect(host.outcome?.at?.isAtSameMomentAs(at), isTrue);
    expect(find.text('Punched in at ${clockOf(at)} · Sowaka Office'), findsOneWidget);
    expect(find.text("You're punched in!"), findsNothing);
    await shot(tester, 'D4-toast');
    await tester.pump(const Duration(seconds: 4));
  });

  testWidgets('a mismatch says the tries left, then looks again with a fresh challenge', (tester) async {
    _verifyReplies = [
      {'passed': false, 'reason': 'not_a_match', 'attemptsLeft': 3, 'fallbackAvailable': false, 'message': 'x'},
    ];
    await slide(tester, enrolled: true);
    await settle(tester);
    _camera.bursts();
    await settle(tester, const Duration(milliseconds: 400));
    expect(_headline(tester), "We couldn't confirm it's you");
    expect(_line(tester), '3 tries left today. Try again.');
    expect(_punchBody, isNull);
    await tester.pump(FaceCheckScreen.failPause);
    await tester.pump();
    expect(_headline(tester), 'Look at the camera');
    expect(_count('/face/challenge'), 2);
    expect(find.byType(FaceCameraAction), findsNothing);
  });

  testWidgets('the server unsure: "Move a little closer", and the burst again', (tester) async {
    _verifyReplies = [
      {'passed': false, 'reason': 'uncertain', 'attemptsLeft': 5, 'fallbackAvailable': false, 'message': 'x'},
    ];
    await slide(tester, enrolled: true);
    await settle(tester);
    _camera.bursts(spoof: 0.55);
    await settle(tester, const Duration(milliseconds: 400));
    expect(_headline(tester), 'Move a little closer');
    expect(_camera.held, isFalse);
    _camera.bursts();
    await settle(tester, const Duration(milliseconds: 400));
    expect(_headline(tester), 'Punched in');
    await tester.pump(const Duration(seconds: 5));
  });

  testWidgets('a photo or a screen, as the server reads it: said, and not a punch', (tester) async {
    _verifyReplies = [
      {'passed': false, 'reason': 'spoof', 'attemptsLeft': 5, 'fallbackAvailable': false, 'message': 'x'},
    ];
    await slide(tester, enrolled: true);
    await settle(tester);
    _camera.bursts(spoof: 0.3);
    await settle(tester, const Duration(milliseconds: 400));
    expect(_headline(tester), 'Please use your face, not a photo or a screen');
    expect(_punchBody, isNull);
    await tester.pump(const Duration(seconds: 3));
  });

  testWidgets('the gate says one thing at a time, in the copy table\'s words', (tester) async {
    await slide(tester, enrolled: true);
    await settle(tester);
    for (final (problem, headline) in [
      (FaceProblem.dark, 'Too dark here'),
      (FaceProblem.bright, 'Turn away from the window'),
      (FaceProblem.angle, 'Face the camera'),
      (FaceProblem.still, 'Hold the phone still'),
      (FaceProblem.oneFace, 'Only one face in the frame'),
      (FaceProblem.spoof, 'Please use your face, not a photo or a screen'),
      (FaceProblem.timeout, 'Face not detected'),
      (FaceProblem.noFace, 'Look at the camera'),
    ]) {
      _camera.sees(problem);
      await tester.pump();
      expect(_headline(tester), headline);
    }
  });

  testWidgets('the fifth mismatch: send the punch-in to the manager, named', (tester) async {
    _verifyReplies = [
      {'passed': false, 'reason': 'not_a_match', 'attemptsLeft': 0, 'fallbackAvailable': true, 'message': 'x'},
    ];
    final host = await slide(tester, enrolled: true);
    await settle(tester);
    _camera.bursts();
    await settle(tester, const Duration(milliseconds: 400));
    expect(_headline(tester), "We couldn't confirm it's you");
    expect(_line(tester), '5 of 5 tries used today.');
    expect(find.text('Send punch-in to manager'), findsOneWidget);
    expect(find.text("Raghav will see the time, the location and that the face check didn't pass."), findsOneWidget);
    await shot(tester, 'D6-manager');
    await tester.tap(find.text('Send punch-in to manager'));
    await settle(tester);
    await settle(tester);
    expect(_fallbackBody, contains('"type":"in"'));
    expect(_punchBody, isNull);
    expect(host.closed, isFalse);
  });

  testWidgets('outside the office: the camera closes on the refusal, and the reasons show', (tester) async {
    _where = _outside;
    await slide(tester, enrolled: true);
    await settle(tester);
    await settle(tester);
    await settle(tester);
    await settle(tester);
    expect(find.byType(FaceCameraView), findsNothing);
    expect(find.text('Working from home'), findsOneWidget);
    expect(_count('/face/verify'), 0);
  });

  testWidgets('setup: the intro, three photos with the arrow, all three sent, then you\'re set up', (tester) async {
    final host = await slide(tester, enrolled: false);
    await settle(tester);
    expect(find.text('Set up your face check'), findsOneWidget);
    expect(find.text('Three quick photos. After this, punching in is a glance at the camera.'), findsOneWidget);
    expect(find.text('Front'), findsOneWidget);
    expect(find.text('Left'), findsOneWidget);
    expect(find.text('Right'), findsOneWidget);
    expect(find.textContaining('Sowaka keeps a template of your face', findRichText: true), findsOneWidget);
    await shot(tester, 'S1-intro');
    await tester.tap(find.byKey(const ValueKey('face-whats-stored')));
    await settle(tester);
    expect(find.text('Face template'), findsOneWidget);
    expect(find.text('Daily checks'), findsOneWidget);
    await tester.tapAt(const Offset(20, 40));
    await settle(tester);

    await tester.tap(find.text('Agree and start'));
    await settle(tester);
    expect(_headline(tester), 'Look at the camera');
    expect(find.text('1 of 3'), findsOneWidget);
    await shot(tester, 'S2-front');

    _camera.bursts();
    await tester.pump();
    expect(find.text('2 of 3'), findsOneWidget);
    expect(_headline(tester), 'Turn toward the arrow');
    expect(find.byKey(const ValueKey('face-arrow-left')), findsOneWidget);
    await shot(tester, 'S3-arrow-left');

    _camera.bursts(yaw: 14);
    await tester.pump();
    expect(find.text('3 of 3'), findsOneWidget);
    expect(find.byKey(const ValueKey('face-arrow-right')), findsOneWidget);
    await shot(tester, 'S4-arrow-right');

    _camera.bursts(yaw: -13);
    await settle(tester, const Duration(milliseconds: 400));
    final body = _enrolBody!;
    expect(_field(body, 'consentVersion'), 'v4');
    expect(_field(body, 'challengeId'), isNotNull);
    for (final name in ['photo', 'photo2', 'photo3', 'crop0', 'crop7', 'crop8', 'crop16', 'crop23']) {
      expect(_hasFile(body, name), isTrue, reason: name);
    }
    expect(_punchBody?['faceToken'], 'enrol-tok');
    expect(find.text("You're set up"), findsOneWidget);
    final at = DateTime.parse('2026-10-30T10:30:00.000Z');
    expect(find.text('Punched in at ${clockOf(at)}'), findsOneWidget);
    await shot(tester, 'S5-done');

    await tester.tap(find.text('Done'));
    await settle(tester);
    await settle(tester);
    expect(host.outcome?.at?.isAtSameMomentAs(at), isTrue);
    expect(FaceCheckOutcome.enrolledThisRun, isTrue);
    await tester.pump(const Duration(seconds: 4));
  });

  testWidgets('setup: the arrow pulses once the turn is slow, with no new words', (tester) async {
    await slide(tester, enrolled: false);
    await settle(tester);
    await tester.tap(find.text('Agree and start'));
    await settle(tester);
    _camera.bursts();
    await tester.pump();
    expect(_camera.turnSlow, isFalse);
    await tester.pump(FaceCamera.turnNudgeAfter);
    await tester.pump(const Duration(milliseconds: 600));
    expect(_camera.turnSlow, isTrue);
    expect(_headline(tester), 'Turn toward the arrow');
    expect(find.byKey(const ValueKey('face-arrow-left')), findsOneWidget);
  });

  testWidgets('a try past 30 seconds: "Face not detected", then a new try with a fresh challenge', (tester) async {
    await slide(tester, enrolled: true);
    await settle(tester);
    expect(_count('/face/challenge'), 1);
    await tester.pump(FaceCamera.promptPatience);
    await tester.pump(const Duration(milliseconds: 600));
    expect(_headline(tester), 'Face not detected');
    await tester.pump(FaceCamera.lapsePause);
    await tester.pump();
    expect(_headline(tester), 'Look at the camera');
    expect(_count('/face/challenge'), 2);
  });

  group('the burst', () {
    List<Offset> face(double dx, double dy, {double spread = 0}) => [
      Offset(100 + dx, 100 + dy),
      Offset(160 + dx + spread, 100 + dy),
      Offset(130 + dx, 140 + dy - spread),
    ];

    test('a print held still does not drift', () {
      final motion = FaceMotion.of(List.generate(8, (_) => face(0, 0)), 1)!;
      expect(motion.mean, 0);
      expect(motion.passed, isFalse);
    });

    test('a screen moved by hand moves every point together', () {
      final motion = FaceMotion.of(List.generate(8, (i) => face(i * 2.0, i * 1.0)), 1)!;
      expect(motion.rigid, isTrue);
      expect(motion.passed, isFalse);
    });

    test('a real face drifts a little, not in one piece', () {
      final motion = FaceMotion.of(List.generate(8, (i) => face(i * 0.8, -i * 0.4, spread: (i % 3) * 0.6)), 1)!;
      expect(motion.mean, inInclusiveRange(FaceMotion.minDrift, FaceMotion.maxDrift));
      expect(motion.passed, isTrue);
    });

    test('scaled to the 160 px crop, and nothing without two frames of points', () {
      expect(FaceMotion.of([face(0, 0), face(1, 0)], 2)!.mean, closeTo(2, 1e-9));
      expect(FaceMotion.of([face(0, 0), null], 1), isNull);
    });

    test('the median, not the mean, and the phone\'s lines', () {
      expect(medianOf([0.9, 0.95, 0.1, 0.92]), closeTo(0.91, 1e-9));
      expect(medianOf([]), isNull);
      expect(FaceSpoofCheck.samples, 8);
      expect(FaceSpoofCheck.accept, 0.7);
      expect(FaceSpoofCheck.refuseBelow, 0.2);
    });
  });

  test('a failed check reads as a fix; only a mismatch is one of the tries', () {
    FaceCheckResult r(String reason) => FaceCheckResult(passed: false, reason: reason, message: '');
    expect(r('not_a_match').title, "We couldn't confirm it's you");
    expect(r('not_a_match').inconclusive, isFalse);
    expect(r('other_person').inconclusive, isFalse);
    expect(r('uncertain').title, 'Move a little closer');
    expect(r('spoof').title, 'Please use your face, not a photo or a screen');
    expect(r('multiple_faces').title, 'Only one face in the frame');
    expect(r('too_dark').inconclusive, isTrue);
    expect(FaceIdStatus.fromJson({'managerName': 'Raghav'}).managerName, 'Raghav');
  });

  test('"4:00 PM · Friday, 30 Oct"', () {
    final at = DateTime(2026, 10, 30, 16, 0);
    expect(clockOf(at), '4:00 PM');
    expect(punchedLine(at), '4:00 PM · Friday, 30 Oct');
    expect(clockOf(DateTime(2026, 10, 30, 0, 5)), '12:05 AM');
  });
}
