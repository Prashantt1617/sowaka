// What a selfie must be before the light check and the send, read off the
// last frame: the face big enough, lit between too dark and too bright,
// the head facing the camera, the picture sharp. Each refusal is a short
// word for the person and a line in the try's log; a sharp, well-lit face
// passes with its numbers logged. Also the server's challenge: how its
// colours are read and used, and the tones a test can listen for.
import 'dart:typed_data';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/face_id/face_camera.dart';
import 'package:mobile_app/features/face_id/face_sounds.dart';

/// A 320×320 BGRA frame, mid grey, with a face-sized square at [box] that is
/// either a sharp checkerboard or flat grey.
FaceFrame _frame(Rect box, {required bool sharp}) {
  const side = 320;
  final bytes = Uint8List(side * side * 4);
  for (var y = 0; y < side; y++) {
    for (var x = 0; x < side; x++) {
      var v = 120;
      if (box.contains(Offset(x.toDouble(), y.toDouble())) && sharp) v = ((x ~/ 4) + (y ~/ 4)).isEven ? 40 : 200;
      final i = (y * side + x) * 4;
      bytes[i] = v;
      bytes[i + 1] = v;
      bytes[i + 2] = v;
      bytes[i + 3] = 255;
    }
  }
  return FaceFrame(bytes: bytes, width: side, height: side, stride: side * 4, bgra: true, rotation: 0);
}

const _big = Rect.fromLTWH(80, 60, 160, 200);
const _ok = FaceLight(110, 128, 132);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('a camera with no frame has nothing to fault', () async {
    final camera = FaceCamera();
    expect(await camera.captureQuality(), isNull);
  });

  test('a face too small, too dark, too bright or turned away is told so, once per word', () async {
    final camera = FaceCamera();
    camera.liveness.setLight(_ok);
    camera.seeFrame(_frame(const Rect.fromLTWH(120, 120, 80, 100), sharp: true), const Rect.fromLTWH(120, 120, 80, 100));
    expect(await camera.captureQuality(), 'Move a little closer');
    expect(camera.nudgeNow, 'Move a little closer');

    camera.seeFrame(_frame(_big, sharp: true), _big);
    camera.liveness.setLight(const FaceLight(25, 128, 128));
    expect(await camera.captureQuality(), "It's too dark: face a light");
    camera.liveness.setLight(const FaceLight(230, 128, 128));
    expect(await camera.captureQuality(), 'Too bright here: turn away from the light');

    camera.liveness.setLight(_ok);
    camera.liveness.yawFromStart = 22;
    expect(await camera.captureQuality(), 'Face the camera');
    camera.liveness.yawFromStart = 0;

    // Each refusal is logged once with its measurement.
    expect(camera.events.where((e) => e.contains('quality small 80px')), hasLength(1));
    expect(camera.events.where((e) => e.contains('quality dark L25')), hasLength(1));
    expect(camera.events.where((e) => e.contains('quality bright L230')), hasLength(1));
    expect(camera.events.where((e) => e.contains('quality turned 22°')), hasLength(1));
  });

  test('a flat, blurred face is held back; a sharp one passes with its numbers logged', () async {
    final camera = FaceCamera();
    camera.liveness.setLight(_ok);
    camera.seeFrame(_frame(_big, sharp: false), _big);
    expect(await camera.captureQuality(), 'Hold the phone still');
    expect(camera.events.last, matches(RegExp(r'quality blur=\d+ L110 160px$')));

    camera.seeFrame(_frame(_big, sharp: true), _big);
    expect(await camera.captureQuality(), isNull);
    expect(camera.events.last, matches(RegExp(r'quality ok blur=\d+ L110 160px$')));
    final blur = int.parse(RegExp(r'blur=(\d+)').firstMatch(camera.events.last)!.group(1)!);
    expect(blur, greaterThan(FaceCamera.blurFloor));
  });

  test("the server's challenge: two different colours by name, else nothing", () {
    expect(FaceChallenge.fromJson({'id': 'c1', 'colours': ['red', 'blue']})?.colours, [FlashColour.red, FlashColour.blue]);
    expect(FaceChallenge.fromJson({'id': 'c1', 'colours': ['Red', ' GREEN ']})?.colours, [FlashColour.red, FlashColour.green]);
    expect(FaceChallenge.fromJson({'id': 'c1', 'colours': ['red', 'red']}), isNull);
    expect(FaceChallenge.fromJson({'id': 'c1', 'colours': ['red']}), isNull);
    expect(FaceChallenge.fromJson({'id': 'c1', 'colours': ['red', 'pink']}), isNull);
    expect(FaceChallenge.fromJson({'id': '', 'colours': ['red', 'blue']}), isNull);
    expect(FaceChallenge.fromJson({'colours': ['red', 'blue']}), isNull);
  });

  test("the server's colours replace the phone's pick, and a reset picks afresh", () {
    final r = FaceRealness();
    r.useColours([FlashColour.green, FlashColour.red]);
    expect(r.colours, [FlashColour.green, FlashColour.red]);
    r.useColours([FlashColour.red, FlashColour.red]);
    expect(r.colours, [FlashColour.green, FlashColour.red], reason: 'two the same is not a challenge');
    r.reset();
    expect(r.colours, hasLength(2));
    expect(r.colours[0] == r.colours[1], isFalse);
  });

  test('the tones: each asks for its own sound, and none when turned off', () async {
    final played = <String>[];
    final before = FaceSounds.play;
    FaceSounds.play = (asset) async => played.add(asset);
    addTearDown(() => FaceSounds.play = before);
    await FaceSounds.prompt();
    await FaceSounds.step();
    await FaceSounds.done();
    await FaceSounds.failed();
    expect(played, ['sounds/face_prompt.wav', 'sounds/face_step.wav', 'sounds/face_done.wav', 'sounds/face_fail.wav']);
    FaceSounds.enabled = false;
    addTearDown(() => FaceSounds.enabled = true);
    await FaceSounds.prompt();
    expect(played, hasLength(4));
  });
}
