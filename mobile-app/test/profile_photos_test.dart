// Every place the app draws a person shows their photo when they have one,
// and their initials only when they have none: the shared face, the
// notification inbox's sender, Hint Relay's roster and card, the games home's
// "playing now" faces, the web games' leaderboard rows, the lifecycle notes,
// starter tasks, intro comments and offboarding avatars.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/games/data/games_home_models.dart';
import 'package:mobile_app/features/games/data/games_models.dart';
import 'package:mobile_app/features/lifecycle/offboarding/offboarding_models.dart';
import 'package:mobile_app/features/lifecycle/offboarding/offboarding_ui.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';
import 'package:mobile_app/features/notifications/presentation/notification_inbox_screen.dart';
import 'package:mobile_app/features/relay/data/relay_models.dart';
import 'package:mobile_app/features/relay/presentation/relay_style.dart';
import 'package:mobile_app/features/shared/face_photo.dart';

/// A 1×1 PNG, decoded in place (no network in tests).
const _photo =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const _session = AuthSession(
  token: 'token',
  user: AuthUser(
    id: 'u-asha',
    email: 'asha@getsowaka.com',
    name: 'Asha',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    enabledTabs: [],
    interests: [],
  ),
);

Future<void> _show(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: Center(child: child))));
  await tester.pumpAndSettle();
}

Finder _photoIn(Finder of) => find.descendant(of: of, matching: find.byType(Image));

void main() {
  group('FacePhoto', () {
    testWidgets('draws the fallback when there is no photo', (tester) async {
      await _show(tester, const FacePhoto(photoUrl: null, size: 40, fallback: Text('AS')));
      expect(find.text('AS'), findsOneWidget);
      expect(find.byType(Image), findsNothing);

      await _show(tester, const FacePhoto(photoUrl: '  ', size: 40, fallback: Text('AS')));
      expect(find.text('AS'), findsOneWidget);
      expect(find.byType(Image), findsNothing);
    });

    testWidgets('draws the photo when there is one', (tester) async {
      await _show(tester, const FacePhoto(photoUrl: _photo, size: 40, fallback: Text('AS')));
      // The photo is drawn (its initials stand under it only until it has decoded).
      expect(find.byType(Image), findsOneWidget);
    });
  });

  testWidgets('a notification about someone wears their photo, the rest keep their icon', (tester) async {
    final now = DateTime.utc(2026, 11, 18, 12);
    Map<String, dynamic> row(String id, String title, {String? photo}) => {
      'id': id,
      'scenario': 'post_liked',
      'title': title,
      'body': '',
      'data': const <String, String>{},
      'createdAt': now.subtract(const Duration(minutes: 5)).toIso8601String(),
      'actorPhotoUrl': ?photo,
    };
    final client = MockClient((request) async {
      if (request.method == 'GET') {
        return http.Response.bytes(
          utf8.encode(jsonEncode({
            'success': true,
            'notifications': [
              row('n1', 'Ravi liked your post', photo: _photo),
              row('n2', 'Meera liked your post'),
            ],
          })),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }
      return http.Response('{"success":true}', 200);
    });
    tester.view.physicalSize = const Size(1179, 6000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(home: NotificationInboxScreen(session: _session, client: client, now: () => now)),
    );
    await tester.pumpAndSettle();

    expect(_photoIn(find.byKey(const ValueKey('notification-n1'))), findsOneWidget);
    expect(_photoIn(find.byKey(const ValueKey('notification-n2'))), findsNothing);
  });

  group('Hint Relay', () {
    test('the roster, the lead and the card carry faces', () {
      final mate = RelayTeammate.fromJson({'name': 'Ravi', 'photoUrl': '/media/a?w=256'});
      expect(mate.photoUrl, '/media/a?w=256');
      expect(RelayTeammate.fromJson({'name': 'Meera', 'photoUrl': null}).photoUrl, isNull);

      final card = RelayCard.fromJson({
        'event': {'title': 'Relay', 'status': 'finished'},
        'team': {
          'name': 'Owls',
          'members': [
            {'name': 'Ravi', 'isLeader': true, 'photoUrl': '/media/a?w=256'},
            {'name': 'Meera', 'photoUrl': null},
          ],
        },
      });
      expect(card.members.map((m) => m.photoUrl), ['/media/a?w=256', null]);
    });

    testWidgets('a face shows the photo, an initial without one', (tester) async {
      await _show(tester, const RelayInitial(name: 'Ravi', size: 40, fontSize: 16, photoUrl: _photo));
      // The photo is drawn (its initials stand under it only until it has decoded).
      expect(find.byType(Image), findsOneWidget);

      await _show(tester, const RelayInitial(name: 'Ravi', size: 40, fontSize: 16));
      expect(find.byType(Image), findsNothing);
      expect(find.text('R'), findsOneWidget);
    });
  });

  test('the games home keeps each playing-now face beside its initials', () {
    final now = PlayingNow.fromJson({
      'count': 3,
      'people': [
        {'userId': 'a', 'name': 'Ravi', 'initials': 'R', 'photoUrl': '/media/a?w=256'},
        {'userId': 'b', 'name': '', 'initials': ''},
        {'userId': 'c', 'name': 'Meera', 'initials': 'M', 'photoUrl': null},
      ],
    });
    expect(now.initials, ['R', 'M']);
    expect(now.photoUrls, ['/media/a?w=256', null]);
  });

  test('a web game leaderboard hands the page each player’s face', () {
    final board = GameLeaderboard.fromJson({
      'leaderboard': [
        {'rank': 1, 'userId': 'a', 'playerName': 'Ravi', 'score': 9, 'photoUrl': '/media/a?w=256'},
        {'rank': 2, 'userId': 'b', 'playerName': 'Meera', 'score': 7, 'photoUrl': null},
      ],
    });
    final entries = board.toPageJson(company: 'Sowaka')['entries'] as List;
    expect((entries[0] as Map)['photoUrl'], '/media/a?w=256');
    expect((entries[1] as Map).containsKey('photoUrl'), isFalse);
  });

  group('Lifecycle', () {
    test('notes, starter tasks and intro comments carry faces', () {
      expect(OneOnOneNote.fromJson({'id': 'n', 'text': 'Hi', 'authorPhotoUrl': '/faces/m?v=1&s=x'}).authorPhotoUrl, '/faces/m?v=1&s=x');
      expect(StarterTask.fromJson({'id': 't', 'assignedByPhotoUrl': '/media/m?w=256'}).assignedByPhotoUrl, '/media/m?w=256');
      final intro = IntroPost.fromJson({
        'comments': [
          {'name': 'Ravi', 'text': 'Welcome!', 'photoUrl': '/media/a?w=256'},
          {'name': 'Meera', 'text': 'Hi'},
        ],
      });
      expect(intro.comments.map((c) => c.photoUrl), ['/media/a?w=256', null]);
      expect(OffboardingPageData.fromJson({'managerName': 'Neha', 'managerPhotoUrl': '/media/n?w=256'}).managerPhotoUrl, '/media/n?w=256');
    });

    testWidgets('an offboarding avatar shows the photo, initials without one', (tester) async {
      await _show(tester, const OffAvatar('NR', photoUrl: _photo));
      // The photo is drawn (its initials stand under it only until it has decoded).
      expect(find.byType(Image), findsOneWidget);

      await _show(tester, const OffAvatar('NR'));
      expect(find.byType(Image), findsNothing);
      expect(find.text('NR'), findsOneWidget);
    });
  });
}
