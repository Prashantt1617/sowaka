import '../../manager/data/manager_models.dart';

/// How a tab is drawn in the bottom bar and the tablet rail: its label and
/// its two icons. One place, so both bars agree.
class TabSpec {
  const TabSpec({
    required this.label,
    required this.iconAsset,
    required this.activeIconAsset,
  });

  final String label;
  final String iconAsset;
  final String activeIconAsset;
}

TabSpec tabSpecFor(ManagerTab tab) => switch (tab) {
  ManagerTab.connect => const TabSpec(
    label: 'Connect',
    iconAsset: 'assets/icons/nav_connect.svg',
    activeIconAsset: 'assets/icons/nav_connect_active.svg',
  ),
  ManagerTab.manage => const TabSpec(
    label: 'Team',
    iconAsset: 'assets/icons/nav_team.svg',
    activeIconAsset: 'assets/icons/nav_team_active.svg',
  ),
  ManagerTab.grow => const TabSpec(
    label: 'Grow',
    iconAsset: 'assets/icons/nav_grow.svg',
    activeIconAsset: 'assets/icons/nav_grow_active.svg',
  ),
  ManagerTab.quick => const TabSpec(
    label: 'Actions',
    iconAsset: 'assets/icons/nav_actions.svg',
    activeIconAsset: 'assets/icons/nav_actions_active.svg',
  ),
  ManagerTab.care => const TabSpec(
    label: 'Care',
    iconAsset: 'assets/icons/nav_care.svg',
    activeIconAsset: 'assets/icons/nav_care_active.svg',
  ),
  ManagerTab.talk => const TabSpec(
    label: 'Help',
    iconAsset: 'assets/icons/nav_talk.svg',
    activeIconAsset: 'assets/icons/nav_talk_active.svg',
  ),
  ManagerTab.games => const TabSpec(
    label: 'Games',
    iconAsset: 'assets/icons/nav_games.svg',
    activeIconAsset: 'assets/icons/nav_games_active.svg',
  ),
};
