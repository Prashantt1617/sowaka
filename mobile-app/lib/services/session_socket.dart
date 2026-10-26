import 'package:socket_io_client/socket_io_client.dart' as io;

import 'api_config.dart';

/// The one live connection to `/connect/socket` a signed-in phone keeps.
///
/// The feed (`connect:changed`) and the person's requests
/// (`requests:changed`) are two channels on the same endpoint, and each used
/// to open its own socket, with a third every time the feed was built again:
/// two or more sockets per phone, each reconnecting (and re-reading what it
/// had missed) on its own. Both now borrow this one; it opens with the first
/// and closes when the last lets go.
class SessionSocket {
  SessionSocket._(this._key, this.socket);

  static final _open = <String, SessionSocket>{};

  final String _key;

  /// The socket itself, for listening on: `on(event, handler)` and
  /// `off(event, handler)` with the same handler. Never disposed by a user.
  final io.Socket socket;
  int _users = 0;

  /// The shared socket for this sign-in on [baseUrl], opened if need be.
  /// Every [acquire] is matched by one [release].
  static SessionSocket acquire(String token, {String? baseUrl}) {
    final url = baseUrl ?? ApiConfig.baseUrl;
    final key = '$url|$token';
    final shared = _open[key] ??= SessionSocket._(
      key,
      io.io(
        url,
        io.OptionBuilder()
            .setPath('/connect/socket')
            // WebSocket first: the proxy in front of the API passes the
            // upgrade through, so this connects directly without a polling
            // handshake. Polling stays listed purely as a fallback for
            // networks that block WebSocket outright.
            .setTransports(['websocket', 'polling'])
            .setAuth({'token': token})
            .enableReconnection()
            // Its own Manager: a socket for the next sign-in on this phone
            // must not reuse this one's connection or its token.
            .enableForceNew()
            .build(),
      ),
    );
    shared._users += 1;
    return shared;
  }

  /// Done with it; the last one out closes the connection.
  void release() {
    _users -= 1;
    if (_users > 0) return;
    if (identical(_open[_key], this)) _open.remove(_key);
    socket.dispose();
  }
}
