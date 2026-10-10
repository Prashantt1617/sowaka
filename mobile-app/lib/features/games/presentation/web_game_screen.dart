import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../../auth/data/auth_models.dart';
import '../../shared/app_toast.dart';
import '../data/game_bridge.dart';
import '../data/game_socket_service.dart';
import '../data/games_api_service.dart';
import '../data/games_models.dart';

/// A web game, full screen under a bar with the way back and its name.
///
/// Two ways in. [WebGameScreen.catalog] opens a game from the company's
/// catalog: its page is fetched with the person's session and loaded here,
/// with the Sowaka bridge (`window.Sowaka`) in it before the game's first
/// line runs, so the game can post a score, read the player's name and show
/// the company's leaderboard; a catalog game hosted elsewhere is opened at
/// its address and given the same bridge once it loads. The plain
/// constructor opens a hosted game by its address, as before the catalog.
///
/// A catalog game also hears about the person's colleague challenges while
/// it is open: each `game:challenge` from the server is passed to the page
/// ([GameEventForwarder]). Opened from a challenge notification, it carries
/// that challenge's id, and the page opens straight on it.
///
/// The games trigger sharing via the Web Share API (`navigator.share`),
/// which on Android pops the OEM-styled system share sheet — off-brand
/// and inconsistent across devices. We override `navigator.share` to
/// route into a Sowaka-styled bottom sheet instead, keeping a native
/// fallback for genuine cross-app sharing.
class WebGameScreen extends StatefulWidget {
  /// A hosted game opened by its address, without a bridge.
  const WebGameScreen({super.key, required this.title, required String this.url})
    : game = null,
      session = null,
      service = null,
      challengeId = null,
      realtime = null;

  /// A game from the company's catalog.
  WebGameScreen.catalog({
    super.key,
    required GameCatalogEntry this.game,
    required AuthSession this.session,
    this.service,
    this.challengeId,
    this.realtime,
  }) : title = game.name,
       url = null;

  final String title;
  final String? url;
  final GameCatalogEntry? game;
  final AuthSession? session;

  /// Supplied by tests; the screen makes its own otherwise.
  final GamesApiService? service;

  /// The challenge to open the game on, from a tapped notification.
  final String? challengeId;

  /// Supplied by tests; the screen opens its own socket otherwise.
  final GameRealtime? realtime;

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
  GameBridge? _bridge;
  GameEventForwarder? _forwarder;
  GamesApiService? _service;
  bool _loading = true;
  int _progress = 0;
  String? _error;

  /// Where the game's page lives once loaded: the address a catalog page is
  /// given, or a hosted game's own. Navigation stays there.
  Uri? _home;

  GameCatalogEntry? get _game => widget.game;

  /// The page's own background, so the bar and the strip under the home
  /// indicator are of a piece with it.
  Color get _background => _game?.backgroundColor ?? _bg;
  bool get _dark => _background.computeLuminance() < 0.4;
  Color get _foreground => _dark ? Colors.white : _ink;

  @override
  void initState() {
    super.initState();
    final PlatformWebViewControllerCreationParams params;
    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      // Game sounds play without a tap of their own, and inline.
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }
    final game = _game;
    _controller = WebViewController.fromPlatformCreationParams(params)
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(_background)
      ..addJavaScriptChannel(
        'SowakaShare',
        onMessageReceived: (message) => _handleShare(message.message),
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: game == null ? null : _onNavigationRequest,
          onProgress: (progress) {
            if (mounted) setState(() => _progress = progress);
          },
          onPageStarted: (_) {
            if (mounted) setState(() => _loading = true);
          },
          onPageFinished: (_) async {
            try {
              await _controller.runJavaScript(_shareBridge);
              // A hosted catalog game gets the bridge now; a page loaded
              // here already has it, and the script leaves it alone.
              if (game != null) await _controller.runJavaScript(_bridgeScript());
            } catch (_) {
              // A page that refuses scripts still plays.
            }
            if (mounted) setState(() => _loading = false);
          },
        ),
      );
    final platform = _controller.platform;
    if (platform is AndroidWebViewController) {
      platform.setMediaPlaybackRequiresUserGesture(false);
    }
    if (game == null) {
      _controller.loadRequest(Uri.parse(widget.url!));
      return;
    }
    final service = widget.service ?? GamesApiService(session: widget.session!);
    _service = service;
    _bridge = GameBridge(
      service: service,
      gameKey: game.key,
      company: widget.session!.user.company,
    );
    _controller
      ..enableZoom(false)
      ..addJavaScriptChannel(
        gameBridgeChannel,
        onMessageReceived: (message) => _onBridgeMessage(message.message),
      );
    // Challenges change while the game is open: the page hears it at once.
    _forwarder = GameEventForwarder(
      realtime: widget.realtime ?? GameSocketService(session: widget.session!),
      gameKey: game.key,
      run: _runInPage,
    )..start();
    _open();
  }

  @override
  void dispose() {
    _forwarder?.dispose();
    super.dispose();
  }

  String _bridgeScript() => gameBridgeScript(
    playerName: widget.session!.user.name,
    startChallengeId: widget.challengeId,
  );

  Future<void> _runInPage(String script) async {
    if (!mounted) return;
    try {
      await _controller.runJavaScript(script);
    } catch (_) {
      // Not loaded yet, or gone: the page reads its lists when it loads.
    }
  }

  /// Loads the game: a page from the catalog is fetched with the session and
  /// loaded as the app's own copy; a hosted one is opened at its address.
  Future<void> _open() async {
    final game = _game!;
    final service = _service!;
    try {
      if (game.hasPage) {
        final html = await service.page(game);
        if (!mounted) return;
        final home = service.pageUri(game.key);
        _home = home;
        await _controller.loadHtmlString(
          injectGameBridge(html, _bridgeScript()),
          baseUrl: home.toString(),
        );
      } else {
        final home = Uri.parse(game.hostedUrl!);
        _home = home;
        await _controller.loadRequest(home);
      }
    } on GamesApiException catch (error) {
      _failed(error.message);
    } catch (_) {
      _failed('This game could not be opened. Check your connection and try again.');
    }
  }

  void _failed(String message) {
    if (!mounted) return;
    setState(() {
      _error = message;
      _loading = false;
    });
  }

  void _retry() {
    setState(() {
      _error = null;
      _loading = true;
      _progress = 0;
    });
    _open();
  }

  /// The game stays on its own page. Its copy here lives at the address it
  /// was given and nothing else on that host is opened; a hosted game keeps
  /// to its own site. A link elsewhere goes to the phone's browser, and a
  /// frame from anywhere else is not loaded, so nothing but the game can
  /// reach the bridge.
  NavigationDecision _onNavigationRequest(NavigationRequest request) {
    final to = Uri.tryParse(request.url);
    if (to == null) return NavigationDecision.prevent;
    if (to.scheme == 'about' || to.scheme == 'data' || to.scheme == 'blob') {
      return NavigationDecision.navigate;
    }
    final home = _home;
    if (home != null && to.scheme == home.scheme && to.host == home.host) {
      if (!_game!.hasPage || to.path == home.path) {
        return NavigationDecision.navigate;
      }
    }
    if (request.isMainFrame &&
        const {'https', 'http', 'mailto', 'tel'}.contains(to.scheme)) {
      launchUrl(to, mode: LaunchMode.externalApplication);
    }
    return NavigationDecision.prevent;
  }

  Future<void> _onBridgeMessage(String raw) async {
    final reply = await _bridge?.handle(raw);
    if (reply == null || !mounted) return;
    try {
      await _controller.runJavaScript(reply);
    } catch (_) {
      // The page went away while the answer was on its way.
    }
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
    final Map<String, dynamic> data;
    try {
      data = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      // Not a share the page could have made: nothing to offer.
      return;
    }
    final parts = [data['title'], data['text'], data['url']]
        .whereType<String>()
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();
    final shareText = parts.join('\n');
    // Handed back to the page re-encoded, never as it came: it goes into a script.
    _showShareSheet(shareText, jsonEncode(data));
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
    showAppToast(context, 'Copied to clipboard');
  }

  /// Re-invokes the browser's original share sheet for genuine cross-app
  /// sharing (unavoidably the OS UI). `rawPayload` is JSON this app encoded.
  Future<void> _nativeShare(String rawPayload) async {
    await _controller.runJavaScript(
      'window.__sowakaNativeShare && window.__sowakaNativeShare($rawPayload);',
    );
  }

  void _showHowToPlay() {
    final game = _game!;
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: _bg,
      showDragHandle: true,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (sheetContext) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                game.name,
                style: const TextStyle(
                  color: _ink,
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.3,
                ),
              ),
              if (game.description.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  game.description,
                  style: const TextStyle(color: _inkSoft, fontSize: 14.5, height: 1.4),
                ),
              ],
              if (game.instructions.isNotEmpty) ...[
                const SizedBox(height: 16),
                const Text(
                  'How to play',
                  style: TextStyle(
                    color: _ink,
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  game.instructions,
                  style: const TextStyle(color: _inkSoft, fontSize: 14.5, height: 1.45),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final game = _game;
    final explains =
        game != null && (game.instructions.isNotEmpty || game.description.isNotEmpty);
    return Scaffold(
      backgroundColor: _background,
      appBar: AppBar(
        backgroundColor: _background,
        foregroundColor: _foreground,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        systemOverlayStyle: _dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
        leading: const BackButton(),
        title: Text(
          widget.title,
          style: TextStyle(
            color: _foreground,
            fontSize: 18,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.2,
          ),
        ),
        actions: [
          if (explains)
            IconButton(
              onPressed: _showHowToPlay,
              tooltip: 'How to play',
              icon: const Icon(Icons.help_outline_rounded),
            ),
          // A catalog game keeps its round going; only a hosted one by
          // address offers a reload.
          if (game == null)
            IconButton(
              onPressed: () => _controller.reload(),
              tooltip: 'Reload',
              icon: const Icon(Icons.refresh_rounded),
            ),
        ],
      ),
      // Under the bar the page has the screen to itself, clear of the home
      // indicator; the strip below it is the page's colour.
      body: SafeArea(
        top: false,
        child: Stack(
          children: [
            WebViewWidget(controller: _controller),
            if (_error != null)
              Positioned.fill(child: _errorView(_error!)),
            if (_loading && _error == null)
              Align(
                alignment: Alignment.topCenter,
                child: LinearProgressIndicator(
                  value: _progress == 0 ? null : _progress / 100,
                  minHeight: 3,
                  backgroundColor: _dark
                      ? Colors.white.withValues(alpha: 0.12)
                      : const Color(0xFFEFE7DA),
                  color: game?.accentColor ?? _terra,
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _errorView(String message) => ColoredBox(
    color: _background,
    child: Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.wifi_off_rounded, size: 34, color: _foreground.withValues(alpha: 0.7)),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(color: _foreground, fontSize: 15, height: 1.4),
            ),
            const SizedBox(height: 18),
            _SheetButton(
              icon: Icons.refresh_rounded,
              label: 'Try again',
              background: _game?.accentColor ?? _terra,
              foreground: (_game?.accentColor ?? _terra).computeLuminance() > 0.5
                  ? _ink
                  : Colors.white,
              onTap: _retry,
            ),
          ],
        ),
      ),
    ),
  );
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
