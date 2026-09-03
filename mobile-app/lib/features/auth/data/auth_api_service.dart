import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../services/api_config.dart';
import 'auth_models.dart';

class AuthApiException implements Exception {
  const AuthApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class AuthApiService {
  AuthApiService({String? baseUrl, http.Client? client})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
      _client = client ?? http.Client();

  final String _baseUrl;
  final http.Client _client;

  Future<void> requestOtp(String email) async {
    await _post('/auth/request-otp', {'email': email});
  }

  Future<AuthSession> verifyOtp(String email, String otp) async {
    final json = await _post('/auth/verify-otp', {'email': email, 'otp': otp});
    return AuthSession.fromJson(json);
  }

  Future<AuthTeammates> fetchTeammates(String token) async {
    final uri = Uri.parse('$_baseUrl/auth/teammates');
    final response = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final raw = utf8.decode(response.bodyBytes);
    final data = raw.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(raw) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AuthApiException(
        data['message'] as String? ?? 'Could not load teammates',
        statusCode: response.statusCode,
      );
    }
    final list = (data['teammates'] as List<dynamic>? ?? const [])
        .map((item) => AuthTeammate.fromJson(item as Map<String, dynamic>))
        .toList();
    return AuthTeammates(
      teammates: list,
      total: (data['total'] as num?)?.toInt() ?? list.length,
    );
  }

  Future<AuthUser> fetchCurrentUser(String token) async {
    final uri = Uri.parse('$_baseUrl/auth/me');
    final response = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final raw = utf8.decode(response.bodyBytes);
    final data = raw.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(raw) as Map<String, dynamic>;

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AuthApiException(
        data['message'] as String? ?? 'Could not refresh profile',
        statusCode: response.statusCode,
      );
    }

    return AuthUser.fromJson(
      data['user'] as Map<String, dynamic>? ?? <String, dynamic>{},
    );
  }

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, dynamic> body,
  ) async {
    final uri = Uri.parse('$_baseUrl$path');
    final response = await _client.post(
      uri,
      headers: const {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );
    final raw = utf8.decode(response.bodyBytes);
    final data = raw.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(raw) as Map<String, dynamic>;

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AuthApiException(
        data['message'] as String? ?? 'Authentication failed',
        statusCode: response.statusCode,
      );
    }

    return data;
  }
}

/// One colleague shown on the welcome screen (node 1849:17741).
class AuthTeammate {
  const AuthTeammate({
    required this.userId,
    required this.name,
    required this.designation,
    required this.department,
    this.photoUrl,
  });

  final String userId;
  final String name;
  final String designation;
  final String department;
  final String? photoUrl;

  /// "UX Researcher · Product", collapsing to whichever half exists.
  String get roleLine => [
    designation,
    department,
  ].where((part) => part.isNotEmpty).join(' · ');

  String get initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  factory AuthTeammate.fromJson(Map<String, dynamic> json) => AuthTeammate(
    userId: json['userId'] as String? ?? '',
    name: json['name'] as String? ?? 'Teammate',
    designation: json['designation'] as String? ?? '',
    department: json['department'] as String? ?? '',
    photoUrl: json['photoUrl'] as String?,
  );
}

class AuthTeammates {
  const AuthTeammates({required this.teammates, required this.total});
  final List<AuthTeammate> teammates;
  final int total;
}

