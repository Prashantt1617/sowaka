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
  });

  final ConnectLoadStatus status;
  final List<ConnectPost> posts;
  final String? error;
  final String? message;
  final String? busyPostId;

  factory ConnectState.initial() {
    return const ConnectState(status: ConnectLoadStatus.initial, posts: []);
  }

  ConnectState copyWith({
    ConnectLoadStatus? status,
    List<ConnectPost>? posts,
    String? error,
    String? message,
    String? busyPostId,
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

  Future<void> load() async {
    _emit(_state.copyWith(status: ConnectLoadStatus.loading, clearError: true));
    try {
      final posts = await _api.fetchFeed();
      _emit(ConnectState(status: ConnectLoadStatus.ready, posts: posts));
      _listenForChanges();
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

  Future<void> refresh() async {
    try {
      final posts = await _api.fetchFeed();
      _emit(_state.copyWith(status: ConnectLoadStatus.ready, posts: posts));
    } catch (error) {
      _emit(_state.copyWith(message: error.toString()));
    }
  }

  Future<void> toggleReaction(String postId) async {
    await _mutatePost(postId, () => _api.toggleReaction(postId));
  }

  Future<void> addComment(
    String postId,
    String text, {
    String? parentId,
  }) async {
    await _mutatePost(
      postId,
      () => _api.addComment(postId, text, parentId: parentId),
    );
  }

  Future<void> reactToComment(String postId, String commentId) async {
    await _mutatePost(postId, () => _api.reactToComment(postId, commentId));
  }

  Future<void> performAction(String postId, {String? optionId}) async {
    await _mutatePost(
      postId,
      () => _api.performAction(postId, optionId: optionId),
    );
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
