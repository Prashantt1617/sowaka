import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../../../../services/api_config.dart';
import '../../../care/content/catalog_content.dart';
import '../../../care/presentation/care_theme.dart';

/// The colour of each part of life on the wheel, by area id.
Color lifeAreaColor(String id) => switch (id) {
  'family' => const Color(0xFFF08A4B),
  'work' => const Color(0xFF3B82F6),
  'movement' => const Color(0xFF22B07D),
  'hobbies' => const Color(0xFFF4B740),
  'social' => const Color(0xFF8B5CF6),
  'relationship' => const Color(0xFFEC5F8B),
  _ => CareColors.blue,
};

Color _shade(Color c, double amt) {
  int ch(double v) =>
      (amt > 0 ? v + amt * (255 - v) : v + amt * v).round().clamp(0, 255);
  return Color.fromARGB(255, ch(c.r * 255), ch(c.g * 255), ch(c.b * 255));
}

/// A part of the wheel: where it starts and ends, in degrees clockwise from
/// the top, with the first part centred there.
class _Slice {
  const _Slice(this.start, this.end);

  final double start;
  final double end;
  double get mid => (start + end) / 2;
}

List<_Slice> _layout(List<double> weights) {
  final total = weights.fold<double>(0, (a, b) => a + b);
  final out = <_Slice>[];
  var at = -(weights.first / total * 360) / 2;
  for (final w in weights) {
    final span = w / total * 360;
    out.add(_Slice(at, at + span));
    at += span;
  }
  return out;
}

/// The parts of life on a wheel you turn with a finger. A raised disc in a
/// pearl rim, each part its own colour with its icon upright on a white
/// disc, the person's photo at the centre and an arrow at the top. Drag it
/// round and it follows; let go mid-swing and it carries on, slowing, the
/// arrow clicking on each peg; where it stops, that part opens. A tap brings
/// the tapped part to the arrow. A part that matters more right now gets a
/// larger slice.
class LifeWheel extends StatefulWidget {
  const LifeWheel({
    super.key,
    required this.areas,
    required this.weights,
    required this.selected,
    required this.hasNotes,
    required this.onLand,
    this.photoUrl,
    this.initials = '',
  });

  final List<Map<String, dynamic>> areas;

  /// How much of the circle each part takes, relative to the rest.
  final List<double> weights;
  final String? selected;
  final bool Function(String id) hasNotes;
  final ValueChanged<String> onLand;
  final String? photoUrl;
  final String initials;

  @override
  State<LifeWheel> createState() => _LifeWheelState();
}

class _LifeWheelState extends State<LifeWheel> with TickerProviderStateMixin {
  static const _size = 300.0;

  /// How far the wheel has turned, in degrees.
  double _angle = 0;
  late List<double> _drawn = List.of(widget.weights);
  late List<_Slice> _slices = _layout(_drawn);
  int _under = 0;
  double _flick = 0;
  bool _flickBack = false;

  // Turning to a part, coasting after a flick, and the slices resizing.
  late final AnimationController _turn = AnimationController(vsync: this);
  Ticker? _coast;
  late final AnimationController _resize = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 650),
  );

  // A finger on the wheel.
  double? _lastBearing;

  @override
  void didUpdateWidget(covariant LifeWheel old) {
    super.didUpdateWidget(old);
    final changed =
        old.weights.length != widget.weights.length ||
        [
          for (var i = 0; i < widget.weights.length; i++)
            old.weights[i] != widget.weights[i],
        ].any((d) => d);
    if (changed) _reweigh();
  }

  @override
  void dispose() {
    _turn.dispose();
    _coast?.dispose();
    _resize.dispose();
    super.dispose();
  }

  int get _count => widget.areas.length;

  /// The part under the arrow when the wheel has turned [a] degrees.
  int _underArrow(double a) {
    final x = ((-a % 360) + 360) % 360;
    for (var i = 0; i < _slices.length; i++) {
      final s = _slices[i];
      for (final y in [x, x - 360, x + 360]) {
        if (y >= s.start && y < s.end) return i;
      }
    }
    return 0;
  }

  void _setAngle(double a) {
    final before = _angle;
    _angle = a;
    final now = _underArrow(a);
    if (now != _under) {
      _under = now;
      final speed = math.min(1.0, (a - before).abs() / 12);
      careWheelTick?.call(1 - speed * 0.6);
      _flick = math.max(_flick, 18 * (0.5 + speed));
    }
    _flick *= 0.82;
    _flickBack = a < before;
    setState(() {});
  }

  void _settle() {
    _flick = 0;
    setState(() {});
  }

  void _land(int i) {
    careWheelChime?.call();
    widget.onLand('${widget.areas[i]['id']}');
  }

  void _stopAll() {
    _turn.stop();
    _coast?.dispose();
    _coast = null;
  }

  /// Turns the wheel the short way round to bring part [i] to the arrow.
  Future<void> _turnTo(int i) async {
    _stopAll();
    final rest = -_slices[i].mid;
    var delta = ((rest - _angle) % 360 + 360) % 360;
    if (delta > 180) delta -= 360;
    if (delta.abs() < 0.5) {
      _land(i);
      return;
    }
    final from = _angle;
    _turn.duration = Duration(milliseconds: (700 + delta.abs() * 3).round());
    void step() =>
        _setAngle(from + delta * Curves.easeOutQuart.transform(_turn.value));
    _turn.addListener(step);
    await _turn.forward(from: 0);
    _turn.removeListener(step);
    if (!mounted) return;
    _settle();
    _land(i);
  }

  /// Carries on turning at [velocity] degrees a second, slowing under
  /// friction, then opens the part under the arrow.
  void _coastFrom(double velocity) {
    var v = velocity.clamp(-2200.0, 2200.0);
    Duration? prev;
    _coast?.dispose();
    _coast = createTicker((elapsed) {
      final dt = prev == null
          ? 0.016
          : math.min(0.048, (elapsed - prev!).inMicroseconds / 1e6);
      prev = elapsed;
      _setAngle(_angle + v * dt);
      v *= math.exp(-dt / 0.9);
      if (v.abs() > 12) return;
      _coast?.dispose();
      _coast = null;
      _settle();
      _land(_underArrow(_angle));
    })..start();
  }

  /// The slices ease to their new sizes; the chosen part stays at the arrow.
  Future<void> _reweigh() async {
    final from = List.of(_drawn);
    final to = List.of(widget.weights);
    final selected = widget.areas.indexWhere(
      (a) => '${a['id']}' == widget.selected,
    );
    void step() {
      final k = Curves.easeOutCubic.transform(_resize.value);
      _drawn = [
        for (var i = 0; i < to.length; i++) from[i] + (to[i] - from[i]) * k,
      ];
      _slices = _layout(_drawn);
      if (selected >= 0) _angle = -_slices[selected].mid;
      _under = _underArrow(_angle);
      setState(() {});
    }

    _resize.addListener(step);
    await _resize.forward(from: 0);
    _resize.removeListener(step);
  }

  double _bearing(Offset local) {
    final d = local - const Offset(_size / 2, _size / 2 + 18);
    return math.atan2(d.dy, d.dx) * 180 / math.pi;
  }

  void _down(DragDownDetails details) {
    careWheelWake?.call();
    _stopAll();
    _lastBearing = _bearing(details.localPosition);
  }

  void _update(DragUpdateDetails details) {
    final last = _lastBearing;
    if (last == null) return;
    final now = _bearing(details.localPosition);
    var d = now - last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    _lastBearing = now;
    _setAngle(_angle + d);
  }

  void _end(DragEndDetails details) {
    _lastBearing = null;
    // The finger's speed across the wheel, as a turning speed.
    final r = details.localPosition - const Offset(_size / 2, _size / 2 + 18);
    final v = details.velocity.pixelsPerSecond;
    final r2 = math.max(400.0, r.distanceSquared);
    final degPerSec = (r.dx * v.dy - r.dy * v.dx) / r2 * 180 / math.pi;
    if (degPerSec.abs() < 30) {
      _settle();
      _land(_underArrow(_angle));
      return;
    }
    _coastFrom(degPerSec);
  }

  void _tap(TapUpDetails details) {
    final d = details.localPosition - const Offset(_size / 2, _size / 2 + 18);
    final dist = d.distance;
    if (dist < 44 || dist > 131) return;
    final deg = math.atan2(d.dy, d.dx) * 180 / math.pi + 90;
    _turnTo(_underArrow(_angle - deg));
  }

  @override
  Widget build(BuildContext context) {
    if (_count == 0) return const SizedBox.shrink();
    final colors = [for (final a in widget.areas) lifeAreaColor('${a['id']}')];
    return Semantics(
      label: 'A wheel of the parts of life. Turn it, or tap a part.',
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onPanDown: _down,
        onPanUpdate: _update,
        onPanEnd: _end,
        onTapUp: _tap,
        child: SizedBox(
          width: _size,
          height: _size + 40,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              // the shadow on the floor
              Positioned(
                left: 24,
                right: 24,
                bottom: 0,
                height: 40,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: RadialGradient(
                      colors: [
                        const Color(0xFF1E223C).withValues(alpha: 0.32),
                        const Color(0x001E223C),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(100),
                  ),
                ),
              ),
              // the edge of the disc, seen below its face
              Positioned(
                left: 0,
                top: 30,
                width: _size,
                height: _size,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: const LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Color(0xFFC9D0DB), Color(0xFF7D8796)],
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: const Color(0xFF141828).withValues(alpha: 0.45),
                        blurRadius: 18,
                        spreadRadius: -6,
                        offset: const Offset(0, 10),
                      ),
                    ],
                  ),
                ),
              ),
              // the face, which turns; its icons stay upright
              Positioned(
                left: 0,
                top: 18,
                width: _size,
                height: _size,
                child: Transform.rotate(
                  angle: _angle * math.pi / 180,
                  child: Stack(
                    children: [
                      Positioned.fill(
                        child: CustomPaint(
                          painter: _FacePainter(
                            slices: _slices,
                            colors: colors,
                          ),
                        ),
                      ),
                      for (var i = 0; i < _count; i++) _icon(i, colors[i]),
                    ],
                  ),
                ),
              ),
              // the rim and the light, which do not turn
              const Positioned(
                left: 0,
                top: 18,
                width: _size,
                height: _size,
                child: IgnorePointer(
                  child: CustomPaint(painter: _LightPainter()),
                ),
              ),
              Positioned(
                left: _size / 2 - 44,
                top: 18 + _size / 2 - 44,
                child: IgnorePointer(child: _hub()),
              ),
              Positioned(
                left: _size / 2 - 18,
                top: 0,
                child: IgnorePointer(
                  child: Transform.rotate(
                    angle: (_flickBack ? 1 : -1) * _flick * math.pi / 180,
                    alignment: const Alignment(0, -0.5),
                    child: const CustomPaint(
                      size: Size(36, 48),
                      painter: _PinPainter(),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _icon(int i, Color color) {
    final id = '${widget.areas[i]['id']}';
    final m = (_slices[i].mid - 90) * math.pi / 180;
    return Positioned(
      left: _size / 2 + math.cos(m) * 90 - 19,
      top: _size / 2 + math.sin(m) * 90 - 19,
      width: 38,
      height: 38,
      child: Transform.rotate(
        angle: -_angle * math.pi / 180,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: const RadialGradient(
                  center: Alignment(-0.3, -0.4),
                  colors: [Colors.white, Color(0xFFEEF1F6)],
                ),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF141828).withValues(alpha: 0.28),
                    blurRadius: 6,
                    offset: const Offset(0, 3),
                  ),
                ],
              ),
              alignment: Alignment.center,
              child: Icon(lifeAreaIcon(id), size: 21, color: color),
            ),
            if (widget.hasNotes(id))
              Positioned(
                right: -1,
                top: -1,
                child: Container(
                  width: 11,
                  height: 11,
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 2),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _hub() {
    final photo = widget.photoUrl;
    return Container(
      width: 88,
      height: 88,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Colors.white, Color(0xFFEEF1F6), Color(0xFFC2CAD6)],
        ),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF141828).withValues(alpha: 0.35),
            blurRadius: 14,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 3),
          gradient: const RadialGradient(
            center: Alignment(-0.3, -0.4),
            colors: [Color(0xFFFFD9C2), Color(0xFFF5A47A), Color(0xFFE07A4F)],
          ),
        ),
        alignment: Alignment.center,
        child: photo != null && photo.isNotEmpty
            ? Image(
                image: avatarImageProvider(photo),
                fit: BoxFit.cover,
                width: 80,
                height: 80,
                errorBuilder: (_, _, _) => _initials(),
              )
            : _initials(),
      ),
    );
  }

  Widget _initials() => Text(
    widget.initials,
    style: const TextStyle(
      fontFamily: careFont,
      color: Colors.white,
      fontSize: 25,
      fontWeight: FontWeight.w800,
      letterSpacing: 0.5,
    ),
  );
}

/// The face of the wheel: domed slices in their colours, white seams, a
/// silver peg at the end of each.
class _FacePainter extends CustomPainter {
  const _FacePainter({required this.slices, required this.colors});

  final List<_Slice> slices;
  final List<Color> colors;

  static double _rad(double deg) => (deg - 90) * math.pi / 180;

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    const inner = 131.0;
    final circle = Rect.fromCircle(center: c, radius: inner);
    for (var i = 0; i < slices.length; i++) {
      final s = slices[i];
      final base = colors[i];
      final sweep = (s.end - s.start) * math.pi / 180;
      final path = Path()
        ..moveTo(c.dx, c.dy)
        ..arcTo(circle, _rad(s.start), sweep, false)
        ..close();
      // domed: brighter toward the middle, deeper at the rim
      canvas.drawPath(
        path,
        Paint()
          ..shader = RadialGradient(
            colors: [_shade(base, 0.38), base, _shade(base, -0.28)],
            stops: const [0.11, 0.5, 1],
          ).createShader(circle),
      );
      // a soft rounded crest along the slice
      final m = _rad(s.mid);
      final half = sweep / 2;
      canvas.drawPath(
        path,
        Paint()
          ..shader =
              LinearGradient(
                colors: [
                  Colors.black.withValues(alpha: 0.16),
                  Colors.white.withValues(alpha: 0.14),
                  Colors.black.withValues(alpha: 0.16),
                ],
              ).createShader(
                Rect.fromPoints(
                  c + Offset(math.cos(m - half), math.sin(m - half)) * inner,
                  c + Offset(math.cos(m + half), math.sin(m + half)) * inner,
                ),
              ),
      );
    }
    final seam = Paint()
      ..color = Colors.white.withValues(alpha: 0.9)
      ..strokeWidth = 2;
    for (final s in slices) {
      final a = _rad(s.start);
      final dir = Offset(math.cos(a), math.sin(a));
      canvas.drawLine(c, c + dir * inner, seam);
      final p = c + dir * (inner - 6);
      canvas.drawCircle(
        p + const Offset(0.75, 1.25),
        4.25,
        Paint()..color = const Color(0xFF141828).withValues(alpha: 0.28),
      );
      canvas.drawCircle(
        p,
        4.25,
        Paint()
          ..shader = const RadialGradient(
            center: Alignment(-0.35, -0.35),
            colors: [Colors.white, Color(0xFFE4E8EE), Color(0xFF8D96A3)],
            stops: [0, 0.55, 1],
          ).createShader(Rect.fromCircle(center: p, radius: 4.25)),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _FacePainter old) =>
      old.slices != slices || old.colors != colors;
}

/// What does not turn: the slices' shadow under the rim, a soft highlight
/// from the top left, and the pearl rim with a bevel each side.
class _LightPainter extends CustomPainter {
  const _LightPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    const outer = 149.0, inner = 131.0;
    final face = Rect.fromCircle(center: c, radius: inner);
    canvas.drawCircle(
      c,
      inner,
      Paint()
        ..shader = RadialGradient(
          colors: [
            const Color(0x00141828),
            const Color(0xFF141828).withValues(alpha: 0.32),
          ],
          stops: const [0.9, 1],
        ).createShader(face),
    );
    canvas.save();
    canvas.clipPath(Path()..addOval(face));
    canvas.drawCircle(
      c + const Offset(-30, -40),
      130,
      Paint()
        ..shader =
            RadialGradient(
              colors: [
                Colors.white.withValues(alpha: 0.38),
                Colors.white.withValues(alpha: 0),
              ],
            ).createShader(
              Rect.fromCircle(center: c + const Offset(-30, -40), radius: 130),
            ),
    );
    canvas.restore();
    final ring = Path()
      ..fillType = PathFillType.evenOdd
      ..addOval(Rect.fromCircle(center: c, radius: outer))
      ..addOval(face);
    final all = Rect.fromCircle(center: c, radius: outer);
    canvas.drawPath(
      ring,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Colors.white, Color(0xFFEEF1F6), Color(0xFFC2CAD6)],
        ).createShader(all),
    );
    canvas.drawCircle(
      c,
      outer - 0.75,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5
        ..shader = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Colors.white.withValues(alpha: 0.9),
            const Color(0xFF78829A).withValues(alpha: 0.6),
          ],
        ).createShader(all),
    );
    canvas.drawCircle(
      c,
      inner + 0.75,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5
        ..shader = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            const Color(0xFF78829A).withValues(alpha: 0.7),
            Colors.white.withValues(alpha: 0.9),
          ],
        ).createShader(face),
    );
  }

  @override
  bool shouldRepaint(covariant _LightPainter old) => false;
}

/// The arrow at the top: a glossy navy pin.
class _PinPainter extends CustomPainter {
  const _PinPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final pin = Path()
      ..moveTo(18, 47)
      ..lineTo(4.5, 17)
      ..arcToPoint(
        const Offset(31.5, 17),
        radius: const Radius.circular(14),
        largeArc: true,
      )
      ..close();
    canvas.drawShadow(pin, const Color(0xFF141828), 4, false);
    canvas.drawPath(
      pin,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF5B6BD8), Color(0xFF2F3C9E), Color(0xFF1B2466)],
          stops: [0, 0.55, 1],
        ).createShader(Offset.zero & size),
    );
    canvas.drawPath(
      pin,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1
        ..color = const Color(0xFF151C52),
    );
    canvas.drawCircle(const Offset(18, 13), 5, Paint()..color = Colors.white);
    canvas.drawArc(
      Rect.fromCircle(center: const Offset(18, 15), radius: 10),
      math.pi * 1.1,
      math.pi * 0.45,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.2
        ..strokeCap = StrokeCap.round
        ..color = Colors.white.withValues(alpha: 0.55),
    );
  }

  @override
  bool shouldRepaint(covariant _PinPainter old) => false;
}
