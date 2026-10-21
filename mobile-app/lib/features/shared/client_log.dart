import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../services/api_config.dart';

/// Errors the app hit on the phone, sent to the server so they leave a trace.
///
/// A post that fails before it reaches the server is otherwise invisible: the
/// person sees a toast and nothing is logged anywhere. Events are kept on the
/// phone until the server has them, so one that happened offline still
/// arrives once the connection is back.
class ClientLog {
  ClientLog._();

  static const _storeKey = 'client_log.pending';
  static const _maxPending = 50;
  static String? _token;
  static String? _appVersion;
  static bool _sending = false;
  static final Set<String> _reported = <String>{};

  /// Who the events are filed under; set at sign-in, cleared at sign-out.
  static void useToken(String? token) {
    _token = token;
    if (token != null) unawaited(flush());
  }

  /// Files [event] (e.g. `post_failed`) with what went wrong.
  static Future<void> report(
    String event,
    Object error, {
    Map<String, Object?> context = const {},
  }) async {
    try {
      _appVersion ??= await PackageInfo.fromPlatform()
          .then((info) => '${info.version}+${info.buildNumber}')
          .catchError((_) => 'unknown');
      final entry = {
        'event': event,
        'message': '${error.runtimeType}: $error',
        'context': {
          for (final e in context.entries)
            if (e.value != null) e.key: '${e.value}',
        },
        'at': DateTime.now().toUtc().toIso8601String(),
        'appVersion': _appVersion,
        'platform': Platform.operatingSystem,
      };
      final prefs = await SharedPreferences.getInstance();
      final pending = prefs.getStringList(_storeKey) ?? <String>[];
      pending.add(jsonEncode(entry));
      await prefs.setStringList(
        _storeKey,
        pending.length > _maxPending
            ? pending.sublist(pending.length - _maxPending)
            : pending,
      );
    } catch (_) {
      // Logging must never be the thing that breaks the app.
      return;
    }
    unawaited(flush());
  }

  /// [report] for errors that can repeat many times a second (a widget that
  /// fails on every frame): each distinct one is filed once per app run.
  static void reportOnce(String event, Object error, {StackTrace? stack}) {
    final key = '$event|${error.runtimeType}|$error';
    if (_reported.length > 200 || !_reported.add(key)) return;
    final top = stack?.toString().split('\n').take(6).join(' | ');
    unawaited(report(event, error, context: {'stack': top}));
  }

  /// Sends whatever is waiting. Quietly keeps it for next time on failure.
  static Future<void> flush() async {
    final token = _token;
    if (token == null || _sending) return;
    _sending = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      final pending = prefs.getStringList(_storeKey) ?? const <String>[];
      if (pending.isEmpty) return;
      final batch = pending.take(20).toList();
      final response = await http
          .post(
            Uri.parse('${ApiConfig.baseUrl}/client-logs'),
            headers: {
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({'events': batch.map(jsonDecode).toList()}),
          )
          .timeout(const Duration(seconds: 15));
      if (response.statusCode >= 200 && response.statusCode < 300) {
        final now = prefs.getStringList(_storeKey) ?? const <String>[];
        await prefs.setStringList(_storeKey, now.skip(batch.length).toList());
      }
    } catch (_) {
      // Still offline, or the server is busy; the events wait on the phone.
    } finally {
      _sending = false;
    }
  }
}
