part of '../../manager/presentation/manager_screen.dart';

class _TabContent extends StatelessWidget {
  const _TabContent({
    required this.session,
    required this.state,
    required this.bloc,
    required this.quickActionsController,
    required this.onOpenProfile,
  });

  final AuthSession session;
  final ManagerState state;
  final ManagerBloc bloc;
  final QuickActionsController quickActionsController;
  final VoidCallback onOpenProfile;

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 220),
      child: switch (state.tab) {
        ManagerTab.manage => _ManageContent(
          state: state,
          bloc: bloc,
          onOpenProfile: onOpenProfile,
        ),
        ManagerTab.grow => _GrowTab(state: state, onOpenProfile: onOpenProfile),
        ManagerTab.connect => _ConnectTab(
          key: ValueKey('connect'),
          session: session,
          recognitionCandidates: state.dashboard!.recognitionCandidates,
          profileAction: _ProfileAvatarAction(
            key: const ValueKey('connect-profile-avatar'),
            initial: state.dashboard!.managerInitial,
            onTap: onOpenProfile,
          ),
        ),
        ManagerTab.games => _GamesTab(
          key: const ValueKey('games'),
          session: session,
          profileAction: _ProfileAvatarAction(
            key: const ValueKey('games-profile-avatar'),
            initial: state.dashboard!.managerInitial,
            onTap: onOpenProfile,
          ),
        ),
        ManagerTab.quick => QuickActionsScreen(
          key: const ValueKey('quick-actions'),
          bloc: bloc,
          dashboard: state.dashboard!,
          controller: quickActionsController,
          profileAction: _ProfileAvatarAction(
            key: const ValueKey('quick-profile-avatar'),
            initial: state.dashboard!.managerInitial,
            onTap: onOpenProfile,
          ),
        ),
      },
    );
  }
}
