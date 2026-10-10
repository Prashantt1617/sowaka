import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../../services/api_config.dart';
import '../auth/data/auth_models.dart';

/// Whether the bell carries its red dot: something unread has arrived since
/// the person last opened the notifications. Opening them clears it; a new
/// push, or an unread one found on launch or return to the app, brings it
/// back. Unread items stay unread in the inbox itself — the dot only says
/// there is something new to look at.
class NotificationBadge {
  NotificationBadge._();

  static final ValueNotifier<bool> hasNew = ValueNotifier(false);

  static String _key(String userId) => 'notifications-seen-$userId';

  /// Reads the inbox and lights the dot when an unread notification is newer
  /// than the last look. Quiet on failure: a missing dot is not worth an error.
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
      final preferences = await SharedPreferences.getInstance();
      final seen = DateTime.tryParse(
        preferences.getString(_key(session.user.id)) ?? '',
      );
      hasNew.value = items.whereType<Map<String, dynamic>>().any((item) {
        if (item['readAt'] != null) return false;
        final at = DateTime.tryParse('${item['createdAt'] ?? ''}');
        return at != null && (seen == null || at.isAfter(seen));
      });
    } catch (_) {
      // Offline or slow: leave the dot as it is.
    }
  }

  /// A push just arrived while the app is open.
  static void arrived() => hasNew.value = true;

  /// The inbox was opened: nothing is new any more.
  static Future<void> markSeen(String userId) async {
    hasNew.value = false;
    try {
      final preferences = await SharedPreferences.getInstance();
      await preferences.setString(
        _key(userId),
        DateTime.now().toUtc().toIso8601String(),
      );
    } catch (_) {}
  }
}
