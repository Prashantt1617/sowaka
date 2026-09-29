import 'dart:math';
import 'dart:ui';

import '../data/garden_models.dart';

/// Where everything stands in the garden.
///
/// The meadow is a tall canvas the person pans and zooms. Trees sit on a
/// loose grid, three across, with a little seeded jitter so it reads as a
/// garden rather than a car park, and the viewer's own tree is placed at the
/// middle so "me" has somewhere to go. Pure and deterministic: the same
/// people give the same garden every time.
class GardenLayout {
  GardenLayout._({required this.worldSize, required this.plots, required this.decor});

  final Size worldSize;
  final List<TreePlot> plots;
  final List<Decor> decor;

  static const columns = 3;

  /// How far apart trees stand. Close enough to feel like one garden.
  static const spacingX = 168.0;
  static const spacingY = 196.0;
  static const treeWidth = 112.0;
  static const padding = 70.0;

  static GardenLayout build(List<GardenPerson> people) {
    // Alphabetical, then the viewer swapped into the middle slot.
    final ordered = [...people]..sort((a, b) => a.name.compareTo(b.name));
    final meIndex = ordered.indexWhere((p) => p.isMe);
    if (meIndex >= 0 && ordered.length > 1) {
      final middle = (ordered.length / 2).floor();
      final me = ordered.removeAt(meIndex);
      ordered.insert(middle, me);
    }
    final rows = max(1, (ordered.length / columns).ceil());
    final size = Size(
      padding * 2 + (columns - 1) * spacingX + treeWidth,
      padding * 2 + rows * spacingY + 40,
    );
    final plots = <TreePlot>[];
    for (var i = 0; i < ordered.length; i++) {
      final col = i % columns, row = i ~/ columns;
      // Odd rows shift half a step, so the eye reads diagonals, not columns.
      final shift = row.isOdd ? spacingX * 0.45 : 0.0;
      final r = _Rng(i * 7919 + 17);
      final x = padding + treeWidth / 2 + col * spacingX + shift + (r.next() - .5) * 26;
      final y = padding + spacingY * (row + 1) + (r.next() - .5) * 28;
      plots.add(TreePlot(person: ordered[i], foot: Offset(x.clamp(treeWidth / 2 + 8, size.width - treeWidth / 2 - 8), y)));
    }
    // Beds, bushes and stones in the gaps. Seeded from the count so a garden
    // that grows by one person keeps most of its furniture where it was.
    final r = _Rng(people.length * 31 + 5);
    final decor = <Decor>[];
    for (var i = 0; i < rows * 2 + 2; i++) {
      decor.add(Decor(
        kind: [DecorKind.bed, DecorKind.bush, DecorKind.bush, DecorKind.stone, DecorKind.bench][i % 5],
        at: Offset(24 + r.next() * (size.width - 48), padding * 0.6 + r.next() * (size.height - padding)),
        seed: i,
      ));
    }
    return GardenLayout._(worldSize: size, plots: plots, decor: decor);
  }

  TreePlot? plotOf(String userId) => plots.where((p) => p.person.userId == userId).firstOrNull;
}

class TreePlot {
  const TreePlot({required this.person, required this.foot});

  final GardenPerson person;

  /// Where the trunk meets the ground.
  final Offset foot;
}

enum DecorKind { bed, bush, stone, bench }

class Decor {
  const Decor({required this.kind, required this.at, required this.seed});

  final DecorKind kind;
  final Offset at;
  final int seed;
}

/// Where a note's sprite sits on a canopy, from the note's id alone, so it
/// never moves between opens. Returned in unit coordinates of the canopy
/// ellipse: (0,0) is its centre, radius 1 its edge.
Offset spritePlace(String noteId) {
  var h = 2166136261;
  for (final unit in noteId.codeUnits) {
    h = ((h ^ unit) * 16777619) & 0xffffffff;
  }
  final r = _Rng(h);
  final angle = r.next() * pi * 2;
  final dist = 0.15 + sqrt(r.next()) * 0.78;
  return Offset(cos(angle) * dist, sin(angle) * dist);
}

/// A tiny deterministic generator. Dart's Random is seeded too, but its
/// sequence is not promised to stay the same across SDK versions; this one is
/// ours and never changes.
class _Rng {
  _Rng(int seed) : _s = seed & 0xffffffff;
  int _s;

  double next() {
    _s = (_s * 1664525 + 1013904223) & 0xffffffff;
    return _s / 4294967296;
  }
}
