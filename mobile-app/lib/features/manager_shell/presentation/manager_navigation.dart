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
                label: 'Manage',
                icon: Icons.checklist_rounded,
                selected: state.tab == ManagerTab.manage,
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
              label: 'Games',
              icon: Icons.sports_esports_rounded,
              selected: state.tab == ManagerTab.games,
              onTap: () => bloc.add(const ChangeManagerTab(ManagerTab.games)),
            ),
            _TabButton(
              label: 'Quick Actions',
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
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

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
            color: selected ? MColors.terraTint : Colors.transparent,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: selected ? MColors.terra : MColors.inkFaint),
              const SizedBox(height: 3),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected ? MColors.terra : MColors.inkFaint,
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

class _ActionAvatar {
  const _ActionAvatar({
    required this.initial,
    required this.index,
    this.completed = false,
  });

  final String initial;
  final int index;
  final bool completed;
}

class _AvatarActionCluster extends StatelessWidget {
  const _AvatarActionCluster({
    required this.people,
    required this.onTap,
    this.emptyText = 'All caught up',
  });

  final Iterable<_ActionAvatar> people;
  final VoidCallback onTap;
  final String emptyText;

  @override
  Widget build(BuildContext context) {
    final items = people.toList();
    if (items.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
        child: Text(
          emptyText,
          style: const TextStyle(
            color: MColors.inkFaint,
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
        ),
      );
    }
    return Semantics(
      button: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
          child: Wrap(
            spacing: 12,
            runSpacing: 12,
            children: items.map((person) {
              return Stack(
                clipBehavior: Clip.none,
                children: [
                  Opacity(
                    opacity: person.completed ? .5 : 1,
                    child: AvatarBadge(
                      initial: person.initial,
                      index: person.index,
                      size: 46,
                    ),
                  ),
                  if (person.completed)
                    const Positioned(
                      right: -2,
                      bottom: -2,
                      child: CircleAvatar(
                        radius: 10,
                        backgroundColor: Colors.white,
                        child: CircleAvatar(
                          radius: 8,
                          backgroundColor: MColors.sage,
                          child: Icon(
                            Icons.check_rounded,
                            size: 11,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ),
                ],
              );
            }).toList(),
          ),
        ),
      ),
    );
  }
}
