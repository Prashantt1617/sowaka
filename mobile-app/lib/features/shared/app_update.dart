import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../services/api_config.dart';
import '../auth/data/auth_models.dart';
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

  /// [session] is the signed-in one when the caller has already read it.
  Future<AppUpdateStatus> check({AuthSession? session}) async {
    final platform = AppUpdateService.platform;
    if (platform == null) return AppUpdateStatus.none;
    // Whose rule applies is known only once someone has signed in.
    session ??= await AuthSessionStore().read();
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
/// * optional: [AppUpdateStrip] at the top of the home feed, closable, shown
///   once for each version it asks for.
///
/// A failed check shows nothing; nobody is locked out by a network error.
class AppUpdateGate extends StatefulWidget {
  const AppUpdateGate({super.key, required this.child, this.service});

  final Widget child;
  final AppUpdateService? service;

  static final _recheck = ValueNotifier<int>(0);
  static const _dismissedKey = 'app_update.dismissed_version';

  /// The optional update the strip offers, or null: set by the gate, cleared
  /// when the strip is closed.
  static final optional = ValueNotifier<AppUpdateStatus?>(null);

  /// Closes the strip and remembers it for that version.
  static Future<void> dismissOptional() async {
    final version = optional.value?.version;
    optional.value = null;
    if (version == null) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_dismissedKey, version);
    } catch (_) {
      // Not remembered: it asks once more next time, nothing worse.
    }
  }

  /// The App Store on iPhone, the Play Store on Android.
  static Future<void> openStore(String? url) async {
    if (url == null) return;
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  /// Asks again now.
  static void recheck() => _recheck.value += 1;

  static final _signedIn = ValueNotifier<int>(0);

  /// Someone is signed in: asks, unless the check at launch already asked for
  /// this same session. Only a launch with nobody signed in had no company to
  /// ask about; one that restored a session asked once already, and the home
  /// screen asking again was a second /app/update on every launch.
  static void signedIn() => _signedIn.value += 1;

  @override
  State<AppUpdateGate> createState() => _AppUpdateGateState();
}

class _AppUpdateGateState extends State<AppUpdateGate>
    with WidgetsBindingObserver {
  late final AppUpdateService _service = widget.service ?? AppUpdateService();
  AppUpdateStatus _status = AppUpdateStatus.none;
  bool _checking = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    AppUpdateGate._recheck.addListener(_check);
    AppUpdateGate._signedIn.addListener(_checkForNewSession);
    _check();
  }

  @override
  void dispose() {
    AppUpdateGate._recheck.removeListener(_check);
    AppUpdateGate._signedIn.removeListener(_checkForNewSession);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _check();
  }

  bool _again = false;

  /// The session the last check asked for (null: nobody signed in).
  String? _askedFor;
  bool _asked = false;

  void _checkForNewSession() => _check(onlyForNewSession: true);

  Future<void> _check({bool onlyForNewSession = false}) async {
    // A recheck asked for mid-check runs once that one is done, not never.
    if (_checking) {
      _again = true;
      return;
    }
    _checking = true;
    try {
      final session = await AuthSessionStore().read();
      if (onlyForNewSession && _asked && session?.token == _askedFor) return;
      _asked = true;
      _askedFor = session?.token;
      final status = await _service.check(session: session);
      AppUpdateStatus? offer;
      if (status.mode == AppUpdateMode.optional) {
        final prefs = await SharedPreferences.getInstance();
        final closed =
            prefs.getString(AppUpdateGate._dismissedKey) == status.version;
        offer = closed ? null : status;
      }
      AppUpdateGate.optional.value = offer;
      if (mounted) setState(() => _status = status);
    } catch (_) {
      // Offline or the server is away: carry on as before.
    } finally {
      _checking = false;
      if (_again && mounted) {
        _again = false;
        unawaited(_check());
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        if (_status.mode == AppUpdateMode.force)
          Positioned.fill(
            // Screen readers too: nothing underneath can be reached.
            child: BlockSemantics(
              child: ForceUpdateScreen(
                onUpdate: () => AppUpdateGate.openStore(_status.storeUrl),
              ),
            ),
          ),
      ],
    );
  }
}

// Figma 3902:15655 (force), Sowaka Connect.
const _headline = Color(0xFF1A1A2E);
const _body = Color(0xFF7A7A9A);
const _brand = Color(0xFF0571A6);
const _tile = Color(0xFFE8F5F8);
const _spark = Color(0xFFC9A8E2);

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

/// The optional update, as a strip at the top of the home feed (the "Update
/// strip" design canvas): the rocket on its pale tile, the line and the
/// "Update" pill on brand blue, and an ✕ that closes it for this version.
/// Nothing at all when no update is offered.
class AppUpdateStrip extends StatelessWidget {
  const AppUpdateStrip({super.key, this.bottomGap = 14});

  /// The space between the strip and what follows, there only with the strip.
  final double bottomGap;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AppUpdateStatus?>(
      valueListenable: AppUpdateGate.optional,
      builder: (context, offer, _) => AnimatedSize(
        duration: const Duration(milliseconds: 240),
        curve: Curves.easeOutCubic,
        alignment: Alignment.topCenter,
        child: offer == null
            ? const SizedBox(width: double.infinity)
            : Padding(
                padding: EdgeInsets.only(bottom: bottomGap),
                child: _StripCard(
                  onUpdate: () => AppUpdateGate.openStore(offer.storeUrl),
                  onClose: AppUpdateGate.dismissOptional,
                ),
              ),
      ),
    );
  }
}

// The light update strip ("Home – update strip only", 2x mock): a pale blue
// card with a hairline border, the rocket on its own, dark copy and a solid
// "Update app" pill.
const _stripFill = Color(0xFFDDEFF8);
const _stripBorder = Color(0xFFBFDDEC);
const _stripTitle = Color(0xFF0B2E42);
const _stripCopy = Color(0xFF3A5A6C);

TextStyle _manrope(
  double size,
  FontWeight weight,
  Color color, {
  double? height,
  double spacing = 0,
}) => TextStyle(
  fontFamily: 'Manrope',
  fontSize: size,
  fontWeight: weight,
  fontVariations: [FontVariation.weight(weight.value.toDouble())],
  color: color,
  height: height,
  letterSpacing: spacing,
);

class _StripCard extends StatelessWidget {
  const _StripCard({required this.onUpdate, required this.onClose});

  final VoidCallback onUpdate;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        constraints: const BoxConstraints(minHeight: 72),
        decoration: BoxDecoration(
          color: _stripFill,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: _stripBorder),
          boxShadow: const [
            BoxShadow(
              color: Color(0x140B2E42), // rgba(11,46,66,0.08)
              offset: Offset(0, 4),
              blurRadius: 12,
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          children: [
            // Two soft white circles: a large one behind the button and the
            // close, a small one rising under the copy.
            const Positioned(
              right: -34,
              top: -46,
              child: _Glow(size: 136, alpha: 0.56),
            ),
            const Positioned(
              left: 72,
              bottom: -34,
              child: _Glow(size: 58, alpha: 0.44),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(6, 10, 2, 10),
              child: Row(
                children: [
                  // The rocket alone, 24 by 41 of it showing in a 44 square.
                  Image.asset(
                    'assets/images/update/update_strip_rocket.png',
                    width: 44,
                    height: 44,
                    fit: BoxFit.contain,
                  ),
                  const SizedBox(width: 6),
                  // The title shrinks a touch rather than wrap on a narrow
                  // phone; the copy under it takes two lines.
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: Text(
                            'We are better than ever',
                            maxLines: 1,
                            softWrap: false,
                            style: _manrope(
                              13,
                              FontWeight.w700,
                              _stripTitle,
                              spacing: -0.1,
                            ),
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Update to the latest version, it only takes a '
                          'moment.',
                          style: _manrope(
                            12,
                            FontWeight.w400,
                            _stripCopy,
                            height: 1.3,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    height: 34,
                    child: FilledButton(
                      onPressed: onUpdate,
                      style: FilledButton.styleFrom(
                        backgroundColor: _brand,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        minimumSize: const Size(0, 34),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        shape: const StadiumBorder(),
                      ),
                      child: Text(
                        'Update app',
                        style: _manrope(14, FontWeight.w700, Colors.white),
                      ),
                    ),
                  ),
                  const SizedBox(width: 5),
                  Semantics(
                    button: true,
                    label: 'Dismiss update banner',
                    child: InkResponse(
                      onTap: onClose,
                      radius: 22,
                      child: const SizedBox(
                        width: 32,
                        height: 44,
                        child: Icon(
                          Icons.close_rounded,
                          size: 18,
                          color: _stripCopy,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Glow extends StatelessWidget {
  const _Glow({required this.size, required this.alpha});

  final double size;
  final double alpha;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: Colors.white.withValues(alpha: alpha),
    ),
  );
}
