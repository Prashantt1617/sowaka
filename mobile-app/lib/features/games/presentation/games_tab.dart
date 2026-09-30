part of '../../manager/presentation/manager_screen.dart';

class _GameEntry {
  const _GameEntry({
    required this.title,
    required this.image,
    required this.color,
    this.url,
    this.screen,
  });

  final String title;

  /// Bundled thumbnail asset (see pubspec `assets/games/`).
  final String image;

  /// Accent colour for the "Play now" affordance.
  final Color color;

  /// A hosted game opens at this URL.
  final String? url;

  /// A game built into the app rather than hosted: what to open.
  final Widget Function(AuthSession session)? screen;
}

/// Only what can be played today. A game that does not exist yet is not
/// shown at all, rather than as a blurred "coming soon" tile.
final List<_GameEntry> _gamesCatalog = [
  _GameEntry(
    title: 'Gratitude Garden',
    image: 'assets/games/gratitude-garden.jpg',
    color: MColors.sageDeep,
    screen: (session) => GardenScreen(session: session),
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
                  .map((entry) => _GameCard(entry: entry, session: session))
                  .toList(),
            ),
          ),
        ],
      ),
    );
  }
}

class _GameCard extends StatelessWidget {
  const _GameCard({required this.entry, required this.session});

  final _GameEntry entry;
  final AuthSession session;

  @override
  Widget build(BuildContext context) {
    return PressableCard(
      padding: const EdgeInsets.all(8),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => entry.screen != null
              ? entry.screen!(session)
              : WebGameScreen(title: entry.title, url: entry.url!),
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
  }
}
