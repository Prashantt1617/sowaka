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

  /// Retained for call sites; composing now starts from the "Start a post"
  /// card at the top of the Connect feed rather than a nav tab.
  final VoidCallback? onOpenComposer;

  /// Pushed screens pass this to unwind back to the shell before switching tab,
  /// otherwise the new tab would render underneath the pushed route.
  final VoidCallback? onBeforeChange;

  @override
  Widget build(BuildContext context) {
    // On a tablet the rail down the left is the navigation, and a second copy
    // along the bottom would be two answers to the same question.
    if (isTabletLayout(context)) return const SizedBox.shrink();
    // Which tabs, and in what order, is the company's call, sent at sign-in.
    final tabs = visibleTabs(bloc.session.user.enabledTabs);
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
            // Six tabs need the room four never did.
            spacing: tabs.length > 4 ? 4 : 14,
            children: [
              for (final tab in tabs)
                _TabButton(
                  label: tabSpecFor(tab).label,
                  iconAsset: tabSpecFor(tab).iconAsset,
                  activeIconAsset: tabSpecFor(tab).activeIconAsset,
                  selected: state.tab == tab,
                  onTap: () {
                    onBeforeChange?.call();
                    bloc.add(ChangeManagerTab(tab));
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
