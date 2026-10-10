// The feed's own bookkeeping: a double-tap that only ever likes, a failed
// guess that undoes only itself, a post opened from a notification that a
// refresh does not take away, a publishing placeholder no other request can
// clear, and an entry that says when it did not go.
import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/bloc/connect_bloc.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/connect/data/connect_models.dart';
import 'package:mobile_app/features/connect/data/connect_socket_service.dart';

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

/// The device's copy of the feed, with the live page never arriving.
class _CachedFeedApi extends ConnectApiService {
  _CachedFeedApi(this.cached, {required super.client})
    : super(session: _session, baseUrl: 'https://example.test');

  final List<ConnectPost> cached;

  @override
  Future<({List<ConnectPost> posts, String? nextCursor})?>
  fetchFeedFromCache() async => (posts: cached, nextCursor: null);

  @override
  Future<({List<ConnectPost> posts, String? nextCursor})> fetchFeed({
    int limit = 5,
    String? cursor,
  }) => Completer<({List<ConnectPost> posts, String? nextCursor})>().future;
}

Map<String, dynamic> _post(
  String id, {
  bool liked = false,
  int likeCount = 0,
  int commentCount = 0,
}) => {
  'id': id,
  'type': 'new_post',
  'tag': 'Post',
  'author': {'userId': 'author', 'name': 'Author', 'initials': 'A'},
  'audience': {'label': 'Public'},
  'body': {'text': 'Hello'},
  'liked': liked,
  'likeCount': likeCount,
  'commentCount': commentCount,
  'comments': <dynamic>[],
  'publishedAt': '2026-10-10T06:00:00.000Z',
};

http.Response _ok(Map<String, dynamic> json) =>
    http.Response(jsonEncode({'success': true, ...json}), 200);

http.Response _failed() =>
    http.Response(jsonEncode({'success': false, 'message': 'Nope'}), 500);

ConnectBloc _bloc(MockClient client) => ConnectBloc(
  session: _session,
  api: ConnectApiService(
    session: _session,
    baseUrl: 'https://example.test',
    client: client,
  ),
  socket: _QuietSocket(),
);

ConnectPost _only(ConnectBloc bloc, String id) =>
    bloc.state.posts.singleWhere((post) => post.id == id);

void main() {
  test('a double-tap the server reads as an unlike is liked back', () async {
    // Liked already, from another device; this feed does not know yet.
    var serverLiked = true;
    var reactions = 0;
    final bloc = _bloc(
      MockClient((request) async {
        if (request.url.path.endsWith('/reaction')) {
          reactions++;
          serverLiked = !serverLiked;
          return _ok({'post': _post('p1', liked: serverLiked, likeCount: 1)});
        }
        return _ok({
          'posts': [_post('p1')],
        });
      }),
    );
    addTearDown(bloc.dispose);
    await bloc.refresh();

    await bloc.likeFromDoubleTap('p1');

    expect(reactions, 2);
    expect(serverLiked, isTrue);
    expect(_only(bloc, 'p1').liked, isTrue);
  });

  test('a double-tap sends nothing on the device copy of the feed', () async {
    var reactions = 0;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/reaction')) reactions++;
      return _ok({'post': _post('p1', liked: true, likeCount: 1)});
    });
    final bloc = ConnectBloc(
      session: _session,
      api: _CachedFeedApi([ConnectPost.fromJson(_post('p1'))], client: client),
      socket: _QuietSocket(),
    );
    addTearDown(bloc.dispose);
    unawaited(bloc.load());
    await pumpEventQueue();
    expect(bloc.state.fromCache, isTrue);

    await bloc.likeFromDoubleTap('p1');

    expect(reactions, 0);
    expect(_only(bloc, 'p1').liked, isFalse);
  });

  test('a failed like undoes only itself, not a newer change', () async {
    final like = Completer<http.Response>();
    final bloc = _bloc(
      MockClient((request) async {
        if (request.url.path.endsWith('/reaction')) return like.future;
        if (request.url.path.endsWith('/comments')) {
          return _ok({'post': _post('p1', commentCount: 1)});
        }
        return _ok({
          'posts': [_post('p1')],
        });
      }),
    );
    addTearDown(bloc.dispose);
    await bloc.refresh();

    final liking = bloc.toggleReaction('p1');
    await bloc.addComment('p1', 'Nice');
    like.complete(_failed());
    await liking;

    // The server's copy after the comment stands; the failed like does not
    // put the post back to how it was before either.
    expect(_only(bloc, 'p1').commentCount, 1);
    expect(_only(bloc, 'p1').liked, isFalse);
  });

  test('a failed like on its own is undone', () async {
    final bloc = _bloc(
      MockClient((request) async {
        if (request.url.path.endsWith('/reaction')) return _failed();
        return _ok({
          'posts': [_post('p1')],
        });
      }),
    );
    addTearDown(bloc.dispose);
    await bloc.refresh();

    await bloc.toggleReaction('p1');

    expect(_only(bloc, 'p1').liked, isFalse);
    expect(_only(bloc, 'p1').likeCount, 0);
  });

  test('a post opened from a notification stays through a refresh', () async {
    final bloc = _bloc(
      MockClient((request) async {
        if (request.url.path.endsWith('/connect/posts/old')) {
          return _ok({'post': _post('old')});
        }
        return _ok({
          'posts': [_post('p1')],
        });
      }),
    );
    addTearDown(bloc.dispose);
    await bloc.refresh();

    expect(await bloc.ensurePost('old'), isTrue);
    await bloc.refresh();

    expect(bloc.state.posts.map((post) => post.id), ['old', 'p1']);
  });

  test('the publishing placeholder outlasts other requests', () async {
    final created = Completer<http.Response>();
    final bloc = _bloc(
      MockClient((request) async {
        if (request.url.path.endsWith('/connect/posts')) return created.future;
        if (request.url.path.endsWith('/captions/vote')) {
          return _ok({'post': _post('p1')});
        }
        return _ok({
          'posts': [_post('p1')],
        });
      }),
    );
    addTearDown(bloc.dispose);
    await bloc.refresh();

    final publishing = bloc.createPost(
      const ConnectPostDraft(
        type: ConnectPostType.newPost,
        body: {'text': 'Hi', 'sendTo': 'my_team'},
      ),
    );
    await pumpEventQueue();
    expect(bloc.state.publishing, 1);

    await bloc.voteCaption('p1', 'entry');
    expect(bloc.state.publishing, 1);
    expect(bloc.state.publishingTo, 'my_team');

    created.complete(_ok({'post': _post('new')}));
    expect(await publishing, isTrue);
    expect(bloc.state.publishing, 0);
    expect(bloc.state.publishingTo, isNull);
  });

  test('an entry that did not go says so', () async {
    var fail = true;
    final bloc = _bloc(
      MockClient((request) async {
        if (request.url.path.endsWith('/captions')) {
          return fail ? _failed() : _ok({'post': _post('p1')});
        }
        return _ok({
          'posts': [_post('p1')],
        });
      }),
    );
    addTearDown(bloc.dispose);
    await bloc.refresh();

    expect(await bloc.submitCaption('p1', 'A caption'), isFalse);
    fail = false;
    expect(await bloc.submitCaption('p1', 'A caption'), isTrue);
  });
}
