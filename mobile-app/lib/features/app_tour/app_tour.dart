/// The Sowaka tour (24 Nov design, "Connect spotlight tour"): a start card,
/// then a spotlight that walks the app itself (each bottom tab, then what is
/// in it), a card under or over each stop, and a finish card. 13 stops for a
/// manager, 11 for everyone else (Teams › Requests and Feedback are a
/// manager's). The tour switches tabs as it goes; a stop whose place is not
/// on screen (a tab the company has not got, a feature that is off, a
/// tablet's rail) is left out.
///
/// Started from the joiner's "Sowaka tour" tile and from Profile › Help.
library;

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../manager/data/manager_models.dart' show ManagerTab, TeamSection;
import 'app_tour_anchor.dart';
import 'app_tour_animations.dart';

export 'app_tour_anchor.dart';

// ─── The app around the tour ────────────────────────────────────────────────

/// What the tour asks of the shell: which tabs there are, show one (fresh
/// when asked), Teams' sections, the profile's Help tab, who is looking.
class AppTourHost {
  const AppTourHost({
    required this.tabs,
    required this.showTab,
    required this.showTeamSection,
    required this.openHelp,
    required this.closeProfile,
    required this.isManager,
    required this.firstName,
  });

  final List<ManagerTab> Function() tabs;

  /// Shows [tab]; [reset] opens it as the bar does (its home, scrolled to
  /// the top) even when it is the tab already shown.
  final void Function(ManagerTab tab, bool reset) showTab;
  final void Function(TeamSection section) showTeamSection;

  /// One's own profile, on its Help tab.
  final VoidCallback openHelp;
  final VoidCallback closeProfile;
  final bool Function() isManager;
  final String Function() firstName;
}

// ─── The stops ──────────────────────────────────────────────────────────────

/// One stop: where it points, what its card says, and what the shell shows
/// under it.
class AppTourStop {
  const AppTourStop({
    required this.chapter,
    required this.target,
    required this.title,
    required this.body,
    this.tab,
    this.section,
    this.profile = false,
    this.managerBody,
    this.managerOnly = false,
    this.isNew = false,
    this.animation,
    this.pad = const EdgeInsets.all(6),
    this.radius = 21,
  });

  final String chapter;
  final AppTourTarget target;
  final String title;
  final String body;

  /// What a manager reads instead of [body].
  final String? managerBody;

  /// The tab shown under it (none with [profile]).
  final ManagerTab? tab;

  /// Teams' section under it.
  final TeamSection? section;

  /// Over the profile's Help tab.
  final bool profile;
  final bool managerOnly;
  final bool isNew;
  final AppTourAnimation? animation;

  /// The white ring round the spotlit widget: how far out, and its corners.
  final EdgeInsets pad;
  final double radius;

  String bodyFor({required bool manager}) => manager ? (managerBody ?? body) : body;
}

const _navPad = EdgeInsets.symmetric(horizontal: 2, vertical: 10);

/// The design's script (Script.dc.html), word for word.
const appTourStops = <AppTourStop>[
  AppTourStop(
    chapter: 'CONNECT TAB',
    target: AppTourTarget.navConnect,
    tab: ManagerTab.connect,
    pad: _navPad,
    title: 'Connect, your company Instagram',
    body: 'Scroll news, wins and celebrations from across the company.',
  ),
  AppTourStop(
    chapter: 'HOME',
    target: AppTourTarget.connectComposer,
    tab: ManagerTab.connect,
    animation: AppTourAnimation.post,
    radius: 26,
    title: 'Your stories, for work',
    body: 'Post a win, a photo or a festive hello for everyone to see.',
  ),
  AppTourStop(
    chapter: 'TEAMS TAB',
    target: AppTourTarget.navTeams,
    tab: ManagerTab.manage,
    section: TeamSection.myTeam,
    pad: _navPad,
    title: 'Your teammates, all in one place',
    body: 'Who’s on which team, no more asking around.',
    managerBody: 'Who’s on which team, plus the requests and feedback waiting on you.',
  ),
  AppTourStop(
    chapter: 'TEAMS · REQUESTS',
    target: AppTourTarget.teamsRequests,
    tab: ManagerTab.manage,
    section: TeamSection.requests,
    managerOnly: true,
    animation: AppTourAnimation.approve,
    pad: EdgeInsets.all(8),
    radius: 27,
    title: 'Your approvals inbox',
    body: 'Leave and overtime requests, like DMs that just need a yes or no.',
  ),
  AppTourStop(
    chapter: 'TEAMS · FEEDBACK',
    target: AppTourTarget.teamsFeedback,
    tab: ManagerTab.manage,
    section: TeamSection.feedback,
    managerOnly: true,
    animation: AppTourAnimation.feedback,
    pad: EdgeInsets.all(8),
    radius: 27,
    title: 'Monthly feedback',
    body: 'Like a report card, but kinder. Rate each teammate; the badge shows who’s left.',
  ),
  AppTourStop(
    chapter: 'ACTIONS TAB',
    target: AppTourTarget.navActions,
    tab: ManagerTab.quick,
    pad: _navPad,
    title: 'Actions, your HR remote',
    body: 'Every HR task, one tap away. No forms, no follow-ups.',
  ),
  AppTourStop(
    chapter: 'ACTIONS',
    target: AppTourTarget.punchCard,
    tab: ManagerTab.quick,
    animation: AppTourAnimation.punch,
    radius: 30,
    title: 'Swipe to punch in',
    body: 'Like unlocking your phone. Slide in when you start, slide out when you leave.',
  ),
  AppTourStop(
    chapter: 'ACTIONS',
    target: AppTourTarget.punchCard,
    tab: ManagerTab.quick,
    radius: 30,
    title: 'Swipe to punch out',
    body: 'Like locking your phone at the end of the day. Slide again to punch out before you head home.',
  ),
  AppTourStop(
    chapter: 'ACTIONS · ATTENDANCE',
    target: AppTourTarget.attendanceTitle,
    tab: ManagerTab.quick,
    animation: AppTourAnimation.calendar,
    pad: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
    radius: 22,
    title: 'Your work calendar',
    body: 'Like your phone calendar, for work. Plan leave, spot holidays, fix missed punches.',
  ),
  AppTourStop(
    chapter: 'ACTIONS',
    target: AppTourTarget.actionTiles,
    tab: ManagerTab.quick,
    pad: EdgeInsets.all(8),
    radius: 25,
    title: 'Your HR speed dial',
    body: 'Leave, overtime, expenses, payslips and HR help, one tap each.',
  ),
  AppTourStop(
    chapter: 'GAMES TAB',
    target: AppTourTarget.navGames,
    tab: ManagerTab.games,
    pad: _navPad,
    title: 'Games, your office game night',
    body: 'Quick games with colleagues. Earn points and climb the leaderboard.',
  ),
  AppTourStop(
    chapter: 'PROFILE',
    target: AppTourTarget.avatar,
    tab: ManagerTab.connect,
    pad: EdgeInsets.all(9),
    radius: 25,
    title: 'Your digital ID card',
    body: 'Tap your photo for your details, org chart, settings and help.',
  ),
  AppTourStop(
    chapter: 'PROFILE · HELP',
    target: AppTourTarget.helpCard,
    profile: true,
    isNew: true,
    radius: 26,
    title: 'A help desk in your pocket',
    body: 'Stuck? Replay this tour, read FAQs or watch quick how-to videos.',
  ),
];

/// "Skip tour" and "Maybe later": the spotlight on the header photo.
const appTourSkippedStop = AppTourStop(
  chapter: 'TOUR SKIPPED',
  target: AppTourTarget.avatar,
  tab: ManagerTab.connect,
  pad: EdgeInsets.all(9),
  radius: 25,
  title: 'No worries, we’ll wait',
  body: 'Find the tour anytime under your profile photo › Help.',
);

/// The stops [manager] gets where the company has [tabs]: 13 for a manager,
/// 11 for anyone else, fewer where a tab is missing.
List<AppTourStop> appTourStopsFor({required bool manager, required Iterable<ManagerTab> tabs}) => [
  for (final stop in appTourStops)
    if ((manager || !stop.managerOnly) && (stop.tab == null || tabs.contains(stop.tab))) stop,
];

// ─── Starting it ────────────────────────────────────────────────────────────

abstract final class AppTour {
  static AppTourHost? _host;
  static OverlayEntry? _entry;
  static Completer<void>? _closed;

  /// The shell, while it is mounted.
  static void register(AppTourHost host) => _host = host;

  static void unregister(AppTourHost host) {
    if (!identical(_host, host)) return;
    _host = null;
    // The shell has gone (a log-out): so does a tour over it, once the
    // frame that took it away is done.
    if (_entry != null) WidgetsBinding.instance.addPostFrameCallback((_) => close());
  }

  static bool get isRunning => _entry != null;

  /// Runs the tour over the app: back to the tabs first (it is started from
  /// pages over them), then the start card ([intro]) or the first stop.
  /// [onComplete] runs when the finish card shows (not on Skip or Maybe
  /// later). Completes when the tour closes; at once when there is no shell.
  static Future<void> start(BuildContext context, {bool intro = true, FutureOr<void> Function()? onComplete}) {
    final host = _host;
    if (host == null) return Future.value();
    final navigator = Navigator.of(context);
    navigator.popUntil((route) => route.isFirst);
    final overlay = navigator.overlay;
    if (overlay == null) return Future.value();
    close();
    final closed = _closed = Completer<void>();
    late final OverlayEntry entry;
    entry = OverlayEntry(
      builder: (_) => AppTourOverlay(
        host: host,
        intro: intro,
        onComplete: onComplete,
        onClose: () {
          if (identical(_entry, entry)) close();
        },
      ),
    );
    _entry = entry;
    overlay.insert(entry);
    return closed.future;
  }

  /// Takes the tour off the screen.
  static void close() {
    final entry = _entry;
    _entry = null;
    if (entry != null && entry.mounted) entry.remove();
    final closed = _closed;
    _closed = null;
    if (closed != null && !closed.isCompleted) closed.complete();
  }
}

// ─── The overlay ────────────────────────────────────────────────────────────

/// rgba(12,20,36,0.68), the design's dim.
const _scrim = Color(0xAD0C1424);

enum _Mode { start, tour, done, skipped }

class AppTourOverlay extends StatefulWidget {
  const AppTourOverlay({super.key, required this.host, required this.onClose, this.intro = true, this.onComplete});

  final AppTourHost host;
  final VoidCallback onClose;
  final bool intro;
  final FutureOr<void> Function()? onComplete;

  @override
  State<AppTourOverlay> createState() => _AppTourOverlayState();
}

class _AppTourOverlayState extends State<AppTourOverlay> {
  late _Mode _mode = widget.intro ? _Mode.start : _Mode.tour;
  List<AppTourStop> _stops = const [];
  int _index = 0;
  bool _manager = false;

  /// The ring round the spotlit widget, in this overlay's coordinates.
  Rect? _ring;
  bool _busy = false;
  int _run = 0;

  /// [AppTourOverlay.onComplete] has run (a replay does not run it again).
  bool _completed = false;
  Timer? _follow;

  AppTourHost get _host => widget.host;

  AppTourStop? get _stop => switch (_mode) {
    _Mode.tour => _index < _stops.length ? _stops[_index] : null,
    _Mode.skipped => appTourSkippedStop,
    _ => null,
  };

  @override
  void initState() {
    super.initState();
    if (_mode == _Mode.tour) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_begin());
      });
    }
    // The spotlit widget can move under the tour (a feed loading, a card
    // growing): measured again a few times a second.
    _follow = Timer.periodic(const Duration(milliseconds: 300), (_) => _remeasure());
  }

  @override
  void dispose() {
    _follow?.cancel();
    _run++;
    super.dispose();
  }

  Future<void> _begin() async {
    _manager = _host.isManager();
    _stops = appTourStopsFor(manager: _manager, tabs: _host.tabs());
    setState(() {
      _mode = _Mode.tour;
      _ring = null;
    });
    await _show(0, forward: true, first: true);
  }

  /// Puts the app under stop [i] and the spotlight on it; a stop whose
  /// widget never shows is dropped and the next one (that way) taken.
  Future<void> _show(int i, {required bool forward, bool first = false}) async {
    final run = ++_run;
    setState(() => _busy = true);
    var at = i;
    var reset = first;
    while (at >= 0 && at < _stops.length) {
      final stop = _stops[at];
      _prepare(stop, reset: reset);
      reset = false;
      final ring = await _find(stop, run);
      if (!mounted || run != _run) return;
      if (ring != null) {
        setState(() {
          _index = at;
          _ring = ring;
          _busy = false;
        });
        return;
      }
      setState(() {
        _stops = [..._stops]..removeAt(at);
        // The stop on screen moves up with the list.
        if (at < _index) _index--;
      });
      if (!forward) at--;
    }
    if (!mounted) return;
    if (at >= _stops.length) {
      _busy = false;
      await _finish();
    } else {
      // Nothing left behind it: stay where it was.
      setState(() => _busy = false);
    }
  }

  void _prepare(AppTourStop stop, {bool reset = false}) {
    if (stop.profile) {
      _host.openHelp();
      return;
    }
    _host.closeProfile();
    final tab = stop.tab;
    if (tab != null) _host.showTab(tab, reset);
    final section = stop.section;
    if (section != null && _manager) _host.showTeamSection(section);
  }

  /// Waits (about two seconds at most) for [stop]'s widget, scrolls it into
  /// view, and gives its ring.
  Future<Rect?> _find(AppTourStop stop, int run) async {
    for (var tries = 0; tries < 40; tries++) {
      await WidgetsBinding.instance.endOfFrame;
      if (!mounted || run != _run) return null;
      final target = AppTourAnchors.contextOf(stop.target);
      if (target != null && target.mounted) {
        await _intoView(target);
        if (!mounted || run != _run) return null;
        final ring = _measure(stop);
        if (ring != null) return ring;
      }
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    return null;
  }

  Future<void> _intoView(BuildContext target) async {
    final box = target.findRenderObject();
    final screen = MediaQuery.sizeOf(context);
    if (box is! RenderBox || !box.hasSize) return;
    final top = box.localToGlobal(Offset.zero).dy;
    final bottom = top + box.size.height;
    final padding = MediaQuery.paddingOf(context);
    if (top >= padding.top && bottom <= screen.height - padding.bottom) return;
    if (Scrollable.maybeOf(target) == null) return;
    await Scrollable.ensureVisible(target, alignment: 0.2, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    await WidgetsBinding.instance.endOfFrame;
  }

  Rect? _measure(AppTourStop stop) {
    final box = AppTourAnchors.boxOf(stop.target);
    final self = context.findRenderObject();
    if (box == null || self is! RenderBox || !self.hasSize) return null;
    final rect = box.localToGlobal(Offset.zero, ancestor: self) & box.size;
    return Rect.fromLTRB(rect.left - stop.pad.left, rect.top - stop.pad.top, rect.right + stop.pad.right, rect.bottom + stop.pad.bottom);
  }

  void _remeasure() {
    final stop = _stop;
    if (!mounted || _busy || stop == null || _ring == null) return;
    final ring = _measure(stop);
    if (ring == null) return;
    final old = _ring!;
    if ((ring.topLeft - old.topLeft).distance > .5 || (ring.width - old.width).abs() > .5 || (ring.height - old.height).abs() > .5) {
      setState(() => _ring = ring);
    }
  }

  // ── Moves ─────────────────────────────────────────────────────────────────

  void _next() {
    if (_busy) return;
    if (_index >= _stops.length - 1) {
      unawaited(_finish());
    } else {
      unawaited(_show(_index + 1, forward: true));
    }
  }

  void _back() {
    if (_busy || _index == 0) return;
    unawaited(_show(_index - 1, forward: false));
  }

  Future<void> _finish() async {
    _run++;
    _home();
    setState(() {
      _mode = _Mode.done;
      _ring = null;
      _busy = false;
    });
    if (_completed) return;
    _completed = true;
    try {
      await widget.onComplete?.call();
    } catch (_) {
      // The tour was seen; a failed note of it is not hers to deal with.
    }
  }

  /// Skip tour, Maybe later: the spotlight on the header photo, where the
  /// tour lives.
  Future<void> _skip() async {
    final run = ++_run;
    setState(() {
      _busy = true;
      _mode = _Mode.skipped;
    });
    _prepare(appTourSkippedStop, reset: false);
    final ring = await _find(appTourSkippedStop, run);
    if (!mounted || run != _run) return;
    if (ring == null) {
      widget.onClose();
      return;
    }
    setState(() {
      _ring = ring;
      _busy = false;
    });
  }

  /// Connect's home, as the finish and the skipped cards sit over it.
  void _home() {
    _host.closeProfile();
    if (_host.tabs().contains(ManagerTab.connect)) _host.showTab(ManagerTab.connect, false);
  }

  void _replay() => unawaited(_begin());

  @override
  Widget build(BuildContext context) {
    final stop = _stop;
    final ring = _ring;
    final spot = (_mode == _Mode.tour || _mode == _Mode.skipped) && ring != null && stop != null;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 200),
      builder: (context, fade, child) => Opacity(opacity: fade, child: child),
      child: Material(
        type: MaterialType.transparency,
        child: DefaultTextStyle.merge(
          style: const TextStyle(decoration: TextDecoration.none),
          child: Stack(
            children: [
              // Nothing under the tour takes a tap; it moves itself.
              Positioned.fill(child: GestureDetector(behavior: HitTestBehavior.opaque, onTap: () {})),
              Positioned.fill(
                child: IgnorePointer(
                  child: spot
                      ? TweenAnimationBuilder<_Spot>(
                          tween: _SpotTween(end: _Spot(ring, stop.radius)),
                          duration: const Duration(milliseconds: 350),
                          curve: Curves.ease,
                          builder: (context, value, _) => CustomPaint(painter: _ScrimPainter(value)),
                        )
                      : const ColoredBox(color: _scrim),
                ),
              ),
              if (spot)
                Positioned.fill(
                  child: _TipLayout(
                    ring: ring,
                    insets: MediaQuery.paddingOf(context),
                    child: _mode == _Mode.skipped ? _skippedTip(stop) : _tourTip(stop),
                  ),
                ),
              if (_mode == _Mode.start) _CenterCard(child: _startCard()),
              if (_mode == _Mode.done) _CenterCard(child: _doneCard()),
            ],
          ),
        ),
      ),
    );
  }

  // ── Cards ─────────────────────────────────────────────────────────────────

  Widget _startCard() => Column(
    key: const ValueKey('app-tour-start-card'),
    mainAxisSize: MainAxisSize.min,
    children: [
      const AppTourGlobe(),
      const SizedBox(height: 16),
      Text('Let’s show you around', textAlign: TextAlign.center, style: tourText(21, FontWeight.w800, TourInk.ink, height: 1.25)),
      const SizedBox(height: 8),
      Text(
        'A quick tour of where everything lives in Connect. It takes about a minute.',
        textAlign: TextAlign.center,
        style: tourText(14, FontWeight.w400, TourInk.body, height: 1.55),
      ),
      const SizedBox(height: 22),
      _Pill(key: const ValueKey('app-tour-start'), label: 'Start tour', width: 200, height: 48, size: 15, onTap: () => unawaited(_begin())),
      const SizedBox(height: 6),
      _Quiet(key: const ValueKey('app-tour-later'), label: 'Maybe later', expand: true, onTap: () => unawaited(_skip())),
    ],
  );

  Widget _doneCard() {
    final name = _host.firstName().trim();
    return Column(
      key: const ValueKey('app-tour-done-card'),
      mainAxisSize: MainAxisSize.min,
      children: [
        const ExcludeSemantics(child: Image(image: AssetImage('assets/images/app_tour_done.png'), width: 52, height: 60)),
        const SizedBox(height: 16),
        Text(
          name.isEmpty ? 'You’re all set' : 'You’re all set, $name',
          textAlign: TextAlign.center,
          style: tourText(21, FontWeight.w800, TourInk.ink, height: 1.25),
        ),
        const SizedBox(height: 8),
        Text(
          'Go punch in, post a hello or top the leaderboard. The tour lives in Profile › Help.',
          textAlign: TextAlign.center,
          style: tourText(14, FontWeight.w400, TourInk.body, height: 1.55),
        ),
        const SizedBox(height: 22),
        _Pill(key: const ValueKey('app-tour-explore'), label: 'Start exploring', expand: true, height: 48, size: 15, onTap: widget.onClose),
        const SizedBox(height: 6),
        _Quiet(key: const ValueKey('app-tour-replay'), label: 'Replay tour', expand: true, onTap: _replay),
      ],
    );
  }

  Widget _chip(String text, {required Color bg, required Color fg, double spacing = .7}) => Container(
    height: 22,
    padding: const EdgeInsets.symmetric(horizontal: 8),
    alignment: Alignment.center,
    decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
    child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: tourText(11, FontWeight.w800, fg, letterSpacing: spacing)),
  );

  Widget _heading(AppTourStop stop, {String? counter}) => Row(
    children: [
      Expanded(
        child: Row(
          children: [
            Flexible(child: _chip(stop.chapter, bg: const Color(0xFFE8F2F9), fg: TourInk.blue)),
            if (stop.managerOnly) ...[const SizedBox(width: 8), _chip('MANAGER', bg: const Color(0xFFF1EDF8), fg: const Color(0xFF5B3E96), spacing: .5)],
            if (stop.isNew) ...[const SizedBox(width: 8), _chip('NEW', bg: const Color(0xFFB23500), fg: Colors.white, spacing: 0)],
          ],
        ),
      ),
      if (counter != null) ...[
        const SizedBox(width: 8),
        Text(counter, key: const ValueKey('app-tour-counter'), style: tourText(12, FontWeight.w700, TourInk.muted)),
      ],
    ],
  );

  Widget _words(AppTourStop stop) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    mainAxisSize: MainAxisSize.min,
    children: [
      const SizedBox(height: 8),
      Text(stop.title, key: const ValueKey('app-tour-title'), style: tourText(17, FontWeight.w800, TourInk.ink, height: 1.3)),
      const SizedBox(height: 6),
      Text(stop.bodyFor(manager: _manager), style: tourText(14, FontWeight.w400, TourInk.body, height: 1.5)),
      const SizedBox(height: 14),
    ],
  );

  Widget _tourTip(AppTourStop stop) {
    final total = _stops.length;
    final last = _index >= total - 1;
    final animation = stop.animation;
    return Column(
      key: ValueKey('app-tour-tip-$_index'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (animation != null) ...[
          AppTourAnimationPanel(key: ValueKey('app-tour-animation-${animation.name}'), kind: animation),
          const SizedBox(height: 14),
        ],
        LayoutBuilder(
          builder: (context, constraints) => Container(
            height: 4,
            alignment: Alignment.centerLeft,
            decoration: BoxDecoration(color: const Color(0xFFEDEDF0), borderRadius: BorderRadius.circular(2)),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 350),
              curve: Curves.ease,
              width: constraints.maxWidth * (_index + 1) / math.max(total, 1),
              decoration: BoxDecoration(color: TourInk.blue, borderRadius: BorderRadius.circular(2)),
            ),
          ),
        ),
        const SizedBox(height: 12),
        _heading(stop, counter: '${_index + 1} of $total'),
        _words(stop),
        Row(
          children: [
            Flexible(
              child: Align(
                alignment: Alignment.centerLeft,
                child: _Quiet(key: const ValueKey('app-tour-skip'), label: 'Skip tour', onTap: () => unawaited(_skip())),
              ),
            ),
            const SizedBox(width: 8),
            if (_index > 0) ...[
              _Outline(key: const ValueKey('app-tour-back'), label: 'Back', onTap: _back),
              const SizedBox(width: 8),
            ],
            _Pill(key: const ValueKey('app-tour-next'), label: last ? 'Finish' : 'Next', onTap: _next),
          ],
        ),
      ],
    );
  }

  Widget _skippedTip(AppTourStop stop) => Column(
    key: const ValueKey('app-tour-skipped'),
    crossAxisAlignment: CrossAxisAlignment.stretch,
    mainAxisSize: MainAxisSize.min,
    children: [
      _heading(stop),
      _words(stop),
      Align(
        alignment: Alignment.centerRight,
        child: _Pill(key: const ValueKey('app-tour-got-it'), label: 'Got it', padding: 24, onTap: widget.onClose),
      ),
    ],
  );
}

// ─── The spotlight ──────────────────────────────────────────────────────────

@immutable
class _Spot {
  const _Spot(this.ring, this.radius);

  final Rect ring;
  final double radius;
}

class _SpotTween extends Tween<_Spot> {
  _SpotTween({super.end});

  @override
  _Spot lerp(double t) {
    final a = begin ?? end!, b = end!;
    return _Spot(Rect.lerp(a.ring, b.ring, t)!, a.radius + (b.radius - a.radius) * t);
  }
}

/// The dim with its hole, 5 inside a 2 px white ring (the design's hole and
/// ring boxes).
class _ScrimPainter extends CustomPainter {
  _ScrimPainter(this.spot);

  final _Spot spot;

  @override
  void paint(Canvas canvas, Size size) {
    final ring = spot.ring;
    final hole = RRect.fromRectAndRadius(ring.deflate(5), Radius.circular(math.max(spot.radius - 5, 4)));
    canvas.drawPath(
      Path()
        ..fillType = PathFillType.evenOdd
        ..addRect(Offset.zero & size)
        ..addRRect(hole),
      Paint()..color = _scrim,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(ring.deflate(1), Radius.circular(math.max(spot.radius - 1, 0))),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = Colors.white,
    );
  }

  @override
  bool shouldRepaint(_ScrimPainter old) => old.spot.ring != spot.ring || old.spot.radius != spot.radius;
}

/// The card under the ring when there is room there, else over it, with its
/// caret pointing at the ring's middle; kept on the screen.
class _TipLayout extends StatelessWidget {
  const _TipLayout({required this.ring, required this.insets, required this.child});

  final Rect ring;

  /// The status bar and home indicator, kept clear.
  final EdgeInsets insets;
  final Widget child;

  static const _gap = 8.0;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final size = constraints.biggest;
      final width = math.min(358.0, size.width - 32);
      final left = (size.width - width) / 2;
      final below = size.height - insets.bottom - ring.bottom >= ring.top - insets.top;
      final caretX = (ring.center.dx - left - 8).clamp(18.0, width - 34);
      final card = Semantics(
        container: true,
        explicitChildNodes: true,
        label: 'App tour',
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              key: const ValueKey('app-tour-tip'),
              width: width,
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(18),
                boxShadow: const [BoxShadow(color: Color(0x47000000), blurRadius: 16, offset: Offset(0, 12))],
              ),
              child: child,
            ),
            Positioned(
              left: caretX,
              top: below ? -8 : null,
              bottom: below ? null : -8,
              child: CustomPaint(size: const Size(16, 8), painter: _CaretPainter(up: below)),
            ),
          ],
        ),
      );
      return CustomSingleChildLayout(
        delegate: _TipDelegate(ring: ring, below: below, left: left, gap: _gap, insets: insets),
        child: card,
      );
    },
  );
}

class _TipDelegate extends SingleChildLayoutDelegate {
  _TipDelegate({required this.ring, required this.below, required this.left, required this.gap, required this.insets});

  final Rect ring;
  final bool below;
  final double left;
  final double gap;
  final EdgeInsets insets;

  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) => constraints.loosen();

  @override
  Offset getPositionForChild(Size size, Size childSize) {
    const margin = 8.0;
    final minTop = insets.top + margin;
    final maxTop = math.max(minTop, size.height - insets.bottom - childSize.height - margin);
    final top = below ? ring.bottom + gap : ring.top - gap - childSize.height;
    return Offset(left, top.clamp(minTop, maxTop));
  }

  @override
  bool shouldRelayout(_TipDelegate old) => old.ring != ring || old.below != below || old.left != left || old.insets != insets;
}

class _CaretPainter extends CustomPainter {
  const _CaretPainter({required this.up});

  final bool up;

  @override
  void paint(Canvas canvas, Size size) {
    final path = up
        ? (Path()
            ..moveTo(0, size.height)
            ..lineTo(size.width / 2, 0)
            ..lineTo(size.width, size.height))
        : (Path()
            ..moveTo(0, 0)
            ..lineTo(size.width / 2, size.height)
            ..lineTo(size.width, 0));
    canvas.drawPath(path..close(), Paint()..color = Colors.white);
  }

  @override
  bool shouldRepaint(_CaretPainter old) => old.up != up;
}

/// The start and finish cards: white, 330 wide, in the middle of the dim.
class _CenterCard extends StatelessWidget {
  const _CenterCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Positioned.fill(
    child: SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Semantics(
            container: true,
            explicitChildNodes: true,
            label: 'App tour',
            child: Container(
              width: 330,
              padding: const EdgeInsets.fromLTRB(24, 28, 24, 22),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(22)),
              child: child,
            ),
          ),
        ),
      ),
    ),
  );
}

// ─── Buttons ────────────────────────────────────────────────────────────────

class _Pill extends StatelessWidget {
  const _Pill({super.key, required this.label, required this.onTap, this.width, this.height = 44, this.size = 14, this.padding = 22, this.expand = false});

  final String label;
  final VoidCallback onTap;
  final double? width;
  final double height;
  final double size;
  final double padding;
  final bool expand;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: expand ? double.infinity : width,
    height: height,
    child: FilledButton(
      onPressed: onTap,
      style: FilledButton.styleFrom(
        backgroundColor: TourInk.blue,
        foregroundColor: Colors.white,
        padding: EdgeInsets.symmetric(horizontal: padding),
        minimumSize: Size(0, height),
        shape: const StadiumBorder(),
        textStyle: tourText(size, FontWeight.w800, Colors.white),
      ),
      child: Text(label),
    ),
  );
}

class _Outline extends StatelessWidget {
  const _Outline({super.key, required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 44,
    child: OutlinedButton(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        backgroundColor: Colors.white,
        foregroundColor: TourInk.ink,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        minimumSize: const Size(0, 44),
        side: const BorderSide(color: Color(0xFFD5D5DC), width: 1.5),
        shape: const StadiumBorder(),
        textStyle: tourText(14, FontWeight.w700, TourInk.ink),
      ),
      child: Text(label),
    ),
  );
}

class _Quiet extends StatelessWidget {
  const _Quiet({super.key, required this.label, required this.onTap, this.expand = false});

  final String label;
  final VoidCallback onTap;
  final bool expand;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: expand ? double.infinity : null,
    height: 44,
    child: TextButton(
      onPressed: onTap,
      style: TextButton.styleFrom(
        foregroundColor: TourInk.quiet,
        padding: const EdgeInsets.symmetric(horizontal: 4),
        minimumSize: const Size(0, 44),
        shape: const StadiumBorder(),
        textStyle: tourText(14, FontWeight.w700, TourInk.quiet),
      ),
      child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
    ),
  );
}

// ─── Profile › Help ─────────────────────────────────────────────────────────

/// Profile › Help's "App tour" card: the tour again, from its first stop.
class AppTourHelpCard extends StatelessWidget {
  const AppTourHelpCard({super.key, this.onStart});

  /// Instead of starting the tour (tests).
  final VoidCallback? onStart;

  @override
  Widget build(BuildContext context) => AppTourAnchor(
    target: AppTourTarget.helpCard,
    child: Container(
      key: const ValueKey('app-tour-help-card'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFEBEBEB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: const BoxDecoration(color: TourInk.panel, shape: BoxShape.circle),
                padding: const EdgeInsets.all(6),
                child: const ExcludeSemantics(child: Image(image: AssetImage(AppTourGlobe.globeAsset))),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('App tour', style: tourText(16, FontWeight.w800, TourInk.ink)),
                    const SizedBox(height: 2),
                    Text('Where everything lives, in about a minute.', style: tourText(13, FontWeight.w400, TourInk.body, height: 1.4)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          SizedBox(
            height: 36,
            child: FilledButton(
              key: const ValueKey('app-tour-help-start'),
              onPressed: onStart ?? () => unawaited(AppTour.start(context, intro: false)),
              style: FilledButton.styleFrom(
                backgroundColor: TourInk.blue,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                minimumSize: const Size(0, 36),
                shape: const StadiumBorder(),
                textStyle: tourText(13, FontWeight.w800, Colors.white),
              ),
              child: const Text('Start the app tour'),
            ),
          ),
        ],
      ),
    ),
  );
}
