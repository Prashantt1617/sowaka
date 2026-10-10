// The Support desk list against a fake server: tickets with their chips, the
// empty state, a server without the desk saying so plainly, a live change
// reading the list again, and the way in from the Actions tab.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';
import 'package:mobile_app/features/support/data/support_api_service.dart';
import 'package:mobile_app/features/support/data/support_models.dart';
import 'package:mobile_app/features/support/presentation/support_desk_screen.dart';
import 'package:mobile_app/features/support/presentation/support_ticket_screen.dart';

import 'support_test_helpers.dart';

void main() {
  testWidgets('lists tickets with unread replies first, then the server chip', (
    tester,
  ) async {
    supportTall(tester);
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/support/tickets')) {
        expect(request.headers['Authorization'], 'Bearer token');
        return supportOk({
          'tickets': [
            supportTicketJson(
              'a',
              unread: 2,
              preview: 'I noticed a difference in.....',
            ),
            supportTicketJson('b', label: 'Manager', unread: 1),
            supportTicketJson(
              'c',
              label: 'Benefits',
              status: 'open',
              chip: 'Submitted',
            ),
            supportTicketJson(
              'd',
              label: 'Leaves',
              status: 'resolved',
              chip: 'Resolved',
            ),
          ],
        });
      }
      return supportOk({});
    });
    await tester.pumpWidget(
      supportApp(
        SupportDeskScreen(
          shell: supportShell(client, realtime: FakeSupportRealtime()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Support desk'), findsOneWidget);
    expect(
      find.textContaining('Have a concern?', findRichText: true),
      findsOneWidget,
    );
    expect(find.text('Payroll'), findsOneWidget);
    expect(find.text('Created on 24 Sep'), findsNWidgets(4));
    expect(find.text('I noticed a difference in.....'), findsOneWidget);
    // Unread replies replace the status, counted by the app.
    expect(find.text('2 new messages'), findsOneWidget);
    expect(find.text('1 new message'), findsOneWidget);
    expect(find.text('Submitted'), findsOneWidget);
    expect(find.text('Resolved'), findsOneWidget);
    expect(find.text('In-process'), findsNothing);
  });

  testWidgets('with no tickets, offers to raise one', (tester) async {
    supportTall(tester);
    final client = MockClient((request) async => supportOk({'tickets': []}));
    await tester.pumpWidget(
      supportApp(
        SupportDeskScreen(
          shell: supportShell(client, realtime: FakeSupportRealtime()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('support-empty')), findsOneWidget);
    // One in the top bar, one under the empty state.
    expect(find.text('Raise Ticket'), findsNWidgets(2));
  });

  testWidgets('a server without the desk says so, not its route', (
    tester,
  ) async {
    supportTall(tester);
    final client = MockClient(
      (request) async =>
          supportError('Route not found: GET /api/support/tickets', 404),
    );
    await tester.pumpWidget(
      supportApp(
        SupportDeskScreen(
          shell: supportShell(client, realtime: FakeSupportRealtime()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text(SupportApiException.unavailable), findsOneWidget);
    expect(find.textContaining('Route not found'), findsNothing);
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets('a live change reads the list again', (tester) async {
    supportTall(tester);
    var reads = 0;
    final client = MockClient((request) async {
      reads++;
      return supportOk({
        'tickets': [
          supportTicketJson('a', unread: reads > 1 ? 1 : 0, chip: 'In-process'),
        ],
      });
    });
    final realtime = FakeSupportRealtime();
    await tester.pumpWidget(
      supportApp(
        SupportDeskScreen(shell: supportShell(client, realtime: realtime)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('In-process'), findsOneWidget);

    realtime.changesController.add(
      const SupportChange(ticketId: 'a', kind: 'message'),
    );
    await tester.pumpAndSettle();
    expect(reads, 2);
    expect(find.text('1 new message'), findsOneWidget);

    realtime.reconnectsController.add(null);
    await tester.pumpAndSettle();
    expect(reads, 3);
  });

  testWidgets('a ticket id opens the thread over the list', (tester) async {
    supportTall(tester);
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/support/tickets')) {
        return supportOk({
          'tickets': [supportTicketJson('t1')],
        });
      }
      if (path.endsWith('/support/tickets/t1')) {
        return supportOk({
          'ticket': supportTicketJson('t1'),
          'messages': [supportMessageJson('m1', 'employee', 'Salary short')],
          'events': [],
        });
      }
      return supportOk({});
    });
    await tester.pumpWidget(
      supportApp(
        SupportDeskScreen(
          shell: supportShell(client, realtime: FakeSupportRealtime()),
          initialTicketId: 't1',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(SupportTicketScreen), findsOneWidget);
    expect(find.text('Chat'), findsOneWidget);

    await tester.tap(find.bySemanticsLabel('Back').last);
    await tester.pumpAndSettle();
    expect(find.text('Support desk'), findsOneWidget);
  });

  testWidgets('the Actions tab has a Support Desk card that opens the desk', (
    tester,
  ) async {
    supportTall(tester);
    final managerClient = MockClient((request) async {
      if (request.url.path.endsWith('/manager/workspace')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'team': <dynamic>[],
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
            'teamLevel': 2,
            'managerScore': 0,
          }),
          200,
        );
      }
      return http.Response(
        jsonEncode({
          'success': true,
          'leaves': <dynamic>[],
          'overtime': <dynamic>[],
          'regularizations': <dynamic>[],
          'claims': <dynamic>[],
          'types': <dynamic>[],
          'records': <dynamic>[],
          'balance': <String, dynamic>{},
        }),
        200,
      );
    });
    SupportApiService.testClient = MockClient(
      (request) async => supportOk({'tickets': []}),
    );
    final realtime = FakeSupportRealtime();
    SupportDeskScreen.testRealtime = () => realtime;
    addTearDown(() {
      SupportApiService.testClient = null;
      SupportDeskScreen.testRealtime = null;
    });

    final bloc = ManagerBloc(
      session: supportSession,
      service: ManagerApiService(
        session: supportSession,
        baseUrl: 'https://example.test',
        client: managerClient,
      ),
    );
    await tester.runAsync(() => bloc.add(const LoadManagerDashboard()));
    final controller = QuickActionsController();
    await tester.pumpWidget(
      supportApp(
        Scaffold(
          body: QuickActionsScreen(
            bloc: bloc,
            dashboard: bloc.state.dashboard!,
            controller: controller,
            profileAction: const SizedBox(width: 30, height: 30),
            onNotifications: () {},
            onOpenComposer: () {},
          ),
        ),
      ),
    );
    await tester.pump();

    final card = find.byKey(const ValueKey('support-desk-card'));
    expect(card, findsOneWidget);
    expect(find.text('Submit concern to HR.'), findsOneWidget);
    await tester.tap(card);
    await tester.pumpAndSettle();

    expect(find.byType(SupportDeskScreen), findsOneWidget);
    expect(realtime.connected, isTrue);

    // Leaving the desk closes the live channel it opened.
    await tester.tap(find.bySemanticsLabel('Back').last);
    await tester.pumpAndSettle();
    expect(realtime.disposed, isTrue);

    await tester.pumpWidget(const SizedBox.shrink());
    bloc.dispose();
    controller.dispose();
  });
}
