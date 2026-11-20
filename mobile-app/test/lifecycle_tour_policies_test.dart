// The Sowaka tour (new-joiner canvas: OnbTour, TourLesson, TourLessonDone):
// the list with Today / Day n / Done and Start / Play / Replay, "For
// managers" only when the server says the joiner manages anyone, and each
// lesson's drawing filled in from the joiner's own record.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_kit.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_tiles.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/tour_lessons.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';

class _NoApi implements OnboardingApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

OnboardingShell _shell() => OnboardingShell(
  api: _NoApi(),
  profileAction: const SizedBox(width: 30, height: 30),
  onNotifications: () {},
  viewerName: 'Isha Verma',
  now: () => DateTime(2026, 12, 16, 10),
);

const _balance = LeaveBalance(
  year: 2026,
  casual: LeaveBalanceItem(remaining: 6, total: 12),
  sick: LeaveBalanceItem(remaining: 4, total: 6),
  earned: LeaveBalanceItem(remaining: 1.5, total: 15),
);

void main() {
  test('the home reads the tour and policy counts from the server', () {
    final home = OnboardingHome.fromJson({
      'journeyId': 'j1',
      'tour': {'lessons': ['punch', 'missed', 'leave', 'overtime'], 'managerLessons': ['approveLeave', 'approveOvertime'], 'done': ['punch']},
      'policies': {'required': 3, 'acknowledged': 1, 'toAcknowledge': 2},
    });
    expect(home.tourDone, ['punch']);
    expect(home.tourForManager, isTrue);
    expect(home.policyCounts, (required: 3, acknowledged: 1, toAcknowledge: 2));
    final plain = OnboardingHome.fromJson({'journeyId': 'j1', 'tour': {'done': <String>[]}});
    expect(plain.tourForManager, isFalse);
    expect(plain.policyCounts, isNull);
  });

  testWidgets('the tour list: today first, play ahead, replay, and For managers only for a manager', (tester) async {
    await tester.pumpWidget(MaterialApp(home: OnbTourScreen(shell: _shell(), done: const ['punch'])));
    await tester.pumpAndSettle();
    expect(find.text('1 of 4 done'), findsOneWidget);
    expect(find.text('Done · 1 min'), findsOneWidget);
    expect(find.text('Replay'), findsOneWidget);
    expect(find.text('Today · 1 min'), findsOneWidget);
    expect(find.text('Start'), findsOneWidget);
    expect(find.text('Day 3 · 2 min'), findsOneWidget);
    expect(find.text('Day 4 · 1 min'), findsOneWidget);
    expect(find.text('Play'), findsNWidgets(2));
    expect(find.text('For managers'), findsNothing);
    expect(find.text('Approving leave'), findsNothing);

    await tester.pumpWidget(MaterialApp(home: OnbTourScreen(shell: _shell(), done: const ['punch'], forManager: true)));
    await tester.pumpAndSettle();
    expect(find.text('For managers'), findsOneWidget);
    expect(find.text('Approving leave'), findsOneWidget);
    expect(find.text('Approving overtime'), findsOneWidget);
  });

  testWidgets('a lesson\'s drawing is filled in from the joiner\'s record', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: OnbTourScreen(shell: _shell(), done: const ['punch', 'missed'], managerName: 'Meera Iyer', leaveBalance: () async => _balance),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('lesson-leave')));
    await tester.pumpAndSettle();
    expect(find.text('Leave policy and applying for leave'), findsOneWidget);
    // The balance the server keeps, not a drawn one.
    expect(find.text('6'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
    expect(find.text('1.5'), findsOneWidget);
    expect(find.text('18 – 19 Dec'), findsOneWidget);
    expect(find.text('Send to Meera'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('lesson-next')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('lesson-next')));
    await tester.pumpAndSettle();
    expect(find.text('Meera gets it straight away.'), findsOneWidget);
  });

  test('without a manager or a balance, the drawing says so plainly', () {
    final facts = TourFacts(today: DateTime(2026, 12, 16));
    final missed = facts.apply(joinerTourLessons[1]);
    expect((missed.blocks[0] as TourCard).meta, 'December');
    expect((missed.blocks[1] as TourRow).title, '15 December');
    expect((missed.blocks[3] as TourRow).title, 'Sent to your manager');
    final leave = facts.apply(joinerTourLessons[2]);
    expect((leave.blocks[0] as TourChips).chips.first, ('—', 'Casual'));
    expect(leave.steps.last.text, 'Your manager gets it straight away.');
    expect((facts.apply(joinerTourLessons[0]).blocks[0] as TourCard).meta, '16 December');
  });
}
