import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../games/data/games_api_service.dart';
import '../../games/data/games_models.dart';
import '../data/leaderboard_models.dart';
import '../data/profile_api_service.dart';
import 'profile_style.dart';

const _monthsLong = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
];
const _monthsShort = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov',
  'Dec',
];

/// '2026-09' as ('September', 'Sep 2026'); null for anything else.
(String, String)? _monthLabels(String month) {
  final parts = month.split('-');
  final year = parts.isNotEmpty ? int.tryParse(parts.first) : null;
  final index = parts.length == 2 ? int.tryParse(parts[1]) : null;
  if (year == null || index == null || index < 1 || index > 12) return null;
  return (_monthsLong[index - 1], '${_monthsShort[index - 1]} $year');
}

/// The artwork for where points came from, as the design draws each game.
String? _artworkFor(PointSource source) => switch (source) {
  PointSource.hintRelay => 'assets/games/points_hint_relay.png',
  PointSource.captionChallenge => 'assets/games/points_caption_contest.png',
  PointSource.photoStoryChallenge => 'assets/games/points_content_contest.png',
  PointSource.mostLikely => 'assets/games/points_most_tagged.png',
  // Drawn from the game's own catalog picture instead; see [_GameArtwork].
  PointSource.gameChallenge => null,
  PointSource.other => null,
};

/// The profile's Rank tab (Figma 3106:50074, history content 3605:30658):
/// where the person stands, and a month of where their points came from —
/// games like Hint Relay and the Connect challenges.
class CreditHistoryView extends StatefulWidget {
  const CreditHistoryView({super.key, required this.service, this.userId});

  final ProfileApiService service;

  /// Whose history it is. Null on the viewer's own profile.
  final String? userId;

  @override
  State<CreditHistoryView> createState() => _CreditHistoryViewState();
}

class _CreditHistoryViewState extends State<CreditHistoryView> {
  String? _month;
  late Future<PointsHistory> _history = _load();
  bool _showAll = false;

  Future<PointsHistory> _load() async {
    final history = await widget.service.fetchPointsHistory(
      month: _month,
      userId: widget.userId,
    );
    // A game's row shows the game's own art, which lives in the games
    // catalog. Opening a profile before the Games tab means the catalog has
    // not been read this run; read it once so the art is there.
    final missingArt = history.activity.any(
      (row) => row.gameKey != null && keptCatalogGame(row.gameKey!) == null,
    );
    if (missingArt) {
      try {
        await GamesApiService(session: widget.service.session).catalog();
      } catch (_) {
        // The controller icon stands in; the history still shows.
      }
    }
    return history;
  }

  void _reload() => setState(() {
    _showAll = false;
    _history = _load();
  });

  Future<void> _pickMonth(PointsHistory history) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: ListView(
            shrinkWrap: true,
            children: [
              for (final month in history.months)
                ListTile(
                  title: Text(
                    _monthLabels(month)?.$2 ?? month,
                    style: ProfileStyle.sora(
                      14,
                      weight: month == history.month
                          ? FontWeight.w700
                          : FontWeight.w500,
                      color: month == history.month
                          ? ProfileStyle.brand
                          : ProfileStyle.ink,
                    ),
                  ),
                  onTap: () => Navigator.of(sheetContext).pop(month),
                ),
            ],
          ),
        ),
      ),
    );
    if (picked == null || picked == history.month || !mounted) return;
    _month = picked;
    _reload();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<PointsHistory>(
      future: _history,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return ProfileEmptyNote(
            'Could not load the point history.',
            onRetry: _reload,
          );
        }
        final history = snapshot.data;
        if (history == null) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 48),
            child: Center(
              child: CircularProgressIndicator(color: ProfileStyle.brand),
            ),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _StandingSummary(history: history),
            const SizedBox(height: 16),
            _ActivityCard(
              history: history,
              showAll: _showAll,
              onToggleAll: () => setState(() => _showAll = !_showAll),
              onPickMonth: () => _pickMonth(history),
            ),
          ],
        );
      },
    );
  }
}

class _StandingSummary extends StatelessWidget {
  const _StandingSummary({required this.history});

  final PointsHistory history;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final standing = '${_monthsShort[now.month - 1]} ${now.year}';
    final moved = history.movement;
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFD5ECF7)),
        boxShadow: const [
          BoxShadow(color: Color(0x08000000), blurRadius: 12, offset: Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              SizedBox(
                width: 44,
                height: 44,
                child: Stack(
                  children: [
                    ProfilePhoto(
                      name: history.name,
                      url: history.photoUrl,
                      size: 44,
                    ),
                    Positioned(
                      right: 0,
                      bottom: 0,
                      child: SvgPicture.asset(
                        'assets/icons/rank_online_dot.svg',
                        width: 12,
                        height: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      history.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: ProfileStyle.sora(
                        14,
                        weight: FontWeight.w700,
                        height: 20,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Current standing · $standing',
                      style: ProfileStyle.sora(
                        11,
                        weight: FontWeight.w600,
                        color: ProfileStyle.tertiary,
                        height: 16,
                      ),
                    ),
                  ],
                ),
              ),
              if (moved != 0) _MovementBadge(places: moved),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _Metric(
                  label: 'Current rank',
                  value: history.rank == null ? '—' : '#${history.rank}',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _Metric(label: 'Total points', value: '${history.points}'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// "↑ 3 places" since the month began, or down in red.
class _MovementBadge extends StatelessWidget {
  const _MovementBadge({required this.places});

  final int places;

  @override
  Widget build(BuildContext context) {
    final up = places > 0;
    final count = places.abs();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: up ? const Color(0xFFEAF8F0) : const Color(0xFFFDECEC),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Transform.flip(
            flipY: !up,
            child: SvgPicture.asset(
              'assets/icons/rank_arrow_up.svg',
              width: 12,
              height: 12,
              colorFilter: up
                  ? null
                  : const ColorFilter.mode(ProfileStyle.red, BlendMode.srcIn),
            ),
          ),
          const SizedBox(width: 4),
          Text(
            '$count ${count == 1 ? 'place' : 'places'}',
            style: ProfileStyle.sora(
              11,
              weight: FontWeight.w700,
              color: up ? ProfileStyle.green : ProfileStyle.red,
              height: 14,
            ),
          ),
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0xFFEAF7FD),
      borderRadius: BorderRadius.circular(16),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label.toUpperCase(),
          style: ProfileStyle.sora(
            10,
            weight: FontWeight.w600,
            color: ProfileStyle.tertiary,
            height: 14,
            spacing: 0.4,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: ProfileStyle.sora(
            26,
            weight: FontWeight.w700,
            color: ProfileStyle.brand,
            height: 30,
          ),
        ),
      ],
    ),
  );
}

class _ActivityCard extends StatelessWidget {
  const _ActivityCard({
    required this.history,
    required this.showAll,
    required this.onToggleAll,
    required this.onPickMonth,
  });

  final PointsHistory history;
  final bool showAll;
  final VoidCallback onToggleAll;
  final VoidCallback? onPickMonth;

  static const _preview = 4;

  @override
  Widget build(BuildContext context) {
    final labels = _monthLabels(history.month);
    final current = history.months.isEmpty || history.months.first == history.month;
    final earned = history.earned;
    final rows = showAll
        ? history.activity
        : history.activity.take(_preview).toList();
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: ProfileStyle.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Recent point activity',
                      style: ProfileStyle.sora(
                        16,
                        weight: FontWeight.w700,
                        height: 22,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '$earned ${earned.abs() == 1 ? 'point' : 'points'} earned '
                      '${current ? 'this month' : 'in ${labels?.$1 ?? history.month}'}',
                      style: ProfileStyle.sora(
                        11,
                        color: ProfileStyle.tertiary,
                        height: 16,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Material(
                color: ProfileStyle.surface,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                  side: const BorderSide(color: ProfileStyle.line),
                ),
                child: InkWell(
                  borderRadius: BorderRadius.circular(10),
                  onTap: onPickMonth,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 7,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          labels?.$1 ?? history.month,
                          style: ProfileStyle.sora(
                            10,
                            weight: FontWeight.w700,
                            color: ProfileStyle.secondary,
                            height: 14,
                          ),
                        ),
                        const SizedBox(width: 5),
                        SvgPicture.asset(
                          'assets/icons/rank_month_chevron.svg',
                          width: 12,
                          height: 12,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (history.activity.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                'No point activity ${current ? 'this month' : 'in ${labels?.$1 ?? history.month}'} '
                'yet. Votes on Connect challenge entries and points from '
                'games are listed here as they are earned.',
                textAlign: TextAlign.center,
                style: ProfileStyle.sora(
                  12,
                  color: ProfileStyle.tertiary,
                  height: 18,
                ),
              ),
            )
          else
            for (final (index, row) in rows.indexed) ...[
              if (index > 0) ...[
                const SizedBox(height: 16),
                const Divider(height: 1, thickness: 1, color: ProfileStyle.line),
                const SizedBox(height: 16),
              ],
              _ActivityRow(activity: row),
            ],
          if (history.activity.length > _preview) ...[
            const SizedBox(height: 16),
            Material(
              color: const Color(0xFFEAF7FD),
              borderRadius: BorderRadius.circular(10),
              child: InkWell(
                borderRadius: BorderRadius.circular(10),
                onTap: onToggleAll,
                child: SizedBox(
                  height: 38,
                  child: Center(
                    child: Text(
                      showAll ? 'Show less' : 'View all point activity',
                      style: ProfileStyle.sora(
                        11,
                        weight: FontWeight.w700,
                        color: ProfileStyle.brand,
                        height: 16,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ActivityRow extends StatelessWidget {
  const _ActivityRow({required this.activity});

  final PointActivity activity;

  @override
  Widget build(BuildContext context) {
    final artwork = _artworkFor(activity.source);
    final positive = activity.points >= 0;
    // A game played for no points (a cap applied) still shows, quietly.
    final none = activity.points == 0;
    return Row(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: SizedBox(
            width: 40,
            height: 40,
            child: activity.source == PointSource.gameChallenge
                ? _GameArtwork(gameKey: activity.gameKey)
                : artwork == null
                ? const ColoredBox(
                    color: Color(0xFFEAF7FD),
                    child: Icon(
                      Icons.stars_rounded,
                      size: 22,
                      color: ProfileStyle.brand,
                    ),
                  )
                : Image.asset(
                    artwork,
                    width: 40,
                    height: 40,
                    fit: BoxFit.cover,
                    // Drawn at 40pt; decoded near that, not at 1024.
                    cacheWidth: 160,
                  ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                activity.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: ProfileStyle.sora(12, weight: FontWeight.w700, height: 17),
              ),
              const SizedBox(height: 3),
              Text(
                activity.detail,
                // Two lines: a game paid nothing for says why, and the
                // reason must not be cut off.
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: ProfileStyle.sora(
                  10,
                  color: ProfileStyle.tertiary,
                  height: 15,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              none ? '0 pts' : '${positive ? '+' : '−'}${activity.points.abs()} pts',
              style: ProfileStyle.sora(
                12,
                weight: FontWeight.w700,
                color: none
                    ? ProfileStyle.tertiary
                    : positive
                    ? ProfileStyle.green
                    : ProfileStyle.red,
                height: 17,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              '${_monthsShort[activity.at.month - 1]} ${activity.at.day}',
              style: ProfileStyle.sora(
                10,
                weight: FontWeight.w600,
                color: ProfileStyle.tertiary,
                height: 15,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// A game challenge's picture: the game's own from the catalog this run has
/// read (a data URI, a URL or a bundled asset), else a game controller on the
/// brand's tint.
class _GameArtwork extends StatelessWidget {
  const _GameArtwork({required this.gameKey});

  final String? gameKey;

  @override
  Widget build(BuildContext context) {
    const fallback = ColoredBox(
      color: Color(0xFFEFEAFB),
      child: Icon(
        Icons.sports_esports_rounded,
        size: 22,
        color: Color(0xFF5E45D6),
      ),
    );
    final key = gameKey;
    final thumbnail = GameThumbnail.of(key == null ? null : keptCatalogGame(key)?.thumbnail);
    return switch (thumbnail) {
      MemoryThumbnail(:final bytes) => Image.memory(
        bytes,
        width: 40,
        height: 40,
        fit: BoxFit.cover,
        cacheWidth: 160,
        errorBuilder: (_, _, _) => fallback,
      ),
      NetworkThumbnail(:final url) => Image.network(
        url,
        width: 40,
        height: 40,
        fit: BoxFit.cover,
        cacheWidth: 160,
        errorBuilder: (_, _, _) => fallback,
      ),
      AssetThumbnail(:final path) => Image.asset(
        path,
        width: 40,
        height: 40,
        fit: BoxFit.cover,
        cacheWidth: 160,
        errorBuilder: (_, _, _) => fallback,
      ),
      SvgThumbnail(:final svg) => SvgPicture.string(svg, width: 40, height: 40, fit: BoxFit.cover),
      NoThumbnail() => fallback,
    };
  }
}
