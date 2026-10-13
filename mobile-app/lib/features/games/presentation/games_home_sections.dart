part of 'games_home.dart';

// The Games home's sections, top to bottom (Figma 3573:61034): a colleague's
// new best, challenges, Live Games, Your Games, and Explore Games.

const _titleInk = Color(0xFF141329);

/// "LIVE GAMES" (node 3581:29381), 8pt above and below it.
class _SectionHeading extends StatelessWidget {
  const _SectionHeading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Text(
        text,
        style: GamesStyle.lilita(23, color: GamesStyle.night, height: 29),
      ),
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
            style: GamesStyle.lilita(
              18,
              color: GamesStyle.night,
              height: 27,
              spacing: 0.35,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- banner

/// The live cards side by side, the next one peeking in (node 3755:28494):
/// 362pt cards 8pt apart, 214pt tall over 9pt for their shadow, so on the
/// design's phone the next shows 8pt at the edge.
class _LiveCarousel extends StatefulWidget {
  const _LiveCarousel({required this.cards, this.autoScroll = false});

  final List<Widget> cards;

  /// Moves on to the next card by itself every few seconds, and back to the
  /// first after the last. Only while the tab is looked at, on the Games
  /// pane, with motion allowed; a touch holds it until the hand has been off
  /// it a while.
  final bool autoScroll;

  static const _cardHeight = 214.0;
  static const _gap = 8.0;
  static const _every = Duration(seconds: 3);
  static const _restAfterTouch = Duration(seconds: 5);

  @override
  State<_LiveCarousel> createState() => _LiveCarouselState();
}

class _LiveCarouselState extends State<_LiveCarousel> {
  final _scroll = ScrollController();
  Timer? _tick;
  Timer? _rest;
  bool _touched = false;

  /// One card and its gap, as last laid out.
  double _step = 0;

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(_LiveCarousel oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
  }

  @override
  void dispose() {
    _tick?.cancel();
    _rest?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  void _sync() {
    final run = widget.autoScroll && widget.cards.length > 1 && !_touched;
    if (run && _tick == null) {
      _tick = Timer.periodic(_LiveCarousel._every, (_) => _advance());
    } else if (!run && _tick != null) {
      _tick!.cancel();
      _tick = null;
    }
  }

  void _advance() {
    if (!mounted || !_scroll.hasClients || _step <= 0) return;
    final position = _scroll.position;
    final at = (position.pixels / _step).round();
    final next = position.pixels >= position.maxScrollExtent - 1 ? 0 : at + 1;
    final target = (next * _step).clamp(0.0, position.maxScrollExtent);
    _scroll.animateTo(
      target,
      duration: Duration(milliseconds: next == 0 ? 650 : 450),
      curve: Curves.easeInOutCubic,
    );
  }

  void _hold() {
    _rest?.cancel();
    if (!_touched) {
      _touched = true;
      _sync();
    }
  }

  void _release() {
    _rest?.cancel();
    _rest = Timer(_LiveCarousel._restAfterTouch, () {
      if (!mounted) return;
      _touched = false;
      _sync();
    });
  }

  @override
  Widget build(BuildContext context) {
    final cards = widget.cards;
    return SizedBox(
      height: 223,
      child: LayoutBuilder(
        builder: (context, box) {
          final room = box.maxWidth - 32;
          final width = cards.length == 1 ? room : math.min(362.0, room + 1);
          _step = width + _LiveCarousel._gap;
          return Listener(
            onPointerDown: (_) => _hold(),
            onPointerUp: (_) => _release(),
            onPointerCancel: (_) => _release(),
            child: ListView.separated(
              key: const ValueKey('games-live'),
              controller: _scroll,
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              clipBehavior: Clip.none,
              itemCount: cards.length,
              separatorBuilder: (_, _) =>
                  const SizedBox(width: _LiveCarousel._gap),
              itemBuilder: (context, index) => Align(
                alignment: Alignment.topCenter,
                child: SizedBox(
                  width: width,
                  height: _LiveCarousel._cardHeight,
                  child: cards[index],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// One live card (node 3755:28496, "Scribble lobby invitation"): a coloured
/// card on a hard shadow, a dark strip over it saying who and how long, the
/// game's picture beside its name and a line about it, then who is in and an
/// arrow at its foot. The whole card opens it.
///
/// Its 2pt edge is drawn inside the card and over what is in it, as Figma
/// draws a stroke, so nothing in it moves in for the edge: the strip is 40pt
/// from the card's top and the body 16pt from its sides. The cards in a row
/// are all one height, so a card with less to say has room left at its foot,
/// as designed.
class _LiveCardFrame extends StatelessWidget {
  const _LiveCardFrame({
    required this.color,
    required this.who,
    required this.whoFace,
    required this.now,
    required this.clock,
    required this.illustration,
    required this.title,
    required this.description,
    required this.onTap,
    required this.footer,
    this.descriptionWeight = FontWeight.w800,
  });

  final Color color;
  final String who;
  final Widget whoFace;

  /// The time, ticking each second while the tab is looked at.
  final ValueListenable<DateTime> now;

  /// What the strip's clock reads at a time: "END IN: 02:14:20", "LIVE NOW".
  final String Function(DateTime now) clock;
  final Widget illustration;
  final String title;
  final String description;

  /// ExtraBold on the lobby card, Bold on the contest one, as designed.
  final FontWeight descriptionWeight;

  /// Opens it; without one the card has no arrow and nothing to open.
  final VoidCallback? onTap;

  /// Who is in, at the foot's left: faces and a count.
  final Widget footer;

  static const _radius = 26.0;

  /// The picture's 97.5pt, or the name's 49pt line over three of 20pt.
  static const _introHeight = 109.0;

  @override
  Widget build(BuildContext context) {
    const top = BorderRadius.vertical(top: Radius.circular(_radius));
    // A strip pill: the face or the clock on the strip's own colour.
    Widget pill(Widget child) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      child: child,
    );
    final onTap = this.onTap;
    final card = Container(
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(_radius),
        boxShadow: const [
          BoxShadow(color: GamesStyle.ink, offset: Offset(0, 7)),
        ],
      ),
      foregroundDecoration: BoxDecoration(
        borderRadius: BorderRadius.circular(_radius),
        border: Border.all(color: GamesStyle.ink, width: 2),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The strip's faint violet edge (rgba(103,90,255,0.2)) shows only
          // along its foot; the card's own edge covers the rest.
          Container(
            decoration: const BoxDecoration(
              color: GamesStyle.ink,
              borderRadius: top,
            ),
            foregroundDecoration: BoxDecoration(
              borderRadius: top,
              border: Border.all(color: const Color(0x33675AFF), width: 1.114),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            child: Row(
              children: [
                Expanded(
                  child: pill(
                    Row(
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
                pill(
                  _Ticking(
                    now: now,
                    text: clock,
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
          // "Game introduction" (3755:28508): as tall as the taller of the
          // picture and the words, and no taller than the card has room for.
          Flexible(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: _introHeight),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 5,
                  children: [
                    illustration,
                    Expanded(
                      child: _LiveTitle(
                        title: title,
                        description: description,
                        weight: descriptionWeight,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          // "Lobby actions" (3755:28556): who is in, and the arrow.
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 18),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 3),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: footer,
                    ),
                  ),
                ),
                if (onTap != null)
                  // The design's left arrow, turned to point on.
                  Transform.flip(
                    key: const ValueKey('live-card-arrow'),
                    flipX: true,
                    child: SvgPicture.asset(
                      '${GamesStyle.asset}/live_card_arrow.svg',
                      width: 20,
                      height: 20,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
    if (onTap == null) return card;
    return Semantics(
      button: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: card,
      ),
    );
  }
}

/// The game's name in the design's 32pt face, made smaller (and then given
/// a second line) only when it would not fit, and the line about it under
/// it: up to three lines, as many as the room under the name holds.
class _LiveTitle extends StatelessWidget {
  const _LiveTitle({
    required this.title,
    required this.description,
    required this.weight,
  });

  final String title;
  final String description;
  final FontWeight weight;

  @override
  Widget build(BuildContext context) {
    final scaler = MediaQuery.textScalerOf(context);
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
            textScaler: scaler,
            textDirection: TextDirection.ltr,
          )..layout(maxWidth: box.maxWidth);
          return !painter.didExceedMaxLines;
        }

        if (!fits(32, 1)) {
          size = fits(26, 1) ? 26 : 22;
          if (!fits(size, 1)) lines = 2;
        }
        final lineHeight = size == 32 ? 49.0 : size * 1.1;
        final room = box.maxHeight.isFinite
            ? box.maxHeight - scaler.scale(lineHeight) * lines
            : 60.0;
        final descriptionLines = (room / scaler.scale(20)).floor().clamp(1, 3);
        return ClipRect(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                upper,
                maxLines: lines,
                overflow: TextOverflow.ellipsis,
                style: GamesStyle.lilita(
                  size,
                  color: _titleInk,
                  height: lineHeight,
                ),
              ),
              if (description.isNotEmpty)
                Text(
                  description,
                  maxLines: descriptionLines,
                  overflow: TextOverflow.ellipsis,
                  style: GamesStyle.sora(
                    14,
                    weight: weight,
                    color: _titleInk,
                    height: 20,
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

/// Up to two faces, then "+N", as the waiting players show (node 3755:28558):
/// 24pt faces in a 1.5pt ring, each over the last by 8pt.
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
        _Face(
          name: face.name,
          initials: face.initials,
          photoUrl: face.photoUrl,
          size: 24,
        ),
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
          child: Text(
            '+$extra',
            style: GamesStyle.sora(10, color: Colors.white),
          ),
        ),
    ];
    if (items.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      width: 24 + (items.length - 1) * 16,
      height: 24,
      child: Stack(
        children: [
          for (var i = 0; i < items.length; i++)
            Positioned(left: i * 16.0, child: items[i]),
        ],
      ),
    );
  }
}

/// A live contest's latest entries in its picture's place, sliding to the
/// next every second: a caption's words, a photo, or the colleague named.
/// Moves only while [active] (the pane's loop is running) and there is more
/// than one to show.
class _EntryCycler extends StatefulWidget {
  const _EntryCycler({
    super.key,
    required this.kind,
    required this.previews,
    required this.active,
    this.overPicture = false,
  });

  final ContestKind kind;
  final List<ContestPreview> previews;
  final bool active;

  /// Drawn over the contest's own picture: light words on a dark wash.
  final bool overPicture;

  @override
  State<_EntryCycler> createState() => _EntryCyclerState();
}

class _EntryCyclerState extends State<_EntryCycler> {
  int _index = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(covariant _EntryCycler old) {
    super.didUpdateWidget(old);
    if (_index >= widget.previews.length) _index = 0;
    _sync();
  }

  void _sync() {
    final run = widget.active && widget.previews.length > 1;
    if (!run) {
      _timer?.cancel();
      _timer = null;
    } else {
      _timer ??= Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted)
          setState(() => _index = (_index + 1) % widget.previews.length);
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Widget _face(ContestPreview preview) {
    final first = preview.name.trim().split(RegExp(r'\s+')).first;
    final image = preview.imageUrl;
    if (widget.kind == ContestKind.photo && image != null) {
      return Image(
        image: CachedNetworkImageProvider(image),
        fit: BoxFit.cover,
        width: 85,
        height: 85,
        errorBuilder: (_, _, _) => const ColoredBox(color: GamesStyle.pageDot),
      );
    }
    if (widget.kind == ContestKind.mostLikely) {
      final photo = preview.photoUrl;
      return Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: GamesStyle.cream,
              border: Border.all(color: GamesStyle.ink, width: 2),
              image: photo == null
                  ? null
                  : DecorationImage(
                      image: CachedNetworkImageProvider(photo),
                      fit: BoxFit.cover,
                    ),
            ),
            alignment: Alignment.center,
            child: photo == null
                ? Text(
                    first.isEmpty ? '?' : first[0].toUpperCase(),
                    style: GamesStyle.lilita(20),
                  )
                : null,
          ),
          const SizedBox(height: 5),
          Text(
            first,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: GamesStyle.figtree(
              11,
              weight: FontWeight.w800,
              color: GamesStyle.ink,
            ),
          ),
        ],
      );
    }
    // A caption: its words, and whose. Over the picture, in white on a wash
    // dark enough to read whatever the picture is.
    final over = widget.overPicture;
    const shadow = [Shadow(color: Color(0x99000000), blurRadius: 3)];
    final caption = Padding(
      padding: const EdgeInsets.fromLTRB(7, 8, 7, 7),
      child: Column(
        children: [
          Expanded(
            child: Center(
              child: Text(
                '“${preview.text ?? ''}”',
                maxLines: 4,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: GamesStyle.figtree(
                  10.5,
                  weight: FontWeight.w800,
                  color: over ? Colors.white : GamesStyle.ink,
                ).copyWith(shadows: over ? shadow : null),
              ),
            ),
          ),
          Text(
            first,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: GamesStyle.figtree(
              9,
              weight: FontWeight.w700,
              color: over ? Colors.white : GamesStyle.ink2,
            ).copyWith(shadows: over ? shadow : null),
          ),
        ],
      ),
    );
    if (!over) return caption;
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0x40000000), Color(0x8C000000)],
        ),
      ),
      child: caption,
    );
  }

  @override
  Widget build(BuildContext context) {
    final previews = widget.previews;
    if (previews.isEmpty) return const SizedBox.shrink();
    final preview = previews[_index % previews.length];
    return ClipRect(
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 320),
        switchInCurve: Curves.easeOutCubic,
        switchOutCurve: Curves.easeInCubic,
        transitionBuilder: (child, animation) => SlideTransition(
          position: Tween(
            begin: const Offset(1, 0),
            end: Offset.zero,
          ).animate(animation),
          child: FadeTransition(opacity: animation, child: child),
        ),
        layoutBuilder: (current, previous) =>
            Stack(fit: StackFit.expand, children: [...previous, ?current]),
        child: KeyedSubtree(key: ValueKey(_index), child: _face(preview)),
      ),
    );
  }
}

/// A Connect contest still taking entries, on the purple card (node
/// 3755:28496).
class _LiveContestCard extends StatelessWidget {
  const _LiveContestCard({
    super.key,
    required this.contest,
    required this.now,
    required this.isAuthor,
    required this.motion,
    required this.onOpen,
  });

  final LiveContest contest;
  final ValueListenable<DateTime> now;
  final bool isAuthor;

  /// The pane's loop, or null to hold still.
  final Animation<double>? motion;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final closes = contest.closesAt;
    // Once there are entries, they take the picture's place, one a second. A
    // caption contest shows the picture being captioned behind them, and on
    // its own until the first caption comes in.
    final picture = contest.kind == ContestKind.caption
        ? contest.imageUrl
        : null;
    final tile = contest.previews.isNotEmpty || picture != null
        ? _IllustrationTile(
            color: contest.kind == ContestKind.photo
                ? GamesStyle.pageDot
                : GamesStyle.purpleArt,
            fitted: false,
            rocking: contest.kind == ContestKind.photo ? null : motion,
            child: SizedBox(
              width: 85,
              height: 85,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (picture != null)
                    Image(
                      key: const ValueKey('contest-picture'),
                      image: CachedNetworkImageProvider(picture),
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) =>
                          const ColoredBox(color: GamesStyle.purpleArt),
                    ),
                  if (contest.previews.isNotEmpty)
                    _EntryCycler(
                      key: ValueKey('contest-previews-${contest.id}'),
                      kind: contest.kind,
                      previews: contest.previews,
                      active: motion != null,
                      overPicture: picture != null,
                    ),
                ],
              ),
            ),
          )
        : switch (contest.kind) {
            ContestKind.caption => _IllustrationTile(
              color: GamesStyle.purpleArt,
              padding: 4,
              rocking: motion,
              child: _moodyCatArt(),
            ),
            // As designed (3690:43101): the tile holds still at 5° while its
            // camera lands and its sparkle blinks.
            ContestKind.photo => _IllustrationTile(
              color: GamesStyle.pageDot,
              fitted: false,
              child: _LivePhotoArt(motion: motion),
            ),
            ContestKind.mostLikely => _IllustrationTile(
              color: GamesStyle.purpleArt,
              padding: 4,
              rocking: motion,
              child: _mostLikelyArt(),
            ),
          };
    final fallbackQuote = switch (contest.kind) {
      ContestKind.caption => 'Write the funniest caption.',
      ContestKind.photo => 'Post your best shot.',
      ContestKind.mostLikely => 'Who fits the tag?',
    };
    final first = contest.authorName.trim().split(RegExp(r'\s+')).first;
    final entries = contest.entries;
    return Semantics(
      container: true,
      label: '${contest.title}, contest',
      child: _LiveCardFrame(
        color: GamesStyle.purple,
        // One HR published speaks as the company, as the feed's card does.
        who: contest.official
            ? 'Sowaka created this contest'
            : isAuthor
            ? 'You created this contest'
            : first.isEmpty
            ? 'A new contest'
            : '$first created this contest',
        whoFace: contest.official
            ? const _SowakaFace(size: 26)
            : _Face(
                name: contest.authorName,
                photoUrl: contest.authorPhotoUrl,
                size: 26,
              ),
        now: now,
        // As the feed's contest card counts down: "END IN: 02:14:20".
        clock: (now) {
          if (closes == null) return 'OPEN';
          final left = _countdown(closes, now);
          return left == null ? 'ENDED' : 'END IN: $left';
        },
        illustration: tile,
        title: contest.title.isEmpty ? 'Contest' : contest.title,
        // The brief as it was written (3755:28555), in Bold.
        description: contest.prompt.isEmpty ? fallbackQuote : contest.prompt,
        descriptionWeight: FontWeight.w700,
        onTap: onOpen,
        // "Waiting players" (3755:28557): the latest faces, "+N", the count.
        footer: Row(
          mainAxisSize: MainAxisSize.min,
          spacing: 8,
          children: [
            _FacePile(faces: contest.entrants, total: entries),
            Flexible(
              child: Text(
                entries == 0
                    ? 'Be the first to enter'
                    : _plural(entries, 'entry', 'entries'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: GamesStyle.sora(12, color: GamesStyle.ink),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The company's Hint Relay, live or coming up, on the yellow lobby card
/// (node 3755:28567).
class _LiveRelayCard extends StatelessWidget {
  const _LiveRelayCard({
    super.key,
    required this.relay,
    required this.now,
    required this.motion,
    required this.onJoin,
  });

  final LiveRelay relay;
  final ValueListenable<DateTime> now;

  /// The pane's loop, or null to hold still.
  final Animation<double>? motion;
  final VoidCallback? onJoin;

  @override
  Widget build(BuildContext context) {
    final starts = relay.startsAt;
    String clock(DateTime now) {
      final left = starts == null ? null : _countdown(starts, now);
      return switch (relay.phase) {
        RelayPhaseNow.live => 'LIVE NOW',
        _ when left != null => 'STARTS IN: $left',
        RelayPhaseNow.lobby => 'LOBBY OPEN',
        RelayPhaseNow.upcoming => 'SOON',
      };
    }

    final team = relay.teamName;
    final who = team != null
        ? 'You are on $team'
        : relay.teams == 1
        ? '1 team is in'
        : relay.teams > 1
        ? '${_plural(relay.teams, 'team', 'teams')} are in'
        : 'Your company’s team game';
    final players = relay.players;
    final footerText = switch (relay.phase) {
      RelayPhaseNow.live => '${_plural(players, 'player', 'players')} playing',
      RelayPhaseNow.lobby => '${_plural(players, 'player', 'players')} waiting',
      RelayPhaseNow.upcoming =>
        '${_plural(players, 'player', 'players')} signed up',
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
          child: SvgPicture.asset(
            '${GamesStyle.asset}/tag_team.svg',
            width: 14,
            height: 14,
          ),
        ),
        now: now,
        clock: clock,
        illustration: _IllustrationTile(
          color: GamesStyle.blueArt,
          padding: 4,
          rocking: motion,
          // Just the tiles and their dashes, so they read at tile size.
          child: ClipRect(
            child: Align(
              widthFactor: 141 / 172.61,
              heightFactor: 63 / 108.786,
              child: SizedBox(
                width: 172.61,
                height: 108.786,
                child: _tilesArt('HINT'),
              ),
            ),
          ),
        ),
        title: relay.title,
        description: team != null
            ? '“Your team needs you!”'
            : '“Many clues. One answer.”',
        onTap: onJoin,
        // Some of the players and how many (3755:28598); the players icon in
        // place of their faces from a server from before them.
        footer: players == 0
            ? const SizedBox(height: 24)
            : Row(
                mainAxisSize: MainAxisSize.min,
                spacing: relay.faces.isEmpty ? 6 : 8,
                children: [
                  if (relay.faces.isEmpty)
                    SvgPicture.asset(
                      '${GamesStyle.asset}/players.svg',
                      width: 16,
                      height: 16,
                    )
                  else
                    _FacePile(faces: relay.faces, total: players),
                  Flexible(
                    child: SizedBox(
                      height: 24,
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          footerText,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: GamesStyle.sora(12, color: GamesStyle.ink),
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

// ---------------------------------------------------------------- challenges

/// "Raghav challenged you in Odd One Out" (node 3581:29409). Its edge is
/// drawn inside, over its padding, as Figma draws a stroke: the text sits
/// 14pt and 12pt in from the card's outside.
class _ChallengeCard extends StatelessWidget {
  const _ChallengeCard({
    super.key,
    required this.challenge,
    required this.now,
    required this.busy,
    required this.onAccept,
  });

  final HomeChallenge challenge;

  /// The time, ticking each second while the tab is looked at, for the clock.
  final ValueListenable<DateTime> now;
  final bool busy;
  final VoidCallback onAccept;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: GamesStyle.night,
        borderRadius: BorderRadius.circular(20),
      ),
      foregroundDecoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: GamesStyle.nightBorder, width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 10,
        children: [
          // The game's name, and who sent it; what to beat and the terms are
          // for inside the game.
          Text(
            challenge.gameName.toUpperCase(),
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
              _Face(
                name: challenge.fromName,
                photoUrl: challenge.fromPhotoUrl,
                size: 34,
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 4,
                  children: [
                    Text(
                      challenge.sentByMe
                          ? 'You challenged ${challenge.fromFirstName}'
                          : '${challenge.fromFirstName} challenged you',
                      style: GamesStyle.sora(
                        13,
                        color: GamesStyle.cream,
                        height: 16,
                      ),
                    ),
                    if (challenge.expiresAt case final ends?)
                      _Ticking(
                        key: ValueKey('challenge-clock-${challenge.id}'),
                        now: now,
                        text: (now) {
                          final left = _countdown(ends, now);
                          return left == null
                              ? 'Challenge ended'
                              : 'Challenge ends in $left';
                        },
                        style: GamesStyle.sora(
                          11.5,
                          color: GamesStyle.lilac,
                          height: 15,
                        ),
                      ),
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
  const _GameCardLarge({
    super.key,
    required this.game,
    required this.played,
    required this.onPlay,
  });

  final GameCatalogEntry game;
  final PlayedGame played;
  final VoidCallback onPlay;

  // Drawn to the design's fixed size: larger text would spill out of it.
  @override
  Widget build(BuildContext context) => MediaQuery.withClampedTextScaling(
    maxScaleFactor: 1.0,
    child: Builder(builder: _drawn),
  );

  Widget _drawn(BuildContext context) {
    final rank = played.rank;
    final players = played.players;
    return Container(
      width: 232,
      height: 282.24,
      decoration: BoxDecoration(
        color: GamesStyle.night,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: GamesStyle.ink2, width: 2.2),
        boxShadow: const [
          BoxShadow(color: GamesStyle.ink2, offset: Offset(0, 5)),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(15.8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              height: 134,
              decoration: const BoxDecoration(
                border: Border(
                  bottom: BorderSide(color: GamesStyle.ink2, width: 2.2),
                ),
              ),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  _GamePicture(game: game, background: GamesStyle.green),
                  // The design's box for the tipped badge is 58.5 × 55.7 at
                  // (163.06, 70.95); the 55 × 52 badge turns in its middle.
                  if (rank != null)
                    Positioned(
                      left: 163.06 + (58.493 - 55) / 2,
                      top: 70.95 + (55.71 - 52) / 2,
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
                    child: Padding(
                      padding: const EdgeInsets.only(left: 0.33, top: 0.36),
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
                  ),
                  SizedBox(
                    height: 28,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        game.name.toUpperCase(),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: GamesStyle.lilita(
                          19,
                          color: GamesStyle.page,
                          height: 22,
                        ),
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
                      style: GamesStyle.figtree(
                        9.5,
                        color: const Color(0xFFEBEBEB),
                        height: 12.35,
                      ),
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

  /// Null while unranked (no points yet).
  final int? rank;
  final bool dark;

  // Drawn to the design's fixed size: larger text would spill out of it.
  @override
  Widget build(BuildContext context) => MediaQuery.withClampedTextScaling(
    maxScaleFactor: 1.0,
    child: Builder(builder: _drawn),
  );

  Widget _drawn(BuildContext context) {
    final ink = dark ? GamesStyle.yellow2 : GamesStyle.ink2;
    return Container(
      width: 55,
      height: 52,
      decoration: BoxDecoration(
        color: dark ? GamesStyle.ink2 : GamesStyle.page,
        borderRadius: BorderRadius.circular(12),
        border: dark ? null : Border.all(color: GamesStyle.ink2, width: 1.1),
        boxShadow: const [
          BoxShadow(color: GamesStyle.ink2, offset: Offset(0, 2)),
        ],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              rank == null ? '–' : '#$rank',
              style: GamesStyle.lilita(22, color: ink, height: 19.8),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 3),
            child: Text(
              'YOUR RANK',
              style: GamesStyle.figtree(
                7,
                weight: FontWeight.w800,
                color: ink,
                height: 10.5,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TypeTag extends StatelessWidget {
  const _TypeTag({
    required this.label,
    required this.icon,
    required this.color,
  });

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
          Text(
            label,
            style: GamesStyle.figtree(
              8.5,
              weight: FontWeight.w800,
              height: 8.5,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- explore

/// Explore Games (node 3605:31672): Team games and Solo games, each a grid
/// of small cards, and who is playing now under them. (The design's
/// Community board is left out: contests are set up from Connect's Posts.)
class _ExploreSection extends StatelessWidget {
  const _ExploreSection({
    required this.tab,
    required this.onTab,
    required this.relay,
    required this.now,
    required this.soloGames,
    required this.thumbnailFor,
    required this.playingNow,
    required this.onJoinRelay,
    required this.onPlay,
  });

  final _ExploreTab tab;
  final ValueChanged<_ExploreTab> onTab;
  final LiveRelay? relay;
  final ValueListenable<DateTime> now;
  final List<GameCatalogEntry> soloGames;
  final String? Function(GameCatalogEntry game)? thumbnailFor;
  final PlayingNow playingNow;
  final ValueChanged<String> onJoinRelay;
  final ValueChanged<GameCatalogEntry> onPlay;

  @override
  Widget build(BuildContext context) {
    final cards = switch (tab) {
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
                  style: GamesStyle.lilita(
                    18,
                    color: GamesStyle.night,
                    height: 27,
                    spacing: 0.35,
                  ),
                ),
              ),
            ),
          ),
          SizedBox(
            height: 37,
            child: Padding(
              padding: const EdgeInsets.only(top: 1),
              child: _FitRow(
                spacing: 12,
                children: [
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
          description:
              'When your company runs Hint Relay, your team plays it from here.',
          bottom: const SizedBox(height: 4),
        ),
      ];
    }
    final starts = event.startsAt;
    String status(DateTime now) {
      final left = starts == null ? null : _countdown(starts, now);
      return switch (event.phase) {
        RelayPhaseNow.live => 'LIVE NOW',
        RelayPhaseNow.lobby => 'LOBBY OPEN',
        RelayPhaseNow.upcoming =>
          left == null ? 'COMING UP' : 'STARTS IN: $left',
      };
    }

    final postId = event.postId;
    return [
      _GameCardSmall(
        key: ValueKey('explore-relay-${event.eventId}'),
        color: GamesStyle.blue,
        artColor: GamesStyle.blueArt,
        art: Stack(
          children: [
            art,
            Positioned(
              left: 7.18,
              top: 5.98,
              child: ValueListenableBuilder<DateTime>(
                valueListenable: now,
                builder: (context, now, _) =>
                    _LiveIndicator(label: status(now)),
              ),
            ),
          ],
        ),
        title: event.title,
        description:
            'Crack the clues with your team before the clock runs out.',
        // The design's (3605:31145): a 34pt foot, 5pt under the line about
        // it, with a 26pt row at its bottom: the players, and the 45pt Join
        // key hanging over the row's top and bottom.
        bottom: Padding(
          padding: const EdgeInsets.only(top: 5),
          child: SizedBox(
            height: 34,
            child: Align(
              alignment: Alignment.bottomCenter,
              child: SizedBox(
                height: 26.2,
                child: Row(
                  children: [
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: 3),
                        child: Row(
                          spacing: 2,
                          children: [
                            SvgPicture.asset(
                              '${GamesStyle.asset}/players.svg',
                              width: 14,
                              height: 14,
                            ),
                            Flexible(
                              child: Text(
                                _plural(event.players, 'player', 'players'),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: GamesStyle.figtree(
                                  10,
                                  weight: FontWeight.w500,
                                  color: GamesStyle.ink,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 55,
                      height: 26.2,
                      child: OverflowBox(
                        minHeight: 45,
                        maxHeight: 45,
                        child: GameCtaButton(
                          key: const ValueKey('join-relay'),
                          label: event.phase == RelayPhaseNow.upcoming
                              ? 'View'
                              : 'Join',
                          onTap: postId == null
                              ? null
                              : () => onJoinRelay(postId),
                          small: true,
                          width: 55,
                          height: 45,
                          fontSize: 12,
                          labelCenter: 0.444,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
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
            child: SizedBox(
              width: 172.593,
              height: 108.786,
              child: _oddOneOutArt(),
            ),
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
                  child: SizedBox(
                    width: 172.593,
                    height: 108.786,
                    child: _oddOneOutArt(),
                  ),
                )
              : _GamePicture(
                  game: game,
                  thumbnail: thumbnailFor?.call(game),
                  background: GamesStyle.mintArt,
                ),
          title: game.name,
          description: game.tagline.isNotEmpty
              ? game.tagline
              : game.description,
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

/// One of the explore tabs: the chosen one tipped 3° on a hard shadow.
class _ExploreChip extends StatelessWidget {
  const _ExploreChip({
    super.key,
    required this.label,
    required this.icon,
    required this.color,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String icon;
  final Color color;
  final bool selected;
  final VoidCallback onTap;

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
          SvgPicture.asset('${GamesStyle.asset}/$icon', width: 14, height: 14),
          Text(
            label,
            style: GamesStyle.figtree(10, weight: FontWeight.w700, height: 15),
          ),
        ],
      ),
    );
    return Semantics(
      button: true,
      selected: selected,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: selected
            ? Transform.rotate(angle: -3 * math.pi / 180, child: chip)
            : chip,
      ),
    );
  }
}

/// Two columns, 10pt apart, rows 12pt apart (node 3605:31585). It keeps two
/// rows' room, as the design's Team tab does with its one card (a second
/// 217.4pt row), so the page under it does not jump as the tabs change.
class _CardGrid extends StatelessWidget {
  const _CardGrid({required this.cards});

  final List<Widget> cards;

  static const _emptyRow = 217.4;

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
              Expanded(
                child: i + 1 < cards.length
                    ? cards[i + 1]
                    : const SizedBox.shrink(),
              ),
            ],
          ),
        if (cards.length <= 2) const SizedBox(height: _emptyRow),
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
        boxShadow: const [
          BoxShadow(color: GamesStyle.ink2, offset: Offset(0, 5)),
        ],
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
                border: const Border(
                  bottom: BorderSide(color: GamesStyle.ink2, width: 2.2),
                ),
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
                    style: GamesStyle.lilita(
                      16,
                      color: GamesStyle.ink2,
                      height: 16,
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 5),
                    child: SizedBox(
                      height: 23.75,
                      child: Text(
                        description,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: GamesStyle.figtree(
                          9.5,
                          color: GamesStyle.muted,
                          height: 11.875,
                        ),
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
      decoration: BoxDecoration(
        color: GamesStyle.ink2,
        borderRadius: BorderRadius.circular(999),
      ),
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

  static const _colors = [
    GamesStyle.blue,
    Color(0xFFC6F03C),
    Color(0xFFFF8A3D),
  ];

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
                            border: Border.all(
                              color: GamesStyle.ink2,
                              width: 1.1,
                            ),
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            faces[i].characters.first,
                            style: GamesStyle.figtree(
                              7,
                              weight: FontWeight.w800,
                              height: 8.75,
                            ),
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
                style: GamesStyle.figtree(
                  9.5,
                  color: GamesStyle.secondary,
                  height: 11.875,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The company's mark where a face would be, on a contest HR published.
class _SowakaFace extends StatelessWidget {
  const _SowakaFace({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      padding: EdgeInsets.all(size * 0.12),
      decoration: BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        border: Border.all(color: GamesStyle.ink, width: 1.5),
      ),
      child: ClipOval(
        child: Image.asset(
          'assets/images/sowaka_logo.png',
          fit: BoxFit.contain,
        ),
      ),
    );
  }
}
