import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:webview_flutter/webview_flutter.dart';

import '../../shared/app_toast.dart';

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
                      leading: CircleAvatar(child: Text('${entry['rank']}')),
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
