import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../../shared/client_log.dart';
import 'auth_models.dart';

class AuthSessionStore {
  static const _sessionKey = 'auth_session';

  Future<void> save(AuthSession session) async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(_sessionKey, jsonEncode(session.toJson()));
    ClientLog.useToken(session.token);
  }

  Future<AuthSession?> read() async {
    final preferences = await SharedPreferences.getInstance();
    final raw = preferences.getString(_sessionKey);
    if (raw == null || raw.isEmpty) return null;

    try {
      final json = jsonDecode(raw);
      if (json is! Map<String, dynamic>) return null;
      final session = AuthSession.fromJson(json);
      if (session.token.isEmpty) return null;
      // Errors from an earlier run that never made it out go now.
      ClientLog.useToken(session.token);
      return session;
    } on FormatException {
      await clear();
      return null;
    }
  }

  Future<void> clear() async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.remove(_sessionKey);
    ClientLog.useToken(null);
  }
}
