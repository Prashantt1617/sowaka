import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../manager/data/manager_models.dart';
import 'tab_specs.dart';

/// The app's bottom bar (Figma BottomNav, node 638:14350): outline icons in
/// grey with their labels, and the tab that is open drawn filled with its
/// label in the brand blue. Games, open, rises on a tilted yellow key instead.
///
/// Which tabs, and in what order, is the company's call ([tabs], from
/// `enabledTabs`); this only draws them.
class AppBottomNav extends StatelessWidget {
  const AppBottomNav({
    super.key,
    required this.tabs,
    required this.selected,
    required this.onSelect,
  });

  final List<ManagerTab> tabs;
  final ManagerTab selected;
  final ValueChanged<ManagerTab> onSelect;

  @override
  Widget build(BuildContext context) {
    // SafeArea sits inside the white bar so the home-indicator inset stays
    // white instead of showing the page behind it.
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Color(0xFFF7F7F9), width: 1.114)),
        boxShadow: [BoxShadow(color: Color(0x0F000000), blurRadius: 10, offset: Offset(0, -4))],
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 9.114, 16, 8),
          child: Row(
            // Six tabs need the room four never did.
            spacing: tabs.length > 4 ? 4 : 14,
            // Centred, as the design's: the open tab's key makes it a point
            // taller than the rest, its label a little lower.
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              for (final tab in tabs)
                Expanded(
                  child: AppNavItem(
                    key: ValueKey('nav-${tab.name}'),
                    tab: tab,
                    selected: tab == selected,
                    onTap: () => onSelect(tab),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One tab in the bar: its icon over its label, filled and blue when open
/// (Games on its yellow key).
class AppNavItem extends StatelessWidget {
  const AppNavItem({super.key, required this.tab, required this.selected, required this.onTap});

  final ManagerTab tab;
  final bool selected;
  final VoidCallback onTap;

  static const selectedColor = Color(0xFF0571A6);

  /// The design's two greys: Connect and Actions in one, Teams and Games in
  /// the other. Each icon carries its own, so only the labels need telling.
  static const idleColor = Color(0xFF9CA3AF);
  static const idleColorSoft = Color(0xFF9197A2);
  static const keyColor = Color(0xFFFFC531);

  /// The Games tab's game controller (akar-icons): the large one on the key,
  /// the small grey one when closed. Each drawn at its own size, where the
  /// design's box puts it.
  static const _keyController = 'assets/games_home/nav_controller.svg';
  static const _idleController = 'assets/games_home/nav_controller_idle.svg';

  bool get _onKey => selected && tab == ManagerTab.games;

  Color get _labelColor {
    if (selected) return selectedColor;
    return tab == ManagerTab.manage || tab == ManagerTab.games ? idleColorSoft : idleColor;
  }

  /// "Game" closed and "Games" open, as the design writes them.
  String get _label => tab == ManagerTab.games && !selected ? 'Game' : tabSpecFor(tab).label;

  Widget _icon() {
    if (tab == ManagerTab.games) {
      return SizedBox(
        width: 21.99,
        height: 21.99,
        child: Stack(
          clipBehavior: Clip.none,
          children: [Positioned(left: 0.916, top: 3.664, child: SvgPicture.asset(_idleController))],
        ),
      );
    }
    final spec = tabSpecFor(tab);
    return SvgPicture.asset(selected ? spec.activeIconAsset : spec.iconAsset);
  }

  Widget _key() {
    return Transform.rotate(
      angle: -2 * math.pi / 180,
      child: Container(
        key: const ValueKey('nav-selected-key'),
        width: 41.808,
        height: 36.497,
        decoration: BoxDecoration(
          color: keyColor,
          borderRadius: BorderRadius.circular(11),
          border: Border.all(color: const Color(0xFF5F4A99), width: 1.1),
          boxShadow: const [BoxShadow(color: Color(0xFF150C2E), offset: Offset(0, 3))],
        ),
        // The controller sits in the key's top-left corner, inside its 5 by 3
        // padding, tilted a further 3 degrees: not centred.
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned(
              left: 5,
              top: 3,
              width: 31.244,
              height: 29.535,
              child: Center(
                child: Transform.rotate(
                  angle: -3 * math.pi / 180,
                  child: SizedBox(
                    width: 29.819,
                    height: 28.013,
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [Positioned(left: 1.568, top: 4.919, child: SvgPicture.asset(_keyController))],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bold = tab == ManagerTab.connect;
    return Semantics(
      button: true,
      selected: selected,
      label: tabSpecFor(tab).label,
      // The label and the tap are this, not the pieces inside.
      onTap: onTap,
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          // Every tab has 6pt above and below, bar Games open on its key.
          padding: EdgeInsets.symmetric(vertical: _onKey ? 0 : 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                height: _onKey ? 35 : 21.99,
                child: Center(child: _onKey ? _key() : _icon()),
              ),
              const SizedBox(height: 4),
              Text(
                _label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: 'Sora',
                  color: _labelColor,
                  fontSize: 10,
                  height: 13.333 / 10,
                  // Connect's label is the design's one bold label, open or not.
                  fontWeight: bold ? FontWeight.w700 : FontWeight.w600,
                  fontVariations: [FontVariation.weight(bold ? 700 : 600)],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
