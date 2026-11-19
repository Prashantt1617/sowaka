import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../data/onboarding_api.dart';
import 'onboarding_kit.dart';

/// The joining portal (preboarding-web) in the app's own page, as the Games
/// tab hosts its web page: the app's header on top, the app's tabs under it,
/// and the portal in between, signed in as the joiner without a code.
///
/// The server gives a fresh portal session for the person's own journey
/// (`POST /lifecycle/portal-session`) and the address of the portal's `/app`
/// entry with it in the fragment; the portal keeps it as its session and goes
/// on to its home. When the portal's session runs out it says `expired` on
/// the `SowakaPortal` channel and a new one is fetched; `signed-out` (the
/// portal's own Sign out) leaves the page.
class PortalPageScreen extends StatefulWidget {
  const PortalPageScreen({super.key, required this.shell, this.surfaceFactory});

  final OnboardingShell shell;

  /// Supplied by tests; a WebView otherwise.
  final PortalSurfaceFactory? surfaceFactory;

  /// For tests that open the page the way the app does (no [surfaceFactory]).
  @visibleForTesting
  static PortalSurfaceFactory? debugSurfaceFactory;

  @override
  State<PortalPageScreen> createState() => _PortalPageScreenState();
}

/// What the page needs of a WebView: load an address, go back in it, be drawn.
abstract class PortalSurface {
  Future<void> load(Uri url);

  /// Goes back a page in the portal; false when it is on its first page.
  Future<bool> back();
  Widget build(BuildContext context);
}

typedef PortalSurfaceFactory =
    PortalSurface Function({
      required void Function(String message) onMessage,
      required bool Function(Uri to) stays,
      required VoidCallback onLoaded,
    });

/// The name the portal posts to (`window.SowakaPortal.postMessage`).
const portalChannel = 'SowakaPortal';

class _PortalPageScreenState extends State<PortalPageScreen> {
  late final PortalSurface _surface;
  Uri? _home;
  String? _error;
  bool _loading = true;
  DateTime? _lastRenewal;

  @override
  void initState() {
    super.initState();
    _surface = (widget.surfaceFactory ?? PortalPageScreen.debugSurfaceFactory ?? _WebViewPortalSurface.new)(
      onMessage: _onMessage,
      stays: _stays,
      onLoaded: () {
        if (mounted) setState(() => _loading = false);
      },
    );
    unawaited(_open());
  }

  Future<void> _open() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final url = await widget.shell.api.portalSessionUrl();
      _home = url;
      await _surface.load(url);
    } catch (error) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = onboardingErrorText(error);
        });
      }
    }
  }

  void _onMessage(String message) {
    switch (message) {
      case 'expired':
        // A fresh session, once a minute at most: a portal that keeps
        // refusing it shows the error instead of reloading for ever.
        final last = _lastRenewal;
        final now = DateTime.now();
        if (last != null && now.difference(last) < const Duration(minutes: 1)) {
          setState(() => _error = 'Your joining portal couldn’t sign you in. Try again.');
          return;
        }
        _lastRenewal = now;
        unawaited(_open());
      case 'signed-out':
        unawaited(Navigator.of(context).maybePop());
    }
  }

  /// The portal's own pages stay here; anything else (mail, a policy, a
  /// site) opens outside the app.
  bool _stays(Uri to) {
    if (to.scheme == 'about' || to.scheme == 'data' || to.scheme == 'blob') return true;
    final home = _home;
    if (home != null && to.scheme == home.scheme && to.host == home.host && to.port == home.port) {
      final base = home.path.endsWith('/app') ? home.path.substring(0, home.path.length - 3) : '/';
      if (to.path.startsWith(base)) return true;
    }
    unawaited(launchUrl(to, mode: LaunchMode.externalApplication).catchError((_) => false));
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final error = _error;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final navigator = Navigator.of(context);
        if (error == null && await _surface.back()) return;
        navigator.pop();
      },
      child: OnbScaffold(
        shell: widget.shell,
        title: 'Onboarding',
        showTitleRow: false,
        background: Colors.white,
        body: error != null
            ? OnbLoadState(error: error, onRetry: _open)
            : Stack(
                children: [
                  Positioned.fill(child: _surface.build(context)),
                  if (_loading) const Positioned(top: 0, left: 0, right: 0, child: LinearProgressIndicator(minHeight: 2)),
                ],
              ),
      ),
    );
  }
}

class _WebViewPortalSurface implements PortalSurface {
  _WebViewPortalSurface({
    required void Function(String message) onMessage,
    required bool Function(Uri to) stays,
    required VoidCallback onLoaded,
  }) : _controller = WebViewController() {
    _controller
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..enableZoom(false)
      ..addJavaScriptChannel(portalChannel, onMessageReceived: (message) => onMessage(message.message))
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) {
            final to = Uri.tryParse(request.url);
            return to != null && stays(to) ? NavigationDecision.navigate : NavigationDecision.prevent;
          },
          onPageFinished: (_) => onLoaded(),
          onWebResourceError: (error) {
            if (error.isForMainFrame ?? false) onLoaded();
          },
        ),
      );
  }

  final WebViewController _controller;

  @override
  Future<void> load(Uri url) => _controller.loadRequest(url);

  @override
  Future<bool> back() async {
    if (!await _controller.canGoBack()) return false;
    await _controller.goBack();
    return true;
  }

  @override
  Widget build(BuildContext context) => WebViewWidget(controller: _controller);
}
