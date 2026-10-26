part of 'connect_feed_screen.dart';

/// The Posts tab on a profile (node 3965:54114): what the person has shared
/// in Connect, newest first, as the feed's own cards — 16 apart, each opened,
/// liked and commented on exactly as in the feed. Only what the viewer's feed
/// would show of theirs; the server sees to that.
///
/// The profile owns [bloc] (`ConnectComposerController.personPosts`) and has
/// it load when the page opens, so the tab's badge can say how many there are
/// before the tab is chosen. Older pages come as the profile scrolls near the
/// end of the ones loaded.
class PersonPostsTab extends StatefulWidget {
  const PersonPostsTab({
    super.key,
    required this.bloc,
    required this.session,
    this.feed,
    this.onOpenPerson,
  });

  final ConnectBloc bloc;
  final AuthSession session;

  /// The feed under the profile: its directory for tagging in comments, its
  /// composer for editing one's own post, and its list to keep in step. Null
  /// where there is none (tests); then nobody can be tagged and Edit does
  /// nothing.
  final ConnectComposerController? feed;

  /// Opens someone's profile from a name or face on a card.
  final ValueChanged<String>? onOpenPerson;

  @override
  State<PersonPostsTab> createState() => _PersonPostsTabState();
}

class _PersonPostsTabState extends State<PersonPostsTab>
    with _PostCardHost<PersonPostsTab> {
  /// Within this much of the end of what is loaded, the next page is asked
  /// for: about a card and a half, so it is usually there before it is needed.
  static const _loadAheadPx = 700.0;

  @override
  ConnectBloc get _bloc => widget.bloc;

  @override
  AuthSession get _session => widget.session;

  @override
  List<ConnectTeammate> get _taggablePeople => widget.feed?._people ?? const [];

  @override
  ValueChanged<String>? get _onOpenPerson => widget.onOpenPerson;

  @override
  void _editPost(ConnectPost post) =>
      unawaited(widget.feed?._editPost(post, alsoIn: _bloc));

  @override
  Future<bool> _confirmBlock(String userId, String name) async {
    final blocked = await super._confirmBlock(userId, name);
    if (blocked) widget.feed?._refresh();
    return blocked;
  }

  /// The profile's own scroll, which this tab sits inside rather than having
  /// one of its own.
  ScrollPosition? _scroll;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final position = Scrollable.maybeOf(context)?.position;
    if (identical(position, _scroll)) return;
    _scroll?.removeListener(_loadMoreIfNearEnd);
    _scroll = position?..addListener(_loadMoreIfNearEnd);
  }

  @override
  void dispose() {
    _scroll?.removeListener(_loadMoreIfNearEnd);
    super.dispose();
  }

  /// The bloc ignores this while a page is on its way, at the end, or after
  /// a failed page — then the retry row asks instead.
  void _loadMoreIfNearEnd() {
    final position = _scroll;
    if (position == null || !position.hasContentDimensions) return;
    if (position.extentAfter < _loadAheadPx) unawaited(_bloc.loadMore());
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<ConnectState>(
      stream: _bloc.stream,
      initialData: _bloc.state,
      builder: (context, snapshot) {
        final state = snapshot.data ?? _bloc.state;
        // What a like, a comment or a report has to say, as the feed says it.
        if (state.message case final message?) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted || _bloc.state.message != message) return;
            showAppToast(context, message);
            _bloc.clearMessage();
          });
        }
        if (state.posts.isEmpty) return _withoutPosts(state);
        // A short first page may not fill the screen, so nothing would
        // scroll to ask for the next one.
        if (state.hasMore) {
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => mounted ? _loadMoreIfNearEnd() : null,
          );
        }
        return _FeedScope(
          bloc: _bloc,
          people: _taggablePeople,
          viewerUserId: _session.user.id,
          onOpenPerson: _onOpenPerson,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (index, post) in state.posts.indexed) ...[
                // 16 between cards (node 3965:54114), not the feed's 24.
                if (index > 0) const SizedBox(height: 16),
                // Only the likes and comments row under each (node
                // 3965:56279): the comments open in their sheet, as in the
                // feed.
                _postCard(
                  post,
                  state,
                  key: ValueKey(post.id),
                  conversation: false,
                ),
              ],
              if (state.hasMore) _nextPage(state),
            ],
          ),
        );
      },
    );
  }

  /// Loading, a failure with its own retry, or nothing posted yet. A failure
  /// here is this tab's alone: the rest of the profile is unaffected.
  Widget _withoutPosts(ConnectState state) {
    switch (state.status) {
      case ConnectLoadStatus.initial || ConnectLoadStatus.loading:
        return const Padding(
          padding: EdgeInsets.symmetric(vertical: 28),
          child: Center(
            child: SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: _ConnectColors.terra,
              ),
            ),
          ),
        );
      case ConnectLoadStatus.failure:
        return ProfileEmptyNote(
          state.error ?? 'Could not load these posts.',
          onRetry: _bloc.load,
        );
      case ConnectLoadStatus.ready:
        return const ProfileEmptyNote('No posts yet.');
    }
  }

  /// Under the last card while older posts exist: a spinner while the next
  /// page comes, or the feed's own retry when it did not.
  Widget _nextPage(ConnectState state) {
    if (state.loadMoreFailed) {
      return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Center(
          child: TextButton(
            onPressed: _bloc.retryLoadMore,
            child: const Text(
              'Could not load more. Tap to retry.',
              style: TextStyle(
                color: _ConnectColors.terra,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
      );
    }
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 18),
      child: Center(
        child: SizedBox(
          width: 22,
          height: 22,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            color: _ConnectColors.terra,
          ),
        ),
      ),
    );
  }
}
