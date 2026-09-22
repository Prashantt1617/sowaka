import 'dart:async';

import 'package:flutter/material.dart';

import 'relay_style.dart';

/// The sunburst banner that moves between the lobby and the rules
/// (Figma 2603:31280 "How to Play", 2606:35931 "Back to Lobby").
///
/// Both are the same artwork facing opposite ways: going to the rules, the
/// team sits left and the arrow points on; coming back, the arrow points back
/// and the team moves right. Drawn at the design's 74pt with the figures and
/// flag spilling past the edges, as they do there.
class RelayBannerButton extends StatelessWidget {
  const RelayBannerButton({
    super.key,
    required this.label,
    required this.back,
    this.onTap,
  });

  final String label;

  /// Arrow pointing back (left), team on the right.
  final bool back;
  final VoidCallback? onTap;

  static const double height = 74;
  static const _ink = Color(0xFF723509);

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: SizedBox(
          height: height,
          child: LayoutBuilder(builder: (context, box) {
            final width = box.maxWidth;
            // The design's row: its contents are wider than the space left by
            // the padding, and stay centred in it, so they are placed from the
            // centre of that space — which is what keeps the overhang right.
            final double start;
            if (back) {
              // pl 41, pr 16; arrow 65 + text 180, gap 22, team 110.
              start = 41 + (width - 57) / 2 - 377 / 2;
            } else {
              // pr 7; team 110, text 180, arrow 65.
              start = (width - 7) / 2 - 355 / 2;
            }
            final arrowLeft = back ? start : start + 110 + 180;
            final textLeft = back ? start + 65 : start + 110;
            final teamLeft = back ? start + 65 + 180 + 22 : start;
            return Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned.fill(child: _surface()),
                Positioned(
                  left: teamLeft,
                  top: (height - 110) / 2,
                  width: 110,
                  height: 110,
                  child: _crop(
                    'banner_team.png',
                    left: 0.0002,
                    top: -0.086,
                    width: 1,
                    height: 1,
                  ),
                ),
                Positioned(
                  left: textLeft,
                  top: 0,
                  bottom: 0,
                  width: 180,
                  child: Align(
                    alignment: back ? Alignment.centerLeft : Alignment.centerRight,
                    child: Text(
                      label,
                      textAlign: back ? TextAlign.left : TextAlign.right,
                      maxLines: 1,
                      softWrap: false,
                      style: RelayStyle.sora(
                        24,
                        weight: FontWeight.w600,
                        color: _ink,
                        height: 16.2,
                        spacing: -0.16,
                      ),
                    ),
                  ),
                ),
                Positioned(
                  left: arrowLeft,
                  top: (height - 44) / 2,
                  width: 65,
                  height: 44,
                  child: Transform.flip(
                    flipX: back,
                    child: _crop(
                      'banner_arrow.png',
                      left: -0.1402,
                      top: -0.4746,
                      width: 1.3108,
                      height: 1.9349,
                    ),
                  ),
                ),
              ],
            );
          }),
        ),
      ),
    );
  }

  Widget _surface() {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xD4F7F7F9),
        borderRadius: BorderRadius.circular(14),
      ),
      foregroundDecoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: _crop(
          'banner_rays.jpg',
          left: -0.0649,
          top: -1.1314,
          width: 1.1346,
          height: 2.8443,
        ),
      ),
    );
  }

  /// An image placed the way the design places it: sized and offset as
  /// fractions of its box, and cut to that box.
  static Widget _crop(
    String file, {
    required double left,
    required double top,
    required double width,
    required double height,
  }) {
    return ClipRect(
      child: LayoutBuilder(
        builder: (context, box) => Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned(
              left: left * box.maxWidth,
              top: top * box.maxHeight,
              width: width * box.maxWidth,
              height: height * box.maxHeight,
              child: Image.asset('${RelayStyle.asset}/$file', fit: BoxFit.fill),
            ),
          ],
        ),
      ),
    );
  }
}

/// The chunky lime button — "View game" on the feed card (Figma 2606:31941)
/// and "Submit" on the answer card (2638:36748).
///
/// At rest it is the design's artwork, cropped as drawn. Held down, the face
/// sinks onto its green base, so a tap feels like pressing a real key; the
/// action fires when the finger lifts, the way buttons do everywhere else.
class RelayCtaButton extends StatefulWidget {
  const RelayCtaButton({
    super.key,
    required this.label,
    required this.labelPadding,
    this.onTap,
    this.height = 101,
  });

  final String label;

  /// Where the label sits on the artwork, from the design.
  final EdgeInsets labelPadding;
  final double height;

  /// Null greys the button out and ignores touches.
  final VoidCallback? onTap;

  static const _ink = Color(0xFF078442);

  @override
  State<RelayCtaButton> createState() => _RelayCtaButtonState();
}

class _RelayCtaButtonState extends State<RelayCtaButton> {
  bool _down = false;
  Timer? _release;

  // Where the key itself sits in the artwork's box, as fractions: the rest is
  // the transparent margin the design crops with.
  static const _keyLeft = 0.0244;
  static const _keyRight = 0.031;
  static const _keyTop = 0.137;
  static const _keyBottom = 0.109;

  /// How far the face travels when held — most of the base's depth.
  static const _travel = 7.0;

  void _set(bool down) {
    _release?.cancel();
    if (_down != down) setState(() => _down = down);
  }

  /// A quick tap is over before a frame of "held" would show, so the face
  /// stays down a moment after the finger lifts — long enough to be seen.
  void _lift() {
    _release?.cancel();
    _release = Timer(const Duration(milliseconds: 140), () {
      if (mounted) setState(() => _down = false);
    });
  }

  @override
  void dispose() {
    _release?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: enabled ? (_) => _set(true) : null,
        onTapCancel: enabled ? () => _set(false) : null,
        onTapUp: enabled ? (_) => _lift() : null,
        onTap: widget.onTap,
        child: Opacity(
          opacity: enabled ? 1 : 0.55,
          child: SizedBox(
            height: widget.height,
            child: LayoutBuilder(builder: (context, box) {
              final w = box.maxWidth;
              final h = box.maxHeight;
              return Stack(
                clipBehavior: Clip.none,
                children: [
                  if (_down)
                    Positioned(
                      left: _keyLeft * w,
                      right: _keyRight * w,
                      top: _keyTop * h + _travel,
                      bottom: _keyBottom * h,
                      child: const _PressedKey(),
                    )
                  else
                    Positioned(
                      left: -0.0518 * w,
                      top: -0.7192 * h,
                      width: 1.0976 * w,
                      height: 2.4658 * h,
                      child: Image.asset('${RelayStyle.asset}/game_cta.png', fit: BoxFit.fill),
                    ),
                  Positioned.fill(
                    child: Transform.translate(
                      offset: Offset(0, _down ? _travel : 0),
                      child: Padding(
                        padding: widget.labelPadding,
                        child: Center(
                          child: Text(
                            widget.label,
                            textAlign: TextAlign.center,
                            maxLines: 1,
                            softWrap: false,
                            style: RelayStyle.sora(
                              24,
                              weight: FontWeight.w700,
                              color: RelayCtaButton._ink,
                              height: 24,
                              spacing: -0.16,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              );
            }),
          ),
        ),
      ),
    );
  }
}

/// The key held down: the whole face drops, its outline with it, leaving just
/// a lip of the green base.
class _PressedKey extends StatelessWidget {
  const _PressedKey();

  static const _outline = Color(0xFF0B5E1F);
  static const _base = Color(0xFF16923A);
  static const _face = Color(0xFFBEFC1E);
  static const _rim = Color(0xFFDDFF7A);
  static const _faceEdge = Color(0xFF9CD81A);

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: _base,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _outline, width: 3),
      ),
      // Held, the face has come down onto the base and only its lip shows.
      padding: const EdgeInsets.only(bottom: 4),
      // The face's lower edge is a darker lime and its top catches the light;
      // layered rather than bordered, since a rounded border takes one colour.
      child: Container(
        decoration: BoxDecoration(
          color: _faceEdge,
          borderRadius: BorderRadius.circular(11),
        ),
        padding: const EdgeInsets.only(bottom: 2.5),
        child: Container(
          decoration: BoxDecoration(
            color: _rim,
            borderRadius: BorderRadius.circular(11),
          ),
          padding: const EdgeInsets.fromLTRB(1.5, 2, 1.5, 0),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: _face,
              borderRadius: BorderRadius.circular(10),
            ),
          ),
        ),
      ),
    );
  }
}
