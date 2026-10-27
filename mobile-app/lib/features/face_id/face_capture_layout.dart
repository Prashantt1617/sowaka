import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// The selfie screens (Figma 4194:21786, "Selfie Punch-in"): the camera
/// fills the page under the status bar, the heading sits on it, the oval is
/// a thin brand-blue line, and everything the person is told — the
/// instruction, the tick once the face is found, a failure with its Try
/// again — is drawn on the camera itself. Drawn from the frames' own
/// measurements: 4266:26005 (looking), 4266:26184 / 4266:26221 (detected),
/// 4266:26076 (not detected). Shared by the punch-in check and Face ID
/// setup, which differ only in their words.
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
  });

  /// True while the screen goes white for the phone's flash check; the
  /// whole page lights up so the face is lit by it.
  final ValueListenable<bool>? flash;

  /// "Set up your Face ID", "Punch-in": 20/600 on the camera, 25 down.
  final String heading;

  /// The live preview, or null while the camera opens.
  final CameraController? camera;
  final FaceCaptureState state;

  /// The one line near the bottom of the camera (4266:26070): the
  /// instruction while looking, the result once detected.
  final String? line;

  /// The button on the camera, for a failed try (4266:26113) or a phone that
  /// cannot detect a face; none while the selfie takes itself.
  final FaceCaptureButton? action;

  /// Under the button (4266:26118): "1 out of 3 tries left".
  final String? caption;

  /// A quiet link under the caption, where a screen needs one.
  final Widget? below;

  /// The selfie is being checked: a spinner in place of the line.
  final bool busy;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final preview = camera;
    final size = preview?.value.isInitialized == true
        ? preview!.value.previewSize
        : null;
    final failed = state == FaceCaptureState.failed;
    final page = Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        bottom: false,
        child: Padding(
          // Selfie camera (4266:26061): 16 in, 16 down, to the bottom.
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          child: ClipRRect(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
            child: Container(
              color: const Color(0xFFD9DEDE),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  // The design's photo stands for the live camera; the
                  // preview covers the card as the photo did.
                  if (preview != null && size != null)
                    FittedBox(
                      fit: BoxFit.cover,
                      clipBehavior: Clip.hardEdge,
                      child: SizedBox(
                        // The preview size is the sensor's, landscape; the card is upright.
                        width: size.height,
                        height: size.width,
                        child: CameraPreview(preview),
                      ),
                    ),
                  // Camera scrim: 4% black, 64% once a try has failed.
                  ColoredBox(
                    color: Colors.black.withValues(alpha: failed ? 0.64 : 0.04),
                  ),
                  // Heading (4266:26018): 25 from the top of the card.
                  Positioned(
                    top: 25,
                    left: 0,
                    right: 0,
                    child: Text(
                      heading,
                      textAlign: TextAlign.center,
                      style: _sora(
                        20,
                        FontWeight.w600,
                        _ink,
                        height: 24 / 20,
                        spacing: 0.4,
                      ),
                    ),
                  ),
                  // Face alignment guide (4266:26064): 287×453, 62 down.
                  Positioned(
                    top: 62,
                    left: 0,
                    right: 0,
                    child: Center(
                      child: SizedBox(
                        width: 287,
                        height: 453,
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            SvgPicture.asset(
                              '$_asset/guide_oval.svg',
                              width: 287,
                              height: 453,
                            ),
                            // Detected (4266:26216): a 291×315 green haze,
                            // the 140 tick in its middle, over the oval.
                            if (state == FaceCaptureState.detected)
                              Positioned(
                                top: 108,
                                child: Container(
                                  width: 291,
                                  height: 315,
                                  alignment: Alignment.center,
                                  decoration: const BoxDecoration(
                                    color: Color(0x1716A34A),
                                    shape: BoxShape.circle,
                                  ),
                                  child: SvgPicture.asset(
                                    '$_asset/success_check.svg',
                                    width: 140,
                                    height: 140,
                                  ),
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
                        ),
                      ),
                    ),
                  // Face detection status (4266:26106): bottom 29 + the
                  // camera label's 24 + 8, 8 apart, over the 16 bottom inset.
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 29 + 24 + 8,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (busy)
                          const SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(
                              color: Colors.white,
                              strokeWidth: 2.4,
                            ),
                          )
                        else if (line case final text?)
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            child: _StatusLine(text: text, state: state),
                          ),
                        if (action case final button?) ...[
                          const SizedBox(height: 8),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 0),
                            child: button,
                          ),
                        ],
                        if (caption case final text?) ...[
                          const SizedBox(height: 8),
                          Text(
                            text,
                            textAlign: TextAlign.center,
                            style: _sora(
                              11,
                              FontWeight.w400,
                              Colors.white,
                              height: 18 / 11,
                            ),
                          ),
                        ],
                        if (below case final link?) ...[
                          const SizedBox(height: 2),
                          link,
                        ],
                      ],
                    ),
                  ),
                  // Camera label (4266:26065): a 50% ink pill, 29 from the bottom.
                  if (!failed)
                    Positioned(
                      bottom: 29,
                      left: 0,
                      right: 0,
                      child: Center(
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 5,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0x80172126),
                            borderRadius: BorderRadius.circular(100),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SvgPicture.asset(
                                '$_asset/camera.svg',
                                width: 12,
                                height: 12,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                'Front camera',
                                style: _sora(
                                  10,
                                  FontWeight.w400,
                                  Colors.white,
                                  height: 14 / 10,
                                ),
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
    return ValueListenableBuilder<bool>(
      valueListenable: flashing,
      builder: (_, on, child) => Stack(
        fit: StackFit.expand,
        children: [
          child!,
          // The flash: the page goes white, the camera still reading under it.
          if (on)
            const ColoredBox(key: ValueKey('face-flash'), color: Colors.white),
        ],
      ),
      child: page,
    );
  }
}

/// What the camera shows besides the face: still looking (the instruction
/// line), a face found (the tick, and a result line), or a failed try (the
/// dark scrim, the amber line, Try again).
enum FaceCaptureState { looking, detected, failed }

/// The line on the camera: white 14/400 (4266:26072), or the failure in
/// amber 16/600 with the alert mark beside it (4266:26107).
class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.text, required this.state});

  final String text;
  final FaceCaptureState state;

  @override
  Widget build(BuildContext context) {
    if (state != FaceCaptureState.failed) {
      return Text(
        text,
        textAlign: TextAlign.center,
        style: _sora(14, FontWeight.w400, Colors.white, height: 22 / 14),
      );
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SvgPicture.asset('$_asset/circle_alert.svg', width: 20, height: 20),
        const SizedBox(width: 8),
        Flexible(
          child: Text(
            text,
            textAlign: TextAlign.center,
            style: _sora(
              16,
              FontWeight.w600,
              _amber,
              height: 16.2 / 16,
              spacing: -0.16,
            ),
          ),
        ),
      ],
    );
  }
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
