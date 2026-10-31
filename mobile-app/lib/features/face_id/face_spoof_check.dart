import 'dart:math';
import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as img;
import 'package:tflite_flutter/tflite_flutter.dart';

import 'face_camera.dart';

/// Whether the face in front of the camera is a face, or a picture of one on
/// a screen or on paper: the MiniFASNet V2 model from Silent-Face-Anti-Spoofing
/// (minivision-ai, Apache-2.0; the LiteRT port at litert-community), 1.85 MB,
/// run on the phone in a few milliseconds a frame. It was trained on what
/// screens and prints look like to a camera — their texture, moiré, glare
/// and colour cast — and answers with how likely the frame shows a real face.
///
/// The gate before the selfie: a burst of [samples] frames is read and the
/// median taken. Over [accept] the selfie is taken; under [refuseBelow] the
/// person is told to use their face; in between the selfie goes and the
/// server, which runs the same model on the same crops, decides.
///
/// One pre-processing for phone and server (backend
/// `face-spoof.service.ts`; keep the two in step — the 0–1 against 0–255 bug
/// of October came from them drifting): the face box scaled [scale] about
/// its centre and held inside the picture ([spoofCropBox]), sent as a
/// [cropSide] px square JPEG ([spoofCrop]); the model reads that at [side] ×
/// [side], bilinear, as BGR values 0–255, channels first; its output index 1
/// is "real".
class FaceSpoofCheck {
  FaceSpoofCheck._(this._interpreter);

  final IsolateInterpreter _interpreter;

  static const scale = 2.7;
  static const side = 80;
  static const cropSide = 160;

  /// The burst, and the lines its median is held to.
  static int samples = 8;
  static double accept = 0.7;
  static double refuseBelow = 0.2;

  static Future<FaceSpoofCheck?> Function() load = _load;

  static Future<FaceSpoofCheck?> _load() async {
    if (kIsWeb) return null;
    try {
      final interpreter = await Interpreter.fromAsset('assets/models/silentface.tflite');
      final isolated = await IsolateInterpreter.create(address: interpreter.address);
      return FaceSpoofCheck._(isolated);
    } catch (error) {
      debugPrint('Face spoof model not loaded: $error');
      return null;
    }
  }

  /// How likely the 160 px face crop [jpeg] ([spoofCrop]) shows a real face,
  /// 0 to 1. Null when it could not be read.
  Future<double?> realProbabilityOfCrop(Uint8List jpeg) async {
    final input = await compute(_inputOf, jpeg);
    if (input == null) return null;
    final output = [List<double>.filled(3, 0)];
    await _interpreter.run([input], output);
    return realFrom(output[0]);
  }

  /// [frame] at [face] (the box in the upright picture), cropped as the
  /// server is sent it, then read. Null when the frame could not be read.
  Future<double?> realProbability(FaceFrame frame, Rect face) async {
    final crop = await compute(spoofCropJob, (frame, face));
    return crop == null ? null : realProbabilityOfCrop(crop);
  }

  /// The model's answer, index 1 of three (0 and 2 are kinds of spoof),
  /// softmaxed if it came as logits.
  @visibleForTesting
  static double realFrom(List<double> scores) {
    final sum = scores.fold<double>(0, (a, b) => a + b);
    final probabilities = scores.every((s) => s >= 0 && s <= 1) && (sum - 1).abs() < 0.02;
    if (probabilities) return scores[1];
    final top = scores.reduce(max);
    final exps = scores.map((s) => exp(s - top)).toList();
    final total = exps.fold<double>(0, (a, b) => a + b);
    return exps[1] / total;
  }

  void close() {
    _interpreter.close();
  }
}

/// The median of [values], or null when there are none.
double? medianOf(List<double> values) {
  if (values.isEmpty) return null;
  final sorted = [...values]..sort();
  final mid = sorted.length ~/ 2;
  return sorted.length.isOdd ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/// The crop the model is shown, as the project's generate_patches.py makes
/// it: the face box scaled [FaceSpoofCheck.scale] about its centre, the scale
/// held down so it fits the picture, and the box shifted (not shrunk) back
/// inside the edges.
Rect spoofCropBox(Rect face, int width, int height) {
  if (face.isEmpty) return Rect.zero;
  final scale = [FaceSpoofCheck.scale, (height - 1) / face.height, (width - 1) / face.width].reduce(min);
  final w = face.width * scale;
  final h = face.height * scale;
  var left = face.center.dx - w / 2;
  var top = face.center.dy - h / 2;
  if (left < 0) left = 0;
  if (top < 0) top = 0;
  if (left + w > width - 1) left = width - 1 - w;
  if (top + h > height - 1) top = height - 1 - h;
  return Rect.fromLTWH(left, top, w, h);
}

/// [picture] cut to [spoofCropBox] about [face] and sent as a
/// [FaceSpoofCheck.cropSide] px square JPEG: what the phone reads and what
/// the server is sent. Null when there is no face to crop.
Uint8List? spoofCrop(img.Image picture, Rect face) {
  final box = spoofCropBox(face, picture.width, picture.height);
  if (box.isEmpty) return null;
  final crop = img.copyResize(
    img.copyCrop(picture, x: box.left.round(), y: box.top.round(), width: box.width.round(), height: box.height.round()),
    width: FaceSpoofCheck.cropSide,
    height: FaceSpoofCheck.cropSide,
    interpolation: img.Interpolation.linear,
  );
  return Uint8List.fromList(img.encodeJpg(crop, quality: 90));
}

/// Off the UI thread: one frame, upright, as its [spoofCrop].
Uint8List? spoofCropJob((FaceFrame, Rect) job) {
  final picture = frameToImage(job.$1);
  return picture == null ? null : spoofCrop(picture, job.$2);
}

/// Off the UI thread: the 160 px crop read at 80 × 80, bilinear, as BGR
/// floats 0..255 in channel-first order. The model was trained on unscaled
/// pixels (the project's ToTensor does not divide by 255); fed 0..1 it calls
/// every face, real or not, a spoof.
List<List<List<double>>>? _inputOf(Uint8List jpeg) {
  final decoded = img.decodeJpg(jpeg);
  if (decoded == null) return null;
  final small = img.copyResize(decoded, width: FaceSpoofCheck.side, height: FaceSpoofCheck.side, interpolation: img.Interpolation.linear);
  final planes = List.generate(3, (_) => List.generate(FaceSpoofCheck.side, (_) => List<double>.filled(FaceSpoofCheck.side, 0)));
  for (var y = 0; y < FaceSpoofCheck.side; y++) {
    for (var x = 0; x < FaceSpoofCheck.side; x++) {
      final p = small.getPixel(x, y);
      planes[0][y][x] = p.b.toDouble();
      planes[1][y][x] = p.g.toDouble();
      planes[2][y][x] = p.r.toDouble();
    }
  }
  return planes;
}
