import 'dart:async';

import 'package:flutter/material.dart';

import 'relay_style.dart';

/// One beat of the reveal: what the clock and the score read at that moment.
typedef RelayRevealStep = ({int seconds, int score});

/// The beats a reveal passes through, from the clock the team stopped down to
/// zero.
///
/// The clock drops to the next multiple of ten, then ten at a time, and the
/// score at each beat is what the time spent so far is worth — half a point a
/// second, rounded down — so 47s and 20 pts runs 47/20, 40/23, 30/28 … 0/43,
/// ending on exactly the bonus the server paid.
List<RelayRevealStep> relayRevealSteps({required int seconds, required int score}) {
  final start = seconds < 0 ? 0 : seconds;
  final steps = <RelayRevealStep>[(seconds: start, score: score)];
  var next = start % 10 == 0 ? start - 10 : start - start % 10;
  while (next >= 0) {
    steps.add((seconds: next, score: score + (start - next) ~/ 2));
    next -= 10;
  }
  return steps;
}

/// CSS `ease-out`, which the prototype's keyframes use between every stop.
const _easeOut = Cubic(0, 0, 0.58, 1);

/// Keyframes as the prototype writes them: stops at fractions of the run, each
/// leg eased on its own, as a browser does.
Animatable<double> _keyframes(List<(double at, double value)> stops) {
  return TweenSequence<double>([
    for (var i = 1; i < stops.length; i += 1)
      TweenSequenceItem(
        tween: Tween(begin: stops[i - 1].$2, end: stops[i].$2).chain(CurveTween(curve: _easeOut)),
        weight: stops[i].$1 - stops[i - 1].$1,
      ),
  ]);
}

// The prototype's @keyframes (Figma Make "UI Animation Preparation").
final _scorePop = _keyframes([(0, 1), (0.35, 1.08), (0.70, 1.03), (1, 1)]);
final _timerBounce = _keyframes([(0, 1), (0.25, 1.1), (0.55, 0.96), (0.80, 1.04), (1, 1)]);
final _floatScale = _keyframes([(0, 1), (0.2, 1.1), (1, 0.9)]);
final _floatRise = _keyframes([(0, 0), (0.2, -6), (1, -36)]);
final _floatFade = _keyframes([(0, 1), (0.2, 1), (1, 0)]);

/// "Time remaining" over the round clock (Figma 2751:40546).
class RelayTimerBadge extends StatelessWidget {
  const RelayTimerBadge({super.key, required this.seconds, this.scale = 1});

  final int seconds;

  /// The reveal's bounce as the clock runs out.
  final double scale;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(39, 20, 39, 18),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            height: 25,
            child: Center(
              child: Text(
                'Time remaining',
                style: RelayStyle.sora(12, weight: FontWeight.w800, color: RelayStyle.surface),
              ),
            ),
          ),
          Transform.scale(
            scale: scale,
            child: Text(
              '$seconds s',
              style: RelayStyle.sora(32, weight: FontWeight.w800, color: Colors.white, height: 48)
                  .copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
            ),
          ),
        ],
      ),
    );
  }
}

/// "YOUR SCORE" on the sunburst (Figma 2751:40664), with room for the reveal's
/// floating "+5" beside the number.
class RelayScoreCard extends StatelessWidget {
  const RelayScoreCard({super.key, required this.points, this.scale = 1, this.floater});

  final int points;
  final double scale;

  /// Drawn over the card's top-right edge, where the prototype floats it.
  final Widget? floater;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(7),
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            const Positioned.fill(child: ColoredBox(color: Colors.white)),
            Positioned.fill(
              child: Opacity(
                opacity: 0.79,
                child: Image.asset('${RelayStyle.asset}/score_sunburst.jpg', fit: BoxFit.cover),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 26 + 18, vertical: 8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'YOUR SCORE',
                    style: RelayStyle.sora(11, weight: FontWeight.w700, color: RelayStyle.secondary, height: 16.5, spacing: 1),
                  ),
                  Stack(
                    clipBehavior: Clip.none,
                    children: [
                      Transform.scale(
                        scale: scale,
                        child: Text('$points pts', style: RelayStyle.sora(18, weight: FontWeight.w700, height: 28)),
                      ),
                      if (floater != null) Positioned(top: -8, right: -24, child: floater!),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The round's clock turning into points (Figma 2804:11327 and the Make
/// prototype): the timer drains in tens while the score climbs, a "+5" floats
/// off each step, and the last three steps bounce.
///
/// One component for every team and every round — the numbers are the game's,
/// never the design's example. [onDone] fires half a second after zero.
class RelayScoreReveal extends StatefulWidget {
  const RelayScoreReveal({
    super.key,
    required this.secondsSaved,
    required this.roundPoints,
    this.onDone,
    this.onPoints,
    this.onSilence,
  });

  final int secondsSaved;
  final int roundPoints;
  final VoidCallback? onDone;

  /// Each step that adds points — where the sound goes, and only there.
  final VoidCallback? onPoints;

  /// When the reveal is over or leaves the screen, however it goes: the sound
  /// must not outlast it.
  final VoidCallback? onSilence;

  /// The prototype's beat, and its pause on zero before moving on.
  static const step = Duration(milliseconds: 220);
  static const hold = Duration(milliseconds: 500);

  @override
  State<RelayScoreReveal> createState() => _RelayScoreRevealState();
}

class _RelayScoreRevealState extends State<RelayScoreReveal> with TickerProviderStateMixin {
  late final List<RelayRevealStep> _steps =
      relayRevealSteps(seconds: widget.secondsSaved, score: widget.roundPoints);
  int _index = 0;
  Timer? _beat;
  Timer? _finish;

  late final _pop = AnimationController(vsync: this, duration: const Duration(milliseconds: 280));
  late final _bounce = AnimationController(vsync: this, duration: const Duration(milliseconds: 280));
  late final _float = AnimationController(vsync: this, duration: const Duration(milliseconds: 600));

  /// What the last step added, floated beside the score.
  int _gain = 0;
  bool _floating = false;
  Timer? _floatTimer;

  @override
  void initState() {
    super.initState();
    _beat = Timer.periodic(RelayScoreReveal.step, (_) => _advance());
  }

  void _advance() {
    if (!mounted) return;
    if (_index + 1 >= _steps.length) {
      _beat?.cancel();
      _finish = Timer(RelayScoreReveal.hold, () {
        widget.onSilence?.call();
        widget.onDone?.call();
      });
      return;
    }
    setState(() {
      _index += 1;
      _gain = _steps[_index].score - _steps[_index - 1].score;
      _floating = _gain > 0;
    });
    _pop.forward(from: 0);
    // The urgent end: the prototype bounces the clock on its last three steps.
    if (_index >= _steps.length - 3) _bounce.forward(from: 0);
    if (_floating) {
      widget.onPoints?.call();
      _float.forward(from: 0);
      _floatTimer?.cancel();
      _floatTimer = Timer(const Duration(milliseconds: 650), () {
        if (mounted) setState(() => _floating = false);
      });
    }
  }

  @override
  void dispose() {
    // Covers every way out — a new round arriving, the screen closing — not
    // only the reveal running to its end.
    widget.onSilence?.call();
    _beat?.cancel();
    _finish?.cancel();
    _floatTimer?.cancel();
    _pop.dispose();
    _bounce.dispose();
    _float.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final now = _steps[_index];
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // The reveal frame gives the clock a taller block than the question
        // does (138 with 4 on top), which drops it and the score a little.
        SizedBox(
          height: 138,
          child: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Center(
              child: AnimatedBuilder(
                animation: _bounce,
                builder: (context, _) => RelayTimerBadge(
                  seconds: now.seconds,
                  scale: _bounce.isAnimating ? _timerBounce.evaluate(_bounce) : 1,
                ),
              ),
            ),
          ),
        ),
        AnimatedBuilder(
          animation: Listenable.merge([_pop, _float]),
          builder: (context, _) => RelayScoreCard(
            points: now.score,
            scale: _index > 0 ? _scorePop.evaluate(_pop) : 1,
            floater: _floating
                ? Opacity(
                    opacity: _floatFade.evaluate(_float).clamp(0.0, 1.0),
                    child: Transform.translate(
                      offset: Offset(0, _floatRise.evaluate(_float)),
                      child: Transform.scale(
                        scale: _floatScale.evaluate(_float),
                        child: Text(
                          '+$_gain',
                          style: RelayStyle.sora(14, weight: FontWeight.w700, color: const Color(0xFF078442), height: 21),
                        ),
                      ),
                    ),
                  )
                : null,
          ),
        ),
        const SizedBox(height: 18 + 32),
        Opacity(
          opacity: 0.85,
          child: Text(
            'Round complete!',
            textAlign: TextAlign.center,
            style: RelayStyle.sora(20, weight: FontWeight.w800, color: Colors.white, height: 30, spacing: -0.1),
          ),
        ),
        const SizedBox(height: 16),
        Text(
          'Converting remaining time to points…',
          textAlign: TextAlign.center,
          style: RelayStyle.sora(14, color: const Color(0xE6CCFCFF), height: 21),
        ),
      ],
    );
  }
}
