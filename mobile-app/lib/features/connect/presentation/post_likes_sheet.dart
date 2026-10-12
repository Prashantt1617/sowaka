part of 'connect_feed_screen.dart';

// Who liked a post, as Instagram lists them: a sheet that opens part way and
// drags to full, "Likes" across the top, then a face, a name and the
// department for each person, latest like first. A row opens that person's
// profile. It reads the list fresh each time it opens, and again whenever the
// post's likes change while it is up.

/// Opens the likes list for [post] from wherever its like count is drawn.
/// Needs the feed around it, for the bloc and the way to a profile.
Future<void> _openPostLikes(BuildContext context, ConnectPost post) async {
  final scope = _FeedScope.of(context);
  if (scope == null) return;
  await showModalBottomSheet<void>(
    context: context,
    useSafeArea: true,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _PostLikesSheet(
      bloc: scope.bloc,
      postId: post.id,
      onOpenPerson: scope.onOpenPerson,
    ),
  );
}

class _PostLikesSheet extends StatefulWidget {
  const _PostLikesSheet({
    required this.bloc,
    required this.postId,
    this.onOpenPerson,
  });

  final ConnectBloc bloc;
  final String postId;

  /// Opens a profile. The sheet is its own route, outside the feed, so it is
  /// handed in rather than looked up. Null where the host cannot navigate.
  final ValueChanged<String>? onOpenPerson;

  @override
  State<_PostLikesSheet> createState() => _PostLikesSheetState();
}

class _PostLikesSheetState extends State<_PostLikesSheet> {
  StreamSubscription<ConnectState>? _changes;

  List<ConnectAuthor>? _likes;
  bool _failed = false;

  /// Only the latest read lands; an older one still in flight is dropped.
  int _request = 0;

  /// The post's likes as last read, to tell when they change.
  ({int count, bool liked})? _seen;

  /// The post as last seen, and whether a reaction is on its way to the
  /// server: the list is read again when the server's copy lands, or the
  /// read made on the tap could be one like short.
  ConnectPost? _seenPost;
  bool _awaitingServer = false;

  @override
  void initState() {
    super.initState();
    _seen = _likeStateIn(widget.bloc.state);
    _seenPost = _postIn(widget.bloc.state);
    _changes = widget.bloc.stream.listen((state) {
      final post = _postIn(state);
      final now = _likeStateIn(state);
      if (post == null || now == null || identical(post, _seenPost)) return;
      _seenPost = post;
      if (now != _seen) {
        // The tap's own guess shows first; the server's answer follows.
        _seen = now;
        _awaitingServer = true;
        _load();
      } else if (_awaitingServer) {
        _awaitingServer = false;
        _load();
      }
    });
    _load();
  }

  @override
  void dispose() {
    _changes?.cancel();
    super.dispose();
  }

  ConnectPost? _postIn(ConnectState state) =>
      state.posts.where((item) => item.id == widget.postId).firstOrNull;

  ({int count, bool liked})? _likeStateIn(ConnectState state) {
    final post = _postIn(state);
    return post == null ? null : (count: post.likeCount, liked: post.liked);
  }

  Future<void> _load() async {
    final request = ++_request;
    // A list already up stays while it refreshes; only a first read or a
    // retry shows the placeholder rows.
    if (_failed) setState(() => _failed = false);
    try {
      final likes = await widget.bloc.fetchPostLikes(widget.postId);
      if (!mounted || request != _request) return;
      setState(() => _likes = likes);
    } catch (_) {
      if (!mounted || request != _request) return;
      setState(() => _failed = true);
    }
  }

  void _open(String userId) {
    final open = widget.onOpenPerson;
    if (open == null) return;
    Navigator.of(context).pop();
    open(userId);
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.35,
      maxChildSize: 1,
      expand: false,
      builder: (context, scrollController) {
        return Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
          child: Container(
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
              boxShadow: [
                BoxShadow(color: Color(0x1F000000), blurRadius: 16, offset: Offset(0, -4)),
              ],
            ),
            child: Column(
              children: [
                const Padding(
                  padding: EdgeInsets.only(top: 12, bottom: 4),
                  child: Center(
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
                ),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                  decoration: const BoxDecoration(
                    border: Border(bottom: BorderSide(color: Color(0xFFF3F4F6))),
                  ),
                  child: const Text(
                    'Likes',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Color(0xFF222222),
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      letterSpacing: -0.16,
                    ),
                  ),
                ),
                Expanded(child: _body(scrollController)),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _body(ScrollController scrollController) {
    final likes = _likes;
    if (_failed && likes == null) {
      return _LikesMessage(
        controller: scrollController,
        text: "Couldn't load likes.",
        action: TextButton(onPressed: _load, child: const Text('Retry')),
      );
    }
    if (likes == null) return _LikesSkeleton(controller: scrollController);
    if (likes.isEmpty) {
      return _LikesMessage(controller: scrollController, text: 'No likes yet');
    }
    return ListView.builder(
      controller: scrollController,
      padding: const EdgeInsets.only(top: 8, bottom: 24),
      itemCount: likes.length,
      itemBuilder: (context, index) {
        final person = likes[index];
        return _PersonTap(
          userId: person.userId,
          onOpenPerson: widget.onOpenPerson == null ? null : _open,
          child: _LikeRow(person: person),
        );
      },
    );
  }
}

/// One person who liked the post: their face, their name, their department.
class _LikeRow extends StatelessWidget {
  const _LikeRow({required this.person});

  final ConnectAuthor person;

  @override
  Widget build(BuildContext context) {
    final department = person.department.trim();
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      child: Row(
        children: [
          _InitialAvatar(
            initials: person.initials,
            color: _hexColor(person.avatarColor, _ConnectColors.terra),
            size: 44,
            photoUrl: person.photoUrl ?? '',
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  person.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF222222),
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (department.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      department,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Color(0xFF717171), fontSize: 13),
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

/// A line in place of the list — nothing to show, or it did not load — that
/// still drags the sheet like the list would.
class _LikesMessage extends StatelessWidget {
  const _LikesMessage({required this.controller, required this.text, this.action});

  final ScrollController controller;
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return ListView(
      controller: controller,
      padding: const EdgeInsets.fromLTRB(20, 48, 20, 24),
      children: [
        Text(
          text,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: _ConnectColors.faint,
            fontSize: 13.5,
            fontWeight: FontWeight.w600,
          ),
        ),
        if (action case final action?) Center(child: action),
      ],
    );
  }
}

/// Grey rows that pulse where the people will be, while the list loads.
class _LikesSkeleton extends StatefulWidget {
  const _LikesSkeleton({required this.controller});

  final ScrollController controller;

  @override
  State<_LikesSkeleton> createState() => _LikesSkeletonState();
}

class _LikesSkeletonState extends State<_LikesSkeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Loading likes',
      child: AnimatedBuilder(
        animation: _pulse,
        builder: (context, _) {
          final shade = Color.lerp(const Color(0xFFF0F0F3), const Color(0xFFE4E4EA), _pulse.value)!;
          Widget bar(double width) => Container(
            width: width,
            height: 10,
            decoration: BoxDecoration(color: shade, borderRadius: BorderRadius.circular(99)),
          );
          return ListView.builder(
            controller: widget.controller,
            physics: const NeverScrollableScrollPhysics(),
            padding: const EdgeInsets.only(top: 4),
            itemCount: 6,
            itemBuilder: (context, index) => Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(color: shade, shape: BoxShape.circle),
                  ),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      bar(index.isEven ? 140 : 110),
                      const SizedBox(height: 8),
                      bar(index.isEven ? 90 : 120),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
