import 'dart:async';
import 'dart:math';

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';

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

/// The phone's own live-person prompt, picked at random so a recording made
/// for one cannot answer another.
enum FaceChallenge {
  blink('blink', 'Blink once, then look at the camera.'),
  turnLeft('turn_left', 'Turn your head a little to your left, then back.'),
  turnRight('turn_right', 'Turn your head a little to your right, then back.');

  const FaceChallenge(this.key, this.prompt);
  final String key;
  final String prompt;
}

/// The front camera with ML Kit face detection on its preview frames.
///
/// What this stops, and what it does not: the prompt (blink, or turn your
/// head, chosen at random) defeats a printed photo or a still on another
/// screen held up to an unmodified app, because a still cannot blink or turn
/// on cue. It does not stop a video of the person that happens to do the
/// same, a good 3D mask, or a modified app that skips the prompt — the
/// result is only reported to the server and logged, never trusted. The
/// server's face match is what decides; Rekognition Face Liveness is the
/// stronger check, ready to switch on.
class FaceCamera extends ChangeNotifier {
  FaceCamera({Random? random})
    : challenge = FaceChallenge
          .values[(random ?? Random()).nextInt(FaceChallenge.values.length)];

  /// How the screens make one. Only a test replaces it, with a camera that
  /// needs no device.
  static FaceCamera Function() create = FaceCamera.new;

  /// How long the phone holds capture for its own face detection and prompt.
  /// Past it, capture unlocks and the server's match decides: a phone that
  /// cannot see a face in dim light, behind glasses or on a slow camera must
  /// not leave someone unable to punch, and the server's failed tries are
  /// what open sending the punch to the manager.
  static Duration patience = const Duration(seconds: 15);

  final FaceChallenge challenge;

  CameraController? _camera;
  CameraDescription? _description;
  FaceDetector? _detector;
  bool _processing = false;
  bool _disposed = false;

  FaceSignal signal = FaceSignal.starting;

  /// Set when the camera cannot be opened: no permission, or none at all.
  String? cameraProblem;
  bool permissionDenied = false;

  bool challengeDone = false;

  /// Detection gave up waiting (see [patience]); the screens read it as
  /// [FaceSignal.unavailable].
  bool waived = false;
  Timer? _patienceTimer;

  // The prompt's progress, for the face being tracked: a different face
  // starts it again, so one person cannot blink for another.
  int? _trackingId;
  int _stage = 0;

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
      await camera.initialize();
      if (_disposed) {
        await camera.dispose();
        return;
      }
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
          enableTracking: true,
          minFaceSize: 0.15,
          performanceMode: FaceDetectorMode.fast,
        ),
      );
      if (!camera.value.isStreamingImages)
        await camera.startImageStream(_onFrame);
      _patienceTimer ??= Timer(patience, () {
        if (_disposed || (signal == FaceSignal.detected && challengeDone))
          return;
        waived = true;
        _set(FaceSignal.unavailable);
      });
    } catch (_) {
      _set(FaceSignal.unavailable);
    }
  }

  Future<void> _onFrame(CameraImage image) async {
    if (_processing || _disposed || waived) return;
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
          .where((face) => face.boundingBox.width / shortSide >= 0.28)
          .toList();
      if (faces.length != 1 || near.length != 1) {
        _set(FaceSignal.notDetected);
        return;
      }
      _follow(near.first);
      _set(FaceSignal.detected);
    } on MissingPluginException {
      _set(FaceSignal.unavailable);
    } on PlatformException {
      // One bad frame is not the detector gone; the next frame tries again.
    } finally {
      _processing = false;
    }
  }

  void _follow(Face face) {
    if (challengeDone) return;
    if (face.trackingId != _trackingId) {
      _trackingId = face.trackingId;
      _stage = 0;
    }
    switch (challenge) {
      case FaceChallenge.blink:
        final left = face.leftEyeOpenProbability;
        final right = face.rightEyeOpenProbability;
        if (left == null || right == null) return;
        final open = left > 0.75 && right > 0.75;
        final shut = left < 0.25 && right < 0.25;
        // Open, then shut, then open again.
        if (_stage == 0 && open) _stage = 1;
        if (_stage == 1 && shut) _stage = 2;
        if (_stage == 2 && open) challengeDone = true;
      case FaceChallenge.turnLeft:
      case FaceChallenge.turnRight:
        // ML Kit's Y angle is positive when the face turns to the person's
        // own left (towards the right of the camera's picture).
        final yaw = face.headEulerAngleY;
        if (yaw == null) return;
        final turned = challenge == FaceChallenge.turnLeft
            ? yaw > 18
            : yaw < -18;
        if (_stage == 0 && yaw.abs() < 10) _stage = 1;
        if (_stage == 1 && turned) _stage = 2;
        if (_stage == 2 && yaw.abs() < 10) challengeDone = true;
    }
  }

  void _set(FaceSignal next) {
    // A frame still being read when detection gave up does not take it back.
    if (_disposed || (waived && next != FaceSignal.unavailable)) return;
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

  /// Takes the selfie. Detection pauses for it and starts again with [resume].
  Future<Uint8List?> capture() async {
    final camera = _camera;
    if (camera == null || !camera.value.isInitialized) return null;
    try {
      if (camera.value.isStreamingImages) await camera.stopImageStream();
      final file = await camera.takePicture();
      return await file.readAsBytes();
    } catch (_) {
      return null;
    }
  }

  /// After a failed check: look again, with the prompt still owed.
  Future<void> resume() async {
    _stage = 0;
    _trackingId = null;
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
    final camera = _camera;
    _camera = null;
    unawaited(camera?.dispose().catchError((_) {}));
    unawaited(_detector?.close().catchError((_) {}));
    super.dispose();
  }
}

/// Takes the selfie on its own: once the face is in the oval and the prompt
/// is done, and it has held there for [hold], [onCapture] runs — the same
/// capture the button makes, which stays as the way to take it by hand.
///
/// Once per try: a capture, automatic or by hand, spends it, and it comes
/// back only after the face has left the oval for [away] (a flicker of one
/// frame is not leaving), so a failed check is never retried on its own.
/// Never while detection is [FaceCamera.waived]: with no face to watch, the
/// button is the only way.
class FaceAutoCapture {
  FaceAutoCapture({required this.camera, required this.allowed, required this.onCapture});

  /// How long the face holds still before the selfie is taken.
  static Duration hold = const Duration(milliseconds: 700);

  /// How long the face is gone before the next try can be automatic.
  static Duration away = const Duration(milliseconds: 500);

  final FaceCamera camera;

  /// What the screen adds: not busy, consent agreed, and so on. Asked again
  /// when the hold ends.
  final bool Function() allowed;
  final VoidCallback onCapture;

  Timer? _hold;
  Timer? _away;
  bool _spent = false;
  bool _disposed = false;

  /// Whether the next capture will be taken without a tap.
  bool get armed => !_spent && !camera.waived;

  bool get _ready =>
      !_disposed && armed && camera.signal == FaceSignal.detected && camera.challengeDone && allowed();

  /// Call on every change to the camera or to [allowed]'s answer.
  void check() {
    if (_disposed) return;
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
      spend();
      onCapture();
    });
  }

  /// A capture has started, by hand or not: no automatic one until the face
  /// has left and come back.
  void spend() {
    _spent = true;
    _hold?.cancel();
    _hold = null;
  }

  void dispose() {
    _disposed = true;
    _hold?.cancel();
    _away?.cancel();
  }
}
