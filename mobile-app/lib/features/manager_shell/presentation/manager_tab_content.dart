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
    return IndexedStack(
      index: ManagerTab.values.indexOf(state.tab),
      children: [
        _ManageContent(
          key: const ValueKey('manage-tab'),
          state: state,
          bloc: bloc,
          onOpenProfile: onOpenProfile,
        ),
        _GrowTab(
          key: const ValueKey('grow-tab'),
          state: state,
          onOpenProfile: onOpenProfile,
        ),
        _ConnectTab(
          key: const ValueKey('connect-tab'),
          session: session,
          recognitionCandidates: state.dashboard!.recognitionCandidates,
          profileAction: _ProfileAvatarAction(
            key: const ValueKey('connect-profile-avatar'),
            initial: state.dashboard!.managerInitial,
            onTap: onOpenProfile,
          ),
        ),
        QuickActionsScreen(
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
      ],
    );
  }
}
