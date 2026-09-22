import 'dart:math' as math;

import 'package:flutter/material.dart';

/// A short burst of confetti for a correct answer.
///
/// Drawn here rather than pulled in as a package: it is one effect, a second
/// and a half long, and a dependency for it would outweigh it. It ignores
/// touches, so it never gets between a player and the next question.
class RelayConfetti extends StatefulWidget {
  const RelayConfetti({super.key, required this.trigger});

  /// A new value fires a new burst; the same value never fires twice.
  final Object? trigger;

  @override
  State<RelayConfetti> createState() => _RelayConfettiState();
}

class _RelayConfettiState extends State<RelayConfetti> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  );
  List<_Piece> _pieces = const [];

  static const _colors = [
    Color(0xFF34C759),
    Color(0xFFFFCC00),
    Color(0xFF0088FF),
    Color(0xFFFF8D28),
    Color(0xFFF5576C),
    Color(0xFFFFFFFF),
  ];

  @override
  void initState() {
    super.initState();
    if (widget.trigger != null) _burst();
  }

  @override
  void didUpdateWidget(covariant RelayConfetti oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.trigger != null && widget.trigger != oldWidget.trigger) _burst();
  }

  void _burst() {
    final random = math.Random();
    _pieces = List.generate(70, (_) {
      return _Piece(
        x: random.nextDouble(),
        drift: (random.nextDouble() - 0.5) * 0.5,
        speed: 0.7 + random.nextDouble() * 0.6,
        size: 5 + random.nextDouble() * 6,
        spin: (random.nextDouble() - 0.5) * 12,
        delay: random.nextDouble() * 0.25,
        color: _colors[random.nextInt(_colors.length)],
      );
    });
    _controller.forward(from: 0);
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
        builder: (context, _) => _controller.isAnimating
            ? CustomPaint(
                size: Size.infinite,
                painter: _ConfettiPainter(_pieces, _controller.value),
              )
            : const SizedBox.shrink(),
      ),
    );
  }
}

class _Piece {
  const _Piece({
    required this.x,
    required this.drift,
    required this.speed,
    required this.size,
    required this.spin,
    required this.delay,
    required this.color,
  });

  final double x;
  final double drift;
  final double speed;
  final double size;
  final double spin;
  final double delay;
  final Color color;
}

class _ConfettiPainter extends CustomPainter {
  _ConfettiPainter(this.pieces, this.progress);

  final List<_Piece> pieces;
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint();
    for (final piece in pieces) {
      final t = ((progress - piece.delay) / (1 - piece.delay)).clamp(0.0, 1.0);
      if (t <= 0) continue;
      final dx = (piece.x + piece.drift * t) * size.width;
      // Falls from just above the top, easing out as it lands.
      final dy = -20 + Curves.easeIn.transform(t) * piece.speed * size.height;
      paint.color = piece.color.withValues(alpha: 1 - Curves.easeIn.transform(t) * 0.8);
      canvas.save();
      canvas.translate(dx, dy);
      canvas.rotate(piece.spin * t);
      canvas.drawRect(
        Rect.fromCenter(center: Offset.zero, width: piece.size, height: piece.size * 0.55),
        paint,
      );
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant _ConfettiPainter old) => old.progress != progress;
}
