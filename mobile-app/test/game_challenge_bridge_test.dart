// Colleague challenges through the web-game bridge: each call the page makes
// reaches the right endpoint under the player's session and comes back as the
// page expects it; a live score finds the challenge in play; refusals carry
// their status and details; and socket events reach the page for this game
// only.
import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/games/data/game_bridge.dart';
import 'package:mobile_app/features/games/data/game_socket_service.dart';
import 'package:mobile_app/features/games/data/games_api_service.dart';

final _session = AuthSession(
  token: 'session-token',
  user: const AuthUser(
    id: 'u-2',
    email: 'divya.rao@getsowaka.com',
    name: 'Divya Rao',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    enabledTabs: ['connect', 'games'],
  ),
);

Map<String, dynamic> _view({String id = 'ch-1', String status = 'accepted', int? seed = 4242}) => {
  'id': id,
  'gameKey': 'odd-one-out',
  'seed': seed,
  'status': status,
  'role': 'opponent',
  'me': {'userId': 'u-2', 'name': 'Divya Rao', 'score': null, 'live': null},
  'them': {'userId': 'u-1', 'name': 'Pooja Nair', 'score': null, 'live': null},
  'outcome': null,
  'myAward': null,
  'theirAward': null,
};

({String id, bool ok, Map<String, dynamic> payload}) _parse(String js) {
  final match = RegExp(r'__reply\(("[^"]*"), (true|false), (.*)\);$').firstMatch(js)!;
  return (
    id: jsonDecode(match.group(1)!) as String,
    ok: match.group(2) == 'true',
    payload: jsonDecode(match.group(3)!) as Map<String, dynamic>,
  );
}

String _call(String type, [Map<String, dynamic> data = const {}]) =>
    jsonEncode({'id': 'c1', 'type': type, 'data': data});

class _FakeRealtime implements GameRealtime {
  final events$ = StreamController<Map<String, dynamic>>.broadcast();
  final reconnects$ = StreamController<void>.broadcast();
  bool connected = false;
  bool disposed = false;

  @override
  Stream<Map<String, dynamic>> get events => events$.stream;

  @override
  Stream<void> get reconnects => reconnects$.stream;

  @override
  void connect() => connected = true;

  @override
  void dispose() {
    disposed = true;
    events$.close();
    reconnects$.close();
  }
}

void main() {
  late List<http.Request> requests;
  late GameBridge bridge;

  void serve(http.Response Function(http.Request request) handler) {
    requests = [];
    bridge = GameBridge(
      service: GamesApiService(
        session: _session,
        baseUrl: 'https://api.example.test',
        client: MockClient((request) async {
          requests.add(request);
          return handler(request);
        }),
      ),
      gameKey: 'odd-one-out',
      company: 'Sowaka',
    );
  }

  http.Response ok(Map<String, dynamic> body) =>
      http.Response(jsonEncode({'success': true, ...body}), 200, headers: {'content-type': 'application/json'});

  group('the page asks, the server answers', () {
    test('colleagues: searched by name, photos made whole', () async {
      serve((_) => ok({
        'colleagues': [
          {'userId': 'u-1', 'name': 'Pooja Nair', 'designation': 'Designer', 'photoUrl': '/media/p%2F1.jpg'},
          {'userId': 'u-3', 'name': 'Raghav', 'photoUrl': null},
        ],
      }));
      final reply = _parse((await bridge.handle(_call('colleagues', {'query': ' poo '})))!);
      expect(requests.single.method, 'GET');
      expect(requests.single.url.path, '/games/challenges/colleagues');
      expect(requests.single.url.queryParameters, {'q': 'poo', 'limit': '50'});
      expect(requests.single.headers['Authorization'], 'Bearer session-token');
      expect(reply.ok, isTrue);
      final people = reply.payload['colleagues'] as List;
      expect(people.first['photoUrl'], 'https://api.example.test/media/p%2F1.jpg');
      expect(people.last['photoUrl'], isNull);
    });

    test('challenge: made for the game the screen opened, the new challenge back', () async {
      serve((_) => ok({'challenge': _view(status: 'pending', seed: null)}));
      final reply = _parse((await bridge.handle(_call('challenge', {'userId': 'u-1'})))!);
      expect(requests.single.method, 'POST');
      expect(requests.single.url.path, '/games/challenges');
      expect(jsonDecode(requests.single.body), {'gameKey': 'odd-one-out', 'opponentUserId': 'u-1'});
      expect(reply.payload['id'], 'ch-1');
      expect(reply.payload['status'], 'pending');
    });

    test('challenges: the four lists, for this game', () async {
      serve((_) => ok({'incoming': [_view(status: 'pending')], 'outgoing': [], 'active': [], 'recent': []}));
      final reply = _parse((await bridge.handle(_call('challenges')))!);
      expect(requests.single.url.path, '/games/challenges');
      expect(requests.single.url.queryParameters, {'game': 'odd-one-out'});
      expect(reply.payload.keys, containsAll(['incoming', 'outgoing', 'active', 'recent']));
      expect((reply.payload['incoming'] as List).single['id'], 'ch-1');
    });

    test('get, accept and decline go to the challenge named', () async {
      serve((request) => ok({'challenge': _view()}));
      await bridge.handle(_call('getChallenge', {'id': 'ch-1'}));
      await bridge.handle(_call('acceptChallenge', {'id': 'ch-1'}));
      await bridge.handle(_call('declineChallenge', {'id': 'ch-1'}));
      expect(requests.map((r) => '${r.method} ${r.url.path}'), [
        'GET /games/challenges/ch-1',
        'POST /games/challenges/ch-1/accept',
        'POST /games/challenges/ch-1/decline',
      ]);
    });

    test('a live score goes to the challenge in play, even without its id', () async {
      serve((request) => request.url.path.endsWith('/live')
          ? ok({'ok': true, 'throttled': false})
          : ok({'challenge': _view(id: 'ch-9')}));
      final none = _parse((await bridge.handle(_call('reportLive', {'score': 300})))!);
      expect(none.ok, isFalse, reason: 'nothing in play yet');
      await bridge.handle(_call('acceptChallenge', {'id': 'ch-9'}));
      expect(bridge.activeChallengeId, 'ch-9');
      final live = _parse((await bridge.handle(_call('reportLive', {'score': 1200})))!);
      expect(live.ok, isTrue);
      expect(requests.last.url.path, '/games/challenges/ch-9/live');
      expect(jsonDecode(requests.last.body), {'score': 1200});
      await bridge.handle(_call('reportLive', {'score': 1500, 'id': 'ch-2'}));
      expect(requests.last.url.path, '/games/challenges/ch-2/live');
    });

    test('finish: the final score, and the challenge after it', () async {
      serve((_) => ok({'challenge': {..._view(status: 'finished'), 'outcome': 'won', 'myAward': {'kind': 'win', 'points': 17}}}));
      final reply = _parse((await bridge.handle(_call('finishChallenge', {'id': 'ch-1', 'score': 4320})))!);
      expect(requests.single.url.path, '/games/challenges/ch-1/finish');
      expect(jsonDecode(requests.single.body), {'score': 4320});
      expect(reply.payload['outcome'], 'won');
      expect(reply.payload['myAward'], {'kind': 'win', 'points': 17});
    });
  });

  test('a refusal reaches the page with its status and details', () async {
    serve((_) => http.Response(
      jsonEncode({'success': false, 'message': 'You already have a challenge open with them', 'details': {'challengeId': 'ch-7'}}),
      409,
    ));
    final reply = _parse((await bridge.handle(_call('challenge', {'userId': 'u-1'})))!);
    expect(reply.ok, isFalse);
    expect(reply.payload, {
      'message': 'You already have a challenge open with them',
      'status': 409,
      'details': {'challengeId': 'ch-7'},
    });
  });

  test('bad ids and scores never reach the server', () async {
    serve((_) => ok({}));
    for (final call in [
      _call('getChallenge', {'id': '../admin'}),
      _call('acceptChallenge'),
      _call('declineChallenge', {'id': 'x' * 65}),
      _call('finishChallenge', {'id': 'ch-1', 'score': -1}),
      _call('finishChallenge', {'id': 'ch-1', 'score': 'lots'}),
      _call('finishChallenge', {'score': 10}),
      _call('reportLive', {'id': 'ch-1', 'score': double.nan.toString()}),
      _call('challenge', {'userId': ''}),
    ]) {
      expect(_parse((await bridge.handle(call))!).ok, isFalse, reason: call);
    }
    expect(requests, isEmpty);
  });

  test('the bridge script offers every challenge call and the challenge to open', () {
    final script = gameBridgeScript(playerName: 'Divya Rao', startChallengeId: 'ch-1');
    for (final name in [
      'colleagues', 'challenge', 'challenges', 'getChallenge', 'acceptChallenge',
      'declineChallenge', 'reportLive', 'finishChallenge',
    ]) {
      expect(script, contains('S.$name = function'), reason: name);
    }
    expect(script, contains('S.startChallengeId = "ch-1";'));
    expect(gameBridgeScript(playerName: 'x'), contains('S.startChallengeId = null;'));
    expect(gameBridgeScript(playerName: 'x', startChallengeId: '</script>'), isNot(contains('</script>')));
    expect(script, contains('error.details = payload.details'));
  });

  group('socket events reach the page', () {
    late _FakeRealtime realtime;
    late List<String> ran;
    late GameEventForwarder forwarder;

    setUp(() {
      realtime = _FakeRealtime();
      ran = [];
      forwarder = GameEventForwarder(
        realtime: realtime,
        gameKey: 'odd-one-out',
        run: (script) async => ran.add(script),
      )..start();
    });

    test('connects, and passes on this game\'s events as they come', () async {
      expect(realtime.connected, isTrue);
      realtime.events$.add({'kind': 'live', 'challengeId': 'ch-1', 'gameKey': 'odd-one-out', 'userId': 'u-1', 'score': 900});
      realtime.events$.add({'kind': 'accepted', 'challengeId': 'ch-1', 'gameKey': 'odd-one-out', 'challenge': _view()});
      await Future<void>.delayed(Duration.zero);
      expect(ran, hasLength(2));
      expect(ran.first, startsWith('window.onSowakaChallenge && window.onSowakaChallenge({'));
      final payload = jsonDecode(RegExp(r'onSowakaChallenge\((\{.*\})\);$').firstMatch(ran.first)!.group(1)!);
      expect(payload, {'kind': 'live', 'challengeId': 'ch-1', 'gameKey': 'odd-one-out', 'userId': 'u-1', 'score': 900});
      expect(ran.last, contains('"kind":"accepted"'));
    });

    test("another game's events are not this page's", () async {
      realtime.events$.add({'kind': 'created', 'challengeId': 'ch-2', 'gameKey': 'word-ladder'});
      realtime.events$.add({'kind': 'created', 'challengeId': 'ch-3'});
      await Future<void>.delayed(Duration.zero);
      expect(ran, isEmpty);
    });

    test('after a reconnection the page is told to read its lists again', () async {
      realtime.reconnects$.add(null);
      await Future<void>.delayed(Duration.zero);
      expect(ran.single, contains('"kind":"resync"'));
    });

    test('a name in an event cannot break out of the script', () {
      final js = challengeEventScript({'kind': 'created', 'challenge': {'them': {'name': '</script><b>\u2028'}}});
      expect(js, isNot(contains('</script>')));
      expect(js, isNot(contains('\u2028')));
    });

    test('closing the game closes the socket', () {
      forwarder.dispose();
      expect(realtime.disposed, isTrue);
    });
  });
}
