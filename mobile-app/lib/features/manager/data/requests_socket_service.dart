import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';

/// Hears, the moment it happens, that one of this person's requests changed —
/// a leave, overtime, correction or claim raised to them or decided for them.
///
/// The server sends only what kind of request it was; the app then reads its
/// own lists, so nothing it shows comes from a payload anyone else could see.
/// It rides the same socket endpoint as the feed, on the person's own channel,
/// and lives as long as the signed-in app rather than only while the feed is
/// open.
class RequestsSocketService {
  RequestsSocketService({required this.session, String? baseUrl})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl;

  final AuthSession session;
  final String _baseUrl;

  io.Socket? _socket;
  final _changes = StreamController<String>.broadcast();
  final _reconnects = StreamController<void>.broadcast();
  bool _hasConnectedOnce = false;

  /// The kind of request that changed, e.g. `leave_submitted`.
  Stream<String> get changes => _changes.stream;

  /// After a re-connection — the app was in the background, or the network
  /// dropped — so anything missed meanwhile is read again.
  Stream<void> get reconnects => _reconnects.stream;

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
    socket.on('requests:changed', (data) {
      final kind = data is Map ? '${data['kind'] ?? ''}' : '';
      if (!_changes.isClosed) _changes.add(kind);
    });
    _socket = socket;
  }

  void dispose() {
    _socket?.dispose();
    _socket = null;
    _changes.close();
    _reconnects.close();
  }
}
