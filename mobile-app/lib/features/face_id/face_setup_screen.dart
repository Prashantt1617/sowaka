import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../attendance/data/punch_location_service.dart';
import '../manager/data/manager_api_service.dart';
import 'face_camera.dart';
import 'face_capture_layout.dart';
import 'face_check_screen.dart';
import 'face_id_models.dart';
import 'face_setup_success.dart';

/// Setting up Face ID, at the first punch the company checks (Figma
/// 4194:21786, with setup's words). The consent is on the same screen: one
/// line to agree to, word for word, above the button.
///
/// Once set up it says so ("Face ID is set up"), then, at a punch, opens the
/// selfie check, and pops with however that check ended: the punch goes on
/// with the check's token, as after any passed check. In onboarding there is
/// no punch, so it pops after the success screen. A failed setup says why,
/// with the tries left; after three, or while the face service is down, the
/// punch can go to the manager instead. Null when closed.
class FaceSetupScreen extends StatefulWidget {
  const FaceSetupScreen({
    super.key,
    required this.api,
    this.type = 'in',
    this.readLocation,
    this.onboarding = false,
  });

  final ManagerApiService api;

  /// 'in' or 'out': the punch this setup is for.
  final String type;

  /// Where the phone is, for a punch sent to the manager. Optional.
  final Future<PunchReading> Function()? readLocation;

  /// Set up during onboarding, with no punch to make: no punch words, and
  /// no sending a punch to the manager, and no selfie check after it.
  final bool onboarding;

  @override
  State<FaceSetupScreen> createState() => _FaceSetupScreenState();
}

class _FaceSetupScreenState extends State<FaceSetupScreen>
    with WidgetsBindingObserver {
  final FaceCamera _camera = FaceCamera.create();
  FaceConsent? _consent;
  String? _loadProblem;
  bool _agreed = false;
  bool _busy = false;
  bool _sendingFallback = false;
  bool _fallbackOpen = false;
  int? _attemptsLeft;
  String? _problemTitle;
  String? _problem;

  /// Set up: the success screen is showing, and the camera is let go.
  bool _setUp = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _camera.addListener(_changed);
    unawaited(_camera.start());
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() => _loadProblem = null);
    try {
      final status = await widget.api.fetchFaceStatus();
      if (!mounted) return;
      setState(() {
        _consent = status.consent;
        _fallbackOpen = status.fallbackAvailable;
      });
    } on ManagerApiException catch (error) {
      if (mounted)
        setState(
          () => _loadProblem = error.offline
              ? 'No internet connection. Connect and try again.'
              : error.message,
        );
    } catch (_) {
      if (mounted)
        setState(() => _loadProblem = "Face ID couldn't be loaded. Try again.");
    }
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused) {
      unawaited(_camera.pause());
    } else if (state == AppLifecycleState.resumed &&
        !_camera.ready &&
        !_busy &&
        !_setUp) {
      unawaited(_camera.start());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _camera.removeListener(_changed);
    _camera.dispose();
    super.dispose();
  }

  Future<void> _enrol() async {
    final consent = _consent;
    if (consent == null || !_agreed || _busy) return;
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      final photo = await _camera.capture();
      if (photo == null) {
        _fail(
          'Photo not taken',
          'The camera did not take the photo. Try again.',
        );
        await _camera.resume();
        return;
      }
      // The consent's version goes with the photo: the server records when
      // they agreed, and to which line.
      // The token a setup may hand back goes unused: the punch carries the
      // selfie check's own, taken next.
      await widget.api.enrolFace(
        jpeg: photo,
        consentVersion: consent.version,
      );
      FaceCheckOutcome.enrolledThisRun = true;
      if (!mounted) return;
      // The check opens its own camera: this one is let go first.
      unawaited(_camera.pause());
      setState(() => _setUp = true);
      return;
    } on ManagerApiException catch (error) {
      final face = error.details?['face'];
      final reason = face is Map ? face['reason'] as String? : null;
      if (reason == 'already_enrolled') {
        // Set up already (on another phone, or before this profile was
        // read): nothing to set up, so the punch takes the selfie check.
        FaceCheckOutcome.enrolledThisRun = true;
        if (mounted)
          Navigator.of(context).pop(const FaceCheckOutcome.needsCheck());
        return;
      }
      if (reason == 'consent_changed' &&
          face is Map &&
          face['consent'] is Map<String, dynamic>) {
        // The line changed since it was shown: agree to the new one first.
        setState(() {
          _consent = FaceConsent.fromJson(
            face['consent'] as Map<String, dynamic>,
          );
          _agreed = false;
        });
        _fail(
          'Consent updated',
          'The Face ID consent has changed. Read it and agree again.',
        );
      } else {
        setState(() {
          if (face is Map && face['attemptsLeft'] is num)
            _attemptsLeft = (face['attemptsLeft'] as num).toInt();
          if (face is Map && face['fallback'] == true) _fallbackOpen = true;
        });
        _fail(
          FaceCheckResult(
            passed: false,
            reason: reason ?? 'not_a_match',
            message: error.message,
          ).title,
          error.offline
              ? 'No internet connection. Connect and try again.'
              : error.message,
        );
      }
      await _camera.resume();
    } catch (_) {
      _fail(
        'Face ID unavailable',
        "Face ID can't be set up right now. Try again in a few minutes.",
      );
      await _camera.resume();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// From the success screen: out of onboarding, or on to the selfie check,
  /// whose outcome (a pass, a punch sent to the manager, or closed) is the
  /// punch's.
  Future<void> _afterSetUp() async {
    final navigator = Navigator.of(context);
    if (widget.onboarding) {
      navigator.pop(const FaceCheckOutcome.needsCheck());
      return;
    }
    final outcome = await navigator.push<FaceCheckOutcome>(
      MaterialPageRoute(
        builder: (_) => FaceCheckScreen(
          api: widget.api,
          type: widget.type,
          readLocation: widget.readLocation,
        ),
      ),
    );
    if (mounted) navigator.pop(outcome);
  }

  void _fail(String title, String message) {
    if (!mounted) return;
    setState(() {
      _problemTitle = title;
      _problem = message;
    });
  }

  Future<void> _sendFallback() async {
    if (_sendingFallback) return;
    setState(() => _sendingFallback = true);
    PunchReading? reading;
    try {
      reading = await widget.readLocation?.call().timeout(
        const Duration(seconds: 12),
      );
    } catch (_) {
      // The manager sees the request without a place rather than not at all.
    }
    try {
      await widget.api.requestFaceFallback(type: widget.type, reading: reading);
      if (mounted)
        Navigator.of(context).pop(const FaceCheckOutcome.fallbackSent());
    } on ManagerApiException catch (error) {
      _fail(
        'Request not sent',
        error.offline
            ? 'No internet connection. Connect and try again.'
            : error.message,
      );
    } finally {
      if (mounted) setState(() => _sendingFallback = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final punchIn = widget.type != 'out';
    final punchWord = punchIn ? 'punch-in' : 'punch-out';
    if (_setUp) {
      return FaceSetupSuccess(
        stepTitle: widget.onboarding
            ? 'Face ID'
            : punchIn
            ? 'Punch in'
            : 'Punch out',
        line: widget.onboarding
            ? 'You can now punch in with a selfie.'
            : 'Next, a selfie to confirm your $punchWord.',
        onContinue: _afterSetUp,
        onClose: () => Navigator.of(context).pop(),
      );
    }
    final label = widget.onboarding
        ? 'Set up Face ID'
        : punchIn
        ? 'Set up & punch in'
        : 'Set up & punch out';
    final signal = _camera.signal;
    final detected = signal == FaceSignal.detected;
    final cameraProblem = _camera.cameraProblem;
    final caption = _attemptsLeft != null && _attemptsLeft! > 0
        ? '$_attemptsLeft ${_attemptsLeft == 1 ? 'try' : 'tries'} left.'
        : 'Your later punches are matched with this selfie.';
    FaceStatusRow? status;
    var action = FaceCaptureAction(
      label: label,
      caption: _agreed || _consent == null
          ? caption
          : 'Agree above to set up Face ID.',
      busy: _busy,
      // Locked until they agree, as well as until a face is in the oval.
      enabled: _agreed,
      onTap: signal == FaceSignal.starting || !_agreed ? null : _enrol,
    );
    if (cameraProblem != null) {
      status = FaceStatusRow.problem(
        title: 'Camera unavailable',
        body: cameraProblem,
      );
      action = FaceCaptureAction(
        label: _camera.permissionDenied ? 'Open Settings' : 'Try again',
        caption: '',
        onTap: _camera.permissionDenied
            ? Geolocator.openAppSettings
            : _camera.start,
      );
    } else if (signal == FaceSignal.notDetected) {
      status = const FaceStatusRow.problem(
        title: 'Face not detected',
        body:
            'Move into the oval, face a light source\nand make sure your face is uncovered.',
      );
      action = FaceCaptureAction(
        label: label,
        caption: 'Capture unlocks when a face is detected.',
        enabled: false,
        onTap: null,
      );
    } else if (detected && !_camera.challengeDone) {
      // Not "Face detected" yet: still detecting, with the prompt to do.
      status = FaceStatusRow.detecting(body: _camera.challenge.prompt);
      action = FaceCaptureAction(
        label: label,
        caption: 'Capture unlocks once you have done that.',
        enabled: false,
        onTap: null,
      );
    } else if (_problem != null) {
      status = FaceStatusRow.problem(
        title: _problemTitle ?? 'Try again',
        body: _problem!,
      );
    } else if (_loadProblem != null) {
      status = FaceStatusRow.problem(
        title: 'Face ID unavailable',
        body: _loadProblem!,
      );
    } else if (detected) {
      status = const FaceStatusRow.detected(
        body:
            "You're all set. Look at the camera and\nhold still while you take your selfie.",
      );
    } else if (signal == FaceSignal.starting) {
      status = const FaceStatusRow.detecting();
    }

    // Out of tries, or the service is down: the manager can be asked instead.
    Widget? below;
    if (_fallbackOpen && cameraProblem == null && !widget.onboarding) {
      action = FaceCaptureAction(
        label: 'Send $punchWord to manager',
        caption: 'Your manager or HR approves the $punchWord.',
        busy: _sendingFallback,
        onTap: _sendFallback,
      );
      below = detected && _camera.challengeDone && _agreed
          ? FaceQuietLink(
              label: 'Try setting up again',
              onTap: _busy ? null : _enrol,
            )
          : null;
    }

    void close() => Navigator.of(context).pop();
    return FaceCaptureLayout(
      stepTitle: widget.onboarding
          ? 'Face ID'
          : punchIn
          ? 'Punch in'
          : 'Punch out',
      heading: 'Set up Face ID',
      instructions: 'Position your face inside the oval to\nset up Face ID.',
      camera: _camera.controller,
      guide: signal == FaceSignal.notDetected
          ? FaceGuide.dashed
          : FaceGuide.solid,
      status: status,
      aboveAction: _ConsentLine(
        consent: _consent,
        agreed: _agreed,
        onChanged: _busy ? null : (value) => setState(() => _agreed = value),
        onRetry: _loadProblem == null ? null : _load,
      ),
      action: action,
      below: below,
      onBack: close,
      onClose: close,
    );
  }
}

/// The consent line and its tick, set in the action caption's type: the
/// whole consent, word for word. Agreeing is something they do, never a default.
class _ConsentLine extends StatelessWidget {
  const _ConsentLine({
    required this.consent,
    required this.agreed,
    required this.onChanged,
    required this.onRetry,
  });

  final FaceConsent? consent;
  final bool agreed;
  final ValueChanged<bool>? onChanged;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final words = consent;
    if (words == null) {
      return Center(
        child: onRetry == null
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2, color: _brand),
              )
            : FaceQuietLink(label: 'Load the consent again', onTap: onRetry),
      );
    }
    return Semantics(
      checked: agreed,
      label: words.agree,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onChanged == null ? null : () => onChanged!(!agreed),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 20,
              height: 20,
              child: Checkbox(
                value: agreed,
                activeColor: _brand,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                visualDensity: VisualDensity.compact,
                onChanged: onChanged == null
                    ? null
                    : (value) => onChanged!(value ?? false),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                words.agree,
                style: _sora(11, FontWeight.w400, _tertiary, height: 18 / 11),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

TextStyle _sora(
  double size,
  FontWeight weight,
  Color color, {
  double? height,
}) => TextStyle(
  fontFamily: 'Sora',
  fontSize: size,
  fontWeight: weight,
  color: color,
  height: height,
);

const _tertiary = Color(0xFF717171);
const _brand = Color(0xFF0571A6);
