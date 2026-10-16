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

/// The podium's medals, on the board and on an entry opened full screen.
const _entryMedals = {
  1: '$_engagementIcons/medal_1.svg',
  2: '$_engagementIcons/medal_2.svg',
  3: '$_engagementIcons/medal_3.svg',
};

/// How long the page's own motion takes: an entry opening full screen and
/// putting itself away, the pinned button coming and going, a jump to an
/// entry on the board.
const _entryViewMotion = Duration(milliseconds: 280);

/// How long a Most Likely bar takes to fill as the page opens, or to slide
/// to its new length when a tag moves the board. Figma has no motion for
/// it (3929:53104); the length is the app's own.
const _barFillMotion = Duration(milliseconds: 600);

/// The contest as the feed has it now, or as it was opened where the feed no
/// longer holds it.
ConnectPost _currentContest(ConnectState state, ConnectPost opened) =>
    state.posts.where((item) => item.id == opened.id).firstOrNull ?? opened;

/// The board as the viewer's vote leaves it. A vote shows on the contest's
/// entries the moment it is cast, while the ranked copy of them waits for
/// the server; each row takes its votes, points and the viewer's mark from
/// its entry, so the page — and an entry open full screen — moves with the
/// tap rather than a beat behind it. The places stay the server's. Most
/// Likely ranks the people named, not entries, and has nothing to carry.
List<ConnectCaptionEntry> _shownBoard(ConnectPost post) {
  final board = post.captionLeaderboard;
  if (post.type == ConnectPostType.mostLikely) return board;
  final live = {for (final entry in post.captionEntries) entry.id: entry};
  return [
    for (final row in board)
      if (live[row.id] case final entry?)
        ConnectCaptionEntry(
          id: row.id,
          userId: row.userId,
          name: row.name,
          initials: row.initials,
          text: row.text,
          photoUrl: row.photoUrl,
          votes: entry.votes,
          points: entry.points,
          votedByViewer: entry.votedByViewer,
          isMine: row.isMine,
          rank: row.rank,
          createdAt: row.createdAt,
        )
      else
        row,
  ];
}

/// The entry the viewer's vote is on, as [_shownBoard] has it.
String? _shownVote(ConnectPost post) => post.captionEntries.isEmpty
    ? post.myCaptionVoteEntryId
    : post.myContestVote;

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
        viewerUserId: scope?.viewerUserId ?? '',
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
    this.viewerUserId = '',
  });

  /// Null only where there is no live feed behind the sheet; it then shows
  /// the post as it was opened and takes no votes.
  final ConnectBloc? bloc;
  final ConnectPost initialPost;
  final List<ConnectTeammate> people;
  final ValueChanged<String>? onOpenPerson;

  /// Who is looking, so the Most Likely vote picker can leave them out —
  /// the server refuses a tag on yourself.
  final String viewerUserId;

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
      duration: _entryViewMotion,
    );
  }

  /// Votes on their way. The server flips a vote, so a second tap on the
  /// same entry before the first is answered would take it straight back.
  final _voting = <String>{};

  Future<void> _vote(ConnectPost post, String entryId) async {
    final bloc = widget.bloc;
    if (bloc == null || _contestClosed(post) || !_voting.add(entryId)) return;
    try {
      await bloc.voteCaption(post.id, entryId);
    } finally {
      _voting.remove(entryId);
    }
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

  // ---- Most Likely: who tagged whom, and changing your own tag -------------

  /// Everyone the viewer could tag: the directory, less the viewer.
  List<ConnectTeammate> get _taggable => [
    for (final person in widget.people)
      if (person.userId.isNotEmpty && person.userId != widget.viewerUserId)
        person,
  ];

  /// The viewer's tag can be moved here: the contest is live, there is a
  /// bloc to send it through and a directory to pick from.
  bool _canRetag(ConnectPost post) =>
      widget.bloc != null && !_contestClosed(post) && _taggable.isNotEmpty;

  /// A change of tag on its way; a second pick waits for it.
  bool _retagging = false;

  /// "YOUR VOTE ▾": the colleagues to tag, the current one ticked.
  Future<void> _openVotePicker(ConnectPost post) async {
    final picked = await _showPeopleSheet<String>(
      context,
      builder: (_) => _VotePickerSheet(
        people: _taggable,
        currentUserId: post.myTaggedUserId,
        photos: _photos,
      ),
    );
    if (picked == null || !mounted) return;
    await _retag(post, picked);
  }

  /// Moves the viewer's tag to [userId] the way the card does it: the old
  /// tag is taken back, then the new one goes in. If taking it back fails
  /// nothing more is sent, and the bloc says why.
  Future<void> _retag(ConnectPost post, String userId) async {
    final bloc = widget.bloc;
    if (bloc == null || _retagging || _contestClosed(post)) return;
    if (userId == post.myTaggedUserId) return;
    setState(() => _retagging = true);
    try {
      if (post.myTaggedUserId != null) {
        await bloc.deleteCaption(post.id);
        if (_currentContest(bloc.state, post).myTaggedUserId != null) return;
      }
      await bloc.submitCaption(post.id, '', taggedUserId: userId);
    } finally {
      if (mounted) setState(() => _retagging = false);
    }
  }

  /// "View all" under a row: everyone who tagged that person.
  void _openTaggers(ConnectCaptionEntry row) {
    _showPeopleSheet<void>(
      context,
      builder: (sheetContext) => _TagBySheet(
        taggers: row.taggedBy,
        photos: _photos,
        onOpenPerson: widget.onOpenPerson == null
            ? null
            : (userId) {
                Navigator.of(sheetContext).pop();
                _openPerson(userId);
              },
      ),
    );
  }

  /// Opens [entry] full screen as its whole card, the entries either side of
  /// it a swipe away in the order the page has them now.
  void _openEntry(
    ConnectPost post,
    List<ConnectCaptionEntry> ordered,
    ConnectCaptionEntry entry,
  ) {
    final index = ordered.indexWhere((row) => row.id == entry.id);
    if (index < 0) return;
    Navigator.of(context).push<void>(
      PageRouteBuilder<void>(
        opaque: false,
        transitionDuration: _entryViewMotion,
        reverseTransitionDuration: _entryViewMotion,
        pageBuilder: (context, animation, _) => _EntryFullView(
          bloc: widget.bloc,
          initialPost: post,
          entries: ordered,
          initialIndex: index,
          photos: _photos,
          animation: animation,
          onVote: _vote,
          onOpenPerson: _openPerson,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bloc = widget.bloc;
    if (bloc == null) return _sheet(widget.initialPost);
    return StreamBuilder<ConnectState>(
      stream: bloc.stream,
      initialData: bloc.state,
      builder: (context, snapshot) => _sheet(
        _currentContest(snapshot.data ?? bloc.state, widget.initialPost),
      ),
    );
  }

  Widget _sheet(ConnectPost post) {
    final canAdd = _canAddEntry(post);
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            if (post.type == ConnectPostType.mostLikely)
              _EntriesHeader(onBack: () => Navigator.of(context).maybePop())
            else
              _EntriesTopBar(onBack: () => Navigator.of(context).maybePop()),
            Expanded(
              child: Builder(
                builder: (context) {
                  final safeBottom = MediaQuery.paddingOf(context).bottom;
                  return Stack(
                    children: [
                      ListView(
                        // With the button pinned over the foot of the page,
                        // the last entry can still scroll up clear of it.
                        padding: EdgeInsets.fromLTRB(
                          20,
                          0,
                          20,
                          24 +
                              safeBottom +
                              (canAdd ? _PinnedEntryCta.height : 0),
                        ),
                        children: [
                          _SheetHero(post: post),
                          if (post.type == ConnectPostType.photoStoryChallenge)
                            _galleryOverview(post)
                          else
                            _voteOverview(post),
                          ..._rankings(post),
                        ],
                      ),
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        child: AnimatedSwitcher(
                          duration: _entryViewMotion,
                          switchInCurve: Curves.easeOutCubic,
                          switchOutCurve: Curves.easeInCubic,
                          transitionBuilder: (child, animation) =>
                              FadeTransition(
                                opacity: animation,
                                child: SlideTransition(
                                  position: Tween(
                                    begin: const Offset(0, 0.3),
                                    end: Offset.zero,
                                  ).animate(animation),
                                  child: child,
                                ),
                              ),
                          child: canAdd
                              ? _PinnedEntryCta(
                                  key: const ValueKey('entries-pinned-cta'),
                                  label: _ctaLabel(post),
                                  onTap: _addEntry,
                                )
                              : const SizedBox.shrink(),
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  bool _canAddEntry(ConnectPost post) {
    if (_contestClosed(post) || widget.onAddEntry == null) return false;
    if (post.type == ConnectPostType.mostLikely) {
      return post.myTaggedUserId == null;
    }
    return post.myCaptionEntryId == null;
  }

  String _ctaLabel(ConnectPost post) => switch (post.type) {
    ConnectPostType.mostLikely => 'Nominate',
    ConnectPostType.photoStoryChallenge => 'Add your photo',
    _ => 'Add your answer',
  };

  // ---- Your vote / your rank -------------------------------------------

  /// "YOUR VOTE | YOUR RANK" for captions and tags (node 3261:25863).
  Widget _voteOverview(ConnectPost post) {
    final isTag = post.type == ConnectPostType.mostLikely;
    final board = _shownBoard(post);
    // Who the viewer backed: the caption they voted for, or the colleague
    // they tagged.
    final votedId = isTag ? post.myTaggedUserId : _shownVote(post);
    final voted = votedId == null
        ? null
        : (isTag ? board : post.captionEntries)
              .where((row) => (isTag ? row.userId : row.id) == votedId)
              .firstOrNull;
    // A tag on someone the board does not show (the viewer has blocked
    // them) still has a name in the directory.
    final votedPerson = isTag && voted == null && votedId != null
        ? widget.people.where((p) => p.userId == votedId).firstOrNull
        : null;
    final votedName = voted?.name ?? votedPerson?.name;
    // Where the viewer stands: their own caption's place, or their own row
    // among the people named.
    final mine = board.where((row) => row.isMine).firstOrNull;
    final VoidCallback? onVoteTap;
    if (isTag && _canRetag(post)) {
      // A dropdown while the contest is live: pick someone, or someone else.
      onVoteTap = () => _openVotePicker(post);
    } else if (voted != null) {
      onVoteTap = () => _reveal(isTag ? voted.userId : voted.id);
    } else {
      onVoteTap = _canAddEntry(post) && isTag ? _addEntry : null;
    }
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
                onTap: onVoteTap,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 16, 9, 13),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _overviewLabel('circle_check.svg', 14, 'YOUR VOTE'),
                      const SizedBox(height: 7),
                      Row(
                        children: [
                          if (voted != null || votedPerson != null) ...[
                            _InitialDot(
                              userId: voted?.userId ?? votedPerson!.userId,
                              initials:
                                  voted?.initials ?? votedPerson!.initials,
                            ),
                            const SizedBox(width: 7),
                          ],
                          Flexible(
                            child: Text(
                              votedName ?? 'Vote for someone',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontFamily: _soraFont,
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: votedName == null
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
                    : (_canAddEntry(post) ? _addEntry : null),
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
                          if (mine == null && _canAddEntry(post))
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
                          // the board only once someone tags you. Until then,
                          // while you have not nominated anyone, the design
                          // asks for your entry — your nomination.
                          isTag && !_canAddEntry(post)
                              ? 'Not tagged yet'
                              : 'Submit your entry',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontFamily: _soraFont,
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
    final entries = _shownBoard(post);
    final votedId = _shownVote(post);
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
    final board = _shownBoard(post);
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
          _contestClosed(post)
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
              closed: _contestClosed(post),
              photo: _photos[entry.userId],
              onOpen: () => _openEntry(post, rows, entry),
              onVote: () => _vote(post, entry.id),
              onOpenPerson: () => _openPerson(entry.userId),
              onDelete: entry.isMine && !_contestClosed(post)
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

  /// The people named, each as a bar with who tagged them under it
  /// (PollInfo, node 3929:53327).
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
              child: Container(
                padding: const EdgeInsets.only(bottom: 8),
                decoration: const BoxDecoration(
                  border: Border(
                    bottom: BorderSide(color: _EngagementColors.border),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _TagBoardBar(
                      row: row,
                      color: _tagBarColor(row, post),
                      maxPoints: top,
                      suffix: row.userId == post.myTaggedUserId
                          ? '(You tagged)'
                          : (row.isMine ? '(You)' : ''),
                      photo: _photos[row.userId],
                      onOpenPerson: () => _openPerson(row.userId),
                    ),
                    if (row.taggedBy.isNotEmpty)
                      _TagByRow(
                        taggers: row.taggedBy,
                        onViewAll: () => _openTaggers(row),
                      ),
                  ],
                ),
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
            closed: _contestClosed(post),
            onOpen: () => _openEntry(post, rows, entry),
            onVote: () => _vote(post, entry.id),
            onOpenPerson: () => _openPerson(entry.userId),
            onDelete: entry.isMine && !_contestClosed(post)
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
        _SheetLivePill(closed: _contestClosed(post)),
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
                fontFamily: _soraFont,
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
                  // The icon takes the label's ink, so whichever order is
                  // chosen reads dark (node 3929:53315).
                  colorFilter: gallery
                      ? null
                      : ColorFilter.mode(
                          selected ? ink : muted,
                          BlendMode.srcIn,
                        ),
                ),
                SizedBox(width: gallery ? 7 : 6),
                Text(
                  label,
                  style: TextStyle(
                    fontFamily: gallery ? null : _soraFont,
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

/// A caption card's fill and outline: the podium in three shades of violet,
/// your vote outlined in lime, your own entry in green.
(Color, Color?) _captionCardColors(ConnectCaptionEntry entry) {
  if (entry.isMine) {
    return (const Color(0xFFC9F8B5), _EngagementColors.liveGreen);
  }
  return switch (entry.rank ?? 0) {
    1 => (const Color(0xFF8051D7), null),
    2 => (const Color(0xFFC7B2EE), null),
    3 => (const Color(0xFFEAE1F8), null),
    _ => (
      Colors.white,
      entry.votedByViewer ? const Color(0xFFC3FA24) : const Color(0xFF9197A2),
    ),
  };
}

/// One caption on the board (node 3464:63087): the podium in three shades of
/// violet, your vote outlined in lime, your own entry in green. A tap on it
/// opens it full screen; the face, the name and the vote button keep their
/// own taps.
class _CaptionEntryCard extends StatelessWidget {
  const _CaptionEntryCard({
    required this.entry,
    required this.closed,
    required this.onOpen,
    required this.onVote,
    required this.onOpenPerson,
    this.photo,
    this.onDelete,
  });

  final ConnectCaptionEntry entry;
  final bool closed;
  final String? photo;
  final VoidCallback onOpen;
  final VoidCallback onVote;
  final VoidCallback onOpenPerson;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final rank = entry.rank ?? 0;
    final medal = _entryMedals[rank];
    final leader = rank == 1 && !entry.isMine;
    final (fill, border) = _captionCardColors(entry);
    final ink = leader ? Colors.white : _sheetInk;
    // Figma draws the outline inside the card without taking room; Flutter
    // adds it to the padding, so it comes back off here.
    final stroke = border == null ? 0.0 : 1.0;
    return _PollPressable(
      onTap: onOpen,
      child: Container(
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
              ? const [
                  BoxShadow(color: Color(0x264F3485), offset: Offset(0, 4)),
                ]
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
                    style: TextStyle(
                      color: leader ? Colors.white : _sheetPurple,
                    ),
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
                              style: TextStyle(
                                fontSize: 10,
                                color: _sheetMuted,
                              ),
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
        // Measured against the top score, as on the feed card: the leader's
        // bar is full and every other is its share of the leader's (10 of 20
        // is half), so a tie is two full bars.
        final nameEnd = 16 + nameWidth + 8;
        final roomBeforePoints = width - 12 - pointsWidth - 8 - 33;
        final share = maxPoints == 0 ? 0.0 : row.points / maxPoints;
        final target = share.clamp(0.0, 1.0);
        // A fill too long to leave the face room before the points — the
        // leader's full bar — has the face just after the name (node
        // 3929:53335); every other face rides the fill's edge (3929:53363).
        final faceAfterName = width * target > roomBeforePoints;
        // Text is white where the fill is under it and takes the bar's colour
        // where it is not, split at the fill's edge: a fill ending mid-name
        // must not leave half the name the same colour as what is behind it.
        final pointsLeft = width - 12 - pointsWidth;
        // The fill grows in when the page opens and slides to its new length
        // when a tag moves the board; the face and the split ink go with it.
        return TweenAnimationBuilder<double>(
          tween: Tween(begin: 0, end: target),
          duration: _barFillMotion,
          curve: Curves.easeOutCubic,
          builder: (context, grown, _) {
            final fill = width * grown;
            // After the name while the fill has not reached past it, and never
            // into the points.
            final avatarLeft = math.min(
              faceAfterName ? nameEnd : math.max(fill, nameEnd),
              roomBeforePoints,
            );
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
                      child: ColoredBox(
                        key: ValueKey('tag-bar-fill-${row.userId}'),
                        color: color,
                      ),
                    ),
                    Positioned(
                      left: 16,
                      top: 0,
                      bottom: 0,
                      child: Center(
                        child: _SplitInk(
                          onFill: name,
                          offFill: TextSpan(
                            children: [
                              TextSpan(
                                text: firstName,
                                style: _nameStyle.copyWith(color: color),
                              ),
                              if (suffix.isNotEmpty)
                                TextSpan(
                                  text: ' $suffix',
                                  style: _suffixStyle.copyWith(color: color),
                                ),
                            ],
                          ),
                          splitAt: fill - 16,
                        ),
                      ),
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
                        child: _SplitInk(
                          onFill: TextSpan(text: points, style: _nameStyle),
                          offFill: TextSpan(
                            text: points,
                            style: _nameStyle.copyWith(color: color),
                          ),
                          splitAt: fill - pointsLeft,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }
}

/// One line of text in two inks: [onFill] up to [splitAt] (measured from the
/// text's left edge), [offFill] after it. The two spans must lay out alike.
class _SplitInk extends StatelessWidget {
  const _SplitInk({
    required this.onFill,
    required this.offFill,
    required this.splitAt,
  });

  final InlineSpan onFill;
  final InlineSpan offFill;
  final double splitAt;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Text.rich(offFill, maxLines: 1),
        ClipRect(
          clipper: _LeftOf(splitAt),
          child: Text.rich(onFill, maxLines: 1),
        ),
      ],
    );
  }
}

/// Keeps what lies left of [x].
class _LeftOf extends CustomClipper<Rect> {
  const _LeftOf(this.x);

  final double x;

  @override
  Rect getClip(Size size) =>
      Rect.fromLTRB(0, 0, x.clamp(0.0, size.width), size.height);

  @override
  bool shouldReclip(_LeftOf oldClipper) => oldClipper.x != x;
}

/// "Tag by:" under a person on the Most Likely board (node 3929:53337): the
/// faces of whoever tagged them, latest first — six at most, then a count of
/// the rest — and "View all", which lists them.
class _TagByRow extends StatelessWidget {
  const _TagByRow({required this.taggers, required this.onViewAll});

  final List<ConnectTagger> taggers;
  final VoidCallback onViewAll;

  static const _maxFaces = 6;
  static const double _face = 32;

  /// Each face tucks 7 under the next.
  static const double _step = _face - 7;

  static const _label = TextStyle(
    fontFamily: _soraFont,
    fontSize: 12,
    height: 18 / 12,
    color: Color(0xFF9197A2),
  );

  /// The faces' fills in the design's order; the rest take the last.
  static const _fills = [
    Color(0xFFF8D6C2),
    Color(0xFFCBE3C9),
    Color(0xFFDCCCEB),
  ];

  Widget _faceOf(String text, Color fill, {bool bold = false}) => Container(
    width: _face,
    height: _face,
    alignment: Alignment.center,
    decoration: BoxDecoration(color: fill, shape: BoxShape.circle),
    child: Text(
      text,
      maxLines: 1,
      style: TextStyle(
        fontFamily: _soraFont,
        fontSize: 10,
        fontWeight: bold ? FontWeight.w700 : FontWeight.w400,
        color: const Color(0xFF155844),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final shown = taggers.take(_maxFaces).toList();
    final more = taggers.length - shown.length;
    final faces = [
      for (final (index, tagger) in shown.indexed)
        _faceOf(
          tagger.initials.isEmpty ? '?' : tagger.initials,
          _fills[math.min(index, _fills.length - 1)],
        ),
      if (more > 0) _faceOf('+$more', const Color(0xFFCDE3E8), bold: true),
    ];
    return GestureDetector(
      key: const ValueKey('tag-by-row'),
      behavior: HitTestBehavior.opaque,
      onTap: onViewAll,
      child: Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Row(
          children: [
            const Text('Tag by:', style: _label),
            const SizedBox(width: 8),
            // Clipped, as drawn, so a narrow phone loses faces at the right
            // rather than pushing "View all" off the row.
            Expanded(
              child: SizedBox(
                height: _face,
                child: ClipRect(
                  child: Stack(
                    children: [
                      for (final (index, face) in faces.indexed)
                        Positioned(left: index * _step, top: 0, child: face),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            const Text('View all', style: _label),
          ],
        ),
      ),
    );
  }
}

/// Opens one of the Most Likely lists — who tagged someone, or whom to
/// tag — as a sheet over the page dimmed to 45% black (node 3929:53880).
Future<T?> _showPeopleSheet<T>(
  BuildContext context, {
  required WidgetBuilder builder,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    elevation: 0,
    barrierColor: const Color(0x73000000),
    builder: builder,
  );
}

/// The white sheet those lists come up in (node 3929:53881): rounded top,
/// a grab handle, the title, then the people, scrolling once they outgrow
/// most of the screen.
class _PeopleSheetFrame extends StatelessWidget {
  const _PeopleSheetFrame({
    super.key,
    required this.title,
    required this.children,
    this.header,
  });

  final String title;
  final Widget? header;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    return Align(
      alignment: Alignment.bottomCenter,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: 420,
          maxHeight: media.size.height * 0.85,
        ),
        padding: EdgeInsets.only(
          bottom: math.max(24, media.padding.bottom) + media.viewInsets.bottom,
        ),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          boxShadow: [
            BoxShadow(
              color: Color(0x1F000000),
              offset: Offset(0, -4),
              blurRadius: 16,
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 4),
              child: Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFFD1D5DB),
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Text(
                title,
                style: const TextStyle(
                  fontFamily: _soraFont,
                  fontSize: 16,
                  height: 22 / 16,
                  letterSpacing: 0.4,
                  color: _EngagementColors.ink,
                ),
              ),
            ),
            ?header,
            const SizedBox(height: 8),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                children: children,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One person in those lists (node 3929:53963): face, name and role line,
/// and at the right a 32-wide slot for whatever the list needs there.
class _PersonRow extends StatelessWidget {
  const _PersonRow({
    required this.userId,
    required this.name,
    required this.initials,
    required this.subtitle,
    this.photoUrl,
    this.trailing,
    this.onTap,
    this.last = false,
  });

  final String userId;
  final String name;
  final String initials;
  final String subtitle;
  final String? photoUrl;
  final Widget? trailing;
  final VoidCallback? onTap;

  /// The last row has no rule under it.
  final bool last;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 60),
        alignment: Alignment.centerLeft,
        padding: const EdgeInsets.symmetric(vertical: 7),
        decoration: last
            ? null
            : const BoxDecoration(
                border: Border(
                  bottom: BorderSide(
                    color: _EngagementColors.border,
                    width: 1.115,
                  ),
                ),
              ),
        child: Row(
          children: [
            _EngagementAvatar(
              userId: userId,
              initials: initials,
              photoUrl: photoUrl,
              size: 35.983,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontFamily: _soraFont,
                      fontSize: 13,
                      height: 19.5 / 13,
                      fontWeight: FontWeight.w600,
                      color: _EngagementColors.ink,
                    ),
                  ),
                  if (subtitle.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: _soraFont,
                        fontSize: 9,
                        height: 12.6 / 9,
                        color: Color(0xFF767676),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              width: 31.993,
              height: 31.993,
              child: trailing == null ? null : Center(child: trailing),
            ),
          ],
        ),
      ),
    );
  }
}

/// "Tag by" (node 3929:53531): everyone who tagged one person, latest
/// first. A tap on someone opens their profile, where the app can.
class _TagBySheet extends StatelessWidget {
  const _TagBySheet({
    required this.taggers,
    required this.photos,
    this.onOpenPerson,
  });

  final List<ConnectTagger> taggers;
  final Map<String, String> photos;
  final ValueChanged<String>? onOpenPerson;

  @override
  Widget build(BuildContext context) {
    final open = onOpenPerson;
    return _PeopleSheetFrame(
      key: const ValueKey('tag-by-sheet'),
      title: 'Tag by',
      children: [
        for (final (index, tagger) in taggers.indexed)
          _PersonRow(
            userId: tagger.userId,
            name: tagger.name,
            initials: tagger.initials,
            subtitle: tagger.roleLine,
            photoUrl: tagger.photoUrl ?? photos[tagger.userId],
            last: index == taggers.length - 1,
            onTap: open == null ? null : () => open(tagger.userId),
          ),
      ],
    );
  }
}

/// "YOUR VOTE ▾" opened: the colleagues the viewer can tag, in the Tag by
/// sheet's rows, the one they tagged ticked and at the top. Pops with the
/// id of whoever is picked.
class _VotePickerSheet extends StatefulWidget {
  const _VotePickerSheet({
    required this.people,
    required this.currentUserId,
    required this.photos,
  });

  final List<ConnectTeammate> people;
  final String? currentUserId;
  final Map<String, String> photos;

  @override
  State<_VotePickerSheet> createState() => _VotePickerSheetState();
}

class _VotePickerSheetState extends State<_VotePickerSheet> {
  final _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    _search.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final typed = _search.text.trim().toLowerCase();
    final current = widget.currentUserId;
    final people =
        [
              ...widget.people.where((p) => p.userId == current),
              ...widget.people.where((p) => p.userId != current),
            ]
            .where((p) => typed.isEmpty || p.name.toLowerCase().contains(typed))
            .toList();
    return _PeopleSheetFrame(
      key: const ValueKey('vote-picker-sheet'),
      title: current == null ? 'Vote for someone' : 'Change your vote',
      header: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        child: Container(
          height: 40,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: const Color(0xFFF7F7F9),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: _EngagementColors.border),
          ),
          child: Row(
            children: [
              SvgPicture.asset(
                'assets/icons/audience_search.svg',
                width: 16,
                height: 16,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  key: const ValueKey('vote-picker-search'),
                  controller: _search,
                  textInputAction: TextInputAction.search,
                  cursorColor: _sheetPurple,
                  style: const TextStyle(
                    fontFamily: _soraFont,
                    fontSize: 13,
                    color: _EngagementColors.ink,
                  ),
                  // Bare: the app's input theme would draw a second box.
                  decoration: const InputDecoration(
                    isCollapsed: true,
                    filled: false,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    contentPadding: EdgeInsets.zero,
                    hintText: 'Search name',
                    hintStyle: TextStyle(
                      fontFamily: _soraFont,
                      fontSize: 13,
                      color: Color(0xFF9197A2),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      children: [
        if (people.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 20),
            child: Text(
              'No one by that name',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: _soraFont,
                fontSize: 12,
                color: _sheetMuted,
              ),
            ),
          ),
        for (final (index, person) in people.indexed)
          _PersonRow(
            userId: person.userId,
            name: person.name,
            initials: person.initials,
            subtitle: person.department,
            photoUrl: person.photoUrl ?? widget.photos[person.userId],
            last: index == people.length - 1,
            trailing: person.userId == current
                ? SvgPicture.asset(
                    '$_engagementIcons/circle_check.svg',
                    width: 20,
                    height: 20,
                    colorFilter: const ColorFilter.mode(
                      _sheetPurple,
                      BlendMode.srcIn,
                    ),
                  )
                : null,
            onTap: () => Navigator.of(context).pop(person.userId),
          ),
      ],
    );
  }
}

/// A gallery tile's fill: the podium in three shades of violet, white after.
Color _galleryFill(int rank) => switch (rank) {
  1 => const Color(0xFF8051D7),
  2 => const Color(0xFFCBB5EC),
  3 => const Color(0xFFE9E0F6),
  _ => Colors.white,
};

/// The rank badge on a photo — lime with its medal for the leader, white
/// after. [scale] draws it larger on a photo open full screen.
class _GalleryRankPill extends StatelessWidget {
  const _GalleryRankPill({required this.rank, this.scale = 1});

  final int rank;
  final double scale;

  @override
  Widget build(BuildContext context) {
    final leader = rank == 1;
    final medal = _entryMedals[rank];
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 9 * scale, vertical: 6 * scale),
      decoration: BoxDecoration(
        color: leader ? const Color(0xFFC3FA24) : Colors.white,
        borderRadius: BorderRadius.circular(100),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (medal != null) ...[
            SvgPicture.asset(medal, width: 20 * scale, height: 20 * scale),
            SizedBox(width: 4 * scale),
          ],
          Text(
            '#$rank',
            style: TextStyle(
              fontSize: 12 * scale,
              fontWeight: FontWeight.w700,
              color: leader ? const Color(0xFF405317) : _galleryInk,
            ),
          ),
        ],
      ),
    );
  }
}

/// The lime "✓ Your vote" on the photo the viewer voted for.
class _GalleryVotedPill extends StatelessWidget {
  const _GalleryVotedPill({this.scale = 1});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 8 * scale, vertical: 5 * scale),
      decoration: BoxDecoration(
        color: const Color(0xFFC3FA24),
        borderRadius: BorderRadius.circular(100),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SvgPicture.asset(
            '$_engagementIcons/check_olive.svg',
            width: 12 * scale,
            height: 12 * scale,
          ),
          SizedBox(width: 4 * scale),
          Text(
            'Your vote',
            style: TextStyle(
              fontSize: 10 * scale,
              fontWeight: FontWeight.w700,
              color: const Color(0xFF405317),
            ),
          ),
        ],
      ),
    );
  }
}

/// One photo in the gallery (node 3327:21085): the picture with its rank
/// badge, who took it, its points and the vote button. A tap on it opens it
/// full screen; the name and the vote button keep their own taps.
class _GalleryEntryCard extends StatelessWidget {
  const _GalleryEntryCard({
    required this.entry,
    required this.closed,
    required this.onOpen,
    required this.onVote,
    required this.onOpenPerson,
    this.onDelete,
  });

  final ConnectCaptionEntry entry;
  final bool closed;
  final VoidCallback onOpen;
  final VoidCallback onVote;
  final VoidCallback onOpenPerson;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final rank = entry.rank ?? 0;
    final leader = rank == 1;
    final ink = leader ? Colors.white : _galleryInk;
    return _PollPressable(
      onTap: onOpen,
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: _galleryFill(rank),
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
                    child: _GalleryRankPill(rank: rank),
                  ),
                  if (entry.votedByViewer)
                    const Positioned(
                      right: 7.5,
                      bottom: 6,
                      child: _GalleryVotedPill(),
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

/// "Entries" over the Most Likely page (node 3939:54035): a grey band with a
/// round white back button at the left and the title centred between it and
/// a button-wide gap at the right.
class _EntriesHeader extends StatelessWidget {
  const _EntriesHeader({required this.onBack});

  final VoidCallback onBack;

  static const double _button = 39.988;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFFF7F7F9),
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Semantics(
            button: true,
            label: 'Back',
            child: GestureDetector(
              onTap: onBack,
              behavior: HitTestBehavior.opaque,
              child: Container(
                width: _button,
                height: _button,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: _EngagementColors.border,
                    width: 1.114,
                  ),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x1A000000),
                      offset: Offset(0, 1),
                      blurRadius: 1.5,
                    ),
                    BoxShadow(
                      color: Color(0x1A000000),
                      offset: Offset(0, 1),
                      blurRadius: 1,
                    ),
                  ],
                ),
                child: SvgPicture.asset(
                  'assets/icons/chevron_back.svg',
                  width: 19.985,
                  height: 19.985,
                ),
              ),
            ),
          ),
          const Expanded(
            child: Center(
              child: Text(
                'Entries',
                style: TextStyle(
                  fontFamily: _soraFont,
                  fontSize: 16,
                  height: 24 / 16,
                  fontWeight: FontWeight.w700,
                  color: _EngagementColors.ink,
                ),
              ),
            ),
          ),
          const SizedBox(width: _button),
        ],
      ),
    );
  }
}

/// The lime button held at the foot of the page while the viewer has not
/// entered and the contest is open (node 3327:23343): it stays put over the
/// entries as they scroll, which fade out under it on a white wash.
class _PinnedEntryCta extends StatelessWidget {
  const _PinnedEntryCta({super.key, required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  /// The button and the gap under it, above the safe area: what the list
  /// leaves clear at its foot so its last entry can scroll up past it.
  static const double height = _ctaHeight + _gapBelow;
  static const double _ctaHeight = 67;
  static const double _gapBelow = 12;

  @override
  Widget build(BuildContext context) {
    final safeBottom = MediaQuery.paddingOf(context).bottom;
    return Stack(
      children: [
        // The wash takes no taps: an entry showing through it can still be
        // reached.
        const Positioned.fill(
          child: IgnorePointer(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Color(0x00FFFFFF), Colors.white],
                  stops: [0, 0.45],
                ),
              ),
            ),
          ),
        ),
        Padding(
          padding: EdgeInsets.fromLTRB(20, 22, 20, _gapBelow + safeBottom),
          child: _EngagementCta(label: label, onTap: onTap),
        ),
      ],
    );
  }
}

// ---- One entry, full screen --------------------------------------------

/// How far down a swipe has to carry an entry, or how fast, to put it away.
const double _entryViewDismissDistance = 120;
const double _entryViewDismissVelocity = 700;

/// An entry opened from the page: its whole card, as large as the screen
/// allows, over the page dimmed in the contest's dark violet. A swipe across
/// goes to the next or the last entry in the order the page had them; the
/// cross, a tap on the dimmed backdrop or a swipe down puts it away. Votes go
/// the page's own way, so they show here and on the page at once.
class _EntryFullView extends StatefulWidget {
  const _EntryFullView({
    required this.bloc,
    required this.initialPost,
    required this.entries,
    required this.initialIndex,
    required this.photos,
    required this.animation,
    required this.onVote,
    required this.onOpenPerson,
  });

  /// Null where there is no live feed behind the page; the view then shows
  /// the contest as it was opened, as the page does.
  final ConnectBloc? bloc;
  final ConnectPost initialPost;

  /// The entries in the order the page showed them when one was tapped. A
  /// vote that reshuffles the board leaves the swipe order as it was.
  final List<ConnectCaptionEntry> entries;
  final int initialIndex;

  /// Faces from the directory, by person.
  final Map<String, String> photos;

  /// The route's own, which fades the backdrop and brings the card up.
  final Animation<double> animation;
  final Future<void> Function(ConnectPost post, String entryId) onVote;
  final ValueChanged<String> onOpenPerson;

  @override
  State<_EntryFullView> createState() => _EntryFullViewState();
}

class _EntryFullViewState extends State<_EntryFullView>
    with SingleTickerProviderStateMixin {
  late final PageController _pages = PageController(
    initialPage: widget.initialIndex,
  );
  late int _page = widget.initialIndex;

  /// Each entry as last seen, so one taken down while the view is open still
  /// has its card.
  late final Map<String, ConnectCaptionEntry> _known = {
    for (final entry in widget.entries) entry.id: entry,
  };

  /// Each entry's zoom, made as its page is built.
  final Map<String, TransformationController> _zooms = {};

  /// Zoomed in past whole, or two fingers down on the picture: either way
  /// the swipe across and the swipe down hold still, so a pan or a pinch
  /// never turns the page or puts the card away.
  bool _zoomed = false;
  bool _pinching = false;
  bool get _held => _zoomed || _pinching;

  TransformationController _zoomFor(String id) => _zooms.putIfAbsent(
    id,
    () => TransformationController()..addListener(_zoomChanged),
  );

  void _zoomChanged() {
    final zoomed = _zooms.values.any(
      (zoom) => zoom.value.getMaxScaleOnAxis() > _entryZoomWhole,
    );
    if (zoomed != _zoomed) setState(() => _zoomed = zoomed);
  }

  void _pinch(bool pinching) {
    if (pinching == _pinching) return;
    setState(() => _pinching = pinching);
    // A second finger mid swipe-down: the swipe is dropped, so the card
    // goes back to its place.
    if (pinching && _drag != 0 && !_closing) {
      _dragFrom = _drag;
      _settle.forward(from: 0);
    }
  }

  /// Another entry in view: every picture back to whole.
  void _turnedTo(int page) {
    for (final zoom in _zooms.values) {
      zoom.value = Matrix4.identity();
    }
    setState(() => _page = page);
  }

  /// How far a swipe down has carried the card, and the spring that takes
  /// it back when the swipe was not enough to put it away.
  double _drag = 0;
  double _dragFrom = 0;
  late final AnimationController _settle = AnimationController(
    vsync: this,
    duration: _entryViewMotion,
  )..addListener(_settleStep);
  bool _closing = false;

  void _settleStep() {
    setState(() {
      _drag = _dragFrom * (1 - Curves.easeOutCubic.transform(_settle.value));
    });
  }

  @override
  void dispose() {
    for (final zoom in _zooms.values) {
      zoom.dispose();
    }
    _settle.dispose();
    _pages.dispose();
    super.dispose();
  }

  void _close() {
    if (_closing) return;
    _closing = true;
    Navigator.of(context).pop();
  }

  void _dragStart(DragStartDetails details) => _settle.stop();

  void _dragUpdate(DragUpdateDetails details) {
    if (_closing) return;
    setState(() => _drag = math.max(0, _drag + details.delta.dy));
  }

  void _dragEnd(DragEndDetails details) {
    if (_closing) return;
    if (_drag > _entryViewDismissDistance ||
        (details.primaryVelocity ?? 0) > _entryViewDismissVelocity) {
      _close();
      return;
    }
    _dragFrom = _drag;
    _settle.forward(from: 0);
  }

  @override
  Widget build(BuildContext context) {
    final bloc = widget.bloc;
    if (bloc == null) return _view(widget.initialPost);
    return StreamBuilder<ConnectState>(
      stream: bloc.stream,
      initialData: bloc.state,
      builder: (context, snapshot) => _view(
        _currentContest(snapshot.data ?? bloc.state, widget.initialPost),
      ),
    );
  }

  Widget _view(ConnectPost post) {
    for (final row in _shownBoard(post)) {
      if (_known.containsKey(row.id)) _known[row.id] = row;
    }
    final closed = _contestClosed(post);
    final isPhoto = post.type == ConnectPostType.photoStoryChallenge;
    final count = widget.entries.length;
    // How far the swipe down has gone towards putting the card away.
    final away = (_drag / 400).clamp(0.0, 1.0);
    final still = MediaQuery.disableAnimationsOf(context);
    final title = isPhoto && _bodyString(post, 'task').isNotEmpty
        ? _bodyString(post, 'task')
        : _bodyString(post, 'title');

    final content = GestureDetector(
      // Anywhere the card is not is the dimmed backdrop.
      behavior: HitTestBehavior.opaque,
      onTap: _close,
      // The cross is the way out for a screen reader.
      excludeFromSemantics: true,
      onVerticalDragStart: _held ? null : _dragStart,
      onVerticalDragUpdate: _held ? null : _dragUpdate,
      onVerticalDragEnd: _held ? null : _dragEnd,
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 14, 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: _soraFont,
                        fontSize: 14,
                        height: 18 / 14,
                        fontWeight: FontWeight.w600,
                        letterSpacing: -0.16,
                        color: _EngagementColors.onCard,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  _EntryViewClose(onTap: _close),
                ],
              ),
            ),
            Expanded(
              child: Transform.translate(
                offset: Offset(0, _drag),
                child: Transform.scale(
                  scale: 1 - away * 0.08,
                  child: PageView.builder(
                    controller: _pages,
                    physics: _held
                        ? const NeverScrollableScrollPhysics()
                        : null,
                    itemCount: count,
                    onPageChanged: _turnedTo,
                    itemBuilder: (context, index) {
                      final entry = _known[widget.entries[index].id]!;
                      final photo = widget.photos[entry.userId];
                      void vote() => widget.onVote(post, entry.id);
                      void openPerson() => widget.onOpenPerson(entry.userId);
                      Widget zoom(Widget child) => _EntryZoom(
                        controller: _zoomFor(entry.id),
                        zoomed: _zoomed,
                        onPinch: _pinch,
                        child: child,
                      );
                      return Padding(
                        padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
                        child: Center(
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 440),
                            // A tap on the card stays on the card.
                            child: isPhoto
                                ? GestureDetector(
                                    onTap: () {},
                                    excludeFromSemantics: true,
                                    child: _PhotoEntryFull(
                                      entry: entry,
                                      closed: closed,
                                      photo: photo,
                                      onVote: vote,
                                      onOpenPerson: openPerson,
                                      zoom: zoom,
                                    ),
                                  )
                                : LayoutBuilder(
                                    // A long caption on a short phone
                                    // shrinks the whole card to fit rather
                                    // than running off the screen.
                                    builder: (context, box) => FittedBox(
                                      fit: BoxFit.scaleDown,
                                      child: SizedBox(
                                        width: box.maxWidth,
                                        child: GestureDetector(
                                          onTap: () {},
                                          excludeFromSemantics: true,
                                          child: _CaptionEntryFull(
                                            entry: entry,
                                            mediaUrl: _bodyString(
                                              post,
                                              'mediaUrl',
                                            ),
                                            closed: closed,
                                            photo: photo,
                                            onVote: vote,
                                            onOpenPerson: openPerson,
                                            zoom: zoom,
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
            ),
            if (count > 1)
              Padding(
                padding: const EdgeInsets.only(top: 4, bottom: 12),
                child: Opacity(
                  opacity: 1 - away,
                  child: _EngagementPager(
                    count: count,
                    page: _page.clamp(0, count - 1),
                    labelColor: _EngagementColors.onCard,
                  ),
                ),
              )
            else
              const SizedBox(height: 16),
          ],
        ),
      ),
    );

    // The route has no page of its own under it; the Material gives its
    // words the app's text style.
    return Material(
      key: const ValueKey('entry-view'),
      type: MaterialType.transparency,
      child: AnimatedBuilder(
        animation: widget.animation,
        child: content,
        builder: (context, child) {
          final shown = Curves.easeOutCubic.transform(widget.animation.value);
          return Stack(
            fit: StackFit.expand,
            children: [
              // The page dimmed in the contest's dark violet and softened,
              // so none of it reads through beside the card. A swipe down
              // lifts both as the card goes.
              IgnorePointer(
                child: BackdropFilter(
                  filterConfig: ImageFilterConfig.blur(
                    sigmaX: 10 * shown * (1 - away),
                    sigmaY: 10 * shown * (1 - away),
                  ),
                  child: ColoredBox(
                    color: _EngagementColors.band.withValues(
                      alpha: 0.88 * shown * (1 - away * 0.6),
                    ),
                  ),
                ),
              ),
              Opacity(
                opacity: shown,
                child: Transform.scale(
                  scale: still ? 1 : 0.94 + 0.06 * shown,
                  child: child,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// The round cross that puts an entry away.
class _EntryViewClose extends StatelessWidget {
  const _EntryViewClose({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Close',
      child: GestureDetector(
        key: const ValueKey('entry-view-close'),
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Container(
          width: 40,
          height: 40,
          alignment: Alignment.center,
          decoration: const BoxDecoration(
            color: Color(0x29FFFFFF),
            shape: BoxShape.circle,
          ),
          child: SvgPicture.asset(
            '$_engagementIcons/cross.svg',
            width: 16,
            height: 16,
            colorFilter: const ColorFilter.mode(Colors.white, BlendMode.srcIn),
          ),
        ),
      ),
    );
  }
}

/// The soft drop under a card opened full screen, lifting it off the dark.
const _entryViewShadow = [
  BoxShadow(color: Color(0x59000000), blurRadius: 28, offset: Offset(0, 14)),
];

/// A caption opened full screen: its card on the board, larger — the medal,
/// the name and the points across the top — with the caption riding over
/// the contest's picture the way the contest card shows it, and the vote
/// button at its foot.
class _CaptionEntryFull extends StatelessWidget {
  const _CaptionEntryFull({
    required this.entry,
    required this.mediaUrl,
    required this.closed,
    required this.photo,
    required this.onVote,
    required this.onOpenPerson,
    required this.zoom,
  });

  final ConnectCaptionEntry entry;
  final String mediaUrl;
  final bool closed;
  final String? photo;
  final VoidCallback onVote;
  final VoidCallback onOpenPerson;

  /// Makes the picture and its caption zoom as one.
  final _EntryZoomWrap zoom;

  @override
  Widget build(BuildContext context) {
    final rank = entry.rank ?? 0;
    final medal = _entryMedals[rank];
    final leader = rank == 1 && !entry.isMine;
    final (fill, border) = _captionCardColors(entry);
    final ink = leader ? Colors.white : _sheetInk;
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 18, 16, 16),
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(22),
        border: border == null ? null : Border.all(color: border),
        boxShadow: _entryViewShadow,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              if (medal != null)
                SvgPicture.asset(medal, width: 26, height: 26)
              else
                Text(
                  '#$rank',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: ink,
                  ),
                ),
              const SizedBox(width: 10),
              Expanded(
                child: GestureDetector(
                  onTap: onOpenPerson,
                  behavior: HitTestBehavior.opaque,
                  child: Text(
                    entry.isMine ? '${entry.name} (you)' : entry.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: ink,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: '${entry.points}',
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const TextSpan(
                      text: ' pts',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
                style: TextStyle(color: leader ? Colors.white : _sheetPurple),
              ),
            ],
          ),
          const SizedBox(height: 14),
          zoom(
            // Room inside the zoom for the frame's tilted corners and the
            // bubble's shadow, which reach past the picture's own box.
            Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 6),
              child: _CaptionOverPicture(
                mediaUrl: mediaUrl,
                entry: entry,
                photo: photo,
                onOpenPerson: onOpenPerson,
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: entry.votedByViewer
                    ? Row(
                        children: [
                          SvgPicture.asset(
                            '$_engagementIcons/check_grey.svg',
                            width: 16,
                            height: 16,
                          ),
                          const SizedBox(width: 6),
                          const Text(
                            'Your vote',
                            style: TextStyle(fontSize: 12, color: _sheetMuted),
                          ),
                        ],
                      )
                    : const SizedBox.shrink(),
              ),
              const SizedBox(width: 13),
              _EntryVoteButton(entry: entry, closed: closed, onVote: onVote),
            ],
          ),
        ],
      ),
    );
  }
}

/// A caption over its contest's picture, as the contest card draws them
/// (nodes 3248:23532, 3684:41643): the picture tilted in its thick white
/// frame, and the caption riding up over its foot in the pink speech bubble
/// on its hard dark shadow, the entrant's face beside it. Drawn to the width
/// it is given; the bubble grows to hold the whole caption, where the card's
/// keeps to three lines.
class _CaptionOverPicture extends StatelessWidget {
  const _CaptionOverPicture({
    required this.mediaUrl,
    required this.entry,
    required this.photo,
    required this.onOpenPerson,
  });

  final String mediaUrl;
  final ConnectCaptionEntry entry;
  final String? photo;
  final VoidCallback onOpenPerson;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        // The card's well is 308 wide; the picture scales with it.
        final scale = constraints.maxWidth / 308;
        final pictureHeight = 221.163 * scale;
        return Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              height: pictureHeight,
              child: Center(
                child: Transform.rotate(
                  angle: -4.37 * math.pi / 180,
                  child: Container(
                    width: (272 + 12) * scale,
                    height: (201 + 12) * scale,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(18 * scale),
                      border: Border.all(color: Colors.white, width: 6 * scale),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x1F160D2C),
                          blurRadius: 10,
                          offset: Offset(0, 4),
                        ),
                      ],
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(12 * scale),
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
            ),
            Padding(
              // The bubbles ride 46 up over the picture (its -46 margin).
              padding: EdgeInsets.only(top: pictureHeight - 46 * scale),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    // Level with the bubble's tail.
                    padding: const EdgeInsets.only(
                      top: _CaptionBubbleBorder.tailY - 24,
                    ),
                    child: GestureDetector(
                      onTap: onOpenPerson,
                      child: _EngagementAvatar(
                        userId: entry.userId,
                        initials: entry.initials,
                        photoUrl: photo,
                        size: 48,
                        borderColor: _EngagementColors.border,
                        fontSize: 18,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(child: _CaptionBubble(entry: entry)),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

/// The caption in its pink speech bubble on the hard dark shadow, at any
/// length (node 3684:41645).
class _CaptionBubble extends StatelessWidget {
  const _CaptionBubble({required this.entry});

  final ConnectCaptionEntry entry;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const ShapeDecoration(
        color: Color(0xFFFFF0ED),
        shape: _CaptionBubbleBorder(),
        // Solid, 4 straight down, following the tail and all.
        shadows: [
          BoxShadow(color: _EngagementColors.band, offset: Offset(0, 4)),
        ],
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 80),
        child: Align(
          alignment: AlignmentDirectional.centerStart,
          heightFactor: 1,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              _CaptionBubbleBorder.tail + 18,
              14,
              16,
              14,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (entry.isMine) ...[
                  const Text(
                    'YOU',
                    style: TextStyle(
                      fontFamily: _soraFont,
                      fontSize: 11,
                      height: 16.2 / 11,
                      fontWeight: FontWeight.w600,
                      letterSpacing: -0.16,
                      color: _EngagementColors.you,
                    ),
                  ),
                  const SizedBox(height: 4),
                ],
                Text(
                  '“${entry.text}',
                  style: const TextStyle(
                    fontFamily: _soraFont,
                    fontSize: 16,
                    height: 22 / 16,
                    fontWeight: FontWeight.w600,
                    letterSpacing: -0.16,
                    color: _EngagementColors.ink,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The caption bubble's outline from caption_bubble.svg, as a shape that
/// grows with its words: corners of 8, the tail out of its left side
/// [tailY] down, and a 1 pink rule round the inside.
class _CaptionBubbleBorder extends ShapeBorder {
  const _CaptionBubbleBorder();

  /// How far the tail reaches out of the bubble's left side.
  static const double tail = 17.01;

  /// Where the tail's point sits, from the top: the middle of the shortest
  /// bubble, level with the face beside it.
  static const double tailY = 40;

  static const double _radius = 8;
  static const _rule = Color(0xFFFBDCFF);

  @override
  EdgeInsetsGeometry get dimensions => const EdgeInsets.only(left: tail);

  @override
  Path getInnerPath(Rect rect, {TextDirection? textDirection}) =>
      getOuterPath(rect.deflate(1), textDirection: textDirection);

  @override
  Path getOuterPath(Rect rect, {TextDirection? textDirection}) {
    final left = rect.left;
    final body = left + tail;
    final top = rect.top;
    final right = rect.right;
    final bottom = rect.bottom;
    final y = top + tailY;
    const corner = Radius.circular(_radius);
    // The tail's curves, measured from its point in the design's path.
    return Path()
      ..moveTo(body + _radius, top)
      ..lineTo(right - _radius, top)
      ..arcToPoint(Offset(right, top + _radius), radius: corner)
      ..lineTo(right, bottom - _radius)
      ..arcToPoint(Offset(right - _radius, bottom), radius: corner)
      ..lineTo(body + _radius, bottom)
      ..arcToPoint(Offset(body, bottom - _radius), radius: corner)
      ..lineTo(body, y + 13.07)
      ..cubicTo(body, y + 9.68, body - 2.141, y + 6.655, body - 5.342, y + 5.53)
      ..lineTo(left + 1.335, y + 1.888)
      ..cubicTo(
        left - 0.445,
        y + 1.26,
        left - 0.445,
        y - 1.258,
        left + 1.335,
        y - 1.885,
      )
      ..lineTo(body - 5.342, y - 5.526)
      ..cubicTo(body - 2.141, y - 6.654, body, y - 9.678, body, y - 13.07)
      ..lineTo(body, top + _radius)
      ..arcToPoint(Offset(body + _radius, top), radius: corner)
      ..close();
  }

  @override
  void paint(Canvas canvas, Rect rect, {TextDirection? textDirection}) {
    // A 2 stroke clipped to the shape leaves the design's 1 inside it.
    final outline = getOuterPath(rect);
    canvas
      ..save()
      ..clipPath(outline)
      ..drawPath(
        outline,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = _rule,
      )
      ..restore();
  }

  @override
  ShapeBorder scale(double t) => this;
}

/// A photo opened full screen: its tile in the gallery, larger — the whole
/// picture, nothing cropped, with its rank and the viewer's vote on it, then
/// who took it, its points and the vote button.
class _PhotoEntryFull extends StatelessWidget {
  const _PhotoEntryFull({
    required this.entry,
    required this.closed,
    required this.photo,
    required this.onVote,
    required this.onOpenPerson,
    required this.zoom,
  });

  final ConnectCaptionEntry entry;
  final bool closed;
  final String? photo;
  final VoidCallback onVote;
  final VoidCallback onOpenPerson;

  /// Makes the picture zoom; its badges stay put over it.
  final _EntryZoomWrap zoom;

  @override
  Widget build(BuildContext context) {
    final rank = entry.rank ?? 0;
    final leader = rank == 1;
    final ink = leader ? Colors.white : _galleryInk;
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: _galleryFill(rank),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: leader ? const Color(0xFF8051D7) : const Color(0xFFEAE5F0),
        ),
        boxShadow: _entryViewShadow,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Flexible(
            child: _EntryPhotoBox(
              url: entry.photoUrl,
              zoom: zoom,
              // The bands either side of a picture not the box's shape.
              backdrop: leader
                  ? const Color(0xFF6B42C2)
                  : const Color(0xFFF1EBF9),
              children: [
                Positioned(
                  left: 12,
                  top: 12,
                  child: _GalleryRankPill(rank: rank, scale: 1.25),
                ),
                if (entry.votedByViewer)
                  const Positioned(
                    right: 12,
                    bottom: 12,
                    child: _GalleryVotedPill(scale: 1.25),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 14, 14),
            child: Row(
              children: [
                Expanded(
                  child: GestureDetector(
                    onTap: onOpenPerson,
                    behavior: HitTestBehavior.opaque,
                    child: Row(
                      children: [
                        _EngagementAvatar(
                          userId: entry.userId,
                          initials: entry.initials,
                          photoUrl: photo,
                          size: 36,
                          fontSize: 14,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                entry.isMine
                                    ? '${entry.name} (you)'
                                    : entry.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w600,
                                  color: ink,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Row(
                                children: [
                                  SvgPicture.asset(
                                    leader
                                        ? '$_engagementIcons/zap_white.svg'
                                        : '$_engagementIcons/zap_dark.svg',
                                    width: 14,
                                    height: 14,
                                  ),
                                  const SizedBox(width: 4),
                                  Text(
                                    '${entry.points} pts',
                                    style: TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w500,
                                      color: ink,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                _EntryVoteButton(entry: entry, closed: closed, onVote: onVote),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A photo entry's picture at its own shape, as large as the room allows:
/// the box takes the picture's proportions once it has loaded (a portrait
/// frame until then), and fits the picture inside whole, on [backdrop],
/// where the room is not that shape.
class _EntryPhotoBox extends StatefulWidget {
  const _EntryPhotoBox({
    required this.url,
    required this.backdrop,
    required this.zoom,
    this.children = const [],
  });

  final String? url;
  final Color backdrop;
  final _EntryZoomWrap zoom;

  /// Laid over the picture: its badges.
  final List<Widget> children;

  @override
  State<_EntryPhotoBox> createState() => _EntryPhotoBoxState();
}

class _EntryPhotoBoxState extends State<_EntryPhotoBox> {
  ImageStream? _stream;
  ImageStreamListener? _listener;
  String _resolved = '';

  /// Width over height, once the picture has told us.
  double? _ratio;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _resolve();
  }

  @override
  void didUpdateWidget(_EntryPhotoBox old) {
    super.didUpdateWidget(old);
    if (old.url != widget.url) _resolve();
  }

  void _resolve() {
    final url = widget.url ?? '';
    if (url == _resolved) return;
    _stopListening();
    _resolved = url;
    _ratio = null;
    if (url.isEmpty) return;
    final listener = ImageStreamListener((info, _) {
      final image = info.image;
      final ratio = image.width / image.height;
      info.dispose();
      if (!mounted || !ratio.isFinite || ratio <= 0) return;
      setState(() => _ratio = ratio);
    }, onError: (_, _) {});
    _listener = listener;
    _stream = _remoteImage(url).resolve(createLocalImageConfiguration(context))
      ..addListener(listener);
  }

  void _stopListening() {
    final listener = _listener;
    if (listener != null) _stream?.removeListener(listener);
    _stream = null;
    _listener = null;
  }

  @override
  void dispose() {
    _stopListening();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final url = widget.url ?? '';
    return AnimatedSize(
      duration: _entryViewMotion,
      curve: Curves.easeOutCubic,
      alignment: Alignment.topCenter,
      child: AspectRatio(
        aspectRatio: _ratio ?? 4 / 5,
        child: Stack(
          fit: StackFit.expand,
          children: [
            ColoredBox(color: widget.backdrop),
            widget.zoom(
              url.isEmpty
                  ? const SizedBox.expand()
                  : Image(
                      image: _remoteImage(url),
                      fit: BoxFit.contain,
                      errorBuilder: (_, _, _) => const SizedBox.shrink(),
                    ),
            ),
            ...widget.children,
          ],
        ),
      ),
    );
  }
}

/// Wraps the part of an entry that zooms.
typedef _EntryZoomWrap = Widget Function(Widget child);

/// A zoom past this counts as zoomed in; a pinch let go short of it goes
/// back to whole.
const double _entryZoomWhole = 1.05;

/// Pinch and double-tap zoom on an entry open full screen: two fingers zoom
/// it up to 4x and one finger pans it while zoomed; a double tap goes to 2x
/// at the tap and back to whole. [onPinch] says when two fingers are down,
/// so the page can hold its swipes before the zoom has even begun.
class _EntryZoom extends StatefulWidget {
  const _EntryZoom({
    required this.controller,
    required this.zoomed,
    required this.onPinch,
    required this.child,
  });

  final TransformationController controller;

  /// Zoomed in past whole: one finger pans the picture rather than leaving
  /// the swipe to the page.
  final bool zoomed;
  final ValueChanged<bool> onPinch;
  final Widget child;

  @override
  State<_EntryZoom> createState() => _EntryZoomState();
}

class _EntryZoomState extends State<_EntryZoom>
    with SingleTickerProviderStateMixin {
  int _pointers = 0;
  Offset _tapAt = Offset.zero;

  /// The double tap's glide, and a pinch let go short of zoomed settling
  /// back to whole.
  late final AnimationController _glide = AnimationController(
    vsync: this,
    duration: _entryViewMotion,
  )..addListener(_glideStep);
  Matrix4Tween? _glideTween;

  void _glideStep() {
    final tween = _glideTween;
    if (tween == null) return;
    widget.controller.value = tween.transform(
      Curves.easeOutCubic.transform(_glide.value),
    );
  }

  void _glideTo(Matrix4 target) {
    _glideTween = Matrix4Tween(
      begin: widget.controller.value.clone(),
      end: target,
    );
    _glide.forward(from: 0);
  }

  void _doubleTap() {
    if (widget.controller.value.getMaxScaleOnAxis() > _entryZoomWhole) {
      _glideTo(Matrix4.identity());
      return;
    }
    // Twice the size, with the point tapped held where it was.
    _glideTo(
      Matrix4.identity()
        ..translateByDouble(-_tapAt.dx, -_tapAt.dy, 0, 1)
        ..scaleByDouble(2, 2, 1, 1),
    );
  }

  void _settleIfWhole(ScaleEndDetails details) {
    final matrix = widget.controller.value;
    if (matrix.getMaxScaleOnAxis() <= _entryZoomWhole &&
        matrix != Matrix4.identity()) {
      _glideTo(Matrix4.identity());
    }
  }

  void _count(int change) {
    final before = _pointers >= 2;
    _pointers = math.max(0, _pointers + change);
    final after = _pointers >= 2;
    if (before != after) widget.onPinch(after);
  }

  @override
  void dispose() {
    _glide.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerDown: (_) {
        _glide.stop();
        _count(1);
      },
      onPointerUp: (_) => _count(-1),
      onPointerCancel: (_) => _count(-1),
      child: GestureDetector(
        onDoubleTapDown: (details) => _tapAt = details.localPosition,
        onDoubleTap: _doubleTap,
        excludeFromSemantics: true,
        child: InteractiveViewer(
          transformationController: widget.controller,
          minScale: 1,
          maxScale: 4,
          panEnabled: widget.zoomed,
          onInteractionEnd: _settleIfWhole,
          child: widget.child,
        ),
      ),
    );
  }
}
