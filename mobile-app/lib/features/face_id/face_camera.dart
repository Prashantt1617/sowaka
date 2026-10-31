import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:image/image.dart' as img;

import 'face_sounds.dart';
import 'face_spoof_check.dart';

/// What the front camera sees, as far as the phone can tell.
enum FaceSignal {
  /// The camera or the detector has not answered yet.
  starting,

  /// No face, or not one the gate passes.
  notDetected,

  /// One face the gate passes.
  detected,

  /// This phone cannot detect faces (the web, a detector that failed to
  /// load). The server still checks the face; the screen offers a button.
  unavailable,
}

/// What the camera asks the person to fix, one at a time. The screens hold
/// the words (the camera copy table of the Face check requirements).
enum FaceProblem {
  /// Nothing to fix: the screen's own headline stands.
  none,

  /// No face in the frame yet: the headline stands too.
  noFace,

  /// A setup photo waits for the head to turn toward the arrow: the
  /// headline ("Turn toward the arrow") stands, and the arrow does the talking.
  turn,

  oneFace,
  closer,
  dark,
  bright,
  angle,
  still,

  /// The detector called the burst a photo or a screen.
  spoof,

  /// A try ran out of time.
  timeout,
}

/// Which photo the camera is taking: the front one (every daily check, and
/// setup's first), or a setup photo with the head turned toward the arrow on
/// one side of the oval ([turnA], the first turn) and then the other ([turnB]).
enum FacePose { front, turnA, turnB }

/// What one burst gave: the selfie, the face crops the server re-reads, and
/// what the phone measured, all of it sent with the selfie.
class FaceBurst {
  const FaceBurst({
    required this.photo,
    required this.crops,
    this.spoofPhone,
    this.motionMean,
    this.motionRigid,
    this.yaw,
    this.report = '',
  });

  /// The selfie: the last frame of the burst, upright, framed on the face.
  final Uint8List photo;

  /// The burst's face crops ([spoofCrop]), 160 px JPEGs, in order.
  final List<Uint8List> crops;

  /// The phone's detector median, real-face probability; null without a detector.
  final double? spoofPhone;

  /// Micro-motion over the burst, px at the 160 px crop ([FaceMotion]).
  final double? motionMean;
  final double? motionRigid;

  /// The head's yaw in the selfie, degrees.
  final double? yaw;

  /// What the phone saw this try, for the server's log.
  final String report;
}

/// How much the face moved over a burst, from ML Kit's eye centres and nose
/// tip in each frame, scaled to the 160 px crop: a print held up does not
/// drift at all; a real face drifts a little and not all in one piece; a
/// screen moved by hand moves every point by the same vector.
///
/// Lenient for now, and only ever a second opinion: it is logged with every
/// try, and refuses a burst only when the detector was unsure as well. The
/// lines are set from `npm run face:calibrate` after two weeks of real
/// punches, as the other thresholds are.
class FaceMotion {
  const FaceMotion(this.mean, this.nonRigid);

  /// Mean displacement per frame of each point, px.
  final double mean;

  /// Mean distance of each point's displacement from the points' common
  /// displacement, px: zero for a rigid translation.
  final double nonRigid;

  static double minDrift = 0.5;
  static double maxDrift = 6;
  static double rigidMax = 0.1;

  bool get rigid => nonRigid < rigidMax;
  bool get passed => mean >= minDrift && mean <= maxDrift && !rigid;

  /// From each frame's points (the same points, in the same order, in each
  /// frame), times [scale] to bring them to the crop. Null with fewer than
  /// two frames that have every point.
  static FaceMotion? of(List<List<Offset>?> frames, double scale) {
    final usable = frames.whereType<List<Offset>>().where((p) => p.isNotEmpty).toList();
    if (usable.length < 2) return null;
    final count = usable.first.length;
    var total = 0.0, spread = 0.0;
    var n = 0, m = 0;
    for (var f = 1; f < usable.length; f++) {
      final a = usable[f - 1], b = usable[f];
      if (a.length != count || b.length != count) continue;
      final moves = [for (var i = 0; i < count; i++) (b[i] - a[i]) * scale];
      final common = moves.reduce((x, y) => x + y) / count.toDouble();
      for (final move in moves) {
        total += move.distance;
        spread += (move - common).distance;
        n++;
      }
      m++;
    }
    if (m == 0 || n == 0) return null;
    return FaceMotion(total / n, spread / n);
  }
}

/// One frame of a burst: the frame, the face's box, its points and its yaw.
class _Sample {
  _Sample(this.frame, this.box, this.points, this.yaw);
  final FaceFrame frame;
  final Rect box;
  final List<Offset>? points;
  final double? yaw;
}

/// The front camera with ML Kit face detection on its preview frames: the
/// quality gate on every frame, then a burst of frames the screen detector
/// reads, then the selfie, handed to [onBurst]. Nothing is captured or sent
/// while the gate fails, and the phone's verdict only decides whether to take
/// the selfie: the server re-reads the crops and matches the face.
class FaceCamera extends ChangeNotifier {
  FaceCamera();

  /// How the screens make one. Only a test replaces it, with a camera that
  /// needs no device.
  static FaceCamera Function() create = FaceCamera.new;

  /// How long one try may take before "Face not detected" is said for
  /// [lapsePause] and the try starts over (with a fresh challenge).
  static Duration promptPatience = const Duration(seconds: 30);
  static Duration lapsePause = const Duration(seconds: 2);

  /// How long a problem must last before the headline says it, so it does
  /// not flicker as someone walks into the frame.
  static Duration debounce = const Duration(milliseconds: 500);

  /// How long a word after a burst ("Hold the phone still", a screen
  /// suspected) stays before the next look.
  static Duration notePause = const Duration(seconds: 2);

  /// The gate, read off each frame: the face at least [minFacePixels] across
  /// and [minFaceShare] of the frame's short side; its light between
  /// [darkBelow] and [brightAbove] (mean luma of cheeks and forehead, 0..255);
  /// within [turnedBeyond] degrees of front on for a front photo; and sharp,
  /// the variance of its Laplacian over a 128 px grey crop at least
  /// [blurFloor], checked on the burst's last frame.
  static int minFacePixels = 110;
  static double minFaceShare = 0.18;
  static double darkBelow = 40;
  static double brightAbove = 215;
  static double turnedBeyond = 15;
  static double blurFloor = 25;

  /// A setup photo is taken once the head has turned this far toward the
  /// arrow; the arrow pulses past [turnNudgeAfter] without it, and either
  /// side is taken past [turnEitherAfter] (the mirror makes sides easy to
  /// mix up, and the second turn is the other side whichever it was).
  static double turnDegrees = 12;
  static Duration turnEitherAfter = const Duration(seconds: 5);
  static Duration turnNudgeAfter = const Duration(seconds: 15);

  /// The burst: up to [FaceSpoofCheck.samples] frames, at most [burstSpan]
  /// once at least [burstMin] are in.
  static int burstMin = 6;
  static Duration burstSpan = const Duration(milliseconds: 700);

  CameraController? _camera;
  CameraDescription? _description;
  FaceDetector? _detector;
  FaceSpoofCheck? _spoof;
  bool _processing = false;
  bool _disposed = false;

  FaceSignal signal = FaceSignal.starting;

  /// Set when the camera cannot be opened: no permission, or none at all.
  String? cameraProblem;
  bool permissionDenied = false;

  /// The photo being taken; setup moves it on.
  FacePose pose = FacePose.front;

  /// The side the first turn was taken on (+1 or −1): the second is the other.
  int? _firstTurnSign;
  int? get firstTurnSign => _firstTurnSign;

  /// Each finished burst, with its selfie: the camera is then [held] until
  /// the screen calls [again] (or moves to the next pose).
  void Function(FaceBurst burst)? onBurst;

  /// A new try begins (the camera opened, a restart after a lapse or a
  /// refusal): the screen asks the server for a fresh challenge.
  VoidCallback? onNewTry;

  /// Every try's record, pass or fail, for the server's log of the phone's side.
  void Function(String summary)? onTryEnded;

  /// What the headline says, debounced; see [FaceProblem].
  FaceProblem problem = FaceProblem.noFace;
  FaceProblem _raw = FaceProblem.noFace;
  DateTime _rawSince = DateTime.now();
  DateTime? _stickyUntil;

  /// No bursts while held: a selfie is with the server, or the screen is showing an answer.
  bool held = false;

  /// A try ran out of time: "Face not detected" is up for [lapsePause].
  bool lapsed = false;

  /// A turn has not been seen for [turnNudgeAfter]: the arrow pulses.
  bool get turnSlow => pose != FacePose.front && _poseFor >= turnNudgeAfter;

  /// The try's and the pose's time, counted in the clock's half-second ticks
  /// (so it stops while the camera is held, and runs on a test's clock).
  static const _tickEvery = Duration(milliseconds: 500);
  int _tryTicks = 0;
  int _poseTicks = 0;
  Duration get _tryFor => _tickEvery * _tryTicks;
  Duration get _poseFor => _tickEvery * _poseTicks;

  DateTime _tryStartedAt = DateTime.now();
  Timer? _clock;
  Timer? _lapseTimer;
  Timer? _stickyTimer;

  final List<_Sample> _burst = [];
  DateTime? _burstStartedAt;
  bool _judging = false;
  FaceFrame? _lastFrame;
  Rect? _lastBox;
  double? _lastYaw;

  /// The try's record, line by line ("gate closer", "burst med0.93 …"),
  /// sent by [onTryEnded] when the try ends.
  final List<String> events = [];

  void note(String event) {
    final at = (DateTime.now().difference(_tryStartedAt).inMilliseconds / 1000).toStringAsFixed(1);
    events.add('$at ${event.trim()}');
  }

  void _endTry(String outcome) {
    note(outcome);
    final summary = events.join(' | ');
    events.clear();
    onTryEnded?.call(summary);
  }

  CameraController? get controller => _camera;
  bool get ready => _camera?.value.isInitialized == true;

  Future<void> start() async {
    if (_disposed) return;
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) throw CameraException('NoCamera', 'No camera on this device');
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
        imageFormatGroup: defaultTargetPlatform == TargetPlatform.iOS ? ImageFormatGroup.bgra8888 : ImageFormatGroup.nv21,
      );
      _camera = camera;
      _spoof ??= await FaceSpoofCheck.load();
      await camera.initialize();
      if (_disposed) {
        await camera.dispose();
        return;
      }
      // Never the flash: the selfie is a frame of the preview.
      await camera.setFlashMode(FlashMode.off).catchError((_) {});
      cameraProblem = null;
      permissionDenied = false;
      notifyListeners();
      again();
      await _startDetecting();
    } on CameraException catch (error) {
      permissionDenied = error.code.contains('AccessDenied') || error.code.contains('Restricted');
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
      _setSignal(FaceSignal.unavailable);
      return;
    }
    try {
      _detector ??= FaceDetector(
        options: FaceDetectorOptions(
          enableLandmarks: true,
          minFaceSize: 0.1,
          performanceMode: FaceDetectorMode.fast,
        ),
      );
      if (!camera.value.isStreamingImages) await camera.startImageStream(_onFrame);
    } catch (_) {
      _setSignal(FaceSignal.unavailable);
    }
  }

  /// A new try from the top: the gate, then a burst. Fresh challenge, fresh
  /// clock. Also how the screen lets the camera go on after an answer.
  void again() {
    if (_disposed) return;
    _lapseTimer?.cancel();
    _burst.clear();
    _burstStartedAt = null;
    _judging = false;
    held = false;
    lapsed = false;
    _tryStartedAt = DateTime.now();
    _tryTicks = 0;
    _clock?.cancel();
    _clock = Timer.periodic(_tickEvery, (_) => _tick());
    onNewTry?.call();
    notifyListeners();
  }

  /// The next setup photo: the photos already taken stand.
  void nextPose(FacePose next) {
    pose = next;
    _poseTicks = 0;
    problem = _raw = next == FacePose.front ? FaceProblem.noFace : FaceProblem.turn;
    again();
  }

  /// Stop taking bursts until [again]: a selfie is with the server.
  void hold() {
    held = true;
    _burst.clear();
    _burstStartedAt = null;
    _clock?.cancel();
    notifyListeners();
  }

  /// A word the headline holds for [notePause] whatever the frames say:
  /// the server was unsure ("Move a little closer"), a screen suspected.
  void say(FaceProblem word, {Duration? pause}) {
    problem = word;
    _stickyUntil = DateTime.now().add(pause ?? notePause);
    _stickyTimer?.cancel();
    _stickyTimer = Timer(pause ?? notePause, () {
      _stickyUntil = null;
      if (!_disposed) notifyListeners();
    });
    notifyListeners();
  }

  /// The try's clock: past [promptPatience] without a selfie, "Face not
  /// detected" for [lapsePause], then a new try. Setup's turned photos have
  /// no clock: the arrow pulses instead, and the photos taken stand.
  void _tick() {
    if (_disposed || held || lapsed || _judging) return;
    _tryTicks++;
    _poseTicks++;
    if (pose != FacePose.front) {
      if (_poseFor == turnNudgeAfter || _poseFor == turnEitherAfter) notifyListeners();
      return;
    }
    if (_tryFor < promptPatience) return;
    lapsed = true;
    _burst.clear();
    _burstStartedAt = null;
    problem = FaceProblem.timeout;
    _endTry('timeout');
    unawaited(FaceSounds.failed());
    notifyListeners();
    _lapseTimer = Timer(lapsePause, () {
      if (_disposed) return;
      problem = _raw;
      again();
    });
  }

  Future<void> _onFrame(CameraImage image) async {
    if (_processing || _disposed) return;
    _processing = true;
    try {
      final input = _inputImage(image);
      if (input == null) {
        _setSignal(FaceSignal.unavailable);
        return;
      }
      final faces = await _detector!.processImage(input);
      if (_disposed) return;
      final rotation = input.metadata?.rotation ?? InputImageRotation.rotation0deg;
      final shortSide = min(image.width, image.height).toDouble();
      final face = faces.isEmpty
          ? null
          : faces.reduce((a, b) => a.boundingBox.width >= b.boundingBox.width ? a : b);
      final others = faces.where((f) => f != face && f.boundingBox.width / shortSide >= 0.08).length;
      FaceProblem raw;
      if (face == null) {
        raw = FaceProblem.noFace;
      } else if (others > 0) {
        raw = FaceProblem.oneFace;
      } else {
        raw = _gate(face, shortSide, _faceLight(image, _onSensor(face.boundingBox, image, rotation)).luma);
      }
      _see(raw);
      if (face == null || raw != FaceProblem.none) {
        _setSignal(FaceSignal.notDetected);
        if (_burst.isNotEmpty) note('burst broken ${raw.name}');
        _burst.clear();
        _burstStartedAt = null;
        return;
      }
      _setSignal(FaceSignal.detected);
      final frame = FaceFrame.of(image, rotation.rawValue);
      if (frame == null) return;
      _lastFrame = frame;
      _lastBox = face.boundingBox;
      _lastYaw = face.headEulerAngleY;
      if (held || lapsed || _judging) return;
      _burstStartedAt ??= DateTime.now();
      _burst.add(_Sample(frame, face.boundingBox, _points(face), face.headEulerAngleY));
      final span = DateTime.now().difference(_burstStartedAt!);
      if (_burst.length >= FaceSpoofCheck.samples || (_burst.length >= burstMin && span >= burstSpan)) {
        unawaited(_judge(List.of(_burst)));
        _burst.clear();
        _burstStartedAt = null;
      }
    } on MissingPluginException {
      _setSignal(FaceSignal.unavailable);
    } on PlatformException {
      // One bad frame is not the detector gone; the next frame tries again.
    } finally {
      _processing = false;
    }
  }

  /// One problem, the one that fixes most: closer before light, light
  /// before angle. A turned setup photo waits for the turn instead of the angle.
  FaceProblem _gate(Face face, double shortSide, double luma) {
    final box = face.boundingBox;
    if (box.width < minFacePixels || box.width / shortSide < minFaceShare) return FaceProblem.closer;
    if (luma < darkBelow) return FaceProblem.dark;
    if (luma > brightAbove) return FaceProblem.bright;
    final yaw = face.headEulerAngleY ?? 0;
    if (pose == FacePose.front) return yaw.abs() > turnedBeyond ? FaceProblem.angle : FaceProblem.none;
    return _turnedEnough(yaw) ? FaceProblem.none : FaceProblem.turn;
  }

  bool _turnedEnough(double yaw) {
    if (yaw.abs() < turnDegrees) return false;
    final sign = yaw.sign.toInt();
    if (pose == FacePose.turnB && _firstTurnSign != null) return sign == -_firstTurnSign!;
    // The first turn: toward the arrow on the left of the oval, or either
    // side once a few seconds have gone by without it.
    return sign == 1 || _poseFor >= turnEitherAfter;
  }

  /// The frame's problem, held to [debounce] before the headline says it.
  void _see(FaceProblem raw) {
    final now = DateTime.now();
    if (raw != _raw) {
      _raw = raw;
      _rawSince = now;
    }
    final sticky = _stickyUntil != null && now.isBefore(_stickyUntil!);
    if (sticky || lapsed || problem == raw) return;
    if (now.difference(_rawSince) >= debounce || raw == FaceProblem.none) {
      problem = raw;
      if (raw.index > FaceProblem.turn.index) note('gate ${raw.name}');
      notifyListeners();
    }
  }

  /// A finished burst: the crops, the detector on each, the motion and the
  /// sharpness; then the selfie, or a word and another look.
  Future<void> _judge(List<_Sample> samples) async {
    _judging = true;
    final started = DateTime.now();
    try {
      final crops = await compute(_cropsJob, [for (final s in samples) (s.frame, s.box)]);
      if (_disposed) return;
      final spoof = _spoof;
      final scores = <double>[];
      if (spoof != null) {
        for (final crop in crops) {
          if (crop == null) continue;
          final score = await spoof.realProbabilityOfCrop(crop);
          if (score != null) scores.add(score);
        }
      }
      final median = medianOf(scores);
      final last = samples.last;
      final upright = _uprightSize(last.frame);
      final cropWidth = spoofCropBox(samples.first.box, upright.width.round(), upright.height.round()).width;
      final motion = cropWidth <= 0 ? null : FaceMotion.of([for (final s in samples) s.points], FaceSpoofCheck.cropSide / cropWidth);
      double? blur;
      try {
        blur = await compute(_blurJob, (last.frame, last.box));
      } catch (_) {}
      if (_disposed || held || lapsed) return;
      final scoreLine = scores.map((s) => s.toStringAsFixed(2)).join('/');
      final measured =
          'med${median?.toStringAsFixed(2) ?? 'NA'} s$scoreLine motion${motion?.mean.toStringAsFixed(1) ?? 'NA'} rigid${motion?.nonRigid.toStringAsFixed(2) ?? 'NA'} blur${blur?.round() ?? 'NA'} n${samples.length}';
      if (blur != null && blur < blurFloor) {
        note('gate still $measured');
        say(FaceProblem.still);
        return;
      }
      final weak = median != null && median < FaceSpoofCheck.accept;
      if ((median != null && median < FaceSpoofCheck.refuseBelow) || (weak && motion != null && !motion.passed)) {
        // A screen or a print, as far as the phone can tell: said, and a new try.
        _endTry('refused $measured');
        unawaited(FaceSounds.failed());
        hold();
        say(FaceProblem.spoof);
        _lapseTimer?.cancel();
        _lapseTimer = Timer(notePause, () {
          if (!_disposed) again();
        });
        return;
      }
      final photo = await _selfie(last);
      if (_disposed || photo == null) return;
      final took = (DateTime.now().difference(_tryStartedAt).inMilliseconds / 1000).toStringAsFixed(1);
      final report = 'captured ${pose.name} $measured judged${DateTime.now().difference(started).inMilliseconds}ms took$took';
      if (last.yaw != null && pose != FacePose.front) {
        _firstTurnSign ??= pose == FacePose.turnA ? last.yaw!.sign.toInt() : null;
      }
      hold();
      _endTry(report);
      onBurst?.call(FaceBurst(
        photo: photo,
        crops: crops.whereType<Uint8List>().toList(),
        spoofPhone: median,
        motionMean: motion?.mean,
        motionRigid: motion?.nonRigid,
        yaw: last.yaw,
        report: report,
      ));
    } catch (error) {
      note('burst error');
    } finally {
      _judging = false;
    }
  }

  /// No face detection on this phone: the selfie on a tap, the last frame or
  /// a photo, with no burst. The server takes it while old builds are allowed.
  Future<Uint8List?> captureNow() async {
    final frame = _lastFrame;
    final box = _lastBox;
    if (frame != null && box != null) return _selfie(_Sample(frame, box, null, _lastYaw));
    return _photo();
  }

  /// The selfie: [sample]'s frame upright, checked for an upright face (an
  /// orientation a phone reports oddly fails it, and a photo is taken
  /// instead), then framed on the face ([cropToFace]), so the face fills it
  /// wherever the person stood. Silent: no shutter, no flash.
  Future<Uint8List?> _selfie(_Sample sample) async {
    try {
      final jpeg = await compute(_frameToJpeg, sample.frame);
      final box = jpeg == null ? null : await _uprightFace(jpeg);
      if (jpeg != null && box != null) return await _framed(jpeg, box);
    } catch (_) {}
    return _photo();
  }

  Future<Uint8List?> _photo() async {
    final camera = _camera;
    if (camera == null || !camera.value.isInitialized) return null;
    try {
      if (camera.value.isStreamingImages) await camera.stopImageStream();
    } catch (_) {}
    try {
      final file = await camera.takePicture();
      final photo = await file.readAsBytes();
      final box = await _uprightFace(photo);
      return box == null ? photo : await _framed(photo, box);
    } catch (_) {
      return null;
    } finally {
      unawaited(_startDetecting());
    }
  }

  Future<Uint8List> _framed(Uint8List jpeg, Rect face) async {
    try {
      return await compute<(Uint8List, Rect), Uint8List?>(_cropJob, (jpeg, face)) ?? jpeg;
    } catch (_) {
      return jpeg;
    }
  }

  /// The one face the detector finds in [jpeg] as it stands, or null.
  Future<Rect?> _uprightFace(Uint8List jpeg) async {
    final detector = _detector;
    if (detector == null) return null;
    final file = File('${Directory.systemTemp.path}/sowaka-face-${DateTime.now().microsecondsSinceEpoch}.jpg');
    try {
      await file.writeAsBytes(jpeg, flush: true);
      final faces = await detector.processImage(InputImage.fromFilePath(file.path));
      return faces.length == 1 ? faces.first.boundingBox : null;
    } catch (_) {
      return null;
    } finally {
      unawaited(file.delete().catchError((_) => file));
    }
  }

  void _setSignal(FaceSignal next) {
    if (_disposed || signal == next) return;
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
        description.lensDirection == CameraLensDirection.front ? (sensor + device) % 360 : (sensor - device + 360) % 360,
      );
    }
    final format = InputImageFormatValue.fromRawValue(image.format.raw);
    if (rotation == null || format == null || image.planes.length != 1) return null;
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

  /// The app went to the background: the camera is let go, as the plugin
  /// asks. [start] brings it back with a new try at the photo being taken.
  Future<void> pause() async {
    final camera = _camera;
    _camera = null;
    _clock?.cancel();
    _lapseTimer?.cancel();
    _burst.clear();
    _burstStartedAt = null;
    lapsed = false;
    signal = FaceSignal.starting;
    if (camera != null) await camera.dispose().catchError((_) {});
  }

  @override
  void dispose() {
    _disposed = true;
    _clock?.cancel();
    _lapseTimer?.cancel();
    _stickyTimer?.cancel();
    final camera = _camera;
    _camera = null;
    unawaited(camera?.dispose().catchError((_) {}));
    unawaited(_detector?.close().catchError((_) {}));
    _spoof?.close();
    super.dispose();
  }
}

/// The eye centres and the nose tip, in the upright picture, or null when
/// ML Kit did not give all three.
List<Offset>? _points(Face face) {
  final out = <Offset>[];
  for (final type in const [FaceLandmarkType.leftEye, FaceLandmarkType.rightEye, FaceLandmarkType.noseBase]) {
    final point = face.landmarks[type]?.position;
    if (point == null) return null;
    out.add(Offset(point.x.toDouble(), point.y.toDouble()));
  }
  return out;
}

Size _uprightSize(FaceFrame f) =>
    f.rotation == 90 || f.rotation == 270 ? Size(f.height.toDouble(), f.width.toDouble()) : Size(f.width.toDouble(), f.height.toDouble());

/// The light on the face, from the sensor's own frame (unrotated): the mean luma.
class FaceLight {
  const FaceLight(this.luma);
  final double luma;
}

/// The face's box, as the detector gave it in the upright picture, back in
/// the sensor's own frame, shrunk to its middle three fifths: cheeks and
/// forehead, clear of hair and background. Null when it does not land
/// inside the frame, and the middle of the frame is read instead.
Rect? _onSensor(Rect box, CameraImage image, InputImageRotation rotation) {
  final w = image.width.toDouble(), h = image.height.toDouble();
  Offset back(Offset p) => switch (rotation) {
    InputImageRotation.rotation0deg => p,
    InputImageRotation.rotation90deg => Offset(p.dy, h - 1 - p.dx),
    InputImageRotation.rotation180deg => Offset(w - 1 - p.dx, h - 1 - p.dy),
    InputImageRotation.rotation270deg => Offset(w - 1 - p.dy, p.dx),
  };
  final corners = [box.topLeft, box.topRight, box.bottomLeft, box.bottomRight].map(back).toList();
  final left = corners.map((c) => c.dx).reduce(min), right = corners.map((c) => c.dx).reduce(max);
  final top = corners.map((c) => c.dy).reduce(min), bottom = corners.map((c) => c.dy).reduce(max);
  final rect = Rect.fromLTRB(left, top, right, bottom);
  if (rect.width < 16 || rect.height < 16 || rect.left < 0 || rect.top < 0 || rect.right > w || rect.bottom > h) return null;
  return Rect.fromCenter(center: rect.center, width: rect.width * 0.6, height: rect.height * 0.6);
}

/// On an NV21 frame the Y plane comes first; on BGRA the channels are read straight.
FaceLight _faceLight(CameraImage image, [Rect? face]) {
  final plane = image.planes.first;
  final bytes = plane.bytes;
  final bgra = defaultTargetPlatform == TargetPlatform.iOS;
  final region = face ?? Rect.fromLTWH(image.width * 0.3, image.height * 0.3, image.width * 0.4, image.height * 0.4);
  final x0 = region.left.round(), x1 = region.right.round();
  final y0 = region.top.round(), y1 = region.bottom.round();
  var luma = 0.0;
  var n = 0;
  for (var y = y0; y < y1; y += 4) {
    final row = y * plane.bytesPerRow;
    for (var x = x0; x < x1; x += 4) {
      if (bgra) {
        final at = row + x * 4;
        if (at + 2 >= bytes.length) break;
        luma += 0.299 * bytes[at + 2] + 0.587 * bytes[at + 1] + 0.114 * bytes[at];
      } else {
        final at = row + x;
        if (at >= bytes.length) break;
        luma += bytes[at];
      }
      n++;
    }
  }
  return FaceLight(n == 0 ? 0 : luma / n);
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

/// Each burst frame upright and cut to its [spoofCrop]: what the phone's
/// detector reads and what goes to the server. Null where a frame cannot be read.
List<Uint8List?> _cropsJob(List<(FaceFrame, Rect)> frames) => [for (final f in frames) spoofCropJob(f)];

/// How blurred the face is: the variance of a 3×3 Laplacian over the grey
/// face, at 128 px. Sharp faces read in the hundreds, motion blur under 20.
double? _blurJob((FaceFrame, Rect) job) {
  final (frame, box) = job;
  final picture = frameToImage(frame);
  if (picture == null) return null;
  final face = img.copyResize(_faceSquare(picture, box, 1.0), width: 128, height: 128, interpolation: img.Interpolation.average);
  final grey = img.grayscale(face);
  final w = grey.width, h = grey.height;
  var sum = 0.0, sumSq = 0.0;
  var n = 0;
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      final c = grey.getPixel(x, y).r;
      final lap = (4 * c - grey.getPixel(x - 1, y).r - grey.getPixel(x + 1, y).r - grey.getPixel(x, y - 1).r - grey.getPixel(x, y + 1).r).toDouble();
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n == 0) return null;
  final mean = sum / n;
  return sumSq / n - mean * mean;
}

/// A square about the face box's centre, [scale] times its longer side,
/// kept inside the picture.
img.Image _faceSquare(img.Image picture, Rect box, double scale) {
  final side = (max(box.width, box.height) * scale).round().clamp(8, min(picture.width, picture.height)).toInt();
  final left = (box.center.dx - side / 2).round().clamp(0, picture.width - side).toInt();
  final top = (box.center.dy - side / 2).round().clamp(0, picture.height - side).toInt();
  return img.copyCrop(picture, x: left, y: top, width: side, height: side);
}

/// [jpeg] framed on [face] (a box in the picture's own upright pixels): a
/// square about twice the face's size, centred a little below the eyes so
/// the chin and hair stay in, kept inside the picture, at most 800 across.
/// Null when there is nothing to gain (the face already fills the picture)
/// or the picture cannot be read.
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
  var cropped = img.copyCrop(picture, x: left.round(), y: top.round(), width: side.round(), height: side.round());
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
