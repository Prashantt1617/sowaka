import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../manager/bloc/manager_bloc.dart';
import '../../manager/data/manager_models.dart';

/// A tablet is wide enough that a phone layout stops being a layout: the nav
/// stretches across a metre of glass and the content runs edge to edge. The
/// shortest side is the honest measure — it does not change when the tablet is
/// rotated, so the app does not switch shape in someone's hands.
///
/// Desktop counts too, so the layout can be seen and worked on without a tablet
/// in hand; a window narrower than the breakpoint falls back to the phone
/// layout, which is the same rule.
bool isTabletLayout(BuildContext context) =>
    MediaQuery.sizeOf(context).shortestSide >= 600;

/// How wide the content column is allowed to grow on a tablet.
///
/// Roughly a large phone. Text that runs the full width of a tablet is
/// unreadable, and every card in this app was drawn against a phone's width.
const double _contentMaxWidth = 720;

/// The rail's width, and the same space kept clear on the right.
///
/// Without it the content is pinned against the rail on one side and the glass
/// on the other, which reads as a phone layout that has been stretched. In
/// portrait there is no room for the column to reach its maximum, so this is
/// what actually creates the margin either side.
const double _railWidth = 96;

/// The bloc currently driving the shell, so the rail can sit *above* the
/// navigator and stay put while screens are pushed over it — the way it does
/// on a tablet everywhere else. Null before sign-in and after logout, when
/// there is no shell and so no rail.
final ValueNotifier<ManagerBloc?> activeManagerBloc =
    ValueNotifier<ManagerBloc?>(null);

/// The app's navigator, reachable from the rail.
///
/// The rail is deliberately above the navigator so it survives a pushed
/// screen — which also means `Navigator.of` finds nothing from up there, and a
/// tap would do nothing at all.
final GlobalKey<NavigatorState> appNavigatorKey = GlobalKey<NavigatorState>();

/// Wraps the whole app: on a tablet, a navigation rail down the left and the
/// content held to a readable column with matching space either side. On a
/// phone it adds nothing at all.
class TabletShell extends StatelessWidget {
  const TabletShell({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (!isTabletLayout(context)) return child;
    return ValueListenableBuilder<ManagerBloc?>(
      valueListenable: activeManagerBloc,
      builder: (context, bloc, _) {
        // Signed out: still centre the content, but there is no rail to show,
        // so the margin is symmetric rather than balanced against one.
        final content = Padding(
          padding: EdgeInsets.only(right: bloc == null ? 0 : _railWidth),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: _contentMaxWidth),
              child: child,
            ),
          ),
        );
        if (bloc == null) {
          return ColoredBox(color: _shellBackground, child: content);
        }
        return ColoredBox(
          color: _shellBackground,
          child: SafeArea(
            top: false,
            bottom: false,
            child: Row(
              children: [
                _NavigationRail(bloc: bloc),
                Expanded(child: content),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// The space either side of the content column, in the app's own background
/// so the gutters read as part of the page rather than as a frame around it.
const Color _shellBackground = Color(0xFFF7F7F9);

/// The rail: the same four destinations as the phone's bottom bar, down the
/// left edge where a tablet's thumb actually is.
class _NavigationRail extends StatelessWidget {
  const _NavigationRail({required this.bloc});

  final ManagerBloc bloc;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<ManagerState>(
      stream: bloc.stream,
      initialData: bloc.state,
      builder: (context, snapshot) {
        final state = snapshot.data ?? bloc.state;
        return Material(
          color: Colors.white,
          child: Container(
            width: _railWidth,
            decoration: const BoxDecoration(
              border: Border(right: BorderSide(color: Color(0xFFEBEBEB))),
            ),
            child: SafeArea(
              right: false,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _RailButton(
                    label: 'Connect',
                    iconAsset: 'assets/icons/nav_connect.svg',
                    activeIconAsset: 'assets/icons/nav_connect_active.svg',
                    selected: state.tab == ManagerTab.connect,
                    onTap: () => _select(context, ManagerTab.connect),
                  ),
                  _RailButton(
                    label: 'Team',
                    iconAsset: 'assets/icons/nav_team.svg',
                    activeIconAsset: 'assets/icons/nav_team_active.svg',
                    selected: state.tab == ManagerTab.manage,
                    onTap: () => _select(context, ManagerTab.manage),
                  ),
                  _RailButton(
                    label: 'Grow',
                    iconAsset: 'assets/icons/nav_grow.svg',
                    activeIconAsset: 'assets/icons/nav_grow_active.svg',
                    selected: state.tab == ManagerTab.grow,
                    onTap: () => _select(context, ManagerTab.grow),
                  ),
                  _RailButton(
                    label: 'Actions',
                    iconAsset: 'assets/icons/nav_actions.svg',
                    activeIconAsset: 'assets/icons/nav_actions_active.svg',
                    selected: state.tab == ManagerTab.quick,
                    onTap: () => _select(context, ManagerTab.quick),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  /// The rail sits above the navigator, so a screen pushed over the shell has
  /// to be unwound before the tab beneath it changes — otherwise the new tab
  /// renders underneath whatever is on top.
  void _select(BuildContext context, ManagerTab tab) {
    appNavigatorKey.currentState?.popUntil((route) => route.isFirst);
    bloc.add(ChangeManagerTab(tab));
  }
}

class _RailButton extends StatelessWidget {
  const _RailButton({
    required this.label,
    required this.iconAsset,
    required this.activeIconAsset,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String iconAsset;
  final String activeIconAsset;
  final bool selected;
  final VoidCallback onTap;

  static const _selectedColor = Color(0xFF0571A6);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SvgPicture.asset(
                selected ? activeIconAsset : iconAsset,
                width: 24,
                height: 24,
              ),
              const SizedBox(height: 6),
              Text(
                label,
                style: TextStyle(
                  color: selected ? _selectedColor : const Color(0xFF717171),
                  fontSize: 11.5,
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
