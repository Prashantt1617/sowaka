// A picture option shows how many votes it has instead of a share (words-only
// options keep their share, with the count beside it), and a poll has no likes
// or comments; a tap on an option votes, while two fingers on its picture
// lift it out to zoom without voting.
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

void main() {
  setUpAll(_loadFonts);

  testWidgets('each picture option shows its votes instead of a share', (
    tester,
  ) async {
    final feed = await _pumpFeed(tester, _poll(selected: 'a'));
    await tester.ensureVisible(find.text('3 total votes'));
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('1 vote'), findsNWidgets(3));
    expect(find.text('0 votes'), findsOneWidget);
    expect(find.textContaining('%'), findsNothing);
    // A poll takes votes only: no like or comment bar, no comment box.
    expect(find.bySemanticsLabel('Like'), findsNothing);
    expect(find.bySemanticsLabel('Comments'), findsNothing);
    expect(find.byType(TextField), findsNothing);

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

  testWidgets('a tap on a picture option votes, and its count moves at once', (
    tester,
  ) async {
    final feed = await _pumpFeed(tester, _poll());
    await tester.ensureVisible(_picture0f('b'));
    await tester.pump();
    expect(
      find.text('0 votes'),
      findsNothing,
      reason: 'no share before a vote',
    );

    await tester.tap(_picture0f('b'));
    // The shares count up over 380 ms once they appear.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(feed.votes.map((vote) => vote.$1), ['b']);
    expect(feed.bloc.state.posts.single.selectedPollOptionId, 'b');
    expect(find.text('4 total votes'), findsOneWidget);
    expect(find.text('1 vote'), findsNWidgets(4));
    expect(find.textContaining('%'), findsNothing);

    feed.votes.single.$2.complete(
      _ok({
        'post': _poll(
          selected: 'b',
          votes: const {'a': 1, 'b': 1, 'c': 1, 'd': 1},
        ),
      }),
    );
    await tester.pump(const Duration(milliseconds: 400));
    await _tearDown(tester, feed.bloc);
  });

  testWidgets('two fingers on a picture lift it out to zoom and do not vote', (
    tester,
  ) async {
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
    expect(feed.votes, isEmpty);
    expect(feed.bloc.state.posts.single.selectedPollOptionId, isNull);

    await _tearDown(tester, feed.bloc);
  });

  testWidgets('holding a picture opens nothing: pinching is the only zoom, '
      'and the hold is a plain tap', (tester) async {
    final feed = await _pumpFeed(tester, _poll());
    await tester.ensureVisible(_picture0f('c'));
    await tester.pump();

    await tester.longPress(_picture0f('c'));
    await _settle(tester);
    expect(find.byType(InteractiveViewer), findsNothing);
    expect(feed.votes.map((vote) => vote.$1), ['c']);
    feed.votes.single.$2.complete(
      _ok({
        'post': _poll(
          selected: 'c',
          votes: const {'a': 1, 'b': 0, 'c': 2, 'd': 1},
        ),
      }),
    );
    await _settle(tester);
    expect(find.text('2 votes'), findsOneWidget);

    await _tearDown(tester, feed.bloc);
  });
}
