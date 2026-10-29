part of 'connect_feed_screen.dart';

/// Sowaka Engagements launching a game in the feed (`game_launch`): the
/// Sowaka mark and name, the photo, GIF or video, a title and a few words,
/// and one button into the game. Nobody likes or comments on it, so there is
/// no row for either, and the server refuses both.
///
/// The button opens the game once: a second tap while it opens, or a tap on
/// the way back, does nothing — the guard the live game and Secret Squad
/// cards keep for the same reason.
class GameLaunchPostCard extends StatefulWidget {
  const GameLaunchPostCard({
    super.key,
    required this.post,
    required this.session,
    this.service,
    this.openGame,
  });

  final ConnectPost post;
  final AuthSession session;

  /// For tests: where the catalog is read from.
  final GamesApiService? service;

  /// For tests: what opening the game does. The game's own screen otherwise.
  final Future<void> Function(BuildContext context, GameCatalogEntry game)? openGame;

  @override
  State<GameLaunchPostCard> createState() => _GameLaunchPostCardState();
}

class _GameLaunchPostCardState extends State<GameLaunchPostCard> {
  bool _opening = false;

  String get _gameKey => _bodyString(widget.post, 'gameKey');

  Future<void> _play() async {
    if (_opening) return;
    setState(() => _opening = true);
    try {
      final game = await _findGame();
      if (!mounted) return;
      if (game == null) {
        showAppToast(context, '${_gameName()} is not on for your company yet.');
        return;
      }
      await (widget.openGame ?? _openInApp)(context, game);
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  String _gameName() {
    final name = _bodyString(widget.post, 'gameName');
    return name.isEmpty ? 'This game' : name;
  }

  /// The game from the catalog the phone keeps, else asked for now. Null
  /// when the company does not have it.
  Future<GameCatalogEntry?> _findGame() async {
    final service = widget.service ?? GamesApiService(session: widget.session);
    bool opens(GameCatalogEntry game) =>
        game.key == _gameKey && (game.hasWebPage || game.kind == 'native');
    try {
      final kept = (await service.catalogFromCache())?.where(opens).firstOrNull;
      if (kept != null) return kept;
    } catch (_) {}
    try {
      return (await service.catalog()).where(opens).firstOrNull;
    } catch (_) {
      return null;
    }
  }

  Future<void> _openInApp(BuildContext context, GameCatalogEntry game) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => WebGameScreen.catalog(
          game: game,
          session: widget.session,
          service: widget.service,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    final title = _bodyString(post, 'title').trim();
    final caption = _bodyString(post, 'text').trim();
    final label = _bodyString(post, 'actionLabel').trim();
    final accent = _launchAccent(_bodyString(post, 'accentColor')) ?? _ConnectColors.blue;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _ConnectColors.cardBorder, width: 1.129),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Who it is from: Sowaka, with nobody to tap through to.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
              child: Row(
                children: [
                  ClipOval(
                    child: Image.asset(
                      'assets/images/sowaka_logo.png',
                      width: 40,
                      height: 40,
                      fit: BoxFit.cover,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          post.author.name.isEmpty ? 'Sowaka Engagements' : post.author.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: _ConnectColors.ink,
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${post.tag.isEmpty ? 'Games' : post.tag} · ${_timeAgo(post.publishedAt)}',
                          style: const TextStyle(
                            color: _ConnectColors.faint,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            if (_hasPostMedia(post))
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: _PostMediaFrame(child: _MediaPreview(post: post)),
              ),
            if (title.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                child: Text(
                  title,
                  style: const TextStyle(
                    color: _ConnectColors.ink,
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    height: 24 / 18,
                  ),
                ),
              ),
            if (caption.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
                child: _PostCaption(text: caption),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
              child: Material(
                color: accent,
                borderRadius: BorderRadius.circular(14),
                child: InkWell(
                  key: const ValueKey('game-launch-play'),
                  borderRadius: BorderRadius.circular(14),
                  onTap: _opening ? null : _play,
                  child: SizedBox(
                    height: 52,
                    child: Center(
                      child: _opening
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                            )
                          : Text(
                              label.isEmpty ? 'Play ${_gameName()}' : label,
                              style: TextStyle(
                                color: _onAccent(accent),
                                fontSize: 15,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// "#F5B82E" as a colour, or null for anything else.
Color? _launchAccent(String value) {
  final hex = value.replaceFirst('#', '');
  if (hex.length != 6) return null;
  final parsed = int.tryParse(hex, radix: 16);
  return parsed == null ? null : Color(0xFF000000 | parsed);
}

/// White on a dark button, ink on a light one (a yellow game accent).
Color _onAccent(Color accent) =>
    accent.computeLuminance() > 0.5 ? _ConnectColors.ink : Colors.white;
