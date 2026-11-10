// The punch-out slider stays off the card for the first 30 minutes after
// punching in, and comes on by itself when the half hour is up.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/attendance/presentation/punch_out_gate.dart';

void main() {
  Widget gate(DateTime punchIn) => MaterialApp(
    home: Scaffold(
      body: PunchOutGate(
        punchIn: punchIn,
        child: const Text('Slide to Punch Out'),
      ),
    ),
  );

  testWidgets('nothing to slide within half an hour of punching in', (
    tester,
  ) async {
    await tester.pumpWidget(
      gate(DateTime.now().subtract(const Duration(minutes: 5))),
    );
    expect(find.text('Slide to Punch Out'), findsNothing);
  });

  testWidgets('the slider is there once half an hour has passed', (
    tester,
  ) async {
    await tester.pumpWidget(
      gate(DateTime.now().subtract(const Duration(minutes: 31))),
    );
    expect(find.text('Slide to Punch Out'), findsOneWidget);
  });

  testWidgets('it comes on by itself when the half hour is up', (tester) async {
    await tester.runAsync(() async {
      await tester.pumpWidget(
        gate(
          DateTime.now()
              .subtract(punchOutMinGap)
              .add(const Duration(milliseconds: 300)),
        ),
      );
      expect(find.text('Slide to Punch Out'), findsNothing);
      await Future<void>.delayed(const Duration(milliseconds: 500));
    });
    await tester.pump();
    expect(find.text('Slide to Punch Out'), findsOneWidget);
  });
}
