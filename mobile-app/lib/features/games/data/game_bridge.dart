import 'dart:convert';

import 'games_api_service.dart';

/// The JavaScript channel a game's page talks to the app through.
const String gameBridgeChannel = 'SowakaGame';

/// What a web game sees as `window.Sowaka`:
///
///   Sowaka.native          true: running inside the Sowaka app
///   Sowaka.playerName()    the player's name, at once
///   Sowaka.submitScore(n)  a Promise of the board after it; the app posts
///                          the score under the player's own session
///   Sowaka.leaderboard()   a Promise of {entries: [{rank, name, score, me}],
///                          me: {rank, score} | null, company, label}
///
/// and for colleague challenges, each a Promise of what the server answered:
///
///   Sowaka.colleagues(query)          {colleagues: [{userId, name, designation,
///                                     department, photoUrl}]}
///   Sowaka.challenge(userId)          the new challenge
///   Sowaka.challenges()               {incoming, outgoing, active, recent}
///   Sowaka.getChallenge(id)           one challenge
///   Sowaka.acceptChallenge(id)        the challenge after it
///   Sowaka.declineChallenge(id)       the challenge after it
///   Sowaka.reportLive(score[, id])    the score mid-round, to the other player;
///                                     without an id, the challenge in play
///   Sowaka.finishChallenge(id, score) the challenge once this final is in
///   Sowaka.startChallengeId           the challenge a tapped notification
///                                     opened the game on, or null
///
/// and the app calls `window.onSowakaChallenge(event)` for each change to one
/// of the player's challenges in this game (see [challengeEventScript]).
///
/// Calls go out over [gameBridgeChannel] as `{id, type, data}`, and the app
/// answers by calling `Sowaka.__reply(id, ok, payload)`; a refusal rejects
/// with an Error carrying the server's `message`, and its `status` and
/// `details` when there are any. A page that loads without the app (a plain
/// browser) has no `window.Sowaka` and is expected to keep its scores itself.
/// A `sowaka-ready` event fires when the bridge arrives, for a page that
/// started before it.
String gameBridgeScript({required String playerName, String? startChallengeId}) {
  // Inside a <script> element: '<' is escaped so a value can never close it.
  final name = _scriptJson(playerName);
  final startId = _scriptJson(startChallengeId);
  return '''
(function () {
  if (window.Sowaka && window.Sowaka.native) return;
  var pending = {}, seq = 0;
  function call(type, data) {
    return new Promise(function (resolve, reject) {
      var id = 'c' + (++seq);
      pending[id] = { resolve: resolve, reject: reject };
      try {
        $gameBridgeChannel.postMessage(JSON.stringify({ id: id, type: type, data: data || {} }));
      } catch (e) {
        delete pending[id];
        reject(e);
      }
    });
  }
  function text(value) { return value == null ? null : String(value); }
  var S = window.Sowaka || {};
  S.native = true;
  S.version = 2;
  S.playerName = function () { return $name; };
  S.submitScore = function (score) { return call('submitScore', { score: Number(score) }); };
  S.leaderboard = function () { return call('leaderboard'); };
  S.colleagues = function (query) { return call('colleagues', { query: text(query) || '' }); };
  S.challenge = function (userId) { return call('challenge', { userId: text(userId) }); };
  S.challenges = function () { return call('challenges'); };
  S.getChallenge = function (id) { return call('getChallenge', { id: text(id) }); };
  S.acceptChallenge = function (id) { return call('acceptChallenge', { id: text(id) }); };
  S.declineChallenge = function (id) { return call('declineChallenge', { id: text(id) }); };
  S.reportLive = function (score, id) { return call('reportLive', { score: Number(score), id: text(id) }); };
  S.finishChallenge = function (id, score) { return call('finishChallenge', { id: text(id), score: Number(score) }); };
  S.startChallengeId = $startId;
  S.__reply = function (id, ok, payload) {
    var p = pending[id];
    if (!p) return;
    delete pending[id];
    if (ok) { p.resolve(payload); return; }
    var error = new Error((payload && payload.message) || 'Something went wrong');
    if (payload && payload.status) error.status = payload.status;
    if (payload && payload.details) error.details = payload.details;
    p.reject(error);
  };
  window.Sowaka = S;
  try { window.dispatchEvent(new CustomEvent('sowaka-ready')); } catch (e) {}
})();
''';
}

/// [value] as a JavaScript literal that is safe inside a `<script>` element.
String _scriptJson(Object? value) => jsonEncode(value)
    .replaceAll('<', r'\u003c')
    .replaceAll('\u2028', r'\u2028')
    .replaceAll('\u2029', r'\u2029');

/// The JavaScript that hands one `game:challenge` event to the page:
/// `{kind, challengeId, gameKey, challenge}`, or for the other player's score
/// mid-round `{kind: 'live', challengeId, userId, score}`, or `{kind:
/// 'resync'}` after the connection came back and anything could have changed.
String challengeEventScript(Map<String, dynamic> event) =>
    'window.onSowakaChallenge && window.onSowakaChallenge(${_scriptJson(event)});';

/// What a game page may load, as the server sends it with `/play` (a page
/// loaded from a string never gets the header), plus no frames at all: on
/// Android a frame could reach the bridge, which every frame can see there.
const gamePagePolicy =
    "default-src 'none'; script-src 'unsafe-inline'; "
    "style-src 'unsafe-inline' https://fonts.googleapis.com; "
    'font-src https://fonts.gstatic.com data:; img-src data: blob: https:; '
    "media-src data: blob:; connect-src 'none'; frame-src 'none'; "
    "base-uri 'none'; form-action 'none'";

/// [html] with the page policy and [script] in it, ahead of the page's own
/// scripts, so both are in force before the game's first line runs: right
/// after `<head>`, else after the doctype, else at the very start.
String injectGameBridge(String html, String script) {
  final tag =
      '<meta http-equiv="Content-Security-Policy" content="$gamePagePolicy">\n'
      '<script>\n$script</script>\n';
  final head = RegExp(r'<head(\s[^>]*)?>', caseSensitive: false).firstMatch(html);
  if (head != null) {
    return html.replaceRange(head.end, head.end, '\n$tag');
  }
  final doctype = RegExp(r'<!doctype[^>]*>', caseSensitive: false).firstMatch(html);
  if (doctype != null) {
    return html.replaceRange(doctype.end, doctype.end, '\n$tag');
  }
  return '$tag$html';
}

/// A challenge id as the server makes them; anything else is never sent.
final RegExp _challengeId = RegExp(r'^[A-Za-z0-9-]{1,64}$');

/// The app's half of the bridge: reads one message from the page, does what
/// it asks with the person's session, and returns the JavaScript that hands
/// the answer back. Null for a message that cannot be answered (no id).
class GameBridge {
  GameBridge({
    required this.service,
    required this.gameKey,
    required this.company,
  });

  final GamesApiService service;
  final String gameKey;

  /// The company's name, for the board's heading.
  final String company;

  /// The challenge being played: the last one the page accepted, opened or
  /// was answered about while it was in play. A live score without an id is
  /// for this one.
  String? activeChallengeId;

  Future<String?> handle(String raw) async {
    Map<String, dynamic> message;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return null;
      message = decoded;
    } catch (_) {
      return null;
    }
    final id = message['id'];
    if (id is! String || id.isEmpty || id.length > 40) return null;
    final data = message['data'] is Map
        ? Map<String, dynamic>.from(message['data'] as Map)
        : const <String, dynamic>{};
    String? challengeId() {
      final value = data['id'];
      return value is String && _challengeId.hasMatch(value) ? value : null;
    }

    num? score() {
      final value = data['score'];
      return value is num && value.isFinite && value >= 0 ? value : null;
    }

    try {
      switch (message['type']) {
        case 'submitScore':
          final value = score();
          if (value == null) return reply(id, false, {'message': 'Score is invalid'});
          final board = await service.submitScore(gameKey, value);
          return reply(id, true, board.toPageJson(company: company));
        case 'leaderboard':
          final board = await service.leaderboard(gameKey);
          return reply(id, true, board.toPageJson(company: company));
        case 'colleagues':
          final query = data['query'];
          return reply(
            id,
            true,
            await service.colleagues(query is String ? query.trim() : ''),
          );
        case 'challenge':
          final userId = data['userId'];
          if (userId is! String || userId.trim().isEmpty || userId.length > 64) {
            return reply(id, false, {'message': 'Choose who to challenge'});
          }
          return reply(id, true, _seen(await service.createChallenge(gameKey, userId.trim())));
        case 'challenges':
          return reply(id, true, await service.challenges(gameKey));
        case 'getChallenge':
        case 'acceptChallenge':
        case 'declineChallenge':
          final target = challengeId();
          if (target == null) return reply(id, false, {'message': 'Challenge not found'});
          final view = switch (message['type']) {
            'acceptChallenge' => await service.acceptChallenge(target),
            'declineChallenge' => await service.declineChallenge(target),
            _ => await service.challenge(target),
          };
          return reply(id, true, _seen(view));
        case 'reportLive':
          final value = score();
          final target = challengeId() ?? activeChallengeId;
          if (value == null) return reply(id, false, {'message': 'Score is invalid'});
          if (target == null) return reply(id, false, {'message': 'No challenge is being played'});
          return reply(id, true, await service.reportLive(target, value));
        case 'finishChallenge':
          final value = score();
          final target = challengeId();
          if (value == null) return reply(id, false, {'message': 'Score is invalid'});
          if (target == null) return reply(id, false, {'message': 'Challenge not found'});
          return reply(id, true, _seen(await service.finishChallenge(target, value)));
        default:
          return reply(id, false, {'message': 'Unknown request'});
      }
    } on GamesApiException catch (error) {
      return reply(id, false, {
        'message': error.message,
        'status': ?error.statusCode,
        'details': ?error.details,
      });
    } catch (_) {
      return reply(id, false, {'message': 'Could not reach Sowaka'});
    }
  }

  /// Notes a challenge that is now in play, so a live score finds it.
  Map<String, dynamic> _seen(Map<String, dynamic> view) {
    final viewId = view['id'];
    if (view['status'] == 'accepted' && viewId is String) activeChallengeId = viewId;
    return view;
  }

  /// The call that settles the page's promise [id].
  static String reply(String id, bool ok, Map<String, dynamic> payload) =>
      'window.Sowaka && window.Sowaka.__reply(${jsonEncode(id)}, $ok, ${jsonEncode(payload)});';
}
