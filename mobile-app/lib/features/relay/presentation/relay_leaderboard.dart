import 'package:flutter/material.dart';

import '../data/relay_models.dart';
import 'relay_style.dart';

/// Between rounds, and at the end (Figma 2606:36359).
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

  bool get _finished => state.phase == RelayPhase.finished;

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
          if (_finished)
            Align(
              alignment: Alignment.centerLeft,
              child: GestureDetector(
                onTap: onClose,
                child: RelayStyle.svg('cross', width: 24, height: 24),
              ),
            )
          else
            Center(child: _timerBadge()),
          const SizedBox(height: 24),
          Text(
            _finished ? 'GAME OVER!' : 'ROUND COMPLETE!',
            textAlign: TextAlign.center,
            style: RelayStyle.sora(26, weight: FontWeight.w800, color: Colors.white, height: 39),
          ),
          const SizedBox(height: 4),
          Text(
            _finished ? '${state.rounds} ROUNDS PLAYED' : 'ROUND ${state.round} OF ${state.rounds}',
            textAlign: TextAlign.center,
            style: RelayStyle.sora(13, color: RelayStyle.onBlue, height: 19.5),
          ),
          const SizedBox(height: 18),
          if (top.isNotEmpty) _podium(top),
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

  /// Third on the left, first raised in the middle, second on the right — the
  /// order a podium stands in, not the order a list reads.
  Widget _podium(List<RelayStanding> top) {
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
                      left: 0.0006 * box.maxWidth,
                      top: -0.323 * box.maxHeight,
                      width: box.maxWidth,
                      height: 1.4799 * box.maxHeight,
                      child: Opacity(
                        opacity: 0.18,
                        child: Image.asset(
                          '${RelayStyle.asset}/ranking_surface.png',
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
                    _finished ? 'Final standings' : 'Standings',
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

  Widget _yourTeam() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0x1F0571A6), width: 1.129),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'YOU',
                  style: RelayStyle.sora(10, weight: FontWeight.w600, color: RelayStyle.tertiary, height: 18),
                ),
                const SizedBox(height: 2),
                Text(
                  state.yourRank > 0 ? '#${state.yourRank} ${state.teamName}' : state.teamName,
                  style: RelayStyle.sora(20, weight: FontWeight.w700, color: RelayStyle.brand, height: 19.5),
                ),
                const SizedBox(height: 2 + 10),
                RelayStyle.svg('divider_line', width: 196, height: 1),
                const SizedBox(height: 2 + 10),
                Text(
                  '+${state.pointsThisRound} points this round',
                  style: RelayStyle.sora(16, weight: FontWeight.w600, color: RelayStyle.tertiary, height: 18),
                ),
              ],
            ),
          ),
          Text(
            '${state.points}',
            style: RelayStyle.sora(16, weight: FontWeight.w700, color: RelayStyle.brand, height: 19.5),
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
            '${row.points}',
            style: RelayStyle.sora(
              15,
              weight: FontWeight.w700,
              color: mine ? RelayStyle.brand : RelayStyle.secondary,
              height: 22.5,
            ),
          ),
        ],
      ),
    );
  }
}
