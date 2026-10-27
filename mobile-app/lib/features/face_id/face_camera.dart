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
/// Two checks of its own, [FaceRealness], say whether the face is a real
/// one before the selfie is taken; the server's match says whose it is.
class FaceCamera extends ChangeNotifier {
  FaceCamera({Random? random});

  /// How the screens make one. Only a test replaces it, with a camera that
  /// needs no device.
  static FaceCamera Function() create = FaceCamera.new;

  /// How long the phone keeps looking for a face it is happy with, from
  /// the camera opening and again from each failed try. Past it the screen
  /// says "Face not detected" and offers Try Again, which takes the selfie
  /// for the server to judge: a phone that cannot see a face in dim light,
  /// behind glasses or on a slow camera must not leave someone stuck.
  static Duration patience = const Duration(seconds: 3);

  CameraController? _camera;
  CameraDescription? _description;
  FaceDetector? _detector;
  bool _processing = false;
  bool _disposed = false;

  FaceSignal signal = FaceSignal.starting;

  /// Set when the camera cannot be opened: no permission, or none at all.
  String? cameraProblem;
  bool permissionDenied = false;

  /// The live prompt (blink or turn) is no longer asked: always done. Kept
  /// so the screens and the server's log read as before.
  bool challengeDone = true;

  /// The last frame a single, near face was seen in: the selfie is taken
  /// from it, silently, with no shutter sound or flash.
  _Frame? _lastFace;

  /// The phone's own two checks that the face is a real one, run while the
  /// face is in the oval and before the selfie; see [FaceRealness].
  final liveness = FaceRealness();

  /// Detection gave up waiting (see [patience]): the screens show "Face not
  /// detected" with Try Again, and a tap takes the selfie.
  bool waived = false;
  Timer? _patienceTimer;

  /// The next wait for a face, from now: after a failed try, or a tap.
  void waitAgain() {
    waived = false;
    _patienceTimer?.cancel();
    _patienceTimer = null;
    if (_disposed) return;
    _patienceTimer = Timer(patience, _giveUp);
  }

  void _giveUp() {
    if (_disposed) return;
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
          .where((face) => face.boundingBox.width / shortSide >= 0.28)
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
  /// off. Detection pauses for it and starts again with [resume].
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
        if (jpeg != null && await _hasUprightFace(jpeg)) return jpeg;
      } catch (_) {
        // Fall back to a photo.
      }
    }
    try {
      final file = await camera.takePicture();
      return await file.readAsBytes();
    } catch (_) {
      return null;
    }
  }

  /// Whether the detector finds one face in [jpeg] as it stands, unrotated:
  /// the check that the frame was turned the right way up.
  Future<bool> _hasUprightFace(Uint8List jpeg) async {
    final detector = _detector;
    if (detector == null) return false;
    final file = File(
      '${Directory.systemTemp.path}/sowaka-face-${DateTime.now().microsecondsSinceEpoch}.jpg',
    );
    try {
      await file.writeAsBytes(jpeg, flush: true);
      final faces = await detector.processImage(
        InputImage.fromFilePath(file.path),
      );
      return faces.length == 1;
    } catch (_) {
      return false;
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

/// Takes the selfie on its own: once the face is in the oval and the prompt
/// is done, and it has held there for [hold], [onCapture] runs — the same
/// capture the button makes, which stays as the way to take it by hand.
///
/// Once per try: a capture, automatic or by hand, spends it, and it comes
/// back only after the face has left the oval for [away] (a flicker of one
/// frame is not leaving), so a failed check is never retried on its own.
/// Never while detection is [FaceCamera.waived]: with no face to watch, the
/// button is the only way.
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

/// Two checks, on the phone, that the face in the oval is a real one and not
/// a picture of one — each a first filter, not a wall; the server's match
/// still decides whose face it is.
///
/// Movement: a real face coming a little closer grows unevenly — the nose,
/// nearest the camera, spreads faster than the eyes behind it — while a flat
/// photo scales evenly. [moved] is set once the face has grown by
/// [growNeeded] and the nose-to-eyes ratio shifted by [parallaxNeeded].
///
/// Flash: the screen goes white for a moment ([FaceFlash]); a real face,
/// lit by it, brightens by at least [brightenNeeded]; a picture on another
/// screen, which makes its own light, does not. In bright light the flash is
/// too faint to see, so a face already brighter than [tooBright] skips it.
class FaceRealness {
  static double growNeeded = 0.12;
  static double parallaxNeeded = 0.035;
  static double brightenNeeded = 6;
  static double tooBright = 170;

  double? _width0, _ratio0;
  double _widthNow = 0, _ratioNow = 0;
  bool moved = false;

  double? _lumaBefore;
  double _lumaNow = 0;
  bool flashing = false;
  bool? lit;

  /// Whether the flash can tell anything here: not in bright light.
  bool get flashUseful => _lumaNow < tooBright;

  /// Whether both checks have passed, or been skipped for the light.
  bool get passed => moved && (lit == true || !flashUseful);

  /// What the line on the camera should ask for, or null once done.
  String? get ask => moved ? null : 'Move a little closer';

  void seeFace(Face face, double shortSide, double luma) {
    _lumaNow = luma;
    final eyeL = face.landmarks[FaceLandmarkType.leftEye]?.position;
    final eyeR = face.landmarks[FaceLandmarkType.rightEye]?.position;
    final nose = face.landmarks[FaceLandmarkType.noseBase]?.position;
    _widthNow = face.boundingBox.width / shortSide;
    if (eyeL != null && eyeR != null && nose != null) {
      final eyeMidX = (eyeL.x + eyeR.x) / 2, eyeMidY = (eyeL.y + eyeR.y) / 2;
      final eyes = sqrt(pow(eyeL.x - eyeR.x, 2) + pow(eyeL.y - eyeR.y, 2));
      final noseDrop = sqrt(
        pow(nose.x - eyeMidX, 2) + pow(nose.y - eyeMidY, 2),
      );
      _ratioNow = eyes == 0 ? 0 : noseDrop / eyes;
    }
    _width0 ??= _widthNow;
    _ratio0 ??= _ratioNow;
    if (!moved && _ratio0 != null) {
      final grew = _widthNow / _width0! - 1;
      final shifted = (_ratioNow - _ratio0!).abs();
      if (grew >= growNeeded && shifted >= parallaxNeeded) moved = true;
      // Moving away resets the baseline, so the next approach counts.
      if (grew < -0.05) {
        _width0 = _widthNow;
        _ratio0 = _ratioNow;
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
    _width0 = _ratio0 = null;
    moved = false;
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
      (!checkLiveness || camera.liveness.moved) &&
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
        camera._giveUp();
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
