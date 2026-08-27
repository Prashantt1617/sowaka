import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

class AppHomeHeader extends StatelessWidget {
  const AppHomeHeader({
    super.key,
    required this.profileAction,
    required this.onNotifications,
    required this.onQuickCreate,
  });

  final Widget profileAction;
  final VoidCallback onNotifications;
  final VoidCallback onQuickCreate;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFF3F4F6))),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Image.asset(
                'assets/images/convrse_logo.png',
                width: 99,
                height: 41,
                fit: BoxFit.contain,
              ),
              const Spacer(),
              _AppHeaderBellButton(onTap: onNotifications),
              const SizedBox(width: 12),
              _AppHeaderPlusButton(onTap: onQuickCreate),
              const SizedBox(width: 12),
              profileAction,
            ],
          ),
        ),
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
              const Positioned(
                right: 6,
                top: 6,
                child: _AppHeaderNotificationDot(),
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

class _AppHeaderPlusButton extends StatelessWidget {
  const _AppHeaderPlusButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Quick create',
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: SvgPicture.asset(
          'assets/icons/plus_add.svg',
          width: 28,
          height: 28,
        ),
      ),
    );
  }
}
