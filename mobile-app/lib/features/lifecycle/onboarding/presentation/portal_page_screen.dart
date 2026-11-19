import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../manager_shell/presentation/app_home_header.dart';
import '../data/onboarding_api.dart';
import 'onboarding_kit.dart';

/// The pre-boarding portal (preboarding-web) in the app, signed in as the
/// joiner without a code, before Day 1 (`/lifecycle/me` says
/// `onboarding.portal`; from the joining day it is false).
///
/// The server gives a fresh portal session for the person's own journey
/// (`POST /lifecycle/portal-session`) and the address of the portal's `/app`
/// entry with it in the fragment; the portal keeps it as its session and goes
/// on to its home. When the portal's session runs out it says `expired` on
/// the `SowakaPortal` channel and a new one is fetched; `signed-out` (the
/// portal's own Sign out) is handed to [onSignedOut].
///
/// Only the page: [PortalTab] puts the app's header over it (the Action tab,
/// as the Games tab hosts its web page), [PortalPageScreen] the header and
/// the tabs (opened over the shell where there is no Action tab).
class PortalPage extends StatefulWidget {
  const PortalPage({
    super.key,
    required this.api,
    this.visible = true,
    this.handlesBack = false,
    this.onSignedOut,
    this.surfaceFactory,
  });

  final OnboardingApi api;

  /// Whether it is on screen: the session is asked for the first time it is,
  /// not the moment a tab that holds it is built.
  final bool visible;

  /// Back steps back inside the portal first (a page pushed on its own); in
  /// a tab the shell decides what Back does.
  final bool handlesBack;

  /// The portal's own Sign out; a fresh session is fetched when not given.
  final VoidCallback? onSignedOut;

  /// Supplied by tests; a WebView otherwise.
  final PortalSurfaceFactory? surfaceFactory;

  /// For tests that build the page the way the app does (no [surfaceFactory]).
  @visibleForTesting
  static PortalSurfaceFactory? debugSurfaceFactory;

  @override
  State<PortalPage> createState() => _PortalPageState();
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

class _PortalPageState extends State<PortalPage> {
  late final PortalSurface _surface;
  Uri? _home;
  String? _error;
  bool _loading = false;
  bool _opened = false;
  DateTime? _lastRenewal;

  @override
  void initState() {
    super.initState();
    _surface = (widget.surfaceFactory ?? PortalPage.debugSurfaceFactory ?? _WebViewPortalSurface.new)(
      onMessage: _onMessage,
      stays: _stays,
      onLoaded: () {
        if (mounted) setState(() => _loading = false);
      },
    );
    if (widget.visible) _first();
  }

  @override
  void didUpdateWidget(PortalPage old) {
    super.didUpdateWidget(old);
    if (widget.visible) _first();
  }

  void _first() {
    if (_opened) return;
    _opened = true;
    unawaited(_open());
  }

  Future<void> _open() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final url = await widget.api.portalSessionUrl();
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
        final signedOut = widget.onSignedOut;
        if (signedOut != null) {
          signedOut();
        } else {
          unawaited(_open());
        }
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
    final Widget page = error != null
        ? OnbLoadState(error: error, onRetry: _open)
        : Stack(
            children: [
              Positioned.fill(child: _surface.build(context)),
              if (_loading) const Positioned(top: 0, left: 0, right: 0, child: LinearProgressIndicator(minHeight: 2)),
            ],
          );
    if (!widget.handlesBack) return page;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final navigator = Navigator.of(context);
        if (error == null && await _surface.back()) return;
        navigator.pop();
      },
      child: page,
    );
  }
}

/// The Action tab before Day 1: the app's header and the
/// portal under it; the shell draws the tabs. Built once and kept, as the
/// Games tab's page is, so switching tabs never reloads it.
class PortalTab extends StatelessWidget {
  const PortalTab({
    super.key,
    required this.api,
    required this.profileAction,
    required this.onNotifications,
    this.visible = true,
  });

  final OnboardingApi api;
  final Widget profileAction;
  final VoidCallback onNotifications;
  final bool visible;

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: Colors.white,
    child: Column(
      children: [
        AppHomeHeader(profileAction: profileAction, onNotifications: onNotifications),
        Expanded(child: PortalPage(api: api, visible: visible)),
      ],
    ),
  );
}

/// The portal as a page of its own over the shell (header, portal, tabs),
/// for where the Action tab cannot show it.
class PortalPageScreen extends StatelessWidget {
  const PortalPageScreen({super.key, required this.shell, this.surfaceFactory});

  final OnboardingShell shell;

  /// Supplied by tests; a WebView otherwise.
  final PortalSurfaceFactory? surfaceFactory;

  @override
  Widget build(BuildContext context) => OnbScaffold(
    shell: shell,
    title: 'Onboarding',
    showTitleRow: false,
    background: Colors.white,
    body: PortalPage(
      api: shell.api,
      handlesBack: true,
      onSignedOut: () => unawaited(Navigator.of(context).maybePop()),
      surfaceFactory: surfaceFactory,
    ),
  );
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
