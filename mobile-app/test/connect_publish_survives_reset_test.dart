// A Connect tab picked afresh rebuilds the feed. A post still on its way up
// when that happens carries on: the new feed takes over the publish, shows
// the post when it lands, and says "Post published".
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
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

Finder _publishingCard() => find.byWidgetPredicate(
  (widget) =>
      widget is Semantics && widget.properties.label == 'Publishing your post',
);

const _existing = {
  'id': 'old',
  'type': 'new_post',
  'tag': 'New Post',
  'author': {'userId': 'a', 'name': 'Author', 'initials': 'A'},
  'audience': {'label': 'Public'},
  'body': {'text': 'Already here', 'postKind': 'text'},
  'liked': false,
  'likeCount': 0,
  'commentCount': 0,
  'comments': <dynamic>[],
  'publishedAt': '2026-10-11T06:00:00.000Z',
};

void main() {
  testWidgets('a post going up survives the feed being built afresh', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1179, 2556);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final publish = Completer<void>();
    var feedReads = 0;
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/connect/feed')) {
        feedReads++;
        return http.Response(
          jsonEncode({'success': true, 'posts': [_existing]}),
          200,
        );
      }
      if (request.method == 'POST' && path.endsWith('/connect/posts')) {
        await publish.future;
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({
            'success': true,
            'post': {
              'id': 'new',
              'type': 'new_post',
              'tag': 'New Post',
              'author': {'userId': 'viewer', 'name': 'Viewer', 'initials': 'V'},
              'audience': {'label': 'Public'},
              'body': {
                'text': (body['body'] as Map)['text'],
                'postKind': 'text',
              },
              'liked': false,
              'likeCount': 0,
              'commentCount': 0,
              'comments': <dynamic>[],
              'publishedAt': '2026-10-12T06:00:00.000Z',
            },
          }),
          201,
        );
      }
      return http.Response(jsonEncode({'success': true}), 200);
    });
    final api = ConnectApiService(
      session: _session,
      baseUrl: 'https://example.test',
      client: client,
    );
    final controller = ConnectComposerController();
    Widget feed(int reset) => MaterialApp(
      home: Scaffold(
        body: ConnectFeedScreen(
          key: ValueKey('connect-tab-$reset'),
          session: _session,
          profileAction: const SizedBox.shrink(),
          composerController: controller,
          api: api,
          socket: _QuietSocket(),
        ),
      ),
    );
    Future<void> settle() async {
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 200));
      }
    }

    await tester.pumpWidget(feed(0));
    await settle();
    await tester.tap(find.text('Start a post.....'));
    await settle();
    await tester.enterText(
      find.byKey(const ValueKey('quick-post-caption')),
      'Render review at 4',
    );
    await tester.pump();
    await tester.tap(find.text('Post'));
    await settle();
    expect(controller.isPublishing, isTrue);
    expect(_publishingCard(), findsOneWidget);

    // Picked afresh while it is on its way: the feed is built again, the
    // publish still showing on it.
    await tester.pumpWidget(feed(1));
    await settle();
    expect(_publishingCard(), findsOneWidget);
    expect(feedReads, 1, reason: 'the feed carried over, not read again');

    publish.complete();
    await settle();
    expect(find.text('Post published'), findsOneWidget);
    expect(find.text('Render review at 4'), findsOneWidget);
    expect(_publishingCard(), findsNothing);
    expect(controller.isPublishing, isFalse);

    await tester.pumpWidget(const SizedBox.shrink());
  });
}
