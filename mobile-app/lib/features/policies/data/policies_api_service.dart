import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../services/api_client.dart';
import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import '../../manager/data/dashboard_cache.dart';
import 'policies_models.dart';

/// What the server said when it refused, shown to no one: a failed read
/// leaves whatever the page already had.
class PoliciesApiException implements Exception {
  const PoliciesApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

/// The company's policies as this app last fetched them, and whose they
/// were, so the page draws at once on its next opening and refreshes behind.
/// Whose matters: the app outlives a sign-out.
List<PolicyDocument>? _lastPolicies;
String? _lastPoliciesFor;

/// The policies last fetched for [userId], when that is who is asking.
List<PolicyDocument>? companyPoliciesFor(String userId) =>
    _lastPoliciesFor == userId ? _lastPolicies : null;

/// The server's counts with the policies last fetched for [userId]
/// (`toAcknowledge` is Actions' "N to acknowledge"); null until fetched.
PolicyAckCounts? policyCountsFor(String userId) =>
    _lastPoliciesFor == userId ? _lastCounts : null;
PolicyAckCounts? _lastCounts;

/// Forgets what is held in memory. Called when the person signs out; the
/// device copy goes with the dashboard's.
void forgetPolicies() {
  _lastPolicies = null;
  _lastCounts = null;
  _lastPoliciesFor = null;
}

/// Actions › View Policies: `GET /policies`.
class PoliciesApiService {
  PoliciesApiService({
    required this.session,
    String? baseUrl,
    http.Client? client,
  }) : baseUrl = baseUrl ?? ApiConfig.baseUrl,
       _client = client ?? ApiClient.shared;

  final AuthSession session;
  final String baseUrl;
  final http.Client _client;

  String get _cacheKey => 'policies-${session.user.id}';

  /// The company's own policies, in order. Kept in memory and on the device.
  ///
  /// Empty when the company has none of its own, and from a server older
  /// than policies (which answers 404): either way the app writes them for
  /// itself, as it always has.
  Future<List<PolicyDocument>> policies() async {
    final startedAt = DateTime.now();
    final response = await _client.get(
      Uri.parse('$baseUrl/policies'),
      headers: {'Authorization': 'Bearer ${session.token}'},
    );
    Map<String, dynamic> json;
    if (response.statusCode == 404) {
      json = {'policies': const <dynamic>[]};
    } else {
      try {
        final decoded = response.body.isEmpty
            ? null
            : jsonDecode(utf8.decode(response.bodyBytes, allowMalformed: true));
        json = decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
      } catch (_) {
        json = <String, dynamic>{};
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw PoliciesApiException(
          json['message'] as String? ?? 'Policies could not be loaded.',
          statusCode: response.statusCode,
        );
      }
      if (json['policies'] is! List) {
        throw const PoliciesApiException('Policies could not be loaded.');
      }
    }
    final policies = parsePolicyDocuments(json);
    _lastPolicies = policies;
    _lastCounts = PolicyAckCounts.fromJson(json, policies);
    _lastPoliciesFor = session.user.id;
    unawaited(
      DashboardCache.write(_cacheKey, {
        'policies': {'policies': json['policies']},
      }, startedAt: startedAt),
    );
    return policies;
  }

  /// Acknowledges [key] at [version], the version read: the whole list back,
  /// with its new state. A 409 means the text changed meanwhile; the message
  /// says so and the caller reloads.
  Future<List<PolicyDocument>> acknowledge(String key, int version) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/policies/${Uri.encodeComponent(key)}/acknowledge'),
      headers: {
        'Authorization': 'Bearer ${session.token}',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'version': version}),
    );
    Map<String, dynamic> json;
    try {
      final decoded = response.body.isEmpty
          ? null
          : jsonDecode(utf8.decode(response.bodyBytes, allowMalformed: true));
      json = decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
    } catch (_) {
      json = <String, dynamic>{};
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw PoliciesApiException(
        (json['error'] ?? json['message']) as String? ??
            'That did not go through. Try again.',
        statusCode: response.statusCode,
      );
    }
    final policies = parsePolicyDocuments(json);
    _lastPolicies = policies;
    _lastCounts = PolicyAckCounts.fromJson(json, policies);
    _lastPoliciesFor = session.user.id;
    return policies;
  }

  /// The server's counts (`GET /policies`): `toAcknowledge` is the number on
  /// Actions' Policies tile.
  Future<PolicyAckCounts> ackCounts() async {
    final policies = await this.policies();
    return policyCountsFor(session.user.id) ?? PolicyAckCounts.fromJson(const {}, policies);
  }

  /// The policies as this person last saw them, without the network. Null
  /// when there is no copy.
  Future<List<PolicyDocument>?> policiesFromCache() async {
    final held = companyPoliciesFor(session.user.id);
    if (held != null) return held;
    final kept = await DashboardCache.read(_cacheKey);
    final json = kept?['policies'];
    if (json == null) return null;
    try {
      return parsePolicyDocuments(json);
    } catch (_) {
      return null;
    }
  }
}
