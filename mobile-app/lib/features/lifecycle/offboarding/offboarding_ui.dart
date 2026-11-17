/// The pieces every offboarding screen is drawn from (canvas Y1R §7 and the
/// Kit, 6Zs §8): Sora, the Connect app's brand blue, white cards on the grey
/// page, amber for "With HR" and "Held", and nothing that celebrates.
library;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'offboarding_dates.dart';

abstract final class OffColors {
  static const brand = Color(0xFF0571A6);
  static const brandPressed = Color(0xFF045A85);
  static const tint = Color(0xFFEAF3F8);
  static const ink = Color(0xFF222222);
  static const secondary = Color(0xFF484848);
  static const tertiary = Color(0xFF717171);
  static const page = Color(0xFFF7F7F9);
  static const inset = Color(0xFFEFEFF2);
  static const line = Color(0xFFEBEBEB);
  static const ring = Color(0xFFC9CDD3);
  static const track = Color(0xFFE3E5E9);
  static const amber = Color(0xFF8A5300);
  static const amberTint = Color(0xFFFFF4E0);
  static const green = Color(0xFF1E8E3E);
  static const greenTint = Color(0xFFEAFFE6);
  static const red = Color(0xFFD93036);
}

TextStyle offText(
  double size, {
  FontWeight weight = FontWeight.w400,
  Color color = OffColors.ink,
  double? height,
  double spacing = 0,
}) => TextStyle(
  fontFamily: 'Sora',
  fontSize: size,
  fontWeight: weight,
  color: color,
  height: height == null ? null : height / size,
  letterSpacing: spacing,
);

/// A page of its own: the shell's header when the caller passes one, the
/// round Back (or Close) and the title, the content, an optional button
/// pinned at the bottom, and the shell's tabs when passed.
class OffScaffold extends StatelessWidget {
  const OffScaffold({
    super.key,
    required this.title,
    required this.children,
    this.close = false,
    this.header,
    this.bottomNav,
    this.bottom,
    this.onBack,
    this.onRefresh,
  });

  final String title;
  final List<Widget> children;
  final bool close;
  final Widget? header;
  final Widget? bottomNav;

  /// A pull to refresh over the scrolling content.
  final Future<void> Function()? onRefresh;

  /// Pinned under the scrolling content (the one primary button).
  final Widget? bottom;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: OffColors.page,
    body: Column(
      children: [
        if (header case final header?)
          header
        else
          const SafeArea(bottom: false, child: SizedBox.shrink()),
        OffTopBar(title: title, close: close, onBack: onBack),
        Expanded(
          child: switch (onRefresh) {
            final refresh? => RefreshIndicator(
              onRefresh: refresh,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
                children: children,
              ),
            ),
            null => ListView(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
              children: children,
            ),
          },
        ),
        if (bottom case final bottom?)
          SafeArea(
            top: false,
            bottom: bottomNav == null,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: bottom,
            ),
          ),
        ?bottomNav,
      ],
    ),
  );
}

/// The round white Back / Close and the page title, centred.
class OffTopBar extends StatelessWidget {
  const OffTopBar({
    super.key,
    required this.title,
    this.close = false,
    this.onBack,
  });

  final String title;
  final bool close;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(16),
    child: Row(
      children: [
        Semantics(
          button: true,
          label: close ? 'Close' : 'Back',
          child: Material(
            color: Colors.white,
            shape: const CircleBorder(side: BorderSide(color: OffColors.line)),
            child: InkWell(
              key: ValueKey(close ? 'off-close' : 'off-back'),
              customBorder: const CircleBorder(),
              onTap: onBack ?? () => Navigator.of(context).maybePop(),
              child: SizedBox(
                width: 40,
                height: 40,
                child: Center(
                  child: close
                      ? const Icon(
                          Icons.close_rounded,
                          size: 20,
                          color: OffColors.ink,
                        )
                      : SvgPicture.asset(
                          'assets/icons/chevron_back.svg',
                          width: 20,
                          height: 20,
                        ),
                ),
              ),
            ),
          ),
        ),
        Expanded(
          child: Text(
            title,
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: offText(17, weight: FontWeight.w600, height: 24),
          ),
        ),
        const SizedBox(width: 40),
      ],
    ),
  );
}

class OffCard extends StatelessWidget {
  const OffCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.color = Colors.white,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: padding,
    decoration: BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(16),
      boxShadow: color == Colors.white
          ? const [
              BoxShadow(
                color: Color(0x0F111827),
                blurRadius: 3,
                offset: Offset(0, 1),
              ),
            ]
          : null,
    ),
    child: child,
  );
}

/// "WHERE IT STANDS": 11/600 caps.
class OffOverline extends StatelessWidget {
  const OffOverline(this.text, {super.key, this.color = OffColors.tertiary});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Text(
    text.toUpperCase(),
    style: offText(11, weight: FontWeight.w600, color: color, spacing: .6),
  );
}

/// A section heading on the page ("Before you go", "Coming up").
class OffHeading extends StatelessWidget {
  const OffHeading(this.text, {super.key, this.trailing});

  final String text;
  final String? trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 20, bottom: 10),
    child: Row(
      children: [
        Expanded(
          child: Text(text, style: offText(16, weight: FontWeight.w600)),
        ),
        if (trailing case final value?)
          Text(value, style: offText(12, color: OffColors.tertiary)),
      ],
    ),
  );
}

enum OffTone { amber, green, blue, grey }

/// A status in words, never by colour alone: "With HR", "Held", "To do".
class OffStatusPill extends StatelessWidget {
  const OffStatusPill(this.label, {super.key, this.tone = OffTone.amber});

  final String label;
  final OffTone tone;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = switch (tone) {
      OffTone.amber => (OffColors.amber, OffColors.amberTint),
      OffTone.green => (OffColors.green, OffColors.greenTint),
      OffTone.blue => (OffColors.brand, OffColors.tint),
      OffTone.grey => (OffColors.secondary, OffColors.inset),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: fg, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(
            label,
            style: offText(11, weight: FontWeight.w600, color: fg),
          ),
        ],
      ),
    );
  }
}

/// The lock and a line saying who can see this.
class OffPrivacyLine extends StatelessWidget {
  const OffPrivacyLine(
    this.text, {
    super.key,
    this.icon = Icons.lock_outline_rounded,
  });

  final String text;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 12),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 1),
          child: Icon(icon, size: 14, color: OffColors.tertiary),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            text,
            style: offText(12, color: OffColors.secondary, height: 17),
          ),
        ),
      ],
    ),
  );
}

class OffPrimaryButton extends StatelessWidget {
  const OffPrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 56,
    width: double.infinity,
    child: FilledButton(
      onPressed: busy ? null : onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: OffColors.brand,
        disabledBackgroundColor: OffColors.brand.withValues(alpha: .4),
        foregroundColor: Colors.white,
        disabledForegroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      child: busy
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2.2,
                color: Colors.white,
              ),
            )
          : Text(
              label,
              style: offText(15, weight: FontWeight.w600, color: Colors.white),
            ),
    ),
  );
}

class OffOutlineButton extends StatelessWidget {
  const OffOutlineButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 56,
    width: double.infinity,
    child: OutlinedButton(
      onPressed: busy ? null : onPressed,
      style: OutlinedButton.styleFrom(
        backgroundColor: Colors.white,
        foregroundColor: OffColors.brand,
        side: const BorderSide(color: OffColors.brand),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      child: busy
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2.2,
                color: OffColors.brand,
              ),
            )
          : Text(
              label,
              style: offText(
                15,
                weight: FontWeight.w600,
                color: OffColors.brand,
              ),
            ),
    ),
  );
}

/// Initials on a soft blue disc: people show initials here.
class OffAvatar extends StatelessWidget {
  const OffAvatar(this.initials, {super.key, this.size = 40});

  final String initials;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: const BoxDecoration(
      color: Color(0xFFDCE9F1),
      shape: BoxShape.circle,
    ),
    child: Text(
      initials,
      style: offText(
        size * .36,
        weight: FontWeight.w600,
        color: OffColors.brand,
      ),
    ),
  );
}

/// Label / value lines ("Sent on · Sun, 1 Nov 2026").
class OffDetailRows extends StatelessWidget {
  const OffDetailRows(this.rows, {super.key});

  final List<(String, String)> rows;

  @override
  Widget build(BuildContext context) => OffCard(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
    child: Column(
      children: [
        for (final (index, (label, value)) in rows.indexed)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 11),
            decoration: index == 0
                ? null
                : const BoxDecoration(
                    border: Border(top: BorderSide(color: Color(0xFFF1F1F4))),
                  ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    label,
                    style: offText(13, color: OffColors.secondary, height: 18),
                  ),
                ),
                const SizedBox(width: 12),
                Flexible(
                  child: Text(
                    value,
                    textAlign: TextAlign.right,
                    style: offText(13, weight: FontWeight.w600, height: 18),
                  ),
                ),
              ],
            ),
          ),
      ],
    ),
  );
}

enum OffStepState { done, current, todo }

class OffStep {
  const OffStep(this.label, this.state, {this.sub});

  final String label;
  final String? sub;
  final OffStepState state;
}

/// The notice stepper: 18 px nodes with their dates, the line filled up to
/// the current one.
class OffStepper extends StatelessWidget {
  const OffStepper(this.steps, {super.key});

  final List<OffStep> steps;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      for (final (index, step) in steps.indexed)
        Expanded(
          child: Column(
            children: [
              SizedBox(
                height: 18,
                child: Row(
                  children: [
                    Expanded(
                      child: index == 0
                          ? const SizedBox.shrink()
                          : Container(
                              height: 2,
                              color: step.state == OffStepState.todo
                                  ? OffColors.track
                                  : OffColors.brand,
                            ),
                    ),
                    _StepNode(step.state),
                    Expanded(
                      child: index == steps.length - 1
                          ? const SizedBox.shrink()
                          : Container(
                              height: 2,
                              color: steps[index + 1].state == OffStepState.todo
                                  ? OffColors.track
                                  : OffColors.brand,
                            ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Text(
                step.label,
                textAlign: TextAlign.center,
                style: offText(
                  12,
                  weight: step.state == OffStepState.current
                      ? FontWeight.w700
                      : FontWeight.w500,
                  color: step.state == OffStepState.todo
                      ? OffColors.tertiary
                      : OffColors.ink,
                  height: 16,
                ),
              ),
              if (step.sub case final sub?)
                Text(
                  sub,
                  textAlign: TextAlign.center,
                  style: offText(11, color: OffColors.tertiary, height: 15),
                ),
            ],
          ),
        ),
    ],
  );
}

class _StepNode extends StatelessWidget {
  const _StepNode(this.state);

  final OffStepState state;

  @override
  Widget build(BuildContext context) => switch (state) {
    OffStepState.done => Container(
      width: 18,
      height: 18,
      decoration: const BoxDecoration(
        color: OffColors.brand,
        shape: BoxShape.circle,
      ),
      child: const Icon(Icons.check_rounded, size: 12, color: Colors.white),
    ),
    OffStepState.current => Container(
      width: 18,
      height: 18,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        border: Border.all(color: OffColors.brand, width: 2),
      ),
      child: Container(
        width: 6,
        height: 6,
        decoration: const BoxDecoration(
          color: OffColors.brand,
          shape: BoxShape.circle,
        ),
      ),
    ),
    OffStepState.todo => Container(
      width: 18,
      height: 18,
      decoration: BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        border: Border.all(color: OffColors.ring, width: 2),
      ),
    ),
  };
}

/// "ON NOTICE · ACCEPTED 4 NOV · 17 days to go · Last day: Thu, 31 Dec",
/// with how far through the notice today is.
class OffNoticeCard extends StatelessWidget {
  const OffNoticeCard({
    super.key,
    required this.lastDay,
    this.acceptedAt,
    this.noticeFrom,
    this.daysLeft,
    this.footer,
    this.today,
  });

  final DateTime? lastDay;
  final DateTime? acceptedAt;
  final DateTime? noticeFrom;
  final int? daysLeft;
  final String? footer;

  /// Today, for tests; the clock's otherwise.
  final DateTime? today;

  @override
  Widget build(BuildContext context) {
    final now = dayOnly(today ?? DateTime.now());
    final last = lastDay;
    final left = daysLeft ?? (last == null ? null : daysBetween(now, last));
    final overline = acceptedAt == null
        ? 'On notice'
        : 'On notice · accepted ${shortDay(acceptedAt!)}';
    return OffCard(
      key: const ValueKey('off-notice-card'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: OffOverline(overline)),
              if (left != null)
                Text(
                  daysToGoLabel(left),
                  style: offText(
                    12,
                    weight: FontWeight.w600,
                    color: OffColors.brand,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            last == null
                ? 'Last day to be confirmed'
                : 'Last day: ${weekdayDay(last)}',
            style: offText(18, weight: FontWeight.w700, height: 24),
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: noticeProgress(noticeFrom ?? acceptedAt, last, now),
              minHeight: 6,
              color: OffColors.brand,
              backgroundColor: OffColors.inset,
            ),
          ),
          if (footer case final text?) ...[
            const SizedBox(height: 10),
            Text(text, style: offText(12, color: OffColors.secondary)),
          ],
        ],
      ),
    );
  }
}

/// A light-blue icon tile, the title and its line, and what stands on the
/// right: a status, a ring, a chevron.
class OffTaskRow extends StatelessWidget {
  const OffTaskRow({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(16),
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: OffColors.tint,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 18, color: OffColors.brand),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: offText(14, weight: FontWeight.w600, height: 20),
                ),
                if (subtitle case final text?)
                  Text(
                    text,
                    style: offText(12, color: OffColors.secondary, height: 16),
                  ),
              ],
            ),
          ),
          if (trailing case final widget?) ...[
            const SizedBox(width: 8),
            widget,
          ],
          if (onTap != null) ...[
            const SizedBox(width: 4),
            const Icon(
              Icons.chevron_right_rounded,
              size: 20,
              color: Color(0xFF9CA3AF),
            ),
          ],
        ],
      ),
    ),
  );
}

/// The 22 px completion ring: empty while to do, filled when done.
class OffRing extends StatelessWidget {
  const OffRing({super.key, required this.done});

  final bool done;

  @override
  Widget build(BuildContext context) => Semantics(
    label: done ? 'Done' : 'To do',
    child: Container(
      width: 22,
      height: 22,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: done ? OffColors.brand : Colors.white,
        border: Border.all(color: OffColors.brand, width: 2),
      ),
      child: done
          ? const Icon(Icons.check_rounded, size: 14, color: Colors.white)
          : null,
    ),
  );
}

/// A centred spinner, or what went wrong and Try again.
class OffLoadState extends StatelessWidget {
  const OffLoadState({super.key, this.error, this.onRetry});

  final String? error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 40),
    child: Center(
      child: error == null
          ? const SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(
                strokeWidth: 2.4,
                color: OffColors.brand,
              ),
            )
          : Column(
              children: [
                Text(
                  error!,
                  textAlign: TextAlign.center,
                  style: offText(13, color: OffColors.secondary),
                ),
                if (onRetry != null)
                  TextButton(
                    onPressed: onRetry,
                    child: Text(
                      'Try again',
                      style: offText(
                        13,
                        weight: FontWeight.w600,
                        color: OffColors.brand,
                      ),
                    ),
                  ),
              ],
            ),
    ),
  );
}

/// The grab handle at the top of a bottom sheet.
class OffSheetHandle extends StatelessWidget {
  const OffSheetHandle({super.key});

  @override
  Widget build(BuildContext context) => Center(
    child: Container(
      width: 40,
      height: 4,
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: OffColors.ring,
        borderRadius: BorderRadius.circular(2),
      ),
    ),
  );
}

/// Opens a bottom sheet in the offboarding style: white, 24 radius on top,
/// the dim scrim.
Future<T?> showOffSheet<T>(BuildContext context, WidgetBuilder builder) =>
    showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      barrierColor: const Color(0x73111827),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
            child: builder(context),
          ),
        ),
      ),
    );

/// Asks a yes-or-no in a sheet; true on yes.
Future<bool> confirmOff(
  BuildContext context, {
  required String title,
  required String body,
  required String yes,
  required String no,
}) async =>
    await showOffSheet<bool>(
      context,
      (context) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const OffSheetHandle(),
          Text(title, style: offText(18, weight: FontWeight.w700, height: 24)),
          const SizedBox(height: 8),
          Text(
            body,
            style: offText(14, color: OffColors.secondary, height: 20),
          ),
          const SizedBox(height: 20),
          OffPrimaryButton(
            key: const ValueKey('off-confirm-yes'),
            label: yes,
            onPressed: () => Navigator.of(context).pop(true),
          ),
          const SizedBox(height: 10),
          OffOutlineButton(
            key: const ValueKey('off-confirm-no'),
            label: no,
            onPressed: () => Navigator.of(context).pop(false),
          ),
        ],
      ),
    ) ==
    true;
