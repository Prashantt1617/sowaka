part of '../../manager/presentation/manager_screen.dart';

class _GameEntry {
  const _GameEntry({
    required this.title,
    required this.subtitle,
    required this.image,
    required this.color,
    this.url,
  });

  final String title;
  final String subtitle;

  /// Bundled thumbnail asset (see pubspec `assets/games/`).
  final String image;

  /// Accent colour for the "Play now" affordance.
  final Color color;

  /// A live, playable game exposes a hosted URL. A `null` url marks the
  /// tile as "coming soon" — it renders blurred and is not tappable.
  final String? url;

  bool get comingSoon => url == null;
}

const List<_GameEntry> _gamesCatalog = [
  _GameEntry(
    title: 'Scribble',
    subtitle: 'Draw it, guess it',
    image: 'assets/games/scribble.jpg',
    color: MColors.terra,
    url: 'https://game-2-w8ur.onrender.com/',
  ),
  _GameEntry(
    title: 'Find your Mate',
    subtitle: 'Match your teammates',
    image: 'assets/games/find-your-mate.jpg',
    color: MColors.plum,
    url: 'https://game1-h13e.onrender.com/',
  ),
  _GameEntry(
    title: 'Know your Nation',
    subtitle: 'Independence trivia',
    image: 'assets/games/know-your-nation.jpg',
    color: MColors.teal,
    url: 'https://independence-trivia-next.vercel.app/play',
  ),
  _GameEntry(
    title: 'Step Challenge',
    subtitle: 'Coming soon',
    image: 'assets/games/step-challenge.png',
    color: MColors.gold,
  ),
  _GameEntry(
    title: 'Fitness Challenge',
    subtitle: 'Coming soon',
    image: 'assets/games/fitness-challenge.png',
    color: MColors.sage,
  ),
  _GameEntry(
    title: 'Bingo Live',
    subtitle: 'Coming soon',
    image: 'assets/games/bingo-live.png',
    color: MColors.live,
  ),
];

class _GamesTab extends StatelessWidget {
  const _GamesTab({
    super.key,
    required this.session,
    required this.profileAction,
  });

  final AuthSession session;
  final Widget profileAction;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: MColors.bg,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 52, 16, 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Games',
                        style: TextStyle(
                          color: MColors.ink,
                          fontSize: 30,
                          fontWeight: FontWeight.w800,
                          height: 1.08,
                          letterSpacing: -0.6,
                        ),
                      ),
                      SizedBox(height: 5),
                      Text(
                        'Play, compete and unwind with your team',
                        style: TextStyle(color: MColors.inkSoft, fontSize: 14.5),
                      ),
                    ],
                  ),
                ),
                profileAction,
              ],
            ),
          ),
          Expanded(
            child: GridView(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
              // Responsive: ~2 columns on a phone, more on wide tablets /
              // landscape, so tiles never balloon and overflow the viewport.
              gridDelegate:
                  const SliverGridDelegateWithMaxCrossAxisExtent(
                    maxCrossAxisExtent: 260,
                    mainAxisSpacing: 14,
                    crossAxisSpacing: 14,
                    childAspectRatio: 0.82,
                  ),
              children: _gamesCatalog
                  .map((entry) => _GameCard(entry: entry))
                  .toList(),
            ),
          ),
        ],
      ),
    );
  }
}

class _GameCard extends StatelessWidget {
  const _GameCard({required this.entry});

  final _GameEntry entry;

  @override
  Widget build(BuildContext context) {
    final card = PressableCard(
      padding: const EdgeInsets.all(8),
      onTap: entry.comingSoon
          ? null
          : () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) =>
                    WebGameScreen(title: entry.title, url: entry.url!),
              ),
            ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.asset(
                entry.image,
                fit: BoxFit.cover,
                width: double.infinity,
                errorBuilder: (_, _, _) => Container(color: MColors.line),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 9, 4, 2),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  entry.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: MColors.ink,
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.2,
                  ),
                ),
                const SizedBox(height: 3),
                if (entry.comingSoon)
                  Text(
                    entry.subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: MColors.inkSoft,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                    ),
                  )
                else
                  Row(
                    children: [
                      Text(
                        'Play now',
                        style: TextStyle(
                          color: entry.color,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(width: 3),
                      Icon(
                        Icons.arrow_forward_rounded,
                        size: 14,
                        color: entry.color,
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ],
      ),
    );

    if (!entry.comingSoon) return card;

    return Stack(
      children: [
        ImageFiltered(
          imageFilter: ui.ImageFilter.blur(sigmaX: 2.6, sigmaY: 2.6),
          child: card,
        ),
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.35),
              borderRadius: BorderRadius.circular(16),
            ),
          ),
        ),
        const Positioned.fill(child: Center(child: _ComingSoonBadge())),
      ],
    );
  }
}

class _ComingSoonBadge extends StatelessWidget {
  const _ComingSoonBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: MColors.ink,
        borderRadius: BorderRadius.circular(99),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.lock_rounded, size: 13, color: Colors.white),
          SizedBox(width: 6),
          Text(
            'Coming soon',
            style: TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}
