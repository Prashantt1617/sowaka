import 'dart:math' as math;

import 'package:flutter/material.dart';

/// A voice-assistant style wave: layered, translucent sine curves that swell
/// while something plays and settle to a line when it pauses, over a soft
/// glowing orb. Drawn, not measured: the app's player exposes no samples, so
/// the motion follows the clock, with enough drift to never repeat.
class SiriWave extends StatefulWidget {
  const SiriWave({super.key, required this.playing, this.height = 160});

  final bool playing;
  final double height;

  @override
  State<SiriWave> createState() => _SiriWaveState();
}

class _SiriWaveState extends State<SiriWave>
    with SingleTickerProviderStateMixin {
  late final AnimationController _clock = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 60),
  )..repeat();

  /// How much the waves swell: eases towards 1 while playing, 0 when paused.
  double _energy = 0;

  @override
  void dispose() {
    _clock.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _clock,
      builder: (_, _) {
        final target = widget.playing ? 1.0 : 0.0;
        _energy += (target - _energy) * 0.06;
        return CustomPaint(
          size: Size(double.infinity, widget.height),
          painter: _WavePainter(time: _clock.value * 60, energy: _energy),
        );
      },
    );
  }
}

class _WavePainter extends CustomPainter {
  _WavePainter({required this.time, required this.energy});

  final double time;
  final double energy;

  static const _layers = [
    (Color(0xFFFFFFFF), 0.95, 1.00, 1.0, 0.0),
    (Color(0xFF9BD8FF), 0.70, 0.86, 1.3, 1.1),
    (Color(0xFF5EC8FF), 0.55, 0.72, 0.8, 2.3),
    (Color(0xFFB8A6FF), 0.42, 0.60, 1.6, 3.4),
    (Color(0xFF7FE6D6), 0.35, 0.50, 1.1, 4.6),
  ];

  @override
  void paint(Canvas canvas, Size size) {
    final mid = size.height / 2;
    // The glow behind, breathing with the energy.
    final glowRadius =
        size.width * (0.22 + 0.06 * energy) * (1 + 0.04 * math.sin(time * 1.3));
    canvas.drawCircle(
      Offset(size.width / 2, mid),
      glowRadius,
      Paint()
        ..shader =
            RadialGradient(
              colors: [
                const Color(
                  0xFF3DB8FF,
                ).withValues(alpha: 0.55 * (0.4 + 0.6 * energy)),
                const Color(0xFF0571A6).withValues(alpha: 0.0),
              ],
            ).createShader(
              Rect.fromCircle(
                center: Offset(size.width / 2, mid),
                radius: glowRadius,
              ),
            ),
    );

    // The waves, quiet at the edges and full in the middle.
    final baseAmp = size.height * 0.34;
    for (var i = 0; i < _layers.length; i++) {
      final (color, alpha, ampScale, speed, phase) = _layers[i];
      // Each layer has its own slow swell, so they cross rather than stack.
      final swell = 0.55 + 0.45 * math.sin(time * (0.9 + i * 0.17) + phase);
      final amp = baseAmp * ampScale * (0.06 + 0.94 * energy * swell);
      final path = Path();
      for (var x = 0.0; x <= size.width; x += 2) {
        final t = x / size.width;
        // Bell-shaped envelope: the wave lives in the centre and fades to a line.
        final envelope = math.exp(-math.pow((t - 0.5) * 3.2, 2));
        final wave =
            math.sin(
              t * math.pi * (3.0 + i * 0.6) + time * (2.0 * speed) + phase,
            ) *
            envelope;
        final y = mid + amp * wave;
        if (x == 0) {
          path.moveTo(x, y);
        } else {
          path.lineTo(x, y);
        }
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = color.withValues(alpha: alpha * (0.35 + 0.65 * energy))
          ..style = PaintingStyle.stroke
          ..strokeWidth = i == 0 ? 2.4 : 1.8
          ..strokeCap = StrokeCap.round
          ..blendMode = BlendMode.plus,
      );
    }
    // A faint resting line, so paused still reads as a player.
    canvas.drawLine(
      Offset(size.width * 0.18, mid),
      Offset(size.width * 0.82, mid),
      Paint()
        ..color = Colors.white.withValues(alpha: 0.18)
        ..strokeWidth = 1,
    );
  }

  @override
  bool shouldRepaint(_WavePainter old) =>
      old.time != time || old.energy != energy;
}
