import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/onboarding/presentation/onboarding_flow.dart';

/// First run, in the order people actually meet it: whatever they are missing,
/// once, and never again once they have answered.

class _FakeApi extends ManagerApiService {
  _FakeApi({required super.session});

  List<String>? savedInterests;
  int photoUploads = 0;

  @override
  Future<void> updateInterests(List<String> interests) async {
    savedInterests = interests;
  }

  @override
  Future<String> updateProfilePhoto({
    required String path,
    required String filename,
  }) async {
    photoUploads += 1;
    return 'https://example.test/photo.png';
  }
}

AuthSession _session({String? photoUrl, List<String> interests = const [], String org = 'convrse'}) {
  return AuthSession(
    token: 't',
    user: AuthUser(
      id: 'u1',
      email: 'someone@convrse.ai',
      name: 'Vikrant',
      role: 'employee',
      company: 'Convrse',
      org: org,
      interests: interests,
      profilePhotoUrl: photoUrl,
    ),
  );
}

Future<void> _pump(WidgetTester tester, Widget child) async {
  tester.view.physicalSize = const Size(393, 852);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(home: child));
  await tester.pump(const Duration(milliseconds: 300));
}

void main() {
  group('who gets asked', () {
    test('nobody who has answered both', () {
      expect(needsOnboarding(_session(photoUrl: 'p', interests: ['Music']).user), isFalse);
    });

    test('someone with no photo', () {
      expect(needsOnboarding(_session(interests: ['Music']).user), isTrue);
    });

    test('someone who joined before interests existed', () {
      expect(needsOnboarding(_session(photoUrl: 'p').user), isTrue);
    });
  });

  testWidgets('with nothing on file, the photo step comes first', (tester) async {
    final session = _session();
    await _pump(
      tester,
      OnboardingFlow(session: session, api: _FakeApi(session: session), onDone: (_, _) {}),
    );
    expect(find.text('Add a profile photo'), findsOneWidget);
    expect(find.text('What are you into?'), findsNothing);
  });

  testWidgets('with a photo already, only the interests are asked', (tester) async {
    final session = _session(photoUrl: 'https://example.test/old.png');
    await _pump(
      tester,
      OnboardingFlow(session: session, api: _FakeApi(session: session), onDone: (_, _) {}),
    );
    expect(find.text('What are you into?'), findsOneWidget);
    expect(find.text('Add a profile photo'), findsNothing);
  });

  testWidgets('interests, then the logo notice, then done — and no second pass', (tester) async {
    final session = _session(photoUrl: 'https://example.test/old.png');
    final api = _FakeApi(session: session);
    String? donePhoto;
    List<String>? doneInterests;
    await _pump(
      tester,
      OnboardingFlow(
        session: session,
        api: api,
        onDone: (photoUrl, interests) {
          donePhoto = photoUrl;
          doneInterests = interests;
        },
      ),
    );

    // Continue is closed until something is picked.
    await tester.tap(find.text('Continue'));
    await tester.pump();
    expect(doneInterests, isNull);

    await tester.tap(find.text('Music'));
    await tester.pump();
    expect(find.text('1 of 3 selected'), findsOneWidget);

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    // The company's notice, once, before anything else.
    expect(find.text('You logo just changed'), findsOneWidget);
    expect(doneInterests, isNull, reason: 'the flow is not over until it is read');

    await tester.tap(find.text('Okay'));
    await tester.pumpAndSettle();

    expect(api.savedInterests, ['Music']);
    expect(doneInterests, ['Music']);
    expect(donePhoto, isEmpty, reason: 'the photo they already had is untouched');
    expect(find.text('You logo just changed'), findsNothing, reason: 'read once');

    // What the app carries forward no longer asks for anything.
    final after = session.user.copyWith(interests: doneInterests);
    expect(needsOnboarding(after), isFalse);
  });

  testWidgets('a Sowaka employee sees no logo notice', (tester) async {
    final session = _session(photoUrl: 'https://example.test/old.png', org: 'sowaka');
    final api = _FakeApi(session: session);
    var done = false;
    await _pump(
      tester,
      OnboardingFlow(session: session, api: api, onDone: (_, _) => done = true),
    );
    await tester.tap(find.text('Travel'));
    await tester.pump();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('You logo just changed'), findsNothing);
    expect(done, isTrue);
  });

  testWidgets('at most three interests', (tester) async {
    final session = _session(photoUrl: 'https://example.test/old.png');
    await _pump(
      tester,
      OnboardingFlow(session: session, api: _FakeApi(session: session), onDone: (_, _) {}),
    );
    for (final label in ['Music', 'Travel', 'Fitness', 'Art']) {
      await tester.tap(find.text(label));
      await tester.pump();
    }
    expect(find.text('3 of 3 selected'), findsOneWidget);
  });
}
