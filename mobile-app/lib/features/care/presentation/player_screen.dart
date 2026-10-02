import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../../../services/api_config.dart';
import '../data/care_models.dart';
import 'care_theme.dart';
import 'siri_wave.dart';

enum PlayerKind { audio, video }

/// Where a sound or a video plays. Without a file yet, it says so and holds
/// the place, so the shelf reads the same before and after Sowaka's media.
class PlayerScreen extends StatelessWidget {
  const PlayerScreen({
    super.key,
    required this.track,
    required this.backLabel,
    required this.kind,
    this.night = false,
  });

  final CareTrack track;
  final String backLabel;
  final PlayerKind kind;

  /// Opened from Sleep: the same night sky behind it, the words in white.
  final bool night;

  @override
  Widget build(BuildContext context) {
    final url = track.url;
    final isVideo = kind == PlayerKind.video;
    final page = CarePage(
      backLabel: backLabel,
      background: night ? Colors.transparent : CareColors.bg,
      children: [
        // The app's bar already names the page on the web.
        if (!careWebPages) ...[
          CareEyebrow(isVideo ? 'Video session' : 'Audio session'),
          const SizedBox(height: 10),
        ],
        CareHeading(
          track.title,
          size: 28,
          color: night ? Colors.white : CareColors.ink,
        ),
        const SizedBox(height: 6),
        CareCopy(track.meta, color: night ? Colors.white70 : CareColors.muted),
        const SizedBox(height: 22),
        if (url == null || url.isEmpty)
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              color: CareColors.sage,
              borderRadius: BorderRadius.circular(22),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  isVideo ? Icons.videocam_outlined : Icons.headphones_outlined,
                  color: CareColors.blue,
                  size: 30,
                ),
                const SizedBox(height: 14),
                const CareSectionTitle('A moment to settle in.'),
                const SizedBox(height: 6),
                CareCopy(
                  isVideo
                      ? 'Follow along at your own pace.'
                      : 'Find a comfortable place and listen in your own time.',
                ),
                const SizedBox(height: 14),
                const CareMicro(
                  'This recording is on its way. It will play here as soon as Sowaka adds it.',
                ),
              ],
            ),
          )
        else
          ClipRRect(
            borderRadius: BorderRadius.circular(22),
            child: SizedBox(
              height: isVideo ? 240 : 360,
              child: InlineVideo(
                url: url,
                title: track.title,
                audioOnly: !isVideo,
              ),
            ),
          ),
      ],
    );
    if (!night) return page;
    return Stack(
      fit: StackFit.expand,
      children: [
        const ColoredBox(color: Color(0xFF0B1118)),
        Image.asset(
          'assets/care/sleep_background.jpg',
          fit: BoxFit.cover,
          alignment: Alignment.topCenter,
        ),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0x80000000), Color(0x14000000), Color(0x99000000)],
              stops: [0, 0.45, 1],
            ),
          ),
        ),
        page,
      ],
    );
  }
}

/// A network clip with a play/pause control and a scrubber. Audio files play
/// through the same player, drawn as a calm tile rather than a black frame.
class InlineVideo extends StatefulWidget {
  const InlineVideo({
    super.key,
    required this.url,
    required this.title,
    this.audioOnly = false,
    this.loop = false,
  });

  final String url;
  final String title;
  final bool audioOnly;
  final bool loop;

  @override
  State<InlineVideo> createState() => _InlineVideoState();
}

class _InlineVideoState extends State<InlineVideo> {
  VideoPlayerController? _controller;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    final controller = VideoPlayerController.networkUrl(
      Uri.parse(resolveMediaUrl(widget.url)),
    );
    _controller = controller;
    controller
        .initialize()
        .then((_) {
          if (!mounted) return;
          controller.setLooping(widget.loop);
          setState(() {});
        })
        .catchError((_) {
          if (mounted) setState(() => _failed = true);
        });
    controller.addListener(_onTick);
  }

  void _onTick() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _controller?.removeListener(_onTick);
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (_failed) {
      return const ColoredBox(
        color: CareColors.blueTint,
        child: Center(child: CareCopy('Could not load this file.')),
      );
    }
    if (controller == null || !controller.value.isInitialized) {
      return const ColoredBox(
        color: CareColors.blueTint,
        child: Center(child: CircularProgressIndicator(color: CareColors.blue)),
      );
    }
    final playing = controller.value.isPlaying;
    if (widget.audioOnly)
      return _AudioPlayer(controller: controller, playing: playing);
    return Stack(
      fit: StackFit.expand,
      children: [
        FittedBox(
          fit: BoxFit.cover,
          clipBehavior: Clip.hardEdge,
          child: SizedBox(
            width: controller.value.size.width,
            height: controller.value.size.height,
            child: VideoPlayer(controller),
          ),
        ),
        Center(
          child: Material(
            color: Colors.white.withValues(alpha: 0.9),
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: () => playing ? controller.pause() : controller.play(),
              child: SizedBox(
                width: 60,
                height: 60,
                child: Icon(
                  playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
                  color: CareColors.blue,
                  size: 36,
                ),
              ),
            ),
          ),
        ),
        Positioned(
          left: 12,
          right: 12,
          bottom: 10,
          child: VideoProgressIndicator(
            controller,
            allowScrubbing: true,
            colors: const VideoProgressColors(
              playedColor: CareColors.blue,
              bufferedColor: Colors.white70,
              backgroundColor: Colors.white38,
            ),
          ),
        ),
      ],
    );
  }
}

String _clock(Duration d) {
  final m = d.inMinutes.remainder(600).toString();
  final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
  return '$m:$s';
}

/// The sound player: a deep blue field with the wave moving while it plays,
/// the play button under it, and the time along the bottom.
class _AudioPlayer extends StatelessWidget {
  const _AudioPlayer({required this.controller, required this.playing});

  final VideoPlayerController controller;
  final bool playing;

  @override
  Widget build(BuildContext context) {
    final position = controller.value.position;
    final duration = controller.value.duration;
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF0B2740), Color(0xFF0B4A78), Color(0xFF0571A6)],
        ),
      ),
      child: Column(
        children: [
          const SizedBox(height: 26),
          Expanded(child: SiriWave(playing: playing, height: 180)),
          Material(
            color: Colors.white,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: () => playing ? controller.pause() : controller.play(),
              child: SizedBox(
                width: 66,
                height: 66,
                child: Icon(
                  playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
                  color: CareColors.blue,
                  size: 38,
                ),
              ),
            ),
          ),
          const SizedBox(height: 18),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 0, 18, 16),
            child: Column(
              children: [
                VideoProgressIndicator(
                  controller,
                  allowScrubbing: true,
                  padding: EdgeInsets.zero,
                  colors: const VideoProgressColors(
                    playedColor: Colors.white,
                    bufferedColor: Colors.white38,
                    backgroundColor: Colors.white24,
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Text(
                      _clock(position),
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: Colors.white70,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const Spacer(),
                    Text(
                      _clock(duration),
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: Colors.white70,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
