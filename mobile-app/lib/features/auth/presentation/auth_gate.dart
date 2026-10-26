import 'dart:async';

import 'package:flutter/material.dart';

import '../../../routes/app_routes.dart';
import '../../manager_shell/presentation/tablet_shell.dart';
import '../../home/presentation/home_screen.dart';
import '../data/auth_models.dart';
import '../data/auth_api_service.dart';
import '../data/auth_session_store.dart';
import '../../shared/org_branding.dart';
import 'login_screen.dart';
import 'splash_screen.dart';

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  late final Future<AuthSession?> _session = _restoreSession();

  /// Whose brand this device last signed in to. Read at once, so the splash
  /// settles on the right wordmark within the first frames rather than
  /// showing Sowaka's to a Convrse employee for two seconds.
  OrgBranding _branding = OrgBranding.sowaka;

  @override
  void initState() {
    super.initState();
    OrgBranding.remembered().then((branding) {
      if (mounted) setState(() => _branding = branding);
    });
  }

  /// How long past the splash the app waits for the fresh profile before it
  /// opens on the one this device kept.
  static const _refreshGrace = Duration(milliseconds: 600);

  Future<AuthSession?> _restoreSession() async {
    // Run the restore and the splash animation together — a cached session
    // resolves almost instantly and would otherwise cut the brand animation
    // off mid-way. The profile check rides along, but a slow network no
    // longer holds the splash for as long as it takes: shortly after the
    // animation the app opens on the session it kept, and the check carries
    // on behind it.
    final splash = Future<void>.delayed(SplashScreen.duration);
    final store = AuthSessionStore();
    final cached = await store.read();
    if (cached == null) {
      await splash;
      return null;
    }
    final refreshed = _refresh(store, cached);
    await splash;
    var late = false;
    final session = await refreshed.timeout(
      _refreshGrace,
      onTimeout: () {
        late = true;
        return cached;
      },
    );
    if (late) {
      // Signed out elsewhere or offboarded meanwhile: the check, when it
      // lands, ends the session it let in.
      unawaited(
        refreshed.then((result) {
          if (result == null && mounted) {
            appNavigatorKey.currentState?.pushNamedAndRemoveUntil(
              AppRoutes.login,
              (_) => false,
            );
          }
        }),
      );
    }
    return session;
  }

  /// The profile as the server has it now, kept for the next launch; null
  /// when the session is over. Never throws: offline, the kept one stands.
  Future<AuthSession?> _refresh(AuthSessionStore store, AuthSession cached) async {
    try {
      final user = await AuthApiService()
          .fetchCurrentUser(cached.token)
          .timeout(const Duration(seconds: 15));
      final refreshed = AuthSession(token: cached.token, user: user);
      await store.save(refreshed);
      return refreshed;
    } on AuthApiException catch (error) {
      if (error.statusCode == 401 || error.statusCode == 403) {
        await store.clear();
        return null;
      }
      return cached;
    } catch (_) {
      return cached;
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<AuthSession?>(
      future: _session,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return SplashScreen(branding: _branding);
        }

        final session = snapshot.data;
        return session == null
            ? const LoginScreen()
            : HomeScreen(session: session);
      },
    );
  }
}
