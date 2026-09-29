import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import 'care_models.dart';

/// What the server said when it refused, shown to the person as it came.
class CareApiException implements Exception {
  const CareApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class CareApiService {
  CareApiService({required this.session, String? baseUrl, http.Client? client})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
      _client = client ?? http.Client();

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;

  Map<String, String> get _headers => {
    'Authorization': 'Bearer ${session.token}',
    'Content-Type': 'application/json',
  };

  Future<Map<String, dynamic>> _request(String method, String path, {Map<String, dynamic>? body}) async {
    final uri = Uri.parse('$_baseUrl$path');
    final response = switch (method) {
      'POST' => await _client.post(uri, headers: _headers, body: jsonEncode(body ?? const {})),
      'PUT' => await _client.put(uri, headers: _headers, body: jsonEncode(body ?? const {})),
      'DELETE' => await _client.delete(uri, headers: _headers),
      _ => await _client.get(uri, headers: _headers),
    };
    final json = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CareApiException(json['message'] as String? ?? 'Something went wrong. Try again.', statusCode: response.statusCode);
    }
    return json;
  }

  /// Read once per tab life; the media list changes only when Sowaka swaps a file.
  Future<CareCatalog> catalog() async {
    final json = await _request('GET', '/care/catalog');
    return CareCatalog.fromJson(json['catalog'] as Map<String, dynamic>? ?? const {});
  }

  Future<JournalView> journal() async => JournalView.fromJson(await _request('GET', '/care/journal'));

  Future<JournalEntry> addEntry({required String text, String? prompt, String context = 'general'}) async {
    final json = await _request('POST', '/care/journal', body: {'text': text, 'prompt': ?prompt, 'context': context});
    return JournalEntry.fromJson(json['entry'] as Map<String, dynamic>);
  }

  Future<JournalEntry> updateEntry(String id, String text) async {
    final json = await _request('PUT', '/care/journal/$id', body: {'text': text});
    return JournalEntry.fromJson(json['entry'] as Map<String, dynamic>);
  }

  Future<void> deleteEntry(String id) async {
    await _request('DELETE', '/care/journal/$id');
  }
}
