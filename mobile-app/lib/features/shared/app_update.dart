import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
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

const _ink = Color(0xFF222222);
const _muted = Color(0xFF6A6A6A);
const _brand = Color(0xFF0571A6);

/// The update nobody can skip: it covers every screen, and its only way
/// forward is the store. Back reaches only the routes underneath it.
class ForceUpdateScreen extends StatelessWidget {
  const ForceUpdateScreen({super.key, required this.onUpdate});

  final VoidCallback onUpdate;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(flex: 3),
              const _UpdateMark(size: 96),
              const SizedBox(height: 28),
              const Text(
                'Time to update',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w800,
                  color: _ink,
                  height: 1.2,
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'This version of Sowaka is no longer supported. '
                'Update to the latest version to keep using the app.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16, color: _muted, height: 1.5),
              ),
              const Spacer(flex: 4),
              _PrimaryButton(label: 'Update now', onPressed: onUpdate),
            ],
          ),
        ),
      ),
    );
  }
}

/// The update that can wait: a card over a dimmed app, closed with ✕, "Not
/// now" or a tap outside it.
class OptionalUpdatePrompt extends StatelessWidget {
  const OptionalUpdatePrompt({
    super.key,
    required this.onUpdate,
    required this.onClose,
  });

  final VoidCallback onUpdate;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.black.withValues(alpha: 0.45),
      child: Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: onClose,
            ),
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              width: double.infinity,
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
              ),
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(24, 12, 24, 20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Align(
                        alignment: Alignment.centerRight,
                        // No tooltip: the gate sits above the app's Overlay.
                        child: IconButton(
                          onPressed: onClose,
                          icon: const Icon(
                            Icons.close_rounded,
                            color: _muted,
                            semanticLabel: 'Close',
                          ),
                        ),
                      ),
                      const _UpdateMark(size: 72),
                      const SizedBox(height: 20),
                      const Text(
                        'A new version is here',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                          color: _ink,
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Update Sowaka for the latest features and fixes.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 16,
                          color: _muted,
                          height: 1.5,
                        ),
                      ),
                      const SizedBox(height: 24),
                      _PrimaryButton(label: 'Update now', onPressed: onUpdate),
                      const SizedBox(height: 8),
                      TextButton(
                        onPressed: onClose,
                        style: TextButton.styleFrom(
                          foregroundColor: _muted,
                          minimumSize: const Size.fromHeight(48),
                        ),
                        child: const Text(
                          'Not now',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _UpdateMark extends StatelessWidget {
  const _UpdateMark({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(size * 0.24),
        child: Image.asset(
          'assets/images/sowaka_logo.png',
          width: size,
          height: size,
          fit: BoxFit.contain,
          errorBuilder: (_, _, _) => Icon(
            Icons.system_update_rounded,
            size: size * 0.7,
            color: _brand,
          ),
        ),
      ),
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  const _PrimaryButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: _brand,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(54),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      child: Text(
        label,
        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
    );
  }
}
