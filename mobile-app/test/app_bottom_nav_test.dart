// The bottom bar: the company's tabs in its order, the open one raised on
// the yellow key (Figma BottomNav, as the Games frames draw it), and a tap
// asking for that tab.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/features/manager_shell/presentation/app_bottom_nav.dart';

void main() {
  Widget host(List<ManagerTab> tabs, ManagerTab selected, ValueChanged<ManagerTab> onSelect) =>
      MaterialApp(
        home: Scaffold(
          bottomNavigationBar: AppBottomNav(tabs: tabs, selected: selected, onSelect: onSelect),
        ),
      );

  Finder keyIn(ManagerTab tab) => find.descendant(
    of: find.byKey(ValueKey('nav-${tab.name}')),
    matching: find.byKey(const ValueKey('nav-selected-key')),
  );

  testWidgets('the company’s tabs, in its order, the open one on the yellow key', (tester) async {
    final tabs = visibleTabs(const ['connect', 'team', 'actions', 'games']);
    final asked = <ManagerTab>[];
    await tester.pumpWidget(host(tabs, ManagerTab.games, asked.add));

    expect(tabs, [ManagerTab.connect, ManagerTab.manage, ManagerTab.quick, ManagerTab.games]);
    final labels = tester.widgetList<Text>(find.byType(Text)).map((text) => text.data).toList();
    expect(labels, ['Connect', 'Teams', 'Actions', 'Games']);

    // Exactly one key, on Games; its label in the brand blue, the rest grey.
    expect(find.byKey(const ValueKey('nav-selected-key')), findsOneWidget);
    expect(keyIn(ManagerTab.games), findsOneWidget);
    final key = tester.widget<Container>(find.byKey(const ValueKey('nav-selected-key')));
    expect((key.decoration! as BoxDecoration).color, AppNavItem.keyColor);
    expect(tester.widget<Text>(find.text('Games')).style!.color, AppNavItem.selectedColor);
    expect(tester.widget<Text>(find.text('Connect')).style!.color, AppNavItem.idleColor);
    expect(
      tester.getSemantics(find.byKey(const ValueKey('nav-games'))),
      matchesSemantics(
        label: 'Games',
        isButton: true,
        isSelected: true,
        hasSelectedState: true,
        hasTapAction: true,
      ),
    );

    await tester.tap(find.text('Teams'));
    expect(asked, [ManagerTab.manage]);

    // Another tab open: the key moves with it.
    await tester.pumpWidget(host(tabs, ManagerTab.connect, asked.add));
    expect(keyIn(ManagerTab.connect), findsOneWidget);
    expect(keyIn(ManagerTab.games), findsNothing);
    expect(tester.widget<Text>(find.text('Games')).style!.color, AppNavItem.idleColor);
  });

  testWidgets('a company without Games has no Games tab', (tester) async {
    final tabs = visibleTabs(const ['connect', 'team', 'grow', 'actions', 'care', 'talk']);
    await tester.pumpWidget(host(tabs, ManagerTab.connect, (_) {}));
    expect(find.text('Games'), findsNothing);
    expect(find.byType(AppNavItem), findsNWidgets(6));
    expect(keyIn(ManagerTab.connect), findsOneWidget);
  });
}
