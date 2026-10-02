import 'dart:typed_data';

import 'package:flutter/material.dart';

/// The look Care and Help share: the handoff's sizes and card colours, set in
/// the app's font, on the app's own background, with the app's blue on every
/// button, link, selected state and accent.
class CareColors {
  /// The app's background, the same on every tab.
  static const bg = Color(0xFFF7F7F9);
  static const paper = Colors.white;
  static const ink = Color(0xFF293B32);
  static const muted = Color(0xFF656D62);
  static const line = Color(0xFFE1E3D9);
  static const sage = Color(0xFFE7EDDF);
  static const peach = Color(0xFFF5E5D6);
  static const lilac = Color(0xFFEDE9F2);
  static const night = Color(0xFFE5E7EC);
  static const sky = Color(0xFFE4EDEF);
  static const clay = Color(0xFF9A5938);
  static const blue = Color(0xFF0571A6);
  static const blueTint = Color(0xFFE3F0F7);

  /// The Move and Breathe screens' warmer paper, from the site.
  static const sand = Color(0xFFFFFCF7);
  static const sandLine = Color(0xFFEFE7DA);
  static const warmInk = Color(0xFF2A2420);
  static const warmMuted = Color(0xFF766B5F);
  static const warmFaint = Color(0xFFB0A493);
}

/// The app's own font, so the two tabs read as part of the same house.
const careFont = 'Plus Jakarta Sans';

class CareEyebrow extends StatelessWidget {
  const CareEyebrow(this.text, {super.key, this.color = CareColors.blue});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Text(
    text.toUpperCase(),
    style: TextStyle(
      fontFamily: careFont,
      color: color,
      fontSize: 11,
      fontWeight: FontWeight.w700,
      letterSpacing: 2,
    ),
  );
}

class CareHeading extends StatelessWidget {
  const CareHeading(
    this.text, {
    super.key,
    this.size = 32,
    this.color = CareColors.ink,
    this.align = TextAlign.start,
  });

  final String text;
  final double size;
  final Color color;
  final TextAlign align;

  @override
  Widget build(BuildContext context) => Text(
    text,
    textAlign: align,
    style: TextStyle(
      fontFamily: careFont,
      color: color,
      fontSize: size,
      fontWeight: FontWeight.w700,
      height: 1.1,
      letterSpacing: -0.6,
    ),
  );
}

class CareCopy extends StatelessWidget {
  const CareCopy(
    this.text, {
    super.key,
    this.size = 13,
    this.color = CareColors.muted,
    this.align = TextAlign.start,
  });

  final String text;
  final double size;
  final Color color;
  final TextAlign align;

  @override
  Widget build(BuildContext context) => Text(
    text,
    textAlign: align,
    style: TextStyle(
      fontFamily: careFont,
      color: color,
      fontSize: size,
      height: 1.6,
    ),
  );
}

/// "← Care": the in-page back the handoff uses instead of a bar.
class CareBackLink extends StatelessWidget {
  const CareBackLink(
    this.label, {
    super.key,
    required this.onTap,
    this.color = CareColors.muted,
  });

  final String label;
  final VoidCallback onTap;

  /// Muted on the light pages; lighter over a photo.
  final Color color;

  @override
  Widget build(BuildContext context) {
    // The web pages draw no back of their own; the app's bar is the way out.
    if (careWebPages) return const SizedBox.shrink();
    return Align(
      alignment: Alignment.centerLeft,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.arrow_back_rounded, size: 16, color: color),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontFamily: careFont,
                  color: color,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The handoff's primary action: full width, blue, rounded.
class CarePrimaryButton extends StatelessWidget {
  const CarePrimaryButton(
    this.label, {
    super.key,
    this.onTap,
    this.icon,
    this.pill = false,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onTap;
  final IconData? icon;

  /// The site's fully round CTA, on Move and Breathe.
  final bool pill;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null && !busy;
    return Opacity(
      opacity: enabled ? 1 : 0.45,
      child: Material(
        color: CareColors.blue,
        borderRadius: BorderRadius.circular(pill ? 100 : 14),
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(pill ? 100 : 14),
          child: Container(
            constraints: BoxConstraints(minHeight: pill ? 54 : 46),
            padding: EdgeInsets.symmetric(
              horizontal: 16,
              vertical: pill ? 15 : 12,
            ),
            alignment: Alignment.center,
            child: busy
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      color: Colors.white,
                      strokeWidth: 2.2,
                    ),
                  )
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Flexible(
                        child: Text(
                          label,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontFamily: careFont,
                            color: Colors.white,
                            fontSize: pill ? 15.5 : 13.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      if (icon != null) ...[
                        const SizedBox(width: 8),
                        Icon(icon, size: 17, color: Colors.white),
                      ],
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

/// A quiet text action in the app's blue.
class CareLink extends StatelessWidget {
  const CareLink(
    this.label, {
    super.key,
    required this.onTap,
    this.icon = Icons.arrow_forward_rounded,
    this.size = 13,
  });

  final String label;
  final VoidCallback onTap;
  final IconData? icon;
  final double size;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(8),
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: Text(
              label,
              style: TextStyle(
                fontFamily: careFont,
                color: CareColors.blue,
                fontSize: size,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          if (icon != null) ...[
            const SizedBox(width: 5),
            Icon(icon, size: size + 3, color: CareColors.blue),
          ],
        ],
      ),
    ),
  );
}

/// A white card with the app's shadow, as the app draws cards today.
class CareCard extends StatelessWidget {
  const CareCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.color = Colors.white,
    this.onTap,
    this.radius = 22,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color color;
  final VoidCallback? onTap;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final body = Container(
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: const Color(0xFFECEFF3)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14141E28),
            blurRadius: 24,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(radius),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(radius),
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
    return body;
  }
}

/// The handoff's choice chip: a pill with a border, blue when chosen.
class CareChoiceChip extends StatelessWidget {
  const CareChoiceChip(
    this.label, {
    super.key,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: selected ? CareColors.blue : CareColors.paper,
    borderRadius: BorderRadius.circular(100),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(100),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(100),
          border: Border.all(
            color: selected ? CareColors.blue : CareColors.line,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontFamily: careFont,
            color: selected ? Colors.white : CareColors.ink,
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    ),
  );
}

/// A row on a shelf: an icon tile, a title, a line of meta, a chevron.
class CareResourceRow extends StatelessWidget {
  const CareResourceRow({
    super.key,
    required this.title,
    required this.meta,
    required this.icon,
    required this.onTap,
    this.tint = CareColors.lilac,
  });

  final String title;
  final String meta;
  final IconData icon;
  final VoidCallback onTap;
  final Color tint;

  @override
  Widget build(BuildContext context) => Material(
    color: CareColors.paper,
    borderRadius: BorderRadius.circular(16),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: CareColors.line),
        ),
        child: Row(
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: tint,
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(icon, color: CareColors.blue, size: 21),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontFamily: careFont,
                      color: CareColors.ink,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      height: 1.25,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    meta,
                    style: const TextStyle(
                      fontFamily: careFont,
                      color: CareColors.muted,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: CareColors.muted),
          ],
        ),
      ),
    ),
  );
}

class CareSectionTitle extends StatelessWidget {
  const CareSectionTitle(this.text, {super.key, this.size = 18});

  final String text;
  final double size;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: TextStyle(
      fontFamily: careFont,
      color: CareColors.ink,
      fontSize: size,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.3,
    ),
  );
}

/// True only in the web build of the Care pages. The app leaves it false,
/// so nothing about its own screens changes.
bool careWebPages = false;

/// On a web page the app shows right up to the top of the screen (Sleep), the
/// height of the phone's status bar, so the words start below it.
double careTopInset = 0;

/// The life wheel's sounds on the web: woken by the first touch (a phone
/// allows sound only from one), a soft tick as a peg passes the arrow, and a
/// gentle chime where it stops. The web build sets them; elsewhere the wheel
/// turns quietly.
void Function()? careWheelWake;
void Function(double strength)? careWheelTick;
void Function()? careWheelChime;

/// Shares a picture (a PNG) through the phone's own share sheet. The web
/// build sets it; it answers false where a picture cannot be shared, and the
/// caller offers the words instead.
Future<bool> Function(Uint8List png, String fileName, String title)?
careShareImage;

/// Plays the ping at the end of a hold done with the eyes closed. The web
/// build sets it; elsewhere a hold ends without a sound.
void Function()? careHoldPing;

/// A scrolling page on the Care background, with the in-page back link.
class CarePage extends StatelessWidget {
  const CarePage({
    super.key,
    required this.children,
    this.backLabel,
    this.onBack,
    this.background = CareColors.bg,
    this.padding = const EdgeInsets.fromLTRB(20, 8, 20, 32),
    this.footer,
  });

  final List<Widget> children;
  final String? backLabel;
  final VoidCallback? onBack;
  final Color background;
  final EdgeInsetsGeometry padding;

  /// Held at the bottom of the screen, under the page as it scrolls.
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final back = backLabel;
    // The web pages draw no back of their own: inside the app its bar
    // returns to Care, and in a browser the browser's back does.
    final hideBack = careWebPages;
    // Inside a full-screen page (Sleep), start below the status bar and the
    // app's floating arrow.
    final under = careWebPages && careTopInset > 0;
    return Scaffold(
      backgroundColor: background,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: under
                    ? padding.add(EdgeInsets.only(top: careTopInset + 52))
                    : padding,
                children: [
                  if (back != null && !hideBack) ...[
                    CareBackLink(
                      back,
                      onTap: onBack ?? () => Navigator.of(context).maybePop(),
                    ),
                    const SizedBox(height: 14),
                  ],
                  ...children,
                ],
              ),
            ),
            ?footer,
          ],
        ),
      ),
    );
  }
}

/// A plain line in the muted colour, for the small print under things.
class CareMicro extends StatelessWidget {
  const CareMicro(this.text, {super.key, this.align = TextAlign.start});

  final String text;
  final TextAlign align;

  @override
  Widget build(BuildContext context) => Text(
    text,
    textAlign: align,
    style: const TextStyle(
      fontFamily: careFont,
      color: CareColors.muted,
      fontSize: 11.5,
      height: 1.5,
    ),
  );
}

/// A message box when something could not load, with an optional retry.
class CareNotice extends StatelessWidget {
  const CareNotice(this.text, {super.key, this.onRetry});

  final String text;
  final Future<void> Function()? onRetry;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    decoration: BoxDecoration(
      color: CareColors.paper,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: CareColors.line),
    ),
    child: Row(
      children: [
        Expanded(child: CareCopy(text, size: 13.5)),
        if (onRetry != null)
          TextButton(
            onPressed: onRetry,
            child: const Text(
              'Retry',
              style: TextStyle(
                color: CareColors.blue,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
      ],
    ),
  );
}

class CareSpinner extends StatelessWidget {
  const CareSpinner({super.key});

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 40),
    child: Center(child: CircularProgressIndicator(color: CareColors.blue)),
  );
}
