part of 'connect_feed_screen.dart';

/// What a screen showing post cards does for them: the feed, and the Posts tab
/// on a profile. Both build a post's card the same way and answer its buttons
/// the same way — the comments and wishes sheets, report, block, delete, the
/// game — against their own [_bloc], so a post on a profile is opened, liked
/// and commented on exactly as it is in the feed.
mixin _PostCardHost<T extends StatefulWidget> on State<T> {
  /// The posts these cards are drawn from and act on.
  ConnectBloc get _bloc;

  AuthSession get _session;

  /// Everyone in the company, for tagging someone in a comment.
  List<ConnectTeammate> get _taggablePeople;

  /// Opens a person's profile; null where the host cannot navigate.
  ValueChanged<String>? get _onOpenPerson;

  /// The viewer's own post, to change in the composer.
  void _editPost(ConnectPost post);

  // AuthUser carries no initials/avatarColor fields of its own, so the
  // signed-in viewer's comment-composer avatar is derived the same way the
  // backend derives author avatars (see `initialsFor`/`avatarColorFor` in
  // connect.service.ts): initials from the name, color hashed from a stable
  // id.
  String get _viewerInitials => _initials(_session.user.name);
  Color get _viewerColor => _avatarColorFor(_session.user.id);
  String get _viewerPhotoUrl => _session.user.profilePhotoUrl ?? '';

  /// One post's card, as the feed draws it: the celebrant's own wishes, a game
  /// that draws its whole card itself, or the standard post — with its latest
  /// comments and comment box unless [conversation] is false.
  Widget _postCard(
    ConnectPost post,
    ConnectState state, {
    Key? key,
    bool conversation = true,
  }) {
    // The celebrant's own birthday or anniversary: their wishes, not
    // a card asking them to wish themselves.
    if (_isCelebrant(post, _session.user.id)) {
      return _CelebrantCard(
        key: key,
        post: post,
        onViewAll: () => _openComments(post.id),
      );
    }
    // The game draws its whole card itself — its own gradient, and the
    // viewer's own team — rather than sitting inside a standard post.
    if (post.type == ConnectPostType.relayGame) {
      return Padding(
        key: key,
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: RelayPostCard(post: post, session: _session),
      );
    }
    // Secret Squad's session for this office: its own animated card,
    // drawn whole like the relay's, with the way into the game.
    if (post.type == ConnectPostType.secretSquad) {
      return SecretSquadPostCard(key: key, post: post, session: _session);
    }
    // Sowaka Engagements launching a game: its own card, one way into the
    // game, and no likes or comments.
    if (post.type == ConnectPostType.gameLaunch) {
      return GameLaunchPostCard(key: key, post: post, session: _session);
    }
    return _ConnectPostCard(
      key: key,
      post: post,
      conversation: conversation,
      busy: state.busyPostId == post.id,
      canManage:
          post.author.userId.isNotEmpty &&
          post.author.userId == _session.user.id,
      onLike: () => _bloc.toggleReaction(post.id),
      // Not on the device's copy of the feed: its hearts may be out
      // of date, and the server flips whatever it holds.
      onDoubleTapLike: state.fromCache
          ? null
          : () => _bloc.likeFromDoubleTap(post.id),
      onComment: (text, mentions) =>
          _bloc.addComment(post.id, text, mentions: mentions),
      onAction: ({optionId}) =>
          _bloc.performAction(post.id, optionId: optionId),
      onSubmitCaption: (text, photoPath, taggedUserId) =>
          _bloc.submitCaption(
            post.id,
            text,
            photoPath: photoPath,
            taggedUserId: taggedUserId,
          ),
      onDeleteCaption: () => _bloc.deleteCaption(post.id),
      onVoteCaption: (entryId) => _bloc.voteCaption(post.id, entryId),
      onPlayGame: () => _openGame(post),
      onEdit: () => _editPost(post),
      onDelete: () => _confirmDelete(post),
      onReport: () => _reportContent(
        postId: post.id,
        authorName: post.author.name,
        isComment: false,
      ),
      onBlock: () => _confirmBlock(post.author.userId, post.author.name),
      onOpenComments: () => _openComments(post.id),
      viewerInitials: _viewerInitials,
      viewerColor: _viewerColor,
      viewerPhotoUrl: _viewerPhotoUrl,
      onOpenPerson: _onOpenPerson,
    );
  }

  Future<void> _confirmDelete(ConnectPost post) async {
    final confirmed = await showDialog<bool>(
      context: context,
      barrierColor: const Color(0x76000000),
      builder: (_) => _DeletePostSheet(
        title: 'Delete post?',
        body:
            'This will remove your ${post.tag.toLowerCase()} post from the company feed.',
      ),
    );
    if (confirmed == true) await _bloc.deletePost(post.id);
  }

  /// Asks why, then sends the report. Used for a post and for a single
  /// comment — the only difference is what the sheet says it is reporting.
  Future<void> _reportContent({
    required String postId,
    required String authorName,
    required bool isComment,
    String? commentId,
  }) async {
    final result = await showModalBottomSheet<_ReportOutcome>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) =>
          _ReportSheet(authorName: authorName, isComment: isComment),
    );
    if (!mounted || result == null) return;
    await _bloc.reportContent(
      postId,
      reason: result.reason,
      commentId: commentId,
      note: result.note,
    );
  }

  /// True when they were blocked.
  Future<bool> _confirmBlock(String userId, String name) async {
    if (userId.isEmpty) return false;
    final confirmed = await showDialog<bool>(
      context: context,
      barrierColor: const Color(0x76000000),
      builder: (_) => _BlockPersonSheet(name: name),
    );
    if (confirmed != true) return false;
    await _bloc.blockPerson(userId, name);
    return true;
  }

  /// The post's comments — on a birthday or anniversary, its wishes, with
  /// [initialText] in the box as a wish starts.
  Future<void> _openComments(String postId, {String initialText = ''}) {
    final post = _bloc.state.posts
        .where((item) => item.id == postId)
        .firstOrNull;
    if (post != null && _isCelebration(post.type)) {
      return _openWishes(post, initialText: initialText);
    }
    return showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _CommentsSheet(
        bloc: _bloc,
        postId: postId,
        people: _taggablePeople,
        viewerUserId: _session.user.id,
        viewerInitials: _viewerInitials,
        viewerColor: _viewerColor,
        viewerPhotoUrl: _viewerPhotoUrl,
        onReportComment: (comment) => _reportContent(
          postId: postId,
          authorName: comment.name,
          isComment: true,
          commentId: comment.id,
        ),
        onBlockCommenter: (comment) =>
            _confirmBlock(comment.userId, comment.name),
        onOpenPerson: _onOpenPerson,
      ),
    );
  }

  /// A birthday's or anniversary's wishes (frame 3886:93781). For the person
  /// it celebrates, opening them is seeing them: their card's "N new" goes,
  /// and anything that arrived while the sheet was up goes when it closes.
  Future<void> _openWishes(ConnectPost post, {String initialText = ''}) async {
    final celebrant = _isCelebrant(post, _session.user.id);
    if (celebrant) unawaited(_bloc.markWishesSeen(post.id));
    await showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _WishesSheet(
        bloc: _bloc,
        postId: post.id,
        initialText: initialText,
        people: _taggablePeople,
        viewerUserId: _session.user.id,
        viewerInitials: _viewerInitials,
        viewerColor: _viewerColor,
        viewerPhotoUrl: _viewerPhotoUrl,
        onReportComment: (comment) => _reportContent(
          postId: post.id,
          authorName: comment.name,
          isComment: true,
          commentId: comment.id,
        ),
        onBlockCommenter: (comment) =>
            _confirmBlock(comment.userId, comment.name),
        onOpenPerson: _onOpenPerson,
      ),
    );
    if (!celebrant || !mounted) return;
    final now = _bloc.state.posts
        .where((item) => item.id == post.id)
        .firstOrNull;
    final unseen = (now?.body['newWishCount'] as num?)?.toInt() ?? 0;
    if (unseen > 0) unawaited(_bloc.markWishesSeen(post.id));
  }

  Future<void> _openGame(ConnectPost post) async {
    final gameId = _bodyString(post, 'gameId');
    final hostedUrl = _bodyString(post, 'hostedUrl');
    if (gameId.isEmpty || hostedUrl.isEmpty) return;
    await _bloc.performAction(post.id);
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => GamePlayScreen(
          session: _session,
          gameId: gameId,
          title: _bodyString(post, 'title'),
          hostedUrl: hostedUrl,
        ),
      ),
    );
  }
}
