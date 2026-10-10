import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import 'support_models.dart';

/// What the Support screens listen to: a ticket of this person's changed, or
/// the connection came back and anything could have.
abstract class SupportRealtime {
  Stream<SupportChange> get changes;
  Stream<void> get reconnects;
  void connect();
  void dispose();
}

/// `support:changed` on the app's socket (path `/connect/socket`), on the
/// person's own `user:<id>` room.
///
/// The payload names the ticket and what happened, never its content; the
/// screens then read the ticket again, so nothing shown comes from a payload.
/// Lives only while the Support desk is open.
class SupportSocketService implements SupportRealtime {
  SupportSocketService({required this.session, String? baseUrl})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl;

  final AuthSession session;
  final String _baseUrl;

  io.Socket? _socket;
  final _changes = StreamController<SupportChange>.broadcast();
  final _reconnects = StreamController<void>.broadcast();
  bool _hasConnectedOnce = false;

  @override
  Stream<SupportChange> get changes => _changes.stream;

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
    socket.on('support:changed', (data) {
      if (data is! Map || _changes.isClosed) return;
      _changes.add(
        SupportChange(
          ticketId: '${data['ticketId'] ?? ''}',
          kind: '${data['kind'] ?? ''}',
        ),
      );
    });
    _socket = socket;
  }

  @override
  void dispose() {
    _socket?.dispose();
    _socket = null;
    _changes.close();
    _reconnects.close();
  }
}
