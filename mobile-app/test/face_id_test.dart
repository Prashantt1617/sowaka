// Face ID: who is asked to set it up, the selfie screens (Figma 4194:21786)
// in each state the camera can be in, and a failed check's way out to the
// manager, against a fake server. A layout that overflows fails the test.
//
// Setup opens on an intro page: pressing its Set up Face ID button is the
// consent, and opens the camera. On the camera one line says what to do
// ("Position your face inside the oval", "Keep your face inside the oval",
// "Hold still") and the selfie takes itself after [FaceAutoCapture.hold]; no
// button is on screen meanwhile. The tick and its line ("Face id successfully
// set up", "Face id detected") come only once the server has answered, never
// while the face is merely detected. A failed try darkens the camera, names
// the reason, and brings Try Again with the tries left.
//
// `flutter test --update-goldens --dart-define=SCREENSHOTS=<dir> test/face_id_test.dart`
// also writes the intro, the setup camera (looking, Hold still, the tick) and
// the check camera (looking, Face id detected, a failed try) to <dir> as PNGs.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/face_id/face_camera.dart';
import 'package:mobile_app/features/face_id/face_capture_layout.dart';
import 'package:mobile_app/features/face_id/face_check_screen.dart';
import 'package:mobile_app/features/face_id/face_setup_screen.dart';
import 'package:mobile_app/features/face_id/face_id_models.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/attendance/presentation/punch_screen.dart';

const _screenshots = String.fromEnvironment('SCREENSHOTS');

/// A front camera that needs no device: the test says what it sees.
class _FakeCamera extends FaceCamera {
  /// What [capture] hands back: null is a photo the camera did not take.
  Uint8List? photo = Uint8List.fromList([0xff, 0xd8, 0xff, 0xe0]);

  /// The real camera's prompt is always done now ([FaceCamera.challengeDone]
  /// starts true); `prompted` stays so a test says so out loud.
  void sees(FaceSignal next, {bool prompted = true}) {
    signal = next;
    challengeDone = prompted;
    notifyListeners();
  }

  @override
  Future<void> start() async {}

  @override
  Future<Uint8List?> capture() async => photo;

  @override
  Future<void> resume() async {}

  @override
  Future<void> pause() async {}
}

AuthUser _user({bool enrolled = false, bool atPunch = false}) =>
    AuthUser.fromJson({
      'id': 'u1',
      'email': 'someone@sowaka.test',
      'name': 'Asha',
      'company': 'Sowaka',
      'org': 'sowaka',
      'profilePhotoUrl': 'https://example.test/p.png',
      'interests': ['Music'],
      'faceId': {'enrolled': enrolled, 'atPunch': atPunch},
    });

const _consentWords = 'I agree to Face ID keeping a template of my face.';

final _requests = <String>[];
String? _enrolBody;
String? _verifyBody;
Map<String, dynamic>? _punchBody;
String? _fallbackBody;

/// What the next setup answers: a pass with its punch token, unless a test says otherwise.
http.Response Function() _enrolReply = _enrolPasses;
http.Response _enrolPasses() => http.Response(
  jsonEncode({
    'success': true,
    'enrolled': true,
    'token': 'enrol-tok',
    'expiresAt': '2026-10-26T10:05:00.000Z',
  }),
  201,
);

/// What `/face/status` answers, and how long it takes: the intro waits on it.
http.Response Function() _statusReply = _statusOk;
Duration _statusDelay = Duration.zero;
http.Response _statusOk() => http.Response(
  jsonEncode({
    'success': true,
    'checkAtPunch': true,
    'enrolled': true,
    'consent': {'version': 'v1', 'agree': _consentWords},
    'liveness': {'mode': 'device'},
    'maxAttempts': 3,
    'failedAttempts': 0,
    'fallbackAvailable': false,
  }),
  200,
);

http.Client _server({required Map<String, dynamic> verify}) => MockClient((
  request,
) async {
  _requests.add(request.url.path);
  if (request.url.path.endsWith('/face/status')) {
    if (_statusDelay > Duration.zero) await Future<void>.delayed(_statusDelay);
    return _statusReply();
  }
  if (request.url.path.endsWith('/face/verify')) {
    _verifyBody = String.fromCharCodes(request.bodyBytes);
    return http.Response(jsonEncode({'success': true, ...verify}), 200);
  }
  if (request.url.path.endsWith('/face/enrol')) {
    _enrolBody = String.fromCharCodes(request.bodyBytes);
    return _enrolReply();
  }
  if (request.url.path.endsWith('/face/fallback')) {
    _fallbackBody = request.body;
    return http.Response(
      jsonEncode({
        'success': true,
        'request': {'id': 'r1'},
      }),
      201,
    );
  }
  if (request.url.path.endsWith('/attendance/punch')) {
    _punchBody = jsonDecode(request.body) as Map<String, dynamic>;
    return http.Response(
      jsonEncode({
        'success': true,
        'workDate': '2026-10-26',
        'punchIn': '2026-10-26T04:00:00.000Z',
      }),
      200,
    );
  }
  return http.Response('{"success":true}', 200);
});

late _FakeCamera _camera;

const _positionLine = 'Position your face inside the oval';
const _keepLine = 'Keep your face inside the oval';
const _holdLine = 'Hold still';
const _tapLine = 'Look at the camera and tap the button.';
const _setUpLine = 'Face id successfully set up';
const _detectedLine = 'Face id detected';

int _count(String path) => _requests.where((p) => p.endsWith(path)).length;

/// The button on the camera, whatever its label: none while the selfie
/// takes itself.
final _cameraButton = find.descendant(
  of: find.byType(FaceCaptureLayout),
  matching: find.byType(FaceCaptureButton),
);

/// The intro page's Set up Face ID button.
final _introButton = find.descendant(
  of: find.byType(FaceSetupIntro),
  matching: find.byType(FaceCaptureButton),
);

/// The green tick on the camera, drawn only once the server has answered.
final _tick = find.byWidgetPredicate(
  (widget) =>
      widget is SvgPicture &&
      widget.bytesLoader is SvgAssetLoader &&
      (widget.bytesLoader as SvgAssetLoader).assetName.endsWith(
        'success_check.svg',
      ),
);

/// Whether [button] takes a tap.
bool _live(WidgetTester tester, Finder button) {
  final widget = tester.widget<FaceCaptureButton>(button);
  return widget.enabled && !widget.busy && widget.onTap != null;
}

/// Nothing the server has not said: no tick, no result line, and none of
/// the status rows the old screens had.
void _expectNoResult() {
  expect(_tick, findsNothing);
  expect(find.text(_detectedLine), findsNothing);
  expect(find.text(_setUpLine), findsNothing);
  expect(find.text('Face detected'), findsNothing);
  expect(find.text('Detecting your face…'), findsNothing);
  expect(find.text('Face not detected'), findsNothing);
}

/// A face in the oval, held still: the selfie takes itself.
Future<void> _faceHeld(WidgetTester tester) async {
  _camera.sees(FaceSignal.detected, prompted: true);
  await tester.pump(FaceAutoCapture.hold);
  await tester.pumpAndSettle();
}

/// The intro's button: agreeing, and opening the camera.
Future<void> _startSetup(WidgetTester tester) async {
  expect(_introButton, findsOneWidget);
  expect(_live(tester, _introButton), isTrue);
  await tester.tap(_introButton);
  await tester.pump();
  expect(find.byType(FaceSetupIntro), findsNothing);
  expect(find.byType(FaceCaptureLayout), findsOneWidget);
}

/// One text field of a multipart body.
String? _field(String body, String name) => RegExp(
  'name="$name"\r\n(?:[^\r\n]*\r\n)*?\r\n([^\r\n]*)',
).firstMatch(body)?.group(1);

/// How the check, pushed as the punch pushes it, ended.
class _Opened {
  FaceCheckOutcome? outcome;
  bool popped = false;
}

Future<_Opened> _openCheck(
  WidgetTester tester,
  http.Client client, {
  String type = 'in',
}) async {
  final opened = _Opened();
  tester.view.physicalSize = const Size(393, 852);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final loader = FontLoader('Sora')
    ..addFont(rootBundle.load('assets/fonts/sora/Sora-Variable.ttf'));
  await loader.load();
  final api = ManagerApiService(
    session: AuthSession(
      token: 't',
      user: _user(enrolled: true, atPunch: true),
    ),
    baseUrl: 'https://example.test',
    client: client,
  );
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () async {
              opened.outcome = await Navigator.of(context).push(
                MaterialPageRoute<FaceCheckOutcome>(
                  builder: (_) => FaceCheckScreen(api: api, type: type),
                ),
              );
              opened.popped = true;
            },
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return opened;
}

void main() {
  setUp(() {
    _requests.clear();
    _punchBody = null;
    _enrolBody = null;
    _verifyBody = null;
    _fallbackBody = null;
    _enrolReply = _enrolPasses;
    _statusReply = _statusOk;
    _statusDelay = Duration.zero;
    FaceCheckOutcome.enrolledThisRun = false;
    FaceCamera.create = () => _camera = _FakeCamera();
    // No frames reach the fake camera, so the phone's own checks stand aside.
    FaceAutoCapture.checkLiveness = false;
  });

  test('the profile keeps both flags across a save', () {
    final again = AuthUser.fromJson(_user(atPunch: true).toJson());
    expect([again.faceIdEnrolled, again.faceIdAtPunch], [false, true]);
  });

  testWidgets(
    'the check: one line on the camera as it looks, and no tick or button before the server answers',
    (tester) async {
      await _openCheck(
        tester,
        _server(verify: {'passed': true, 'token': 'tok'}),
      );
      // Starting (4266:26005): the heading on the camera, the line, no button.
      expect(find.text('Punch-in'), findsOneWidget);
      expect(find.text('Front camera'), findsOneWidget);
      expect(find.text(_positionLine), findsOneWidget);
      expect(find.text(_keepLine), findsNothing);
      expect(find.text(_holdLine), findsNothing);
      expect(_cameraButton, findsNothing);
      expect(find.text('Take selfie & punch in'), findsNothing);
      _expectNoResult();

      // Not detected (4266:26076's camera, before a try): still no button.
      _camera.sees(FaceSignal.notDetected, prompted: true);
      await tester.pump();
      expect(find.text(_keepLine), findsOneWidget);
      expect(find.text(_positionLine), findsNothing);
      expect(_cameraButton, findsNothing);
      _expectNoResult();

      // A face in the oval: "Hold still", and nothing else until the server
      // has matched it: no tick, no "Face id detected", no button.
      _camera.sees(FaceSignal.detected, prompted: true);
      await tester.pump();
      expect(find.text(_holdLine), findsOneWidget);
      expect(find.text(_keepLine), findsNothing);
      expect(find.text('Blink once, then look at the camera.'), findsNothing);
      expect(_cameraButton, findsNothing);
      _expectNoResult();
      await tester.pump(
        FaceAutoCapture.hold - const Duration(milliseconds: 100),
      );
      expect(_count('/face/verify'), 0);
      expect(find.text(_holdLine), findsOneWidget);
      _expectNoResult();
      expect(tester.takeException(), isNull);
      // Out of the oval again: the hold is off, nothing is taken.
      _camera.sees(FaceSignal.notDetected, prompted: true);
      await tester.pump(const Duration(seconds: 2));
      expect(_count('/face/verify'), 0);
    },
  );

  testWidgets(
    'setup: the intro waits for the consent, shows it under the button, and the button opens the camera',
    (tester) async {
      tester.view.physicalSize = const Size(393, 852);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      _statusDelay = const Duration(seconds: 1);
      final api = ManagerApiService(
        session: AuthSession(token: 't', user: _user(atPunch: true)),
        baseUrl: 'https://example.test',
        client: _server(verify: const {}),
      );
      await tester.pumpWidget(MaterialApp(home: FaceSetupScreen(api: api)));
      await tester.pump();
      // The intro (4200:55075): what it is for, the tips, the button.
      expect(find.byType(FaceSetupIntro), findsOneWidget);
      expect(find.byType(FaceCaptureLayout), findsNothing);
      expect(find.text('Punch in'), findsOneWidget);
      expect(find.text('Set up your Face ID'), findsOneWidget);
      expect(
        find.text(
          'Face enrollment is required before you\ncan punch in for attendance.',
        ),
        findsOneWidget,
      );
      expect(find.text('One-time face setup'), findsOneWidget);
      expect(find.text('For a clear face capture'), findsOneWidget);
      expect(find.text('Keep your face inside the oval.'), findsOneWidget);
      expect(find.text('Face a light source.'), findsOneWidget);
      expect(find.text('Uncover your face and hold still.'), findsOneWidget);
      expect(find.byType(Checkbox), findsNothing);
      // The consent has not loaded: the button waits, locked, with no words.
      expect(find.text('Set up Face ID'), findsOneWidget);
      expect(_live(tester, _introButton), isFalse);
      expect(find.text(_consentWords), findsNothing);
      expect(
        find.descendant(
          of: find.byType(FaceSetupIntro),
          matching: find.byType(CircularProgressIndicator),
        ),
        findsOneWidget,
      );
      await tester.tap(find.text('Set up Face ID'));
      await tester.pump();
      expect(find.byType(FaceSetupIntro), findsOneWidget);
      expect(find.byType(FaceCaptureLayout), findsNothing);
      // A face at the camera meanwhile takes nothing: they have not agreed.
      _camera.sees(FaceSignal.detected, prompted: true);
      await tester.pump(const Duration(milliseconds: 500));
      expect(_count('/face/enrol'), 0);

      // Loaded: the words under the button, and the button live.
      await tester.pump(const Duration(seconds: 1));
      expect(find.text(_consentWords), findsOneWidget);
      expect(_live(tester, _introButton), isTrue);
      expect(
        find.descendant(
          of: find.byType(FaceSetupIntro),
          matching: find.byType(CircularProgressIndicator),
        ),
        findsNothing,
      );
      await tester.pump(const Duration(seconds: 2));
      expect(
        _count('/face/enrol'),
        0,
        reason: 'nothing is taken before they press the button',
      );
      expect(tester.takeException(), isNull);

      // Pressing is agreeing: the camera, with setup's heading, and nothing
      // sent yet. The face is already in the oval, so "Hold still".
      await _startSetup(tester);
      expect(_count('/face/enrol'), 0);
      expect(find.text('Set up your Face ID'), findsOneWidget);
      expect(find.text('Front camera'), findsOneWidget);
      expect(find.text(_consentWords), findsNothing);
      expect(find.text(_holdLine), findsOneWidget);
      expect(_cameraButton, findsNothing);
      _expectNoResult();
      await tester.pump(
        FaceAutoCapture.hold - const Duration(milliseconds: 100),
      );
      expect(_count('/face/enrol'), 0);
      expect(tester.takeException(), isNull);
      // Out of the oval: the hold is off, the line says so.
      _camera.sees(FaceSignal.notDetected, prompted: true);
      await tester.pump(const Duration(seconds: 2));
      expect(find.text(_keepLine), findsOneWidget);
      expect(_count('/face/enrol'), 0);
    },
  );

  testWidgets(
    'the consent that fails to load: the problem, a link to load it again, and the button locked',
    (tester) async {
      tester.view.physicalSize = const Size(393, 852);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      var failedOnce = false;
      _statusReply = () {
        if (failedOnce) return _statusOk();
        failedOnce = true;
        return http.Response(
          jsonEncode({
            'success': false,
            'message': 'Face ID is down right now.',
          }),
          503,
        );
      };
      final api = ManagerApiService(
        session: AuthSession(token: 't', user: _user(atPunch: true)),
        baseUrl: 'https://example.test',
        client: _server(verify: const {}),
      );
      await tester.pumpWidget(MaterialApp(home: FaceSetupScreen(api: api)));
      await tester.pumpAndSettle();
      expect(find.text('Face ID is down right now.'), findsOneWidget);
      expect(find.text('Load the consent again'), findsOneWidget);
      expect(find.text(_consentWords), findsNothing);
      expect(_live(tester, _introButton), isFalse);
      await tester.tap(find.text('Set up Face ID'));
      await tester.pump();
      expect(find.byType(FaceCaptureLayout), findsNothing);

      await tester.tap(find.text('Load the consent again'));
      await tester.pumpAndSettle();
      expect(_count('/face/status'), 2);
      expect(find.text('Face ID is down right now.'), findsNothing);
      expect(find.text('Load the consent again'), findsNothing);
      expect(find.text(_consentWords), findsOneWidget);
      expect(_live(tester, _introButton), isTrue);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a punch-out has the same selfie with its own words, and its own fallback',
    (tester) async {
      final opened = await _openCheck(
        tester,
        _server(
          verify: {
            'passed': false,
            'reason': 'not_a_match',
            'message': 'No match.',
            'attemptsLeft': 0,
            'fallbackAvailable': true,
          },
        ),
        type: 'out',
      );
      expect(find.text('Punch-out'), findsOneWidget);
      expect(find.text('Punch-in'), findsNothing);
      _camera.sees(FaceSignal.detected, prompted: true);
      await tester.pump();
      expect(find.text(_holdLine), findsOneWidget);
      expect(find.text('Take selfie & punch out'), findsNothing);
      await _faceHeld(tester);
      expect(_count('/face/verify'), 1);
      expect(find.text('Face not matched'), findsOneWidget);
      expect(find.text('Send punch-out to manager'), findsOneWidget);
      expect(
        find.text('Your manager or HR approves the punch-out.'),
        findsOneWidget,
      );
      expect(find.text('Take another selfie'), findsOneWidget);
      _expectNoResult();
      await tester.tap(find.text('Send punch-out to manager'));
      await tester.pumpAndSettle();
      expect(_fallbackBody, contains('"type":"out"'));
      expect(opened.popped, isTrue);
      expect(opened.outcome?.fallbackSent, isTrue);
    },
  );

  testWidgets(
    'a pass: "Face id detected" and the tick only once the server has matched, then the token goes to the punch',
    (tester) async {
      final opened = await _openCheck(
        tester,
        _server(
          verify: {'passed': true, 'reason': 'matched', 'token': 'tok-1'},
        ),
      );
      _camera.sees(FaceSignal.detected, prompted: true);
      await tester.pump();
      expect(find.text(_holdLine), findsOneWidget);
      _expectNoResult();
      await _faceHeld(tester);
      expect(_count('/face/verify'), 1);
      // Matched (4266:26221): the tick and the line, no button, not gone yet.
      expect(find.text(_detectedLine), findsOneWidget);
      expect(_tick, findsOneWidget);
      expect(find.text(_holdLine), findsNothing);
      expect(_cameraButton, findsNothing);
      expect(find.text('Punch-in'), findsOneWidget);
      expect(opened.popped, isFalse);
      expect(tester.takeException(), isNull);
      // Then the punch, with the server's token.
      await tester.pump(FaceCheckScreen.matchedPause);
      await tester.pumpAndSettle();
      expect(opened.popped, isTrue);
      expect(opened.outcome?.token, 'tok-1');
      expect(find.byType(FaceCheckScreen), findsNothing);
      expect(_count('/face/verify'), 1);
    },
  );

  testWidgets('the check tells the server no live prompt was asked', (
    tester,
  ) async {
    await _openCheck(
      tester,
      _server(verify: {'passed': true, 'reason': 'matched', 'token': 'tok-1'}),
    );
    await _faceHeld(tester);
    final body = _verifyBody!;
    expect(_field(body, 'challenge'), 'none');
    expect(_field(body, 'devicePassed'), 'false');
    expect(body, contains('filename="face.jpg"'));
    expect(_field(body, 'livenessSessionId'), isNull);
    await tester.pump(FaceCheckScreen.matchedPause);
    await tester.pumpAndSettle();
  });

  testWidgets('out of tries: the punch-in can go to the manager', (
    tester,
  ) async {
    final opened = await _openCheck(
      tester,
      _server(
        verify: {
          'passed': false,
          'reason': 'not_a_match',
          'message': "This doesn't match the face set up for your account.",
          'attemptsLeft': 0,
          'fallbackAvailable': true,
        },
      ),
    );
    await _faceHeld(tester);
    expect(find.text('Face not matched'), findsOneWidget);
    expect(
      find.text('Your manager or HR approves the punch-in.'),
      findsOneWidget,
    );
    expect(find.text('Try Again'), findsNothing);
    expect(find.textContaining('tries left'), findsNothing);
    _expectNoResult();
    await tester.tap(find.text('Send punch-in to manager'));
    await tester.pumpAndSettle();
    expect(_count('/face/fallback'), 1);
    expect(opened.popped, isTrue);
    expect(opened.outcome?.fallbackSent, isTrue);
    expect(find.byType(FaceCheckScreen), findsNothing);
  });

  Future<void> pumpPunch(
    WidgetTester tester, {
    required String type,
    Map<String, dynamic> verify = const {},
  }) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = ManagerApiService(
      session: AuthSession(token: 't', user: _user(atPunch: true)),
      baseUrl: 'https://example.test',
      client: _server(verify: verify),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<PunchOutcome>(
                  builder: (_) => PunchScreen(
                    api: api,
                    type: type,
                    geofenced: false,
                    startImmediately: true,
                  ),
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'not set up: the first punch opens the intro, the camera, the tick, then the selfie carries the punch',
    (tester) async {
      await pumpPunch(
        tester,
        type: 'in',
        verify: {'passed': true, 'reason': 'matched', 'token': 'verify-tok'},
      );
      // Setup's intro, not the check: the punch's step title, and the consent.
      expect(find.byType(FaceSetupIntro), findsOneWidget);
      expect(find.text('Punch in'), findsOneWidget);
      expect(find.text('Set up your Face ID'), findsOneWidget);
      expect(find.text(_consentWords), findsOneWidget);
      expect(find.byType(Checkbox), findsNothing);
      _camera.sees(FaceSignal.detected, prompted: true);
      await tester.pump(const Duration(seconds: 2));
      // Not agreed: no camera, and nothing taken however long the face stays.
      expect(find.byType(FaceCaptureLayout), findsNothing);
      expect(_count('/face/enrol'), 0);
      await _startSetup(tester);
      expect(find.text(_holdLine), findsOneWidget);
      _expectNoResult();
      await tester.pump(FaceAutoCapture.hold);
      await tester.pumpAndSettle();
      expect(_count('/face/enrol'), 1);
      expect(_field(_enrolBody!, 'consentVersion'), 'v1');
      expect(_field(_enrolBody!, 'consent'), 'true');
      expect(FaceCheckOutcome.enrolledThisRun, isTrue);
      // Set up (4266:26184): the tick on the same camera, and no punch yet.
      expect(find.text(_setUpLine), findsOneWidget);
      expect(_tick, findsOneWidget);
      expect(find.text(_holdLine), findsNothing);
      expect(find.text('Set up your Face ID'), findsOneWidget);
      expect(_cameraButton, findsNothing);
      expect(find.byType(FaceCheckScreen), findsNothing);
      expect(_punchBody, isNull);
      expect(tester.takeException(), isNull);
      // It goes on by itself, to the selfie check.
      await tester.pump(FaceSetupScreen.successPause);
      await tester.pumpAndSettle();
      expect(find.text(_setUpLine), findsNothing);
      expect(_tick, findsNothing);
      expect(find.byType(FaceCheckScreen), findsOneWidget);
      expect(find.text('Punch-in'), findsOneWidget);
      expect(_count('/face/verify'), 0);
      await _faceHeld(tester);
      expect(_count('/face/verify'), 1);
      expect(find.text(_detectedLine), findsOneWidget);
      expect(_tick, findsOneWidget);
      expect(_punchBody, isNull);
      await tester.pump(FaceCheckScreen.matchedPause);
      await tester.pumpAndSettle();
      // The punch went with the check's token, not the setup's.
      expect(_count('/face/verify'), 1);
      expect(_punchBody?['faceToken'], 'verify-tok');
      expect(find.text("You're punched in!"), findsOneWidget);
      expect(find.byType(FaceCheckScreen), findsNothing);
      expect(find.byType(FaceSetupScreen), findsNothing);
    },
  );

  testWidgets(
    'closing the check that follows setup closes the punch, with nothing sent',
    (tester) async {
      await pumpPunch(
        tester,
        type: 'out',
        verify: {'passed': true, 'token': 'verify-tok'},
      );
      expect(find.text('Punch out'), findsOneWidget);
      await _startSetup(tester);
      await _faceHeld(tester);
      expect(find.text(_setUpLine), findsOneWidget);
      await tester.pump(FaceSetupScreen.successPause);
      await tester.pumpAndSettle();
      expect(find.text('Punch-out'), findsOneWidget);
      expect(find.byType(FaceCheckScreen), findsOneWidget);
      // Nothing more opens on its own.
      await tester.pump(const Duration(seconds: 2));
      await tester.pumpAndSettle();
      expect(find.byType(FaceCheckScreen), findsOneWidget);
      await tester.tap(
        find.descendant(
          of: find.byType(FaceCheckScreen),
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is Semantics && widget.properties.label == 'Close',
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(FaceCheckScreen), findsNothing);
      expect(find.byType(FaceSetupScreen), findsNothing);
      expect(_count('/face/verify'), 0);
      expect(_punchBody, isNull);
    },
  );

  testWidgets('in onboarding the tick ends the setup, with no selfie check', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = ManagerApiService(
      session: AuthSession(token: 't', user: _user(atPunch: true)),
      baseUrl: 'https://example.test',
      client: _server(verify: {'passed': true, 'token': 'verify-tok'}),
    );
    var popped = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute<FaceCheckOutcome>(
                    builder: (_) => FaceSetupScreen(api: api, onboarding: true),
                  ),
                );
                popped = true;
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('Face ID'), findsOneWidget);
    expect(find.text('Punch in'), findsNothing);
    expect(find.text(_consentWords), findsOneWidget);
    await _startSetup(tester);
    _camera.sees(FaceSignal.detected, prompted: true);
    await tester.pump();
    // The heading only: no button while the face is found.
    expect(find.text('Set up your Face ID'), findsOneWidget);
    expect(find.text(_holdLine), findsOneWidget);
    expect(_cameraButton, findsNothing);
    _expectNoResult();
    await _faceHeld(tester);
    expect(_count('/face/enrol'), 1);
    expect(find.text(_setUpLine), findsOneWidget);
    expect(_tick, findsOneWidget);
    expect(popped, isFalse);
    await tester.pump(FaceSetupScreen.successPause);
    await tester.pumpAndSettle();
    expect(popped, isTrue);
    expect(find.byType(FaceCheckScreen), findsNothing);
    expect(_count('/face/verify'), 0);
  });

  testWidgets('already set up elsewhere: setup steps aside for the selfie check', (
    tester,
  ) async {
    _enrolReply = () => http.Response(
      jsonEncode({
        'success': false,
        'message':
            'Face ID is already set up. Ask HR to reset it if you need to set it up again.',
        'details': {
          'face': {'reason': 'already_enrolled'},
        },
      }),
      409,
    );
    await pumpPunch(tester, type: 'in');
    await _startSetup(tester);
    await _faceHeld(tester);
    expect(_count('/face/enrol'), 1);
    expect(FaceCheckOutcome.enrolledThisRun, isTrue);
    // The check, not setup again: no consent, no tick, and no punch without a face.
    expect(find.byType(FaceCheckScreen), findsOneWidget);
    expect(find.byType(FaceSetupScreen), findsNothing);
    expect(find.text('Punch-in'), findsOneWidget);
    expect(find.text(_consentWords), findsNothing);
    _expectNoResult();
    expect(_punchBody, isNull);
  });

  testWidgets(
    'a changed consent sends setup back to the intro with the new words, and the next try carries its version',
    (tester) async {
      var enrols = 0;
      _enrolReply = () {
        enrols += 1;
        if (enrols > 1) return _enrolPasses();
        return http.Response(
          jsonEncode({
            'success': false,
            'message': 'The Face ID consent has changed.',
            'details': {
              'face': {
                'reason': 'consent_changed',
                'consent': {
                  'version': 'v2',
                  'agree': 'I agree to the new Face ID line.',
                },
              },
            },
          }),
          403,
        );
      };
      await pumpPunch(
        tester,
        type: 'in',
        verify: {'passed': true, 'token': 'verify-tok'},
      );
      await _startSetup(tester);
      await _faceHeld(tester);
      expect(_count('/face/enrol'), 1);
      expect(_field(_enrolBody!, 'consentVersion'), 'v1');
      // Back on the intro, with the new line: the old agreement is not theirs.
      expect(find.byType(FaceSetupIntro), findsOneWidget);
      expect(find.byType(FaceCaptureLayout), findsNothing);
      expect(find.text('I agree to the new Face ID line.'), findsOneWidget);
      expect(find.text(_consentWords), findsNothing);
      expect(FaceCheckOutcome.enrolledThisRun, isFalse);
      // Nothing more until they press the button again.
      _camera.sees(FaceSignal.detected, prompted: true);
      await tester.pump(const Duration(seconds: 2));
      expect(_count('/face/enrol'), 1);
      await _startSetup(tester);
      // The face leaves and comes back: the next try, with the new version.
      _camera.sees(FaceSignal.notDetected, prompted: true);
      await tester.pump(
        FaceAutoCapture.away + const Duration(milliseconds: 100),
      );
      await _faceHeld(tester);
      expect(_count('/face/enrol'), 2);
      expect(_field(_enrolBody!, 'consentVersion'), 'v2');
      expect(find.text(_setUpLine), findsOneWidget);
      await tester.pump(FaceSetupScreen.successPause);
      await tester.pumpAndSettle();
      expect(find.byType(FaceCheckScreen), findsOneWidget);
    },
  );

  testWidgets(
    'a setup that fails says why, with Try Again and the tries left; after three the punch-out can go to the manager',
    (tester) async {
      var tries = 0;
      _enrolReply = () {
        tries += 1;
        return http.Response(
          jsonEncode({
            'success': false,
            'message':
                "It's too dark. Move to a brighter spot or face a light.",
            'details': {
              'face': {
                'reason': 'too_dark',
                'attemptsLeft': 3 - tries,
                'fallback': tries >= 3,
              },
            },
          }),
          422,
        );
      };
      await pumpPunch(tester, type: 'out');
      expect(find.text('Punch out'), findsOneWidget);
      await _startSetup(tester);
      _camera.sees(FaceSignal.detected, prompted: true);
      await tester.pump();
      expect(_cameraButton, findsNothing);
      await _faceHeld(tester);
      expect(_count('/face/enrol'), 1);
      // The failed try (4266:26076): the reason, Try Again, the tries left.
      expect(find.text('Too dark'), findsOneWidget);
      expect(find.text('Try Again'), findsOneWidget);
      expect(_live(tester, _cameraButton), isTrue);
      expect(find.text('2 out of 3 tries left'), findsOneWidget);
      expect(
        find.text("It's too dark. Move to a brighter spot or face a light."),
        findsNothing,
      );
      expect(find.text('Front camera'), findsNothing);
      _expectNoResult();
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Try Again'));
      await tester.pumpAndSettle();
      expect(_count('/face/enrol'), 2);
      expect(find.text('1 out of 3 try left'), findsOneWidget);
      await tester.tap(find.text('Try Again'));
      await tester.pumpAndSettle();
      expect(_count('/face/enrol'), 3);
      // Out of tries: the manager instead, or another go while the face is in.
      expect(find.text('Try Again'), findsNothing);
      expect(find.text('Send punch-out to manager'), findsOneWidget);
      expect(
        find.text('Your manager or HR approves the punch-out.'),
        findsOneWidget,
      );
      expect(find.text('Try setting up again'), findsOneWidget);
      await tester.tap(find.text('Send punch-out to manager'));
      await tester.pumpAndSettle();
      expect(_fallbackBody, contains('"type":"out"'));
      expect(_punchBody, isNull);
      expect(find.byType(FaceSetupScreen), findsNothing);
    },
  );

  testWidgets('ready and held still: the selfie is taken without a tap, once', (
    tester,
  ) async {
    final opened = await _openCheck(
      tester,
      _server(
        verify: {'passed': true, 'reason': 'matched', 'token': 'tok-auto'},
      ),
    );
    _camera.sees(FaceSignal.detected, prompted: true);
    await tester.pump();
    // Not before the hold, and no button to tap meanwhile.
    await tester.pump(FaceAutoCapture.hold - const Duration(milliseconds: 100));
    expect(_count('/face/verify'), 0);
    expect(_cameraButton, findsNothing);
    expect(find.text(_holdLine), findsOneWidget);
    _expectNoResult();
    // The face moving a little resets nothing; the hold ends and it is taken.
    _camera.sees(FaceSignal.detected, prompted: true);
    await tester.pump(const Duration(milliseconds: 150));
    await tester.pumpAndSettle();
    expect(_count('/face/verify'), 1);
    expect(find.text(_detectedLine), findsOneWidget);
    await tester.pump(FaceCheckScreen.matchedPause);
    await tester.pumpAndSettle();
    expect(opened.outcome?.token, 'tok-auto');
    expect(_count('/face/verify'), 1);
  });

  for (final waived in [true, false]) {
    final why = waived
        ? 'detection gave up waiting'
        : 'the phone cannot detect faces';
    testWidgets(
      '$why: the check has its button, which takes the selfie, and nothing is automatic',
      (tester) async {
        final opened = await _openCheck(
          tester,
          _server(verify: {'passed': true, 'token': 'tok'}),
        );
        expect(_cameraButton, findsNothing);
        _camera.waived = waived;
        _camera.sees(FaceSignal.unavailable, prompted: true);
        await tester.pump(const Duration(seconds: 2));
        expect(_count('/face/verify'), 0);
        expect(find.text(_holdLine), findsNothing);
        expect(find.text(_tapLine), findsOneWidget);
        expect(_cameraButton, findsOneWidget);
        expect(find.text('Take selfie & punch in'), findsOneWidget);
        expect(_live(tester, _cameraButton), isTrue);
        _expectNoResult();
        await tester.tap(find.text('Take selfie & punch in'));
        await tester.pumpAndSettle();
        expect(_count('/face/verify'), 1);
        expect(_field(_verifyBody!, 'challenge'), 'none');
        expect(_field(_verifyBody!, 'devicePassed'), 'false');
        expect(find.text(_detectedLine), findsOneWidget);
        expect(_tick, findsOneWidget);
        await tester.pump(FaceCheckScreen.matchedPause);
        await tester.pumpAndSettle();
        expect(opened.outcome?.token, 'tok');
      },
    );

    testWidgets(
      '$why: setup has its button on the camera once they agree, and it sets up',
      (tester) async {
        await pumpPunch(
          tester,
          type: 'in',
          verify: {'passed': true, 'token': 'verify-tok'},
        );
        _camera.waived = waived;
        _camera.sees(FaceSignal.unavailable, prompted: true);
        await tester.pump(const Duration(seconds: 2));
        // The intro still: its button is the consent, nothing is sent by it.
        expect(find.byType(FaceSetupIntro), findsOneWidget);
        expect(_cameraButton, findsNothing);
        expect(_count('/face/enrol'), 0);
        await _startSetup(tester);
        expect(_count('/face/enrol'), 0);
        expect(find.text(_tapLine), findsOneWidget);
        expect(find.text(_holdLine), findsNothing);
        expect(_cameraButton, findsOneWidget);
        expect(find.text('Set up Face ID'), findsOneWidget);
        expect(_live(tester, _cameraButton), isTrue);
        await tester.pump(const Duration(seconds: 2));
        expect(
          _count('/face/enrol'),
          0,
          reason: 'nothing is automatic without detection',
        );
        _expectNoResult();
        await tester.tap(_cameraButton);
        await tester.pumpAndSettle();
        expect(_count('/face/enrol'), 1);
        expect(find.text(_setUpLine), findsOneWidget);
        expect(_tick, findsOneWidget);
        expect(_cameraButton, findsNothing);
        // Let the tick move on to the check before the test ends.
        await tester.pump(FaceSetupScreen.successPause);
        await tester.pumpAndSettle();
        expect(find.byType(FaceCheckScreen), findsOneWidget);
      },
    );
  }

  testWidgets(
    'after a failed check Try Again comes back, locked while the face is out, with the tries left',
    (tester) async {
      await _openCheck(
        tester,
        _server(
          verify: {
            'passed': false,
            'reason': 'not_a_match',
            'message': "This doesn't match the face set up for your account.",
            'attemptsLeft': 2,
            'fallbackAvailable': false,
          },
        ),
      );
      _camera.sees(FaceSignal.detected, prompted: true);
      await tester.pump();
      expect(_cameraButton, findsNothing);
      await _faceHeld(tester);
      expect(_count('/face/verify'), 1);
      expect(find.text('Face not matched'), findsOneWidget);
      expect(_cameraButton, findsOneWidget);
      expect(find.text('Try Again'), findsOneWidget);
      expect(_live(tester, _cameraButton), isTrue);
      expect(find.text('2 out of 3 tries left'), findsOneWidget);
      expect(
        find.text("This doesn't match the face set up for your account."),
        findsNothing,
      );
      expect(find.text('Send punch-in to manager'), findsNothing);
      _expectNoResult();
      // The face out of the oval: the button stays, locked.
      _camera.sees(FaceSignal.notDetected, prompted: true);
      await tester.pump();
      expect(_cameraButton, findsOneWidget);
      expect(_live(tester, _cameraButton), isFalse);
      await tester.tap(find.text('Try Again'));
      await tester.pump();
      expect(_count('/face/verify'), 1);
      // Back in the oval within the flicker: no automatic try, the tap takes it.
      _camera.sees(FaceSignal.detected, prompted: true);
      await tester.pump();
      expect(_live(tester, _cameraButton), isTrue);
      await tester.tap(find.text('Try Again'));
      await tester.pumpAndSettle();
      expect(_count('/face/verify'), 2);
    },
  );

  testWidgets('a photo the camera did not take brings Try Again back too', (
    tester,
  ) async {
    final opened = await _openCheck(
      tester,
      _server(verify: {'passed': true, 'reason': 'matched', 'token': 'tok'}),
    );
    _camera.photo = null;
    await _faceHeld(tester);
    expect(_count('/face/verify'), 0);
    expect(find.text('Face check unavailable'), findsOneWidget);
    expect(
      find.text('The camera did not take the photo. Try again.'),
      findsOneWidget,
    );
    expect(find.text('Try Again'), findsOneWidget);
    _expectNoResult();
    _camera.photo = Uint8List.fromList([0xff, 0xd8, 0xff, 0xe0]);
    await tester.tap(find.text('Try Again'));
    await tester.pumpAndSettle();
    expect(_count('/face/verify'), 1);
    expect(find.text(_detectedLine), findsOneWidget);
    await tester.pump(FaceCheckScreen.matchedPause);
    await tester.pumpAndSettle();
    expect(opened.outcome?.token, 'tok');
  });

  testWidgets(
    'a failed check is not retried on its own until the face leaves and comes back',
    (tester) async {
      await _openCheck(
        tester,
        _server(
          verify: {
            'passed': false,
            'reason': 'not_a_match',
            'message': "This doesn't match the face set up for your account.",
            'attemptsLeft': 2,
            'fallbackAvailable': false,
          },
        ),
      );
      _camera.sees(FaceSignal.detected, prompted: true);
      await tester.pump(FaceAutoCapture.hold);
      await tester.pumpAndSettle();
      expect(_count('/face/verify'), 1);
      expect(find.text('Face not matched'), findsOneWidget);
      expect(find.text('Try Again'), findsOneWidget);

      // Still in the oval, frame after frame: nothing more.
      for (var i = 0; i < 5; i += 1) {
        _camera.sees(FaceSignal.detected, prompted: true);
        await tester.pump(const Duration(milliseconds: 400));
      }
      expect(_count('/face/verify'), 1);

      // A flicker of one frame is not leaving.
      _camera.sees(FaceSignal.notDetected, prompted: true);
      await tester.pump(const Duration(milliseconds: 100));
      _camera.sees(FaceSignal.detected, prompted: true);
      await tester.pump(const Duration(seconds: 2));
      expect(_count('/face/verify'), 1);

      // Gone, then back: the next try is automatic again.
      _camera.sees(FaceSignal.notDetected, prompted: true);
      await tester.pump(
        FaceAutoCapture.away + const Duration(milliseconds: 100),
      );
      _camera.sees(FaceSignal.detected, prompted: true);
      await tester.pump(FaceAutoCapture.hold);
      await tester.pumpAndSettle();
      expect(_count('/face/verify'), 2);

      // A tap still takes one by hand.
      await tester.tap(find.text('Try Again'));
      await tester.pumpAndSettle();
      expect(_count('/face/verify'), 3);
    },
  );

  testWidgets(
    'setup takes the selfie on its own, but only once they press Set up Face ID',
    (tester) async {
      await pumpPunch(
        tester,
        type: 'in',
        verify: {'passed': true, 'reason': 'matched', 'token': 'verify-tok'},
      );
      _camera.sees(FaceSignal.detected, prompted: true);
      await tester.pump(const Duration(seconds: 2));
      expect(_count('/face/enrol'), 0);
      expect(find.byType(FaceSetupIntro), findsOneWidget);
      await _startSetup(tester);
      expect(find.text(_holdLine), findsOneWidget);
      expect(_cameraButton, findsNothing);
      expect(_count('/face/enrol'), 0);
      await tester.pump(FaceAutoCapture.hold);
      await tester.pump();
      await tester.pump();
      expect(_count('/face/enrol'), 1);
      // Set up: the tick, then the selfie check takes itself too, and the
      // punch carries the check's token.
      expect(find.text(_setUpLine), findsOneWidget);
      await tester.pump(FaceSetupScreen.successPause);
      await tester.pumpAndSettle();
      expect(find.byType(FaceCheckScreen), findsOneWidget);
      _camera.sees(FaceSignal.detected, prompted: true);
      await tester.pump(FaceAutoCapture.hold);
      await tester.pumpAndSettle();
      expect(_count('/face/verify'), 1);
      expect(find.text(_detectedLine), findsOneWidget);
      await tester.pump(FaceCheckScreen.matchedPause);
      await tester.pumpAndSettle();
      expect(_punchBody?['faceToken'], 'verify-tok');
      expect(find.text("You're punched in!"), findsOneWidget);
    },
  );

  testWidgets('a failed setup is not retried on its own while the face stays', (
    tester,
  ) async {
    _enrolReply = () => http.Response(
      jsonEncode({
        'success': false,
        'message': "It's too dark. Move to a brighter spot or face a light.",
        'details': {
          'face': {'reason': 'too_dark', 'attemptsLeft': 2, 'fallback': false},
        },
      }),
      422,
    );
    await pumpPunch(tester, type: 'in');
    await _startSetup(tester);
    _camera.sees(FaceSignal.detected, prompted: true);
    await tester.pump(FaceAutoCapture.hold);
    await tester.pumpAndSettle();
    expect(_count('/face/enrol'), 1);
    expect(find.text('Too dark'), findsOneWidget);
    expect(find.text('Try Again'), findsOneWidget);
    expect(find.text('2 out of 3 tries left'), findsOneWidget);
    _camera.sees(FaceSignal.detected, prompted: true);
    await tester.pump(const Duration(seconds: 3));
    expect(_count('/face/enrol'), 1);
    // Out of the oval: Try Again locked, and nothing taken.
    _camera.sees(FaceSignal.notDetected, prompted: true);
    await tester.pump(const Duration(milliseconds: 100));
    expect(_live(tester, _cameraButton), isFalse);
    await tester.tap(find.text('Try Again'));
    await tester.pump(const Duration(seconds: 1));
    expect(_count('/face/enrol'), 1);
    // Gone and back: the next try is automatic again, as on the check.
    _camera.sees(FaceSignal.detected, prompted: true);
    await tester.pump(FaceAutoCapture.hold);
    await tester.pumpAndSettle();
    expect(_count('/face/enrol'), 2);
    expect(find.text('Too dark'), findsOneWidget);
  });

  // The screens as PNGs (393x852 @2x), only when SCREENSHOTS names a folder.
  group('screenshots', () {
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
      // The icons, for screenshots only: tests draw them as boxes otherwise.
      if (_screenshots.isNotEmpty) {
        final icons = File(
          '/opt/homebrew/share/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
        );
        if (icons.existsSync()) {
          await (FontLoader('MaterialIcons')..addFont(
                Future.value(ByteData.sublistView(icons.readAsBytesSync())),
              ))
              .load();
        }
      }
    });

    const shot = ValueKey('shot');
    const phone = Size(393, 852);

    /// A 393 x 852 phone drawn at 2x: a golden is captured at one pixel per
    /// logical pixel, so the screen is laid out at the phone's size and
    /// scaled up into a view twice as big. The screen is pushed as a route,
    /// as the app pushes it, so it can pop.
    Future<void> pumpScreen(
      WidgetTester tester,
      Widget Function() screen,
    ) async {
      tester.view.physicalSize = phone * 2;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        RepaintBoundary(
          key: shot,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
            builder: (context, child) => FittedBox(
              child: SizedBox.fromSize(
                size: phone,
                child: MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(size: phone, devicePixelRatio: 2),
                  child: child!,
                ),
              ),
            ),
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<FaceCheckOutcome>(
                      builder: (_) => screen(),
                    ),
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
    }

    /// The SVGs and the intro's picture are decoded outside the fake clock;
    /// the pump after is short of [FaceAutoCapture.hold].
    Future<void> settle(WidgetTester tester) async {
      await tester.pump();
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 150));
        for (final element in find.byType(Image).evaluate()) {
          await precacheImage((element.widget as Image).image, element);
        }
      });
      await tester.pump(const Duration(milliseconds: 300));
    }

    Future<void> shoot(String name) async {
      if (_screenshots.isEmpty) return;
      await expectLater(
        find.byKey(shot),
        matchesGoldenFile(Uri.file('$_screenshots/$name.png')),
      );
    }

    ManagerApiService api({
      Map<String, dynamic> verify = const {'passed': true, 'token': 'tok'},
    }) => ManagerApiService(
      session: AuthSession(
        token: 't',
        user: _user(enrolled: true, atPunch: true),
      ),
      baseUrl: 'https://example.test',
      client: _server(verify: verify),
    );

    testWidgets('setup: the intro, the camera looking, Hold still, the tick', (
      tester,
    ) async {
      await pumpScreen(tester, () => FaceSetupScreen(api: api()));
      await settle(tester);
      expect(find.byType(FaceSetupIntro), findsOneWidget);
      expect(find.text(_consentWords), findsOneWidget);
      await shoot('setup-intro');
      await _startSetup(tester);
      await settle(tester);
      expect(find.text(_positionLine), findsOneWidget);
      expect(_cameraButton, findsNothing);
      await shoot('setup-looking');
      _camera.sees(FaceSignal.detected, prompted: true);
      await settle(tester);
      expect(find.text(_holdLine), findsOneWidget);
      expect(_cameraButton, findsNothing);
      expect(_count('/face/enrol'), 0);
      _expectNoResult();
      await shoot('setup-detected');
      await tester.pump(FaceAutoCapture.hold);
      await tester.pumpAndSettle();
      expect(_count('/face/enrol'), 1);
      expect(find.text(_setUpLine), findsOneWidget);
      await settle(tester);
      expect(_tick, findsOneWidget);
      await shoot('setup-success');
      // Let the tick move on to the check before the test ends.
      await tester.pump(FaceSetupScreen.successPause);
      await tester.pumpAndSettle();
      expect(find.byType(FaceCheckScreen), findsOneWidget);
    });

    testWidgets('the check: looking, then Face id detected with the tick', (
      tester,
    ) async {
      await pumpScreen(tester, () => FaceCheckScreen(api: api()));
      await settle(tester);
      expect(find.text(_positionLine), findsOneWidget);
      expect(_cameraButton, findsNothing);
      await shoot('check-looking');
      await _faceHeld(tester);
      expect(_count('/face/verify'), 1);
      expect(find.text(_detectedLine), findsOneWidget);
      await settle(tester);
      expect(_tick, findsOneWidget);
      await shoot('check-detected');
      await tester.pump(FaceCheckScreen.matchedPause);
      await tester.pumpAndSettle();
      expect(find.byType(FaceCheckScreen), findsNothing);
    });

    testWidgets('the check: a failed try, with Try Again and the tries left', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        () => FaceCheckScreen(
          api: api(
            verify: {
              'passed': false,
              'reason': 'no_face',
              'message': 'No face was found in the photo.',
              'attemptsLeft': 2,
            },
          ),
        ),
      );
      await settle(tester);
      await _faceHeld(tester);
      expect(_count('/face/verify'), 1);
      expect(find.text('Face not detected'), findsOneWidget);
      expect(find.text('Try Again'), findsOneWidget);
      expect(find.text('2 out of 3 tries left'), findsOneWidget);
      expect(_tick, findsNothing);
      await settle(tester);
      await shoot('check-failed');
    });
  });

  test('a failed check reads its reason as a heading', () {
    expect(
      const FaceCheckResult(
        passed: false,
        reason: 'too_dark',
        message: '',
      ).title,
      'Too dark',
    );
    expect(
      const FaceCheckResult(
        passed: false,
        reason: 'other_person',
        message: '',
      ).title,
      'Face not matched',
    );
  });
}
