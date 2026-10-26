import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:video_player/video_player.dart';

import '../../../services/api_config.dart';
import '../../shared/network_status.dart';

/// Where feed videos are kept on the phone once watched, so a loop, a scroll
/// back or the next launch plays the file rather than streaming it again.
///
/// One `.mov` was fetched 3,832 times in 17 hours, mostly as ranged pieces:
/// the player streamed it afresh on every loop, and nothing was kept.
class FeedVideoCache {
  const FeedVideoCache();

  /// Keeps nothing and finds nothing: every video streams. For tests, which
  /// have no disk.
  static const FeedVideoCache none = _NoVideoCache();

  static final CacheManager _files = CacheManager(
    Config(
      'feedVideos',
      // A video's key never changes, so a kept copy never goes stale; these
      // bound the space it takes, oldest seen first out.
      stalePeriod: const Duration(days: 14),
      maxNrOfCacheObjects: 30,
    ),
  );

  static final Set<String> _keeping = <String>{};

  /// The phone's copy of [url], or null when there is none (yet).
  Future<File?> cached(String url) async {
    try {
      return (await _files.getFileFromCache(url))?.file;
    } catch (_) {
      return null;
    }
  }

  /// Downloads [url] to the phone in the background, once, for next time.
  void keep(String url) {
    if (!_keeping.add(url)) return;
    unawaited(
      _files.downloadFile(url).then<void>((_) {}, onError: (Object _) {}).whenComplete(() => _keeping.remove(url)),
    );
  }
}

class _NoVideoCache extends FeedVideoCache {
  const _NoVideoCache();

  @override
  Future<File?> cached(String url) async => null;

  @override
  void keep(String url) {}
}

/// A video posted to the feed, or picked for a post and not yet sent. As on
/// Instagram it has no play button: it plays by itself, looping, once most
/// of it is on screen, and stops once it is scrolled away or its screen is
/// covered. It starts muted; a tap turns the sound on or off, and that
/// choice holds for the next video too. Holding a finger on it pauses it
/// until let go. It plays at its own shape: portrait stays portrait,
/// landscape stays landscape. The corner button opens it full screen on the
/// same player, so it carries on from where it was.
///
/// Only one plays at a time. The player is made only once a quarter of the
/// card is on screen, not when the card is built (the list builds cards well
/// ahead of the screen, and each one used to start downloading its video),
/// and goes with the card. Until then the card shows a still frame. The
/// first play streams while a copy is downloaded to the phone; every loop
/// after, and every later showing, plays that copy.
///
/// Given a [header], it is a video post's own card (node 3752:27075): who
/// posted it over the top of the video on a shade that keeps it legible, and
/// the sound toggle in the bottom corner, in the feed and full screen alike.
class FeedVideo extends StatefulWidget {
  const FeedVideo({super.key, required String this.url, this.header, this.surfaceWrapper})
      : filePath = null;

  /// A file on this phone: the composer's preview of what is about to go up.
  const FeedVideo.file({super.key, required String path})
      : url = null,
        filePath = path,
        header = null,
        surfaceWrapper = null;

  /// The API's `/media/...` path, or a whole URL.
  final String? url;
  final String? filePath;

  /// The author row laid over the top of the video. Null keeps the plain
  /// player, as the composer shows it.
  final FeedVideoHeaderBuilder? header;

  /// Wraps the picture itself — not the author row, the menu or the buttons
  /// over it — so the feed can take a double-tap on the video alone.
  final Widget Function(Widget surface)? surfaceWrapper;

  Widget _wrap(Widget surface) => surfaceWrapper?.call(surface) ?? surface;

  /// Back to muted, as the app opens: each test starts where a person would.
  @visibleForTesting
  static void resetSound() => _FeedVideoState._soundOn = false;

  /// Where watched videos are kept; [FeedVideoCache.none] in tests.
  static FeedVideoCache cache = const FeedVideoCache();

  @override
  State<FeedVideo> createState() => _FeedVideoState();
}

/// Builds the author row over a video post. In the feed [closeButton] is null
/// and the row ends in the post's menu; full screen it is the way back, and
/// stands where the menu was.
typedef FeedVideoHeaderBuilder = Widget Function(BuildContext context, Widget? closeButton);

/// How far in from the edges a video post's overlays sit (node 3752:27075):
/// 12 from the sides, 22 from the top and bottom.
const double _chromeSide = 12;
const double _chromeTop = 22;

/// The sound toggle's own 4 of padding in the design's corner button.
const double _cornerPad = 4;

class _FeedVideoState extends State<FeedVideo> {
  /// The one playing now, paused when another starts.
  static _FeedVideoState? _playing;

  /// Sound on or off, for every video: off until someone taps for it.
  static bool _soundOn = false;

  /// How much of it must be on screen for it to start, and how little before
  /// it stops: apart, so one on the edge does not flicker.
  static const double _startAt = 0.6;
  static const double _stopBelow = 0.5;

  /// How much of it must be on screen before its player is made at all.
  static const double _openAt = 0.25;

  VideoPlayerController? _controller;
  bool _failed = false;

  /// A player is on its way (the phone's copy is being looked for).
  bool _opening = false;

  /// Bumped whenever the player is thrown away, so one still being made for
  /// the old video is not put in its place.
  int _generation = 0;

  /// Playing from the network rather than the phone's copy: it does not loop
  /// by itself, since a looping network player streams the whole video again
  /// each time round; at the end it moves to the copy, once there is one.
  bool _streaming = false;
  bool _looping = false;

  /// Held down: paused until the finger lifts.
  bool _held = false;

  /// Full screen, on this player: its own screen covers the feed, but it
  /// plays on.
  bool _fullScreen = false;

  /// Its screen is showing: not a tab in the background, not under another
  /// page.
  bool _shown = true;
  ScrollPosition? _scroll;

  @override
  void initState() {
    super.initState();
    NetworkStatus.offline.addListener(_onNetworkChanged);
    // A file on this phone costs nothing to open; a posted video waits until
    // it is on screen (see [_followSight]).
    if (widget.filePath != null) unawaited(_open());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final scroll = Scrollable.maybeOf(context)?.position;
    if (scroll != _scroll) {
      _scroll?.removeListener(_followSight);
      _scroll = scroll?..addListener(_followSight);
    }
    // A tab in the background, or a page pushed over the feed.
    final shown = TickerMode.valuesOf(context).enabled && Visibility.of(context);
    if (shown != _shown) {
      _shown = shown;
      if (!shown && !_fullScreen) _pause();
    }
    _followSightSoon();
  }

  @override
  void didUpdateWidget(covariant FeedVideo old) {
    super.didUpdateWidget(old);
    if (old.url != widget.url || old.filePath != widget.filePath) _reopen();
  }

  @override
  void dispose() {
    NetworkStatus.offline.removeListener(_onNetworkChanged);
    _scroll?.removeListener(_followSight);
    if (identical(_playing, this)) _playing = null;
    _generation += 1;
    _controller?.removeListener(_onTick);
    _controller?.dispose();
    super.dispose();
  }

  String get _url => resolveMediaUrl(widget.url!);

  /// Makes the player: on the phone's copy when there is one, else streaming.
  Future<void> _open() async {
    if (_opening || _controller != null) return;
    _opening = true;
    final generation = _generation;
    final path = widget.filePath;
    final File? kept = path != null ? null : await FeedVideo.cache.cached(_url);
    _opening = false;
    if (!mounted || generation != _generation) return;
    _streaming = path == null && kept == null;
    final controller = path != null
        ? VideoPlayerController.file(File(path))
        : kept != null
        ? VideoPlayerController.file(kept)
        : VideoPlayerController.networkUrl(Uri.parse(_url));
    controller.addListener(_onTick);
    setState(() => _controller = controller);
    controller.initialize().then((_) {
      if (!mounted || !identical(_controller, controller)) return;
      controller.setLooping(!_streaming);
      controller.setVolume(_soundOn ? 1 : 0);
      setState(() {});
      _followSightSoon();
    }).catchError((Object _) {
      if (mounted && identical(_controller, controller)) setState(() => _failed = true);
    });
  }

  /// Thrown away and made again: a retry, or another video in this card.
  void _reopen() {
    final old = _controller;
    if (identical(_playing, this)) _playing = null;
    _generation += 1;
    _opening = false;
    old?.removeListener(_onTick);
    setState(() {
      _failed = false;
      _controller = null;
    });
    old?.dispose();
    if (widget.filePath != null) {
      unawaited(_open());
    } else {
      _followSightSoon();
    }
  }

  /// A streamed video that has played to its end goes round again: on the
  /// phone's copy if it has arrived (from then on it loops by itself, with
  /// nothing more downloaded), else streamed once more.
  void _onTick() {
    final controller = _controller;
    if (controller == null || !_streaming || _looping || !controller.value.isCompleted) return;
    _looping = true;
    unawaited(_loopAgain(controller).whenComplete(() => _looping = false));
  }

  Future<void> _loopAgain(VideoPlayerController streamed) async {
    final generation = _generation;
    final keepGoing = identical(_playing, this) && !_held;
    // Full screen holds this player, so it stays on it until it is back.
    final kept = _fullScreen ? null : await FeedVideo.cache.cached(_url);
    if (!mounted || generation != _generation || !identical(_controller, streamed)) return;
    if (kept != null) {
      final local = VideoPlayerController.file(kept);
      try {
        await local.initialize();
      } catch (_) {
        await local.dispose();
        return _streamAgain(streamed, keepGoing);
      }
      if (!mounted || generation != _generation || !identical(_controller, streamed)) {
        await local.dispose();
        return;
      }
      await local.setLooping(true);
      await local.setVolume(streamed.value.volume);
      local.addListener(_onTick);
      streamed.removeListener(_onTick);
      _streaming = false;
      setState(() => _controller = local);
      if (identical(_playing, this) && !_held) unawaited(local.play());
      await streamed.dispose();
      return;
    }
    await _streamAgain(streamed, keepGoing);
  }

  Future<void> _streamAgain(VideoPlayerController streamed, bool keepGoing) async {
    await streamed.seekTo(Duration.zero);
    if (keepGoing && identical(_playing, this) && !_held) await streamed.play();
  }

  void _onNetworkChanged() {
    if (_failed && !NetworkStatus.offline.value) _reopen();
  }

  void _play() {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;
    final other = _playing;
    if (other != null && !identical(other, this)) other._pause();
    _playing = this;
    controller.setVolume(_soundOn ? 1 : 0);
    controller.play();
    // Watched, not scrolled past: worth keeping on the phone for the loop.
    if (_streaming) FeedVideo.cache.keep(_url);
  }

  void _pause() {
    _controller?.pause();
    if (identical(_playing, this)) _playing = null;
  }

  /// A tap: the sound on or off, here and for every video after.
  void _toggleSound() {
    final controller = _controller;
    if (_failed) return _reopen();
    _soundOn = !_soundOn;
    controller?.setVolume(_soundOn ? 1 : 0);
    if (controller != null && controller.value.isInitialized && !controller.value.isPlaying && !_held) {
      _play();
    }
  }

  void _hold() {
    _held = true;
    _controller?.pause();
  }

  void _letGo() {
    _held = false;
    if (identical(_playing, this)) {
      _controller?.play();
    } else {
      _followSight();
    }
  }

  /// How much of it is on screen, 0 to 1.
  double _inSight() {
    if (!mounted) return 0;
    final box = context.findRenderObject();
    if (box is! RenderBox || !box.hasSize || !box.attached) return 0;
    final top = box.localToGlobal(Offset.zero).dy;
    final height = box.size.height;
    final screen = MediaQuery.sizeOf(context).height;
    final visible = (top + height).clamp(0.0, screen) - top.clamp(0.0, screen);
    return height > 0 ? visible / height : 0;
  }

  /// Plays once most of it is on screen and nothing else is playing in
  /// plain sight; stops once it is mostly gone.
  void _followSight() {
    final controller = _controller;
    if (!mounted) return;
    if (controller == null) {
      // Not made yet: made once enough of it is in sight.
      if (!_failed && _shown && widget.url != null && _inSight() >= _openAt) unawaited(_open());
      return;
    }
    if (!controller.value.isInitialized || _fullScreen) return;
    final seen = _shown ? _inSight() : 0.0;
    if (controller.value.isPlaying || identical(_playing, this)) {
      if (seen < _stopBelow) _pause();
      return;
    }
    if (_held || seen < _startAt) return;
    final other = _playing;
    if (other != null && other._inSight() >= _startAt) return;
    _play();
  }

  /// After this frame is laid out, so its place on screen is known.
  void _followSightSoon() {
    WidgetsBinding.instance.addPostFrameCallback((_) => _followSight());
  }

  Future<void> _openFullScreen() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;
    _fullScreen = true;
    if (!controller.value.isPlaying) _play();
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => _FullScreenVideo(
          controller: controller,
          onPlay: _play,
          onPause: _pause,
          header: widget.header,
        ),
      ),
    );
    _fullScreen = false;
    // Sound turned on or off full screen holds here too.
    _soundOn = controller.value.volume > 0;
    if (mounted) _followSightSoon();
  }

  /// A frame with no picture yet (loading, or failed) still says who posted
  /// it, on a video post.
  Widget _withHeader(Widget child) {
    final header = widget.header;
    if (header == null) return child;
    return Stack(
      fit: StackFit.expand,
      children: [
        widget._wrap(Stack(fit: StackFit.expand, children: [const _TopShade(), child])),
        Positioned(
          left: _chromeSide,
          top: _chromeTop,
          right: _chromeSide,
          child: header(context, null),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    final header = widget.header;
    if (!_failed && controller == null) {
      // Not on screen yet, so no player and nothing downloaded: a still
      // frame in its place, with who posted it. (The server keeps no poster
      // image of a video yet, so the frame is plain.)
      return _VideoFrame(
        aspectRatio: 4 / 5,
        onTap: () => unawaited(_open()),
        child: _withHeader(
          const Center(
            child: Icon(Icons.movie_outlined, size: 32, color: Color(0x99FFFFFF)),
          ),
        ),
      );
    }
    if (_failed || controller == null) {
      return _VideoFrame(
        aspectRatio: 4 / 5,
        onTap: _reopen,
        child: _withHeader(
          const _VideoMessage(
            icon: Icons.videocam_off_outlined,
            title: "Couldn't load video",
            action: 'Tap to retry',
          ),
        ),
      );
    }
    return ValueListenableBuilder<VideoPlayerValue>(
      valueListenable: controller,
      builder: (context, value, _) {
        if (!value.isInitialized) {
          return _VideoFrame(
            aspectRatio: 4 / 5,
            onTap: _toggleSound,
            child: _withHeader(
              const Center(
                child: SizedBox(
                  width: 28,
                  height: 28,
                  child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                ),
              ),
            ),
          );
        }
        final left = value.duration - value.position;
        // At the shape it was filmed: a portrait clip stands tall, a
        // landscape one lies wide. Only something stranger than 9:16 or
        // 16:9 is trimmed to fit.
        final ratio = value.aspectRatio.clamp(9 / 16, 16 / 9);
        void toggleSound() => _toggleSound();
        return _VideoFrame(
          aspectRatio: ratio,
          onTap: _toggleSound,
          onHold: _hold,
          onLetGo: _letGo,
          child: Stack(
            fit: StackFit.expand,
            children: [
              widget._wrap(
                Stack(
                  fit: StackFit.expand,
                  children: [
                    ClipRect(
                      child: FittedBox(
                        fit: BoxFit.cover,
                        child: SizedBox(
                          width: value.size.width,
                          height: value.size.height,
                          child: VideoPlayer(controller),
                        ),
                      ),
                    ),
                    if (header != null) const _TopShade(),
                  ],
                ),
              ),
              if (value.isPlaying && value.isBuffering)
                const Center(child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white)),
              if (header == null) ...[
                Positioned(
                  left: 12,
                  bottom: 12,
                  child: _VideoChip(label: _clock(left.isNegative ? Duration.zero : left)),
                ),
                Positioned(
                  right: 8,
                  bottom: 8,
                  child: Row(
                    children: [
                      _RoundIconButton(
                        icon: value.volume == 0 ? Icons.volume_off_rounded : Icons.volume_up_rounded,
                        label: value.volume == 0 ? 'Sound on' : 'Mute',
                        onTap: toggleSound,
                      ),
                      const SizedBox(width: 6),
                      _RoundIconButton(
                        icon: Icons.fullscreen_rounded,
                        label: 'Full screen',
                        onTap: _openFullScreen,
                      ),
                    ],
                  ),
                ),
              ] else ...[
                Positioned(
                  left: _chromeSide,
                  top: _chromeTop,
                  right: _chromeSide,
                  child: header(context, null),
                ),
                // The sound toggle in the corner, as drawn, with full screen
                // beside it in the same glass circle.
                Positioned(
                  right: _chromeSide + _cornerPad - _ChromeButton.slop,
                  bottom: _chromeTop + _cornerPad - _ChromeButton.slop,
                  child: Row(
                    children: [
                      _ChromeButton(
                        label: 'Full screen',
                        onTap: _openFullScreen,
                        child: const Icon(Icons.fullscreen_rounded, size: 20, color: _chromeGlyph),
                      ),
                      _SoundToggle(muted: value.volume == 0, onTap: toggleSound),
                    ],
                  ),
                ),
              ],
              if (value.position > Duration.zero)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: VideoProgressIndicator(
                    controller,
                    allowScrubbing: false,
                    padding: EdgeInsets.zero,
                    colors: const VideoProgressColors(
                      playedColor: Colors.white,
                      bufferedColor: Color(0x66FFFFFF),
                      backgroundColor: Color(0x33FFFFFF),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

/// The video full screen, on the feed's own player: back to the feed, it
/// is where it was left.
class _FullScreenVideo extends StatelessWidget {
  const _FullScreenVideo({
    required this.controller,
    required this.onPlay,
    required this.onPause,
    this.header,
  });

  final VideoPlayerController controller;
  final VoidCallback onPlay;
  final VoidCallback onPause;

  /// A video post's author row, drawn again over the top here.
  final FeedVideoHeaderBuilder? header;

  @override
  Widget build(BuildContext context) {
    final header = this.header;
    if (header != null) return _buildPost(context, header);
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: ValueListenableBuilder<VideoPlayerValue>(
          valueListenable: controller,
          builder: (context, value, _) {
            final ended = value.duration > Duration.zero && value.position >= value.duration && !value.isPlaying;
            return Stack(
              children: [
                Positioned.fill(
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: value.isPlaying ? onPause : onPlay,
                    child: Center(
                      child: AspectRatio(
                        aspectRatio: value.aspectRatio,
                        child: VideoPlayer(controller),
                      ),
                    ),
                  ),
                ),
                if (!value.isPlaying)
                  IgnorePointer(
                    child: Center(
                      child: _PlayButton(icon: ended ? Icons.replay_rounded : Icons.play_arrow_rounded),
                    ),
                  ),
                Positioned(
                  top: 8,
                  left: 8,
                  child: _RoundIconButton(
                    icon: Icons.close_rounded,
                    label: 'Close',
                    onTap: () => Navigator.of(context).pop(),
                  ),
                ),
                Positioned(
                  left: 16,
                  right: 16,
                  bottom: 16,
                  child: Row(
                    children: [
                      _VideoChip(label: _clock(value.position)),
                      const SizedBox(width: 10),
                      Expanded(
                        child: SizedBox(
                          height: 20,
                          child: VideoProgressIndicator(
                            controller,
                            allowScrubbing: true,
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            colors: const VideoProgressColors(
                              playedColor: Colors.white,
                              bufferedColor: Color(0x66FFFFFF),
                              backgroundColor: Color(0x33FFFFFF),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      _VideoChip(label: _clock(value.duration)),
                      const SizedBox(width: 6),
                      _RoundIconButton(
                        icon: value.volume == 0 ? Icons.volume_off_rounded : Icons.volume_up_rounded,
                        label: value.volume == 0 ? 'Sound on' : 'Mute',
                        onTap: () => controller.setVolume(value.volume == 0 ? 1 : 0),
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  /// A video post full screen: the same author row over the same shade as in
  /// the feed, the way back where the post's menu was, and the clock, the
  /// scrubber and the sound toggle along the bottom.
  Widget _buildPost(BuildContext context, FeedVideoHeaderBuilder header) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: ValueListenableBuilder<VideoPlayerValue>(
        valueListenable: controller,
        builder: (context, value, _) {
          final ended = value.duration > Duration.zero && value.position >= value.duration && !value.isPlaying;
          return Stack(
            children: [
              Positioned.fill(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: value.isPlaying ? onPause : onPlay,
                  child: Center(
                    child: AspectRatio(
                      aspectRatio: value.aspectRatio,
                      child: VideoPlayer(controller),
                    ),
                  ),
                ),
              ),
              const Positioned.fill(child: _TopShade()),
              if (!value.isPlaying)
                IgnorePointer(
                  child: Center(
                    child: _PlayButton(icon: ended ? Icons.replay_rounded : Icons.play_arrow_rounded),
                  ),
                ),
              Positioned.fill(
                child: SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: _chromeSide,
                      vertical: _chromeTop,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        header(
                          context,
                          _ChromeButton(
                            label: 'Close',
                            onTap: () => Navigator.of(context).pop(),
                            child: const Icon(Icons.close_rounded, size: 20, color: _chromeGlyph),
                          ),
                        ),
                        const Spacer(),
                        Row(
                          children: [
                            _VideoChip(label: _clock(value.position)),
                            const SizedBox(width: 10),
                            Expanded(
                              child: SizedBox(
                                height: 20,
                                child: VideoProgressIndicator(
                                  controller,
                                  allowScrubbing: true,
                                  padding: const EdgeInsets.symmetric(vertical: 8),
                                  colors: const VideoProgressColors(
                                    playedColor: Colors.white,
                                    bufferedColor: Color(0x66FFFFFF),
                                    backgroundColor: Color(0x33FFFFFF),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            _VideoChip(label: _clock(value.duration)),
                            const SizedBox(width: 12 - _ChromeButton.slop),
                            // Its circle on the inset line, its tap slop past it.
                            Transform.translate(
                              offset: const Offset(_ChromeButton.slop, 0),
                              child: _SoundToggle(
                                muted: value.volume == 0,
                                onTap: () => controller.setVolume(value.volume == 0 ? 1 : 0),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// "1:05": minutes and seconds, as a video's clock reads.
String _clock(Duration duration) {
  final seconds = duration.inSeconds;
  return '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';
}

class _VideoFrame extends StatelessWidget {
  const _VideoFrame({
    required this.aspectRatio,
    required this.onTap,
    this.onHold,
    this.onLetGo,
    required this.child,
  });

  final double aspectRatio;
  final VoidCallback onTap;

  /// A finger held down, and lifted again.
  final VoidCallback? onHold;
  final VoidCallback? onLetGo;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      onLongPressStart: onHold == null ? null : (_) => onHold!(),
      onLongPressEnd: onLetGo == null ? null : (_) => onLetGo!(),
      child: AspectRatio(
        aspectRatio: aspectRatio,
        child: ColoredBox(color: const Color(0xFF15140F), child: child),
      ),
    );
  }
}

class _PlayButton extends StatelessWidget {
  const _PlayButton({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 56,
      height: 56,
      decoration: const BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        boxShadow: [BoxShadow(color: Color(0x33000000), blurRadius: 20, offset: Offset(0, 8))],
      ),
      child: Icon(icon, size: 34, color: const Color(0xFF15140F)),
    );
  }
}

class _VideoChip extends StatelessWidget {
  const _VideoChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 11,
          fontWeight: FontWeight.w700,
          fontFeatures: [FontFeature.tabularFigures()],
        ),
      ),
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(4),
          child: Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.55),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 20, color: Colors.white),
          ),
        ),
      ),
    );
  }
}

class _VideoMessage extends StatelessWidget {
  const _VideoMessage({required this.icon, required this.title, required this.action});

  final IconData icon;
  final String title;
  final String action;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 28, color: const Color(0xFFB9B4A8)),
          const SizedBox(height: 8),
          Text(
            title,
            style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 2),
          Text(
            action,
            style: const TextStyle(color: Color(0xFF8FD3F5), fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

/// The glyphs on a video post's glass buttons (node 3752:27075).
const _chromeGlyph = Color(0xFFEBEBEB);

/// The shade under a video post's author row: black at a third at the top,
/// clear by the bottom.
class _TopShade extends StatelessWidget {
  const _TopShade();

  @override
  Widget build(BuildContext context) {
    return const IgnorePointer(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0x57000000), Color(0x00000000)],
          ),
        ),
      ),
    );
  }
}

/// A 30px glass circle on a video post, the design's grey at 39%. It takes
/// taps a little past its edge, so it is easier to hit than it looks.
class _ChromeButton extends StatelessWidget {
  const _ChromeButton({required this.label, required this.onTap, required this.child});

  /// How far past the circle a tap still counts.
  static const double slop = 6;

  final String label;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(slop),
          child: Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: const BoxDecoration(color: Color(0x638A8A8A), shape: BoxShape.circle),
            child: child,
          ),
        ),
      ),
    );
  }
}

/// The sound toggle in a video post's corner: the struck-through speaker
/// while it is muted, the speaker with its waves while the sound is on.
class _SoundToggle extends StatelessWidget {
  const _SoundToggle({required this.muted, required this.onTap});

  final bool muted;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: muted ? 'Sound on' : 'Mute',
      child: GestureDetector(
        key: const ValueKey('feed-video-sound'),
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(_ChromeButton.slop),
          child: SvgPicture.asset(
            muted ? 'assets/icons/connect_video_muted.svg' : 'assets/icons/connect_video_sound_on.svg',
            width: 30,
            height: 30,
          ),
        ),
      ),
    );
  }
}
