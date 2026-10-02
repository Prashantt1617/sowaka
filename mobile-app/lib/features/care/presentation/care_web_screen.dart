import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import 'care_theme.dart';

/// One of the Care pages on the web, opened inside the app: Move, Breathe,
/// Listen or Sleep at care.getsowaka.com. Clips and sounds play inline, and
/// start without a second tap, so the page behaves like the app's own
/// screens did.
class CareWebScreen extends StatefulWidget {
  const CareWebScreen({
    super.key,
    required this.title,
    required this.url,
    this.fullScreen = false,
  });

  final String title;
  final String url;

  /// The page runs right up to the top of the screen, under the status bar,
  /// with the back arrow floating over it: Sleep's night sky.
  final bool fullScreen;

  @override
  State<CareWebScreen> createState() => _CareWebScreenState();
}

class _CareWebScreenState extends State<CareWebScreen> {
  late final WebViewController _controller;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    final PlatformWebViewControllerCreationParams params;
    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }
    _controller = WebViewController.fromPlatformCreationParams(params)
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(
        widget.fullScreen ? const Color(0xFF0B1118) : CareColors.bg,
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (_) {
            if (mounted) setState(() => _loading = true);
          },
          onPageFinished: (_) {
            if (mounted) setState(() => _loading = false);
          },
        ),
      )
      ..loadRequest(Uri.parse(_address()));
    final platform = _controller.platform;
    if (platform is AndroidWebViewController) {
      platform.setMediaPlaybackRequiresUserGesture(false);
    }
  }

  @override
  void dispose() {
    // A full-screen page turned the status bar white; the screen below it
    // is light again.
    if (widget.fullScreen) {
      SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.dark);
    }
    super.dispose();
  }

  /// A full-screen page is told how tall the status bar is, so its words
  /// start below it.
  String _address() {
    if (!widget.fullScreen) return widget.url;
    final view = WidgetsBinding.instance.platformDispatcher.views.first;
    final top = view.padding.top / view.devicePixelRatio;
    final sep = widget.url.contains('#') ? '&' : '#';
    return '${widget.url}${sep}top=${top.round()}';
  }

  /// The one way back. The page goes back within itself first (a stretch
  /// to Move, a profile to its topic); at its first page it says so, and
  /// this returns to the app. Pages from before they could answer simply
  /// return to the app.
  Future<void> _back() async {
    try {
      final went = await _controller.runJavaScriptReturningResult(
        'window.sowakaBack ? window.sowakaBack() : false',
      );
      if (went == true || '$went' == 'true' || '$went' == '1') return;
    } catch (_) {
      // No answer from the page: take the person home.
    }
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final web = WebViewWidget(controller: _controller);
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: widget.fullScreen ? _fullScreen(web) : _framed(web),
    );
  }

  Widget _arrow(Color color, {bool backed = false}) => Semantics(
    button: true,
    label: 'Back',
    child: Material(
      // Over a page that may be light or dark, a soft dark disc behind it.
      color: backed ? Colors.black.withValues(alpha: 0.28) : Colors.transparent,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: _back,
        customBorder: const CircleBorder(),
        child: Padding(
          padding: const EdgeInsets.all(9),
          child: Icon(Icons.arrow_back_rounded, size: 22, color: color),
        ),
      ),
    ),
  );

  Widget _framed(Widget web) => Scaffold(
    backgroundColor: CareColors.bg,
    body: SafeArea(
      bottom: false,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 2, 20, 0),
            child: Row(
              children: [
                _arrow(CareColors.muted),
                const Spacer(),
                Text(
                  widget.title,
                  style: const TextStyle(
                    fontFamily: careFont,
                    color: CareColors.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          if (_loading)
            const LinearProgressIndicator(
              minHeight: 2,
              color: CareColors.blue,
              backgroundColor: CareColors.blueTint,
            ),
          Expanded(child: web),
        ],
      ),
    ),
  );

  Widget _fullScreen(Widget web) => AnnotatedRegion<SystemUiOverlayStyle>(
    value: SystemUiOverlayStyle.light,
    child: Scaffold(
      backgroundColor: const Color(0xFF0B1118),
      body: Stack(
        // The page fills the whole screen; the bar floats over its top.
        fit: StackFit.expand,
        children: [
          Positioned.fill(child: web),
          Positioned(
            left: 0,
            right: 0,
            top: 0,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 2, 20, 0),
                child: Row(
                  children: [
                    _arrow(Colors.white, backed: true),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.28),
                        borderRadius: BorderRadius.circular(100),
                      ),
                      child: Text(
                        widget.title,
                        style: const TextStyle(
                          fontFamily: careFont,
                          color: Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (_loading)
            const Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: LinearProgressIndicator(
                minHeight: 2,
                color: Colors.white70,
                backgroundColor: Colors.transparent,
              ),
            ),
        ],
      ),
    ),
  );
}
