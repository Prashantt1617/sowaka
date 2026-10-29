part of 'connect_feed_screen.dart';

/// Sowaka Engagements launching a game or a tournament in the feed
/// (`game_launch`): the Sowaka mark and name, a timer on top while it has a
/// start time ("O-O-O Tournament starts in 01h 12m 05s", then "Live now",
/// then "This game has ended"), the photo, GIF or video, a title and a few
/// words, and one button into the game. Nobody likes or comments on it, so
/// there is no row for either, and the server refuses both.
///
/// Every word and every colour comes from the post (`body.theme`, written by
/// `src/scripts/game-launch-post.ts`), so Sowaka can dress each launch as its
/// game; anything left out keeps the light default.
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
    this.now,
  });

  final ConnectPost post;
  final AuthSession session;

  /// For tests: where the catalog is read from.
  final GamesApiService? service;

  /// For tests: what opening the game does. The game's own screen otherwise.
  final Future<void> Function(BuildContext context, GameCatalogEntry game)? openGame;

  /// For tests: the clock the timer reads.
  final DateTime Function()? now;

  @override
  State<GameLaunchPostCard> createState() => _GameLaunchPostCardState();
}

/// Where a timed launch is: still to start, on, or over. An untimed one is
/// always on.
enum GameLaunchPhase { upcoming, live, ended }

/// The card's colours, from `body.theme`.
class _LaunchTheme {
  _LaunchTheme(Map<String, dynamic> raw, {required Color accent})
    : card = parseHexColor(raw['card']) ?? Colors.white,
      gradient = (raw['cardGradient'] is List)
          ? [for (final stop in raw['cardGradient'] as List) ?parseHexColor(stop)]
          : const [],
      border = parseHexColor(raw['border']) ?? _ConnectColors.cardBorder,
      text = parseHexColor(raw['text']) ?? _ConnectColors.ink,
      muted = parseHexColor(raw['muted']) ?? _ConnectColors.faint,
      timerBackground = parseHexColor(raw['timerBackground']) ?? const Color(0xFFE8F3FA),
      timerText = parseHexColor(raw['timerText']) ?? _ConnectColors.blue,
      timerLabel = parseHexColor(raw['timerLabel']) ?? const Color(0xFF717171),
      live = parseHexColor(raw['live']) ?? _ConnectColors.live,
      button = parseHexColor(raw['button']) ?? accent,
      buttonText = parseHexColor(raw['buttonText']) ?? _onAccent(parseHexColor(raw['button']) ?? accent);

  final Color card;
  final List<Color> gradient;
  final Color border;
  final Color text;
  final Color muted;
  final Color timerBackground;
  final Color timerText;
  final Color timerLabel;
  final Color live;
  final Color button;
  final Color buttonText;
}

class _GameLaunchPostCardState extends State<GameLaunchPostCard> {
  bool _opening = false;
  Timer? _ticker;

  Map<String, dynamic> get _body => widget.post.body;
  String get _gameKey => _bodyString(widget.post, 'gameKey');
  DateTime _now() => (widget.now ?? DateTime.now)();
  DateTime? _at(String key) => DateTime.tryParse(_bodyString(widget.post, key))?.toLocal();
  DateTime? get _startsAt => _at('startsAt');
  DateTime? get _endsAt => _at('endsAt');

  GameLaunchPhase get _phase {
    final now = _now();
    final ends = _endsAt;
    if (ends != null && !now.isBefore(ends)) return GameLaunchPhase.ended;
    final starts = _startsAt;
    if (starts != null && now.isBefore(starts)) return GameLaunchPhase.upcoming;
    return GameLaunchPhase.live;
  }

  bool get _timed => _startsAt != null || _endsAt != null;

  @override
  void initState() {
    super.initState();
    _tick();
  }

  @override
  void didUpdateWidget(covariant GameLaunchPostCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    _tick();
  }

  /// Once a second while there is a clock to move: before the start, and
  /// until the end. It stops itself once there is nothing left to count.
  void _tick() {
    final moving = _timed && _phase != GameLaunchPhase.ended;
    if (!moving) {
      _ticker?.cancel();
      _ticker = null;
      return;
    }
    _ticker ??= Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {});
      if (_phase == GameLaunchPhase.ended) {
        _ticker?.cancel();
        _ticker = null;
      }
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

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
      if (!game.hasWebPage) {
        // Built into the app: its own screen is the Games tab's to open.
        showAppToast(context, 'Open ${game.name} from the Games tab.');
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

  /// The company's game from a fresh catalog, else the one the phone kept
  /// (offline). Null when the company does not have it.
  Future<GameCatalogEntry?> _findGame() async {
    final service = widget.service ?? GamesApiService(session: widget.session);
    bool mine(GameCatalogEntry game) =>
        game.key == _gameKey && (game.hasWebPage || game.kind == GameKind.native);
    try {
      return (await service.catalog()).where(mine).firstOrNull;
    } catch (_) {
      try {
        return (await service.catalogFromCache())?.where(mine).firstOrNull;
      } catch (_) {
        return null;
      }
    }
  }

  /// The web game's own screen, as the Games tab opens it.
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
    final accent = parseHexColor(_bodyString(post, 'accentColor')) ?? _ConnectColors.blue;
    final theme = _LaunchTheme(
      _body['theme'] is Map ? Map<String, dynamic>.from(_body['theme'] as Map) : const {},
      accent: accent,
    );
    final phase = _phase;
    final locked =
        phase == GameLaunchPhase.ended ||
        (phase == GameLaunchPhase.upcoming && _body['lockUntilStart'] == true);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.gradient.length < 2 ? theme.card : null,
        gradient: theme.gradient.length < 2
            ? null
            : LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: theme.gradient,
              ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: theme.border, width: 1.129),
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
                          style: TextStyle(color: theme.text, fontSize: 15, fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${post.tag.isEmpty ? 'Games' : post.tag} · ${_timeAgo(post.publishedAt)}',
                          style: TextStyle(color: theme.muted, fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
                  if (_timed && phase == GameLaunchPhase.live) _LaunchLivePill(color: theme.live),
                ],
              ),
            ),
            if (_timed)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: _LaunchTimer(
                  key: const ValueKey('game-launch-timer'),
                  phase: phase,
                  label: _timerLabel(phase),
                  value: _timerValue(phase),
                  theme: theme,
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
                  style: TextStyle(color: theme.text, fontSize: 18, fontWeight: FontWeight.w800, height: 24 / 18),
                ),
              ),
            if (caption.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
                child: DefaultTextStyle.merge(
                  style: TextStyle(color: theme.text),
                  child: LinkifiedText(
                    caption,
                    style: TextStyle(color: theme.text, fontSize: 16, height: 22 / 16, letterSpacing: 0.4),
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
              child: Opacity(
                opacity: locked ? 0.5 : 1,
                child: Material(
                  color: theme.button,
                  borderRadius: BorderRadius.circular(14),
                  child: InkWell(
                    key: const ValueKey('game-launch-play'),
                    borderRadius: BorderRadius.circular(14),
                    onTap: _opening || locked ? null : _play,
                    child: SizedBox(
                      height: 52,
                      child: Center(
                        child: _opening
                            ? SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(strokeWidth: 2.2, color: theme.buttonText),
                              )
                            : Text(
                                _buttonLabel(phase, label, locked),
                                style: TextStyle(color: theme.buttonText, fontSize: 15, fontWeight: FontWeight.w800),
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

  String _timerLabel(GameLaunchPhase phase) {
    final custom = _bodyString(widget.post, 'timerLabel').trim();
    return switch (phase) {
      GameLaunchPhase.upcoming => custom.isEmpty ? '${_gameName()} starts in' : custom,
      GameLaunchPhase.live => _endsAt == null ? '${_gameName()} is on' : 'Ends in',
      GameLaunchPhase.ended => 'This game has ended',
    };
  }

  String _timerValue(GameLaunchPhase phase) {
    final now = _now();
    return switch (phase) {
      GameLaunchPhase.upcoming => relayCountdown(_startsAt!.difference(now).inSeconds),
      GameLaunchPhase.live => _endsAt == null ? 'Live now' : relayCountdown(_endsAt!.difference(now).inSeconds),
      GameLaunchPhase.ended => 'Thanks for playing',
    };
  }

  String _buttonLabel(GameLaunchPhase phase, String label, bool locked) {
    if (phase == GameLaunchPhase.ended) return 'Ended';
    if (locked) {
      final at = _startsAt!;
      final hour = at.hour % 12 == 0 ? 12 : at.hour % 12;
      return 'Opens at $hour:${at.minute.toString().padLeft(2, '0')} ${at.hour < 12 ? 'AM' : 'PM'}';
    }
    return label.isEmpty ? 'Play ${_gameName()}' : label;
  }
}

/// The timer on top (as the Hint Relay card's "Game start in"): the words,
/// then the clock in large tabular figures, in the post's own colours.
class _LaunchTimer extends StatelessWidget {
  const _LaunchTimer({
    super.key,
    required this.phase,
    required this.label,
    required this.value,
    required this.theme,
  });

  final GameLaunchPhase phase;
  final String label;
  final String value;
  final _LaunchTheme theme;

  @override
  Widget build(BuildContext context) {
    final live = phase == GameLaunchPhase.live && value == 'Live now';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
      decoration: BoxDecoration(
        color: theme.timerBackground,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontFamily: 'Sora',
              color: theme.timerLabel,
              fontSize: 12,
              fontWeight: FontWeight.w600,
              letterSpacing: -0.16,
            ),
          ),
          const SizedBox(height: 4),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              value,
              maxLines: 1,
              style: TextStyle(
                fontFamily: 'Sora',
                color: live ? theme.live : theme.timerText,
                fontSize: phase == GameLaunchPhase.ended ? 20 : 30,
                fontWeight: FontWeight.w600,
                letterSpacing: -0.16,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// "LIVE" with a dot, beside the Sowaka name while the game is on.
class _LaunchLivePill extends StatelessWidget {
  const _LaunchLivePill({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 7, height: 7, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 6),
        Text('LIVE', style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.4)),
      ],
    ),
  );
}

/// White on a dark button, ink on a light one (a yellow game accent).
Color _onAccent(Color accent) =>
    accent.computeLuminance() > 0.5 ? _ConnectColors.ink : Colors.white;
