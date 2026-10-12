// A poll vote shows the moment it is cast, the way a like does: the pick and
// the counts move before the request leaves, the server's copy replaces the
// guess, a failure falls back to the server's copy, and a change of mind
// while one is on its way shows at once and is sent next.
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

Map<String, dynamic> _poll({String? selected, int a = 3, int b = 1}) => {
  'id': 'poll',
  'type': 'survey',
  'tag': 'Poll',
  'author': {'userId': 'author', 'name': 'Author', 'initials': 'A'},
  'audience': {'label': 'Public'},
  'body': {
    'question': 'Lunch?',
    'options': [
      {'id': 'a', 'label': 'Pizza', 'votes': a},
      {'id': 'b', 'label': 'Thali', 'votes': b},
    ],
    'totalVotes': a + b,
  },
  'liked': false,
  'likeCount': 0,
  'commentCount': 0,
  'comments': <dynamic>[],
  'publishedAt': '2026-10-12T06:00:00.000Z',
  'selectedPollOptionId': selected,
};

http.Response _ok(Map<String, dynamic> json) =>
    http.Response(jsonEncode({'success': true, ...json}), 200);

int _votes(ConnectPost post, String id) =>
    post.pollOptions.singleWhere((option) => option.id == id).votes;

void main() {
  late Completer<http.Response> reply;
  late int votesSent;
  late Map<String, dynamic> feedPoll;
  late ConnectBloc bloc;

  setUp(() async {
    votesSent = 0;
    feedPoll = _poll();
    bloc = ConnectBloc(
      session: _session,
      api: ConnectApiService(
        session: _session,
        baseUrl: 'https://example.test',
        client: MockClient((request) async {
          if (request.url.path.endsWith('/connect/posts/poll/actions')) {
            votesSent++;
            reply = Completer<http.Response>();
            return reply.future;
          }
          return _ok({
            'posts': [feedPoll],
          });
        }),
      ),
      socket: _QuietSocket(),
    );
    await bloc.refresh();
  });

  tearDown(() => bloc.dispose());

  ConnectPost poll() => bloc.state.posts.single;

  test('a first vote shows at once, before the server answers', () async {
    final voting = bloc.performAction('poll', optionId: 'a');
    await Future<void>.delayed(Duration.zero);

    expect(poll().selectedPollOptionId, 'a');
    expect(_votes(poll(), 'a'), 4);
    expect(_votes(poll(), 'b'), 1);
    expect(poll().totalVotes, 5);
    expect(bloc.state.busyPostId, isNull, reason: 'nothing waits on the network');

    // Someone else voted meanwhile: the server's copy is what stays.
    reply.complete(_ok({'post': _poll(selected: 'a', a: 5, b: 1)}));
    await voting;
    expect(_votes(poll(), 'a'), 5);
    expect(poll().totalVotes, 6);
  });

  test('changing a vote moves it without adding a voter', () async {
    feedPoll = _poll(selected: 'a', a: 4, b: 1);
    await bloc.refresh();

    final voting = bloc.performAction('poll', optionId: 'b');
    await Future<void>.delayed(Duration.zero);

    expect(poll().selectedPollOptionId, 'b');
    expect(_votes(poll(), 'a'), 3);
    expect(_votes(poll(), 'b'), 2);
    expect(poll().totalVotes, 5);

    reply.complete(_ok({'post': _poll(selected: 'b', a: 3, b: 2)}));
    await voting;
  });

  test('a vote that fails is undone, and only that vote', () async {
    final voting = bloc.performAction('poll', optionId: 'a');
    await Future<void>.delayed(Duration.zero);
    expect(poll().selectedPollOptionId, 'a');

    reply.complete(
      http.Response(jsonEncode({'success': false, 'message': 'Nope'}), 500),
    );
    await voting;

    expect(poll().selectedPollOptionId, isNull);
    expect(_votes(poll(), 'a'), 3);
    expect(poll().totalVotes, 4);
  });

  test('a change of mind while a vote travels shows at once and is sent next', () async {
    final first = bloc.performAction('poll', optionId: 'a');
    await Future<void>.delayed(Duration.zero);
    await bloc.performAction('poll', optionId: 'b');

    // The second pick shows straight away; only one request is out.
    expect(poll().selectedPollOptionId, 'b');
    expect(_votes(poll(), 'a'), 3);
    expect(_votes(poll(), 'b'), 2);
    expect(votesSent, 1);

    // The first reply lands: it is never shown, and the latest pick goes next.
    reply.complete(_ok({'post': _poll(selected: 'a', a: 4, b: 1)}));
    for (var i = 0; i < 10 && votesSent < 2; i++) {
      await Future<void>.delayed(Duration.zero);
    }
    expect(votesSent, 2);
    expect(poll().selectedPollOptionId, 'b');

    reply.complete(_ok({'post': _poll(selected: 'b', a: 3, b: 2)}));
    await first;
    expect(poll().selectedPollOptionId, 'b');
    expect(_votes(poll(), 'b'), 2);
  });
}
