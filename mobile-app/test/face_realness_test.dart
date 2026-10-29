// The phone's own checks that a face is a real one, fed made-up frames. A
// head that turns swings its nose against the eye line; a photo turned the
// same way keeps nose and eyes in step. Eyes that close and open again have
// blinked; a photo's never close. Under the flash a lit face brightens; a
// screen does not. Bright light skips the flash.
import 'dart:math';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:mobile_app/features/face_id/face_camera.dart';

/// A face of [eyes] px between the eyes, its nose base [noseX] px right of
/// the point between them, turned [yaw] degrees as ML Kit reads it, with its
/// eyes [open] (0 shut, 1 wide).
Face _face({
  double eyes = 100,
  double noseX = 0,
  double yaw = 0,
  double? open = 1,
}) => Face(
  boundingBox: Rect.fromLTWH(0, 0, eyes * 3, eyes * 4),
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
      position: Point(100 + (eyes / 2 + noseX).round(), 160),
    ),
  },
  contours: const {},
  headEulerAngleY: yaw,
  leftEyeOpenProbability: open,
  rightEyeOpenProbability: open,
);

void main() {
  test('the line asks for the turn, then the blink, then nothing', () {
    final r = FaceRealness();
    r.seeFace(_face(), 1000, 100);
    expect(r.ask, 'Turn your head a little to one side');
    // Turned 15°, the nose 9 px (of 100 between the eyes) off the eye line.
    r.seeFace(_face(eyes: 97, noseX: 9, yaw: 15), 1000, 100);
    expect(r.turned, isTrue);
    expect(r.ask, 'Blink your eye');
    r.seeFace(_face(open: 0.1), 1000, 100);
    expect(r.blinked, isFalse);
    r.seeFace(_face(open: 0.9), 1000, 100);
    expect(r.blinked, isTrue);
    expect(r.challengesDone, isTrue);
    expect(r.ask, isNull);
  });

  test('a photo turned the same way has not turned: its nose stays put', () {
    final r = FaceRealness();
    r.seeFace(_face(), 1000, 100);
    // Flat: the eyes narrow with the turn and the nose narrows with them.
    r.seeFace(_face(eyes: 97, noseX: 1, yaw: 15), 1000, 100);
    r.seeFace(_face(eyes: 94, noseX: 2, yaw: 20), 1000, 100);
    expect(r.turned, isFalse);
  });

  test('a nose that drifts without the head turning is not a turn', () {
    final r = FaceRealness();
    r.seeFace(_face(), 1000, 100);
    r.seeFace(_face(noseX: 9, yaw: 3), 1000, 100);
    expect(r.turned, isFalse);
  });

  test('a blink counts before the turn is asked for', () {
    final r = FaceRealness();
    r.seeFace(_face(open: 0.2), 1000, 100);
    r.seeFace(_face(open: 0.8), 1000, 100);
    expect(r.blinked, isTrue);
    expect(r.ask, 'Turn your head a little to one side');
    r.seeFace(_face(eyes: 97, noseX: 9, yaw: 15), 1000, 100);
    expect(r.challengesDone, isTrue);
  });

  test('eyes half shut are neither closed nor a blink', () {
    final r = FaceRealness();
    r.seeFace(_face(open: 0.5), 1000, 100);
    r.seeFace(_face(open: 0.9), 1000, 100);
    expect(r.blinked, isFalse);
  });

  test('a real face brightens under the flash; a screen does not', () {
    final lit = FaceRealness();
    lit.seeFace(_face(), 1000, 90);
    lit.flashOn();
    lit.flashOff(104);
    expect(lit.lit, isTrue);

    final screen = FaceRealness();
    screen.seeFace(_face(), 1000, 90);
    screen.flashOn();
    screen.flashOff(91);
    expect(screen.lit, isFalse);
  });

  test('in bright light the flash is skipped, and the prompts alone pass', () {
    final r = FaceRealness();
    r.seeFace(_face(open: 0.1), 1000, 200);
    r.seeFace(_face(eyes: 97, noseX: 9, yaw: 15, open: 0.9), 1000, 200);
    expect(r.flashUseful, isFalse);
    expect(r.passed, isTrue);
  });

  test('the prompts answered but no flash yet: not passed', () {
    final r = FaceRealness();
    r.seeFace(_face(open: 0.1), 1000, 90);
    r.seeFace(_face(eyes: 97, noseX: 9, yaw: 15, open: 0.9), 1000, 90);
    expect(r.challengesDone, isTrue);
    expect(r.passed, isFalse);
  });

  test('reset starts every check over', () {
    final r = FaceRealness();
    r.seeFace(_face(open: 0.1), 1000, 90);
    r.seeFace(_face(eyes: 97, noseX: 9, yaw: 15, open: 0.9), 1000, 90);
    r.flashOn();
    r.flashOff(120);
    expect(r.passed, isTrue);
    r.reset();
    expect(r.turned, isFalse);
    expect(r.blinked, isFalse);
    expect(r.lit, isNull);
    expect(r.ask, 'Turn your head a little to one side');
  });
}
