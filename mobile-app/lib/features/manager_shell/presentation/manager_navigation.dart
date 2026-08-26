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
                icon: Icons.people_alt_rounded,
                selected: state.tab == ManagerTab.manage,
                selectedColor: const Color(0xFF0571A6),
                selectedTint: const Color(0xFFE3F2FA),
                onTap: () =>
                    bloc.add(const ChangeManagerTab(ManagerTab.manage)),
              ),
            _TabButton(
              label: 'Grow',
              icon: Icons.show_chart_rounded,
              selected: state.tab == ManagerTab.grow,
              onTap: () => bloc.add(const ChangeManagerTab(ManagerTab.grow)),
            ),
            _TabButton(
              label: 'Connect',
              icon: Icons.newspaper_rounded,
              selected: state.tab == ManagerTab.connect,
              onTap: () => bloc.add(const ChangeManagerTab(ManagerTab.connect)),
            ),
            _TabButton(
              label: 'Actions',
              icon: Icons.bolt_rounded,
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
    required this.icon,
    required this.selected,
    required this.onTap,
    this.selectedColor = MColors.terra,
    this.selectedTint = MColors.terraTint,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;
  final Color selectedColor;
  final Color selectedTint;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: selected ? selectedTint : Colors.transparent,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: selected ? selectedColor : MColors.inkFaint),
              const SizedBox(height: 3),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected ? selectedColor : MColors.inkFaint,
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
