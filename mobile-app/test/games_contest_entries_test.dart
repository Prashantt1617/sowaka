// A live contest on the Games tab opens its Entries page over the tab, not
// in the Connect feed: Back (the page's own and the system's) comes back to
// the Games pane, a vote cast there reaches the bloc — the feed's own when
// the feed has the contest — and "Add your answer" opens the contest's card
// with its answer box, as it does from the feed.
//
// The shell's wiring (`_GamesTab`) is private to it; the harness here wires
// the Games pane the same way, over a Connect feed kept mounted beside it as
// the shell's IndexedStack keeps it.
import 'dart:async';
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
import 'package:mobile_app/features/games/data/games_api_service.dart';
import 'package:mobile_app/features/games/presentation/games_home.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'viewer',
    email: 'viewer@example.test',
    name: 'Viewer',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    enabledTabs: ['connect', 'games'],
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

Map<String, dynamic> _entry(String id, {int votes = 0, bool voted = false}) => {
  'id': id,
  'userId': 'user-$id',
  'name': 'Person $id',
  'initials': id.toUpperCase(),
  'text': 'Caption $id',
  'votes': votes,
  'points': votes * 10,
  'votedByViewer': voted,
  'isMine': false,
  'createdAt': '2026-10-12T06:00:00.000Z',
};

Map<String, dynamic> _contest({String? myVote, String? myEntry}) {
  final entries = [
    _entry('a', votes: 3),
    _entry('b', votes: 1, voted: myVote == 'b'),
  ];
  return {
    'id': 'contest',
    'type': 'caption_challenge',
    'tag': 'Caption Challenge',
    'author': {'userId': 'author', 'name': 'Aakshay Rao', 'initials': 'AR'},
    'audience': {'label': 'Public'},
    'body': {
      'title': 'Caption this',
      'pointsPerVote': 10,
      'mediaKind': 'image',
      'closesAt': DateTime.now()
          .add(const Duration(days: 1))
          .toUtc()
          .toIso8601String(),
      'entries': entries,
      'leaderboard': [
        for (final (index, entry) in entries.indexed)
          {...entry, 'rank': index + 1},
      ],
      'myEntryId': myEntry,
      'myVoteEntryId': myVote,
    },
    'liked': false,
    'likeCount': 0,
    'commentCount': 0,
    'comments': <dynamic>[],
    'publishedAt': '2026-10-12T06:00:00.000Z',
  };
}

Map<String, dynamic> _home() => {
  'success': true,
  'points': 120,
  'rank': 4,
  'total': 31,
  'banner': null,
  'liveContests': [
    {
      'id': 'contest',
      'type': 'caption',
      'postType': 'caption_challenge',
      'title': 'Caption this',
      'prompt': 'Write the funniest caption.',
      'closesAt': DateTime.now()
          .add(const Duration(hours: 2))
          .toUtc()
          .toIso8601String(),
      'author': {'userId': 'author', 'name': 'Aakshay Rao', 'photoUrl': null},
      'entries': 2,
      'entrants': <dynamic>[],
      'entered': false,
    },
  ],
  'liveRelay': null,
  'challenges': <dynamic>[],
  'yourGames': <dynamic>[],
  'games': <dynamic>[],
  'playingNow': {'count': 0, 'people': <dynamic>[]},
};

http.Response _ok(Map<String, dynamic> json) =>
    http.Response(jsonEncode({'success': true, ...json}), 200);

class _Harness {
  _Harness({required this.feedHasContest});

  final bool feedHasContest;
  bool failPost = false;
  final postReads = <Uri>[];
  final votes = <String>[];
  final captions = <http.BaseRequest>[];
  final opened = <String>[];
  late ConnectBloc feedBloc;

  late final connect = MockClient((request) async {
    final path = request.url.path;
    if (path.endsWith('/connect/feed')) {
      return _ok({
        'posts': feedHasContest ? [_contest()] : <dynamic>[],
      });
    }
    if (path.endsWith('/captions/vote')) {
      votes.add(jsonDecode(request.body)['entryId'] as String);
      return _ok({'post': _contest(myVote: 'b')});
    }
    if (path.endsWith('/connect/posts/contest/captions')) {
      captions.add(request);
      return _ok({'post': _contest(myEntry: 'mine')});
    }
    if (path.endsWith('/connect/posts/contest')) {
      postReads.add(request.url);
      if (failPost) {
        return http.Response(
          jsonEncode({'success': false, 'message': 'Down'}),
          500,
        );
      }
      return _ok({'post': _contest()});
    }
    return _ok({});
  });

  Future<void> pump(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1179, 2556);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    feedBloc = ConnectBloc(
      session: _session,
      api: ConnectApiService(
        session: _session,
        baseUrl: 'https://example.test',
        client: connect,
      ),
      socket: _QuietSocket(),
    );
    await feedBloc.load();
    final controller = ConnectComposerController();
    final games = GamesApiService(
      session: _session,
      baseUrl: 'https://example.test',
      client: MockClient(
        (request) async => http.Response(jsonEncode(_home()), 200),
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: true),
          child: child!,
        ),
        home: Scaffold(
          body: IndexedStack(
            index: 1,
            children: [
              ConnectFeedScreen(
                session: _session,
                profileAction: const SizedBox.shrink(),
                bloc: feedBloc,
                composerController: controller,
              ),
              Builder(
                builder: (context) => GamesHomeView(
                  session: _session,
                  service: games,
                  onOpenPost: opened.add,
                  onOpenContest: (postId) => openContestEntries(
                    context,
                    _session,
                    postId,
                    feed: controller,
                    onOpenPerson: (_) {},
                    // The bloc the page makes for itself, when the feed does
                    // not have the contest, talks to the fake server too.
                    api: ConnectApiService(
                      session: _session,
                      baseUrl: 'https://example.test',
                      client: connect,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    await settle(tester);
  }

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 300));
    }
  }

  Future<void> tearDown(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    feedBloc.dispose();
  }
}

final _card = find.byKey(const ValueKey('live-contest-contest'));
final _entriesBar = find.text('Entries');
final _gamesPane = find.text('LIVE GAMES');
final _back = find.byWidgetPredicate(
  (widget) => widget is Semantics && widget.properties.label == 'Back',
);

/// The vote button in the same row as [caption].
Finder _voteFor(WidgetTester tester, String caption) {
  final y = tester.getCenter(find.text(caption)).dy;
  final buttons = find.text('vote');
  final count = buttons.evaluate().length;
  var best = 0;
  for (var i = 1; i < count; i++) {
    final gap = (tester.getCenter(buttons.at(i)).dy - y).abs();
    if (gap < (tester.getCenter(buttons.at(best)).dy - y).abs()) best = i;
  }
  return buttons.at(best);
}

void main() {
  testWidgets('a Games contest opens its Entries page over the tab, and Back '
      'comes back to it', (tester) async {
    final harness = _Harness(feedHasContest: true);
    await harness.pump(tester);
    expect(_gamesPane, findsOneWidget);

    await tester.tap(_card);
    await harness.settle(tester);

    expect(_entriesBar, findsOneWidget);
    expect(find.text('Caption a'), findsOneWidget);
    expect(find.text('Caption b'), findsOneWidget);
    // Nothing asked the shell to switch to Connect.
    expect(harness.opened, isEmpty);

    await tester.tap(_back);
    await harness.settle(tester);
    expect(_entriesBar, findsNothing);
    expect(_gamesPane, findsOneWidget);
    expect(harness.opened, isEmpty);
    await harness.tearDown(tester);
  });

  testWidgets('a vote there reaches the feed bloc, which shows it too', (
    tester,
  ) async {
    final harness = _Harness(feedHasContest: true);
    await harness.pump(tester);
    await tester.tap(_card);
    await harness.settle(tester);

    await tester.tap(_voteFor(tester, 'Caption b'));
    await tester.pump();
    expect(harness.votes, ['b']);
    final inFeed = harness.feedBloc.state.posts.singleWhere(
      (post) => post.id == 'contest',
    );
    expect(inFeed.myContestVote, 'b');
    await harness.settle(tester);
    await harness.tearDown(tester);
  });

  testWidgets('one the feed has not loaded is read for the page, voted on, '
      'and the system Back returns to Games', (tester) async {
    final harness = _Harness(feedHasContest: false);
    await harness.pump(tester);
    await tester.tap(_card);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    // The page's top bar over a spinner while the contest is read.
    expect(_entriesBar, findsOneWidget);
    await harness.settle(tester);

    expect(harness.postReads, isNotEmpty);
    expect(find.text('Caption b'), findsOneWidget);
    await tester.tap(_voteFor(tester, 'Caption b'));
    await tester.pump();
    expect(harness.votes, ['b']);
    // Not put into the feed, which never had it.
    expect(harness.feedBloc.state.posts, isEmpty);
    await harness.settle(tester);

    await tester.binding.handlePopRoute();
    await harness.settle(tester);
    expect(_entriesBar, findsNothing);
    expect(_gamesPane, findsOneWidget);
    await harness.tearDown(tester);
  });

  testWidgets('a contest that cannot be read offers Retry', (tester) async {
    final harness = _Harness(feedHasContest: false)..failPost = true;
    await harness.pump(tester);
    await tester.tap(_card);
    await harness.settle(tester);

    expect(find.text("Couldn't load this contest."), findsOneWidget);
    harness.failPost = false;
    await tester.tap(find.text('Retry'));
    await harness.settle(tester);
    expect(find.text('Caption a'), findsOneWidget);
    await harness.tearDown(tester);
  });

  testWidgets('Add your answer opens the card with its answer box, and the '
      'entry goes up from there', (tester) async {
    final harness = _Harness(feedHasContest: true);
    await harness.pump(tester);
    await tester.tap(_card);
    await harness.settle(tester);

    await tester.tap(find.text('Add your answer'));
    await harness.settle(tester);
    // The Entries page has gone; the contest's card is up under its name,
    // its answer box open.
    expect(_entriesBar, findsNothing);
    expect(find.text('Caption this'), findsWidgets);
    final box = find.byType(TextField);
    expect(box, findsOneWidget);
    await tester.enterText(box, 'Monday, again');
    await tester.tap(
      find.byWidgetPredicate(
        (widget) => widget is Semantics && widget.properties.label == 'Send',
      ),
    );
    await harness.settle(tester);
    expect(harness.captions, hasLength(1));

    await tester.tap(_back);
    await harness.settle(tester);
    expect(_gamesPane, findsOneWidget);
    expect(harness.opened, isEmpty);
    await harness.tearDown(tester);
  });
}
