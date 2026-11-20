import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/tour_lessons.dart';
import 'package:mobile_app/features/policies/data/policies_models.dart';
import 'package:mobile_app/features/policies/presentation/policies_ack_screen.dart';

PolicyDocument _p(String key, String title, {int version = 1, int? acked, bool req = true, String note = ''}) => PolicyDocument(
  key: key,
  title: title,
  body: '## Purpose\nWhy it exists.\n\n- One\n- Two',
  version: version,
  ackRequired: req,
  readMinutes: 3,
  changeNote: note,
  acknowledgedVersion: acked,
  acknowledgedAt: acked == null ? null : DateTime(2026, 12, 15),
);

class _Fake implements PoliciesSource {
  _Fake(this.list);
  List<PolicyDocument> list;
  final acks = <String>[];

  @override
  Future<List<PolicyDocument>?> cached() async => null;

  @override
  Future<List<PolicyDocument>> load() async => list;

  @override
  Future<List<PolicyDocument>> acknowledge(String key, int version) async {
    acks.add('$key@$version');
    list = [
      for (final p in list)
        p.key == key ? _p(p.key, p.title, version: p.version, acked: version, req: p.ackRequired, note: p.changeNote) : p,
    ];
    return list;
  }
}

void main() {
  testWidgets('lists pills, reads a policy, and acknowledges it once ticked', (tester) async {
    final source = _Fake([
      _p('conduct', 'Code of conduct', version: 2),
      _p('leave', 'Leave', version: 3, acked: 2, note: 'Casual leave goes up from 6 to 8 days a year.'),
      _p('devices', 'Using company devices', acked: 1),
      _p('travel', 'Travel and expenses', req: false),
    ]);
    await tester.pumpWidget(MaterialApp(home: PoliciesAckScreen(source: source)));
    await tester.pumpAndSettle();

    expect(find.text('2 to acknowledge'), findsOneWidget);
    expect(find.text('Acknowledge'), findsOneWidget);
    expect(find.text('Updated'), findsOneWidget);
    expect(find.text('Acknowledged'), findsOneWidget);
    expect(find.text('Read'), findsOneWidget);
    expect(find.text('Acknowledged 15 Dec 2026'), findsOneWidget);

    // The updated one shows what changed and asks for the update.
    await tester.tap(find.byKey(const ValueKey('policy-leave')));
    await tester.pumpAndSettle();
    expect(find.text('What changed'), findsOneWidget);
    expect(find.text('I’ve read what changed'), findsOneWidget);
    expect(find.text('Acknowledge the update'), findsOneWidget);

    // Disabled until ticked.
    await tester.tap(find.byKey(const ValueKey('policy-ack')));
    await tester.pump();
    expect(source.acks, isEmpty);
    await tester.tap(find.byKey(const ValueKey('policy-agree')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('policy-ack')));
    await tester.pumpAndSettle();
    expect(source.acks, ['leave@3']);
    expect(find.text('Acknowledged today'), findsOneWidget);

    // Back to the list: one left.
    await tester.tap(find.bySemanticsLabel('Back'));
    await tester.pumpAndSettle();
    expect(find.text('1 to acknowledge'), findsOneWidget);

    // A read-only policy can be acknowledged too (the canvas draws the tick
    // on every policy), but it never counted.
    await tester.tap(find.byKey(const ValueKey('policy-travel')));
    await tester.pumpAndSettle();
    expect(find.text('I’ve read this policy'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('policy-agree')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('policy-ack')));
    await tester.pumpAndSettle();
    expect(source.acks, ['leave@3', 'travel@1']);
    await tester.tap(find.bySemanticsLabel('Back'));
    await tester.pumpAndSettle();
    expect(find.text('1 to acknowledge'), findsOneWidget);
  });

  testWidgets('a joiner reads a later version as it is: no "what changed"', (tester) async {
    final source = _Fake([_p('leave', 'Leave policy', version: 2, note: 'Casual leave goes up.')]);
    await tester.pumpWidget(MaterialApp(home: PoliciesAckScreen(source: source, openKey: 'leave')));
    await tester.pumpAndSettle();
    expect(find.text('Leave policy'), findsOneWidget);
    expect(find.text('Version 2 · 3 min read'), findsOneWidget);
    expect(find.text('What changed'), findsNothing);
    expect(find.text('I’ve read this policy'), findsOneWidget);
    expect(find.text('Acknowledge'), findsOneWidget);
  });

  testWidgets('from Actions, a company with no policies any more closes it for the built-in ones', (tester) async {
    var emptied = false;
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => TextButton(
          onPressed: () => Navigator.of(context).push<void>(MaterialPageRoute(
            builder: (_) => PoliciesAckScreen(source: _Fake(const []), onEmpty: () => emptied = true),
          )),
          child: const Text('open'),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(emptied, isTrue);
    expect(find.byType(PoliciesAckScreen), findsNothing);
  });

  test('the counts are the server\'s, else counted by the same rule', () {
    final list = [_p('a', 'A'), _p('b', 'B', acked: 1), _p('c', 'C', version: 2, acked: 1), _p('d', 'D', req: false)];
    final local = PolicyAckCounts.fromJson(const {}, list);
    expect([local.required, local.acknowledged, local.toAcknowledge], [3, 1, 2]);
    final server = PolicyAckCounts.fromJson(const {'required': 5, 'acknowledged': 2, 'toAcknowledge': 3}, list);
    expect(server.toAcknowledge, 3);
  });

  testWidgets('a tour lesson steps through and reports done once', (tester) async {
    final done = <String>[];
    await tester.pumpWidget(MaterialApp(
      home: TourLessonScreen(lesson: joinerTourLessons[1], onDone: (k) async => done.add(k)),
    ));
    expect(find.text('Step 1 of 3'), findsOneWidget);
    expect(find.text('Spot the missed punch'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('lesson-next')));
    await tester.pumpAndSettle();
    expect(find.text('Step 2 of 3'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('lesson-next')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    expect(find.text('You’ve got it'), findsOneWidget);
    expect(done, ['missed']);
    await tester.tap(find.byKey(const ValueKey('lesson-replay')));
    await tester.pumpAndSettle();
    expect(find.text('Step 1 of 3'), findsOneWidget);
  });

  test('todaysTourLesson is the first not done', () {
    expect(todaysTourLesson(const [])!.key, 'punch');
    expect(todaysTourLesson(const ['punch'])!.key, 'missed');
    expect(todaysTourLesson(const ['punch', 'missed', 'leave', 'overtime']), isNull);
  });
}
