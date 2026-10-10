part of 'connect_feed_screen.dart';

// The entries sheet behind "View Entries" and "See all nominations"
// (LeaderboardSheet frames 3261:25645, 3261:26059 for captions, 3332:23582,
// 3388:30108 for tags, 3327:20846, 3327:21639 for photos).
//
// The design sets this sheet in Inter, which the app does not bundle; those
// lines take the app's own face, and the lines the design sets in Sora keep it.

const _sheetInk = Color(0xFF292536);
const _sheetMuted = Color(0xFF817B8F);
const _sheetPurple = Color(0xFF59378D);
const _galleryInk = Color(0xFF24222A);
const _galleryMuted = Color(0xFF817C89);

/// Opens the entries for a contest as a page of its own, with a back button
/// to the feed. The page is its own route, so what it needs from the feed is
/// collected here and handed in.
Future<void> _openEntriesSheet(
  BuildContext context,
  ConnectPost post, {
  Future<void> Function()? onAddEntry,
}) {
  final scope = _FeedScope.of(context);
  return Navigator.of(context).push<void>(
    MaterialPageRoute(
      builder: (_) => _EntriesSheet(
        bloc: scope?.bloc,
        initialPost: post,
        people: scope?.people ?? const [],
        onOpenPerson: scope?.onOpenPerson,
        onAddEntry: onAddEntry,
      ),
    ),
  );
}

enum _EntriesOrder { mostVoted, mostRecent }

class _EntriesSheet extends StatefulWidget {
  const _EntriesSheet({
    required this.bloc,
    required this.initialPost,
    required this.people,
    required this.onOpenPerson,
    required this.onAddEntry,
  });

  /// Null only where there is no live feed behind the sheet; it then shows
  /// the post as it was opened and takes no votes.
  final ConnectBloc? bloc;
  final ConnectPost initialPost;
  final List<ConnectTeammate> people;
  final ValueChanged<String>? onOpenPerson;

  /// Starts the viewer's own entry back on the card ("Add your answer").
  final Future<void> Function()? onAddEntry;

  @override
  State<_EntriesSheet> createState() => _EntriesSheetState();
}

class _EntriesSheetState extends State<_EntriesSheet> {
  _EntriesOrder _order = _EntriesOrder.mostVoted;
  final _keys = <String, GlobalKey>{};

  late final Map<String, String> _photos = {
    for (final person in widget.people)
      if ((person.photoUrl ?? '').isNotEmpty) person.userId: person.photoUrl!,
  };

  GlobalKey _keyFor(String id) => _keys.putIfAbsent(id, GlobalKey.new);

  void _reveal(String? id) {
    final target = id == null ? null : _keys[id]?.currentContext;
    if (target == null) return;
    Scrollable.ensureVisible(
      target,
      alignment: 0.3,
      duration: const Duration(milliseconds: 280),
    );
  }

  void _vote(ConnectPost post, String entryId) {
    if (post.challengeClosed) return;
    widget.bloc?.voteCaption(post.id, entryId);
  }

  Future<void> _addEntry() async {
    final add = widget.onAddEntry;
    Navigator.of(context).pop();
    if (add != null) await add();
  }

  void _openPerson(String userId) {
    final open = widget.onOpenPerson;
    if (open == null || userId.isEmpty) return;
    open(userId);
  }

  @override
  Widget build(BuildContext context) {
    final bloc = widget.bloc;
    if (bloc == null) return _sheet(widget.initialPost);
    return StreamBuilder<ConnectState>(
      stream: bloc.stream,
      initialData: bloc.state,
      builder: (context, snapshot) {
        final post =
            (snapshot.data ?? bloc.state).posts
                .where((item) => item.id == widget.initialPost.id)
                .firstOrNull ??
            widget.initialPost;
        return _sheet(post);
      },
    );
  }

  Widget _sheet(ConnectPost post) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _EntriesTopBar(onBack: () => Navigator.of(context).maybePop()),
            Expanded(
              child: Builder(
                builder: (context) => ListView(
                  padding: EdgeInsets.fromLTRB(
                    20,
                    0,
                    20,
                    24 + MediaQuery.paddingOf(context).bottom,
                  ),
                  children: [
                    _SheetHero(post: post),
                    if (post.type == ConnectPostType.photoStoryChallenge)
                      _galleryOverview(post)
                    else
                      _voteOverview(post),
                    ..._rankings(post),
                    if (_canAddEntry(post)) _footer(post),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  bool _canAddEntry(ConnectPost post) {
    if (post.challengeClosed || widget.onAddEntry == null) return false;
    if (post.type == ConnectPostType.mostLikely) {
      return post.myTaggedUserId == null;
    }
    return post.myCaptionEntryId == null;
  }

  /// The lime button under everything, for someone who has not entered yet
  /// (node 3327:23343).
  Widget _footer(ConnectPost post) {
    final label = switch (post.type) {
      ConnectPostType.mostLikely => 'Nominate',
      ConnectPostType.photoStoryChallenge => 'Add your photo',
      _ => 'Add your answer',
    };
    return Padding(
      padding: const EdgeInsets.only(top: 17, bottom: 13),
      child: _EngagementCta(label: label, onTap: _addEntry),
    );
  }

  // ---- Your vote / your rank -------------------------------------------

  /// "YOUR VOTE | YOUR RANK" for captions and tags (node 3261:25863).
  Widget _voteOverview(ConnectPost post) {
    final isTag = post.type == ConnectPostType.mostLikely;
    final board = post.captionLeaderboard;
    // Who the viewer backed: the caption they voted for, or the colleague
    // they tagged.
    final votedId = isTag ? post.myTaggedUserId : post.myCaptionVoteEntryId;
    final voted = votedId == null
        ? null
        : (isTag ? board : post.captionEntries)
              .where((row) => (isTag ? row.userId : row.id) == votedId)
              .firstOrNull;
    // Where the viewer stands: their own caption's place, or their own row
    // among the people named.
    final mine = board.where((row) => row.isMine).firstOrNull;
    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: Container(
        height: 79,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFECE7F5)),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 179,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: voted != null
                    ? () => _reveal(isTag ? voted.userId : voted.id)
                    : (_canAddEntry(post) && isTag ? _addEntry : null),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 16, 9, 13),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _overviewLabel('circle_check.svg', 14, 'YOUR VOTE'),
                      const SizedBox(height: 7),
                      Row(
                        children: [
                          if (voted != null) ...[
                            _InitialDot(
                              userId: voted.userId,
                              initials: voted.initials,
                            ),
                            const SizedBox(width: 7),
                          ],
                          Flexible(
                            child: Text(
                              voted?.name ?? 'Vote for someone',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: voted == null
                                    ? _EngagementColors.inkTertiary
                                    : _sheetInk,
                              ),
                            ),
                          ),
                          const SizedBox(width: 7),
                          SvgPicture.asset(
                            '$_engagementIcons/chevron_down.svg',
                            width: 13,
                            height: 13,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(
              width: 1,
              height: double.infinity,
              child: ColoredBox(color: Color(0xFFECE7F5)),
            ),
            Expanded(
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: mine != null
                    ? () => _reveal(isTag ? mine.userId : mine.id)
                    : (_canAddEntry(post) && !isTag ? _addEntry : null),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(11, 17, 9, 13),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: _overviewLabel(
                              'trophy_outline.svg',
                              15,
                              'YOUR RANK',
                            ),
                          ),
                          if (mine == null && !isTag && _canAddEntry(post))
                            SvgPicture.asset(
                              '$_engagementIcons/plus.svg',
                              width: 13,
                              height: 13,
                            ),
                        ],
                      ),
                      const SizedBox(height: 7),
                      if (mine != null)
                        Row(
                          children: [
                            Text(
                              '#${mine.rank ?? 0}',
                              style: const TextStyle(
                                fontSize: 21,
                                height: 23 / 21,
                                fontWeight: FontWeight.w700,
                                color: _sheetPurple,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Flexible(
                              child: Text(
                                'of ${board.length} · ${mine.points} pts',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: _sheetMuted,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            SvgPicture.asset(
                              '$_engagementIcons/chevron_down.svg',
                              width: 13,
                              height: 13,
                            ),
                          ],
                        )
                      else
                        Text(
                          // Most Likely ranks the people named, so you are on
                          // the board only once someone tags you.
                          isTag ? 'Not tagged yet' : 'Submit your entry',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: _EngagementColors.inkTertiary,
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _overviewLabel(String icon, double size, String label) {
    return Row(
      children: [
        SvgPicture.asset('$_engagementIcons/$icon', width: size, height: size),
        const SizedBox(width: 5),
        Text(
          label,
          style: const TextStyle(
            fontSize: 9,
            fontWeight: FontWeight.w700,
            color: _sheetMuted,
          ),
        ),
      ],
    );
  }

  /// "YOUR VOTE" and "YOUR PHOTO" cards for a photo contest
  /// (nodes 3327:21029, 3327:21657).
  Widget _galleryOverview(ConnectPost post) {
    final entries = post.captionLeaderboard;
    final votedId = post.myCaptionVoteEntryId;
    final voted = votedId == null
        ? null
        : entries.where((entry) => entry.id == votedId).firstOrNull;
    final mine = entries.where((entry) => entry.isMine).firstOrNull;
    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: Row(
        children: [
          Expanded(
            child: _GalleryOverviewCard(
              label: 'YOUR VOTE',
              icon: 'chevron_right.svg',
              onTap: voted == null ? null : () => _reveal(voted.id),
              thumb: voted == null
                  ? const _OverviewPlaceholder(
                      icon: 'arrow_up_thick_purple.svg',
                      size: 20,
                    )
                  : _OverviewThumb(url: voted.photoUrl),
              title: Text(
                voted?.name ?? 'Not voted yet',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: _galleryInk,
                ),
              ),
              subtitle: voted == null
                  ? 'Pick your favourite'
                  : '#${voted.rank ?? 0} · ${voted.votes} vote${voted.votes == 1 ? '' : 's'}',
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: _GalleryOverviewCard(
              label: 'YOUR PHOTO',
              icon: 'plus.svg',
              onTap: mine != null
                  ? () => _reveal(mine.id)
                  : (_canAddEntry(post) ? _addEntry : null),
              thumb: mine == null
                  ? const _OverviewPlaceholder(
                      icon: 'camera_outline.svg',
                      size: 19,
                    )
                  : _OverviewThumb(url: mine.photoUrl),
              title: mine == null
                  ? const Text(
                      'No entry yet',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: _galleryInk,
                      ),
                    )
                  : Text(
                      '#${mine.rank ?? 0}',
                      style: const TextStyle(
                        fontFamily: _soraFont,
                        fontSize: 16,
                        height: 16.2 / 16,
                        fontWeight: FontWeight.w600,
                        letterSpacing: -0.16,
                        color: _galleryInk,
                      ),
                    ),
              subtitle: mine == null
                  ? 'Add your photo'
                  : '${mine.points} pts · ${mine.votes} vote${mine.votes == 1 ? '' : 's'}',
            ),
          ),
        ],
      ),
    );
  }

  // ---- The ranking -------------------------------------------------------

  List<Widget> _rankings(ConnectPost post) {
    final isTag = post.type == ConnectPostType.mostLikely;
    final isPhoto = post.type == ConnectPostType.photoStoryChallenge;
    final board = post.captionLeaderboard;
    final ordered = [...board];
    // Most recent goes by when each entry went in — for Most Likely, when
    // each person was last tagged. A board from a server that sends no times
    // keeps its own order rather than being half-sorted.
    if (_order == _EntriesOrder.mostRecent &&
        ordered.every((row) => row.createdAt != null)) {
      ordered.sort((a, b) => b.createdAt!.compareTo(a.createdAt!));
    }
    final count = board.length;
    return [
      Padding(
        padding: EdgeInsets.only(
          top: 23,
          left: isPhoto ? 15 : 0,
          right: isPhoto ? 15 : 0,
        ),
        child: SizedBox(
          height: isPhoto ? 24 : 36,
          child: Padding(
            padding: EdgeInsets.only(bottom: isPhoto ? 0 : 6),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  isPhoto ? 'The gallery' : 'Leaderboard',
                  style: TextStyle(
                    fontSize: 20,
                    height: 1.2,
                    fontWeight: FontWeight.w700,
                    color: isPhoto ? _galleryInk : _sheetInk,
                  ),
                ),
                Text(
                  '$count ${count == 1 ? 'entry' : 'entries'}',
                  style: TextStyle(
                    fontSize: 11,
                    color: isPhoto ? _galleryMuted : _sheetMuted,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      Padding(
        padding: EdgeInsets.only(
          top: isPhoto ? 15 : 0,
          left: isPhoto ? 15 : 0,
          right: isPhoto ? 15 : 0,
        ),
        child: _SortTabs(
          order: _order,
          gallery: isPhoto,
          onChanged: (order) => setState(() => _order = order),
        ),
      ),
      Padding(
        padding: EdgeInsets.fromLTRB(
          isPhoto ? 15 : 2,
          isPhoto ? 9 : 8,
          isPhoto ? 15 : 0,
          isPhoto ? 16 : 12,
        ),
        child: Text(
          post.challengeClosed
              ? 'This contest has closed.'
              : 'You can change your vote while the contest is live',
          style: TextStyle(
            fontSize: isPhoto ? 11 : 10,
            height: 13 / (isPhoto ? 11 : 10),
            color: isPhoto ? _galleryMuted : _sheetMuted,
          ),
        ),
      ),
      if (board.isEmpty)
        const _EntriesEmpty()
      else if (isTag)
        _tagBoard(post, ordered)
      else if (isPhoto)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 15),
          child: _gallery(post, ordered),
        )
      else
        _captionBoard(post, ordered),
    ];
  }

  Widget _captionBoard(ConnectPost post, List<ConnectCaptionEntry> rows) {
    return Column(
      children: [
        for (final (index, entry) in rows.indexed) ...[
          if (index > 0) const SizedBox(height: 9),
          KeyedSubtree(
            key: _keyFor(entry.id),
            child: _CaptionEntryCard(
              entry: entry,
              closed: post.challengeClosed,
              photo: _photos[entry.userId],
              onVote: () => _vote(post, entry.id),
              onOpenPerson: () => _openPerson(entry.userId),
              onDelete: entry.isMine && !post.challengeClosed
                  ? () => _confirmDeleteEntry(context, entry, () async {
                      await widget.bloc?.deleteCaption(post.id);
                    }, noun: 'caption')
                  : null,
            ),
          ),
        ],
      ],
    );
  }

  Widget _tagBoard(ConnectPost post, List<ConnectCaptionEntry> rows) {
    final top = rows.fold<int>(0, (best, row) => math.max(best, row.points));
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Column(
        children: [
          for (final (index, row) in rows.indexed) ...[
            if (index > 0) const SizedBox(height: 12),
            KeyedSubtree(
              key: _keyFor(row.userId),
              child: _TagBoardBar(
                row: row,
                color: _tagBarColor(row, post),
                maxPoints: top,
                suffix: row.userId == post.myTaggedUserId
                    ? '(You tagged)'
                    : (row.isMine ? '(You)' : ''),
                photo: _photos[row.userId],
                onOpenPerson: () => _openPerson(row.userId),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _gallery(ConnectPost post, List<ConnectCaptionEntry> rows) {
    final cards = [
      for (final entry in rows)
        KeyedSubtree(
          key: _keyFor(entry.id),
          child: _GalleryEntryCard(
            entry: entry,
            closed: post.challengeClosed,
            onVote: () => _vote(post, entry.id),
            onOpenPerson: () => _openPerson(entry.userId),
            onDelete: entry.isMine && !post.challengeClosed
                ? () => _confirmDeleteEntry(context, entry, () async {
                    await widget.bloc?.deleteCaption(post.id);
                  }, noun: 'photo')
                : null,
          ),
        ),
    ];
    return Column(
      children: [
        for (var i = 0; i < cards.length; i += 2) ...[
          if (i > 0) const SizedBox(height: 13),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: cards[i]),
                const SizedBox(width: 11),
                Expanded(
                  child: i + 1 < cards.length
                      ? cards[i + 1]
                      : const SizedBox.shrink(),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// The violet hero at the top of the sheet (node 3261:25849): the live pill,
/// the contest's name, what a vote is worth, and — for a caption contest —
/// its picture, tilted at the right.
class _SheetHero extends StatelessWidget {
  const _SheetHero({required this.post});

  final ConnectPost post;

  @override
  Widget build(BuildContext context) {
    final isCaption = post.type == ConnectPostType.captionChallenge;
    final isPhoto = post.type == ConnectPostType.photoStoryChallenge;
    final title = _bodyString(post, 'title');
    final task = _bodyString(post, 'task');
    final question = _bodyString(post, 'question');
    final mediaUrl = _bodyString(post, 'mediaUrl');
    final points = _pointsPerVote(post);
    final column = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        _SheetLivePill(closed: post.challengeClosed),
        const SizedBox(height: 8),
        if (isPhoto)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              task.isNotEmpty
                  ? task
                  : (title.isEmpty ? 'Caught red handed' : title),
              style: const TextStyle(
                fontFamily: _soraFont,
                fontSize: 20,
                height: 1.26,
                fontWeight: FontWeight.w600,
                letterSpacing: -0.16,
                color: _EngagementColors.onCard,
              ),
            ),
          )
        else
          SizedBox(
            width: isCaption ? 130 : null,
            child: Text(
              title.isEmpty
                  ? (isCaption ? 'Caption this!' : 'Most Likely')
                  : title,
              maxLines: isCaption ? 3 : 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 26,
                height: 28 / 26,
                fontWeight: FontWeight.w700,
                color: Colors.white,
              ),
            ),
          ),
        if (post.type == ConnectPostType.mostLikely) ...[
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              question.isNotEmpty
                  ? question
                  : 'Nominate the teammate who fits this tag',
              style: const TextStyle(
                fontFamily: _soraFont,
                fontSize: 12,
                height: 16.2 / 12,
                fontWeight: FontWeight.w600,
                letterSpacing: -0.16,
                color: _EngagementColors.onCard,
              ),
            ),
          ),
        ],
        const SizedBox(height: 8),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SvgPicture.asset(
              '$_engagementIcons/zap.svg',
              width: 14,
              height: 14,
            ),
            const SizedBox(width: 4),
            Text(
              '$points pts per vote',
              style: const TextStyle(
                fontSize: 11,
                height: 16 / 11,
                fontWeight: FontWeight.w600,
                color: _sheetPurple,
              ),
            ),
          ],
        ),
      ],
    );
    return Container(
      width: double.infinity,
      constraints: BoxConstraints(minHeight: isCaption ? 149 : 0),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: const Color(0xFFA387F7),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Stack(
        children: [
          if (isCaption)
            Positioned(
              left: 149,
              top: 7,
              width: 190,
              height: 142,
              child: Center(
                child: Transform.rotate(
                  angle: 5 * math.pi / 180,
                  child: Container(
                    width: 178,
                    height: 131,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(color: Colors.white, width: 6),
                    ),
                    child: mediaUrl.isEmpty
                        ? const ColoredBox(color: Color(0xFFF2F2F5))
                        : Image(
                            image: _remoteImage(mediaUrl),
                            fit: BoxFit.cover,
                          ),
                  ),
                ),
              ),
            ),
          Padding(
            padding: isCaption
                ? const EdgeInsets.fromLTRB(16, 22, 16, 16)
                : const EdgeInsets.all(16),
            child: column,
          ),
        ],
      ),
    );
  }
}

/// The small lime "• Live" pill on the sheet's hero (node 3261:25851).
class _SheetLivePill extends StatelessWidget {
  const _SheetLivePill({required this.closed});

  final bool closed;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 19,
      padding: const EdgeInsets.fromLTRB(6, 2, 6, 0),
      decoration: BoxDecoration(
        color: closed ? Colors.white : const Color(0xFFC3FA24),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        closed ? '• Closed' : '• Live',
        style: TextStyle(
          fontSize: 9,
          height: 12 / 9,
          fontWeight: FontWeight.w700,
          color: closed
              ? _EngagementColors.inkTertiary
              : const Color(0xFF3D531A),
        ),
      ),
    );
  }
}

/// A solid circle with an initial — the sheet's small faces (node 3261:25870).
class _InitialDot extends StatelessWidget {
  const _InitialDot({required this.userId, required this.initials});

  final String userId;
  final String initials;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 23,
      height: 23,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: _avatarColorFor(userId),
        shape: BoxShape.circle,
      ),
      child: Text(
        initials.isEmpty ? '?' : initials.characters.first,
        style: const TextStyle(fontSize: 11, color: Colors.white),
      ),
    );
  }
}

/// "Most voted | Most recent" (node 3261:25892; 3327:21072 in the gallery).
class _SortTabs extends StatelessWidget {
  const _SortTabs({
    required this.order,
    required this.onChanged,
    this.gallery = false,
  });

  final _EntriesOrder order;
  final ValueChanged<_EntriesOrder> onChanged;
  final bool gallery;

  @override
  Widget build(BuildContext context) {
    Widget tab(_EntriesOrder value, String icon, String label) {
      final selected = order == value;
      final ink = gallery ? _galleryInk : _sheetInk;
      final muted = gallery ? _galleryMuted : _sheetMuted;
      return Expanded(
        child: GestureDetector(
          onTap: () => onChanged(value),
          behavior: HitTestBehavior.opaque,
          child: Container(
            decoration: BoxDecoration(
              color: selected ? Colors.white : Colors.transparent,
              borderRadius: BorderRadius.circular(9),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                SvgPicture.asset(
                  '$_engagementIcons/$icon',
                  width: gallery ? 14 : 15,
                  height: gallery ? 14 : 15,
                ),
                SizedBox(width: gallery ? 7 : 6),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: selected || !gallery
                        ? FontWeight.w600
                        : FontWeight.w500,
                    color: selected ? ink : muted,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Container(
      height: gallery ? 46 : 42,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: gallery ? const Color(0xFFF1EBF9) : const Color(0xFFF0EBFA),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          tab(
            _EntriesOrder.mostVoted,
            gallery ? 'flame_small.svg' : 'flame.svg',
            'Most voted',
          ),
          const SizedBox(width: 4),
          tab(
            _EntriesOrder.mostRecent,
            gallery ? 'clock_small.svg' : 'clock.svg',
            'Most recent',
          ),
        ],
      ),
    );
  }
}

/// The vote button on an entry, in each of its states (node 3464:63112):
/// lime "vote", purple once it holds your vote, outlined with the tally on
/// your own entry.
class _EntryVoteButton extends StatelessWidget {
  const _EntryVoteButton({
    required this.entry,
    required this.closed,
    required this.onVote,
    this.onDelete,
  });

  final ConnectCaptionEntry entry;
  final bool closed;
  final VoidCallback onVote;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final count = Text(
      '${entry.votes}',
      style: TextStyle(
        fontSize: 14,
        height: 15 / 14,
        fontWeight: FontWeight.w700,
        color: entry.votedByViewer ? Colors.white : _sheetPurple,
      ),
    );
    final votes = Text(
      entry.votes == 1 ? 'vote' : 'votes',
      style: TextStyle(
        fontSize: 10,
        height: 11 / 10,
        color: entry.votedByViewer ? Colors.white : _sheetPurple,
      ),
    );
    final Widget body;
    final BoxDecoration decoration;
    if (entry.votedByViewer) {
      // Tapping it again takes the vote back.
      decoration = BoxDecoration(
        color: _sheetPurple,
        borderRadius: BorderRadius.circular(12),
      );
      body = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SvgPicture.asset(
            '$_engagementIcons/check_white.svg',
            width: 15,
            height: 15,
          ),
          const SizedBox(height: 1),
          count,
          const SizedBox(height: 1),
          votes,
        ],
      );
    } else if (entry.isMine || closed) {
      decoration = BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: entry.isMine
              ? _EngagementColors.liveGreen
              : _EngagementColors.border,
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x24000000),
            blurRadius: 2,
            offset: Offset(0, 2),
          ),
        ],
      );
      body = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SvgPicture.asset(
            '$_engagementIcons/arrow_up_purple.svg',
            width: 15,
            height: 15,
          ),
          const SizedBox(height: 1),
          count,
          const SizedBox(height: 1),
          votes,
        ],
      );
    } else {
      decoration = BoxDecoration(
        color: const Color(0xFFBDFA19),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _EngagementColors.border),
        boxShadow: const [
          BoxShadow(
            color: Color(0x26000000),
            blurRadius: 2,
            offset: Offset(0, 2),
          ),
        ],
      );
      body = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SvgPicture.asset(
            '$_engagementIcons/arrow_up_thick_green.svg',
            width: 18,
            height: 18,
          ),
          const SizedBox(height: 1),
          const Text(
            'vote',
            style: TextStyle(
              fontFamily: _soraFont,
              fontSize: 10,
              height: 11 / 10,
              color: _EngagementColors.ctaText,
            ),
          ),
        ],
      );
    }
    final canTap = !entry.isMine && !closed;
    return Semantics(
      button: canTap,
      label: entry.votedByViewer ? 'Voted' : 'Vote',
      child: GestureDetector(
        onTap: canTap ? onVote : null,
        // Holding your own entry offers to take it down.
        onLongPress: onDelete,
        child: Container(
          width: 49,
          height: 54,
          padding: const EdgeInsets.only(top: 5, bottom: 4),
          alignment: Alignment.center,
          decoration: decoration,
          child: body,
        ),
      ),
    );
  }
}

/// One caption on the board (node 3464:63087): the podium in three shades of
/// violet, your vote outlined in lime, your own entry in green.
class _CaptionEntryCard extends StatelessWidget {
  const _CaptionEntryCard({
    required this.entry,
    required this.closed,
    required this.onVote,
    required this.onOpenPerson,
    this.photo,
    this.onDelete,
  });

  final ConnectCaptionEntry entry;
  final bool closed;
  final String? photo;
  final VoidCallback onVote;
  final VoidCallback onOpenPerson;
  final VoidCallback? onDelete;

  static const _medals = {
    1: '$_engagementIcons/medal_1.svg',
    2: '$_engagementIcons/medal_2.svg',
    3: '$_engagementIcons/medal_3.svg',
  };

  @override
  Widget build(BuildContext context) {
    final rank = entry.rank ?? 0;
    final medal = _medals[rank];
    final leader = rank == 1 && !entry.isMine;
    final Color fill;
    Color? border;
    if (entry.isMine) {
      fill = const Color(0xFFC9F8B5);
      border = _EngagementColors.liveGreen;
    } else if (rank == 1) {
      fill = const Color(0xFF8051D7);
    } else if (rank == 2) {
      fill = const Color(0xFFC7B2EE);
    } else if (rank == 3) {
      fill = const Color(0xFFEAE1F8);
    } else {
      fill = Colors.white;
      border = entry.votedByViewer
          ? const Color(0xFFC3FA24)
          : const Color(0xFF9197A2);
    }
    final ink = leader ? Colors.white : _sheetInk;
    // Figma draws the outline inside the card without taking room; Flutter
    // adds it to the padding, so it comes back off here.
    final stroke = border == null ? 0.0 : 1.0;
    return Container(
      constraints: BoxConstraints(minHeight: medal != null ? 120 : 144),
      padding: EdgeInsets.fromLTRB(
        16 - stroke,
        (medal != null ? 15 : 17) - stroke,
        13 - stroke,
        12 - stroke,
      ),
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(18),
        border: border == null ? null : Border.all(color: border),
        boxShadow: leader
            ? const [BoxShadow(color: Color(0x264F3485), offset: Offset(0, 4))]
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            height: 24,
            child: Row(
              children: [
                if (medal != null)
                  SvgPicture.asset(medal, width: 20, height: 20)
                else
                  SizedBox(
                    width: 16,
                    height: 28,
                    child: Center(
                      child: Text(
                        '$rank',
                        style: const TextStyle(
                          fontSize: 13,
                          height: 14 / 13,
                          fontWeight: FontWeight.w600,
                          color: _sheetInk,
                        ),
                      ),
                    ),
                  ),
                const SizedBox(width: 9),
                GestureDetector(
                  onTap: onOpenPerson,
                  child: photo == null
                      ? _InitialDot(
                          userId: entry.userId,
                          initials: entry.initials,
                        )
                      : ClipOval(
                          child: Image(
                            image: _remoteImage(photo!),
                            width: 23,
                            height: 23,
                            fit: BoxFit.cover,
                          ),
                        ),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: GestureDetector(
                    onTap: onOpenPerson,
                    behavior: HitTestBehavior.opaque,
                    child: Text(
                      entry.isMine ? '${entry.name} (you)' : entry.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: ink,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 9),
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: '${entry.points}',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const TextSpan(
                        text: ' pts',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                  style: TextStyle(color: leader ? Colors.white : _sheetPurple),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          // The podium's captions sit at the foot of the card, level with the
          // vote button; below it they hang 16 under the name in a taller
          // card (nodes 3464:63109, 3464:63183).
          Row(
            crossAxisAlignment: medal != null
                ? CrossAxisAlignment.end
                : CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (medal == null) const SizedBox(height: 16),
                    Text(
                      entry.text,
                      style: TextStyle(
                        fontSize: 14,
                        height: 20 / 14,
                        fontWeight: FontWeight.w500,
                        color: ink,
                      ),
                    ),
                    if (entry.votedByViewer) ...[
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          SvgPicture.asset(
                            '$_engagementIcons/check_grey.svg',
                            width: 14,
                            height: 14,
                          ),
                          const SizedBox(width: 6),
                          const Text(
                            'Your vote',
                            style: TextStyle(fontSize: 10, color: _sheetMuted),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 13),
              _EntryVoteButton(
                entry: entry,
                closed: closed,
                onVote: onVote,
                onDelete: onDelete,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// One person on the Most Likely board (node 3572:27632): their name inside
/// the bar, their face where it ends, their points at the right.
class _TagBoardBar extends StatelessWidget {
  const _TagBoardBar({
    required this.row,
    required this.color,
    required this.maxPoints,
    required this.suffix,
    required this.onOpenPerson,
    this.photo,
  });

  final ConnectCaptionEntry row;
  final Color color;
  final int maxPoints;
  final String suffix;
  final String? photo;
  final VoidCallback onOpenPerson;

  static const _nameStyle = TextStyle(
    fontFamily: _soraFont,
    fontSize: 16,
    height: 24 / 16,
    fontWeight: FontWeight.w700,
    color: Colors.white,
  );
  static const _suffixStyle = TextStyle(
    fontFamily: _soraFont,
    fontSize: 10,
    height: 24 / 10,
    fontWeight: FontWeight.w700,
    color: Colors.white,
  );

  @override
  Widget build(BuildContext context) {
    final firstName = row.name.split(' ').first;
    final name = TextSpan(
      children: [
        TextSpan(text: firstName, style: _nameStyle),
        if (suffix.isNotEmpty) TextSpan(text: ' $suffix', style: _suffixStyle),
      ],
    );
    final points = '${row.points}pt';
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final nameWidth = (TextPainter(
          text: name,
          textDirection: TextDirection.ltr,
          maxLines: 1,
        )..layout()).width;
        final pointsWidth = (TextPainter(
          text: TextSpan(text: points, style: _nameStyle),
          textDirection: TextDirection.ltr,
          maxLines: 1,
        )..layout()).width;
        // The leader's bar runs the full width; the rest run to about
        // five-eighths of it at the leader's score (node 3332:23582), never
        // shorter than their name and never into the points at the end.
        final leader = (row.rank ?? 0) == 1;
        final nameEnd = 16 + nameWidth + 8;
        final roomBeforePoints = width - 12 - pointsWidth - 8 - 33;
        final share = maxPoints == 0 ? 0.0 : row.points / maxPoints;
        final fill = leader
            ? width
            : math.min(
                math.max(nameEnd, width * 0.625 * share),
                roomBeforePoints,
              );
        final avatarLeft = leader ? nameEnd : fill;
        return GestureDetector(
          onTap: onOpenPerson,
          child: Container(
            height: 47.996,
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: color, width: 1.114),
            ),
            child: Stack(
              children: [
                Positioned(
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: fill,
                  child: ColoredBox(color: color),
                ),
                Positioned(
                  left: 16,
                  top: 0,
                  bottom: 0,
                  child: Center(child: Text.rich(name, maxLines: 1)),
                ),
                Positioned(
                  left: avatarLeft,
                  top: 6,
                  child: _EngagementAvatar(
                    userId: row.userId,
                    initials: row.initials,
                    photoUrl: photo,
                    size: 33,
                    fontSize: 13,
                  ),
                ),
                Positioned(
                  right: 12,
                  top: 0,
                  bottom: 0,
                  child: Center(
                    child: Text(
                      points,
                      style: _nameStyle.copyWith(
                        color: leader ? Colors.white : color,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// One photo in the gallery (node 3327:21085): the picture with its rank
/// badge, who took it, its points and the vote button.
class _GalleryEntryCard extends StatelessWidget {
  const _GalleryEntryCard({
    required this.entry,
    required this.closed,
    required this.onVote,
    required this.onOpenPerson,
    this.onDelete,
  });

  final ConnectCaptionEntry entry;
  final bool closed;
  final VoidCallback onVote;
  final VoidCallback onOpenPerson;
  final VoidCallback? onDelete;

  static const _medals = {
    1: '$_engagementIcons/medal_1.svg',
    2: '$_engagementIcons/medal_2.svg',
    3: '$_engagementIcons/medal_3.svg',
  };

  @override
  Widget build(BuildContext context) {
    final rank = entry.rank ?? 0;
    final leader = rank == 1;
    final medal = _medals[rank];
    final fill = switch (rank) {
      1 => const Color(0xFF8051D7),
      2 => const Color(0xFFCBB5EC),
      3 => const Color(0xFFE9E0F6),
      _ => Colors.white,
    };
    final ink = leader ? Colors.white : _galleryInk;
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(
          color: leader ? const Color(0xFF8051D7) : const Color(0xFFEAE5F0),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            height: 176,
            child: Stack(
              fit: StackFit.expand,
              children: [
                (entry.photoUrl ?? '').isEmpty
                    ? const ColoredBox(color: Color(0xFFF2F2F5))
                    : Image(
                        image: _remoteImage(entry.photoUrl!),
                        fit: BoxFit.cover,
                      ),
                Positioned(
                  left: 7,
                  top: 8,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 9,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: leader ? const Color(0xFFC3FA24) : Colors.white,
                      borderRadius: BorderRadius.circular(100),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (medal != null) ...[
                          SvgPicture.asset(medal, width: 20, height: 20),
                          const SizedBox(width: 4),
                        ],
                        Text(
                          '#$rank',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: leader
                                ? const Color(0xFF405317)
                                : _galleryInk,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (entry.votedByViewer)
                  Positioned(
                    right: 7.5,
                    bottom: 6,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFC3FA24),
                        borderRadius: BorderRadius.circular(100),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          SvgPicture.asset(
                            '$_engagementIcons/check_olive.svg',
                            width: 12,
                            height: 12,
                          ),
                          const SizedBox(width: 4),
                          const Text(
                            'Your vote',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF405317),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 12),
            child: Row(
              children: [
                Expanded(
                  child: GestureDetector(
                    onTap: onOpenPerson,
                    behavior: HitTestBehavior.opaque,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Your own photo is told by its outlined tally, not
                        // a "(you)" the narrow card would cut off (node
                        // 3327:20846).
                        Text(
                          entry.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: ink,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            SvgPicture.asset(
                              leader
                                  ? '$_engagementIcons/zap_white.svg'
                                  : '$_engagementIcons/zap_dark.svg',
                              width: 12,
                              height: 12,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              '${entry.points} pts',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w500,
                                color: ink,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                _EntryVoteButton(
                  entry: entry,
                  closed: closed,
                  onVote: onVote,
                  onDelete: onDelete,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _GalleryOverviewCard extends StatelessWidget {
  const _GalleryOverviewCard({
    required this.label,
    required this.icon,
    required this.thumb,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  final String label;
  final String icon;
  final Widget thumb;
  final Widget title;
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        height: 92,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(17),
          border: Border.all(color: const Color(0xFFEAE5F0)),
          boxShadow: const [
            BoxShadow(
              color: Color(0x61D8CFEA),
              blurRadius: 1,
              offset: Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    label,
                    style: const TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w500,
                      color: _galleryMuted,
                    ),
                  ),
                ),
                SvgPicture.asset(
                  '$_engagementIcons/$icon',
                  width: 13,
                  height: 13,
                ),
              ],
            ),
            const SizedBox(height: 15),
            Row(
              children: [
                thumb,
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      title,
                      const SizedBox(height: 4),
                      Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 10,
                          color: _galleryMuted,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _OverviewThumb extends StatelessWidget {
  const _OverviewThumb({required this.url});

  final String? url;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(6),
      child: SizedBox(
        width: 35,
        height: 35,
        child: (url ?? '').isEmpty
            ? const ColoredBox(color: Color(0xFFF1EBF9))
            : Image(image: _remoteImage(url!), fit: BoxFit.cover),
      ),
    );
  }
}

class _OverviewPlaceholder extends StatelessWidget {
  const _OverviewPlaceholder({required this.icon, required this.size});

  final String icon;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: const Color(0xFFF1EBF9),
        borderRadius: BorderRadius.circular(8),
      ),
      child: SvgPicture.asset(
        '$_engagementIcons/$icon',
        width: size,
        height: size,
      ),
    );
  }
}

class _EntriesEmpty extends StatelessWidget {
  const _EntriesEmpty();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const SizedBox(height: 24),
        Image.asset(
          '$_engagementIcons/trophy.png',
          width: 108,
          height: 108,
          fit: BoxFit.contain,
        ),
        const SizedBox(height: 16),
        const Text(
          'Be the first one to play',
          style: TextStyle(
            fontFamily: _soraFont,
            fontSize: 14,
            height: 16.2 / 14,
            fontWeight: FontWeight.w600,
            letterSpacing: -0.16,
            color: Color(0xFFD67E33),
          ),
        ),
        const SizedBox(height: 24),
      ],
    );
  }
}

/// "‹  Entries" across the top of the page, as the contest page's own header
/// is drawn: a round back button and the title beside it.
class _EntriesTopBar extends StatelessWidget {
  const _EntriesTopBar({required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 60,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(
          bottom: BorderSide(color: Color(0xFFF3F4F6), width: 1.114),
        ),
      ),
      child: Row(
        children: [
          Semantics(
            button: true,
            label: 'Back',
            child: GestureDetector(
              onTap: onBack,
              behavior: HitTestBehavior.opaque,
              child: Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                  color: Color(0xFFF7F7F9),
                  shape: BoxShape.circle,
                ),
                child: SvgPicture.asset(
                  'assets/icons/chevron_left_small.svg',
                  width: 17.983,
                  height: 17.983,
                ),
              ),
            ),
          ),
          const SizedBox(width: 14),
          const Text(
            'Entries',
            style: TextStyle(
              fontFamily: _soraFont,
              fontSize: 16,
              height: 24 / 16,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.2,
              color: _EngagementColors.ink,
            ),
          ),
        ],
      ),
    );
  }
}
