// The screen detector run for real, on the sample pictures that ship with
// Silent-Face-Anti-Spoofing (one real face, one printed photo, one tablet):
// the model's answer for the real face must be well above both spoofs. Needs
// the TFLite library where flutter_tester looks for it on macOS
// (flutter/bin/cache/artifacts/engine/resources/libtensorflowlite_c-mac.dylib)
// and the pictures in the folder SPOOF_SAMPLES; without either it is skipped,
// so it never fails a machine that has neither.
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:mobile_app/features/face_id/face_camera.dart';
import 'package:mobile_app/features/face_id/face_spoof_check.dart';

/// The face box in each picture once upright (480×640), as a detector would
/// give it: forehead to chin, ear to ear.
const _faces = {
  'image_T1.jpg': Rect.fromLTWH(105, 105, 195, 240),
  'image_F1.jpg': Rect.fromLTWH(205, 140, 220, 250),
  'image_F2.jpg': Rect.fromLTWH(150, 215, 210, 270),
};

FaceFrame _frameOf(img.Image picture) {
  final bytes = Uint8List(picture.width * picture.height * 4);
  var i = 0;
  for (final p in picture) {
    bytes[i++] = p.b.toInt();
    bytes[i++] = p.g.toInt();
    bytes[i++] = p.r.toInt();
    bytes[i++] = 255;
  }
  return FaceFrame(bytes: bytes, width: picture.width, height: picture.height, stride: picture.width * 4, bgra: true, rotation: 0);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final folder = Platform.environment['SPOOF_SAMPLES'];
  final ready = folder != null && _faces.keys.every((name) => File('$folder/$name').existsSync());

  test('the real face scores well above the printed photo and the tablet', () async {
    final check = await FaceSpoofCheck.load();
    expect(check, isNotNull, reason: 'TFLite library not found by flutter_tester');
    final scores = <String, double>{};
    for (final entry in _faces.entries) {
      var picture = img.decodeImage(File('$folder/${entry.key}').readAsBytesSync())!;
      picture = img.bakeOrientation(picture);
      expect((picture.width, picture.height), (480, 640), reason: '${entry.key} upright');
      // Mean of three reads, as the phone takes them.
      var sum = 0.0;
      for (var i = 0; i < 3; i++) {
        sum += (await check!.realProbability(_frameOf(picture), entry.value))!;
      }
      scores[entry.key] = sum / 3;
    }
    // ignore: avoid_print
    print('real-face probability: $scores');
    expect(scores['image_T1.jpg']!, greaterThan(0.6));
    expect(scores['image_F1.jpg']!, lessThan(scores['image_T1.jpg']! - 0.3));
    expect(scores['image_F2.jpg']!, lessThan(scores['image_T1.jpg']! - 0.3));
    expect(scores['image_T1.jpg']!, greaterThan(FaceSpoofCheck.threshold));
    check!.close();
  }, skip: ready ? false : 'set SPOOF_SAMPLES to the folder with the Silent-Face sample pictures');
}
