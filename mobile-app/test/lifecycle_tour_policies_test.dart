// The Sowaka tour's lessons (New joiner canvas, AppLesson): each lesson's
// drawing filled in from the joiner's own record, plainly when not known.
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/tour_lessons.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';

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

  test('a lesson\'s drawing is filled in from the joiner\'s record', () {
    final facts = TourFacts(
      today: DateTime(2026, 12, 16),
      managerName: 'Sunny Kapoor',
      casual: _balance.casual.remaining,
      sick: _balance.sick.remaining,
      earned: _balance.earned.remaining,
    );
    final missed = facts.apply(joinerTourLessons[1]);
    expect((missed.blocks[3] as TourRow).title, 'Sent to Sunny');
    final leave = facts.apply(joinerTourLessons[2]);
    expect((leave.blocks[0] as TourChips).chips.map((c) => c.$1), ['6', '4', '1.5']);
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
