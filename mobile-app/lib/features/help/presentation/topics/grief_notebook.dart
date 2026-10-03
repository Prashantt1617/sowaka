import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../../../care/presentation/care_theme.dart';

/// The hand Grief & loss is written in: a fountain pen.
const griefHand = 'La Belle Aurore';

/// Notepaper and fountain-pen ink.
class _Paper {
  static const sheet = Color(0xFFFBF7EC);
  static const back = Color(0xFFF2ECDC);
  static const edge = Color(0xFFE6DCC5);
  static const rule = Color(0x2B4068A0);
  static const faintRule = Color(0x144068A0);
  static const margin = Color(0x4DC45C54);
  static const ink = Color(0xFF1D2B4F);
  static const inkSoft = Color(0xFF3E4F78);
}

/// One line of the ruled paper, and where the writing starts.
const _line = 32.0;
const _top = 14.0;
const _marginX = 30.0;
const _textLeft = 42.0;

TextStyle _hand(double size, {Color color = _Paper.ink}) => TextStyle(
  fontFamily: griefHand,
  fontSize: size,
  height: _line / size,
  color: color,
  fontWeight: FontWeight.w400,
);

/// Grief & loss's cards as the pages of a notebook, written by hand, then a
/// blank page to write on. A page turns the way paper does: drag it from its
/// edge, tap either side, or use the arrows underneath.
class GriefNotebook extends StatefulWidget {
  const GriefNotebook({
    super.key,
    required this.notes,
    required this.prompt,
    this.height = 492,
  });

  /// Each card's eyebrow, title, body and note.
  final List<Map<String, dynamic>> notes;

  /// The heading of the blank page.
  final String prompt;
  final double height;

  @override
  State<GriefNotebook> createState() => _GriefNotebookState();
}

/// A page part-way over: a picture of it, which page lies beneath, and how
/// far it has gone, 0 lying flat to 180 turned away.
class _Turn {
  _Turn({
    required this.image,
    required this.ratio,
    required this.leaf,
    required this.under,
    required this.forward,
    required this.turned,
  });

  final ui.Image image;
  final double ratio;
  final int leaf;
  final int under;
  final bool forward;
  double turned;
}

class _GriefNotebookState extends State<GriefNotebook>
    with SingleTickerProviderStateMixin {
  /// What is written on the blank page stays here while the page is open.
  /// Nothing is saved or sent.
  final _writing = TextEditingController();
  final _writingFocus = FocusNode();
  late final List<GlobalKey> _keys = [
    for (var i = 0; i < _count; i++) GlobalKey(),
  ];
  late final AnimationController _motion = AnimationController(vsync: this);
  int _current = 0;
  _Turn? _turn;
  bool _starting = false;
  double _dragDx = 0;

  /// A drag let go before its page was ready to turn: finished once it is.
  DragEndDetails? _endEarly;

  int get _count => widget.notes.length + 1;

  @override
  void dispose() {
    _motion.dispose();
    _writing.dispose();
    _writingFocus.dispose();
    _turn?.image.dispose();
    super.dispose();
  }

  /// Takes a picture of the page about to turn, and sets the turn going
  /// from flat (forward) or from turned away (back).
  Future<bool> _start(bool forward) async {
    if (_turn != null || _starting) return false;
    final leaf = forward ? _current : _current - 1;
    final under = forward ? _current + 1 : _current;
    if (leaf < 0 || under >= _count) return false;
    final boundary =
        _keys[leaf].currentContext?.findRenderObject()
            as RenderRepaintBoundary?;
    if (boundary == null) return false;
    _starting = true;
    FocusScope.of(context).unfocus();
    final ratio = MediaQuery.devicePixelRatioOf(context);
    final image = await boundary.toImage(pixelRatio: ratio);
    _starting = false;
    if (!mounted) {
      image.dispose();
      return false;
    }
    setState(
      () => _turn = _Turn(
        image: image,
        ratio: ratio,
        leaf: leaf,
        under: under,
        forward: forward,
        turned: forward ? 0 : 180,
      ),
    );
    return true;
  }

  /// Carries the page from where it is to [to], then lays it down.
  Future<void> _finish(double to, {double ms = 820}) async {
    final turn = _turn;
    if (turn == null) return;
    final from = turn.turned;
    final share = ((to - from).abs() / 180).clamp(0.35, 1.0);
    _motion.duration = Duration(milliseconds: (ms * share).round());
    void step() {
      setState(
        () => turn.turned =
            from + (to - from) * Curves.easeInOutCubic.transform(_motion.value),
      );
    }

    _motion.addListener(step);
    await _motion.forward(from: 0);
    _motion.removeListener(step);
    if (!mounted) return;
    final completed = turn.forward ? to >= 180 : to <= 0;
    setState(() {
      if (completed) _current += turn.forward ? 1 : -1;
      _turn = null;
    });
    turn.image.dispose();
  }

  Future<void> _go(bool forward) async {
    if (await _start(forward)) await _finish(forward ? 180 : 0);
  }

  void _dragStart(DragStartDetails details) {
    _dragDx = 0;
    _endEarly = null;
  }

  Future<void> _dragUpdate(DragUpdateDetails details, double width) async {
    _dragDx += details.delta.dx;
    if (_turn == null) {
      if (_starting || _dragDx.abs() < 8) return;
      if (!await _start(_dragDx < 0)) return;
      if (_endEarly case final end?) {
        _endEarly = null;
        _dragEnd(end);
        return;
      }
    }
    final turn = _turn!;
    final share = ((turn.forward ? -_dragDx : _dragDx) / (width * 0.95)).clamp(
      0.0,
      1.0,
    );
    setState(
      () => turn.turned = turn.forward ? share * 180 : 180 - share * 180,
    );
  }

  void _dragEnd(DragEndDetails details) {
    final turn = _turn;
    if (turn == null && _starting) {
      _endEarly = details;
      return;
    }
    if (turn == null || _motion.isAnimating) return;
    final velocity = details.primaryVelocity ?? 0;
    final fast = turn.forward ? velocity < -600 : velocity > 600;
    final progress = turn.forward ? turn.turned / 180 : 1 - turn.turned / 180;
    final complete = progress > 0.35 || fast;
    _finish(turn.forward == complete ? 180 : 0);
  }

  Widget _page(int i) {
    final child = i < widget.notes.length
        ? _NotePage(note: widget.notes[i])
        : _WritePage(
            controller: _writing,
            focus: _writingFocus,
            prompt: widget.prompt,
          );
    return RepaintBoundary(key: _keys[i], child: child);
  }

  @override
  Widget build(BuildContext context) {
    final turn = _turn;
    return Column(
      children: [
        SizedBox(
          height: widget.height,
          child: LayoutBuilder(
            builder: (_, box) {
              final width = box.maxWidth;
              // At rest the open page lies on top, the pages either side of it
              // beneath, ready to be turned to. While a page turns, its picture
              // is drawn over the page it uncovers.
              final shown = <int>[
                for (final i in [_current - 1, _current + 1, _current])
                  if (i >= 0 && i < _count) i,
              ];
              return GestureDetector(
                behavior: HitTestBehavior.opaque,
                onHorizontalDragStart: _dragStart,
                onHorizontalDragUpdate: (d) => _dragUpdate(d, width),
                onHorizontalDragEnd: _dragEnd,
                onTapUp: (d) => _go(d.localPosition.dx > width / 2),
                child: Stack(
                  fit: StackFit.expand,
                  clipBehavior: Clip.none,
                  children: [
                    for (var i = 0; i < _count; i++)
                      if (!shown.contains(i)) Offstage(child: _page(i)),
                    for (final i in shown)
                      Positioned.fill(
                        child: turn != null && i != turn.under
                            ? Opacity(opacity: 0, child: _page(i))
                            : _page(i),
                      ),
                    if (turn != null)
                      Positioned.fill(
                        child: IgnorePointer(
                          child: CustomPaint(painter: _TurnPainter(turn)),
                        ),
                      ),
                  ],
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 18),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _Round(
              icon: Icons.arrow_back_rounded,
              label: 'Previous page',
              enabled: _current > 0,
              onTap: () => _go(false),
            ),
            const SizedBox(width: 18),
            for (var i = 0; i < _count; i++)
              AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                margin: const EdgeInsets.symmetric(horizontal: 4),
                width: i == _current ? 22 : 7,
                height: 7,
                decoration: BoxDecoration(
                  color: i == _current ? CareColors.blue : CareColors.line,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            const SizedBox(width: 18),
            _Round(
              icon: Icons.arrow_forward_rounded,
              label: 'Next page',
              enabled: _current < _count - 1,
              onTap: () => _go(true),
            ),
          ],
        ),
      ],
    );
  }
}

/// A sheet of ruled notepaper: the faint blue lines, the red margin.
class _Sheet extends StatelessWidget {
  const _Sheet({required this.child, this.ruled = true});

  final Widget child;

  /// Off where the lines are drawn with the writing, so they scroll with it.
  final bool ruled;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: _Paper.sheet,
        border: Border.all(color: _Paper.edge),
        borderRadius: const BorderRadius.horizontal(
          left: Radius.circular(2),
          right: Radius.circular(6),
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F3C321E),
            blurRadius: 1,
            offset: Offset(0, 1),
          ),
          BoxShadow(
            color: Color(0x553C321E),
            blurRadius: 26,
            spreadRadius: -16,
            offset: Offset(0, 14),
          ),
        ],
      ),
      child: CustomPaint(
        painter: _RulesPainter(rules: ruled, margin: true),
        child: child,
      ),
    );
  }
}

class _RulesPainter extends CustomPainter {
  const _RulesPainter({required this.rules, required this.margin});

  final bool rules;
  final bool margin;

  @override
  void paint(Canvas canvas, Size size) {
    if (rules) {
      final paint = Paint()
        ..color = _Paper.rule
        ..strokeWidth = 1;
      for (var y = _top + _line - 0.5; y < size.height; y += _line) {
        canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
      }
    }
    if (margin) {
      canvas.drawLine(
        const Offset(_marginX + 0.5, 0),
        Offset(_marginX + 0.5, size.height),
        Paint()
          ..color = _Paper.margin
          ..strokeWidth = 1,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _RulesPainter old) =>
      old.rules != rules || old.margin != margin;
}

/// One card, written out by hand: no bold, no italics, no underlines.
class _NotePage extends StatelessWidget {
  const _NotePage({required this.note});

  final Map<String, dynamic> note;

  @override
  Widget build(BuildContext context) {
    return _Sheet(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(_textLeft, _top, 18, 18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${note['eyebrow'] ?? ''}',
              style: _hand(18, color: _Paper.inkSoft),
            ),
            Text('${note['title'] ?? ''}', style: _hand(25)),
            Text('${note['body'] ?? ''}', style: _hand(21)),
            const SizedBox(height: _line),
            Text(
              '${note['note'] ?? ''}',
              style: _hand(21, color: _Paper.inkSoft),
            ),
          ],
        ),
      ),
    );
  }
}

/// The blank page: its question, then lines to write on, in the same hand.
/// The lines scroll with the words, so they always sit on them.
class _WritePage extends StatelessWidget {
  const _WritePage({
    required this.controller,
    required this.focus,
    required this.prompt,
  });

  final TextEditingController controller;
  final FocusNode focus;
  final String prompt;

  @override
  Widget build(BuildContext context) {
    // A tap anywhere on the lines starts writing, rather than turning back.
    return _Sheet(
      ruled: false,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: focus.requestFocus,
        child: LayoutBuilder(
          builder: (_, box) => SingleChildScrollView(
            child: CustomPaint(
              painter: const _RulesPainter(rules: true, margin: false),
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: box.maxHeight),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(_textLeft, _top, 18, 18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(prompt, style: _hand(25)),
                      TextField(
                        controller: controller,
                        focusNode: focus,
                        maxLines: null,
                        keyboardType: TextInputType.multiline,
                        textCapitalization: TextCapitalization.sentences,
                        cursorColor: _Paper.ink,
                        style: _hand(21),
                        decoration: const InputDecoration.collapsed(
                          hintText: null,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The page part-way over, drawn as thin upright strips each hinged on the
/// one before. A strip turns a little further than its neighbour nearer the
/// spine, so the sheet bends: most mid-turn, flat at either end. The edge
/// being pulled leads. Light dims a strip as it turns edge-on, and the page
/// throws its shadow on the one beneath.
class _TurnPainter extends CustomPainter {
  _TurnPainter(this.turn);

  final _Turn turn;

  static const _strips = 20;
  static const _bend = 62.0;
  static const _depth = 1 / 2300;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final sw = w / _strips;
    final t = turn.turned;
    final lead = turn.forward ? 1.0 : -1.0;
    final bend = _bend * math.sin(t * math.pi / 180);
    final angles = [
      for (var k = 0; k < _strips; k++)
        (t + lead * bend * ((k + 0.5) / _strips)).clamp(0.0, 180.0) *
            math.pi /
            180,
    ];

    // The shadow on the page beneath, under the free edge, or at the spine
    // once the page has gone past upright.
    final lift = math.sin(t * math.pi / 180);
    var reach = 0.0;
    for (final a in angles) {
      reach += sw * math.cos(a);
    }
    if (reach > 0) {
      final x = math.min(w, reach);
      canvas.drawRect(
        Rect.fromLTWH(x - 1, 0, 57, h),
        Paint()
          ..shader = ui.Gradient.linear(Offset(x, 0), Offset(x + 56, 0), [
            Color.fromRGBO(30, 22, 8, 0.34 * lift),
            const Color.fromRGBO(30, 22, 8, 0),
          ]),
      );
    } else {
      canvas.drawRect(
        Rect.fromLTWH(0, 0, 60, h),
        Paint()
          ..shader = ui.Gradient.linear(Offset.zero, const Offset(60, 0), [
            Color.fromRGBO(30, 22, 8, 0.24 * lift),
            const Color.fromRGBO(30, 22, 8, 0),
          ]),
      );
    }

    final image = turn.image;
    final ratio = turn.ratio;
    var x = 0.0;
    var z = 0.0;
    for (var k = 0; k < _strips; k++) {
      final a = angles[k];
      final m = Matrix4.identity()
        ..translateByDouble(w / 2, h / 2, 0, 1)
        ..multiply(Matrix4.identity()..setEntry(3, 2, _depth))
        ..translateByDouble(-w / 2 + x, -h / 2, z, 1)
        ..rotateY(a);
      canvas.save();
      canvas.transform(m.storage);
      final rect = Rect.fromLTWH(0, 0, sw + 0.8, h);
      final dim = 0.5 * (1 - math.cos(a).abs());
      if (a <= math.pi / 2) {
        final left = k * sw * ratio;
        final src = Rect.fromLTWH(
          left,
          0,
          math.min((sw + 0.8) * ratio, image.width - left),
          image.height.toDouble(),
        );
        canvas.drawImageRect(
          image,
          src,
          Rect.fromLTWH(0, 0, src.width / ratio, h),
          Paint()..filterQuality = FilterQuality.medium,
        );
        canvas.drawRect(rect, Paint()..color = Color.fromRGBO(40, 30, 10, dim));
      } else {
        // The back of the sheet: plain paper, its lines faintly through.
        canvas.drawRect(rect, Paint()..color = _Paper.back);
        final rule = Paint()
          ..color = _Paper.faintRule
          ..strokeWidth = 1;
        for (var y = _top + _line - 0.5; y < h; y += _line) {
          canvas.drawLine(Offset(0, y), Offset(rect.width, y), rule);
        }
        final edge = Paint()..color = _Paper.edge;
        canvas.drawRect(Rect.fromLTWH(0, 0, rect.width, 1), edge);
        canvas.drawRect(Rect.fromLTWH(0, h - 1, rect.width, 1), edge);
        canvas.drawRect(
          rect,
          Paint()..color = Color.fromRGBO(40, 30, 10, dim * 0.8),
        );
      }
      canvas.restore();
      x += sw * math.cos(a);
      z -= sw * math.sin(a);
    }
  }

  @override
  bool shouldRepaint(covariant _TurnPainter old) => true;
}

class _Round extends StatelessWidget {
  const _Round({
    required this.icon,
    required this.label,
    required this.enabled,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: label,
    child: Opacity(
      opacity: enabled ? 1 : 0.35,
      child: Material(
        color: Colors.white,
        shape: const CircleBorder(side: BorderSide(color: CareColors.line)),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: enabled ? onTap : null,
          child: SizedBox(
            width: 40,
            height: 40,
            child: Icon(icon, size: 18, color: CareColors.blue),
          ),
        ),
      ),
    ),
  );
}
