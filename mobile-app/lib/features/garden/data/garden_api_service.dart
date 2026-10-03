import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import 'garden_models.dart';

/// What the server said when it refused, shown to the person as it came.
class GardenApiException implements Exception {
  const GardenApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class GardenApiService {
  GardenApiService({required this.session, String? baseUrl, http.Client? client})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
      _client = client ?? http.Client();

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;

  Map<String, String> get _headers => {
    'Authorization': 'Bearer ${session.token}',
    'Content-Type': 'application/json',
  };

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final uri = Uri.parse('$_baseUrl$path');
    final response = switch (method) {
      'POST' => await _client.post(uri, headers: _headers, body: jsonEncode(body ?? const {})),
      'DELETE' => await _client.delete(uri, headers: _headers),
      _ => await _client.get(uri, headers: _headers),
    };
    final json = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw GardenApiException(
        json['message'] as String? ?? 'Something went wrong. Try again.',
        statusCode: response.statusCode,
      );
    }
    return json;
  }

  Future<GardenView> garden() async => GardenView.fromJson(await _request('GET', '/garden/'));

  Future<TreeView> tree(String userId) async =>
      TreeView.fromJson(await _request('GET', '/garden/trees/$userId'));

  Future<List<GardenNote>> timeline() async {
    final json = await _request('GET', '/garden/timeline');
    return [
      for (final row in (json['notes'] as List<dynamic>? ?? const []))
        GardenNote.fromJson(row as Map<String, dynamic>),
    ];
  }

  Future<GardenGift> give({required String toUserId, required String kind, required String note}) async {
    final json = await _request('POST', '/garden/notes', body: {'toUserId': toUserId, 'kind': kind, 'note': note});
    return GardenGift.fromJson(json);
  }

  Future<void> remove(String noteId) async {
    await _request('DELETE', '/garden/notes/$noteId');
  }
}
