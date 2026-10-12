import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' show ImageFilter;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/foundation.dart' show ValueListenable;
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../auth/data/auth_models.dart';
import '../../shared/app_toast.dart';
import '../../shared/org_branding.dart';
import '../data/games_api_service.dart';
import '../data/games_home_models.dart';
import '../data/games_models.dart';
import 'games_style.dart';

part 'games_art.dart';
part 'games_home_sections.dart';
part 'games_leaderboard_view.dart';

/// Opens a catalog game; on [challengeId] when it is a challenge being taken
/// up. Completes when the game is closed again.
typedef OpenCatalogGame =
    Future<void> Function(BuildContext context, GameCatalogEntry game, {String? challengeId});

/// The Games tab (Figma 3573:61034, and its Leaderboard 3623:31816).
///
/// Its own header — the brand with a GAMES badge, the viewer's points, and
/// the Games | Leaderboard switch with their rank — then, on Games: a
/// colleague's new best, what is live (contests in the feed, a Hint Relay),
/// challenges waiting, the games they have played, and the games to explore.
/// Everything comes from `GET /games/home` in one round trip.
///
/// Drawn at once from what was last fetched (in memory, else on the phone),
/// then refreshed the first time the tab is looked at and whenever it is come
/// back to after a while. A server from before the home gets the catalog.
class GamesHomeView extends StatefulWidget {
  const GamesHomeView({
    super.key,
    required this.session,
    this.visible = true,
    this.service,
    this.onOpenGame,
    this.onOpenPost,
    this.onCreateContest,
    this.canOpen,
    this.thumbnailFor,
    this.fallbackGames = const [],
    this.now = DateTime.now,
  });

  final AuthSession session;

  /// Whether this is the tab on screen. Every tab is built at once; nothing
  /// is fetched for a company that never opens this one.
  final bool visible;

  /// Supplied by tests; the view makes its own otherwise.
  final GamesApiService? service;

  /// Opens a game. The shell opens native games itself and web ones at their page.
  final OpenCatalogGame? onOpenGame;

  /// Opens a post in Connect: a live contest, the Hint Relay's.
  final ValueChanged<String>? onOpenPost;

  /// Create on a Community board card: sets the contest up and publishes it.
  /// Completes once the screen is closed.
  final Future<void> Function(ContestKind kind)? onCreateContest;

  /// Whether this app can open a catalog game: a native one it has, a web
  /// one with a page. Web games with a page only, when not given.
  final bool Function(GameCatalogEntry game)? canOpen;

  /// The picture a game's card falls back to: one bundled with the app.
  final String? Function(GameCatalogEntry game)? thumbnailFor;

  /// What a server from before the catalog gets: the games the tab always had.
  final List<GameCatalogEntry> fallbackGames;

  /// The time the clocks count down from: the phone's, unless a test gives
  /// its own.
  final DateTime Function() now;

  @override
  State<GamesHomeView> createState() => _GamesHomeViewState();
}

enum _GamesPane { games, leaderboard }

enum _ExploreTab { community, team, solo }

class _GamesHomeViewState extends State<GamesHomeView>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  static const _stale = Duration(minutes: 2);

  late final GamesApiService _service = widget.service ?? GamesApiService(session: widget.session);

  /// The pane's 1.5 s loop (Figma's motion on 3573:61034): one clock for
  /// every moving picture on it, so they keep time together as designed.
  /// It runs only while there is something on screen to move.
  late final AnimationController _motion = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1500),
  );

  /// Reduced motion: every picture holds its rest pose instead.
  bool _still = false;

  GamesHome? _home;
  String? _error;
  bool _fetching = false;
  DateTime? _fetchedAt;

  _GamesPane _pane = _GamesPane.games;
  _ExploreTab _explore = _ExploreTab.community;

  final Map<PointsPeriod, PointsLeaderboard> _boards = {};
  PointsPeriod _period = PointsPeriod.week;
  String? _boardError;

  /// The boards on their way: each period loads on its own, so switching to
  /// one while the other is still coming does not leave it never asked for.
  final Set<PointsPeriod> _boardsLoading = {};

  /// The time the "END IN: 02:14:20" clocks read, moved on each second by
  /// one timer while the tab is looked at and the app is in front. Only the
  /// clocks listen, so a tick redraws them and nothing else.
  late final ValueNotifier<DateTime> _now = ValueNotifier(widget.now());
  Timer? _clock;

  /// Whether the app is in front; the clock stops while it is not.
  bool _foreground = true;

  /// A challenge being accepted, so its button cannot be pressed twice.
  String? _accepting;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _foreground = lifecycle == null || lifecycle == AppLifecycleState.resumed;
    _home = gamesHomeFor(widget.session.user.id);
    if (_home == null) {
      final catalog = gamesCatalogFor(widget.session.user.id);
      if (catalog != null) _home = GamesHome.ofCatalog(catalog);
    }
    if (widget.visible) _show();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _still = MediaQuery.disableAnimationsOf(context);
    _syncMotion();
  }

  @override
  void didUpdateWidget(covariant GamesHomeView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.visible && !oldWidget.visible) _show();
    if (!widget.visible && oldWidget.visible) _syncClock();
    _syncMotion();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _syncClock();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _clock?.cancel();
    _clock = null;
    _now.dispose();
    _motion.dispose();
    super.dispose();
  }

  /// Whether anything that moves is on the Games pane: a live card, or the
  /// Community board with Best Photo on it.
  bool get _somethingMoves {
    final home = _home;
    if (home == null) return false;
    final live = home.liveRelay != null || home.liveContests.isNotEmpty;
    return live || _explore == _ExploreTab.community;
  }

  /// Runs the loop while the tab is looked at, on the Games pane, with
  /// something to move and motion allowed; stops it otherwise, so a hidden
  /// tab never keeps the screen drawing. (A game opened over the tab mutes
  /// it too: the route below is not ticked.)
  void _syncMotion() {
    final run = widget.visible && !_still && _pane == _GamesPane.games && _somethingMoves;
    if (run && !_motion.isAnimating) {
      _motion.repeat();
    } else if (!run && _motion.isAnimating) {
      _motion.stop();
    }
  }

  /// Ticks the clocks each second while the tab is looked at and the app is
  /// in front; one timer, stopped otherwise. Started again, the clocks are
  /// set right at once rather than at the next tick.
  void _syncClock() {
    final run = widget.visible && _foreground;
    if (run && _clock == null) {
      _now.value = widget.now();
      _clock = Timer.periodic(const Duration(seconds: 1), (_) => _now.value = widget.now());
    } else if (!run && _clock != null) {
      _clock!.cancel();
      _clock = null;
    }
  }

  Future<void> _show() async {
    _syncClock();
    if (_home == null) {
      final kept = await _service.homeFromCache();
      if (mounted && _home == null && kept != null) {
        setState(() => _home = kept);
        _syncMotion();
      }
    }
    final fetched = _fetchedAt;
    final stale = fetched == null || DateTime.now().difference(fetched) > _stale;
    if (_pane == _GamesPane.leaderboard) unawaited(_loadBoard(_period, force: stale));
    if (stale) await _refresh();
  }

  Future<void> _refresh() async {
    if (_fetching) return;
    _fetching = true;
    try {
      final home = await _service.home();
      _fetchedAt = DateTime.now();
      if (mounted) {
        setState(() {
          _home = home;
          _error = null;
        });
        _syncMotion();
      }
    } on GamesApiException catch (error) {
      // A server from before the home: the catalog, as the tab always had.
      if (error.statusCode == 404) {
        await _refreshCatalog();
        // Asked and answered: coming back to the tab need not ask again at once.
        _fetchedAt ??= DateTime.now();
      } else if (mounted && _home == null) {
        setState(() => _error = error.message);
      }
    } catch (_) {
      if (mounted && _home == null) {
        setState(() => _error = 'Games could not be loaded. Check your connection and try again.');
      }
    } finally {
      _fetching = false;
    }
  }

  Future<void> _refreshCatalog() async {
    try {
      final games = await _service.catalog();
      _fetchedAt = DateTime.now();
      if (mounted) {
        setState(() {
          _home = GamesHome.ofCatalog(games);
          _error = null;
        });
        _syncMotion();
      }
    } on GamesApiException catch (error) {
      if (!mounted || _home != null) return;
      setState(() {
        // A server from before the catalog too: the tab as it always was.
        if (error.statusCode == 404) {
          _home = GamesHome.ofCatalog(widget.fallbackGames);
        } else {
          _error = error.message;
        }
      });
      _syncMotion();
    } catch (_) {
      if (mounted && _home == null) {
        setState(() => _error = 'Games could not be loaded. Check your connection and try again.');
      }
    }
  }

  Future<void> _loadBoard(PointsPeriod period, {bool force = false}) async {
    if (!mounted) return;
    if (_boardsLoading.contains(period) || (!force && _boards.containsKey(period))) return;
    setState(() {
      _boardsLoading.add(period);
      _boardError = null;
    });
    try {
      final board = await _service.pointsLeaderboard(period);
      if (mounted) setState(() => _boards[period] = board);
    } on GamesApiException catch (error) {
      if (mounted) {
        setState(
          // A server from before the leaderboard says so in its own words.
          () => _boardError = error.statusCode == 404
              ? "The leaderboard isn't available yet."
              : error.message,
        );
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _boardError =
              'The leaderboard could not be loaded. Check your connection and try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _boardsLoading.remove(period));
    }
  }

  void _choosePane(_GamesPane pane) {
    if (pane == _pane) return;
    setState(() => _pane = pane);
    _syncMotion();
    if (pane == _GamesPane.leaderboard) unawaited(_loadBoard(_period));
  }

  void _chooseExplore(_ExploreTab tab) {
    setState(() => _explore = tab);
    _syncMotion();
  }

  void _choosePeriod(PointsPeriod period) {
    if (period == _period) return;
    setState(() => _period = period);
    unawaited(_loadBoard(period));
  }

  bool _opens(GameCatalogEntry game) => widget.canOpen?.call(game) ?? game.hasWebPage;

  GameCatalogEntry? _game(String key) =>
      _home?.games.where((game) => game.key == key && _opens(game)).firstOrNull;

  Future<void> _openGame(GameCatalogEntry game, {String? challengeId}) async {
    final open = widget.onOpenGame;
    if (open == null) return;
    await open(context, game, challengeId: challengeId);
    // Back from a round: a new best, a challenge played, points won.
    if (mounted) unawaited(_refresh());
  }

  void _openGameByKey(String key) {
    final game = _game(key);
    if (game == null) {
      showAppToast(context, 'That game is not available any more.');
      return;
    }
    unawaited(_openGame(game));
  }

  void _openPost(String? postId) {
    if (postId == null || postId.isEmpty) return;
    widget.onOpenPost?.call(postId);
  }

  Future<void> _create(ContestKind kind) async {
    final create = widget.onCreateContest;
    if (create == null) return;
    await create(kind);
    // A contest that went live is live here too.
    if (mounted) unawaited(_refresh());
  }

  /// Accept on a challenge: answered here, then the game opens on it, where
  /// the round starts. One already answered still opens, and says so there.
  Future<void> _takeUp(HomeChallenge challenge) async {
    if (_accepting != null) return;
    final game = _game(challenge.gameKey);
    if (game == null) {
      showAppToast(context, 'That game is not available any more.');
      return;
    }
    if (!challenge.incoming) {
      unawaited(_openGame(game, challengeId: challenge.id));
      return;
    }
    setState(() => _accepting = challenge.id);
    try {
      await _service.acceptChallenge(challenge.id);
    } on GamesApiException catch (error) {
      if (error.statusCode != 409) {
        if (mounted) {
          setState(() => _accepting = null);
          showAppToast(context, error.message);
          unawaited(_refresh());
        }
        return;
      }
    } catch (_) {
      if (mounted) {
        setState(() => _accepting = null);
        showAppToast(context, 'That challenge could not be accepted. Try again.');
      }
      return;
    }
    if (!mounted) return;
    setState(() => _accepting = null);
    await _openGame(game, challengeId: challenge.id);
  }

  @override
  Widget build(BuildContext context) {
    final home = _home;
    final board = _boards[_period];
    return GamesDotBackground(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _GamesHeader(
            points: home?.points ?? 0,
            // On both panes, as the design draws it. On the leaderboard it is
            // the rank of the board on screen, so the pill and the card under
            // it never disagree (the home's until that board has come).
            rank: _pane != _GamesPane.leaderboard || board == null
                ? home?.rank
                : ((board.me?.points ?? 0) > 0 ? board.me!.rank : null),
            pane: _pane,
            onPane: _choosePane,
          ),
          Expanded(
            child: _pane == _GamesPane.games
                ? RefreshIndicator(
                    color: GamesStyle.night,
                    onRefresh: _refresh,
                    child: _gamesBody(),
                  )
                : _LeaderboardPane(
                    board: board,
                    period: _period,
                    loading: _boardsLoading.contains(_period),
                    error: _boardError,
                    viewerId: widget.session.user.id,
                    onPeriod: _choosePeriod,
                    onRefresh: () async {
                      await Future.wait([_loadBoard(_period, force: true), _refresh()]);
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Widget _gamesBody() {
    final home = _home;
    if (home == null) {
      if (_error == null) {
        // Built with every other tab but not looked at: nothing that animates,
        // so a hidden tab never keeps the screen busy.
        if (!widget.visible) return const SizedBox.shrink();
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: const [
            SizedBox(height: 140),
            Center(
              child: SizedBox(
                width: 26,
                height: 26,
                child: CircularProgressIndicator(strokeWidth: 2.4, color: GamesStyle.night),
              ),
            ),
          ],
        );
      }
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(32, 110, 32, 24),
        children: [
          Text(
            _error!,
            textAlign: TextAlign.center,
            style: GamesStyle.sora(14, color: GamesStyle.secondary, height: 20),
          ),
          const SizedBox(height: 14),
          Center(
            child: TextButton(
              onPressed: _refresh,
              child: Text(
                'Try again',
                style: GamesStyle.sora(14, weight: FontWeight.w700, color: GamesStyle.night),
              ),
            ),
          ),
        ],
      );
    }

    final played = [
      for (final row in home.yourGames)
        if (_game(row.key) case final game?) (game: game, played: row),
    ];
    final challenges = home.challenges.where((c) => _game(c.gameKey) != null).toList();
    // Under reduced motion the pictures are handed no loop and hold still.
    final motion = _still ? null : _motion;
    final live = <Widget>[
      if (home.liveRelay case final relay?)
        _LiveRelayCard(
          key: ValueKey('live-relay-${relay.eventId}'),
          relay: relay,
          now: _now,
          motion: motion,
          onJoin: relay.postId == null ? null : () => _openPost(relay.postId),
        ),
      for (final contest in home.liveContests)
        _LiveContestCard(
          key: ValueKey('live-contest-${contest.id}'),
          contest: contest,
          now: _now,
          isAuthor: contest.authorUserId == widget.session.user.id,
          motion: motion,
          onOpen: () => _openPost(contest.id),
        ),
    ];

    return ListView(
      key: const PageStorageKey('games-home'),
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        if (home.banner case final banner?)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: _ScoreBannerCard(banner: banner, onTap: () => _openGameByKey(banner.gameKey)),
          ),
        if (live.isNotEmpty) ...[const _SectionHeading('LIVE GAMES'), _LiveCarousel(cards: live)],
        if (challenges.isNotEmpty)
          Padding(
            padding: EdgeInsets.fromLTRB(16, live.isEmpty ? 12 : 14, 16, 0),
            child: Column(
              spacing: 12,
              children: [
                for (final challenge in challenges)
                  _ChallengeCard(
                    key: ValueKey('challenge-${challenge.id}'),
                    challenge: challenge,
                    busy: _accepting == challenge.id,
                    onAccept: () => _takeUp(challenge),
                  ),
              ],
            ),
          ),
        if (played.isNotEmpty) ...[
          const _SectionTitle(kicker: 'BACK FOR MORE?', title: 'YOUR GAMES'),
          _YourGamesCarousel(games: played, onPlay: (game) => unawaited(_openGame(game))),
        ],
        _ExploreSection(
          tab: _explore,
          onTab: _chooseExplore,
          relay: home.liveRelay,
          now: _now,
          soloGames: home.games.where(_opens).toList(),
          thumbnailFor: widget.thumbnailFor,
          playingNow: home.playingNow,
          motion: motion,
          onCreate: widget.onCreateContest == null ? null : _create,
          onJoinRelay: (postId) => _openPost(postId),
          onPlay: (game) => unawaited(_openGame(game)),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------- header

/// The brand and the points (node 3581:29355), and the Games | Leaderboard
/// switch (3581:29362). Replaces the app's shared header on this tab.
class _GamesHeader extends StatelessWidget {
  const _GamesHeader({
    required this.points,
    required this.rank,
    required this.pane,
    required this.onPane,
  });

  final int points;
  final int? rank;
  final _GamesPane pane;
  final ValueChanged<_GamesPane> onPane;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: 58,
              child: _FitRow(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const _BrandLockup(),
                  const SizedBox(width: 8),
                  _PointsChip(points: points),
                ],
              ),
            ),
            const SizedBox(height: 8),
            _GamesSwitch(pane: pane, rank: rank, onPane: onPane),
          ],
        ),
      ),
    );
  }
}

/// The company's badge with the tilted GAMES one tucked against it. Sowaka's
/// is the design's lettered badge; a company with its own logo shows that.
class _BrandLockup extends StatelessWidget {
  const _BrandLockup();

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<OrgBranding>(
      valueListenable: OrgBranding.current,
      builder: (context, branding, _) {
        final logo = branding.homeLogoAsset;
        final Widget badge = logo == null
            ? Container(
                height: 26,
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(
                  color: const Color(0xFFB23500),
                  borderRadius: BorderRadius.circular(8),
                ),
                alignment: Alignment.center,
                child: Text(
                  branding.wordmark,
                  style: GamesStyle.sora(12, weight: FontWeight.w800, color: Colors.white),
                ),
              )
            : Container(
                height: 26,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0x1A160D2C)),
                ),
                child: Image.asset(logo, height: 18, fit: BoxFit.contain),
              );
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            badge,
            Transform.translate(
              offset: const Offset(-8, 0),
              child: SizedBox(
                width: 70.214,
                height: 28.577,
                child: Center(
                  child: Transform.rotate(
                    angle: -3 * math.pi / 180,
                    child: Container(
                      height: 25,
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      decoration: BoxDecoration(
                        color: GamesStyle.yellow,
                        borderRadius: BorderRadius.circular(7),
                        boxShadow: const [BoxShadow(color: GamesStyle.ink, offset: Offset(0, 3))],
                      ),
                      alignment: Alignment.center,
                      child: Text('GAMES', style: GamesStyle.lilita(15)),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// "⚡ 7,650  Pts": the viewer's engagement points (node 3581:29361).
class _PointsChip extends StatelessWidget {
  const _PointsChip({required this.points});

  final int points;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '${GamesStyle.count(points)} points',
      excludeSemantics: true,
      child: Container(
        key: const ValueKey('games-points'),
        constraints: const BoxConstraints(minWidth: 112),
        // 33pt, as the design draws it (its CSS does not add up to it).
        height: 33,
        padding: const EdgeInsets.symmetric(horizontal: 11.5),
        decoration: BoxDecoration(
          color: GamesStyle.ink,
          borderRadius: BorderRadius.circular(30),
          border: Border.all(color: GamesStyle.nightBorder, width: 1.5),
        ),
        alignment: Alignment.center,
        child: Text(
          '⚡ ${GamesStyle.count(points)}  Pts',
          style: GamesStyle.lilita(17, color: GamesStyle.cream, height: 22, spacing: -0.16),
        ),
      ),
    );
  }
}

/// GAMES | LEADERBOARD (nodes 3581:29362, 3687:42679), with the viewer's
/// rank on the Leaderboard tab while it is the one open; on the Games pane
/// that side is just its label, centred as the Games side is on the other.
/// Drawn at the design's width and scaled down on a narrower phone.
class _GamesSwitch extends StatelessWidget {
  const _GamesSwitch({required this.pane, required this.rank, required this.onPane});

  final _GamesPane pane;

  /// Beside LEADERBOARD on either pane; none while unranked.
  final int? rank;
  final ValueChanged<_GamesPane> onPane;

  static const _designInner = 345.0;

  @override
  Widget build(BuildContext context) {
    final games = pane == _GamesPane.games;
    final rank = this.rank;
    final Widget row = games
        ? Row(
            children: [
              _ActiveTab(
                width: 158,
                children: [
                  _gamepad(GamesStyle.ink),
                  Text('GAMES', style: GamesStyle.lilita(20)),
                ],
              ),
              const SizedBox(width: 14),
              Expanded(
                child: _TabTap(
                  key: const ValueKey('games-tab-leaderboard'),
                  label: 'Leaderboard',
                  onTap: () => onPane(_GamesPane.leaderboard),
                  child: _FitRow(
                    mainAxisAlignment: MainAxisAlignment.center,
                    spacing: 7,
                    children: [
                      Text('LEADERBOARD', style: GamesStyle.lilita(18, color: GamesStyle.lilac)),
                      if (rank != null)
                        Transform.rotate(angle: math.pi / 180, child: _RankPill(rank: rank)),
                    ],
                  ),
                ),
              ),
            ],
          )
        : Row(
            children: [
              Expanded(
                child: _TabTap(
                  key: const ValueKey('games-tab-games'),
                  label: 'Games',
                  onTap: () => onPane(_GamesPane.games),
                  child: _FitRow(
                    mainAxisAlignment: MainAxisAlignment.center,
                    spacing: 6,
                    children: [
                      Transform.rotate(angle: -math.pi / 180, child: _gamepad(GamesStyle.lilac)),
                      Text('GAMES', style: GamesStyle.lilita(18, color: GamesStyle.lilac)),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 14),
              _ActiveTab(
                padding: 12,
                children: [
                  Text('LEADERBOARD', style: GamesStyle.lilita(20)),
                  if (rank != null)
                    Transform.rotate(angle: math.pi / 180, child: _RankPill(rank: rank)),
                ],
              ),
            ],
          );
    return Container(
      height: 59,
      padding: const EdgeInsets.all(7),
      decoration: BoxDecoration(
        color: GamesStyle.ink,
        borderRadius: BorderRadius.circular(40),
        border: Border.all(color: GamesStyle.nightBorder, width: 1.5),
      ),
      child: LayoutBuilder(
        builder: (context, box) => box.maxWidth >= _designInner
            ? row
            : FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: SizedBox(width: _designInner, height: box.maxHeight, child: row),
              ),
      ),
    );
  }

  static Widget _gamepad(Color color) => SvgPicture.asset(
    '${GamesStyle.asset}/gamepad.svg',
    width: 17,
    height: 17,
    colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
  );
}

/// The selected half of the switch: a yellow pill tipped back a degree, with
/// a pink edge under it.
class _ActiveTab extends StatelessWidget {
  const _ActiveTab({required this.children, this.width, this.padding = 0});

  final List<Widget> children;
  final double? width;
  final double padding;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: true,
      button: true,
      child: Transform.rotate(
        angle: -math.pi / 180,
        child: Container(
          width: width,
          height: 43,
          padding: EdgeInsets.symmetric(horizontal: padding),
          decoration: BoxDecoration(
            color: GamesStyle.yellow,
            borderRadius: BorderRadius.circular(30),
            boxShadow: const [BoxShadow(color: GamesStyle.pink, offset: Offset(0, 4))],
          ),
          child: Row(
            mainAxisSize: width == null ? MainAxisSize.min : MainAxisSize.max,
            mainAxisAlignment: MainAxisAlignment.center,
            spacing: 7,
            children: children,
          ),
        ),
      ),
    );
  }
}

class _TabTap extends StatelessWidget {
  const _TabTap({super.key, required this.label, required this.onTap, required this.child});

  final String label;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: SizedBox(height: 43, child: child),
      ),
    );
  }
}

class _RankPill extends StatelessWidget {
  const _RankPill({required this.rank});

  final int rank;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('games-rank'),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: GamesStyle.night, borderRadius: BorderRadius.circular(20)),
      child: Text('#$rank', style: GamesStyle.lilita(14, color: GamesStyle.yellow)),
    );
  }
}

// ---------------------------------------------------------------- shared bits

/// A row at its natural size, laid out across the room it has, and scaled
/// down only when its contents would not fit (large text, a narrow phone).
class _FitRow extends StatelessWidget {
  const _FitRow({
    required this.children,
    this.mainAxisAlignment = MainAxisAlignment.start,
    this.spacing = 0,
  });

  final List<Widget> children;
  final MainAxisAlignment mainAxisAlignment;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, box) => FittedBox(
        fit: BoxFit.scaleDown,
        alignment: Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: BoxConstraints(minWidth: box.maxWidth),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: mainAxisAlignment,
            spacing: spacing,
            children: children,
          ),
        ),
      ),
    );
  }
}

/// Someone's face: their photo in a ring, else their initials on a colour.
class _Face extends StatelessWidget {
  const _Face({
    required this.name,
    required this.size,
    this.photoUrl,
    this.initials,
    this.border = 1.5,
    this.borderColor = GamesStyle.ink,
    this.background,
    this.textStyle,
  });

  final String name;
  final double size;
  final String? photoUrl;
  final String? initials;
  final double border;
  final Color borderColor;
  final Color? background;
  final TextStyle? textStyle;

  static const _palette = [
    GamesStyle.blue,
    Color(0xFFB08CFF),
    GamesStyle.green,
    GamesStyle.yellow2,
    GamesStyle.pink2,
  ];

  static Color colorFor(String seed) =>
      _palette[seed.codeUnits.fold<int>(0, (sum, unit) => sum + unit) % _palette.length];

  static String initialsOf(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((part) => part.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return parts.first.characters.first.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final letters = Center(
      child: Text(
        (initials?.isNotEmpty ?? false)
            ? initials!.characters.first.toUpperCase()
            : initialsOf(name),
        style:
            textStyle ??
            GamesStyle.figtree(size * 0.36, weight: FontWeight.w800, color: GamesStyle.ink2),
      ),
    );
    final url = photoUrl;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: background ?? colorFor(name),
        border: border > 0 ? Border.all(color: borderColor, width: border) : null,
      ),
      child: ClipOval(
        child: url == null || url.isEmpty
            ? letters
            : CachedNetworkImage(
                imageUrl: url,
                fit: BoxFit.cover,
                width: size,
                height: size,
                placeholder: (_, _) => letters,
                errorWidget: (_, _, _) => letters,
              ),
      ),
    );
  }
}

/// "02:14:20": the hours, minutes and seconds left until [at], as the feed's
/// contest card counts down (hours past a day run on: "26:00:00"). Null once
/// it has come.
String? _countdown(DateTime at, DateTime now) {
  final left = at.difference(now);
  if (left <= Duration.zero) return null;
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(left.inHours)}:${two(left.inMinutes % 60)}:${two(left.inSeconds % 60)}';
}

/// A clock's text, redrawn each time [now] ticks and nothing else with it.
/// Its digits are all one width, so it does not shuffle as they change.
class _Ticking extends StatelessWidget {
  const _Ticking({required this.now, required this.text, required this.style});

  final ValueListenable<DateTime> now;
  final String Function(DateTime now) text;
  final TextStyle style;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<DateTime>(
      valueListenable: now,
      builder: (context, now, _) => Text(
        text(now),
        maxLines: 1,
        style: style.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
      ),
    );
  }
}

String _plural(int count, String one, String many) =>
    '${GamesStyle.count(count)} ${count == 1 ? one : many}';
