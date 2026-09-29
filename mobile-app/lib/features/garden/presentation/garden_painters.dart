import 'dart:math';

import 'package:flutter/material.dart';

import 'garden_layout.dart';

/// The meadow under the trees: grass, a winding path, ponds, and the beds,
/// bushes, stones and benches the layout scattered. Painted once at world
/// size and transformed with the canvas, so panning costs nothing.
class MeadowPainter extends CustomPainter {
  const MeadowPainter({required this.decor});

  final List<Decor> decor;

  static const grassTop = Color(0xFFD9EDBF);
  static const grassMid = Color(0xFFBFE09C);
  static const grassLow = Color(0xFFA3CF80);
  static const pathLight = Color(0xFFEFDFBF);
  static const pathDark = Color(0xFFE2CDA3);

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    canvas.drawRect(
      rect,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [grassTop, grassMid, grassLow],
          stops: [0, .5, 1],
        ).createShader(rect),
    );
    // Lighter patches, so the lawn is not one flat green.
    final patch = Paint()..color = const Color(0xFFC9E6A5).withValues(alpha: .65);
    for (var i = 0; i < (size.height / 260).ceil(); i++) {
      canvas.drawOval(
        Rect.fromCenter(
          center: Offset(size.width * (i.isEven ? .28 : .72), 180 + i * 260.0),
          width: size.width * .5,
          height: 120,
        ),
        patch,
      );
    }
    // A path that wanders down the whole meadow.
    final path = Path()..moveTo(size.width * .5, -20);
    final steps = (size.height / 220).ceil();
    for (var i = 0; i < steps; i++) {
      final y0 = i * 220.0, y1 = y0 + 220;
      final cx = size.width * (i.isEven ? .78 : .22);
      path.cubicTo(cx, y0 + 60, cx, y1 - 60, size.width * .5, y1);
    }
    canvas.drawPath(path, Paint()..color = pathLight..style = PaintingStyle.stroke..strokeWidth = 42..strokeCap = StrokeCap.round);
    _dashed(canvas, path, Paint()..color = pathDark.withValues(alpha: .8)..style = PaintingStyle.stroke..strokeWidth = 28..strokeCap = StrokeCap.round);
    // Two ponds, one high and one low, off the path.
    _pond(canvas, Offset(size.width * .8, size.height * .3), 110, 52);
    if (size.height > 900) _pond(canvas, Offset(size.width * .2, size.height * .74), 92, 42);
    // Furniture from the layout.
    for (final d in decor) {
      switch (d.kind) {
        case DecorKind.bed:
          _bed(canvas, d.at, d.seed);
        case DecorKind.bush:
          _bush(canvas, d.at, 30 + (d.seed % 3) * 8.0, d.seed);
        case DecorKind.stone:
          _stone(canvas, d.at, 14 + (d.seed % 2) * 4.0);
        case DecorKind.bench:
          _bench(canvas, d.at);
      }
    }
  }

  void _dashed(Canvas canvas, Path path, Paint paint) {
    for (final metric in path.computeMetrics()) {
      var at = 0.0;
      while (at < metric.length) {
        final end = min(at + 22, metric.length);
        canvas.drawPath(metric.extractPath(at, end), paint);
        at += 36;
      }
    }
  }

  void _pond(Canvas canvas, Offset c, double rx, double ry) {
    canvas.drawOval(Rect.fromCenter(center: c + const Offset(0, 4), width: rx * 2 + 16, height: ry * 2 + 12), Paint()..color = const Color(0xFF5E9FC4).withValues(alpha: .35));
    final rect = Rect.fromCenter(center: c, width: rx * 2, height: ry * 2);
    canvas.drawOval(
      rect,
      Paint()
        ..shader = const RadialGradient(center: Alignment(-0.1, -0.2), radius: .9, colors: [Color(0xFFC7E8F3), Color(0xFF8FCBE4), Color(0xFF6FB4D6)], stops: [0, .6, 1]).createShader(rect),
    );
    canvas.drawOval(Rect.fromCenter(center: c + Offset(-rx * .3, -ry * .3), width: rx * .7, height: ry * .45), Paint()..color = Colors.white.withValues(alpha: .28));
    final ripple = Paint()..color = Colors.white.withValues(alpha: .4)..style = PaintingStyle.stroke..strokeWidth = 2;
    canvas.drawPath(Path()..moveTo(c.dx - rx * .4, c.dy + ry * .2)..quadraticBezierTo(c.dx - rx * .1, c.dy + ry * .08, c.dx + rx * .2, c.dy + ry * .2), ripple);
    final lily = Paint()..color = const Color(0xFF5F9D4A);
    for (final o in [Offset(rx * .45, ry * .35), Offset(-rx * .5, ry * .1), Offset(rx * .1, -ry * .5)]) {
      canvas.drawCircle(c + o, 8, lily);
    }
  }

  void _bed(Canvas canvas, Offset at, int seed) {
    final r = _seeded(seed);
    final soil = Paint()..color = const Color(0xFFB98F63).withValues(alpha: .35);
    canvas.drawOval(Rect.fromCenter(center: at, width: 96, height: 30), soil);
    const petals = [Color(0xFFE86A8B), Color(0xFFFFC94D), Color(0xFFF2A0C0), Color(0xFFFFFFFF), Color(0xFF7FB3F7)];
    for (var i = 0; i < 9; i++) {
      final p = at + Offset((i - 4) * 10 + (r() - .5) * 6, (r() - .5) * 12);
      canvas.drawLine(p, p + const Offset(0, 8), Paint()..color = const Color(0xFF5F9D4A)..strokeWidth = 2);
      final petal = Paint()..color = petals[i % petals.length];
      for (var k = 0; k < 5; k++) {
        final a = k * pi * 2 / 5;
        canvas.drawCircle(p + Offset(cos(a) * 3.2, sin(a) * 3.2), 2.2, petal);
      }
      canvas.drawCircle(p, 1.8, Paint()..color = const Color(0xFFFFE08A));
    }
  }

  void _bush(Canvas canvas, Offset at, double w, int seed) {
    final r = _seeded(seed);
    canvas.drawOval(Rect.fromCenter(center: at + Offset(0, w * .32), width: w * 1.1, height: w * .22), Paint()..color = const Color(0xFF1E3C14).withValues(alpha: .14));
    const greens = [Color(0xFF5BA75A), Color(0xFF93D178), Color(0xFF469A67)];
    for (var i = 0; i < 5; i++) {
      final c = at + Offset((i - 2) * w * .2 + (r() - .5) * w * .1, (r() - .5) * w * .18);
      canvas.drawCircle(c, w * (.22 + r() * .1), Paint()..color = greens[i % greens.length]);
    }
    canvas.drawCircle(at + Offset(-w * .12, -w * .12), w * .18, Paint()..color = const Color(0xFFC7EC9F).withValues(alpha: .7));
  }

  void _stone(Canvas canvas, Offset at, double rx) {
    canvas.drawOval(Rect.fromCenter(center: at, width: rx * 2, height: rx * 1.1), Paint()..color = const Color(0xFFB9C0C6));
    canvas.drawOval(Rect.fromCenter(center: at + Offset(-rx * .2, -rx * .18), width: rx * 1.1, height: rx * .6), Paint()..color = const Color(0xFFD4D9DC));
  }

  void _bench(Canvas canvas, Offset at) {
    final wood = Paint()..color = const Color(0xFF9A7350);
    final dark = Paint()..color = const Color(0xFF7A5637);
    canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromCenter(center: at, width: 66, height: 8), const Radius.circular(3)), wood);
    canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromCenter(center: at + const Offset(0, 13), width: 66, height: 7), const Radius.circular(3)), Paint()..color = const Color(0xFF8A6446));
    canvas.drawRect(Rect.fromLTWH(at.dx - 30, at.dy + 16, 6, 16), dark);
    canvas.drawRect(Rect.fromLTWH(at.dx + 24, at.dy + 16, 6, 16), dark);
  }

  double Function() _seeded(int seed) {
    var s = (seed * 2654435761) & 0xffffffff;
    return () {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return s / 4294967296;
    };
  }

  @override
  bool shouldRepaint(MeadowPainter old) => old.decor != decor;
}

/// The sky and lawn behind one big tree.
class SkyPainter extends CustomPainter {
  const SkyPainter({required this.groundY});

  final double groundY;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    canvas.drawRect(
      rect,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFFDCEFFF), Color(0xFFEEF7EF), Color(0xFFCFE6B8)],
          stops: [0, .55, 1],
        ).createShader(rect),
    );
    final cloud = Paint()..color = Colors.white.withValues(alpha: .85);
    for (final c in [Offset(size.width * .2, 150), Offset(size.width * .82, 205)]) {
      canvas.drawOval(Rect.fromCenter(center: c, width: 70, height: 24), cloud);
      canvas.drawOval(Rect.fromCenter(center: c + const Offset(18, -8), width: 44, height: 24), cloud);
    }
    final lawn = Path()
      ..moveTo(0, groundY - 8)
      ..quadraticBezierTo(size.width / 2, groundY - 34, size.width, groundY - 6)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(lawn, Paint()..color = const Color(0xFFB6DB91));
    final lawn2 = Path()
      ..moveTo(0, groundY + 30)
      ..quadraticBezierTo(size.width / 2, groundY + 10, size.width, groundY + 34)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(lawn2, Paint()..color = const Color(0xFF9FCD7A));
  }

  @override
  bool shouldRepaint(SkyPainter old) => old.groundY != groundY;
}

/// The moment a flower or fruit arrives: a ring that swells and fades, and
/// petals that fly out and tumble. Drawn around the sprite, at [t] in 0..1.
class BurstPainter extends CustomPainter {
  const BurstPainter({required this.t, required this.isFruit});

  final double t;
  final bool isFruit;

  @override
  void paint(Canvas canvas, Size size) {
    final c = Offset(size.width / 2, size.height / 2);
    final ring = Paint()
      ..color = Colors.white.withValues(alpha: (1 - t) * .9)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3;
    canvas.drawCircle(c, 14 + t * 34, ring);
    final colors = isFruit
        ? const [Color(0xFFE0413F), Color(0xFFF28C8A), Color(0xFFFFD166)]
        : const [Color(0xFFF4A6C1), Color(0xFFFFD166), Color(0xFFFBE6EC), Colors.white];
    final ease = Curves.easeOut.transform(t);
    for (var i = 0; i < 10; i++) {
      final a = i * pi * 2 / 10;
      final dist = (26 + (i % 3) * 8) * ease;
      final p = c + Offset(cos(a) * dist, sin(a) * dist - 10 * ease);
      canvas.save();
      canvas.translate(p.dx, p.dy);
      canvas.rotate(t * 4.5);
      final paint = Paint()..color = colors[i % colors.length].withValues(alpha: 1 - t);
      canvas.drawRRect(RRect.fromRectAndCorners(Rect.fromCenter(center: Offset.zero, width: 7 * (1 - t * .6), height: 7 * (1 - t * .6)), topLeft: const Radius.circular(4), topRight: const Radius.circular(4), bottomLeft: const Radius.circular(4)), paint);
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(BurstPainter old) => old.t != t;
}
