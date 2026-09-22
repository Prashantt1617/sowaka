import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'relay_style.dart';

/// The "?" block on the feed card, turning on its upright axis above its
/// shadow (Figma 2606:35622).
///
/// The design's art is a single still render, and spinning a flat picture
/// only flips it like a card — it goes edge-on and vanishes. So the block is
/// built as an actual cube: four sides wearing the render's own "?" face, a
/// top in its yellow, seen from a little above and turned in perspective. The
/// render's drawn shadow stays on the ground beneath it.
class RelaySpinningCube extends StatefulWidget {
  const RelaySpinningCube({super.key, this.size = 168});

  /// The box the design gives the art; the block and shadow sit where the
  /// render put them inside it.
  final double size;

  @override
  State<RelaySpinningCube> createState() => _RelaySpinningCubeState();
}

class _RelaySpinningCubeState extends State<RelaySpinningCube> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 4000),
  );

  // Measured from the 480×360 render, cover-fitted into the square box: the
  // block's centre and front-face width, and the band holding the shadow.
  static const _artHeight = 360.0;
  static const _blockCentre = Offset(244.5, 163);
  static const _faceWidth = 127.0;
  static const _shadowFrom = 279 / _artHeight;

  static const _top = Color(0xFFFCE374);
  static const _tilt = 0.32; // looking down on it, as the render does

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Motion is decoration here; honour the system's reduce-motion setting.
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) {
      _controller.stop();
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = widget.size;
    final scale = size / _artHeight;
    final cropX = (480 * scale - size) / 2;
    final centre = Offset(_blockCentre.dx * scale - cropX, _blockCentre.dy * scale);
    final edge = _faceWidth * scale;

    return SizedBox.square(
      dimension: size,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          final turn = _controller.value * 2 * math.pi;
          final lift = (1 - math.cos(_controller.value * 4 * math.pi)) / 2; // two bobs a turn
          return Stack(
            clipBehavior: Clip.none,
            children: [
              // The render's own shadow, tightening a touch as the block rises.
              ClipRect(
                clipper: const _Band(from: _shadowFrom),
                child: Transform.scale(
                  scaleX: 1 - 0.1 * lift,
                  alignment: const Alignment(0, 0.845),
                  child: Opacity(
                    opacity: 1 - 0.25 * lift,
                    child: Image.asset(
                      '${RelayStyle.asset}/question_mark.png',
                      width: size,
                      height: size,
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
              ),
              Positioned(
                left: centre.dx - edge / 2,
                top: centre.dy - edge / 2 - 4 * lift,
                width: edge,
                height: edge,
                child: _Cube(edge: edge, turn: turn),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _Cube extends StatelessWidget {
  const _Cube({required this.edge, required this.turn});

  final double edge;
  final double turn;

  Matrix4 _view() => Matrix4.identity()
    ..setEntry(3, 2, 0.004)
    ..rotateX(_RelaySpinningCubeState._tilt)
    ..rotateY(turn);

  @override
  Widget build(BuildContext context) {
    final half = edge / 2;
    // Each side's facing: 1 straight on, 0 edge-on, below 0 turned away.
    final sides = [
      for (var k = 0; k < 4; k += 1) (k, math.cos(turn + k * math.pi / 2)),
    ]..sort((a, b) => a.$2.compareTo(b.$2));

    return Stack(
      clipBehavior: Clip.none,
      children: [
        for (final (k, facing) in sides)
          if (facing > 0)
            Transform(
              alignment: Alignment.center,
              transform: _view()
                ..rotateY(k * math.pi / 2)
                ..translateByDouble(0, 0, -half, 1),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  Image.asset('${RelayStyle.asset}/cube_face.png', fit: BoxFit.fill),
                  // Sides turning away catch less light.
                  ColoredBox(color: Colors.black.withValues(alpha: 0.28 * (1 - facing))),
                ],
              ),
            ),
        // The lid, seen from above.
        Transform(
          alignment: Alignment.center,
          transform: _view()
            ..translateByDouble(0, -half, 0, 1)
            ..rotateX(math.pi / 2),
          child: Container(
            decoration: BoxDecoration(
              color: _RelaySpinningCubeState._top,
              borderRadius: BorderRadius.circular(edge * 0.06),
            ),
          ),
        ),
      ],
    );
  }
}

/// The part of the box from [from] (a fraction of its height) to the bottom.
class _Band extends CustomClipper<Rect> {
  const _Band({required this.from});

  final double from;

  @override
  Rect getClip(Size size) => Rect.fromLTRB(0, size.height * from, size.width, size.height);

  @override
  bool shouldReclip(covariant _Band old) => old.from != from;
}
