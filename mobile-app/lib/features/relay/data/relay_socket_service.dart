import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import 'relay_models.dart';

/// The game's connection.
///
/// A separate namespace from Connect's feed, on the same socket server, so
/// there is one upgrade through the proxy and one way of authenticating. Every
/// message carries the player's whole state: a clue is meant for one device, so
/// nothing here fetches a shared payload that others could ask for too.
class RelaySocketService {
  RelaySocketService({required this.session, String? baseUrl})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl;

  final AuthSession session;
  final String _baseUrl;

  io.Socket? _socket;
  Timer? _heartbeat;
  final _states = StreamController<RelayState>.broadcast();
  final _results = StreamController<RelayResult>.broadcast();
  final _errors = StreamController<String>.broadcast();

  /// The player's own view, pushed whenever it changes.
  Stream<RelayState> get states => _states.stream;

  /// How a submitted answer landed, straight back to whoever sent it.
  Stream<RelayResult> get results => _results.stream;

  /// Refusals worth showing — answering when you are not the lead, mostly.
  Stream<String> get errors => _errors.stream;

  bool get isConnected => _socket?.connected ?? false;

  void connect() {
    if (_socket != null) return;
    final socket = io.io(
      // The namespace is part of the address. Without it the socket joined
      // Connect's feed channel and never heard a single game update — the
      // lobby simply waited forever.
      '$_baseUrl/relay',
      io.OptionBuilder()
          // The game rides Connect's socket server on its own namespace.
          .setPath('/connect/socket')
          .setTransports(['websocket', 'polling'])
          .setAuth({'token': session.token})
          .enableReconnection()
          .enableForceNew()
          .build(),
    );

    // A connection that never succeeds must say so; a silent spinner is how
    // the wrong address went unnoticed.
    socket.onConnectError((_) {
      if (!_errors.isClosed) _errors.add('Can’t reach the game. Check your connection.');
    });

    socket.on('relay:state', (data) {
      if (data is! Map) return;
      if (!_states.isClosed) {
        _states.add(RelayState.fromJson(Map<String, dynamic>.from(data)));
      }
    });
    socket.on('relay:result', (data) {
      if (data is! Map) return;
      if (!_results.isClosed) {
        _results.add(RelayResult.fromJson(Map<String, dynamic>.from(data)));
      }
    });
    socket.on('relay:error', (data) {
      final message = data is Map ? data['message'] : null;
      if (message is String && !_errors.isClosed) _errors.add(message);
    });

    // Holding the socket already counts as being present; this is a cheap
    // second signal for the stretch before the first state arrives.
    _heartbeat = Timer.periodic(const Duration(seconds: 10), (_) {
      socket.emit('relay:heartbeat');
    });

    _socket = socket;
  }

  /// Only the lead has an answer box, so only the lead ever sends this.
  void submitAnswer(String text) => _socket?.emit('relay:answer', {'text': text});

  void skipQuestion() => _socket?.emit('relay:skip');

  /// Sent while the lead types, so their team's screens can say somebody is on
  /// it. Expires by itself a few seconds after they stop.
  void reportTyping() => _socket?.emit('relay:typing');

  void dispose() {
    _heartbeat?.cancel();
    _heartbeat = null;
    _socket?.dispose();
    _socket = null;
    _states.close();
    _results.close();
    _errors.close();
  }
}
