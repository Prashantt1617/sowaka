// Raising a ticket against a fake server: the button waits for a topic and a
// comment, the topics come from the server, the thread opens at once with the
// ticket marked as sending while it is created behind it (the topic's key and
// the comment go out, nothing else); leaving before it is created asks first;
// a refusal leaves it marked for retry, and too many tickets in a day gets a
// friendly word.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:mobile_app/features/support/presentation/support_desk_screen.dart';
import 'package:mobile_app/features/support/presentation/support_request_screen.dart';
import 'package:mobile_app/features/support/presentation/support_ticket_screen.dart';

import 'support_test_helpers.dart';

void main() {
  testWidgets('raises a request and opens its thread', (tester) async {
    supportTall(tester);
    Map<String, dynamic>? sent;
    var created = false;
    final server = Completer<void>();
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/support/topics')) {
        return supportOk({'topics': supportTopics});
      }
      if (path.endsWith('/support/tickets') && request.method == 'POST') {
        sent = jsonDecode(request.body) as Map<String, dynamic>;
        await server.future;
        created = true;
        return supportOk({
          'ticket': supportTicketJson('t9', status: 'open', chip: 'Submitted'),
          'messages': [
            supportMessageJson('m1', 'employee', 'My salary was short'),
            supportMessageJson(
              'm2',
              'system',
              'Your ticket is raised, you should get a reply within 3 '
                  'working days',
            ),
          ],
        });
      }
      if (path.endsWith('/support/tickets')) {
        return supportOk({
          'tickets': [
            if (created)
              supportTicketJson('t9', status: 'open', chip: 'Submitted'),
          ],
        });
      }
      if (path.endsWith('/support/tickets/t9')) {
        return supportOk({
          'ticket': supportTicketJson('t9', status: 'open', chip: 'Submitted'),
          'messages': [
            supportMessageJson('m1', 'employee', 'My salary was short'),
            supportMessageJson(
              'm2',
              'system',
              'Your ticket is raised, you should get a reply within 3 '
                  'working days',
            ),
          ],
          'events': [],
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
    await tester.tap(find.text('Raise Ticket').first);
    await tester.pumpAndSettle();
    expect(find.byType(SupportRequestScreen), findsOneWidget);

    // Nothing to send yet.
    await tester.tap(find.text('Submit Ticket'));
    await tester.pumpAndSettle();
    expect(created, isFalse);

    // The server's topics, in its order, in the sheet.
    await tester.tap(find.byKey(const ValueKey('support-topic-field')));
    await tester.pumpAndSettle();
    expect(find.text('Safety issues'), findsOneWidget);
    expect(find.text('Workplace'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('support-topic-payroll')));
    await tester.pumpAndSettle();
    expect(find.text('Payroll'), findsOneWidget);

    // A topic alone is not enough.
    await tester.tap(find.text('Submit Ticket'));
    await tester.pumpAndSettle();
    expect(created, isFalse);

    await tester.enterText(
      find.byKey(const ValueKey('support-comment')),
      '  My salary was short  ',
    );
    await tester.pump();
    // Nothing on the form asks to hide who is raising it.
    expect(find.textContaining('confidential'), findsNothing);

    await tester.tap(find.text('Submit Ticket'));
    await tester.pumpAndSettle();

    // In the thread before the server has answered: the ticket marked as on
    // its way, no spinner, the composer ready.
    expect(find.byType(SupportTicketScreen), findsOneWidget);
    expect(
      find.textContaining('Comment: My salary was short', findRichText: true),
      findsOneWidget,
    );
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.byKey(const ValueKey('support-composer')), findsOneWidget);
    expect(find.byKey(const ValueKey('support-not-sent')), findsNothing);
    expect(find.byKey(const ValueKey('support-sending')), findsOneWidget);

    // Leaving now would drop it: back asks first, and staying stays.
    await tester.tap(find.bySemanticsLabel('Back').last);
    await tester.pumpAndSettle();
    expect(
      find.text('Your ticket hasn\'t been sent yet. Leave anyway?'),
      findsOneWidget,
    );
    await tester.tap(find.text('Stay'));
    await tester.pumpAndSettle();
    expect(find.byType(SupportTicketScreen), findsOneWidget);

    server.complete();
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('support-sending')), findsNothing);

    expect(sent, {'topic': 'payroll', 'text': 'My salary was short'});
    // Straight into the new thread: the request, then the automatic reply.
    expect(find.byType(SupportTicketScreen), findsOneWidget);
    expect(
      find.textContaining('Comment: ', findRichText: true),
      findsOneWidget,
    );
    expect(find.textContaining('reply within 3 working days'), findsOneWidget);
  });

  testWidgets('a ticket that does not go through can be retried or deleted', (
    tester,
  ) async {
    supportTall(tester);
    var posts = 0;
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/support/topics')) {
        return supportOk({'topics': supportTopics});
      }
      if (path.endsWith('/support/tickets') && request.method == 'POST') {
        posts++;
        return posts == 1
            ? supportError('Too many', 429)
            : supportError('Server down', 500);
      }
      return supportOk({'tickets': []});
    });
    await tester.pumpWidget(
      supportApp(
        SupportDeskScreen(
          shell: supportShell(client, realtime: FakeSupportRealtime()),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Raise Ticket').first);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('support-topic-field')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('support-topic-manager')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('support-comment')),
      'Again',
    );
    await tester.pump();
    await tester.tap(find.text('Submit Ticket'));
    await tester.pumpAndSettle();

    // Too many today: said kindly, in the desk's words, and marked to retry.
    expect(find.byType(SupportTicketScreen), findsOneWidget);
    expect(
      find.textContaining('You have raised a lot of tickets today'),
      findsOneWidget,
    );
    expect(find.text('Not sent · Tap to retry'), findsOneWidget);
    expect(
      find.textContaining('Comment: Again', findRichText: true),
      findsOneWidget,
    );

    await tester.tap(find.text('Not sent · Tap to retry'));
    await tester.pumpAndSettle();
    expect(posts, 2);
    expect(find.text('Not sent · Tap to retry'), findsOneWidget);

    // Deleting it leaves the thread for the list.
    await tester.longPress(
      find.textContaining('Comment: Again', findRichText: true),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('support-delete-message')));
    await tester.pumpAndSettle();
    expect(find.byType(SupportTicketScreen), findsNothing);
    expect(find.text('Support desk'), findsOneWidget);
  });
}
