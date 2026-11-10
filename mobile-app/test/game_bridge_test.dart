// The app's half of the web-game bridge: what a page asks over the
// SowakaGame channel, what reaches the server under the player's session,
// and the JavaScript that settles the page's promise.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/games/data/game_bridge.dart';
import 'package:mobile_app/features/games/data/game_voice_recorder.dart';
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
    {
      'rank': 1,
      'userId': 'u-1',
      'playerName': 'Neha Iyer',
      'score': 9100,
      'isMe': false,
    },
    {
      'rank': 2,
      'userId': 'u-2',
      'playerName': 'Tanvi Shah',
      'score': 4200,
      'isMe': true,
    },
  ],
  'me': {'rank': 2, 'score': 4200},
};

/// The reply's arguments, read back out of `Sowaka.__reply(id, ok, payload)`.
({String id, bool ok, Map<String, dynamic> payload}) _parse(String js) {
  final match = RegExp(
    r'__reply\(("[^"]*"), (true|false), (.*)\);$',
  ).firstMatch(js)!;
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

  test(
    'a score goes to the server under the session and the board comes back',
    () async {
      serve(
        (request) async => http.Response(
          jsonEncode({..._board, 'score': 4200, 'improved': true}),
          200,
          headers: {'content-type': 'application/json'},
        ),
      );
      final js = await bridge.handle(
        jsonEncode({
          'id': 'c1',
          'type': 'submitScore',
          'data': {'score': 4200},
        }),
      );
      expect(requests, hasLength(1));
      expect(requests.single.method, 'POST');
      expect(
        requests.single.url.toString(),
        'https://api.example.test/games/odd-one-out/score',
      );
      expect(requests.single.headers['Authorization'], 'Bearer session-token');
      expect(jsonDecode(requests.single.body), {'score': 4200});

      final reply = _parse(js!);
      expect(reply.id, 'c1');
      expect(reply.ok, isTrue);
      expect(reply.payload['company'], 'Sowaka');
      expect(reply.payload['improved'], isTrue);
      expect(reply.payload['me'], {'rank': 2, 'score': 4200});
      // Each row carries whose it is, so the page can open their profile.
      expect((reply.payload['entries'] as List).first, {
        'rank': 1,
        'userId': 'u-1',
        'name': 'Neha Iyer',
        'score': 9100,
        'me': false,
      });
    },
  );

  test('openProfile is offered only when the app can open profiles', () {
    final without = gameBridgeScript(playerName: 'Tanvi', userId: 'u-2');
    expect(without, isNot(contains('S.openProfile')));
    final offered = gameBridgeScript(
      playerName: 'Tanvi',
      userId: 'u-2',
      opensProfiles: true,
    );
    expect(offered, contains('S.openProfile = function (userId)'));
    expect(offered, contains("type: 'openProfile'"));
    expect(offered, contains('S.version = 6;'));
  });

  test("the page's openProfile opens that person, with no answer", () async {
    serve((request) async => http.Response('{}', 404));
    final opened = <String>[];
    bridge = GameBridge(
      service: GamesApiService(
        session: _session,
        baseUrl: 'https://api.example.test',
        client: MockClient((request) async => http.Response('{}', 404)),
      ),
      gameKey: 'odd-one-out',
      company: 'Sowaka',
      onOpenProfile: opened.add,
    );
    Future<String?> send(Object? userId) => bridge.handle(
      jsonEncode({
        'id': 'p',
        'type': 'openProfile',
        'data': {'userId': userId},
      }),
    );
    expect(await send('u-1'), isNull);
    expect(opened, ['u-1']);
    // Nothing that is not a person's id is passed on.
    for (final bad in ['', '../x', 'a b', null, 42]) {
      expect(await send(bad), isNull);
    }
    expect(opened, ['u-1']);
    expect(requests, isEmpty);
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
          jsonEncode({
            'id': 'c3',
            'type': 'submitScore',
            'data': {'score': score},
          }),
        ))!,
      );
      expect(reply.ok, isFalse);
      expect(reply.payload['message'], 'Score is invalid');
    }
    expect(requests, isEmpty);
  });

  test("the server's refusal is passed on as the page's error", () async {
    serve(
      (request) async => http.Response(
        jsonEncode({
          'success': false,
          'message': 'This game is not available for your company',
        }),
        403,
      ),
    );
    final reply = _parse(
      (await bridge.handle(
        jsonEncode({
          'id': 'c4',
          'type': 'submitScore',
          'data': {'score': 10},
        }),
      ))!,
    );
    expect(reply.ok, isFalse);
    expect(
      reply.payload['message'],
      'This game is not available for your company',
    );
  });

  test('no connection is an error the page can show', () async {
    serve((request) async => throw http.ClientException('offline'));
    final reply = _parse(
      (await bridge.handle(jsonEncode({'id': 'c5', 'type': 'leaderboard'})))!,
    );
    expect(reply.ok, isFalse);
    expect(reply.payload['message'], 'Could not reach Sowaka');
  });

  test(
    'an unknown request is refused; a message without an id is dropped',
    () async {
      serve((request) async => http.Response('{}', 200));
      final unknown = _parse(
        (await bridge.handle(
          jsonEncode({'id': 'c6', 'type': 'deleteEveryone'}),
        ))!,
      );
      expect(unknown.ok, isFalse);
      expect(await bridge.handle('not json'), isNull);
      expect(await bridge.handle(jsonEncode(['a'])), isNull);
      expect(await bridge.handle(jsonEncode({'type': 'leaderboard'})), isNull);
      expect(
        await bridge.handle(
          jsonEncode({'id': 'x' * 41, 'type': 'leaderboard'}),
        ),
        isNull,
      );
      expect(requests, isEmpty);
    },
  );

  test(
    'the bridge goes in ahead of the page and a name cannot break out of it',
    () {
      final script = gameBridgeScript(
        playerName: 'Tanvi </script><b>',
        userId: 'u-2</script>',
      );
      expect(script, contains(r'"Tanvi \u003c/script>\u003cb>"'));
      expect(script, contains(r'S.userId = "u-2\u003c/script>";'));
      expect(script, isNot(contains('</script>')));
      expect(script, contains('SowakaGame.postMessage'));

      const page =
          '<!doctype html><html><head><title>x</title></head><body><script>game()</script></body></html>';
      final injected = injectGameBridge(page, 'BRIDGE();');
      expect(
        injected.indexOf('BRIDGE();'),
        lessThan(injected.indexOf('game()')),
      );
      expect(
        injected.indexOf('BRIDGE();'),
        greaterThan(injected.indexOf('<head>')),
      );
      expect(injected, startsWith('<!doctype html>'));

      // The page's policy comes first, frames refused, so it covers the bridge and the game.
      final policy = injected.indexOf('http-equiv="Content-Security-Policy"');
      expect(policy, greaterThan(injected.indexOf('<head>')));
      expect(policy, lessThan(injected.indexOf('BRIDGE();')));
      expect(injected, contains("frame-src 'none'"));

      final noHead = injectGameBridge(
        '<!DOCTYPE html><title>x</title><script>game()</script>',
        'BRIDGE();',
      );
      expect(
        noHead,
        startsWith(
          '<!DOCTYPE html>\n<meta http-equiv="Content-Security-Policy"',
        ),
      );
      expect(noHead.indexOf('BRIDGE();'), lessThan(noHead.indexOf('game()')));
      expect(
        injectGameBridge('<script>game()</script>', 'BRIDGE();'),
        startsWith('<meta http-equiv="Content-Security-Policy"'),
      );
    },
  );

  group('Sowaka.voice', () {
    GameBridge withVoice(_FakeRecorder? recorder) => GameBridge(
      service: GamesApiService(
        session: _session,
        baseUrl: 'https://api.example.test',
        client: MockClient((request) async => http.Response('{}', 404)),
      ),
      gameKey: 'pool',
      company: 'Sowaka',
      voice: recorder,
    );
    Future<String?> ask(GameBridge b, String type) =>
        b.handle(jsonEncode({'id': 'v1', 'type': type, 'data': {}}));

    test('is offered only where the app can record', () {
      expect(
        gameBridgeScript(playerName: 'x', userId: 'u', talks: true),
        contains('S.voice = {'),
      );
      expect(
        gameBridgeScript(playerName: 'x', userId: 'u'),
        isNot(contains('S.voice')),
      );
      expect(
        gameBridgeScript(playerName: 'x', userId: 'u'),
        contains('S.version = 6;'),
      );
    });

    test('start records, stop hands back the clip, cancel drops it', () async {
      final recorder = _FakeRecorder();
      final b = withVoice(recorder);
      final started = _parse((await ask(b, 'voiceStart'))!);
      expect(started.ok, isTrue);
      expect(started.payload['maxMs'], 15000);
      final stopped = _parse((await ask(b, 'voiceStop'))!);
      expect(stopped.payload, {
        'data': 'QUFB',
        'mime': 'audio/mp4',
        'ms': 1800,
      });
      expect(_parse((await ask(b, 'voiceCancel'))!).ok, isTrue);
      expect(recorder.calls, ['start', 'stop', 'cancel']);
    });

    test(
      'a mic the person has not allowed is a 403 with the way to fix it',
      () async {
        final refused = _parse(
          (await ask(withVoice(_FakeRecorder(allowed: false)), 'voiceStart'))!,
        );
        expect(refused.ok, isFalse);
        expect(refused.payload['status'], 403);
        expect(refused.payload['message'], contains('Settings'));
      },
    );

    test('a phone that cannot record says so', () async {
      final none = _parse((await ask(withVoice(null), 'voiceStart'))!);
      expect(none.ok, isFalse);
      expect(none.payload['status'], 501);
    });
  });
}

class _FakeRecorder extends GameVoiceRecorder {
  _FakeRecorder({this.allowed = true});

  final bool allowed;
  final calls = <String>[];

  @override
  Future<bool> start() async {
    calls.add('start');
    return allowed;
  }

  @override
  Future<GameVoiceClip?> stop() async {
    calls.add('stop');
    return const GameVoiceClip(data: 'QUFB', mime: 'audio/mp4', ms: 1800);
  }

  @override
  Future<void> cancel() async => calls.add('cancel');
}
