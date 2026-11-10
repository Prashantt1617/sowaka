// A picture poll (Figma "Poll updated", 4610:23636): each option is its
// picture with its name on it, and after a vote its share. A tap on a picture
// opens it over the feed (node 4607:23605) with its name, its votes and a Vote
// button — the vote is cast from in there, never by a tap on the card — and
// two fingers on a picture lift it out to zoom without opening or voting.
// Words-only options keep their bars, a tap on one voting, with each share's
// count beside it. A poll has no likes or comments.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

/// A one-pixel PNG as a `data:` URI, which the card decodes in place rather
/// than fetching.
const _picture =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

Map<String, dynamic> _poll({
  String? selected,
  bool pictures = true,
  Map<String, int> votes = const {'a': 1, 'b': 0, 'c': 1, 'd': 1},
}) => {
  'id': 'poll',
  'type': 'survey',
  'tag': 'Poll',
  'author': {'userId': 'author', 'name': 'Author', 'initials': 'A'},
  'audience': {'label': 'Public'},
  'body': {
    'question': 'Friday game?',
    'options': [
      for (final (id, label) in const [
        ('a', 'musical chairs'),
        ('b', 'truth and dare'),
        ('c', 'Cricket'),
        ('d', 'vollyball'),
      ])
        {
          'id': id,
          'label': label,
          'votes': votes[id] ?? 0,
          if (pictures) 'imageUrl': _picture,
        },
    ],
    'totalVotes': votes.values.fold(0, (sum, n) => sum + n),
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

class _Feed {
  _Feed(this.bloc, this.votes);

  final ConnectBloc bloc;

  /// The options a vote was sent for, each answered when its completer is.
  final List<(String, Completer<http.Response>)> votes;
}

Future<_Feed> _pumpFeed(WidgetTester tester, Map<String, dynamic> poll) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final votes = <(String, Completer<http.Response>)>[];
  final client = MockClient((request) async {
    if (request.url.path.endsWith('/connect/posts/poll/actions')) {
      final reply = Completer<http.Response>();
      votes.add((jsonDecode(request.body)['optionId'] as String, reply));
      return reply.future;
    }
    if (request.url.path.endsWith('/connect/feed')) {
      return _ok({
        'posts': [poll],
      });
    }
    return _ok({});
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
      theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
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
  return _Feed(bloc, votes);
}

/// The faces the app sets these screens in, so text takes the room it takes
/// on a phone rather than the test font's wider square glyphs.
Future<void> _loadFonts() async {
  for (final (family, file) in [
    (
      'Plus Jakarta Sans',
      'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf',
    ),
    ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
  ]) {
    await (FontLoader(family)..addFont(rootBundle.load(file))).load();
  }
}

/// Lets a route come or go.
Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

/// Takes the feed down before the test ends.
Future<void> _tearDown(WidgetTester tester, ConnectBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
}

/// Two fingers down either side of [target]'s middle and drawn apart, a
/// step at a time; left down unless [release].
Future<(TestGesture, TestGesture)> _pinchOut(
  WidgetTester tester,
  Finder target, {
  bool release = true,
}) async {
  final middle = tester.getCenter(target);
  final left = await tester.startGesture(middle - const Offset(20, 0));
  final right = await tester.startGesture(middle + const Offset(20, 0));
  await tester.pump();
  for (var step = 0; step < 6; step++) {
    await left.moveBy(const Offset(-15, 0));
    await right.moveBy(const Offset(15, 0));
    await tester.pump();
  }
  if (release) {
    await left.up();
    await right.up();
    await tester.pump();
  }
  return (left, right);
}

Finder _picture0f(String id) => find.byKey(ValueKey('poll-option-image-$id'));
final _overlay = find.byKey(const ValueKey('pinch-zoom-overlay'));
final _viewer = find.byKey(const ValueKey('poll-option-viewer'));
final _voteButton = find.byKey(const ValueKey('poll-option-vote'));
final _close = find.byKey(const ValueKey('poll-option-viewer-close'));

/// [text] inside the open picture, not on the card behind it.
Finder _inViewer(String text) =>
    find.descendant(of: _viewer, matching: find.text(text));

/// Opens option [id]'s picture from the card.
Future<void> _open(WidgetTester tester, String id) async {
  await tester.ensureVisible(_picture0f(id));
  await tester.pump();
  await tester.tap(_picture0f(id));
  await _settle(tester);
}

void main() {
  setUpAll(_loadFonts);

  testWidgets('each picture option shows its share once the viewer has voted', (
    tester,
  ) async {
    final feed = await _pumpFeed(tester, _poll(selected: 'a'));
    await tester.ensureVisible(find.text('3 total votes'));
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('33%'), findsNWidgets(3));
    expect(find.text('0%'), findsOneWidget);
    expect(find.textContaining('vote'), findsOneWidget, reason: 'the total');
    // A poll takes votes only: no like or comment bar, no comment box.
    expect(find.bySemanticsLabel('Like'), findsNothing);
    expect(find.bySemanticsLabel('Comments'), findsNothing);
    expect(find.byType(TextField), findsNothing);

    await _tearDown(tester, feed.bloc);
  });

  testWidgets('no share shows on a picture option before a vote', (
    tester,
  ) async {
    final feed = await _pumpFeed(tester, _poll());
    await tester.ensureVisible(find.text('3 total votes'));
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.textContaining('%'), findsNothing);
    expect(find.text('Cricket'), findsOneWidget);

    await _tearDown(tester, feed.bloc);
  });

  testWidgets('each words-only option shows its votes beside its share', (
    tester,
  ) async {
    final feed = await _pumpFeed(
      tester,
      _poll(
        selected: 'a',
        pictures: false,
        votes: const {'a': 2, 'b': 0, 'c': 1, 'd': 1},
      ),
    );
    await tester.ensureVisible(find.text('4 total votes'));
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('50%'), findsOneWidget);
    expect(find.text('2 votes'), findsOneWidget);
    expect(find.text('1 vote'), findsNWidgets(2));
    expect(find.text('0 votes'), findsOneWidget);

    await _tearDown(tester, feed.bloc);
  });

  testWidgets('a tap on a words-only option still votes on the card', (
    tester,
  ) async {
    final feed = await _pumpFeed(tester, _poll(pictures: false));
    await tester.ensureVisible(find.text('Cricket'));
    await tester.pump();

    await tester.tap(find.text('Cricket'));
    await _settle(tester);
    expect(feed.votes.map((vote) => vote.$1), ['c']);
    expect(_viewer, findsNothing);

    feed.votes.single.$2.complete(
      _ok({
        'post': _poll(
          selected: 'c',
          pictures: false,
          votes: const {'a': 1, 'b': 0, 'c': 2, 'd': 1},
        ),
      }),
    );
    await _settle(tester);
    await _tearDown(tester, feed.bloc);
  });

  testWidgets('a tap on a picture opens it with its votes and a Vote button, '
      'and does not vote', (tester) async {
    final feed = await _pumpFeed(tester, _poll());
    await _open(tester, 'c');

    expect(_viewer, findsOneWidget);
    expect(_inViewer('Cricket'), findsOneWidget);
    expect(_inViewer('1 vote'), findsOneWidget);
    expect(_inViewer('Vote'), findsOneWidget);
    expect(feed.votes, isEmpty);
    expect(feed.bloc.state.posts.single.selectedPollOptionId, isNull);

    // The close button puts it away, and nothing was voted.
    await tester.tap(_close);
    await _settle(tester);
    expect(_viewer, findsNothing);
    expect(feed.votes, isEmpty);

    // So does a tap outside it.
    await _open(tester, 'a');
    expect(_viewer, findsOneWidget);
    await tester.tapAt(const Offset(10, 10));
    await _settle(tester);
    expect(_viewer, findsNothing);
    expect(feed.votes, isEmpty);
    expect(feed.bloc.state.posts.single.selectedPollOptionId, isNull);

    await _tearDown(tester, feed.bloc);
  });

  testWidgets('Vote inside the picture votes: its count steps up and the '
      'button reads Voted at once, and the card shows the shares', (
    tester,
  ) async {
    final feed = await _pumpFeed(tester, _poll());
    await _open(tester, 'b');
    expect(_inViewer('0 votes'), findsOneWidget);

    await tester.tap(_voteButton);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(feed.votes.map((vote) => vote.$1), ['b']);
    expect(feed.bloc.state.posts.single.selectedPollOptionId, 'b');
    expect(_inViewer('Voted'), findsOneWidget);
    expect(_inViewer('1 vote'), findsOneWidget);
    // The card behind has the vote too.
    expect(find.text('4 total votes'), findsOneWidget);
    expect(find.text('25%'), findsNWidgets(4));

    // The server agrees; the picture keeps its voted look.
    feed.votes.single.$2.complete(
      _ok({
        'post': _poll(
          selected: 'b',
          votes: const {'a': 1, 'b': 1, 'c': 1, 'd': 1},
        ),
      }),
    );
    await _settle(tester);
    expect(_inViewer('Voted'), findsOneWidget);
    expect(_inViewer('1 vote'), findsOneWidget);

    // Voted takes no more taps: a second one sends nothing.
    await tester.tap(_voteButton);
    await _settle(tester);
    expect(feed.votes, hasLength(1));

    await tester.tap(_close);
    await _settle(tester);
    expect(_viewer, findsNothing);
    expect(find.text('25%'), findsNWidgets(4));

    await _tearDown(tester, feed.bloc);
  });

  testWidgets('voting from another picture moves the vote', (tester) async {
    final feed = await _pumpFeed(tester, _poll(selected: 'a'));
    await _open(tester, 'a');
    expect(_inViewer('Voted'), findsOneWidget);
    await tester.tap(_close);
    await _settle(tester);

    await _open(tester, 'd');
    expect(_inViewer('Vote'), findsOneWidget);
    expect(_inViewer('1 vote'), findsOneWidget);
    await tester.tap(_voteButton);
    await _settle(tester);

    expect(feed.votes.map((vote) => vote.$1), ['d']);
    expect(_inViewer('Voted'), findsOneWidget);
    expect(_inViewer('2 votes'), findsOneWidget);
    final post = feed.bloc.state.posts.single;
    expect(post.pollOptions.firstWhere((o) => o.id == 'a').votes, 0);
    expect(post.totalVotes, 3);

    feed.votes.single.$2.complete(
      _ok({
        'post': _poll(
          selected: 'd',
          votes: const {'a': 0, 'b': 0, 'c': 1, 'd': 2},
        ),
      }),
    );
    await _settle(tester);
    await _tearDown(tester, feed.bloc);
  });

  testWidgets('a vote that fails comes off in the picture again', (
    tester,
  ) async {
    final feed = await _pumpFeed(tester, _poll());
    await _open(tester, 'c');
    await tester.tap(_voteButton);
    await _settle(tester);
    expect(_inViewer('Voted'), findsOneWidget);
    expect(_inViewer('2 votes'), findsOneWidget);

    feed.votes.single.$2.complete(http.Response('{"success":false}', 500));
    await _settle(tester);
    await _settle(tester);

    expect(feed.bloc.state.posts.single.selectedPollOptionId, isNull);
    expect(_inViewer('Vote'), findsOneWidget);
    expect(_inViewer('1 vote'), findsOneWidget);

    await _tearDown(tester, feed.bloc);
  });

  testWidgets('two fingers on a picture lift it out to zoom; they neither '
      'open it nor vote', (tester) async {
    final feed = await _pumpFeed(tester, _poll());
    await tester.ensureVisible(_picture0f('a'));
    await tester.pump();
    expect(_overlay, findsNothing);

    final (left, right) = await _pinchOut(
      tester,
      _picture0f('a'),
      release: false,
    );
    expect(_overlay, findsOneWidget);
    expect(feed.votes, isEmpty);

    await left.up();
    await right.up();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(_overlay, findsNothing);
    expect(_viewer, findsNothing);
    expect(feed.votes, isEmpty);
    expect(feed.bloc.state.posts.single.selectedPollOptionId, isNull);

    await _tearDown(tester, feed.bloc);
  });
}
