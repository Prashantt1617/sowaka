// The selfie is framed on the face before it is sent: a face a step back or
// off to one side fills the picture the server sees, kept inside the frame.
import 'dart:typed_data';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:mobile_app/features/face_id/face_camera.dart';

Uint8List _picture(int width, int height) =>
    Uint8List.fromList(img.encodeJpg(img.Image(width: width, height: height)));

img.Image _read(Uint8List jpeg) => img.decodeJpg(jpeg)!;

void main() {
  test('a small face off to one side: a square about twice its size, around it', () {
    final out = cropToFace(_picture(720, 1280), const Rect.fromLTWH(40, 300, 150, 180));
    expect(out, isNotNull);
    final framed = _read(out!);
    expect(framed.width, framed.height);
    expect(framed.width, closeTo(360, 2));
  });

  test('a face at the very edge: the square is kept inside the picture', () {
    final out = cropToFace(_picture(720, 1280), const Rect.fromLTWH(600, 1150, 120, 130));
    final framed = _read(out!);
    expect(framed.width, closeTo(260, 2));
  });

  test('a face that already fills the picture is left as it is', () {
    expect(cropToFace(_picture(720, 1280), const Rect.fromLTWH(60, 300, 600, 700)), isNull);
  });

  test('a large picture is brought down to 800 across', () {
    final out = cropToFace(_picture(2000, 3000), const Rect.fromLTWH(600, 900, 500, 600));
    expect(_read(out!).width, 800);
  });

  test('the size a face must reach is about a fifth of the frame', () {
    expect(FaceCamera.minFaceShare, lessThan(0.28));
    expect(FaceCamera.minFaceShare, greaterThanOrEqualTo(0.15));
  });
}
