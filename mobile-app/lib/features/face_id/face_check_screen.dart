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
  const FaceCheckOutcome.passed(String this.token) : fallbackSent = false, needsSetup = false, needsCheck = false;
  const FaceCheckOutcome.fallbackSent() : token = null, fallbackSent = true, needsSetup = false, needsCheck = false;
  const FaceCheckOutcome.needsSetup() : token = null, fallbackSent = false, needsSetup = true, needsCheck = false;
  const FaceCheckOutcome.needsCheck() : token = null, fallbackSent = false, needsSetup = false, needsCheck = true;

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
/// It never decides anything itself. The phone's prompt (blink, or turn your
/// head) and its face detection only gate the button; the server matches the
/// face and answers with a token or a reason. After the tries run out, or
/// while the face service is down, it offers to send the punch-in to the
/// manager, so nobody is shut out at the door. Null when closed.
class FaceCheckScreen extends StatefulWidget {
  const FaceCheckScreen({super.key, required this.api, this.type = 'in', this.readLocation});

  final ManagerApiService api;

  /// 'in' or 'out': the same selfie guards both, with the punch's own words.
  final String type;

  /// Where the phone is, for a punch-in sent to the manager. Optional: the
  /// request goes without it if the location cannot be read.
  final Future<PunchReading> Function()? readLocation;

  @override
  State<FaceCheckScreen> createState() => _FaceCheckScreenState();
}

class _FaceCheckScreenState extends State<FaceCheckScreen> with WidgetsBindingObserver {
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
    if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      unawaited(_camera.pause());
    } else if (state == AppLifecycleState.resumed && !_camera.ready && !_busy) {
      unawaited(_camera.start());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _camera.removeListener(_changed);
    _auto.dispose();
    _camera.dispose();
    super.dispose();
  }

  bool get _fallbackOpen => _result?.fallbackAvailable == true || (_result == null && _status?.fallbackAvailable == true);

  /// Face Liveness, once the company's server has it on: AWS's own detector
  /// streams the check, and the server reads the result and matches the face.
  Future<void> _runLiveness(FaceIdStatus status) async {
    const liveness = FaceLiveness();
    if (!await liveness.isAvailable()) {
      if (mounted) {
        setState(() => _problem = "This version of the app can't run your company's face check. Update it from the store.");
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
      await _judge(await widget.api.verifyFace(livenessSessionId: session.sessionId));
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
        setState(() => _problem = 'The camera did not take the photo. Try again.');
        await _camera.resume();
        return;
      }
      final result = await widget.api.verifyFace(
        jpeg: photo,
        challenge: _camera.signal == FaceSignal.unavailable ? 'none' : _camera.challenge.key,
        devicePassed: _camera.challengeDone,
      );
      await _judge(result);
    } on ManagerApiException catch (error) {
      _refused(error);
      await _camera.resume();
    } catch (_) {
      if (mounted) setState(() => _problem = "Face check isn't available right now. Try again in a minute.");
      await _camera.resume();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _judge(FaceCheckResult result) async {
    if (!mounted) return;
    if (result.passed && result.token != null) {
      Navigator.of(context).pop(FaceCheckOutcome.passed(result.token!));
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
      _problem = error.offline ? 'No internet connection. Connect and try again.' : error.message;
      if (face is Map && face['fallback'] == true) {
        _result = FaceCheckResult(passed: false, reason: reason ?? 'unavailable', message: error.message, fallbackAvailable: true);
      }
    });
  }

  Future<void> _sendFallback() async {
    if (_sendingFallback) return;
    setState(() => _sendingFallback = true);
    PunchReading? reading;
    try {
      reading = await widget.readLocation?.call().timeout(const Duration(seconds: 12));
    } catch (_) {
      // The manager sees the request without a place rather than not at all.
    }
    try {
      await widget.api.requestFaceFallback(type: widget.type, reading: reading);
      if (mounted) Navigator.of(context).pop(const FaceCheckOutcome.fallbackSent());
    } on ManagerApiException catch (error) {
      if (mounted) setState(() => _problem = error.offline ? 'No internet connection. Connect and try again.' : error.message);
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
    final noFace = signal == FaceSignal.notDetected;
    final promptDone = _camera.challengeDone;
    final punchIn = widget.type != 'out';
    final punchLabel = punchIn ? 'Take selfie & punch in' : 'Take selfie & punch out';
    final punchWord = punchIn ? 'punch-in' : 'punch-out';

    FaceStatusRow? status;
    var action = FaceCaptureAction(
      label: punchLabel,
      // Ready, and the selfie will be taken without a tap; the button stays,
      // for after a failed try and for a phone that cannot detect a face.
      caption: detected && promptDone && _auto.armed
          ? "Hold still — we'll take it automatically."
          : 'Your selfie will confirm your $punchWord.',
      busy: _busy,
      // Before the first frame is read (4010:63873) the button is drawn as
      // the design has it; it waits for detection rather than taking a photo
      // of nobody, unless this phone cannot detect faces at all.
      onTap: signal == FaceSignal.starting ? null : _capture,
    );

    if (cameraProblem != null) {
      status = FaceStatusRow.problem(title: 'Camera unavailable', body: cameraProblem);
      action = FaceCaptureAction(
        label: _camera.permissionDenied ? 'Open Settings' : 'Try again',
        caption: '',
        onTap: _camera.permissionDenied ? Geolocator.openAppSettings : _camera.start,
      );
    } else if (noFace) {
      // Face not detected (4005:51579): capture stays locked.
      status = const FaceStatusRow.problem(
        title: 'Face not detected',
        body: 'Move into the oval, face a light source\nand make sure your face is uncovered.',
      );
      action = FaceCaptureAction(
        label: punchLabel,
        caption: 'Capture unlocks when a face is detected.',
        enabled: false,
        onTap: null,
      );
    } else if (detected && !promptDone) {
      // Not "Face detected" yet: still detecting, with the phone's own
      // prompt as the instruction until it is done.
      status = FaceStatusRow.detecting(body: _camera.challenge.prompt);
      action = FaceCaptureAction(
        label: punchLabel,
        caption: 'Capture unlocks once you have done that.',
        enabled: false,
        onTap: null,
      );
    } else if (result != null) {
      // The last check failed: its reason stays until the next try.
      status = FaceStatusRow.problem(title: result.title, body: result.message);
    } else if (_problem != null) {
      status = FaceStatusRow.problem(title: 'Face check unavailable', body: _problem!);
    } else if (detected) {
      // Face detected (4005:51535): a face, and the prompt done.
      status = const FaceStatusRow.detected(
        body: "You're all set. Look at the camera and\nhold still while you take your selfie.",
      );
    } else if (signal == FaceSignal.starting) {
      // The camera or the detector has not answered yet.
      status = const FaceStatusRow.detecting();
    }

    // Out of tries, or the service is down: the manager can be asked instead.
    Widget? below;
    if (_fallbackOpen && cameraProblem == null) {
      action = FaceCaptureAction(
        label: 'Send $punchWord to manager',
        caption: result?.reason == 'unavailable'
            ? 'Face check is unavailable. Your manager or HR approves the $punchWord.'
            : 'Your manager or HR approves the $punchWord.',
        busy: _sendingFallback,
        onTap: _sendFallback,
      );
      below = (detected && promptDone) || signal == FaceSignal.unavailable
          ? FaceQuietLink(label: 'Take another selfie', onTap: _busy ? null : _capture)
          : null;
    } else if (result != null && result.attemptsLeft > 0 && action.enabled) {
      action = FaceCaptureAction(
        label: action.label,
        caption: '${result.attemptsLeft} ${result.attemptsLeft == 1 ? 'try' : 'tries'} left.',
        busy: action.busy,
        onTap: action.onTap,
      );
    }

    return FaceCaptureLayout(
      stepTitle: punchIn ? 'Punch in' : 'Punch out',
      heading: 'Take a selfie',
      instructions: 'Position your face inside the oval to\nconfirm your attendance.',
      camera: _camera.controller,
      guide: detected || signal == FaceSignal.starting || signal == FaceSignal.unavailable ? FaceGuide.solid : FaceGuide.dashed,
      status: status,
      action: action,
      below: below,
      onBack: _close,
      onClose: _close,
    );
  }
}
