import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../../services/api_config.dart';
import '../auth/data/auth_models.dart';

/// Whether the bell carries its red dot: something in the inbox is unread.
/// Opening the inbox leaves it; reading what is there — one at a time or all
/// at once — takes it away, and a new push brings it back.
class NotificationBadge {
  NotificationBadge._();

  static final ValueNotifier<bool> hasNew = ValueNotifier(false);

  /// Reads the inbox and lights the dot when anything in it is unread. Quiet
  /// on failure: a missing dot is not worth an error.
  static Future<void> refresh(AuthSession session, {http.Client? client}) async {
    try {
      final response = await (client ?? http.Client()).get(
        Uri.parse('${ApiConfig.baseUrl}/notifications'),
        headers: {'Authorization': 'Bearer ${session.token}'},
      );
      if (response.statusCode < 200 || response.statusCode >= 300) return;
      final items =
          (jsonDecode(response.body) as Map<String, dynamic>)['notifications']
              as List<dynamic>? ??
          const [];
      hasNew.value = items
          .whereType<Map<String, dynamic>>()
          .any((item) => item['readAt'] == null);
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
