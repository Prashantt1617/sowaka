import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../content/catalog_content.dart';
import '../content/move_content.dart';
import '../data/care_models.dart';
import 'care_theme.dart';
import 'stretch_screen.dart';

/// Move: which part of your body? The site's silhouette with six pulsing
/// zones, and the same six as chips under it.
class MoveScreen extends StatelessWidget {
  const MoveScreen({super.key, required this.catalog});

  final CareCatalog catalog;

  void _pick(BuildContext context, String key) {
    final stretch = stretchesFrom(catalog).firstWhere((s) => s.key == key);
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => StretchScreen(stretch: stretch, catalog: catalog),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return CarePage(
      backLabel: 'Care',
      background: CareColors.bg,
      children: [
        const CareEyebrow('Move'),
        const SizedBox(height: 10),
        const CareHeading(
          'Which part of your\nbody do you want\nto stretch?',
          size: 23,
          color: CareColors.warmInk,
        ),
        const SizedBox(height: 6),
        const CareCopy(
          'Tap the area that needs attention',
          size: 13.5,
          color: CareColors.warmMuted,
        ),
        const SizedBox(height: 10),
        Center(
          child: BodySilhouette(
            height: 340,
            onZone: (key) => _pick(context, key),
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          alignment: WrapAlignment.center,
          children: [
            for (final stretch in stretchesFrom(catalog))
              Material(
                color: stretch.chipBackground,
                borderRadius: BorderRadius.circular(100),
                child: InkWell(
                  key: ValueKey('zone-chip-${stretch.key}'),
                  onTap: () => _pick(context, stretch.key),
                  borderRadius: BorderRadius.circular(100),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 15,
                      vertical: 10,
                    ),
                    child: Text(
                      stretch.zone,
                      style: TextStyle(
                        fontFamily: careFont,
                        color: stretch.chipForeground,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// The body artwork with the zones drawn over it, pulsing gently, each a
/// tap target sized like the site's.
class BodySilhouette extends StatefulWidget {
  const BodySilhouette({super.key, required this.height, required this.onZone});

  final double height;
  final ValueChanged<String> onZone;

  @override
  State<BodySilhouette> createState() => _BodySilhouetteState();
}

class _BodySilhouetteState extends State<BodySilhouette>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 3),
  )..repeat();

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  void _tap(Offset local, double scale) {
    final x = local.dx / scale;
    final y = local.dy / scale;
    for (final zone in bodyZones) {
      for (final e in zone.ellipses) {
        final dx = (x - e[0]) / (e[2] * 1.2);
        final dy = (y - e[1]) / (e[3] * 1.1);
        if (dx * dx + dy * dy <= 1) {
          widget.onZone(zone.stretchKey);
          return;
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scale = widget.height / bodyArtHeight;
    final width = bodyArtWidth * scale;
    return SizedBox(
      width: width,
      height: widget.height,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapUp: (details) => _tap(details.localPosition, scale),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.asset('assets/care/body.png', fit: BoxFit.fill),
            AnimatedBuilder(
              animation: _pulse,
              builder: (_, _) => CustomPaint(
                painter: _ZonesPainter(scale: scale, t: _pulse.value),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ZonesPainter extends CustomPainter {
  _ZonesPainter({required this.scale, required this.t});

  final double scale;
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    for (var i = 0; i < bodyZones.length; i++) {
      final zone = bodyZones[i];
      final color = stretchByKey(zone.stretchKey).zoneColor;
      // Each zone pulses on its own beat, as on the site.
      final phase = (t + i * 0.2) % 1;
      final pulse = 0.45 + 0.4 * (0.5 - 0.5 * math.cos(phase * 2 * math.pi));
      for (final e in zone.ellipses) {
        final rect = Rect.fromCenter(
          center: Offset(e[0] * scale, e[1] * scale),
          width: e[2] * 2 * scale,
          height: e[3] * 2 * scale,
        );
        canvas.drawOval(
          rect,
          Paint()..color = color.withValues(alpha: 0.3 * pulse),
        );
        canvas.drawOval(
          rect,
          Paint()
            ..color = color.withValues(alpha: 0.55 * pulse)
            ..style = PaintingStyle.stroke
            ..strokeWidth = 5 * scale,
        );
      }
      for (final d in zone.dots) {
        final centre = Offset(d[0] * scale, d[1] * scale);
        canvas.drawCircle(centre, 16 * scale, Paint()..color = color);
        canvas.drawCircle(centre, 7 * scale, Paint()..color = Colors.white);
      }
    }
  }

  @override
  bool shouldRepaint(_ZonesPainter old) => old.t != t || old.scale != scale;
}
