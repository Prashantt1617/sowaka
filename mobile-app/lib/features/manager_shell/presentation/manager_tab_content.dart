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

  Future<void> _openNotifications(BuildContext context) =>
      openNotificationInbox(context, session);

  /// [tab] only when the company has it in the bar, or it is being looked at
  /// (a notification can land on a tab the bar leaves out). Every tab used to
  /// be built for everyone, so a company without Care or Help still asked for
  /// both at every launch and every rebuild, and was refused each time: 1,270
  /// `/care/catalog` and 635 `/help/home` 403s in 17 hours.
  Widget _only(ManagerTab tab, Widget built) =>
      _tabs.contains(tab) || state.tab == tab ? built : const SizedBox.shrink();

  List<ManagerTab> get _tabs => visibleTabs(bloc.session.user.enabledTabs);

  @override
  Widget build(BuildContext context) {
    return IndexedStack(
      index: ManagerTab.values.indexOf(state.tab),
      children: [
        _only(ManagerTab.manage, _ManageContent(
          key: ValueKey('manage-tab-${state.resetsOf(ManagerTab.manage)}'),
          state: state,
          bloc: bloc,
          onOpenProfile: onOpenProfile,
          onNotifications: () => _openNotifications(context),
          onOpenComposer: connectComposerController.openComposer,
        )),
        _only(ManagerTab.grow, _GrowTab(
          key: ValueKey('grow-tab-${state.resetsOf(ManagerTab.grow)}'),
          state: state,
          bloc: bloc,
          onOpenProfile: onOpenProfile,
          onNotifications: () => _openNotifications(context),
          onOpenComposer: connectComposerController.openComposer,
        )),
        _only(ManagerTab.connect, _ConnectTab(
          key: ValueKey('connect-tab-${state.resetsOf(ManagerTab.connect)}'),
          session: session,
          recognitionCandidates: state.dashboard!.recognitionCandidates,
          composerController: connectComposerController,
          data: state.dashboard!,
          bloc: bloc,
          onOpenProfile: onOpenProfile,
          profileAction: _ProfileAvatarAction(
            key: const ValueKey('connect-profile-avatar'),
            initial: state.dashboard!.managerInitial,
            photoUrl: state.dashboard!.managerPhotoUrl,
            onTap: onOpenProfile,
            size: 30,
          ),
        )),
        // Children are positional: the IndexedStack is keyed on the enum's
        // index, so this must stay in ManagerTab order — games sits between
        // connect and quick.
        // Not keyed on its resets like the others: the tab's web page is
        // kept loaded, and a fresh pick resets it in place (the native home
        // is rebuilt inside the tab, as before).
        _only(ManagerTab.games, _GamesTab(
          key: const ValueKey('games'),
          resets: state.resetsOf(ManagerTab.games),
          session: session,
          bloc: bloc,
          connectComposerController: connectComposerController,
          // The home is fetched when the tab is first looked at, not for
          // every company the moment the app opens.
          visible: state.tab == ManagerTab.games,
        )),
        _only(ManagerTab.quick, QuickActionsScreen(
          key: ValueKey('quick-actions-${state.resetsOf(ManagerTab.quick)}'),
          bloc: bloc,
          dashboard: state.dashboard!,
          controller: quickActionsController,
          onNotifications: () => _openNotifications(context),
          onOpenComposer: connectComposerController.openComposer,
          profileAction: _ProfileAvatarAction(
            key: const ValueKey('quick-profile-avatar'),
            initial: state.dashboard!.managerInitial,
            photoUrl: state.dashboard!.managerPhotoUrl,
            onTap: onOpenProfile,
            size: 30,
          ),
        )),
        // Still in ManagerTab order: care, then talk. Whether either is in the
        // bar is the company's call; the stack builds them only if so.
        _only(ManagerTab.care, CareTab(
          key: ValueKey('care-tab-${state.resetsOf(ManagerTab.care)}'),
          session: session,
          onOpenHelp: () => bloc.add(const ChangeManagerTab(ManagerTab.talk)),
          onNotifications: () => _openNotifications(context),
          profileAction: _ProfileAvatarAction(
            key: const ValueKey('care-profile-avatar'),
            initial: state.dashboard!.managerInitial,
            photoUrl: state.dashboard!.managerPhotoUrl,
            onTap: onOpenProfile,
            size: 30,
          ),
        )),
        _only(ManagerTab.talk, HelpTab(
          key: ValueKey('help-tab-${state.resetsOf(ManagerTab.talk)}'),
          session: session,
          // Built beside the other tabs; only one is looked at. Help asks about a
          // finished session, and that question belongs on Help.
          visible: state.tab == ManagerTab.talk,
          onNotifications: () => _openNotifications(context),
          profileAction: _ProfileAvatarAction(
            key: const ValueKey('talk-profile-avatar'),
            initial: state.dashboard!.managerInitial,
            photoUrl: state.dashboard!.managerPhotoUrl,
            onTap: onOpenProfile,
            size: 30,
          ),
        )),
      ],
    );
  }
}
