// The app's half of the web-game bridge: what a page asks over the
// SowakaGame channel, what reaches the server under the player's session,
// and the JavaScript that settles the page's promise.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/games/data/game_bridge.dart';
import 'package:mobile_app/features/games/data/games_api_service.dart';

final _session = AuthSession(
  token: 'session-token',
  user: const AuthUser(
    id: 'u-2',
    email: 'tanvi@getsowaka.com',
    name: 'Tanvi Shah',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    enabledTabs: ['connect', 'games'],
  ),
);

final _board = {
  'success': true,
  'scoring': {'higherIsBetter': true, 'label': 'points'},
  'leaderboard': [
    {'rank': 1, 'userId': 'u-1', 'playerName': 'Neha Iyer', 'score': 9100, 'isMe': false},
    {'rank': 2, 'userId': 'u-2', 'playerName': 'Tanvi Shah', 'score': 4200, 'isMe': true},
  ],
  'me': {'rank': 2, 'score': 4200},
};

/// The reply's arguments, read back out of `Sowaka.__reply(id, ok, payload)`.
({String id, bool ok, Map<String, dynamic> payload}) _parse(String js) {
  final match = RegExp(r'__reply\(("[^"]*"), (true|false), (.*)\);$').firstMatch(js)!;
  return (
    id: jsonDecode(match.group(1)!) as String,
    ok: match.group(2) == 'true',
    payload: jsonDecode(match.group(3)!) as Map<String, dynamic>,
  );
}

void main() {
  late List<http.Request> requests;
  late GameBridge bridge;

  void serve(Future<http.Response> Function(http.Request request) handler) {
    requests = [];
    final client = MockClient((request) {
      requests.add(request);
      return handler(request);
    });
    bridge = GameBridge(
      service: GamesApiService(
        session: _session,
        baseUrl: 'https://api.example.test',
        client: client,
      ),
      gameKey: 'odd-one-out',
      company: 'Sowaka',
    );
  }

  test('a score goes to the server under the session and the board comes back', () async {
    serve((request) async => http.Response(
      jsonEncode({..._board, 'score': 4200, 'improved': true}),
      200,
      headers: {'content-type': 'application/json'},
    ));
    final js = await bridge.handle(
      jsonEncode({'id': 'c1', 'type': 'submitScore', 'data': {'score': 4200}}),
    );
    expect(requests, hasLength(1));
    expect(requests.single.method, 'POST');
    expect(requests.single.url.toString(), 'https://api.example.test/games/odd-one-out/score');
    expect(requests.single.headers['Authorization'], 'Bearer session-token');
    expect(jsonDecode(requests.single.body), {'score': 4200});

    final reply = _parse(js!);
    expect(reply.id, 'c1');
    expect(reply.ok, isTrue);
    expect(reply.payload['company'], 'Sowaka');
    expect(reply.payload['improved'], isTrue);
    expect(reply.payload['me'], {'rank': 2, 'score': 4200});
    expect((reply.payload['entries'] as List).first, {
      'rank': 1,
      'name': 'Neha Iyer',
      'score': 9100,
      'me': false,
    });
    expect(js, isNot(contains('u-1')));
  });

  test('the leaderboard is read for the game it was opened for', () async {
    serve((request) async => http.Response(jsonEncode(_board), 200));
    final reply = _parse(
      (await bridge.handle(jsonEncode({'id': 'c2', 'type': 'leaderboard'})))!,
    );
    expect(requests.single.method, 'GET');
    expect(requests.single.url.path, '/games/odd-one-out/leaderboard');
    expect(reply.ok, isTrue);
    expect((reply.payload['entries'] as List), hasLength(2));
  });

  test('an impossible score is refused before it reaches the server', () async {
    serve((request) async => http.Response('{}', 200));
    for (final score in [-5, 'lots', null]) {
      final reply = _parse(
        (await bridge.handle(
          jsonEncode({'id': 'c3', 'type': 'submitScore', 'data': {'score': score}}),
        ))!,
      );
      expect(reply.ok, isFalse);
      expect(reply.payload['message'], 'Score is invalid');
    }
    expect(requests, isEmpty);
  });

  test("the server's refusal is passed on as the page's error", () async {
    serve((request) async => http.Response(
      jsonEncode({'success': false, 'message': 'This game is not available for your company'}),
      403,
    ));
    final reply = _parse(
      (await bridge.handle(
        jsonEncode({'id': 'c4', 'type': 'submitScore', 'data': {'score': 10}}),
      ))!,
    );
    expect(reply.ok, isFalse);
    expect(reply.payload['message'], 'This game is not available for your company');
  });

  test('no connection is an error the page can show', () async {
    serve((request) async => throw http.ClientException('offline'));
    final reply = _parse(
      (await bridge.handle(jsonEncode({'id': 'c5', 'type': 'leaderboard'})))!,
    );
    expect(reply.ok, isFalse);
    expect(reply.payload['message'], 'Could not reach Sowaka');
  });

  test('an unknown request is refused; a message without an id is dropped', () async {
    serve((request) async => http.Response('{}', 200));
    final unknown = _parse(
      (await bridge.handle(jsonEncode({'id': 'c6', 'type': 'deleteEveryone'})))!,
    );
    expect(unknown.ok, isFalse);
    expect(await bridge.handle('not json'), isNull);
    expect(await bridge.handle(jsonEncode(['a'])), isNull);
    expect(await bridge.handle(jsonEncode({'type': 'leaderboard'})), isNull);
    expect(await bridge.handle(jsonEncode({'id': 'x' * 41, 'type': 'leaderboard'})), isNull);
    expect(requests, isEmpty);
  });

  test('the bridge goes in ahead of the page and a name cannot break out of it', () {
    final script = gameBridgeScript(playerName: 'Tanvi </script><b>');
    expect(script, contains(r'"Tanvi \u003c/script>\u003cb>"'));
    expect(script, isNot(contains('</script>')));
    expect(script, contains('SowakaGame.postMessage'));

    const page = '<!doctype html><html><head><title>x</title></head><body><script>game()</script></body></html>';
    final injected = injectGameBridge(page, 'BRIDGE();');
    expect(injected.indexOf('BRIDGE();'), lessThan(injected.indexOf('game()')));
    expect(injected.indexOf('BRIDGE();'), greaterThan(injected.indexOf('<head>')));
    expect(injected, startsWith('<!doctype html>'));

    final noHead = injectGameBridge('<!DOCTYPE html><title>x</title><script>game()</script>', 'BRIDGE();');
    expect(noHead, startsWith('<!DOCTYPE html>\n<script>'));
    expect(injectGameBridge('<script>game()</script>', 'BRIDGE();'), startsWith('<script>\nBRIDGE();'));
  });
}
