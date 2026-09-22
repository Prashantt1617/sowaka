import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import 'relay_buttons.dart';
import 'relay_style.dart';

/// The rules, before anybody plays them (Figma 2606:35931).
///
/// There is no operator on the day and no practice round, so this is where a
/// team learns that only one screen holds each clue. Nothing gates on watching
/// it — "Back to Lobby" is right at the top, and players move between here and
/// the lobby freely until the game starts.
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
    this.roundKinds = const [],
    this.onClose,
    this.onBackToLobby,
  });

  final String videoUrl;
  final int pointsPerCorrect;

  /// A round's full length. Zero until the first update tells us.
  final int roundSeconds;

  /// Each round's kind, in order, as the imported sheet set them.
  final List<String> roundKinds;

  final VoidCallback? onClose;
  final VoidCallback? onBackToLobby;

  @override
  State<RelayHowToPlay> createState() => _RelayHowToPlayState();
}

/// How each kind of round is introduced on the rules screen.
const _kinds = <String, ({String glyph, Color tint, Color ink, String title, String line})>{
  'number': (glyph: '#', tint: Color(0xFFE4F7FA), ink: Color(0xFF279CB6), title: 'Number Crunch', line: 'Clues link the number'),
  'word': (glyph: 'Aa', tint: Color(0xFFF1E9FA), ink: Color(0xFF9A65C3), title: 'Word Twist', line: 'Unscramble the letters'),
  'movie': (glyph: '▣', tint: Color(0xFFFFF0D3), ink: Color(0xFFD89025), title: 'Plot Picks', line: 'Guess the movie'),
  'lyric': (glyph: '♬', tint: Color(0xFFFBE6EF), ink: Color(0xFFD35B91), title: 'Lyric Link', line: 'Find the missing lyric word'),
  'odd': (glyph: '☆', tint: Color(0xFFE9F2FF), ink: Color(0xFF628ECF), title: 'Odd One Out', line: 'Spot the one that doesn’t belong'),
};

class _RelayHowToPlayState extends State<RelayHowToPlay> {
  VideoPlayerController? _controller;
  bool _unavailable = false;

  /// The fallback note only appears once somebody has actually tried to play.
  bool _triedToPlay = false;

  static const _navy = Color(0xFF173B4D);
  static const _slate = Color(0xFF647E8B);
  static const _teal = Color(0xFF0792B0);
  static const _mint = Color(0xF7CCFCFF);

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
      angle: 121.09724847448723,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: GestureDetector(
              onTap: widget.onClose,
              child: RelayStyle.svg('cross', width: 24, height: 24),
            ),
          ),
          const SizedBox(height: 13),
          RelayBannerButton(
            label: 'Back to Lobby',
            back: true,
            onTap: widget.onBackToLobby,
          ),
          const SizedBox(height: 18 + 24),
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
          _stepOne(),
          const SizedBox(height: 24),
          _stepTwo(),
          const SizedBox(height: 24),
          _stepThree(),
          if (widget.roundKinds.isNotEmpty) ...[
            const SizedBox(height: 24),
            _roundsHeading(),
            const SizedBox(height: 24),
            _roundList(),
          ],
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  // ── Video ────────────────────────────────────────────────────────────────

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

  // ── Steps ────────────────────────────────────────────────────────────────

  Widget _stepHeading(int number, String title, {String badge = 'step_badge_blue', Color ink = _teal, Color titleInk = _navy}) {
    return Row(
      children: [
        SizedBox(
          width: 22,
          height: 22,
          child: Stack(
            alignment: Alignment.center,
            children: [
              RelayStyle.svg(badge, width: 22, height: 22),
              Text('$number', style: RelayStyle.sora(11, weight: FontWeight.w700, color: ink)),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            title,
            style: RelayStyle.sora(16, weight: FontWeight.w600, color: titleInk, height: 16.2, spacing: -0.16),
          ),
        ),
      ],
    );
  }

  Widget _card({required List<Widget> children, Color color = Colors.white, CrossAxisAlignment align = CrossAxisAlignment.start}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(18)),
      child: Column(crossAxisAlignment: align, children: children),
    );
  }

  Widget _stepOne() {
    const tiles = [
      ('T', 'TURQUOISE', Color(0xFFE4F6FC), Color(0xFF35A8D7)),
      ('M', 'MYSTERY', Color(0xFFF2EAF9), Color(0xFF9D70C9)),
      ('A', 'ANIMAL', Color(0xFFFFF4D8), Color(0xFFD59C26)),
      ('E', 'ELECTRIC', Color(0xFFFCEAF3), Color(0xFFD96DA7)),
    ];
    return _card(
      align: CrossAxisAlignment.center,
      children: [
        _stepHeading(1, 'Teammates get one clue each'),
        const SizedBox(height: 10),
        SizedBox(
          width: double.infinity,
          child: Text(
            'Four teammates get a private clue each.\nRead them aloud and piece them together.',
            style: RelayStyle.sora(14, color: _slate, spacing: -0.16),
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            for (var i = 0; i < tiles.length; i += 1) ...[
              if (i > 0) const SizedBox(width: 8),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.only(top: 8, bottom: 6),
                  decoration: BoxDecoration(color: tiles[i].$3, borderRadius: BorderRadius.circular(8)),
                  child: Column(
                    children: [
                      Text(tiles[i].$1, style: RelayStyle.sora(22, weight: FontWeight.w700, color: tiles[i].$4)),
                      const SizedBox(height: 5),
                      Text(
                        tiles[i].$2,
                        maxLines: 1,
                        style: RelayStyle.sora(7, weight: FontWeight.w600, color: tiles[i].$4),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
          decoration: BoxDecoration(color: _mint, borderRadius: BorderRadius.circular(27)),
          child: Text(
            'Solve as a team',
            style: RelayStyle.sora(12, weight: FontWeight.w600, color: RelayStyle.brand, height: 16.2, spacing: -0.16),
          ),
        ),
      ],
    );
  }

  Widget _stepTwo() {
    return _card(
      children: [
        _stepHeading(2, 'Lead enters the answer in the app'),
        const SizedBox(height: 10),
        Text(
          'Agree on the answer as a team.',
          style: RelayStyle.sora(14, color: _slate, height: 16.2, spacing: -0.16),
        ),
        const SizedBox(height: 10),
        Container(
          height: 38,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          decoration: BoxDecoration(color: const Color(0xFFEAF8FB), borderRadius: BorderRadius.circular(10)),
          child: Row(
            children: [
              RelayStyle.svg('crown', width: 20, height: 20),
              const SizedBox(width: 11),
              Expanded(
                child: Text('TEAM', style: RelayStyle.sora(11, weight: FontWeight.w700, color: _navy)),
              ),
              Container(
                width: 28,
                height: 24,
                margin: const EdgeInsets.only(right: 10),
                decoration: BoxDecoration(color: _teal, borderRadius: BorderRadius.circular(6)),
                alignment: Alignment.center,
                child: const Text('→', style: TextStyle(fontSize: 12, color: Colors.white)),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _stepThree() {
    const rule = Color(0xFFDDBF69);
    return _card(
      color: const Color(0xFFFFE39A),
      children: [
        _stepHeading(3, 'Answer as many as you can', badge: 'step_badge_gold', ink: const Color(0xFF795900)),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: Column(
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
                          child: Text(
                            widget.roundSeconds > 0 ? '${widget.roundSeconds}' : '—',
                            style: RelayStyle.sora(22, weight: FontWeight.w700, color: _navy),
                          ),
                        ),
                        Positioned(
                          top: 39,
                          child: Text('SECONDS', style: RelayStyle.sora(7, weight: FontWeight.w700, color: _slate)),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text('per round', style: RelayStyle.sora(12, color: _slate, height: 16.2, spacing: -0.16)),
                ],
              ),
            ),
            const SizedBox(width: 14),
            Container(width: 1, height: 62, color: rule),
            const SizedBox(width: 14),
            Expanded(
              // At least the design's 84, but free to grow with larger text.
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 84),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text('+${widget.pointsPerCorrect}', style: RelayStyle.sora(28, weight: FontWeight.w700, color: _navy)),
                    Text('POINTS', style: RelayStyle.sora(10, color: _slate, height: 16.2, spacing: -0.16)),
                    Text(
                      'per correct answer',
                      textAlign: TextAlign.center,
                      style: RelayStyle.sora(12, color: _slate, height: 16.2, spacing: -0.16),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            RelayStyle.svg('repeat', width: 11.57, height: 9),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                'Keep solving until the timer runs out.',
                textAlign: TextAlign.center,
                style: RelayStyle.sora(10, weight: FontWeight.w600, color: _slate, height: 16.2, spacing: -0.16),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _roundsHeading() {
    final count = widget.roundKinds.length;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _stepHeading(4, 'There are $count round${count == 1 ? '' : 's'}', badge: 'step_badge_plain', titleInk: Colors.white),
          const SizedBox(height: 3),
          Text(
            'A new clue category every round.',
            style: RelayStyle.sora(14, color: Colors.white, height: 16.2, spacing: -0.16),
          ),
        ],
      ),
    );
  }

  Widget _roundList() {
    final kinds = widget.roundKinds;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
      child: Column(
        children: [
          for (var i = 0; i < kinds.length; i += 1)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: i == kinds.length - 1
                  ? null
                  : const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0xFFDCEEF2)))),
              child: _roundRow(i + 1, kinds[i]),
            ),
        ],
      ),
    );
  }

  Widget _roundRow(int number, String kind) {
    final meta = _kinds[kind] ??
        (glyph: '?', tint: const Color(0xFFE9F2FF), ink: const Color(0xFF628ECF), title: kind, line: '');
    return Row(
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: BoxDecoration(color: meta.tint, borderRadius: BorderRadius.circular(6)),
          alignment: Alignment.center,
          child: Text(meta.glyph, style: RelayStyle.sora(9, weight: FontWeight.w700, color: meta.ink)),
        ),
        const SizedBox(width: 9),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(meta.title, style: RelayStyle.sora(14, weight: FontWeight.w600, color: _navy, height: 16.2, spacing: -0.16)),
              const SizedBox(height: 1),
              if (meta.line.isNotEmpty)
                Text(meta.line, style: RelayStyle.sora(12, color: _slate, height: 16.2, spacing: -0.16)),
            ],
          ),
        ),
        Text(number.toString().padLeft(2, '0'), style: RelayStyle.sora(12, color: _slate, height: 16.2, spacing: -0.16)),
      ],
    );
  }
}
