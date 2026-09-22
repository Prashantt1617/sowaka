import 'dart:math' as math;

import 'package:flutter/material.dart';

/// The wrong-answer animation, from the designer's "Error Animation" Lottie.
///
/// Drawn directly rather than through a Lottie player: it is two shapes and
/// four keyframed values, and a package to play it would outweigh it. The
/// shapes, colours, frames and easing curves are the file's own — a red
/// scalloped badge spins in and grows, then a white cross draws itself on as
/// it turns upright. One second at 30fps; it holds on the last frame.
class RelayErrorMark extends StatefulWidget {
  const RelayErrorMark({super.key, this.size = 200});

  final double size;

  @override
  State<RelayErrorMark> createState() => _RelayErrorMarkState();
}

class _RelayErrorMarkState extends State<RelayErrorMark> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 1),
  )..forward();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Incorrect',
      child: SizedBox.square(
        dimension: widget.size,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) => CustomPaint(
            painter: _ErrorMarkPainter(frame: _controller.value * 30),
          ),
        ),
      ),
    );
  }
}

class _ErrorMarkPainter extends CustomPainter {
  _ErrorMarkPainter({required this.frame});

  /// The Lottie frame, 0–30.
  final double frame;

  static const _red = Color.fromRGBO(234, 74, 74, 1); // [0.9176, 0.2902, 0.2902]

  // The file's easing: out-handle (x, y) then in-handle (x, y).
  static const _easeOut = Cubic(0, 0, 0.36, 1);
  static const _easeInOut = Cubic(0.65, 0, 0.36, 1);

  static const _badge = <Offset>[
    Offset(69, 10), Offset(84.3149, 21.8656), Offset(103.679, 21.268),
    Offset(109.095, 39.8694), Offset(125.112, 50.768), Offset(118.56, 69),
    Offset(125.112, 87.232), Offset(109.095, 98.1306), Offset(103.679, 116.732),
    Offset(84.3149, 116.134), Offset(69, 128), Offset(53.6851, 116.134),
    Offset(34.3207, 116.732), Offset(28.9051, 98.1306), Offset(12.8877, 87.232),
    Offset(19.44, 69), Offset(12.8877, 50.768), Offset(28.9051, 39.8694),
    Offset(34.3207, 21.268), Offset(53.6851, 21.8656),
  ];

  /// A keyframed value between [from] at frame [start] and [to] at [end].
  double _key(double start, double end, double from, double to, Curve curve) {
    final t = ((frame - start) / (end - start)).clamp(0.0, 1.0);
    return from + (to - from) * curve.transform(t);
  }

  @override
  void paint(Canvas canvas, Size size) {
    // The layer: a 500 canvas, anchor (69, 69) placed at its centre, scaled
    // 350.85%. Fitted here to whatever size the widget is given.
    final fit = size.width / 500;
    canvas.save();
    canvas.scale(fit);
    canvas.translate(250, 250);
    canvas.scale(3.5084677175771304);
    canvas.translate(-69, -69);

    // Group 2 — the badge: grows 0→100% over frames 0–12, turns 90°→0 over 1–13.
    final grow = _key(0, 12, 0, 1, _easeOut);
    if (grow > 0) {
      canvas.save();
      canvas.translate(69, 69);
      canvas.rotate(_key(1, 13, 90, 0, _easeOut) * math.pi / 180);
      canvas.scale(grow);
      canvas.translate(-69, -69);
      canvas.drawPath(Path()..addPolygon(_badge, true), Paint()..color = _red);
      canvas.restore();
    }

    // Group 1 — the cross: each stroke draws on over frames 6–16 while the
    // pair turns 180°→0 over 5–22.
    final drawn = _key(6, 16, 0, 1, _easeInOut);
    if (drawn > 0) {
      canvas.save();
      canvas.translate(68.5, 69.5);
      canvas.rotate(_key(5, 22, 180, 0, _easeOut) * math.pi / 180);
      canvas.translate(-68.5, -69.5);
      final stroke = Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 8
        ..strokeCap = StrokeCap.square
        ..strokeJoin = StrokeJoin.miter;
      for (final (a, b) in const [
        (Offset(53, 85), Offset(84, 54)),
        (Offset(53, 54), Offset(84, 85)),
      ]) {
        canvas.drawLine(a, Offset.lerp(a, b, drawn)!, stroke);
      }
      canvas.restore();
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _ErrorMarkPainter old) => old.frame != frame;
}
