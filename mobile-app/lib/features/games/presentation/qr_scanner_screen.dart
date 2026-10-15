import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Whether this phone can scan a QR code with its camera: the app on
/// Android or iOS. A game page is offered `Sowaka.scanQr()` only here.
bool get canScanQr =>
    !kIsWeb &&
    (defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS);

/// Opens the scanner over whatever is showing: the text of the first QR
/// code it reads, or null when the person cancels (or the camera is not
/// allowed and they leave).
Future<String?> showQrScanner(BuildContext context) {
  return Navigator.of(context).push<String>(
    MaterialPageRoute<String>(
      fullscreenDialog: true,
      builder: (_) => const QrScannerScreen(),
    ),
  );
}

/// What stands in for the camera in tests: it reports a code through
/// [onCode].
typedef QrPreviewBuilder =
    Widget Function(BuildContext context, ValueChanged<String> onCode);

/// A full-screen camera scanner in the games' own look (Secret Squad's
/// hunt): dark navy, a lime frame to aim with, "Point at a colleague's
/// code", and Cancel. It closes with the first QR code it reads.
class QrScannerScreen extends StatefulWidget {
  const QrScannerScreen({
    super.key,
    this.prompt = 'Point at a colleague’s code',
    this.previewBuilder,
  });

  final String prompt;

  /// Supplied by tests in place of the camera.
  final QrPreviewBuilder? previewBuilder;

  @override
  State<QrScannerScreen> createState() => _QrScannerScreenState();
}

class _QrScannerScreenState extends State<QrScannerScreen> {
  static const _navy = Color(0xFF141B3F);
  static const _navyRaised = Color(0xFF1D2550);
  static const _navyLine = Color(0xFF35407A);
  static const _navyShadow = Color(0xFF070A1A);
  static const _yellow = Color(0xFFFFCC2E);
  static const _yellowEdge = Color(0xFFC99A00);
  static const _ink = Color(0xFF1D1B2C);
  static const _soft = Color(0xFFC9CDF0);

  MobileScannerController? _controller;
  bool _done = false;

  @override
  void initState() {
    super.initState();
    if (widget.previewBuilder == null) {
      _controller = MobileScannerController(
        formats: const [BarcodeFormat.qrCode],
        detectionSpeed: DetectionSpeed.noDuplicates,
      );
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  void _found(String text) {
    if (_done || text.isEmpty || !mounted) return;
    _done = true;
    HapticFeedback.mediumImpact();
    Navigator.of(context).pop(text);
  }

  void _cancel() {
    if (_done) return;
    _done = true;
    Navigator.of(context).pop();
  }

  /// Where the frame sits: a square of most of the width, a little above
  /// the middle.
  Rect _window(Size size) {
    final side = math.min(size.width * 0.68, 280.0);
    final center = Offset(size.width / 2, size.height * 0.44);
    return Rect.fromCenter(center: center, width: side, height: side);
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: _navy,
        body: LayoutBuilder(
          builder: (context, box) {
            final size = box.biggest;
            final window = _window(size);
            return Stack(
              children: [
                Positioned.fill(child: _preview(window)),
                Positioned.fill(
                  child: IgnorePointer(
                    child: CustomPaint(painter: _FramePainter(window)),
                  ),
                ),
                Positioned(
                  left: 24,
                  right: 24,
                  top: window.bottom + 20,
                  child: Text(
                    widget.prompt,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: 'Lilita One',
                      fontSize: 22,
                      height: 1.1,
                      color: Colors.white,
                      letterSpacing: 0.2,
                    ),
                  ),
                ),
                SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(20, 14, 20, 20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Transform.rotate(
                            angle: -3 * math.pi / 180,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 4,
                              ),
                              decoration: BoxDecoration(
                                color: _yellow,
                                borderRadius: BorderRadius.circular(9),
                                boxShadow: const [
                                  BoxShadow(
                                    color: _yellowEdge,
                                    offset: Offset(0, 3),
                                  ),
                                ],
                              ),
                              child: const Text(
                                'SCAN A CODE',
                                style: TextStyle(
                                  fontFamily: 'Lilita One',
                                  fontSize: 16,
                                  color: _ink,
                                  letterSpacing: 0.4,
                                ),
                              ),
                            ),
                          ),
                        ),
                        const Spacer(),
                        _CancelButton(onTap: _cancel),
                      ],
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _preview(Rect window) {
    final fake = widget.previewBuilder;
    if (fake != null) return fake(context, _found);
    return MobileScanner(
      controller: _controller,
      scanWindow: window,
      onDetect: (capture) {
        for (final code in capture.barcodes) {
          final text = code.rawValue;
          if (text != null && text.isNotEmpty) {
            _found(text);
            return;
          }
        }
      },
      placeholderBuilder: (_) => const ColoredBox(color: _navy),
      errorBuilder: (context, error) => _CameraProblem(
        message: error.errorCode == MobileScannerErrorCode.permissionDenied
            ? 'Sowaka can’t use the camera. Allow camera access for Sowaka '
                  'in Settings, or type the code instead.'
            : 'The camera didn’t start. Type the code instead.',
      ),
    );
  }
}

/// The dimmed surround with the lime frame cut out of it.
class _FramePainter extends CustomPainter {
  const _FramePainter(this.window);

  final Rect window;

  @override
  void paint(Canvas canvas, Size size) {
    final hole = RRect.fromRectAndRadius(window, const Radius.circular(22));
    canvas.drawPath(
      Path.combine(
        PathOperation.difference,
        Path()..addRect(Offset.zero & size),
        Path()..addRRect(hole),
      ),
      Paint()..color = const Color(0x99141B3F),
    );
    canvas.drawRRect(
      hole,
      Paint()
        ..color = const Color(0xFFC6F432)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4,
    );
  }

  @override
  bool shouldRepaint(covariant _FramePainter oldDelegate) =>
      oldDelegate.window != window;
}

class _CameraProblem extends StatelessWidget {
  const _CameraProblem({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: _QrScannerScreenState._navy,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 48),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.no_photography_outlined,
                color: _QrScannerScreenState._soft,
                size: 34,
              ),
              const SizedBox(height: 12),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: _QrScannerScreenState._soft,
                  fontSize: 15,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CancelButton extends StatelessWidget {
  const _CancelButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Cancel',
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            color: _QrScannerScreenState._navyRaised,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: _QrScannerScreenState._navyLine,
              width: 2,
            ),
            boxShadow: const [
              BoxShadow(
                color: _QrScannerScreenState._navyShadow,
                offset: Offset(0, 4),
              ),
            ],
          ),
          child: const Text(
            'Cancel',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontFamily: 'Lilita One',
              fontSize: 20,
              color: Colors.white,
              letterSpacing: 0.3,
            ),
          ),
        ),
      ),
    );
  }
}
