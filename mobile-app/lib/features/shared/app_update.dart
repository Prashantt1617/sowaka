import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../services/api_config.dart';
import '../auth/data/auth_session_store.dart';

/// What the server says about the app in this person's hand.
enum AppUpdateMode { none, optional, force }

class AppUpdateStatus {
  const AppUpdateStatus({required this.mode, this.version, this.storeUrl});

  static const none = AppUpdateStatus(mode: AppUpdateMode.none);

  factory AppUpdateStatus.fromJson(Map<String, dynamic> json) {
    final storeUrl = json['storeUrl'] as String?;
    final mode = switch (json['mode']) {
      'force' => AppUpdateMode.force,
      'optional' => AppUpdateMode.optional,
      _ => AppUpdateMode.none,
    };
    // Nowhere to send them, nothing to ask.
    if (storeUrl == null || storeUrl.isEmpty) return none;
    return AppUpdateStatus(
      mode: mode,
      version: json['version'] as String?,
      storeUrl: storeUrl,
    );
  }

  final AppUpdateMode mode;

  /// The version the rule asks for; the optional prompt is closed per version.
  final String? version;
  final String? storeUrl;
}

/// Asks `GET /app/update` with this build's version and platform. Each
/// company's rule is set by Sowaka on the server, so turning the screens on
/// or off needs no release.
class AppUpdateService {
  AppUpdateService({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  static String? get platform {
    if (kIsWeb) return null;
    if (Platform.isIOS) return 'ios';
    if (Platform.isAndroid) return 'android';
    return null;
  }

  Future<AppUpdateStatus> check() async {
    final platform = AppUpdateService.platform;
    if (platform == null) return AppUpdateStatus.none;
    // Whose rule applies is known only once someone has signed in.
    final session = await AuthSessionStore().read();
    if (session == null) return AppUpdateStatus.none;
    final info = await PackageInfo.fromPlatform();
    final version = info.buildNumber.isEmpty
        ? info.version
        : '${info.version}+${info.buildNumber}';
    final uri = Uri.parse(
      '${ApiConfig.baseUrl}/app/update',
    ).replace(queryParameters: {'platform': platform, 'version': version});
    final response = await _client
        .get(uri, headers: {'Authorization': 'Bearer ${session.token}'})
        .timeout(const Duration(seconds: 10));
    if (response.statusCode != 200) return AppUpdateStatus.none;
    final data = jsonDecode(utf8.decode(response.bodyBytes));
    return data is Map<String, dynamic>
        ? AppUpdateStatus.fromJson(data)
        : AppUpdateStatus.none;
  }
}

/// Sits above the whole app. At launch and every time the app comes back to
/// the front it asks whether this build must or may update:
///
/// * force: a full screen over everything, with no way past it but the store;
/// * optional: a closable card, shown once for each version it asks for.
///
/// A failed check shows nothing; nobody is locked out by a network error.
class AppUpdateGate extends StatefulWidget {
  const AppUpdateGate({super.key, required this.child, this.service});

  final Widget child;
  final AppUpdateService? service;

  static final _recheck = ValueNotifier<int>(0);

  /// Asks again now: called once someone is signed in, since the check at
  /// launch had no company to ask about.
  static void recheck() => _recheck.value += 1;

  @override
  State<AppUpdateGate> createState() => _AppUpdateGateState();
}

class _AppUpdateGateState extends State<AppUpdateGate>
    with WidgetsBindingObserver {
  static const _dismissedKey = 'app_update.dismissed_version';

  late final AppUpdateService _service = widget.service ?? AppUpdateService();
  AppUpdateStatus _status = AppUpdateStatus.none;
  bool _checking = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    AppUpdateGate._recheck.addListener(_check);
    _check();
  }

  @override
  void dispose() {
    AppUpdateGate._recheck.removeListener(_check);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _check();
  }

  Future<void> _check() async {
    if (_checking) return;
    _checking = true;
    try {
      var status = await _service.check();
      if (status.mode == AppUpdateMode.optional) {
        final prefs = await SharedPreferences.getInstance();
        if (prefs.getString(_dismissedKey) == status.version) {
          status = AppUpdateStatus.none;
        }
      }
      if (mounted) setState(() => _status = status);
    } catch (_) {
      // Offline or the server is away: carry on as before.
    } finally {
      _checking = false;
    }
  }

  Future<void> _dismiss() async {
    final version = _status.version;
    setState(() => _status = AppUpdateStatus.none);
    if (version == null) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_dismissedKey, version);
    } catch (_) {
      // Not remembered: it asks once more next time, nothing worse.
    }
  }

  Future<void> _openStore() async {
    final url = _status.storeUrl;
    if (url == null) return;
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        if (_status.mode == AppUpdateMode.force)
          Positioned.fill(child: ForceUpdateScreen(onUpdate: _openStore)),
        if (_status.mode == AppUpdateMode.optional)
          Positioned.fill(
            child: OptionalUpdatePrompt(
              onUpdate: _openStore,
              onClose: _dismiss,
            ),
          ),
      ],
    );
  }
}

// Figma 3902:15655 (force) and 3920:50797 (optional), Sowaka Connect.
const _headline = Color(0xFF1A1A2E);
const _body = Color(0xFF7A7A9A);
const _brand = Color(0xFF0571A6);
const _tile = Color(0xFFE8F5F8);
const _spark = Color(0xFFC9A8E2);
const _handle = Color(0xFFD1D5DB);
const _scrim = Color(0x73000000); // rgba(0,0,0,0.45)

const _copy =
    'To keep using the app, please update to the latest version. It only '
    'takes a moment.';

/// The update nobody can skip: it covers every screen, and its only way
/// forward is the store. Back reaches only the routes underneath it.
class ForceUpdateScreen extends StatelessWidget {
  const ForceUpdateScreen({super.key, required this.onUpdate});

  final VoidCallback onUpdate;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeOut,
      builder: (context, t, child) => Opacity(opacity: t, child: child),
      child: Material(
        color: Colors.white,
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 70, 20, 32),
            child: Column(
              children: [
                const _UpdateIllustration(width: 184, height: 184, rocket: 248),
                const SizedBox(height: 50),
                const _UpdateCopy(),
                const Spacer(),
                _UpdateButton(label: 'Update now', onPressed: onUpdate),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The update that can wait: a sheet over the dimmed app. It closes by
/// swiping it down or tapping above it; there is no close button in the
/// design.
class OptionalUpdatePrompt extends StatefulWidget {
  const OptionalUpdatePrompt({
    super.key,
    required this.onUpdate,
    required this.onClose,
  });

  final VoidCallback onUpdate;
  final VoidCallback onClose;

  @override
  State<OptionalUpdatePrompt> createState() => _OptionalUpdatePromptState();
}

class _OptionalUpdatePromptState extends State<OptionalUpdatePrompt>
    with SingleTickerProviderStateMixin {
  late final AnimationController _shown = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 320),
    reverseDuration: const Duration(milliseconds: 220),
  )..forward();
  double _sheetHeight = 0;
  bool _closing = false;

  @override
  void dispose() {
    _shown.dispose();
    super.dispose();
  }

  Future<void> _close() async {
    if (_closing) return;
    _closing = true;
    await _shown.reverse();
    widget.onClose();
  }

  void _drag(DragUpdateDetails details) {
    if (_sheetHeight <= 0) return;
    _shown.value -= (details.primaryDelta ?? 0) / _sheetHeight;
  }

  void _release(DragEndDetails details) {
    final flungDown = (details.primaryVelocity ?? 0) > 700;
    if (flungDown || _shown.value < 0.6) {
      _close();
    } else {
      _shown.forward();
    }
  }

  @override
  Widget build(BuildContext context) {
    final slide = CurvedAnimation(
      parent: _shown,
      curve: Curves.easeOutCubic,
      reverseCurve: Curves.easeInCubic,
    );
    return Stack(
      children: [
        Positioned.fill(
          child: FadeTransition(
            opacity: _shown,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: _close,
              child: const ColoredBox(color: _scrim),
            ),
          ),
        ),
        Align(
          alignment: Alignment.bottomCenter,
          child: AnimatedBuilder(
            animation: slide,
            builder: (context, child) => FractionalTranslation(
              translation: Offset(0, 1 - slide.value),
              child: child,
            ),
            child: GestureDetector(
              onVerticalDragUpdate: _drag,
              onVerticalDragEnd: _release,
              child: _MeasuredSheet(
                onHeight: (height) => _sheetHeight = height,
                child: _sheet(context),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _sheet(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      shadowColor: const Color(0x1F000000),
      elevation: 8,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: _handle,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 46),
              const _UpdateIllustration(
                width: double.infinity,
                height: 171,
                rocket: 235,
              ),
              const SizedBox(height: 50),
              const _UpdateCopy(),
              const SizedBox(height: 50),
              _UpdateButton(label: 'Update', onPressed: widget.onUpdate),
            ],
          ),
        ),
      ),
    );
  }
}

/// Reports its child's height, so a drag can be read as a fraction of it.
class _MeasuredSheet extends SingleChildRenderObjectWidget {
  const _MeasuredSheet({required this.onHeight, required super.child});

  final ValueChanged<double> onHeight;

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderMeasured(onHeight);

  @override
  void updateRenderObject(BuildContext context, _RenderMeasured renderObject) {
    renderObject.onHeight = onHeight;
  }
}

class _RenderMeasured extends RenderProxyBox {
  _RenderMeasured(this.onHeight);

  ValueChanged<double> onHeight;

  @override
  void performLayout() {
    super.performLayout();
    onHeight(size.height);
  }
}

/// The pale tile with the launching rocket (an animated GIF from the design)
/// and its two accent dots and spark.
class _UpdateIllustration extends StatelessWidget {
  const _UpdateIllustration({
    required this.width,
    required this.height,
    required this.rocket,
  });

  final double width;
  final double height;
  final double rocket;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: _tile,
        borderRadius: BorderRadius.circular(40),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1F1A7FA6),
            offset: Offset(0, 12),
            blurRadius: 14,
          ),
        ],
      ),
      child: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.center,
        children: [
          Positioned(
            left: 23,
            top: 27,
            child: SvgPicture.asset(
              'assets/images/update/accent_bubble.svg',
              width: 24,
              height: 24,
            ),
          ),
          Positioned(
            left: 142,
            top: 132,
            child: SvgPicture.asset(
              'assets/images/update/accent_dot.svg',
              width: 14,
              height: 14,
            ),
          ),
          // Larger than its tile on purpose: the rocket's smoke spills out.
          OverflowBox(
            maxWidth: rocket,
            maxHeight: rocket,
            child: Image.asset(
              'assets/images/update/update_rocket.gif',
              width: rocket,
              height: rocket,
              fit: BoxFit.cover,
              gaplessPlayback: true,
            ),
          ),
          Positioned(
            left: 139,
            top: 28.46,
            child: Transform.rotate(
              angle: -32 * 3.141592653589793 / 180,
              child: Container(
                width: 18,
                height: 5,
                decoration: BoxDecoration(
                  color: _spark,
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _UpdateCopy extends StatelessWidget {
  const _UpdateCopy();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          // "than": the force screen's frame says "then", a typo the
          // optional sheet's frame does not have.
          'We are better than ever',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontFamily: 'Sora',
            fontSize: 24,
            fontWeight: FontWeight.w700,
            fontVariations: [FontVariation.weight(700)],
            height: 38 / 24,
            color: _headline,
          ),
        ),
        SizedBox(height: 10),
        // 323 wide in Figma; Flutter sets Sora a hair wider, so the box is
        // widened just enough to break where the design does.
        SizedBox(
          width: 336,
          child: Text(
            _copy,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontFamily: 'Sora',
              fontSize: 15,
              fontWeight: FontWeight.w400,
              fontVariations: [FontVariation.weight(400)],
              height: 23 / 15,
              color: _body,
            ),
          ),
        ),
      ],
    );
  }
}

class _UpdateButton extends StatelessWidget {
  const _UpdateButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton(
        onPressed: onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: _brand,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        child: Text(
          label,
          style: const TextStyle(
            fontFamily: 'Sora',
            fontSize: 16,
            fontWeight: FontWeight.w600,
            fontVariations: [FontVariation.weight(600)],
            height: 24 / 16,
            letterSpacing: -0.16,
          ),
        ),
      ),
    );
  }
}
