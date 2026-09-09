import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/shared/image_crop_sheet.dart';

/// Where a point in child (contain) space lands in the frame after the crop's
/// opening transform — the check that the photo really fills the frame.
Offset mapped(Matrix4 m, Offset p) => MatrixUtils.transformPoint(m, p);

void main() {
  // A 400x400 square crop frame, the profile-photo case.
  const frame = Size(400, 400);

  /// Under BoxFit.contain the photo is centred and letterboxed inside `frame`.
  Rect contained(double aspect, Size frame) {
    final frameAspect = frame.width / frame.height;
    if (aspect > frameAspect) {
      final h = frame.width / aspect;
      return Rect.fromLTWH(0, (frame.height - h) / 2, frame.width, h);
    }
    final w = frame.height * aspect;
    return Rect.fromLTWH((frame.width - w) / 2, 0, w, frame.height);
  }

  void expectFills(double aspect, Size frame, String label) {
    final m = coverTransform(aspect, frame);
    final box = contained(aspect, frame);
    final topLeft = mapped(m, box.topLeft);
    final bottomRight = mapped(m, box.bottomRight);
    // Every edge of the frame must be covered by the photo.
    expect(topLeft.dx, lessThanOrEqualTo(0.01), reason: '$label: left edge');
    expect(topLeft.dy, lessThanOrEqualTo(0.01), reason: '$label: top edge');
    expect(bottomRight.dx, greaterThanOrEqualTo(frame.width - 0.01), reason: '$label: right edge');
    expect(bottomRight.dy, greaterThanOrEqualTo(frame.height - 0.01), reason: '$label: bottom edge');
    // And it must be centred: equal overhang on opposite sides.
    expect(topLeft.dx + (bottomRight.dx - frame.width), closeTo(0, 0.01), reason: '$label: centred x');
    expect(topLeft.dy + (bottomRight.dy - frame.height), closeTo(0, 0.01), reason: '$label: centred y');
  }

  test('a square frame is filled by any source shape', () {
    expectFills(16 / 9, frame, 'landscape into square');
    expectFills(9 / 16, frame, 'portrait into square');
    expectFills(1, frame, 'square into square');
    expectFills(3, frame, 'panorama into square');
  });

  test('a landscape frame is filled by any source shape', () {
    const wide = Size(480, 270);
    expectFills(16 / 9, wide, 'landscape into landscape');
    expectFills(9 / 16, wide, 'portrait into landscape');
    expectFills(1, wide, 'square into landscape');
  });

  test('a portrait frame is filled by any source shape', () {
    const tall = Size(320, 400);
    expectFills(16 / 9, tall, 'landscape into portrait');
    expectFills(9 / 16, tall, 'portrait into portrait');
  });

  test('the zoom is never below 1 — a fill is never a shrink', () {
    for (final aspect in [0.2, 0.5, 1.0, 1.5, 4.0]) {
      for (final f in [frame, const Size(480, 270), const Size(320, 400)]) {
        expect(coverScaleFor(aspect, f.width / f.height), greaterThanOrEqualTo(1.0),
            reason: 'aspect $aspect into $f');
      }
    }
  });
}
