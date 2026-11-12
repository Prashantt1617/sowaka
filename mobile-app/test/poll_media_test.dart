// A poll's options can each carry a photo or a video. The editor's option
// mode reads "Media" (it read "Image"), and picks either from the feed's own
// pickers; a video goes up in the same upload field as a photo. In the feed a
// video option is a tile playing its video muted on the feed's player, and a
// tap opens it to watch and vote from the Vote pill, as a picture option does.
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
import 'package:mobile_app/features/connect/data/connect_socket_service.dart';
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

/// Plays nothing: every video is ready at once, a 9:16 clip ten seconds long.
class _FakeVideoPlayer extends VideoPlayerPlatform {
  final _events = <int, StreamController<VideoEvent>>{};

  /// Each play and pause, in order: (player, playing).
  final plays = <(int, bool)>[];
  final volumes = <(int, double)>[];
  int _next = 0;

  @override
  Future<void> init() async {}

  @override
  Future<int?> createWithOptions(VideoCreationOptions options) async {
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
  Future<void> setLooping(int playerId, bool looping) async {}

  @override
  Future<void> setVolume(int playerId, double volume) async =>
      volumes.add((playerId, volume));

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

  /// Whether every player made was left muted (the player itself sets full
  /// volume as it starts, before it is told otherwise).
  bool get allMuted {
    final last = <int, double>{};
    for (final (id, v) in volumes) {
      last[id] = v;
    }
    return last.values.every((v) => v == 0);
  }

  /// Whether [player] was last told to play.
  bool playing(int player) =>
      plays.lastWhere((e) => e.$1 == player, orElse: () => (player, false)).$2;
}

Map<String, dynamic> _videoPoll({String? selected}) => {
  'id': 'poll',
  'type': 'survey',
  'tag': 'Poll',
  'author': {'userId': 'author', 'name': 'Author', 'initials': 'A'},
  'audience': {'label': 'Public'},
  'body': {
    'title': 'Best dance move?',
    'options': [
      {
        'id': 'a',
        'label': 'Moonwalk',
        'votes': selected == 'a' ? 1 : 0,
        'videoUrl': '/media/a.mp4',
        'mediaKind': 'video',
      },
      {
        'id': 'b',
        'label': 'Robot',
        'votes': 0,
        'videoUrl': '/media/b.mp4',
        'mediaKind': 'video',
      },
    ],
    'totalVotes': selected == null ? 0 : 1,
  },
  'liked': false,
  'likeCount': 0,
  'commentCount': 0,
  'comments': <dynamic>[],
  'publishedAt': '2026-11-12T06:00:00.000Z',
  'selectedPollOptionId': selected,
};

http.Response _ok(Map<String, dynamic> json) =>
    http.Response(jsonEncode({'success': true, ...json}), 200);

class _Feed {
  _Feed(this.bloc, this.requests, this.votes);
  final ConnectBloc bloc;
  final List<http.Request> requests;
  final List<(String, Completer<http.Response>)> votes;
}

Future<_Feed> _pumpFeed(
  WidgetTester tester,
  List<Map<String, dynamic>> posts,
) async {
  tester.view.physicalSize = const Size(393, 852) * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final requests = <http.Request>[];
  final votes = <(String, Completer<http.Response>)>[];
  final client = MockClient((request) async {
    requests.add(request);
    if (request.url.path.endsWith('/connect/posts/poll/actions')) {
      final reply = Completer<http.Response>();
      votes.add((jsonDecode(request.body)['optionId'] as String, reply));
      return reply.future;
    }
    if (request.url.path.endsWith('/connect/feed')) {
      return _ok({'posts': posts});
    }
    if (request.method == 'POST' &&
        request.url.path.endsWith('/connect/posts')) {
      return _ok({'post': _videoPoll()..['id'] = 'new-poll'});
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
  await tester.pump(const Duration(milliseconds: 300));
  return _Feed(bloc, requests, votes);
}

Future<void> _settle(WidgetTester tester, [int frames = 4]) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 300));
  }
}

Future<void> _tearDown(WidgetTester tester, ConnectBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
}

/// From the feed into the poll editor, through "Start a post" and its Poll chip.
Future<void> _openPollEditor(WidgetTester tester) async {
  await tester.tap(find.text('Start a post.....'));
  await _settle(tester, 5);
  await tester.tap(find.text('POLL'));
  await _settle(tester, 5);
}

final _viewer = find.byKey(const ValueKey('poll-option-viewer'));
final _voteButton = find.byKey(const ValueKey('poll-option-vote'));

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

  test('an option reads its video, never as its picture', () {
    final video = ConnectPollOption.fromJson(const {
      'id': 'a',
      'label': 'A',
      'votes': 0,
      'videoUrl': '/media/a.mp4',
    });
    expect(video.hasVideo, isTrue);
    expect(video.hasMedia, isTrue);
    expect(video.imageUrl, isNull);
    final picture = ConnectPollOption.fromJson(const {
      'id': 'b',
      'label': 'B',
      'imageUrl': '/media/b.jpg',
    });
    expect(picture.hasVideo, isFalse);
    expect(picture.hasMedia, isTrue);
    expect(
      ConnectPollOption.fromJson(const {'id': 'c', 'label': 'C'}).hasMedia,
      isFalse,
    );
  });

  testWidgets('the poll editor offers Media, saying photo or video', (
    tester,
  ) async {
    final feed = await _pumpFeed(tester, const []);
    await _openPollEditor(tester);

    expect(find.text('Media'), findsOneWidget);
    expect(find.text('Image'), findsNothing);
    expect(find.text('Add a photo or a video to each option.'), findsNothing);

    await tester.tap(find.text('Media'));
    await tester.pump();
    expect(find.text('Add a photo or a video to each option.'), findsOneWidget);
    expect(find.bySemanticsLabel('Add a photo or video'), findsNWidgets(2));
    await _tearDown(tester, feed.bloc);
  });

  testWidgets(
    'a video chosen for an option is shown and goes up with the poll',
    (tester) async {
      final dir = Directory.systemTemp.createTempSync('poll-media-test');
      addTearDown(() => dir.deleteSync(recursive: true));
      final clip = File('${dir.path}/clip.mp4')
        ..writeAsBytesSync(List.filled(2048, 7));
      // The Files picker, as the editor reaches it off a phone.
      const picker = MethodChannel('miguelruivo.flutter.plugins.filepicker');
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      final asked = <List<String>>[];
      messenger.setMockMethodCallHandler(picker, (call) async {
        final args = call.arguments as Map?;
        asked.add([
          for (final e in (args?['allowedExtensions'] as List?) ?? const [])
            e.toString(),
        ]);
        return [
          {'name': 'clip.mp4', 'path': clip.path, 'size': 2048},
        ];
      });
      addTearDown(() => messenger.setMockMethodCallHandler(picker, null));

      final feed = await _pumpFeed(tester, const []);
      await _openPollEditor(tester);
      await tester.tap(find.text('Media'));
      await tester.pump();

      await tester.enterText(find.byType(TextField).at(0), 'Best dance move?');
      await tester.enterText(find.byType(TextField).at(1), 'Moonwalk');
      await tester.enterText(find.byType(TextField).at(2), 'Robot');
      await tester.tap(find.bySemanticsLabel('Add a photo or video').first);
      await _settle(tester);

      // The feed's own extensions: video as well as photos.
      expect(asked.single, containsAll(['jpg', 'png', 'mp4', 'mov']));
      // The clip is previewed in its option on the feed's player, muted.
      expect(
        find.byKey(const ValueKey('poll-option-video-preview')),
        findsOneWidget,
      );
      expect(find.byType(FeedVideo), findsOneWidget);
      expect(
        find.bySemanticsLabel('Replace the photo or video'),
        findsOneWidget,
      );
      expect(videos.allMuted, isTrue);

      await tester.tap(find.text('Done'));
      await _settle(tester, 5);
      // The composer's summary of the poll marks the option as a video.
      expect(
        find.byKey(const ValueKey('poll-summary-video-0')),
        findsOneWidget,
      );

      await tester.tap(find.text('Post'));
      // The upload reads the clip off the disk: real time for the file, fake
      // time for the screens, in turn until the request is out.
      for (var i = 0; i < 10; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)),
        );
        await tester.pump(const Duration(milliseconds: 100));
      }
      await _settle(tester);

      final create = feed.requests.where(
        (r) => r.method == 'POST' && r.url.path.endsWith('/connect/posts'),
      );
      expect(create, hasLength(1));
      final sent = latin1.decode(create.single.bodyBytes);
      expect(
        sent,
        contains('name="pollOptionImages"; filename="clip.mp4"'),
        reason: 'the video goes up in the same field a picture does',
      );
      expect(sent, contains('video/mp4'));
      expect(sent, contains('name="pollOptionImageIndexes"'));
      expect(sent, contains('[0]'));
      await _tearDown(tester, feed.bloc);
    },
  );

  testWidgets(
    'a video poll plays in its tile and is voted on from the opened video',
    (tester) async {
      final feed = await _pumpFeed(tester, [_videoPoll()]);
      final tile = find.byKey(const ValueKey('poll-option-open-a'));
      await tester.ensureVisible(tile);
      await _settle(tester);

      // Each option is its video on the feed's player, with the video mark;
      // no picture is drawn for it.
      expect(find.byKey(const ValueKey('poll-option-video-a')), findsOneWidget);
      expect(find.byKey(const ValueKey('poll-option-video-b')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('poll-option-video-mark')),
        findsNWidgets(2),
      );
      expect(find.text('Moonwalk'), findsOneWidget);
      // One of them plays, muted, by the feed's rules.
      expect(videos.plays.where((e) => e.$2), isNotEmpty);
      expect(videos.allMuted, isTrue);
      final tilePlayers = {for (final e in videos.plays) e.$1};

      await tester.tap(tile);
      await _settle(tester);
      expect(_viewer, findsOneWidget);
      final inViewer = find.descendant(
        of: _viewer,
        matching: find.byKey(const ValueKey('poll-option-viewer-video-a')),
      );
      expect(inViewer, findsOneWidget);
      // The opened video is the one playing; the tiles behind it stand still.
      final viewerPlayer = videos.plays
          .map((e) => e.$1)
          .firstWhere((id) => !tilePlayers.contains(id));
      expect(videos.playing(viewerPlayer), isTrue);
      for (final id in tilePlayers) {
        expect(videos.playing(id), isFalse, reason: 'tile player $id');
      }
      // Its sound and full-screen buttons are there, as on a video post.
      expect(
        find.descendant(
          of: _viewer,
          matching: find.bySemanticsLabel('Sound on'),
        ),
        findsOneWidget,
      );

      await tester.tap(_voteButton);
      await tester.pump();
      expect(feed.votes.single.$1, 'a');
      expect(
        find.descendant(of: _viewer, matching: find.text('Voted')),
        findsOneWidget,
      );
      feed.votes.single.$2.complete(_ok({'post': _videoPoll(selected: 'a')}));
      await _settle(tester);
      expect(
        find.descendant(of: _viewer, matching: find.text('1 vote')),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const ValueKey('poll-option-viewer-close')));
      await _settle(tester);
      expect(_viewer, findsNothing);
      await _tearDown(tester, feed.bloc);
    },
  );

  testWidgets(
    'a poll posts with no question and an option that is only a video',
    (tester) async {
      final dir = Directory.systemTemp.createTempSync('poll-no-text-test');
      addTearDown(() => dir.deleteSync(recursive: true));
      final clip = File('${dir.path}/clip.mp4')
        ..writeAsBytesSync(List.filled(2048, 7));
      const picker = MethodChannel('miguelruivo.flutter.plugins.filepicker');
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(picker, (call) async {
        return [
          {'name': 'clip.mp4', 'path': clip.path, 'size': 2048},
        ];
      });
      addTearDown(() => messenger.setMockMethodCallHandler(picker, null));

      final feed = await _pumpFeed(tester, const []);
      await _openPollEditor(tester);
      await tester.tap(find.text('Media'));
      await tester.pump();
      // No question, the first option only a video, the second only words.
      await tester.enterText(find.byType(TextField).at(2), 'Robot');
      await tester.tap(find.bySemanticsLabel('Add a photo or video').first);
      await _settle(tester);
      await tester.tap(find.text('Done'));
      await _settle(tester, 5);
      await tester.tap(find.text('Post'));
      for (var i = 0; i < 10; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)),
        );
        await tester.pump(const Duration(milliseconds: 100));
      }
      await _settle(tester);

      expect(
        find.textContaining('Add at least two poll options'),
        findsNothing,
      );
      final create = feed.requests.where(
        (r) => r.method == 'POST' && r.url.path.endsWith('/connect/posts'),
      );
      expect(create, hasLength(1));
      final sent = latin1.decode(create.single.bodyBytes);
      // The video stays on the first option, the one it was chosen for.
      expect(sent, contains('name="pollOptionImages"; filename="clip.mp4"'));
      expect(sent, contains('name="pollOptionImageIndexes"'));
      expect(sent, contains('[0]'));
      expect(sent, contains('Robot'));
      await _tearDown(tester, feed.bloc);
    },
  );

  testWidgets('a poll with pictures still draws them as pictures', (
    tester,
  ) async {
    const picture =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    final poll = _videoPoll();
    for (final option in (poll['body'] as Map)['options'] as List) {
      (option as Map)
        ..remove('videoUrl')
        ..remove('mediaKind')
        ..['imageUrl'] = picture;
    }
    final feed = await _pumpFeed(tester, [poll]);
    await tester.ensureVisible(
      find.byKey(const ValueKey('poll-option-image-a')),
    );
    await _settle(tester);
    expect(find.byType(FeedVideo), findsNothing);
    expect(find.byKey(const ValueKey('poll-option-video-mark')), findsNothing);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('poll-option-image-a')),
        matching: find.byType(Image),
      ),
      findsOneWidget,
    );
    await _tearDown(tester, feed.bloc);
  });
}
