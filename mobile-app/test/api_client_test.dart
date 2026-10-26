// Every API request has a time limit: an ordinary call, and a longer one for
// an upload, whose clock runs while the bytes go up.
import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/services/api_client.dart';

void main() {
  test('an ordinary call has the short limit, an upload the long one', () {
    final get = http.Request('GET', Uri.parse('https://example.test/feed'));
    expect(TimedClient.limitFor(get), TimedClient.answer);
    final post = http.Request('POST', Uri.parse('https://example.test/leaves'))..body = '{"a":1}';
    expect(TimedClient.limitFor(post), TimedClient.answer);
    final photo = http.MultipartRequest('POST', Uri.parse('https://example.test/connect/posts'));
    expect(TimedClient.limitFor(photo), TimedClient.upload);
    final big = http.Request('POST', Uri.parse('https://example.test/x'))..bodyBytes = List.filled(300 * 1024, 0);
    expect(TimedClient.limitFor(big), TimedClient.upload);
  });

  testWidgets('a server that never answers is given up on', (tester) async {
    final never = MockClient((_) => Completer<http.Response>().future);
    final client = TimedClient(never);
    Object? failure;
    unawaited(client.get(Uri.parse('https://example.test/feed')).catchError((Object error) {
      failure = error;
      return http.Response('', 599);
    }));
    await tester.pump(TimedClient.answer - const Duration(seconds: 1));
    expect(failure, isNull);
    await tester.pump(const Duration(seconds: 2));
    expect(failure, isA<TimeoutException>());
  });

  test('a reply passes through untouched', () async {
    final client = TimedClient(MockClient((_) async => http.Response('{"ok":true}', 201, headers: {'x-a': 'b'})));
    final response = await client.get(Uri.parse('https://example.test/x'));
    expect(response.statusCode, 201);
    expect(response.body, '{"ok":true}');
    expect(response.headers['x-a'], 'b');
  });
}
