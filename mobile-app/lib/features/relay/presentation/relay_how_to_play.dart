import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import 'relay_buttons.dart';
import 'relay_round_demo.dart';
import 'relay_style.dart';

/// The rules, before anybody plays them (Figma 2606:35931).
///
/// There is no operator on the day and no practice round, so this is where a
/// team learns each round by example. Nothing gates on watching it — "Back to
/// Lobby" is right at the top, and players move between here and the lobby
/// freely until the game starts.
///
/// The round length, the points and the list of rounds come from the event,
/// not the copy: the design's figures are examples, and a rules screen that
/// disagrees with the game is worse than none.
class RelayHowToPlay extends StatefulWidget {
  const RelayHowToPlay({
    super.key,
    required this.videoUrl,
    required this.pointsPerCorrect,
    this.roundSeconds = 0,
    this.questionsPerRound = 0,
    this.roundKinds = const [],
    this.onClose,
    this.onBackToLobby,
  });

  final String videoUrl;
  final int pointsPerCorrect;

  /// A round's full length. Zero until the first update tells us.
  final int roundSeconds;

  /// Questions in a round. Zero until the first update tells us.
  final int questionsPerRound;

  /// Each round's kind, in order, as the imported sheet set them.
  final List<String> roundKinds;

  final VoidCallback? onClose;
  final VoidCallback? onBackToLobby;

  @override
  State<RelayHowToPlay> createState() => _RelayHowToPlayState();
}

class _RelayHowToPlayState extends State<RelayHowToPlay> {
  VideoPlayerController? _controller;
  bool _unavailable = false;

  /// The fallback note only appears once somebody has actually tried to play.
  bool _triedToPlay = false;

  static const _navy = Color(0xFF173B4D);
  static const _slate = Color(0xFF647E8B);

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
      angle: 122.15958857356406,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The design starts this screen at 81, nineteen below the others.
          const SizedBox(height: 19),
          RelayBannerButton(
            label: 'Back to Lobby',
            back: true,
            onTap: widget.onBackToLobby,
          ),
          const SizedBox(height: 18 + 16),
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
          const SizedBox(height: 6 + 18),
          _video(),
          const SizedBox(height: 36),
          if (widget.roundKinds.isNotEmpty) ...[
            _roundsHeading(),
            const SizedBox(height: 24),
            _roundCarousel(),
            const SizedBox(height: 24),
          ],
          _questionsCard(),
          const SizedBox(height: 24),
          _fasterCard(),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  /// Opens the instructions on the whole screen, and picks up where the
  /// tile left off.
  ///
  /// A 201pt strip is not enough to follow what somebody is doing; the way
  /// back is a cross in the corner, and the video is paused on the way out so
  /// it is not still talking behind the rules.
  Future<void> _openFullScreen(VideoPlayerController controller) async {
    await controller.play();
    if (!mounted) return;
    await Navigator.of(context, rootNavigator: true).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (context) => _FullScreenVideo(controller: controller),
      ),
    );
    await controller.pause();
    if (mounted) setState(() {});
  }

  // ── Video ────────────────────────────────────────────────────────────────

  Widget _video() {
    final controller = _controller;
    final playing = controller?.value.isPlaying ?? false;
    return GestureDetector(
      onTap: controller == null
          ? () => setState(() => _triedToPlay = true)
          : () => _openFullScreen(controller),
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
                        child: Image.asset('${RelayStyle.asset}/video_poster.png', fit: BoxFit.fill),
                      ),
                    ],
                  ),
                ),
              if (!playing)
                Center(
                  child: Container(
                    width: 30,
                    height: 30,
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(15)),
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

  // ── Rounds ───────────────────────────────────────────────────────────────

  Widget _roundsHeading() {
    final count = widget.roundKinds.length;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'There are $count round${count == 1 ? '' : 's'}',
            style: RelayStyle.sora(16, weight: FontWeight.w600, color: Colors.white, height: 16.2, spacing: -0.16),
          ),
          const SizedBox(height: 3),
          Text(
            'A new clue category every round.',
            style: RelayStyle.sora(14, color: Colors.white, height: 16.2, spacing: -0.16),
          ),
        ],
      ),
    );
  }

  /// One example card per round, in playing order, swiped sideways with the
  /// next one peeking in. Not clipped to the page's margin, as drawn. Every
  /// card is the tallest one's height, whatever its example holds.
  Widget _roundCarousel() {
    final kinds = widget.roundKinds;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      clipBehavior: Clip.none,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < kinds.length; i += 1) ...[
              if (i > 0) const SizedBox(width: 26),
              RelayRoundDemo(round: i + 1, kind: kinds[i], width: 337.26, fill: true),
            ],
          ],
        ),
      ),
    );
  }

  // ── Scoring ──────────────────────────────────────────────────────────────

  Widget _yellowCard({required String title, required List<Widget> children}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: const Color(0xFFFFE39A), borderRadius: BorderRadius.circular(18)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            title,
            style: RelayStyle.sora(16, weight: FontWeight.w600, color: _navy, height: 16.2, spacing: -0.16),
          ),
          for (final child in children) ...[const SizedBox(height: 10), child],
        ],
      ),
    );
  }

  /// The gold dial with a figure and SECONDS in it, and a word under it.
  Widget _dial(String figure, String under) {
    return Column(
      children: [
        SizedBox(
          width: 65,
          height: 65,
          child: Stack(
            alignment: Alignment.topCenter,
            children: [
              RelayStyle.svg('timer_dial', width: 65, height: 65),
              Positioned(
                top: 14,
                child: Text(figure, style: RelayStyle.sora(22, weight: FontWeight.w700, color: _navy)),
              ),
              Positioned(
                top: 39,
                child: Text('SECONDS', style: RelayStyle.sora(7, weight: FontWeight.w700, color: _slate)),
              ),
            ],
          ),
        ),
        const SizedBox(height: 2),
        Text(under, style: RelayStyle.sora(12, color: _slate, height: 16.2, spacing: -0.16)),
      ],
    );
  }

  Widget _points(String figure, {String? under}) {
    // At least the design's 84, but free to grow with larger text.
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 84),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(figure, style: RelayStyle.sora(28, weight: FontWeight.w700, color: _navy)),
          Text('POINTS', style: RelayStyle.sora(10, color: _slate, height: 16.2, spacing: -0.16)),
          if (under != null)
            Text(
              under,
              textAlign: TextAlign.center,
              style: RelayStyle.sora(12, color: _slate, height: 16.2, spacing: -0.16),
            ),
        ],
      ),
    );
  }

  Widget _questionsCard() {
    final questions = widget.questionsPerRound;
    return _yellowCard(
      title: questions > 0 ? 'There are $questions questions in every round.' : 'Answer as many as you can.',
      children: [
        Row(
          children: [
            Expanded(child: _dial(widget.roundSeconds > 0 ? '${widget.roundSeconds}' : '—', 'per round')),
            const SizedBox(width: 14),
            Container(width: 1, height: 62, color: const Color(0xFFDDBF69)),
            const SizedBox(width: 14),
            Expanded(child: _points('+${widget.pointsPerCorrect}', under: 'per correct answer')),
          ],
        ),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            RelayStyle.svg('repeat', width: 11.57, height: 9),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                ' Keep solving until the timer runs out.',
                textAlign: TextAlign.center,
                style: RelayStyle.sora(10, weight: FontWeight.w600, color: _slate, height: 16.2, spacing: -0.16),
              ),
            ),
          ],
        ),
      ],
    );
  }

  /// The time bonus, with the design's own worked example: 40 seconds left is
  /// 20 points. The round length and question count are the event's.
  Widget _fasterCard() {
    const secondsLeft = 40;
    const bonus = secondsLeft ~/ 2;
    final round = widget.roundSeconds;
    final questions = widget.questionsPerRound;
    return _yellowCard(
      title: 'Points for finishing faster',
      children: [
        Text(
          'If you complete all the questions before ${round > 0 ? '${round}s' : 'the timer runs out'}, the balance '
          'seconds will add to your score (2s →1pt). But to get these points, you need to have at least one '
          'right answer in that round.',
          style: RelayStyle.sora(14, color: _slate, spacing: -0.16),
        ),
        Row(
          children: [
            Expanded(child: _dial('$secondsLeft', 'Left')),
            const SizedBox(width: 14),
            Text('=', textAlign: TextAlign.center, style: RelayStyle.sora(28, weight: FontWeight.w700, color: _navy)),
            const SizedBox(width: 14),
            Expanded(child: _points('$bonus')),
          ],
        ),
      ],
    );
  }
}

/// The instructions video on the whole screen, over black.
class _FullScreenVideo extends StatefulWidget {
  const _FullScreenVideo({required this.controller});

  final VideoPlayerController controller;

  @override
  State<_FullScreenVideo> createState() => _FullScreenVideoState();
}

class _FullScreenVideoState extends State<_FullScreenVideo> {
  @override
  void initState() {
    super.initState();
    // The tile and this screen share one player, so a tap here has to redraw
    // there too.
    widget.controller.addListener(_onPlayerChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onPlayerChanged);
    super.dispose();
  }

  void _onPlayerChanged() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final playing = controller.value.isPlaying;
    return Scaffold(
      backgroundColor: Colors.black,
      body: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => playing ? controller.pause() : controller.play(),
        child: Stack(
          children: [
            // Whatever shape it was filmed in: scaled up until it meets the
            // edges, never cropped and never stretched. A portrait clip fills
            // the height, a landscape one the width.
            Center(
              child: controller.value.isInitialized
                  ? FittedBox(
                      fit: BoxFit.contain,
                      child: SizedBox(
                        width: controller.value.size.width,
                        height: controller.value.size.height,
                        child: VideoPlayer(controller),
                      ),
                    )
                  : const CircularProgressIndicator(color: Colors.white),
            ),
            if (!playing)
              Center(
                child: Container(
                  width: 56,
                  height: 56,
                  decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                  child: const Icon(Icons.play_arrow_rounded, size: 34, color: Colors.black),
                ),
              ),
            Positioned(
              left: 16,
              top: MediaQuery.paddingOf(context).top + 12,
              child: GestureDetector(
                onTap: () => Navigator.of(context).pop(),
                child: Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.45),
                    shape: BoxShape.circle,
                  ),
                  child: Center(child: RelayStyle.svg('cross', width: 20, height: 20)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
