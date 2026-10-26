// Face ID: who is asked to set it up, the selfie screens (Figma 4194:21786)
// in each state the camera can be in, and a failed check's way out to the
// manager, against a fake server. A layout that overflows fails the test.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/face_id/face_camera.dart';
import 'package:mobile_app/features/face_id/face_check_screen.dart';
import 'package:mobile_app/features/face_id/face_id_models.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/attendance/presentation/punch_screen.dart';

/// A front camera that needs no device: the test says what it sees.
class _FakeCamera extends FaceCamera {
  _FakeCamera() : super();

  void sees(FaceSignal next, {bool prompted = false}) {
    signal = next;
    challengeDone = prompted;
    notifyListeners();
  }

  @override
  Future<void> start() async {}

  @override
  Future<Uint8List?> capture() async => Uint8List.fromList([0xff, 0xd8, 0xff, 0xe0]);

  @override
  Future<void> resume() async {}

  @override
  Future<void> pause() async {}
}

AuthUser _user({bool enrolled = false, bool atPunch = false}) => AuthUser.fromJson({
  'id': 'u1',
  'email': 'someone@sowaka.test',
  'name': 'Asha',
  'company': 'Sowaka',
  'org': 'sowaka',
  'profilePhotoUrl': 'https://example.test/p.png',
  'interests': ['Music'],
  'faceId': {'enrolled': enrolled, 'atPunch': atPunch},
});

final _requests = <String>[];
String? _enrolBody;
Map<String, dynamic>? _punchBody;

/// What the next setup answers: a pass with its punch token, unless a test says otherwise.
http.Response Function() _enrolReply = _enrolPasses;
http.Response _enrolPasses() =>
    http.Response(jsonEncode({'success': true, 'enrolled': true, 'token': 'enrol-tok', 'expiresAt': '2026-10-26T10:05:00.000Z'}), 201);
String? _fallbackBody;

http.Client _server({required Map<String, dynamic> verify}) => MockClient((request) async {
  _requests.add(request.url.path);
  if (request.url.path.endsWith('/face/status')) {
    return http.Response(jsonEncode({
      'success': true, 'checkAtPunch': true, 'enrolled': true,
      'consent': {'version': 'v1', 'agree': 'I agree to Face ID keeping a template of my face.'},
      'liveness': {'mode': 'device'}, 'maxAttempts': 3, 'failedAttempts': 0, 'fallbackAvailable': false,
    }), 200);
  }
  if (request.url.path.endsWith('/face/verify')) return http.Response(jsonEncode({'success': true, ...verify}), 200);
  if (request.url.path.endsWith('/face/enrol')) {
    _enrolBody = String.fromCharCodes(request.bodyBytes);
    return _enrolReply();
  }
  if (request.url.path.endsWith('/face/fallback')) {
    _fallbackBody = request.body;
    return http.Response(jsonEncode({'success': true, 'request': {'id': 'r1'}}), 201);
  }
  if (request.url.path.endsWith('/attendance/punch')) {
    _punchBody = jsonDecode(request.body) as Map<String, dynamic>;
    return http.Response(jsonEncode({'success': true, 'workDate': '2026-10-26', 'punchIn': '2026-10-26T04:00:00.000Z'}), 200);
  }
  return http.Response('{"success":true}', 200);
});

late _FakeCamera _camera;

Future<FaceCheckOutcome?> Function() _pumpCheck(WidgetTester tester, http.Client client) {
  FaceCheckOutcome? outcome;
  var popped = false;
  return () async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final loader = FontLoader('Sora')..addFont(rootBundle.load('assets/fonts/sora/Sora-Variable.ttf'));
    await loader.load();
    final api = ManagerApiService(
      session: AuthSession(token: 't', user: _user(enrolled: true, atPunch: true)),
      baseUrl: 'https://example.test',
      client: client,
    );
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () async {
              outcome = await Navigator.of(context).push(MaterialPageRoute<FaceCheckOutcome>(
                builder: (_) => FaceCheckScreen(api: api),
              ));
              popped = true;
            },
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    return popped ? outcome : null;
  };
}

void main() {
  setUp(() {
    _requests.clear();
    _punchBody = null;
    _enrolReply = _enrolPasses;
    FaceCheckOutcome.enrolledThisRun = false;
    FaceCamera.create = () => _camera = _FakeCamera();
  });

  test('the profile keeps both flags across a save', () {
    final again = AuthUser.fromJson(_user(atPunch: true).toJson());
    expect([again.faceIdEnrolled, again.faceIdAtPunch], [false, true]);
  });

  testWidgets('the selfie screen in each state the camera can be in', (tester) async {
    await _pumpCheck(tester, _server(verify: {'passed': true, 'token': 'tok'}))();
    // Before the first frame (4010:63873): no status row.
    expect(find.text('Take a selfie'), findsOneWidget);
    expect(find.text('Front camera'), findsOneWidget);
    expect(find.text('Face detected'), findsNothing);
    expect(find.text('Face not detected'), findsNothing);

    // Face not detected (4005:51579): capture locked.
    _camera.sees(FaceSignal.notDetected);
    await tester.pump();
    expect(find.text('Face not detected'), findsOneWidget);
    expect(find.text('Capture unlocks when a face is detected.'), findsOneWidget);

    // A face, but the phone's prompt not done yet.
    _camera.sees(FaceSignal.detected);
    await tester.pump();
    expect(find.text('Face detected'), findsOneWidget);
    expect(find.text(_camera.challenge.prompt), findsOneWidget);

    // Face detected (4005:51535): ready.
    _camera.sees(FaceSignal.detected, prompted: true);
    await tester.pump();
    expect(find.text("You're all set. Look at the camera and\nhold still while you take your selfie."), findsOneWidget);
    expect(find.text('Your selfie will confirm your punch-in.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a punch-out has the same selfie with its own words, and its own fallback', (tester) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = ManagerApiService(
      session: AuthSession(token: 't', user: _user(enrolled: true, atPunch: true)),
      baseUrl: 'https://example.test',
      client: _server(verify: {'passed': false, 'reason': 'not_a_match', 'message': 'No match.', 'attemptsLeft': 0, 'fallbackAvailable': true}),
    );
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<FaceCheckOutcome>(
              builder: (_) => FaceCheckScreen(api: api, type: 'out'),
            )),
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('Punch out'), findsOneWidget);
    _camera.sees(FaceSignal.detected, prompted: true);
    await tester.pump();
    expect(find.text('Your selfie will confirm your punch-out.'), findsOneWidget);
    await tester.tap(find.text('Take selfie & punch out'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Send punch-out to manager'));
    await tester.pumpAndSettle();
    expect(_fallbackBody, contains('"type":"out"'));
  });

  testWidgets('a pass hands the token back to the punch', (tester) async {
    final open = _pumpCheck(tester, _server(verify: {'passed': true, 'reason': 'matched', 'token': 'tok-1'}));
    await open();
    _camera.sees(FaceSignal.detected, prompted: true);
    await tester.pump();
    await tester.tap(find.text('Take selfie & punch in'));
    await tester.pumpAndSettle();
    expect(find.text('Take a selfie'), findsNothing);
    expect(_requests.where((path) => path.endsWith('/face/verify')).length, 1);
  });

  testWidgets('out of tries: the punch-in can go to the manager', (tester) async {
    await _pumpCheck(tester, _server(verify: {
      'passed': false, 'reason': 'not_a_match', 'message': "This doesn't match the face set up for your account.",
      'attemptsLeft': 0, 'fallbackAvailable': true,
    }))();
    _camera.sees(FaceSignal.detected, prompted: true);
    await tester.pump();
    await tester.tap(find.text('Take selfie & punch in'));
    await tester.pumpAndSettle();
    expect(find.text('Face not matched'), findsOneWidget);
    expect(find.text("This doesn't match the face set up for your account."), findsOneWidget);
    await tester.tap(find.text('Send punch-in to manager'));
    await tester.pumpAndSettle();
    expect(_requests.where((path) => path.endsWith('/face/fallback')).length, 1);
    expect(find.text('Take a selfie'), findsNothing);
  });

  Future<void> pumpPunch(WidgetTester tester, {required String type}) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = ManagerApiService(
      session: AuthSession(token: 't', user: _user(atPunch: true)),
      baseUrl: 'https://example.test',
      client: _server(verify: const {}),
    );
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<PunchOutcome>(
              builder: (_) => PunchScreen(api: api, type: type, geofenced: false, startImmediately: true),
            )),
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  testWidgets('not set up: the first punch opens setup, and the setup carries the punch', (tester) async {
    await pumpPunch(tester, type: 'in');
    // Setup, not the check: the Selfie Punch-in screens with setup's words.
    expect(find.text('Set up Face ID'), findsOneWidget);
    expect(find.text('Punch in'), findsOneWidget);
    expect(find.text('I agree to Face ID keeping a template of my face.'), findsOneWidget);
    _camera.sees(FaceSignal.detected, prompted: true);
    await tester.pump();
    // Not agreed: the button does nothing.
    await tester.tap(find.text('Set up & punch in'));
    await tester.pumpAndSettle();
    expect(_requests.where((path) => path.endsWith('/face/enrol')), isEmpty);
    expect(find.text('Agree above to set up Face ID.'), findsOneWidget);
    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    await tester.tap(find.text('Set up & punch in'));
    await tester.pumpAndSettle();
    expect(_enrolBody, contains('v1'));
    // No second selfie: the punch went with the setup's token.
    expect(_requests.where((path) => path.endsWith('/face/verify')), isEmpty);
    expect(_punchBody?['faceToken'], 'enrol-tok');
    expect(find.text("You're punched in!"), findsOneWidget);
    expect(FaceCheckOutcome.enrolledThisRun, isTrue);
  });

  testWidgets('a setup that fails says why, and after three the punch-out can go to the manager', (tester) async {
    var tries = 0;
    _enrolReply = () {
      tries += 1;
      return http.Response(jsonEncode({
        'success': false,
        'message': "It's too dark. Move to a brighter spot or face a light.",
        'details': {'face': {'reason': 'too_dark', 'attemptsLeft': 3 - tries, 'fallback': tries >= 3}},
      }), 422);
    };
    await pumpPunch(tester, type: 'out');
    expect(find.text('Punch out'), findsOneWidget);
    await tester.tap(find.byType(Checkbox));
    _camera.sees(FaceSignal.detected, prompted: true);
    await tester.pump();
    await tester.tap(find.text('Set up & punch out'));
    await tester.pumpAndSettle();
    expect(find.text('Too dark'), findsOneWidget);
    expect(find.text('2 tries left.'), findsOneWidget);
    for (var i = 0; i < 2; i += 1) {
      await tester.tap(find.text('Set up & punch out'));
      await tester.pumpAndSettle();
    }
    await tester.tap(find.text('Send punch-out to manager'));
    await tester.pumpAndSettle();
    expect(_fallbackBody, contains('"type":"out"'));
    expect(_punchBody, isNull);
  });

  test('a failed check reads its reason as a heading', () {
    expect(const FaceCheckResult(passed: false, reason: 'too_dark', message: '').title, 'Too dark');
    expect(const FaceCheckResult(passed: false, reason: 'other_person', message: '').title, 'Face not matched');
  });
}
