import 'dart:convert';

import 'games_api_service.dart';

/// The JavaScript channel the Games tab's web home talks to the app through.
/// Its own, apart from a game's ([gameBridgeChannel]): the home and a game
/// never share a bridge.
const String homePageChannel = 'SowakaHome';

/// What the Games tab's web home sees as `window.Sowaka` (the contract,
/// v1, in the page's own words):
///
///   Sowaka.native                  true
///   Sowaka.homeVersion             1
///   Sowaka.reduceMotion            the phone's reduced-motion setting
///   Sowaka.userId                  the signed-in person's id, a string
///   Sowaka.org                     the company's id, for its logo in the header
///   Sowaka.nativeGames             the keys of the games the app opens
///                                  natively (its own screens), an array
///   Sowaka.home()                  `GET /games/home`, pictures made whole
///   Sowaka.leaderboard(period)     `GET /games/leaderboard?period=week|all`
///   Sowaka.acceptChallenge(id)     the challenge after it
///   Sowaka.openGame(key, id?)      fire and forget: the game, on challenge id
///   Sowaka.openContest(postId)     fire and forget: the contest's Entries
///   Sowaka.openPost(postId)        fire and forget: the post in the feed
///   Sowaka.openProfile(userId)     fire and forget: their profile
///   Sowaka.toast(text)             fire and forget: a native toast
///   Sowaka.haptic(kind)            fire and forget: light | medium | success
///
/// Calls that answer go out over [homePageChannel] as `{id, type, data}` and
/// are settled by `Sowaka.__reply(id, ok, payload)`, as a game's bridge does;
/// each id carries [loadId], the page load it was asked in, so an answer
/// meant for a page since replaced can never settle a call in the new one;
/// a refusal rejects with an Error carrying the server's `message` and its
/// `status`. Fire-and-forget calls go out with no id and get no answer.
/// `sowaka-ready` fires on window once `window.Sowaka` exists. The app tells
/// the page what happens around it through `window.onSowakaHome(event)`
/// ([homeEventScript]).
String homePageBridgeScript({
  required bool reduceMotion,
  required String userId,
  String org = '',
  List<String> nativeGames = const [],
  String loadId = '',
}) =>
    '''
(function () {
  if (window.Sowaka && window.Sowaka.native) return;
  var pending = {}, seq = 0, load = ${_scriptJson(loadId)};
  function send(message) {
    $homePageChannel.postMessage(JSON.stringify(message));
  }
  function call(type, data) {
    return new Promise(function (resolve, reject) {
      var id = 'h' + load + '.' + (++seq);
      pending[id] = { resolve: resolve, reject: reject };
      try {
        send({ id: id, type: type, data: data || {} });
      } catch (e) {
        delete pending[id];
        reject(e);
      }
    });
  }
  function tell(type, data) {
    try { send({ id: null, type: type, data: data || {} }); } catch (e) {}
  }
  function text(value) { return value == null ? null : String(value); }
  var S = window.Sowaka || {};
  S.native = true;
  S.homeVersion = 1;
  S.reduceMotion = ${reduceMotion ? 'true' : 'false'};
  S.userId = ${_scriptJson(userId)};
  S.org = ${_scriptJson(org)};
  S.nativeGames = ${_scriptJson(nativeGames)};
  S.home = function () { return call('home'); };
  S.leaderboard = function (period) { return call('leaderboard', { period: period === 'all' ? 'all' : 'week' }); };
  S.acceptChallenge = function (id) { return call('acceptChallenge', { id: text(id) }); };
  S.openGame = function (key, challengeId) { tell('openGame', { key: text(key), challengeId: text(challengeId) }); };
  S.openContest = function (postId) { tell('openContest', { postId: text(postId) }); };
  S.openPost = function (postId) { tell('openPost', { postId: text(postId) }); };
  S.openProfile = function (userId) { tell('openProfile', { userId: text(userId) }); };
  S.toast = function (value) { tell('toast', { text: text(value) }); };
  S.haptic = function (kind) { tell('haptic', { kind: text(kind) }); };
  S.__reply = function (id, ok, payload) {
    var p = pending[id];
    if (!p) return;
    delete pending[id];
    if (ok) { p.resolve(payload); return; }
    var error = new Error((payload && payload.message) || 'Something went wrong');
    if (payload && payload.status) error.status = payload.status;
    p.reject(error);
  };
  window.Sowaka = S;
  try { window.dispatchEvent(new CustomEvent('sowaka-ready')); } catch (e) {}
})();
''';

/// The JavaScript that hands [event] to the page: `{kind: 'visible' |
/// 'hidden' | 'reset' | 'refresh'}` or `{kind: 'challenge', challenge}`.
/// Dropped when the page has not set its handler yet.
String homeEventScript(Map<String, dynamic> event) =>
    'window.onSowakaHome && window.onSowakaHome(${_scriptJson(event)});';

/// [value] as a JavaScript literal that is safe inside a `<script>` element.
String _scriptJson(Object? value) => jsonEncode(value)
    .replaceAll('<', r'\u003c')
    .replaceAll('\u2028', r'\u2028')
    .replaceAll('\u2029', r'\u2029');

/// What the page may load: the game pages' policy, plus the fonts it is
/// allowed. No frames (on Android a frame could reach the bridge), no
/// requests of its own: everything comes through the bridge.
const homePagePolicy =
    "default-src 'none'; script-src 'unsafe-inline'; "
    "style-src 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; "
    "media-src 'self' data: blob: https:; connect-src 'none'; frame-src 'none'; "
    "base-uri 'none'; form-action 'none'";

/// [html] with the policy and [script] in it, ahead of the page's own
/// scripts: right after `<head>`, else after the doctype, else at the start.
String injectHomeBridge(String html, String script) {
  final tag =
      '<meta http-equiv="Content-Security-Policy" content="$homePagePolicy">\n'
      '<script>\n$script</script>\n';
  final head = RegExp(
    r'<head(\s[^>]*)?>',
    caseSensitive: false,
  ).firstMatch(html);
  if (head != null) return html.replaceRange(head.end, head.end, '\n$tag');
  final doctype = RegExp(
    r'<!doctype[^>]*>',
    caseSensitive: false,
  ).firstMatch(html);
  if (doctype != null)
    return html.replaceRange(doctype.end, doctype.end, '\n$tag');
  return '$tag$html';
}

/// What the page's fire-and-forget calls do in the app, and the data the
/// answering ones need. The tab supplies them; tests give their own.
class HomePageActions {
  const HomePageActions({
    required this.home,
    required this.leaderboard,
    required this.acceptChallenge,
    required this.openGame,
    required this.openContest,
    required this.openPost,
    required this.openProfile,
    required this.toast,
    required this.haptic,
  });

  final Future<Map<String, dynamic>> Function() home;
  final Future<Map<String, dynamic>> Function(String period) leaderboard;
  final Future<Map<String, dynamic>> Function(String id) acceptChallenge;
  final void Function(String key, String? challengeId) openGame;
  final void Function(String postId) openContest;
  final void Function(String postId) openPost;
  final void Function(String userId) openProfile;
  final void Function(String text) toast;
  final void Function(String kind) haptic;
}

/// A server id: a challenge's, a post's, a person's, a game's key.
final RegExp _id = RegExp(r'^[A-Za-z0-9_-]{1,80}$');

/// What a game opens on: a challenge's id, or `room:<code>` for an invite to
/// a live room (Scribble and Tile Up read the prefix themselves).
final RegExp _startId = RegExp(r'^(room:)?[A-Za-z0-9_-]{1,80}$');

/// The app's half of the home's bridge: reads one message, does what it
/// asks, and returns the JavaScript that answers it. Null for a message that
/// needs no answer (fire and forget) or cannot be answered.
class HomePageBridge {
  HomePageBridge(this.actions);

  final HomePageActions actions;

  Future<String?> handle(String raw) async {
    Map<String, dynamic> message;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return null;
      message = decoded;
    } catch (_) {
      return null;
    }
    final data = message['data'] is Map
        ? Map<String, dynamic>.from(message['data'] as Map)
        : const <String, dynamic>{};
    String? idOf(String field) {
      final value = data[field];
      return value is String && _id.hasMatch(value) ? value : null;
    }

    final id = message['id'];
    if (id == null) {
      _tell('${message['type']}', data, idOf);
      return null;
    }
    if (id is! String || id.isEmpty || id.length > 40) return null;
    try {
      switch (message['type']) {
        case 'home':
          return reply(id, true, await actions.home());
        case 'leaderboard':
          return reply(
            id,
            true,
            await actions.leaderboard(data['period'] == 'all' ? 'all' : 'week'),
          );
        case 'acceptChallenge':
          final target = idOf('id');
          if (target == null)
            return reply(id, false, {'message': 'Challenge not found'});
          return reply(id, true, await actions.acceptChallenge(target));
        default:
          return reply(id, false, {'message': 'Unknown request'});
      }
    } on GamesApiException catch (error) {
      return reply(id, false, {
        'message': error.message,
        'status': ?error.statusCode,
      });
    } catch (_) {
      return reply(id, false, {'message': 'Could not reach Sowaka'});
    }
  }

  void _tell(
    String type,
    Map<String, dynamic> data,
    String? Function(String) idOf,
  ) {
    switch (type) {
      case 'openGame':
        final key = idOf('key');
        final start = data['challengeId'];
        if (key != null) {
          actions.openGame(
            key,
            start is String && _startId.hasMatch(start) ? start : null,
          );
        }
      case 'openContest':
        final post = idOf('postId');
        if (post != null) actions.openContest(post);
      case 'openPost':
        final post = idOf('postId');
        if (post != null) actions.openPost(post);
      case 'openProfile':
        final user = idOf('userId');
        if (user != null) actions.openProfile(user);
      case 'toast':
        final text = data['text'];
        if (text is String && text.trim().isNotEmpty) {
          actions.toast(
            text.trim().length > 200
                ? '${text.trim().substring(0, 200)}…'
                : text.trim(),
          );
        }
      case 'haptic':
        final kind = data['kind'];
        actions.haptic(
          kind is String && const {'light', 'medium', 'success'}.contains(kind)
              ? kind
              : 'light',
        );
    }
  }

  /// The call that settles the page's promise [id].
  static String reply(String id, bool ok, Map<String, dynamic> payload) =>
      'window.Sowaka && window.Sowaka.__reply(${jsonEncode(id)}, $ok, ${_scriptJson(payload)});';
}
