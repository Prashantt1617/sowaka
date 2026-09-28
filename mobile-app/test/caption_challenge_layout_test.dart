// A contest card carries whatever question the organiser typed. A long one
// used to push the Leaderboard link off the card: "Whose reaction is like
// this?" overflowed a phone by 47 pixels, and the feed drew the yellow and
// black overflow stripe over the post.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/bloc/connect_bloc.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/connect/presentation/connect_feed_screen.dart';

Map<String, dynamic> captionPost(String title) => {
  'id': 'post-1',
  'type': 'caption_challenge',
  'tag': 'Caption Challenge',
  'author': {'name': 'Sowaka Engagement', 'initials': 'SE'},
  'audience': <String, dynamic>{},
  'body': {
    'title': title,
    'brief': "Who reacts like this when it's Friday?",
    'pointsPerVote': 10,
    'entries': <dynamic>[],
  },
  'likeCount': 0,
  'commentCount': 0,
  'comments': <dynamic>[],
  'publishedAt': '2026-09-28T06:00:00.000Z',
};

void main() {
  testWidgets('a long contest question does not overflow the card', (
    tester,
  ) async {
    // A narrow phone, so the title and the Leaderboard link are tight.
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    final client = MockClient((request) async {
      if (request.url.path.endsWith('/connect/feed')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'posts': [
              captionPost('Whose reaction is like this?'),
              captionPost(
                'Whose reaction is like this one here on a Friday evening?',
              ),
            ],
          }),
          200,
        );
      }
      return http.Response(jsonEncode({'success': true}), 200);
    });

    final session = AuthSession(
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
    final bloc = ConnectBloc(
      session: session,
      api: ConnectApiService(
        session: session,
        baseUrl: 'https://example.test',
        client: client,
      ),
    );
    await bloc.load();

    // Overflow is reported as a framework error, so they are collected here
    // and inspected. Other noise (a semantics assertion the framework raises
    // while laying this tree out in a test) is ignored on purpose.
    final errors = <String>[];
    final previousOnError = FlutterError.onError;
    FlutterError.onError = (details) => errors.add(details.exceptionAsString());
    addTearDown(() => FlutterError.onError = previousOnError);

    await tester.pumpWidget(
      MaterialApp(
        // The shell supplies the Scaffold in the app; the screen is only the
        // feed itself.
        home: Scaffold(
          body: ConnectFeedScreen(
            session: session,
            profileAction: const SizedBox.shrink(),
            bloc: bloc,
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 300));

    final texts = tester
        .widgetList<Text>(find.byType(Text))
        .map((t) => t.data ?? '')
        .where((s) => s.isNotEmpty)
        .toList();
    final overflows = errors.where((e) => e.contains('overflowed')).toList();

    await tester.pumpWidget(const SizedBox.shrink());
    bloc.dispose();

    expect(
      texts,
      contains('Whose reaction is like this one here on a Friday evening?'),
      reason: 'the contest card should be on screen: $texts',
    );
    expect(overflows, isEmpty, reason: overflows.join('\n'));
  });
}
