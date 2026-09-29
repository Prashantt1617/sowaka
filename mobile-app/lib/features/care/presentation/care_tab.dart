part of '../../manager/presentation/manager_screen.dart';

/// Care: a tab with nothing behind it yet. It exists so the bar, the routing
/// and the per-company switch are proven before there is anything to put in
/// it, and so a company that has it sees where it will live.
class _CareTab extends StatelessWidget {
  const _CareTab({
    super.key,
    required this.profileAction,
    required this.onNotifications,
  });

  final Widget profileAction;
  final VoidCallback onNotifications;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: MColors.bg,
      child: Column(
        children: [
          AppHomeHeader(
            profileAction: profileAction,
            onNotifications: onNotifications,
          ),
          Expanded(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 64,
                      height: 64,
                      decoration: const BoxDecoration(
                        color: MColors.terraTint,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.favorite_rounded,
                        color: MColors.terra,
                        size: 30,
                      ),
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'Care',
                      style: TextStyle(
                        fontFamily: 'Sora',
                        color: MColors.ink,
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Coming soon',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: MColors.inkSoft,
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
