// The screen detector's framing and answer: the crop the model is shown is
// the face box scaled 2.7 about its centre, held inside the picture; its
// answer is the real-face probability, index 1, softmaxed if it came as logits.
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/face_id/face_spoof_check.dart';

void main() {
  test('a face in the middle: a box 2.7 times its size, around it', () {
    final box = spoofCropBox(const Rect.fromLTWH(300, 500, 120, 150), 720, 1280);
    expect(box.width, closeTo(324, 0.01));
    expect(box.height, closeTo(405, 0.01));
    expect(box.center.dx, closeTo(360, 0.01));
    expect(box.center.dy, closeTo(575, 0.01));
  });

  test('a face at the edge: the box is shifted inside, not shrunk', () {
    final box = spoofCropBox(const Rect.fromLTWH(0, 0, 120, 150), 720, 1280);
    expect(box.left, 0);
    expect(box.top, 0);
    expect(box.width, closeTo(324, 0.01));
    final far = spoofCropBox(const Rect.fromLTWH(650, 1200, 120, 150), 720, 1280);
    expect(far.right, lessThanOrEqualTo(719));
    expect(far.bottom, lessThanOrEqualTo(1279));
    expect(far.width, closeTo(324, 0.01));
  });

  test('a face filling the picture: the scale is held down so the box fits', () {
    final box = spoofCropBox(const Rect.fromLTWH(60, 100, 600, 700), 720, 1280);
    expect(box.width, lessThanOrEqualTo(719));
    expect(box.height, lessThanOrEqualTo(1279));
    expect(box.width / 600, closeTo(box.height / 700, 0.01));
  });

  test('the answer is index 1: probabilities as they are, logits softmaxed', () {
    expect(FaceSpoofCheck.realFrom([0.05, 0.9, 0.05]), closeTo(0.9, 1e-9));
    final real = FaceSpoofCheck.realFrom([1.0, 4.0, 0.5]);
    expect(real, greaterThan(0.9));
    final fake = FaceSpoofCheck.realFrom([4.0, 1.0, 0.5]);
    expect(fake, lessThan(0.1));
  });
}
