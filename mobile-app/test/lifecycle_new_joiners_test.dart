import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/new_joiners_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/manager/new_joiners_tab.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_kit.dart';

/// Teams › New joiners: the one joiners list (the manager, the buddy, the head
/// of department and every teammate), view only, of the people joining their
/// team or department (Tj − 1 to Tj + 30), against
/// `GET /lifecycle/team/new-joiners` in the shape
/// backend/src/services/lifecycle/teamNewJoiners.ts writes.
///
/// `flutter test --dart-define=SCREENSHOTS=<dir> test/lifecycle_new_joiners_test.dart`
/// also writes the list at 360 and 412 wide (and at text scale 1.3) to `<dir>`.

const _screenshots = String.fromEnvironment('SCREENSHOTS');

class _NoOnboardingApi implements OnboardingApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

OnboardingShell _shell() => OnboardingShell(
  api: _NoOnboardingApi(),
  profileAction: const SizedBox(width: 30, height: 30),
  onNotifications: () {},
  viewerName: 'Rohan Das',
  now: () => DateTime(2026, 11, 30, 10),
);

class _FakeApi implements NewJoinersApi {
  _FakeApi(this.rows);
  List<Map<String, dynamic>> rows;
  int reads = 0;

  @override
  Future<List<NewJoinerCard>> fetchNewJoiners() async {
    reads += 1;
    return rows.map(NewJoinerCard.fromJson).toList();
  }
}

final _kavya = {
  'journeyId': 'j8', 'name': 'Kavya Rao', 'initials': 'KR', 'designation': 'Product designer', 'department': 'Design',
  'tj': '2026-12-01', 'joiningLine': 'Joins tomorrow', 'relation': 'department', 'profileNote': 'Profile opens on their first day',
};
final _priya = {
  'journeyId': 'j1', 'userId': 'u-priya', 'name': 'Priya Shah', 'initials': 'PS', 'designation': 'Operations executive', 'department': 'Operations',
  'tj': '2026-11-23', 'joiningLine': 'Joined Mon 23 Nov', 'relation': 'peer',
};

Future<void> _pump(WidgetTester tester, Widget body) async {
  tester.view.physicalSize = const Size(393 * 3, 852 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: body)));
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async {
    for (final (family, file) in [
      ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
      ('Plus Jakarta Sans', 'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf'),
    ]) {
      await (FontLoader(family)..addFont(rootBundle.load(file))).load();
    }
  });
  setUp(() => NewJoinersTab.count.value = 0);

  group('Teams › New joiners', () {
    testWidgets('a card each: name, role · department, the joining line; tap opens the profile', (tester) async {
      final opened = <String>[];
      final api = _FakeApi([_kavya, _priya]);
      await _pump(tester, NewJoinersTab(shell: _shell(), api: api, openProfile: opened.add));

      final priya = find.byKey(const ValueKey('new-joiner-j1'));
      expect(priya, findsOneWidget);
      expect(find.descendant(of: priya, matching: find.text('Priya Shah')), findsOneWidget);
      expect(find.descendant(of: priya, matching: find.text('Operations executive · Operations')), findsOneWidget);
      expect(find.descendant(of: priya, matching: find.text('Joined Mon 23 Nov')), findsOneWidget);
      // The Team tab's card: the whole card is the tap (an ink ripple), as My Team's people are.
      expect(find.descendant(of: priya, matching: find.byType(InkWell)), findsOneWidget);
      expect(NewJoinersTab.count.value, 2);

      await tester.tap(priya);
      await tester.pumpAndSettle();
      expect(opened, ['u-priya']);
    });

    testWidgets('no account yet: "Profile opens on their first day", and a tap opens nothing', (tester) async {
      final opened = <String>[];
      await _pump(tester, NewJoinersTab(shell: _shell(), api: _FakeApi([_kavya]), openProfile: opened.add));
      final kavya = find.byKey(const ValueKey('new-joiner-j8'));
      expect(find.descendant(of: kavya, matching: find.text('Joins tomorrow')), findsOneWidget);
      expect(find.descendant(of: kavya, matching: find.text('Profile opens on their first day')), findsOneWidget);
      expect(find.descendant(of: kavya, matching: find.byType(InkWell)), findsNothing);
      await tester.tap(kavya);
      await tester.pumpAndSettle();
      expect(opened, isEmpty);
    });

    testWidgets('view only: no buttons, ticks or task rows anywhere on the tab', (tester) async {
      await _pump(tester, NewJoinersTab(shell: _shell(), api: _FakeApi([_kavya, _priya]), openProfile: (_) {}));
      expect(find.byType(ElevatedButton), findsNothing);
      expect(find.byType(TextButton), findsNothing);
      expect(find.byType(OutlinedButton), findsNothing);
      expect(find.byType(FilledButton), findsNothing);
      expect(find.byType(Checkbox), findsNothing);
    });

    testWidgets('an empty list says so, and the count goes to 0', (tester) async {
      NewJoinersTab.count.value = 3;
      await _pump(tester, NewJoinersTab(shell: _shell(), api: _FakeApi([]), openProfile: (_) {}));
      expect(find.text('No new joiners right now.'), findsOneWidget);
      expect(NewJoinersTab.count.value, 0);
    });

    for (final (width, scale) in [(360.0, 1.0), (412.0, 1.0), (360.0, 1.3)]) {
      testWidgets('lays out at $width wide, text scale $scale: long names and roles end in …, nothing overflows', (tester) async {
        final long = {
          ..._priya,
          'journeyId': 'jl', 'name': 'Venkatanarasimharajuvaripeta Subrahmanyam Lakshminarayanan',
          'designation': 'Senior principal customer experience operations specialist', 'department': 'Customer success and operations',
        };
        tester.view.physicalSize = Size(width * 3, 780 * 3);
        tester.view.devicePixelRatio = 3;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(
          MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
            home: MediaQuery.withClampedTextScaling(
              minScaleFactor: scale,
              maxScaleFactor: scale,
              child: Scaffold(
                backgroundColor: const Color(0xFFF7F7F9),
                body: NewJoinersTab(shell: _shell(), api: _FakeApi([_kavya, _priya, long]), openProfile: (_) {}),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final name = tester.widget<Text>(find.text(long['name']!));
        expect([name.maxLines, name.overflow], [1, TextOverflow.ellipsis]);
        // Every card is as wide as the list (16 at each side).
        expect(tester.getSize(find.byKey(const ValueKey('new-joiner-jl'))).width, width - 32);
        if (_screenshots.isNotEmpty) {
          await expectLater(find.byType(NewJoinersTab), matchesGoldenFile(Uri.file('$_screenshots/new-joiners-${width.toInt()}${scale == 1 ? '' : '-text130'}.png')));
        }
      });
    }

    test('the New joiners pill: only while the lifecycle is on and the list has someone', () {
      expect(NewJoinersTab.showsPill(lifecycleOn: true, joiners: 1, open: false), isTrue);
      expect(NewJoinersTab.showsPill(lifecycleOn: true, joiners: 0, open: false), isFalse);
      expect(NewJoinersTab.showsPill(lifecycleOn: false, joiners: 2, open: false), isFalse);
      expect(NewJoinersTab.showsPill(lifecycleOn: true, joiners: 0, open: true), isTrue);
    });

    test('refreshCount reads the list for the pill', () async {
      await NewJoinersTab.refreshCount(api: _FakeApi([_kavya, _priya]));
      expect(NewJoinersTab.count.value, 2);
    });

    test('the card reads the server’s shape; role line from the parts there are', () {
      final c = NewJoinerCard.fromJson(_kavya);
      expect([c.journeyId, c.userId, c.name, c.roleLine, c.joiningLine, c.profileNote], ['j8', null, 'Kavya Rao', 'Product designer · Design', 'Joins tomorrow', 'Profile opens on their first day']);
      expect(NewJoinerCard.fromJson({'journeyId': 'x', 'name': 'A B', 'joiningLine': 'Joined today'}).roleLine, isNull);
      expect(NewJoinerCard.fromJson({'journeyId': 'x', 'name': 'A B', 'department': 'Design', 'joiningLine': 'Joined today'}).roleLine, 'Design');
    });

    test('HTTP: GET /lifecycle/team/new-joiners with the session, errors carry the server’s words', () async {
      Uri? asked;
      String? auth;
      final ok = MockClient((request) async {
        asked = request.url;
        auth = request.headers['Authorization'];
        return http.Response(jsonEncode({'joiners': [_priya, _kavya]}), 200, headers: {'content-type': 'application/json'});
      });
      final session = AuthSession(token: 'tok', user: _user());
      final rows = await HttpNewJoinersApi(session: session, baseUrl: 'https://api.test', client: ok).fetchNewJoiners();
      expect(asked.toString(), 'https://api.test/lifecycle/team/new-joiners');
      expect(auth, 'Bearer tok');
      expect(rows.map((r) => r.journeyId), ['j1', 'j8']);

      final notAvailable = MockClient((_) async => http.Response(jsonEncode({'error': 'Not available'}), 404));
      expect(
        () => HttpNewJoinersApi(session: session, baseUrl: 'https://api.test', client: notAvailable).fetchNewJoiners(),
        throwsA(isA<OnboardingApiException>().having((e) => e.message, 'message', 'Not available').having((e) => e.statusCode, 'statusCode', 404)),
      );
    });
  });
}

AuthUser _user() => AuthUser.fromJson({'userId': 'rohan', 'name': 'Rohan Das', 'email': 'rohan@sowaka.test', 'role': 'employee', 'org': 'sowaka'});
