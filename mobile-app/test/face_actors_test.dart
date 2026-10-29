// Three people in front of the camera for a whole try, frame by frame at ten
// a second: a printed photo held up and tilted, a video of someone turning
// and blinking played on a tablet, and a real face. The photo never answers
// the first prompt; the video answers every prompt but not the colour flash,
// because a screen makes its own light; only the real face takes the colour
// and passes. The 30 s lapse itself is a FaceCamera matter and is covered in
// face_id_test.dart ('a try that ran out of time').
import 'dart:math';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:mobile_app/features/face_id/face_camera.dart';

const _fps = 10;
const _tryMs = 30 * 1000;
const _room = FaceLight(92, 127, 131);

/// A detector reading: eyes [eyes] px apart, the nose [noseX] px off the
/// middle of the eye line, the head [yaw] degrees round, eyes [open].
Face _reading({required double eyes, required double noseX, required double yaw, required double open}) => Face(
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

abstract class _Actor {
  _Actor(this.random);
  final Random random;
  double jitter(double by) => (random.nextDouble() * 2 - 1) * by;

  /// What the detector reads at [ms] into the try, given what the prompts
  /// are asking for right now.
  Face at(int ms, String? ask);

  /// The light on the face at [ms] while the screen is [colour], or the room
  /// light when it is not flashing.
  FaceLight light(int ms, FlashColour? colour);
}

/// A printed photo in a hand: it shakes a little and is tilted now and then
/// to "turn", but the nose stays exactly in step with the eyes, since the
/// face is flat. It reflects the flash like skin would (paper does).
class _PrintedPhoto extends _Actor {
  _PrintedPhoto(super.random);

  @override
  Face at(int ms, String? ask) {
    // Tilted up to 20° for a second every four seconds, as someone trying
    // to answer "turn your head" would do with the photo.
    final tilting = ms % 4000 < 1000;
    final yaw = (tilting ? 20.0 : 0.0) + jitter(2);
    // Foreshortened a little when tilted; the nose keeps its share of the
    // eye line, so its offset scales with the eyes and nothing else.
    final eyes = (tilting ? 94.0 : 100.0) + jitter(1);
    return _reading(eyes: eyes, noseX: jitter(1), yaw: yaw, open: 0.95 + jitter(0.04));
  }

  @override
  FaceLight light(int ms, FlashColour? colour) =>
      colour == null ? _room : FaceRealness.answering(colour, _room);
}

/// A recording of a real person turning, facing the camera and blinking,
/// played on a tablet: the detector reads a proper turn and a proper blink.
/// Whatever the screen shows, the screen's own light drowns the flash: the
/// face gets a little brighter and no redder, greener or bluer.
class _VideoOnTablet extends _Actor {
  _VideoOnTablet(super.random, {this.sheen = 0.4});

  /// How much of the flash's colour the glossy glass gives back, in chroma
  /// units: a little, never the 1.5 skin gives.
  final double sheen;

  @override
  Face at(int ms, String? ask) {
    // The recording: straight, a turn 2 s in for a second, straight again,
    // a blink at 5 s, over and over every 8 s — so it answers each prompt
    // within a few seconds of being asked.
    final t = ms % 8000;
    if (t >= 2000 && t < 3000) return _reading(eyes: 97 + jitter(0.5), noseX: 9 + jitter(0.5), yaw: 15 + jitter(1), open: 0.95);
    if (t >= 5000 && t < 5300) return _reading(eyes: 100, noseX: jitter(0.5), yaw: jitter(1), open: 0.1);
    return _reading(eyes: 100 + jitter(0.5), noseX: jitter(0.5), yaw: jitter(1), open: 0.95);
  }

  @override
  FaceLight light(int ms, FlashColour? colour) {
    if (colour == null) return _room;
    final full = FaceRealness.answering(colour, _room);
    final share = sheen / 6;
    return FaceLight(_room.luma + 4, _room.cb + (full.cb - _room.cb) * share, _room.cr + (full.cr - _room.cr) * share);
  }
}

/// A real person doing what the prompt says, a second or so after it is
/// asked, whose skin takes each colour.
class _RealPerson extends _Actor {
  _RealPerson(super.random);
  String? _askedSince;
  int _askedAt = 0;

  @override
  Face at(int ms, String? ask) {
    if (ask != _askedSince) {
      _askedSince = ask;
      _askedAt = ms;
    }
    final doing = ms - _askedAt >= 1000;
    // One prompt covers the turn and the face back: turned from a second
    // after it is asked until two and a half, then straight again.
    final turning = doing && ms - _askedAt < 2500;
    return switch (ask) {
      'Move your head to the left, then face the camera' when turning =>
        _reading(eyes: 96 + jitter(1), noseX: 10 + jitter(1), yaw: 17 + jitter(2), open: 0.9),
      'Move your head to the left, then face the camera' => _reading(eyes: 100 + jitter(1), noseX: jitter(1), yaw: jitter(2), open: 0.9),
      'Blink now' when doing && (ms - _askedAt) % 1000 < 200 => _reading(eyes: 100, noseX: jitter(1), yaw: jitter(2), open: 0.1),
      _ => _reading(eyes: 100 + jitter(1), noseX: jitter(1), yaw: jitter(2), open: 0.9 + jitter(0.05)),
    };
  }

  @override
  FaceLight light(int ms, FlashColour? colour) {
    if (colour == null) return _room;
    final lit = FaceRealness.answering(colour, _room);
    return FaceLight(lit.luma + jitter(0.5), lit.cb + jitter(0.3), lit.cr + jitter(0.3));
  }
}

/// Runs one try: frames every 100 ms until the prompts are done, then the
/// two colour flashes (600 ms each, 300 ms apart, exactly as FaceAutoCapture
/// runs them), reading the light the actor shows. Returns the ms it took, or
/// null when the 30 s ran out with the prompts unanswered.
int? _try(FaceRealness r, _Actor actor) {
  var ms = 0;
  for (; ms < _tryMs; ms += 1000 ~/ _fps) {
    r.seeFace(actor.at(ms, r.ask), 1000, actor.light(ms, null));
    if (r.challengesDone) break;
  }
  if (!r.challengesDone) return null;
  for (var flash = 0; flash < 2; flash++) {
    final colour = r.colours[flash];
    r.flashOn(flash);
    for (var f = 0; f < 6; f++, ms += 100) {
      r.seeFace(actor.at(ms, null), 1000, actor.light(ms, colour));
    }
    r.flashOff(flash, r.litMean(_room));
    ms += 300;
  }
  return ms;
}

void main() {
  for (var seed = 1; seed <= 5; seed++) {
    test('seed $seed: a printed photo never answers the first prompt, in a whole 30 s try', () {
      final r = FaceRealness(random: Random(seed));
      expect(_try(r, _PrintedPhoto(Random(seed))), isNull);
      expect(r.turned, isFalse);
      expect(r.step, 0);
      expect(r.passed, isFalse);
    });

    test('seed $seed: a video on a tablet answers the prompts but not the flash', () {
      final r = FaceRealness(random: Random(seed));
      final took = _try(r, _VideoOnTablet(Random(seed)));
      expect(took, isNotNull, reason: 'the recording turns and blinks, so the prompts are answered');
      expect(r.challengesDone, isTrue);
      expect(r.lit, isFalse, reason: r.report);
      expect(r.passed, isFalse);
    });

    test('seed $seed: a glossier screen giving back half the colour still fails', () {
      final r = FaceRealness(random: Random(seed));
      _try(r, _VideoOnTablet(Random(seed), sheen: 1.2));
      expect(r.lit, isFalse, reason: r.report);
    });

    test('seed $seed: a real person passes within a few seconds', () {
      final r = FaceRealness(random: Random(seed));
      final took = _try(r, _RealPerson(Random(seed)));
      expect(took, isNotNull);
      expect(took!, lessThan(8000), reason: 'prompts answered a second after each ask, then two flashes');
      expect(r.lit, isTrue, reason: r.report);
      expect(r.passed, isTrue);
    });
  }

  test('what the server sees from each: the report says which colours and how much', () {
    final real = FaceRealness(random: Random(3));
    _try(real, _RealPerson(Random(3)));
    final video = FaceRealness(random: Random(3));
    _try(video, _VideoOnTablet(Random(3)));
    // Same colours (same seed): the real face moves each chroma by about 6,
    // the screen by well under 1.
    expect(real.colours, video.colours);
    expect(real.report, matches(RegExp(r'^[rgb][-+]?\d+\.\d/[-+]?\d+\.\d [rgb][-+]?\d+\.\d/[-+]?\d+\.\d$')));
    expect(video.report, matches(RegExp(r'^[rgb][-+]?\d+\.\d/[-+]?\d+\.\d [rgb][-+]?\d+\.\d/[-+]?\d+\.\d$')));
  });
}
