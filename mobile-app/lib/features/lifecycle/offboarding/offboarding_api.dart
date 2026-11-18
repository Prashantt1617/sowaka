import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../../../services/api_client.dart';
import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import '../../manager/data/dashboard_cache.dart';
import '../../shared/network_status.dart';
import 'offboarding_models.dart';

class OffboardingApiException implements Exception {
  const OffboardingApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  /// The lifecycle is off for this company (the server answers 404
  /// `Not available`), or this person has nothing here.
  bool get notAvailable => statusCode == 404 || statusCode == 403;

  @override
  String toString() => message;
}

/// The app's offboarding endpoints (docs/lifecycle/CONTRACT.md,
/// "Offboarding"): the leaver's resignation, off-boarding page, handover and
/// exit interview, and the manager's resignations and leavers.
///
/// Every screen builds it from the session ([OffboardingApi.forSession]);
/// tests put their own in [testOverride].
class OffboardingApi {
  OffboardingApi({required this.session, String? baseUrl, http.Client? client})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
      _client = client ?? ApiClient.shared;

  /// Answers every offboarding call, in tests.
  @visibleForTesting
  static OffboardingApi Function(AuthSession session)? testOverride;

  static OffboardingApi forSession(AuthSession session) =>
      testOverride?.call(session) ?? OffboardingApi(session: session);

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;

  // ── The device's copy (DashboardCache, as the onboarding and dashboard do) ──
  //
  // Every GET that answers is kept by path, per person; [fromDevice] replays
  // a read against those replies through the same parsing.

  static final Map<String, Map<String, Map<String, dynamic>>> _keptByUser = {};
  static final Map<String, Future<void>> _loadingKept = {};
  static final Set<String> _pendingWrite = {};
  static const _replayKey = #offboardingReplay;

  String get _cacheKey => 'lifecycle-off-${session.user.id}';

  /// [read] answered from the device's last replies, never the network; null
  /// when a reply it needs was never kept.
  Future<T?> fromDevice<T>(Future<T> Function(OffboardingApi api) read) async {
    final user = session.user.id;
    if (user.isEmpty) return null;
    if (!_keptByUser.containsKey(user)) {
      await (_loadingKept[user] ??= DashboardCache.read(_cacheKey).then((replies) {
        _keptByUser.putIfAbsent(user, () => replies ?? {});
      }));
    }
    try {
      return await runZoned(() => read(this), zoneValues: {_replayKey: true});
    } catch (_) {
      return null;
    }
  }

  void _keep(String path, Map<String, dynamic>? json, DateTime startedAt) {
    final user = session.user.id;
    if (user.isEmpty || !DashboardCache.writeAllowed(startedAt)) return;
    final kept = _keptByUser[user] ??= {};
    if (json == null) {
      if (kept.remove(path) == null) return;
    } else {
      kept[path] = json;
    }
    // One write for the replies that land together (no timer left behind).
    if (_pendingWrite.add(user)) {
      final key = _cacheKey;
      scheduleMicrotask(() {
        _pendingWrite.remove(user);
        unawaited(DashboardCache.write(key, Map.of(kept), startedAt: startedAt));
      });
    }
  }

  /// Signed out: the copies in memory go (the files go with DashboardCache.clearAll).
  static void forgetKept() {
    _pendingWrite.clear();
    _keptByUser.clear();
    _loadingKept.clear();
  }

  // ── The person leaving ────────────────────────────────────────────────

  Future<LifecycleMe> fetchMe() async =>
      LifecycleMe.fromJson(await _send('GET', '/lifecycle/me'));

  Future<ResignationState> fetchResignation() async =>
      ResignationState.fromJson(await _send('GET', '/lifecycle/resignation'));

  Future<ResignationView> resign({required String reason, String? note}) async {
    final json = await _send('POST', '/lifecycle/resignation', {
      'reason': reason,
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    });
    return ResignationView.fromJson(_object(json['resignation']));
  }

  Future<void> withdraw() async {
    await _send('POST', '/lifecycle/resignation/withdraw', const {});
  }

  Future<OffboardingPageData> fetchOffboarding() async =>
      OffboardingPageData.fromJson(
        await _send('GET', '/lifecycle/offboarding'),
      );

  Future<HandoverItem> uploadHandoverFile(
    String itemId, {
    required String fileName,
    required Uint8List bytes,
  }) async {
    final request =
        http.MultipartRequest(
            'POST',
            Uri.parse(
              '$_baseUrl/lifecycle/offboarding/handover/${Uri.encodeComponent(itemId)}',
            ),
          )
          ..headers['Authorization'] = 'Bearer ${session.token}'
          ..files.add(
            http.MultipartFile.fromBytes('file', bytes, filename: fileName),
          );
    final json = await _read(
      () async => http.Response.fromStream(await _client.send(request)),
    );
    return HandoverItem.fromJson(_object(json['item']));
  }

  Future<HandoverItem> linkHandover(String itemId, String url) async {
    final json = await _send(
      'POST',
      '/lifecycle/offboarding/handover/${Uri.encodeComponent(itemId)}',
      {'url': url},
    );
    return HandoverItem.fromJson(_object(json['item']));
  }

  Future<void> removeHandoverUpload(String itemId) async {
    await _send(
      'DELETE',
      '/lifecycle/offboarding/handover/${Uri.encodeComponent(itemId)}',
    );
  }

  Future<void> sendExitInterview(ExitInterviewAnswers answers) async {
    await _send('POST', '/lifecycle/offboarding/interview', answers.toJson());
  }

  // ── The manager ───────────────────────────────────────────────────────

  Future<List<ResignationView>> fetchManagerResignations() async {
    final json = await _send('GET', '/lifecycle/manager/resignations');
    final rows = json['resignations'];
    return [
      if (rows is List)
        for (final row in rows)
          if (row is Map) ResignationView.fromJson(row.cast<String, dynamic>()),
    ];
  }

  /// accept | change_day | release_early; [date] for the last two.
  Future<ResignationView?> actOnResignation(
    String resignationId, {
    required String action,
    String? date,
    String? note,
  }) async {
    final json = await _send(
      'POST',
      '/lifecycle/manager/resignations/${Uri.encodeComponent(resignationId)}',
      {
        'action': action,
        'date': ?date,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      },
    );
    final resignation = json['resignation'];
    return resignation is Map
        ? ResignationView.fromJson(resignation.cast<String, dynamic>())
        : null;
  }

  /// The manager's reports with an exit under way, HR-started ones too.
  Future<List<LeaverSummary>> fetchManagerLeavers() async {
    final json = await _send('GET', '/lifecycle/manager/leavers');
    final rows = json['leavers'];
    return [
      if (rows is List)
        for (final row in rows)
          if (row is Map) LeaverSummary.fromJson(row.cast<String, dynamic>()),
    ];
  }

  /// A handover upload, for the leaver (their own) or their manager:
  /// `GET /lifecycle/offboarding/handover/:id/file` with the session. A stored
  /// file comes back as a short-lived link; a development server sends the
  /// bytes.
  Future<HandoverFile> fetchHandoverFile(String itemId) async {
    final uri = Uri.parse(
      '$_baseUrl/lifecycle/offboarding/handover/${Uri.encodeComponent(itemId)}/file',
    );
    final http.Response response;
    try {
      response = await _client.get(
        uri,
        headers: {'Authorization': 'Bearer ${session.token}'},
      );
    } catch (error) {
      NetworkStatus.reportFailure(error, probe: Uri.parse('$_baseUrl/health'));
      if (NetworkStatus.isNetworkError(error)) {
        throw const OffboardingApiException('No internet connection');
      }
      rethrow;
    }
    NetworkStatus.reportSuccess();
    final type = (response.headers['content-type'] ?? '')
        .split(';')
        .first
        .trim();
    if (type == 'application/json' ||
        response.statusCode < 200 ||
        response.statusCode >= 300) {
      Map<String, dynamic> json = const {};
      try {
        final decoded = jsonDecode(utf8.decode(response.bodyBytes));
        if (decoded is Map) json = decoded.cast<String, dynamic>();
      } on FormatException {
        // Not JSON: the refusal below says so.
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw OffboardingApiException(
          json['error'] as String? ??
              json['message'] as String? ??
              'Could not open the file. Try again.',
          statusCode: response.statusCode,
        );
      }
      final url = json['url'];
      if (url is String && url.isNotEmpty) return HandoverFile(url: url);
      throw const OffboardingApiException(
        'Could not open the file. Try again.',
      );
    }
    final disposition = response.headers['content-disposition'] ?? '';
    return HandoverFile(
      bytes: response.bodyBytes,
      contentType: type,
      name: RegExp(r'filename="([^"]+)"').firstMatch(disposition)?.group(1),
    );
  }

  Future<LeaverView> fetchLeaver(String userId) async => LeaverView.fromJson(
    await _send(
      'GET',
      '/lifecycle/manager/leavers/${Uri.encodeComponent(userId)}',
    ),
  );

  /// The whole checklist as it should stand: every item's title, in order,
  /// and the note.
  Future<void> saveHandover(
    String userId, {
    required List<String> items,
    String? note,
  }) async {
    await _send(
      'PUT',
      '/lifecycle/manager/leavers/${Uri.encodeComponent(userId)}/handover',
      {'items': items, 'note': note?.trim() ?? ''},
    );
  }

  Future<void> markHandoverDone(String userId) async {
    await _send(
      'POST',
      '/lifecycle/manager/leavers/${Uri.encodeComponent(userId)}/handover/done',
      const {},
    );
  }

  // ── Plumbing ──────────────────────────────────────────────────────────

  Map<String, dynamic> _object(Object? value) =>
      value is Map ? value.cast<String, dynamic>() : const <String, dynamic>{};

  Future<Map<String, dynamic>> _send(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    if (Zone.current[_replayKey] == true) {
      final byPath = _keptByUser[session.user.id];
      final kept = method == 'GET' && byPath != null ? byPath[path] : null;
      if (kept == null) throw const OffboardingApiException('Not kept on this device');
      return Map<String, dynamic>.from(kept);
    }
    final startedAt = DateTime.now();
    try {
      final json = await _sendLive(method, path, body);
      if (method == 'GET') _keep(path, json, startedAt);
      return json;
    } on OffboardingApiException catch (error) {
      if (method == 'GET' && error.statusCode == 404) _keep(path, null, startedAt);
      rethrow;
    }
  }

  Future<Map<String, dynamic>> _sendLive(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) {
    final uri = Uri.parse('$_baseUrl$path');
    final headers = {
      'Authorization': 'Bearer ${session.token}',
      if (body != null) 'Content-Type': 'application/json',
    };
    return _read(
      () => switch (method) {
        'GET' => _client.get(uri, headers: headers),
        'POST' => _client.post(
          uri,
          headers: headers,
          body: jsonEncode(body ?? const {}),
        ),
        'PUT' => _client.put(
          uri,
          headers: headers,
          body: jsonEncode(body ?? const {}),
        ),
        'DELETE' => _client.delete(uri, headers: headers),
        _ => throw ArgumentError(method),
      },
    );
  }

  Future<Map<String, dynamic>> _read(
    Future<http.Response> Function() call,
  ) async {
    final http.Response response;
    try {
      response = await call();
    } catch (error) {
      NetworkStatus.reportFailure(error, probe: Uri.parse('$_baseUrl/health'));
      if (NetworkStatus.isNetworkError(error)) {
        throw const OffboardingApiException('No internet connection');
      }
      rethrow;
    }
    NetworkStatus.reportSuccess();
    Map<String, dynamic> json;
    try {
      final decoded = response.body.isEmpty
          ? null
          : jsonDecode(utf8.decode(response.bodyBytes));
      json = decoded is Map
          ? decoded.cast<String, dynamic>()
          : <String, dynamic>{};
    } on FormatException {
      json = <String, dynamic>{};
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw OffboardingApiException(
        json['error'] as String? ??
            json['message'] as String? ??
            'Something went wrong. Try again.',
        statusCode: response.statusCode,
      );
    }
    return json;
  }
}
