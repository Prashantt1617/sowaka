part of '../../manager/presentation/manager_screen.dart';

class _BottomTabs extends StatelessWidget {
  const _BottomTabs({required this.state, required this.bloc});

  final ManagerState state;
  final ManagerBloc bloc;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: MColors.line)),
        ),
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 6),
        child: Row(
          children: [
            if (state.canManage)
              _TabButton(
                label: 'Team',
                iconAsset: 'assets/icons/nav_team.svg',
                activeIconAsset: 'assets/icons/nav_team_active.svg',
                selected: state.tab == ManagerTab.manage,
                onTap: () =>
                    bloc.add(const ChangeManagerTab(ManagerTab.manage)),
              ),
            _TabButton(
              label: 'Grow',
              iconAsset: 'assets/icons/nav_grow.svg',
              selected: state.tab == ManagerTab.grow,
              onTap: () => bloc.add(const ChangeManagerTab(ManagerTab.grow)),
            ),
            _TabButton(
              label: 'Connect',
              iconAsset: 'assets/icons/nav_connect.svg',
              selected: state.tab == ManagerTab.connect,
              onTap: () => bloc.add(const ChangeManagerTab(ManagerTab.connect)),
            ),
            _TabButton(
              label: 'Actions',
              iconAsset: 'assets/icons/nav_actions.svg',
              activeIconAsset: 'assets/icons/nav_actions_active.svg',
              selected: state.tab == ManagerTab.quick,
              onTap: () => bloc.add(const ChangeManagerTab(ManagerTab.quick)),
            ),
          ],
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
  static const _selectedTint = Color(0xFFE3F2FA);

  @override
  Widget build(BuildContext context) {
    final hasActiveAsset = activeIconAsset != null;
    final asset = selected && hasActiveAsset ? activeIconAsset! : iconAsset;
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: selected ? _selectedTint : Colors.transparent,
            borderRadius: BorderRadius.circular(14),
          ),
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
              const SizedBox(height: 3),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected ? _selectedColor : MColors.inkFaint,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
