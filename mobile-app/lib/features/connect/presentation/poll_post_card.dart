part of 'connect_feed_screen.dart';

// The poll card (instance 3572:27926, component 2028:51565): the author row,
// the POLL pill, the question, the options — two to a row with their
// pictures when they have them — the tally, the like and comment bar, the
// two latest comments and the comment box, all on one padded column.

const _pollInk = Color(0xFF222222);
const _pollInkSecondary = Color(0xFF484848);
const _pollIcons = Color(0xFF9197A2);
const _pollBorder = Color(0xFFEBEBEB);
const _pollSurface = Color(0xFFF7F7F9);
const _pollBrand = Color(0xFF0571A6);

/// How long a vote takes to settle: bars grow, shares count, the pick lights.
const _pollMotion = Duration(milliseconds: 380);

/// A number that counts up to its new value instead of jumping to it: a share, or a vote count.
class _PollPercent extends StatelessWidget {
  const _PollPercent({
    required this.value,
    required this.style,
    this.votes = false,
    this.countIn = true,
  });

  final int value;
  final TextStyle style;

  /// Shown as "3 votes" instead of "3%".
  final bool votes;

  /// Whether it counts up from nothing when it first shows; otherwise it
  /// starts at [value] and moves only when that changes.
  final bool countIn;

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
    tween: Tween(begin: countIn ? 0 : value.toDouble(), end: value.toDouble()),
    duration: _pollMotion,
    curve: Curves.easeOutCubic,
    builder: (context, shown, _) {
      final n = shown.round();
      return Text(
        votes ? '$n vote${value == 1 ? '' : 's'}' : '$n%',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: style,
      );
    },
  );
}

/// How many votes an option has, set small and muted under its share.
class _PollOptionVotes extends StatelessWidget {
  const _PollOptionVotes({required this.votes});

  final int votes;

  @override
  Widget build(BuildContext context) => Text(
    '$votes vote${votes == 1 ? '' : 's'}',
    maxLines: 1,
    overflow: TextOverflow.ellipsis,
    style: const TextStyle(
      fontFamily: _soraFont,
      fontSize: 12,
      height: 18 / 12,
      fontWeight: FontWeight.w500,
      color: _pollIcons,
    ),
  );
}

/// An option that gives under the finger, so a tap is felt before the vote lands.
class _PollPressable extends StatefulWidget {
  const _PollPressable({super.key, required this.onTap, required this.child});

  final VoidCallback onTap;
  final Widget child;

  @override
  State<_PollPressable> createState() => _PollPressableState();
}

class _PollPressableState extends State<_PollPressable> {
  bool _down = false;

  void _set(bool down) {
    if (_down != down) setState(() => _down = down);
  }

  @override
  Widget build(BuildContext context) => GestureDetector(
    behavior: HitTestBehavior.opaque,
    onTapDown: (_) => _set(true),
    onTapCancel: () => _set(false),
    onTapUp: (_) => _set(false),
    // Two fingers lifting the picture out to zoom are not a vote, even when
    // the first of them lands and lifts within a tap.
    onTap: () {
      if (_PinchToZoom.active.value) return;
      widget.onTap();
    },
    child: AnimatedScale(
      scale: _down ? 0.97 : 1,
      duration: const Duration(milliseconds: 110),
      curve: Curves.easeOut,
      child: widget.child,
    ),
  );
}

class _PollPostCard extends StatelessWidget {
  const _PollPostCard({
    required this.post,
    required this.bloc,
    required this.busy,
    required this.canManage,
    required this.commentController,
    required this.onAction,
    required this.onEdit,
    required this.onDelete,
    required this.onLike,
    required this.onComment,
    required this.onOpenComments,
    required this.viewerInitials,
    required this.viewerPhotoUrl,
    this.mentions,
  });

  final ConnectPost post;

  /// Where [post] comes from, for a picture opened from it to follow.
  final ConnectBloc bloc;
  final bool busy;
  final bool canManage;

  /// The "@" tags in [commentController].
  final _CommentMentions? mentions;
  final TextEditingController commentController;
  final Future<void> Function({String? optionId}) onAction;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onLike;
  final VoidCallback onComment;
  final VoidCallback onOpenComments;
  final String viewerInitials;
  final String viewerPhotoUrl;

  @override
  Widget build(BuildContext context) {
    final options = post.pollOptions;
    final withImages = options.any((o) => (o.imageUrl ?? '').isNotEmpty);
    return Container(
      padding: const EdgeInsets.all(21),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0x80EBEBEB), width: 1.114),
        boxShadow: const [
          BoxShadow(
            color: Color(0x08000000),
            blurRadius: 6,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The author row is 317.09 wide, 2.24 past the content (node
          // 2028:51566), which puts the dots that much nearer the edge.
          _Overhang(
            extra: 2.235,
            child: _PollAuthorRow(
              post: post,
              canManage: canManage,
              onEdit: onEdit,
              onDelete: onDelete,
            ),
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (_showsLeadershipBadge(post))
                  const _LeadershipBadge(inPoll: true),
                const _PollBadge(),
              ],
            ),
          ),
          const SizedBox(height: 12),
          // The design sets the question 318 wide, a little past the card's
          // 314.85 of content, and wraps it there (node 2028:51596).
          _Overhang(
            extra: 3.15,
            child: Text(
              _bodyString(post, 'title'),
              style: const TextStyle(
                fontFamily: _soraFont,
                fontSize: 20,
                height: 24 / 20,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.4,
                color: _pollInk,
              ),
            ),
          ),
          const SizedBox(height: 12),
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: withImages
                ? _PollOptionGrid(post: post, bloc: bloc, onAction: onAction)
                : _PollOptionBars(post: post, onAction: onAction),
          ),
          const SizedBox(height: 12),
          // A poll takes votes only: no likes or comments under it.
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Row(
              children: [
                Text(
                  '${post.totalVotes} total vote${post.totalVotes == 1 ? '' : 's'}',
                  style: const TextStyle(
                    fontFamily: _soraFont,
                    fontSize: 14,
                    height: 21 / 14,
                    fontWeight: FontWeight.w500,
                    color: _pollIcons,
                  ),
                ),
                const Spacer(),
                if (busy)
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: _pollBrand,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The poster's face and name (both open their profile), the audience pill,
/// their role and when they posted (node 2028:51566).
class _PollAuthorRow extends StatelessWidget {
  const _PollAuthorRow({
    required this.post,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  final ConnectPost post;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  static const _meta = TextStyle(
    fontFamily: _soraFont,
    fontSize: 14,
    height: 21 / 14,
    fontWeight: FontWeight.w400,
    letterSpacing: -0.16,
    color: _pollIcons,
  );

  @override
  Widget build(BuildContext context) {
    final author = post.author;
    final audience = post.audience.label;
    return Row(
      children: [
        _PersonTap(
          userId: author.userId,
          child: _EngagementAvatar(
            userId: author.userId,
            initials: author.initials,
            photoUrl: author.photoUrl,
            size: 47.996,
            fontSize: 18,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Flexible(
                    child: _PersonTap(
                      userId: author.userId,
                      child: Text(
                        author.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: _soraFont,
                          fontSize: 16,
                          height: 24 / 16,
                          fontWeight: FontWeight.w600,
                          letterSpacing: -0.16,
                          color: _pollInk,
                        ),
                      ),
                    ),
                  ),
                  if (audience.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Container(
                      // A custom list's name can run to 40 characters.
                      constraints: const BoxConstraints(maxWidth: 140),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: _pollBorder, width: 1.114),
                      ),
                      child: Text(
                        audience,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: _soraFont,
                          fontSize: 12,
                          height: 16.2 / 12,
                          fontWeight: FontWeight.w400,
                          letterSpacing: -0.16,
                          color: _pollInk,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Row(
                  children: [
                    if (author.designation.isNotEmpty) ...[
                      Flexible(
                        child: Text(
                          author.designation,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: _meta,
                        ),
                      ),
                      const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 6),
                        child: Text('•', style: _meta),
                      ),
                    ],
                    Text(_relativeTime(post.publishedAt), style: _meta),
                  ],
                ),
              ),
            ],
          ),
        ),
        _PostMenuButton(
          canManage: canManage,
          onEdit: onEdit,
          onDelete: onDelete,
          icon: SvgPicture.asset(
            '$_engagementIcons/dots_menu_grey.svg',
            width: 19.985,
            height: 19.985,
          ),
        ),
      ],
    );
  }
}

/// The POLL pill (node 2028:51589).
class _PollBadge extends StatelessWidget {
  const _PollBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: BoxDecoration(
        color: _pollSurface,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: _pollBorder, width: 1.114),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Image.asset(
            'assets/icons/post_type_poll.png',
            width: 30,
            height: 20,
            fit: BoxFit.cover,
          ),
          const SizedBox(width: 10),
          const Text(
            'POLL',
            style: TextStyle(
              fontFamily: _soraFont,
              fontSize: 12,
              height: 18 / 12,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.3,
              color: _pollInkSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

/// Picture options, two to a row (section 4610:23636, "Poll updated"): each
/// option is its picture, 152 tall, darkened toward the bottom with its name
/// in white on it. A tap on a picture does not vote — it opens the picture
/// in [_PollOptionViewer], and the vote is cast from in there. Once the
/// viewer has voted each picture carries its share beside its name, and
/// their pick is outlined in brand blue with its words in light blue (node
/// 4604:23303). The picture being looked at is outlined too while its viewer
/// is up (node 4607:23534).
class _PollOptionGrid extends StatefulWidget {
  const _PollOptionGrid({
    required this.post,
    required this.bloc,
    required this.onAction,
  });

  final ConnectPost post;

  /// Where [post] comes from, for an open viewer to follow.
  final ConnectBloc bloc;
  final Future<void> Function({String? optionId}) onAction;

  @override
  State<_PollOptionGrid> createState() => _PollOptionGridState();
}

class _PollOptionGridState extends State<_PollOptionGrid> {
  /// The option whose viewer is up, if any.
  String? _openId;

  Future<void> _open(ConnectPollOption option) async {
    setState(() => _openId = option.id);
    await showDialog<void>(
      context: context,
      barrierColor: const Color(0x76000000),
      barrierLabel: 'Close',
      builder: (_) => _PollOptionViewer(
        bloc: widget.bloc,
        postId: widget.post.id,
        optionId: option.id,
        onAction: widget.onAction,
      ),
    );
    if (mounted) setState(() => _openId = null);
  }

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    final options = post.pollOptions;
    final voted = post.selectedPollOptionId != null;
    final total = post.totalVotes == 0 ? 1 : post.totalVotes;
    Widget tile(ConnectPollOption option) {
      final selected = voted && post.selectedPollOptionId == option.id;
      final outlined = selected || _openId == option.id;
      final ink = selected ? const Color(0xFF83CFF4) : Colors.white;
      final image = option.imageUrl ?? '';
      final pct = ((option.votes / total) * 100).round();
      return Semantics(
        button: true,
        selected: selected,
        label: option.label,
        hint: 'Opens the picture to vote',
        child: _PollPressable(
          key: ValueKey('poll-option-open-${option.id}'),
          onTap: () => _open(option),
          child: AnimatedContainer(
            duration: _pollMotion,
            curve: Curves.easeOutCubic,
            // The outline sits over the picture, as the design's stroke does.
            foregroundDecoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: outlined ? const Color(0xFF0571A5) : _pollBorder,
                width: outlined ? 1.5 : 1,
              ),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  SizedBox.expand(
                    key: ValueKey('poll-option-image-${option.id}'),
                    child: image.isEmpty
                        // An option posted without a picture keeps its place
                        // in the grid on a flat grey the white words read on.
                        ? const ColoredBox(color: _pollIcons)
                        // Two fingers still lift the picture out to zoom in
                        // place, as a photo post's do.
                        : _PinchToZoom(
                            child: Image(
                              image: _remoteImage(image),
                              fit: BoxFit.cover,
                            ),
                          ),
                  ),
                  const IgnorePointer(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [Color(0x57666666), Color(0x57000000)],
                        ),
                      ),
                    ),
                  ),
                  Positioned(
                    left: 8,
                    right: 8,
                    bottom: 8,
                    child: IgnorePointer(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: AnimatedDefaultTextStyle(
                              duration: _pollMotion,
                              style: TextStyle(
                                fontFamily: _soraFont,
                                fontSize: 12,
                                height: 22.5 / 12,
                                fontWeight: FontWeight.w600,
                                color: ink,
                              ),
                              child: Text(
                                option.label,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ),
                          if (voted) ...[
                            const SizedBox(width: 8),
                            _PollPercent(
                              value: pct,
                              style: TextStyle(
                                fontFamily: _soraFont,
                                fontSize: 12,
                                height: 24 / 12,
                                fontWeight: FontWeight.w700,
                                color: ink,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return Column(
      children: [
        for (var i = 0; i < options.length; i += 2) ...[
          if (i > 0) const SizedBox(height: 12),
          SizedBox(
            height: 152,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: tile(options[i])),
                const SizedBox(width: 12),
                Expanded(
                  child: i + 1 < options.length
                      ? tile(options[i + 1])
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

/// One picture option opened over the feed (node 4607:23605): the picture,
/// its name and how many votes it has, and the Vote button — a picture poll
/// is voted on from here, never from the card. The close button on the
/// picture, a tap outside or Back puts it away.
///
/// It draws the post exactly as [bloc] holds it, read by [postId] on every
/// change: voting goes the card's way, through [onAction], and the bloc puts
/// the vote on at once and takes it off again if sending fails, so the
/// button and the count here follow it with no copy of their own. The
/// design draws only the open option before a vote; the voted look is the
/// Vote button's own pill filled, reading "Voted". Voting for another option
/// later, from its own picture, moves the vote as a tap on a words-only
/// option does. Should the post or this option go while it is open — the
/// poll deleted, its options edited — it closes.
class _PollOptionViewer extends StatefulWidget {
  const _PollOptionViewer({
    required this.bloc,
    required this.postId,
    required this.optionId,
    required this.onAction,
  });

  final ConnectBloc bloc;
  final String postId;
  final String optionId;
  final Future<void> Function({String? optionId}) onAction;

  @override
  State<_PollOptionViewer> createState() => _PollOptionViewerState();
}

class _PollOptionViewerState extends State<_PollOptionViewer> {
  static const _ink = TextStyle(
    fontFamily: _soraFont,
    color: _pollInkSecondary,
  );

  bool _closing = false;

  /// Puts the viewer away once, after this frame: what it showed is gone.
  void _close() {
    if (_closing) return;
    _closing = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      // This viewer's own route, wherever it is: a screen opened over it
      // (a tapped notification) is not the one to close.
      final route = ModalRoute.of(context);
      if (route == null) return;
      if (route.isCurrent) {
        Navigator.of(context).pop();
      } else if (route.isActive) {
        Navigator.of(context).removeRoute(route);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<ConnectState>(
      stream: widget.bloc.stream,
      initialData: widget.bloc.state,
      builder: (context, snapshot) {
        final post = (snapshot.data ?? widget.bloc.state).posts
            .where((p) => p.id == widget.postId)
            .firstOrNull;
        final option = post?.pollOptions
            .where((o) => o.id == widget.optionId)
            .firstOrNull;
        if (post == null || option == null) {
          _close();
          return const SizedBox.shrink();
        }
        final voted = post.selectedPollOptionId == option.id;
        final image = option.imageUrl ?? '';
        return Center(
          child: Padding(
            // Clear of the screen's edges, so on a short screen the picture
            // gives up height rather than the card running off it.
            padding: const EdgeInsets.all(16),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 361),
              child: Material(
                key: const ValueKey('poll-option-viewer'),
                color: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                  side: const BorderSide(color: _pollBorder),
                ),
                clipBehavior: Clip.antiAlias,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // 337 by 319 on the design's 361-wide card, kept in
                      // that shape on any other width — and shorter, cropped
                      // the more, where the screen is too short for it (a
                      // phone on its side, large text), so the name and the
                      // Vote button below always fit.
                      Flexible(
                        child: AspectRatio(
                          aspectRatio: 337 / 319,
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                if (image.isEmpty)
                                  const ColoredBox(color: _pollIcons)
                                else
                                  Semantics(
                                    image: true,
                                    label: option.label,
                                    child: _PinchToZoom(
                                      child: Image(
                                        image: _remoteImage(image),
                                        fit: BoxFit.cover,
                                      ),
                                    ),
                                  ),
                                // The 24 grey disc 13 from the top and 10 from
                                // the right (node 4610:23631), with a finger's
                                // room around it to hit.
                                Positioned(
                                  top: 5,
                                  right: 2,
                                  child: Semantics(
                                    button: true,
                                    label: 'Close',
                                    child: GestureDetector(
                                      key: const ValueKey(
                                        'poll-option-viewer-close',
                                      ),
                                      behavior: HitTestBehavior.opaque,
                                      onTap: () =>
                                          Navigator.of(context).maybePop(),
                                      child: SizedBox(
                                        width: 40,
                                        height: 40,
                                        child: Center(
                                          child: Container(
                                            width: 23.995,
                                            height: 23.995,
                                            alignment: Alignment.center,
                                            decoration: const BoxDecoration(
                                              color: Color(0xFF767676),
                                              shape: BoxShape.circle,
                                            ),
                                            child: SvgPicture.asset(
                                              'assets/icons/poll_viewer_close.svg',
                                              width: 14,
                                              height: 14,
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
                        ),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  option.label,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: _ink.copyWith(
                                    fontSize: 16,
                                    height: 16.2 / 16,
                                    fontWeight: FontWeight.w600,
                                    letterSpacing: -0.16,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                // Steps up from where it stood when a vote
                                // lands, rather than counting from nothing
                                // each time the picture opens.
                                _PollPercent(
                                  value: option.votes,
                                  votes: true,
                                  countIn: false,
                                  style: _ink.copyWith(
                                    fontSize: 12,
                                    height: 24 / 12,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 12),
                          _PollVoteButton(
                            voted: voted,
                            onVote: () =>
                                widget.onAction(optionId: widget.optionId),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

/// The viewer's Vote button (node 4610:23614): brand-blue words in a
/// hairline brand-blue pill. Once this option holds the viewer's vote it is
/// the same pill filled, reading "Voted" — no longer a button at all: it
/// neither gives under the finger nor offers a tap to a screen reader.
class _PollVoteButton extends StatelessWidget {
  const _PollVoteButton({required this.voted, required this.onVote});

  final bool voted;
  final VoidCallback onVote;

  // One tree either way, so the pill's fill still eases from white to blue;
  // only the pointer and the button role come and go.
  @override
  Widget build(BuildContext context) => Semantics(
    key: const ValueKey('poll-option-vote'),
    button: !voted,
    selected: voted,
    child: IgnorePointer(
      ignoring: voted,
      // The pill is drawn 36 tall; the finger gets 46 (5 above and below).
      child: _PollPressable(
        onTap: onVote,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: _pill(),
        ),
      ),
    ),
  );

  Widget _pill() => AnimatedContainer(
    duration: _pollMotion,
    curve: Curves.easeOutCubic,
    padding: const EdgeInsets.symmetric(horizontal: 21, vertical: 5),
    decoration: BoxDecoration(
      color: voted ? _pollBrand : Colors.white,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: _pollBrand),
      boxShadow: const [
        BoxShadow(
          color: Color(0x1A000000),
          blurRadius: 1.5,
          offset: Offset(0, 1),
        ),
      ],
    ),
    child: Text(
      voted ? 'Voted' : 'Vote',
      textAlign: TextAlign.center,
      style: TextStyle(
        fontFamily: _soraFont,
        fontSize: 16,
        height: 24 / 16,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.16,
        color: voted ? Colors.white : _pollBrand,
      ),
    ),
  );
}

/// Words-only options keep the result bars, set in the card's face: the bar
/// fills to each option's share once the viewer has voted.
class _PollOptionBars extends StatelessWidget {
  const _PollOptionBars({required this.post, required this.onAction});

  final ConnectPost post;
  final Future<void> Function({String? optionId}) onAction;

  @override
  Widget build(BuildContext context) {
    final total = post.totalVotes == 0 ? 1 : post.totalVotes;
    final voted = post.selectedPollOptionId != null;
    final options = post.pollOptions;
    return Column(
      children: [
        for (final (index, option) in options.indexed) ...[
          if (index > 0) const SizedBox(height: 12),
          Builder(
            builder: (context) {
              final selected = voted && post.selectedPollOptionId == option.id;
              final pct = ((option.votes / total) * 100).round();
              final ink = selected ? _pollBrand : _pollInkSecondary;
              return _PollPressable(
                onTap: () => onAction(optionId: option.id),
                child: AnimatedContainer(
                  duration: _pollMotion,
                  curve: Curves.easeOutCubic,
                  height: 48,
                  clipBehavior: Clip.antiAlias,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: selected ? const Color(0xF7CCFCFF) : _pollBorder,
                      width: 1.114,
                    ),
                  ),
                  child: Stack(
                    children: [
                      if (voted)
                        // The bar grows to its share, from nothing on the
                        // first vote and from where it was after that.
                        Positioned.fill(
                          child: TweenAnimationBuilder<double>(
                            tween: Tween(
                              begin: 0,
                              end: (pct / 100).clamp(0.0, 1.0),
                            ),
                            duration: _pollMotion,
                            curve: Curves.easeOutCubic,
                            builder: (context, share, _) =>
                                FractionallySizedBox(
                                  alignment: Alignment.centerLeft,
                                  widthFactor: share,
                                  child: AnimatedContainer(
                                    duration: _pollMotion,
                                    color: selected
                                        ? const Color(0xF7CCFCFF)
                                        : _pollBorder,
                                  ),
                                ),
                          ),
                        ),
                      Positioned.fill(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  option.label,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontFamily: _soraFont,
                                    fontSize: 15,
                                    height: 22.5 / 15,
                                    fontWeight: FontWeight.w600,
                                    color: ink,
                                  ),
                                ),
                              ),
                              if (voted) ...[
                                _PollOptionVotes(votes: option.votes),
                                const SizedBox(width: 8),
                                _PollPercent(
                                  value: pct,
                                  style: TextStyle(
                                    fontFamily: _soraFont,
                                    fontSize: 16,
                                    height: 24 / 16,
                                    fontWeight: FontWeight.w700,
                                    color: ink,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ],
      ],
    );
  }
}

/// Lays its child out [extra] wider than the space it is given, while taking
/// up only that space itself — the child's last few pixels hang into the
/// padding beside it.
class _Overhang extends SingleChildRenderObjectWidget {
  const _Overhang({required this.extra, required super.child});

  final double extra;

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderOverhang(extra);

  @override
  void updateRenderObject(BuildContext context, _RenderOverhang renderObject) {
    renderObject.extra = extra;
  }
}

class _RenderOverhang extends RenderShiftedBox {
  _RenderOverhang(this._extra) : super(null);

  double _extra;

  set extra(double value) {
    if (value == _extra) return;
    _extra = value;
    markNeedsLayout();
  }

  @override
  void performLayout() {
    final child = this.child;
    if (child == null) {
      size = constraints.smallest;
      return;
    }
    child.layout(
      BoxConstraints(maxWidth: constraints.maxWidth + _extra),
      parentUsesSize: true,
    );
    size = constraints.constrain(Size(constraints.maxWidth, child.size.height));
  }
}
