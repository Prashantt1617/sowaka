import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../../../services/notification_service.dart';
import '../../auth/data/auth_models.dart';
import '../../shared/app_toast.dart';
import '../data/games_api_service.dart';
import '../data/home_page_bridge.dart';
import 'games_style.dart';

/// The key of the Games tab's page on the server (`GET /app-pages/games-home`).
const String gamesHomePageKey = 'games-home';

/// What the tab needs of a WebView: load a page, run a script in it, and be
/// drawn. [WebViewHomeSurface] is the real one; tests give their own.
abstract class HomePageSurface {
  Future<void> load(String html, {required String baseUrl});
  Future<void> run(String script);
  Widget build(BuildContext context);
}

/// Makes the tab's one surface. [onMessage] hears the page's bridge channel;
/// [onLoaded] is called each time a page has finished loading, and [onGone]
/// when the page has been thrown away under the tab (iOS ends a WebView's
/// content process to free memory) and must be loaded again.
typedef HomePageSurfaceFactory =
    HomePageSurface Function({
      required void Function(String message) onMessage,
      required VoidCallback onLoaded,
      required VoidCallback onGone,
    });

/// Clears what web pages kept on this phone: their local storage (Odd One
/// Out's `oddone.v1` and its caches, kept by player name) and the web cache.
/// For sign-out, so the next account on the phone starts clean; the pages'
/// own keying by person is a later change. Never in the way: without a
/// WebView (a test) or on any failure it does nothing.
Future<void> clearGamesWebData() async {
  if (WebViewPlatform.instance == null) return;
  try {
    final controller = WebViewController();
    await controller.clearLocalStorage();
    await controller.clearCache();
  } catch (_) {}
}

/// Opens a game by its key; on [challengeId] when one is being taken up.
/// Completes when the game is closed.
typedef OpenGameByKey =
    Future<void> Function(
      BuildContext context,
      String key,
      String? challengeId,
    );

/// Opens a contest's Entries page over the tab; completes when it is closed.
typedef OpenContestEntries =
    Future<void> Function(BuildContext context, String postId);

/// The Games tab as the server's web page (`backend/app-pages/games-home.html`),
/// whenever the page is on for the person's company; the native tab
/// ([nativeHome]) whenever it is not, or cannot be had.
///
/// Which one: the page the phone last kept is shown at once, and the server
/// is asked again the first time the tab is looked at (and after a while); a
/// newer version, or the page being switched off (404), takes effect the
/// next time the tab is shown, never under the person's finger. Asked for
/// the first time, the tab waits for the answer, briefly; with no answer and
/// nothing kept, the native tab.
///
/// The page lives as long as the tab: switching tabs, opening a game over it
/// or picking it again from the bar never reloads it. A fresh pick from the
/// bar ([resets] going up) tells the page `{kind: 'reset'}` instead; the
/// native tab is rebuilt for it as before.
class WebGamesHome extends StatefulWidget {
  const WebGamesHome({
    super.key,
    required this.session,
    required this.nativeHome,
    required this.onOpenGame,
    required this.onOpenContest,
    required this.onOpenPost,
    this.onOpenProfile,
    this.visible = true,
    this.resets = 0,
    this.service,
    this.surfaceFactory,
    this.challengeEvents,
    this.bundledThumbnails = const {},
    this.nativeGames = const [],
    this.decideWithin = const Duration(seconds: 5),
    this.callTimeout = const Duration(seconds: 15),
  });

  final AuthSession session;

  /// The native Games tab, the fallback.
  final WidgetBuilder nativeHome;

  final OpenGameByKey onOpenGame;
  final OpenContestEntries onOpenContest;

  /// Opens a post in the Connect feed: anything that is not a contest.
  final ValueChanged<String> onOpenPost;
  final ValueChanged<String>? onOpenProfile;

  /// Whether this is the tab on screen.
  final bool visible;

  /// How many times the tab has been picked fresh from the bar.
  final int resets;

  /// Supplied by tests; the tab makes its own otherwise.
  final GamesApiService? service;

  /// Supplied by tests; a WebView otherwise.
  final HomePageSurfaceFactory? surfaceFactory;

  /// Challenge changes the app hears, `{gameKey, challengeId, ...}`; the
  /// game-challenge notifications that arrive while the app is open, when
  /// not given.
  final Stream<Map<String, dynamic>>? challengeEvents;

  /// Pictures bundled with the app for its own games, by key, handed to the
  /// page as data: it cannot load the app's assets itself.
  final Map<String, String> bundledThumbnails;

  /// The keys of the games the app opens natively, for the page to know
  /// which of the catalog's native games it can offer (`Sowaka.nativeGames`).
  final List<String> nativeGames;

  /// How long a first-ever look waits for the server before the native tab.
  final Duration decideWithin;

  /// How long the page's home, leaderboard and accept calls may take before
  /// they are refused, so the page's own Try again comes up rather than a
  /// spinner for ever.
  final Duration callTimeout;

  @override
  State<WebGamesHome> createState() => _WebGamesHomeState();
}

enum _Mode { deciding, web, native }

/// Neither shown yet nor waiting: what to change to on the next show.
sealed class _Pending {
  const _Pending();
}

class _PendingPage extends _Pending {
  const _PendingPage(this.page);
  final AppPage page;
}

class _PendingNative extends _Pending {
  const _PendingNative();
}

class _WebGamesHomeState extends State<WebGamesHome>
    with WidgetsBindingObserver {
  /// How old the last answer may be before a show asks the server again.
  static const _recheckAfter = Duration(minutes: 10);

  late final GamesApiService _service =
      widget.service ?? GamesApiService(session: widget.session);

  _Mode _mode = _Mode.deciding;
  _Pending? _pending;
  HomePageSurface? _surface;
  AppPage? _loaded;
  late final HomePageBridge _bridge = HomePageBridge(_actions());

  bool _checking = false;
  DateTime? _checkedAt;
  Timer? _decideTimer;

  bool _foreground = true;
  bool _covered = false;
  bool _reduceMotion = false;

  /// Whether the tab was looked at when last brought in line ([_sync]).
  bool _looked = false;

  /// A game or a contest the page asked for, on its way open or open ([_over]).
  bool _opening = false;

  /// Page loads so far: an answer is only handed to the load it was asked in.
  int _loads = 0;
  final _random = math.Random();

  /// What the page was last told: looked at, or not.
  bool _shown = false;
  DateTime? _refreshedAt;

  StreamSubscription<Map<String, dynamic>>? _challenges;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _foreground = lifecycle == null || lifecycle == AppLifecycleState.resumed;
    _challenges = (widget.challengeEvents ?? _challengeNotifications()).listen(
      _onChallenge,
    );
    unawaited(_start());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduceMotion = MediaQuery.disableAnimationsOf(context);
    // A route pushed over the shell (a game, an Entries page) stops its
    // tickers: the tab is not looked at while it is there.
    _covered = !TickerMode.valuesOf(context).enabled;
    if (_covered) _wasCovered = true;
    _sync();
  }

  @override
  void didUpdateWidget(covariant WebGamesHome oldWidget) {
    super.didUpdateWidget(oldWidget);
    final reset = widget.resets != oldWidget.resets;
    _sync();
    if (reset && _mode == _Mode.web) {
      _send({'kind': 'reset'});
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _sync();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _decideTimer?.cancel();
    _challenges?.cancel();
    super.dispose();
  }

  Stream<Map<String, dynamic>> _challengeNotifications() =>
      AppNotificationService.instance.received.where(
        (data) => data['destination'] == 'game_challenge',
      );

  /// What the phone kept decides at once; else the tab waits for the server
  /// when it is first looked at.
  Future<void> _start() async {
    KeptAppPage? kept;
    try {
      kept = await _service.appPageFromCache(gamesHomePageKey);
    } catch (_) {}
    if (!mounted || _mode != _Mode.deciding) return;
    if (kept != null) {
      final page = kept.page;
      setState(() {
        if (page == null) {
          _useNative();
        } else {
          _useWeb(page);
        }
      });
    }
    _sync();
  }

  /// Whether the person is looking at the tab right now.
  bool get _lookedAt => widget.visible && _foreground && !_covered;

  /// Brings everything in line with whether the tab is looked at: what is
  /// waiting is swapped in as it comes into view, the page is told, and the
  /// server is asked again when the last answer is old.
  void _sync() {
    if (!mounted) return;
    final looked = _lookedAt;
    final cameIntoView = looked && !_looked;
    _looked = looked;
    if (looked) {
      _everLooked = true;
      _loadTarget();
    }
    if (cameIntoView) {
      _applyPending();
      final checked = _checkedAt;
      // A page served from disk on a developer's machine is asked for on
      // every show, so an edit to it is picked up without a relaunch.
      if (checked == null ||
          _target?.version == 'dev' ||
          DateTime.now().difference(checked) > _recheckAfter) {
        unawaited(_check());
      }
    }
    if (_mode != _Mode.web) {
      _shown = false;
      if (_mode == _Mode.deciding && looked) _waitForAnswer();
      return;
    }
    if (looked == _shown) return;
    _shown = looked;
    _send({'kind': looked ? 'visible' : 'hidden'});
    // Back from a route pushed over the tab (a game, an Entries page, a
    // profile): the page reads its data again at once.
    if (looked && _wasCovered) {
      _wasCovered = false;
      _refresh();
    }
  }

  /// Whether something was pushed over the tab since it was last looked at.
  bool _wasCovered = false;

  /// A page has loaded: it is told at once whether it is looked at, since
  /// it starts as though it were.
  void _onLoaded() {
    if (!mounted || _mode != _Mode.web) return;
    _shown = _lookedAt;
    _send({'kind': _shown ? 'visible' : 'hidden'});
  }

  /// The page was thrown away under the tab: loaded again now when the tab is
  /// looked at, else the next time it is ([_sync] loads what is missing).
  void _onGone() {
    if (!mounted) return;
    _loaded = null;
    _shown = false;
    if (_lookedAt) _loadTarget();
  }

  void _waitForAnswer() {
    if (_decideTimer != null) return;
    _decideTimer = Timer(widget.decideWithin, () {
      if (mounted && _mode == _Mode.deciding) setState(_useNative);
    });
  }

  void _useNative() {
    _decideTimer?.cancel();
    _decideTimer = null;
    _mode = _Mode.native;
  }

  void _applyPending() {
    final pending = _pending;
    if (pending == null) return;
    _pending = null;
    switch (pending) {
      case _PendingPage(:final page):
        setState(() => _useWeb(page));
      case _PendingNative():
        setState(_useNative);
    }
  }

  /// Asks the server for the page; what it says is used now when nothing is
  /// on screen, else on the next show.
  Future<void> _check() async {
    if (_checking) return;
    _checking = true;
    try {
      final page = await _service.appPage(gamesHomePageKey);
      _checkedAt = DateTime.now();
      if (!mounted) return;
      if (page == null) {
        if (_mode == _Mode.native) {
          _pending = null;
        } else {
          _decide(const _PendingNative());
        }
      } else if (_mode != _Mode.web ||
          _target?.version != page.version ||
          _target?.html != page.html) {
        _decide(_PendingPage(page));
      } else {
        _pending = null;
      }
    } catch (_) {
      // Nothing kept and no answer: the native tab. Something kept stays.
      if (mounted && _mode == _Mode.deciding) setState(_useNative);
    } finally {
      _checking = false;
    }
  }

  void _decide(_Pending next) {
    final now = _mode == _Mode.deciding || !_lookedAt;
    if (!now) {
      _pending = next;
      return;
    }
    _pending = next;
    _applyPending();
    _sync();
  }

  /// Shows [page] in the tab's one surface. The surface (a WebView) is made,
  /// and the page loaded, once the tab is first looked at: a page reads its
  /// data as it starts, nothing is asked of the server for a tab never
  /// opened, and an app start never pays for a WebView it does not show.
  void _useWeb(AppPage page) {
    _decideTimer?.cancel();
    _decideTimer = null;
    _mode = _Mode.web;
    _target = page;
    if (_everLooked) _loadTarget();
  }

  /// The page the surface should hold, and whether the tab was ever looked at.
  AppPage? _target;
  bool _everLooked = false;

  void _loadTarget() {
    final page = _target;
    if (page == null || _mode != _Mode.web) return;
    var surface = _surface;
    if (surface == null) {
      surface = _surface = (widget.surfaceFactory ?? WebViewHomeSurface.new)(
        onMessage: _onMessage,
        onLoaded: _onLoaded,
        onGone: _onGone,
      );
      if (mounted) setState(() {});
    }
    if (_loaded != null &&
        _loaded!.version == page.version &&
        _loaded!.html == page.html)
      return;
    _loaded = page;
    _shown = false;
    _loads += 1;
    unawaited(
      surface.load(
        injectHomeBridge(
          page.html,
          homePageBridgeScript(
            reduceMotion: _reduceMotion,
            userId: widget.session.user.id,
            org: widget.session.user.org ?? '',
            nativeGames: widget.nativeGames,
            loadId: '$_loads${_random.nextInt(1 << 30).toRadixString(36)}',
          ),
        ),
        baseUrl: '${_service.baseUrl}/app-pages/$gamesHomePageKey',
      ),
    );
  }

  Future<void> _send(Map<String, dynamic> event) async {
    final surface = _surface;
    if (surface == null || _mode != _Mode.web) return;
    try {
      await surface.run(homeEventScript(event));
    } catch (_) {
      // Not loaded yet: the page reads everything when it starts.
    }
  }

  /// Tells the page to read its data again; once, however many reasons
  /// arrive together.
  void _refresh() {
    final last = _refreshedAt;
    final now = DateTime.now();
    if (last != null && now.difference(last) < const Duration(seconds: 1))
      return;
    _refreshedAt = now;
    _send({'kind': 'refresh'});
  }

  void _onChallenge(Map<String, dynamic> data) {
    if (_mode != _Mode.web) return;
    _send({
      'kind': 'challenge',
      'challenge': {
        'id': data['challengeId'],
        'gameKey': data['gameKey'],
        if (data['scenario'] != null) 'scenario': data['scenario'],
      },
    });
  }

  Future<void> _onMessage(String raw) async {
    final load = _loads;
    final reply = await _bridge.handle(raw);
    // Asked by a page since replaced: nobody is waiting for it.
    if (reply == null || !mounted || load != _loads) return;
    try {
      await _surface?.run(reply);
    } catch (_) {
      // The page went away while the answer was on its way.
    }
  }

  /// Runs [open] (a pushed route) and has the page read its data when it
  /// closes. One at a time: the page's taps on a card while a game or a
  /// contest is on its way open (the catalog read, the route pushed) or open
  /// are dropped, so a quick second tap never opens it — or joins its room —
  /// twice.
  Future<void> _over(Future<void> Function() open) async {
    if (_opening) return;
    _opening = true;
    try {
      await open();
    } finally {
      _opening = false;
      if (mounted) _refresh();
    }
  }

  /// [call], refused with a message the page shows (with its Try again)
  /// when it has not answered in time.
  Future<T> _inTime<T>(Future<T> Function() call) async {
    try {
      return await call().timeout(widget.callTimeout);
    } on TimeoutException {
      throw const GamesApiException(
        'Sowaka took too long to answer. Check your connection and try again.',
      );
    }
  }

  HomePageActions _actions() => HomePageActions(
    // The home has its own limit inside, so a slow answer falls back to the
    // home last kept; the outer one only turns a timeout into a refusal.
    home: () => _inTime(
      () async => _withBundledThumbnails(
        await _service.homeJson(
          timeout: widget.callTimeout - const Duration(milliseconds: 500),
        ),
      ),
    ),
    leaderboard: (period) =>
        _inTime(() => _service.pointsLeaderboardJson(period)),
    acceptChallenge: (id) => _inTime(() => _service.acceptChallenge(id)),
    openGame: (key, challengeId) {
      if (!mounted) return;
      unawaited(_over(() => widget.onOpenGame(context, key, challengeId)));
    },
    openContest: (postId) {
      if (!mounted) return;
      unawaited(_over(() => widget.onOpenContest(context, postId)));
    },
    openPost: (postId) => widget.onOpenPost(postId),
    openProfile: (userId) => widget.onOpenProfile?.call(userId),
    toast: (text) {
      if (mounted) showAppToast(context, text);
    },
    haptic: (kind) => switch (kind) {
      'medium' => HapticFeedback.mediumImpact(),
      'success' => HapticFeedback.heavyImpact(),
      _ => HapticFeedback.lightImpact(),
    },
  );

  /// Bundled pictures, as data the page can show; read once per run.
  static final Map<String, String> _bundledData = {};

  Future<Map<String, dynamic>> _withBundledThumbnails(
    Map<String, dynamic> json,
  ) async {
    final games = json['games'];
    if (games is! List) return json;
    final out = <dynamic>[];
    for (final game in games) {
      if (game is! Map) {
        out.add(game);
        continue;
      }
      final thumbnail = game['thumbnail'];
      final asset = thumbnail is String && thumbnail.startsWith('assets/')
          ? thumbnail
          : (thumbnail == null || thumbnail == '')
          ? widget.bundledThumbnails['${game['key']}']
          : null;
      if (asset == null) {
        out.add(game);
        continue;
      }
      final data = await _assetData(asset);
      out.add({...game, 'thumbnail': ?data});
    }
    return {...json, 'games': out};
  }

  static Future<String?> _assetData(String asset) async {
    final held = _bundledData[asset];
    if (held != null) return held;
    try {
      final bytes = await rootBundle.load(asset);
      final lower = asset.toLowerCase();
      final type = lower.endsWith('.png')
          ? 'image/png'
          : lower.endsWith('.webp')
          ? 'image/webp'
          : lower.endsWith('.svg')
          ? 'image/svg+xml'
          : 'image/jpeg';
      final uri =
          'data:$type;base64,${base64Encode(bytes.buffer.asUint8List(bytes.offsetInBytes, bytes.lengthInBytes))}';
      _bundledData[asset] = uri;
      return uri;
    } catch (_) {
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    return switch (_mode) {
      _Mode.native => KeyedSubtree(
        // A fresh pick from the bar builds the native tab again, as it always did.
        key: ValueKey('games-native-${widget.resets}'),
        child: widget.nativeHome(context),
      ),
      _Mode.deciding => GamesDotBackground(
        child: widget.visible
            ? const Center(
                child: SizedBox(
                  width: 26,
                  height: 26,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.4,
                    color: GamesStyle.night,
                  ),
                ),
              )
            : const SizedBox.expand(),
      ),
      // The top inset is the app's; the page fills the rest, down to the bar.
      // Until the tab is first looked at there is no WebView, only its ground.
      _Mode.web => GamesDotBackground(
        child: _surface == null
            ? const SizedBox.expand()
            : SafeArea(
                bottom: false,
                child: KeyedSubtree(
                  key: const ValueKey('games-web-home'),
                  child: _surface!.build(context),
                ),
              ),
      ),
    };
  }
}

/// The tab's WebView, set up as a game's ([WebGameScreen]): JavaScript on,
/// the page's colour behind it, no zoom, and the page kept to itself — a link
/// elsewhere opens in the phone's browser, and nothing else is navigated to.
class WebViewHomeSurface implements HomePageSurface {
  WebViewHomeSurface({
    required void Function(String message) onMessage,
    required VoidCallback onLoaded,
    required VoidCallback onGone,
  }) {
    final PlatformWebViewControllerCreationParams params;
    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }
    controller = WebViewController.fromPlatformCreationParams(params)
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(GamesStyle.page)
      ..enableZoom(false)
      ..addJavaScriptChannel(
        homePageChannel,
        onMessageReceived: (message) => onMessage(message.message),
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: _onNavigationRequest,
          onPageFinished: (_) => onLoaded(),
          // iOS ends the content process to free memory, mostly while the
          // app is in the background; the WebView is then blank until it is
          // loaded again. (Android's renderer going away is not reported by
          // webview_flutter_android 4.12, which has no onRenderProcessGone.)
          onWebResourceError: (error) {
            if (error.errorType ==
                WebResourceErrorType.webContentProcessTerminated)
              onGone();
          },
        ),
      );
    final platform = controller.platform;
    if (platform is AndroidWebViewController) {
      platform.setMediaPlaybackRequiresUserGesture(false);
    }
  }

  late final WebViewController controller;
  Uri? _home;

  @override
  Future<void> load(String html, {required String baseUrl}) {
    _home = Uri.parse(baseUrl);
    return controller.loadHtmlString(html, baseUrl: baseUrl);
  }

  @override
  Future<void> run(String script) => controller.runJavaScript(script);

  @override
  // The page takes every touch at once, ahead of the tab shell's swipe: see
  // the game screen for why.
  Widget build(BuildContext context) => WebViewWidget(
    controller: controller,
    gestureRecognizers: const {
      Factory<OneSequenceGestureRecognizer>(EagerGestureRecognizer.new),
    },
  );

  NavigationDecision _onNavigationRequest(NavigationRequest request) {
    final to = Uri.tryParse(request.url);
    if (to == null) return NavigationDecision.prevent;
    if (to.scheme == 'about' || to.scheme == 'data' || to.scheme == 'blob') {
      return NavigationDecision.navigate;
    }
    final home = _home;
    if (home != null &&
        to.scheme == home.scheme &&
        to.host == home.host &&
        to.path == home.path) {
      return NavigationDecision.navigate;
    }
    if (request.isMainFrame &&
        const {'https', 'http', 'mailto', 'tel'}.contains(to.scheme)) {
      launchUrl(to, mode: LaunchMode.externalApplication);
    }
    return NavigationDecision.prevent;
  }
}
