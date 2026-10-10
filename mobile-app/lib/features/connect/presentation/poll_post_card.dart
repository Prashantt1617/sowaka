part of 'connect_feed_screen.dart';

// The poll card (instance 3572:27926, component 2028:51565): the author row,
// the POLL pill, the question, the options — two to a row with their
// pictures when they have them — the tally, the like and comment bar, the
// two latest comments and the comment box, all on one padded column.

const _pollInk = Color(0xFF222222);
const _pollInkSecondary = Color(0xFF484848);
const _pollInkTertiary = Color(0xFF717171);
const _pollIcons = Color(0xFF9197A2);
const _pollBorder = Color(0xFFEBEBEB);
const _pollSurface = Color(0xFFF7F7F9);
const _pollBrand = Color(0xFF0571A6);

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
    final comments = _latestComments(post.comments);
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
          const Align(alignment: Alignment.centerLeft, child: _PollBadge()),
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
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              '${post.totalVotes} total vote${post.totalVotes == 1 ? '' : 's'}',
              style: const TextStyle(
                fontFamily: _soraFont,
                fontSize: 14,
                height: 21 / 14,
                fontWeight: FontWeight.w500,
                color: _pollIcons,
              ),
            ),
          ),
          const SizedBox(height: 12),
          // ActionBar (node 2028:51629).
          Container(
            padding: const EdgeInsets.only(top: 18.114),
            decoration: const BoxDecoration(
              border: Border(
                top: BorderSide(color: Color(0x66EBEBEB), width: 1.114),
              ),
            ),
            child: Row(
              children: [
                _PollCount(
                  icon: post.liked
                      ? 'assets/icons/connect_icon_heart_filled.svg'
                      : 'assets/icons/connect_icon_heart_outline.svg',
                  count: post.likeCount,
                  label: post.liked ? 'Unlike' : 'Like',
                  onTap: onLike,
                ),
                const SizedBox(width: 24),
                _PollCount(
                  icon: 'assets/icons/connect_icon_comment.svg',
                  count: post.commentCount,
                  label: 'Comments',
                  onTap: onOpenComments,
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
          const SizedBox(height: 12),
          // PostComments (node 2028:51640): the two latest, oldest of the pair
          // first, then the box.
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final comment in comments) ...[
                  _PollCommentPreview(
                    comment: comment,
                    onOpenThread: onOpenComments,
                  ),
                  const SizedBox(height: 12),
                ],
                if (mentions case final tags?)
                  ValueListenableBuilder<TextEditingValue>(
                    valueListenable: commentController,
                    builder: (context, _, _) {
                      final scope = _FeedScope.of(context);
                      return _MentionSuggestions(
                        people: tags.matches(
                          scope?.people ?? const [],
                          viewerUserId: scope?.viewerUserId ?? '',
                        ),
                        onPick: tags.pick,
                      );
                    },
                  ),
                _PollCommentInput(
                  controller: commentController,
                  onSend: onComment,
                  viewerInitials: viewerInitials,
                  viewerPhotoUrl: viewerPhotoUrl,
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
    final total = post.totalVotes == 0 ? 1 : post.totalVotes;
    final voted = post.selectedPollOptionId != null;
    Widget tile(ConnectPollOption option) {
      final selected = voted && post.selectedPollOptionId == option.id;
      final ink = selected ? _pollBrand : _pollInkSecondary;
      final pct = ((option.votes / total) * 100).round();
      final image = option.imageUrl ?? '';
      return Semantics(
        button: true,
        selected: selected,
        label: option.label,
        child: GestureDetector(
          onTap: () => onAction(optionId: option.id),
          behavior: HitTestBehavior.opaque,
          child: Container(
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
                    height: 88,
                    child: image.isEmpty
                        ? const ColoredBox(color: _pollSurface)
                        : Image(image: _remoteImage(image), fit: BoxFit.cover),
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
                  Text(
                    '$pct%',
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
              return GestureDetector(
                onTap: () => onAction(optionId: option.id),
                behavior: HitTestBehavior.opaque,
                child: Container(
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
                        Positioned.fill(
                          child: FractionallySizedBox(
                            alignment: Alignment.centerLeft,
                            widthFactor: (pct / 100).clamp(0.0, 1.0),
                            child: ColoredBox(
                              color: selected
                                  ? const Color(0xF7CCFCFF)
                                  : _pollBorder,
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
                              if (voted)
                                Text(
                                  '$pct%',
                                  style: TextStyle(
                                    fontFamily: _soraFont,
                                    fontSize: 16,
                                    height: 24 / 16,
                                    fontWeight: FontWeight.w700,
                                    color: ink,
                                  ),
                                ),
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

/// A heart or speech bubble with its count (node 2028:51630).
class _PollCount extends StatelessWidget {
  const _PollCount({
    required this.icon,
    required this.count,
    required this.label,
    required this.onTap,
  });

  final String icon;
  final int count;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Row(
          children: [
            SvgPicture.asset(icon, width: 21.987, height: 21.987),
            const SizedBox(width: 8),
            Text(
              '$count',
              style: const TextStyle(
                fontFamily: _soraFont,
                fontSize: 16,
                height: 24 / 16,
                fontWeight: FontWeight.w600,
                color: _pollIcons,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One of the two comment previews under the poll (node 2028:51641). The
/// commenter's face and name open their profile; the rest opens the thread.
class _PollCommentPreview extends StatelessWidget {
  const _PollCommentPreview({
    required this.comment,
    required this.onOpenThread,
  });

  final ConnectComment comment;
  final VoidCallback onOpenThread;

  @override
  Widget build(BuildContext context) {
    final photo = comment.photoUrl ?? '';
    final initial = _initials(comment.name).characters.first;
    return GestureDetector(
      onTap: onOpenThread,
      behavior: HitTestBehavior.opaque,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _PersonTap(
            userId: comment.userId,
            child: _GradientInitialAvatar(
              initial: initial,
              colors: _gradientFor(comment.id),
              photoUrl: photo,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Flexible(
                      child: _PersonTap(
                        userId: comment.userId,
                        child: Text(
                          comment.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontFamily: _soraFont,
                            fontSize: 13,
                            height: 19.5 / 13,
                            fontWeight: FontWeight.w600,
                            color: _pollInk,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      _relativeTime(comment.createdAt),
                      style: const TextStyle(
                        fontFamily: _soraFont,
                        fontSize: 11,
                        height: 16.5 / 11,
                        fontWeight: FontWeight.w400,
                        color: _pollInkTertiary,
                      ),
                    ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: _commentBody(
                    comment,
                    style: _commentStyle,
                    plain: Text(comment.text, style: _commentStyle),
                    onOpenPerson: _FeedScope.of(context)?.onOpenPerson,
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

/// A 32px round face on a gradient (node 2028:51642).
class _GradientInitialAvatar extends StatelessWidget {
  const _GradientInitialAvatar({
    required this.initial,
    required this.colors,
    this.photoUrl = '',
  });

  final String initial;
  final List<Color> colors;
  final String photoUrl;

  @override
  Widget build(BuildContext context) {
    final letter = Text(
      initial,
      style: const TextStyle(
        fontFamily: _soraFont,
        fontSize: 11.2,
        height: 16.8 / 11.2,
        fontWeight: FontWeight.w700,
        color: Colors.white,
      ),
    );
    return Container(
      width: 31.997,
      height: 31.997,
      alignment: Alignment.center,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: colors,
        ),
      ),
      child: photoUrl.isEmpty
          ? letter
          : Image(
              image: _remoteImage(photoUrl),
              width: 31.997,
              height: 31.997,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => letter,
            ),
    );
  }
}

/// The comment box (node 352:1331): the viewer's face and a pill field with
/// the paper plane.
class _PollCommentInput extends StatelessWidget {
  const _PollCommentInput({
    required this.controller,
    required this.onSend,
    required this.viewerInitials,
    required this.viewerPhotoUrl,
  });

  final TextEditingController controller;
  final VoidCallback onSend;
  final String viewerInitials;
  final String viewerPhotoUrl;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _GradientInitialAvatar(
          initial: viewerInitials.isEmpty
              ? '?'
              : viewerInitials.characters.first,
          colors: const [Color(0xFFFF5A5F), Color(0xFFFF8C8F)],
          photoUrl: viewerPhotoUrl,
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: _pollSurface,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: _pollBorder, width: 1.114),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: controller,
                    minLines: 1,
                    maxLines: 3,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => onSend(),
                    style: const TextStyle(
                      fontFamily: _soraFont,
                      fontSize: 13,
                      color: _pollInk,
                    ),
                    decoration: const InputDecoration(
                      isDense: true,
                      filled: false,
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      disabledBorder: InputBorder.none,
                      contentPadding: EdgeInsets.zero,
                      hintText: 'Write a comment...',
                      hintStyle: TextStyle(
                        fontFamily: _soraFont,
                        fontSize: 13,
                        color: _pollInkTertiary,
                      ),
                    ),
                  ),
                ),
                Semantics(
                  button: true,
                  label: 'Send comment',
                  child: GestureDetector(
                    onTap: onSend,
                    behavior: HitTestBehavior.opaque,
                    child: Padding(
                      padding: const EdgeInsets.only(left: 8),
                      child: SvgPicture.asset(
                        '$_engagementIcons/send.svg',
                        width: 19.985,
                        height: 19.985,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
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

const _commentStyle = TextStyle(
  fontFamily: _soraFont,
  fontSize: 13,
  height: 18 / 13,
  fontWeight: FontWeight.w400,
  color: _pollInkSecondary,
);
