import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../../../services/api_config.dart';
import '../data/secret_squad_post.dart';
import 'secret_squad_style.dart';

/// The game-over card's "Top 10 players" box ("Secret Squad · game over"
/// design): slow white rays turning behind, confetti falling, a podium in
/// the order 3 · 1 · 2 whose bars grow up and whose players pop in (the
/// winner under a wobbling crown), then ranks 4 to 10 in two columns sliding
/// in one after another, and last the viewer's own rank, "You".
///
/// Only what there is is drawn: fewer than three players leave podium places
/// empty (the winner stays in the middle), fewer than ten leave the list
/// short, and with no one past the podium and no "You" there is no list.
///
/// The viewer's own rank shows only if they played. Within the top 10 they
/// are marked where they stand ("You", highlighted, in the list; "You" under
/// their face on the podium) and the extra cell is left out: the box stays
/// the top 10 and nothing is said twice.
///
/// Every motion is the design's CSS, timed from one clock started when the
/// box first shows. With animations off (MediaQuery.disableAnimations) it is
/// the last frame, still: bars up, faces in, rays and crown at rest, and no
/// confetti, as the design's reduced-motion rule has it.
class SquadResultsBox extends StatefulWidget {
  const SquadResultsBox({
    super.key,
    required this.results,
    required this.viewerId,
    this.debugTime,
  });

  /// Everyone who played, most points first.
  final List<SquadStanding> results;

  /// The person looking at the card.
  final String viewerId;

  /// Draws the box frozen this many seconds in; screenshots only.
  final double? debugTime;

  @override
  State<SquadResultsBox> createState() => _SquadResultsBoxState();
}

class _SquadResultsBoxState extends State<SquadResultsBox>
    with SingleTickerProviderStateMixin {
  late final Ticker _ticker = createTicker(_tick);

  /// Every frame, for what loops: the rays, the confetti and the crown.
  final _time = ValueNotifier<_Motion>(const _Motion.at(0));

  /// Every frame until the entrances are done, then left on their last.
  final _entrance = ValueNotifier<_Motion>(const _Motion.at(0));

  /// When the last entrance (the "You" cell's) is over, with room to spare.
  static const _entranceEnd = 2.6;

  void _tick(Duration elapsed) {
    final motion = _Motion.at(elapsed.inMicroseconds / 1e6);
    _time.value = motion;
    if (_entrance.value.t <= _entranceEnd) _entrance.value = motion;
  }

  void _show(_Motion motion) {
    _time.value = motion;
    _entrance.value = motion;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(covariant SquadResultsBox oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.debugTime != widget.debugTime) _sync();
  }

  void _sync() {
    final debugTime = widget.debugTime;
    if (MediaQuery.disableAnimationsOf(context)) {
      _ticker.stop();
      _show(const _Motion.still());
    } else if (debugTime != null) {
      _ticker.stop();
      _show(_Motion.at(debugTime));
    } else if (!_ticker.isActive) {
      _ticker.start();
    }
  }

  @override
  void dispose() {
    _ticker.dispose();
    _time.dispose();
    _entrance.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final results = widget.results;
    final top = results.take(10).toList();
    final viewerId = widget.viewerId;
    final mine = viewerId.isEmpty
        ? -1
        : results.indexWhere((row) => row.userId == viewerId);
    final rest = top.skip(3).toList();
    final cells = <_RankChip>[
      for (var i = 0; i < rest.length; i++)
        _RankChip(
          standing: rest[i],
          place: i + 3,
          you: mine == i + 3,
          delay: 1.3 + 0.06 * i,
          time: _entrance,
        ),
      if (mine >= 10)
        _RankChip(
          standing: results[mine],
          place: mine,
          you: true,
          delay: rest.isEmpty ? 1.3 : 1.3 + 0.06 * (rest.length - 1) + 0.14,
          time: _entrance,
        ),
    ];
    return ClipRRect(
      borderRadius: BorderRadius.circular(20),
      child: ColoredBox(
        color: _lavender,
        child: Stack(
          children: [
            Positioned.fill(
              child: RepaintBoundary(
                child: CustomPaint(painter: _RaysPainter(_time)),
              ),
            ),
            Positioned.fill(
              child: RepaintBoundary(
                child: CustomPaint(painter: _ConfettiPainter(_time)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 12, 10, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'Top 10 players',
                    textAlign: TextAlign.center,
                    style: SquadStyle.lexend(
                      13,
                      FontWeight.w600,
                      SquadStyle.clockInk,
                    ),
                  ),
                  const SizedBox(height: 10),
                  _Podium(
                    places: top.take(3).toList(),
                    mine: mine,
                    time: _entrance,
                    loop: _time,
                  ),
                  // The design's 10 gap less the list's -10 margin: the list
                  // starts where the bars end.
                  if (cells.isNotEmpty) _RankList(cells: cells),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

const _lavender = Color(0xFFE6E2FF);
const _navy = SquadStyle.navy;
const _gold = SquadStyle.yellow;

/// The faces' fills when there is no photo, by place: the design's own.
const _faceFills = [
  Color(0xFFFFD6DA),
  Color(0xFFCDE3FF),
  Color(0xFFFFC9A8),
  Color(0xFFBFE6C8),
  Color(0xFFFFE8A3),
  Color(0xFFD9D2FF),
  Color(0xFFFFC9A8),
  Color(0xFFCDE3FF),
  Color(0xFFFFD6DA),
  Color(0xFFBFE6C8),
];

/// The viewer's own face, as the app's header draws it in the design.
const _youFill = Color(0xFFF26B6B);

/// `pop`: cubic-bezier(.2,1.6,.4,1), overshooting.
const _popCurve = Cubic(0.2, 1.6, 0.4, 1);

/// `grow`: cubic-bezier(.2,1.3,.4,1), overshooting.
const _growCurve = Cubic(0.2, 1.3, 0.4, 1);

/// CSS `ease-in-out`.
const _ease = Cubic(0.42, 0, 0.58, 1);

/// Where the box's motion is: [t] seconds since it first showed, or [still]
/// (animations off), the last frame.
@immutable
class _Motion {
  const _Motion.at(this.t) : still = false;
  const _Motion.still() : t = 0, still = true;

  final double t;
  final bool still;

  /// A once-only entrance (CSS fill-mode both): 0 before [delay], along
  /// [curve] for [length] seconds, then 1; 1 when still.
  double entrance(double delay, double length, Curve curve) {
    if (still) return 1;
    return curve.transform(((t - delay) / length).clamp(0.0, 1.0));
  }

  /// Where a loop of [period] seconds is, 0 to 1; 0 when still.
  double loop(double period) => still ? 0 : (t % period) / period;
}

class _Place {
  const _Place({
    required this.bar,
    required this.fill,
    required this.ink,
    required this.rankOpacity,
    required this.pointsSize,
    required this.pointsWeight,
    required this.face,
    required this.initialsSize,
    required this.barDelay,
    required this.popDelay,
  });

  final double bar;
  final Color fill;
  final Color ink;
  final double rankOpacity;
  final double pointsSize;
  final FontWeight pointsWeight;
  final double face;
  final double initialsSize;
  final double barDelay;
  final double popDelay;
}

/// First, second and third: bar heights and colours, and their entrances
/// (third grows first and the winner pops in last).
const _places = [
  _Place(
    bar: 70,
    fill: _gold,
    ink: _navy,
    rankOpacity: 0.75,
    pointsSize: 20,
    pointsWeight: FontWeight.w800,
    face: 50,
    initialsSize: 16,
    barDelay: 0.7,
    popDelay: 1.15,
  ),
  _Place(
    bar: 58,
    fill: SquadStyle.violetTop,
    ink: Colors.white,
    rankOpacity: 0.85,
    pointsSize: 17,
    pointsWeight: FontWeight.w700,
    face: 40,
    initialsSize: 13,
    barDelay: 0.4,
    popDelay: 0.85,
  ),
  _Place(
    bar: 46,
    fill: Color(0xFF2F80ED),
    ink: Colors.white,
    rankOpacity: 0.85,
    pointsSize: 17,
    pointsWeight: FontWeight.w700,
    face: 40,
    initialsSize: 13,
    barDelay: 0.15,
    popDelay: 0.6,
  ),
];

class _Podium extends StatelessWidget {
  const _Podium({
    required this.places,
    required this.mine,
    required this.time,
    required this.loop,
  });

  /// Up to three, the winner first.
  final List<SquadStanding> places;

  /// The viewer's place among everyone, or -1.
  final int mine;

  /// The entrances' clock, and the crown's.
  final ValueListenable<_Motion> time;
  final ValueListenable<_Motion> loop;

  @override
  Widget build(BuildContext context) {
    Widget column(int place) => Expanded(
      child: place < places.length
          ? _Step(
              standing: places[place],
              place: place,
              you: mine == place,
              time: time,
              loop: loop,
            )
          : const SizedBox.shrink(),
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(6, 10, 6, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          column(2),
          const SizedBox(width: 8),
          column(0),
          const SizedBox(width: 8),
          column(1),
        ],
      ),
    );
  }
}

/// One podium place: the face and name popping in over a growing bar.
class _Step extends StatelessWidget {
  const _Step({
    required this.standing,
    required this.place,
    required this.you,
    required this.time,
    required this.loop,
  });

  final SquadStanding standing;
  final int place;
  final bool you;
  final ValueListenable<_Motion> time;
  final ValueListenable<_Motion> loop;

  @override
  Widget build(BuildContext context) {
    final spec = _places[place];
    final winner = place == 0;
    Widget face = _Face(
      initials: standing.initials,
      photoUrl: standing.photoUrl,
      size: spec.face,
      fill: _faceFills[place],
      initialsSize: spec.initialsSize,
      ring: spec.fill,
      glow: winner,
    );
    if (winner) {
      face = Stack(
        clipBehavior: Clip.none,
        children: [
          face,
          // 15 over the face's inside edge, so 12 over its ring.
          Positioned(
            top: -12,
            left: (spec.face + 6) / 2 - 12,
            child: _Crown(time: loop),
          ),
        ],
      );
    }
    final who = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        face,
        const SizedBox(height: 2),
        Text(
          you ? 'You' : standing.shortName,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.center,
          style: SquadStyle.lexend(12.5, FontWeight.w700, _navy, height: 1.2),
        ),
      ],
    );
    final bar = Container(
      height: spec.bar,
      decoration: BoxDecoration(
        color: spec.fill,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            '#${standing.rank}',
            style: SquadStyle.lexend(
              11,
              FontWeight.w700,
              spec.ink.withValues(alpha: spec.rankOpacity),
            ),
          ),
          const SizedBox(width: 6),
          Flexible(
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                '${standing.points}',
                maxLines: 1,
                style: SquadStyle.lexend(
                  spec.pointsSize,
                  spec.pointsWeight,
                  spec.ink,
                  tabular: true,
                ),
              ),
            ),
          ),
        ],
      ),
    );
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          label:
              '#${standing.rank} ${you ? 'You' : standing.shortName}, '
              '${standing.points} points',
          excludeSemantics: true,
          child: ValueListenableBuilder<_Motion>(
            valueListenable: time,
            child: who,
            builder: (context, motion, child) {
              // pop: scale and opacity 0 → 1 over .5 s.
              final e = motion.entrance(spec.popDelay, 0.5, _popCurve);
              return Opacity(
                opacity: e.clamp(0.0, 1.0),
                child: Transform.scale(scale: e <= 0 ? 1 : e, child: child),
              );
            },
          ),
        ),
        const SizedBox(height: 5),
        ExcludeSemantics(
          child: ValueListenableBuilder<_Motion>(
            valueListenable: time,
            child: bar,
            builder: (context, motion, child) {
              // grow: scaleY 0 → 1 from the bottom over .9 s.
              final e = motion.entrance(spec.barDelay, 0.9, _growCurve);
              return Opacity(
                opacity: e <= 0 ? 0 : 1,
                child: Transform(
                  alignment: Alignment.bottomCenter,
                  transform: Matrix4.diagonal3Values(1, e <= 0 ? 1 : e, 1),
                  child: child,
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

/// The ranks past the podium, in two columns filled top to bottom.
class _RankList extends StatelessWidget {
  const _RankList({required this.cells});

  final List<_RankChip> cells;

  @override
  Widget build(BuildContext context) {
    final rows = (cells.length + 1) ~/ 2;
    // A grid row is as tall as its tallest chip: 34, or 35 beside "You"
    // (its 1.5 border).
    Widget cell(int index, double height) => index < cells.length
        ? ConstrainedBox(
            constraints: BoxConstraints(minHeight: height),
            child: cells[index],
          )
        : const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var row = 0; row < rows; row++) ...[
            if (row > 0) const SizedBox(height: 6),
            Builder(
              builder: (context) {
                final you =
                    cells[row].you ||
                    (rows + row < cells.length && cells[rows + row].you);
                final height = you ? 35.0 : 34.0;
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: cell(row, height)),
                    const SizedBox(width: 8),
                    Expanded(child: cell(rows + row, height)),
                  ],
                );
              },
            ),
          ],
        ],
      ),
    );
  }
}

/// One rank in the list: the number, a face, the name and the points; the
/// viewer's own highlighted as "You".
class _RankChip extends StatelessWidget {
  const _RankChip({
    required this.standing,
    required this.place,
    required this.you,
    required this.delay,
    required this.time,
  });

  final SquadStanding standing;

  /// Where they are among everyone, from 0.
  final int place;
  final bool you;
  final double delay;
  final ValueListenable<_Motion> time;

  static final _pointsStyle = SquadStyle.lexend(
    12.5,
    FontWeight.w700,
    _navy,
    tabular: true,
  );
  static final _yourRankStyle = SquadStyle.lexend(
    11,
    FontWeight.w700,
    _navy,
    tabular: true,
  );
  static final _youStyle = SquadStyle.lexend(12.5, FontWeight.w700, _navy);

  @override
  Widget build(BuildContext context) {
    final points = Text('${standing.points}', maxLines: 1, style: _pointsStyle);
    // What the row cannot do without: the rank, the face, the points, and
    // "You" (a name gives way to an ellipsis). On a phone too narrow for
    // that, the row is drawn a little smaller rather than spilling over.
    final scaler = MediaQuery.textScalerOf(context);
    double width(String text, TextStyle style) {
      final painter = TextPainter(
        text: TextSpan(text: text, style: style),
        textDirection: TextDirection.ltr,
        textScaler: scaler,
        maxLines: 1,
      )..layout();
      final width = painter.width;
      painter.dispose();
      return width;
    }

    final needed =
        (you ? width('#${standing.rank}', _yourRankStyle) : 16) +
        7 +
        24 +
        7 +
        (you ? width('You', _youStyle) : 0) +
        7 +
        width('${standing.points}', _pointsStyle);
    Widget fit(Widget row) => LayoutBuilder(
      builder: (context, box) => box.maxWidth >= needed
          ? row
          : FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: SizedBox(width: needed, child: row),
            ),
    );
    final chip = you
        ? Container(
            key: const ValueKey('squad-results-you'),
            alignment: Alignment.centerLeft,
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF3C4),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: _gold, width: 1.5),
            ),
            child: fit(
              Row(
                children: [
                  Text('#${standing.rank}', style: _yourRankStyle),
                  const SizedBox(width: 7),
                  _Face(
                    initials: _firstLetter(standing.initials),
                    photoUrl: standing.photoUrl,
                    size: 24,
                    fill: _youFill,
                    ink: Colors.white,
                    initialsSize: 10,
                  ),
                  const SizedBox(width: 7),
                  Expanded(child: Text('You', maxLines: 1, style: _youStyle)),
                  const SizedBox(width: 7),
                  points,
                ],
              ),
            ),
          )
        : Container(
            alignment: Alignment.centerLeft,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
            decoration: BoxDecoration(
              color: const Color(0xFFF6F5FF),
              borderRadius: BorderRadius.circular(10),
            ),
            child: fit(
              Row(
                children: [
                  SizedBox(
                    width: 16,
                    child: Text(
                      '${standing.rank}',
                      maxLines: 1,
                      softWrap: false,
                      overflow: TextOverflow.visible,
                      style: SquadStyle.lexend(
                        12,
                        FontWeight.w700,
                        const Color(0xFF4A4F63),
                        tabular: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: 7),
                  _Face(
                    initials: standing.initials,
                    photoUrl: standing.photoUrl,
                    size: 24,
                    fill: _faceFills[place % _faceFills.length],
                    initialsSize: 9.5,
                  ),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Text(
                      standing.shortName,
                      maxLines: 1,
                      softWrap: false,
                      overflow: TextOverflow.ellipsis,
                      style: SquadStyle.lexend(12.5, FontWeight.w400, _navy),
                    ),
                  ),
                  const SizedBox(width: 7),
                  points,
                ],
              ),
            ),
          );
    return Semantics(
      label: you
          ? 'Your rank: #${standing.rank}, ${standing.points} points'
          : '#${standing.rank} ${standing.shortName}, '
                '${standing.points} points',
      excludeSemantics: true,
      child: ValueListenableBuilder<_Motion>(
        valueListenable: time,
        child: chip,
        builder: (context, motion, child) {
          // slidein: up 8 and in over .45 s, ease-out.
          final e = motion.entrance(delay, 0.45, Curves.easeOut);
          return Opacity(
            opacity: e,
            child: Transform.translate(
              offset: Offset(0, 8 * (1 - e)),
              child: child,
            ),
          );
        },
      ),
    );
  }
}

String _firstLetter(String initials) =>
    initials.isEmpty ? '?' : String.fromCharCode(initials.runes.first);

/// A round face: the photo, or the initials on [fill] while it loads or if
/// it cannot; with a 3-wide [ring] round it when given, and the winner's
/// gold [glow] outside that.
class _Face extends StatelessWidget {
  const _Face({
    required this.initials,
    required this.photoUrl,
    required this.size,
    required this.fill,
    required this.initialsSize,
    this.ink = _navy,
    this.ring,
    this.glow = false,
  });

  final String initials;
  final String? photoUrl;

  /// Inside the ring.
  final double size;
  final Color fill;
  final double initialsSize;
  final Color ink;
  final Color? ring;
  final bool glow;

  @override
  Widget build(BuildContext context) {
    final letters = ColoredBox(
      color: fill,
      child: Center(
        child: Text(
          initials,
          maxLines: 1,
          softWrap: false,
          style: SquadStyle.lexend(initialsSize, FontWeight.w700, ink),
        ),
      ),
    );
    final url = photoUrl;
    final inside = url == null || url.isEmpty
        ? letters
        : Image(
            image: avatarImageProvider(url),
            width: size,
            height: size,
            fit: BoxFit.cover,
            errorBuilder: (_, _, _) => letters,
            frameBuilder: (_, child, frame, wasSync) =>
                frame == null && !wasSync ? letters : child,
          );
    final ringColor = ring;
    final edge = ringColor == null ? 0.0 : 3.0;
    return Container(
      width: size + 2 * edge,
      height: size + 2 * edge,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: fill,
        border: ringColor == null
            ? null
            : Border.all(color: ringColor, width: edge),
        // 0 0 0 4px rgba(255,204,46,.35)
        boxShadow: glow
            ? const [BoxShadow(color: Color(0x59FFCC2E), spreadRadius: 4)]
            : null,
      ),
      child: ClipOval(
        child: SizedBox.square(dimension: size, child: inside),
      ),
    );
  }
}

/// The winner's crown, wobbling on its base: ±10° and up 3 every 2.6 s.
class _Crown extends StatelessWidget {
  const _Crown({required this.time});

  final ValueListenable<_Motion> time;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<_Motion>(
      valueListenable: time,
      child: const CustomPaint(size: Size(24, 19), painter: _CrownPainter()),
      builder: (context, motion, child) {
        if (motion.still) return child!;
        final p = motion.loop(2.6);
        final half = p < 0.5;
        final e = _ease.transform(half ? p * 2 : (p - 0.5) * 2);
        final degrees = half ? -10 + 20 * e : 10 - 20 * e;
        final up = half ? -3 * e : -3 + 3 * e;
        return Transform(
          alignment: Alignment.bottomCenter,
          transform: Matrix4.rotationZ(degrees * math.pi / 180)
            ..multiply(Matrix4.translationValues(0, up, 0)),
          child: child,
        );
      },
    );
  }
}

class _CrownPainter extends CustomPainter {
  const _CrownPainter();

  @override
  void paint(Canvas canvas, Size size) {
    // The 28 × 22 artboard, fitted and centred (xMidYMid meet).
    final scale = math.min(size.width / 28, size.height / 22);
    canvas
      ..translate((size.width - 28 * scale) / 2, (size.height - 22 * scale) / 2)
      ..scale(scale);
    final crown = Path()
      ..moveTo(2, 6)
      ..lineTo(8, 12)
      ..lineTo(14, 2)
      ..lineTo(20, 12)
      ..lineTo(26, 6)
      ..lineTo(24, 20)
      ..lineTo(4, 20)
      ..close();
    canvas
      ..drawPath(crown, Paint()..color = _gold)
      ..drawPath(
        crown,
        Paint()
          ..color = SquadStyle.gold
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5
          ..strokeJoin = StrokeJoin.round,
      )
      ..drawCircle(
        const Offset(14, 2.5),
        2,
        Paint()..color = const Color(0xFFE8434F),
      );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// `repeating-conic-gradient(rgba(255,255,255,.75) 0deg 9deg, transparent
/// 9deg 22.5deg)` on a 520 circle centred 120 down the box, turning once
/// every 28 s.
class _RaysPainter extends CustomPainter {
  _RaysPainter(this.time) : super(repaint: time);

  final ValueListenable<_Motion> time;

  @override
  void paint(Canvas canvas, Size size) {
    final turn = time.value.loop(28) * 2 * math.pi;
    final paint = Paint()..color = const Color(0xBFFFFFFF);
    final circle = Rect.fromCircle(center: Offset.zero, radius: 260);
    canvas
      ..save()
      ..translate(size.width / 2, 120)
      ..rotate(turn);
    for (var ray = 0; ray < 16; ray++) {
      // Conic angles start at the top and run clockwise.
      final from = -math.pi / 2 + ray * 22.5 * math.pi / 180;
      canvas.drawArc(circle, from, 9 * math.pi / 180, true, paint);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _RaysPainter oldDelegate) =>
      oldDelegate.time != time;
}

/// Six pieces of confetti, 7 × 11, falling 220 and turning 540° every
/// 3.6 s, each from its own start; none with animations off.
class _ConfettiPainter extends CustomPainter {
  _ConfettiPainter(this.time) : super(repaint: time);

  final ValueListenable<_Motion> time;

  /// (left, colour, delay)
  static const _pieces = [
    (0.12, Color(0xFFFFCC2E), 0.0),
    (0.28, Color(0xFFE8434F), 1.2),
    (0.46, Color(0xFF6C5CE7), 0.5),
    (0.62, Color(0xFF22C55E), 2.0),
    (0.76, Color(0xFFFFCC2E), 1.6),
    (0.90, Color(0xFF2F80ED), 0.9),
  ];

  @override
  void paint(Canvas canvas, Size size) {
    final motion = time.value;
    if (motion.still) return;
    for (final (left, color, delay) in _pieces) {
      if (motion.t < delay) continue;
      final p = ((motion.t - delay) % 3.6) / 3.6;
      // Opacity 0 → 1 by 8%, then back to 0 at the end.
      final opacity = p < 0.08 ? p / 0.08 : 1 - (p - 0.08) / 0.92;
      canvas
        ..save()
        ..translate(size.width * left + 3.5, -14 + 5.5 + 220 * p)
        ..rotate(540 * p * math.pi / 180)
        ..drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromCenter(center: Offset.zero, width: 7, height: 11),
            const Radius.circular(2),
          ),
          Paint()..color = color.withValues(alpha: opacity.clamp(0.0, 1.0)),
        )
        ..restore();
    }
  }

  @override
  bool shouldRepaint(covariant _ConfettiPainter oldDelegate) =>
      oldDelegate.time != time;
}

// ---------------------------------------------------------- full leaderboard

/// View Full Leaderboard: everyone who played, best first, in a sheet in the
/// card's colours. The podium's three keep their colours; your own row is
/// the yellow "You" row, as on the card.
Future<void> showSquadLeaderboard(
  BuildContext context, {
  required List<SquadStanding> results,
  required String viewerId,
  String office = '',
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) =>
        _LeaderboardSheet(results: results, viewerId: viewerId, office: office),
  );
}

class _LeaderboardSheet extends StatelessWidget {
  const _LeaderboardSheet({
    required this.results,
    required this.viewerId,
    required this.office,
  });

  final List<SquadStanding> results;
  final String viewerId;
  final String office;

  /// The podium's colours for #1, #2 and #3, as the card's bars.
  static const _medals = [_gold, Color(0xFF5B4BD6), Color(0xFF2F80ED)];

  @override
  Widget build(BuildContext context) {
    final height = MediaQuery.sizeOf(context).height;
    final bottom = MediaQuery.paddingOf(context).bottom;
    final players = results.length;
    return Container(
      constraints: BoxConstraints(maxHeight: height * 0.88),
      decoration: const BoxDecoration(
        color: Color(0xFFF4F5F9),
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The card's purple, with the title.
          Container(
            padding: const EdgeInsets.fromLTRB(22, 12, 12, 18),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment(-0.5, -1),
                end: Alignment(0.5, 1),
                colors: [Color(0xFF5B4BD6), Color(0xFF3A2E9E), Color(0xFF1B1F55)],
                stops: [0, 0.45, 1],
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: 10),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.35),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'FULL LEADERBOARD',
                            style: SquadStyle.lexend(
                              12,
                              FontWeight.w600,
                              const Color(0xFFCFC8FF),
                            ).copyWith(letterSpacing: 12 * 0.14),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Secret Squad',
                            style: SquadStyle.lexend(
                              26,
                              FontWeight.w700,
                              Colors.white,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            [
                              if (office.isNotEmpty) office,
                              players == 1 ? '1 player' : '$players players',
                            ].join(' · '),
                            style: SquadStyle.lexend(
                              14,
                              FontWeight.w400,
                              const Color(0xFFE4E0FF),
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Close',
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close_rounded, color: Colors.white),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Flexible(
            child: ListView.separated(
              shrinkWrap: true,
              padding: EdgeInsets.fromLTRB(16, 14, 16, 16 + bottom),
              itemCount: results.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, i) {
                final row = results[i];
                final you = row.userId == viewerId;
                final medal = row.rank >= 1 && row.rank <= 3
                    ? _medals[row.rank - 1]
                    : null;
                return Container(
                  key: ValueKey('squad-board-${row.userId}'),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                  decoration: BoxDecoration(
                    color: you ? const Color(0xFFFFF3C4) : Colors.white,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: you ? _gold : const Color(0xFFE6E2FF),
                      width: you ? 1.5 : 1,
                    ),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 34,
                        height: 26,
                        alignment: Alignment.center,
                        decoration: medal == null
                            ? null
                            : BoxDecoration(
                                color: medal,
                                borderRadius: BorderRadius.circular(8),
                              ),
                        child: Text(
                          '#${row.rank}',
                          style: SquadStyle.lexend(
                            12.5,
                            FontWeight.w700,
                            medal == null || medal == _gold
                                ? _navy
                                : Colors.white,
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      _Face(
                        initials: row.initials,
                        photoUrl: row.photoUrl,
                        size: 34,
                        fill: you ? _youFill : _faceFills[i % _faceFills.length],
                        ink: you ? Colors.white : _navy,
                        initialsSize: 12,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          you ? 'You' : row.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: SquadStyle.lexend(
                            15,
                            you ? FontWeight.w700 : FontWeight.w500,
                            _navy,
                          ),
                        ),
                      ),
                      Text(
                        '${row.points}',
                        style: SquadStyle.lexend(15, FontWeight.w700, _navy)
                            .copyWith(
                              fontFeatures: const [FontFeature.tabularFigures()],
                            ),
                      ),
                      Text(
                        ' pts',
                        style: SquadStyle.lexend(
                          12,
                          FontWeight.w400,
                          const Color(0xFF5B6075),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
