import 'dart:math' as math;

import 'package:flutter/material.dart';

/// The Sowaka GAMES lockup the game pages draw in their top-right corner:
/// "sowaka" on the burnt-orange badge with the tilted yellow GAMES tag tucked
/// against it. The app's game screen wears it at the right end of its own
/// header, where the pages draw theirs, so the pages can drop it once this
/// build is out.
///
/// Measured from the pages' CSS (`.swg`): 28 tall at [height] 22 and every
/// part in proportion to it.
class SowakaGamesBadge extends StatelessWidget {
  const SowakaGamesBadge({super.key, this.height = 22});

  final double height;

  @override
  Widget build(BuildContext context) {
    // The pages size everything in units of the lockup's height / 28.577.
    final u = height / 28.577;
    TextStyle type(Color color) => TextStyle(
      fontFamily: 'Sora',
      fontSize: 13 * u,
      height: 1,
      fontWeight: FontWeight.w800,
      letterSpacing: .02 * 13 * u,
      color: color,
    );
    return Semantics(
      label: 'Sowaka Games',
      child: ExcludeSemantics(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              height: 28 * u,
              padding: EdgeInsets.fromLTRB(6 * u, 0, 10 * u, 0),
              decoration: BoxDecoration(
                color: const Color(0xFFB23500),
                borderRadius: BorderRadius.circular(8 * u),
              ),
              alignment: Alignment.center,
              child: Text(
                'sowaka',
                maxLines: 1,
                softWrap: false,
                overflow: TextOverflow.visible,
                style: type(Colors.white),
              ),
            ),
            // The tag sizes itself to GAMES: a fixed width cut it to "GAM…"
            // wherever the font came out a little wider than the page's.
            Transform.translate(
              offset: Offset(-8 * u, 0),
              child: SizedBox(
                height: 28.577 * u,
                child: Center(
                  widthFactor: 1,
                  child: Transform.rotate(
                    angle: -3 * math.pi / 180,
                    child: Container(
                      height: 25 * u,
                      padding: EdgeInsets.symmetric(horizontal: 10 * u),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFCC2E),
                        borderRadius: BorderRadius.circular(7 * u),
                        boxShadow: [
                          BoxShadow(
                            color: const Color(0xFF160D2C),
                            offset: Offset(0, 2 * u),
                          ),
                        ],
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        'GAMES',
                        maxLines: 1,
                        softWrap: false,
                        overflow: TextOverflow.visible,
                        style: type(const Color(0xFF160D2C)),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
