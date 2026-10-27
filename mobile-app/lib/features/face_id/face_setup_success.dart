import 'dart:async';

import 'package:flutter/material.dart';

import 'face_capture_layout.dart';

/// Face ID set up: the tick and one line, in the punch's own success look
/// ("You're punched in!": the same 80 tick, 24/700 heading and 14/400 line)
/// under the Face screens' step navigation, with their bottom button. It
/// goes on by itself after [autoAdvance], or at once on Continue: to the
/// selfie at a punch, or out of onboarding.
class FaceSetupSuccess extends StatefulWidget {
  const FaceSetupSuccess({
    super.key,
    required this.stepTitle,
    required this.line,
    required this.onContinue,
    this.onClose,
    this.autoAdvance = const Duration(milliseconds: 1500),
  });

  final String stepTitle;

  /// What happens next, in one short line.
  final String line;
  final VoidCallback onContinue;
  final VoidCallback? onClose;

  /// Null to wait for Continue.
  final Duration? autoAdvance;

  @override
  State<FaceSetupSuccess> createState() => _FaceSetupSuccessState();
}

class _FaceSetupSuccessState extends State<FaceSetupSuccess> {
  Timer? _timer;
  bool _advanced = false;

  @override
  void initState() {
    super.initState();
    if (widget.autoAdvance case final wait?) _timer = Timer(wait, _continue);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  /// Once only: the timer and the button never both go on.
  void _continue() {
    _timer?.cancel();
    if (_advanced || !mounted) return;
    _advanced = true;
    widget.onContinue();
  }

  void _close() {
    _timer?.cancel();
    _advanced = true;
    widget.onClose?.call();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Setup is done: nothing to go back to, so only the close.
            FaceStepHeader(title: widget.stepTitle, onClose: widget.onClose == null ? null : _close),
            Expanded(
              child: Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Image.asset('assets/icons/punch/punched_in.png', width: 80, height: 80),
                      const SizedBox(height: 24),
                      Text(
                        'Face ID is set up',
                        textAlign: TextAlign.center,
                        style: _sora(24, FontWeight.w700, _ink, height: 32 / 24),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        widget.line,
                        textAlign: TextAlign.center,
                        style: _sora(14, FontWeight.w400, _secondary, height: 21 / 14),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              child: FaceCaptureAction(label: 'Continue', caption: '', onTap: _continue),
            ),
          ],
        ),
      ),
    );
  }
}

TextStyle _sora(double size, FontWeight weight, Color color, {double? height}) =>
    TextStyle(fontFamily: 'Sora', fontSize: size, fontWeight: weight, color: color, height: height);

const _ink = Color(0xFF222222);
const _secondary = Color(0xFF484848);
