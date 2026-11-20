import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../data/onboarding_models.dart';

/// The joiner's plant: one widget for every place it grows (the onboarding
/// home, the profile card, the manager's cards, the moments), drawn as the
/// 20 Nov New joiner artifact's Plant component draws it, in its 120 × 140
/// box: a clay pot, [stage] 0–5 (seed, sprout, seedling, sapling, bud,
/// bloom) and, for the seed only, [water] 0–3 (wet soil and falling drops,
/// then a crack in the seed, then a shoot peeking out). It sways gently, and
/// stands still with reduce motion or [sway] off.
///
/// [leaves] and [droop] are still accepted from the server's plant but are
/// not drawn: the artifact's plant has neither (and no "Needs water" pill).
class Plant extends StatefulWidget {
  const Plant({
    super.key,
    this.stage = 1,
    this.size = 120,
    this.sway = true,
    this.water = 0,
    this.leaves = 0,
    this.droop = false,
    this.showPill = true,
  });

  Plant.of(PlantState state, {Key? key, double size = 120, bool sway = true, bool showPill = true})
    : this(
        key: key,
        stage: state.stage,
        size: size,
        sway: sway,
        water: state.water,
        leaves: state.leaves,
        droop: state.droop,
        showPill: showPill,
      );

  final int stage;
  final double size;
  final bool sway;
  final int water;
  final int leaves;
  final bool droop;
  final bool showPill;

  /// The artifact's label: "Plant at Seed stage, watered 2 of 3".
  static String semanticsLabel({required int stage, int water = 0}) {
    final s = stage.clamp(0, 5);
    final wl = s == 0 ? water.clamp(0, 3) : 0;
    return 'Plant at ${PlantState.stageNames[s]} stage${wl > 0 ? ', watered $wl of 3' : ''}';
  }

  @override
  State<Plant> createState() => _PlantState();
}

class _PlantState extends State<Plant> with SingleTickerProviderStateMixin {
  Ticker? _ticker;
  final _clock = ValueNotifier<Duration>(Duration.zero);

  int get _stage => widget.stage.clamp(0, 5);
  int get _water => _stage == 0 ? widget.water.clamp(0, 3) : 0;

  /// Anything to move: the sway, or the seed's drops and shoot.
  bool _moving(BuildContext context) => !MediaQuery.disableAnimationsOf(context) && (widget.sway || _water > 0);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncMotion();
  }

  @override
  void didUpdateWidget(covariant Plant oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncMotion();
  }

  void _syncMotion() {
    if (_moving(context)) {
      _ticker ??= createTicker((elapsed) => _clock.value = elapsed)..start();
    } else {
      _ticker?.dispose();
      _ticker = null;
      _clock.value = Duration.zero;
    }
  }

  @override
  void dispose() {
    _ticker?.dispose();
    _clock.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final width = widget.size.clamp(24.0, 320.0);
    final height = (width * 140 / 120).roundToDouble();
    final still = MediaQuery.disableAnimationsOf(context);
    return Semantics(
      image: true,
      label: Plant.semanticsLabel(stage: _stage, water: _water),
      child: ExcludeSemantics(
        child: SizedBox(
          width: width,
          height: height,
          child: CustomPaint(
            painter: PlantPainter(
              stage: _stage,
              water: _water,
              sway: widget.sway && !still,
              animate: !still,
              clock: _clock,
            ),
          ),
        ),
      ),
    );
  }
}

/// The artifact's Plant SVG (viewBox 0 0 120 140), painted.
class PlantPainter extends CustomPainter {
  PlantPainter({required this.stage, required this.water, required this.sway, required this.animate, required this.clock})
    : super(repaint: clock);

  final int stage;
  final int water;
  final bool sway;
  final bool animate;
  final ValueListenable<Duration> clock;

  static const _leafA = [Color(0xFF8EDB72), Color(0xFF3FA34D)];
  static const _leafB = [Color(0xFF7BCF67), Color(0xFF358F43)];
  static const _petal = [Color(0xFFFFC2D4), Color(0xFFEE6A93)];
  static const _stem = Color(0xFF3E9B4A);

  // Each stage's leaves: centre, radii, rotation (degrees), gradient A or B.
  static const _full = <_Leaf>[
    (50, 80, 12, 6, 20, true), (70, 78, 12, 6, -20, false),
    (51, 64, 11, 5.6, 24, true), (69, 62, 11, 5.6, -24, false),
    (52.5, 48, 9.5, 5, 30, true), (67.5, 46, 9.5, 5, -30, false),
  ];
  static const _stages = <int, ({List<double> stem, List<_Leaf> leaves})>{
    1: (stem: [60, 90, 60, 82, 61, 82, 60, 75], leaves: [(52.5, 73, 8, 4.5, 25, true), (67.5, 71, 8, 4.5, -25, false)]),
    2: (
      stem: [60, 90, 60, 73, 61, 73, 60, 56],
      leaves: [(52, 74, 10, 5.2, 22, true), (68, 72, 10, 5.2, -22, false), (52, 57, 8.5, 4.6, 32, false), (68, 55, 8.5, 4.6, -32, true)],
    ),
    3: (
      stem: [60, 90, 60, 64, 61, 64, 60, 38],
      leaves: [
        (50, 78, 12, 6, 20, true), (70, 76, 12, 6, -20, false),
        (51, 61, 11, 5.6, 26, true), (69, 59, 11, 5.6, -26, false),
        (53, 41, 8.5, 4.6, 34, false), (67, 39, 8.5, 4.6, -34, true),
      ],
    ),
    4: (stem: [60, 90, 60, 60, 61, 60, 60, 31], leaves: _full),
    5: (stem: [60, 90, 60, 60, 61, 60, 60, 30], leaves: _full),
  };

  /// CSS keyframes between [a] and [b] over [t] 0–1 of a segment.
  static double _lerp(double a, double b, double t) => a + (b - a) * t;

  @override
  void paint(Canvas canvas, Size size) {
    final seconds = clock.value.inMicroseconds / 1e6;
    canvas.save();
    canvas.scale(size.width / 120, size.height / 140);

    _paintPot(canvas);

    if (stage == 0 && water >= 1) {
      canvas.drawOval(_oval(60, 89.8, 24, 2.8), Paint()..color = const Color(0xFF3F2716).withValues(alpha: 0.75));
      final bead = Paint()..color = const Color(0xFF9AD9FF).withValues(alpha: 0.8);
      canvas.drawCircle(const Offset(47, 89), 1.2, bead);
      canvas.drawCircle(const Offset(72, 90), 1, bead);
      // drip: 2.2 s ease-in; down from −6 to 14, fading in by 30 % and out by the end.
      final p = animate ? (seconds % 2.2) / 2.2 : 0.5;
      final dy = _lerp(-6, 14, Curves.easeIn.transform(p));
      final opacity = p < 0.3 ? Curves.easeIn.transform(p / 0.3) : 1 - Curves.easeIn.transform((p - 0.3) / 0.7);
      canvas.save();
      canvas.translate(0, dy);
      final drop = Paint()..color = const Color(0xFF7FD3FF).withValues(alpha: opacity.clamp(0, 1));
      canvas.drawPath(_dropPath(44, 70), drop);
      canvas.drawPath(_dropPath(76, 64), drop);
      canvas.restore();
    }

    // plantSway: 3.2 s ease-in-out, −2.5° → 2.5° → −2.5° about (60, 90).
    canvas.save();
    if (sway) {
      final p = (seconds % 3.2) / 3.2;
      final deg = p < 0.5 ? _lerp(-2.5, 2.5, Curves.easeInOut.transform(p * 2)) : _lerp(2.5, -2.5, Curves.easeInOut.transform((p - 0.5) * 2));
      _rotateAbout(canvas, deg, 60, 90);
    }
    if (stage == 0) {
      _paintSeed(canvas, seconds);
    } else {
      final shape = _stages[stage]!;
      final st = shape.stem;
      canvas.drawPath(
        Path()
          ..moveTo(st[0], st[1])
          ..cubicTo(st[2], st[3], st[4], st[5], st[6], st[7]),
        Paint()
          ..color = _stem
          ..style = PaintingStyle.stroke
          ..strokeWidth = 4
          ..strokeCap = StrokeCap.round,
      );
      for (final leaf in shape.leaves) {
        _paintLeaf(canvas, leaf);
      }
      if (stage == 4) _paintBud(canvas);
      if (stage == 5) _paintBloom(canvas);
    }
    canvas.restore();
    canvas.restore();
  }

  void _paintPot(Canvas canvas) {
    canvas.drawOval(_oval(60, 136, 26, 3), Paint()..color = Colors.black.withValues(alpha: 0.08));
    final pot = Path()
      ..moveTo(31, 100)
      ..lineTo(89, 100)
      ..quadraticBezierTo(87, 120, 84, 130)
      ..quadraticBezierTo(83, 135, 77, 135)
      ..lineTo(43, 135)
      ..quadraticBezierTo(37, 135, 36, 130)
      ..quadraticBezierTo(33, 120, 31, 100)
      ..close();
    canvas.drawPath(
      pot,
      Paint()
        ..shader = const LinearGradient(
          colors: [Color(0xFFE9895A), Color(0xFFD9703F), Color(0xFFB9532A)],
          stops: [0, 0.45, 1],
        ).createShader(const Rect.fromLTRB(31, 100, 89, 135)),
    );
    canvas.drawPath(
      Path()
        ..moveTo(31, 100)
        ..lineTo(89, 100)
        ..lineTo(88.4, 105)
        ..lineTo(31.6, 105)
        ..close(),
      Paint()..color = const Color(0xFF9E4320).withValues(alpha: 0.35),
    );
    canvas.drawPath(
      Path()
        ..moveTo(39, 108)
        ..quadraticBezierTo(40, 119, 42, 127),
      Paint()
        ..color = const Color(0xFFFFD0B3).withValues(alpha: 0.5)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawRRect(
      RRect.fromLTRBR(24, 87, 96, 102, const Radius.circular(7.5)),
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFFEE9466), Color(0xFFC95F32)],
        ).createShader(const Rect.fromLTRB(24, 87, 96, 102)),
    );
    canvas.drawRRect(
      RRect.fromLTRBR(29, 89.5, 55, 92.1, const Radius.circular(1.3)),
      Paint()..color = const Color(0xFFFFD9C2).withValues(alpha: 0.55),
    );
    canvas.drawOval(_oval(60, 89, 31, 4.6), Paint()..color = const Color(0xFF5A3A24));
    canvas.drawOval(_oval(60, 89.6, 25, 3), Paint()..color = const Color(0xFF6E4A2E));
  }

  void _paintSeed(Canvas canvas, double seconds) {
    canvas.save();
    _rotateAbout(canvas, -18, 60, 86);
    canvas.drawOval(_oval(60, 86, 7, 4.5), Paint()..color = const Color(0xFFD69A5C));
    canvas.drawOval(_oval(58, 84.6, 3, 1.3), Paint()..color = const Color(0xFFFFE6C8).withValues(alpha: 0.7));
    if (water >= 2) {
      canvas.drawPath(
        Path()
          ..moveTo(56, 85.5)
          ..lineTo(59, 87)
          ..lineTo(61, 85)
          ..lineTo(64, 86.6),
        Paint()
          ..color = const Color(0xFF8B5A2B)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.1
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round,
      );
    }
    canvas.restore();
    if (water >= 3) {
      // peek: 2.4 s ease-in-out, scaleY 1 → 1.12 → 1 from the shoot's foot.
      final p = animate ? (seconds % 2.4) / 2.4 : 0.0;
      final scale = p < 0.5 ? _lerp(1, 1.12, Curves.easeInOut.transform(p * 2)) : _lerp(1.12, 1, Curves.easeInOut.transform((p - 0.5) * 2));
      canvas.save();
      canvas.translate(61.5, 84);
      canvas.scale(1, scale);
      canvas.translate(-61.5, -84);
      canvas.drawPath(
        Path()
          ..moveTo(60.5, 84)
          ..cubicTo(60.5, 80, 61, 78, 62.5, 76.5),
        Paint()
          ..color = _stem
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.4
          ..strokeCap = StrokeCap.round,
      );
      canvas.restore();
      canvas.save();
      _rotateAbout(canvas, -30, 64, 76.5);
      canvas.drawOval(_oval(64, 76.5, 3.2, 1.8), Paint()..color = const Color(0xFF6CCB78));
      canvas.restore();
    }
  }

  void _paintLeaf(Canvas canvas, _Leaf leaf) {
    final (cx, cy, rx, ry, deg, a) = leaf;
    canvas.save();
    _rotateAbout(canvas, deg.toDouble(), cx.toDouble(), cy.toDouble());
    final rect = _oval(cx.toDouble(), cy.toDouble(), rx.toDouble(), ry.toDouble());
    canvas.drawOval(
      rect,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: a ? _leafA : _leafB,
        ).createShader(rect),
    );
    canvas.drawOval(
      _oval(cx - rx * 0.25, cy - ry * 0.35, rx * 0.45, ry * 0.28),
      Paint()..color = Colors.white.withValues(alpha: 0.35),
    );
    canvas.restore();
  }

  void _paintBud(Canvas canvas) {
    final sepal = Paint()..color = const Color(0xFF4CAF50);
    canvas.save();
    _rotateAbout(canvas, 30, 55.5, 31);
    canvas.drawOval(_oval(55.5, 31, 4.5, 2.4), sepal);
    canvas.restore();
    canvas.save();
    _rotateAbout(canvas, -30, 64.5, 31);
    canvas.drawOval(_oval(64.5, 31, 4.5, 2.4), sepal);
    canvas.restore();
    canvas.drawPath(
      Path()
        ..moveTo(60, 13)
        ..cubicTo(68, 19, 68, 28, 60, 32)
        ..cubicTo(52, 28, 52, 19, 60, 13)
        ..close(),
      Paint()..shader = _petalShader(const Rect.fromLTRB(54, 13, 66, 32)),
    );
    canvas.drawOval(_oval(57.5, 20, 1.8, 4), Paint()..color = Colors.white.withValues(alpha: 0.45));
  }

  void _paintBloom(Canvas canvas) {
    const petals = [Offset(60, 12.5), Offset(69, 19.1), Offset(65.6, 29.7), Offset(54.4, 29.7), Offset(51, 19.1)];
    for (final c in petals) {
      canvas.drawCircle(c, 8.2, Paint()..shader = _petalShader(Rect.fromCircle(center: c, radius: 8.2)));
    }
    canvas.drawCircle(const Offset(60, 22), 6, Paint()..color = const Color(0xFFFFC93C));
    canvas.drawCircle(const Offset(58.2, 20.2), 2, Paint()..color = const Color(0xFFFFF3C4).withValues(alpha: 0.8));
  }

  /// The SVG's radial `petal` (cx .4, cy .35, r .75 of the shape's box).
  static Shader _petalShader(Rect box) =>
      const RadialGradient(center: Alignment(-0.2, -0.3), radius: 0.75, colors: _petal).createShader(box);

  static Path _dropPath(double x, double y) => Path()
    ..moveTo(x, y)
    ..cubicTo(x + 2, y + 3, x + 3, y + 5, x, y + 7)
    ..cubicTo(x - 3, y + 5, x - 2, y + 3, x, y)
    ..close();

  static Rect _oval(double cx, double cy, double rx, double ry) => Rect.fromLTRB(cx - rx, cy - ry, cx + rx, cy + ry);

  static void _rotateAbout(Canvas canvas, double degrees, double x, double y) {
    canvas.translate(x, y);
    canvas.rotate(degrees * 3.141592653589793 / 180);
    canvas.translate(-x, -y);
  }

  @override
  bool shouldRepaint(covariant PlantPainter old) =>
      old.stage != stage || old.water != water || old.sway != sway || old.animate != animate || old.clock != clock;
}

typedef _Leaf = (num cx, num cy, num rx, num ry, num deg, bool a);
