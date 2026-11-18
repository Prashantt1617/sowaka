import 'dart:io' show Platform;

import 'package:flutter/material.dart';

import '../../../../services/api_config.dart';
import '../../../manager/data/manager_models.dart';
import '../../../manager_shell/presentation/app_bottom_nav.dart';
import '../../../manager_shell/presentation/app_home_header.dart';
import '../../../manager_shell/presentation/tablet_shell.dart' show isTabletLayout;
import '../../../support/presentation/support_ui.dart' show SupportBackButton;
import '../data/onboarding_api.dart';

/// The onboarding screens' pieces, on the app's own design system: the
/// theme's font (Plus Jakarta Sans, [sowakaTheme] in main.dart, which every
/// style here inherits), colours taken from the palette the older app screens
/// already use, white cards on the #F7F7F9 screen, one 56 px primary button
/// pinned at the bottom, story bars on reels.

/// Each value is one the app already uses (main.dart's theme, or two or more of
/// the older feature screens); none is the kit's own.
abstract final class OnbColors {
  static const primary = Color(0xFF0571A6);
  static const primaryPressed = Color(0xFF075985);
  static const brandBorder = Color(0xFFC3EBFE);
  static const tint = Color(0xFFE8F3FA);
  static const text = Color(0xFF222222);
  static const text2 = Color(0xFF484848);
  static const text3 = Color(0xFF717171);
  static const icon = Color(0xFF9197A2);
  static const screen = Color(0xFFF7F7F9);
  static const line = Color(0xFFEBEBEB);
  static const lineDark = Color(0xFFDDDDDD);
  static const green = Color(0xFF34C759);
  static const doneTint = Color(0xFFE7F8EC);
  static const doneText = Color(0xFF16A34A);
  static const waterTint = Color(0xFFFFF5DC);
  static const waterText = Color(0xFF8A6218);
  static const mustTint = Color(0xFFFFF5DC);
  static const mustText = Color(0xFFB23500);
  static const redTint = Color(0xFFFDECEC);
  static const redText = Color(0xFFE5484D);
  static const quiet = Color(0xFFF1F1F4);
  static const divider = Color(0xFFF3F4F6);
  static const scrim = Color(0x73111827);
}

/// No family on any of these: they take the theme's (Plus Jakarta Sans) from
/// the text around them. A button, which sets its own text style, gets the
/// theme's through [button].
abstract final class OnbText {
  static TextStyle displayXl([double size = 44, Color color = OnbColors.text]) => TextStyle(
    fontSize: size,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.03 * size,
    height: 1.05,
    color: color,
  );

  static const display = TextStyle(fontSize: 24, fontWeight: FontWeight.w600, height: 1.25, color: OnbColors.text);
  static const h1 = TextStyle(fontSize: 20, fontWeight: FontWeight.w600, height: 1.3, color: OnbColors.text);
  static const screenTitle = TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: OnbColors.text);
  static const bodyStrong = TextStyle(fontSize: 14, fontWeight: FontWeight.w600, height: 1.4, color: OnbColors.text);
  static const body = TextStyle(fontSize: 14, fontWeight: FontWeight.w400, height: 1.45, color: OnbColors.text2);
  static const label = TextStyle(fontSize: 12, fontWeight: FontWeight.w400, height: 1.35, color: OnbColors.text3);
  static const eyebrow = TextStyle(
    fontSize: 11,
    fontWeight: FontWeight.w600,
    letterSpacing: 1.1,
    color: OnbColors.text3,
  );
  static const link = TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: OnbColors.primary);

  /// A button's words: the theme's label style (its font), at the kit's size.
  static TextStyle? button(BuildContext context, {double size = 15, FontWeight weight = FontWeight.w600}) =>
      Theme.of(context).textTheme.labelLarge?.copyWith(fontSize: size, fontWeight: weight);
}

// ─── The app around the screens ─────────────────────────────────────────────

/// What every onboarding screen needs from the app around it: the API, the
/// header's avatar and bell, the tabs under the page, and the doors into the
/// rest of the app (the face setup, a profile photo, a Connect post).
class OnboardingShell {
  OnboardingShell({
    required this.api,
    required this.profileAction,
    required this.onNotifications,
    this.tabs = const [],
    this.selectedTab,
    this.onSelectTab,
    this.registerFace,
    this.changePhoto,
    this.openPost,
    this.viewerName = '',
    this.viewerDesignation,
    this.viewerDepartment,
    this.viewerPhotoUrl,
    DateTime Function()? now,
  }) : now = now ?? DateTime.now;

  final OnboardingApi api;
  final Widget profileAction;
  final VoidCallback onNotifications;
  final List<ManagerTab> tabs;
  final ManagerTab? selectedTab;
  final ValueChanged<ManagerTab>? onSelectTab;

  /// Opens the face setup; true once a face was saved.
  final Future<bool> Function(BuildContext context)? registerFace;

  /// Picks, crops and saves a new profile photo; its URL, or null.
  final Future<String?> Function(BuildContext context)? changePhoto;

  /// Opens a Connect post in the feed.
  final void Function(String postId)? openPost;

  final String viewerName;
  final String? viewerDesignation;
  final String? viewerDepartment;
  String? viewerPhotoUrl;
  final DateTime Function() now;

  String get viewerFirstName => viewerName.trim().split(RegExp(r'\s+')).first;
}

/// An onboarding page as Leave and the Support desk are laid out: the app
/// header, a back + title row, the page, an optional footer, and the app's
/// tabs under it ([showNav] off on reels, which hide the nav).
class OnbScaffold extends StatelessWidget {
  const OnbScaffold({
    super.key,
    required this.shell,
    required this.title,
    required this.body,
    this.footer,
    this.trailing,
    this.showNav = true,
    this.onBack,
    this.background = OnbColors.screen,
    this.offline = false,
  });

  final OnboardingShell shell;
  final String title;
  final Widget body;
  final Widget? footer;
  final Widget? trailing;
  final bool showNav;
  final VoidCallback? onBack;
  final Color background;

  /// The live read failed and the screen shows the device's last copy.
  final bool offline;

  @override
  Widget build(BuildContext context) {
    final select = shell.onSelectTab;
    final selected = shell.selectedTab;
    final nav = !showNav ||
            select == null ||
            selected == null ||
            shell.tabs.isEmpty ||
            isTabletLayout(context) ||
            MediaQuery.viewInsetsOf(context).bottom > 0
        ? null
        : AppBottomNav(tabs: shell.tabs, selected: selected, onSelect: select);
    final footer = this.footer;
    return Scaffold(
      backgroundColor: background,
      body: Column(
        children: [
          AppHomeHeader(
            profileAction: Listener(
              onPointerUp: (_) => Navigator.of(context).popUntil((route) => route.isFirst),
              child: shell.profileAction,
            ),
            onNotifications: shell.onNotifications,
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(bottom: BorderSide(color: OnbColors.divider)),
            ),
            child: Row(
              children: [
                SupportBackButton(onTap: onBack ?? () => Navigator.of(context).maybePop()),
                const SizedBox(width: 10),
                Expanded(
                  child: Semantics(
                    header: true,
                    child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: OnbText.screenTitle),
                  ),
                ),
                ?trailing,
              ],
            ),
          ),
          if (offline) const OnbOfflineNote(),
          Expanded(child: body),
          if (footer != null)
            nav == null ? footer : MediaQuery.removePadding(context: context, removeBottom: true, child: footer),
          ?nav,
        ],
      ),
    );
  }
}

/// "Offline · showing your last update": the screen is the device's copy
/// because the live read failed. Never an error card while a copy exists.
class OnbOfflineNote extends StatelessWidget {
  const OnbOfflineNote({super.key});

  static const text = 'Offline · showing your last update';

  @override
  Widget build(BuildContext context) => Container(
    key: const ValueKey('offline-note'),
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
    color: OnbColors.waterTint,
    child: const Row(
      children: [
        Icon(Icons.cloud_off_rounded, size: 16, color: OnbColors.waterText),
        SizedBox(width: 8),
        Expanded(child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.waterText))),
      ],
    ),
  );
}

/// The white strip a pinned primary button sits on.
class OnbFooter extends StatelessWidget {
  const OnbFooter({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: OnbColors.line)),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: children),
    ),
  );
}

// ─── Buttons, tags, cards ───────────────────────────────────────────────────

class OnbPrimaryButton extends StatelessWidget {
  const OnbPrimaryButton({super.key, required this.label, required this.onTap, this.busy = false});

  final String label;
  final VoidCallback? onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 56,
    width: double.infinity,
    child: FilledButton(
      onPressed: busy ? null : onTap,
      style: FilledButton.styleFrom(
        backgroundColor: OnbColors.primary,
        // Not yet possible: grey, as the reels draw it ("Agree and continue").
        disabledBackgroundColor: OnbColors.line,
        foregroundColor: Colors.white,
        disabledForegroundColor: OnbColors.text3,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: OnbText.button(context),
      ),
      child: busy
          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
          : Text(label),
    ),
  );
}

class OnbSecondaryButton extends StatelessWidget {
  const OnbSecondaryButton({super.key, required this.label, required this.onTap, this.height = 56});

  final String label;
  final VoidCallback? onTap;
  final double height;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    width: double.infinity,
    child: OutlinedButton(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        foregroundColor: OnbColors.text,
        side: const BorderSide(color: OnbColors.lineDark),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: OnbText.button(context),
      ),
      child: Text(label),
    ),
  );
}

/// A text link in the brand blue.
class OnbLink extends StatelessWidget {
  const OnbLink({super.key, required this.label, required this.onTap, this.icon, this.color = OnbColors.primary});

  final String label;
  final VoidCallback? onTap;
  final IconData? icon;

  /// White on a blue card; the brand blue elsewhere.
  final Color color;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    child: InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[Icon(icon, size: 16, color: color), const SizedBox(width: 6)],
            Flexible(child: Text(label, style: OnbText.link.copyWith(color: color))),
          ],
        ),
      ),
    ),
  );
}

enum OnbTone { todo, done, mustDo, inReview, needsWater, count, red, locked, brand }

/// The kit's status tags: words, never colour alone.
class OnbTag extends StatelessWidget {
  const OnbTag(this.label, {super.key, this.tone = OnbTone.todo, this.icon});

  final String label;
  final OnbTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final (background, foreground) = switch (tone) {
      OnbTone.done => (OnbColors.doneTint, OnbColors.doneText),
      OnbTone.mustDo => (OnbColors.mustTint, OnbColors.mustText),
      OnbTone.inReview || OnbTone.count => (OnbColors.tint, OnbColors.primary),
      OnbTone.needsWater => (OnbColors.waterTint, OnbColors.waterText),
      OnbTone.red => (OnbColors.redTint, OnbColors.redText),
      OnbTone.locked => (OnbColors.quiet, OnbColors.text3),
      OnbTone.brand => (OnbColors.primary, Colors.white),
      OnbTone.todo => (OnbColors.quiet, OnbColors.text2),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 12, color: foreground), const SizedBox(width: 4)],
          Text(
            label,
            style: TextStyle(
              
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: tone == OnbTone.mustDo ? 0.4 : 0,
              color: foreground,
            ),
          ),
        ],
      ),
    );
  }
}

/// A white card with the kit's hairline.
class OnbCard extends StatelessWidget {
  const OnbCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.radius = 20,
    this.color = Colors.white,
    this.borderColor = OnbColors.line,
    this.onTap,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final Color color;
  final Color borderColor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(radius),
      side: BorderSide(color: borderColor),
    );
    return Material(
      color: color,
      shape: shape,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}

/// The 36–40 px tinted tile a task's emoji sits in.
class OnbIconTile extends StatelessWidget {
  const OnbIconTile(this.emoji, {super.key, this.size = 40, this.tint = OnbColors.tint, this.radius = 12});

  final String emoji;
  final double size;
  final Color tint;
  final double radius;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(radius)),
    child: ExcludeSemantics(child: Text(emoji, style: TextStyle(fontSize: size * 0.48))),
  );
}

/// A face into the image cache ahead of its card (the disk-cached provider
/// every avatar uses), so the card and M2 paint it at once. Never under the
/// test runner, whose image loads never answer.
Future<void> precacheOnbAvatar(BuildContext context, String url) async {
  if (Platform.environment['FLUTTER_TEST'] == 'true' || !context.mounted) return;
  try {
    await precacheImage(avatarImageProvider(url), context, onError: (_, _) {});
  } catch (_) {}
}

/// A person's photo, or their initials on the brand tint.
class OnbAvatar extends StatelessWidget {
  const OnbAvatar({super.key, required this.name, this.photoUrl, this.size = 40, this.ring});

  final String name;
  final String? photoUrl;
  final double size;
  final Color? ring;

  static String initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return parts.take(2).map((p) => p[0].toUpperCase()).join();
  }

  @override
  Widget build(BuildContext context) {
    final url = photoUrl;
    final fallback = Center(
      child: Text(
        initials(name),
        style: TextStyle(fontSize: size * 0.36, fontWeight: FontWeight.w600, color: OnbColors.primary),
      ),
    );
    return Semantics(
      image: true,
      label: name,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: OnbColors.tint,
          border: ring == null ? null : Border.all(color: ring!, width: 2),
        ),
        clipBehavior: Clip.antiAlias,
        child: url == null || url.isEmpty
            ? fallback
            : Image(
                image: avatarImageProvider(url),
                fit: BoxFit.cover,
                width: size,
                height: size,
                errorBuilder: (_, _, _) => fallback,
              ),
      ),
    );
  }
}

/// The reels' segmented bar: 4 px segments, done and current filled.
class OnbStoryBar extends StatelessWidget {
  const OnbStoryBar({super.key, required this.count, required this.current, this.onWhite = true});

  final int count;

  /// 0-based; segments up to and including it are filled.
  final int current;
  final bool onWhite;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Step ${current + 1} of $count',
    child: Row(
      children: [
        for (var i = 0; i < count; i++) ...[
          if (i > 0) const SizedBox(width: 4),
          Expanded(
            child: AnimatedContainer(
              duration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 250),
              height: 4,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(2),
                // Done blue, the current one light blue, the rest grey (as drawn).
                color: onWhite
                    ? (i < current ? OnbColors.primary : (i == current ? OnbColors.brandBorder : OnbColors.line))
                    : (i <= current ? Colors.white : Colors.white24),
              ),
            ),
          ),
        ],
      ],
    ),
  );
}

/// Rises in on entry (0.45 s); still with reduce motion.
class OnbRise extends StatelessWidget {
  const OnbRise({super.key, required this.child, this.delay = 0});

  final Widget child;
  final int delay;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.disableAnimationsOf(context)) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: 450 + delay),
      curve: Curves.easeOutCubic,
      builder: (context, t, child) => Opacity(
        opacity: t,
        child: Transform.translate(offset: Offset(0, 14 * (1 - t)), child: child),
      ),
      child: child,
    );
  }
}

/// A selectable choice card (radio or check), brand outline when picked.
class OnbChoiceCard extends StatelessWidget {
  const OnbChoiceCard({
    super.key,
    required this.title,
    required this.selected,
    required this.onTap,
    this.subtitle,
    this.badge,
    this.multi = false,
  });

  final String title;
  final String? subtitle;
  final String? badge;
  final bool selected;
  final bool multi;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    selected: selected,
    button: true,
    child: Material(
      color: selected ? OnbColors.tint : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: selected ? OnbColors.primary : OnbColors.line, width: selected ? 1.5 : 1),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                multi
                    ? (selected ? Icons.check_box_rounded : Icons.check_box_outline_blank_rounded)
                    : (selected ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded),
                color: selected ? OnbColors.primary : OnbColors.lineDark,
                size: 22,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(child: Text(title, style: OnbText.bodyStrong)),
                        if (badge != null) ...[const SizedBox(width: 8), OnbTag(badge!, tone: OnbTone.count)],
                      ],
                    ),
                    if (subtitle != null) ...[const SizedBox(height: 3), Text(subtitle!, style: OnbText.label)],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

/// A multiline field in the kit's input style.
class OnbTextArea extends StatelessWidget {
  const OnbTextArea({
    super.key,
    required this.controller,
    this.hint,
    this.label,
    this.maxLength,
    this.minLines = 3,
    this.onChanged,
    this.fieldKey,
    this.showCounter = false,
  });

  final TextEditingController controller;
  final String? hint;
  final String? label;
  final int? maxLength;
  final int minLines;
  final ValueChanged<String>? onChanged;
  final Key? fieldKey;
  final bool showCounter;

  @override
  Widget build(BuildContext context) => TextField(
    key: fieldKey,
    controller: controller,
    minLines: minLines,
    maxLines: minLines == 1 ? 1 : 6,
    maxLength: maxLength,
    onChanged: onChanged,
    style: const TextStyle(fontSize: 14, color: OnbColors.text),
    decoration: InputDecoration(
      hintText: hint,
      labelText: label,
      counterText: showCounter ? null : '',
      hintStyle: const TextStyle(fontSize: 14, color: OnbColors.icon),
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.all(14),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: OnbColors.lineDark)),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: OnbColors.lineDark),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: OnbColors.primary, width: 1.5),
      ),
    ),
  );
}

/// Loading and failed states for a page that reads before it shows.
class OnbLoadState extends StatelessWidget {
  const OnbLoadState({super.key, this.error, this.onRetry});

  final String? error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    if (error == null) {
      return const Center(child: CircularProgressIndicator(color: OnbColors.primary));
    }
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(error!, textAlign: TextAlign.center, style: OnbText.body),
            const SizedBox(height: 12),
            if (onRetry != null) TextButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}

/// A bottom sheet in the kit's style: white, 24 radius on top, a grabber.
Future<T?> showOnbSheet<T>(BuildContext context, {required WidgetBuilder builder}) => showModalBottomSheet<T>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  backgroundColor: Colors.white,
  barrierColor: OnbColors.scrim,
  shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
  builder: (context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(height: 10),
        Container(
          width: 40,
          height: 4,
          decoration: BoxDecoration(color: OnbColors.lineDark, borderRadius: BorderRadius.circular(2)),
        ),
        Flexible(child: builder(context)),
      ],
    ),
  ),
);

// ─── Dates ──────────────────────────────────────────────────────────────────

const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "Fri 5 Dec".
String onbDay(DateTime date) => '${_weekdays[date.weekday - 1]} ${date.day} ${_months[date.month - 1]}';

/// "11:00 AM".
String onbTime(DateTime time) {
  final hour = time.hour % 12 == 0 ? 12 : time.hour % 12;
  final minute = time.minute.toString().padLeft(2, '0');
  return '$hour:$minute ${time.hour < 12 ? 'AM' : 'PM'}';
}

/// "Mon 1 Dec, 5:40 PM".
String onbDayTime(DateTime time) => '${onbDay(time)}, ${onbTime(time)}';

/// "Dec 2026".
String onbMonthYear(DateTime date) => '${_months[date.month - 1]} ${date.year}';

/// "Today", "Tomorrow" or "Fri 5 Dec".
String onbRelativeDay(DateTime date, DateTime now) {
  final days = DateTime.utc(date.year, date.month, date.day).difference(DateTime.utc(now.year, now.month, now.day)).inDays;
  return switch (days) {
    0 => 'Today',
    1 => 'Tomorrow',
    -1 => 'Yesterday',
    _ => onbDay(date),
  };
}
