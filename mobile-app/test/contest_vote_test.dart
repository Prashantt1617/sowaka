// A contest vote shows the moment it is cast, the way a like does: the entry
// fills and its votes and points move before the request leaves, tapping it
// again takes the vote back, a failure falls back to how it was, and a change
// of mind while one is on its way shows at once and is sent next.
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

Map<String, dynamic> _entry(String id, {int votes = 0, bool mine = false, bool voted = false}) => {
  'id': id,
  'userId': 'user-$id',
  'name': 'Person $id',
  'initials': id.toUpperCase(),
  'text': 'Caption $id',
  'votes': votes,
  'points': votes * 10,
  'votedByViewer': voted,
  'isMine': mine,
};

Map<String, dynamic> _contest({String? votedFor, int a = 3, int b = 1}) => {
  'id': 'contest',
  'type': 'caption_challenge',
  'tag': 'Caption Challenge',
  'author': {'userId': 'author', 'name': 'Sowaka Engagement', 'initials': 'SE'},
  'audience': {'label': 'Public'},
  'body': {
    'title': 'Caption this',
    'pointsPerVote': 10,
    'closesAt': DateTime.now().add(const Duration(days: 1)).toUtc().toIso8601String(),
    'entries': [
      _entry('a', votes: a, voted: votedFor == 'a'),
      _entry('b', votes: b, voted: votedFor == 'b'),
    ],
  },
  'liked': false,
  'likeCount': 0,
  'commentCount': 0,
  'comments': <dynamic>[],
  'publishedAt': '2026-10-12T06:00:00.000Z',
};

http.Response _ok(Map<String, dynamic> json) =>
    http.Response(jsonEncode({'success': true, ...json}), 200);

ConnectCaptionEntry _e(ConnectPost post, String id) =>
    post.captionEntries.singleWhere((entry) => entry.id == id);

void main() {
  late Completer<http.Response> reply;
  late List<String> sent;
  late Map<String, dynamic> feedContest;
  late ConnectBloc bloc;

  setUp(() async {
    sent = [];
    feedContest = _contest();
    bloc = ConnectBloc(
      session: _session,
      api: ConnectApiService(
        session: _session,
        baseUrl: 'https://example.test',
        client: MockClient((request) async {
          if (request.method == 'POST' && request.url.path.contains('/connect/posts/contest/')) {
            sent.add(request.url.path.split('/').last);
            reply = Completer<http.Response>();
            return reply.future;
          }
          return _ok({
            'posts': [feedContest],
          });
        }),
      ),
      socket: _QuietSocket(),
    );
    await bloc.refresh();
  });

  tearDown(() => bloc.dispose());

  ConnectPost contest() => bloc.state.posts.single;

  test('a vote shows at once, before the server answers', () async {
    final voting = bloc.voteCaption('contest', 'a');
    await Future<void>.delayed(Duration.zero);

    expect(_e(contest(), 'a').votedByViewer, isTrue);
    expect(_e(contest(), 'a').votes, 4);
    expect(_e(contest(), 'a').points, 40);
    expect(bloc.state.busyPostId, isNull, reason: 'nothing waits on the network');

    reply.complete(_ok({'post': _contest(votedFor: 'a', a: 5)}));
    await voting;
    expect(_e(contest(), 'a').votes, 5, reason: "the server's copy is what stays");
  });

  test('voting for another entry moves the vote', () async {
    feedContest = _contest(votedFor: 'a', a: 4);
    await bloc.refresh();

    final voting = bloc.voteCaption('contest', 'b');
    await Future<void>.delayed(Duration.zero);
    expect(_e(contest(), 'a').votedByViewer, isFalse);
    expect(_e(contest(), 'a').votes, 3);
    expect(_e(contest(), 'b').votedByViewer, isTrue);
    expect(_e(contest(), 'b').votes, 2);

    reply.complete(_ok({'post': _contest(votedFor: 'b', a: 3, b: 2)}));
    await voting;
  });

  test('tapping the entry already voted for takes the vote back', () async {
    feedContest = _contest(votedFor: 'a', a: 4);
    await bloc.refresh();

    final voting = bloc.voteCaption('contest', 'a');
    await Future<void>.delayed(Duration.zero);
    expect(_e(contest(), 'a').votedByViewer, isFalse);
    expect(_e(contest(), 'a').votes, 3);

    reply.complete(_ok({'post': _contest(a: 3)}));
    await voting;
    expect(contest().myContestVote, isNull);
  });

  test('a vote that fails goes back to how it was', () async {
    final voting = bloc.voteCaption('contest', 'a');
    await Future<void>.delayed(Duration.zero);
    expect(_e(contest(), 'a').votedByViewer, isTrue);

    reply.complete(http.Response(jsonEncode({'success': false, 'message': 'Closed'}), 400));
    await voting;
    expect(contest().myContestVote, isNull);
    expect(_e(contest(), 'a').votes, 3);
  });

  test('a change of mind while a vote travels shows at once and is sent next', () async {
    final first = bloc.voteCaption('contest', 'a');
    await Future<void>.delayed(Duration.zero);
    await bloc.voteCaption('contest', 'b');

    expect(contest().myContestVote, 'b');
    expect(sent.length, 1);

    reply.complete(_ok({'post': _contest(votedFor: 'a', a: 4)}));
    for (var i = 0; i < 10 && sent.length < 2; i++) {
      await Future<void>.delayed(Duration.zero);
    }
    expect(sent.length, 2);
    expect(contest().myContestVote, 'b', reason: 'the first answer is never shown');

    reply.complete(_ok({'post': _contest(votedFor: 'b', a: 3, b: 2)}));
    await first;
    expect(contest().myContestVote, 'b');
  });
}
