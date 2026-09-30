import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../manager/presentation/manager_screen.dart';
import '../data/garden_api_service.dart';
import '../data/garden_models.dart';
import 'garden_layout.dart';
import 'garden_widgets.dart';

/// What giving did, shown on both trees: the flower crosses from yours to
/// theirs and settles, then the fruit that grew drops onto yours. Two lines
/// say the same in words, and one button returns to the garden.
///
/// The trees are fetched fresh so what is already on them is right; the two
/// new notes are held back and animated on.
class GiveSuccessScreen extends StatefulWidget {
  const GiveSuccessScreen({
    super.key,
    required this.service,
    required this.to,
    required this.gift,
    required this.companyName,
  });

  final GardenApiService service;
  final GardenPerson to;
  final GardenGift gift;
  final String companyName;

  @override
  State<GiveSuccessScreen> createState() => _GiveSuccessScreenState();
}

class _GiveSuccessScreenState extends State<GiveSuccessScreen> with SingleTickerProviderStateMixin {
  List<GardenSprite>? _mine;
  List<GardenSprite>? _theirs;
  late final AnimationController _anim = AnimationController(vsync: this, duration: const Duration(milliseconds: 4200));

  // Where each beat falls, as a fraction of the whole.
  static const _flyStart = .06, _flyEnd = .42, _dropStart = .56, _dropEnd = .88;

  bool get _self => widget.to.isMe;
  GardenNote get _flower => widget.gift.note;
  GardenNote? get _fruit => widget.gift.grown;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _anim.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final held = {_flower.id, if (_fruit case final f?) f.id};
    List<GardenSprite> sprites(TreeView tree) => [
      for (final n in tree.notes)
        if (!held.contains(n.id)) GardenSprite(id: n.id, kind: n.kind, fromUserId: n.fromUserId),
    ];
    try {
      final mine = await widget.service.tree(_flower.fromUserId);
      final theirs = _self ? mine : await widget.service.tree(widget.to.userId);
      if (!mounted) return;
      setState(() {
        _mine = sprites(mine);
        _theirs = sprites(theirs);
      });
    } catch (_) {
      // The trees can still be drawn bare; what matters is the two new ones.
      if (!mounted) return;
      setState(() {
        _mine = const [];
        _theirs = const [];
      });
    }
    if (!mounted) return;
    if (MediaQuery.of(context).disableAnimations) {
      _anim.value = 1;
    } else {
      _anim.forward();
    }
  }

  @override
  Widget build(BuildContext context) {
    final mine = _mine;
    final theirs = _theirs;
    final first = widget.to.firstName;
    return Scaffold(
      backgroundColor: MColors.bg,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 18, 16, 8),
                children: [
                  Text(
                    _self ? 'Your tree grew 🌸' : "$first's tree grew 🌸",
                    key: const ValueKey('give-success-title'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontFamily: 'Sora', color: MColors.ink, fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: -.4),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Everyone at ${widget.companyName} can see it now.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: MColors.inkSoft, fontSize: 13.5),
                  ),
                  const SizedBox(height: 14),
                  if (mine == null || theirs == null)
                    const SizedBox(height: 260, child: Center(child: CircularProgressIndicator(color: GardenColors.blue)))
                  else
                    _stage(mine, theirs),
                  const SizedBox(height: 10),
                  AnimatedBuilder(
                    animation: _anim,
                    builder: (_, _) => Column(
                      children: [
                        _Line(
                          kind: _flower.kind,
                          title: _self ? 'You added a ${_flower.kindInfo.name} to your tree' : 'You gave $first a ${_flower.kindInfo.name}',
                          sub: _flower.kindInfo.meaning,
                          shown: _reveal(_self ? _dropEnd : _flyEnd),
                        ),
                        if (_fruit case final fruit?) ...[
                          const SizedBox(height: 8),
                          _Line(
                            kind: fruit.kind,
                            title: 'A ${fruit.kindInfo.name} grew on your tree',
                            sub: fruit.grown?.line ?? 'Grew when you gave $first a ${_flower.kindInfo.name}',
                            shown: _reveal(_dropEnd),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
              child: ActionButton(
                label: 'Back to the garden',
                background: GardenColors.blue,
                foreground: Colors.white,
                onTap: () => Navigator.of(context).pop(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// 0 before [at], 1 a tenth later.
  double _reveal(double at) => ((_anim.value - at) / .1).clamp(0.0, 1.0);

  Widget _stage(List<GardenSprite> mine, List<GardenSprite> theirs) {
    return LayoutBuilder(
      builder: (context, box) {
        final w = box.maxWidth;
        final treeW = _self ? math.min(w * .5, 190.0) : math.min((w - 16) / 2, 170.0);
        final treeH = treeW * GardenTree.aspect;
        final leftX = _self ? (w - treeW) / 2 : (w / 2 - 8) - treeW;
        final rightX = w / 2 + 8;
        Offset canopy(double x, String id) {
          final p = spritePlace(id);
          return Offset(
            x + treeW * GardenTree.canopyCx + p.dx * treeW * GardenTree.canopyRx,
            treeH * GardenTree.canopyCy + p.dy * treeH * GardenTree.canopyRy,
          );
        }

        final flowerAt = canopy(_self ? leftX : rightX, _flower.id);
        final fruitAt = _fruit == null ? null : canopy(leftX, _fruit!.id);
        final from = Offset(leftX + treeW * GardenTree.canopyCx, treeH * GardenTree.canopyCy);

        return SizedBox(
          height: treeH + 34,
          child: AnimatedBuilder(
            animation: _anim,
            builder: (_, _) {
              final t = _anim.value;
              final flowerLanded = t >= (_self ? _dropEnd : _flyEnd);
              final fruitLanded = _fruit != null && t >= _dropEnd;
              final flowerSprite = GardenSprite(id: _flower.id, kind: _flower.kind, fromUserId: _flower.fromUserId);
              final fruitSprite = _fruit == null ? null : GardenSprite(id: _fruit!.id, kind: _fruit!.kind, fromUserId: _fruit!.fromUserId);
              final mySprites = [...mine, if (fruitLanded && fruitSprite != null) fruitSprite, if (_self && flowerLanded) flowerSprite];
              final theirSprites = [...theirs, if (!_self && flowerLanded) flowerSprite];
              return Stack(
                clipBehavior: Clip.none,
                children: [
                  _tree(leftX, treeW, mySprites, 'Your tree', highlight: fruitLanded ? _fruit!.id : (_self && flowerLanded ? _flower.id : null), popAt: fruitLanded ? _pop(_dropEnd) : (_self && flowerLanded ? _pop(_dropEnd) : 1)),
                  if (!_self)
                    _tree(rightX, treeW, theirSprites, "${widget.to.firstName}'s tree", highlight: flowerLanded ? _flower.id : null, popAt: flowerLanded ? _pop(_flyEnd) : 1),
                  // The flower on its way: an arc from your canopy to theirs,
                  // or straight down onto your own.
                  if (!flowerLanded && t > (_self ? _dropStart : _flyStart))
                    _flying(
                      kind: _flower.kind,
                      at: _self
                          ? Offset.lerp(Offset(flowerAt.dx, -30), flowerAt, Curves.easeOut.transform(_frac(t, _dropStart, _dropEnd)))!
                          : _arc(from, flowerAt, Curves.easeInOut.transform(_frac(t, _flyStart, _flyEnd))),
                    ),
                  // The fruit dropping in from above.
                  if (fruitAt != null && !fruitLanded && t > _dropStart)
                    _flying(
                      kind: _fruit!.kind,
                      at: Offset.lerp(Offset(fruitAt.dx, -30), fruitAt, Curves.bounceOut.transform(_frac(t, _dropStart, _dropEnd)))!,
                    ),
                ],
              );
            },
          ),
        );
      },
    );
  }

  static double _frac(double t, double a, double b) => ((t - a) / (b - a)).clamp(0.0, 1.0);

  /// A scale-in for a sprite that has just landed, over the tenth after [at].
  double _pop(double at) => Curves.elasticOut.transform(_reveal(at));

  /// A point along a rising arc from [a] to [b].
  static Offset _arc(Offset a, Offset b, double t) {
    final mid = Offset((a.dx + b.dx) / 2, math.min(a.dy, b.dy) - 70);
    final p0 = Offset.lerp(a, mid, t)!;
    final p1 = Offset.lerp(mid, b, t)!;
    return Offset.lerp(p0, p1, t)!;
  }

  Widget _tree(double x, double treeW, List<GardenSprite> sprites, String label, {String? highlight, double popAt = 1}) {
    return Positioned(
      left: x,
      top: 0,
      child: Column(
        children: [
          Transform.scale(
            scale: highlight == null ? 1 : (1 + (popAt - 1) * .04).clamp(.96, 1.06),
            child: GardenTree(width: treeW, sprites: sprites, spriteSize: 18, highlightId: highlight),
          ),
          const SizedBox(height: 6),
          Text(label, style: const TextStyle(fontFamily: 'Sora', color: MColors.ink, fontSize: 12.5, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }

  Widget _flying({required String kind, required Offset at}) {
    return Positioned(
      left: at.dx - 17,
      top: at.dy - 17,
      child: IgnorePointer(
        child: Container(
          width: 34,
          height: 34,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: .95),
            shape: BoxShape.circle,
            boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: .25), blurRadius: 8, offset: const Offset(0, 3))],
          ),
          child: KindIcon(kind, size: 24),
        ),
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.kind, required this.title, required this.sub, required this.shown});

  final String kind;
  final String title;
  final String sub;
  final double shown;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: shown,
      child: Transform.translate(
        offset: Offset(0, (1 - shown) * 6),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: MColors.line)),
          child: Row(
            children: [
              KindIcon(kind, size: 26),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontFamily: 'Sora', color: MColors.ink, fontSize: 13, fontWeight: FontWeight.w700)),
                    Text(sub, style: const TextStyle(color: MColors.inkSoft, fontSize: 12)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
