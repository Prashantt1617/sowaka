// The bell's dot reads the server's unread count, not the whole inbox, and
// still works against a server from before the count.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/notifications/notification_badge.dart';

const _session = AuthSession(
  token: 'token',
  user: AuthUser(
    id: 'u-asha',
    email: 'asha@getsowaka.com',
    name: 'Asha',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    enabledTabs: [],
    interests: [],
  ),
);

void main() {
  setUp(() => NotificationBadge.hasNew.value = false);

  test('the dot comes from the unread count alone', () async {
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add(request.url.path);
      return http.Response(jsonEncode({'success': true, 'unread': 3}), 200);
    });
    await NotificationBadge.refresh(_session, client: client);
    expect(NotificationBadge.hasNew.value, isTrue);
    expect(paths, ['/notifications/unread-count']);

    final none = MockClient((_) async => http.Response(jsonEncode({'success': true, 'unread': 0}), 200));
    await NotificationBadge.refresh(_session, client: none);
    expect(NotificationBadge.hasNew.value, isFalse);
  });

  test('a server without the count is asked for the inbox, as before', () async {
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add(request.url.path);
      if (request.url.path.endsWith('/unread-count')) return http.Response('{}', 404);
      return http.Response(
        jsonEncode({
          'success': true,
          'notifications': [
            {'id': 'a', 'readAt': '2026-10-20T10:00:00Z'},
            {'id': 'b', 'readAt': null},
          ],
        }),
        200,
      );
    });
    await NotificationBadge.refresh(_session, client: client);
    expect(NotificationBadge.hasNew.value, isTrue);
    expect(paths, ['/notifications/unread-count', '/notifications']);
  });

  test('a refusal or a failure leaves the dot as it was', () async {
    NotificationBadge.hasNew.value = true;
    await NotificationBadge.refresh(_session, client: MockClient((_) async => http.Response('{}', 500)));
    expect(NotificationBadge.hasNew.value, isTrue);
    await NotificationBadge.refresh(_session, client: MockClient((_) async => throw http.ClientException('offline')));
    expect(NotificationBadge.hasNew.value, isTrue);
  });
}
