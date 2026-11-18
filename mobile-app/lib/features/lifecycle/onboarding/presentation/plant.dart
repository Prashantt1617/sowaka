import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../data/onboarding_models.dart';
import 'onboarding_kit.dart';

/// The joiner's plant (6Zs §8.3): one widget for every place it grows — the
/// onboarding home, the profile card, the manager's cards, the moments.
///
/// A clay pot; [stage] 0–5 (seed, sprout, seedling, sapling, bud, bloom);
/// [water] 0–3 drops before joining (seed only); [leaves] extra leaves for
/// finished groups; [droop] bends it over and shows the "Needs water" pill
/// (never red). It sways gently, and stands still with reduce motion. The
/// designer's 3D stages replace the painting here and only here.
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

  /// The "Needs water" pill under a drooping plant; off where a card says
  /// it already.
  final bool showPill;

  static String semanticsLabel({required int stage, int water = 0, bool droop = false}) {
    final name = PlantState.stageNames[stage.clamp(0, 5)];
    final watered = stage == 0 && water > 0 ? ', watered $water of 3' : '';
    return 'Plant at $name stage$watered${droop ? ', needs water' : ''}';
  }

  @override
  State<Plant> createState() => _PlantState();
}

class _PlantState extends State<Plant> with SingleTickerProviderStateMixin {
  AnimationController? _sway;

  bool _moving(BuildContext context) => widget.sway && !MediaQuery.disableAnimationsOf(context);

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
      _sway ??= AnimationController(vsync: this, duration: const Duration(milliseconds: 3200))..repeat(reverse: true);
    } else {
      _sway?.dispose();
      _sway = null;
    }
  }

  @override
  void dispose() {
    _sway?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final width = widget.size.clamp(24.0, 320.0);
    final height = width * 140 / 120;
    final stage = widget.stage.clamp(0, 5);
    Widget painted(double t) => CustomPaint(
      size: Size(width, height),
      painter: _PlantPainter(
        stage: stage,
        water: widget.water.clamp(0, 3),
        leaves: widget.leaves.clamp(0, 8),
        droop: widget.droop,
        sway: t,
      ),
    );
    final sway = _sway;
    final plant = sway == null
        ? painted(0)
        : AnimatedBuilder(animation: sway, builder: (_, _) => painted(sway.value * 2 - 1));
    return Semantics(
      image: true,
      label: Plant.semanticsLabel(stage: stage, water: widget.water, droop: widget.droop),
      child: ExcludeSemantics(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(width: width, height: height, child: plant),
            if (widget.droop && widget.showPill && width >= 60) ...[
              const SizedBox(height: 6),
              const OnbTag('Needs water', tone: OnbTone.needsWater, icon: Icons.water_drop_outlined),
            ],
          ],
        ),
      ),
    );
  }
}

class _PlantPainter extends CustomPainter {
  _PlantPainter({required this.stage, required this.water, required this.leaves, required this.droop, required this.sway});

  final int stage;
  final int water;
  final int leaves;
  final bool droop;

  /// −1 … 1.
  final double sway;

  static const _clay = Color(0xFFC9784F);
  static const _clayDark = Color(0xFFA85E3A);
  static const _clayRim = Color(0xFFD98B60);
  static const _soil = Color(0xFF6B4A33);
  static const _stem = Color(0xFF2FA84F);
  static const _leaf = Color(0xFF34C759);
  static const _leafDark = Color(0xFF16A34A);
  static const _droopLeaf = Color(0xFF8DBF6A);
  static const _petal = Color(0xFFFFB3C7);
  static const _petalCentre = Color(0xFFFFD166);
  static const _bud = Color(0xFFF5A3B8);
  static const _water = Color(0xFF5AB8E6);
  static const _seed = Color(0xFF8C6A45);

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final unit = w / 120;

    // Pot: a tapered trapezoid with a rim.
    final potTop = h * 0.68;
    final potBottom = h * 0.98;
    final rimHeight = 10 * unit;
    final pot = Path()
      ..moveTo(w * 0.27, potTop + rimHeight)
      ..lineTo(w * 0.73, potTop + rimHeight)
      ..lineTo(w * 0.66, potBottom)
      ..quadraticBezierTo(w * 0.5, potBottom + 2 * unit, w * 0.34, potBottom)
      ..close();
    canvas.drawPath(pot, Paint()..color = _clay);
    canvas.drawPath(
      Path()
        ..moveTo(w * 0.60, potTop + rimHeight)
        ..lineTo(w * 0.73, potTop + rimHeight)
        ..lineTo(w * 0.66, potBottom)
        ..lineTo(w * 0.56, potBottom)
        ..close(),
      Paint()..color = _clayDark.withValues(alpha: 0.35),
    );
    final rim = RRect.fromRectAndRadius(
      Rect.fromLTWH(w * 0.22, potTop, w * 0.56, rimHeight),
      Radius.circular(4 * unit),
    );
    canvas.drawRRect(rim, Paint()..color = _clayRim);
    // Soil.
    canvas.drawOval(
      Rect.fromCenter(center: Offset(w * 0.5, potTop + 1.5 * unit), width: w * 0.48, height: 6 * unit),
      Paint()..color = _soil,
    );

    final base = Offset(w * 0.5, potTop);
    if (stage == 0) {
      _paintSeed(canvas, base, unit);
      return;
    }

    // Stem: taller each stage; bent over when drooping; a little sway.
    final heights = [0.0, 0.16, 0.28, 0.42, 0.50, 0.54];
    final stemLength = h * heights[stage];
    final lean = (droop ? 0.9 : 0.0) + sway * 0.06;
    final tip = Offset(
      base.dx + math.sin(lean) * stemLength * (droop ? 0.55 : 0.3),
      base.dy - math.cos(lean) * stemLength * (droop ? 0.85 : 1),
    );
    final control = Offset(base.dx - sway * 4 * unit, base.dy - stemLength * 0.55);
    final stemPath = Path()
      ..moveTo(base.dx, base.dy)
      ..quadraticBezierTo(control.dx, control.dy, tip.dx, tip.dy);
    canvas.drawPath(
      stemPath,
      Paint()
        ..color = _stem
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeWidth = (2.5 + stage * 0.6) * unit,
    );

    // Leaves along the stem: two per stage step, plus the earned ones.
    final metric = stemPath.computeMetrics().first;
    final pairs = [0, 1, 2, 3, 3, 3][stage] + (leaves / 2).ceil().clamp(0, 3);
    final leafColor = droop ? _droopLeaf : _leaf;
    for (var i = 0; i < pairs; i++) {
      final at = metric.length * (0.35 + 0.6 * (i + 1) / (pairs + 1));
      final tangent = metric.getTangentForOffset(at.clamp(0, metric.length));
      if (tangent == null) continue;
      final leafSize = (9 + stage * 2.2 - i * 0.8) * unit;
      final droopAngle = droop ? 0.9 : 0.0;
      _paintLeaf(canvas, tangent.position, leafSize, -0.7 - droopAngle * -0.6, leafColor, left: true);
      if (i * 2 + 1 < pairs * 2) {
        _paintLeaf(canvas, tangent.position, leafSize * 0.92, 0.7 + droopAngle, leafColor, left: false);
      }
    }
    // The top pair at the tip.
    _paintLeaf(canvas, tip, (8 + stage * 1.6) * unit, -0.4, leafColor, left: true);
    _paintLeaf(canvas, tip, (8 + stage * 1.6) * unit, 0.4 + (droop ? 0.6 : 0), leafColor, left: false);

    if (stage == 4) {
      canvas.drawOval(
        Rect.fromCenter(center: tip.translate(0, -5 * unit), width: 10 * unit, height: 14 * unit),
        Paint()..color = _bud,
      );
      _paintLeaf(canvas, tip.translate(0, -1 * unit), 7 * unit, -0.3, _leafDark, left: true);
      _paintLeaf(canvas, tip.translate(0, -1 * unit), 7 * unit, 0.3, _leafDark, left: false);
    }
    if (stage == 5) {
      final centre = tip.translate(0, -8 * unit);
      for (var p = 0; p < 6; p++) {
        final angle = p * math.pi / 3 + sway * 0.1;
        canvas.drawCircle(
          centre + Offset(math.cos(angle), math.sin(angle)) * 7 * unit,
          6 * unit,
          Paint()..color = _petal,
        );
      }
      canvas.drawCircle(centre, 5 * unit, Paint()..color = _petalCentre);
    }
  }

  void _paintSeed(Canvas canvas, Offset base, double unit) {
    canvas.drawOval(
      Rect.fromCenter(center: base.translate(0, -3 * unit), width: 12 * unit, height: 8 * unit),
      Paint()..color = _seed,
    );
    for (var i = 0; i < 3; i++) {
      final drop = base.translate((i - 1) * 14 * unit, -22 * unit - (i == 1 ? 6 * unit : 0));
      final path = Path()
        ..moveTo(drop.dx, drop.dy - 6 * unit)
        ..quadraticBezierTo(drop.dx + 5 * unit, drop.dy + 1 * unit, drop.dx, drop.dy + 3 * unit)
        ..quadraticBezierTo(drop.dx - 5 * unit, drop.dy + 1 * unit, drop.dx, drop.dy - 6 * unit);
      final filled = i < water;
      canvas.drawPath(
        path,
        Paint()
          ..color = filled ? _water : OnbColors.lineDark
          ..style = filled ? PaintingStyle.fill : PaintingStyle.stroke
          ..strokeWidth = 1.4 * unit,
      );
    }
  }

  void _paintLeaf(Canvas canvas, Offset at, double size, double angle, Color color, {required bool left}) {
    canvas.save();
    canvas.translate(at.dx, at.dy);
    canvas.rotate(angle + (left ? -0.6 : 0.6));
    final dir = left ? -1.0 : 1.0;
    final leaf = Path()
      ..moveTo(0, 0)
      ..quadraticBezierTo(dir * size * 0.5, -size * 0.55, dir * size, -size * 0.1)
      ..quadraticBezierTo(dir * size * 0.45, size * 0.35, 0, 0);
    canvas.drawPath(leaf, Paint()..color = color);
    canvas.drawLine(
      Offset.zero,
      Offset(dir * size * 0.8, -size * 0.12),
      Paint()
        ..color = _leafDark.withValues(alpha: 0.5)
        ..strokeWidth = size * 0.06,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _PlantPainter old) =>
      old.stage != stage || old.water != water || old.leaves != leaves || old.droop != droop || old.sway != sway;
}
