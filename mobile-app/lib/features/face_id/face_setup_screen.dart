import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../attendance/data/punch_location_service.dart';
import '../manager/data/manager_api_service.dart';
import 'face_camera.dart';
import 'face_capture_layout.dart';
import 'face_check_screen.dart';
import 'face_id_models.dart';
import 'face_sounds.dart';

/// Setting up the face check (boards S1–S5), at the first punch the company
/// checks, after an HR reset, or in onboarding: the intro with the consent
/// ("Agree and start" is agreeing), then three photos the camera takes on its
/// own — front, then the head turned toward an arrow on one side of the oval,
/// then the other — with a ring that fills and a tap of haptic for each, so
/// nobody reads while turning. All three go to the server with the front
/// burst's crops; the setup is that day's check, so at a punch the punch is
/// made from here and the done screen says when.
///
/// A refused setup says why on the camera for a moment and starts again from
/// the front photo; once the day's tries are spent, or while the face service
/// is down, the punch can go to the manager instead. Null when closed.
class FaceSetupScreen extends StatefulWidget {
  const FaceSetupScreen({
    super.key,
    required this.api,
    this.type = 'in',
    this.readLocation,
    this.onboarding = false,
    this.place,
    this.punch,
  });

  final ManagerApiService api;

  /// 'in' or 'out': the punch this setup is for.
  final String type;

  /// Where the phone is, for a punch sent to the manager. Optional.
  final Future<PunchReading> Function()? readLocation;

  /// Set up during onboarding, with no punch to make.
  final bool onboarding;

  /// The punch screen's location check, run while the camera warms up.
  final Future<FacePlace>? place;

  /// The punch, made with the setup's token; null hands the token back.
  final FacePunch? punch;

  /// How long an answer stays on the camera before it looks again.
  static Duration failPause = const Duration(seconds: 2);

  @override
  State<FaceSetupScreen> createState() => _FaceSetupScreenState();
}

class _FaceSetupScreenState extends State<FaceSetupScreen> with WidgetsBindingObserver {
  final FaceCamera _camera = FaceCamera.create();
  FaceIdStatus? _status;
  FaceConsent? _consent;
  String? _loadProblem;
  bool _agreed = false;
  bool _consentChanged = false;

  Future<String?>? _challenge;

  /// The photos taken so far: the front one, then the turned ones.
  final List<FaceBurst> _photos = [];

  bool _sending = false;
  (String, String?)? _answer;
  bool _fallbackOpen = false;
  String? _fallbackLine;
  bool _sendingFallback = false;

  /// Set up; with the punch time when a punch was made from here.
  bool _done = false;
  DateTime? _punchedAt;
  String? _token;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _camera
      ..addListener(_changed)
      ..onTryEnded = ((summary) => unawaited(widget.api.logFaceTry(summary)))
      ..onNewTry = _newChallenge
      ..onBurst = _onBurst
      ..pose = FacePose.front;
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() => _loadProblem = null);
    try {
      final status = await widget.api.fetchFaceStatus();
      if (!mounted) return;
      setState(() {
        _status = status;
        _consent = status.consent;
        if (status.fallbackAvailable && !widget.onboarding) _openFallback(null);
      });
    } on ManagerApiException catch (error) {
      if (mounted) setState(() => _loadProblem = error.offline ? 'No internet connection. Connect and try again.' : error.message);
    } catch (_) {
      if (mounted) setState(() => _loadProblem = "The face check couldn't be loaded. Try again.");
    }
  }

  void _newChallenge() {
    _challenge = widget.api.startFaceChallenge().catchError((Object _) => null);
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  void _agree() {
    setState(() {
      _agreed = true;
      _consentChanged = false;
    });
    unawaited(_camera.start());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!_agreed || _done) return;
    if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      unawaited(_camera.pause());
    } else if (state == AppLifecycleState.resumed && !_camera.ready && !_sending) {
      // Back at the photo being taken, with the ones already taken kept.
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

  /// A photo taken: the ring fills a third, a tap of haptic, and the next
  /// pose; after the third, the setup goes to the server.
  void _onBurst(FaceBurst burst) {
    if (!mounted || _sending) return;
    unawaited(FaceSounds.step());
    setState(() => _photos.add(burst));
    switch (_photos.length) {
      case 1:
        _camera.nextPose(FacePose.turnA);
      case 2:
        _camera.nextPose(FacePose.turnB);
      default:
        unawaited(_enrol());
    }
  }

  Future<void> _enrol() async {
    final consent = _consent;
    if (consent == null || _photos.length < 3) return;
    setState(() => _sending = true);
    try {
      final challengeId = await (_challenge ?? Future<String?>.value()).timeout(const Duration(seconds: 6), onTimeout: () => null);
      final token = await widget.api.enrolFace(
        front: _photos[0],
        turned: _photos.sublist(1, 3),
        consentVersion: consent.version,
        challengeId: challengeId,
      );
      FaceCheckOutcome.enrolledThisRun = true;
      _token = token;
      DateTime? at;
      final punch = widget.punch;
      if (punch != null && token != null && _status?.liveness.aws != true) {
        try {
          at = await punch(token);
        } catch (_) {
          at = null;
        }
        if (!mounted) return;
        if (at == null) {
          // The punch screen has taken over (outside the office, say).
          Navigator.of(context).pop(FaceCheckOutcome.passed(token));
          return;
        }
      }
      if (!mounted) return;
      unawaited(FaceSounds.done());
      unawaited(_camera.pause());
      setState(() {
        _done = true;
        _punchedAt = at;
      });
    } on ManagerApiException catch (error) {
      _refused(error);
    } catch (_) {
      _again("The face check can't be set up right now", 'Try again in a few minutes.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _refused(ManagerApiException error) {
    if (!mounted) return;
    final face = error.details?['face'];
    final reason = face is Map ? face['reason'] as String? : null;
    if (reason == 'already_enrolled') {
      // Set up already (on another phone, or before this profile was read):
      // nothing to set up, so the punch takes the daily check.
      FaceCheckOutcome.enrolledThisRun = true;
      Navigator.of(context).pop(const FaceCheckOutcome.needsCheck());
      return;
    }
    if (reason == 'consent_changed' && face is Map && face['consent'] is Map<String, dynamic>) {
      // The line changed since it was shown: agree to the new one first.
      unawaited(_camera.pause());
      setState(() {
        _consent = FaceConsent.fromJson(face['consent'] as Map<String, dynamic>);
        _agreed = false;
        _consentChanged = true;
        _photos.clear();
        _camera.pose = FacePose.front;
      });
      return;
    }
    unawaited(FaceSounds.failed());
    if (face is Map && face['fallback'] == true && !widget.onboarding) {
      setState(() => _openFallback(reason));
      return;
    }
    if (error.offline) {
      _again('No internet connection', 'Connect and try again.');
      return;
    }
    final result = FaceCheckResult(passed: false, reason: reason ?? 'not_a_match', message: error.message);
    if (reason == 'already_enrolled_elsewhere') {
      _again('This face is set up on another account', 'Ask HR to check.');
    } else if (result.inconclusive) {
      _again(result.title, null);
    } else {
      final left = face is Map && face['attemptsLeft'] is num ? (face['attemptsLeft'] as num).toInt() : null;
      _again("We couldn't confirm it's you", left == null ? null : '$left ${left == 1 ? 'try' : 'tries'} left today. Try again.');
    }
  }

  /// An answer on the camera for a moment, then setup again from the front photo.
  void _again(String headline, String? line) {
    if (!mounted) return;
    setState(() {
      _answer = (headline, line);
      _photos.clear();
    });
    _camera.hold();
    _timer?.cancel();
    _timer = Timer(FaceSetupScreen.failPause, () {
      if (!mounted || _fallbackOpen) return;
      setState(() => _answer = null);
      _camera.nextPose(FacePose.front);
    });
  }

  void _openFallback(String? reason) {
    _camera.hold();
    _fallbackOpen = true;
    final max = _status?.maxAttempts ?? 5;
    _fallbackLine = reason == 'unavailable' || reason == null && _status == null
        ? "Face check isn't available right now."
        : '$max of $max tries used today.';
  }

  Future<void> _sendFallback() async {
    if (_sendingFallback) return;
    setState(() => _sendingFallback = true);
    PunchReading? reading;
    try {
      reading = await widget.readLocation?.call().timeout(const Duration(seconds: 12));
    } catch (_) {}
    try {
      await widget.api.requestFaceFallback(type: widget.type, reading: reading);
      if (mounted) Navigator.of(context).pop(const FaceCheckOutcome.fallbackSent());
    } on ManagerApiException catch (error) {
      if (mounted) setState(() => _fallbackLine = error.offline ? 'No internet connection. Connect and try again.' : error.message);
    } finally {
      if (mounted) setState(() => _sendingFallback = false);
    }
  }

  /// Done: back to the card with the punch made, or out of onboarding. A
  /// company on AWS Face Liveness still takes its own check for the punch.
  void _finish() {
    final navigator = Navigator.of(context);
    final at = _punchedAt;
    if (at != null) {
      navigator.pop(FaceCheckOutcome.punched(at));
    } else if (_token case final token? when !widget.onboarding && _status?.liveness.aws != true) {
      navigator.pop(FaceCheckOutcome.passed(token));
    } else {
      navigator.pop(const FaceCheckOutcome.needsCheck());
    }
  }

  void _close() => Navigator.of(context).pop();

  @override
  Widget build(BuildContext context) {
    final punchIn = widget.type != 'out';
    if (!_agreed) {
      return FaceSetupIntro(
        consent: _consent?.agree,
        problem: _loadProblem ?? (_consentChanged ? 'The consent has changed. Read it and agree again.' : null),
        onRetry: _loadProblem == null ? null : _load,
        onBack: _close,
        onStart: _consent == null ? null : _agree,
      );
    }
    if (_done) {
      final at = _punchedAt;
      return FaceSetupDone(
        line: at == null ? null : '${punchIn ? 'Punched in' : 'Punched out'} at ${clockOf(at)}',
        onDone: _finish,
      );
    }
    final taken = _photos.length;
    final ring = FaceRing.progress(taken / 3);
    final counter = '${(taken + 1).clamp(1, 3)} of 3';
    if (_fallbackOpen) {
      final manager = _status?.managerName;
      return FaceCameraView(
        headline: "We couldn't confirm it's you",
        line: _fallbackLine,
        camera: _camera.controller,
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
    final cameraProblem = _camera.cameraProblem;
    if (cameraProblem != null) {
      return FaceCameraView(
        headline: 'Camera not available',
        line: cameraProblem,
        counter: counter,
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
    final pose = _camera.pose;
    if (_sending) {
      headline = 'Checking…';
    } else if (_answer case (final h, final l)) {
      headline = h;
      line = l;
      tone = FaceHeadlineTone.fix;
    } else {
      (headline, line, tone) = faceCopy(_camera.problem, pose: pose);
    }
    return FaceCameraView(
      headline: headline,
      line: line,
      tone: tone,
      camera: _camera.controller,
      ring: ring,
      counter: counter,
      onClose: _sending ? null : _close,
      arrow: _sending || _answer != null
          ? null
          : switch (pose) {
              FacePose.turnA => FaceArrowSide.left,
              // The other side from the first turn, whichever that was.
              FacePose.turnB => _camera.firstTurnSign == -1 ? FaceArrowSide.left : FaceArrowSide.right,
              FacePose.front => null,
            },
      arrowPulse: _camera.turnSlow,
      steps: (taken, taken.clamp(0, 2)),
    );
  }
}
