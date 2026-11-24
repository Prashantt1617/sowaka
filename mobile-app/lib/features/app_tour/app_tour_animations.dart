/// The Sowaka tour's short looping pictures (24 Nov design, "Connect
/// spotlight tour"): the 326 x 132 panel at the top of a stop's card, rebuilt
/// from the design's CSS keyframes, and the start card's globe with its
/// paper plane. Every time below is a fraction of one loop, as the CSS has it.
library;

import 'dart:math' as math;
import 'dart:ui' show PathMetric;

import 'package:flutter/material.dart';

/// The stops that carry a picture.
enum AppTourAnimation { post, approve, feedback, punch, calendar }

// ─── Type and colours (the design's) ────────────────────────────────────────

TextStyle tourText(double size, FontWeight weight, Color color, {double? height, double? letterSpacing}) => TextStyle(
  fontFamily: 'Manrope',
  fontSize: size,
  fontWeight: weight,
  fontVariations: [FontVariation.weight(weight.value.toDouble())],
  color: color,
  height: height,
  letterSpacing: letterSpacing,
  decoration: TextDecoration.none,
);

/// The panels' type: set tight (the design's boxes are drawn to the pixel).
TextStyle _pt(double size, FontWeight weight, Color color, {double height = 1.15, double? letterSpacing}) =>
    tourText(size, weight, color, height: height, letterSpacing: letterSpacing);

abstract final class TourInk {
  static const blue = Color(0xFF0B6FAA);
  static const ink = Color(0xFF1B1B22);
  static const body = Color(0xFF3A3A44);
  static const muted = Color(0xFF6B6B76);
  static const quiet = Color(0xFF5F5F6B);
  static const panel = Color(0xFFEEF5FB);
  static const green = Color(0xFF2ECC71);
}

// ─── Keyframes ──────────────────────────────────────────────────────────────

/// The value at [t] (0..1) of a piecewise track: (time, value) pairs in
/// order, each leg eased by [curve] (CSS's `ease` by default), held before
/// the first and after the last.
double track(double t, List<(double, double)> frames, {Curve curve = Curves.ease}) {
  if (t <= frames.first.$1) return frames.first.$2;
  for (var i = 1; i < frames.length; i++) {
    final (t1, v1) = frames[i];
    if (t <= t1) {
      final (t0, v0) = frames[i - 1];
      final span = t1 - t0;
      final p = span <= 0 ? 1.0 : curve.transform(((t - t0) / span).clamp(0.0, 1.0));
      return v0 + (v1 - v0) * p;
    }
  }
  return frames.last.$2;
}

/// Runs [builder] with the loop's place (0..1), [period] long, for as long
/// as it is on screen. With animations off (the system's reduce motion) it
/// holds still at [still].
class TourLoop extends StatefulWidget {
  const TourLoop({super.key, required this.period, required this.builder, this.still = 0.7});

  final Duration period;
  final Widget Function(BuildContext context, double t) builder;
  final double still;

  @override
  State<TourLoop> createState() => _TourLoopState();
}

class _TourLoopState extends State<TourLoop> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: widget.period);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) {
      _c
        ..stop()
        ..value = widget.still;
    } else if (!_c.isAnimating) {
      _c.repeat();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: _c, builder: (context, _) => widget.builder(context, _c.value));
}

// ─── The panel ──────────────────────────────────────────────────────────────

/// The light blue panel with [kind]'s loop, drawn at the design's 326 x 132
/// and scaled to the card's width.
class AppTourAnimationPanel extends StatelessWidget {
  const AppTourAnimationPanel({super.key, required this.kind});

  final AppTourAnimation kind;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: AspectRatio(
      aspectRatio: 326 / 132,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: ColoredBox(
          color: TourInk.panel,
          child: FittedBox(
            child: SizedBox(
              width: 326,
              height: 132,
              child: switch (kind) {
                AppTourAnimation.post => const _PostLoop(),
                AppTourAnimation.approve => const _ApproveLoop(),
                AppTourAnimation.feedback => const _FeedbackLoop(),
                AppTourAnimation.punch => const _PunchLoop(),
                AppTourAnimation.calendar => const _CalendarLoop(),
              },
            ),
          ),
        ),
      ),
    ),
  );
}

// ─── Shared pieces ──────────────────────────────────────────────────────────

Widget _box({required double left, required double top, required double width, required double height, required Widget child, EdgeInsets padding = EdgeInsets.zero, Color color = Colors.white, double radius = 12}) =>
    Positioned(
      left: left,
      top: top,
      width: width,
      height: height,
      child: Container(
        padding: padding,
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(radius)),
        child: child,
      ),
    );

/// Shown with [opacity], [dy] / [dx] off its place.
Widget _fade(double opacity, Widget child, {double dx = 0, double dy = 0}) => Opacity(
  opacity: opacity.clamp(0.0, 1.0),
  child: Transform.translate(offset: Offset(dx, dy), child: child),
);

Widget _avatar(String initials, double size, Color bg, Color fg, double font) => Container(
  width: size,
  height: size,
  alignment: Alignment.center,
  decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
  child: Text(initials, style: _pt(font, FontWeight.w800, fg)),
);

/// The dark toast along the panel's foot.
Widget _toast(double t, {required String text, required double top, required double height, required List<(double, double)> show, double rise = 8, bool tick = false}) {
  final o = track(t, show);
  return Positioned(
    left: 10,
    top: top,
    width: 306,
    height: height,
    child: _fade(
      o,
      dy: rise * (1 - o),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(color: TourInk.ink, borderRadius: BorderRadius.circular(8)),
        child: Row(
          children: [
            if (tick) ...[const _Tick(), const SizedBox(width: 6)],
            Flexible(child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: _pt(10, FontWeight.w700, Colors.white))),
          ],
        ),
      ),
    ),
  );
}

class _Tick extends StatelessWidget {
  const _Tick();

  @override
  Widget build(BuildContext context) => Container(
    width: 12,
    height: 12,
    decoration: const BoxDecoration(color: TourInk.green, shape: BoxShape.circle),
    child: const Icon(Icons.check_rounded, size: 9, color: TourInk.ink),
  );
}

/// The finger: a blue dot ringed in white that lands, presses and lifts
/// between [from] and [to] (the CSS m-tap: in at +6%, pressed at +11%, gone at +17%).
Widget _tap(double t, {required double left, required double top, required double from}) {
  final frames = [(from, 0.0), (from + .06, 1.0), (from + .11, 1.0), (from + .17, 0.0)];
  final o = track(t, frames);
  final s = track(t, [(from, 1.5), (from + .06, 1.0), (from + .11, .7), (from + .17, 1.0)]);
  return Positioned(
    left: left,
    top: top,
    child: Opacity(
      opacity: o,
      child: Transform.scale(
        scale: s,
        child: Container(
          width: 22,
          height: 22,
          decoration: BoxDecoration(
            color: const Color(0x4D0B6FAA),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 2),
            boxShadow: const [BoxShadow(color: Color(0x4D000000), blurRadius: 6, offset: Offset(0, 2))],
          ),
        ),
      ),
    ),
  );
}

Widget _chip(String text, {required Color bg, required Color fg, double height = 13, double font = 8, double radius = 7, FontWeight weight = FontWeight.w700, EdgeInsets padding = const EdgeInsets.symmetric(horizontal: 6), BoxBorder? border}) =>
    Container(
      height: height,
      padding: padding,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(radius), border: border),
      child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: _pt(font, weight, fg)),
    );

// ─── Stop 2 · a first post (6 s) ────────────────────────────────────────────

class _PostLoop extends StatelessWidget {
  const _PostLoop();

  static const _text = 'Hey, it’s my first day!';

  @override
  Widget build(BuildContext context) => TourLoop(
    period: const Duration(milliseconds: 6000),
    still: 0.8,
    builder: (context, t) {
      // Typed in 23 steps from 8% to 38%.
      final typed = (((t - .08) / .30).clamp(0.0, 1.0) * _text.length).floor();
      final press = track(t, [(.44, 1.0), (.47, .86), (.50, 1.0)]);
      final comp = track(t, [(.52, 1.0), (.58, 0.0)]);
      final feed = track(t, [(.54, 0.0), (.62, 1.0), (.95, 1.0), (1.0, 0.0)]);
      final caretOn = ((t * 6000) ~/ 400).isEven;
      return Stack(
        children: [
          Positioned(
            left: 10,
            top: 10,
            width: 306,
            height: 112,
            child: _fade(
              comp,
              dy: -10 * (1 - comp),
              Container(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      height: 22,
                      child: Row(
                        children: [
                          const Icon(Icons.close_rounded, size: 12, color: TourInk.body),
                          const SizedBox(width: 6),
                          _avatar('AB', 18, const Color(0xFFF3D9CF), const Color(0xFFB23500), 7),
                          const SizedBox(width: 6),
                          Text('Public', style: _pt(10, FontWeight.w700, TourInk.ink)),
                          const SizedBox(width: 6),
                          const Icon(Icons.keyboard_arrow_down_rounded, size: 10, color: TourInk.body),
                          const Spacer(),
                          Transform.scale(
                            scale: press,
                            child: Container(
                              width: 40,
                              height: 20,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: Color.lerp(const Color(0xFFA9CBE0), TourInk.blue, track(t, [(.30, 0.0), (.34, 1.0)]))!,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text('Post', style: _pt(9, FontWeight.w800, Colors.white)),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        for (final (i, label) in const ['MEDIA', 'POLL', 'KUDOS', 'REC'].indexed) ...[
                          if (i > 0) const SizedBox(width: 5),
                          _chip(label, bg: const Color(0xFFF3F3F5), fg: TourInk.body, height: 18, font: 8.5, radius: 9, weight: FontWeight.w800, padding: const EdgeInsets.symmetric(horizontal: 8)),
                        ],
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Text(_text.substring(0, typed), style: _pt(12, FontWeight.w400, TourInk.ink)),
                        const SizedBox(width: 1),
                        Opacity(opacity: caretOn ? 1 : 0, child: Container(width: 1.5, height: 14, color: TourInk.blue)),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
          Positioned(
            left: 10,
            top: 10,
            width: 306,
            height: 80,
            child: _fade(
              feed,
              dy: 12 * (1 - feed),
              Container(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        _avatar('AB', 22, const Color(0xFFF3D9CF), const Color(0xFFB23500), 8),
                        const SizedBox(width: 7),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Text('Ananya Bisht', style: _pt(10.5, FontWeight.w800, TourInk.ink)),
                                const SizedBox(width: 5),
                                _chip('Public', bg: Colors.white, fg: TourInk.blue, border: Border.all(color: TourInk.blue)),
                              ],
                            ),
                            const SizedBox(height: 1),
                            Text('Design Lead · Now', style: _pt(9, FontWeight.w400, TourInk.muted)),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(_text, style: _pt(11, FontWeight.w400, TourInk.ink)),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Icon(Icons.favorite_border_rounded, size: 12, color: TourInk.quiet),
                        const SizedBox(width: 3),
                        Text('0', style: _pt(9, FontWeight.w400, TourInk.quiet)),
                        const SizedBox(width: 10),
                        const Icon(Icons.chat_bubble_outline_rounded, size: 12, color: TourInk.quiet),
                        const SizedBox(width: 3),
                        Text('0', style: _pt(9, FontWeight.w400, TourInk.quiet)),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
          _toast(t, text: 'Post published', top: 96, height: 26, show: const [(.60, 0.0), (.66, 1.0), (.92, 1.0), (.97, 0.0)]),
          _tap(t, left: 275, top: 18, from: .38),
        ],
      );
    },
  );
}

// ─── Stop 4 · approve a leave (5 s) ─────────────────────────────────────────

class _ApproveLoop extends StatelessWidget {
  const _ApproveLoop();

  @override
  Widget build(BuildContext context) => TourLoop(
    period: const Duration(milliseconds: 5000),
    builder: (context, t) {
      final buttons = track(t, [(.40, 1.0), (.46, 0.0), (.94, 0.0), (1.0, 1.0)]);
      final approved = track(t, [(.42, 0.0), (.50, 1.0), (.94, 1.0), (1.0, 0.0)]);
      Widget button(String label, Color bg, Color fg) => Expanded(
        child: Container(
          alignment: Alignment.center,
          decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(11)),
          child: Text(label, style: _pt(10, FontWeight.w800, fg)),
        ),
      );
      return Stack(
        children: [
          _box(
            left: 10,
            top: 6,
            width: 306,
            height: 96,
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
            child: Stack(
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        _avatar('AD', 22, const Color(0xFF2F6690), Colors.white, 8),
                        const SizedBox(width: 7),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Arjun Deshpande', style: _pt(10.5, FontWeight.w800, TourInk.ink)),
                            Text('Design', style: _pt(9, FontWeight.w400, TourInk.muted)),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 5),
                    Text('Type: Casual · Date: 20 Nov – 24 Nov', maxLines: 1, overflow: TextOverflow.ellipsis, style: _pt(9.5, FontWeight.w400, TourInk.body)),
                  ],
                ),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 22,
                  child: Opacity(
                    opacity: buttons,
                    child: Row(
                      children: [
                        button('Approve', const Color(0xFFDCF3D2), const Color(0xFF3D8B2F)),
                        const SizedBox(width: 8),
                        button('Reject', const Color(0xFFF8D8D6), const Color(0xFFC0392B)),
                      ],
                    ),
                  ),
                ),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 22,
                  child: Opacity(
                    opacity: approved,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      alignment: Alignment.centerLeft,
                      decoration: BoxDecoration(color: const Color(0xFFDCF3D2), borderRadius: BorderRadius.circular(6)),
                      child: Text('Approved', style: _pt(10, FontWeight.w800, const Color(0xFF3D8B2F))),
                    ),
                  ),
                ),
              ],
            ),
          ),
          _toast(t, text: 'Leave approved', top: 106, height: 20, rise: 6, show: const [(.46, 0.0), (.52, 1.0), (.90, 1.0), (.96, 0.0)]),
          _tap(t, left: 69, top: 72, from: .26),
        ],
      );
    },
  );
}

// ─── Stop 5 · monthly feedback (6 s) ────────────────────────────────────────

class _FeedbackLoop extends StatelessWidget {
  const _FeedbackLoop();

  @override
  Widget build(BuildContext context) => TourLoop(
    period: const Duration(milliseconds: 6000),
    builder: (context, t) {
      final list = track(t, [(.34, 1.0), (.42, 0.0)]);
      final detail = track(t, [(.36, 0.0), (.44, 1.0), (.95, 1.0), (1.0, 0.0)]);
      final detailIn = track(t, [(.36, 0.0), (.44, 1.0)]);
      return Stack(
        children: [
          Positioned(
            left: 10,
            top: 10,
            width: 306,
            height: 112,
            child: _fade(
              list,
              dx: -24 * (1 - list),
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    height: 44,
                    padding: const EdgeInsets.fromLTRB(10, 7, 10, 7),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Team Feedback', style: _pt(10.5, FontWeight.w800, TourInk.ink)),
                        const SizedBox(height: 2),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.baseline,
                          textBaseline: TextBaseline.alphabetic,
                          children: [
                            Text('0/5', style: _pt(12, FontWeight.w800, TourInk.ink)),
                            const SizedBox(width: 4),
                            Text('Feedback given · Nov 2026', style: _pt(8.5, FontWeight.w600, TourInk.quiet)),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    height: 48,
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                    child: Row(
                      children: [
                        _avatar('AD', 26, const Color(0xFF2F6690), Colors.white, 9),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Flexible(child: Text('Arjun Deshpande', maxLines: 1, overflow: TextOverflow.ellipsis, style: _pt(10.5, FontWeight.w800, TourInk.ink))),
                                  const SizedBox(width: 5),
                                  _chip('Pending', bg: const Color(0xFFFFF3B8), fg: const Color(0xFF7A5E00), radius: 6, padding: const EdgeInsets.symmetric(horizontal: 5)),
                                ],
                              ),
                              const SizedBox(height: 1),
                              Text('Product Designer', style: _pt(9, FontWeight.w400, TourInk.muted)),
                            ],
                          ),
                        ),
                        const Icon(Icons.chevron_right_rounded, size: 12, color: TourInk.body),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          Positioned(
            left: 10,
            top: 10,
            width: 306,
            height: 112,
            child: _fade(
              detail,
              dx: 24 * (1 - detailIn),
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    height: 58,
                    padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                    child: Row(
                      children: [
                        Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('OVERALL SCORE', style: _pt(7.5, FontWeight.w800, TourInk.muted, letterSpacing: .5)),
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.baseline,
                              textBaseline: TextBaseline.alphabetic,
                              children: [
                                Text('4.7', style: _pt(20, FontWeight.w800, TourInk.ink, height: 1)),
                                const SizedBox(width: 3),
                                Text('/5', style: _pt(10, FontWeight.w400, TourInk.muted)),
                              ],
                            ),
                            _chip('+0.4 pts', bg: const Color(0xFFE3F4EA), fg: const Color(0xFF1E6B42), weight: FontWeight.w800, padding: const EdgeInsets.symmetric(horizontal: 5)),
                          ],
                        ),
                        const SizedBox(width: 10),
                        const CustomPaint(size: Size(170, 44), painter: _TrendPainter()),
                      ],
                    ),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    height: 48,
                    padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF8EC),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFFF5C26B), width: 1.5),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Feedback is due for this month', maxLines: 1, overflow: TextOverflow.ellipsis, style: _pt(9.5, FontWeight.w400, TourInk.body)),
                        const SizedBox(height: 4),
                        _chip('Give Feedback', bg: const Color(0xFFF28C28), fg: Colors.white, height: 18, font: 9, radius: 5, weight: FontWeight.w800, padding: const EdgeInsets.symmetric(horizontal: 10)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          _tap(t, left: 150, top: 75, from: .16),
          _tap(t, left: 46, top: 98, from: .66),
        ],
      );
    },
  );
}

class _TrendPainter extends CustomPainter {
  const _TrendPainter();

  static const _points = [Offset(6, 20), Offset(46, 18), Offset(86, 16), Offset(126, 12), Offset(162, 36)];

  @override
  void paint(Canvas canvas, Size size) {
    final line = Path()..moveTo(_points.first.dx, _points.first.dy);
    for (final p in _points.skip(1)) {
      line.lineTo(p.dx, p.dy);
    }
    final area = Path.from(line)
      ..lineTo(162, 44)
      ..lineTo(6, 44)
      ..close();
    canvas
      ..drawPath(area, Paint()..color = const Color(0xFFE8F0FA))
      ..drawPath(
        line,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = TourInk.blue,
      );
    for (final (i, p) in _points.indexed) {
      if (i == 3) {
        canvas.drawCircle(p, 3, Paint()..color = TourInk.blue);
      } else if (i == 4) {
        canvas.drawCircle(p, 2.5, Paint()..color = TourInk.ink);
      } else {
        canvas
          ..drawCircle(p, 2.5, Paint()..color = Colors.white)
          ..drawCircle(
            p,
            2.5,
            Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = 1.5
              ..color = TourInk.blue,
          );
      }
    }
  }

  @override
  bool shouldRepaint(_TrendPainter oldDelegate) => false;
}

// ─── Stop 7 · slide to punch in (6.5 s) ─────────────────────────────────────

class _PunchLoop extends StatelessWidget {
  const _PunchLoop();

  @override
  Widget build(BuildContext context) => TourLoop(
    period: const Duration(milliseconds: 6500),
    still: 0.8,
    builder: (context, t) {
      final card = track(t, [(.32, 1.0), (.36, 0.0)]);
      final knob = track(t, [(.08, 0.0), (.28, 246.0)], curve: Curves.easeInOut);
      final face = track(t, [(.32, 0.0), (.36, 1.0), (.60, 1.0), (.64, 0.0)]);
      final ring = Color.lerp(const Color(0x8CFFFFFF), TourInk.green, track(t, [(.46, 0.0), (.52, 1.0)]))!;
      final present = track(t, [(.60, 0.0), (.66, 1.0), (.95, 1.0), (1.0, 0.0)]);
      final presentIn = track(t, [(.60, 0.0), (.66, 1.0)]);
      Widget time(String label, String value) => Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: _pt(7.5, FontWeight.w700, TourInk.muted)),
            Text(value, style: _pt(11, FontWeight.w800, TourInk.ink)),
          ],
        ),
      );
      return Stack(
        children: [
          Positioned(
            left: 10,
            top: 10,
            width: 306,
            height: 112,
            child: Opacity(
              opacity: card,
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.calendar_today_outlined, size: 12, color: TourInk.body),
                        const SizedBox(width: 6),
                        Expanded(child: Text('Attendance', style: _pt(11, FontWeight.w800, TourInk.ink))),
                        const Icon(Icons.chevron_right_rounded, size: 12, color: TourInk.body),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text('13 Nov, Friday', style: _pt(10, FontWeight.w400, TourInk.body)),
                    const SizedBox(height: 10),
                    Container(
                      height: 40,
                      decoration: BoxDecoration(color: const Color(0xFFE3F1FA), borderRadius: BorderRadius.circular(20)),
                      child: Stack(
                        children: [
                          Positioned(
                            left: 40,
                            right: 0,
                            top: 0,
                            bottom: 0,
                            child: Center(child: Text('Slide to Punch In', style: _pt(11, FontWeight.w800, TourInk.blue))),
                          ),
                          Positioned(
                            left: 4 + knob,
                            top: 4,
                            child: Container(
                              width: 32,
                              height: 32,
                              decoration: const BoxDecoration(color: TourInk.blue, shape: BoxShape.circle),
                              child: const Icon(Icons.arrow_forward_rounded, size: 14, color: Colors.white),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Positioned.fill(
            child: Opacity(
              opacity: face,
              child: ColoredBox(
                color: const Color(0xFF1E2228),
                child: Stack(
                  children: [
                    Positioned(
                      left: 0,
                      right: 0,
                      top: 10,
                      child: Text('Look at the camera', textAlign: TextAlign.center, style: _pt(11, FontWeight.w800, Colors.white)),
                    ),
                    Positioned(
                      left: 131,
                      top: 32,
                      width: 64,
                      height: 84,
                      child: CustomPaint(
                        foregroundPainter: _DashedOutline(color: ring, width: 3, dash: 3, gap: 3, oval: true),
                        child: ClipOval(
                          child: Align(
                            alignment: Alignment.bottomCenter,
                            child: CustomPaint(size: const Size(50, 60), painter: const _PersonPainter()),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Positioned(
            left: 10,
            top: 8,
            width: 306,
            height: 80,
            child: _fade(
              present,
              dy: 8 * (1 - presentIn),
              Container(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(child: Text('Attendance', style: _pt(11, FontWeight.w800, TourInk.ink))),
                        Text('● Present', style: _pt(9, FontWeight.w800, const Color(0xFF2E9E62))),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text('13 Nov, Friday', style: _pt(9.5, FontWeight.w400, TourInk.body)),
                    Container(
                      height: 3,
                      margin: const EdgeInsets.symmetric(vertical: 6),
                      decoration: BoxDecoration(color: const Color(0xFFEDEDF0), borderRadius: BorderRadius.circular(2)),
                    ),
                    Row(children: [time('PUNCH-IN', '01:53 PM'), time('PUNCH-OUT', 'NR')]),
                  ],
                ),
              ),
            ),
          ),
          _toast(
            t,
            text: 'Punched in at 1:53 PM · Sowaka Office',
            top: 96,
            height: 26,
            rise: 6,
            tick: true,
            show: const [(.68, 0.0), (.74, 1.0), (.93, 1.0), (.98, 0.0)],
          ),
        ],
      );
    },
  );
}

class _PersonPainter extends CustomPainter {
  const _PersonPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = const Color(0xFF5A6270);
    canvas.drawCircle(const Offset(25, 22), 12, paint);
    final body = Path()
      ..moveTo(4, 60)
      ..cubicTo(4, 48, 13, 40, 25, 40)
      ..cubicTo(37, 40, 46, 48, 46, 60)
      ..close();
    canvas.drawPath(body, paint);
  }

  @override
  bool shouldRepaint(_PersonPainter oldDelegate) => false;
}

/// A dashed or dotted outline: an oval, or a rounded box of [radius].
class _DashedOutline extends CustomPainter {
  const _DashedOutline({required this.color, required this.width, this.dash = 4, this.gap = 3, this.oval = false, this.radius = 0});

  final Color color;
  final double width;
  final double dash;
  final double gap;
  final bool oval;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final r = (Offset.zero & size).deflate(width / 2);
    final path = oval ? (Path()..addOval(r)) : (Path()..addRRect(RRect.fromRectAndRadius(r, Radius.circular(radius))));
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = width
      ..color = color;
    for (final PathMetric metric in path.computeMetrics()) {
      for (var d = 0.0; d < metric.length; d += dash + gap) {
        canvas.drawPath(metric.extractPath(d, math.min(d + dash, metric.length)), paint);
      }
    }
  }

  @override
  bool shouldRepaint(_DashedOutline old) => old.color != color || old.width != width;
}

// ─── Stop 9 · the work calendar (7 s) ───────────────────────────────────────

class _CalendarLoop extends StatelessWidget {
  const _CalendarLoop();

  static const _red = Color(0xFFD0453A);
  static const _green = Color(0xFF2E9E62);

  @override
  Widget build(BuildContext context) => TourLoop(
    period: const Duration(milliseconds: 7000),
    builder: (context, t) {
      final sel = track(t, [(.32, 0.0), (.36, 1.0), (.95, 1.0), (1.0, 0.0)]);
      final det = track(t, [(.36, 0.0), (.42, 1.0), (.95, 1.0), (1.0, 0.0)]);
      final detIn = track(t, [(.36, 0.0), (.42, 1.0)]);
      Widget legend(String label, String count) => Container(
        height: 16,
        padding: const EdgeInsets.fromLTRB(6, 0, 3, 0),
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFFE6E6EA))),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(label, style: _pt(8, FontWeight.w700, TourInk.body)),
            const SizedBox(width: 4),
            Container(
              constraints: const BoxConstraints(minWidth: 12),
              height: 11,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: const Color(0xFFF0F0F2), borderRadius: BorderRadius.circular(6)),
              child: Text(count, style: _pt(7.5, FontWeight.w700, TourInk.body)),
            ),
          ],
        ),
      );
      Widget day(int n, double left, double top, Color color, {Color? bg, Border? border, bool dashed = false}) => Positioned(
        left: left,
        top: top,
        width: 36,
        height: 20,
        child: CustomPaint(
          foregroundPainter: dashed ? const _DashedOutline(color: TourInk.blue, width: 1.5, dash: 3, gap: 2, radius: 5) : null,
          child: Container(
            alignment: Alignment.center,
            decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(5), border: border),
            child: Text('$n', style: _pt(10, FontWeight.w700, color)),
          ),
        ),
      );
      const xs = [8.0, 49.0, 90.0, 131.0, 172.0, 213.0, 254.0];
      return Stack(
        children: [
          _box(
            left: 10,
            top: 6,
            width: 306,
            height: 120,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Stack(
                children: [
                  Positioned(
                    left: 0,
                    right: 0,
                    top: 4,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text('‹', style: _pt(10.5, FontWeight.w800, TourInk.muted)),
                        const SizedBox(width: 30),
                        Text('November 2026', style: _pt(10.5, FontWeight.w800, TourInk.ink)),
                        const SizedBox(width: 30),
                        Text('›', style: _pt(10.5, FontWeight.w800, TourInk.muted)),
                      ],
                    ),
                  ),
                  Positioned(
                    left: 8,
                    top: 20,
                    child: Row(
                      children: [
                        legend('Missed Punch', '8'),
                        const SizedBox(width: 4),
                        legend('Present', '2'),
                        const SizedBox(width: 4),
                        legend('Leave', '5'),
                        const SizedBox(width: 4),
                        legend('Holiday', '1'),
                      ],
                    ),
                  ),
                  for (final (i, n) in const [2, 3, 4, 5, 6, 7].indexed) day(n, xs[i], 40, n == 3 ? _green : _red),
                  day(8, xs[6], 40, const Color(0xFF75757F), bg: const Color(0xFFF0F0F2)),
                  for (final (i, n) in const [9, 10, 11, 12].indexed) day(n, xs[i], 64, n == 12 ? _green : _red),
                  day(13, xs[4], 64, TourInk.blue, border: Border.all(color: TourInk.blue, width: 1.5)),
                  day(14, xs[5], 64, TourInk.blue, dashed: true),
                  day(15, xs[6], 64, TourInk.blue, dashed: true),
                  Positioned(
                    left: 90,
                    top: 40,
                    width: 36,
                    height: 20,
                    child: Opacity(
                      opacity: sel,
                      child: Container(
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: const Color(0xFFE3F1FA),
                          borderRadius: BorderRadius.circular(5),
                          border: Border.all(color: TourInk.blue, width: 1.5),
                        ),
                        child: Text('4', style: _pt(10, FontWeight.w800, _red)),
                      ),
                    ),
                  ),
                  Positioned(
                    left: 0,
                    top: 88,
                    width: 306,
                    height: 32,
                    child: _fade(
                      det,
                      dy: 10 * (1 - detIn),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        decoration: const BoxDecoration(
                          color: Colors.white,
                          border: Border(top: BorderSide(color: Color(0xFFEDEDF0))),
                        ),
                        child: Row(
                          children: [
                            Flexible(child: Text('Wed, 4 Nov', maxLines: 1, overflow: TextOverflow.ellipsis, style: _pt(9.5, FontWeight.w800, TourInk.ink))),
                            const SizedBox(width: 6),
                            Flexible(child: _chip('● Missed Punched', bg: const Color(0xFFFDE8E7), fg: const Color(0xFFC0392B), height: 14)),
                            const SizedBox(width: 6),
                            const Spacer(),
                            _chip(
                              'Request Correction',
                              bg: Colors.white,
                              fg: TourInk.ink,
                              height: 20,
                              font: 8.5,
                              radius: 10,
                              weight: FontWeight.w800,
                              padding: const EdgeInsets.symmetric(horizontal: 8),
                              border: Border.all(color: const Color(0xFFD5D5DC)),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          _toast(
            t,
            text: 'Regularization sent to your manager',
            top: 96,
            height: 26,
            rise: 6,
            tick: true,
            show: const [(.66, 0.0), (.72, 1.0), (.94, 1.0), (.99, 0.0)],
          ),
          _tap(t, left: 107, top: 47, from: .22),
          _tap(t, left: 255, top: 99, from: .52),
        ],
      );
    },
  );
}

// ─── The start card's globe and paper plane (4.8 s) ─────────────────────────

/// The plane's path round the globe (CSS m-plane): x, y, turn in degrees,
/// scale, and whether it is behind the globe (darker) at each keyframe.
const _plane = <(double, double, double, double, double, bool)>[
  (0, 0, 0, 0, 1, false),
  (.05, 0, 0, 0, 1, false),
  (.09, 4.5, -5.36, 10, 1.06, false),
  (.13, 17.92, 6.55, 60, 1.05, false),
  (.17, 23.35, 18.47, 106.9, .801, true),
  (.1921, 25.01, 22.40, 130.5, .823, true),
  (.2143, 24.57, 25.78, 166.2, .965, false),
  (.2364, 22.04, 28.44, 197.4, .987, false),
  (.2586, 17.56, 30.26, 215.9, 1.008, false),
  (.2807, 11.34, 31.13, 226.8, 1.026, false),
  (.3029, 3.70, 31.02, 234.2, 1.041, false),
  (.325, -4.97, 29.93, 239.8, 1.052, false),
  (.3471, -14.25, 27.92, 244.5, 1.058, false),
  (.3693, -23.67, 25.09, 249.0, 1.060, false),
  (.3914, -32.75, 21.57, 253.5, 1.056, false),
  (.4136, -41.05, 17.55, 258.5, 1.048, false),
  (.4357, -48.13, 13.22, 264.7, 1.035, false),
  (.4579, -53.66, 8.81, 273.3, 1.018, false),
  (.48, -57.35, 4.53, 286.9, .999, false),
  (.5021, -59.01, .60, 310.5, .977, false),
  (.5243, -58.57, -2.78, 346.2, .960, false),
  (.5464, -56.04, -5.44, 377.4, .813, true),
  (.5686, -51.56, -7.26, 395.9, .792, true),
  (.5907, -45.34, -8.13, 406.8, .774, true),
  (.6129, -37.70, -8.02, 414.2, .759, true),
  (.635, -29.03, -6.93, 419.8, .748, true),
  (.6571, -19.75, -4.92, 424.5, .742, true),
  (.6793, -10.33, -2.09, 429.0, .740, true),
  (.7014, -1.25, 1.43, 433.5, .744, true),
  (.7236, 7.05, 5.45, 438.5, .752, true),
  (.7457, 14.13, 9.78, 444.7, .765, true),
  (.7679, 19.66, 14.19, 453.3, .782, true),
  (.79, 23.35, 18.47, 466.9, .801, true),
  (.84, 17.92, 6.55, 433.4, 1.05, false),
  (.88, 0, 0, 360, 1, false),
  (1, 0, 0, 360, 1, false),
];

/// The sparks that burst when the plane lands home: colour and where each flies.
const _sparks = <(Color, Offset)>[
  (Color(0xFFF2A900), Offset(-34, -20)),
  (Color(0xFF4CAF50), Offset(34, -22)),
  (Color(0xFF1E9BE0), Offset(-38, 14)),
  (Color(0xFFFF6B6B), Offset(38, 16)),
  (Color(0xFFF2A900), Offset(0, -40)),
  (Color(0xFF1E9BE0), Offset(4, 40)),
];

class AppTourGlobe extends StatelessWidget {
  const AppTourGlobe({super.key});

  static const globeAsset = 'assets/images/app_tour_globe.png';
  static const planeAsset = 'assets/images/app_tour_plane.png';

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: SizedBox(
      width: 76,
      height: 76,
      child: TourLoop(
        period: const Duration(milliseconds: 4800),
        still: 0.95,
        builder: (context, t) {
          // The plane: linear between its keyframes.
          var i = 1;
          while (i < _plane.length - 1 && _plane[i].$1 < t) {
            i++;
          }
          final a = _plane[i - 1], b = _plane[i];
          final p = b.$1 == a.$1 ? 1.0 : ((t - a.$1) / (b.$1 - a.$1)).clamp(0.0, 1.0);
          double lerp(double x, double y) => x + (y - x) * p;
          final behind = p < .5 ? a.$6 : b.$6;
          final dim = lerp(a.$6 ? .8 : 1, b.$6 ? .8 : 1);
          final pop = track(t, [(.88, 1.0), (.91, 1.2), (.94, .93), (.97, 1.0)], curve: Curves.easeOut);
          final plane = Positioned(
            left: 32,
            top: 6,
            width: 43,
            height: 47,
            child: Transform.translate(
              offset: Offset(lerp(a.$2, b.$2), lerp(a.$3, b.$3)),
              child: Transform.rotate(
                angle: lerp(a.$4, b.$4) * math.pi / 180,
                child: Transform.scale(
                  scale: lerp(a.$5, b.$5),
                  child: ColorFiltered(
                    colorFilter: ColorFilter.matrix([dim, 0, 0, 0, 0, 0, dim, 0, 0, 0, 0, 0, dim, 0, 0, 0, 0, 0, 1, 0]),
                    child: Image.asset(planeAsset, width: 43, height: 47),
                  ),
                ),
              ),
            ),
          );
          final spark = track(t, [(.88, 0.0), (.91, 1.0), (.97, 0.0)], curve: Curves.easeOut);
          final reach = track(t, [(.88, 0.0), (.91, .6), (.97, 1.0)], curve: Curves.easeOut);
          final size = track(t, [(.88, .3), (.91, 1.0), (.97, .4)], curve: Curves.easeOut);
          return Transform.translate(
            offset: const Offset(.37, 4.68),
            child: Transform.scale(
              scale: pop,
              alignment: const Alignment(0, .1),
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  if (behind) plane,
                  const Positioned.fill(child: Image(image: AssetImage(globeAsset), width: 76, height: 76)),
                  if (!behind) plane,
                  if (spark > 0)
                    for (final (color, to) in _sparks)
                      Positioned(
                        left: 35 + to.dx * reach,
                        top: 38 + to.dy * reach,
                        child: Opacity(
                          opacity: spark,
                          child: Transform.scale(
                            scale: size,
                            child: Container(width: 6, height: 6, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                          ),
                        ),
                      ),
                ],
              ),
            ),
          );
        },
      ),
    ),
  );
}
