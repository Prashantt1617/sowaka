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
/// A filter, not the gate: the colour flash is what a recording cannot
/// answer; this catches the screen itself. Scores go to the server's log
/// with the selfie, so the threshold can be tuned on real phones.
class FaceSpoofCheck {
  FaceSpoofCheck._(this._interpreter);

  final IsolateInterpreter _interpreter;

  /// How much of the frame around the face box the model sees (the model
  /// was trained on this crop), and the size it reads at.
  static const scale = 2.7;
  static const side = 80;

  /// How many frames are read while the face holds still, and the mean real
  /// probability they must reach. Scores are logged with every selfie, so
  /// this can be tuned on the fleet.
  static int samples = 3;
  static double threshold = 0.6;

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

  /// How likely [frame] shows a real face at [face] (the box as the detector
  /// found it, in the upright picture), 0 to 1. Null when the frame could
  /// not be read.
  Future<double?> realProbability(FaceFrame frame, Rect face) async {
    final input = await compute(_prepare, (frame, face));
    if (input == null) return null;
    final output = [List<double>.filled(3, 0)];
    await _interpreter.run([input], output);
    return realFrom(output[0]);
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

/// The crop the model is shown, as the project's generate_patches.py makes
/// it: the face box scaled [FaceSpoofCheck.scale] about its centre, the scale
/// held down so it fits the picture, and the box shifted (not shrunk) back
/// inside the edges.
@visibleForTesting
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

/// Off the UI thread: the frame upright, cropped to the model's box, at
/// 80×80, as BGR floats 0..1 in channel-first order.
List<List<List<double>>>? _prepare((FaceFrame, Rect) job) {
  final (frame, face) = job;
  final picture = frameToImage(frame);
  if (picture == null) return null;
  final box = spoofCropBox(face, picture.width, picture.height);
  if (box.isEmpty) return null;
  final crop = img.copyResize(
    img.copyCrop(picture, x: box.left.round(), y: box.top.round(), width: box.width.round(), height: box.height.round()),
    width: FaceSpoofCheck.side,
    height: FaceSpoofCheck.side,
    interpolation: img.Interpolation.linear,
  );
  final planes = List.generate(3, (_) => List.generate(FaceSpoofCheck.side, (_) => List<double>.filled(FaceSpoofCheck.side, 0)));
  for (var y = 0; y < FaceSpoofCheck.side; y++) {
    for (var x = 0; x < FaceSpoofCheck.side; x++) {
      final p = crop.getPixel(x, y);
      planes[0][y][x] = p.b / 255;
      planes[1][y][x] = p.g / 255;
      planes[2][y][x] = p.r / 255;
    }
  }
  return planes;
}
