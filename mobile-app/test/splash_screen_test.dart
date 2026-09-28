// The launch screen is the same for every company: white, no company logo,
// "Your app is powered by" with "sowaka" under it in the brand's colour.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/auth/presentation/splash_screen.dart';
import 'package:mobile_app/features/shared/org_branding.dart';

const _brandInk = Color(0xFFB23500);

void main() {
  testWidgets("a company's launch screen carries the line, not their logo", (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(home: SplashScreen(branding: OrgBranding.of('convrse'))),
    );
    await tester.pump(SplashScreen.duration);

    expect(find.text('Your app is powered by'), findsOneWidget);
    expect(find.text('sowaka'), findsOneWidget);
    expect(find.byType(Image), findsNothing, reason: 'no company logo');

    final scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
    expect(scaffold.backgroundColor, Colors.white);

    final sowaka = tester.widget<Text>(find.text('sowaka'));
    expect(sowaka.style?.color, _brandInk);
    expect(sowaka.style?.fontFamily, 'Anton');
  });

  testWidgets('every company gets the same white screen', (tester) async {
    for (final org in ['acmt', 'convrse', 'nobody-in-particular']) {
      await tester.pumpWidget(
        MaterialApp(home: SplashScreen(branding: OrgBranding.of(org))),
      );
      await tester.pump(SplashScreen.duration);
      final scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
      expect(scaffold.backgroundColor, Colors.white, reason: org);
      expect(find.byType(Image), findsNothing, reason: org);
      final sowaka = tester.widget<Text>(find.text('sowaka'));
      expect(sowaka.style?.color, _brandInk, reason: org);
    }
  });
}
