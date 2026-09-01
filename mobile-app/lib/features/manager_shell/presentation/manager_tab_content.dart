part of '../../manager/presentation/manager_screen.dart';

class _TabContent extends StatelessWidget {
  const _TabContent({
    required this.session,
    required this.state,
    required this.bloc,
    required this.quickActionsController,
    required this.connectComposerController,
    required this.onOpenProfile,
  });

  final AuthSession session;
  final ManagerState state;
  final ManagerBloc bloc;
  final QuickActionsController quickActionsController;
  final ConnectComposerController connectComposerController;
  final VoidCallback onOpenProfile;

  Future<void> _openNotifications(BuildContext context) async {
    await AppNotificationService.instance.requestPermission();
    if (!context.mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => NotificationInboxScreen(session: session),
      ),
    );
  }

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
          onNotifications: () => _openNotifications(context),
          onOpenComposer: connectComposerController.openComposer,
        ),
        _GrowTab(
          key: const ValueKey('grow-tab'),
          state: state,
          bloc: bloc,
          onOpenProfile: onOpenProfile,
          onNotifications: () => _openNotifications(context),
          onOpenComposer: connectComposerController.openComposer,
        ),
        _ConnectTab(
          key: const ValueKey('connect-tab'),
          session: session,
          recognitionCandidates: state.dashboard!.recognitionCandidates,
          composerController: connectComposerController,
          profileAction: _ProfileAvatarAction(
            key: const ValueKey('connect-profile-avatar'),
            initial: state.dashboard!.managerInitial,
            onTap: onOpenProfile,
            size: 30,
          ),
        ),
        QuickActionsScreen(
          key: const ValueKey('quick-actions'),
          bloc: bloc,
          dashboard: state.dashboard!,
          controller: quickActionsController,
          onNotifications: () => _openNotifications(context),
          onOpenComposer: connectComposerController.openComposer,
          profileAction: _ProfileAvatarAction(
            key: const ValueKey('quick-profile-avatar'),
            initial: state.dashboard!.managerInitial,
            onTap: onOpenProfile,
            size: 30,
          ),
        ),
      ],
    );
  }
}
