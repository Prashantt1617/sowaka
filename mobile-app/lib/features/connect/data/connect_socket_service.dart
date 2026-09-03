import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';

enum ConnectChangeAction { created, updated, deleted }

/// A post changed somewhere else in the org. Deliberately carries no post body:
/// every viewer sees their own rendering of a post (their own `liked`, poll
/// choice, action state), so the client fetches its own view of it.
class ConnectChange {
  const ConnectChange({
    required this.postId,
    required this.action,
    this.actorUserId,
  });

  final String postId;
  final ConnectChangeAction action;
  final String? actorUserId;

  static ConnectChange? fromJson(Map<String, dynamic> json) {
    final postId = json['postId'];
    if (postId is! String || postId.isEmpty) return null;
    final action = switch (json['action']) {
      'created' => ConnectChangeAction.created,
      'updated' => ConnectChangeAction.updated,
      'deleted' => ConnectChangeAction.deleted,
      _ => null,
    };
    if (action == null) return null;
    return ConnectChange(
      postId: postId,
      action: action,
      actorUserId: json['actorUserId'] as String?,
    );
  }
}

/// Live Connect updates over socket.io.
///
/// Reconnects are left to the socket.io client, which retries with backoff on
/// its own. [reconnects] fires after any re-established connection so callers
/// can resync whatever they missed while the socket was down.
class ConnectSocketService {
  ConnectSocketService({required this.session, String? baseUrl})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl;

  final AuthSession session;
  final String _baseUrl;

  io.Socket? _socket;
  final _changes = StreamController<ConnectChange>.broadcast();
  final _reconnects = StreamController<void>.broadcast();
  bool _hasConnectedOnce = false;

  Stream<ConnectChange> get changes => _changes.stream;

  /// Emits after a *re*-connection (not the first connect), signalling that the
  /// caller should refetch to catch changes missed while disconnected.
  Stream<void> get reconnects => _reconnects.stream;

  bool get isConnected => _socket?.connected ?? false;

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
      if (_hasConnectedOnce) {
        if (!_reconnects.isClosed) _reconnects.add(null);
      }
      _hasConnectedOnce = true;
    });

    socket.on('connect:changed', (data) {
      if (data is! Map) return;
      final change = ConnectChange.fromJson(Map<String, dynamic>.from(data));
      if (change != null && !_changes.isClosed) _changes.add(change);
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
