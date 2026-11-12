// The game screen's own header wears the Sowaka GAMES lockup at its right end,
// sized like the pages' (28.577 units at 22 tall), and GAMES is never cut.
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
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
    'top right of an app bar with a long game name, GAMES shown whole',
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
              title: const Text(
                'A very long game name that has to be cut short',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              actions: [
                IconButton(
                  onPressed: () {},
                  icon: const Icon(Icons.help_outline_rounded),
                ),
                const Padding(
                  padding: EdgeInsets.only(left: 2, right: 14),
                  child: Center(child: SowakaGamesBadge()),
                ),
              ],
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      final badge = tester.getRect(find.byType(SowakaGamesBadge));
      expect(badge.right, greaterThan(360 - 30));
      // The tag is as wide as its word: nothing ellipsised or clipped.
      final games = tester.renderObject<RenderParagraph>(find.text('GAMES'));
      expect(games.didExceedMaxLines, isFalse);
      expect(tester.getRect(find.text('GAMES')).right, lessThanOrEqualTo(360));
    },
  );
}
