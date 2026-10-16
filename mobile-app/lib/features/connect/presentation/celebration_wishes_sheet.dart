part of 'connect_feed_screen.dart';

// A birthday's or work anniversary's wishes (node 3844:82492): each wish with
// its heart and "Reply", the replies under it, a row of quick emoji and the
// box to wish in. The wishes are the post's comments; liking and replying
// are the comments' own.

const _wishEmoji = ['❤️', '🙌', '🔥', '👏', '😍', '🎉', '💯', '😂'];

/// "1h ago", as the sheet stamps a wish.
String _wishAge(DateTime? at) {
  final age = _timeAgo(at);
  return RegExp(r'^\d+[mhd]$').hasMatch(age) ? '$age ago' : age;
}

class _WishesSheet extends StatefulWidget {
  const _WishesSheet({
    required this.bloc,
    required this.postId,
    required this.viewerUserId,
    required this.viewerInitials,
    required this.viewerColor,
    required this.onReportComment,
    required this.onBlockCommenter,
    this.viewerPhotoUrl = '',
    this.onOpenPerson,
    this.people = const [],
    this.initialText = '',
  });

  final ConnectBloc bloc;
  final String postId;

  /// What the box starts with — a wish, ready to send or change.
  final String initialText;

  /// Everyone in the company who can be tagged with "@".
  final List<ConnectTeammate> people;
  final String viewerUserId;
  final String viewerInitials;
  final Color viewerColor;
  final String viewerPhotoUrl;
  final ValueChanged<ConnectComment> onReportComment;
  final ValueChanged<ConnectComment> onBlockCommenter;

  /// Opens a wisher's profile. The sheet is its own route, outside the feed,
  /// so it is handed in rather than looked up.
  final ValueChanged<String>? onOpenPerson;

  @override
  State<_WishesSheet> createState() => _WishesSheetState();
}

class _WishesSheetState extends State<_WishesSheet> {
  final _controller = TextEditingController();
  late final _mentions = _CommentMentions(_controller);
  final _focusNode = FocusNode();
  String? _replyingToId;
  String? _replyingToName;

  @override
  void initState() {
    super.initState();
    if (widget.initialText.isNotEmpty) {
      _controller.value = TextEditingValue(
        text: widget.initialText,
        selection: TextSelection.collapsed(offset: widget.initialText.length),
      );
    }
    // The suggestion list follows what is typed after an "@".
    _controller.addListener(_onTyping);
  }

  void _onTyping() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  ConnectPost? get _post => widget.bloc.state.posts
      .where((item) => item.id == widget.postId)
      .firstOrNull;

  void _reply(String wishId, String name) {
    final firstName = name.split(' ').first;
    setState(() {
      _replyingToId = wishId;
      _replyingToName = name;
    });
    _controller.value = TextEditingValue(
      text: '@$firstName ',
      selection: TextSelection.collapsed(offset: firstName.length + 2),
    );
    _focusNode.requestFocus();
  }

  void _cancelReply() {
    setState(() {
      _replyingToId = null;
      _replyingToName = null;
      _controller.clear();
    });
  }

  /// An emoji goes where the cursor is, as typing it would.
  void _insertEmoji(String emoji) {
    final value = _controller.value;
    final selection = value.selection.isValid
        ? value.selection
        : TextSelection.collapsed(offset: value.text.length);
    _controller.value = TextEditingValue(
      text: value.text.replaceRange(selection.start, selection.end, emoji),
      selection: TextSelection.collapsed(
        offset: selection.start + emoji.length,
      ),
    );
    _focusNode.requestFocus();
  }

  Future<void> _submit() async {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    final parentId = _replyingToId;
    final parentName = _replyingToName;
    final mentions = _mentions.mentionsIn(text);
    // A colleague's first wish also marks the card wished, as its button
    // used to — only once: the server flips the mark each time.
    final before = _post;
    final firstWish =
        parentId == null &&
        before != null &&
        !_isCelebrant(before, widget.viewerUserId) &&
        before.actionValue == null;
    _mentions.clear();
    _controller.clear();
    setState(() {
      _replyingToId = null;
      _replyingToName = null;
    });
    final sent = await widget.bloc.addComment(
      widget.postId,
      text,
      parentId: parentId,
      mentions: mentions,
    );
    if (sent && firstWish && _post?.actionValue == null) {
      await widget.bloc.performAction(widget.postId);
    }
    // A wish that did not go comes back to the box — the reply it was, and
    // its tags — unless something new has been typed there since.
    if (sent || !mounted || _controller.text.isNotEmpty) return;
    _controller.value = TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
    _mentions.restore(mentions);
    setState(() {
      _replyingToId = parentId;
      _replyingToName = parentName;
    });
  }

  /// Report or block, for a wish or reply someone else wrote — held down, as
  /// the design leaves the row free of a menu button.
  Future<void> _showMenu(ConnectComment comment, Offset at) async {
    if (comment.userId.isEmpty) return;
    final mine = comment.userId == widget.viewerUserId;
    final overlay =
        Overlay.of(context).context.findRenderObject()! as RenderBox;
    final action = await showMenu<_PostMenuAction>(
      context: context,
      position: RelativeRect.fromRect(
        at & const Size(1, 1),
        Offset.zero & overlay.size,
      ),
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      items: mine
          ? const [
              PopupMenuItem(
                value: _PostMenuAction.delete,
                child: Row(
                  children: [
                    Icon(Icons.delete_outline_rounded, size: 18, color: Color(0xFFE5484D)),
                    SizedBox(width: 10),
                    Text('Delete', style: TextStyle(color: Color(0xFFE5484D))),
                  ],
                ),
              ),
            ]
          : [
        const PopupMenuItem(
          value: _PostMenuAction.report,
          child: Row(
            children: [
              Icon(Icons.flag_outlined, size: 18),
              SizedBox(width: 10),
              Text('Report wish'),
            ],
          ),
        ),
        PopupMenuItem(
          value: _PostMenuAction.block,
          child: Row(
            children: [
              const Icon(Icons.block_rounded, size: 18),
              const SizedBox(width: 10),
              Flexible(
                child: Text(
                  'Block ${comment.name.split(' ').first}',
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ],
    );
    if (!mounted) return;
    if (action == _PostMenuAction.delete) {
      await _confirmDeleteComment(
        context,
        widget.bloc,
        widget.postId,
        comment,
        noun: comment.parentId == null ? 'wish' : 'reply',
      );
    }
    if (action == _PostMenuAction.report) widget.onReportComment(comment);
    if (action == _PostMenuAction.block) widget.onBlockCommenter(comment);
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<ConnectState>(
      stream: widget.bloc.stream,
      initialData: widget.bloc.state,
      builder: (context, snapshot) {
        final post = (snapshot.data ?? widget.bloc.state).posts
            .where((item) => item.id == widget.postId)
            .firstOrNull;
        if (post == null) return const SizedBox.shrink();
        final celebrant = _isCelebrant(post, widget.viewerUserId);
        return DraggableScrollableSheet(
          // 723 of the design's 852-high screen.
          initialChildSize: 0.85,
          minChildSize: 0.4,
          maxChildSize: 0.92,
          expand: false,
          builder: (context, scrollController) {
            // The keyboard gets its room, or the box sits behind it.
            return Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.viewInsetsOf(context).bottom,
              ),
              child: Container(
                key: const ValueKey('wishes-sheet'),
                decoration: const BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
                  boxShadow: [
                    BoxShadow(
                      color: Color(0x1F000000),
                      blurRadius: 16,
                      offset: Offset(0, -4),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    // node 3844:82493
                    const Padding(
                      padding: EdgeInsets.only(top: 12, bottom: 4),
                      child: SizedBox(
                        width: 40,
                        height: 4,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: Color(0xFFD1D5DB),
                            borderRadius: BorderRadius.all(Radius.circular(99)),
                          ),
                        ),
                      ),
                    ),
                    // node 3844:82495
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 20,
                        vertical: 12,
                      ),
                      decoration: const BoxDecoration(
                        border: Border(
                          bottom: BorderSide(
                            color: Color(0xFFF3F4F6),
                            width: 1.114,
                          ),
                        ),
                      ),
                      child: Text(
                        post.type == ConnectPostType.birthday
                            ? 'Birthday Wishes'
                            : 'Work Anniversary Wishes',
                        textAlign: TextAlign.center,
                        style: _celebrationText(
                          16,
                          FontWeight.w600,
                          _CelebrationColors.main,
                          height: 24,
                          spacing: -0.16,
                        ),
                      ),
                    ),
                    Expanded(
                      child: _wishList(post, celebrant, scrollController),
                    ),
                    _emojiRow(),
                    _composer(post, celebrant),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget _wishList(
    ConnectPost post,
    bool celebrant,
    ScrollController scrollController,
  ) {
    final wishes = post.comments
        .where((comment) => comment.parentId == null)
        .toList();
    if (wishes.isEmpty) {
      // Still scrollable, so the sheet drags from here too.
      return ListView(
        controller: scrollController,
        children: [
          const SizedBox(height: 120),
          Center(
            child: Text(
              celebrant
                  ? 'No wishes yet. They will show up here.'
                  : 'No wishes yet — be the first.',
              style: _celebrationText(
                13.5,
                FontWeight.w600,
                _CelebrationColors.tertiary,
              ),
            ),
          ),
        ],
      );
    }
    final replies = <String, List<ConnectComment>>{};
    for (final comment in post.comments) {
      final parent = comment.parentId;
      if (parent != null) (replies[parent] ??= []).add(comment);
    }
    return ListView.builder(
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      itemCount: wishes.length,
      itemBuilder: (context, index) => _wishRow(
        wishes[index],
        replies[wishes[index].id] ?? const <ConnectComment>[],
      ),
    );
  }

  Widget _face(ConnectComment comment) {
    final photo = comment.photoUrl ?? '';
    final initial = Text(
      _initials(comment.name).characters.take(1).toString(),
      style: _celebrationText(14, FontWeight.w700, Colors.white, height: 21),
    );
    return _PersonTap(
      userId: comment.userId,
      onOpenPerson: widget.onOpenPerson,
      child: Container(
        width: 40,
        height: 40,
        alignment: Alignment.center,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: _gradientFor(comment.id),
          ),
        ),
        child: photo.isEmpty
            ? initial
            : Image(
                image: _remoteImage(photo),
                width: 40,
                height: 40,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => initial,
              ),
      ),
    );
  }

  /// node 3844:82499: one wish, its heart, and the replies under it.
  Widget _wishRow(ConnectComment wish, List<ConnectComment> replies) {
    final repliedByMe = replies.any(
      (reply) => reply.userId == widget.viewerUserId,
    );
    final textStyle = _celebrationText(
      14,
      FontWeight.w400,
      const Color(0xFF484848),
      height: 20,
    );
    return GestureDetector(
      key: ValueKey('wish-${wish.id}'),
      behavior: HitTestBehavior.translucent,
      onLongPressStart: (details) => _showMenu(wish, details.globalPosition),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: const BoxDecoration(
          border: Border(
            bottom: BorderSide(color: Color(0xFFF7F7F9), width: 1.114),
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _face(wish),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: _PersonTap(
                          userId: wish.userId,
                          onOpenPerson: widget.onOpenPerson,
                          child: Text(
                            wish.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: _celebrationText(
                              14,
                              FontWeight.w600,
                              _CelebrationColors.main,
                              height: 21,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        _wishAge(wish.createdAt),
                        style: _celebrationText(
                          12,
                          FontWeight.w400,
                          _CelebrationColors.tertiary,
                          height: 18,
                        ),
                      ),
                    ],
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: _commentBody(
                      wish,
                      style: textStyle,
                      plain: LinkifiedText(wish.text, style: textStyle),
                      onOpenPerson: widget.onOpenPerson,
                    ),
                  ),
                  // node 3844:82511: "Reply", or "You Replied" once you have.
                  SizedBox(
                    height: 26.88,
                    child: Align(
                      alignment: Alignment.topLeft,
                      child: GestureDetector(
                        key: ValueKey('wish-reply-${wish.id}'),
                        behavior: HitTestBehavior.opaque,
                        onTap: () => _reply(wish.id, wish.name),
                        child: Padding(
                          padding: const EdgeInsets.only(top: 6, right: 12),
                          child: Text(
                            repliedByMe ? 'You Replied' : 'Reply',
                            style: _celebrationText(
                              13,
                              FontWeight.w600,
                              _CelebrationColors.tertiary,
                              height: 19.5,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  for (final reply in replies) _replyRow(reply),
                ],
              ),
            ),
            _likeButton(wish),
          ],
        ),
      ),
    );
  }

  /// node 3844:82638: a reply, under the wish. Yours stand under "You
  /// Replied"; anyone else's carry their name.
  Widget _replyRow(ConnectComment reply) {
    final mine = reply.userId == widget.viewerUserId;
    final style = _celebrationText(
      12,
      FontWeight.w400,
      const Color(0xFF484848),
      height: 20,
    );
    final tagStyle = _celebrationText(
      12,
      FontWeight.w600,
      _CelebrationColors.main,
      height: 20,
    );
    // "@Sarahkim Thankyou for sure." — the name a reply opens with, bold.
    final lead = RegExp(r'^@\S+').firstMatch(reply.text);
    final body = reply.mentions.isNotEmpty
        ? _commentBody(
            reply,
            style: style,
            plain: Text(reply.text, style: style),
            onOpenPerson: widget.onOpenPerson,
          )
        : Text.rich(
            TextSpan(
              style: style,
              children: [
                if (lead != null)
                  TextSpan(text: lead.group(0), style: tagStyle),
                TextSpan(
                  text: lead == null
                      ? reply.text
                      : reply.text.substring(lead.end),
                ),
              ],
            ),
          );
    return GestureDetector(
      key: ValueKey('wish-${reply.id}'),
      behavior: HitTestBehavior.translucent,
      onLongPressStart: (details) => _showMenu(reply, details.globalPosition),
      child: Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!mine)
                _PersonTap(
                  userId: reply.userId,
                  onOpenPerson: widget.onOpenPerson,
                  child: Text(
                    reply.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: _celebrationText(
                      12,
                      FontWeight.w600,
                      _CelebrationColors.main,
                      height: 18,
                    ),
                  ),
                ),
              Padding(padding: const EdgeInsets.only(top: 2), child: body),
            ],
          ),
        ),
      ),
    );
  }

  /// node 3844:82518: the heart, and how many liked the wish under it. The
  /// 12 beside the column is part of what takes the tap.
  Widget _likeButton(ConnectComment wish) {
    return GestureDetector(
      key: ValueKey('wish-like-${wish.id}'),
      behavior: HitTestBehavior.opaque,
      onTap: () => widget.bloc.reactToComment(widget.postId, wish.id),
      child: Padding(
        padding: const EdgeInsets.only(left: 12, top: 2),
        child: SizedBox(
          width: 16,
          child: Column(
            children: [
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 180),
                transitionBuilder: (child, animation) =>
                    ScaleTransition(scale: animation, child: child),
                child: SvgPicture.asset(
                  wish.liked
                      ? 'assets/icons/celebration_wish_heart_filled.svg'
                      : 'assets/icons/celebration_wish_heart_outline.svg',
                  key: ValueKey(wish.liked),
                  width: 16,
                  height: 16,
                ),
              ),
              if (wish.likeCount > 0) ...[
                const SizedBox(height: 2),
                Text(
                  '${wish.likeCount}',
                  maxLines: 1,
                  softWrap: false,
                  overflow: TextOverflow.visible,
                  style: _celebrationText(
                    11,
                    FontWeight.w400,
                    _CelebrationColors.tertiary,
                    height: 16.5,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// node 3844:82608: emoji that go into the box.
  Widget _emojiRow() {
    return Container(
      height: 54,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Color(0xFFF3F4F6), width: 1.114)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          for (final emoji in _wishEmoji)
            InkResponse(
              key: ValueKey('wish-emoji-$emoji'),
              radius: 20,
              onTap: () => _insertEmoji(emoji),
              child: Text(
                emoji,
                style: const TextStyle(fontSize: 22, height: 33 / 22),
              ),
            ),
        ],
      ),
    );
  }

  /// node 3844:82625: your face and the box, "Wish Subham…".
  Widget _composer(ConnectPost post, bool celebrant) {
    final hint = celebrant ? 'Say thanks…' : 'Wish ${_firstNameOf(post)}…';
    final matches = _mentions.matches(
      widget.people,
      viewerUserId: widget.viewerUserId,
    );
    return SafeArea(
      top: false,
      minimum: const EdgeInsets.only(bottom: 24),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_replyingToId != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Replying to ${_replyingToName ?? ''}',
                        overflow: TextOverflow.ellipsis,
                        style: _celebrationText(
                          12,
                          FontWeight.w600,
                          _CelebrationColors.tertiary,
                        ),
                      ),
                    ),
                    GestureDetector(
                      onTap: _cancelReply,
                      child: const Icon(
                        Icons.close_rounded,
                        size: 16,
                        color: _CelebrationColors.tertiary,
                      ),
                    ),
                  ],
                ),
              ),
            if (matches.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: _MentionSuggestions(
                  people: matches,
                  onPick: _mentions.pick,
                ),
              ),
            ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 75),
              child: Row(
                children: [
                  _InitialAvatar(
                    initials: widget.viewerInitials,
                    color: widget.viewerColor,
                    photoUrl: widget.viewerPhotoUrl,
                    size: 32,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.fromLTRB(
                        15.1,
                        11.1,
                        15.1,
                        11.1,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF7F7F9),
                        borderRadius: BorderRadius.circular(99),
                        border: Border.all(
                          color: const Color(0xFFEBEBEB),
                          width: 1.114,
                        ),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: TextField(
                              key: const ValueKey('wish-box'),
                              controller: _controller,
                              focusNode: _focusNode,
                              minLines: 1,
                              maxLines: 3,
                              textInputAction: TextInputAction.send,
                              onSubmitted: (_) => _submit(),
                              style: _celebrationText(
                                13,
                                FontWeight.w400,
                                _CelebrationColors.main,
                                height: 19.5,
                              ),
                              decoration: InputDecoration.collapsed(
                                hintText: hint,
                                hintStyle: _celebrationText(
                                  13,
                                  FontWeight.w400,
                                  _CelebrationColors.tertiary,
                                  height: 19.5,
                                ),
                              ),
                            ),
                          ),
                          GestureDetector(
                            key: const ValueKey('wish-send'),
                            behavior: HitTestBehavior.opaque,
                            onTap: _submit,
                            child: Padding(
                              padding: const EdgeInsets.only(left: 8),
                              child: SvgPicture.asset(
                                'assets/icons/celebration_wish_send.svg',
                                width: 20,
                                height: 20,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
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
