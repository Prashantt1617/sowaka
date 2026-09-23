import 'package:flutter/material.dart';

import '../../auth/data/auth_models.dart';
import '../../auth/data/auth_session_store.dart';
import '../../auth/presentation/login_screen.dart';
import '../../manager/data/manager_api_service.dart';
import '../../manager/presentation/manager_screen.dart';
import '../../onboarding/presentation/onboarding_flow.dart';
import '../../shared/app_icon.dart';
import '../../shared/org_branding.dart';

/// Where a signed-in person lands, and the one place that decides whether
/// they are new here.
///
/// Someone who has never added a profile photo is taken through onboarding
/// first; everyone else goes straight in. This is also where the app takes on
/// the company's brand — the splash on the next launch, and the icon on the
/// home screen.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, this.session});

  final AuthSession? session;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  AuthSession? _session;
  bool _onboarding = false;
  bool _branded = false;

  /// Onboarded in this run, so the punch screen stays away until next launch.
  bool _justOnboarded = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_session != null) return;
    final session = widget.session ?? ModalRoute.of(context)?.settings.arguments;
    if (session is! AuthSession) return;
    _session = session;
    // A photo is what onboarding is gated on: it is the one thing on those
    // screens the rest of the app can see afterwards.
    _onboarding = (session.user.profilePhotoUrl ?? '').isEmpty;
    _applyBranding(session);
  }

  Future<void> _applyBranding(AuthSession session) async {
    if (_branded) return;
    _branded = true;
    final branding = OrgBranding.of(session.user.org);
    await OrgBranding.remember(session.user.org);
    await AppIcon.use(branding.iosIconName);
  }

  Future<void> _finishOnboarding(String photoUrl, List<String> interests) async {
    final session = _session;
    if (session == null) return;
    final updated = AuthSession(
      token: session.token,
      user: session.user.copyWith(
        profilePhotoUrl: photoUrl.isEmpty ? null : photoUrl,
        interests: interests,
      ),
    );
    await AuthSessionStore().save(updated);
    if (!mounted) return;
    setState(() {
      _session = updated;
      _onboarding = false;
      _justOnboarded = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    final session = _session;
    if (session == null) return const LoginScreen();
    if (_onboarding) {
      return OnboardingFlow(
        session: session,
        api: ManagerApiService(session: session),
        onDone: _finishOnboarding,
      );
    }
    return ManagerScreen(
      session: session,
      justOnboarded: _justOnboarded,
    );
  }
}
