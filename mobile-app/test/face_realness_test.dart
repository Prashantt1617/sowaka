// The phone's own checks that a face is a real one, fed made-up frames. The
// prompts in order: a head that turns swings its nose against the eye line
// (a photo turned the same way keeps them in step); back to the camera; a
// blink, counted only once asked for. Then the light check: two colours
// picked at random, each of which the face must take — its chroma moving
// the colour's way and brightening — which a screen, making its own light,
// does not.
import 'dart:math';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:mobile_app/features/face_id/face_camera.dart';

Face _face({double eyes = 100, double noseX = 0, double yaw = 0, double? open = 1}) => Face(
  boundingBox: Rect.fromLTWH(0, 0, eyes * 3, eyes * 4),
  landmarks: {
    FaceLandmarkType.leftEye: FaceLandmark(type: FaceLandmarkType.leftEye, position: const Point(100, 100)),
    FaceLandmarkType.rightEye: FaceLandmark(type: FaceLandmarkType.rightEye, position: Point(100 + eyes.round(), 100)),
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

const _dim = FaceLight(90, 128, 128);

void main() {
  test('the prompts, in order: turn and face the camera (one prompt), blink; then nothing', () {
    final r = FaceRealness(random: Random(1));
    r.seeFace(_face(), 1000, _dim);
    expect(r.ask, 'Move your head to the left, then face the camera');
    expect(r.step, 0);
    // Turned 15°, the nose 9 px (of 100 between the eyes) off the eye line.
    r.seeFace(_face(eyes: 97, noseX: 9, yaw: 15), 1000, _dim);
    expect(r.turned, isTrue);
    expect(r.ask, 'Move your head to the left, then face the camera');
    expect(r.step, 0);
    r.seeFace(_face(yaw: 2), 1000, _dim);
    expect(r.faced, isTrue);
    expect(r.ask, 'Blink now');
    expect(r.step, 1);
    r.seeFace(_face(open: 0.1), 1000, _dim);
    r.seeFace(_face(open: 0.9), 1000, _dim);
    expect(r.blinked, isTrue);
    expect(r.challengesDone, isTrue);
    expect(r.step, 2);
    expect(r.ask, isNull);
  });

  test('a photo turned the same way has not turned: its nose stays put', () {
    final r = FaceRealness(random: Random(1));
    r.seeFace(_face(), 1000, _dim);
    r.seeFace(_face(eyes: 97, noseX: 1, yaw: 15), 1000, _dim);
    r.seeFace(_face(eyes: 94, noseX: 2, yaw: 20), 1000, _dim);
    expect(r.turned, isFalse);
  });

  test('a blink before it is asked for does not count', () {
    final r = FaceRealness(random: Random(1));
    r.seeFace(_face(open: 0.1), 1000, _dim);
    r.seeFace(_face(open: 0.9), 1000, _dim);
    expect(r.blinked, isFalse);
    r.seeFace(_face(eyes: 97, noseX: 9, yaw: 15), 1000, _dim);
    r.seeFace(_face(yaw: 1), 1000, _dim);
    expect(r.faced, isTrue);
    expect(r.blinked, isFalse);
    r.seeFace(_face(open: 0.1), 1000, _dim);
    r.seeFace(_face(open: 0.9), 1000, _dim);
    expect(r.blinked, isTrue);
  });

  test('two different colours are picked for the flash, afresh each try', () {
    final r = FaceRealness(random: Random(7));
    expect(r.colours, hasLength(2));
    expect(r.colours[0], isNot(r.colours[1]));
    final seen = <String>{};
    for (var i = 0; i < 20; i++) {
      r.reset();
      seen.add('${r.colours[0].name}>${r.colours[1].name}');
    }
    expect(seen.length, greaterThan(2));
  });

  test('skin takes the colour: red raises Cr, blue raises Cb, green lowers both', () {
    expect(FaceRealness.answers(FlashColour.red, _dim, const FaceLight(96, 127, 134)), isTrue);
    expect(FaceRealness.answers(FlashColour.blue, _dim, const FaceLight(96, 134, 127)), isTrue);
    expect(FaceRealness.answers(FlashColour.green, _dim, const FaceLight(96, 124, 124)), isTrue);
    // The wrong colour, or no colour at all, is not an answer.
    expect(FaceRealness.answers(FlashColour.red, _dim, const FaceLight(96, 134, 127)), isFalse);
    expect(FaceRealness.answers(FlashColour.blue, _dim, const FaceLight(96, 128, 128)), isFalse);
  });

  test('a screen makes its own light: brighter but no colour, and it fails', () {
    expect(FaceRealness.answers(FlashColour.red, const FaceLight(180, 128, 128), const FaceLight(185, 128.4, 128.6)), isFalse);
    // Or nothing changes at all.
    expect(FaceRealness.answers(FlashColour.blue, const FaceLight(180, 128, 128), const FaceLight(180, 128, 128)), isFalse);
  });

  test('both flashes answered: lit; one not: not lit; and a report of what was measured', () {
    final r = FaceRealness(random: Random(3));
    r.setLight(_dim);
    r.flashOn(0);
    r.flashOff(0, FaceRealness.answering(r.colours[0], _dim));
    expect(r.lit, isNull);
    // A late, still-lit frame lands between the colours: it is not the
    // baseline for the second, the reading before the first is.
    r.setLight(FaceRealness.answering(r.colours[0], _dim));
    r.flashOn(1);
    r.flashOff(1, FaceRealness.answering(r.colours[1], _dim));
    expect(r.lit, isTrue);
    expect(r.report, matches(RegExp(r'^[rgb][-+]?\d+\.\d/[-+]?\d+\.\d [rgb][-+]?\d+\.\d/[-+]?\d+\.\d$')));

    final s = FaceRealness(random: Random(3));
    s.setLight(_dim);
    s.flashOn(0);
    s.flashOff(0, FaceRealness.answering(s.colours[0], _dim));
    s.flashOn(1);
    s.flashOff(1, _dim);
    expect(s.lit, isFalse);
    expect(s.passed, isFalse);
  });

  test('reset starts every check over, with new colours', () {
    final r = FaceRealness(random: Random(5));
    r.seeFace(_face(eyes: 97, noseX: 9, yaw: 15), 1000, _dim);
    r.flashOn(0);
    r.flashOff(0, _dim);
    r.reset();
    expect(r.turned, isFalse);
    expect(r.faced, isFalse);
    expect(r.blinked, isFalse);
    expect(r.lit, isNull);
    expect(r.report, '');
    expect(r.ask, 'Move your head to the left, then face the camera');
  });

  test('the light under a colour is the mean of its frames, and the flash alone can start over', () {
    final r = FaceRealness(random: Random(9));
    r.seeFace(_face(), 1000, _dim);
    r.seeFace(_face(eyes: 97, noseX: 9, yaw: 15), 1000, _dim);
    r.seeFace(_face(yaw: 1), 1000, _dim);
    r.seeFace(_face(open: 0.1), 1000, _dim);
    r.seeFace(_face(open: 0.9), 1000, _dim);
    expect(r.challengesDone, isTrue);
    r.flashOn(0);
    r.seeFace(_face(), 1000, const FaceLight(94, 128, 132));
    r.seeFace(_face(), 1000, const FaceLight(98, 128, 136));
    expect(r.litMean(_dim).luma, closeTo(96, 1e-9));
    expect(r.litMean(_dim).cr, closeTo(134, 1e-9));
    r.flashOff(0, r.litMean(_dim));
    final first = r.colours;
    r.resetFlash();
    // The prompts stand; only the flashes are new.
    expect(r.challengesDone, isTrue);
    expect(r.lit, isNull);
    expect(r.report, '');
    expect(r.litBy, [null, null]);
    expect(r.colours, hasLength(2));
    expect(r.colours == first, isFalse);
  });
}
