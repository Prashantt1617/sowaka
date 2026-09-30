import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../auth/data/auth_models.dart';
import '../../manager/presentation/manager_screen.dart';
import '../../shared/app_toast.dart';
import '../data/garden_api_service.dart';
import '../data/garden_models.dart';
import 'garden_layout.dart';
import 'garden_painters.dart';
import 'garden_search.dart';
import 'floating_tree.dart';
import 'garden_widgets.dart';
import 'give_flow.dart';
import 'tree_screen.dart';

/// The Gratitude Garden: one meadow with everyone's tree on it, to pan and
/// zoom through, and beside it the timeline of everything given this season.
class GardenScreen extends StatefulWidget {
  const GardenScreen({super.key, required this.session, this.service});

  final AuthSession session;
  final GardenApiService? service;

  @override
  State<GardenScreen> createState() => _GardenScreenState();
}

class _GardenScreenState extends State<GardenScreen> {
  late final GardenApiService _service = widget.service ?? GardenApiService(session: widget.session);
  GardenView? _garden;
  GardenLayout? _layout;
  String? _error;
  bool _timeline = false;
  List<GardenNote>? _notes;
  final _transform = TransformationController();
  bool _centred = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _transform.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final garden = await _service.garden();
      if (!mounted) return;
      setState(() {
        _garden = garden;
        _layout = GardenLayout.build(garden.people);
        _error = null;
      });
      if (!_centred) {
        _centred = true;
        WidgetsBinding.instance.addPostFrameCallback((_) => _findMe(animate: false));
      }
      if (_timeline) _loadTimeline();
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error is GardenApiException ? error.message : 'Could not open the garden.');
    }
  }

  Future<void> _loadTimeline() async {
    try {
      final notes = await _service.timeline();
      if (mounted) setState(() => _notes = notes);
    } catch (error) {
      if (mounted) showAppToast(context, error is GardenApiException ? error.message : 'Could not load the timeline.');
    }
  }

  Size get _viewport {
    final size = MediaQuery.sizeOf(context);
    return Size(size.width, size.height);
  }

  void _findMe({bool animate = true}) {
    final layout = _layout;
    final me = _garden?.me;
    if (layout == null || me == null) return;
    final plot = layout.plotOf(me.userId);
    if (plot == null) return;
    const scale = 1.0;
    final v = _viewport;
    final target = plot.foot - const Offset(0, GardenLayout.treeWidth * GardenTree.aspect * .5);
    final m = Matrix4.identity()
      ..translateByDouble(v.width / 2 - target.dx * scale, v.height / 2 - target.dy * scale, 0, 1)
      ..scaleByDouble(scale, scale, 1, 1);
    _transform.value = m;
  }

  void _zoom(double factor) {
    final v = _viewport;
    final centre = Offset(v.width / 2, v.height / 2);
    final current = _transform.value.clone();
    final scale = current.getMaxScaleOnAxis();
    final next = (scale * factor).clamp(0.45, 2.5);
    final f = next / scale;
    // Zoom about the middle of the screen, so what you were looking at stays.
    final m = Matrix4.identity()
      ..translateByDouble(centre.dx, centre.dy, 0, 1)
      ..scaleByDouble(f, f, 1, 1)
      ..translateByDouble(-centre.dx, -centre.dy, 0, 1);
    _transform.value = m * current;
  }

  Future<void> _openTree(GardenPerson person) async {
    final garden = _garden;
    if (garden == null) return;
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => TreeScreen(
          service: _service,
          person: person,
          companyName: widget.session.user.company,
          leftToday: garden.leftToday,
          dailyLimit: garden.dailyLimit,
        ),
      ),
    );
    if (changed == true) _load();
  }

  Future<void> _search() async {
    final garden = _garden;
    if (garden == null) return;
    final person = await Navigator.of(context).push<GardenPerson>(
      MaterialPageRoute(builder: (_) => GardenSearchScreen(people: garden.people, trees: garden.trees)),
    );
    if (person != null && mounted) _openTree(person);
  }

  Future<void> _give() async {
    final garden = _garden;
    if (garden == null) return;
    if (garden.leftToday == 0) {
      showAppToast(context, 'That is ${_words(garden.dailyLimit)} for today. The garden opens again tomorrow.');
      return;
    }
    final person = await Navigator.of(context).push<GardenPerson>(
      MaterialPageRoute(builder: (_) => GardenSearchScreen(people: garden.people, trees: garden.trees, title: 'Who are you thanking?')),
    );
    if (person == null || !mounted) return;
    final note = await Navigator.of(context).push<GardenNote>(
      MaterialPageRoute(
        builder: (_) => GiveFlowScreen(service: _service, to: person, companyName: widget.session.user.company, leftToday: garden.leftToday, dailyLimit: garden.dailyLimit),
      ),
    );
    if (note == null || !mounted) return;
    showAppToast(context, 'You added a ${note.kindInfo.name.toLowerCase()} to ${person.isMe ? 'your' : "${person.firstName}'s"} tree');
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final garden = _garden;
    final layout = _layout;
    final top = MediaQuery.paddingOf(context).top;
    return Scaffold(
      backgroundColor: MeadowPainter.grassMid,
      body: Stack(
        children: [
          if (garden == null || layout == null)
            Center(
              child: _error == null
                  ? const CircularProgressIndicator(color: GardenColors.blue)
                  : Padding(padding: const EdgeInsets.all(32), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: MColors.ink))),
            )
          else if (_timeline)
            _Timeline(notes: _notes, topInset: top + 104, bottomInset: MediaQuery.paddingOf(context).bottom + 16)
          else
            Positioned.fill(
              child: InteractiveViewer(
                transformationController: _transform,
                constrained: false,
                minScale: 0.45,
                maxScale: 2.5,
                boundaryMargin: const EdgeInsets.all(240),
                child: _Meadow(layout: layout, garden: garden, onTree: _openTree),
              ),
            ),
          Positioned(
            left: 0,
            right: 0,
            top: 0,
            child: GardenTopBar(
              title: 'Gratitude Garden',
              subtitle: garden == null ? null : '${_seasonName(garden.season)} · ${garden.daysLeft} ${garden.daysLeft == 1 ? 'day' : 'days'} left',
              onBack: () => Navigator.of(context).pop(),
              transparent: true,
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  ValueListenableBuilder<bool>(
                    valueListenable: FloatingTreeSettings.enabled,
                    builder: (_, on, _) => RoundTile(
                      label: on ? 'Hide my tree from other screens' : 'Show my tree on every screen',
                      onTap: () => FloatingTreeSettings.set(!on),
                      child: Icon(on ? Icons.park_rounded : Icons.park_outlined, color: on ? GardenColors.blue : MColors.inkSoft, size: 20),
                    ),
                  ),
                  const SizedBox(width: 8),
                  RoundTile(label: 'Find someone', onTap: _search, child: const Icon(Icons.search_rounded, color: MColors.inkSoft, size: 20)),
                ],
              ),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            top: top + 62,
            child: _Segments(
              timeline: _timeline,
              onChanged: (timeline) {
                setState(() => _timeline = timeline);
                if (timeline && _notes == null) _loadTimeline();
              },
            ),
          ),
          if (!_timeline && garden != null)
            Positioned(
              right: 14,
              bottom: MediaQuery.paddingOf(context).bottom + 84,
              child: Column(
                spacing: 8,
                children: [
                  RoundTile(label: 'Zoom in', onTap: () => _zoom(1.25), child: const Icon(Icons.add_rounded, color: MColors.ink, size: 20)),
                  RoundTile(label: 'Zoom out', onTap: () => _zoom(0.8), child: const Icon(Icons.remove_rounded, color: MColors.ink, size: 20)),
                  RoundTile(label: 'Find my tree', onTap: _findMe, child: const Text('me', style: TextStyle(color: MColors.ink, fontSize: 11.5, fontWeight: FontWeight.w800))),
                ],
              ),
            ),
          if (!_timeline && garden != null)
            Positioned(
              left: 16,
              right: 16,
              bottom: MediaQuery.paddingOf(context).bottom + 16,
              child: ActionButton(
                label: 'Give gratitude',
                icon: Icons.local_florist_rounded,
                background: GardenColors.blue,
                foreground: Colors.white,
                onTap: _give,
              ),
            ),
        ],
      ),
    );
  }

  static String _words(int n) => const ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'].elementAtOrNull(n) ?? '$n';

  static String _seasonName(String season) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    final parts = season.split('-');
    if (parts.length != 2) return season;
    final m = int.tryParse(parts[1]) ?? 1;
    return months[(m - 1).clamp(0, 11)];
  }
}

class _Segments extends StatelessWidget {
  const _Segments({required this.timeline, required this.onChanged});

  final bool timeline;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    Widget seg(String label, bool on, bool value) => Expanded(
      child: GestureDetector(
        onTap: () => onChanged(value),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(color: on ? MColors.ink : Colors.transparent, borderRadius: BorderRadius.circular(10)),
          child: Text(label, textAlign: TextAlign.center, style: TextStyle(color: on ? Colors.white : MColors.inkSoft, fontSize: 12.5, fontWeight: FontWeight.w700)),
        ),
      ),
    );
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: Colors.white.withValues(alpha: .94), borderRadius: BorderRadius.circular(12), boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 8, offset: Offset(0, 2))]),
      child: Row(children: [seg('Garden', !timeline, false), seg('Timeline', timeline, true)]),
    );
  }
}

/// The meadow at world size: the painted ground, then a tree per person,
/// the lowest drawn last so trunks overlap canopies the natural way.
class _Meadow extends StatelessWidget {
  const _Meadow({required this.layout, required this.garden, required this.onTree});

  final GardenLayout layout;
  final GardenView garden;
  final ValueChanged<GardenPerson> onTree;

  @override
  Widget build(BuildContext context) {
    final plots = [...layout.plots]..sort((a, b) => a.foot.dy.compareTo(b.foot.dy));
    const w = GardenLayout.treeWidth;
    const h = w * GardenTree.aspect;
    final r = Random(7);
    return SizedBox(
      width: layout.worldSize.width,
      height: layout.worldSize.height,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned.fill(child: CustomPaint(painter: MeadowPainter(decor: layout.decor))),
          for (var i = 0; i < 4; i++)
            Positioned(
              left: 40 + r.nextDouble() * (layout.worldSize.width - 80),
              top: 60 + r.nextDouble() * (layout.worldSize.height - 120),
              child: IgnorePointer(child: SvgPicture.asset(i.isEven ? 'assets/garden/butterfly.svg' : 'assets/garden/bee.svg', width: i.isEven ? 20 : 15)),
            ),
          for (final plot in plots)
            Positioned(
              left: plot.foot.dx - w / 2,
              top: plot.foot.dy - h,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => onTree(plot.person),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Stack(
                      clipBehavior: Clip.none,
                      alignment: Alignment.bottomCenter,
                      children: [
                        if (plot.person.isMe)
                          Positioned(
                            bottom: 6,
                            child: Container(
                              width: 120,
                              height: 28,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(60),
                                gradient: RadialGradient(colors: [GardenColors.blue.withValues(alpha: .28), GardenColors.blue.withValues(alpha: 0)]),
                              ),
                            ),
                          ),
                        GardenTree(width: w, sprites: garden.trees[plot.person.userId] ?? const [], spriteSize: plot.person.isMe ? 22 : 19),
                      ],
                    ),
                    Transform.translate(
                      offset: const Offset(0, -6),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                        decoration: BoxDecoration(
                          color: plot.person.isMe ? GardenColors.blue : Colors.white.withValues(alpha: .92),
                          borderRadius: BorderRadius.circular(999),
                          boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 3, offset: Offset(0, 1))],
                        ),
                        child: Text(
                          plot.person.isMe ? 'You' : plot.person.firstName,
                          style: TextStyle(color: plot.person.isMe ? Colors.white : MColors.ink, fontSize: 12, fontWeight: FontWeight.w700),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Everything given this season, rising on its own. Nothing to scroll, tap
/// or pause: it is watched, not worked.
class _Timeline extends StatefulWidget {
  const _Timeline({required this.notes, required this.topInset, required this.bottomInset});

  final List<GardenNote>? notes;
  final double topInset;
  final double bottomInset;

  @override
  State<_Timeline> createState() => _TimelineState();
}

class _TimelineState extends State<_Timeline> with SingleTickerProviderStateMixin {
  final _scroll = ScrollController();
  late final Ticker _ticker = createTicker(_tick);
  Duration _last = Duration.zero;

  /// Pixels per second. Slow enough to read, fast enough to feel alive.
  static const speed = 22.0;

  @override
  void initState() {
    super.initState();
    _ticker.start();
  }

  @override
  void dispose() {
    _ticker.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _tick(Duration elapsed) {
    final dt = (elapsed - _last).inMicroseconds / 1e6;
    _last = elapsed;
    if (!_scroll.hasClients || dt <= 0 || dt > 0.5) return;
    final max = _scroll.position.maxScrollExtent;
    if (max <= 0) return;
    var next = _scroll.offset + speed * dt;
    // The list is shown twice; halfway through is the same picture as the
    // start, so jump back there and nobody sees the seam.
    if (next >= max / 2) next -= max / 2;
    _scroll.jumpTo(next);
  }

  @override
  Widget build(BuildContext context) {
    final notes = widget.notes;
    if (notes == null) return const Center(child: CircularProgressIndicator(color: GardenColors.blue));
    if (notes.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text('Nothing given yet this month. Be the first.', textAlign: TextAlign.center, style: TextStyle(color: MColors.ink.withValues(alpha: .8), fontSize: 14)),
        ),
      );
    }
    final ordered = notes.reversed.toList();
    final rows = [...ordered, ...ordered];
    return Container(
      color: const Color(0xFFEEF6EA),
      padding: EdgeInsets.only(top: widget.topInset),
      child: Stack(
        children: [
          IgnorePointer(
            child: ListView.builder(
              controller: _scroll,
              physics: const NeverScrollableScrollPhysics(),
              padding: EdgeInsets.fromLTRB(16, 8, 16, widget.bottomInset),
              itemCount: rows.length,
              itemBuilder: (_, index) => Padding(padding: const EdgeInsets.only(bottom: 10), child: _TimelineCard(note: rows[index])),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            top: 0,
            height: 36,
            child: IgnorePointer(
              child: DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [const Color(0xFFEEF6EA), const Color(0xFFEEF6EA).withValues(alpha: 0)]))),
            ),
          ),
          Positioned(
            right: 20,
            top: 10,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(999), boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 3)]),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _Blink(),
                  SizedBox(width: 5),
                  Text('Live', style: TextStyle(color: GardenColors.blue, fontSize: 10.5, fontWeight: FontWeight.w800)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Blink extends StatefulWidget {
  const _Blink();

  @override
  State<_Blink> createState() => _BlinkState();
}

class _BlinkState extends State<_Blink> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween(begin: 1.0, end: .25).animate(_c),
      child: Container(width: 7, height: 7, decoration: const BoxDecoration(color: GardenColors.blue, shape: BoxShape.circle)),
    );
  }
}

class _TimelineCard extends StatelessWidget {
  const _TimelineCard({required this.note});

  final GardenNote note;

  @override
  Widget build(BuildContext context) {
    final kind = note.kindInfo;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 11, 12, 11),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: MColors.line)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          KindIcon(kind.key, size: 30),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(
                  TextSpan(children: [
                    TextSpan(text: note.fromName, style: const TextStyle(fontWeight: FontWeight.w800)),
                    const TextSpan(text: '  →  ', style: TextStyle(color: MColors.inkFaint)),
                    TextSpan(text: note.fromUserId == note.toUserId ? 'themselves' : note.toName, style: const TextStyle(fontWeight: FontWeight.w800)),
                    TextSpan(text: '  ·  ${kind.name}', style: const TextStyle(color: MColors.inkSoft, fontWeight: FontWeight.w600)),
                  ]),
                  style: const TextStyle(color: MColors.ink, fontSize: 12.5),
                ),
                const SizedBox(height: 4),
                Text('"${note.note}"', style: const TextStyle(color: MColors.ink, fontSize: 13, height: 1.4)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
