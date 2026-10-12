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
  });

  final int value;
  final TextStyle style;

  /// Shown as "3 votes" instead of "3%".
  final bool votes;

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
    tween: Tween(begin: 0, end: value.toDouble()),
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
  const _PollPressable({required this.onTap, required this.child});

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
                ? _PollOptionGrid(post: post, onAction: onAction)
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

/// Picture options, two to a row (node 3553:46841). The share shows once the
/// viewer has voted; their pick is outlined in brand blue.
class _PollOptionGrid extends StatelessWidget {
  const _PollOptionGrid({required this.post, required this.onAction});

  final ConnectPost post;
  final Future<void> Function({String? optionId}) onAction;

  @override
  Widget build(BuildContext context) {
    final options = post.pollOptions;
    final voted = post.selectedPollOptionId != null;
    Widget tile(ConnectPollOption option) {
      final selected = voted && post.selectedPollOptionId == option.id;
      final ink = selected ? _pollBrand : _pollInkSecondary;
      final image = option.imageUrl ?? '';
      return Semantics(
        button: true,
        selected: selected,
        label: option.label,
        child: _PollPressable(
          onTap: () => onAction(optionId: option.id),
          child: AnimatedContainer(
            duration: _pollMotion,
            curve: Curves.easeOutCubic,
            padding: EdgeInsets.all(selected ? 10.5 : 11),
            decoration: BoxDecoration(
              color: selected ? const Color(0xFFEFF6FF) : Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: selected ? const Color(0xFF0571A5) : _pollBorder,
                width: selected ? 1.5 : 1,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: SizedBox(
                    key: ValueKey('poll-option-image-${option.id}'),
                    height: 88,
                    child: image.isEmpty
                        ? const ColoredBox(color: _pollSurface)
                        // Two fingers lift the picture out to zoom, as a
                        // photo post's does. One finger's tap still votes.
                        : _PinchToZoom(
                            child: Image(
                              image: _remoteImage(image),
                              fit: BoxFit.cover,
                            ),
                          ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  option.label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontFamily: _soraFont,
                    fontSize: 15,
                    height: 22.5 / 15,
                    fontWeight: FontWeight.w600,
                    color: ink,
                  ),
                ),
                if (voted) ...[
                  const SizedBox(height: 4),
                  // A picture option counts votes, not a share of them.
                  _PollPercent(
                    value: option.votes,
                    votes: true,
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
      );
    }

    return Column(
      children: [
        for (var i = 0; i < options.length; i += 2) ...[
          if (i > 0) const SizedBox(height: 12),
          IntrinsicHeight(
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
