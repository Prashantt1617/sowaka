// The phone's own checks that a face is a real one, fed made-up frames: a
// face that comes closer with its nose spreading faster than its eyes has
// moved; a photo that scales evenly has not. Under the flash a lit face
// brightens; a screen does not. Bright light skips the flash.
import 'dart:math';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:mobile_app/features/face_id/face_camera.dart';

Face _face({
  required double width,
  required double eyes,
  required double noseDrop,
}) => Face(
  boundingBox: Rect.fromLTWH(0, 0, width, width * 1.3),
  landmarks: {
    FaceLandmarkType.leftEye: FaceLandmark(
      type: FaceLandmarkType.leftEye,
      position: const Point(100, 100),
    ),
    FaceLandmarkType.rightEye: FaceLandmark(
      type: FaceLandmarkType.rightEye,
      position: Point(100 + eyes.round(), 100),
    ),
    FaceLandmarkType.noseBase: FaceLandmark(
      type: FaceLandmarkType.noseBase,
      position: Point(100 + (eyes / 2).round(), 100 + noseDrop.round()),
    ),
  },
  contours: const {},
);

void main() {
  test(
    'a face coming closer, nose spreading faster than the eyes, has moved',
    () {
      final r = FaceRealness();
      r.seeFace(_face(width: 300, eyes: 100, noseDrop: 60), 1000, 100);
      expect(r.moved, isFalse);
      expect(r.ask, 'Move a little closer');
      // 15% bigger, and the nose dropped 8% further relative to the eyes.
      r.seeFace(_face(width: 345, eyes: 115, noseDrop: 74), 1000, 100);
      expect(r.moved, isTrue);
      expect(r.ask, isNull);
    },
  );

  test('a photo that scales evenly has not moved', () {
    final r = FaceRealness();
    r.seeFace(_face(width: 300, eyes: 100, noseDrop: 60), 1000, 100);
    r.seeFace(_face(width: 345, eyes: 115, noseDrop: 69), 1000, 100);
    r.seeFace(_face(width: 390, eyes: 130, noseDrop: 78), 1000, 100);
    expect(r.moved, isFalse);
  });

  test('a real face brightens under the flash; a screen does not', () {
    final lit = FaceRealness();
    lit.seeFace(_face(width: 300, eyes: 100, noseDrop: 60), 1000, 90);
    lit.flashOn();
    lit.flashOff(104);
    expect(lit.lit, isTrue);

    final screen = FaceRealness();
    screen.seeFace(_face(width: 300, eyes: 100, noseDrop: 60), 1000, 90);
    screen.flashOn();
    screen.flashOff(91);
    expect(screen.lit, isFalse);
  });

  test('in bright light the flash is skipped, and movement alone passes', () {
    final r = FaceRealness();
    r.seeFace(_face(width: 300, eyes: 100, noseDrop: 60), 1000, 200);
    r.seeFace(_face(width: 345, eyes: 115, noseDrop: 74), 1000, 200);
    expect(r.flashUseful, isFalse);
    expect(r.passed, isTrue);
  });

  test('reset starts both over', () {
    final r = FaceRealness();
    r.seeFace(_face(width: 300, eyes: 100, noseDrop: 60), 1000, 90);
    r.seeFace(_face(width: 345, eyes: 115, noseDrop: 74), 1000, 90);
    r.flashOn();
    r.flashOff(120);
    expect(r.passed, isTrue);
    r.reset();
    expect(r.moved, isFalse);
    expect(r.lit, isNull);
  });
}
