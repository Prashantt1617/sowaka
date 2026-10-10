import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// The Games tab's look, from the Figma section 3692:43200 (frames 3573:61034
/// and 3623:31816): its colours, its three type faces, its dotted page and
/// its green "Game CTA" button. Public, so other game screens can match it.
abstract final class GamesStyle {
  static const asset = 'assets/games_home';

  static const ink = Color(0xFF160D2C);
  static const ink2 = Color(0xFF150C2E);
  static const night = Color(0xFF2D1D55);
  static const nightBorder = Color(0xFF50368B);
  static const rowBorder = Color(0xFF4A3A8C);
  static const page = Color(0xFFFFF9ED);
  static const pageDot = Color(0xFFFFEEBA);
  static const cream = Color(0xFFFFF8E3);
  static const cream2 = Color(0xFFFFF6E5);
  static const yellow = Color(0xFFFFCC2E);
  static const yellow2 = Color(0xFFFFC531);
  static const pink = Color(0xFFFF5094);
  static const pink2 = Color(0xFFFF5C93);
  static const lilac = Color(0xFFC7BDDE);
  static const lilacSoft = Color(0xFFC9BFE8);
  static const purple = Color(0xFFA08CFF);
  static const purpleArt = Color(0xFF8FA0FF);
  static const blue = Color(0xFF5CC8FF);
  static const blueArt = Color(0xFFBCEDFF);
  static const mint = Color(0xFF73E7BF);
  static const mintArt = Color(0xFFE6FFF6);
  static const green = Color(0xFF2EE6A6);
  static const ctaInk = Color(0xFF078442);
  static const violetText = Color(0xFF6C3FD5);
  static const muted = Color(0xFF4A4266);
  static const secondary = Color(0xFF484848);

  /// Lilita One, the display face. One weight.
  static TextStyle lilita(
    double size, {
    Color color = ink,
    double? height,
    double? spacing,
    List<Shadow>? shadows,
  }) => TextStyle(
    fontFamily: 'Lilita One',
    fontSize: size,
    color: color,
    height: height == null ? null : height / size,
    letterSpacing: spacing,
    shadows: shadows,
  );

  /// Figtree, the small print.
  static TextStyle figtree(
    double size, {
    FontWeight weight = FontWeight.w400,
    Color color = ink2,
    double? height,
    double? spacing,
  }) => TextStyle(
    fontFamily: 'Figtree',
    fontSize: size,
    fontWeight: weight,
    fontVariations: [FontVariation.weight(weight.value.toDouble())],
    color: color,
    height: height == null ? null : height / size,
    letterSpacing: spacing,
  );

  /// Sora, the body face (already the engagement cards').
  static TextStyle sora(
    double size, {
    FontWeight weight = FontWeight.w400,
    Color color = ink,
    double? height,
    double? spacing,
  }) => TextStyle(
    fontFamily: 'Sora',
    fontSize: size,
    fontWeight: weight,
    fontVariations: [FontVariation.weight(weight.value.toDouble())],
    color: color,
    height: height == null ? null : height / size,
    letterSpacing: spacing,
  );

  /// "7,650" — thousands grouped as the design writes them.
  static String count(num value) {
    final digits = value.round().abs().toString();
    final grouped = digits.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
    return value < 0 ? '-$grouped' : grouped;
  }
}

/// The design's green "Game CTA": a bitmap of a bevelled key with the label
/// set on it (imgGameCta, `assets/games_home/game_cta.png`).
///
/// The bitmap is the design's own, placed exactly as its CSS places it — a
/// stretched image hanging past the box on every side, the button itself
/// filling the box — so it reads the same at every size the design uses it.
/// [small] is the variant the explore cards use (imgGameCta1), drawn from a
/// larger canvas with its own placement.
class GameCtaButton extends StatefulWidget {
  const GameCtaButton({
    super.key,
    required this.label,
    required this.onTap,
    this.height = 83,
    this.width,
    this.fontSize = 24,
    this.small = false,
    this.labelCenter = 0.446,
  });

  final String label;
  final VoidCallback? onTap;
  final double height;
  final double? width;
  final double fontSize;
  final bool small;

  /// How far down the box the label's middle sits, as a share of its height.
  /// The design sets it on the key's top face, above the box's middle: at
  /// 0.446 for the 83pt key and the explore cards' 48pt one, 0.467 for the
  /// 60pt Accept and 0.44 for the 57pt one on Your Games.
  final double labelCenter;

  /// imgGameCta: `h-[246.58%] left-[-5.18%] top-[-71.92%] w-[109.76%]`.
  static const _large = (left: -0.0518, top: -0.7192, width: 1.0976, height: 2.4658);

  /// imgGameCta1: `h-[386.17%] left-[-86.02%] top-[-142.14%] w-[272%]`.
  static const _small = (left: -0.8602, top: -1.4214, width: 2.72, height: 3.8617);

  @override
  State<GameCtaButton> createState() => _GameCtaButtonState();
}

class _GameCtaButtonState extends State<GameCtaButton> {
  bool _down = false;

  void _set(bool down) {
    if (_down != down) setState(() => _down = down);
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    final place = widget.small ? GameCtaButton._small : GameCtaButton._large;
    final image = widget.small ? 'game_cta_small.png' : 'game_cta.png';
    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.label,
      onTap: widget.onTap,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: enabled ? (_) => _set(true) : null,
        onTapCancel: enabled ? () => _set(false) : null,
        onTapUp: enabled ? (_) => _set(false) : null,
        onTap: widget.onTap == null
            ? null
            : () {
                HapticFeedback.selectionClick();
                widget.onTap!();
              },
        child: Opacity(
          opacity: enabled ? 1 : 0.55,
          child: SizedBox(
            height: widget.height,
            width: widget.width,
            child: LayoutBuilder(
              builder: (context, box) {
                final w = box.maxWidth;
                final h = box.maxHeight;
                return AnimatedSlide(
                  // Pressed, the key sinks a little into its base.
                  offset: Offset(0, _down ? 0.03 : 0),
                  duration: const Duration(milliseconds: 70),
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      Positioned(
                        left: place.left * w,
                        top: place.top * h,
                        width: place.width * w,
                        height: place.height * h,
                        child: Image.asset(
                          '${GamesStyle.asset}/$image',
                          fit: BoxFit.fill,
                          filterQuality: FilterQuality.medium,
                        ),
                      ),
                      Positioned(
                        left: 0,
                        right: 0,
                        top: widget.labelCenter * h - widget.fontSize,
                        height: widget.fontSize * 2,
                        child: Center(
                          child: Text(
                            widget.label,
                            maxLines: 1,
                            softWrap: false,
                            overflow: TextOverflow.fade,
                            textAlign: TextAlign.center,
                            style: GamesStyle.sora(
                              widget.fontSize,
                              weight: FontWeight.w700,
                              color: GamesStyle.ctaInk,
                              height: widget.fontSize,
                              spacing: -0.16,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

/// The page's dot grid (node 3575:28025): 3pt dots every 18.2pt, from 9.5pt
/// in, in the cream the design draws them.
class GamesDotBackground extends StatelessWidget {
  const GamesDotBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(color: GamesStyle.page),
      child: CustomPaint(painter: const _DotGrid(), child: child),
    );
  }
}

class _DotGrid extends CustomPainter {
  const _DotGrid();

  static const _step = 18.2;
  static const _origin = 9.5;
  static const _radius = 1.5;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = GamesStyle.pageDot;
    for (var y = _origin; y < size.height + _radius; y += _step) {
      for (var x = _origin; x < size.width + _radius; x += _step) {
        canvas.drawCircle(Offset(x, y), _radius, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DotGrid oldDelegate) => false;
}
