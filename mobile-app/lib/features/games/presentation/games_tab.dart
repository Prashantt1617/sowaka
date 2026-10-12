part of '../../manager/presentation/manager_screen.dart';

/// The games built into the app, by their catalog key. The catalog decides
/// which a company sees; a native entry this app does not know (a game from
/// a newer release) is simply not shown.
final Map<String, Widget Function(AuthSession session)> _nativeGames = {
  'gratitude-garden': (session) => GardenScreen(session: session),
};

/// Pictures bundled with the app for its own games, for an entry without one.
const Map<String, String> _bundledGameThumbnails = {
  'gratitude-garden': 'assets/games/gratitude-garden.jpg',
};

/// What the tab shows when the server has no catalog to give (one from
/// before the catalog) and none is kept on the phone: the one game the tab
/// always had.
const List<GameCatalogEntry> _builtInGames = [
  GameCatalogEntry(
    key: 'gratitude-garden',
    name: 'Gratitude Garden',
    kind: GameKind.native,
    accentColor: MColors.sageDeep,
  ),
];

bool _canOpen(GameCatalogEntry game) =>
    game.kind == GameKind.native ? _nativeGames.containsKey(game.key) : game.hasWebPage;

/// Opens a game: a native one at its own screen, a web one at its page,
/// on [challengeId] when a challenge notification opened it. Completes when
/// the game is closed.
Future<void> openCatalogGame(
  BuildContext context,
  AuthSession session,
  GameCatalogEntry game, {
  GamesApiService? service,
  String? challengeId,
}) {
  final native = _nativeGames[game.key];
  final Widget screen = game.kind == GameKind.native && native != null
      ? native(session)
      : WebGameScreen.catalog(
          game: game,
          session: session,
          service: service,
          challengeId: challengeId,
        );
  return Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
}

/// The company's game [key], if this app can open it: from a fresh catalog,
/// else the one last kept (offline). Null when the company does not have it.
Future<GameCatalogEntry?> findCatalogGame(GamesApiService service, String key) async {
  bool opens(GameCatalogEntry game) => game.key == key && _canOpen(game);
  try {
    return (await service.catalog()).where(opens).firstOrNull;
  } catch (_) {
    return (await service.catalogFromCache())?.where(opens).firstOrNull;
  }
}

/// Opens [gameKey] straight on [challengeId], for a tapped challenge
/// notification. False when the game is not one the person's company has.
Future<bool> openGameChallenge(
  BuildContext context,
  AuthSession session, {
  required String gameKey,
  required String challengeId,
  GamesApiService? service,
}) async {
  final api = service ?? GamesApiService(session: session);
  final game = await findCatalogGame(api, gameKey);
  if (game == null || !context.mounted) return false;
  openCatalogGame(
    context,
    session,
    game,
    service: api,
    challengeId: challengeId.isEmpty ? null : challengeId,
  );
  return true;
}

/// The Games tab: its own home (Figma 3573:61034) and leaderboard, under its
/// own header — the shared app header is not drawn on this tab.
///
/// Games open here, as anywhere else. A live contest opens on its Entries
/// page over this tab, and Back comes back here; the Hint Relay opens its
/// post in Connect. Contests are not set up here: they are made from
/// Connect's Posts only.
///
/// The tab is the server's web page (`WebGamesHome`) when it is on for the
/// company, and this native home otherwise. The tab is built once and kept:
/// a fresh pick from the bar ([resets]) resets the page in place, or builds
/// the native home again.
class _GamesTab extends StatelessWidget {
  const _GamesTab({
    super.key,
    required this.session,
    required this.bloc,
    required this.connectComposerController,
    this.visible = true,
    this.resets = 0,
  });

  final AuthSession session;
  final ManagerBloc bloc;
  final ConnectComposerController connectComposerController;
  final bool visible;

  /// How many times the tab has been picked fresh from the bar.
  final int resets;

  void _openPost(String postId) {
    bloc.add(const ChangeManagerTab(ManagerTab.connect));
    WidgetsBinding.instance.addPostFrameCallback(
      // Where it sits in the feed: opening it never moves it to the top.
      (_) => connectComposerController.openPost(postId, inPlace: true),
    );
  }

  // On the feed's own bloc where the feed has the contest, so a vote cast
  // here is on the feed's card too.
  Future<void> _openContest(BuildContext context, String postId) => openContestEntries(
    context,
    session,
    postId,
    feed: connectComposerController,
    onOpenPerson: (userId) => openPersonProfile(userId),
  );

  /// A game the page asked for by key: the company's, if this app can open
  /// it; on [challengeId] when one is being taken up.
  Future<void> _openGameByKey(BuildContext context, String key, String? challengeId) async {
    final service = GamesApiService(session: session);
    // The catalog the page's last home() carried, else asked for now.
    final kept = (await service.catalogFromCache())
        ?.where((game) => game.key == key && _canOpen(game))
        .firstOrNull;
    final game = kept ?? await findCatalogGame(service, key);
    if (!context.mounted) return;
    if (game == null) {
      showAppToast(context, 'That game is not available any more.');
      return;
    }
    await openCatalogGame(context, session, game, service: service, challengeId: challengeId);
  }

  @override
  Widget build(BuildContext context) {
    return WebGamesHome(
      session: session,
      visible: visible,
      resets: resets,
      bundledThumbnails: _bundledGameThumbnails,
      nativeGames: _nativeGames.keys.toList(),
      onOpenGame: _openGameByKey,
      onOpenContest: _openContest,
      onOpenPost: _openPost,
      onOpenProfile: (userId) => openPersonProfile(userId),
      nativeHome: (context) => GamesHomeView(
        session: session,
        visible: visible,
        canOpen: _canOpen,
        thumbnailFor: (game) => _bundledGameThumbnails[game.key],
        fallbackGames: _builtInGames,
        onOpenGame: (context, game, {challengeId}) =>
            openCatalogGame(context, session, game, challengeId: challengeId),
        onOpenPost: _openPost,
        onOpenContest: (postId) => _openContest(context, postId),
      ),
    );
  }
}
