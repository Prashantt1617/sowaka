import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:video_player/video_player.dart';

import '../../../services/api_config.dart';
import '../../shared/network_status.dart';

/// A video posted to the feed, or picked for a post and not yet sent. It
/// shows its first frame until tapped, then plays where it is, at its own
/// shape: portrait stays portrait, landscape stays landscape. A tap pauses
/// it, and the corner button opens it full screen on the same player, so it
/// carries on from where it was.
///
/// Only one plays at a time, and one scrolled mostly out of sight pauses.
/// The player is made when the card is built and goes with it, so only the
/// cards near the screen hold one.
///
/// Given a [header], it is a video post's own card (node 3752:27075): who
/// posted it over the top of the video on a shade that keeps it legible, and
/// the sound toggle in the bottom corner, in the feed and full screen alike.
class FeedVideo extends StatefulWidget {
  const FeedVideo({super.key, required String this.url, this.header}) : filePath = null;

  /// A file on this phone: the composer's preview of what is about to go up.
  const FeedVideo.file({super.key, required String path})
      : url = null,
        filePath = path,
        header = null;

  /// The API's `/media/...` path, or a whole URL.
  final String? url;
  final String? filePath;

  /// The author row laid over the top of the video. Null keeps the plain
  /// player, as the composer shows it.
  final FeedVideoHeaderBuilder? header;

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

  VideoPlayerController? _controller;
  bool _failed = false;

  /// Tapped before the player was ready: it plays as soon as it is.
  bool _wantsPlay = false;
  ScrollPosition? _scroll;

  @override
  void initState() {
    super.initState();
    NetworkStatus.offline.addListener(_onNetworkChanged);
    _open();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final scroll = Scrollable.maybeOf(context)?.position;
    if (scroll != _scroll) {
      _scroll?.removeListener(_pauseIfOutOfSight);
      _scroll = scroll?..addListener(_pauseIfOutOfSight);
    }
  }

  @override
  void didUpdateWidget(covariant FeedVideo old) {
    super.didUpdateWidget(old);
    if (old.url != widget.url || old.filePath != widget.filePath) _reopen();
  }

  @override
  void dispose() {
    NetworkStatus.offline.removeListener(_onNetworkChanged);
    _scroll?.removeListener(_pauseIfOutOfSight);
    if (identical(_playing, this)) _playing = null;
    _controller?.dispose();
    super.dispose();
  }

  void _open() {
    final path = widget.filePath;
    final controller = path != null
        ? VideoPlayerController.file(File(path))
        : VideoPlayerController.networkUrl(Uri.parse(resolveMediaUrl(widget.url!)));
    _controller = controller;
    controller.initialize().then((_) {
      if (!mounted || !identical(_controller, controller)) return;
      setState(() {});
      if (_wantsPlay) _play();
    }).catchError((Object _) {
      if (mounted && identical(_controller, controller)) setState(() => _failed = true);
    });
  }

  void _reopen() {
    final old = _controller;
    if (identical(_playing, this)) _playing = null;
    setState(() {
      _failed = false;
      _wantsPlay = false;
    });
    _open();
    old?.dispose();
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
    _wantsPlay = false;
    final value = controller.value;
    // Played to the end: from the start again.
    if (value.duration > Duration.zero && value.position >= value.duration) {
      controller.seekTo(Duration.zero);
    }
    controller.play();
  }

  void _pause() {
    _controller?.pause();
    if (identical(_playing, this)) _playing = null;
  }

  void _toggle() {
    final controller = _controller;
    if (_failed) return _reopen();
    if (controller == null || !controller.value.isInitialized) {
      setState(() => _wantsPlay = !_wantsPlay);
      return;
    }
    controller.value.isPlaying ? _pause() : _play();
  }

  /// Pauses once less than a third of it is on screen.
  void _pauseIfOutOfSight() {
    final controller = _controller;
    if (controller == null || !controller.value.isPlaying || !mounted) return;
    final box = context.findRenderObject();
    if (box is! RenderBox || !box.hasSize || !box.attached) return;
    final top = box.localToGlobal(Offset.zero).dy;
    final height = box.size.height;
    final screen = MediaQuery.sizeOf(context).height;
    final visible = (top + height).clamp(0.0, screen) - top.clamp(0.0, screen);
    if (height > 0 && visible / height < 1 / 3) _pause();
  }

  Future<void> _openFullScreen() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;
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
  }

  /// A frame with no picture yet (loading, or failed) still says who posted
  /// it, on a video post.
  Widget _withHeader(Widget child) {
    final header = widget.header;
    if (header == null) return child;
    return Stack(
      fit: StackFit.expand,
      children: [
        const _TopShade(),
        child,
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
            onTap: _toggle,
            child: _withHeader(
              Center(
                child: _wantsPlay
                    ? const SizedBox(
                        width: 28,
                        height: 28,
                        child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                      )
                    : const _PlayButton(icon: Icons.play_arrow_rounded),
              ),
            ),
          );
        }
        final ended = value.duration > Duration.zero && value.position >= value.duration && !value.isPlaying;
        final left = value.isPlaying ? value.duration - value.position : value.duration;
        // At the shape it was filmed: a portrait clip stands tall, a
        // landscape one lies wide. Only something stranger than 9:16 or
        // 16:9 is trimmed to fit.
        final ratio = value.aspectRatio.clamp(9 / 16, 16 / 9);
        void toggleSound() => controller.setVolume(value.volume == 0 ? 1 : 0);
        return _VideoFrame(
          aspectRatio: ratio,
          onTap: _toggle,
          child: Stack(
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
              if (!value.isPlaying)
                Center(
                  child: value.isBuffering && _wantsPlay
                      ? const CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white)
                      : _PlayButton(icon: ended ? Icons.replay_rounded : Icons.play_arrow_rounded),
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
  const _VideoFrame({required this.aspectRatio, required this.onTap, required this.child});

  final double aspectRatio;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
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
