// Tapping a post's like count lists who liked it, as Instagram does: a sheet
// with their faces, names and departments, and each row opening that
// person's profile. The heart beside the count still likes the post.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/bloc/connect_bloc.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
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

Map<String, dynamic> _post({int likeCount = 2, bool liked = false}) => {
  'id': 'p1',
  'type': 'new_post',
  'tag': 'new_post',
  'author': {
    'userId': 'author-1',
    'name': 'Author One',
    'initials': 'AO',
    'designation': 'Designer',
  },
  'audience': {'label': 'Public'},
  'body': {'text': 'Team lunch on Friday', 'mediaKind': 'none'},
  'likeCount': likeCount,
  'liked': liked,
  'commentCount': 0,
  'comments': const [],
  'publishedAt': '2026-09-28T06:00:00.000Z',
};

const _riya = {
  'userId': 'riya',
  'name': 'Riya Sharma',
  'initials': 'RS',
  'designation': 'Product Manager',
  'department': 'Product',
  'avatarColor': '#4F8C89',
};
const _kabir = {
  'userId': 'kabir',
  'name': 'Kabir Shah',
  'initials': 'KS',
  'designation': 'Engineer',
  'department': 'Engineering',
  'avatarColor': '#8A6AA0',
};

class _Server {
  _Server({this.post, this.likes = const [_riya, _kabir]});

  Map<String, dynamic>? post;
  List<Map<String, Object>> likes;
  bool failLikes = false;
  final likeReads = <Uri>[];
  final reactions = <Uri>[];

  late final client = MockClient((request) async {
    final path = request.url.path;
    if (path.endsWith('/connect/feed')) {
      return http.Response(
        jsonEncode({
          'success': true,
          'posts': [post ?? _post()],
        }),
        200,
      );
    }
    if (path.endsWith('/connect/posts/p1/likes')) {
      likeReads.add(request.url);
      if (failLikes) {
        return http.Response(
          jsonEncode({'success': false, 'message': 'Down'}),
          500,
        );
      }
      return http.Response(jsonEncode({'success': true, 'likes': likes}), 200);
    }
    if (path.endsWith('/connect/posts/p1/reaction')) {
      reactions.add(request.url);
      final current = post ?? _post();
      final liked = !(current['liked'] as bool? ?? false);
      post = {
        ...current,
        'liked': liked,
        'likeCount': (current['likeCount'] as int) + (liked ? 1 : -1),
      };
      return http.Response(jsonEncode({'success': true, 'post': post}), 200);
    }
    return http.Response(jsonEncode({'success': true}), 200);
  });
}

Future<(List<String>, ConnectBloc)> _pumpFeed(
  WidgetTester tester,
  _Server server,
) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final bloc = ConnectBloc(
    session: _session,
    api: ConnectApiService(
      session: _session,
      baseUrl: 'https://example.test',
      client: server.client,
    ),
  );
  await bloc.load();
  final opened = <String>[];
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: ConnectFeedScreen(
          session: _session,
          profileAction: const SizedBox.shrink(),
          bloc: bloc,
          onOpenPerson: opened.add,
        ),
      ),
    ),
  );
  await tester.pump(const Duration(milliseconds: 300));
  return (opened, bloc);
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 4; i++) {
    await tester.pump(const Duration(milliseconds: 250));
  }
}

Future<void> _tearDown(WidgetTester tester, ConnectBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
}

final _count = find.byKey(const ValueKey('post-like-count'));
final _heart = find.byKey(const ValueKey('post-like-heart'));

void main() {
  testWidgets('tapping the like count lists who liked the post', (
    tester,
  ) async {
    final server = _Server();
    final (_, bloc) = await _pumpFeed(tester, server);
    await tester.tap(_count);
    await _settle(tester);

    expect(find.text('Likes'), findsOneWidget);
    // No search box; the department under each name, not the designation.
    expect(find.text('Search'), findsNothing);
    expect(find.byType(TextField), findsOneWidget, reason: 'only the comment box');
    expect(find.text('Riya Sharma'), findsOneWidget);
    expect(find.text('Product'), findsOneWidget);
    expect(find.text('Product Manager'), findsNothing);
    expect(find.text('Kabir Shah'), findsOneWidget);
    expect(find.text('Engineering'), findsOneWidget);
    // Latest like first, as the server sends them.
    expect(
      tester.getTopLeft(find.text('Riya Sharma')).dy,
      lessThan(tester.getTopLeft(find.text('Kabir Shah')).dy),
    );
    expect(server.likeReads, hasLength(1));
    await _tearDown(tester, bloc);
  });

  testWidgets('tapping a person closes the sheet and opens their profile', (
    tester,
  ) async {
    final server = _Server();
    final (opened, bloc) = await _pumpFeed(tester, server);
    await tester.tap(_count);
    await _settle(tester);
    await tester.tap(find.text('Kabir Shah'));
    await _settle(tester);

    expect(opened, ['kabir']);
    expect(find.text('Likes'), findsNothing);
    await _tearDown(tester, bloc);
  });

  testWidgets('tapping the heart likes the post and opens no list', (
    tester,
  ) async {
    final server = _Server();
    final (_, bloc) = await _pumpFeed(tester, server);
    await tester.tap(_heart);
    await _settle(tester);

    expect(server.reactions, hasLength(1));
    expect(server.likeReads, isEmpty);
    expect(find.text('Likes'), findsNothing);
    await _tearDown(tester, bloc);
  });

  testWidgets('a count of 0 opens nothing', (tester) async {
    final server = _Server(post: _post(likeCount: 0));
    final (_, bloc) = await _pumpFeed(tester, server);
    expect(
      find.descendant(of: _count, matching: find.text('0')),
      findsOneWidget,
    );
    await tester.tap(_count);
    await _settle(tester);

    expect(server.likeReads, isEmpty);
    expect(server.reactions, isEmpty);
    expect(find.text('Likes'), findsNothing);
    await _tearDown(tester, bloc);
  });

  testWidgets('a list that comes back empty says so', (tester) async {
    final server = _Server(likes: const []);
    final (_, bloc) = await _pumpFeed(tester, server);
    await tester.tap(_count);
    await _settle(tester);

    expect(find.text('No likes yet'), findsOneWidget);
    await _tearDown(tester, bloc);
  });

  testWidgets('a failed read offers Retry, which loads the list', (
    tester,
  ) async {
    final server = _Server()..failLikes = true;
    final (_, bloc) = await _pumpFeed(tester, server);
    await tester.tap(_count);
    await _settle(tester);

    expect(find.text("Couldn't load likes."), findsOneWidget);
    server.failLikes = false;
    await tester.tap(find.text('Retry'));
    await _settle(tester);
    expect(find.text('Riya Sharma'), findsOneWidget);
    expect(server.likeReads, hasLength(2));
    await _tearDown(tester, bloc);
  });

  testWidgets('a like while the list is open reads it again', (tester) async {
    final server = _Server();
    final (_, bloc) = await _pumpFeed(tester, server);
    await tester.tap(_count);
    await _settle(tester);
    expect(server.likeReads, hasLength(1));

    server.likes = const [
      {
        'userId': 'viewer',
        'name': 'Viewer',
        'initials': 'V',
        'designation': '',
        'avatarColor': '#BE5A36',
      },
      _riya,
      _kabir,
    ];
    await bloc.toggleReaction('p1');
    await _settle(tester);

    expect(server.likeReads.length, greaterThanOrEqualTo(2));
    expect(find.text('Viewer'), findsOneWidget);
    await _tearDown(tester, bloc);
  });
}
