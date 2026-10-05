import 'dart:async';

import '../../auth/data/auth_models.dart';
import '../data/connect_api_service.dart';
import '../data/connect_models.dart';
import '../data/connect_socket_service.dart';

enum ConnectLoadStatus { initial, loading, ready, failure }

class ConnectState {
  const ConnectState({
    required this.status,
    required this.posts,
    this.error,
    this.message,
    this.busyPostId,
    this.hasMore = false,
    this.loadingMore = false,
  });

  final ConnectLoadStatus status;
  final List<ConnectPost> posts;
  final String? error;
  final String? message;
  final String? busyPostId;

  /// Older posts exist beyond what is loaded; the list asks for them as it
  /// nears its end.
  final bool hasMore;
  final bool loadingMore;

  factory ConnectState.initial() {
    return const ConnectState(status: ConnectLoadStatus.initial, posts: []);
  }

  ConnectState copyWith({
    ConnectLoadStatus? status,
    List<ConnectPost>? posts,
    String? error,
    String? message,
    String? busyPostId,
    bool? hasMore,
    bool? loadingMore,
    bool clearError = false,
    bool clearMessage = false,
    bool clearBusy = false,
  }) {
    return ConnectState(
      status: status ?? this.status,
      posts: posts ?? this.posts,
      error: clearError ? null : error ?? this.error,
      message: clearMessage ? null : message ?? this.message,
      busyPostId: clearBusy ? null : busyPostId ?? this.busyPostId,
      hasMore: hasMore ?? this.hasMore,
      loadingMore: loadingMore ?? this.loadingMore,
    );
  }
}

class ConnectBloc {
  ConnectBloc({
    required AuthSession session,
    ConnectApiService? api,
    ConnectSocketService? socket,
  }) : _session = session,
       _api = api ?? ConnectApiService(session: session),
       _socket = socket ?? ConnectSocketService(session: session);

  final AuthSession _session;
  final ConnectApiService _api;
  final ConnectSocketService _socket;
  final _controller = StreamController<ConnectState>.broadcast();
  ConnectState _state = ConnectState.initial();
  StreamSubscription<ConnectChange>? _changeSub;
  StreamSubscription<void>? _reconnectSub;

  Stream<ConnectState> get stream => _controller.stream;
  ConnectState get state => _state;

  /// Five posts a page: the first page is on screen before the rest is
  /// asked for, and the rest comes as the reader scrolls.
  static const pageSize = 5;

  /// Where the next page starts; null at the end of the feed.
  String? _cursor;

  Future<void> load() async {
    _emit(_state.copyWith(status: ConnectLoadStatus.loading, clearError: true));
    try {
      final page = await _api.fetchFeed(limit: pageSize);
      _cursor = page.nextCursor;
      _emit(ConnectState(
        status: ConnectLoadStatus.ready,
        posts: page.posts,
        hasMore: page.nextCursor != null,
      ));
      _listenForChanges();
      // The second page is asked for as soon as the first is on screen, so
      // the first scroll never waits on a spinner.
      unawaited(loadMore());
    } catch (error) {
      _emit(
        _state.copyWith(
          status: ConnectLoadStatus.failure,
          error: error.toString(),
        ),
      );
    }
  }

  void _listenForChanges() {
    if (_changeSub != null) return;
    _changeSub = _socket.changes.listen(_applyChange);
    // A dropped socket means missed events, so resync the whole feed once the
    // connection comes back rather than trusting incremental updates alone.
    _reconnectSub = _socket.reconnects.listen((_) => unawaited(refresh()));
    _socket.connect();
  }

  Future<void> _applyChange(ConnectChange change) async {
    // My own actions already updated state from the REST response.
    if (change.actorUserId == _session.user.id) return;
    if (change.action == ConnectChangeAction.deleted) {
      _emit(
        _state.copyWith(
          posts: _state.posts
              .where((post) => post.id != change.postId)
              .toList(),
        ),
      );
      return;
    }
    try {
      final post = await _api.fetchPost(change.postId);
      if (_controller.isClosed) return;
      final index = _state.posts.indexWhere((item) => item.id == post.id);
      final posts = [..._state.posts];
      if (index >= 0) {
        posts[index] = post;
      } else {
        posts.insert(0, post);
      }
      _emit(_state.copyWith(posts: posts));
    } catch (_) {
      // A post we can't fetch (deleted or not visible to us) just stays as-is;
      // the next reconnect or manual refresh reconciles the feed.
    }
  }

  /// Back to the top of the feed: the first page again, older pages dropped
  /// until the reader scrolls for them.
  Future<void> refresh() async {
    try {
      final page = await _api.fetchFeed(limit: pageSize);
      _cursor = page.nextCursor;
      _emit(_state.copyWith(
        status: ConnectLoadStatus.ready,
        posts: page.posts,
        hasMore: page.nextCursor != null,
        loadingMore: false,
      ));
    } catch (error) {
      _emit(_state.copyWith(message: error.toString()));
    }
  }

  /// The next page, appended. A no-op while one is already on its way or
  /// there is nothing older.
  Future<void> loadMore() async {
    final cursor = _cursor;
    if (cursor == null || _state.loadingMore || !_state.hasMore) return;
    _emit(_state.copyWith(loadingMore: true));
    try {
      final page = await _api.fetchFeed(limit: pageSize, cursor: cursor);
      if (_controller.isClosed) return;
      // A refresh in the meantime moved the cursor on; this page is stale.
      if (_cursor != cursor) return;
      _cursor = page.nextCursor;
      final known = _state.posts.map((post) => post.id).toSet();
      _emit(_state.copyWith(
        posts: [
          ..._state.posts,
          ...page.posts.where((post) => !known.contains(post.id)),
        ],
        hasMore: page.nextCursor != null,
        loadingMore: false,
      ));
    } catch (error) {
      if (_controller.isClosed) return;
      _emit(_state.copyWith(loadingMore: false, message: error.toString()));
    }
  }

  /// A like shows at once: the heart fills and the count moves before the
  /// request leaves the device. The server's copy of the post replaces the
  /// guess when it arrives; if the request fails, the guess is undone.
  Future<void> toggleReaction(String postId) async {
    await _mutateOptimistically(
      postId,
      (post) => post.copyWith(
        liked: !post.liked,
        likeCount: post.liked
            ? (post.likeCount - 1).clamp(0, 1 << 30)
            : post.likeCount + 1,
      ),
      () => _api.toggleReaction(postId),
    );
  }

  /// The comment appears in the thread the moment it is sent, under the
  /// viewer's own name, and is swapped for the server's copy when that lands.
  Future<void> addComment(
    String postId,
    String text, {
    String? parentId,
  }) async {
    final user = _session.user;
    final pending = ConnectComment(
      id: 'pending-${DateTime.now().microsecondsSinceEpoch}',
      userId: user.id,
      name: user.name,
      text: text,
      createdAt: DateTime.now(),
      parentId: parentId,
      photoUrl: user.profilePhotoUrl,
    );
    await _mutateOptimistically(
      postId,
      (post) => post.copyWith(
        commentCount: post.commentCount + 1,
        comments: [...post.comments, pending],
      ),
      () => _api.addComment(postId, text, parentId: parentId),
    );
  }

  Future<void> reactToComment(String postId, String commentId) async {
    await _mutateOptimistically(
      postId,
      (post) => post.copyWith(
        comments: [
          for (final comment in post.comments)
            if (comment.id == commentId)
              comment.copyWith(
                liked: !comment.liked,
                likeCount: comment.liked
                    ? (comment.likeCount - 1).clamp(0, 1 << 30)
                    : comment.likeCount + 1,
              )
            else
              comment,
        ],
      ),
      () => _api.reactToComment(postId, commentId),
    );
  }

  Future<void> performAction(String postId, {String? optionId}) async {
    await _mutatePost(
      postId,
      () => _api.performAction(postId, optionId: optionId),
    );
  }

  Future<void> submitCaption(
    String postId,
    String text, {
    String? photoPath,
    String? taggedUserId,
  }) async {
    await _mutatePost(
      postId,
      () => _api.submitCaption(
        postId,
        text,
        photoPath: photoPath,
        taggedUserId: taggedUserId,
      ),
    );
  }

  Future<void> deleteCaption(String postId) async {
    await _mutatePost(postId, () => _api.deleteCaption(postId));
  }

  Future<void> voteCaption(String postId, String entryId) async {
    await _mutatePost(postId, () => _api.voteCaption(postId, entryId));
  }

  Future<bool> createPost(ConnectPostDraft draft) async {
    _emit(_state.copyWith(busyPostId: '__create__', clearMessage: true));
    try {
      final post = await _api.createPost(draft);
      _emit(
        _state.copyWith(
          posts: [post, ..._state.posts],
          message: 'Post published',
          busyPostId: null,
          clearBusy: true,
        ),
      );
      return true;
    } catch (error) {
      _emit(
        _state.copyWith(
          message: error.toString(),
          busyPostId: null,
          clearBusy: true,
        ),
      );
      return false;
    }
  }

  Future<bool> updatePost(String postId, ConnectPostDraft draft) async {
    _emit(_state.copyWith(busyPostId: postId, clearMessage: true));
    try {
      final post = await _api.updatePost(postId, draft);
      _emit(
        _state.copyWith(
          posts: _replacePost(post),
          message: 'Post updated',
          busyPostId: null,
          clearBusy: true,
        ),
      );
      return true;
    } catch (error) {
      _emit(
        _state.copyWith(
          message: error.toString(),
          busyPostId: null,
          clearBusy: true,
        ),
      );
      return false;
    }
  }

  Future<void> deletePost(String postId) async {
    _emit(_state.copyWith(busyPostId: postId, clearMessage: true));
    try {
      await _api.deletePost(postId);
      _emit(
        _state.copyWith(
          posts: _state.posts.where((post) => post.id != postId).toList(),
          message: 'Post deleted',
          busyPostId: null,
          clearBusy: true,
        ),
      );
    } catch (error) {
      _emit(
        _state.copyWith(
          message: error.toString(),
          busyPostId: null,
          clearBusy: true,
        ),
      );
    }
  }

  /// Sends a report to HR. The feed is untouched — reporting something does
  /// not hide it, and saying otherwise would be a promise the app can't keep.
  Future<void> reportContent(
    String postId, {
    required ConnectReportReason reason,
    String? commentId,
    String? note,
  }) async {
    try {
      final isNew = await _api.reportContent(
        postId,
        reason: reason,
        commentId: commentId,
        note: note,
      );
      _emit(
        _state.copyWith(
          message: isNew
              ? 'Reported. Your HR team will review it.'
              : 'You have already reported this — HR is looking at it.',
        ),
      );
    } catch (error) {
      _emit(_state.copyWith(message: error.toString()));
    }
  }

  /// Mutes a colleague, then drops what they wrote out of the loaded feed so
  /// the change is visible immediately rather than at the next refresh.
  Future<void> blockPerson(String userId, String name) async {
    try {
      await _api.blockPerson(userId);
      _emit(
        _state.copyWith(
          posts: _state.posts
              .where((post) => post.author.userId != userId)
              .toList(),
          message: "You won't see $name's posts in Connect.",
        ),
      );
      // Their comments live inside posts that stay, so those come back
      // filtered from the server.
      await refresh();
    } catch (error) {
      _emit(_state.copyWith(message: error.toString()));
    }
  }

  void clearMessage() {
    _emit(_state.copyWith(clearMessage: true));
  }

  /// Applies `guess` to the post straight away, without marking it busy, then
  /// sends the request. The post is swapped for the server's version on
  /// success and put back as it was on failure, so the feed never waits on
  /// the network for a like or a comment.
  Future<void> _mutateOptimistically(
    String postId,
    ConnectPost Function(ConnectPost post) guess,
    Future<ConnectPost> Function() request,
  ) async {
    final index = _state.posts.indexWhere((post) => post.id == postId);
    if (index < 0) return;
    final before = _state.posts[index];
    final posts = [..._state.posts]..[index] = guess(before);
    _emit(_state.copyWith(posts: posts, clearMessage: true));
    try {
      final post = await request();
      if (_controller.isClosed) return;
      _emit(_state.copyWith(posts: _replacePost(post)));
    } catch (error) {
      if (_controller.isClosed) return;
      // Undo only if nothing else has replaced the post in the meantime.
      final current = _state.posts.indexWhere((post) => post.id == postId);
      final rolledBack = [..._state.posts];
      if (current >= 0 && rolledBack[current].id == posts[index].id) {
        rolledBack[current] = before;
      }
      _emit(_state.copyWith(posts: rolledBack, message: error.toString()));
    }
  }

  Future<void> _mutatePost(
    String postId,
    Future<ConnectPost> Function() request,
  ) async {
    _emit(_state.copyWith(busyPostId: postId, clearMessage: true));
    try {
      final post = await request();
      _emit(
        _state.copyWith(
          posts: _replacePost(post),
          busyPostId: null,
          clearBusy: true,
        ),
      );
    } catch (error) {
      _emit(
        _state.copyWith(
          message: error.toString(),
          busyPostId: null,
          clearBusy: true,
        ),
      );
    }
  }

  List<ConnectPost> _replacePost(ConnectPost updated) {
    return _state.posts
        .map((post) => post.id == updated.id ? updated : post)
        .toList();
  }

  void _emit(ConnectState state) {
    _state = state;
    if (!_controller.isClosed) _controller.add(state);
  }

  void dispose() {
    _changeSub?.cancel();
    _reconnectSub?.cancel();
    _socket.dispose();
    _controller.close();
  }
}
