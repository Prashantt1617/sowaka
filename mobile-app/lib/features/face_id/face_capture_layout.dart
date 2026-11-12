import 'dart:math';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// The face check's screens, from the design canvas of the revised flow
/// (boards D2–D6 for the daily check, S1–S5 for setup; Figma section
/// 2300:27810 — setup is frames 4200:55075, 4423:35824/35910/35996 and
/// 3357:29653): a dark camera screen whose preview and oval never move, with
/// one headline at the top and one optional line under it, inside a ring of
/// ticks; a white intro before setup and a white done screen after it. Setup
/// is set in Sora as its frames are; the daily check keeps the system font.

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

// The white setup pages (4200:55075, 3357:29653).
const _brand = Color(0xFF0571A6);
const _text = Color(0xFF222222);
const _textSecondary = Color(0xFF484848);
const _textTertiary = Color(0xFF717171);
const _navy = Color(0xFF142A43);
const _cardMuted = Color(0xFF586B7D);
const _cardTop = Color(0xFFF4F7FB);
const _hairline = Color(0xFFDCE3EA);

TextStyle _sora(double size, FontWeight weight, Color color, {double? height, double? spacing}) => TextStyle(
  fontFamily: 'Sora',
  fontSize: size,
  fontWeight: weight,
  color: color,
  height: height,
  letterSpacing: spacing,
);

/// How the headline reads: as it is, or as a correction (amber).
enum FaceHeadlineTone { plain, fix }

/// The ring of ticks round the oval: grey while looking, green once matched
/// (or once setup's three photos are taken); during a setup turn the half on
/// the side to turn toward is green (S3, S4).
class FaceRing {
  const FaceRing.grey() : green = false, side = null;
  const FaceRing.green() : green = true, side = null;
  const FaceRing.turn(FaceArrowSide this.side) : green = false;

  final bool green;
  final FaceArrowSide? side;
}

/// Which side of the oval setup asks the head to turn toward: the screen's
/// side, which in the mirrored preview is the person's own side too.
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
    this.arrowPulse = false,
    this.steps,
    this.dim = false,
    this.setup = false,
    this.progress,
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

  /// The turn is slow: the green half of the ring pulses.
  final bool arrowPulse;

  /// Setup's three bars at the bottom: (taken, current).
  final (int, int)? steps;

  /// The preview dimmed behind an answer that ends the try (D6).
  final bool dim;

  /// Setup's camera (S2–S4): its headline, close icon and spacing, in Sora.
  final bool setup;

  /// The share of an upload sent, 0 to 1: a bar across the oval while it goes.
  final double? progress;

  @override
  Widget build(BuildContext context) {
    final preview = camera;
    final size = preview?.value.isInitialized == true ? preview!.value.previewSize : null;
    final shortScreen = MediaQuery.sizeOf(context).height < 700;
    final fix = tone == FaceHeadlineTone.fix;
    final headlineStyle = setup
        ? _sora(26, FontWeight.w600, fix ? _amber : Colors.white, spacing: -0.4, height: 1.26)
        : TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.w600,
            letterSpacing: -0.3,
            color: fix ? _amber : Colors.white,
            height: 1.25,
          );
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: _dark,
        body: SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(24, 4, 24, setup ? 16 : 24),
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
                            child: SizedBox(
                              width: 44,
                              height: 44,
                              child: setup
                                  ? Center(child: SvgPicture.asset('assets/icons/face/close_white.svg', width: 20, height: 20))
                                  : const Icon(Icons.close_rounded, color: Colors.white, size: 22),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                SizedBox(height: shortScreen ? 20 : (setup ? 64 : 48)),
                Text(headline, key: const ValueKey('face-heading'), textAlign: TextAlign.center, style: headlineStyle),
                // The line's room is kept when there is none, so the oval
                // never moves when one comes and goes.
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
                // The ticks' box is 30 px wider than the oval on every side:
                // setup's oval sits 56 px under the headline's room (S2–S4),
                // the daily check's where it was inside the old solid ring.
                SizedBox(height: shortScreen ? 0 : (setup ? 6 : 16)),
                Expanded(
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.topCenter,
                      child: SizedBox(
                        width: 320,
                        height: 400,
                        child: Stack(
                          clipBehavior: Clip.none,
                          children: [
                            Positioned(
                              left: 30,
                              top: 30,
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
                            Positioned.fill(child: _TickRing(ring: ring, amber: fix, pulse: arrowPulse)),
                            if (progress != null)
                              Positioned(
                                left: 80,
                                right: 80,
                                top: 197,
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(3),
                                  child: LinearProgressIndicator(
                                    key: const ValueKey('face-upload-progress'),
                                    value: progress,
                                    minHeight: 6,
                                    color: Colors.white,
                                    backgroundColor: Colors.white24,
                                  ),
                                ),
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

/// The 64 ticks round the oval (the "Tick ring" of 4423:35926), in a 320 ×
/// 400 box: grey, all green once matched, all amber behind a correction, or
/// green on the half to turn toward — pulsing when the turn is slow.
class _TickRing extends StatefulWidget {
  const _TickRing({required this.ring, required this.amber, required this.pulse});
  final FaceRing ring;
  final bool amber;
  final bool pulse;

  @override
  State<_TickRing> createState() => _TickRingState();
}

class _TickRingState extends State<_TickRing> with SingleTickerProviderStateMixin {
  late final AnimationController _beat = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));

  bool get _pulsing => widget.pulse && widget.ring.side != null;

  @override
  void initState() {
    super.initState();
    if (_pulsing) _beat.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(_TickRing old) {
    super.didUpdateWidget(old);
    if (_pulsing && !_beat.isAnimating) _beat.repeat(reverse: true);
    if (!_pulsing && _beat.isAnimating) {
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
    final side = widget.ring.side;
    final ring = AnimatedBuilder(
      animation: _beat,
      builder: (context, _) => CustomPaint(
        painter: _TickPainter(ring: widget.ring, amber: widget.amber, glow: 1 - 0.55 * _beat.value),
      ),
    );
    if (side == null) return ring;
    return Semantics(
      key: ValueKey('face-arrow-${side.name}'),
      label: 'Turn your head toward the ${side.name}',
      child: ring,
    );
  }
}

class _TickPainter extends CustomPainter {
  const _TickPainter({required this.ring, required this.amber, required this.glow});
  final FaceRing ring;
  final bool amber;

  /// The green half's opacity, 0..1, while it pulses.
  final double glow;

  static const _count = 64;

  @override
  void paint(Canvas canvas, Size size) {
    // Measured from the design's ticks: 3 px, round ends, their inner ends on
    // an ellipse of 136.5 × 178.5 round the box's centre and their outer ends
    // 10.5 % further out along the same line.
    final sx = size.width / 320;
    final sy = size.height / 400;
    final centre = Offset(size.width / 2, size.height / 2);
    final side = ring.side;
    final base = ring.green ? _green : (amber && side == null ? _amber : _ringGrey);
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;
    for (var k = 0; k < _count; k++) {
      final t = 2 * pi * k / _count;
      final inner = Offset(136.5 * sin(t) * sx, -178.5 * cos(t) * sy);
      // The turn's half: every tick on that side but the two nearest the top
      // and the bottom (k 2..30 on the right, 34..62 on the left).
      final lit = switch (side) {
        FaceArrowSide.right => k >= 2 && k <= 30,
        FaceArrowSide.left => k >= 34 && k <= 62,
        null => false,
      };
      paint.color = lit ? _green.withValues(alpha: glow) : base;
      canvas.drawLine(centre + inner, centre + inner * 1.1048, paint);
    }
  }

  @override
  bool shouldRepaint(_TickPainter old) =>
      old.ring.green != ring.green || old.ring.side != ring.side || old.amber != amber || old.glow != glow;
}

/// Before setup (S1, 4200:55075): what it is, the three steps with their
/// photos, the button that agrees and starts, and the consent under it, word
/// for word as the server sends it, with what is stored.
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
        // The frame runs the consent to 26 px above the bottom edge, over
        // the home bar's strip.
        body: SafeArea(
          bottom: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Not drawn in the frame; kept so the page can be left as before.
              SizedBox(
                height: 48,
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Padding(
                    padding: const EdgeInsets.only(left: 4),
                    child: IconButton(
                      onPressed: onBack,
                      tooltip: 'Back',
                      icon: const Icon(Icons.arrow_back_rounded, color: _text),
                    ),
                  ),
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Set up your face check',
                        textAlign: TextAlign.center,
                        style: _sora(20, FontWeight.w600, _text, height: 24 / 20, spacing: 0.4),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'One time setup. After this, punching in is a glance at the camera.',
                        textAlign: TextAlign.center,
                        style: _sora(14, FontWeight.w400, _textSecondary, height: 22 / 14),
                      ),
                      const SizedBox(height: 44),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            for (final (step, asset, label) in const [
                              (1, 'assets/images/face_check/setup_front.jpg', 'Front'),
                              (2, 'assets/images/face_check/setup_left.jpg', 'Left'),
                              (3, 'assets/images/face_check/setup_right.jpg', 'Right'),
                            ]) ...[
                              if (step > 1) const SizedBox(width: 16),
                              Expanded(
                                child: Column(
                                  children: [
                                    Text(
                                      'Step $step',
                                      style: _sora(14, FontWeight.w600, _muted, height: 16.2 / 14, spacing: -0.16),
                                    ),
                                    const SizedBox(height: 12),
                                    ClipOval(
                                      child: Image.asset(asset, width: 88, height: 112, fit: BoxFit.cover),
                                    ),
                                    const SizedBox(height: 12),
                                    Text(label, style: const TextStyle(fontSize: 13, color: _muted)),
                                  ],
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                      if (problem != null) ...[
                        const SizedBox(height: 24),
                        Text(problem!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, color: Color(0xFFC0392B), height: 1.4)),
                        if (onRetry != null) TextButton(onPressed: onRetry, child: const Text('Try again')),
                      ],
                    ],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 24, 16, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SizedBox(
                      height: 56,
                      child: FilledButton(
                        key: const ValueKey('face-agree'),
                        onPressed: onStart,
                        style: FilledButton.styleFrom(
                          backgroundColor: _brand,
                          disabledBackgroundColor: _brand.withValues(alpha: 0.5),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                        child: Text(
                          'Set up face check',
                          style: _sora(16, FontWeight.w600, Colors.white, height: 24 / 16, spacing: -0.16),
                        ),
                      ),
                    ),
                    if (consent != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: Text.rich(
                          TextSpan(
                            style: _sora(11, FontWeight.w400, _textTertiary, height: 18 / 11),
                            children: [
                              TextSpan(text: '${consent!} '),
                              WidgetSpan(
                                alignment: PlaceholderAlignment.baseline,
                                baseline: TextBaseline.alphabetic,
                                child: GestureDetector(
                                  onTap: () => showWhatsStored(context),
                                  child: Text(
                                    "What's stored",
                                    key: const ValueKey('face-whats-stored'),
                                    style: _sora(11, FontWeight.w600, _brand, height: 18 / 11),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ),
                  ],
                ),
              ),
            ],
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

/// After setup (S5, 3357:29653): the tick, "You're set up!", and — when the
/// setup made the punch — the card with its time, day and office, then the
/// button back to Connect.
class FaceSetupDone extends StatelessWidget {
  const FaceSetupDone({super.key, required this.onDone, this.punchedAt, this.punchIn = true, this.office});

  /// When the punch made from the setup was recorded; null when none was
  /// (onboarding, or a punch the punch screen still makes).
  final DateTime? punchedAt;

  /// 'Punched in' or 'Punched out' on the card.
  final bool punchIn;

  /// The office the punch screen's location check found, if it did.
  final String? office;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    final at = punchedAt?.toLocal();
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          bottom: false,
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 24, 16, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Image.asset('assets/icons/punch/punched_in.png', width: 80, height: 80),
                  const SizedBox(height: 24),
                  Text(
                    "You're set up!",
                    textAlign: TextAlign.center,
                    style: _sora(24, FontWeight.w700, _text, height: 32 / 24),
                  ),
                  if (at != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      'Your attendance has been recorded.',
                      key: const ValueKey('face-done-line'),
                      textAlign: TextAlign.center,
                      style: _sora(14, FontWeight.w400, _textSecondary, height: 21 / 14),
                    ),
                    const SizedBox(height: 24),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 336),
                      child: _PunchCard(heading: punchIn ? 'Punched in' : 'Punched out', at: at, office: office),
                    ),
                  ],
                  SizedBox(height: at != null ? 64 : 32),
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 336),
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        boxShadow: const [BoxShadow(color: Color(0x400571A6), offset: Offset(0, 2), blurRadius: 4)],
                      ),
                      child: SizedBox(
                        width: double.infinity,
                        height: 50.5,
                        child: FilledButton(
                          key: const ValueKey('face-done'),
                          onPressed: onDone,
                          style: FilledButton.styleFrom(
                            backgroundColor: _brand,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          ),
                          child: Text(
                            at != null ? 'Continue to Connect' : 'Continue',
                            style: _sora(15, FontWeight.w600, Colors.white, height: 22.5 / 15),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The punch the setup made: "Punched in", the time, the day, and the office.
class _PunchCard extends StatelessWidget {
  const _PunchCard({required this.heading, required this.at, this.office});
  final String heading;
  final DateTime at;
  final String? office;

  static const _days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  static const _months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  @override
  Widget build(BuildContext context) {
    final hour = at.hour % 12 == 0 ? 12 : at.hour % 12;
    final time = '$hour:${at.minute.toString().padLeft(2, '0')}';
    final meridiem = at.hour >= 12 ? 'PM' : 'AM';
    final where = office;
    return Container(
      key: const ValueKey('face-done-card'),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _hairline, width: 1.115),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            color: _cardTop,
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 15),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(heading, style: _sora(11.5, FontWeight.w400, _cardMuted, height: 17.25 / 11.5)),
                const SizedBox(height: 16),
                SizedBox(
                  height: 53,
                  child: Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(text: '$time ', style: _sora(35, FontWeight.w700, _navy, height: 52.5 / 35, spacing: -1.4)),
                        TextSpan(text: meridiem, style: _sora(17, FontWeight.w400, _navy, height: 25.5 / 17, spacing: -1.4)),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  '${_days[at.weekday - 1]}, ${at.day} ${_months[at.month - 1]} ${at.year}',
                  style: _sora(11.5, FontWeight.w400, _cardMuted, height: 17.25 / 11.5),
                ),
              ],
            ),
          ),
          if (where != null && where.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
              decoration: const BoxDecoration(border: Border(top: BorderSide(color: _hairline, width: 1.115))),
              child: Row(
                children: [
                  SizedBox(
                    width: 21,
                    height: 21,
                    child: Center(child: SvgPicture.asset('assets/icons/punch/ool_row_pin.svg', width: 15.6, height: 18.2)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      where,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: _sora(12, FontWeight.w600, _navy, height: 18 / 12),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
