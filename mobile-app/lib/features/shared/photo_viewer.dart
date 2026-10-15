import 'package:flutter/material.dart';

/// A photo full screen on black: two fingers pinch it up to 4x and one finger
/// pans it while zoomed in; a double tap zooms to 2.5x at the tap and back to
/// whole. A tap, Back or the close button puts it away.
///
/// Used for a profile photo tapped on someone's profile (or one's own).
/// [action] sits at the bottom — one's own "Change photo".
Future<void> showPhotoViewer(
  BuildContext context, {
  required ImageProvider image,
  String label = 'Photo',
  Widget? action,
}) {
  return Navigator.of(context).push(
    PageRouteBuilder<void>(
      opaque: false,
      barrierColor: Colors.black,
      barrierDismissible: false,
      transitionDuration: const Duration(milliseconds: 200),
      reverseTransitionDuration: const Duration(milliseconds: 160),
      pageBuilder: (_, _, _) =>
          PhotoViewer(image: image, label: label, action: action),
      transitionsBuilder: (_, animation, _, child) => FadeTransition(
        opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
        child: child,
      ),
    ),
  );
}

/// The full-screen photo [showPhotoViewer] opens.
class PhotoViewer extends StatefulWidget {
  const PhotoViewer({
    super.key,
    required this.image,
    this.label = 'Photo',
    this.action,
  });

  final ImageProvider image;

  /// What a screen reader says the photo is: "Ananya's photo".
  final String label;
  final Widget? action;

  @override
  State<PhotoViewer> createState() => _PhotoViewerState();
}

class _PhotoViewerState extends State<PhotoViewer>
    with SingleTickerProviderStateMixin {
  static const _maxScale = 4.0;
  static const _doubleTapScale = 2.5;

  final TransformationController _transform = TransformationController();
  Offset _tapAt = Offset.zero;

  /// The double tap's glide in and back out.
  late final AnimationController _glide = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 220),
  )..addListener(_glideStep);
  Matrix4Tween? _glideTween;

  void _glideStep() {
    final tween = _glideTween;
    if (tween == null) return;
    _transform.value = tween.transform(
      Curves.easeOutCubic.transform(_glide.value),
    );
  }

  void _doubleTap() {
    final zoomed = _transform.value.getMaxScaleOnAxis() > 1.01;
    // In: the point tapped stays under the finger.
    final target = zoomed
        ? Matrix4.identity()
        : (Matrix4.identity()
            ..translateByDouble(
              -_tapAt.dx * (_doubleTapScale - 1),
              -_tapAt.dy * (_doubleTapScale - 1),
              0,
              1,
            )
            ..scaleByDouble(_doubleTapScale, _doubleTapScale, 1, 1));
    _glideTween = Matrix4Tween(begin: _transform.value.clone(), end: target);
    _glide.forward(from: 0);
  }

  @override
  void dispose() {
    _glide.dispose();
    _transform.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final padding = MediaQuery.paddingOf(context);
    final action = widget.action;
    return Material(
      color: Colors.black,
      child: Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              key: const ValueKey('photo-viewer-surface'),
              onTap: () => Navigator.of(context).maybePop(),
              onDoubleTapDown: (details) => _tapAt = details.localPosition,
              onDoubleTap: _doubleTap,
              child: InteractiveViewer(
                key: const ValueKey('photo-viewer-zoom'),
                transformationController: _transform,
                minScale: 1,
                maxScale: _maxScale,
                onInteractionStart: (_) => _glide.stop(),
                child: SizedBox.expand(
                  child: Semantics(
                    image: true,
                    label: widget.label,
                    child: Image(
                      image: widget.image,
                      fit: BoxFit.contain,
                      errorBuilder: (_, _, _) => const Center(
                        child: Icon(
                          Icons.broken_image_outlined,
                          color: Colors.white54,
                          size: 48,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            left: 8,
            top: padding.top + 8,
            child: IconButton(
              key: const ValueKey('photo-viewer-close'),
              tooltip: 'Close',
              onPressed: () => Navigator.of(context).maybePop(),
              style: IconButton.styleFrom(
                backgroundColor: const Color(0x66000000),
              ),
              icon: const Icon(Icons.close_rounded, color: Colors.white),
            ),
          ),
          if (action != null)
            Positioned(
              left: 16,
              right: 16,
              bottom: padding.bottom + 20,
              child: Center(child: action),
            ),
        ],
      ),
    );
  }
}
