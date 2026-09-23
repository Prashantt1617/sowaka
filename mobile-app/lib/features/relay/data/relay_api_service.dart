import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import 'relay_models.dart';

/// The one request the game needs outside its socket: what is on, and which
/// team this person is on, for the card in the feed.
class RelayApiService {
  RelayApiService({required this.session, String? baseUrl, http.Client? client})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
      _client = client ?? http.Client();

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;

  Future<RelayCard?> myCard() async {
    final response = await _client.get(
      Uri.parse('$_baseUrl/relay/me'),
      headers: {'Authorization': 'Bearer ${session.token}'},
    );
    // No open game, or not on a team: the card simply leaves that part out.
    if (response.statusCode != 200) return null;
    final card = RelayCard.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
    // A signed video comes back absolute; a locally stored one is a path on
    // this API, which the phone resolves against the address it is using.
    if (card.instructionsVideoUrl.startsWith('/')) {
      return RelayCard(
        title: card.title,
        status: card.status,
        startsAt: card.startsAt,
        pointsPerCorrect: card.pointsPerCorrect,
        instructionsVideoUrl: '$_baseUrl${card.instructionsVideoUrl}',
        teamName: card.teamName,
        members: card.members,
        podium: card.podium,
      );
    }
    return card;
  }
}
