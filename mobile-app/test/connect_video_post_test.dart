// A video post is drawn as its own card (node 3752:27075): the video edge to
// edge with who posted it laid over the top and the sound toggle in its
// corner. Posts a leader writes carry the LEADERSHIP pill, beside the post's
// own type pill when it has one.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/bloc/connect_bloc.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/connect/data/connect_models.dart';
import 'package:mobile_app/features/connect/presentation/connect_feed_screen.dart';
import 'package:mobile_app/features/connect/presentation/feed_video.dart';
// ignore: depend_on_referenced_packages
import 'package:video_player_platform_interface/video_player_platform_interface.dart';

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

Map<String, dynamic> _post(
  String id,
  String type,
  Map<String, dynamic> body, {
  bool leader = false,
  String userId = '',
}) => {
  'id': id,
  'type': type,
  'tag': type,
  'author': {
    'userId': userId.isEmpty ? 'author-$id' : userId,
    'name': 'Author $id',
    'initials': 'A',
    'designation': 'Designer',
    'isLeadership': leader,
  },
  'audience': {'label': 'Public'},
  'body': body,
  'likeCount': 0,
  'commentCount': 0,
  'comments': const [],
  'publishedAt': DateTime.now()
      .subtract(const Duration(hours: 2))
      .toUtc()
      .toIso8601String(),
};

Map<String, dynamic> _videoPost(
  String id, {
  bool leader = false,
  String text = '',
}) => _post(id, 'new_post', {
  'text': text,
  'mediaKind': 'video',
  'mediaUrl': '/media/clip.mp4',
}, leader: leader);

/// The top edge of the action bar: the hairline the likes sit under.
double _actionBarTop(WidgetTester tester) => tester
    .getRect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Container &&
            widget.decoration is BoxDecoration &&
            (widget.decoration! as BoxDecoration).border ==
                const Border(top: BorderSide(color: Color(0x66EBEBEB))),
      ),
    )
    .top;

/// Plays nothing: every video is ready at once, a 9:16 clip ten seconds long.
class _FakeVideoPlayer extends VideoPlayerPlatform {
  final _events = <int, StreamController<VideoEvent>>{};
  final volumes = <double>[];

  /// Each play and pause, in order: (player, playing).
  final plays = <(int, bool)>[];

  /// Where each player made reads from, in order.
  final sources = <DataSourceType>[];

  /// Each setLooping, in order: (player, looping).
  final loops = <(int, bool)>[];
  int _next = 0;

  /// [player] played to its end.
  void finish(int player) => _events[player]?.add(VideoEvent(eventType: VideoEventType.completed));

  @override
  Future<void> init() async {}

  @override
  Future<int?> createWithOptions(VideoCreationOptions options) async {
    sources.add(options.dataSource.sourceType);
    final id = _next++;
    _events[id] = StreamController<VideoEvent>();
    return id;
  }

  @override
  Stream<VideoEvent> videoEventsFor(int playerId) {
    final events = _events[playerId]!;
    scheduleMicrotask(
      () => events.add(
        VideoEvent(
          eventType: VideoEventType.initialized,
          duration: const Duration(seconds: 10),
          size: const Size(1080, 1920),
        ),
      ),
    );
    return events.stream;
  }

  @override
  Future<void> dispose(int playerId) async => _events.remove(playerId)?.close();

  @override
  Future<void> setPreventsDisplaySleepDuringVideoPlayback(
    int playerId,
    bool preventsDisplaySleepDuringVideoPlayback,
  ) async {}

  @override
  Future<void> setLooping(int playerId, bool looping) async => loops.add((playerId, looping));

  @override
  Future<void> setVolume(int playerId, double volume) async =>
      volumes.add(volume);

  @override
  Future<void> play(int playerId) async => plays.add((playerId, true));

  @override
  Future<void> pause(int playerId) async => plays.add((playerId, false));

  @override
  Future<void> setPlaybackSpeed(int playerId, double speed) async {}

  @override
  Future<void> seekTo(int playerId, Duration position) async {}

  @override
  Future<Duration> getPosition(int playerId) async => Duration.zero;

  @override
  Widget buildViewWithOptions(VideoViewOptions options) =>
      const ColoredBox(color: Colors.black);
}

Future<(List<http.Request>, ConnectBloc)> _pumpFeed(
  WidgetTester tester,
  Map<String, dynamic> post, {
  double width = 1179,
}) async {
  tester.view.physicalSize = Size(width, 2556 * 2);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final requests = <http.Request>[];
  final client = MockClient((request) async {
    requests.add(request);
    if (request.url.path.endsWith('/connect/feed')) {
      return http.Response(
        jsonEncode({
          'success': true,
          'posts': [post],
        }),
        200,
      );
    }
    return http.Response(jsonEncode({'success': true}), 200);
  });
  final bloc = ConnectBloc(
    session: _session,
    api: ConnectApiService(
      session: _session,
      baseUrl: 'https://example.test',
      client: client,
    ),
  );
  await bloc.load();

  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: ConnectFeedScreen(
          session: _session,
          profileAction: const SizedBox.shrink(),
          bloc: bloc,
          onOpenPerson: (_) {},
        ),
      ),
    ),
  );
  await tester.pump(const Duration(milliseconds: 300));
  await tester.pump(const Duration(milliseconds: 300));
  return (requests, bloc);
}

/// The control a screen reader announces as [label].
Finder _labelled(String label) => find.byWidgetPredicate(
  (widget) => widget is Semantics && widget.properties.label == label,
);

/// Takes the feed down before the test ends: the bloc's live connection
/// leaves a timer behind otherwise.
Future<void> _tearDown(WidgetTester tester, ConnectBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
}

void main() {
  late VideoPlayerPlatform realPlatform;
  late _FakeVideoPlayer videos;

  setUp(() {
    realPlatform = VideoPlayerPlatform.instance;
    videos = _FakeVideoPlayer();
    VideoPlayerPlatform.instance = videos;
    FeedVideo.resetSound();
    FeedVideo.cache = FeedVideoCache.none;
  });

  tearDown(() => VideoPlayerPlatform.instance = realPlatform);

  test('the author says whether they are one of the leaders', () {
    expect(
      ConnectAuthor.fromJson(const {
        'userId': 'a',
        'isLeadership': true,
      }).isLeadership,
      isTrue,
    );
    expect(ConnectAuthor.fromJson(const {'userId': 'a'}).isLeadership, isFalse);
  });

  testWidgets('a leader\'s post carries the LEADERSHIP pill', (tester) async {
    final (_, bloc) = await _pumpFeed(
      tester,
      _post('1', 'new_post', {
        'text': 'Town hall on Friday',
        'mediaKind': 'none',
      }, leader: true),
    );
    expect(find.text('Author 1'), findsOneWidget);
    expect(find.text('LEADERSHIP'), findsOneWidget);
    await _tearDown(tester, bloc);
  });

  testWidgets('a colleague\'s post carries no LEADERSHIP pill', (tester) async {
    final (_, bloc) = await _pumpFeed(
      tester,
      _post('2', 'new_post', {'text': 'Lunch?', 'mediaKind': 'none'}),
    );
    expect(find.text('Author 2'), findsOneWidget);
    expect(find.text('LEADERSHIP'), findsNothing);
    await _tearDown(tester, bloc);
  });

  testWidgets('LEADERSHIP sits ahead of the post\'s own type pill', (
    tester,
  ) async {
    final (_, bloc) = await _pumpFeed(
      tester,
      _post('3', 'hr_announcement', {
        'title': 'Holiday list',
        'text': 'Out now',
      }, leader: true),
      // The test font's capitals are wide: room for both pills on one row.
      width: 1500,
    );
    final leadership = find.text('LEADERSHIP');
    final notice = find.text('HR NOTICE');
    expect(leadership, findsOneWidget);
    expect(notice, findsOneWidget);
    expect(
      tester.getTopLeft(leadership).dx,
      lessThan(tester.getTopLeft(notice).dx),
    );
    expect(tester.getTopLeft(leadership).dy, tester.getTopLeft(notice).dy);
    await _tearDown(tester, bloc);
  });

  testWidgets('a leader\'s poll shows LEADERSHIP beside POLL', (tester) async {
    final (_, bloc) = await _pumpFeed(
      tester,
      _post('4', 'survey', {
        'title': 'Where to?',
        'options': [
          {'id': 'a', 'label': 'Bowling', 'votes': 1},
          {'id': 'b', 'label': 'Cricket', 'votes': 0},
        ],
      }, leader: true),
    );
    expect(find.text('LEADERSHIP'), findsOneWidget);
    expect(find.text('POLL'), findsOneWidget);
    expect(
      tester.getTopLeft(find.text('LEADERSHIP')).dx,
      lessThan(tester.getTopLeft(find.text('POLL')).dx),
    );
    await _tearDown(tester, bloc);
  });

  testWidgets('a leadership post with nobody behind it carries no pill', (
    tester,
  ) async {
    final post = _post('5', 'leadership', {
      'text': 'From the company',
      'mediaKind': 'none',
    });
    (post['author'] as Map)['userId'] = '';
    final (_, bloc) = await _pumpFeed(tester, post);
    expect(find.text('From the company'), findsOneWidget);
    expect(find.text('LEADERSHIP'), findsNothing);
    await _tearDown(tester, bloc);
  });

  testWidgets('a video post lays its author row over the video', (
    tester,
  ) async {
    final (_, bloc) = await _pumpFeed(tester, _videoPost('6', leader: true));

    // The author row is inside the video, in white, with the role and the
    // time after it — not the standard header above it.
    final name = find.text('Author 6');
    expect(name, findsOneWidget);
    expect(tester.widget<Text>(name).style?.color, Colors.white);
    expect(find.text('Designer'), findsOneWidget);
    expect(find.text('2h ago'), findsOneWidget);
    expect(find.text('•'), findsOneWidget);
    expect(find.text('Public'), findsOneWidget);
    expect(find.text('LEADERSHIP'), findsOneWidget);

    // It plays by itself, muted, with no play button: the sound toggle in
    // the corner turns the sound on.
    expect(videos.plays, contains((0, true)));
    expect(find.byIcon(Icons.play_arrow_rounded), findsNothing);
    expect(videos.volumes.last, 0);
    final sound = find.byKey(const ValueKey('feed-video-sound'));
    expect(sound, findsOneWidget);
    expect(_labelled('Sound on'), findsOneWidget);
    final card = tester.getRect(find.byType(FeedVideo));
    // Portrait stays portrait: 9:16 across the card.
    expect(card.height / card.width, closeTo(16 / 9, 0.01));
    final corner = tester.getRect(sound);
    // The 30pt icon sits 16 from the side and 26 from the bottom (12 and 22
    // of inset plus the corner button's 4); its tap area reaches 6 past it.
    expect(corner.right, closeTo(card.right - 10, 0.5));
    expect(corner.bottom, closeTo(card.bottom - 20, 0.5));
    expect(tester.getRect(name).top, greaterThan(card.top));
    await tester.tap(sound);
    // A single tap lands once the post's double-tap-to-like window passes.
    await tester.pump(const Duration(milliseconds: 400));
    expect(videos.volumes.last, 1);
    expect(_labelled('Mute'), findsOneWidget);
    await _tearDown(tester, bloc);
  });

  testWidgets('a tap on the video turns the sound on; holding pauses it', (
    tester,
  ) async {
    final (_, bloc) = await _pumpFeed(tester, _videoPost('7'));
    final spot = tester.getCenter(find.byType(FeedVideo));
    await tester.tapAt(spot);
    await tester.pump(const Duration(milliseconds: 400));
    expect(videos.volumes.last, 1);

    final hold = await tester.startGesture(spot);
    await tester.pump(const Duration(milliseconds: 600));
    expect(videos.plays.last, (0, false));
    await hold.up();
    await tester.pump();
    expect(videos.plays.last, (0, true));
    await _tearDown(tester, bloc);
  });

  testWidgets('a video post\'s caption sits under the video', (tester) async {
    const caption = 'Demo day highlights';
    final (_, bloc) = await _pumpFeed(
      tester,
      _videoPost('10', text: '$caption\n'),
    );
    final video = tester.getRect(find.byType(FeedVideo));
    final text = tester.getRect(find.text(caption));
    expect(text.top, closeTo(video.bottom + 12, 0.01));
    expect(_actionBarTop(tester), closeTo(text.bottom + 12, 0.01));
    await _tearDown(tester, bloc);
  });

  testWidgets('a video post with no caption leaves no block under it', (
    tester,
  ) async {
    final (_, bloc) = await _pumpFeed(tester, _videoPost('11', text: '   '));
    final video = tester.getRect(find.byType(FeedVideo));
    expect(_actionBarTop(tester), closeTo(video.bottom + 12, 0.01));
    await _tearDown(tester, bloc);
  });

  testWidgets('the composer shows a picked video above its caption', (
    tester,
  ) async {
    // The Files picker, as the composer reaches it off a phone.
    const picker = MethodChannel('miguelruivo.flutter.plugins.filepicker');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      picker,
      (call) async => [
        {'name': 'clip.mp4', 'path': '/tmp/clip.mp4', 'size': 1024},
      ],
    );
    addTearDown(() => messenger.setMockMethodCallHandler(picker, null));

    final (_, bloc) = await _pumpFeed(tester, _videoPost('12'));
    await tester.tap(find.text('Start a post.....'));
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 300));
    }
    final caption = find.byKey(const ValueKey('quick-post-caption'));
    final emptyHeight = tester.getRect(caption).height;
    await tester.tap(find.text('MEDIA'));
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 300));
    }

    // As the post will read: the video, then the caption under it; an empty
    // caption holds one line there, not the three it has on its own.
    final preview = tester.getRect(find.byType(FeedVideo));
    final field = tester.getRect(caption);
    expect(field.top, greaterThan(preview.bottom));
    expect(field.height, lessThan(emptyHeight));
    expect(find.text('Add a caption...'), findsOneWidget);
    await _tearDown(tester, bloc);
  });

  testWidgets('the menu on a video post still opens', (tester) async {
    final (_, bloc) = await _pumpFeed(tester, _videoPost('7'));
    expect(find.text('LEADERSHIP'), findsNothing);
    await tester.tap(
      find.descendant(
        of: find.byType(FeedVideo),
        matching: find.byWidgetPredicate((widget) => widget is PopupMenuButton),
      ),
    );
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Report post'), findsOneWidget);
    expect(find.text('Block Author'), findsOneWidget);
    await _tearDown(tester, bloc);
  });

  testWidgets('a double-tap on the video likes the post', (tester) async {
    final (requests, bloc) = await _pumpFeed(tester, _videoPost('8'));
    // On the picture, clear of the play button in the middle.
    final spot =
        tester.getCenter(find.byType(FeedVideo)) + const Offset(0, 160);
    await tester.tapAt(spot);
    await tester.pump(const Duration(milliseconds: 50));
    await tester.tapAt(spot);
    await tester.pump(const Duration(milliseconds: 400));
    expect(
      requests.where(
        (r) => r.method == 'POST' && r.url.path.endsWith('/posts/8/reaction'),
      ),
      isNotEmpty,
    );
    await tester.pump(const Duration(seconds: 1));
    await _tearDown(tester, bloc);
  });

  testWidgets('a double-tap on the menu or the sound button is not a like', (
    tester,
  ) async {
    final (requests, bloc) = await _pumpFeed(tester, _videoPost('13'));
    bool liked() => requests.any(
      (r) => r.method == 'POST' && r.url.path.endsWith('/posts/13/reaction'),
    );
    final sound = find.byKey(const ValueKey('feed-video-sound'));
    await tester.tap(sound);
    await tester.pump(const Duration(milliseconds: 50));
    await tester.tap(sound);
    await tester.pump(const Duration(milliseconds: 400));
    expect(liked(), isFalse);

    final menu = find.descendant(
      of: find.byType(FeedVideo),
      matching: find.byWidgetPredicate((widget) => widget is PopupMenuButton),
    );
    await tester.tap(menu);
    await tester.pump(const Duration(milliseconds: 50));
    await tester.tap(menu, warnIfMissed: false);
    await tester.pump(const Duration(milliseconds: 400));
    expect(liked(), isFalse);
    await tester.pump(const Duration(seconds: 1));
    await _tearDown(tester, bloc);
  });

  testWidgets('full screen shows the same author row and closes', (
    tester,
  ) async {
    final (_, bloc) = await _pumpFeed(tester, _videoPost('9', leader: true));
    await tester.tap(_labelled('Full screen'));
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 300));
    }

    // Over the full-screen video: the author, the pill, the way back, and the
    // sound toggle — the feed's own copy waits under the route.
    expect(find.text('Author 9', skipOffstage: false), findsNWidgets(2));
    expect(find.text('Author 9').hitTestable(), findsOneWidget);
    expect(find.text('2h ago').hitTestable(), findsOneWidget);
    expect(find.text('LEADERSHIP').hitTestable(), findsOneWidget);
    expect(
      find.byKey(const ValueKey('feed-video-sound')).hitTestable(),
      findsOneWidget,
    );
    await tester.tap(_labelled('Close'));
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 300));
    }
    expect(find.text('Author 9'), findsOneWidget);
    expect(_labelled('Close'), findsNothing);
    await _tearDown(tester, bloc);
  });

  testWidgets('a streamed video does not loop by itself; at its end it moves to the phone\'s copy, '
      'which loops with nothing more downloaded', (tester) async {
    final cache = _FakeVideoCache();
    FeedVideo.cache = cache;
    final (_, bloc) = await _pumpFeed(tester, _videoPost('10'));

    expect(videos.sources, [DataSourceType.network]);
    expect(videos.loops, isNot(contains((0, true))));
    // Played, so it is kept for next time.
    expect(cache.kept, hasLength(1));

    // The copy has arrived; the stream reaches its end.
    cache.arrived = true;
    videos.finish(0);
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(videos.sources, [DataSourceType.network, DataSourceType.file]);
    expect(videos.loops.last, (1, true));
    expect(videos.plays.last, (1, true));
    await _tearDown(tester, bloc);
  });

  testWidgets('a video already on the phone plays from the file, looping', (tester) async {
    FeedVideo.cache = _FakeVideoCache()..arrived = true;
    final (_, bloc) = await _pumpFeed(tester, _videoPost('11'));
    expect(videos.sources, [DataSourceType.file]);
    expect(videos.loops.last, (0, true));
    await _tearDown(tester, bloc);
  });

  testWidgets('without the copy yet, the end streams it once more', (tester) async {
    FeedVideo.cache = _FakeVideoCache();
    final (_, bloc) = await _pumpFeed(tester, _videoPost('12'));
    final before = videos.plays.length;
    videos.finish(0);
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(videos.sources, [DataSourceType.network]);
    expect(videos.plays.sublist(before), contains((0, true)));
    await _tearDown(tester, bloc);
  });
}

/// The phone's copies, in memory: none until [arrived].
class _FakeVideoCache extends FeedVideoCache {
  bool arrived = false;
  final kept = <String>[];

  @override
  Future<File?> cached(String url) async => arrived ? File('/tmp/kept.mov') : null;

  @override
  void keep(String url) => kept.add(url);
}
