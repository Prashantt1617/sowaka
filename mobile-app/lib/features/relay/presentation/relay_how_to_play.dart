import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import 'relay_style.dart';

/// The rules, before anybody plays them (Figma 2606:35931).
///
/// There is no operator on the day and no practice round, so this is where a
/// team learns that only one screen holds each clue. Nothing gates on watching
/// it — players move between here and the lobby freely until the game starts.
class RelayHowToPlay extends StatefulWidget {
  const RelayHowToPlay({
    super.key,
    required this.videoUrl,
    required this.pointsPerCorrect,
    this.onClose,
    this.onViewTeam,
    this.onViewLobby,
  });

  final String videoUrl;

  /// From the event, so this screen cannot promise a different number.
  final int pointsPerCorrect;

  final VoidCallback? onClose;
  final VoidCallback? onViewTeam;
  final VoidCallback? onViewLobby;

  @override
  State<RelayHowToPlay> createState() => _RelayHowToPlayState();
}

class _RelayHowToPlayState extends State<RelayHowToPlay> {
  VideoPlayerController? _controller;
  bool _unavailable = false;

  /// The fallback note only appears once somebody has actually tried to play.
  bool _triedToPlay = false;

  @override
  void initState() {
    super.initState();
    _prepare();
  }

  Future<void> _prepare() async {
    if (widget.videoUrl.isEmpty) {
      setState(() => _unavailable = true);
      return;
    }
    final controller = VideoPlayerController.networkUrl(Uri.parse(widget.videoUrl));
    try {
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      controller.addListener(() {
        if (mounted) setState(() {});
      });
      setState(() => _controller = controller);
    } catch (_) {
      // Playback is not available everywhere the app runs. The poster and the
      // steps still read, which is the point of the screen.
      await controller.dispose();
      if (mounted) setState(() => _unavailable = true);
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RelayBackdrop(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              GestureDetector(
                onTap: widget.onClose,
                child: RelayStyle.svg('cross', width: 24, height: 24),
              ),
              GestureDetector(
                onTap: widget.onViewTeam,
                child: Text(
                  'View Team',
                  style: RelayStyle.sora(
                    14,
                    weight: FontWeight.w600,
                    color: RelayStyle.onBlue,
                    height: 16.2,
                    spacing: -0.16,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          const SizedBox(height: 26),
          Text(
            'How to Play',
            textAlign: TextAlign.center,
            style: RelayStyle.sora(24, weight: FontWeight.w800, color: Colors.white, height: 32),
          ),
          const SizedBox(height: 8),
          Center(
            child: SizedBox(
              width: 321,
              child: Text(
                'Watch the below video to understand how to play the following game',
                textAlign: TextAlign.center,
                style: RelayStyle.sora(14, color: RelayStyle.onBlue, height: 22),
              ),
            ),
          ),
          const SizedBox(height: 26 + 18 + 16),
          _label('INSTRUCTION'),
          const SizedBox(height: 12),
          _video(),
          const SizedBox(height: 12 + 16),
          _label('STEPS TO PLAY'),
          const SizedBox(height: 24),
          _step(1, 'Teammates get one clue each',
              'Each teammate gets one private clue. Read yours aloud.'),
          const SizedBox(height: 24),
          _step(2, 'Lead enters the answer in the app',
              'Everyone connects the clues as a team. The lead only enters the final answer.'),
          const SizedBox(height: 24),
          _highlightStep(
            3,
            'Every correct answer scores',
            'Four questions a round. Get them all with time to spare and the team keeps the seconds too.',
            '+${widget.pointsPerCorrect} every correct answer',
          ),
          const SizedBox(height: 24),
          _step(4, 'Stuck? Move to the next question',
              'The round gives your team 120 seconds for all four. Moving on is instant, but you can’t come back.'),
          if (widget.onViewLobby != null) ...[
            const SizedBox(height: 28),
            GestureDetector(
              onTap: widget.onViewLobby,
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text(
                  'View lobby',
                  textAlign: TextAlign.center,
                  style: RelayStyle.sora(13, weight: FontWeight.w600, color: RelayStyle.brand, height: 19.5),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _label(String text) => Text(
    text,
    style: RelayStyle.sora(
      12,
      weight: FontWeight.w600,
      color: Colors.white,
      height: 18,
      spacing: 0.5,
    ),
  );

  Widget _video() {
    final controller = _controller;
    final playing = controller?.value.isPlaying ?? false;
    return GestureDetector(
      onTap: controller == null
          ? () => setState(() => _triedToPlay = true)
          : () => playing ? controller.pause() : controller.play(),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: SizedBox(
          height: 201,
          width: double.infinity,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (controller != null && (playing || controller.value.position > Duration.zero))
                FittedBox(
                  fit: BoxFit.cover,
                  child: SizedBox(
                    width: controller.value.size.width,
                    height: controller.value.size.height,
                    child: VideoPlayer(controller),
                  ),
                )
              else
                // The design's own crop of the poster, not a centred cover.
                LayoutBuilder(
                  builder: (context, box) => Stack(
                    children: [
                      Positioned(
                        left: -0.1445 * box.maxWidth,
                        top: -0.7653 * box.maxHeight,
                        width: 1.2881 * box.maxWidth,
                        height: 2.3267 * box.maxHeight,
                        child: Image.asset(
                          '${RelayStyle.asset}/video_poster.png',
                          fit: BoxFit.fill,
                        ),
                      ),
                    ],
                  ),
                ),
              if (!playing)
                // Where the design places it, a little left of centre.
                Align(
                  alignment: const Alignment(-0.148, 0.004),
                  child: Container(
                    width: 30,
                    height: 30,
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(15),
                    ),
                    child: Transform.rotate(
                      angle: math.pi / 2,
                      child: Transform.flip(
                        flipY: true,
                        child: RelayStyle.svg('play_arrow', width: 24, height: 24),
                      ),
                    ),
                  ),
                ),
              if (_unavailable && _triedToPlay)
                Positioned(
                  left: 12,
                  right: 12,
                  bottom: 10,
                  child: Text(
                    'The video can’t play here — the steps below say the same thing.',
                    textAlign: TextAlign.center,
                    style: RelayStyle.sora(11, color: Colors.white70),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _badge(int number) => Container(
    width: 28,
    height: 28,
    decoration: BoxDecoration(
      color: Colors.white,
      shape: BoxShape.circle,
      border: Border.all(color: const Color(0xFFE5E7EB)),
    ),
    alignment: Alignment.center,
    child: Text(
      '$number',
      style: RelayStyle.sora(12, weight: FontWeight.w700, color: RelayStyle.inkDeep),
    ),
  );

  Widget _step(int number, String title, String detail) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _badge(number),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: RelayStyle.sora(
                  16,
                  weight: FontWeight.w600,
                  color: RelayStyle.inkDeep,
                  height: 16.2,
                  spacing: -0.16,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                detail,
                style: RelayStyle.sora(
                  14,
                  color: RelayStyle.onBlue,
                  height: 16.2,
                  spacing: -0.16,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _highlightStep(int number, String title, String detail, String badge) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: const Color(0xFFFFDDAA),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _badge(number),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: RelayStyle.sora(13, weight: FontWeight.w600, color: RelayStyle.inkDeep),
                ),
                const SizedBox(height: 4),
                Text(
                  detail,
                  style: RelayStyle.sora(13, color: RelayStyle.secondary, height: 17.55),
                ),
                const SizedBox(height: 4),
                Text(
                  badge,
                  style: RelayStyle.sora(13, color: const Color(0xFFFF8D28), height: 17.55),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
