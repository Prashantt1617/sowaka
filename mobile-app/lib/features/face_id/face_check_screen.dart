import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../attendance/data/punch_location_service.dart';
import '../manager/data/manager_api_service.dart';
import 'face_camera.dart';
import 'face_capture_layout.dart';
import 'face_id_models.dart';
import 'face_liveness.dart';

/// How the face check before a punch ended.
class FaceCheckOutcome {
  const FaceCheckOutcome.passed(String this.token)
    : fallbackSent = false,
      needsSetup = false,
      needsCheck = false;
  const FaceCheckOutcome.fallbackSent()
    : token = null,
      fallbackSent = true,
      needsSetup = false,
      needsCheck = false;
  const FaceCheckOutcome.needsSetup()
    : token = null,
      fallbackSent = false,
      needsSetup = true,
      needsCheck = false;
  const FaceCheckOutcome.needsCheck()
    : token = null,
      fallbackSent = false,
      needsSetup = false,
      needsCheck = true;

  /// Set up in this run of the app: the profile the app holds still says
  /// not, until it is read again at the next launch.
  static bool enrolledThisRun = false;

  /// Spent by the punch: the server's proof the face matched.
  final String? token;

  /// The tries ran out and the punch-in went to the manager instead.
  final bool fallbackSent;

  /// Face ID is not set up (or HR reset it): set it up first.
  final bool needsSetup;

  /// Set up, but with no punch token to show for it: take the selfie.
  final bool needsCheck;
}

/// The selfie before a punch, in or out (Figma 4194:21786; a punch-out has
/// the same screens with its own words). Face first, then the
/// location: the punch screen opens this, and goes on to the location check
/// with the token it hands back.
///
/// It never decides anything itself. The phone's face detection only says
/// when to take the selfie; the server matches the face and answers with a
/// token or a reason, and only then does the camera say "Face id detected". After the tries run out, or
/// while the face service is down, it offers to send the punch-in to the
/// manager, so nobody is shut out at the door. Null when closed.
class FaceCheckScreen extends StatefulWidget {
  const FaceCheckScreen({
    super.key,
    required this.api,
    this.type = 'in',
    this.readLocation,
  });

  final ManagerApiService api;

  /// 'in' or 'out': the same selfie guards both, with the punch's own words.
  final String type;

  /// Where the phone is, for a punch-in sent to the manager. Optional: the
  /// request goes without it if the location cannot be read.
  final Future<PunchReading> Function()? readLocation;

  /// How long "Face id detected" stays on the camera before the punch goes on.
  static Duration matchedPause = const Duration(milliseconds: 900);

  @override
  State<FaceCheckScreen> createState() => _FaceCheckScreenState();
}

class _FaceCheckScreenState extends State<FaceCheckScreen>
    with WidgetsBindingObserver {
  final FaceCamera _camera = FaceCamera.create();
  FaceIdStatus? _status;
  FaceCheckResult? _result;
  String? _problem;
  bool _busy = false;
  bool _sendingFallback = false;

  /// Whether the status has been read (or failed to be): until then, the
  /// selfie is not taken on its own, in case the company uses Face Liveness.
  bool _statusRead = false;
  late final FaceAutoCapture _auto = FaceAutoCapture(
    camera: _camera,
    allowed: () =>
        mounted &&
        !_busy &&
        _statusRead &&
        _status?.liveness.aws != true &&
        !_fallbackOpen &&
        _camera.cameraProblem == null,
    onCapture: _capture,
  );

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _camera.addListener(_changed);
    unawaited(_open());
  }

  Future<void> _open() async {
    // The camera and the status together: neither waits on the other.
    unawaited(_camera.start());
    try {
      final status = await widget.api.fetchFaceStatus();
      if (!mounted) return;
      if (!status.enrolled) {
        Navigator.of(context).pop(const FaceCheckOutcome.needsSetup());
        return;
      }
      setState(() => _status = status);
      if (status.liveness.aws) await _runLiveness(status);
    } catch (_) {
      // The check itself will say what is wrong; the status only adds to it.
    } finally {
      _statusRead = true;
      _auto.check();
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
    } else if (state == AppLifecycleState.resumed && !_camera.ready && !_busy) {
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

  bool get _fallbackOpen =>
      _result?.fallbackAvailable == true ||
      (_result == null && _status?.fallbackAvailable == true);

  /// Face Liveness, once the company's server has it on: AWS's own detector
  /// streams the check, and the server reads the result and matches the face.
  Future<void> _runLiveness(FaceIdStatus status) async {
    const liveness = FaceLiveness();
    if (!await liveness.isAvailable()) {
      if (mounted) {
        setState(
          () => _problem =
              "This version of the app can't run your company's face check. Update it from the store.",
        );
      }
      return;
    }
    setState(() => _busy = true);
    try {
      final session = await widget.api.startFaceLiveness();
      final ran = await liveness.run(
        sessionId: session.sessionId,
        region: session.region,
        identityPoolId: session.identityPoolId,
      );
      if (ran == 'cancelled') return;
      await _judge(
        await widget.api.verifyFace(livenessSessionId: session.sessionId),
      );
    } on ManagerApiException catch (error) {
      _refused(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _capture() async {
    if (_busy || !mounted) return;
    _auto.spend();
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      final photo = await _camera.capture();
      if (photo == null) {
        setState(
          () => _problem = 'The camera did not take the photo. Try again.',
        );
        await _camera.resume();
        return;
      }
      final result = await widget.api.verifyFace(
        jpeg: photo,
        // No live prompt is asked any more: the server logs that honestly.
        challenge: 'none',
        devicePassed: false,
      );
      await _judge(result);
    } on ManagerApiException catch (error) {
      _refused(error);
      await _camera.resume();
    } catch (_) {
      if (mounted)
        setState(
          () => _problem =
              "Face check isn't available right now. Try again in a minute.",
        );
      await _camera.resume();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Matched: the tick is on the camera until [_onTimer] hands the token on.
  bool _matched = false;
  Timer? _onTimer;

  Future<void> _judge(FaceCheckResult result) async {
    if (!mounted) return;
    if (result.passed && result.token != null) {
      // Face id detected (4266:26221): the tick, then the punch.
      setState(() => _matched = true);
      _onTimer = Timer(FaceCheckScreen.matchedPause, () {
        if (mounted)
          Navigator.of(context).pop(FaceCheckOutcome.passed(result.token!));
      });
      return;
    }
    setState(() => _result = result);
    await _camera.resume();
  }

  void _refused(ManagerApiException error) {
    if (!mounted) return;
    final face = error.details?['face'];
    final reason = face is Map ? face['reason'] as String? : null;
    if (reason == 'not_enrolled') {
      Navigator.of(context).pop(const FaceCheckOutcome.needsSetup());
      return;
    }
    setState(() {
      _problem = error.offline
          ? 'No internet connection. Connect and try again.'
          : error.message;
      if (face is Map && face['fallback'] == true) {
        _result = FaceCheckResult(
          passed: false,
          reason: reason ?? 'unavailable',
          message: error.message,
          fallbackAvailable: true,
        );
      }
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
      if (mounted)
        setState(
          () => _problem = error.offline
              ? 'No internet connection. Connect and try again.'
              : error.message,
        );
    } finally {
      if (mounted) setState(() => _sendingFallback = false);
    }
  }

  void _close() => Navigator.of(context).pop();

  @override
  Widget build(BuildContext context) {
    final signal = _camera.signal;
    final result = _result;
    final cameraProblem = _camera.cameraProblem;
    final detected = signal == FaceSignal.detected;
    final punchIn = widget.type != 'out';
    final punchWord = punchIn ? 'punch-in' : 'punch-out';
    final heading = punchIn ? 'Punch-in' : 'Punch-out';

    // The camera (4266:26221 / 4266:26076): the heading, the oval, one line.
    // "Face id detected" and the tick come only once the server has matched
    // the face (4266:26221); a failed try darkens the camera (4266:26076).
    if (_matched) {
      return FaceCaptureLayout(
        heading: heading,
        camera: _camera.controller,
        state: FaceCaptureState.detected,
        line: 'Face id detected',
        onClose: _close,
      );
    }
    FaceCaptureState state;
    String? line;
    FaceCaptureButton? action;
    String? caption;
    Widget? below;
    final failed = result != null || _problem != null;
    if (cameraProblem != null) {
      state = FaceCaptureState.failed;
      line = cameraProblem;
      action = FaceCaptureButton(
        label: _camera.permissionDenied ? 'Open Settings' : 'Try again',
        onTap: _camera.permissionDenied
            ? Geolocator.openAppSettings
            : _camera.start,
      );
    } else if (failed) {
      // The last check failed (4266:26076): its reason, Try Again, the tries
      // left. The reason stays until the next try.
      state = FaceCaptureState.failed;
      line = result?.title ?? 'Face check unavailable';
      action = FaceCaptureButton(
        label: 'Try Again',
        busy: _busy,
        enabled: detected || signal == FaceSignal.unavailable,
        onTap: _capture,
      );
      caption = result != null && result.attemptsLeft > 0
          ? '${result.attemptsLeft} out of 3 ${result.attemptsLeft == 1 ? 'try' : 'tries'} left'
          : result?.message ?? _problem;
    } else if (signal == FaceSignal.unavailable) {
      // This phone cannot find faces: the button takes the selfie.
      state = FaceCaptureState.looking;
      line = 'Look at the camera and tap the button.';
      action = FaceCaptureButton(
        label: punchIn ? 'Take selfie & punch in' : 'Take selfie & punch out',
        busy: _busy,
        onTap: _capture,
      );
    } else {
      // Looking, or found: the line says which, and the selfie takes itself.
      state = FaceCaptureState.looking;
      line = detected
          ? 'Hold still'
          : signal == FaceSignal.notDetected
          ? 'Keep your face inside the oval'
          : 'Position your face inside the oval';
    }
    // Out of tries, or the service is down: the manager can be asked instead.
    if (_fallbackOpen && cameraProblem == null) {
      state = FaceCaptureState.failed;
      line = result?.title ?? 'Face check unavailable';
      action = FaceCaptureButton(
        label: 'Send $punchWord to manager',
        busy: _sendingFallback,
        onTap: _sendFallback,
      );
      caption = result?.reason == 'unavailable'
          ? 'Face check is unavailable. Your manager or HR approves the $punchWord.'
          : 'Your manager or HR approves the $punchWord.';
      below = detected || signal == FaceSignal.unavailable
          ? FaceQuietLink(
              label: 'Take another selfie',
              onCamera: true,
              onTap: _busy ? null : _capture,
            )
          : null;
    }
    return FaceCaptureLayout(
      heading: heading,
      camera: _camera.controller,
      state: state,
      line: line,
      action: action,
      caption: caption,
      below: below,
      busy: _busy && action == null,
      onClose: _close,
    );
  }
}
