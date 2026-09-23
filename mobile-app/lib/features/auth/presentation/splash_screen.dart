import 'package:flutter/material.dart';

import '../../shared/org_branding.dart';

/// Brand splash (node 1887:27413 → 1887:27433).
///
/// Wears whichever company's mark this device last signed in to, so a Convrse
/// employee's app opens as Convrse rather than showing them somebody else's
/// brand for two seconds.
///
/// The two design states are the same screen at different points of one
/// animation: the wordmark settles first, then the tagline — which the design
/// ships at zero opacity — fades up underneath it.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key, this.branding = OrgBranding.sowaka});

  final OrgBranding branding;

  /// How long the whole entrance takes; callers hold the splash at least this
  /// long so the animation isn't cut off by a fast session restore.
  static const Duration duration = Duration(milliseconds: 1900);

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: SplashScreen.duration,
  )..forward();

  late final Animation<double> _markOpacity = CurvedAnimation(
    parent: _controller,
    curve: const Interval(0.0, 0.45, curve: Curves.easeOut),
  );

  late final Animation<double> _markScale = Tween<double>(begin: 0.86, end: 1)
      .animate(
        CurvedAnimation(
          parent: _controller,
          curve: const Interval(0.0, 0.55, curve: Curves.easeOutBack),
        ),
      );

  late final Animation<double> _taglineOpacity = CurvedAnimation(
    parent: _controller,
    curve: const Interval(0.45, 0.85, curve: Curves.easeOut),
  );

  late final Animation<double> _taglineShift = Tween<double>(begin: 12, end: 0)
      .animate(
        CurvedAnimation(
          parent: _controller,
          curve: const Interval(0.45, 0.9, curve: Curves.easeOutCubic),
        ),
      );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0571A6),
      body: Center(
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) => Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Opacity(
                opacity: _markOpacity.value,
                child: Transform.scale(
                  scale: _markScale.value,
                  child: Text(
                    widget.branding.wordmark,
                    style: const TextStyle(
                      fontFamily: 'Anton',
                      fontSize: 45,
                      color: Colors.white,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 60),
              Opacity(
                opacity: _taglineOpacity.value,
                child: Transform.translate(
                  offset: Offset(0, _taglineShift.value),
                  child: Text(
                    widget.branding.tagline,
                    style: TextStyle(
                      color: widget.branding.isSowaka
                          ? Colors.white
                          : Colors.white.withValues(alpha: 0.68),
                      fontWeight: widget.branding.isSowaka
                          ? FontWeight.w400
                          : FontWeight.w600,
                      fontSize: widget.branding.isSowaka ? 13 : 14,
                      height: 19.5 / (widget.branding.isSowaka ? 13 : 14),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
