import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import '../../talk/data/talk_api_service.dart';
import 'help_models.dart';

/// Help, from the server: the intake, the match, a counsellor's profile.
/// Booking goes through the Talk service it carries.
class HelpApiService {
  HelpApiService({required this.session, String? baseUrl, http.Client? client})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
      _client = client ?? http.Client(),
      talk = TalkApiService(session: session, baseUrl: baseUrl, client: client);

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;
  final TalkApiService talk;

  Map<String, String> get _headers => {
    'Authorization': 'Bearer ${session.token}',
    'Content-Type': 'application/json',
  };

  Future<Map<String, dynamic>> _request(String method, String path, {Map<String, dynamic>? body}) async {
    final uri = Uri.parse('$_baseUrl$path');
    final response = switch (method) {
      'POST' => await _client.post(uri, headers: _headers, body: jsonEncode(body ?? const {})),
      'PUT' => await _client.put(uri, headers: _headers, body: jsonEncode(body ?? const {})),
      _ => await _client.get(uri, headers: _headers),
    };
    final json = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw TalkApiException(json['message'] as String? ?? 'Something went wrong. Try again.', statusCode: response.statusCode);
    }
    return json;
  }

  Future<HelpHome> home() async => HelpHome.fromJson(await _request('GET', '/help/home'));

  Future<HelpIntake?> intake() async {
    final json = await _request('GET', '/help/intake');
    final raw = json['intake'];
    return raw is Map<String, dynamic> ? HelpIntake.fromJson(raw) : null;
  }

  Future<HelpMatchResult> saveIntake(HelpIntake intake) async =>
      HelpMatchResult.fromJson(await _request('PUT', '/help/intake', body: intake.toJson()));

  /// Accepts a counsellor although a preference goes unmet.
  Future<HelpMatch> acceptCounsellor(String counsellorId) async {
    final json = await _request('POST', '/help/match', body: {'counsellorUserId': counsellorId});
    return HelpMatch.fromJson(json['match'] as Map<String, dynamic>);
  }

  Future<CounsellorDetail> counsellor(String counsellorId) async =>
      CounsellorDetail.fromJson(await _request('GET', '/help/counsellors/$counsellorId'));
}
