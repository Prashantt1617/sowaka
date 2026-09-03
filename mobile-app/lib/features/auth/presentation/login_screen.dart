import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../../routes/app_routes.dart';
import '../../../services/api_config.dart';
import '../bloc/auth_bloc.dart';
import '../data/auth_api_service.dart';
import '../data/auth_models.dart';
import '../data/auth_session_store.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen>
    with TickerProviderStateMixin {
  late final AnimationController _floatController;
  late final AnimationController _blinkController;
  late final TextEditingController _emailController;
  late final List<TextEditingController> _otpControllers;
  late final List<FocusNode> _otpFocusNodes;
  late final AuthBloc _bloc;
  bool _didFocusOtp = false;
  bool _rememberMe = false;

  @override
  void initState() {
    super.initState();
    _bloc = AuthBloc();
    _emailController = TextEditingController();
    _emailController.addListener(_handleEmailChanged);
    _otpControllers = List.generate(6, (_) => TextEditingController());
    _otpFocusNodes = List.generate(6, (_) => FocusNode());
    _floatController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 3600),
    )..repeat();
    _blinkController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1100),
    )..repeat();
  }

  @override
  void dispose() {
    _bloc.dispose();
    _floatController.dispose();
    _blinkController.dispose();
    _emailController
      ..removeListener(_handleEmailChanged)
      ..dispose();
    for (final controller in _otpControllers) {
      controller.dispose();
    }
    for (final focusNode in _otpFocusNodes) {
      focusNode.dispose();
    }
    super.dispose();
  }

  void _handleEmailChanged() {
    _bloc.add(AuthEmailChanged(_emailController.text));
  }

  void _handleOtpChanged() {
    _bloc.add(
      AuthOtpChanged(
        _otpControllers.map((controller) => controller.text).join(),
      ),
    );
  }

  void _sendCode() {
    _bloc.add(const RequestAuthOtp());
  }

  void _verifyCode() {
    _bloc.add(const VerifyAuthOtp());
  }

  void _editEmail() {
    _didFocusOtp = false;
    for (final controller in _otpControllers) {
      controller.clear();
    }
    _bloc.add(const EditAuthEmail());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: StreamBuilder<AuthState>(
          stream: _bloc.stream,
          initialData: _bloc.state,
          builder: (context, snapshot) {
            final state = snapshot.data ?? _bloc.state;
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (!mounted) return;
              // Errors render inline on the form itself (nodes 1849:17319 and
              // 1849:17545) rather than as a snackbar, so nothing is surfaced
              // here beyond the success step's own handling.
              if (state.error != null && state.step == AuthStep.success) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(state.error!),
                    behavior: SnackBarBehavior.floating,
                    backgroundColor: _CxColors.ink,
                  ),
                );
                _bloc.add(const ClearAuthError());
              }
              if (state.step == AuthStep.code && !_didFocusOtp) {
                _didFocusOtp = true;
                _otpFocusNodes.first.requestFocus();
              }
            });

            return AnimatedSwitcher(
              duration: const Duration(milliseconds: 420),
              switchInCurve: Curves.easeOutCubic,
              switchOutCurve: Curves.easeInCubic,
              transitionBuilder: (child, animation) {
                final curved = CurvedAnimation(
                  parent: animation,
                  curve: Curves.easeOutCubic,
                );
                return FadeTransition(
                  opacity: curved,
                  child: SlideTransition(
                    position: Tween<Offset>(
                      begin: const Offset(0.04, 0),
                      end: Offset.zero,
                    ).animate(curved),
                    child: child,
                  ),
                );
              },
              child: switch (state.step) {
                AuthStep.email => _EmailStep(
                  key: const ValueKey('email'),
                  emailController: _emailController,
                  isEmailValid: state.isEmailValid,
                  isLoading: state.isLoading,
                  onSendCode: _sendCode,
                  rememberMe: _rememberMe,
                  onRememberMeChanged: (value) =>
                      setState(() => _rememberMe = value),
                  errorText: state.error,
                ),
                AuthStep.code => _CodeStep(
                  key: const ValueKey('code'),
                  email: state.email,
                  otpControllers: _otpControllers,
                  otpFocusNodes: _otpFocusNodes,
                  isOtpComplete: state.isOtpComplete,
                  isLoading: state.isLoading,
                  onOtpChanged: _handleOtpChanged,
                  onBack: _editEmail,
                  onVerify: _verifyCode,
                  onResend: _sendCode,
                  errorText: state.error,
                ),
                AuthStep.success => _SuccessStep(
                  key: const ValueKey('success'),
                  name: state.session?.user.name ?? 'there',
                  company: state.session?.user.company ?? 'Sowaka',
                  session: state.session,
                  onEnter: () async {
                    final session = state.session;
                    if (session == null) return;
                    await AuthSessionStore().save(session);
                    if (!context.mounted) return;
                    Navigator.of(context).pushNamedAndRemoveUntil(
                      AppRoutes.home,
                      (_) => false,
                      arguments: session,
                    );
                  },
                ),
              },
            );
          },
        ),
      ),
    );
  }
}

/// Shared chrome for the signed-out screens (nodes 1849:17178 / 1849:17502):
/// a brand band with a white sheet pulled up over it.
class _LoginShell extends StatelessWidget {
  const _LoginShell({required this.child});

  final Widget child;

  static const brand = Color(0xFF1A7FA6);

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SizedBox(
          height: 131,
          child: Stack(
            children: [
              Container(color: brand),
              Positioned(
                left: 0,
                right: 0,
                top: 91,
                child: Container(
                  height: 40,
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(28),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: Container(
            width: double.infinity,
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            child: child,
          ),
        ),
      ],
    );
  }
}

/// The rounded brand button used for "Continue" and "Verify".
class _LoginPrimaryButton extends StatelessWidget {
  const _LoginPrimaryButton({
    required this.label,
    required this.enabled,
    required this.onPressed,
    this.loading = false,
    this.trailingArrow = false,
  });

  final String label;
  final bool enabled;
  final VoidCallback? onPressed;
  final bool loading;
  final bool trailingArrow;

  @override
  Widget build(BuildContext context) {
    final active = enabled && !loading;
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Color(0x4D1A7FA6),
            blurRadius: 8,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Material(
        // #0571A6 when actionable, the muted #96B7C7 resting state otherwise.
        color: active ? const Color(0xFF0571A6) : const Color(0xFF96B7C7),
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: active ? onPressed : null,
          child: SizedBox(
            height: 54,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    height: 24 / 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (loading) ...[
                  const SizedBox(width: 8),
                  const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation(Colors.white),
                    ),
                  ),
                ] else if (trailingArrow) ...[
                  const SizedBox(width: 8),
                  SvgPicture.asset(
                    'assets/icons/login_arrow.svg',
                    width: 18,
                    height: 18,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _EmailStep extends StatelessWidget {
  const _EmailStep({
    super.key,
    required this.emailController,
    required this.isEmailValid,
    required this.isLoading,
    required this.onSendCode,
    required this.rememberMe,
    required this.onRememberMeChanged,
    this.errorText,
  });

  final TextEditingController emailController;
  final bool isEmailValid;
  final bool isLoading;
  final VoidCallback onSendCode;
  final bool rememberMe;
  final ValueChanged<bool> onRememberMeChanged;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    return _LoginShell(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            "Let's get you signed in",
            style: TextStyle(
              color: Color(0xFF222222),
              fontSize: 24,
              fontWeight: FontWeight.w600,
              letterSpacing: -0.16,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Your workplace, connected.',
            style: TextStyle(
              color: Color(0xFF717171),
              fontSize: 14,
              height: 21 / 14,
              fontWeight: FontWeight.w400,
            ),
          ),
          const SizedBox(height: 32),
          const Text(
            'Work email',
            style: TextStyle(
              color: Color(0xFF222222),
              fontSize: 13,
              height: 19.5 / 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          Container(
            height: 52,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              color: const Color(0xFFFAFAFA),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: errorText != null
                    ? const Color(0xFFE5484D)
                    : const Color(0xFFE8E8F0),
                width: 1.129,
              ),
            ),
            child: Row(
              children: [
                SvgPicture.asset(
                  'assets/icons/login_mail.svg',
                  width: 18,
                  height: 18,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: emailController,
                    keyboardType: TextInputType.emailAddress,
                    autocorrect: false,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) {
                      if (isEmailValid && !isLoading) onSendCode();
                    },
                    style: const TextStyle(
                      color: Color(0xFF222222),
                      fontSize: 15,
                      fontWeight: FontWeight.w400,
                    ),
                    decoration: const InputDecoration(
                      isCollapsed: true,
                      filled: false,
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      hintText: 'you@company.com',
                      hintStyle: TextStyle(
                        color: Color(0xFF717171),
                        fontSize: 15,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                  ),
                ),
                // Green tick once the address parses, per node 1849:17381.
                if (isEmailValid)
                  Container(
                    width: 20,
                    height: 20,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(
                      color: Color(0xFF2BB673),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.check_rounded,
                      size: 13,
                      color: Colors.white,
                    ),
                  ),
              ],
            ),
          ),
          if (errorText != null) ...[
            const SizedBox(height: 6),
            Text(
              errorText!,
              style: const TextStyle(
                color: Color(0xFFE5484D),
                fontSize: 12,
                height: 18 / 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
          const SizedBox(height: 8),
          InkWell(
            onTap: () => onRememberMeChanged(!rememberMe),
            borderRadius: BorderRadius.circular(6),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Container(
                    width: 18,
                    height: 18,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: rememberMe
                          ? const Color(0xFF0571A6)
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(2),
                      border: Border.all(
                        color: rememberMe
                            ? const Color(0xFF0571A6)
                            : const Color(0xFFDDDDDD),
                      ),
                    ),
                    child: rememberMe
                        ? const Icon(
                            Icons.check_rounded,
                            size: 13,
                            color: Colors.white,
                          )
                        : null,
                  ),
                  const SizedBox(width: 8),
                  const Text(
                    'Remember me',
                    style: TextStyle(
                      color: Color(0xFF484848),
                      fontSize: 13,
                      height: 19.5 / 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const Spacer(),
          _LoginPrimaryButton(
            label: 'Continue',
            enabled: isEmailValid,
            loading: isLoading,
            trailingArrow: true,
            onPressed: onSendCode,
          ),
        ],
      ),
    );
  }
}

class _CodeStep extends StatelessWidget {
  const _CodeStep({
    super.key,
    required this.email,
    required this.otpControllers,
    required this.otpFocusNodes,
    required this.isOtpComplete,
    required this.isLoading,
    required this.onOtpChanged,
    required this.onBack,
    required this.onVerify,
    required this.onResend,
    this.errorText,
  });

  final String email;
  final List<TextEditingController> otpControllers;
  final List<FocusNode> otpFocusNodes;
  final bool isOtpComplete;
  final bool isLoading;
  final VoidCallback onOtpChanged;
  final VoidCallback onBack;
  final VoidCallback onVerify;
  final VoidCallback onResend;
  final String? errorText;

  /// `ananya@sowaka.fit` → `an***@sowaka.fit`, matching the design.
  String get _maskedEmail {
    final at = email.indexOf('@');
    if (at <= 0) return email;
    final name = email.substring(0, at);
    final domain = email.substring(at);
    if (name.length <= 2) return '$name***$domain';
    return '${name.substring(0, 2)}***$domain';
  }

  @override
  Widget build(BuildContext context) {
    return _LoginShell(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: InkWell(
              onTap: onBack,
              borderRadius: BorderRadius.circular(8),
              child: const Padding(
                padding: EdgeInsets.symmetric(vertical: 4, horizontal: 2),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.arrow_back_rounded,
                      size: 18,
                      color: Color(0xFF717171),
                    ),
                    SizedBox(width: 6),
                    Text(
                      'Change email',
                      style: TextStyle(
                        color: Color(0xFF717171),
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          const SizedBox(
            width: double.infinity,
            child: Text(
              "We've sent a 6-digit code to",
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Color(0xFF7A7A9A),
                fontSize: 14,
                height: 21 / 14,
                fontWeight: FontWeight.w400,
              ),
            ),
          ),
          const SizedBox(height: 6),
          SizedBox(
            width: double.infinity,
            child: Text(
              _maskedEmail,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF1A1A2E),
                fontSize: 14,
                height: 21 / 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(height: 32),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(6, (index) {
              return Padding(
                padding: EdgeInsets.only(right: index == 5 ? 0 : 8),
                child: _OtpBox(
                  controller: otpControllers[index],
                  focusNode: otpFocusNodes[index],
                  hasError: errorText != null,
                  onChanged: (value) {
                    if (value.isNotEmpty && index < 5) {
                      otpFocusNodes[index + 1].requestFocus();
                    } else if (value.isEmpty && index > 0) {
                      otpFocusNodes[index - 1].requestFocus();
                    }
                    onOtpChanged();
                  },
                ),
              );
            }),
          ),
          const SizedBox(height: 20),
          if (errorText != null) ...[
            SizedBox(
              width: double.infinity,
              child: Text(
                errorText!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFFE5484D),
                  fontSize: 13,
                  height: 19.5 / 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(height: 4),
          ],
          Center(
            child: InkWell(
              onTap: isLoading ? null : onResend,
              borderRadius: BorderRadius.circular(8),
              child: const Padding(
                padding: EdgeInsets.symmetric(vertical: 2, horizontal: 6),
                child: Text(
                  'Resend Code',
                  style: TextStyle(
                    color: Color(0xFF0571A6),
                    fontSize: 13,
                    height: 19.5 / 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ),
          const Spacer(),
          _LoginPrimaryButton(
            label: isLoading ? 'Verifying' : 'Verify',
            enabled: isOtpComplete,
            loading: isLoading,
            onPressed: onVerify,
          ),
        ],
      ),
    );
  }
}

class _OtpBox extends StatelessWidget {
  const _OtpBox({
    required this.controller,
    required this.focusNode,
    required this.onChanged,
    required this.hasError,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;
  final bool hasError;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 46,
      height: 56,
      child: TextField(
        controller: controller,
        focusNode: focusNode,
        textAlign: TextAlign.center,
        keyboardType: TextInputType.number,
        maxLength: 1,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        onChanged: onChanged,
        style: const TextStyle(
          color: Color(0xFF1A1A2E),
          fontSize: 20,
          fontWeight: FontWeight.w600,
        ),
        decoration: InputDecoration(
          counterText: '',
          filled: true,
          fillColor: const Color(0xFFFAFAFA),
          contentPadding: EdgeInsets.zero,
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(
              color: hasError
                  ? const Color(0xFFE5484D)
                  : const Color(0xFFE8E8F0),
              width: 1.129,
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFF0571A6), width: 1.5),
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFE8E8F0)),
          ),
        ),
      ),
    );
  }
}

/// Post-login welcome (node 1849:17741).
class _SuccessStep extends StatefulWidget {
  const _SuccessStep({
    super.key,
    required this.name,
    required this.company,
    required this.session,
    required this.onEnter,
  });

  final String name;
  final String company;
  final AuthSession? session;
  final VoidCallback onEnter;

  @override
  State<_SuccessStep> createState() => _SuccessStepState();
}

class _SuccessStepState extends State<_SuccessStep> {
  List<AuthTeammate> _teammates = const [];
  int _total = 0;

  /// Fixed palette from the design, assigned by position.
  static const _avatarColors = [
    Color(0xFFC9A8E2),
    Color(0xFFA8C8E2),
    Color(0xFFF2B7A2),
    Color(0xFFA2E2C2),
  ];

  @override
  void initState() {
    super.initState();
    _loadTeammates();
  }

  Future<void> _loadTeammates() async {
    final token = widget.session?.token;
    if (token == null) return;
    try {
      final result = await AuthApiService().fetchTeammates(token);
      if (!mounted) return;
      setState(() {
        _teammates = result.teammates;
        _total = result.total;
      });
    } catch (_) {
      // The welcome screen still reads correctly without the team section.
    }
  }

  String get _initials {
    final parts = widget.name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final firstName = widget.name.split(' ').first;
    final strip = _teammates.take(4).toList();
    final overflow = _total - strip.length;
    return Container(
      color: Colors.white,
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          const Text(
            "You're in! 🎉",
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF1A1A2E),
              fontSize: 32,
              height: 39.1 / 32,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Welcome to ${widget.company}, $firstName.',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF7A7A9A),
              fontSize: 14,
              height: 22.5 / 14,
              fontWeight: FontWeight.w400,
            ),
          ),
          const SizedBox(height: 24),
          Container(
            width: 72,
            height: 72,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              color: Color(0xFFC9A8E2),
              shape: BoxShape.circle,
            ),
            child: Text(
              _initials,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 25.2,
                height: 37.8 / 25.2,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (strip.isNotEmpty) ...[
            const Text(
              'Meet your team',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Color(0xFF1A1A2E),
                fontSize: 15,
                height: 22.5 / 15,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 14),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 0; i < strip.length; i++) ...[
                  if (i > 0) const SizedBox(width: 8),
                  _WelcomeAvatar(
                    initials: strip[i].initials,
                    photoUrl: strip[i].photoUrl,
                    color: _avatarColors[i % _avatarColors.length],
                    size: 48,
                    fontSize: 16.8,
                  ),
                ],
                if (overflow > 0) ...[
                  const SizedBox(width: 8),
                  Container(
                    width: 48,
                    height: 48,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(
                      color: Color(0xFFE8E8F0),
                      shape: BoxShape.circle,
                    ),
                    child: Text(
                      '+$overflow',
                      style: const TextStyle(
                        color: Color(0xFF7A7A9A),
                        fontSize: 13,
                        height: 19.5 / 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 20),
            Expanded(
              child: ListView.separated(
                padding: EdgeInsets.zero,
                itemCount: strip.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (_, index) => _TeammateCard(
                  teammate: strip[index],
                  color: _avatarColors[index % _avatarColors.length],
                ),
              ),
            ),
          ] else
            const Spacer(),
          const SizedBox(height: 16),
          _LoginPrimaryButton(
            label: "Let's get started",
            enabled: true,
            trailingArrow: true,
            onPressed: widget.onEnter,
          ),
        ],
      ),
    );
  }
}

class _WelcomeAvatar extends StatelessWidget {
  const _WelcomeAvatar({
    required this.initials,
    required this.color,
    required this.size,
    required this.fontSize,
    this.photoUrl,
  });

  final String initials;
  final Color color;
  final double size;
  final double fontSize;
  final String? photoUrl;

  @override
  Widget build(BuildContext context) {
    final circle = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      child: Text(
        initials,
        style: TextStyle(
          color: Colors.white,
          fontSize: fontSize,
          height: 1.5,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
    final url = photoUrl;
    if (url == null || url.isEmpty) return circle;
    return ClipOval(
      child: SizedBox(
        width: size,
        height: size,
        child: Image(
          image: avatarImageProvider(url),
          width: size,
          height: size,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => circle,
          frameBuilder: (_, child, frame, wasSync) =>
              frame == null && !wasSync ? circle : child,
        ),
      ),
    );
  }
}

class _TeammateCard extends StatelessWidget {
  const _TeammateCard({required this.teammate, required this.color});

  final AuthTeammate teammate;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEBEBEB)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F000000),
            blurRadius: 2,
            offset: Offset(0, 1),
          ),
          BoxShadow(
            color: Color(0x0A000000),
            blurRadius: 4,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          _WelcomeAvatar(
            initials: teammate.initials,
            photoUrl: teammate.photoUrl,
            color: color,
            size: 38,
            fontSize: 13.3,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  teammate.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF1A1A2E),
                    fontSize: 14,
                    height: 21 / 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  teammate.roleLine,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF7A7A9A),
                    fontSize: 12,
                    height: 18 / 12,
                    fontWeight: FontWeight.w400,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PhoneCanvas extends StatelessWidget {
  const _PhoneCanvas({required this.child, required this.horizontalPadding});

  final Widget child;
  final double horizontalPadding;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        horizontalPadding,
        20,
        horizontalPadding,
        30,
      ),
      child: child,
    );
  }
}

class _BrandRow extends StatelessWidget {
  const _BrandRow();

  @override
  Widget build(BuildContext context) {
    return const Row(
      children: [
        _BrandLogo(size: 34, fontSize: 18),
        SizedBox(width: 10),
        Text(
          'Sowaka',
          style: TextStyle(
            color: _CxColors.ink,
            fontSize: 15.5,
            letterSpacing: -0.15,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

class _BrandLogo extends StatelessWidget {
  const _BrandLogo({required this.size, required this.fontSize});

  final double size;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: _CxColors.rust,
        boxShadow: [
          BoxShadow(
            color: _CxColors.rust.withValues(alpha: 0.4),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Center(
        child: Text(
          'S',
          style: TextStyle(
            color: Colors.white,
            fontSize: fontSize,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }
}

class _PeopleCluster extends StatelessWidget {
  const _PeopleCluster({required this.controller});

  final AnimationController controller;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, child) {
        final dy = -6 * (0.5 + 0.5 * math.sin(controller.value * math.pi * 2));
        return Padding(
          padding: const EdgeInsets.only(left: 6),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              const _Person(
                color: _CxColors.gold,
                head: 26,
                bodyWidth: 34,
                bodyHeight: 22,
              ),
              const _OverlapPerson(
                color: _CxColors.olive,
                head: 30,
                bodyWidth: 40,
                bodyHeight: 26,
              ),
              Transform.translate(
                offset: Offset(0, dy),
                child: const _OverlapPerson(
                  color: _CxColors.rust,
                  head: 36,
                  bodyWidth: 48,
                  bodyHeight: 31,
                ),
              ),
              const _OverlapPerson(
                color: _CxColors.purple,
                head: 30,
                bodyWidth: 40,
                bodyHeight: 26,
              ),
              const _OverlapPerson(
                color: _CxColors.teal,
                head: 26,
                bodyWidth: 34,
                bodyHeight: 22,
              ),
            ],
          ),
        );
      },
    );
  }
}

class _OverlapPerson extends StatelessWidget {
  const _OverlapPerson({
    required this.color,
    required this.head,
    required this.bodyWidth,
    required this.bodyHeight,
  });

  final Color color;
  final double head;
  final double bodyWidth;
  final double bodyHeight;

  @override
  Widget build(BuildContext context) {
    return Transform.translate(
      offset: const Offset(-8, 0),
      child: _Person(
        color: color,
        head: head,
        bodyWidth: bodyWidth,
        bodyHeight: bodyHeight,
      ),
    );
  }
}

class _Person extends StatelessWidget {
  const _Person({
    required this.color,
    required this.head,
    required this.bodyWidth,
    required this.bodyHeight,
  });

  final Color color;
  final double head;
  final double bodyWidth;
  final double bodyHeight;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: head,
          height: head,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: color,
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF28180C).withValues(alpha: 0.18),
                blurRadius: 8,
                offset: const Offset(0, 3),
              ),
            ],
          ),
        ),
        Transform.translate(
          offset: Offset(0, -head * 0.14),
          child: Container(
            width: bodyWidth,
            height: bodyHeight,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.vertical(
                top: Radius.circular(bodyWidth / 2),
                bottom: const Radius.circular(8),
              ),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF28180C).withValues(alpha: 0.14),
                  blurRadius: 12,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _EmailField extends StatelessWidget {
  const _EmailField({required this.controller, required this.isValid});

  final TextEditingController controller;
  final bool isValid;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isValid ? _CxColors.olive : _CxColors.line,
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF462D1C).withValues(alpha: 0.04),
            blurRadius: 2,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      child: Row(
        children: [
          const SizedBox(width: 16),
          const Icon(
            Icons.mail_outline_rounded,
            size: 20,
            color: _CxColors.rust,
          ),
          const SizedBox(width: 11),
          Expanded(
            child: TextField(
              controller: controller,
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.done,
              autocorrect: false,
              enableSuggestions: false,
              style: const TextStyle(
                color: _CxColors.ink,
                fontSize: 15.5,
                fontWeight: FontWeight.w600,
              ),
              decoration: const InputDecoration(
                hintText: 'name@company.com',
                hintStyle: TextStyle(
                  color: _CxColors.softText,
                  fontSize: 15.5,
                  fontWeight: FontWeight.w600,
                ),
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                isDense: true,
                contentPadding: EdgeInsets.symmetric(vertical: 16),
              ),
            ),
          ),
          AnimatedOpacity(
            duration: const Duration(milliseconds: 160),
            opacity: isValid ? 1 : 0,
            child: const Icon(
              Icons.check_circle_rounded,
              size: 19,
              color: _CxColors.olive,
            ),
          ),
          const SizedBox(width: 16),
        ],
      ),
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  const _PrimaryButton({
    required this.label,
    required this.onPressed,
    this.isLoading = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onPressed,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: onPressed == null
              ? _CxColors.rust.withValues(alpha: 0.45)
              : _CxColors.rust,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            if (onPressed != null)
              BoxShadow(
                color: _CxColors.rust.withValues(alpha: 0.34),
                blurRadius: 24,
                offset: const Offset(0, 12),
              ),
          ],
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (isLoading) ...[
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 10),
            ],
            Text(
              label,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 15.5,
                fontWeight: FontWeight.w700,
              ),
            ),
            if (!isLoading) ...[
              const SizedBox(width: 9),
              const Icon(
                Icons.arrow_forward_rounded,
                color: Colors.white,
                size: 19,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton({required this.icon, required this.onPressed});

  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onPressed,
      child: Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: Colors.white,
          shape: BoxShape.circle,
          border: Border.all(color: _CxColors.line),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFF462D1C).withValues(alpha: 0.05),
              blurRadius: 2,
              offset: const Offset(0, 1),
            ),
          ],
        ),
        child: Icon(icon, color: _CxColors.ink, size: 20),
      ),
    );
  }
}

class _SuccessMark extends StatelessWidget {
  const _SuccessMark({required this.controller});

  final AnimationController controller;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 170,
      height: 120,
      child: AnimatedBuilder(
        animation: controller,
        builder: (context, child) {
          double float(double phase, double amount) {
            return -amount *
                (0.5 +
                    0.5 * math.sin((controller.value + phase) * math.pi * 2));
          }

          return Stack(
            children: [
              Positioned(
                left: 20,
                top: 10 + float(0, 6),
                child: Transform.rotate(
                  angle: 0.35,
                  child: const _Confetti(
                    color: _CxColors.gold,
                    square: true,
                    size: 11,
                  ),
                ),
              ),
              Positioned(
                right: 24,
                top: 6 + float(0.2, 6),
                child: const _Confetti(color: _CxColors.olive, size: 9),
              ),
              Positioned(
                right: 14,
                bottom: 26 - float(0.45, 6),
                child: Transform.rotate(
                  angle: -0.26,
                  child: const _Confetti(
                    color: _CxColors.purple,
                    square: true,
                    size: 12,
                  ),
                ),
              ),
              Positioned(
                left: 16,
                bottom: 20 - float(0.65, 6),
                child: const _Confetti(color: _CxColors.teal, size: 9),
              ),
              Center(
                child: Container(
                  width: 90,
                  height: 90,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _CxColors.rust,
                    boxShadow: [
                      BoxShadow(
                        color: _CxColors.rust.withValues(alpha: 0.42),
                        blurRadius: 36,
                        offset: const Offset(0, 18),
                      ),
                    ],
                  ),
                  child: const Icon(
                    Icons.check_rounded,
                    color: Colors.white,
                    size: 48,
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _Confetti extends StatelessWidget {
  const _Confetti({
    required this.color,
    required this.size,
    this.square = false,
  });

  final Color color;
  final double size;
  final bool square;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color,
        shape: square ? BoxShape.rectangle : BoxShape.circle,
        borderRadius: square ? BorderRadius.circular(3) : null,
      ),
    );
  }
}

class _CompanyPill extends StatelessWidget {
  const _CompanyPill({required this.company});

  final String company;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFE9EBE0),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.apartment_rounded,
            size: 15,
            color: Color(0xFF4C5840),
          ),
          const SizedBox(width: 7),
          Text(
            company,
            style: const TextStyle(
              color: Color(0xFF4C5840),
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _AvatarStack extends StatelessWidget {
  const _AvatarStack();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 34,
      width: 106,
      child: Stack(
        children: const [
          Positioned(
            left: 0,
            child: _Avatar(label: 'R', color: _CxColors.rust),
          ),
          Positioned(
            left: 24,
            child: _Avatar(label: 'M', color: _CxColors.olive),
          ),
          Positioned(
            left: 48,
            child: _Avatar(label: 'K', color: _CxColors.purple),
          ),
          Positioned(
            left: 72,
            child: _Avatar(label: '+245', color: _CxColors.line, dark: true),
          ),
        ],
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.label, required this.color, this.dark = false});

  final String label;
  final Color color;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color,
        border: Border.all(color: _CxColors.paper, width: 2.5),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: dark ? _CxColors.muted : Colors.white,
          fontSize: dark ? 12 : 14,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _CxColors {
  static const paper = Color(0xFFF6F2EC);
  static const ink = Color(0xFF2A2420);
  static const muted = Color(0xFF6E655C);
  static const softText = Color(0xFFA79D92);
  static const line = Color(0xFFEAE3D9);
  static const rust = Color(0xFFBE5A36);
  static const gold = Color(0xFFC98A2E);
  static const olive = Color(0xFF7E8B6E);
  static const purple = Color(0xFF8A6AA0);
  static const teal = Color(0xFF4F8C89);
}
