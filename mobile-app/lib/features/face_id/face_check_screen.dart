import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../attendance/data/punch_location_service.dart';
import '../manager/data/manager_api_service.dart';
import 'face_camera.dart';
import 'face_capture_layout.dart';
import 'face_id_models.dart';
import 'face_liveness.dart';
import 'face_sounds.dart';

/// How the face check before a punch ended.
class FaceCheckOutcome {
  const FaceCheckOutcome._({
    this.token,
    this.punchedAt,
    this.fallbackSent = false,
    this.needsSetup = false,
    this.needsCheck = false,
    this.placeRefused = false,
  });

  /// Matched, with the token for the punch that follows.
  const FaceCheckOutcome.passed(String token) : this._(token: token);

  /// Matched, and the punch made from the camera went through at [at].
  const FaceCheckOutcome.punched(DateTime at) : this._(punchedAt: at);

  const FaceCheckOutcome.fallbackSent() : this._(fallbackSent: true);
  const FaceCheckOutcome.needsSetup() : this._(needsSetup: true);
  const FaceCheckOutcome.needsCheck() : this._(needsCheck: true);

  /// The location check came back outside the office (or unreadable) while
  /// the camera was open: the punch screen says so, as it always did.
  const FaceCheckOutcome.placeRefused() : this._(placeRefused: true);

  /// Set up in this run of the app: the profile the app holds still says
  /// not, until it is read again at the next launch.
  static bool enrolledThisRun = false;

  final String? token;
  final DateTime? punchedAt;
  final bool fallbackSent;
  final bool needsSetup;
  final bool needsCheck;
  final bool placeRefused;
}

/// Where the phone is, as the punch screen's location check found it while
/// the camera warmed up: the office's name, or refused (outside, or the
/// reading would not do), which ends the camera.
class FacePlace {
  const FacePlace.inside(this.office) : refused = false;
  const FacePlace.unchecked() : office = null, refused = false;
  const FacePlace.refused() : office = null, refused = true;

  final String? office;
  final bool refused;
}

/// The punch made from the camera with a matched face's token: the time it
/// was recorded at, or null when it did not go through and the punch screen
/// has taken over saying why.
typedef FacePunch = Future<DateTime?> Function(String token);

/// The words on the camera for each thing the gate asks: one headline, one
/// optional line (the camera copy table of the requirements).
(String, String?, FaceHeadlineTone) faceCopy(FaceProblem problem, {FacePose pose = FacePose.front}) => switch (problem) {
  FaceProblem.closer => ('Move a little closer', 'Your face should fill most of the oval.', FaceHeadlineTone.fix),
  FaceProblem.dark => ('Too dark here', 'Face a light or a window.', FaceHeadlineTone.fix),
  FaceProblem.bright => ('Turn away from the window', null, FaceHeadlineTone.fix),
  FaceProblem.angle => ('Face the camera', null, FaceHeadlineTone.fix),
  FaceProblem.still => ('Hold the phone still', null, FaceHeadlineTone.fix),
  FaceProblem.oneFace => ('Only one face in the frame', null, FaceHeadlineTone.fix),
  FaceProblem.spoof => ('Please use your face, not a photo or a screen', null, FaceHeadlineTone.fix),
  FaceProblem.timeout => ('Face not detected', null, FaceHeadlineTone.fix),
  _ when pose != FacePose.front => ('Turn toward the arrow', null, FaceHeadlineTone.plain),
  _ => ('Look at the camera', 'Hold the phone at eye level.', FaceHeadlineTone.plain),
};

/// "4:00 PM", in the phone's time.
String clockOf(DateTime at) {
  final t = at.toLocal();
  final hour = t.hour % 12 == 0 ? 12 : t.hour % 12;
  return '$hour:${t.minute.toString().padLeft(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}';
}

const _weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "4:00 PM · Friday, 30 Oct".
String punchedLine(DateTime at) {
  final t = at.toLocal();
  return '${clockOf(t)} · ${_weekdays[t.weekday - 1]}, ${t.day} ${_months[t.month - 1]}';
}

/// The daily face check (boards D2–D6): the camera opens at once, the gate
/// and the burst run with nothing to tap, the selfie goes to the server with
/// the burst's crops, and on a match the punch is made from here
/// ([punch]) and "Punched in" shows for a moment before the screen closes on
/// its own. A mismatch says so with the tries left and looks again; after
/// the day's tries the punch can go to the manager instead.
///
/// The phone's own verdict only decides whether to take the selfie: the
/// server re-reads the crops and matches the face. Null when closed.
class FaceCheckScreen extends StatefulWidget {
  const FaceCheckScreen({
    super.key,
    required this.api,
    this.type = 'in',
    this.readLocation,
    this.place,
    this.punch,
  });

  final ManagerApiService api;

  /// 'in' or 'out': the same check guards both.
  final String type;

  /// Where the phone is, for a punch sent to the manager. Optional: the
  /// request goes without it if the location cannot be read.
  final Future<PunchReading> Function()? readLocation;

  /// The punch screen's location check, run while the camera warms up.
  final Future<FacePlace>? place;

  /// The punch, made with the token once the face matched; null hands the
  /// token back instead ([FaceCheckOutcome.passed]).
  final FacePunch? punch;

  /// How long "Punched in" stays before the screen closes.
  static Duration matchedPause = const Duration(milliseconds: 600);

  /// How long an answer stays on the camera before it looks again.
  static Duration failPause = const Duration(seconds: 2);

  @override
  State<FaceCheckScreen> createState() => _FaceCheckScreenState();
}

class _FaceCheckScreenState extends State<FaceCheckScreen> with WidgetsBindingObserver {
  final FaceCamera _camera = FaceCamera.create();
  FaceIdStatus? _status;
  String? _office;

  /// The server's challenge for the next selfie, asked for at each new try.
  Future<String?>? _challenge;

  /// A selfie is with the server, or the punch is going through: "Checking…".
  bool _checking = false;

  /// The face matched and the punch went through: the green ring and tick.
  bool _matched = false;
  DateTime? _punchedAt;

  /// An answer on the camera for [FaceCheckScreen.failPause]: (headline, line).
  (String, String?)? _answer;
  FaceHeadlineTone _answerTone = FaceHeadlineTone.plain;

  /// The day's tries are spent (or the service is down): the manager instead.
  bool _fallbackOpen = false;
  String? _fallbackLine;
  bool _sendingFallback = false;
  String? _problem;

  Timer? _timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _camera
      ..addListener(_changed)
      ..onTryEnded = ((summary) => unawaited(widget.api.logFaceTry(summary)))
      ..onNewTry = _newChallenge
      ..onBurst = _onBurst;
    unawaited(_open());
    unawaited(_watchPlace());
  }

  Future<void> _open() async {
    // The camera, the status and the challenge together: none waits on another.
    unawaited(_camera.start());
    try {
      final status = await widget.api.fetchFaceStatus();
      if (!mounted) return;
      if (!status.enrolled) {
        Navigator.of(context).pop(const FaceCheckOutcome.needsSetup());
        return;
      }
      setState(() {
        _status = status;
        if (status.fallbackAvailable) _openFallback(null);
      });
      if (status.liveness.aws) await _runLiveness();
    } catch (_) {
      // The check itself will say what is wrong; the status only adds to it.
    }
  }

  Future<void> _watchPlace() async {
    final place = widget.place;
    if (place == null) return;
    try {
      final where = await place;
      if (!mounted) return;
      if (where.refused) {
        // Outside the office: the punch screen's refusal, not the camera's.
        if (!_checking && !_matched) Navigator.of(context).pop(const FaceCheckOutcome.placeRefused());
        return;
      }
      setState(() => _office = where.office);
    } catch (_) {}
  }

  void _newChallenge() {
    _challenge = widget.api.startFaceChallenge().catchError((Object _) => null);
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      unawaited(_camera.pause());
    } else if (state == AppLifecycleState.resumed && !_camera.ready && !_checking && !_matched) {
      // Back from the background: a new try, the camera live, no button over an empty oval.
      _timer?.cancel();
      _answer = null;
      unawaited(_camera.start());
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _camera.removeListener(_changed);
    _camera.dispose();
    super.dispose();
  }

  /// Face Liveness, once the company's server has it on: AWS's own detector
  /// streams the check, and the server reads the result and matches the face.
  Future<void> _runLiveness() async {
    const liveness = FaceLiveness();
    _camera.hold();
    if (!await liveness.isAvailable()) {
      if (mounted) setState(() => _problem = "This version of the app can't run your company's face check. Update it from the store.");
      return;
    }
    setState(() => _checking = true);
    try {
      final session = await widget.api.startFaceLiveness();
      final ran = await liveness.run(sessionId: session.sessionId, region: session.region, identityPoolId: session.identityPoolId);
      if (ran == 'cancelled') return;
      await _judge(await widget.api.verifyFace(livenessSessionId: session.sessionId));
    } on ManagerApiException catch (error) {
      _refused(error);
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  Future<void> _onBurst(FaceBurst burst) async {
    if (!mounted || _checking) return;
    setState(() {
      _checking = true;
      _problem = null;
    });
    try {
      final challengeId = await (_challenge ?? Future<String?>.value()).timeout(const Duration(seconds: 6), onTimeout: () => null);
      final result = await widget.api.verifyFace(burst: burst, challengeId: challengeId);
      await _judge(result);
    } on ManagerApiException catch (error) {
      _refused(error);
    } catch (_) {
      _say("Face check isn't available right now", 'Try again in a minute.');
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  /// A selfie with no burst, on a phone that cannot find faces.
  Future<void> _takeByHand() async {
    if (_checking) return;
    setState(() => _checking = true);
    try {
      final photo = await _camera.captureNow();
      if (photo == null) {
        _say('The photo was not taken', 'Try again.');
        return;
      }
      await _judge(await widget.api.verifyFace(jpeg: photo));
    } on ManagerApiException catch (error) {
      _refused(error);
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  Future<void> _judge(FaceCheckResult result) async {
    if (!mounted) return;
    final token = result.token;
    if (result.passed && token != null) {
      final punch = widget.punch;
      if (punch == null) {
        await _celebrate(null);
        if (mounted) Navigator.of(context).pop(FaceCheckOutcome.passed(token));
        return;
      }
      // "Checking…" stays while the punch goes through; then "Punched in".
      DateTime? at;
      try {
        at = await punch(token);
      } catch (_) {
        at = null;
      }
      if (!mounted) return;
      if (at == null) {
        Navigator.of(context).pop(FaceCheckOutcome.passed(token));
        return;
      }
      await _celebrate(at);
      if (mounted) Navigator.of(context).pop(FaceCheckOutcome.punched(at));
      return;
    }
    if (result.fallbackAvailable) {
      unawaited(FaceSounds.failed());
      setState(() => _openFallback(result));
      return;
    }
    switch (result.reason) {
      case 'uncertain':
        // The server was unsure: closer, and the burst again with a fresh challenge.
        _camera.say(FaceProblem.closer, pause: FaceCheckScreen.failPause);
        _camera.again();
        return;
      case 'spoof':
      case 'liveness_failed':
        unawaited(FaceSounds.failed());
        _say(result.title, null, tone: FaceHeadlineTone.fix);
        return;
    }
    unawaited(FaceSounds.failed());
    if (result.inconclusive) {
      _say(result.title, null, tone: FaceHeadlineTone.fix);
    } else {
      final left = result.attemptsLeft;
      _say("We couldn't confirm it's you", '$left ${left == 1 ? 'try' : 'tries'} left today. Try again.');
    }
  }

  /// The green ring and tick, the tone, and [FaceCheckScreen.matchedPause].
  Future<void> _celebrate(DateTime? at) async {
    unawaited(FaceSounds.done());
    setState(() {
      _matched = true;
      _punchedAt = at;
    });
    await Future<void>.delayed(FaceCheckScreen.matchedPause);
  }

  /// An answer on the camera for a moment, then another look.
  void _say(String headline, String? line, {FaceHeadlineTone tone = FaceHeadlineTone.plain}) {
    if (!mounted) return;
    setState(() {
      _answer = (headline, line);
      _answerTone = tone;
    });
    _timer?.cancel();
    _timer = Timer(FaceCheckScreen.failPause, () {
      if (!mounted || _fallbackOpen) return;
      setState(() => _answer = null);
      _camera.again();
    });
  }

  void _openFallback(FaceCheckResult? result) {
    _camera.hold();
    _fallbackOpen = true;
    final max = _status?.maxAttempts ?? 5;
    _fallbackLine = result?.reason == 'unavailable'
        ? "Face check isn't available right now."
        : result != null && result.inconclusive
        ? "The check couldn't be completed today."
        : '$max of $max tries used today.';
  }

  void _refused(ManagerApiException error) {
    if (!mounted) return;
    final face = error.details?['face'];
    final reason = face is Map ? face['reason'] as String? : null;
    if (reason == 'not_enrolled') {
      Navigator.of(context).pop(const FaceCheckOutcome.needsSetup());
      return;
    }
    unawaited(FaceSounds.failed());
    if (face is Map && face['fallback'] == true) {
      setState(() => _openFallback(FaceCheckResult(passed: false, reason: reason ?? 'unavailable', message: error.message)));
      return;
    }
    if (error.offline) {
      _say('No internet connection', 'Connect and try again.');
    } else {
      _say(FaceCheckResult(passed: false, reason: reason ?? 'unavailable', message: error.message).title, null);
    }
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
    final punchIn = widget.type != 'out';
    final cameraProblem = _camera.cameraProblem;
    if (_matched) {
      final at = _punchedAt;
      return FaceCameraView(
        headline: at == null ? "That's you" : (punchIn ? 'Punched in' : 'Punched out'),
        line: at == null ? null : punchedLine(at),
        camera: _camera.controller,
        ring: const FaceRing.green(),
        tick: true,
        place: _office,
      );
    }
    if (_fallbackOpen) {
      final manager = _status?.managerName;
      return FaceCameraView(
        headline: "We couldn't confirm it's you",
        line: _problem ?? _fallbackLine,
        camera: _camera.controller,
        place: _office,
        dim: true,
        onClose: _close,
        action: FaceCameraAction(
          label: 'Send ${punchIn ? 'punch-in' : 'punch-out'} to manager',
          busy: _sendingFallback,
          onTap: _sendFallback,
          note: '${manager ?? 'Your manager'} will see the time, the location and that the face check didn\'t pass.',
        ),
      );
    }
    if (cameraProblem != null) {
      return FaceCameraView(
        headline: 'Camera not available',
        line: cameraProblem,
        place: _office,
        onClose: _close,
        action: FaceCameraAction(
          label: _camera.permissionDenied ? 'Open Settings' : 'Try again',
          onTap: _camera.permissionDenied ? Geolocator.openAppSettings : _camera.start,
        ),
      );
    }
    String headline;
    String? line;
    var tone = FaceHeadlineTone.plain;
    FaceCameraAction? action;
    if (_checking) {
      headline = 'Checking…';
    } else if (_answer case (final h, final l)) {
      headline = h;
      line = l;
      tone = _answerTone;
    } else if (_problem != null) {
      headline = "Face check isn't available";
      line = _problem;
    } else if (_camera.signal == FaceSignal.unavailable) {
      headline = 'Look at the camera';
      line = 'Then tap the button.';
      action = FaceCameraAction(label: punchIn ? 'Punch in' : 'Punch out', onTap: _takeByHand);
    } else {
      (headline, line, tone) = faceCopy(_camera.problem);
    }
    return FaceCameraView(
      headline: headline,
      line: line,
      tone: tone,
      camera: _camera.controller,
      place: _office,
      onClose: _checking ? null : _close,
      action: action,
    );
  }
}
