import 'dart:async';

import 'package:flutter/material.dart';

import '../data/relay_models.dart';
import 'relay_round_demo.dart';
import 'relay_style.dart';

/// Between rounds, and at the end (Figma 2717:39052, opening to 2777:43446).
///
/// Every team sees the same table at the same moment, because rounds start
/// together whoever finished first — finishing early buys points, not a head
/// start. So the break is where the room finds out where it stands.
class RelayLeaderboard extends StatelessWidget {
  const RelayLeaderboard({
    super.key,
    required this.state,
    required this.secondsLeft,
    this.onClose,
  });

  final RelayState state;

  /// Counts down to the next round; unused once the game is over.
  final int secondsLeft;
  final VoidCallback? onClose;

  /// Over, either because the server says so or because that was the last
  /// round — a countdown to a round that cannot come is worse than no clock.
  bool get _finished =>
      state.phase == RelayPhase.finished || state.round >= state.rounds;

  /// What the next round is, as the imported sheet set it — nothing after the
  /// last one.
  String? get _nextKind {
    if (_finished || state.round >= state.rounds) return null;
    final kinds = state.roundKinds;
    return state.round < kinds.length ? kinds[state.round] : null;
  }

  String get _clock {
    final minutes = (secondsLeft ~/ 60).toString().padLeft(2, '0');
    final seconds = (secondsLeft % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  @override
  Widget build(BuildContext context) {
    final top = state.standings.take(3).toList();
    return RelayBackdrop(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Over: the game's own name across the top with the way out beside
          // it. Between rounds: the clock to the next one.
          if (_finished)
            Stack(
              alignment: Alignment.center,
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: GestureDetector(
                    onTap: onClose,
                    child: RelayStyle.svg('cross', width: 24, height: 24),
                  ),
                ),
                Text(
                  state.eventName.isEmpty ? 'Hint Relay' : state.eventName,
                  style: RelayStyle.sora(
                    16,
                    weight: FontWeight.w600,
                    color: Colors.white,
                    height: 24 / 16,
                  ),
                ),
              ],
            )
          else
            Center(child: _timerBadge()),
          const SizedBox(height: 24),
          Text(
            _finished ? 'GAME COMPLETE!' : 'ROUND COMPLETE!',
            textAlign: TextAlign.center,
            style: RelayStyle.sora(26, weight: FontWeight.w800, color: Colors.white, height: 39),
          ),
          if (!_finished) ...[
            const SizedBox(height: 4),
            Text(
              // What this screen counts down to is the next round, so that is
              // the one it names.
              'ROUND ${state.round >= state.rounds ? state.rounds : state.round + 1} OF ${state.rounds}',
              textAlign: TextAlign.center,
              style: RelayStyle.sora(13, color: RelayStyle.onBlue, height: 19.5),
            ),
          ],
          if (_nextKind != null)
            // Time to read the score first; then what is coming next.
            _AfterAMoment(
              child: Padding(
                padding: const EdgeInsets.only(top: 24),
                child: _NextRound(round: state.round + 1, kind: _nextKind!),
              ),
            ),
          const SizedBox(height: 18),
          if (top.isNotEmpty)
            RelayPodium(top: top, title: _finished ? 'Final standings' : 'Top 3'),
          const SizedBox(height: 16 + 24),
          _yourTeam(),
          const SizedBox(height: 16),
          Text(
            'LEADERBOARD',
            style: RelayStyle.sora(
              12,
              weight: FontWeight.w700,
              color: Colors.white,
              height: 18,
              spacing: 0.5,
            ),
          ),
          const SizedBox(height: 12),
          for (var i = 0; i < state.standings.length; i += 1) ...[
            if (i > 0) const SizedBox(height: 12),
            _row(state.standings[i]),
          ],
        ],
      ),
    );
  }

  Widget _timerBadge() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 97,
            child: Text(
              'Next round in',
              textAlign: TextAlign.center,
              style: RelayStyle.sora(12, weight: FontWeight.w800, color: RelayStyle.secondary),
            ),
          ),
          Text(
            _clock,
            style: RelayStyle.sora(
              14,
              weight: FontWeight.w800,
              color: RelayStyle.green,
            ).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
          ),
        ],
      ),
    );
  }

  Widget _yourTeam() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0x1F0571A6), width: 1.129),
      ),
      child: Stack(
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'YOU',
                style: RelayStyle.sora(10, weight: FontWeight.w600, color: RelayStyle.tertiary, height: 18),
              ),
              const SizedBox(height: 2 + 8),
              Padding(
                // Clear of the total on the right.
                padding: const EdgeInsets.only(right: 72),
                child: Text(
                  state.yourRank > 0 ? '#${state.yourRank} ${state.teamName}' : state.teamName,
                  style: RelayStyle.sora(20, weight: FontWeight.w700, color: RelayStyle.brand, height: 19.5),
                ),
              ),
              const SizedBox(height: 2 + 8),
              SizedBox(
                width: double.infinity,
                height: 1,
                child: RelayStyle.svg('divider_line', width: double.infinity, height: 1, fit: BoxFit.fill),
              ),
              const SizedBox(height: 2 + 12),
              Text(
                '+${state.pointsThisRound} points this round',
                style: RelayStyle.sora(16, weight: FontWeight.w600, color: const Color(0xFFFF8D28), height: 18),
              ),
            ],
          ),
          Positioned(
            right: 0,
            top: 0,
            bottom: 0,
            child: Center(
              child: SizedBox(
                height: 34,
                child: Text(
                  '${state.points} pts',
                  style: RelayStyle.sora(16, weight: FontWeight.w700, color: RelayStyle.brand, height: 19.5),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(RelayStanding row) {
    final mine = row.name == state.teamName;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: mine ? Colors.white : RelayStyle.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: mine ? const Color(0x330571A6) : const Color(0xFFEBEBEB),
          width: 1.129,
        ),
      ),
      child: Row(
        children: [
          Flexible(
            child: Text(
              '${row.rank}. ${row.name}',
              overflow: TextOverflow.ellipsis,
              style: RelayStyle.sora(14, weight: mine ? FontWeight.w700 : FontWeight.w600, height: 21),
            ),
          ),
          if (mine) ...[
            const SizedBox(width: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                color: const Color(0x1A0571A6),
                borderRadius: BorderRadius.circular(99),
              ),
              child: Text(
                'YOU',
                style: RelayStyle.sora(10, weight: FontWeight.w700, color: RelayStyle.brand, height: 15, spacing: 0.3),
              ),
            ),
          ],
          const Spacer(),
          Text(
            '${row.points} pts',
            style: RelayStyle.sora(15, weight: FontWeight.w700, color: RelayStyle.secondary, height: 22.5),
          ),
        ],
      ),
    );
  }
}

/// A look at the next round, which opens by itself a second after the
/// leaderboard lands (Figma 2717:39052 closed, 2777:43446 open).
class _NextRound extends StatefulWidget {
  const _NextRound({required this.round, required this.kind});

  final int round;
  final String kind;

  @override
  State<_NextRound> createState() => _NextRoundState();
}

class _NextRoundState extends State<_NextRound> {
  bool _open = false;
  Timer? _timer;

  /// Closed, the card shows its heading row only: 24 above, 17 of text, 21
  /// below — the design's 62.
  static const _closedHeight = 62.0;

  @override
  void initState() {
    super.initState();
    _timer = Timer(const Duration(seconds: 1), () {
      if (mounted) setState(() => _open = true);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final card = RelayRoundDemo(round: widget.round, kind: widget.kind, place: RelayDemoPlace.nextRound);
    return AnimatedSize(
      duration: const Duration(milliseconds: 400),
      curve: Curves.easeOutCubic,
      alignment: Alignment.topCenter,
      child: _open
          ? card
          : Container(
              height: _closedHeight,
              // The card is cut short, so its outline is drawn on the cut.
              foregroundDecoration: BoxDecoration(
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: Colors.white, width: 1.129),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(20),
                child: OverflowBox(
                  alignment: Alignment.topCenter,
                  maxHeight: double.infinity,
                  child: card,
                ),
              ),
            ),
    );
  }
}

/// The top three on a podium: third, first raised in the middle, second — the
/// order a podium stands in, not the order a list reads. Shared by the
/// leaderboard and the finished game's post (Figma 2717:39071, 2759:43105).
class RelayPodium extends StatelessWidget {
  const RelayPodium({
    super.key,
    required this.top,
    required this.title,
    this.surface = 'ranking_surface.png',
    this.surfaceLeft = 0.0006,
    this.surfaceTop = -0.323,
  });

  final List<RelayStanding> top;
  final String title;

  /// The rays behind the podium, and where the design places them.
  final String surface;
  final double surfaceLeft;
  final double surfaceTop;

  @override
  Widget build(BuildContext context) {
    RelayStanding? at(int rank) => top.length >= rank ? top[rank - 1] : null;
    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: Container(
        decoration: BoxDecoration(
          color: const Color(0xFFC3EBFE),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFEBEBEB)),
        ),
        child: Stack(
          children: [
            // The rays behind the podium, at the design's own 18%.
            Positioned.fill(
              child: LayoutBuilder(
                builder: (context, box) => Stack(
                  children: [
                    Positioned(
                      left: surfaceLeft * box.maxWidth,
                      top: surfaceTop * box.maxHeight,
                      width: box.maxWidth,
                      height: 1.4799 * box.maxHeight,
                      child: Opacity(
                        opacity: 0.18,
                        child: Image.asset(
                          '${RelayStyle.asset}/$surface',
                          fit: BoxFit.fill,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 18, 12, 12),
              child: Column(
                children: [
                  Text(
                    title,
                    style: RelayStyle.sora(11, weight: FontWeight.w700, color: RelayStyle.secondary),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Expanded(child: _place(at(3), 3)),
                      const SizedBox(width: 8),
                      Expanded(child: _place(at(1), 1)),
                      const SizedBox(width: 8),
                      Expanded(child: _place(at(2), 2)),
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

  static const _placeColor = {
    1: Color(0xFFFFCC00),
    2: Color(0xFF34C759),
    3: Color(0xFF0088FF),
  };
  static const _barHeight = {1: 116.0, 2: 92.0, 3: 72.0};

  Widget _place(RelayStanding? row, int rank) {
    if (row == null) return const SizedBox.shrink();
    final color = _placeColor[rank]!;
    final first = rank == 1;
    final frame = first ? 68.0 : 54.0;
    final portrait = first ? 62.0 : 48.0;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 32,
          height: 32,
          child: first
              ? Container(
                  decoration: const BoxDecoration(color: Color(0xFFFFF3B8), shape: BoxShape.circle),
                  alignment: Alignment.center,
                  child: Image.asset('${RelayStyle.asset}/trophy.png', width: 18, height: 18),
                )
              : Center(
                  child: Text(
                    rank == 2 ? '🥈' : '🥉',
                    style: const TextStyle(fontSize: 18, height: 22 / 18),
                  ),
                ),
        ),
        const SizedBox(height: 8),
        Container(
          width: frame,
          height: frame,
          decoration: BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,
            border: Border.all(color: color, width: 3),
            boxShadow: const [
              BoxShadow(color: Color(0x2128345A), blurRadius: 10, offset: Offset(0, 5)),
            ],
          ),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              RelayInitial(name: row.name, size: portrait, fontSize: first ? 22 : 18),
              Positioned(
                right: -2 - 3,
                bottom: -2 - 3,
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      RelayStyle.svg('rank_dot_$rank', width: 20, height: 20),
                      Text(
                        '$rank',
                        style: const TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Text(
          row.name,
          textAlign: TextAlign.center,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: RelayStyle.sora(12, weight: FontWeight.w700, color: const Color(0xFF202236), height: 16),
        ),
        const SizedBox(height: 8),
        Container(
          height: _barHeight[rank],
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(4, 12, 4, 0),
          decoration: BoxDecoration(
            color: color,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(12),
              topRight: Radius.circular(12),
              bottomLeft: Radius.circular(4),
              bottomRight: Radius.circular(4),
            ),
          ),
          child: Column(
            children: [
              Text(
                '${row.points}',
                style: RelayStyle.sora(
                  18,
                  weight: FontWeight.w800,
                  color: first ? const Color(0xFF202236) : Colors.white,
                  height: 22,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'POINTS',
                style: RelayStyle.sora(
                  10,
                  weight: FontWeight.w600,
                  color: first ? const Color(0xFF564800) : const Color(0xE8FFFFFF),
                  spacing: 0.4,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

}

/// Holds its child back for a few seconds, then fades it in.
///
/// The leaderboard rebuilds every second as the clock ticks; the wait lives in
/// state so it runs once, not from the top on every tick.
class _AfterAMoment extends StatefulWidget {
  const _AfterAMoment({required this.child});

  final Widget child;

  static const delay = Duration(seconds: 6);

  @override
  State<_AfterAMoment> createState() => _AfterAMomentState();
}

class _AfterAMomentState extends State<_AfterAMoment> {
  bool _shown = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer(_AfterAMoment.delay, () {
      if (mounted) setState(() => _shown = true);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Nothing is held open for it: an empty gap where the card will be pushed
    // the standings down the screen for six seconds. The space opens as the
    // card fades in.
    return AnimatedSize(
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOut,
      alignment: Alignment.topCenter,
      child: _shown
          ? AnimatedOpacity(
              opacity: 1,
              duration: const Duration(milliseconds: 260),
              curve: Curves.easeOut,
              child: widget.child,
            )
          : const SizedBox(width: double.infinity),
    );
  }
}
