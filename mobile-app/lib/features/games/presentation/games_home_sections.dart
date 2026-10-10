part of 'games_home.dart';

// The Games home's sections, top to bottom (Figma 3573:61034): a colleague's
// new best, Live Games, challenges, Your Games, and Explore Games.

const _titleInk = Color(0xFF141329);

class _SectionHeading extends StatelessWidget {
  const _SectionHeading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Text(text, style: GamesStyle.lilita(23, color: GamesStyle.night, height: 29)),
    );
  }
}

/// "BACK FOR MORE?" over "YOUR GAMES" (node 3605:29770).
class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.kicker, required this.title});

  final String kicker;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(17, 12, 17, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            kicker,
            style: GamesStyle.sora(
              10,
              weight: FontWeight.w600,
              color: GamesStyle.violetText,
              height: 21,
            ),
          ),
          Text(
            title,
            style: GamesStyle.lilita(18, color: GamesStyle.night, height: 27, spacing: 0.35),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- banner

/// "Yami just beat your Odd One Out score" (node 3581:29375).
class _ScoreBannerCard extends StatelessWidget {
  const _ScoreBannerCard({required this.banner, required this.onTap});

  final ScoreBanner banner;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      child: GestureDetector(
        key: const ValueKey('games-banner'),
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          height: 50,
          padding: const EdgeInsets.symmetric(horizontal: 9),
          decoration: BoxDecoration(
            color: GamesStyle.pageDot,
            borderRadius: BorderRadius.circular(17),
            border: Border.all(color: GamesStyle.ink2, width: 0.4),
          ),
          child: Row(
            spacing: 12,
            children: [
              _Face(name: banner.name, photoUrl: banner.photoUrl, size: 34),
              Expanded(
                child: Text(
                  '${banner.firstName} just beat your ${banner.gameName} score',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: GamesStyle.sora(13, color: const Color(0xFF222222)),
                ),
              ),
              SvgPicture.asset('${GamesStyle.asset}/eye.svg', width: 20, height: 20),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- live games

/// The live cards side by side, the next one peeking in (node 3690:43046).
class _LiveCarousel extends StatelessWidget {
  const _LiveCarousel({required this.cards});

  final List<Widget> cards;

  static const _cardHeight = 292.0;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 301,
      child: LayoutBuilder(
        builder: (context, box) {
          final room = box.maxWidth - 32;
          final width = cards.length == 1 ? room : math.min(341.0, room - 21);
          return ListView.separated(
            key: const ValueKey('games-live'),
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            clipBehavior: Clip.none,
            itemCount: cards.length,
            separatorBuilder: (_, _) => const SizedBox(width: 12),
            itemBuilder: (context, index) => Align(
              alignment: Alignment.topCenter,
              child: SizedBox(width: width, height: _cardHeight, child: cards[index]),
            ),
          );
        },
      ),
    );
  }
}

/// One live card's frame (node 3690:43048): a coloured card on a hard
/// shadow, a dark strip over it saying who and how long, then the game.
class _LiveCardFrame extends StatelessWidget {
  const _LiveCardFrame({
    required this.color,
    required this.who,
    required this.whoFace,
    required this.clock,
    required this.illustration,
    required this.title,
    required this.quote,
    required this.cta,
    required this.onTap,
    required this.footer,
  });

  final Color color;
  final String who;
  final Widget whoFace;
  final String clock;
  final Widget illustration;
  final String title;
  final String quote;
  final String cta;
  final VoidCallback? onTap;
  final Widget footer;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: GamesStyle.ink, width: 2),
        boxShadow: const [BoxShadow(color: GamesStyle.ink, offset: Offset(0, 7))],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              color: GamesStyle.ink,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              child: Row(
                children: [
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      child: Row(
                        spacing: 6,
                        children: [
                          whoFace,
                          Flexible(
                            child: Text(
                              who,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: GamesStyle.sora(
                                10,
                                weight: FontWeight.w600,
                                color: Colors.white,
                                height: 15,
                                spacing: 0.3,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    child: Text(
                      clock,
                      style: GamesStyle.sora(
                        10,
                        weight: FontWeight.w800,
                        color: Colors.white,
                        height: 15,
                        spacing: 0.3,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: SizedBox(
                height: 96.5,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 5,
                  children: [
                    illustration,
                    Expanded(
                      child: _LiveTitle(title: title, quote: quote),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: GameCtaButton(label: cta, onTap: onTap),
            ),
            Center(
              child: Padding(padding: const EdgeInsets.only(bottom: 3), child: footer),
            ),
          ],
        ),
      ),
    );
  }
}

/// The game's name in the design's 32pt face, made smaller (and then given
/// a second line) only when it would not fit, and its line under it.
class _LiveTitle extends StatelessWidget {
  const _LiveTitle({required this.title, required this.quote});

  final String title;
  final String quote;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, box) {
        final upper = title.toUpperCase();
        double size = 32;
        var lines = 1;
        bool fits(double s, int maxLines) {
          final painter = TextPainter(
            text: TextSpan(
              text: upper,
              style: GamesStyle.lilita(s, height: s * 1.05),
            ),
            maxLines: maxLines,
            textDirection: TextDirection.ltr,
          )..layout(maxWidth: box.maxWidth);
          return !painter.didExceedMaxLines;
        }

        if (!fits(32, 1)) {
          size = fits(26, 1) ? 26 : (fits(22, 1) ? 22 : 22);
          if (!fits(size, 1)) lines = 2;
        }
        final lineHeight = size == 32 ? 49.0 : size * 1.1;
        return ClipRect(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                upper,
                maxLines: lines,
                overflow: TextOverflow.ellipsis,
                style: GamesStyle.lilita(size, color: _titleInk, height: lineHeight),
              ),
              Text(
                quote,
                maxLines: lines == 2 ? 1 : 2,
                overflow: TextOverflow.ellipsis,
                style: GamesStyle.sora(14, weight: FontWeight.w800, color: _titleInk, height: 20),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Up to two faces, then "+N", as the waiting players show (node 3690:43153).
class _FacePile extends StatelessWidget {
  const _FacePile({required this.faces, required this.total});

  final List<ContestFace> faces;
  final int total;

  @override
  Widget build(BuildContext context) {
    final shown = faces.take(total > 3 ? 2 : 3).toList();
    final extra = total - shown.length;
    final items = <Widget>[
      for (final face in shown)
        _Face(name: face.name, initials: face.initials, photoUrl: face.photoUrl, size: 24),
      if (extra > 0)
        Container(
          width: 24,
          height: 24,
          decoration: BoxDecoration(
            color: GamesStyle.ink2,
            shape: BoxShape.circle,
            border: Border.all(color: GamesStyle.ink, width: 1.5),
          ),
          alignment: Alignment.center,
          child: Text('+$extra', style: GamesStyle.sora(10, color: Colors.white)),
        ),
    ];
    if (items.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      width: 24 + (items.length - 1) * 16,
      height: 24,
      child: Stack(
        children: [
          for (var i = 0; i < items.length; i++) Positioned(left: i * 16.0, child: items[i]),
        ],
      ),
    );
  }
}

/// A Connect contest still taking entries, on the lobby card (node 3690:43088).
class _LiveContestCard extends StatelessWidget {
  const _LiveContestCard({
    super.key,
    required this.contest,
    required this.now,
    required this.isAuthor,
    required this.onOpen,
  });

  final LiveContest contest;
  final DateTime now;
  final bool isAuthor;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final closes = contest.closesAt;
    final (art, tint, fallbackQuote) = switch (contest.kind) {
      ContestKind.caption => (_moodyCatArt(), GamesStyle.purpleArt, 'Write the funniest caption.'),
      ContestKind.photo => (_photoArt(), GamesStyle.pageDot, 'Post your best shot.'),
      ContestKind.mostLikely => (_mostLikelyArt(), GamesStyle.purpleArt, 'Who fits the tag?'),
    };
    final first = contest.authorName.trim().split(RegExp(r'\s+')).first;
    final entries = contest.entries;
    return Semantics(
      container: true,
      label: '${contest.title}, contest',
      child: _LiveCardFrame(
        color: GamesStyle.purple,
        who: isAuthor
            ? 'You created this contest'
            : first.isEmpty
            ? 'A new contest'
            : '$first created this contest',
        whoFace: _Face(name: contest.authorName, photoUrl: contest.authorPhotoUrl, size: 26),
        clock: closes == null ? 'OPEN' : 'Ends in ${_timeLeft(closes, now)}',
        illustration: _IllustrationTile(color: tint, padding: 4, child: art),
        title: contest.title.isEmpty ? 'Contest' : contest.title,
        quote: '“${contest.prompt.isEmpty ? fallbackQuote : contest.prompt}”',
        cta: contest.entered ? 'See entries' : 'Your turn',
        onTap: onOpen,
        footer: Row(
          mainAxisSize: MainAxisSize.min,
          spacing: 8,
          children: [
            _FacePile(faces: contest.entrants, total: entries),
            Text(
              entries == 0 ? 'Be the first to enter' : _plural(entries, 'entry', 'entries'),
              style: GamesStyle.sora(12, color: GamesStyle.ink),
            ),
          ],
        ),
      ),
    );
  }
}

/// The company's Hint Relay, live or coming up, on the yellow lobby card
/// (node 3690:43048).
class _LiveRelayCard extends StatelessWidget {
  const _LiveRelayCard({super.key, required this.relay, required this.now, required this.onJoin});

  final LiveRelay relay;
  final DateTime now;
  final VoidCallback? onJoin;

  @override
  Widget build(BuildContext context) {
    final starts = relay.startsAt;
    final clock = switch (relay.phase) {
      RelayPhaseNow.live => 'LIVE NOW',
      _ when starts != null && starts.isAfter(now) => 'Starts in ${_timeLeft(starts, now)}',
      RelayPhaseNow.lobby => 'LOBBY OPEN',
      RelayPhaseNow.upcoming => 'SOON',
    };
    final team = relay.teamName;
    final who = team != null
        ? 'You are on $team'
        : relay.teams > 0
        ? '${_plural(relay.teams, 'team', 'teams')} are in'
        : 'Your company’s team game';
    final players = relay.players;
    final footerText = switch (relay.phase) {
      RelayPhaseNow.live => '${_plural(players, 'player', 'players')} playing',
      RelayPhaseNow.lobby => '${_plural(players, 'player', 'players')} waiting',
      RelayPhaseNow.upcoming => '${_plural(players, 'player', 'players')} signed up',
    };
    return Semantics(
      container: true,
      label: '${relay.title}, team game',
      child: _LiveCardFrame(
        color: GamesStyle.yellow,
        who: who,
        whoFace: Container(
          width: 26,
          height: 26,
          decoration: BoxDecoration(
            color: GamesStyle.blue,
            shape: BoxShape.circle,
            border: Border.all(color: GamesStyle.ink, width: 1.5),
          ),
          alignment: Alignment.center,
          child: SvgPicture.asset('${GamesStyle.asset}/tag_team.svg', width: 14, height: 14),
        ),
        clock: clock,
        illustration: _IllustrationTile(
          color: GamesStyle.blueArt,
          padding: 4,
          // Just the tiles and their dashes, so they read at tile size.
          child: ClipRect(
            child: Align(
              widthFactor: 141 / 172.61,
              heightFactor: 63 / 108.786,
              child: SizedBox(width: 172.61, height: 108.786, child: _tilesArt('HINT')),
            ),
          ),
        ),
        title: relay.title,
        quote: team != null ? '“Your team needs you!”' : '“Many clues. One answer.”',
        cta: relay.phase == RelayPhaseNow.upcoming ? 'View game' : 'Join lobby',
        onTap: onJoin,
        footer: players == 0
            ? const SizedBox(height: 24)
            : Row(
                mainAxisSize: MainAxisSize.min,
                spacing: 6,
                children: [
                  SvgPicture.asset('${GamesStyle.asset}/players.svg', width: 16, height: 16),
                  SizedBox(
                    height: 24,
                    child: Center(
                      child: Text(footerText, style: GamesStyle.sora(12, color: GamesStyle.ink)),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

// ---------------------------------------------------------------- challenges

/// "Raghav challenged you in Odd One Out" (node 3581:29409).
class _ChallengeCard extends StatelessWidget {
  const _ChallengeCard({
    super.key,
    required this.challenge,
    required this.busy,
    required this.onAccept,
  });

  final HomeChallenge challenge;
  final bool busy;
  final VoidCallback onAccept;

  @override
  Widget build(BuildContext context) {
    final beat = challenge.beat;
    final terms = beat == null
        ? 'Same boards for both of you. Winner takes both scores.'
        : 'Beat ${GamesStyle.count(beat)}. Winner takes both scores.';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: GamesStyle.night,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: GamesStyle.nightBorder, width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 10,
        children: [
          Text(
            challenge.incoming ? 'CHALLENGE RECEIVED' : 'YOUR TURN',
            style: GamesStyle.sora(
              10,
              weight: FontWeight.w800,
              color: const Color(0xFFFF86B5),
              height: 13,
            ),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: 12,
            children: [
              _Face(name: challenge.fromName, photoUrl: challenge.fromPhotoUrl, size: 34),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 4,
                  children: [
                    Text(
                      challenge.incoming
                          ? '${challenge.fromFirstName} challenged you in ${challenge.gameName}'
                          : 'You vs ${challenge.fromFirstName} in ${challenge.gameName}',
                      style: GamesStyle.sora(13, color: GamesStyle.cream, height: 16),
                    ),
                    Text(terms, style: GamesStyle.sora(11.5, color: GamesStyle.lilac, height: 15)),
                  ],
                ),
              ),
              GameCtaButton(
                key: ValueKey('accept-${challenge.id}'),
                label: challenge.incoming ? 'Accept' : 'Play',
                onTap: busy ? null : onAccept,
                width: 115,
                height: 60,
                fontSize: 16,
                labelCenter: 0.467,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- your games

class _YourGamesCarousel extends StatelessWidget {
  const _YourGamesCarousel({required this.games, required this.onPlay});

  final List<({GameCatalogEntry game, PlayedGame played})> games;
  final ValueChanged<GameCatalogEntry> onPlay;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 301,
      child: ListView.separated(
        key: const ValueKey('games-yours'),
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        clipBehavior: Clip.none,
        itemCount: games.length,
        separatorBuilder: (_, _) => const SizedBox(width: 12),
        itemBuilder: (context, index) {
          final row = games[index];
          return Align(
            alignment: Alignment.topCenter,
            child: _GameCardLarge(
              key: ValueKey('your-game-${row.game.key}'),
              game: row.game,
              played: row.played,
              onPlay: () => onPlay(row.game),
            ),
          );
        },
      ),
    );
  }
}

/// A game the viewer has played, with their best and rank (node 3605:30389).
class _GameCardLarge extends StatelessWidget {
  const _GameCardLarge({super.key, required this.game, required this.played, required this.onPlay});

  final GameCatalogEntry game;
  final PlayedGame played;
  final VoidCallback onPlay;

  @override
  Widget build(BuildContext context) {
    final rank = played.rank;
    final players = played.players;
    return Container(
      width: 232,
      height: 282.24,
      decoration: BoxDecoration(
        color: GamesStyle.night,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: GamesStyle.ink2, width: 2.2),
        boxShadow: const [BoxShadow(color: GamesStyle.ink2, offset: Offset(0, 5))],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(15.8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              height: 134,
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: GamesStyle.ink2, width: 2.2)),
              ),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  _GamePicture(game: game, background: GamesStyle.green),
                  if (rank != null)
                    Positioned(
                      left: 163.06,
                      top: 70.95,
                      child: Transform.rotate(
                        angle: 4 * math.pi / 180,
                        child: _YourRankBadge(rank: rank),
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 10, 10, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    height: 23.836,
                    child: Align(
                      alignment: Alignment.topLeft,
                      child: game.isWeb
                          ? const _TypeTag(
                              label: 'SOLO CHALLENGE',
                              icon: 'tag_solo.svg',
                              color: GamesStyle.mint,
                            )
                          : const _TypeTag(
                              label: 'TEAM GAME',
                              icon: 'tag_team.svg',
                              color: GamesStyle.blue,
                            ),
                    ),
                  ),
                  SizedBox(
                    height: 28,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        game.name.toUpperCase(),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: GamesStyle.lilita(19, color: GamesStyle.page, height: 22),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      [
                        if (players > 0) _plural(players, 'player', 'players'),
                        'Best ${GamesStyle.count(played.best)}',
                      ].join(' · '),
                      maxLines: 1,
                      style: GamesStyle.figtree(9.5, color: const Color(0xFFEBEBEB), height: 12.35),
                    ),
                  ),
                  GameCtaButton(
                    label: 'Play',
                    onTap: onPlay,
                    height: 57,
                    fontSize: 16,
                    labelCenter: 0.44,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _YourRankBadge extends StatelessWidget {
  const _YourRankBadge({required this.rank, this.dark = false});

  final int rank;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final ink = dark ? GamesStyle.yellow2 : GamesStyle.ink2;
    return Container(
      width: 55,
      height: 52,
      decoration: BoxDecoration(
        color: dark ? GamesStyle.ink2 : GamesStyle.page,
        borderRadius: BorderRadius.circular(12),
        border: dark ? null : Border.all(color: GamesStyle.ink2, width: 1.1),
        boxShadow: const [BoxShadow(color: GamesStyle.ink2, offset: Offset(0, 2))],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text('#$rank', style: GamesStyle.lilita(22, color: ink, height: 19.8)),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 3),
            child: Text(
              'YOUR RANK',
              style: GamesStyle.figtree(7, weight: FontWeight.w800, color: ink, height: 10.5),
            ),
          ),
        ],
      ),
    );
  }
}

class _TypeTag extends StatelessWidget {
  const _TypeTag({required this.label, required this.icon, required this.color});

  final String label;
  final String icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(5),
        border: Border.all(color: GamesStyle.ink2, width: 1.1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        spacing: 4,
        children: [
          SvgPicture.asset('${GamesStyle.asset}/$icon', width: 12, height: 12),
          Text(label, style: GamesStyle.figtree(8.5, weight: FontWeight.w800, height: 8.5)),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- explore

/// Explore Games (node 3605:31672): Community board, Team games and Solo
/// games, each a grid of small cards, and who is playing now under them.
class _ExploreSection extends StatelessWidget {
  const _ExploreSection({
    required this.tab,
    required this.onTab,
    required this.relay,
    required this.now,
    required this.soloGames,
    required this.thumbnailFor,
    required this.playingNow,
    required this.onCreate,
    required this.onJoinRelay,
    required this.onPlay,
  });

  final _ExploreTab tab;
  final ValueChanged<_ExploreTab> onTab;
  final LiveRelay? relay;
  final DateTime now;
  final List<GameCatalogEntry> soloGames;
  final String? Function(GameCatalogEntry game)? thumbnailFor;
  final PlayingNow playingNow;
  final Future<void> Function(ContestKind kind)? onCreate;
  final ValueChanged<String> onJoinRelay;
  final ValueChanged<GameCatalogEntry> onPlay;

  @override
  Widget build(BuildContext context) {
    final cards = switch (tab) {
      _ExploreTab.community => _community(),
      _ExploreTab.team => _team(),
      _ExploreTab.solo => _solo(),
    };
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: 2,
        children: [
          SizedBox(
            height: 45,
            child: Align(
              alignment: Alignment.bottomLeft,
              child: Padding(
                padding: const EdgeInsets.only(left: 1, bottom: 8),
                child: Text(
                  'EXPLORE GAMES',
                  style: GamesStyle.lilita(18, color: GamesStyle.night, height: 27, spacing: 0.35),
                ),
              ),
            ),
          ),
          SizedBox(
            height: 37,
            child: Padding(
              padding: const EdgeInsets.only(top: 1),
              child: _FitRow(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _ExploreChip(
                    key: const ValueKey('explore-community'),
                    label: 'COMMUNITY BOARD',
                    icon: 'tab_board.svg',
                    iconSize: 12,
                    color: GamesStyle.purple,
                    selected: tab == _ExploreTab.community,
                    onTap: () => onTab(_ExploreTab.community),
                  ),
                  _ExploreChip(
                    key: const ValueKey('explore-team'),
                    label: 'TEAM GAMES',
                    icon: 'tab_team.svg',
                    color: GamesStyle.blue,
                    selected: tab == _ExploreTab.team,
                    onTap: () => onTab(_ExploreTab.team),
                  ),
                  _ExploreChip(
                    key: const ValueKey('explore-solo'),
                    label: 'SOLO GAMES',
                    icon: 'tab_solo.svg',
                    color: GamesStyle.mint,
                    selected: tab == _ExploreTab.solo,
                    onTap: () => onTab(_ExploreTab.solo),
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: _CardGrid(cards: cards),
          ),
          if (playingNow.count > 0)
            _PlayingNowPill(playingNow: playingNow)
          else
            const SizedBox(height: 20),
        ],
      ),
    );
  }

  List<Widget> _community() {
    Widget create(ContestKind kind) => GameCtaButton(
      key: ValueKey('create-${kind.name}'),
      label: 'Create',
      onTap: onCreate == null ? null : () => onCreate!(kind),
      small: true,
      width: 97,
      height: 48,
      fontSize: 12,
    );
    return [
      _GameCardSmall(
        key: const ValueKey('explore-caption'),
        color: GamesStyle.purple,
        artColor: GamesStyle.purpleArt,
        art: Align(alignment: Alignment.topCenter, child: _moodyCatArt()),
        title: 'Caption this',
        description: 'Let your teammates add their funniest, wittiest comments.',
        bottom: create(ContestKind.caption),
      ),
      _GameCardSmall(
        key: const ValueKey('explore-photo'),
        color: GamesStyle.purple,
        artColor: GamesStyle.purpleArt,
        art: Align(
          alignment: Alignment.topCenter,
          child: SizedBox(width: 126.04, height: 107.82, child: Center(child: _photoArt())),
        ),
        title: 'Best photo',
        description: 'Get your teammates to capture a moment or a mood.',
        bottom: create(ContestKind.photo),
      ),
      _GameCardSmall(
        key: const ValueKey('explore-most-likely'),
        color: GamesStyle.purple,
        artColor: GamesStyle.purpleArt,
        art: Align(
          alignment: Alignment.topLeft,
          child: SizedBox(width: 172.593, height: 108.786, child: _mostLikelyArt()),
        ),
        title: 'Most likely',
        description: 'Nominate the teammate who fits the tag',
        bottom: create(ContestKind.mostLikely),
      ),
    ];
  }

  List<Widget> _team() {
    final event = relay;
    final art = Align(
      alignment: Alignment.topLeft,
      child: SizedBox(
        width: 172.61,
        height: 108.786,
        child: _tilesArt(event == null ? 'TEAM' : 'HINT'),
      ),
    );
    if (event == null) {
      return [
        _GameCardSmall(
          key: const ValueKey('explore-team-empty'),
          color: GamesStyle.blue,
          artColor: GamesStyle.blueArt,
          art: art,
          title: 'No team game yet',
          description: 'When your company runs Hint Relay, your team plays it from here.',
          bottom: const SizedBox(height: 4),
        ),
      ];
    }
    final starts = event.startsAt;
    final status = switch (event.phase) {
      RelayPhaseNow.live => 'LIVE NOW',
      RelayPhaseNow.lobby => 'LOBBY OPEN',
      RelayPhaseNow.upcoming =>
        starts != null && starts.isAfter(now)
            ? 'STARTS IN ${_timeLeft(starts, now).toUpperCase()}'
            : 'COMING UP',
    };
    final postId = event.postId;
    return [
      _GameCardSmall(
        key: ValueKey('explore-relay-${event.eventId}'),
        color: GamesStyle.blue,
        artColor: GamesStyle.blueArt,
        art: Stack(
          children: [
            art,
            Positioned(left: 7.18, top: 5.98, child: _LiveIndicator(label: status)),
          ],
        ),
        title: event.title,
        description: 'Crack the clues with your team before the clock runs out.',
        bottom: SizedBox(
          height: 45,
          child: Row(
            children: [
              SvgPicture.asset('${GamesStyle.asset}/players.svg', width: 14, height: 14),
              const SizedBox(width: 2),
              Expanded(
                child: Text(
                  _plural(event.players, 'player', 'players'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GamesStyle.figtree(10, weight: FontWeight.w500, color: GamesStyle.ink),
                ),
              ),
              GameCtaButton(
                key: const ValueKey('join-relay'),
                label: event.phase == RelayPhaseNow.upcoming ? 'View' : 'Join',
                onTap: postId == null ? null : () => onJoinRelay(postId),
                small: true,
                width: 55,
                height: 45,
                fontSize: 12,
                labelCenter: 0.444,
              ),
            ],
          ),
        ),
      ),
    ];
  }

  List<Widget> _solo() {
    if (soloGames.isEmpty) {
      return [
        _GameCardSmall(
          key: const ValueKey('explore-solo-empty'),
          color: GamesStyle.mint,
          artColor: GamesStyle.mintArt,
          art: Align(
            alignment: Alignment.topLeft,
            child: SizedBox(width: 172.593, height: 108.786, child: _oddOneOutArt()),
          ),
          title: 'No games yet',
          description: 'New games your company switches on show up here.',
          bottom: const SizedBox(height: 4),
        ),
      ];
    }
    return [
      for (final game in soloGames)
        _GameCardSmall(
          key: ValueKey('explore-game-${game.key}'),
          color: GamesStyle.mint,
          artColor: GamesStyle.mintArt,
          art: game.key == 'odd-one-out'
              ? Align(
                  alignment: Alignment.topLeft,
                  child: SizedBox(width: 172.593, height: 108.786, child: _oddOneOutArt()),
                )
              : _GamePicture(
                  game: game,
                  thumbnail: thumbnailFor?.call(game),
                  background: GamesStyle.mintArt,
                ),
          title: game.name,
          description: game.tagline.isNotEmpty ? game.tagline : game.description,
          bottom: GameCtaButton(
            key: ValueKey('play-${game.key}'),
            label: 'Play',
            onTap: () => onPlay(game),
            small: true,
            width: 97,
            height: 48,
            fontSize: 12,
          ),
        ),
    ];
  }
}

/// One of the three explore tabs: the chosen one tipped 3° on a hard shadow.
class _ExploreChip extends StatelessWidget {
  const _ExploreChip({
    super.key,
    required this.label,
    required this.icon,
    required this.color,
    required this.selected,
    required this.onTap,
    this.iconSize = 14,
  });

  final String label;
  final String icon;
  final Color color;
  final bool selected;
  final VoidCallback onTap;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    final chip = Container(
      height: 36,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(7),
        boxShadow: selected
            ? const [BoxShadow(color: GamesStyle.ink2, offset: Offset(0, 3))]
            : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        spacing: 5,
        children: [
          SizedBox(
            width: 14,
            height: 14,
            child: Center(
              child: SvgPicture.asset(
                '${GamesStyle.asset}/$icon',
                width: iconSize,
                height: iconSize,
              ),
            ),
          ),
          Text(label, style: GamesStyle.figtree(10, weight: FontWeight.w700, height: 15)),
        ],
      ),
    );
    return Semantics(
      button: true,
      selected: selected,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: selected ? Transform.rotate(angle: -3 * math.pi / 180, child: chip) : chip,
      ),
    );
  }
}

/// Two columns, 10pt apart, rows 12pt apart (node 3605:31585).
class _CardGrid extends StatelessWidget {
  const _CardGrid({required this.cards});

  final List<Widget> cards;

  @override
  Widget build(BuildContext context) {
    return Column(
      spacing: 12,
      children: [
        for (var i = 0; i < cards.length; i += 2)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: cards[i]),
              const SizedBox(width: 10),
              Expanded(child: i + 1 < cards.length ? cards[i + 1] : const SizedBox.shrink()),
            ],
          ),
      ],
    );
  }
}

/// A small explore card (GameCardSmall, node 3605:31586): its picture over a
/// line, then the name, a line about it, and what to do.
class _GameCardSmall extends StatelessWidget {
  const _GameCardSmall({
    super.key,
    required this.color,
    required this.artColor,
    required this.art,
    required this.title,
    required this.description,
    required this.bottom,
  });

  final Color color;
  final Color artColor;
  final Widget art;
  final String title;
  final String description;
  final Widget bottom;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: GamesStyle.ink2, width: 2.2),
        boxShadow: const [BoxShadow(color: GamesStyle.ink2, offset: Offset(0, 5))],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12.8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              height: 111,
              decoration: BoxDecoration(
                color: artColor,
                border: const Border(bottom: BorderSide(color: GamesStyle.ink2, width: 2.2)),
              ),
              child: ClipRect(
                child: OverflowBox(
                  alignment: Alignment.topCenter,
                  maxWidth: double.infinity,
                  maxHeight: double.infinity,
                  child: SizedBox(width: 173, height: 111, child: art),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(9),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title.toUpperCase(),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: GamesStyle.lilita(16, color: GamesStyle.ink2, height: 16),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 5),
                    child: SizedBox(
                      height: 23.75,
                      child: Text(
                        description,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: GamesStyle.figtree(9.5, color: GamesStyle.muted, height: 11.875),
                      ),
                    ),
                  ),
                  bottom,
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// "LOBBY OPEN" on a card's picture (node 3605:31236).
class _LiveIndicator extends StatelessWidget {
  const _LiveIndicator({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 18,
      padding: const EdgeInsets.symmetric(horizontal: 9),
      decoration: BoxDecoration(color: GamesStyle.ink2, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        spacing: 5,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              color: const Color(0xFFFF3B5C).withValues(alpha: 0.62),
              borderRadius: BorderRadius.circular(3),
            ),
          ),
          Text(
            label,
            style: GamesStyle.figtree(
              7,
              weight: FontWeight.w800,
              color: GamesStyle.cream2,
              height: 10.5,
              spacing: 0.25,
            ),
          ),
        ],
      ),
    );
  }
}

/// "12 people from your team are playing right now" (node 3605:31657).
class _PlayingNowPill extends StatelessWidget {
  const _PlayingNowPill({required this.playingNow});

  final PlayingNow playingNow;

  static const _colors = [GamesStyle.blue, Color(0xFFC6F03C), Color(0xFFFF8A3D)];

  @override
  Widget build(BuildContext context) {
    final count = playingNow.count;
    final faces = playingNow.initials.take(3).toList();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 20),
      child: Container(
        key: const ValueKey('games-playing-now'),
        height: 42,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: GamesStyle.rowBorder, width: 1.1),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          spacing: 8,
          children: [
            if (faces.isNotEmpty)
              SizedBox(
                width: 20 + (faces.length - 1) * 13,
                height: 20,
                child: Stack(
                  children: [
                    for (var i = 0; i < faces.length; i++)
                      Positioned(
                        left: i * 13.0,
                        child: Container(
                          width: 20,
                          height: 20,
                          decoration: BoxDecoration(
                            color: _colors[i % _colors.length],
                            shape: BoxShape.circle,
                            border: Border.all(color: GamesStyle.ink2, width: 1.1),
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            faces[i].characters.first,
                            style: GamesStyle.figtree(7, weight: FontWeight.w800, height: 8.75),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            Flexible(
              child: Text(
                count == 1
                    ? '1 person from your team is playing right now'
                    : '${GamesStyle.count(count)} people from your team are playing right now',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: GamesStyle.figtree(9.5, color: GamesStyle.secondary, height: 11.875),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
