import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import 'talk_models.dart';

/// What the server said when it refused: shown to the person as it came.
class TalkApiException implements Exception {
  const TalkApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class TalkApiService {
  TalkApiService({required this.session, String? baseUrl, http.Client? client})
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
      'POST' => await _client.post(
        uri,
        headers: _headers,
        body: jsonEncode(body ?? const {}),
      ),
      _ => await _client.get(uri, headers: _headers),
    };
    final json = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw TalkApiException(
        json['message'] as String? ?? 'Something went wrong. Try again.',
        statusCode: response.statusCode,
      );
    }
    return json;
  }

  Future<List<Counsellor>> counsellors() async {
    final json = await _request('GET', '/talk/counsellors');
    return [
      for (final row in (json['counsellors'] as List<dynamic>? ?? const []))
        Counsellor.fromJson(row as Map<String, dynamic>),
    ];
  }

  /// Who is free when on [date], given as YYYY-MM-DD.
  Future<List<TalkSlot>> availability(String date) async {
    final json = await _request('GET', '/talk/availability?date=$date');
    return [
      for (final row in (json['slots'] as List<dynamic>? ?? const []))
        TalkSlot.fromJson(row as Map<String, dynamic>),
    ];
  }

  Future<TalkSessions> sessions() async =>
      TalkSessions.fromJson(await _request('GET', '/talk/sessions'));

  Future<TalkSession> book({
    required String counsellorId,
    required DateTime startsAt,
  }) async {
    final json = await _request(
      'POST',
      '/talk/sessions',
      body: {
        'counsellorUserId': counsellorId,
        'startsAt': startsAt.toUtc().toIso8601String(),
      },
    );
    return TalkSession.fromJson(json['session'] as Map<String, dynamic>);
  }
}
