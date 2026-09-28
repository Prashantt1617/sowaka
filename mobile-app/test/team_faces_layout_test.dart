// The row of faces on a department card. The card is indented under the
// trunk, so five faces do not always fit; what must never happen is a row
// wider than its card, or a "+1" bubble filling the very place the last
// face could have taken.
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/manage/presentation/team_faces_layout.dart';

void main() {
  const widths = [400.0, 320.0, 300.0, 296.5, 240.0, 200.0, 120.0, 56.0];

  test('a row never grows wider than the card it sits in', () {
    for (final width in widths) {
      for (var members = 0; members <= 12; members++) {
        final layout = TeamFacesLayout.forWidth(width, members);
        expect(
          layout.width,
          lessThanOrEqualTo(width + 0.001),
          reason: '$members faces in ${width}pt took ${layout.width}pt',
        );
      }
    }
  });

  test('every person is accounted for, as a face or in the count', () {
    for (final width in widths) {
      for (var members = 0; members <= 12; members++) {
        final layout = TeamFacesLayout.forWidth(width, members);
        expect(layout.faceCount + layout.rest, members);
        expect(layout.faceCount, isNonNegative);
        expect(layout.rest, isNonNegative);
      }
    }
  });

  test('a "+1" never stands where the face itself would fit', () {
    for (final width in widths) {
      for (var members = 0; members <= 12; members++) {
        final layout = TeamFacesLayout.forWidth(width, members);
        // Five faces then a count is the design; a "+1" is only wasteful
        // when it was the card's width, not the cap, that cut the row short.
        if (layout.faceCount >= TeamFacesLayout.maxShown) continue;
        expect(layout.rest, isNot(1), reason: '${width}pt, $members members');
      }
    }
  });

  test('faces are never pulled over each other when they all fit', () {
    final layout = TeamFacesLayout.forWidth(400, 4);
    expect(layout.overlapping, isFalse);
    expect(layout.faceCount, 4);
    expect(layout.rest, 0);
  });

  test('a crowded card overlaps and counts the rest', () {
    // The width a department card gets on a phone, indented under the trunk.
    final layout = TeamFacesLayout.forWidth(296.5, 9);
    expect(layout.overlapping, isTrue);
    expect(layout.faceCount, greaterThan(0));
    expect(layout.faceCount + layout.rest, 9);
  });

  test('five is the most ever drawn, however wide the card', () {
    final layout = TeamFacesLayout.forWidth(2000, 30);
    expect(layout.faceCount, lessThanOrEqualTo(TeamFacesLayout.maxShown));
  });

  test('an empty team draws nothing', () {
    final layout = TeamFacesLayout.forWidth(300, 0);
    expect(layout.faceCount, 0);
    expect(layout.rest, 0);
    expect(layout.width, 0);
  });
}
