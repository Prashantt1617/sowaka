import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import 'game_bridge.dart';

/// What a game's screen listens to: a change to one of the person's
/// challenges, or the connection came back and anything could have.
abstract class GameRealtime {
  Stream<Map<String, dynamic>> get events;
  Stream<void> get reconnects;
  void connect();
  void dispose();
}

/// `game:challenge` on the app's socket (path `/connect/socket`), on the
/// person's own `user:<id>` room: a challenge created, accepted, declined,
/// scored, finished or expired, with the person's own view of it, or the
/// other player's score mid-round. Lives only while a game is open.
class GameSocketService implements GameRealtime {
  GameSocketService({required this.session, String? baseUrl})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl;

  final AuthSession session;
  final String _baseUrl;

  io.Socket? _socket;
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  final _reconnects = StreamController<void>.broadcast();
  bool _hasConnectedOnce = false;

  @override
  Stream<Map<String, dynamic>> get events => _events.stream;

  @override
  Stream<void> get reconnects => _reconnects.stream;

  @override
  void connect() {
    if (_socket != null) return;
    final socket = io.io(
      _baseUrl,
      io.OptionBuilder()
          .setPath('/connect/socket')
          .setTransports(['websocket', 'polling'])
          .setAuth({'token': session.token})
          .enableReconnection()
          .enableForceNew()
          .build(),
    );
    socket.onConnect((_) {
      if (_hasConnectedOnce && !_reconnects.isClosed) _reconnects.add(null);
      _hasConnectedOnce = true;
    });
    socket.on('game:challenge', (data) {
      if (data is! Map || _events.isClosed) return;
      _events.add(Map<String, dynamic>.from(data));
    });
    _socket = socket;
  }

  @override
  void dispose() {
    _socket?.dispose();
    _socket = null;
    _events.close();
    _reconnects.close();
  }
}

/// Passes a game's challenge events to its page as they arrive: those for
/// [gameKey] only, each as [challengeEventScript], and a `resync` after a
/// reconnection so the page reads its lists again.
class GameEventForwarder {
  GameEventForwarder({
    required this.realtime,
    required this.gameKey,
    required this.run,
  });

  final GameRealtime realtime;
  final String gameKey;

  /// Runs JavaScript in the page.
  final Future<void> Function(String script) run;

  StreamSubscription<Map<String, dynamic>>? _events;
  StreamSubscription<void>? _reconnects;

  void start() {
    if (_events != null) return;
    _events = realtime.events.listen((event) {
      if (event['gameKey'] != gameKey) return;
      unawaited(run(challengeEventScript(event)));
    });
    _reconnects = realtime.reconnects.listen((_) {
      unawaited(run(challengeEventScript({'kind': 'resync', 'gameKey': gameKey})));
    });
    realtime.connect();
  }

  void dispose() {
    _events?.cancel();
    _reconnects?.cancel();
    _events = null;
    _reconnects = null;
    realtime.dispose();
  }
}
