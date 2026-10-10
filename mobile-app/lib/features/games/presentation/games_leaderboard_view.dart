part of 'games_home.dart';

// The Leaderboard half of the Games tab (Figma 3623:31816): individuals by
// engagement points, this week's or all time — a podium for the top three,
// everyone else in a list, and the viewer's place pinned to the bottom.

class _LeaderboardPane extends StatelessWidget {
  const _LeaderboardPane({
    required this.board,
    required this.period,
    required this.loading,
    required this.error,
    required this.viewerId,
    required this.onPeriod,
    required this.onRefresh,
  });

  final PointsLeaderboard? board;
  final PointsPeriod period;
  final bool loading;
  final String? error;
  final String viewerId;
  final ValueChanged<PointsPeriod> onPeriod;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final board = this.board;
    final me = board?.me;
    final podium = board == null
        ? const <PointsEntry>[]
        : board.entries.where((entry) => entry.points > 0).take(3).toList();
    final rest = board == null
        ? const <PointsEntry>[]
        : board.entries.where((entry) => !podium.contains(entry)).toList();
    return Stack(
      children: [
        RefreshIndicator(
          color: GamesStyle.night,
          onRefresh: onRefresh,
          child: ListView(
            key: const PageStorageKey('games-leaderboard'),
            physics: const AlwaysScrollableScrollPhysics(),
            padding: EdgeInsets.only(bottom: me == null ? 24 : 104),
            children: [
              const _LeaderboardHero(),
              Center(
                child: _PeriodToggle(period: period, onPeriod: onPeriod),
              ),
              const SizedBox(height: 14),
              if (board == null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(32, 60, 32, 24),
                  child: error != null && !loading
                      ? Column(
                          children: [
                            Text(
                              error!,
                              textAlign: TextAlign.center,
                              style: GamesStyle.sora(14, color: GamesStyle.secondary, height: 20),
                            ),
                            TextButton(
                              onPressed: onRefresh,
                              child: Text(
                                'Try again',
                                style: GamesStyle.sora(
                                  14,
                                  weight: FontWeight.w700,
                                  color: GamesStyle.night,
                                ),
                              ),
                            ),
                          ],
                        )
                      : const Center(
                          child: SizedBox(
                            width: 26,
                            height: 26,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.4,
                              color: GamesStyle.night,
                            ),
                          ),
                        ),
                )
              else ...[
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: podium.isEmpty ? _EmptyPodium(period: period) : _PointsPodium(top: podium),
                ),
                const SizedBox(height: 14),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    spacing: 8,
                    children: [
                      for (final entry in rest)
                        _LeaderboardRow(
                          key: ValueKey('board-row-${entry.userId}'),
                          entry: entry,
                          isMe: entry.userId == viewerId,
                        ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
        if (me != null)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: _StickyRank(standing: me, period: period),
          ),
      ],
    );
  }
}

/// "GOOD COMPANY / GREAT COMPETITION" (node 3687:42580): two 65pt lines
/// pulled 27pt together, the first on a blue drop.
class _LeaderboardHero extends StatelessWidget {
  const _LeaderboardHero();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 12 + 38 + 65,
      child: Stack(
        children: [
          Positioned(
            left: 0,
            right: 0,
            top: 12,
            height: 65,
            child: Center(
              child: Text(
                'GOOD COMPANY',
                style: GamesStyle.lilita(
                  24,
                  color: GamesStyle.night,
                  shadows: const [Shadow(color: Color(0xFF5884F4), offset: Offset(0, 4))],
                ),
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            top: 50,
            height: 65,
            child: Center(
              child: Text(
                'GREAT COMPETITION',
                style: GamesStyle.lilita(24, color: GamesStyle.night),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// This week | All time (node 3687:42585).
class _PeriodToggle extends StatelessWidget {
  const _PeriodToggle({required this.period, required this.onPeriod});

  final PointsPeriod period;
  final ValueChanged<PointsPeriod> onPeriod;

  @override
  Widget build(BuildContext context) {
    Widget segment(PointsPeriod value, String label) {
      final on = value == period;
      return Semantics(
        button: true,
        selected: on,
        child: GestureDetector(
          key: ValueKey('period-${value.name}'),
          behavior: HitTestBehavior.opaque,
          onTap: () => onPeriod(value),
          child: Container(
            padding: EdgeInsets.symmetric(horizontal: 26, vertical: on ? 10 : 12),
            decoration: on
                ? BoxDecoration(color: GamesStyle.page, borderRadius: BorderRadius.circular(10))
                : null,
            child: Text(
              label,
              style: GamesStyle.sora(
                13,
                weight: FontWeight.w700,
                color: on ? GamesStyle.night : GamesStyle.cream,
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      width: 263,
      height: 50,
      padding: const EdgeInsets.symmetric(horizontal: 9),
      decoration: BoxDecoration(color: GamesStyle.night, borderRadius: BorderRadius.circular(17)),
      child: _FitRow(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [segment(PointsPeriod.week, 'This week'), segment(PointsPeriod.all, 'All time')],
      ),
    );
  }
}

/// The top three on a podium (node 3628:33503): third, first raised in the
/// middle, second — with their photos.
class _PointsPodium extends StatelessWidget {
  const _PointsPodium({required this.top});

  final List<PointsEntry> top;

  static const _placeColor = {1: Color(0xFFFFCC00), 2: Color(0xFF34C759), 3: Color(0xFF0088FF)};
  static const _barHeight = {1: 116.0, 2: 92.0, 3: 72.0};

  @override
  Widget build(BuildContext context) {
    PointsEntry? at(int place) => top.length >= place ? top[place - 1] : null;
    return Container(
      key: const ValueKey('games-podium'),
      decoration: BoxDecoration(
        color: const Color(0xFFC3EBFE),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFEBEBEB)),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(17),
        child: Stack(
          children: [
            // The rays behind it, at the design's 18%.
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
                          '${GamesStyle.asset}/ranking_surface.jpg',
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
                    'TOP 3',
                    style: GamesStyle.sora(
                      11,
                      weight: FontWeight.w700,
                      color: GamesStyle.secondary,
                    ),
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

  Widget _place(PointsEntry? entry, int place) {
    if (entry == null) return const SizedBox.shrink();
    final color = _placeColor[place]!;
    final first = place == 1;
    final frame = first ? 68.0 : 54.0;
    final portrait = first ? 62.0 : 48.0;
    return Column(
      key: ValueKey('podium-$place'),
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 32,
          height: 32,
          child: first
              ? Container(
                  decoration: const BoxDecoration(color: Color(0xFFFFF3B8), shape: BoxShape.circle),
                  alignment: Alignment.center,
                  child: Image.asset('${GamesStyle.asset}/trophy.png', width: 18, height: 18),
                )
              : Center(
                  child: Text(
                    place == 2 ? '🥈' : '🥉',
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
          // The design's rank dot sits under the portrait, which covers it.
          child: _Face(
            name: entry.name,
            photoUrl: entry.photoUrl,
            size: portrait,
            border: 0,
            textStyle: GamesStyle.lilita(first ? 26 : 20, color: GamesStyle.ink2),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          entry.name,
          textAlign: TextAlign.center,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: GamesStyle.sora(
            12,
            weight: FontWeight.w700,
            color: const Color(0xFF202236),
            height: 16,
          ),
        ),
        const SizedBox(height: 8),
        Container(
          height: _barHeight[place],
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
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  GamesStyle.count(entry.points),
                  style: GamesStyle.sora(
                    18,
                    weight: FontWeight.w800,
                    color: first ? const Color(0xFF202236) : Colors.white,
                    height: 22,
                  ),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'POINTS',
                style: GamesStyle.sora(
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

/// Nobody has points on this board yet.
class _EmptyPodium extends StatelessWidget {
  const _EmptyPodium({required this.period});

  final PointsPeriod period;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('games-podium-empty'),
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 22),
      decoration: BoxDecoration(
        color: const Color(0xFFC3EBFE),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFEBEBEB)),
      ),
      child: Column(
        spacing: 6,
        children: [
          Text(
            'TOP 3',
            style: GamesStyle.sora(11, weight: FontWeight.w700, color: GamesStyle.secondary),
          ),
          Text(
            period == PointsPeriod.week ? 'NOBODY ON THE PODIUM YET' : 'THE PODIUM IS EMPTY',
            style: GamesStyle.lilita(18, color: GamesStyle.night),
          ),
          Text(
            'Win a challenge or enter a contest to be the first one up.',
            textAlign: TextAlign.center,
            style: GamesStyle.sora(12, color: GamesStyle.secondary, height: 17),
          ),
        ],
      ),
    );
  }
}

/// One person's row (node 3628:33559). The viewer's is cream, tipped a
/// little, with a pink edge and YOU beside their name (node 3628:33542).
class _LeaderboardRow extends StatelessWidget {
  const _LeaderboardRow({super.key, required this.entry, required this.isMe});

  final PointsEntry entry;
  final bool isMe;

  @override
  Widget build(BuildContext context) {
    final ink = isMe ? GamesStyle.ink2 : GamesStyle.cream2;
    final moved = entry.moved ?? 0;
    final row = Container(
      height: isMe ? 61 : 57,
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: isMe ? GamesStyle.cream2 : GamesStyle.night,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: isMe ? GamesStyle.ink2 : GamesStyle.rowBorder, width: 1.1),
        boxShadow: isMe ? const [BoxShadow(color: GamesStyle.pink2, offset: Offset(0, 3))] : null,
      ),
      child: Row(
        children: [
          SizedBox(
            width: 24,
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                '${entry.rank}',
                textAlign: TextAlign.center,
                style: GamesStyle.lilita(17, color: ink),
              ),
            ),
          ),
          const SizedBox(width: 5),
          SizedBox(
            width: 33,
            child: Align(
              alignment: Alignment.centerLeft,
              child: _Face(
                name: entry.name,
                photoUrl: entry.photoUrl,
                size: 29,
                border: 1.1,
                borderColor: GamesStyle.ink2,
                background: _Face.colorFor(entry.userId),
                textStyle: GamesStyle.figtree(10, weight: FontWeight.w800, height: 15),
              ),
            ),
          ),
          const SizedBox(width: 5),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        entry.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: GamesStyle.figtree(
                          11.5,
                          weight: FontWeight.w700,
                          color: ink,
                          height: 17.25,
                        ),
                      ),
                    ),
                    if (isMe) ...[
                      const SizedBox(width: 4),
                      Container(
                        height: 14,
                        padding: const EdgeInsets.symmetric(horizontal: 2.85),
                        decoration: BoxDecoration(
                          color: GamesStyle.yellow2,
                          borderRadius: BorderRadius.circular(5),
                          border: Border.all(color: GamesStyle.ink2, width: 1.1),
                        ),
                        alignment: Alignment.center,
                        child: Text(
                          'YOU',
                          style: GamesStyle.figtree(8, weight: FontWeight.w700, height: 12),
                        ),
                      ),
                    ],
                  ],
                ),
                if (entry.department.isNotEmpty)
                  Text(
                    entry.department,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: GamesStyle.figtree(
                      8.5,
                      color: isMe ? GamesStyle.muted : GamesStyle.lilacSoft,
                      height: 12.75,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 5),
          ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 34),
            child: Text(
              GamesStyle.count(entry.points),
              style: GamesStyle.figtree(13, weight: FontWeight.w700, color: ink, height: 19.5),
            ),
          ),
          const SizedBox(width: 5),
          SizedBox(
            width: 22,
            child: moved == 0
                ? null
                : FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text(
                      moved > 0 ? '↑$moved' : '↓${-moved}',
                      style: GamesStyle.figtree(
                        13,
                        color: moved > 0 ? GamesStyle.green : GamesStyle.pink2,
                        height: 19.5,
                      ),
                    ),
                  ),
          ),
        ],
      ),
    );
    return isMe ? Transform.rotate(angle: -0.4 * math.pi / 180, child: row) : row;
  }
}

/// The viewer's place, pinned over the list (node 3628:33677): their rank,
/// their points, the week's, and who they would pass next.
class _StickyRank extends StatelessWidget {
  const _StickyRank({required this.standing, required this.period});

  final PointsStanding standing;
  final PointsPeriod period;

  @override
  Widget build(BuildContext context) {
    final gap = standing.gap;
    final name = standing.nextUpName;
    final points = standing.points;
    final line = gap != null && name != null
        ? '${GamesStyle.count(gap)} XP to pass $name for #${standing.nextUpRank ?? standing.rank - 1}'
        : points > 0
        ? (period == PointsPeriod.week
              ? 'You are top of the board this week'
              : 'You are top of the board')
        : 'Win a challenge or enter a contest to get on the board';
    final side = period == PointsPeriod.all
        ? (standing.weekPoints > 0
              ? '↑ ${GamesStyle.count(standing.weekPoints)} this week'
              : 'No points yet this week')
        : '${GamesStyle.count(standing.allTimePoints)} XP all time';
    final progress = gap == null
        ? (points > 0 ? 1.0 : 0.0)
        : (points / (points + gap)).clamp(0.04, 1.0);
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 2, sigmaY: 2),
        child: Container(
          key: const ValueKey('games-sticky-rank'),
          color: const Color(0x14FFFFFF),
          padding: const EdgeInsets.fromLTRB(8, 10, 8, 10),
          child: Container(
            height: 69,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            decoration: BoxDecoration(
              color: GamesStyle.yellow2,
              borderRadius: BorderRadius.circular(17),
              border: Border.all(color: GamesStyle.ink2, width: 2.2),
              boxShadow: const [BoxShadow(color: GamesStyle.ink2, offset: Offset(0, 5))],
            ),
            child: Row(
              children: [
                SizedBox(
                  width: 58,
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Transform.rotate(
                      angle: 4 * math.pi / 180,
                      child: _YourRankBadge(rank: standing.rank, dark: true),
                    ),
                  ),
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _FitRow(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            '${GamesStyle.count(points)} XP',
                            style: GamesStyle.lilita(20, color: GamesStyle.ink2),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            side,
                            style: GamesStyle.figtree(9, weight: FontWeight.w800, height: 13.5),
                          ),
                        ],
                      ),
                      Container(
                        height: 8,
                        decoration: BoxDecoration(
                          color: GamesStyle.cream2,
                          borderRadius: BorderRadius.circular(99),
                          border: Border.all(color: GamesStyle.ink2, width: 1.1),
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(99),
                          child: FractionallySizedBox(
                            alignment: Alignment.centerLeft,
                            widthFactor: progress.toDouble(),
                            child: const ColoredBox(color: GamesStyle.pink2),
                          ),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.only(top: 3),
                        child: Text(
                          line,
                          textAlign: TextAlign.center,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: GamesStyle.figtree(8, weight: FontWeight.w800, height: 12),
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
    );
  }
}
