import 'dart:math';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// The face check's screens, from the design canvas of the revised flow
/// (boards D2–D6 for the daily check, S1–S5 for setup): a dark camera screen
/// whose preview and oval never move, with one headline at the top and one
/// optional line under it; a white intro before setup and a white done
/// screen after it. The system font throughout.

const _dark = Color(0xFF16181C);
const _ovalFill = Color(0xFF2A2F36);
const _ringGrey = Color(0xFF3A4049);
const _soft = Color(0xFFB8BFC8);
const _amber = Color(0xFFF5C451);
const _green = Color(0xFF2E9E5B);
const _greenTick = Color(0xFF5CC08A);
const _blue = Color(0xFF1B6FB3);
const _ink = Color(0xFF15181C);
const _muted = Color(0xFF5F6B7A);

/// How the headline reads: as it is, or as a correction (amber).
enum FaceHeadlineTone { plain, fix }

/// The ring round the oval: grey while looking, green once matched; at setup
/// it fills (a fraction, 0..1) as the photos are taken.
class FaceRing {
  const FaceRing.grey() : green = false, fill = null;
  const FaceRing.green() : green = true, fill = null;
  const FaceRing.progress(double this.fill) : green = false;

  final bool green;
  final double? fill;
}

/// Which side of the oval the setup arrow sits on. Never "left" or "right"
/// in words: the preview is a mirror, so the arrow carries the direction.
enum FaceArrowSide { left, right }

/// The one button the camera screen can carry (D6), with a line under it.
class FaceCameraAction {
  const FaceCameraAction({required this.label, required this.onTap, this.busy = false, this.note});
  final String label;
  final VoidCallback? onTap;
  final bool busy;
  final String? note;
}

/// The camera screen (D2–D6, S2–S4).
class FaceCameraView extends StatelessWidget {
  const FaceCameraView({
    super.key,
    required this.headline,
    this.line,
    this.tone = FaceHeadlineTone.plain,
    this.camera,
    this.ring = const FaceRing.grey(),
    this.tick = false,
    this.place,
    this.counter,
    this.onClose,
    this.action,
    this.arrow,
    this.arrowPulse = false,
    this.steps,
    this.dim = false,
  });

  final String headline;
  final String? line;
  final FaceHeadlineTone tone;
  final CameraController? camera;
  final FaceRing ring;

  /// The green tick in the oval (D3).
  final bool tick;

  /// The office the phone is in, top left ("✓ Sowaka Office"); null shows nothing.
  final String? place;

  /// Setup's "1 of 3", top left, in place of the office.
  final String? counter;

  /// The close control; null hides it (D3, while the punch goes through).
  final VoidCallback? onClose;
  final FaceCameraAction? action;
  final FaceArrowSide? arrow;
  final bool arrowPulse;

  /// Setup's three bars at the bottom: (taken, current).
  final (int, int)? steps;

  /// The preview dimmed behind an answer that ends the try (D6).
  final bool dim;

  @override
  Widget build(BuildContext context) {
    final preview = camera;
    final size = preview?.value.isInitialized == true ? preview!.value.previewSize : null;
    final shortScreen = MediaQuery.sizeOf(context).height < 700;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: _dark,
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 4, 24, 24),
            child: Column(
              children: [
                SizedBox(
                  height: 44,
                  child: Row(
                    children: [
                      if (place != null)
                        Row(
                          key: const ValueKey('face-place'),
                          children: [
                            const Icon(Icons.check_rounded, size: 16, color: _greenTick),
                            const SizedBox(width: 6),
                            Text(place!, style: const TextStyle(fontSize: 13, color: _soft)),
                          ],
                        )
                      else if (counter != null)
                        Text(counter!, key: const ValueKey('face-counter'), style: const TextStyle(fontSize: 14, color: _soft)),
                      const Spacer(),
                      if (onClose != null)
                        Semantics(
                          button: true,
                          label: 'Close',
                          child: InkResponse(
                            onTap: onClose,
                            radius: 22,
                            child: const SizedBox(
                              width: 44,
                              height: 44,
                              child: Icon(Icons.close_rounded, color: Colors.white, size: 22),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                SizedBox(height: shortScreen ? 20 : 48),
                Text(
                  headline,
                  key: const ValueKey('face-heading'),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w600,
                    letterSpacing: -0.3,
                    color: tone == FaceHeadlineTone.fix ? _amber : Colors.white,
                    height: 1.25,
                  ),
                ),
                SizedBox(
                  height: 50,
                  child: line == null
                      ? null
                      : Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(
                            line!,
                            key: const ValueKey('face-line'),
                            textAlign: TextAlign.center,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 15, color: _soft),
                          ),
                        ),
                ),
                SizedBox(height: shortScreen ? 12 : 36),
                Expanded(
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.topCenter,
                      child: SizedBox(
                        width: 280,
                        height: 360,
                        child: Stack(
                          clipBehavior: Clip.none,
                          children: [
                            Positioned(
                              left: 10,
                              top: 10,
                              child: ClipOval(
                                child: SizedBox(
                                  width: 260,
                                  height: 340,
                                  child: Stack(
                                    fit: StackFit.expand,
                                    children: [
                                      const ColoredBox(color: _ovalFill),
                                      if (preview != null && size != null)
                                        FittedBox(
                                          fit: BoxFit.cover,
                                          clipBehavior: Clip.hardEdge,
                                          child: SizedBox(
                                            // The sensor's size is landscape; the oval is upright.
                                            width: size.height,
                                            height: size.width,
                                            child: CameraPreview(preview),
                                          ),
                                        ),
                                      if (dim) ColoredBox(color: Colors.black.withValues(alpha: 0.45)),
                                      if (tick)
                                        Center(
                                          child: Container(
                                            key: const ValueKey('face-tick'),
                                            width: 88,
                                            height: 88,
                                            decoration: const BoxDecoration(color: _green, shape: BoxShape.circle),
                                            child: const Icon(Icons.check_rounded, color: Colors.white, size: 48),
                                          ),
                                        ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                            Positioned.fill(child: CustomPaint(painter: _RingPainter(ring))),
                            if (arrow != null)
                              Positioned(
                                left: arrow == FaceArrowSide.left ? 28 : null,
                                right: arrow == FaceArrowSide.right ? 28 : null,
                                top: 148,
                                child: _Arrow(side: arrow!, pulse: arrowPulse),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                if (action != null) ...[
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: FilledButton(
                      key: const ValueKey('face-action'),
                      onPressed: action!.busy ? null : action!.onTap,
                      style: FilledButton.styleFrom(
                        backgroundColor: _blue,
                        disabledBackgroundColor: _blue.withValues(alpha: 0.6),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: action!.busy
                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : Text(action!.label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Colors.white)),
                    ),
                  ),
                  if (action!.note != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(
                        action!.note!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 13, color: _soft, height: 1.5),
                      ),
                    ),
                ],
                if (steps case (final taken, final current))
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Row(
                      key: const ValueKey('face-steps'),
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        for (var i = 0; i < 3; i++)
                          Container(
                            width: 32,
                            height: 6,
                            margin: const EdgeInsets.symmetric(horizontal: 4),
                            decoration: BoxDecoration(
                              color: i < taken ? _green : i == current ? _blue : _ringGrey,
                              borderRadius: BorderRadius.circular(3),
                            ),
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  const _RingPainter(this.ring);
  final FaceRing ring;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(4, 4, size.width - 8, size.height - 8);
    final base = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4
      ..color = ring.green ? _green : _ringGrey;
    canvas.drawOval(rect, base);
    final fill = ring.fill;
    if (fill != null && fill > 0) {
      final arc = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 6
        ..strokeCap = StrokeCap.round
        ..color = fill >= 1 ? _green : _blue;
      canvas.drawArc(rect, -pi / 2, 2 * pi * fill.clamp(0, 1), false, arc);
    }
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.ring.green != ring.green || old.ring.fill != ring.fill;
}

/// The 64 px arrow inside the oval (S3, S4), pulsing when the turn is slow.
class _Arrow extends StatefulWidget {
  const _Arrow({required this.side, required this.pulse});
  final FaceArrowSide side;
  final bool pulse;

  @override
  State<_Arrow> createState() => _ArrowState();
}

class _ArrowState extends State<_Arrow> with SingleTickerProviderStateMixin {
  late final AnimationController _beat = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));

  @override
  void initState() {
    super.initState();
    if (widget.pulse) _beat.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(_Arrow old) {
    super.didUpdateWidget(old);
    if (widget.pulse && !_beat.isAnimating) _beat.repeat(reverse: true);
    if (!widget.pulse && _beat.isAnimating) {
      _beat.stop();
      _beat.value = 0;
    }
  }

  @override
  void dispose() {
    _beat.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Turn your head toward this arrow',
      child: AnimatedBuilder(
        animation: _beat,
        builder: (context, child) => Transform.scale(scale: 1 + 0.15 * _beat.value, child: child),
        child: Container(
          key: ValueKey('face-arrow-${widget.side.name}'),
          width: 64,
          height: 64,
          decoration: const BoxDecoration(color: _blue, shape: BoxShape.circle),
          child: Icon(
            widget.side == FaceArrowSide.left ? Icons.arrow_back_rounded : Icons.arrow_forward_rounded,
            color: Colors.white,
            size: 32,
          ),
        ),
      ),
    );
  }
}

/// Before setup (S1): what it is, three thumbnails, the consent in normal
/// contrast with what is stored, and the button that agrees and starts.
class FaceSetupIntro extends StatelessWidget {
  const FaceSetupIntro({
    super.key,
    required this.consent,
    required this.onStart,
    this.onBack,
    this.onRetry,
    this.problem,
  });

  /// The consent, word for word; null while it loads.
  final String? consent;

  /// Null while the consent has not loaded: the button waits for it.
  final VoidCallback? onStart;
  final VoidCallback? onBack;

  /// The consent failed to load: a link to try again, with [problem].
  final VoidCallback? onRetry;
  final String? problem;

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 4, 24, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: Transform.translate(
                    offset: const Offset(-10, 0),
                    child: IconButton(
                      onPressed: onBack,
                      tooltip: 'Back',
                      icon: const Icon(Icons.arrow_back_rounded, color: _ink),
                    ),
                  ),
                ),
                Expanded(
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const SizedBox(height: 32),
                        const Text(
                          'Set up your face check',
                          style: TextStyle(fontSize: 28, fontWeight: FontWeight.w600, letterSpacing: -0.5, height: 1.2, color: _ink),
                        ),
                        const SizedBox(height: 10),
                        const Text(
                          'Three quick photos. After this, punching in is a glance at the camera.',
                          style: TextStyle(fontSize: 16, color: _muted, height: 1.5),
                        ),
                        const SizedBox(height: 40),
                        Row(
                          children: [
                            for (final (asset, label) in const [
                              ('assets/images/face_check/setup_front.jpg', 'Front'),
                              ('assets/images/face_check/setup_left.jpg', 'Left'),
                              ('assets/images/face_check/setup_right.jpg', 'Right'),
                            ]) ...[
                              if (label != 'Front') const SizedBox(width: 16),
                              Expanded(
                                child: Column(
                                  children: [
                                    AspectRatio(
                                      aspectRatio: 235 / 300,
                                      child: ClipRRect(
                                        borderRadius: BorderRadius.circular(999),
                                        child: Image.asset(asset, fit: BoxFit.cover),
                                      ),
                                    ),
                                    const SizedBox(height: 12),
                                    Text(label, style: const TextStyle(fontSize: 13, color: _muted)),
                                  ],
                                ),
                              ),
                            ],
                          ],
                        ),
                        if (problem != null) ...[
                          const SizedBox(height: 24),
                          Text(problem!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, color: Color(0xFFC0392B), height: 1.4)),
                          if (onRetry != null)
                            TextButton(onPressed: onRetry, child: const Text('Try again')),
                        ],
                      ],
                    ),
                  ),
                ),
                if (consent != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16, top: 12),
                    child: Text.rich(
                      TextSpan(
                        style: const TextStyle(fontSize: 13, color: _muted, height: 1.5),
                        children: [
                          TextSpan(text: '${consent!} '),
                          WidgetSpan(
                            alignment: PlaceholderAlignment.baseline,
                            baseline: TextBaseline.alphabetic,
                            child: GestureDetector(
                              onTap: () => showWhatsStored(context),
                              child: const Text(
                                "What's stored",
                                key: ValueKey('face-whats-stored'),
                                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: _blue, height: 1.5),
                              ),
                            ),
                          ),
                        ],
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                SizedBox(
                  height: 52,
                  child: FilledButton(
                    key: const ValueKey('face-agree'),
                    onPressed: onStart,
                    style: FilledButton.styleFrom(
                      backgroundColor: _blue,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text('Agree and start', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Colors.white)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// What the face check keeps, and where: the retention table behind the
/// consent's "What's stored".
Future<void> showWhatsStored(BuildContext context) {
  const rows = [
    ('Face template', 'A set of numbers describing your face, kept by AWS Rekognition in Mumbai. Deleted when you leave or HR resets your face check.'),
    ('One setup photo', 'The front photo from setup, encrypted in Sowaka\'s private storage, so your face can be set up again without you. Deleted with the template.'),
    ('Daily checks', 'Nothing from them is kept: each selfie is matched and thrown away. Only the time and the result are logged.'),
  ];
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    backgroundColor: Colors.white,
    builder: (context) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text("What's stored", style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: _ink)),
            const SizedBox(height: 16),
            for (final (title, body) in rows)
              Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: _ink)),
                    const SizedBox(height: 4),
                    Text(body, style: const TextStyle(fontSize: 14, color: _muted, height: 1.45)),
                  ],
                ),
              ),
          ],
        ),
      ),
    ),
  );
}

/// After setup (S5): the tick, "You're set up", the punch it made, and Done.
class FaceSetupDone extends StatelessWidget {
  const FaceSetupDone({super.key, required this.line, required this.onDone});

  /// "Punched in at 4:00 PM", or what the setup led to.
  final String? line;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Spacer(),
                Center(
                  child: Container(
                    width: 80,
                    height: 80,
                    decoration: const BoxDecoration(color: Color(0xFFE4F5EB), shape: BoxShape.circle),
                    child: const Icon(Icons.check_rounded, color: _green, size: 40),
                  ),
                ),
                const SizedBox(height: 28),
                const Text(
                  "You're set up",
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 28, fontWeight: FontWeight.w600, letterSpacing: -0.5, color: _ink),
                ),
                if (line != null) ...[
                  const SizedBox(height: 10),
                  Text(line!, key: const ValueKey('face-done-line'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 16, color: _muted)),
                ],
                const Spacer(),
                SizedBox(
                  height: 52,
                  child: FilledButton(
                    key: const ValueKey('face-done'),
                    onPressed: onDone,
                    style: FilledButton.styleFrom(
                      backgroundColor: _blue,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text('Done', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Colors.white)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
