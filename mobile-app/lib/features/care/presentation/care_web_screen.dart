import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import 'care_theme.dart';

/// One of the Care pages on the web, opened inside the app: Move, Breathe,
/// Listen or Sleep at care.getsowaka.com. Clips and sounds play inline, and
/// start without a second tap, so the page behaves like the app's own
/// screens did.
class CareWebScreen extends StatefulWidget {
  const CareWebScreen({super.key, required this.title, required this.url});

  final String title;
  final String url;

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
      ..setBackgroundColor(CareColors.bg)
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
      ..loadRequest(Uri.parse(widget.url));
    final platform = _controller.platform;
    if (platform is AndroidWebViewController) {
      platform.setMediaPlaybackRequiresUserGesture(false);
    }
  }

  /// Back on this bar returns to the app, always. The page keeps its own
  /// back links for moving within itself, so stepping through the web
  /// view's history here only made Care feel two pages deep.
  void _back() {
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        backgroundColor: CareColors.bg,
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                child: Row(
                  children: [
                    Expanded(child: CareBackLink('Care', onTap: _back)),
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
              Expanded(child: WebViewWidget(controller: _controller)),
            ],
          ),
        ),
      ),
    );
  }
}
