/// How many faces a department card can show, and how they sit.
///
/// Kept apart from the widget so the arithmetic can be tested on its own: it
/// is easy to get an off-by-one here, and the failure — a "+1" bubble filling
/// the exact space the last face would have taken, or a row wider than its
/// card — only shows on one card size.
class TeamFacesLayout {
  const TeamFacesLayout({
    required this.faceCount,
    required this.rest,
    required this.step,
    this.faceSize = face,
  });

  /// How many photos are drawn.
  final int faceCount;

  /// How many people the "+N" bubble stands for. Zero means no bubble.
  final int rest;

  /// Distance from one face's left edge to the next: a gap when they all fit,
  /// an overlap when they do not.
  final double step;

  /// How wide one face is drawn: [face] on the Team tab, smaller where the
  /// same card sits inside a profile.
  final double faceSize;

  bool get overlapping => step < faceSize;

  static const double face = 56;
  static const double gap = 4;
  static const double overlap = 10;

  /// At most this many faces, however wide the card (node 2503:92493).
  static const int maxShown = 5;

  /// [width] is the card's inner width; [members] how many people are on it.
  /// [faceSize] is how wide each face is drawn; the overlap shrinks with it,
  /// so a smaller row is pulled together in the same proportion.
  factory TeamFacesLayout.forWidth(
    double width,
    int members, {
    double faceSize = face,
  }) {
    if (members <= 0) {
      return TeamFacesLayout(
        faceCount: 0,
        rest: 0,
        step: faceSize + gap,
        faceSize: faceSize,
      );
    }
    // n faces with a gap between them take (face + gap)·n − gap.
    final fitWithGap = ((width + gap) / (faceSize + gap)).floor();
    if (members <= fitWithGap && members <= maxShown) {
      return TeamFacesLayout(
        faceCount: members,
        rest: 0,
        step: faceSize + gap,
        faceSize: faceSize,
      );
    }
    // Overlapped, n items take (face − overlap)·(n − 1) + face.
    final step = faceSize - overlap * faceSize / face;
    final slots = ((width - faceSize) / step).floor() + 1;
    if (members <= slots && members <= maxShown) {
      return TeamFacesLayout(
        faceCount: members,
        rest: 0,
        step: step,
        faceSize: faceSize,
      );
    }
    // Only one circle fits: the count alone says more than a lone face.
    if (slots <= 1) {
      return TeamFacesLayout(
        faceCount: 0,
        rest: members,
        step: step,
        faceSize: faceSize,
      );
    }
    // One slot goes to the bubble.
    final faceCount = (slots - 1).clamp(1, maxShown);
    return TeamFacesLayout(
      faceCount: faceCount,
      rest: members - faceCount,
      step: step,
      faceSize: faceSize,
    );
  }

  /// The width the row actually needs, for the overflow check.
  double get width => faceCount + rest.clamp(0, 1) == 0
      ? 0
      : step * (faceCount + rest.clamp(0, 1) - 1) + faceSize;
}
