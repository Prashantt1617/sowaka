import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:image/image.dart' as img;

import 'face_spoof_check.dart';

/// What the front camera sees, as far as the phone can tell.
enum FaceSignal {
  /// The camera or the detector has not answered yet.
  starting,

  /// No face, a face too small to be in the oval, or more than one.
  notDetected,

  /// One face, near enough to fill the oval.
  detected,

  /// This phone cannot detect faces (the web, a detector that failed to
  /// load). The server still checks the face; only the phone's prompt is lost.
  unavailable,
}

/// The front camera with ML Kit face detection on its preview frames.
///
/// Checks of its own, [FaceRealness], say whether the face is a real one
/// before the selfie is taken; the server's match says whose it is.
class FaceCamera extends ChangeNotifier {
  FaceCamera({Random? random});

  /// How the screens make one. Only a test replaces it, with a camera that
  /// needs no device.
  static FaceCamera Function() create = FaceCamera.new;

  /// How long the phone keeps looking for a face, from the camera opening,
  /// again from each failed try, and from the last frame a face was seen
  /// in. Past it the screen says "Face not detected" and offers Try Again,
  /// which looks again.
  static Duration patience = const Duration(seconds: 3);

  /// How long one try may take, from the camera opening or the last start
  /// over: the prompts, the light check and the selfie. Past it the camera
  /// says "Face not detected" for [lapsePause] and starts the prompts over
  /// on its own; a photo held in the oval, which never answers, cycles
  /// through this and never gets a selfie. There is no button to press.
  static Duration promptPatience = const Duration(seconds: 30);
  static Duration lapsePause = const Duration(milliseconds: 2200);

  /// How much of the frame's short side a face must span to count: near
  /// enough to read, not lined up in the oval. Where it stands does not
  /// matter, and the selfie is framed on it before it is sent ([cropToFace]).
  static double minFaceShare = 0.18;

  CameraController? _camera;
  CameraDescription? _description;
  FaceDetector? _detector;
  bool _processing = false;
  bool _disposed = false;

  FaceSignal signal = FaceSignal.starting;

  /// Set when the camera cannot be opened: no permission, or none at all.
  String? cameraProblem;
  bool permissionDenied = false;

  /// Whether the prompts may be skipped. Only a test's camera sets it false:
  /// the real one asks for the turn and the blink every time.
  bool challengeDone = true;

  /// The last frame a single, near face was seen in: the selfie is taken
  /// from it, silently, with no shutter sound or flash.
  FaceFrame? _lastFace;

  /// The phone's own checks that the face is a real one, run while the
  /// face is in the oval and before the selfie; see [FaceRealness].
  final liveness = FaceRealness();

  /// The screen detector ([FaceSpoofCheck]), loaded with the camera; null
  /// where it could not be, and then the gate stands open and says so.
  FaceSpoofCheck? _spoof;
  bool _spoofBusy = false;
  DateTime? _lastSpoofAt;

  /// Its answers for this try, one a frame while the face holds still once
  /// the prompts are done, up to [FaceSpoofCheck.samples].
  final List<double> spoofScores = [];

  /// Null until enough frames have been read; then whether they looked like
  /// a face rather than a screen. True where there is no detector.
  bool? get spoofVerdict {
    if (_spoof == null) return true;
    if (spoofScores.length < FaceSpoofCheck.samples) return null;
    return spoofScores.reduce((a, b) => a + b) / spoofScores.length >= FaceSpoofCheck.threshold;
  }

  /// What the phone measured this try, for the server's log: the flashes,
  /// and the screen detector's mean ("r+5.1/-2.0 b+6.2/+0.3 s0.83", or "sNA").
  String get checkReport {
    final mean = spoofScores.isEmpty
        ? null
        : (spoofScores.reduce((a, b) => a + b) / spoofScores.length).toStringAsFixed(2);
    return '${liveness.report} s${_spoof == null ? 'NA' : (mean ?? '-')}'.trim();
  }

  /// The prompts and the detector from the start of a try.
  void startOver() {
    liveness.reset();
    spoofScores.clear();
    _spoofBusy = false;
  }

  /// The detector saw a screen or a print: said, and the try starts over.
  void screenSuspected() {
    if (_disposed) return;
    startOver();
    final now = DateTime.now();
    _tryStartedAt = now;
    nudge = 'Please use your face, not a photo or a screen';
    _nudgeUntil = now.add(const Duration(seconds: 3));
    notifyListeners();
  }

  /// Detection gave up waiting (see [patience] and [promptPatience]): the
  /// screens show "Face not detected" with Try Again, which looks again.
  bool waived = false;

  /// The camera never gives up: after a try's [promptPatience] it says so
  /// ([lapsed]) and starts the prompts over, until the selfie is taken or
  /// the person leaves. Only a test's camera turns this off to drive the
  /// old give-up path.
  bool keepGoing = true;

  /// A try ran out of time: "Face not detected" is on the camera for
  /// [lapsePause], then the prompts start over.
  bool lapsed = false;
  Timer? _lapseTimer;
  DateTime? _tryStartedAt;

  /// A short word from the camera after a restart ("Let's go again", "Move
  /// out of the bright light"), shown instead of the prompt until [_nudgeUntil].
  String? nudge;
  DateTime? _nudgeUntil;
  String? get nudgeNow =>
      nudge != null && _nudgeUntil != null && DateTime.now().isBefore(_nudgeUntil!) ? nudge : null;

  /// The light check failed [fails] times running: start over, with a word
  /// about the light after the second time. The daily check gives up.
  void lightNotTaken(int fails) {
    if (_disposed) return;
    if (!keepGoing) {
      giveUpNow();
      return;
    }
    startOver();
    final now = DateTime.now();
    _firstSeen = now;
    nudge = fails >= 2
        ? 'Move out of the bright light and face the camera'
        : 'Let\u2019s check the light again';
    _nudgeUntil = now.add(const Duration(seconds: 2));
    notifyListeners();
  }
  Timer? _patienceTimer;
  DateTime? _lastSeen;
  DateTime? _firstSeen;

  /// The next wait for a face, from now: after a failed try, or a tap.
  void waitAgain() {
    waived = false;
    lapsed = false;
    spoofScores.clear();
    _spoofBusy = false;
    _lapseTimer?.cancel();
    _lapseTimer = null;
    _lastSeen = null;
    _firstSeen = null;
    _tryStartedAt = DateTime.now();
    _patienceTimer?.cancel();
    _patienceTimer = null;
    if (_disposed) return;
    _patienceTimer = Timer(patience, _giveUp);
  }

  void _giveUp() {
    if (_disposed) return;
    _patienceTimer = null;
    if (keepGoing) {
      // No face for a while is not the end: the line keeps asking, and only
      // a whole try's worth of time without a selfie starts it over.
      if (_tryOverdue()) {
        _lapse();
      } else {
        _patienceTimer = Timer(patience, _giveUp);
      }
      return;
    }
    final seen = _lastSeen;
    if (seen != null && !waived) {
      // A face is being watched: the wait is from the last frame it was in.
      final since = DateTime.now().difference(seen);
      if (since < patience) {
        _patienceTimer = Timer(patience - since, _giveUp);
        return;
      }
    }
    giveUpNow();
  }

  bool _tryOverdue() {
    final started = _tryStartedAt;
    return started != null && DateTime.now().difference(started) >= promptPatience;
  }

  /// The try ran out of time: "Face not detected" for [lapsePause], then over
  /// again from the first prompt.
  void _lapse() {
    if (_disposed || lapsed) return;
    lapsed = true;
    nudge = null;
    notifyListeners();
    _lapseTimer = Timer(lapsePause, () {
      if (_disposed) return;
      startOver();
      waitAgain();
      notifyListeners();
    });
  }

  /// Stop looking this try: the flash found no real face, or the prompts
  /// went unanswered.
  void giveUpNow() {
    if (_disposed || waived) return;
    _patienceTimer?.cancel();
    _patienceTimer = null;
    waived = true;
    notifyListeners();
  }

  CameraController? get controller => _camera;
  bool get ready => _camera?.value.isInitialized == true;

  Future<void> start() async {
    if (_disposed) return;
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty)
        throw CameraException('NoCamera', 'No camera on this device');
      final front = cameras.firstWhere(
        (camera) => camera.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );
      _description = front;
      final camera = CameraController(
        front,
        // 720p: plenty for a face filling the oval, and a selfie of a few
        // hundred kilobytes to send.
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: defaultTargetPlatform == TargetPlatform.iOS
            ? ImageFormatGroup.bgra8888
            : ImageFormatGroup.nv21,
      );
      _camera = camera;
      _spoof ??= await FaceSpoofCheck.load();
      await camera.initialize();
      if (_disposed) {
        await camera.dispose();
        return;
      }
      // Never the flash: the selfie is a frame of the preview, and the
      // fallback photo must not light up the room either.
      await camera.setFlashMode(FlashMode.off).catchError((_) {});
      cameraProblem = null;
      permissionDenied = false;
      notifyListeners();
      await _startDetecting();
    } on CameraException catch (error) {
      permissionDenied =
          error.code.contains('AccessDenied') ||
          error.code.contains('Restricted');
      cameraProblem = permissionDenied
          ? 'Allow camera access in Settings to check your face.'
          : 'The camera could not be opened. Close other apps using it and try again.';
      notifyListeners();
    } catch (_) {
      cameraProblem = 'The camera could not be opened. Try again.';
      notifyListeners();
    }
  }

  Future<void> _startDetecting() async {
    final camera = _camera;
    if (camera == null || kIsWeb) {
      _set(FaceSignal.unavailable);
      return;
    }
    try {
      _detector ??= FaceDetector(
        options: FaceDetectorOptions(
          enableClassification: true,
          enableLandmarks: true,
          enableTracking: true,
          minFaceSize: 0.15,
          performanceMode: FaceDetectorMode.fast,
        ),
      );
      if (!camera.value.isStreamingImages)
        await camera.startImageStream(_onFrame);
      _patienceTimer ??= Timer(patience, _giveUp);
    } catch (_) {
      _set(FaceSignal.unavailable);
    }
  }

  Future<void> _onFrame(CameraImage image) async {
    if (_processing || _disposed) return;
    _processing = true;
    try {
      final input = _inputImage(image);
      if (input == null) {
        _set(FaceSignal.unavailable);
        return;
      }
      final faces = await _detector!.processImage(input);
      final shortSide = min(image.width, image.height).toDouble();
      final near = faces
          .where((face) => face.boundingBox.width / shortSide >= minFaceShare)
          .toList();
      if (faces.length != 1 || near.length != 1) {
        _set(FaceSignal.notDetected);
        return;
      }
      _lastFace = FaceFrame.of(image, input.metadata?.rotation.rawValue ?? 0);
      liveness.seeFace(near.first, shortSide, _faceLight(image));
      _sampleSpoof(near.first.boundingBox);
      final now = DateTime.now();
      _lastSeen = now;
      _firstSeen ??= now;
      if (lapsed) return;
      if (!liveness.challengesDone &&
          (keepGoing ? _tryOverdue() : now.difference(_firstSeen!) >= promptPatience)) {
        // Seen all this time and never answered the prompts: not a face the
        // phone will vouch for. Said, then the prompts start over.
        if (keepGoing) {
          _lapse();
        } else {
          giveUpNow();
        }
        return;
      }
      _set(FaceSignal.detected);
    } on MissingPluginException {
      _set(FaceSignal.unavailable);
    } on PlatformException {
      // One bad frame is not the detector gone; the next frame tries again.
    } finally {
      _processing = false;
    }
  }

  /// Once the prompts are answered: a few frames to the screen detector,
  /// spaced out, each read off the UI thread; the auto capture waits on them.
  void _sampleSpoof(Rect face) {
    final spoof = _spoof;
    final frame = _lastFace;
    if (spoof == null || frame == null || _spoofBusy || lapsed) return;
    if (!liveness.challengesDone || spoofScores.length >= FaceSpoofCheck.samples) return;
    final now = DateTime.now();
    if (_lastSpoofAt != null && now.difference(_lastSpoofAt!) < const Duration(milliseconds: 150)) return;
    _spoofBusy = true;
    _lastSpoofAt = now;
    unawaited(spoof.realProbability(frame, face).then((score) {
      _spoofBusy = false;
      if (_disposed || score == null) return;
      spoofScores.add(score);
      notifyListeners();
    }).catchError((Object _) {
      _spoofBusy = false;
    }));
  }

  void _set(FaceSignal next) {
    if (_disposed) return;
    signal = next;
    notifyListeners();
  }

  InputImage? _inputImage(CameraImage image) {
    final description = _description;
    final camera = _camera;
    if (description == null || camera == null) return null;
    final sensor = description.sensorOrientation;
    InputImageRotation? rotation;
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      rotation = InputImageRotationValue.fromRawValue(sensor);
    } else {
      const turns = {
        DeviceOrientation.portraitUp: 0,
        DeviceOrientation.landscapeLeft: 90,
        DeviceOrientation.portraitDown: 180,
        DeviceOrientation.landscapeRight: 270,
      };
      final device = turns[camera.value.deviceOrientation] ?? 0;
      rotation = InputImageRotationValue.fromRawValue(
        description.lensDirection == CameraLensDirection.front
            ? (sensor + device) % 360
            : (sensor - device + 360) % 360,
      );
    }
    final format = InputImageFormatValue.fromRawValue(image.format.raw);
    if (rotation == null || format == null || image.planes.length != 1)
      return null;
    final plane = image.planes.first;
    return InputImage.fromBytes(
      bytes: plane.bytes,
      metadata: InputImageMetadata(
        size: Size(image.width.toDouble(), image.height.toDouble()),
        rotation: rotation,
        format: format,
        bytesPerRow: plane.bytesPerRow,
      ),
    );
  }

  /// Takes the selfie, silently: the last frame the face was seen in, turned
  /// upright and saved as a JPEG, so there is no shutter sound and no flash.
  /// That frame is checked for an upright face first; if it has none (an
  /// orientation this phone reports oddly), a photo is taken instead, flash
  /// off. Either way the picture is then framed on the face found in it
  /// ([cropToFace]): the face fills the selfie wherever the person stood, so
  /// someone a step back or off to one side is not refused for it. Detection
  /// pauses for it and starts again with [resume].
  Future<Uint8List?> capture() async {
    final camera = _camera;
    if (camera == null || !camera.value.isInitialized) return null;
    final frame = _lastFace;
    try {
      if (camera.value.isStreamingImages) await camera.stopImageStream();
    } catch (_) {
      // Already stopped.
    }
    if (frame != null) {
      try {
        final jpeg = await compute(_frameToJpeg, frame);
        final box = jpeg == null ? null : await _uprightFace(jpeg);
        if (jpeg != null && box != null) return await _framed(jpeg, box);
      } catch (_) {
        // Fall back to a photo.
      }
    }
    try {
      final file = await camera.takePicture();
      final photo = await file.readAsBytes();
      final box = await _uprightFace(photo);
      return box == null ? photo : await _framed(photo, box);
    } catch (_) {
      return null;
    }
  }

  /// [jpeg] cropped to [face], off the UI thread; as it was if that fails.
  Future<Uint8List> _framed(Uint8List jpeg, Rect face) async {
    try {
      return await compute<(Uint8List, Rect), Uint8List?>(_cropJob, (jpeg, face)) ?? jpeg;
    } catch (_) {
      return jpeg;
    }
  }

  /// The one face the detector finds in [jpeg] as it stands, unrotated (the
  /// check that the frame was turned the right way up), or null.
  Future<Rect?> _uprightFace(Uint8List jpeg) async {
    final detector = _detector;
    if (detector == null) return null;
    final file = File(
      '${Directory.systemTemp.path}/sowaka-face-${DateTime.now().microsecondsSinceEpoch}.jpg',
    );
    try {
      await file.writeAsBytes(jpeg, flush: true);
      final faces = await detector.processImage(
        InputImage.fromFilePath(file.path),
      );
      return faces.length == 1 ? faces.first.boundingBox : null;
    } catch (_) {
      return null;
    } finally {
      unawaited(file.delete().catchError((_) => file));
    }
  }

  /// Holds the camera's exposure where it is for the light check, so the
  /// colours on the screen change the picture rather than the camera's
  /// settings: with exposure free to adapt, a flash is half cancelled before
  /// it is read. Best effort; a camera that cannot lock just reads as it is.
  Future<void> lockExposure() async {
    try {
      await _camera?.setExposureMode(ExposureMode.locked);
    } catch (_) {}
  }

  Future<void> freeExposure() async {
    try {
      await _camera?.setExposureMode(ExposureMode.auto);
    } catch (_) {}
  }

  /// After a failed check: look again.
  Future<void> resume() async {
    _lastFace = null;
    startOver();
    waitAgain();
    _set(FaceSignal.starting);
    await _startDetecting();
  }

  /// The app went to the background: the camera is let go, as the plugin asks.
  Future<void> pause() async {
    final camera = _camera;
    _camera = null;
    signal = FaceSignal.starting;
    if (camera != null) await camera.dispose().catchError((_) {});
  }

  @override
  void dispose() {
    _disposed = true;
    _patienceTimer?.cancel();
    _lapseTimer?.cancel();
    final camera = _camera;
    _camera = null;
    unawaited(camera?.dispose().catchError((_) {}));
    unawaited(_detector?.close().catchError((_) {}));
    _spoof?.close();
    super.dispose();
  }
}

/// Takes the selfie on its own: once the face is in the oval, the prompts
/// are answered and it has held there for [hold], the flash runs and
/// [onCapture] follows. A tap never takes it instead: that would let a photo
/// skip the checks.
///
/// Once per try: a capture, automatic or by hand, spends it, and it comes
/// back only after the face has left the oval for [away] (a flicker of one
/// frame is not leaving), so a failed check is never retried on its own.
/// Never while detection is [FaceCamera.waived]: there is nothing to take.
///
/// The light on the face, read from the middle of the frame: the mean luma
/// and the mean chroma (Cb, Cr). The oval sits mid-frame, so a mid-frame
/// sample is close enough, and the frame is the sensor's, unrotated. On an
/// NV21 frame the Y plane comes first, then V and U interleaved at half
/// size; on BGRA the three channels are read straight.
class FaceLight {
  const FaceLight(this.luma, this.cb, this.cr);
  final double luma;
  final double cb;
  final double cr;
  static const none = FaceLight(0, 128, 128);
}

FaceLight _faceLight(CameraImage image) {
  final plane = image.planes.first;
  final bytes = plane.bytes;
  final bgra = defaultTargetPlatform == TargetPlatform.iOS;
  final x0 = (image.width * 0.3).round(), x1 = (image.width * 0.7).round();
  final y0 = (image.height * 0.3).round(), y1 = (image.height * 0.7).round();
  var luma = 0.0, cb = 0.0, cr = 0.0;
  var n = 0;
  if (bgra) {
    for (var y = y0; y < y1; y += 4) {
      final row = y * plane.bytesPerRow;
      for (var x = x0; x < x1; x += 4) {
        final at = row + x * 4;
        if (at + 2 >= bytes.length) break;
        final b = bytes[at], g = bytes[at + 1], r = bytes[at + 2];
        luma += 0.299 * r + 0.587 * g + 0.114 * b;
        cb += 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        cr += 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        n++;
      }
    }
  } else {
    final uv = plane.bytesPerRow * image.height;
    for (var y = y0; y < y1; y += 4) {
      final row = y * plane.bytesPerRow;
      final uvRow = uv + (y >> 1) * plane.bytesPerRow;
      for (var x = x0; x < x1; x += 4) {
        final at = row + x;
        final uvAt = uvRow + (x & ~1);
        if (at >= bytes.length || uvAt + 1 >= bytes.length) break;
        luma += bytes[at];
        cr += bytes[uvAt];
        cb += bytes[uvAt + 1];
        n++;
      }
    }
  }
  return n == 0 ? FaceLight.none : FaceLight(luma / n, cb / n, cr / n);
}

/// A colour the screen flashes for the light check.
enum FlashColour {
  red(Color(0xFFFF2A2A)),
  green(Color(0xFF2AFF4A)),
  blue(Color(0xFF2A5CFF));

  const FlashColour(this.color);
  final Color color;
}

/// The phone's own checks that the face in the oval is a real one and not a
/// picture or a video of one — each a first filter, not a wall; the server's
/// match still decides whose face it is.
///
/// Three prompts, in order, with the words the screen shows:
///  1. "Turn your head to one side" — a real nose, nearer the camera
///     than the eyes, swings along the eye line as the head turns; a flat
///     photo turned the same way keeps nose and eyes in step. [turned] once
///     ML Kit's yaw has swung [turnDegrees] and the nose has moved
///     [noseShiftNeeded] of the eye distance.
///  2. "Now face the camera" — back within [facedWithin] degrees,
///     so the blink and the selfie are taken front on.
///  3. "Blink now" — ML Kit's eye-open probabilities fall under
///     [closedBelow] and come back over [openAbove], after the prompt.
///
/// Then the light check, which a recording cannot answer: the screen flashes
/// two colours picked at random each time (red, green or blue), and the
/// face must reflect each one — its chroma shifts towards the colour by
/// [chromaNeeded] and it brightens a little ([brightenNeeded]). A video on
/// another screen makes its own light and does not take ours; a recording
/// of someone answering an earlier flash answers the wrong colours. Never
/// skipped: in light too bright to measure the check fails and the person
/// is asked to move, rather than let through.
class FaceRealness {
  FaceRealness({Random? random}) : _random = random ?? Random();

  static double turnDegrees = 12;
  static double noseShiftNeeded = 0.06;
  static double facedWithin = 7;
  static double closedBelow = 0.3;
  static double openAbove = 0.6;
  static double chromaNeeded = 3.0;
  static double brightenNeeded = 2.0;

  final Random _random;

  double? _yaw0, _offset0;
  bool turned = false;
  bool faced = false;
  bool _eyesClosed = false;
  bool blinked = false;

  /// The two colours this try flashes, picked afresh on every [reset].
  late List<FlashColour> colours = _pick();

  FaceLight _light = FaceLight.none;
  FaceLight? _before;
  bool flashing = false;

  /// One answer per colour, in order; null until that flash has been judged.
  final List<bool?> litBy = [null, null];

  /// What the flashes measured, for the server's log ("r+5.1/-2.0 b+6.2/+0.3").
  String report = '';

  List<FlashColour> _pick() {
    final all = [...FlashColour.values]..shuffle(_random);
    return all.take(2).toList();
  }

  /// Whether the three prompts have been answered: the light check waits on them.
  bool get challengesDone => turned && faced && blinked;

  /// Whether every check has passed: the prompts, and the face took the light.
  bool get passed => challengesDone && lit == true;

  /// Whether the light check is done, and how it went.
  bool get flashesDone => litBy.every((answer) => answer != null);
  bool? get lit => flashesDone ? litBy.every((answer) => answer == true) : null;

  /// Which prompt is being answered, 0 to 3 (3: all done), for the dots.
  int get step => !turned ? 0 : !faced ? 1 : !blinked ? 2 : 3;
  static const steps = 3;

  /// What the line on the camera should ask for, or null once done.
  String? get ask => !turned
      ? 'Turn your head to one side'
      : !faced
      ? 'Now face the camera'
      : !blinked
      ? 'Blink now'
      : null;

  void seeFace(Face face, double shortSide, FaceLight light) {
    _light = light;
    final yaw = face.headEulerAngleY;
    final eyeL = face.landmarks[FaceLandmarkType.leftEye]?.position;
    final eyeR = face.landmarks[FaceLandmarkType.rightEye]?.position;
    final nose = face.landmarks[FaceLandmarkType.noseBase]?.position;
    if (yaw != null && eyeL != null && eyeR != null && nose != null) {
      final eyes = sqrt(pow(eyeL.x - eyeR.x, 2) + pow(eyeL.y - eyeR.y, 2));
      if (eyes > 0) {
        final offset = (nose.x - (eyeL.x + eyeR.x) / 2) / eyes;
        _yaw0 ??= yaw;
        _offset0 ??= offset;
        if (!turned) {
          final swung = (yaw - _yaw0!).abs();
          final shifted = (offset - _offset0!).abs();
          if (swung >= turnDegrees && shifted >= noseShiftNeeded) turned = true;
        } else if (!faced && (yaw - _yaw0!).abs() <= facedWithin) {
          faced = true;
        }
      }
    }
    // The blink counts only once asked for, front on: a blink during the
    // turn is not an answer to "Blink now".
    final left = face.leftEyeOpenProbability;
    final right = face.rightEyeOpenProbability;
    if (faced && !blinked && (left != null || right != null)) {
      final open = min(left ?? 1, right ?? 1);
      if (open <= closedBelow) {
        _eyesClosed = true;
      } else if (_eyesClosed && open >= openAbove) {
        blinked = true;
      }
    }
  }

  /// The screen has gone [colours] number [index]: what the face looked like
  /// just before is kept to compare against.
  void flashOn(int index) {
    flashing = true;
    _before = _light;
  }

  /// The screen is back to normal: judge colour [index] from the lit frames.
  /// [lit] is the light measured while the colour was up.
  void flashOff(int index, FaceLight lit) {
    flashing = false;
    final before = _before ?? FaceLight.none;
    _before = null;
    litBy[index] = answers(colours[index], before, lit);
    final tag = colours[index].name[0];
    final dCb = (lit.cb - before.cb).toStringAsFixed(1);
    final dCr = (lit.cr - before.cr).toStringAsFixed(1);
    report = '${report.isEmpty ? '' : '$report '}$tag$dCb/$dCr';
  }

  /// Whether the face took the colour: its chroma moved the colour's way by
  /// [chromaNeeded], more that way than any other, and it brightened.
  static bool answers(FlashColour colour, FaceLight before, FaceLight lit) {
    final dCb = lit.cb - before.cb;
    final dCr = lit.cr - before.cr;
    final dL = lit.luma - before.luma;
    if (dL < brightenNeeded) return false;
    return switch (colour) {
      FlashColour.red => dCr >= chromaNeeded && dCr > dCb,
      FlashColour.blue => dCb >= chromaNeeded && dCb > dCr,
      FlashColour.green => dCb <= -chromaNeeded / 2 && dCr <= -chromaNeeded / 2,
    };
  }

  /// The light on the face right now.
  FaceLight get lightNow => _light;

  /// A test's camera has no frames: it says what the light is.
  @visibleForTesting
  void setLight(FaceLight light) => _light = light;

  /// A reading that answers [colour] after [before]: the face took it.
  @visibleForTesting
  static FaceLight answering(FlashColour colour, FaceLight before) => switch (colour) {
    FlashColour.red => FaceLight(before.luma + 6, before.cb - 1, before.cr + 6),
    FlashColour.green => FaceLight(before.luma + 6, before.cb - 4, before.cr - 4),
    FlashColour.blue => FaceLight(before.luma + 6, before.cb + 6, before.cr - 1),
  };

  void reset() {
    _yaw0 = _offset0 = null;
    turned = faced = blinked = false;
    _eyesClosed = false;
    _before = null;
    flashing = false;
    litBy[0] = litBy[1] = null;
    report = '';
    colours = _pick();
  }
}

class FaceAutoCapture {
  FaceAutoCapture({
    required this.camera,
    required this.allowed,
    required this.onCapture,
  });

  /// How long the face holds still, front on, before the light check.
  static Duration hold = const Duration(milliseconds: 700);

  /// How long each colour stays on the screen, and the pause between them
  /// for the camera's exposure to settle.
  static Duration flash = const Duration(milliseconds: 420);
  static Duration flashGap = const Duration(milliseconds: 260);

  /// Whether the phone's liveness checks gate the selfie. Off in tests
  /// that have no frames to feed them.
  static bool checkLiveness = true;

  /// The colour on the screen while a flash is up, else null: the layout draws it.
  final ValueNotifier<Color?> flashColour = ValueNotifier(null);

  /// How long the face is gone before the next try can be automatic.
  static Duration away = const Duration(milliseconds: 500);

  final FaceCamera camera;

  /// What the screen adds: not busy, consent agreed, and so on. Asked again
  /// when the hold ends.
  final bool Function() allowed;
  final VoidCallback onCapture;

  Timer? _hold;
  Timer? _away;
  Timer? _flashTimer;
  bool _spent = false;
  bool _disposed = false;

  /// Light checks failed in a row this try: after two, the line asks the
  /// person to move out of the light.
  int flashFails = 0;

  /// Whether the next capture will be taken without a tap.
  bool get armed => !_spent && !camera.waived && !camera.lapsed;

  bool get _ready =>
      !_disposed &&
      armed &&
      camera.signal == FaceSignal.detected &&
      camera.challengeDone &&
      (!checkLiveness || (camera.liveness.challengesDone && camera.spoofVerdict == true)) &&
      allowed();

  /// Call on every change to the camera or to [allowed]'s answer.
  void check() {
    if (_disposed || _flashTimer != null) return;
    if (checkLiveness && camera.spoofVerdict == false) {
      // A screen or a print in the oval: not a face to flash at.
      camera.screenSuspected();
      return;
    }
    if (camera.signal == FaceSignal.notDetected) {
      if (_spent) _away ??= Timer(away, () => _spent = false);
    } else {
      _away?.cancel();
      _away = null;
    }
    if (!_ready) {
      _hold?.cancel();
      _hold = null;
      return;
    }
    _hold ??= Timer(hold, () {
      _hold = null;
      if (!_ready) return;
      if (checkLiveness && camera.liveness.lit == null) {
        _runFlash(0);
        return;
      }
      spend();
      onCapture();
    });
  }

  /// Colour [index] on the screen for [flash], the face read under it, then
  /// the next colour after [flashGap]; after the last, the selfie if the
  /// face took both, else the try starts over.
  void _runFlash(int index) {
    final liveness = camera.liveness;
    if (index == 0) unawaited(camera.lockExposure());
    liveness.flashOn(index);
    flashColour.value = liveness.colours[index].color;
    _flashTimer = Timer(flash, () {
      flashColour.value = null;
      liveness.flashOff(index, liveness.lightNow);
      if (index + 1 >= liveness.colours.length) unawaited(camera.freeExposure());
      if (_disposed) return;
      if (index + 1 < liveness.colours.length) {
        _flashTimer = Timer(flashGap, () {
          _flashTimer = null;
          if (_disposed) return;
          if (camera.signal == FaceSignal.detected && !camera.waived) {
            _runFlash(index + 1);
          } else {
            camera.startOver();
            check();
          }
        });
        return;
      }
      _flashTimer = null;
      if (liveness.lit == true && _ready) {
        flashFails = 0;
        spend();
        onCapture();
      } else if (liveness.lit == false) {
        flashFails += 1;
        camera.lightNotTaken(flashFails);
      } else {
        camera.startOver();
        check();
      }
    });
  }

  /// A capture has started, by hand or not: no automatic one until the face
  /// has left and come back.
  void spend() {
    _spent = true;
    _hold?.cancel();
    _hold = null;
  }

  /// Try Again: the next capture may be automatic without the face leaving.
  void rearm() {
    _spent = false;
    _away?.cancel();
    _away = null;
  }

  /// Whether the last light check found no real face: the line says so.
  bool get flashFailed => checkLiveness && camera.liveness.lit == false;

  void dispose() {
    _disposed = true;
    _hold?.cancel();
    _away?.cancel();
    _flashTimer?.cancel();
    flashColour.dispose();
  }
}

/// One preview frame, copied out of the camera's buffer (which is reused for
/// the next frame), with the turn that makes it upright.
class FaceFrame {
  const FaceFrame({
    required this.bytes,
    required this.width,
    required this.height,
    required this.stride,
    required this.bgra,
    required this.rotation,
  });

  static FaceFrame? of(CameraImage image, int rotation) {
    if (image.planes.length != 1) return null;
    final plane = image.planes.first;
    return FaceFrame(
      bytes: Uint8List.fromList(plane.bytes),
      width: image.width,
      height: image.height,
      stride: plane.bytesPerRow,
      bgra: defaultTargetPlatform == TargetPlatform.iOS,
      rotation: rotation,
    );
  }

  final Uint8List bytes;
  final int width;
  final int height;
  final int stride;

  /// iOS sends BGRA; Android NV21 (a Y plane, then interleaved V and U).
  final bool bgra;
  final int rotation;
}

Uint8List? _cropJob((Uint8List, Rect) job) => cropToFace(job.$1, job.$2);

/// [jpeg] framed on [face] (a box in the picture's own upright pixels): a
/// square about twice the face's size, centred a little below the eyes so
/// the chin and hair stay in, kept inside the picture, at most 800 across.
/// The face then fills the selfie whatever the distance or the side the
/// person stood on. Null when there is nothing to gain (the face already
/// fills the picture) or the picture cannot be read.
@visibleForTesting
Uint8List? cropToFace(Uint8List jpeg, Rect face) {
  final decoded = img.decodeJpg(jpeg);
  if (decoded == null || face.isEmpty) return null;
  final picture = img.bakeOrientation(decoded);
  final shortSide = min(picture.width, picture.height).toDouble();
  var side = max(face.width, face.height) * 2.0;
  if (side >= shortSide * 0.95) return null;
  side = side.clamp(1.0, shortSide);
  final centreX = face.center.dx;
  final centreY = face.center.dy + face.height * 0.08;
  final left = (centreX - side / 2).clamp(0.0, picture.width - side);
  final top = (centreY - side / 2).clamp(0.0, picture.height - side);
  var cropped = img.copyCrop(
    picture,
    x: left.round(),
    y: top.round(),
    width: side.round(),
    height: side.round(),
  );
  if (cropped.width > 800) cropped = img.copyResize(cropped, width: 800, height: 800);
  return Uint8List.fromList(img.encodeJpg(cropped, quality: 90));
}

/// A frame as an upright JPEG, off the UI thread ([compute]). Null when the
/// frame is not in a shape this reads.
Uint8List? _frameToJpeg(FaceFrame f) {
  final picture = frameToImage(f);
  if (picture == null) return null;
  return Uint8List.fromList(img.encodeJpg(picture, quality: 88));
}

/// A frame as an upright picture. Null when the frame is not in a shape this reads.
img.Image? frameToImage(FaceFrame f) {
  img.Image picture;
  if (f.bgra) {
    picture = img.Image.fromBytes(
      width: f.width,
      height: f.height,
      bytes: f.bytes.buffer,
      rowStride: f.stride,
      numChannels: 4,
      order: img.ChannelOrder.bgra,
    );
  } else {
    final uv = f.stride * f.height;
    if (f.bytes.length < uv + f.stride * (f.height ~/ 2)) return null;
    picture = img.Image(width: f.width, height: f.height);
    for (var y = 0; y < f.height; y++) {
      final row = y * f.stride;
      final uvRow = uv + (y >> 1) * f.stride;
      for (var x = 0; x < f.width; x++) {
        final luma = f.bytes[row + x];
        final at = uvRow + (x & ~1);
        final v = f.bytes[at] - 128;
        final u = f.bytes[at + 1] - 128;
        picture.setPixelRgb(
          x,
          y,
          (luma + 1.402 * v).round().clamp(0, 255),
          (luma - 0.344136 * u - 0.714136 * v).round().clamp(0, 255),
          (luma + 1.772 * u).round().clamp(0, 255),
        );
      }
    }
  }
  if (f.rotation != 0) picture = img.copyRotate(picture, angle: f.rotation);
  return picture;
}
