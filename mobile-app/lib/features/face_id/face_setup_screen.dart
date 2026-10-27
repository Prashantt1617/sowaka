import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../attendance/data/punch_location_service.dart';
import '../manager/data/manager_api_service.dart';
import 'face_camera.dart';
import 'face_capture_layout.dart';
import 'face_check_screen.dart';
import 'face_id_models.dart';

/// Setting up Face ID, at the first punch the company checks (Figma
/// 4194:21786): a page that says what it is for, with the consent under its
/// button (4200:55075) — pressing Set up Face ID is agreeing — then the
/// camera, where the selfie takes itself once the face is in the oval.
///
/// Once set up it says so on the camera ("Face id successfully set up", with
/// the tick), then, at a punch, opens the selfie check, and pops with however that check ended: the punch goes on
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

  /// How long "Face id successfully set up" stays on the camera before the
  /// selfie check (or, in onboarding, the way out).
  static Duration successPause = const Duration(milliseconds: 1500);

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
  late final FaceAutoCapture _auto = FaceAutoCapture(
    camera: _camera,
    // Never before they agree: the consent is theirs to give first.
    allowed: () =>
        mounted &&
        !_busy &&
        _agreed &&
        _consent != null &&
        !(_fallbackOpen && !widget.onboarding) &&
        _camera.cameraProblem == null,
    onCapture: _enrol,
  );

  /// The consent's words changed under them: the intro says so, once.
  bool _consentChanged = false;

  /// Set up: the tick is on the camera until [_onTimer] moves on.
  bool _setUp = false;
  Timer? _onTimer;

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
      _auto.check();
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
    if (!mounted) return;
    setState(() {});
    _auto.check();
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
    _onTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _camera.removeListener(_changed);
    _auto.dispose();
    _camera.dispose();
    super.dispose();
  }

  Future<void> _enrol() async {
    final consent = _consent;
    if (consent == null || !_agreed || _busy || !mounted) return;
    _auto.spend();
    setState(() {
      _busy = true;
      _problem = null;
      _dismissed = false;
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
      await widget.api.enrolFace(jpeg: photo, consentVersion: consent.version);
      FaceCheckOutcome.enrolledThisRun = true;
      if (!mounted) return;
      // "Face id successfully set up" on the camera for a moment, then on:
      // the check opens its own camera, so this one is let go first.
      setState(() => _setUp = true);
      _onTimer = Timer(FaceSetupScreen.successPause, () {
        if (!mounted) return;
        unawaited(_camera.pause());
        unawaited(_afterSetUp());
      });
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
        // Back on the intro, which says why; the camera starts clean.
        _problem = null;
        _problemTitle = null;
        _consentChanged = true;
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

  /// After the tick: out of onboarding, or on to the selfie check, whose
  /// outcome (a pass, a punch sent to the manager, or closed) is the punch's.
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

  /// Try Again was tapped on a failed setup: the camera looks again, and
  /// the reason is off the screen until the next answer.
  bool _dismissed = false;

  /// Try Again: never a selfie straight away — that would let a photo skip
  /// the phone's checks — but another look, with the prompts asked again.
  void _lookAgain() {
    if (_busy || !mounted) return;
    setState(() => _dismissed = true);
    _camera.waitAgain();
    _auto.rearm();
    unawaited(_camera.resume());
    _auto.check();
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
    final stepTitle = widget.onboarding
        ? 'Face ID'
        : punchIn
        ? 'Punch in'
        : 'Punch out';
    void close() => Navigator.of(context).pop();
    // The page before the camera (4200:55075): pressing Set up Face ID is
    // the consent, so the camera only opens once they have agreed.
    if (!_agreed) {
      return FaceSetupIntro(
        stepTitle: stepTitle,
        consent: _consent?.agree,
        problem:
            _loadProblem ??
            (_consentChanged
                ? 'The Face ID consent has changed. Read it and agree again.'
                : null),
        onRetry: _loadProblem == null ? null : _load,
        onBack: close,
        onStart: _consent == null
            ? null
            : () {
                setState(() {
                  _agreed = true;
                  _consentChanged = false;
                });
                _auto.check();
              },
      );
    }
    final signal = _camera.signal;
    final detected = signal == FaceSignal.detected;
    final cameraProblem = _camera.cameraProblem;
    final tries = _attemptsLeft;

    // The camera (4266:26005 onwards): the heading, the oval, and one line.
    // "Face ID successfully set up" is drawn on it (4266:26184), with the
    // tick, once the server has kept the face — never before.
    if (_setUp) {
      return FaceCaptureLayout(
        heading: 'Set up your Face ID',
        camera: _camera.controller,
        state: FaceCaptureState.detected,
        line: 'Face id successfully set up',
        onClose: close,
      );
    }
    FaceCaptureState state;
    String? line;
    FaceCaptureButton? action;
    String? caption;
    Widget? below;
    if (cameraProblem != null) {
      state = FaceCaptureState.failed;
      line = cameraProblem;
      action = FaceCaptureButton(
        label: _camera.permissionDenied ? 'Open Settings' : 'Try again',
        onTap: _camera.permissionDenied
            ? Geolocator.openAppSettings
            : _camera.start,
      );
    } else if (_problem != null && !_dismissed) {
      // A failed setup (4266:26076): the reason, Try again, the tries left.
      state = FaceCaptureState.failed;
      line = _problemTitle ?? 'Try again';
      action = FaceCaptureButton(
        label: 'Try Again',
        busy: _busy,
        enabled: detected || signal == FaceSignal.unavailable,
        onTap: signal == FaceSignal.unavailable ? _enrol : _lookAgain,
      );
      caption = tries != null && tries > 0
          ? '$tries out of 3 ${tries == 1 ? 'try' : 'tries'} left'
          : _problem;
    } else if (_camera.waived) {
      // The phone could not read a face in time, or it never turned and
      // blinked (4266:26076): the dark camera, Face not detected, and Try
      // Again looks again.
      state = FaceCaptureState.failed;
      line = 'Face not detected';
      action = FaceCaptureButton(
        label: 'Try Again',
        busy: _busy,
        onTap: _lookAgain,
      );
      caption = tries != null && tries > 0
          ? '$tries out of 3 ${tries == 1 ? 'try' : 'tries'} left'
          : 'Keep your face inside the oval, then turn your head and blink when asked.';
    } else if (signal == FaceSignal.unavailable) {
      // This phone cannot find faces at all: the button takes the selfie.
      state = FaceCaptureState.looking;
      line = 'Look at the camera and tap the button.';
      action = FaceCaptureButton(
        label: 'Set up Face ID',
        busy: _busy,
        onTap: _enrol,
      );
    } else {
      // Looking, or found: the line says which, and the selfie takes itself
      // once the phone's own checks are done — the turn, the blink, then
      // the flash.
      state = FaceCaptureState.looking;
      line = detected
          ? (FaceAutoCapture.checkLiveness ? _camera.liveness.ask : null) ??
                'Hold still'
          : signal == FaceSignal.notDetected
          ? 'Keep your face inside the oval'
          : 'Position your face inside the oval';
    }
    // Out of tries, or the service is down: the manager can be asked instead.
    if (_fallbackOpen && cameraProblem == null && !widget.onboarding) {
      state = FaceCaptureState.failed;
      line ??= 'Face ID unavailable';
      action = FaceCaptureButton(
        label: 'Send $punchWord to manager',
        busy: _sendingFallback,
        onTap: _sendFallback,
      );
      caption = 'Your manager or HR approves the $punchWord.';
      below = detected
          ? FaceQuietLink(
              label: 'Try setting up again',
              onCamera: true,
              onTap: _busy ? null : _enrol,
            )
          : null;
    }
    return FaceCaptureLayout(
      heading: 'Set up your Face ID',
      camera: _camera.controller,
      state: state,
      line: line,
      action: action,
      caption: caption,
      below: below,
      busy: _busy && action == null,
      flash: _auto.flashOnScreen,
      onClose: close,
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
