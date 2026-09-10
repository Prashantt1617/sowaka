import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// A lightweight full-screen WebView for externally hosted games
/// (Scribble, Find your Mate, Know your Nation). Unlike the Connect
/// game player it carries no leaderboard — these games manage their
/// own scoring — so it just loads the URL and shows load progress.
///
/// The games trigger sharing via the Web Share API (`navigator.share`),
/// which on Android pops the OEM-styled system share sheet — off-brand
/// and inconsistent across devices. We override `navigator.share` to
/// route into a Sowaka-styled bottom sheet instead, keeping a native
/// fallback for genuine cross-app sharing.
class WebGameScreen extends StatefulWidget {
  const WebGameScreen({super.key, required this.title, required this.url});

  final String title;
  final String url;

  @override
  State<WebGameScreen> createState() => _WebGameScreenState();
}

class _WebGameScreenState extends State<WebGameScreen> {
  // Sowaka brand tokens (WebGameScreen is standalone, outside the manager
  // library, so it can't reach MColors — mirror the key values here).
  static const _bg = Color(0xFFF8F4ED);
  static const _terra = Color(0xFFBE5A36);
  static const _ink = Color(0xFF2A2420);
  static const _inkSoft = Color(0xFF6E655C);
  static const _line = Color(0xFFF0E8DD);

  late final WebViewController _controller;
  bool _loading = true;
  int _progress = 0;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(_bg)
      ..addJavaScriptChannel(
        'SowakaShare',
        onMessageReceived: (message) => _handleShare(message.message),
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (progress) {
            if (mounted) setState(() => _progress = progress);
          },
          onPageStarted: (_) {
            if (mounted) setState(() => _loading = true);
          },
          onPageFinished: (_) async {
            await _controller.runJavaScript(_shareBridge);
            if (mounted) setState(() => _loading = false);
          },
        ),
      )
      ..loadRequest(Uri.parse(widget.url));
  }

  /// Redirects the game's `navigator.share()` calls into our bottom sheet,
  /// stashing the browser's real share fn for the "other apps" fallback.
  static const String _shareBridge = '''
(function () {
  if (window.__sowakaShareHooked) return;
  window.__sowakaShareHooked = true;
  window.__sowakaNativeShare = navigator.share ? navigator.share.bind(navigator) : null;
  navigator.share = function (data) {
    try { SowakaShare.postMessage(JSON.stringify(data || {})); } catch (e) {}
    return Promise.resolve();
  };
  if (!navigator.canShare) { navigator.canShare = function () { return true; }; }
})();
''';

  void _handleShare(String raw) {
    Map<String, dynamic> data;
    try {
      data = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      data = const {};
    }
    final parts = [data['title'], data['text'], data['url']]
        .whereType<String>()
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();
    final shareText = parts.join('\n');
    _showShareSheet(shareText, raw);
  }

  void _showShareSheet(String shareText, String rawPayload) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: _bg,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Share your result',
                style: TextStyle(
                  color: _ink,
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.3,
                ),
              ),
              if (shareText.isNotEmpty) ...[
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: _line, width: 1.5),
                  ),
                  child: Text(
                    shareText,
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: _inkSoft,
                      fontSize: 13.5,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              _SheetButton(
                icon: Icons.copy_rounded,
                label: 'Copy',
                background: _terra,
                foreground: Colors.white,
                onTap: () {
                  Navigator.pop(sheetContext);
                  _copy(shareText);
                },
              ),
              const SizedBox(height: 10),
              _SheetButton(
                icon: Icons.ios_share_rounded,
                label: 'Share to other apps',
                background: Colors.white,
                foreground: _ink,
                border: _line,
                onTap: () {
                  Navigator.pop(sheetContext);
                  _nativeShare(rawPayload);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _copy(String text) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Copied to clipboard'),
        behavior: SnackBarBehavior.floating,
        backgroundColor: _ink,
      ),
    );
  }

  /// Re-invokes the browser's original share sheet for genuine cross-app
  /// sharing (unavoidably the OS UI). `rawPayload` is already valid JSON.
  Future<void> _nativeShare(String rawPayload) async {
    await _controller.runJavaScript(
      'window.__sowakaNativeShare && window.__sowakaNativeShare($rawPayload);',
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          IconButton(
            onPressed: () => _controller.reload(),
            tooltip: 'Reload',
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_loading)
            Align(
              alignment: Alignment.topCenter,
              child: LinearProgressIndicator(
                value: _progress == 0 ? null : _progress / 100,
                minHeight: 3,
                backgroundColor: const Color(0xFFEFE7DA),
                color: _terra,
              ),
            ),
        ],
      ),
    );
  }
}

class _SheetButton extends StatelessWidget {
  const _SheetButton({
    required this.icon,
    required this.label,
    required this.background,
    required this.foreground,
    required this.onTap,
    this.border,
  });

  final IconData icon;
  final String label;
  final Color background;
  final Color foreground;
  final VoidCallback onTap;
  final Color? border;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: background,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 15),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: border == null ? null : Border.all(color: border!, width: 1.5),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: foreground, size: 19),
              const SizedBox(width: 9),
              Text(
                label,
                style: TextStyle(
                  color: foreground,
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
