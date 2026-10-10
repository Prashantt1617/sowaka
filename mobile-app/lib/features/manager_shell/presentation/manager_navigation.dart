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
    return AppBottomNav(
      tabs: visibleTabs(bloc.session.user.enabledTabs),
      selected: state.tab,
      onSelect: (tab) {
        onBeforeChange?.call();
        bloc.add(ChangeManagerTab(tab));
      },
    );
  }
}
