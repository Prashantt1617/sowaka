import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:webview_flutter/webview_flutter.dart';

import '../../shared/app_toast.dart';
import '../../shared/face_photo.dart';

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';

class GamePlayScreen extends StatefulWidget {
  const GamePlayScreen({
    super.key,
    required this.session,
    required this.gameId,
    required this.title,
    required this.hostedUrl,
  });

  final AuthSession session;
  final String gameId;
  final String title;
  final String hostedUrl;

  @override
  State<GamePlayScreen> createState() => _GamePlayScreenState();
}

class _GamePlayScreenState extends State<GamePlayScreen> {
  late final WebViewController _controller;
  List<Map<String, dynamic>> _leaders = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFF8F4ED))
      ..addJavaScriptChannel(
        'SowakaScore',
        onMessageReceived: (message) => _submitScore(message.message),
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) async {
            await _controller.runJavaScript('''
window.Sowaka = window.Sowaka || {};
window.Sowaka.submitScore = function(score) {
  SowakaScore.postMessage(String(score));
};
window.dispatchEvent(new CustomEvent('sowaka-ready'));
''');
            if (mounted) setState(() => _loading = false);
          },
        ),
      )
      ..loadRequest(Uri.parse(widget.hostedUrl));
    _loadLeaderboard();
  }

  Map<String, String> get _headers => {
    'Authorization': 'Bearer ${widget.session.token}',
    'Content-Type': 'application/json',
  };

  Future<void> _loadLeaderboard() async {
    final response = await http.get(
      Uri.parse('${ApiConfig.baseUrl}/connect/games/${widget.gameId}'),
      headers: _headers,
    );
    if (response.statusCode < 200 || response.statusCode >= 300) return;
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    if (mounted) {
      setState(() {
        _leaders = (json['leaderboard'] as List<dynamic>? ?? const [])
            .map((entry) => Map<String, dynamic>.from(entry as Map))
            .toList();
      });
    }
  }

  Future<void> _submitScore(String raw) async {
    final score = num.tryParse(raw);
    if (score == null) return;
    final response = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/connect/games/${widget.gameId}/scores'),
      headers: _headers,
      body: jsonEncode({'score': score}),
    );
    if (!mounted) return;
    if (response.statusCode >= 200 && response.statusCode < 300) {
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      setState(() {
        _leaders = (json['leaderboard'] as List<dynamic>? ?? const [])
            .map((entry) => Map<String, dynamic>.from(entry as Map))
            .toList();
      });
      showAppToast(context, 'Score ${score.round()} saved');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          IconButton(
            onPressed: _showLeaderboard,
            tooltip: 'Leaderboard',
            icon: const Icon(Icons.leaderboard_rounded),
          ),
        ],
      ),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_loading) const Center(child: CircularProgressIndicator()),
        ],
      ),
    );
  }

  void _showLeaderboard() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Leaderboard',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 12),
              if (_leaders.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(20),
                  child: Text('No scores yet. Be the first!'),
                ),
              ..._leaders
                  .take(10)
                  .map(
                    (entry) => ListTile(
                      dense: true,
                      leading: _LeaderFace(
                        rank: '${entry['rank']}',
                        photoUrl: entry['photoUrl'] is String ? entry['photoUrl'] as String : null,
                      ),
                      title: Text(
                        '${entry['playerName']}',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      trailing: Text(
                        '${entry['score']}',
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                    ),
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A leaderboard row's lead: the player's face with their place on it, or
/// the place alone in a circle when they have no photo.
class _LeaderFace extends StatelessWidget {
  const _LeaderFace({required this.rank, this.photoUrl});

  final String rank;
  final String? photoUrl;

  @override
  Widget build(BuildContext context) {
    final plain = CircleAvatar(child: Text(rank));
    if (!FacePhoto.has(photoUrl)) return plain;
    return SizedBox(
      width: 40,
      height: 40,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          FacePhoto(photoUrl: photoUrl, size: 40, fallback: plain),
          Positioned(
            right: -4,
            bottom: -4,
            child: Container(
              constraints: const BoxConstraints(minWidth: 20),
              height: 20,
              padding: const EdgeInsets.symmetric(horizontal: 4),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primary,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Colors.white, width: 1.5),
              ),
              child: Text(
                rank,
                style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
