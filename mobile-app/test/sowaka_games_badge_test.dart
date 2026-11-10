// The game screen's own header wears the Sowaka GAMES lockup beside the back
// arrow, sized like the pages' (28.577 units at 22 tall).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/games/presentation/sowaka_games_badge.dart';

void main() {
  testWidgets('the lockup reads Sowaka Games and keeps the pages\' size', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: Center(child: SowakaGamesBadge())),
      ),
    );
    expect(find.text('sowaka'), findsOneWidget);
    expect(find.text('GAMES'), findsOneWidget);
    expect(find.bySemanticsLabel('Sowaka Games'), findsOneWidget);
    final size = tester.getSize(find.byType(SowakaGamesBadge));
    expect(size.height, closeTo(22, 1.5));
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'it fits an app bar beside the back arrow with a long game name',
    (tester) async {
      tester.view.physicalSize = const Size(360 * 3, 640 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            appBar: AppBar(
              leading: const BackButton(),
              titleSpacing: 0,
              title: const Row(
                children: [
                  SowakaGamesBadge(),
                  SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      'A very long game name that has to be cut short',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              actions: [
                IconButton(
                  onPressed: () {},
                  icon: const Icon(Icons.help_outline_rounded),
                ),
              ],
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      expect(find.byType(SowakaGamesBadge), findsOneWidget);
    },
  );
}
