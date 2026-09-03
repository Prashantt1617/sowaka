import 'package:flutter/material.dart';

import '../../home/presentation/home_screen.dart';
import '../data/auth_models.dart';
import '../data/auth_api_service.dart';
import '../data/auth_session_store.dart';
import 'login_screen.dart';
import 'splash_screen.dart';

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  late final Future<AuthSession?> _session = _restoreSession();

  Future<AuthSession?> _restoreSession() async {
    // Run the restore and the splash animation together, then take whichever
    // finishes last — a cached session resolves almost instantly and would
    // otherwise cut the brand animation off mid-way.
    final restored = _readSession();
    await Future.wait<void>([
      restored.then((_) {}),
      Future<void>.delayed(SplashScreen.duration),
    ]);
    return restored;
  }

  Future<AuthSession?> _readSession() async {
    final store = AuthSessionStore();
    final cached = await store.read();
    if (cached == null) return null;

    try {
      final user = await AuthApiService().fetchCurrentUser(cached.token);
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
          return const SplashScreen();
        }

        final session = snapshot.data;
        return session == null
            ? const LoginScreen()
            : HomeScreen(session: session);
      },
    );
  }
}
