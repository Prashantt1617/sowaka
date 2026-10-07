import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

/// The last dashboard this person saw, kept on the device so the next launch
/// opens on it at once and refreshes behind it — the way the feed apps open
/// on yesterday's content rather than a spinner.
///
/// What is kept is the raw answer of every request the dashboard is built
/// from, keyed by path, so the same parsing runs on it as on a live reply.
/// Per person, so a shared phone never shows one account's day to another.
class DashboardCache {
  const DashboardCache._();

  static Future<File?> _file(String userId) async {
    // Under the test runner the file-location plugin never answers, and a
    // feed waiting on it would wait forever.
    if (Platform.environment['FLUTTER_TEST'] == 'true') return null;
    try {
      final dir = await getApplicationSupportDirectory().timeout(const Duration(seconds: 3));
      return File('${dir.path}/dashboard-${userId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_')}.json');
    } catch (_) {
      // No file system to speak of (a test, a sandbox): no cache, no harm.
      return null;
    }
  }

  static Future<Map<String, Map<String, dynamic>>?> read(String userId) async {
    try {
      final file = await _file(userId);
      if (file == null || !await file.exists()) return null;
      final decoded = jsonDecode(await file.readAsString());
      if (decoded is! Map<String, dynamic>) return null;
      return {
        for (final entry in decoded.entries)
          if (entry.value is Map<String, dynamic>) entry.key: entry.value as Map<String, dynamic>,
      };
    } catch (error) {
      debugPrint('Dashboard cache unreadable: $error');
      return null;
    }
  }

  static Future<void> write(
    String userId,
    Map<String, Map<String, dynamic>> replies, {
    DateTime? startedAt,
  }) async {
    if (startedAt != null && !writeAllowed(startedAt)) return;
    try {
      final file = await _file(userId);
      if (file == null) return;
      // Written beside, then moved in: a launch mid-write reads a whole file
      // or none, never half of one.
      final draft = File('${file.path}.tmp');
      await draft.writeAsString(jsonEncode(replies), flush: true);
      await draft.rename(file.path);
    } catch (error) {
      debugPrint('Dashboard cache not written: $error');
    }
  }

  /// When the device's copies were last cleared. A write that began before
  /// then is dropped, so a load still in flight at sign-out cannot put a copy
  /// back after it was wiped.
  static DateTime _clearedAt = DateTime.fromMillisecondsSinceEpoch(0);

  static bool writeAllowed(DateTime startedAt) => startedAt.isAfter(_clearedAt);

  static Future<void> clear(String userId) async {
    try {
      final file = await _file(userId);
      if (file != null && await file.exists()) await file.delete();
    } catch (_) {}
  }

  /// Every copy on this device — the dashboard and the feed, for anyone who
  /// signed in here. For sign-out: nothing of theirs stays behind.
  static Future<void> clearAll() async {
    _clearedAt = DateTime.now();
    try {
      if (Platform.environment['FLUTTER_TEST'] == 'true') return;
      final dir = await getApplicationSupportDirectory().timeout(const Duration(seconds: 3));
      await for (final entry in dir.list()) {
        final name = entry.uri.pathSegments.last;
        if (entry is File && name.startsWith('dashboard-') && name.endsWith('.json')) {
          await entry.delete();
        }
      }
    } catch (error) {
      debugPrint('Device copies not cleared: $error');
    }
  }
}
