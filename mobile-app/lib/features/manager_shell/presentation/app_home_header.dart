import 'package:flutter/material.dart';

import '../../notifications/notification_badge.dart';
import '../../shared/org_branding.dart';
import 'package:flutter_svg/flutter_svg.dart';

class AppHomeHeader extends StatelessWidget {
  const AppHomeHeader({
    super.key,
    required this.profileAction,
    required this.onNotifications,
    this.onQuickCreate,
    this.divider = true,
  });

  final Widget profileAction;
  final VoidCallback onNotifications;

  /// Retained so existing call sites keep compiling, but no longer rendered:
  /// per the updated design the header is logo + bell + avatar only, and
  /// creating a post now starts from the "Post" tab in the bottom nav.
  final VoidCallback? onQuickCreate;

  /// The hairline under the header. Off where a top bar sits straight under
  /// it with no line between them (the Support desk, node 2896:32383; the
  /// Team tab's My Team / Requests / Feedback bar).
  final bool divider;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white,
        border: divider
            ? const Border(bottom: BorderSide(color: Color(0xFFF3F4F6)))
            : null,
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              // The logo takes what the bell and avatar leave, so nothing in
              // it can push them off the screen.
              const Expanded(
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: _AppHeaderLogo(),
                ),
              ),
              _AppHeaderBellButton(onTap: onNotifications),
              const SizedBox(width: 12),
              // The avatar is 30 or 42 across. Capped, because the row gives
              // its children all the width they ask for: a photo that failed
              // with no fallback drew Flutter's error box, its message on one
              // line, and overflowed the header by ~2000 px on a phone that
              // could not reach the API.
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 48, maxHeight: 48),
                child: profileAction,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Whose app this is: the signed-in org's logo, or the Convrse logo the
/// header has always worn when the org has none of its own. Listens, so the
/// face changes the moment the org is known.
///
/// Always 99 x 41, whatever the logo's shape: a wide wordmark or a tall crest
/// is fitted inside, and one that fails to load gives way to the default logo
/// (or to nothing, if even that fails), never to an error box.
class _AppHeaderLogo extends StatelessWidget {
  const _AppHeaderLogo();

  static const _defaultLogo = 'assets/images/convrse_logo.png';

  static Widget _logo(String asset, {required Widget fallback}) => Image.asset(
    asset,
    width: 99,
    height: 41,
    fit: BoxFit.contain,
    errorBuilder: (_, _, _) => fallback,
  );

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      key: const ValueKey('app-home-logo'),
      width: 99,
      height: 41,
      child: ValueListenableBuilder<OrgBranding>(
        valueListenable: OrgBranding.current,
        builder: (context, branding, _) {
          const none = SizedBox.shrink();
          final asset = branding.homeLogoAsset ?? _defaultLogo;
          return _logo(
            asset,
            fallback: asset == _defaultLogo
                ? none
                : _logo(_defaultLogo, fallback: none),
          );
        },
      ),
    );
  }
}

class _AppHeaderBellButton extends StatelessWidget {
  const _AppHeaderBellButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Notifications',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(99),
        child: SizedBox(
          width: 40,
          height: 40,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Center(
                child: SvgPicture.asset(
                  'assets/icons/bell_notification.svg',
                  width: 22,
                  height: 22,
                ),
              ),
              // Only when something new has arrived since the inbox was last
              // opened (see NotificationBadge).
              ValueListenableBuilder<bool>(
                valueListenable: NotificationBadge.hasNew,
                builder: (context, hasNew, _) => hasNew
                    ? const Positioned(
                        right: 6,
                        top: 6,
                        child: _AppHeaderNotificationDot(),
                      )
                    : const SizedBox.shrink(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AppHeaderNotificationDot extends StatelessWidget {
  const _AppHeaderNotificationDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(
        color: const Color(0xFFFB2C36),
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 1.1),
      ),
    );
  }
}
