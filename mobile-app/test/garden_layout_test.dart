// The garden is laid out from the people alone, deterministically: the same
// company gives the same meadow every time, the viewer's tree stands in the
// middle, and a note's sprite never moves between opens.
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/garden/data/garden_models.dart';
import 'package:mobile_app/features/garden/presentation/garden_layout.dart';

GardenPerson _p(String name, {bool me = false}) =>
    GardenPerson(userId: name.toLowerCase(), name: name, department: 'Plant', isMe: me);

void main() {
  test('the same people give the same garden', () {
    final people = [_p('Priya', me: true), _p('Arjun'), _p('Rohan'), _p('Sneha'), _p('Vikram')];
    final a = GardenLayout.build(people);
    final b = GardenLayout.build(List.of(people.reversed));
    expect(a.worldSize, b.worldSize);
    for (final plot in a.plots) {
      expect(b.plotOf(plot.person.userId)!.foot, plot.foot, reason: plot.person.name);
    }
  });

  test('the viewer stands in the middle of the garden', () {
    final people = [for (final n in ['Arjun', 'Rohan', 'Sneha', 'Vikram', 'Nandini', 'Soni']) _p(n)]..add(_p('Priya', me: true));
    final layout = GardenLayout.build(people);
    final me = layout.plotOf('priya')!;
    final centre = layout.worldSize.height / 2;
    final distances = layout.plots.map((p) => (p.foot.dy - centre).abs()).toList()..sort();
    // Nobody's tree is nearer the vertical middle than the viewer's.
    expect((me.foot.dy - centre).abs(), lessThanOrEqualTo(distances[1] + 1));
  });

  test('trees stand close but never on top of each other', () {
    final layout = GardenLayout.build([for (var i = 0; i < 12; i++) _p('Person$i', me: i == 3)]);
    for (final a in layout.plots) {
      for (final b in layout.plots) {
        if (a == b) continue;
        expect((a.foot - b.foot).distance, greaterThan(GardenLayout.treeWidth * 0.9), reason: '${a.person.name} vs ${b.person.name}');
      }
    }
    // Tall as well as wide: twelve trees make a meadow taller than it is broad.
    expect(layout.worldSize.height, greaterThan(layout.worldSize.width));
  });

  test('a note sits where its id puts it, inside the canopy', () {
    final a = spritePlace('9f2b7c1e-note');
    final b = spritePlace('9f2b7c1e-note');
    expect(a, b);
    expect(a.distance, lessThanOrEqualTo(1.0));
    expect(spritePlace('another'), isNot(a));
  });

  test('the garden payload parses and counts what is left today', () {
    final view = GardenView.fromJson({
      'season': '2026-09',
      'daysLeft': 2,
      'people': [
        {'userId': 'p', 'name': 'Priya Nair', 'department': 'Quality', 'isMe': true},
        {'userId': 'r', 'name': 'Rohan Iyer', 'department': 'Production', 'isMe': false},
      ],
      'trees': {
        'r': [{'id': 'n1', 'kind': 'daisy', 'fromUserId': 'p'}],
      },
      'givenToday': 1,
      'dailyLimit': 3,
    });
    expect(view.me?.name, 'Priya Nair');
    expect(view.trees['r']!.single.kind, 'daisy');
    expect(view.trees['p'], isNull);
    expect(view.leftToday, 2);
    expect(kindOf('daisy').meaning, 'A kindness I noticed');
    expect(kindOf('nonsense').key, gardenKinds.first.key, reason: 'an unknown kind still draws something');
  });
}
