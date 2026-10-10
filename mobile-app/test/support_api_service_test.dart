// The Support desk's API calls: routes, the multipart "files" field when
// there is something attached, and the server's message on a refusal.
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/support/data/support_api_service.dart';
import 'package:mobile_app/features/support/data/support_models.dart';

import 'support_test_helpers.dart';

void main() {
  SupportApiService service(http.Client client) => SupportApiService(
    session: supportSession,
    baseUrl: 'https://example.test',
    client: client,
  );

  test('topics and tickets are read from /support', () async {
    final paths = <String>[];
    final api = service(
      MockClient((request) async {
        paths.add('${request.method} ${request.url.path}');
        if (request.url.path.endsWith('/topics')) {
          return supportOk({'topics': supportTopics});
        }
        return supportOk({
          'tickets': [
            supportTicketJson(
              'a',
              unread: 3,
              status: 'open',
              chip: 'Submitted',
            ),
          ],
        });
      }),
    );
    final topics = await api.fetchTopics();
    expect(topics.map((t) => t.key), [
      'workplace',
      'manager',
      'payroll',
      'attendance',
      'leaves',
      'benefits',
      'safety',
      'other',
    ]);
    expect(topics[6].label, 'Safety issues');
    final tickets = await api.fetchTickets();
    expect(tickets.single.status, SupportStatus.open);
    expect(tickets.single.unread, 3);
    expect(tickets.single.ticketNo, 42);
    expect(paths, ['GET /support/topics', 'GET /support/tickets']);
  });

  test('a request with files is sent as multipart under "files"', () async {
    late http.Request seen;
    final api = service(
      MockClient((request) async {
        seen = request;
        return supportOk({
          'ticket': supportTicketJson('t1', status: 'open'),
          'messages': [supportMessageJson('m1', 'employee', 'Hi')],
        });
      }),
    );
    final thread = await api.createTicket(
      topic: 'payroll',
      text: 'Hi',
      files: [
        SupportUpload(
          name: 'slip.pdf',
          size: 3,
          bytes: Uint8List.fromList([1, 2, 3]),
        ),
        SupportUpload(
          name: 'photo.PNG',
          size: 3,
          bytes: Uint8List.fromList([4, 5, 6]),
        ),
      ],
    );
    expect(thread.ticket.id, 't1');
    expect(seen.url.path, '/support/tickets');
    expect(seen.headers['content-type'], startsWith('multipart/form-data'));
    final body = seen.body;
    expect(body, contains('name="topic"'));
    expect(body, isNot(contains('name="confidential"')));
    expect('name="files"'.allMatches(body).length, 2);
    expect(body, contains('filename="slip.pdf"'));
    expect(body, contains('content-type: application/pdf'));
    expect(body, contains('content-type: image/png'));
  });

  test('a refusal carries the server message and status', () async {
    final api = service(
      MockClient(
        (request) async => supportError('This request is resolved', 409),
      ),
    );
    await expectLater(
      api.sendMessage('t1', text: 'Hello'),
      throwsA(
        isA<SupportApiException>()
            .having((e) => e.message, 'message', 'This request is resolved')
            .having((e) => e.statusCode, 'statusCode', 409),
      ),
    );
  });
}
