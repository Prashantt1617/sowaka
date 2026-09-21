import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

/// The rules, before anybody plays them.
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

  /// Taken from the event rather than written into the copy, so the number on
  /// this screen cannot disagree with what a correct answer actually pays.
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

  static const _sky = Color(0xFF4FA3D1);
  static const _skyDeep = Color(0xFF3B8FC4);
  static const _ink = Color(0xFF222222);
  static const _muted = Color(0xFF6B7280);
  static const _highlight = Color(0xFFFBE8C8);
  static const _highlightInk = Color(0xFFB4741B);

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
      setState(() => _controller = controller);
    } catch (_) {
      // Playback is not available everywhere the app runs. The rules still
      // read, which is the point of the screen.
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
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [_sky, _skyDeep],
        ),
      ),
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 16, 0),
              child: Row(
                children: [
                  IconButton(
                    onPressed: widget.onClose,
                    icon: const Icon(Icons.close, color: Colors.white, size: 24),
                  ),
                  const Spacer(),
                  GestureDetector(
                    onTap: widget.onViewTeam,
                    child: const Text(
                      'View Team',
                      style: TextStyle(
                        fontFamily: 'Sora',
                        color: Colors.white,
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Center(
                      child: Text(
                        'How to Play',
                        style: TextStyle(
                          fontFamily: 'Sora',
                          color: Colors.white,
                          fontSize: 26,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Center(
                      child: Text(
                        'Watch the below video to understand how to play the following game',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontFamily: 'Sora',
                          color: Color(0xFFE3F1FA),
                          fontSize: 13.5,
                          height: 1.45,
                        ),
                      ),
                    ),
                    const SizedBox(height: 22),
                    _label('INSTRUCTION'),
                    const SizedBox(height: 8),
                    _video(),
                    const SizedBox(height: 22),
                    _label('STEPS TO PLAY'),
                    const SizedBox(height: 10),
                    _step(1, 'Teammates get one clue each',
                        'Each teammate gets one private clue. Read yours aloud.'),
                    _step(2, 'Lead enters the answer in the app',
                        'Everyone connects the clues as a team. The lead only enters the final answer.'),
                    _step(3, 'Every correct answer scores',
                        'Answer before the round runs out. Finish them all with time to spare and the team keeps the seconds as points.',
                        badge: '+${widget.pointsPerCorrect} every correct answer'),
                    const SizedBox(height: 18),
                    if (widget.onViewLobby != null)
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: widget.onViewLobby,
                          style: FilledButton.styleFrom(
                            backgroundColor: Colors.white,
                            foregroundColor: _skyDeep,
                            padding: const EdgeInsets.symmetric(vertical: 15),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                          ),
                          child: const Text(
                            'View lobby',
                            style: TextStyle(
                              fontFamily: 'Sora',
                              fontSize: 15.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _label(String text) => Text(
    text,
    style: const TextStyle(
      fontFamily: 'Sora',
      color: Colors.white,
      fontSize: 11.5,
      letterSpacing: 1.3,
      fontWeight: FontWeight.w700,
    ),
  );

  Widget _video() {
    final controller = _controller;
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: AspectRatio(
        aspectRatio: controller?.value.aspectRatio ?? 16 / 9,
        child: controller == null
            ? Container(
                color: const Color(0xFF2A3136),
                alignment: Alignment.center,
                child: _unavailable
                    ? const Padding(
                        padding: EdgeInsets.all(20),
                        child: Text(
                          'The video cannot play here — the steps below say the same thing.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontFamily: 'Sora',
                            color: Color(0xFFBFC7CC),
                            fontSize: 13,
                          ),
                        ),
                      )
                    : const CircularProgressIndicator(color: Colors.white70),
              )
            : Stack(
                alignment: Alignment.center,
                children: [
                  VideoPlayer(controller),
                  GestureDetector(
                    onTap: () => setState(() {
                      controller.value.isPlaying ? controller.pause() : controller.play();
                    }),
                    child: Container(
                      color: Colors.transparent,
                      width: double.infinity,
                      height: double.infinity,
                      child: Center(
                        child: AnimatedOpacity(
                          opacity: controller.value.isPlaying ? 0 : 1,
                          duration: const Duration(milliseconds: 180),
                          child: const CircleAvatar(
                            radius: 24,
                            backgroundColor: Colors.white,
                            child: Icon(Icons.play_arrow, color: Color(0xFF222222), size: 28),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _step(int number, String title, String detail, {String? badge}) {
    final highlighted = badge != null;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(14, 13, 14, 13),
      decoration: BoxDecoration(
        color: highlighted ? _highlight : Colors.white,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 24,
            height: 24,
            decoration: BoxDecoration(
              color: highlighted ? Colors.white : const Color(0xFFEFF5F9),
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Text(
              '$number',
              style: const TextStyle(
                fontFamily: 'Sora',
                color: _ink,
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: _ink,
                    fontSize: 14.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  detail,
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: _muted,
                    fontSize: 13,
                    height: 1.4,
                  ),
                ),
                if (badge != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    badge,
                    style: const TextStyle(
                      fontFamily: 'Sora',
                      color: _highlightInk,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
