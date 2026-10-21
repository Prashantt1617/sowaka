// A post tapped on a connection the phone had dropped used to vanish: the app
// never sent it again, and nothing was logged. It is now sent again, with the
// same id every time, so the server can hand back a post it already made.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/connect/data/connect_models.dart';
import 'package:shared_preferences/shared_preferences.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'viewer',
    email: 'viewer@example.test',
    name: 'Viewer',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    interests: [],
  ),
);

http.Response _created(Map<String, dynamic> body) => http.Response(
  jsonEncode({
    'success': true,
    'post': {
      'id': 'new',
      'type': 'new_post',
      'tag': 'New Post',
      'author': {'userId': 'viewer', 'name': 'Viewer', 'initials': 'V'},
      'audience': {'label': 'Public'},
      'body': {'text': (body['body'] as Map)['text'], 'postKind': 'text'},
      'liked': false,
      'likeCount': 0,
      'commentCount': 0,
      'comments': <dynamic>[],
      'publishedAt': '2026-10-21T09:10:00.000Z',
    },
  }),
  201,
);

const _draft = ConnectPostDraft(
  type: ConnectPostType.newPost,
  body: {'text': 'Hello team', 'postKind': 'text'},
);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  ConnectApiService api(Future<http.Response> Function(http.Request) handler) =>
      ConnectApiService(
        session: _session,
        baseUrl: 'https://example.test',
        client: MockClient(handler),
      );

  test('a dropped connection is sent again, with the same id', () async {
    final ids = <String>[];
    final service = api((request) async {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      ids.add(body['clientRequestId'] as String);
      if (ids.length == 1) throw http.ClientException('Connection reset by peer');
      return _created(body);
    });

    final post = await service.createPost(_draft);

    expect(post.id, 'new');
    expect(ids, hasLength(2));
    expect(ids.first, isNotEmpty);
    expect(ids.toSet(), hasLength(1));
  });

  test('a gateway error is tried three times, then reported', () async {
    var attempts = 0;
    final service = api((request) async {
      attempts++;
      return http.Response('Bad gateway', 502);
    });

    await expectLater(
      service.createPost(_draft),
      throwsA(isA<ConnectApiException>()),
    );
    expect(attempts, 3);
    // Filed in the background, so wait for it to land.
    List<String>? pending;
    for (var i = 0; i < 50 && pending == null; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
      pending = (await SharedPreferences.getInstance()).getStringList(
        'client_log.pending',
      );
    }
    expect(pending, isNotNull);
    final logged = jsonDecode(pending!.single) as Map<String, dynamic>;
    expect(logged['event'], 'post_failed');
    expect((logged['context'] as Map)['attempts'], '3');
    expect((logged['context'] as Map)['status'], '502');
  });

  test('a refusal is not sent again', () async {
    var attempts = 0;
    final service = api((request) async {
      attempts++;
      return http.Response(jsonEncode({'message': 'Write something'}), 400);
    });

    await expectLater(
      service.createPost(_draft),
      throwsA(isA<ConnectApiException>()),
    );
    expect(attempts, 1);
  });

  test('each new post gets its own id', () async {
    final ids = <String>[];
    final service = api((request) async {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      ids.add(body['clientRequestId'] as String);
      return _created(body);
    });

    await service.createPost(_draft);
    await service.createPost(_draft);

    expect(ids.toSet(), hasLength(2));
  });
}
