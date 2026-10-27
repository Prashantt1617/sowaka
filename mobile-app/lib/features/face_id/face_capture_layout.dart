import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// The selfie screens (Figma 4194:21786, "Selfie Punch-in"): the step
/// navigation, the instructions, the camera card with its oval, a status row
/// and the action at the bottom. Drawn from the frames' own measurements:
/// 4010:63873 (no status yet), 4005:51535 (face detected) and 4005:51579
/// (face not detected). Shared by the punch-in check and Face ID setup, which
/// differ only in their words.
class FaceCaptureLayout extends StatelessWidget {
  const FaceCaptureLayout({
    super.key,
    required this.stepTitle,
    required this.heading,
    required this.instructions,
    required this.camera,
    required this.guide,
    required this.action,
    this.status,
    this.onBack,
    this.onClose,
    this.below,
    this.aboveAction,
  });

  final String stepTitle;
  final String heading;
  final String instructions;

  /// The live preview, or null while the camera opens.
  final CameraController? camera;
  final FaceGuide guide;
  final FaceStatusRow? status;
  final FaceCaptureAction action;
  final VoidCallback? onBack;
  final VoidCallback? onClose;

  /// A quiet link under the action's caption, where a screen needs one.
  final Widget? below;

  /// Something the action depends on, just above it: setup's consent line.
  final Widget? aboveAction;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            FaceStepHeader(title: stepTitle, onBack: onBack, onClose: onClose),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Selfie instructions (4005:51559): 20/600 over 14/400, 8 apart.
                    Text(
                      heading,
                      textAlign: TextAlign.center,
                      style: _sora(20, FontWeight.w600, _ink, height: 24 / 20, spacing: 0.4),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      instructions,
                      textAlign: TextAlign.center,
                      style: _sora(14, FontWeight.w400, _secondary, height: 22 / 14),
                    ),
                    const SizedBox(height: 20),
                    _CameraCard(camera: camera, guide: guide),
                    if (status case final row?) ...[
                      const SizedBox(height: 20),
                      row,
                    ],
                  ],
                ),
              ),
            ),
            // Capture action (4005:51574): 12 above, 24 below, 16 in, 10 apart.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (aboveAction case final above?) ...[above, const SizedBox(height: 12)],
                  action,
                  if (below case final link?) ...[const SizedBox(height: 4), Center(child: link)],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The step navigation (4005:51552): 56 high, 16 in, a 40 box each side.
/// Without [onBack] the arrow's box stays empty, for a step with nowhere to
/// go back to.
class FaceStepHeader extends StatelessWidget {
  const FaceStepHeader({super.key, required this.title, this.onBack, this.onClose});

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
                child: SvgPicture.asset('$_asset/arrow_left.svg', width: 24, height: 24),
              ),
            Expanded(
              child: Text(
                title,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: _sora(16, FontWeight.w600, _ink, height: 16.2 / 16, spacing: -0.16),
              ),
            ),
            _NavButton(
              label: 'Close',
              alignment: Alignment.centerRight,
              onTap: onClose,
              child: SvgPicture.asset('$_asset/close.svg', width: 20, height: 20),
            ),
          ],
        ),
      ),
    );
  }
}

/// The oval: solid brand blue once a face is in it (4005:51565), dashed white
/// with the scan-face mark while there is none (4005:51609, 4005:51646).
enum FaceGuide { solid, dashed }

class _CameraCard extends StatelessWidget {
  const _CameraCard({required this.camera, required this.guide});

  final CameraController? camera;
  final FaceGuide guide;

  @override
  Widget build(BuildContext context) {
    final preview = camera;
    final size = preview?.value.isInitialized == true ? preview!.value.previewSize : null;
    return ClipRRect(
      borderRadius: BorderRadius.circular(20),
      child: Container(
        height: 300,
        color: const Color(0xFFD9DEDE),
        child: Stack(
          fit: StackFit.expand,
          children: [
            // The design's photo stands for the live camera; the preview is
            // laid over the card as a cover, as the photo was.
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
            // Camera scrim: 4% black over a face, 14% while there is none.
            ColoredBox(
              color: Colors.black.withValues(alpha: guide == FaceGuide.solid ? 0.04 : 0.14),
            ),
            Positioned(
              top: 16,
              left: 0,
              right: 0,
              child: Center(
                child: guide == FaceGuide.solid
                    ? SvgPicture.asset('$_asset/face_guide.svg', width: 214, height: 258)
                    : Image.asset('$_asset/face_guide_dashed.png', width: 214, height: 258),
              ),
            ),
            if (guide == FaceGuide.dashed)
              // 56 square, centred 8 above the card's middle.
              Align(
                alignment: const Alignment(0, -16 / (300 - 56)),
                child: SvgPicture.asset('$_asset/scan_face.svg', width: 56, height: 56),
              ),
            // Camera label (4005:51566): a 50% ink pill, 12 from the bottom.
            Positioned(
              bottom: 12,
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
                      Text('Front camera', style: _sora(10, FontWeight.w400, Colors.white, height: 14 / 10)),
                    ],
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

/// Face detection status (4005:51569): the icon and heading on one line,
/// the guidance under it, 8 apart.
class FaceStatusRow extends StatelessWidget {
  /// Only once a face is in the oval and the phone's prompt is done.
  const FaceStatusRow.detected({super.key, this.title = 'Face detected', required this.body})
    : _icon = 'circle_check.svg',
      _color = _brand;

  /// Still looking: the camera opening, or a face waiting on the prompt,
  /// which [body] then carries. Neutral, in the design's own type.
  const FaceStatusRow.detecting({
    super.key,
    this.title = 'Detecting your face…',
    this.body = 'Hold your phone at eye level and\nlook straight at the camera.',
  })
    : _icon = 'scan_face_status.svg',
      _color = _ink;

  const FaceStatusRow.problem({super.key, required this.title, required this.body})
    : _icon = 'circle_alert.svg',
      _color = _amber;

  final String title;
  final String body;
  final String _icon;
  final Color _color;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SvgPicture.asset('$_asset/$_icon', width: 20, height: 20),
            const SizedBox(width: 8),
            Flexible(
              child: Text(title, style: _sora(16, FontWeight.w600, _color, height: 16.2 / 16, spacing: -0.16)),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(body, textAlign: TextAlign.center, style: _sora(14, FontWeight.w400, _secondary, height: 22 / 14)),
      ],
    );
  }
}

/// The bottom button and the line under it (4005:51575 / 4005:51620): 56
/// high, 16 radius, brand blue, or the pressed blue while capture is locked.
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
  Widget build(BuildContext context) {
    final live = enabled && !busy && onTap != null;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
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
                          child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                        )
                      : Text(
                          label,
                          textAlign: TextAlign.center,
                          style: _sora(16, FontWeight.w600, Colors.white, height: 24 / 16, spacing: -0.16),
                        ),
                ),
              ),
            ),
          ),
        ),
        if (caption.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(caption, textAlign: TextAlign.center, style: _sora(11, FontWeight.w400, _tertiary, height: 18 / 11)),
        ],
      ],
    );
  }
}

/// A quiet text link for under the action, in the punch screens' link blue.
class FaceQuietLink extends StatelessWidget {
  const FaceQuietLink({super.key, required this.label, required this.onTap});

  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(8),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: Text(label, style: _sora(12, FontWeight.w600, const Color(0xFF0668D8), height: 18 / 12)),
    ),
  );
}

class _NavButton extends StatelessWidget {
  const _NavButton({required this.label, required this.alignment, required this.onTap, required this.child});

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
      child: SizedBox(width: 40, height: 40, child: Align(alignment: alignment, child: child)),
    ),
  );
}

TextStyle _sora(double size, FontWeight weight, Color color, {double? height, double? spacing}) => TextStyle(
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
const _brand = Color(0xFF0571A6);
const _locked = Color(0xFF96B7C7);
const _amber = Color(0xFFA75B20);
