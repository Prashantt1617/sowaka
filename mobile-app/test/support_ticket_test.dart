// A ticket's thread against a fake server: the ticket bubble, the HR team's
// replies, a reply shown at once and confirmed behind (or marked to retry,
// never shown twice), and a resolved ticket closing the composer.
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/support/data/support_api_service.dart';
import 'package:mobile_app/features/support/data/support_models.dart';
import 'package:mobile_app/features/support/presentation/support_ticket_screen.dart';

import 'support_test_helpers.dart';

final _doc = {
  'name': 'Payslip.pdf',
  'contentType': 'application/pdf',
  'size': 2048,
  'url': 'https://example.test/signed/payslip',
};

List<Map<String, dynamic>> _messages() => [
  supportMessageJson(
    'm1',
    'employee',
    'I noticed a difference in my salary.',
    at: DateTime(2026, 9, 24, 10, 32),
    attachments: [_doc],
  ),
  supportMessageJson(
    'm2',
    'system',
    'Your ticket is raised, you should get a reply within 3 working days',
    at: DateTime(2026, 9, 24, 10, 32, 1),
  ),
  supportMessageJson(
    'm3',
    'staff',
    'Could you share last month’s slip too?',
    at: DateTime(2026, 9, 24, 11, 5),
  ),
  supportMessageJson(
    'm4',
    'staff',
    'Thanks, we are checking it with payroll.',
    at: DateTime(2026, 9, 25, 9),
  ),
];

Future<void> _open(
  WidgetTester tester,
  http.Client client, {
  FakeSupportRealtime? realtime,
}) async {
  supportTall(tester);
  await tester.pumpWidget(
    supportApp(
      SupportTicketScreen(
        shell: supportShell(
          client,
          realtime: realtime ?? FakeSupportRealtime(),
        ),
        ticketId: 't1',
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows the request and the HR team', (tester) async {
    final client = MockClient(
      (request) async => supportOk({
        'ticket': supportTicketJson('t1'),
        'messages': _messages(),
        'events': [],
      }),
    );
    await _open(tester, client);

    expect(find.text('Chat'), findsOneWidget);
    final request = tester.widget<RichText>(
      find.textContaining('Type: ', findRichText: true),
    );
    expect(
      request.text.toPlainText(),
      'Type: Payroll\nComment: I noticed a difference in my salary.'
      '\nAttachment:',
    );
    expect(find.text('Payslip.pdf'), findsOneWidget);
    // The automatic reply reads as a reply, without a name.
    expect(
      find.text(
        'Your ticket is raised, you should get a reply within 3 working days',
      ),
      findsOneWidget,
    );
    // Staff are only ever "HR team".
    expect(find.textContaining('HR team · '), findsNWidgets(2));
    // The next day's reply, under a divider for the new day.
    expect(
      find.text('Thanks, we are checking it with payroll.'),
      findsOneWidget,
    );
    expect(find.text('25/9/2026'), findsOneWidget);
    // No confidential tag and no menu to reveal anything.
    expect(find.text('Confidential'), findsNothing);
    expect(find.byKey(const ValueKey('support-thread-menu')), findsNothing);
    expect(find.byKey(const ValueKey('support-composer')), findsOneWidget);
  });

  testWidgets('a reply shows at once and the server copy takes its place', (
    tester,
  ) async {
    Map<String, dynamic>? sent;
    final server = Completer<void>();
    final client = MockClient((request) async {
      if (request.method == 'POST' &&
          request.url.path.endsWith('/support/tickets/t1/messages')) {
        sent = jsonDecode(request.body) as Map<String, dynamic>;
        await server.future;
        return supportOk({
          'message': supportMessageJson(
            'm9',
            'employee',
            'Sharing it now',
            at: DateTime(2026, 9, 25, 10),
          ),
        });
      }
      return supportOk({
        'ticket': supportTicketJson('t1'),
        'messages': _messages().take(3).toList(),
        'events': [],
      });
    });
    await _open(tester, client);

    await tester.enterText(
      find.byKey(const ValueKey('support-composer')),
      'Sharing it now',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('support-send')));
    await tester.pump();

    // Sent as far as the person can tell: cleared, shown, nothing spinning.
    expect(find.text('Sharing it now'), findsOneWidget);
    final field = tester.widget<TextField>(
      find.byKey(const ValueKey('support-composer')),
    );
    expect(field.controller!.text, isEmpty);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.byKey(const ValueKey('support-not-sent')), findsNothing);

    server.complete();
    await tester.pumpAndSettle();
    expect(sent, {'text': 'Sharing it now'});
    expect(find.text('Sharing it now'), findsOneWidget);
    expect(find.byKey(const ValueKey('support-message-m9')), findsOneWidget);
  });

  testWidgets('a live refetch never shows a reply twice', (tester) async {
    final server = Completer<void>();
    var posted = false;
    final client = MockClient((request) async {
      if (request.method == 'POST') {
        posted = true;
        await server.future;
        return supportOk({
          'message': supportMessageJson(
            'm9',
            'employee',
            'Same words',
            at: DateTime(2026, 9, 25, 10),
          ),
        });
      }
      return supportOk({
        'ticket': supportTicketJson('t1'),
        'messages': [
          ..._messages().take(3),
          // The server already has it by the time the thread is read again.
          if (posted)
            supportMessageJson(
              'm9',
              'employee',
              'Same words',
              at: DateTime(2026, 9, 25, 10),
            ),
        ],
        'events': [],
      });
    });
    final realtime = FakeSupportRealtime();
    await _open(tester, client, realtime: realtime);

    await tester.enterText(
      find.byKey(const ValueKey('support-composer')),
      'Same words',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('support-send')));
    await tester.pump();
    realtime.changesController.add(
      const SupportChange(ticketId: 't1', kind: 'message'),
    );
    await tester.pumpAndSettle();
    expect(find.text('Same words'), findsOneWidget);

    server.complete();
    await tester.pumpAndSettle();
    expect(find.text('Same words'), findsOneWidget);
  });

  testWidgets('a reply that fails is marked; retry resends, delete removes', (
    tester,
  ) async {
    var posts = 0;
    final client = MockClient((request) async {
      if (request.method == 'POST') {
        posts++;
        if (posts < 3) return supportError('Server down', 500);
        return supportOk({
          'message': supportMessageJson(
            'm${posts + 10}',
            'employee',
            jsonDecode(request.body)['text'] as String,
            at: DateTime(2026, 9, 25, 10),
          ),
        });
      }
      return supportOk({
        'ticket': supportTicketJson('t1'),
        'messages': _messages().take(3).toList(),
        'events': [],
      });
    });
    await _open(tester, client);

    Future<void> send(String text) async {
      await tester.enterText(
        find.byKey(const ValueKey('support-composer')),
        text,
      );
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('support-send')));
      await tester.pumpAndSettle();
    }

    await send('First try');
    expect(find.text('Not sent · Tap to retry'), findsOneWidget);
    await send('Second try');
    expect(find.text('Not sent · Tap to retry'), findsNWidgets(2));

    // Delete the second one from its long-press.
    await tester.longPress(find.text('Second try'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('support-delete-message')));
    await tester.pumpAndSettle();
    expect(find.text('Second try'), findsNothing);

    // Retry the first: it goes, and the marker with it.
    await tester.tap(find.text('First try'));
    await tester.pumpAndSettle();
    expect(posts, 3);
    expect(find.text('First try'), findsOneWidget);
    expect(find.text('Not sent · Tap to retry'), findsNothing);
  });

  testWidgets('a resolved ticket is read only and asks for a new ticket', (
    tester,
  ) async {
    final client = MockClient(
      (request) async => supportOk({
        'ticket': supportTicketJson('t1', status: 'resolved', chip: 'Resolved'),
        'messages': _messages().take(3).toList(),
        'events': [],
      }),
    );
    await _open(tester, client);

    expect(find.byKey(const ValueKey('support-composer')), findsNothing);
    expect(find.byKey(const ValueKey('support-attach')), findsNothing);
    expect(find.textContaining('Please start a new ticket'), findsOneWidget);
  });

  testWidgets('a live change on this ticket reads it again', (tester) async {
    var reads = 0;
    final client = MockClient((request) async {
      reads++;
      return supportOk({
        'ticket': supportTicketJson(
          't1',
          status: reads > 1 ? 'resolved' : 'assigned',
        ),
        'messages': _messages().take(3).toList(),
        'events': [],
      });
    });
    final realtime = FakeSupportRealtime();
    await _open(tester, client, realtime: realtime);
    expect(find.byKey(const ValueKey('support-composer')), findsOneWidget);

    // Someone else's ticket: nothing to read.
    realtime.changesController.add(
      const SupportChange(ticketId: 'other', kind: 'message'),
    );
    await tester.pumpAndSettle();
    expect(reads, 1);

    realtime.changesController.add(
      const SupportChange(ticketId: 't1', kind: 'resolved'),
    );
    await tester.pumpAndSettle();
    expect(reads, 2);
    expect(find.byKey(const ValueKey('support-composer')), findsNothing);
  });

  testWidgets('a new ticket shows its files at once, photos as thumbnails', (
    tester,
  ) async {
    final server = Completer<void>();
    final client = MockClient((request) async {
      await server.future;
      return supportError('Not now', 500);
    });
    // A 1×1 transparent PNG.
    final png = Uint8List.fromList(
      base64Decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      ),
    );
    supportTall(tester);
    await tester.pumpWidget(
      supportApp(
        SupportTicketScreen(
          shell: supportShell(client, realtime: FakeSupportRealtime()),
          draft: SupportDraft(
            topic: const SupportTopic(key: 'payroll', label: 'Payroll'),
            text: 'See attached',
            files: [
              SupportUpload(name: 'screen.png', size: png.length, bytes: png),
              SupportUpload(
                name: 'slip.pdf',
                size: 3,
                bytes: Uint8List.fromList([1, 2, 3]),
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pump();

    expect(
      find.textContaining('Attachment:', findRichText: true),
      findsOneWidget,
    );
    // The photo from its bytes, not a link; the PDF as a chip.
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Image &&
            widget.image is ResizeImage &&
            (widget.image as ResizeImage).imageProvider is MemoryImage,
      ),
      findsOneWidget,
    );
    expect(find.text('slip.pdf'), findsOneWidget);

    server.complete();
    await tester.pumpAndSettle();
    expect(find.text('Not sent · Tap to retry'), findsOneWidget);
  });
}
