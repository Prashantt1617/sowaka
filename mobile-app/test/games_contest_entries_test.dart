// A live contest on the Games tab opens its Entries page over the tab, not
// in the Connect feed: Back (the page's own and the system's) comes back to
// the Games pane, a vote cast there reaches the bloc — the feed's own when
// the feed has the contest — and "Add your answer" / "Add your photo" opens
// the contest's card with its answer box over the Entries page, still on the
// Games tab. The entry sent, the Entries page is back with it on; an entry
// that did not go keeps the card up and says why.
//
// The shell's wiring (`_GamesTab`) is private to it; the harness here wires
// the Games pane the same way, over a Connect feed kept mounted beside it as
// the shell's IndexedStack keeps it. The harness has no shell bloc at all:
// the only way to Connect is the pane's `onOpenPost`, which is recorded, so
// an empty record is the tab never having been asked to change.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
// The platform behind `FilePicker.pickFiles`, swapped for a fake: on this
// test's platform the app's photo picker is the file browser.
// ignore: implementation_imports
import 'package:file_picker/src/platform/file_picker_platform_interface.dart';
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

Map<String, dynamic> _entry(
  String id, {
  int votes = 0,
  bool voted = false,
  bool mine = false,
  String? text,
}) => {
  'id': id,
  'userId': mine ? 'viewer' : 'user-$id',
  'name': mine ? 'Viewer' : 'Person $id',
  'initials': mine ? 'V' : id.toUpperCase(),
  'text': text ?? 'Caption $id',
  'votes': votes,
  'points': votes * 10,
  'votedByViewer': voted,
  'isMine': mine,
  'createdAt': '2026-10-12T06:00:00.000Z',
};

/// The contest as the server sends it: a caption contest unless [type] says
/// otherwise, with the viewer's own entry ([myText]) on it once they have
/// sent one.
Map<String, dynamic> _contest({
  String type = 'caption_challenge',
  String? myVote,
  String? myText,
}) {
  final entries = [
    _entry('a', votes: 3),
    _entry('b', votes: 1, voted: myVote == 'b'),
    if (myText != null) _entry('mine', mine: true, text: myText),
  ];
  return {
    'id': 'contest',
    'type': type,
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
      'myEntryId': myText == null ? null : 'mine',
      'myVoteEntryId': myVote,
    },
    'liked': false,
    'likeCount': 0,
    'commentCount': 0,
    'comments': <dynamic>[],
    'publishedAt': '2026-10-12T06:00:00.000Z',
  };
}

Map<String, dynamic> _home({String type = 'caption_challenge'}) => {
  'success': true,
  'points': 120,
  'rank': 4,
  'total': 31,
  'banner': null,
  'liveContests': [
    {
      'id': 'contest',
      'type': type == 'photo_story_challenge' ? 'photo' : 'caption',
      'postType': type,
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

/// The app's photo picker, on this platform the file browser, made to hand
/// back [path] — or nothing, when the person backs out.
class _FakeFilePicker extends FilePickerMacOS {
  _FakeFilePicker(this.path);

  final String? path;
  int asked = 0;

  @override
  Future<FilePickerResult?> pickFiles({
    String? dialogTitle,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    Function(FilePickerStatus)? onFileLoading,
    int compressionQuality = 0,
    bool allowMultiple = false,
    bool withData = false,
    bool withReadStream = false,
    bool lockParentWindow = false,
    bool readSequential = false,
    bool cancelUploadOnWindowBlur = true,
  }) async {
    asked++;
    final file = path;
    if (file == null) return null;
    return FilePickerResult([
      PlatformFile(path: file, name: 'desk.png', size: File(file).lengthSync()),
    ]);
  }
}

/// Installs [picker] as the photo picker for the test running.
_FakeFilePicker _usePicker(String? path) {
  final before = FilePickerPlatform.instance;
  final picker = _FakeFilePicker(path);
  FilePickerPlatform.instance = picker;
  addTearDown(() => FilePickerPlatform.instance = before);
  return picker;
}

/// A 1×1 PNG, written where the fake picker can point at it. Written at
/// once: a test's clock is a fake one, and real file work waits on it.
String _writePhoto() {
  final dir = Directory.systemTemp.createTempSync('games_contest_entries');
  addTearDown(() => dir.deleteSync(recursive: true));
  final file = File('${dir.path}/desk.png');
  file.writeAsBytesSync(
    base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    ),
  );
  return file.path;
}

class _Harness {
  _Harness({required this.feedHasContest, this.type = 'caption_challenge'});

  final bool feedHasContest;
  final String type;
  bool failPost = false;

  /// The next entry sent is refused.
  bool failCaption = false;

  /// The viewer's entry as the server has it, once one has gone up, and
  /// whether a picture came with it.
  String? myText;
  bool hadPhoto = false;
  final postReads = <Uri>[];
  final votes = <String>[];
  final captions = <http.Request>[];
  final opened = <String>[];
  late ConnectBloc feedBloc;

  Map<String, dynamic> _current({String? myVote}) =>
      _contest(type: type, myVote: myVote, myText: myText);

  late final connect = MockClient((request) async {
    final path = request.url.path;
    if (path.endsWith('/connect/feed')) {
      return _ok({
        'posts': feedHasContest ? [_current()] : <dynamic>[],
      });
    }
    if (path.endsWith('/captions/vote')) {
      votes.add(jsonDecode(request.body)['entryId'] as String);
      return _ok({'post': _current(myVote: 'b')});
    }
    if (path.endsWith('/connect/posts/contest/captions')) {
      captions.add(request);
      if (failCaption) {
        return http.Response(
          jsonEncode({'success': false, 'message': 'Entries are closed'}),
          400,
        );
      }
      // A caption is sent as JSON; a photo as a multipart body (the picture
      // is not text, so it is read as bytes), whose story is its text part.
      final isMultipart = (request.headers['content-type'] ?? '').startsWith(
        'multipart/',
      );
      if (isMultipart) {
        final match = RegExp(
          r'name="text"\r\n\r\n(.*?)\r\n',
        ).firstMatch(latin1.decode(request.bodyBytes));
        myText = match?.group(1) ?? '';
        hadPhoto = request.bodyBytes.length > 200;
      } else {
        myText = jsonDecode(request.body)['text'] as String? ?? '';
      }
      return _ok({'post': _current()});
    }
    if (path.endsWith('/connect/posts/contest')) {
      postReads.add(request.url);
      if (failPost) {
        return http.Response(
          jsonEncode({'success': false, 'message': 'Down'}),
          500,
        );
      }
      return _ok({'post': _current()});
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
        (request) async => http.Response(jsonEncode(_home(type: type)), 200),
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
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
  setUpAll(_loadFonts);

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

  testWidgets('Add your answer opens the card with its answer box over the '
      'Entries page, on the Games tab; the entry sent, the Entries page is '
      'back with it on, and Back goes to Games', (tester) async {
    final harness = _Harness(feedHasContest: true);
    await harness.pump(tester);
    await tester.tap(_card);
    await harness.settle(tester);

    await tester.tap(find.text('Add your answer'));
    await harness.settle(tester);
    // The contest's card is up under its name, its answer box open, over
    // the Entries page (which is there, under it, out of sight). Nothing
    // asked the shell for Connect.
    expect(_entriesBar, findsNothing);
    expect(find.text('Caption this'), findsWidgets);
    expect(harness.opened, isEmpty);
    final box = find.byType(TextField);
    expect(box, findsOneWidget);
    await tester.enterText(box, 'Monday, again');
    await tester.tap(_send);
    await harness.settle(tester);
    expect(harness.captions, hasLength(1));
    expect(harness.myText, 'Monday, again');

    // The card page has closed onto the Entries page, which shows the entry
    // and no longer offers to add one; the feed's bloc has it too.
    expect(_entriesBar, findsOneWidget);
    expect(find.text('Monday, again'), findsOneWidget);
    expect(find.text('Add your answer'), findsNothing);
    expect(
      harness.feedBloc.state.posts
          .singleWhere((post) => post.id == 'contest')
          .myCaptionEntryId,
      'mine',
    );

    await tester.tap(_back);
    await harness.settle(tester);
    expect(_entriesBar, findsNothing);
    expect(_gamesPane, findsOneWidget);
    expect(harness.opened, isEmpty);
    await harness.tearDown(tester);
  });

  testWidgets('Add your photo picks and crops the photo, takes the story, '
      'and sends it, all over the Games tab; the Entries page then shows '
      'the photo entry', (tester) async {
    final picker = _usePicker(_writePhoto());
    final harness = _Harness(
      feedHasContest: true,
      type: 'photo_story_challenge',
    );
    await harness.pump(tester);
    await tester.tap(_card);
    await harness.settle(tester);
    expect(find.text('No entry yet'), findsOneWidget);

    // Reading the picture, cropping it and sending it are real file work.
    await tester.runAsync(() async {
      await tester.tap(_pinnedCta);
      await _realWork(tester);
      expect(picker.asked, 1);
      // The crop page, over the card.
      expect(find.text('Crop your photo'), findsOneWidget);
      await tester.tap(find.text('Done'));
      await _realWork(tester);

      // The card with the picture in its box, over the Entries page.
      expect(find.text('Crop your photo'), findsNothing);
      expect(_entriesBar, findsNothing);
      expect(harness.opened, isEmpty);
      final story = find.byType(TextField);
      expect(story, findsOneWidget);
      await tester.enterText(story, 'My corner');
      await tester.tap(_send);
      await _realWork(tester);
    });
    await harness.settle(tester);

    expect(harness.captions, hasLength(1));
    expect(harness.hadPhoto, isTrue);
    expect(harness.myText, 'My corner');
    // Back on the Entries page, the photo now the viewer's own.
    expect(_entriesBar, findsOneWidget);
    expect(find.text('No entry yet'), findsNothing);
    expect(find.text('0 pts · 0 votes'), findsOneWidget);
    expect(find.text('Add your photo'), findsNothing);

    await tester.tap(_back);
    await harness.settle(tester);
    expect(_entriesBar, findsNothing);
    expect(_gamesPane, findsOneWidget);
    expect(harness.opened, isEmpty);
    await harness.tearDown(tester);
  });

  testWidgets('backing out of the photo picker returns to the Entries page', (
    tester,
  ) async {
    final picker = _usePicker(null);
    final harness = _Harness(
      feedHasContest: true,
      type: 'photo_story_challenge',
    );
    await harness.pump(tester);
    await tester.tap(_card);
    await harness.settle(tester);

    await tester.tap(_pinnedCta);
    await harness.settle(tester);
    expect(picker.asked, 1);
    expect(_entriesBar, findsOneWidget);
    expect(_pinnedCta, findsOneWidget);
    expect(harness.captions, isEmpty);
    expect(harness.opened, isEmpty);

    await tester.tap(_back);
    await harness.settle(tester);
    expect(_gamesPane, findsOneWidget);
    await harness.tearDown(tester);
  });

  for (final feedHasContest in [false, true]) {
    testWidgets('an entry that did not go keeps the card up, with what was '
        'written, and says why (${feedHasContest ? "the feed's bloc, which "
                  "the feed speaks for" : "the page's own bloc"})', (
      tester,
    ) async {
      final harness = _Harness(feedHasContest: feedHasContest)
        ..failCaption = true;
      await harness.pump(tester);
      await tester.tap(_card);
      await harness.settle(tester);

      await tester.tap(find.text('Add your answer'));
      await harness.settle(tester);
      await tester.enterText(find.byType(TextField), 'Monday, again');
      await tester.tap(_send);
      await harness.settle(tester);
      expect(harness.captions, hasLength(1));
      expect(find.text('Entries are closed'), findsWidgets);
      expect(_entriesBar, findsNothing);
      expect(find.text('Monday, again'), findsOneWidget);

      // Another go, and it is through.
      harness.failCaption = false;
      await tester.tap(_send);
      await harness.settle(tester);
      expect(harness.captions, hasLength(2));
      expect(_entriesBar, findsOneWidget);
      expect(find.text('Monday, again'), findsOneWidget);
      expect(harness.opened, isEmpty);
      await harness.tearDown(tester);
    });
  }
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

/// The Entries page's pinned "Add your photo" button (the Your Photo tile
/// says it too).
final _pinnedCta = find.byKey(const ValueKey('entries-pinned-cta'));

final _send = find.byWidgetPredicate(
  (widget) => widget is Semantics && widget.properties.label == 'Send',
);

/// Lets file reads, image decoding and the upload (real work, under
/// `runAsync`) complete, pumping frames between.
Future<void> _realWork(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 40));
    await tester.pump(const Duration(milliseconds: 100));
  }
}
