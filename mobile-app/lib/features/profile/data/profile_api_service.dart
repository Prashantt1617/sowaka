import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import '../../manager/data/manager_models.dart';
import '../../shared/network_status.dart';
import 'leaderboard_models.dart';

class ProfileApiException implements Exception {
  const ProfileApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

/// What a profile reads beyond the workspace: the leaderboard, one's own
/// credit history, and a colleague's public profile.
class ProfileApiService {
  ProfileApiService({
    required this.session,
    String? baseUrl,
    http.Client? client,
  }) : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
       _client = client ?? testClient ?? http.Client();

  /// Answers every request a profile page makes, in tests. The pages build
  /// their own service from the session, so this is where a test reaches it.
  @visibleForTesting
  static http.Client? testClient;

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;

  /// The company by points. [userId] also asks where that person stands, for
  /// the Rank tab on their profile.
  Future<Leaderboard> fetchLeaderboard({String? userId}) async {
    final query = userId == null || userId.isEmpty
        ? ''
        : '?userId=${Uri.encodeQueryComponent(userId)}';
    return Leaderboard.fromJson(await _get('/profile/leaderboard$query'));
  }

  /// The signed-in person's credit history; [month] is 'YYYY-MM', this month
  /// when null.
  /// Where someone stands and a month of where their points came from: the
  /// viewer's own, or [userId]'s for a colleague's Rank tab.
  Future<PointsHistory> fetchPointsHistory({String? month, String? userId}) async {
    final query = [
      if (month != null) 'month=$month',
      if (userId != null) 'userId=${Uri.encodeQueryComponent(userId)}',
    ].join('&');
    return PointsHistory.fromJson(
      await _get('/profile/points/activity${query.isEmpty ? '' : '?$query'}'),
    );
  }

  /// A colleague as anyone in the company may see them: their work details
  /// and reporting line, nothing else. [id] only has to be unique among the
  /// members on screen; it is never sent anywhere.
  Future<TeamMember> fetchPerson(String userId, {int id = -1}) async {
    final json = await _get('/profile/people/${Uri.encodeComponent(userId)}');
    final person = json['person'];
    if (person is! Map<String, dynamic>) {
      throw const ProfileApiException('Person not found', statusCode: 404);
    }
    return TeamMember.fromJson(person, id);
  }

  Future<Map<String, dynamic>> _get(String path) async {
    final http.Response response;
    try {
      response = await _client.get(
        Uri.parse('$_baseUrl$path'),
        headers: {'Authorization': 'Bearer ${session.token}'},
      );
    } catch (error) {
      NetworkStatus.reportFailure(error, probe: Uri.parse('$_baseUrl/health'));
      if (NetworkStatus.isNetworkError(error)) {
        throw const ProfileApiException('No internet connection');
      }
      rethrow;
    }
    NetworkStatus.reportSuccess();
    final json = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ProfileApiException(
        json['message'] as String? ?? 'Request failed',
        statusCode: response.statusCode,
      );
    }
    return json;
  }
}
