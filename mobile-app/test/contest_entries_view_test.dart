// The contest's entries page: a tap on an entry opens it full screen as its
// whole card — the cross, the dimmed backdrop and a swipe down put it away,
// a swipe across goes to the next entry, and a vote cast there shows at once
// there and on the page. The "Add your answer" button stays pinned at the
// foot of the page while the entries scroll, until the viewer has entered.
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

Map<String, dynamic> _entry(
  String id, {
  int votes = 0,
  bool mine = false,
  bool voted = false,
}) => {
  'id': id,
  'userId': 'user-$id',
  'name': 'Person $id',
  'initials': id.toUpperCase(),
  'text': 'Caption $id',
  'votes': votes,
  'points': votes * 10,
  'votedByViewer': voted,
  'isMine': mine,
  'createdAt': '2026-10-12T06:00:00.000Z',
};

/// A caption contest as the server sends it: the entries in the order they
/// went in, and the same entries ranked by votes on the leaderboard.
Map<String, dynamic> _contest(
  List<Map<String, dynamic>> entries, {
  String? myEntryId,
  String? myVoteEntryId,
  String type = 'caption_challenge',
  String title = 'Caption this',
}) {
  final ranked = [...entries]
    ..sort((a, b) => (b['votes'] as int).compareTo(a['votes'] as int));
  return {
    'id': 'contest',
    'type': type,
    'tag': 'Caption Challenge',
    'author': {
      'userId': 'author',
      'name': 'Sowaka Engagement',
      'initials': 'SE',
    },
    'audience': {'label': 'Public'},
    'body': {
      'title': title,
      'pointsPerVote': 10,
      'closesAt': DateTime.now()
          .add(const Duration(days: 1))
          .toUtc()
          .toIso8601String(),
      'entries': entries,
      'leaderboard': [
        for (final (index, entry) in ranked.indexed)
          {...entry, 'rank': index + 1},
      ],
      'myEntryId': myEntryId,
      'myVoteEntryId': myVoteEntryId,
    },
    'liked': false,
    'likeCount': 0,
    'commentCount': 0,
    'comments': <dynamic>[],
    'publishedAt': '2026-10-12T06:00:00.000Z',
  };
}

http.Response _ok(Map<String, dynamic> json) =>
    http.Response(jsonEncode({'success': true, ...json}), 200);

class _Feed {
  _Feed(this.bloc, this.votes);

  final ConnectBloc bloc;

  /// The entries a vote was sent for, each answered when its completer is.
  final List<(String, Completer<http.Response>)> votes;
}

Future<_Feed> _pumpFeed(
  WidgetTester tester,
  Map<String, dynamic> contest, {
  Size size = const Size(1179, 2556),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final votes = <(String, Completer<http.Response>)>[];
  final client = MockClient((request) async {
    if (request.url.path.endsWith('/captions/vote')) {
      final reply = Completer<http.Response>();
      votes.add((jsonDecode(request.body)['entryId'] as String, reply));
      return reply.future;
    }
    if (request.url.path.endsWith('/connect/feed')) {
      return _ok({
        'posts': [contest],
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

Future<void> _openEntries(WidgetTester tester) async {
  await tester.ensureVisible(find.text('View Entries'));
  await tester.pump();
  await tester.tap(find.text('View Entries'));
  await _pageTransition(tester);
  expect(find.text('Leaderboard'), findsOneWidget);
}

/// Lets the entries page come or go, the platform's page transition and all.
Future<void> _pageTransition(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 600));
  await tester.pump(const Duration(milliseconds: 600));
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

/// Lets a route come or go: the page's motion is 280 ms.
Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

/// Takes the feed down before the test ends.
Future<void> _tearDown(WidgetTester tester, ConnectBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
}

final _view = find.byKey(const ValueKey('entry-view'));
Finder _inView(Finder finder) => find.descendant(of: _view, matching: finder);

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

Future<void> _doubleTap(WidgetTester tester, Finder target) async {
  await tester.tap(target, warnIfMissed: false);
  await tester.pump(const Duration(milliseconds: 80));
  await tester.tap(target, warnIfMissed: false);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

final _zoom = find.descendant(
  of: find.byKey(const ValueKey('entry-view')),
  matching: find.byType(InteractiveViewer),
);

double _zoomScale(WidgetTester tester) => tester
    .widget<InteractiveViewer>(_zoom)
    .transformationController!
    .value
    .getMaxScaleOnAxis();

void main() {
  setUpAll(_loadFonts);

  testWidgets('a tap on an entry opens it full screen; the cross, the '
      'backdrop and a swipe down put it away', (tester) async {
    final feed = await _pumpFeed(
      tester,
      _contest([
        _entry('a', votes: 3),
        _entry('b', votes: 2),
        _entry('c', votes: 1),
      ]),
    );
    await _openEntries(tester);
    expect(_view, findsNothing);

    // The caption's body opens it, at its place in the order.
    await tester.tap(find.text('Caption b'));
    await _settle(tester);
    expect(_view, findsOneWidget);
    expect(_inView(find.text('“Caption b')), findsOneWidget);
    expect(_inView(find.text('Person b')), findsOneWidget);
    expect(_inView(find.text('20 pts')), findsOneWidget);
    expect(_inView(find.text('2 of 3')), findsOneWidget);

    // A swipe across goes to the next entry in the board's order.
    await tester.drag(_inView(find.byType(PageView)), const Offset(-300, 0));
    await _settle(tester);
    await _settle(tester);
    expect(_inView(find.text('“Caption c')), findsOneWidget);
    expect(_inView(find.text('3 of 3')), findsOneWidget);

    // The cross puts it away, leaving the page as it was.
    await tester.tap(find.byKey(const ValueKey('entry-view-close')));
    await _settle(tester);
    expect(_view, findsNothing);
    expect(find.text('Leaderboard'), findsOneWidget);

    // So does a tap on the dimmed backdrop beside the card…
    await tester.tap(find.text('Caption a'));
    await _settle(tester);
    expect(_inView(find.text('“Caption a')), findsOneWidget);
    await tester.tap(_inView(find.text('“Caption a')));
    await _settle(tester);
    expect(_view, findsOneWidget, reason: 'a tap on the card keeps it open');
    await tester.tapAt(const Offset(6, 600));
    await _settle(tester);
    expect(_view, findsNothing);

    // …and a swipe down.
    await tester.tap(find.text('Caption a'));
    await _settle(tester);
    expect(_view, findsOneWidget);
    await tester.drag(_inView(find.byType(PageView)), const Offset(0, 300));
    await _settle(tester);
    expect(_view, findsNothing);

    await _tearDown(tester, feed.bloc);
  });

  testWidgets('a vote in the full view shows at once there and on the page', (
    tester,
  ) async {
    final feed = await _pumpFeed(
      tester,
      _contest([_entry('a', votes: 3), _entry('b', votes: 1)]),
    );
    await _openEntries(tester);
    await tester.tap(find.text('Caption b'));
    await _settle(tester);
    expect(_inView(find.text('10 pts')), findsOneWidget);
    expect(find.text('Your vote'), findsNothing);

    await tester.tap(_inView(find.text('vote')));
    await tester.pump();

    // Before the server answers, the vote is on the entry in both views.
    expect(feed.votes.map((vote) => vote.$1), ['b']);
    expect(_inView(find.text('20 pts')), findsOneWidget);
    expect(_inView(find.text('Your vote')), findsOneWidget);
    expect(_inView(find.text('votes')), findsOneWidget);
    expect(_inView(find.text('vote')), findsNothing);
    expect(
      find.text('Your vote'),
      findsNWidgets(2),
      reason: 'the page under it has the vote too',
    );

    // The server's copy agrees, and stays.
    feed.votes.single.$2.complete(
      _ok({
        'post': _contest([
          _entry('a', votes: 3),
          _entry('b', votes: 2, voted: true),
        ], myVoteEntryId: 'b'),
      }),
    );
    await tester.pump();
    await tester.pump();
    expect(_inView(find.text('20 pts')), findsOneWidget);
    expect(find.text('Your vote'), findsNWidgets(2));

    await tester.tap(find.byKey(const ValueKey('entry-view-close')));
    await _settle(tester);
    expect(_view, findsNothing);
    expect(find.text('Your vote'), findsOneWidget);

    await _tearDown(tester, feed.bloc);
  });

  testWidgets('the vote button on the page votes without opening the entry', (
    tester,
  ) async {
    final feed = await _pumpFeed(
      tester,
      _contest([_entry('a', votes: 3), _entry('b', votes: 1)]),
    );
    await _openEntries(tester);
    await tester.tap(find.text('vote').first);
    await _settle(tester);
    expect(_view, findsNothing);
    expect(feed.votes.map((vote) => vote.$1), hasLength(1));
    expect(find.text('Your vote'), findsOneWidget);

    await _tearDown(tester, feed.bloc);
  });

  testWidgets('the add button stays pinned while a long list scrolls', (
    tester,
  ) async {
    final feed = await _pumpFeed(
      tester,
      _contest([for (var i = 0; i < 12; i++) _entry('$i', votes: 20 - i)]),
    );
    await _openEntries(tester);

    final pinned = find.byKey(const ValueKey('entries-pinned-cta'));
    final button = find
        .ancestor(
          of: find.text('Add your answer'),
          matching: find.byType(GestureDetector),
        )
        .first;
    expect(pinned, findsOneWidget);
    final before = tester.getRect(button);
    final screen = tester.view.physicalSize / tester.view.devicePixelRatio;
    expect(before.bottom, lessThan(screen.height));
    expect(before.bottom, greaterThan(screen.height - 120));

    // Down to the foot of the list: the button has not moved, and the last
    // entry scrolls up clear of it.
    await tester.fling(
      find.byWidgetPredicate(
        (widget) =>
            widget is ListView &&
            widget.padding == const EdgeInsets.fromLTRB(20, 0, 20, 24 + 79),
      ),
      const Offset(0, -4000),
      4000,
    );
    await tester.pump(const Duration(seconds: 2));
    expect(find.text('Add your answer'), findsOneWidget);
    expect(tester.getRect(button), before);
    final lastCard = find
        .ancestor(of: find.text('Caption 11'), matching: find.byType(Container))
        .first;
    expect(tester.getRect(lastCard).bottom, lessThanOrEqualTo(before.top));

    // It still takes a tap: the page closes to start the answer on the card.
    await tester.tap(find.text('Add your answer'));
    await _pageTransition(tester);
    expect(find.text('Leaderboard'), findsNothing);

    await _tearDown(tester, feed.bloc);
  });

  testWidgets('there is no add button once the viewer has entered', (
    tester,
  ) async {
    final feed = await _pumpFeed(
      tester,
      _contest([
        for (var i = 0; i < 12; i++) _entry('$i', votes: 20 - i),
        _entry('mine', mine: true),
      ], myEntryId: 'mine'),
    );
    await _openEntries(tester);
    expect(find.byKey(const ValueKey('entries-pinned-cta')), findsNothing);
    expect(find.text('Add your answer'), findsNothing);

    await _tearDown(tester, feed.bloc);
  });

  testWidgets('a photo opened full screen pinches and double-taps to zoom; '
      'while zoomed the swipes hold still', (tester) async {
    final feed = await _pumpFeed(
      tester,
      _contest(
        [_entry('a', votes: 3), _entry('b', votes: 2), _entry('c', votes: 1)],
        type: 'photo_story_challenge',
        title: 'Best desk setup',
      ),
    );
    await tester.ensureVisible(find.text('View Entries'));
    await tester.pump();
    await tester.tap(find.text('View Entries'));
    await _pageTransition(tester);
    await tester.tap(find.text('#1'));
    await _settle(tester);
    expect(_inView(find.text('1 of 3')), findsOneWidget);
    expect(_zoomScale(tester), 1);

    // Two fingers drawn apart zoom the photo in.
    await _pinchOut(tester, _zoom);
    await tester.pump(const Duration(milliseconds: 400));
    expect(_zoomScale(tester), greaterThan(1.2));
    expect(_zoomScale(tester), lessThanOrEqualTo(4));

    // Zoomed in, a swipe across pans the photo and stays on this entry, and
    // a swipe down leaves the card open.
    await tester.drag(_inView(find.byType(PageView)), const Offset(-300, 0));
    await _settle(tester);
    expect(_inView(find.text('1 of 3')), findsOneWidget);
    await tester.drag(_inView(find.byType(PageView)), const Offset(0, 300));
    await _settle(tester);
    expect(_view, findsOneWidget);

    // A double tap goes back to whole; then the swipe turns the page again.
    await _doubleTap(tester, _zoom);
    expect(_zoomScale(tester), 1);
    await tester.drag(_inView(find.byType(PageView)), const Offset(-300, 0));
    await _settle(tester);
    await _settle(tester);
    expect(_inView(find.text('2 of 3')), findsOneWidget);

    // From whole, a double tap goes to twice the size, which holds the
    // swipe too, and another comes back.
    await _doubleTap(tester, _zoom);
    expect(_zoomScale(tester), closeTo(2, 0.01));
    await tester.drag(_inView(find.byType(PageView)), const Offset(-300, 0));
    await _settle(tester);
    expect(_inView(find.text('2 of 3')), findsOneWidget);
    await _doubleTap(tester, _zoom);
    expect(_zoomScale(tester), 1);

    await _tearDown(tester, feed.bloc);
  });

  testWidgets('a caption zooms with its picture as one', (tester) async {
    final feed = await _pumpFeed(
      tester,
      _contest([_entry('a', votes: 3), _entry('b', votes: 1)]),
    );
    await _openEntries(tester);
    await tester.tap(find.text('Caption a'));
    await _settle(tester);
    expect(
      find.descendant(of: _zoom, matching: find.text('“Caption a')),
      findsOneWidget,
    );
    await _pinchOut(tester, _zoom);
    await tester.pump(const Duration(milliseconds: 400));
    expect(_zoomScale(tester), greaterThan(1.2));

    await _tearDown(tester, feed.bloc);
  });

  testWidgets('a pinch on an entry photo in the feed lifts it out to zoom, '
      'holds the carousel, and springs back on release', (tester) async {
    final feed = await _pumpFeed(
      tester,
      _contest(
        [_entry('a', votes: 3), _entry('b', votes: 2), _entry('c', votes: 1)],
        type: 'photo_story_challenge',
        title: 'Best desk setup',
      ),
    );
    final overlay = find.byKey(const ValueKey('pinch-zoom-overlay'));
    final snap = find
        .byWidgetPredicate(
          (widget) =>
              widget is ColoredBox && widget.color == const Color(0xFFF2F2F5),
        )
        .first;
    await tester.ensureVisible(snap);
    await tester.pump();
    expect(find.text('1 of 3'), findsOneWidget);
    expect(overlay, findsNothing);

    final (left, right) = await _pinchOut(tester, snap, release: false);
    expect(overlay, findsOneWidget);
    // Held well past the carousel's two seconds, it stays on its page.
    await tester.pump(const Duration(seconds: 3));
    expect(find.text('1 of 3'), findsOneWidget);

    await left.up();
    await right.up();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(overlay, findsNothing);

    await _tearDown(tester, feed.bloc);
  });
}
