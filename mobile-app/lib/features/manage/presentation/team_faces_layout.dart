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
  });

  /// How many photos are drawn.
  final int faceCount;

  /// How many people the "+N" bubble stands for. Zero means no bubble.
  final int rest;

  /// Distance from one face's left edge to the next: a gap when they all fit,
  /// an overlap when they do not.
  final double step;

  bool get overlapping => step < face;

  static const double face = 56;
  static const double gap = 4;
  static const double overlap = 10;

  /// At most this many faces, however wide the card (node 2503:92493).
  static const int maxShown = 5;

  /// [width] is the card's inner width; [members] how many people are on it.
  factory TeamFacesLayout.forWidth(double width, int members) {
    if (members <= 0) {
      return const TeamFacesLayout(faceCount: 0, rest: 0, step: face + gap);
    }
    // n faces with a gap between them take (face + gap)·n − gap.
    final fitWithGap = ((width + gap) / (face + gap)).floor();
    if (members <= fitWithGap && members <= maxShown) {
      return TeamFacesLayout(faceCount: members, rest: 0, step: face + gap);
    }
    // Overlapped, n items take (face − overlap)·(n − 1) + face.
    final step = face - overlap;
    final slots = ((width - face) / step).floor() + 1;
    if (members <= slots && members <= maxShown) {
      return TeamFacesLayout(faceCount: members, rest: 0, step: step);
    }
    // Only one circle fits: the count alone says more than a lone face.
    if (slots <= 1) {
      return TeamFacesLayout(faceCount: 0, rest: members, step: step);
    }
    // One slot goes to the bubble.
    final faceCount = (slots - 1).clamp(1, maxShown);
    return TeamFacesLayout(
      faceCount: faceCount,
      rest: members - faceCount,
      step: step,
    );
  }

  /// The width the row actually needs, for the overflow check.
  double get width => faceCount + rest.clamp(0, 1) == 0
      ? 0
      : step * (faceCount + rest.clamp(0, 1) - 1) + face;
}
