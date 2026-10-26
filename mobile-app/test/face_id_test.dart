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
import 'package:mobile_app/features/face_id/face_setup_screen.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/onboarding/presentation/onboarding_flow.dart';

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

AuthUser _user({bool required = false, bool enrolled = false, bool atPunch = false}) => AuthUser.fromJson({
  'id': 'u1',
  'email': 'someone@sowaka.test',
  'name': 'Asha',
  'company': 'Sowaka',
  'org': 'sowaka',
  'profilePhotoUrl': 'https://example.test/p.png',
  'interests': ['Music'],
  'faceId': {'required': required, 'enrolled': enrolled, 'atPunch': atPunch},
});

final _requests = <String>[];
String? _enrolBody;
String? _fallbackBody;

http.Client _server({required Map<String, dynamic> verify}) => MockClient((request) async {
  _requests.add(request.url.path);
  if (request.url.path.endsWith('/face/status')) {
    return http.Response(jsonEncode({
      'success': true, 'setupRequired': true, 'checkAtPunch': true, 'enrolled': true,
      'consent': {'version': 'v1', 'agree': 'I agree to Face ID keeping a template of my face.'},
      'liveness': {'mode': 'device'}, 'maxAttempts': 3, 'failedAttempts': 0, 'fallbackAvailable': false,
    }), 200);
  }
  if (request.url.path.endsWith('/face/verify')) return http.Response(jsonEncode({'success': true, ...verify}), 200);
  if (request.url.path.endsWith('/face/enrol')) {
    _enrolBody = String.fromCharCodes(request.bodyBytes);
    return http.Response(jsonEncode({'success': true, 'enrolled': true}), 201);
  }
  if (request.url.path.endsWith('/face/fallback')) {
    _fallbackBody = request.body;
    return http.Response(jsonEncode({'success': true, 'request': {'id': 'r1'}}), 201);
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
      session: AuthSession(token: 't', user: _user(required: true, enrolled: true, atPunch: true)),
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
    FaceCamera.create = () => _camera = _FakeCamera();
  });

  group('who is asked to set up Face ID', () {
    test('everyone at a company that asks, once photo and interests are done', () {
      expect(needsOnboarding(_user(required: true)), isTrue);
    });
    test('nobody who has set it up', () {
      expect(needsOnboarding(_user(required: true, enrolled: true)), isFalse);
    });
    test('nobody at a company that does not ask', () {
      expect(needsOnboarding(_user()), isFalse);
    });
    test('the profile keeps the three flags across a save', () {
      final again = AuthUser.fromJson(_user(required: true, atPunch: true).toJson());
      expect([again.faceIdRequired, again.faceIdEnrolled, again.faceIdAtPunch], [true, false, true]);
      expect(again.copyWith(faceIdEnrolled: true).faceIdEnrolled, isTrue);
    });
  });

  testWidgets('onboarding ends with the Face ID step for someone who has the rest', (tester) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final session = AuthSession(token: 't', user: _user(required: true));
    await tester.pumpWidget(MaterialApp(
      home: OnboardingFlow(session: session, api: ManagerApiService(session: session), onDone: (_, _, _) {}),
    ));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Set up Face ID'), findsWidgets);
    expect(find.text('What are you into?'), findsNothing);
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
      session: AuthSession(token: 't', user: _user(required: true, enrolled: true, atPunch: true)),
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

  testWidgets('setup: the same screens, agree on them, and the version goes with the photo', (tester) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = ManagerApiService(
      session: AuthSession(token: 't', user: _user(required: true)),
      baseUrl: 'https://example.test',
      client: _server(verify: const {}),
    );
    bool? enrolled;
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () async => enrolled = await Navigator.of(context).push<bool>(
              MaterialPageRoute(builder: (_) => FaceSetupScreen(api: api)),
            ),
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('Set up Face ID'), findsOneWidget);
    expect(find.text('I agree to Face ID keeping a template of my face.'), findsOneWidget);
    expect(find.text('Learn more'), findsNothing);
    _camera.sees(FaceSignal.detected, prompted: true);
    await tester.pump();
    // Not agreed: the button does nothing.
    await tester.tap(find.text('Take selfie & set up'));
    await tester.pumpAndSettle();
    expect(_requests.where((path) => path.endsWith('/face/enrol')), isEmpty);
    expect(find.text('Agree above to set up Face ID.'), findsOneWidget);
    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    await tester.tap(find.text('Take selfie & set up'));
    await tester.pumpAndSettle();
    expect(_enrolBody, contains('v1'));
    expect(find.text('Face ID is set up'), findsOneWidget);
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(enrolled, isTrue);
  });

  test('a failed check reads its reason as a heading', () {
    expect(const FaceCheckResult(passed: false, reason: 'too_dark', message: '').title, 'Too dark');
    expect(const FaceCheckResult(passed: false, reason: 'other_person', message: '').title, 'Face not matched');
  });
}
