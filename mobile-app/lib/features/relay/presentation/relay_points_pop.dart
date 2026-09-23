import 'package:flutter/material.dart';

/// "+40" floating up the screen when a team gets one right.
///
/// Yellow, outlined, in an arcade face: the reward for a correct answer reads
/// as a score in a game rather than as a notice from an app. It ignores
/// touches and leaves nothing behind, so the next question is never behind it.
class RelayPointsPop extends StatefulWidget {
  const RelayPointsPop({super.key, required this.trigger, required this.points});

  /// A new value fires a new pop; the same value never fires twice.
  final Object? trigger;

  /// What the answer was worth.
  final int points;

  @override
  State<RelayPointsPop> createState() => _RelayPointsPopState();
}

class _RelayPointsPopState extends State<RelayPointsPop> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1500),
  );

  @override
  void initState() {
    super.initState();
    if (widget.trigger != null) _controller.forward(from: 0);
  }

  @override
  void didUpdateWidget(covariant RelayPointsPop oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.trigger != null && widget.trigger != oldWidget.trigger) {
      _controller.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          if (!_controller.isAnimating) return const SizedBox.shrink();
          final t = _controller.value;
          // Leaves quickly, slows as it climbs, and fades out at the top.
          final rise = Curves.easeOutCubic.transform(t);
          final opacity = t < 0.12
              ? t / 0.12
              : t > 0.72
                  ? (1 - t) / 0.28
                  : 1.0;
          // A small kick as it appears, the way a score does in a game.
          final scale = t < 0.18 ? 0.7 + 0.3 * (t / 0.18) : 1.0;
          return Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: EdgeInsets.only(bottom: 120 + rise * 260),
              child: Opacity(
                opacity: opacity.clamp(0.0, 1.0),
                child: Transform.scale(scale: scale, child: child),
              ),
            ),
          );
        },
        child: _Score(points: widget.points),
      ),
    );
  }
}

class _Score extends StatelessWidget {
  const _Score({required this.points});

  final int points;

  static const _yellow = Color(0xFFFFD836);

  @override
  Widget build(BuildContext context) {
    // Drawn twice: the dark pass is the outline every arcade score has, and
    // the bright pass sits inside it.
    final base = TextStyle(
      fontFamily: 'PressStart2P',
      fontSize: 28,
      height: 1.2,
      letterSpacing: 1,
      shadows: const [Shadow(color: Color(0x66000000), blurRadius: 12, offset: Offset(0, 4))],
    );
    return Stack(
      alignment: Alignment.center,
      children: [
        Text(
          '+$points',
          style: base.copyWith(
            foreground: Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = 6
              ..strokeJoin = StrokeJoin.round
              ..color = const Color(0xFF1B1B2F),
          ),
        ),
        Text('+$points', style: base.copyWith(color: _yellow)),
      ],
    );
  }
}
