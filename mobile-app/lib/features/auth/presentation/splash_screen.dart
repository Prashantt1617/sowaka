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
                  child: _Mark(branding: widget.branding),
                ),
              ),
              // Nothing between them: the design butts the tagline's box
              // straight against the wordmark's.
              Opacity(
                opacity: _taglineOpacity.value,
                child: Transform.translate(
                  offset: Offset(0, _taglineShift.value),
                  child: _Tagline(branding: widget.branding),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The brand's wordmark — Sowaka's, or the company's — in Anton.
class _Mark extends StatelessWidget {
  const _Mark({required this.branding});

  final OrgBranding branding;

  @override
  Widget build(BuildContext context) {
    return Text(
      branding.wordmark,
      style: const TextStyle(
        fontFamily: 'Anton',
        fontSize: 45,
        // The design's own line box: 68pt for a 45pt wordmark, which is the
        // whole gap down to the tagline.
        height: 68 / 45,
        color: Colors.white,
        letterSpacing: 0.5,
      ),
    );
  }
}

/// Sowaka's line, or — under a company's wordmark — "powered by" with
/// "sowaka" on the line below in Anton, at the tagline's own size so it sits
/// well under the company's name.
class _Tagline extends StatelessWidget {
  const _Tagline({required this.branding});

  final OrgBranding branding;

  @override
  Widget build(BuildContext context) {
    if (branding.isSowaka) {
      return Text(
        branding.tagline,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 13,
          height: 19.5 / 13,
          fontWeight: FontWeight.w400,
        ),
      );
    }
    final color = Colors.white.withValues(alpha: 0.68);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          branding.tagline,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: color,
            fontWeight: FontWeight.w600,
            fontSize: 14,
            height: 19.5 / 14,
          ),
        ),
        Text(
          'sowaka',
          textAlign: TextAlign.center,
          // The design's type spec: Anton 400, 100% line height, no tracking.
          style: TextStyle(
            fontFamily: 'Anton',
            fontWeight: FontWeight.w400,
            color: color,
            fontSize: 14,
            height: 1,
            letterSpacing: 0,
          ),
        ),
      ],
    );
  }
}
