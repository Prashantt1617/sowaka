import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../manager/data/manager_models.dart';
import 'tab_specs.dart';

/// The app's bottom bar (Figma BottomNav, node 638:14348, as the Games
/// frames draw it): outline icons in grey with their labels, and the tab
/// that is open raised on a tilted yellow key with its icon in ink.
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

/// One tab in the bar: its icon (on the yellow key when open) over its label.
class AppNavItem extends StatelessWidget {
  const AppNavItem({super.key, required this.tab, required this.selected, required this.onTap});

  final ManagerTab tab;
  final bool selected;
  final VoidCallback onTap;

  static const selectedColor = Color(0xFF0571A6);
  static const idleColor = Color(0xFF9CA3AF);
  static const keyColor = Color(0xFFFFC531);
  static const _ink = Color(0xFF170E30);

  /// The Games tab wears the design's game controller (akar-icons).
  static const _controller = 'assets/games_home/nav_controller.svg';

  Widget _icon(Color color, {required bool large}) {
    final filter = ColorFilter.mode(color, BlendMode.srcIn);
    if (tab == ManagerTab.games) {
      // The controller's box, with the glyph inset in it as the design has it.
      final width = large ? 29.819 : 22.0;
      final height = large ? 28.013 : 22.0;
      return SizedBox(
        width: width,
        height: height,
        child: Padding(
          padding: EdgeInsets.fromLTRB(
            width * 0.0833,
            height * 0.2083,
            width * 0.0833,
            height * 0.2225,
          ),
          child: SvgPicture.asset(_controller, fit: BoxFit.fill, colorFilter: filter),
        ),
      );
    }
    final size = large ? 24.0 : 22.0;
    return SvgPicture.asset(
      tabSpecFor(tab).iconAsset,
      width: size,
      height: size,
      colorFilter: filter,
    );
  }

  @override
  Widget build(BuildContext context) {
    final label = tabSpecFor(tab).label;
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      // The label and the tap are this, not the pieces inside.
      onTap: onTap,
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          // Unopened tabs have 6pt above and below; the key has none.
          padding: EdgeInsets.symmetric(vertical: selected ? 0 : 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                height: selected ? 35 : 22,
                child: Center(
                  child: selected
                      ? Transform.rotate(
                          angle: -2 * math.pi / 180,
                          child: Container(
                            key: const ValueKey('nav-selected-key'),
                            width: 41.808,
                            height: 36.497,
                            decoration: BoxDecoration(
                              color: keyColor,
                              borderRadius: BorderRadius.circular(11),
                              border: Border.all(color: const Color(0xFF5F4A99), width: 1.1),
                              boxShadow: const [
                                BoxShadow(color: Color(0xFF150C2E), offset: Offset(0, 3)),
                              ],
                            ),
                            alignment: Alignment.center,
                            child: Transform.rotate(
                              angle: -3 * math.pi / 180,
                              child: _icon(_ink, large: true),
                            ),
                          ),
                        )
                      : _icon(idleColor, large: false),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: 'Sora',
                  color: selected ? selectedColor : idleColor,
                  fontSize: 10,
                  height: 13.333 / 10,
                  fontWeight: FontWeight.w600,
                  fontVariations: const [FontVariation.weight(600)],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
