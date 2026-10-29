import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// The selfie screens (Figma 4309:24713, after 4194:21786): a dark page, the
/// live camera seen only through the oval and its thin brand-blue line, and
/// one line of white words above it — what to do next ("Turn your head a
/// little to one side", "Blink your eye"), or "Verified" with the green tick
/// once the server has matched the face (4289:26644). A failed try darkens
/// the oval and says why in red under it, with Try Again and the day's tries
/// left (4289:26675). Shared by the punch-in check and Face ID setup.
class FaceCaptureLayout extends StatelessWidget {
  const FaceCaptureLayout({
    super.key,
    required this.heading,
    required this.camera,
    required this.state,
    this.line,
    this.action,
    this.caption,
    this.below,
    this.busy = false,
    this.onClose,
    this.flash,
    this.progress,
  });

  /// The colour on the screen during the phone's light check, else null;
  /// the whole page takes it so the face is lit by it.
  final ValueListenable<Color?>? flash;

  /// Which prompt is being answered, of how many: the dots under the words.
  final (int, int)? progress;

  /// What the screen is ("Set up your Face ID", "Punch-in"), shown above the
  /// oval only while there is no [line] to show there instead.
  final String heading;

  /// The live preview, or null while the camera opens.
  final CameraController? camera;
  final FaceCaptureState state;

  /// The words above the oval while looking or once detected (4289:26559:
  /// the prompt, or "Verified"), or the red reason under it once a try has
  /// failed (4289:26709).
  final String? line;

  /// The button under the oval, for a failed try (4289:26710) or a phone that
  /// cannot detect a face; none while the selfie takes itself.
  final FaceCaptureButton? action;

  /// Under the button (4289:26711): "4 out of 5 tries left".
  final String? caption;

  /// A quiet link under the caption, where a screen needs one.
  final Widget? below;

  /// The selfie is being checked: a spinner under the oval.
  final bool busy;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final preview = camera;
    final size = preview?.value.isInitialized == true
        ? preview!.value.previewSize
        : null;
    final failed = state == FaceCaptureState.failed;
    final top = failed ? null : (line ?? heading);
    final page = AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: _page,
        body: SafeArea(
          bottom: false,
          child: Padding(
            // Selfie camera (4289:26550): 16 in, 16 down, 20 round.
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: ClipRRect(
              borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  // The words above the oval (4289:26558): 76 down, 20/600.
                  if (top != null)
                    Positioned(
                      top: 76,
                      left: 10,
                      right: 10,
                      child: Column(
                        children: [
                          Text(
                            top,
                            key: const ValueKey('face-heading'),
                            textAlign: TextAlign.center,
                            style: _sora(20, FontWeight.w600, Colors.white, height: 24 / 20, spacing: 0.4),
                          ),
                          if (progress case (final done, final total))
                            Padding(
                              padding: const EdgeInsets.only(top: 10),
                              child: Row(
                                key: const ValueKey('face-steps'),
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  for (var i = 0; i < total; i++)
                                    Container(
                                      width: i < done ? 18 : 8,
                                      height: 8,
                                      margin: const EdgeInsets.symmetric(horizontal: 3),
                                      decoration: BoxDecoration(
                                        color: i < done ? _brand : Colors.white.withValues(alpha: 0.35),
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  // Face alignment guide (4289:26553): 287×453, 128 down; the
                  // camera shows only inside it.
                  Positioned(
                    top: 128,
                    left: 0,
                    right: 0,
                    child: Center(
                      child: SizedBox(
                        width: 287,
                        height: 453,
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            ClipOval(
                              child: SizedBox(
                                width: 287,
                                height: 453,
                                child: Stack(
                                  fit: StackFit.expand,
                                  children: [
                                    const ColoredBox(color: Color(0xFF2E3336)),
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
                                    // A failed try dims the face (4289:26681).
                                    if (failed) ColoredBox(color: Colors.black.withValues(alpha: 0.5)),
                                  ],
                                ),
                              ),
                            ),
                            SvgPicture.asset('$_asset/guide_oval.svg', width: 287, height: 453),
                            // Verified (4289:26670): a 291×315 green haze, the
                            // 140 tick in its middle, 98 down the oval.
                            if (state == FaceCaptureState.detected)
                              Positioned(
                                top: 98,
                                child: Container(
                                  key: const ValueKey('face-verified'),
                                  width: 291,
                                  height: 315,
                                  alignment: Alignment.center,
                                  decoration: const BoxDecoration(
                                    color: Color(0x1716A34A),
                                    shape: BoxShape.circle,
                                  ),
                                  child: SvgPicture.asset('$_asset/success_check.svg', width: 140, height: 140),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  if (onClose != null)
                    Positioned(
                      top: 4,
                      right: 4,
                      child: _NavButton(
                        label: 'Close',
                        onTap: onClose,
                        child: SvgPicture.asset(
                          '$_asset/close.svg',
                          width: 20,
                          height: 20,
                          colorFilter: const ColorFilter.mode(Colors.white, BlendMode.srcIn),
                        ),
                      ),
                    ),
                  // Face detection status (4289:26705): 24 from the bottom, 8
                  // apart; above the camera label while it shows.
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: failed ? 24 : 29 + 24 + 8,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (busy)
                          const SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.4),
                          )
                        else if (failed && line != null)
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            child: _FailureLine(text: line!),
                          ),
                        if (action case final button?) ...[
                          const SizedBox(height: 8),
                          button,
                        ],
                        if (caption case final text?) ...[
                          const SizedBox(height: 8),
                          Text(
                            text,
                            textAlign: TextAlign.center,
                            style: _sora(11, FontWeight.w400, Colors.white, height: 18 / 11),
                          ),
                        ],
                        if (below case final link?) ...[
                          const SizedBox(height: 2),
                          link,
                        ],
                      ],
                    ),
                  ),
                  // Camera label (4289:26554): a 50% ink pill, 29 from the bottom.
                  if (!failed)
                    Positioned(
                      bottom: 29,
                      left: 0,
                      right: 0,
                      child: Center(
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: const Color(0x80172126),
                            borderRadius: BorderRadius.circular(100),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SvgPicture.asset('$_asset/camera.svg', width: 12, height: 12),
                              const SizedBox(width: 6),
                              Text(
                                'Front camera',
                                style: _sora(10, FontWeight.w400, Colors.white, height: 14 / 10),
                              ),
                            ],
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
    final flashing = flash;
    if (flashing == null) return page;
    return ValueListenableBuilder<Color?>(
      valueListenable: flashing,
      builder: (_, colour, child) => Stack(
        fit: StackFit.expand,
        children: [
          child!,
          // The flash: the page takes the colour, the camera still reading under it.
          if (colour != null)
            ColoredBox(key: const ValueKey('face-flash'), color: colour),
        ],
      ),
      child: page,
    );
  }
}

/// What the camera shows besides the face: still looking (the prompt above
/// the oval), a face matched (the tick, "Verified"), or a failed try (the
/// dimmed oval, the red reason, Try again).
enum FaceCaptureState { looking, detected, failed }

/// The reason a try failed (4289:26706): red 16/600, the alert mark beside it.
class _FailureLine extends StatelessWidget {
  const _FailureLine({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      SvgPicture.asset('$_asset/circle_alert_red.svg', width: 20, height: 20),
      const SizedBox(width: 8),
      Flexible(
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: _sora(16, FontWeight.w600, _red, height: 16.2 / 16, spacing: -0.16),
        ),
      ),
    ],
  );
}

/// The brand-blue button (4266:26113, 4200:55123): 56 high, 16 radius, or
/// the pressed blue while it cannot be used.
class FaceCaptureButton extends StatelessWidget {
  const FaceCaptureButton({
    super.key,
    required this.label,
    required this.onTap,
    this.enabled = true,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onTap;
  final bool enabled;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final live = enabled && !busy && onTap != null;
    return Semantics(
      button: true,
      enabled: live,
      label: label,
      child: Material(
        color: enabled ? _brand : _locked,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: live ? onTap : null,
          child: SizedBox(
            height: 56,
            child: Center(
              child: busy
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(
                        color: Colors.white,
                        strokeWidth: 2,
                      ),
                    )
                  : Text(
                      label,
                      textAlign: TextAlign.center,
                      style: _sora(
                        16,
                        FontWeight.w600,
                        Colors.white,
                        height: 24 / 16,
                        spacing: -0.16,
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The page before the camera (4200:55075): what Face ID is for, the
/// illustration, three tips, the consent, and the button that starts it.
class FaceSetupIntro extends StatelessWidget {
  const FaceSetupIntro({
    super.key,
    required this.stepTitle,
    required this.consent,
    required this.onStart,
    this.onBack,
    this.onRetry,
    this.problem,
  });

  final String stepTitle;

  /// The consent, word for word (4200:55125); null while it loads.
  final String? consent;

  /// Null while the consent has not loaded: the button waits for it.
  final VoidCallback? onStart;
  final VoidCallback? onBack;

  /// The consent failed to load: a link to try again, with [problem].
  final VoidCallback? onRetry;
  final String? problem;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            FaceStepHeader(title: stepTitle, onBack: onBack),
            Expanded(
              child: SingleChildScrollView(
                // Setup guidance (4200:55100): 16 in, 16 down, 20 apart.
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Set up your Face ID',
                      textAlign: TextAlign.center,
                      style: _sora(
                        20,
                        FontWeight.w600,
                        _ink,
                        height: 24 / 20,
                        spacing: 0.4,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Face enrollment is required before you\ncan punch in for attendance.',
                      textAlign: TextAlign.center,
                      style: _sora(
                        14,
                        FontWeight.w400,
                        _secondary,
                        height: 22 / 14,
                      ),
                    ),
                    const SizedBox(height: 20),
                    // Face enrollment illustration (4200:55104): 260 high.
                    Container(
                      height: 260,
                      decoration: BoxDecoration(
                        color: _surface,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Stack(
                        children: [
                          Positioned(
                            top: 26,
                            left: 0,
                            right: 0,
                            child: Center(
                              child: Image.asset(
                                '$_asset/setup_intro.png',
                                width: 186,
                                height: 169,
                                fit: BoxFit.contain,
                              ),
                            ),
                          ),
                          Positioned(
                            bottom: 18,
                            left: 0,
                            right: 0,
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                SvgPicture.asset(
                                  '$_asset/camera_14.svg',
                                  width: 14,
                                  height: 14,
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  'One-time face setup',
                                  style: _sora(
                                    12,
                                    FontWeight.w400,
                                    _secondary,
                                    height: 16.2 / 12,
                                    spacing: -0.16,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),
                    // Capture preparation (4200:55110): 8 in, 4 down, 16 apart.
                    Padding(
                      padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            'For a clear face capture',
                            style: _sora(
                              14,
                              FontWeight.w600,
                              _ink,
                              height: 16.2 / 14,
                              spacing: -0.16,
                            ),
                          ),
                          const SizedBox(height: 16),
                          const _Tip(
                            icon: 'scan_face_status.svg',
                            text: 'Keep your face inside the oval.',
                          ),
                          const SizedBox(height: 14),
                          const _Tip(
                            icon: 'sun.svg',
                            text: 'Face a light source.',
                          ),
                          const SizedBox(height: 14),
                          const _Tip(
                            icon: 'user_round.svg',
                            text: 'Uncover your face and hold still.',
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            // Setup action (4200:55122): 16 in, 24 above and below, 10 apart.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 24, 16, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (problem case final text?) ...[
                    Text(
                      text,
                      textAlign: TextAlign.center,
                      style: _sora(
                        13,
                        FontWeight.w400,
                        _amber,
                        height: 18 / 13,
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
                  FaceCaptureButton(
                    label: 'Set up Face ID',
                    enabled: onStart != null,
                    onTap: onStart,
                  ),
                  const SizedBox(height: 10),
                  if (consent case final words?)
                    Text(
                      words,
                      textAlign: TextAlign.center,
                      style: _sora(
                        11,
                        FontWeight.w400,
                        _tertiary,
                        height: 18 / 11,
                      ),
                    )
                  else if (onRetry case final retry?)
                    Center(
                      child: FaceQuietLink(
                        label: 'Load the consent again',
                        onTap: retry,
                      ),
                    )
                  else
                    const Center(
                      child: SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: _brand,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A capture tip (4200:55113): a 20 icon and the words, 12 apart.
class _Tip extends StatelessWidget {
  const _Tip({required this.icon, required this.text});

  final String icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      SvgPicture.asset('$_asset/$icon', width: 20, height: 20),
      const SizedBox(width: 12),
      Expanded(
        child: Text(
          text,
          style: _sora(14, FontWeight.w400, _secondary, height: 22 / 14),
        ),
      ),
    ],
  );
}

/// The step navigation (4200:55092): 56 high, 16 in, a 40 box each side.
/// Without [onBack] the arrow's box stays empty, for a step with nowhere to
/// go back to.
class FaceStepHeader extends StatelessWidget {
  const FaceStepHeader({
    super.key,
    required this.title,
    this.onBack,
    this.onClose,
  });

  final String title;
  final VoidCallback? onBack;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          children: [
            if (onBack == null)
              const SizedBox(width: 40, height: 40)
            else
              _NavButton(
                label: 'Back',
                alignment: Alignment.centerLeft,
                onTap: onBack,
                child: SvgPicture.asset(
                  '$_asset/arrow_left.svg',
                  width: 24,
                  height: 24,
                ),
              ),
            Expanded(
              child: Text(
                title,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: _sora(
                  16,
                  FontWeight.w600,
                  _ink,
                  height: 16.2 / 16,
                  spacing: -0.16,
                ),
              ),
            ),
            if (onClose == null)
              const SizedBox(width: 40, height: 40)
            else
              _NavButton(
                label: 'Close',
                alignment: Alignment.centerRight,
                onTap: onClose,
                child: SvgPicture.asset(
                  '$_asset/close.svg',
                  width: 20,
                  height: 20,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The bottom button and the line under it, for the pages that keep one
/// (the setup success page): 56 high, 16 radius, brand blue.
class FaceCaptureAction extends StatelessWidget {
  const FaceCaptureAction({
    super.key,
    required this.label,
    required this.caption,
    required this.onTap,
    this.enabled = true,
    this.busy = false,
  });

  final String label;
  final String caption;
  final VoidCallback? onTap;
  final bool enabled;
  final bool busy;

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      FaceCaptureButton(
        label: label,
        onTap: onTap,
        enabled: enabled,
        busy: busy,
      ),
      if (caption.isNotEmpty) ...[
        const SizedBox(height: 10),
        Text(
          caption,
          textAlign: TextAlign.center,
          style: _sora(11, FontWeight.w400, _tertiary, height: 18 / 11),
        ),
      ],
    ],
  );
}

/// A quiet text link, white on the camera or the link blue on white.
class FaceQuietLink extends StatelessWidget {
  const FaceQuietLink({
    super.key,
    required this.label,
    required this.onTap,
    this.onCamera = false,
  });

  final String label;
  final VoidCallback? onTap;
  final bool onCamera;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(8),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: Text(
        label,
        style: _sora(
          12,
          FontWeight.w600,
          onCamera ? Colors.white : const Color(0xFF0668D8),
          height: 18 / 12,
        ),
      ),
    ),
  );
}

class _NavButton extends StatelessWidget {
  const _NavButton({
    required this.label,
    required this.onTap,
    required this.child,
    this.alignment = Alignment.center,
  });

  final String label;
  final Alignment alignment;
  final VoidCallback? onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: label,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: SizedBox(
        width: 40,
        height: 40,
        child: Align(alignment: alignment, child: child),
      ),
    ),
  );
}

TextStyle _sora(
  double size,
  FontWeight weight,
  Color color, {
  double? height,
  double? spacing,
}) => TextStyle(
  fontFamily: 'Sora',
  fontSize: size,
  fontWeight: weight,
  color: color,
  height: height,
  letterSpacing: spacing,
);

const _asset = 'assets/icons/face';
const _ink = Color(0xFF222222);
const _secondary = Color(0xFF484848);
const _tertiary = Color(0xFF717171);
const _surface = Color(0xFFF7F7F9);
const _brand = Color(0xFF0571A6);
const _locked = Color(0xFF96B7C7);
const _amber = Color(0xFFA75B20);
const _red = Color(0xFFFF383C);
const _page = Color(0xFF222222);
