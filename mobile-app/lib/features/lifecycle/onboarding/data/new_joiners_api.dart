import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../../services/api_client.dart';
import '../../../../services/api_config.dart';
import '../../../auth/data/auth_models.dart';
import 'onboarding_api.dart';

/// Teams › New joiners for every teammate: the people who have joined the
/// viewer's own team, in their first month, profile only (server
/// services/lifecycle/teamNewJoiners.ts, `GET /lifecycle/team/new-joiners`).
/// Who counts as a teammate, the window and every line on a card are the
/// server's.

String? _str(Object? v) => v is String && v.isNotEmpty ? v : null;

/// One card on New joiners.
class NewJoinerCard {
  const NewJoinerCard({
    required this.journeyId,
    required this.name,
    required this.joiningLine,
    this.userId,
    this.photoUrl,
    this.designation,
    this.department,
    this.profileNote,
  });

  factory NewJoinerCard.fromJson(Map<String, dynamic> json) => NewJoinerCard(
    journeyId: '${json['journeyId'] ?? ''}',
    userId: _str(json['userId']),
    name: _str(json['name']) ?? '—',
    photoUrl: _str(json['photoUrl']),
    designation: _str(json['designation']),
    department: _str(json['department']),
    joiningLine: _str(json['joiningLine']) ?? '',
    profileNote: _str(json['profileNote']),
  );

  final String journeyId;

  /// Their account, which opens the profile; null before they have one.
  final String? userId;
  final String name;
  final String? photoUrl;
  final String? designation;
  final String? department;

  /// "Joins tomorrow", "Joined Mon 30 Nov".
  final String joiningLine;

  /// "Profile opens on their first day" while there is no account to open.
  final String? profileNote;

  /// "Designer · Design", the parts there are.
  String? get roleLine {
    final parts = [?designation, ?department];
    return parts.isEmpty ? null : parts.join(' · ');
  }
}

abstract class NewJoinersApi {
  Future<List<NewJoinerCard>> fetchNewJoiners();
}

class HttpNewJoinersApi implements NewJoinersApi {
  HttpNewJoinersApi({required this.session, String? baseUrl, http.Client? client})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
      _client = client ?? ApiClient.shared;

  /// The signed-in shell's API, when it talks to the server.
  static NewJoinersApi? from(OnboardingApi api) => api is HttpOnboardingApi ? HttpNewJoinersApi(session: api.session) : null;

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;

  @override
  Future<List<NewJoinerCard>> fetchNewJoiners() async {
    final request = http.Request('GET', Uri.parse('$_baseUrl/lifecycle/team/new-joiners'))
      ..headers.addAll({'Authorization': 'Bearer ${session.token}'});
    final http.Response response;
    try {
      response = await _client.send(request).then(http.Response.fromStream).timeout(HttpOnboardingApi.requestTimeout);
    } on TimeoutException {
      throw const OnboardingApiException(OnboardingApiException.tooSlow);
    } catch (_) {
      throw const OnboardingApiException(OnboardingApiException.offline);
    }
    Map<String, dynamic> json = const {};
    try {
      final decoded = response.body.isEmpty ? null : jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map<String, dynamic>) json = decoded;
    } catch (_) {}
    if (response.statusCode >= 400) {
      throw OnboardingApiException(_str(json['error']) ?? OnboardingApiException.failed, statusCode: response.statusCode);
    }
    return ((json['joiners'] as List?) ?? const [])
        .whereType<Map>()
        .map((m) => NewJoinerCard.fromJson(m.cast<String, dynamic>()))
        .toList();
  }
}
