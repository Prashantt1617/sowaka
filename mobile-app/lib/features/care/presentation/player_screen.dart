import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../data/care_models.dart';
import 'care_theme.dart';

enum PlayerKind { audio, video }

/// Where a sound or a video plays. Without a file yet, it says so and holds
/// the place, so the shelf reads the same before and after Sowaka's media.
class PlayerScreen extends StatelessWidget {
  const PlayerScreen({super.key, required this.track, required this.backLabel, required this.kind});

  final CareTrack track;
  final String backLabel;
  final PlayerKind kind;

  @override
  Widget build(BuildContext context) {
    final url = track.url;
    final isVideo = kind == PlayerKind.video;
    return CarePage(
      backLabel: backLabel,
      children: [
        CareEyebrow(isVideo ? 'Video session' : 'Audio session'),
        const SizedBox(height: 10),
        CareHeading(track.title, size: 28),
        const SizedBox(height: 6),
        CareCopy(track.meta),
        const SizedBox(height: 22),
        if (url == null || url.isEmpty)
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(color: CareColors.sage, borderRadius: BorderRadius.circular(22)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(isVideo ? Icons.videocam_outlined : Icons.headphones_outlined, color: CareColors.blue, size: 30),
                const SizedBox(height: 14),
                const CareSectionTitle('A moment to settle in.'),
                const SizedBox(height: 6),
                CareCopy(isVideo ? 'Follow along at your own pace.' : 'Find a comfortable place and listen in your own time.'),
                const SizedBox(height: 14),
                const CareMicro('This recording is on its way. It will play here as soon as Sowaka adds it.'),
              ],
            ),
          )
        else
          ClipRRect(
            borderRadius: BorderRadius.circular(22),
            child: SizedBox(height: isVideo ? 240 : 200, child: InlineVideo(url: url, title: track.title, audioOnly: !isVideo)),
          ),
      ],
    );
  }
}

/// A network clip with a play/pause control and a scrubber. Audio files play
/// through the same player, drawn as a calm tile rather than a black frame.
class InlineVideo extends StatefulWidget {
  const InlineVideo({super.key, required this.url, required this.title, this.audioOnly = false, this.loop = false});

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
    final controller = VideoPlayerController.networkUrl(Uri.parse(widget.url));
    _controller = controller;
    controller.initialize().then((_) {
      if (!mounted) return;
      controller.setLooping(widget.loop);
      setState(() {});
    }).catchError((_) {
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
      return const ColoredBox(color: CareColors.blueTint, child: Center(child: CareCopy('Could not load this file.')));
    }
    if (controller == null || !controller.value.isInitialized) {
      return const ColoredBox(color: CareColors.blueTint, child: Center(child: CircularProgressIndicator(color: CareColors.blue)));
    }
    final playing = controller.value.isPlaying;
    return Stack(
      fit: StackFit.expand,
      children: [
        if (widget.audioOnly)
          const ColoredBox(color: CareColors.sage, child: Icon(Icons.graphic_eq_rounded, color: CareColors.blue, size: 48))
        else
          FittedBox(
            fit: BoxFit.cover,
            clipBehavior: Clip.hardEdge,
            child: SizedBox(width: controller.value.size.width, height: controller.value.size.height, child: VideoPlayer(controller)),
          ),
        Center(
          child: Material(
            color: Colors.white.withValues(alpha: 0.9),
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: () => playing ? controller.pause() : controller.play(),
              child: SizedBox(width: 60, height: 60, child: Icon(playing ? Icons.pause_rounded : Icons.play_arrow_rounded, color: CareColors.blue, size: 36)),
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
            colors: const VideoProgressColors(playedColor: CareColors.blue, bufferedColor: Colors.white70, backgroundColor: Colors.white38),
          ),
        ),
      ],
    );
  }
}
