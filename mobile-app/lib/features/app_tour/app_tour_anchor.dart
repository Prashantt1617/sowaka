import 'package:flutter/widgets.dart';

/// What the Sowaka tour can point at (the spotlight tour's stops, 24 Nov
/// design "Connect spotlight tour"): a bottom-bar tab, a piece of a tab's
/// home, the header photo, the Profile › Help card.
enum AppTourTarget {
  navConnect,
  navTeams,
  navActions,
  navGames,
  connectComposer,
  teamsRequests,
  teamsFeedback,
  punchCard,
  attendanceTitle,
  actionTiles,
  avatar,
  helpCard,
}

/// Marks [child] as the place the tour spotlights for [target]. The same
/// target can be marked more than once at a time (the bottom bar is drawn by
/// the shell, the profile and pages pushed over them; every tab keeps its
/// header built): the tour picks the one that is on screen, in the route in
/// front, in the tab shown and not under the profile.
class AppTourAnchor extends StatefulWidget {
  const AppTourAnchor({super.key, required this.target, required this.child});

  final AppTourTarget target;
  final Widget child;

  @override
  State<AppTourAnchor> createState() => _AppTourAnchorState();
}

class _AppTourAnchorState extends State<AppTourAnchor> {
  /// The marked widget itself: a key of its own per mark, so two marks of one
  /// target never clash the way one shared GlobalKey would.
  final _key = GlobalKey();

  bool _visible = true;
  bool _ticking = true;
  bool _current = true;

  @override
  void initState() {
    super.initState();
    AppTourAnchors._add(widget.target, this);
  }

  @override
  void didUpdateWidget(covariant AppTourAnchor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.target != widget.target) {
      AppTourAnchors._remove(oldWidget.target, this);
      AppTourAnchors._add(widget.target, this);
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // An IndexedStack tab not shown reads hidden; the tabs under the open
    // profile have their tickers off.
    _visible = Visibility.of(context);
    _ticking = TickerMode.valuesOf(context).enabled;
    // A page pushed over this one hides it.
    _current = ModalRoute.isCurrentOf(context) ?? true;
  }

  @override
  void dispose() {
    AppTourAnchors._remove(widget.target, this);
    super.dispose();
  }

  /// The marked box, when it is laid out and could be seen now.
  RenderBox? get _box {
    if (!mounted || !_visible || !_ticking || !_current) return null;
    final box = _key.currentContext?.findRenderObject();
    if (box is! RenderBox || !box.attached || !box.hasSize || box.size.isEmpty) return null;
    return box;
  }

  @override
  Widget build(BuildContext context) => KeyedSubtree(key: _key, child: widget.child);
}

/// The marks on screen, by target.
abstract final class AppTourAnchors {
  static final Map<AppTourTarget, List<_AppTourAnchorState>> _marks = {};

  static void _add(AppTourTarget target, _AppTourAnchorState mark) => (_marks[target] ??= []).add(mark);

  static void _remove(AppTourTarget target, _AppTourAnchorState mark) => _marks[target]?.remove(mark);

  /// The box of [target] that can be seen now (the latest marked first), or
  /// null when none is on screen.
  static RenderBox? boxOf(AppTourTarget target) {
    for (final mark in (_marks[target] ?? const <_AppTourAnchorState>[]).reversed) {
      if (mark._box case final box?) return box;
    }
    return null;
  }

  /// The context of [target]'s visible mark, for scrolling it into view.
  static BuildContext? contextOf(AppTourTarget target) {
    for (final mark in (_marks[target] ?? const <_AppTourAnchorState>[]).reversed) {
      if (mark._box != null) return mark._key.currentContext;
    }
    return null;
  }
}
