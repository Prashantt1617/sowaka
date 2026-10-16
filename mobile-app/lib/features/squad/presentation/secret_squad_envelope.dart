import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'secret_squad_style.dart';

/// The feed card's top-secret envelope ("Secret Squad Feed Card" design):
/// it bobs over its shadow, its flap opens and its wax seal pops off, a word
/// card rises out through MARS, TWIX, KITKAT and a red "?", and three
/// sparkles twinkle round it.
///
/// Every motion is the design's own CSS keyframes, timed from one clock:
/// bob and shadow 3.2 s, flap, seal and card 4 s, the word 16 s (4 s each),
/// sparkles 2.4 s; 48 s brings them all back together. With animations off
/// (MediaQuery.disableAnimations) it holds still, closed, on MARS, as the
/// design's reduced-motion rule does.
class SecretSquadEnvelope extends StatefulWidget {
  const SecretSquadEnvelope({super.key, this.debugTime});

  /// Draws the envelope frozen at this many seconds into its cycle; for
  /// tests and screenshots only.
  final double? debugTime;

  static const size = Size(112, 128);

  @override
  State<SecretSquadEnvelope> createState() => _SecretSquadEnvelopeState();
}

class _SecretSquadEnvelopeState extends State<SecretSquadEnvelope>
    with SingleTickerProviderStateMixin {
  /// 48 s: the least time after which every loop is back where it started.
  static const _cycle = 48.0;

  late final AnimationController _clock = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 48),
  );

  bool _still = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _still = MediaQuery.disableAnimationsOf(context);
    if (_still || widget.debugTime != null) {
      _clock.stop();
    } else if (!_clock.isAnimating) {
      _clock.repeat();
    }
  }

  @override
  void dispose() {
    _clock.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: RepaintBoundary(
        child: SizedBox.fromSize(
          size: SecretSquadEnvelope.size,
          child: AnimatedBuilder(
            animation: _clock,
            builder: (context, _) => _EnvelopeFrame(
              frame: _still
                  ? const _Frame.still()
                  : _Frame.at(widget.debugTime ?? _clock.value * _cycle),
            ),
          ),
        ),
      ),
    );
  }
}

/// CSS `ease-in-out`, applied per keyframe segment as a browser does.
const _ease = Cubic(0.42, 0, 0.58, 1);

/// The word card's springy `cubic-bezier(.3,1.4,.5,1)`: it overshoots.
const _spring = Cubic(0.3, 1.4, 0.5, 1);

/// One keyframed value: [stops] are (fraction of the loop, value) pairs, and
/// between two the value moves along [curve].
double _keyframes(double p, List<(double, double)> stops, Curve curve) {
  if (p <= stops.first.$1) return stops.first.$2;
  for (var i = 1; i < stops.length; i++) {
    final (at, value) = stops[i];
    if (p <= at) {
      final (fromAt, from) = stops[i - 1];
      if (at == fromAt) return value;
      final t = curve.transform((p - fromAt) / (at - fromAt));
      return from + (value - from) * t;
    }
  }
  return stops.last.$2;
}

double _loop(double seconds, double period) =>
    (seconds % period + period) % period / period;

/// Where everything is at one moment.
class _Frame {
  const _Frame.still()
    : bobY = 0,
      bobTurn = 0,
      shadowScale = 1,
      shadowOpacity = 0.9,
      flapScale = 1,
      flapZ = 4,
      sealScale = 1,
      sealOpacity = 1,
      cardY = 0,
      word = 0,
      sparks = const [(1, 0, 1), (1, 0, 1), (1, 0, 1)];

  factory _Frame.at(double t) {
    // bob 3.2 s: translateY(0) rotate(-6deg) ↔ translateY(-9px) rotate(4deg)
    final bob = _loop(t, 3.2);
    final bobY = _keyframes(bob, const [(0, 0), (0.5, -9), (1, 0)], _ease);
    final bobTurn = _keyframes(bob, const [(0, -6), (0.5, 4), (1, -6)], _ease);
    // shadow 3.2 s: scaleX 1 ↔ .72, opacity .9 ↔ .5
    final shadowScale = _keyframes(bob, const [
      (0, 1),
      (0.5, 0.72),
      (1, 1),
    ], _ease);
    final shadowOpacity = _keyframes(bob, const [
      (0, 0.9),
      (0.5, 0.5),
      (1, 0.9),
    ], _ease);
    // flap 4 s: closed to 14%, open 28–72%, closed again from 86%. Its
    // z-index runs 4 → 1 and back with it, in whole steps.
    final four = _loop(t, 4);
    const flapStops = [
      (0.0, 1.0),
      (0.14, 1.0),
      (0.28, -1.0),
      (0.72, -1.0),
      (0.86, 1.0),
      (1.0, 1.0),
    ];
    const zStops = [
      (0.0, 4.0),
      (0.14, 4.0),
      (0.28, 1.0),
      (0.72, 1.0),
      (0.86, 4.0),
      (1.0, 4.0),
    ];
    // seal 4 s: gone 22–78%.
    const sealStops = [
      (0.0, 1.0),
      (0.12, 1.0),
      (0.22, 0.0),
      (0.78, 0.0),
      (0.90, 1.0),
      (1.0, 1.0),
    ];
    // rise 4 s: the card up 34 px 40–66%, on the spring.
    const riseStops = [
      (0.0, 0.0),
      (0.22, 0.0),
      (0.40, -34.0),
      (0.66, -34.0),
      (0.82, 0.0),
      (1.0, 0.0),
    ];
    final seal = _keyframes(four, sealStops, _ease);
    // word 16 s, steps(1, end): each word for 4 s, MARS first.
    final word = (_loop(t, 16) * 4).floor().clamp(0, 3);
    // twinkle 2.4 s, the three sparkles .2 s, 1.1 s and 1.7 s behind.
    final sparks = [
      for (final delay in const [0.2, 1.1, 1.7])
        () {
          final p = _loop(t - delay, 2.4);
          return (
            _keyframes(p, const [(0, 0.3), (0.5, 1), (1, 0.3)], _ease),
            _keyframes(p, const [(0, 0), (0.5, 45), (1, 0)], _ease),
            _keyframes(p, const [(0, 0), (0.5, 1), (1, 0)], _ease),
          );
        }(),
    ];
    return _Frame._(
      bobY: bobY,
      bobTurn: bobTurn,
      shadowScale: shadowScale,
      shadowOpacity: shadowOpacity,
      flapScale: _keyframes(four, flapStops, _ease),
      flapZ: _keyframes(four, zStops, _ease).round(),
      sealScale: seal,
      sealOpacity: seal,
      cardY: _keyframes(four, riseStops, _spring),
      word: word,
      sparks: sparks,
    );
  }

  const _Frame._({
    required this.bobY,
    required this.bobTurn,
    required this.shadowScale,
    required this.shadowOpacity,
    required this.flapScale,
    required this.flapZ,
    required this.sealScale,
    required this.sealOpacity,
    required this.cardY,
    required this.word,
    required this.sparks,
  });

  final double bobY;

  /// Degrees.
  final double bobTurn;
  final double shadowScale;
  final double shadowOpacity;

  /// 1 closed, -1 flipped up open.
  final double flapScale;

  /// The flap's CSS z-index: 4 over everything, 1 behind the card.
  final int flapZ;
  final double sealScale;
  final double sealOpacity;
  final double cardY;

  /// 0 MARS, 1 TWIX, 2 KITKAT, 3 "?".
  final int word;

  /// Each sparkle's (scale, degrees, opacity).
  final List<(double, double, double)> sparks;
}

class _EnvelopeFrame extends StatelessWidget {
  const _EnvelopeFrame({required this.frame});

  final _Frame frame;

  static const _words = ['MARS', 'TWIX', 'KITKAT', '?'];

  @override
  Widget build(BuildContext context) {
    final f = frame;
    // The flap's place among the layers follows its z-index: over the front
    // (4, 3), between the card and the front (2), behind the card (1).
    final back = Positioned.fill(
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: const Color(0xFFC99A00),
          borderRadius: BorderRadius.circular(8),
        ),
      ),
    );
    final card = Positioned(
      left: 8,
      right: 8,
      top: 6,
      height: 58,
      child: Transform.translate(
        offset: Offset(0, f.cardY),
        child: _WordCard(word: _words[f.word], alarm: f.word == 3),
      ),
    );
    const front = Positioned.fill(child: _EnvelopeFront());
    final flap = Positioned(
      left: 0,
      right: 0,
      top: 0,
      height: 66 * 0.62,
      child: Transform(
        alignment: Alignment.topCenter,
        transform: Matrix4.diagonal3Values(1, f.flapScale, 1),
        child: const _EnvelopeFlap(),
      ),
    );
    final layers = switch (f.flapZ) {
      >= 3 => [back, card, front, flap],
      2 => [back, card, flap, front],
      _ => [back, flap, card, front],
    };
    return Stack(
      clipBehavior: Clip.none,
      children: [
        // The shadow on the ground, under the floating envelope.
        Positioned(
          left: 22,
          top: 112,
          width: 68,
          height: 10,
          child: Opacity(
            opacity: f.shadowOpacity,
            child: Transform(
              alignment: Alignment.center,
              transform: Matrix4.diagonal3Values(f.shadowScale, 1, 1),
              child: ImageFiltered(
                imageFilter: ui.ImageFilter.blur(sigmaX: 1.5, sigmaY: 1.5),
                child: const DecoratedBox(
                  decoration: ShapeDecoration(
                    color: Color(0x59070A1A),
                    shape: OvalBorder(),
                  ),
                ),
              ),
            ),
          ),
        ),
        _spark(left: 2, top: 22, size: 10, spark: f.sparks[0]),
        _spark(left: 112 - 8, top: 8, size: 8, spark: f.sparks[1]),
        _spark(left: 112 - 6 - 7, top: 84, size: 7, spark: f.sparks[2]),
        Positioned(
          left: 10,
          top: 30,
          width: 92,
          height: 66,
          child: Transform(
            alignment: Alignment.center,
            transform: Matrix4.translationValues(0, f.bobY, 0)
              ..rotateZ(f.bobTurn * math.pi / 180),
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                ...layers,
                // The wax seal, on the flap's tip.
                Positioned(
                  left: 46 - 12,
                  top: 66 * 0.44,
                  width: 24,
                  height: 24,
                  child: Opacity(
                    opacity: f.sealOpacity.clamp(0, 1),
                    child: Transform.scale(
                      scale: f.sealScale,
                      child: const _Seal(),
                    ),
                  ),
                ),
                const Positioned(left: 6, bottom: 6, child: _Stamp()),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _spark({
    required double left,
    required double top,
    required double size,
    required (double, double, double) spark,
  }) {
    final (scale, degrees, opacity) = spark;
    return Positioned(
      left: left,
      top: top,
      width: size,
      height: size,
      child: Opacity(
        opacity: opacity.clamp(0, 1),
        child: Transform(
          alignment: Alignment.center,
          transform: Matrix4.diagonal3Values(scale, scale, 1)
            ..rotateZ(degrees * math.pi / 180),
          child: const CustomPaint(painter: _SparkPainter()),
        ),
      ),
    );
  }
}

class _WordCard extends StatelessWidget {
  const _WordCard({required this.word, required this.alarm});

  final String word;
  final bool alarm;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(7),
        boxShadow: const [
          BoxShadow(color: Color(0x1F000000), offset: Offset(0, 2)),
        ],
      ),
      child: Center(
        child: Text(
          word,
          maxLines: 1,
          softWrap: false,
          style: SquadStyle.lexend(
            alarm ? 22 : 14,
            FontWeight.w800,
            alarm ? const Color(0xFFE8434F) : const Color(0xFF141B3F),
            spacing: (alarm ? 22 : 14) * 0.06,
          ),
        ),
      ),
    );
  }
}

/// The envelope's front: the pocket, cut in a V under the flap.
class _EnvelopeFront extends StatelessWidget {
  const _EnvelopeFront();

  @override
  Widget build(BuildContext context) {
    return ClipPath(
      clipper: const _PolygonClipper([
        Offset(0, 0.18),
        Offset(0.5, 0.58),
        Offset(1, 0.18),
        Offset(1, 1),
        Offset(0, 1),
      ]),
      child: LayoutBuilder(
        builder: (context, box) => DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            gradient: SquadStyle.cssGradient(
              160,
              box.biggest,
              const [Color(0xFFFFE27A), Color(0xFFFFCC2E), Color(0xFFF2B705)],
              const [0, 0.55, 1],
            ),
          ),
        ),
      ),
    );
  }
}

class _EnvelopeFlap extends StatelessWidget {
  const _EnvelopeFlap();

  @override
  Widget build(BuildContext context) {
    return const ClipPath(
      clipper: _PolygonClipper([Offset(0, 0), Offset(1, 0), Offset(0.5, 1)]),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.vertical(top: Radius.circular(8)),
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFFFFD84D), Color(0xFFE8B000)],
          ),
        ),
      ),
    );
  }
}

class _Seal extends StatelessWidget {
  const _Seal();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        color: Color(0xFFE8434F),
        boxShadow: [BoxShadow(color: Color(0xFF9B1C2A), offset: Offset(0, 2))],
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          // The inset shade along its lower edge (inset 0 -3px 0).
          ClipOval(child: CustomPaint(painter: _InsetShadePainter())),
          Center(
            child: Text(
              'S',
              style: SquadStyle.lexend(
                12,
                FontWeight.w800,
                const Color(0xFFFFE3E5),
                height: 1,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InsetShadePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final circle = Path()..addOval(Offset.zero & size);
    final lifted = Path()..addOval(Offset(0, -3) & size);
    canvas.drawPath(
      Path.combine(PathOperation.difference, circle, lifted),
      Paint()..color = const Color(0x26000000),
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _Stamp extends StatelessWidget {
  const _Stamp();

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: 0.8,
      child: Transform.rotate(
        angle: -8 * math.pi / 180,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1),
          decoration: BoxDecoration(
            border: Border.all(color: const Color(0xFF9B1C2A), width: 1.5),
            borderRadius: BorderRadius.circular(3),
          ),
          child: Text(
            'TOP SECRET',
            style: SquadStyle.lexend(
              7.5,
              FontWeight.w800,
              const Color(0xFF9B1C2A),
              spacing: 7.5 * 0.12,
            ),
          ),
        ),
      ),
    );
  }
}

/// A four-pointed sparkle: two crossed bars, 2 thick, rounded.
class _SparkPainter extends CustomPainter {
  const _SparkPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = const Color(0xFFFFE27A);
    final c = size.center(Offset.zero);
    canvas
      ..drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromCenter(center: c, width: size.width, height: 2),
          const Radius.circular(2),
        ),
        paint,
      )
      ..drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromCenter(center: c, width: 2, height: size.height),
          const Radius.circular(2),
        ),
        paint,
      );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// CSS `clip-path: polygon(...)`, with points as fractions of the box.
class _PolygonClipper extends CustomClipper<Path> {
  const _PolygonClipper(this.points);

  final List<Offset> points;

  @override
  Path getClip(Size size) => Path()
    ..addPolygon([
      for (final p in points) Offset(p.dx * size.width, p.dy * size.height),
    ], true);

  @override
  bool shouldReclip(covariant _PolygonClipper oldClipper) => false;
}
