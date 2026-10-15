import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Secret Squad's type and colour, as the "Secret Squad Feed Card" design
/// sets them. The card is set in Lexend, bundled with the app (OFL), and
/// only here.
abstract final class SquadStyle {
  static const fontFamily = 'Lexend';

  static const violetTop = Color(0xFF5B4BD6);
  static const violetMid = Color(0xFF3A2E9E);
  static const navyDeep = Color(0xFF1B1F55);
  static const lilac = Color(0xFFCFC8FF);
  static const lilacText = Color(0xFFE4E0FF);
  static const lilacBox = Color(0xFFEEEAFF);
  static const clockInk = Color(0xFF2E2470);
  static const grey = Color(0xFF5B6075);
  static const gold = Color(0xFFC99A00);
  static const lime = Color(0xFFC6F432);
  static const limeEdge = Color(0xFF1F7A32);
  static const limeInk = Color(0xFF0B5A2A);

  /// The game's own look, for the screens it opens: the scanner.
  static const navy = Color(0xFF141B3F);
  static const navyRaised = Color(0xFF1D2550);
  static const navyLine = Color(0xFF35407A);
  static const navyShadow = Color(0xFF070A1A);
  static const yellow = Color(0xFFFFCC2E);

  /// Lexend at [weight]. The font is variable, so the weight is set on its
  /// axis too, or every weight draws as the file's default.
  ///
  /// Lines are the font's own height (CSS `normal`, 1.25 for Lexend) unless
  /// [height] says otherwise, never what a surrounding theme sets, and any
  /// leading is shared above and below as a browser shares it.
  static TextStyle lexend(
    double size,
    FontWeight weight,
    Color color, {
    double? height,
    double spacing = 0,
    bool tabular = false,
  }) => TextStyle(
    fontFamily: fontFamily,
    fontSize: size,
    fontWeight: weight,
    fontVariations: [FontVariation.weight(weight.value.toDouble())],
    color: color,
    height: height ?? 1.25,
    leadingDistribution: TextLeadingDistribution.even,
    letterSpacing: spacing,
    fontFeatures: tabular ? const [FontFeature.tabularFigures()] : null,
  );

  /// CSS `linear-gradient(<deg>, ...)` over a box of [size]: the gradient
  /// line runs through the centre at that angle (0 up, 90 right) and is
  /// just long enough for its ends to touch the box's far corners.
  static LinearGradient cssGradient(
    double degrees,
    Size size,
    List<Color> colors,
    List<double> stops,
  ) {
    final a = degrees * math.pi / 180;
    final dx = math.sin(a);
    final dy = -math.cos(a);
    final length = (size.width * dx).abs() + (size.height * dy).abs();
    final w = size.width == 0 ? 1.0 : size.width / 2;
    final h = size.height == 0 ? 1.0 : size.height / 2;
    final ex = dx * length / 2 / w;
    final ey = dy * length / 2 / h;
    return LinearGradient(
      begin: Alignment(-ex, -ey),
      end: Alignment(ex, ey),
      colors: colors,
      stops: stops,
    );
  }
}
