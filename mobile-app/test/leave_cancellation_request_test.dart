// A request to cancel an approved leave, as the manager meets it: its own card
// in Team Requests ("Leave cancellation", the employee's note, Approve /
// Reject), its own detail page, and the outcome in the reviewed list. A
// cancelled leave says what it had been: "Cancelled pending leave" (withdrawn
// before anyone decided) or "Cancelled approved leave" (cancelled through an
// approved cancellation request).
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';

http.Response _ok(Map<String, dynamic> body) => http.Response(
  jsonEncode({'success': true, ...body}),
  200,
  headers: {'content-type': 'application/json'},
);

Map<String, dynamic> _leave(
  String id,
  String name,
  String status, {
  Map<String, dynamic>? cancelRequest,
  String? cancelledFrom,
  String cancelNote = '',
  String? decidedAt,
}) => {
  'id': id,
  'userId': name.toLowerCase(),
  'employee': {'name': name, 'department': 'Design'},
  'type': 'casual',
  'typeName': 'Casual Leave',
  'startDate': '2026-12-0${id.substring(1)}',
  'endDate': '2026-12-0${id.substring(1)}',
  'days': 1,
  'reason': 'Reason $id',
  'status': status,
  'createdAt': '2026-11-01T09:00:00.000Z',
  'decidedAt': ?decidedAt,
  'cancelRequest': ?cancelRequest,
  'cancelledFrom': ?cancelledFrom,
  if (cancelNote.isNotEmpty) 'cancelNote': cancelNote,
  if (status == 'cancelled') 'cancelledAt': '2026-11-05T09:00:00.000Z',
};

Map<String, dynamic> _member(String name, {bool self = false}) => {
  'userId': name.toLowerCase(),
  'name': name,
  'department': 'Design',
  'designation': 'Designer',
  'reportsToViewer': !self,
  'isSelf': self,
  'isManager': self,
  'parameters': <dynamic>[],
  'history': <dynamic>[],
};

/// The manager's Team Requests over [leaves]; PATCHes to a cancellation are
/// recorded in [decisions] and answered with [answer].
Future<ManagerBloc> _pumpRequests(
  WidgetTester tester,
  List<Map<String, dynamic>> leaves,
  List<Map<String, dynamic>> decisions,
  Map<String, dynamic> Function(String id, Map<String, dynamic> body) answer,
) async {
  tester.view.physicalSize = const Size(480 * 3, 1800 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final client = MockClient((request) async {
    final path = request.url.path;
    if (request.method == 'PATCH' && path.endsWith('/cancellation')) {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      final id = path.split('/')[path.split('/').length - 2];
      decisions.add({'id': id, ...body});
      return _ok({'leave': answer(id, body)});
    }
    if (path.endsWith('/manager/workspace')) {
      return _ok({
        'team': [
          _member('Pankaj', self: true),
          _member('Asha'),
          _member('Bala'),
          _member('Chitra'),
          _member('Dev'),
        ],
        'recognitionCandidates': <dynamic>[],
        'nominations': <dynamic>[],
        'recognitionHistory': <dynamic>[],
        'myParameters': <dynamic>[],
        'growthHistory': <dynamic>[],
        'holidays': <dynamic>[],
        'myOrgChart': <dynamic>[],
        'weekoffDays': [0],
        'shift': <String, dynamic>{},
        'overtimeEnabled': true,
        'hasManager': true,
        'teamLevel': 1,
        'managerScore': 0,
      });
    }
    return _ok({
      'leaves': path.endsWith('/leaves/inbox') ? leaves : <dynamic>[],
      'overtime': <dynamic>[],
      'regularizations': <dynamic>[],
      'claims': <dynamic>[],
      'types': <dynamic>[],
      'records': <dynamic>[],
      'balance': <String, dynamic>{},
    });
  });
  final session = AuthSession(
    token: 'token',
    user: const AuthUser(
      id: 'pankaj',
      email: 'pankaj@sowaka.test',
      name: 'Pankaj',
      role: 'manager',
      company: 'Sowaka',
      org: 'sowaka',
      interests: [],
    ),
  );
  final bloc = ManagerBloc(
    session: session,
    service: ManagerApiService(
      session: session,
      baseUrl: 'https://example.test',
      client: client,
    ),
  );
  await tester.runAsync(() => bloc.add(const LoadManagerDashboard()));
  await tester.pumpWidget(
    MaterialApp(home: ManagerScreen(session: session, bloc: bloc)),
  );
  bloc.add(const ChangeManagerTab(ManagerTab.manage));
  bloc.add(const ShowTeamSection(TeamSection.requests));
  await tester.pumpAndSettle(const Duration(seconds: 1));
  return bloc;
}

Future<void> _done(WidgetTester tester, ManagerBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
  await tester.pump(const Duration(seconds: 30));
}

void main() {
  test('a cancelled leave names what it had been, older rows included', () {
    LeaveRequest read(Map<String, dynamic> json) => LeaveRequest.fromJson(json);
    expect(
      read(
        _leave('l1', 'Asha', 'cancelled', cancelledFrom: 'pending'),
      ).cancelledLabel,
      'Cancelled pending leave',
    );
    expect(
      read(
        _leave(
          'l2',
          'Asha',
          'cancelled',
          cancelledFrom: 'approved',
          cancelRequest: {
            'requestedAt': '2026-11-04T09:00:00.000Z',
            'status': 'approved',
          },
        ),
      ).cancelledLabel,
      'Cancelled approved leave',
    );
    // A server before cancellation requests: a decision on record means it
    // had been approved; none, that it was withdrawn while pending.
    expect(
      read(
        _leave('l3', 'Asha', 'cancelled', decidedAt: '2026-11-02T09:00:00Z'),
      ).cancelledLabel,
      'Cancelled approved leave',
    );
    expect(
      read(_leave('l4', 'Asha', 'cancelled')).cancelledLabel,
      'Cancelled pending leave',
    );
    final waiting = read(
      _leave(
        'l5',
        'Asha',
        'approved',
        cancelRequest: {
          'requestedAt': '2026-11-04T09:00:00.000Z',
          'status': 'pending',
          'note': 'Trip off',
        },
      ),
    );
    expect(waiting.cancelledLabel, isNull);
    expect(waiting.cancellationPending, isTrue);
    expect(waiting.cancelRequest!.note, 'Trip off');
  });

  testWidgets(
    'the cancellation is its own request; the outcomes read as what happened',
    (tester) async {
      final decisions = <Map<String, dynamic>>[];
      final asked = _leave(
        'l3',
        'Chitra',
        'approved',
        cancelRequest: {
          'requestedAt': '2026-11-06T09:00:00.000Z',
          'status': 'pending',
          'note': 'Trip called off',
        },
      );
      final bloc = await _pumpRequests(
        tester,
        [
          _leave(
            'l1',
            'Asha',
            'cancelled',
            cancelledFrom: 'pending',
            cancelNote: 'Plans changed',
          ),
          _leave(
            'l2',
            'Bala',
            'cancelled',
            cancelledFrom: 'approved',
            cancelNote: 'Not needed',
            cancelRequest: {
              'requestedAt': '2026-11-04T09:00:00.000Z',
              'status': 'approved',
              'note': 'Not needed',
            },
          ),
          asked,
          _leave(
            'l4',
            'Dev',
            'approved',
            cancelRequest: {
              'requestedAt': '2026-11-03T09:00:00.000Z',
              'status': 'declined',
              'decisionNote': 'Cover is booked',
            },
          ),
        ],
        decisions,
        (id, body) => {
          ...asked,
          'status': 'cancelled',
          'cancelledFrom': 'approved',
          'cancelNote': 'Trip called off',
          'cancelRequest': {
            ...(asked['cancelRequest'] as Map<String, dynamic>),
            'status': body['decision'],
          },
        },
      );

      expect(find.text('Cancelled by the employee'), findsNothing);
      expect(find.text('Cancelled pending leave'), findsOneWidget);
      expect(find.text('Plans changed'), findsOneWidget);
      // Bala's leave and the cancellation that ended it.
      expect(find.text('Cancelled approved leave'), findsNWidgets(2));
      expect(find.text('Cancellation declined'), findsOneWidget);
      expect(find.text('Cover is booked'), findsOneWidget);

      // Chitra's: waiting, with her note and the two buttons.
      final card = find.byKey(const ValueKey('leave-cancellation-l3'));
      expect(card, findsOneWidget);
      expect(
        find.descendant(of: card, matching: find.text('Leave cancellation')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: card, matching: find.text('Trip called off')),
        findsOneWidget,
      );
      final approve = find.descendant(of: card, matching: find.text('Approve'));
      await tester.ensureVisible(approve);
      await tester.tap(approve);
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
      await tester.pumpAndSettle(const Duration(seconds: 1));

      expect(decisions, [
        {'id': 'l3', 'decision': 'approved'},
      ]);
      // Now reviewed: her leave and her request both read as cancelled.
      expect(find.text('Cancelled approved leave'), findsNWidgets(4));
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('leave-cancellation-l3')),
          matching: find.text('Approve'),
        ),
        findsNothing,
      );
      await _done(tester, bloc);
    },
  );

  testWidgets('declined from its detail page, the note optional', (
    tester,
  ) async {
    final decisions = <Map<String, dynamic>>[];
    final asked = _leave(
      'l3',
      'Chitra',
      'approved',
      cancelRequest: {
        'requestedAt': '2026-11-06T09:00:00.000Z',
        'status': 'pending',
        'note': 'Trip called off',
      },
    );
    final bloc = await _pumpRequests(
      tester,
      [asked],
      decisions,
      (id, body) => {
        ...asked,
        'cancelRequest': {
          ...(asked['cancelRequest'] as Map<String, dynamic>),
          'status': body['decision'],
        },
      },
    );
    final details = find.descendant(
      of: find.byKey(const ValueKey('leave-cancellation-l3')),
      matching: find.text('View details'),
    );
    await tester.ensureVisible(details);
    await tester.tap(details);
    await tester.pumpAndSettle(const Duration(seconds: 1));

    expect(find.text('Leave cancellation'), findsWidgets);
    expect(find.text('CANCELLATION NOTE'), findsOneWidget);
    expect(find.text('Trip called off'), findsOneWidget);
    expect(find.text('Waiting on you'), findsOneWidget);
    // Still approved while it waits.
    expect(find.text('Approved'), findsWidgets);

    await tester.tap(find.text('Decline').last);
    await tester.pumpAndSettle(const Duration(seconds: 1));
    expect(find.text('Decline cancellation'), findsOneWidget);
    expect(find.text('The leave stays approved.'), findsOneWidget);
    // No note needed to keep the leave.
    await tester.tap(find.text('Confirm decline'));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
    await tester.pumpAndSettle(const Duration(seconds: 1));
    expect(decisions, [
      {'id': 'l3', 'decision': 'declined'},
    ]);
    await _done(tester, bloc);
  });
}
