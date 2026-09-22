import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// The game's look, taken from the Figma file so every screen agrees.
///
/// Values are the design's own — the gradient angle, the card tints, the type
/// ramp — rather than approximations, because these screens sit next to each
/// other in quick succession and any drift between them shows.
abstract final class RelayStyle {
  static const asset = 'assets/games/relay';

  /// The design's `linear-gradient(137.97deg, #57B9E8 2.94%, #147381 116.62%)`.
  ///
  /// A CSS angle lives in pixel space and its line length depends on the box,
  /// so fixed alignments would only match one screen shape. This works the
  /// endpoints out for the actual size, with the stops folded into them so
  /// nothing falls outside 0–1.
  static LinearGradient backgroundFor(Size size, {double degrees = 137.9677728017552}) {
    final radians = degrees * math.pi / 180;
    final dx = math.sin(radians);
    final dy = -math.cos(radians);
    final half = (size.width * dx.abs() + size.height * dy.abs()) / 2;
    Alignment at(double stop) {
      final along = half * (2 * stop - 1);
      return Alignment(
        size.width == 0 ? 0 : dx * along / (size.width / 2),
        size.height == 0 ? 0 : dy * along / (size.height / 2),
      );
    }

    return LinearGradient(
      begin: at(0.029411),
      end: at(1.1662),
      colors: const [Color(0xFF57B9E8), Color(0xFF147381)],
    );
  }

  static const brand = Color(0xFF0571A6);
  static const ink = Color(0xFF222222);
  static const inkDeep = Color(0xFF111827);
  static const secondary = Color(0xFF484848);
  static const tertiary = Color(0xFF717171);
  static const onBlue = Color(0xFFEBEBEB);
  static const surface = Color(0xFFF7F7F9);
  static const green = Color(0xFF34C759);
  static const online = Color(0xFF00C950);
  static const tint = Color(0xFFCDEDFF);
  static const tintBorder = Color(0x264474EF);

  /// Teammate avatars: the violet ramp for the roster, pink for the lead strip.
  static const avatarViolet = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF667EEA), Color(0xFF764BA2)],
  );
  static const avatarPink = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFF093FB), Color(0xFFF5576C)],
  );

  static TextStyle sora(
    double size, {
    FontWeight weight = FontWeight.w400,
    Color color = ink,
    double? height,
    double? spacing,
  }) =>
      TextStyle(
        fontFamily: 'Sora',
        fontSize: size,
        fontWeight: weight,
        color: color,
        height: height == null ? null : height / size,
        letterSpacing: spacing,
      );

  static Widget svg(String name, {double? width, double? height}) =>
      SvgPicture.asset('$asset/$name.svg', width: width, height: height);
}

/// Every game screen sits on the same gradient with the same page padding.
class RelayBackdrop extends StatelessWidget {
  const RelayBackdrop({super.key, required this.child, this.scroll = true, this.angle});

  final Widget child;
  final bool scroll;

  /// Some screens draw the gradient at their own angle.
  final double? angle;

  @override
  Widget build(BuildContext context) {
    final padded = Padding(
      // 62 top in the design includes the status bar; SafeArea supplies that.
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 22),
      child: child,
    );
    // Expanded to the whole screen: sized to its content, the gradient stopped
    // wherever a short screen's content did and left a white band beneath.
    return SizedBox.expand(
      child: LayoutBuilder(
        builder: (context, constraints) => DecoratedBox(
          decoration: BoxDecoration(
            gradient: angle == null
                ? RelayStyle.backgroundFor(constraints.biggest)
                : RelayStyle.backgroundFor(constraints.biggest, degrees: angle!),
          ),
          child: SafeArea(
            child: scroll ? SingleChildScrollView(child: padded) : padded,
          ),
        ),
      ),
    );
  }
}

/// A round avatar carrying one initial, as the roster and lead strip draw it.
class RelayInitial extends StatelessWidget {
  const RelayInitial({
    super.key,
    required this.name,
    required this.size,
    required this.fontSize,
    this.gradient = RelayStyle.avatarViolet,
  });

  final String name;
  final double size;
  final double fontSize;
  final Gradient gradient;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(shape: BoxShape.circle, gradient: gradient),
      alignment: Alignment.center,
      child: Text(
        name.trim().isEmpty ? '?' : name.trim().characters.first.toUpperCase(),
        style: RelayStyle.sora(fontSize, weight: FontWeight.w700, color: Colors.white),
      ),
    );
  }
}
