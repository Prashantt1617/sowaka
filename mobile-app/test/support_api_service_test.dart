// The Support desk's API calls: routes, the multipart "files" field when
// there is something attached, the server's message on a refusal, and plain
// words — never a route or an exception — for a server without the desk, a
// server fault or no connection.
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/shared/network_status.dart';
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

  test('a server without the desk, or a fault, reads as plain words', () async {
    Future<SupportApiException> failure(http.Response response) async {
      final api = service(MockClient((request) async => response));
      try {
        await api.fetchTickets();
      } on SupportApiException catch (error) {
        return error;
      }
      fail('expected a SupportApiException');
    }

    final missing = await failure(
      supportError('Route not found: GET /api/support/tickets', 404),
    );
    expect(missing.message, SupportApiException.unavailable);
    expect(missing.statusCode, 404);
    // A 404 from the desk itself keeps its own words.
    expect(
      (await failure(supportError('Ticket not found', 404))).message,
      'Ticket not found',
    );
    expect(
      (await failure(supportError('TypeError: x is undefined', 500))).message,
      SupportApiException.failed,
    );
    // A gateway's page rather than the API's reply.
    expect(
      (await failure(http.Response('<html>Bad gateway</html>', 502))).message,
      SupportApiException.failed,
    );
  });

  test('no connection reads as plain words', () async {
    final api = service(
      MockClient((request) async => throw http.ClientException('refused')),
    );
    await expectLater(
      api.fetchTopics(),
      throwsA(
        isA<SupportApiException>().having(
          (e) => e.message,
          'message',
          SupportApiException.offline,
        ),
      ),
    );
    NetworkStatus.reportSuccess();
    expect(
      supportErrorText(StateError('Bad state: raw')),
      SupportApiException.failed,
    );
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
