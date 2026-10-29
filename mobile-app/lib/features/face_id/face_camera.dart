import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:image/image.dart' as img;

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

  /// How long a face that is seen has to turn and blink ([FaceRealness])
  /// before the phone gives up on it the same way: a photo held in the oval
  /// never does either, and must not sit there forever.
  static Duration promptPatience = const Duration(seconds: 10);

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
  _Frame? _lastFace;

  /// The phone's own checks that the face is a real one, run while the
  /// face is in the oval and before the selfie; see [FaceRealness].
  final liveness = FaceRealness();

  /// Detection gave up waiting (see [patience] and [promptPatience]): the
  /// screens show "Face not detected" with Try Again, which looks again.
  bool waived = false;
  Timer? _patienceTimer;
  DateTime? _lastSeen;
  DateTime? _firstSeen;

  /// The next wait for a face, from now: after a failed try, or a tap.
  void waitAgain() {
    waived = false;
    _lastSeen = null;
    _firstSeen = null;
    _patienceTimer?.cancel();
    _patienceTimer = null;
    if (_disposed) return;
    _patienceTimer = Timer(patience, _giveUp);
  }

  void _giveUp() {
    if (_disposed) return;
    _patienceTimer = null;
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
      _lastFace = _Frame.of(image, input.metadata?.rotation.rawValue ?? 0);
      liveness.seeFace(
        near.first,
        shortSide,
        _faceBrightness(image, near.first),
      );
      final now = DateTime.now();
      _lastSeen = now;
      _firstSeen ??= now;
      if (!liveness.challengesDone &&
          now.difference(_firstSeen!) >= promptPatience) {
        // Seen all this time and never turned or blinked: not a face the
        // phone will vouch for.
        giveUpNow();
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

  /// After a failed check: look again.
  Future<void> resume() async {
    _lastFace = null;
    liveness.reset();
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
    final camera = _camera;
    _camera = null;
    unawaited(camera?.dispose().catchError((_) {}));
    unawaited(_detector?.close().catchError((_) {}));
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
/// The mean luma over the face's box, from the frame's Y plane (the first
/// bytes of an NV21 frame; the green channel of a BGRA one, which is close
/// enough): what the screen flash is measured against.
double _faceBrightness(CameraImage image, Face face) {
  final plane = image.planes.first;
  final bgra = defaultTargetPlatform == TargetPlatform.iOS;
  final box = face.boundingBox;
  // The frame is the sensor's, unrotated; the box is in the input's rotated
  // space. The oval sits mid-frame, so a mid-frame sample is close enough.
  final x0 = (image.width * 0.3).round(), x1 = (image.width * 0.7).round();
  final y0 = (image.height * 0.3).round(), y1 = (image.height * 0.7).round();
  var sum = 0, n = 0;
  for (var y = y0; y < y1; y += 4) {
    final row = y * plane.bytesPerRow;
    for (var x = x0; x < x1; x += 4) {
      final at = bgra ? row + x * 4 + 1 : row + x;
      if (at >= plane.bytes.length) break;
      sum += plane.bytes[at];
      n++;
    }
  }
  assert(box.width > 0);
  return n == 0 ? 0 : sum / n;
}

/// Three checks, on the phone, that the face in the oval is a real one and
/// not a picture of one — each a first filter, not a wall; the server's match
/// still decides whose face it is.
///
/// Turn: the line asks for a small turn of the head. On a real face the nose,
/// nearer the camera than the eyes, swings sideways against the eye line as
/// the head turns; on a flat photo turned the same way, nose and eyes shrink
/// together and their ratio never changes. [turned] is set once the head has
/// swung by [turnDegrees] (ML Kit's own yaw) and the nose moved along the eye
/// line by [noseShiftNeeded] of the distance between the eyes.
///
/// Blink: the line then asks for a blink. ML Kit's eye-open probabilities
/// fall under [closedBelow] and come back over [openAbove]; a photo never
/// closes its eyes. A blink counts whenever it comes, prompted or not.
///
/// Flash: the screen goes white for a moment ([FaceAutoCapture.flash]); a
/// real face, lit by it, brightens by at least [brightenNeeded]; a picture on
/// another screen, which makes its own light, does not. In bright light the
/// flash is too faint to see, so a face already brighter than [tooBright]
/// skips it.
class FaceRealness {
  static double turnDegrees = 12;
  static double noseShiftNeeded = 0.06;
  static double closedBelow = 0.3;
  static double openAbove = 0.6;
  static double brightenNeeded = 6;
  static double tooBright = 170;

  double? _yaw0, _offset0;
  bool turned = false;

  bool _eyesClosed = false;
  bool blinked = false;

  double? _lumaBefore;
  double _lumaNow = 0;
  bool flashing = false;
  bool? lit;

  /// Whether the flash can tell anything here: not in bright light.
  bool get flashUseful => _lumaNow < tooBright;

  /// Whether the two prompts have been answered: the selfie waits on them.
  bool get challengesDone => turned && blinked;

  /// Whether every check has passed, or been skipped for the light.
  bool get passed => challengesDone && (lit == true || !flashUseful);

  /// What the line on the camera should ask for, or null once done.
  String? get ask => !turned
      ? 'Turn your head a little to one side'
      : !blinked
      ? 'Blink your eye'
      : null;

  void seeFace(Face face, double shortSide, double luma) {
    _lumaNow = luma;
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
        }
      }
    }
    final left = face.leftEyeOpenProbability;
    final right = face.rightEyeOpenProbability;
    if (!blinked && (left != null || right != null)) {
      final open = min(left ?? 1, right ?? 1);
      if (open <= closedBelow) {
        _eyesClosed = true;
      } else if (_eyesClosed && open >= openAbove) {
        blinked = true;
      }
    }
    if (flashing) {
      _lumaBefore ??= luma;
    } else if (_lumaBefore != null && lit == null) {
      // The frame after the flash ended was lit by it on a real face.
      lit = luma - _lumaBefore! >= brightenNeeded;
      _lumaBefore = null;
    }
  }

  /// The screen is white: the next frames are the lit ones.
  void flashOn() {
    flashing = true;
    _lumaBefore = _lumaNow;
  }

  /// Back to normal: judge from what the lit frames showed.
  void flashOff(double litLuma) {
    flashing = false;
    if (_lumaBefore != null) {
      lit = litLuma - _lumaBefore! >= brightenNeeded;
      _lumaBefore = null;
    }
  }

  double get lumaNow => _lumaNow;

  void reset() {
    _yaw0 = _offset0 = null;
    turned = false;
    _eyesClosed = false;
    blinked = false;
    _lumaBefore = null;
    flashing = false;
    lit = null;
  }
}

class FaceAutoCapture {
  FaceAutoCapture({
    required this.camera,
    required this.allowed,
    required this.onCapture,
  });

  /// How long the face holds still before the selfie is taken.
  static Duration hold = const Duration(milliseconds: 700);

  /// How long the screen stays white for the flash check.
  static Duration flash = const Duration(milliseconds: 350);

  /// Whether the phone's liveness checks gate the selfie. Off in tests
  /// that have no frames to feed them.
  static bool checkLiveness = true;

  /// Set while the screen is white: the layout draws it.
  final ValueNotifier<bool> flashOnScreen = ValueNotifier(false);

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
      !_disposed &&
      armed &&
      camera.signal == FaceSignal.detected &&
      camera.challengeDone &&
      (!checkLiveness || camera.liveness.challengesDone) &&
      allowed();

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
      if (checkLiveness &&
          camera.liveness.flashUseful &&
          camera.liveness.lit == null) {
        _runFlash();
        return;
      }
      if (checkLiveness &&
          camera.liveness.flashUseful &&
          camera.liveness.lit == false) {
        // Did not light up: not taken on its own; the button is the way.
        spend();
        return;
      }
      spend();
      onCapture();
    });
  }

  /// The screen goes white for [flash], the face is read under it, and the
  /// selfie follows if it lit up.
  void _runFlash() {
    camera.liveness.flashOn();
    flashOnScreen.value = true;
    Timer(flash, () {
      flashOnScreen.value = false;
      camera.liveness.flashOff(camera.liveness.lumaNow);
      if (_disposed) return;
      if (_ready && camera.liveness.lit == true) {
        spend();
        onCapture();
      } else if (camera.liveness.lit == false) {
        spend();
        camera.giveUpNow();
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

  /// Whether the last flash found no real face: the line says so.
  bool get flashFailed => checkLiveness && camera.liveness.lit == false;

  void dispose() {
    _disposed = true;
    _hold?.cancel();
    _away?.cancel();
    flashOnScreen.dispose();
  }
}

/// One preview frame, copied out of the camera's buffer (which is reused for
/// the next frame), with the turn that makes it upright.
class _Frame {
  const _Frame({
    required this.bytes,
    required this.width,
    required this.height,
    required this.stride,
    required this.bgra,
    required this.rotation,
  });

  static _Frame? of(CameraImage image, int rotation) {
    if (image.planes.length != 1) return null;
    final plane = image.planes.first;
    return _Frame(
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
Uint8List? _frameToJpeg(_Frame f) {
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
  return Uint8List.fromList(img.encodeJpg(picture, quality: 88));
}
