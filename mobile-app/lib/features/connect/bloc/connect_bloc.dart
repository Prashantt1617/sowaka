import 'dart:async';

import '../../auth/data/auth_models.dart';
import '../data/connect_api_service.dart';
import '../data/connect_models.dart';

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
  ConnectBloc({required AuthSession session, ConnectApiService? api})
    : _api = api ?? ConnectApiService(session: session);

  final ConnectApiService _api;
  final _controller = StreamController<ConnectState>.broadcast();
  ConnectState _state = ConnectState.initial();

  Stream<ConnectState> get stream => _controller.stream;
  ConnectState get state => _state;

  Future<void> load() async {
    _emit(_state.copyWith(status: ConnectLoadStatus.loading, clearError: true));
    try {
      final posts = await _api.fetchFeed();
      _emit(ConnectState(status: ConnectLoadStatus.ready, posts: posts));
    } catch (error) {
      _emit(
        _state.copyWith(
          status: ConnectLoadStatus.failure,
          error: error.toString(),
        ),
      );
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
    _controller.close();
  }
}
