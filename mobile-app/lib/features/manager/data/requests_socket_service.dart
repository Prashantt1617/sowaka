import 'dart:async';

import '../../../services/api_config.dart';
import '../../../services/session_socket.dart';
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

  /// The sign-in's one socket, shared with the feed; see [SessionSocket].
  SessionSocket? _shared;
  final _changes = StreamController<String>.broadcast();
  final _reconnects = StreamController<void>.broadcast();
  bool _hasConnectedOnce = false;

  /// The kind of request that changed, e.g. `leave_submitted`.
  Stream<String> get changes => _changes.stream;

  /// After a re-connection that followed at least [missedAfter] without one
  /// — the app was in the background, or the network was gone a while — so
  /// anything missed meanwhile is read again. A short drop is not reported:
  /// `requests:changed` says what changed while the socket is up.
  Stream<void> get reconnects => _reconnects.stream;

  /// When the connection last dropped, while it is down.
  DateTime? _lostAt;

  /// Down for less than this, and nothing is read again on the way back: a
  /// change in that window is rare, the minute's leave poll covers the common
  /// one, and every reconnection (a lift, a tunnel, a flaky office Wi-Fi) read
  /// all eight request lists.
  static const missedAfter = Duration(minutes: 2);

  void _onDisconnect(dynamic _) => _lostAt ??= DateTime.now();

  void _onConnect(dynamic _) {
    final lostAt = _lostAt;
    _lostAt = null;
    final away = lostAt == null ? Duration.zero : DateTime.now().difference(lostAt);
    if (_hasConnectedOnce && away >= missedAfter && !_reconnects.isClosed) {
      _reconnects.add(null);
    }
    _hasConnectedOnce = true;
  }

  void _onChanged(dynamic data) {
    final kind = data is Map ? '${data['kind'] ?? ''}' : '';
    if (!_changes.isClosed) _changes.add(kind);
  }

  void connect() {
    if (_shared != null) return;
    final shared = SessionSocket.acquire(session.token, baseUrl: _baseUrl);
    _hasConnectedOnce = shared.socket.connected;
    shared.socket
      ..on('connect', _onConnect)
      ..on('disconnect', _onDisconnect)
      ..on('requests:changed', _onChanged);
    _shared = shared;
  }

  void dispose() {
    final shared = _shared;
    if (shared != null) {
      shared.socket
        ..off('connect', _onConnect)
        ..off('disconnect', _onDisconnect)
        ..off('requests:changed', _onChanged);
      shared.release();
    }
    _shared = null;
    _changes.close();
    _reconnects.close();
  }
}
