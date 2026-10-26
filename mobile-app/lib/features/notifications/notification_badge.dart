import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../../services/api_client.dart';
import '../../services/api_config.dart';
import '../auth/data/auth_models.dart';

/// Whether the bell carries its red dot: something in the inbox is unread.
/// Opening the inbox leaves it; reading what is there — one at a time or all
/// at once — takes it away, and a new push brings it back.
class NotificationBadge {
  NotificationBadge._();

  static final ValueNotifier<bool> hasNew = ValueNotifier(false);

  /// Asks the server how many are unread and lights the dot when any are.
  /// Quiet on failure: a missing dot is not worth an error.
  ///
  /// The count, not the inbox: reading a hundred notifications (about 1.5 s
  /// on the server) to light one dot was done at every launch and every
  /// return to the app. A server from before the count (404) is asked for
  /// the inbox as before.
  static Future<void> refresh(
    AuthSession session, {
    http.Client? client,
  }) async {
    final api = client ?? ApiClient.shared;
    final headers = {'Authorization': 'Bearer ${session.token}'};
    try {
      final counted = await api.get(
        Uri.parse('${ApiConfig.baseUrl}/notifications/unread-count'),
        headers: headers,
      );
      if (counted.statusCode >= 200 && counted.statusCode < 300) {
        final unread = (jsonDecode(counted.body) as Map<String, dynamic>)['unread'];
        if (unread is num) hasNew.value = unread > 0;
        return;
      }
      if (counted.statusCode != 404) return;
      final response = await api.get(
        Uri.parse('${ApiConfig.baseUrl}/notifications'),
        headers: headers,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) return;
      final items =
          (jsonDecode(response.body) as Map<String, dynamic>)['notifications']
              as List<dynamic>? ??
          const [];
      // Unread, and not already done with (the server's `resolved`), as the
      // inbox counts it.
      hasNew.value = items.whereType<Map<String, dynamic>>().any(
        (item) => item['readAt'] == null && item['resolved'] != true,
      );
    } catch (_) {
      // Offline or slow: leave the dot as it is.
    }
  }

  /// A push just arrived while the app is open.
  static void arrived() => hasNew.value = true;

  /// What the inbox itself now shows, straight after a read or a load, so the
  /// dot follows at once rather than after the server has caught up.
  static void showUnread(bool any) => hasNew.value = any;
}
