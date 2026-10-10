// A contest card counts down to its close — "END IN: 02:14" — and reads
// "Ended" once it has passed, closing the way in there and then rather than
// leaving a button the server would refuse.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/bloc/connect_bloc.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/connect/data/connect_socket_service.dart';
import 'package:mobile_app/features/connect/presentation/connect_feed_screen.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'viewer',
    email: 'viewer@example.test',
    name: 'Viewer',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    interests: [],
  ),
);

/// No live connection: the test lets time pass, and the real socket would
/// dial out when it did.
class _QuietSocket implements ConnectSocketService {
  @override
  Stream<ConnectChange> get changes => const Stream.empty();
  @override
  Stream<void> get reconnects => const Stream.empty();
  @override
  bool get isConnected => false;
  @override
  void connect() {}
  @override
  void dispose() {}
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Map<String, dynamic> _captionPost(DateTime closesAt) => {
  'id': 'post-1',
  'type': 'caption_challenge',
  'tag': 'Caption Challenge',
  'author': {'name': 'Sowaka Engagement', 'initials': 'SE'},
  'audience': <String, dynamic>{},
  'body': {
    'title': 'Caption this',
    'pointsPerVote': 10,
    'closesAt': closesAt.toUtc().toIso8601String(),
    'entries': <dynamic>[],
  },
  'likeCount': 0,
  'commentCount': 0,
  'comments': <dynamic>[],
  'publishedAt': '2026-10-10T06:00:00.000Z',
};

void main() {
  group('contestCountdownLabel', () {
    final now = DateTime.utc(2026, 10, 10, 12);

    test('hours and minutes left, as the design writes them', () {
      expect(
        contestCountdownLabel(
          now.add(const Duration(hours: 2, minutes: 14, seconds: 30)),
          now,
        ),
        'END IN: 02:14',
      );
    });

    test('counts whole minutes gone by, like a clock', () {
      expect(
        contestCountdownLabel(now.add(const Duration(seconds: 30)), now),
        'END IN: 00:00',
      );
      expect(
        contestCountdownLabel(now.add(const Duration(minutes: 1)), now),
        'END IN: 00:01',
      );
    });

    test('a contest days away keeps counting in hours', () {
      expect(
        contestCountdownLabel(
          now.add(const Duration(days: 2, hours: 4, minutes: 10)),
          now,
        ),
        'END IN: 52:10',
      );
    });

    test('reads Ended at and after the close', () {
      expect(contestCountdownLabel(now, now), 'Ended');
      expect(
        contestCountdownLabel(now.subtract(const Duration(hours: 3)), now),
        'Ended',
      );
    });

    test('says nothing for a contest with no closing time', () {
      expect(contestCountdownLabel(null, now), '');
    });
  });

  testWidgets('the card ticks down to Ended and closes the way in', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1179, 2556 * 2);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    // A few seconds to go: "END IN: 00:00" until it passes. Generous, since
    // the setup below runs on the real clock and a busy full test run is slow.
    final closesAt = DateTime.now().add(const Duration(seconds: 4));
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/connect/feed')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'posts': [_captionPost(closesAt)],
          }),
          200,
        );
      }
      return http.Response(jsonEncode({'success': true}), 200);
    });
    final bloc = ConnectBloc(
      session: _session,
      api: ConnectApiService(
        session: _session,
        baseUrl: 'https://example.test',
        client: client,
      ),
      socket: _QuietSocket(),
    );
    await bloc.load();

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ConnectFeedScreen(
            session: _session,
            profileAction: const SizedBox.shrink(),
            bloc: bloc,
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('END IN: 00:00'), findsOneWidget);
    expect(find.text('LIVE'), findsOneWidget);
    expect(find.text('Add your answer'), findsOneWidget);

    // The card reads the wall clock; let it pass the close for real, then
    // let the countdown's own timer fire.
    final untilClosed =
        closesAt.difference(DateTime.now()) + const Duration(milliseconds: 300);
    await tester.runAsync(
      () => Future<void>.delayed(
        untilClosed.isNegative ? Duration.zero : untilClosed,
      ),
    );
    // And the card's own timer, which runs on the test clock, past it too.
    await tester.pump(const Duration(seconds: 6));
    await tester.pump();

    expect(find.text('Ended'), findsOneWidget);
    expect(find.text('CLOSED'), findsOneWidget);
    expect(find.text('This contest has closed.'), findsOneWidget);
    expect(find.text('Add your answer'), findsNothing);

    await tester.pumpWidget(const SizedBox.shrink());
    bloc.dispose();
  });
}
