part of '../../manager/presentation/manager_screen.dart';

class _BottomTabs extends StatelessWidget {
  const _BottomTabs({
    required this.state,
    required this.bloc,
    this.onBeforeChange,
    this.onOpenComposer,
  });

  final ManagerState state;
  final ManagerBloc bloc;

  /// "Post" is an action rather than a tab — it switches to Connect and opens
  /// the composer, so it never shows a selected state.
  final VoidCallback? onOpenComposer;

  /// Pushed screens pass this to unwind back to the shell before switching tab,
  /// otherwise the new tab would render underneath the pushed route.
  final VoidCallback? onBeforeChange;

  @override
  Widget build(BuildContext context) {
    // Per node 638:14376. SafeArea sits *inside* the white container so the
    // home-indicator inset stays white instead of exposing the page behind it.
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Color(0xFFF7F7F9), width: 1.114)),
        boxShadow: [
          BoxShadow(
            color: Color(0x0F000000),
            blurRadius: 10,
            offset: Offset(0, -4),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 9, 16, 8),
          child: Row(
            children: [
              _TabButton(
                label: 'Connect',
                iconAsset: 'assets/icons/nav_connect.svg',
                activeIconAsset: 'assets/icons/nav_connect_active.svg',
                selected: state.tab == ManagerTab.connect,
                onTap: () {
                  onBeforeChange?.call();
                  bloc.add(const ChangeManagerTab(ManagerTab.connect));
                },
              ),
              // Team is visible to everyone; individual contributors get the
              // same list read-only, without the requests segment.
              _TabButton(
                label: 'Team',
                iconAsset: 'assets/icons/nav_team.svg',
                activeIconAsset: 'assets/icons/nav_team_active.svg',
                selected: state.tab == ManagerTab.manage,
                onTap: () {
                  onBeforeChange?.call();
                  bloc.add(const ChangeManagerTab(ManagerTab.manage));
                },
              ),
              _TabButton(
                label: 'Post',
                iconAsset: 'assets/icons/nav_post.svg',
                selected: false,
                onTap: () {
                  onBeforeChange?.call();
                  onOpenComposer?.call();
                },
              ),
              _TabButton(
                label: 'Grow',
                iconAsset: 'assets/icons/nav_grow.svg',
                activeIconAsset: 'assets/icons/nav_grow_active.svg',
                selected: state.tab == ManagerTab.grow,
                onTap: () {
                  onBeforeChange?.call();
                  bloc.add(const ChangeManagerTab(ManagerTab.grow));
                },
              ),
              _TabButton(
                label: 'Actions',
                iconAsset: 'assets/icons/nav_actions.svg',
                activeIconAsset: 'assets/icons/nav_actions_active.svg',
                selected: state.tab == ManagerTab.quick,
                onTap: () {
                  onBeforeChange?.call();
                  bloc.add(const ChangeManagerTab(ManagerTab.quick));
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TabButton extends StatelessWidget {
  const _TabButton({
    required this.label,
    required this.iconAsset,
    this.activeIconAsset,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String iconAsset;
  final String? activeIconAsset;
  final bool selected;
  final VoidCallback onTap;

  static const _selectedColor = Color(0xFF0571A6);

  @override
  Widget build(BuildContext context) {
    final hasActiveAsset = activeIconAsset != null;
    final asset = selected && hasActiveAsset ? activeIconAsset! : iconAsset;
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          // The design marks the active tab with colour alone — no pill.
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SvgPicture.asset(
                asset,
                width: 22,
                height: 22,
                colorFilter: selected && !hasActiveAsset
                    ? const ColorFilter.mode(_selectedColor, BlendMode.srcIn)
                    : null,
              ),
              const SizedBox(height: 4),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected ? _selectedColor : const Color(0xFF9197A2),
                  fontSize: 10,
                  height: 13.333 / 10,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
