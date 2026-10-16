part of 'connect_feed_screen.dart';

// A contest's entries opened from outside the feed — a live contest card on
// the Games tab — as a page over wherever it was opened: the same Entries
// page the feed's "View Entries" opens, and Back returns to where it came
// from rather than to the feed.
//
// It works on the Connect feed's own bloc when the feed already holds the
// contest, so a vote cast here shows on the feed's card too. Otherwise it
// reads the contest into a bloc of its own, which goes when the page does.
//
// "Add your answer", "Add your photo" and "Nominate" open the contest's card
// as a page over the Entries page, with its answer box ready (the photo
// picked first) — the feed's own card and box, on the same tab. Once the
// entry has gone, the card page closes and the Entries page is there again,
// with the entry on it; Back from there returns to where it all started.
// The flow never leaves the tab it was opened on.

/// Opens the Entries page for contest [postId] as a page over [context].
/// Completes when the person is back where they were.
///
/// [feed] is the shell's Connect composer controller, through which the
/// feed's bloc and its directory of colleagues are reached; [onOpenPerson]
/// opens a profile, falling back to the feed's own way of doing it. [api] is
/// for tests: the server the page's own bloc talks to, when it needs one.
Future<void> openContestEntries(
  BuildContext context,
  AuthSession session,
  String postId, {
  ConnectComposerController? feed,
  ValueChanged<String>? onOpenPerson,
  @visibleForTesting ConnectApiService? api,
}) async {
  final navigator = Navigator.of(context);
  final flow = _ContestFlow(
    session: session,
    postId: postId,
    feed: feed?._state,
    onOpenPerson: onOpenPerson,
    api: api,
  );
  try {
    // The Entries page is the feed's, and it closes itself before it asks
    // for an entry: from the feed, the contest's card is right behind it.
    // Here nothing is, so a page just like it is put straight back in its
    // place — without a transition, so nothing is seen to move — and the
    // card page opens over that. When the card page closes (the entry sent,
    // or the person backed out), it is the Entries page that is showing.
    var addEntry = false;
    Future<void> showEntries({required bool first}) => navigator.push<void>(
      _EntriesPageRoute(
        instant: !first,
        builder: (_) => _ContestEntriesPage(
          flow: flow,
          readOnOpen: first,
          onAddEntry: () async {
            addEntry = true;
          },
        ),
      ),
    );
    var entries = showEntries(first: true);
    while (true) {
      await entries;
      if (!addEntry || !navigator.mounted) break;
      addEntry = false;
      entries = showEntries(first: false);
      await navigator.push<void>(
        MaterialPageRoute(builder: (_) => _ContestCardPage(flow: flow, compose: true)),
      );
      // Whatever came of it, the page shows the contest as the server has
      // it now; the bloc already holds the entry that was just sent.
      unawaited(flow.load());
    }
  } finally {
    flow.dispose();
  }
}

/// The Entries page's route. [instant] when the page is put back in the
/// place of one that has just closed itself, so that it appears at once over
/// the one going; it still goes with the usual transition.
class _EntriesPageRoute extends MaterialPageRoute<void> {
  _EntriesPageRoute({required super.builder, this.instant = false});

  final bool instant;

  @override
  Duration get transitionDuration => instant ? Duration.zero : super.transitionDuration;

  @override
  Duration get reverseTransitionDuration => super.transitionDuration;
}

/// What the Entries page and the card page opened from it share: the bloc
/// the contest lives in, the colleagues for a nomination, and the way to a
/// profile.
class _ContestFlow {
  _ContestFlow({
    required this.session,
    required this.postId,
    _ConnectFeedScreenState? feed,
    ValueChanged<String>? onOpenPerson,
    ConnectApiService? api,
  }) {
    final live = feed != null && feed.mounted ? feed : null;
    final feedBloc = live?._bloc;
    // The feed's bloc only when the contest is already in the feed: one
    // further down than it has loaded would otherwise be put on top of it.
    if (feedBloc != null && feedBloc.state.posts.any((post) => post.id == postId)) {
      bloc = feedBloc;
      ownsBloc = false;
    } else {
      bloc = ConnectBloc(session: session, api: api);
      ownsBloc = true;
    }
    people = ValueNotifier(live?._taggablePeople ?? const []);
    this.onOpenPerson = onOpenPerson ?? live?.widget.onOpenPerson;
    if (people.value.isEmpty) _loadPeople();
  }

  final AuthSession session;
  final String postId;
  late final ConnectBloc bloc;
  late final bool ownsBloc;
  late final ValueNotifier<List<ConnectTeammate>> people;
  late final ValueChanged<String>? onOpenPerson;
  bool _disposed = false;

  /// The contest as the bloc holds it now; null until it has been read.
  ConnectPost? get post =>
      bloc.state.posts.where((item) => item.id == postId).firstOrNull;

  /// Reads the contest fresh. True when there is a copy to show.
  Future<bool> load() async {
    if (_disposed) return false;
    return bloc.ensurePost(postId, keepOnTop: false);
  }

  /// Everyone in the company, for a Most Likely nomination, when the feed had
  /// no list to lend.
  Future<void> _loadPeople() async {
    try {
      final result = await AuthApiService().fetchTeammates(session.token, limit: 500);
      if (_disposed) return;
      people.value = [
        for (final person in result.teammates)
          ConnectTeammate(
            userId: person.userId,
            name: person.name,
            initials: person.initials,
            department: person.roleLine,
            photoUrl: person.photoUrl,
          ),
      ];
    } catch (_) {
      // A nomination can still be typed in full; the list is a convenience.
    }
  }

  void dispose() {
    _disposed = true;
    if (ownsBloc) bloc.dispose();
    people.dispose();
  }
}

/// Shows what the bloc has to say — an entry that did not go, a vote that
/// failed — when the bloc is the page's own; the feed says it for its own.
mixin _FlowMessages<T extends StatefulWidget> on State<T> {
  _ContestFlow get flow;
  StreamSubscription<ConnectState>? _messages;

  void listenForMessages() {
    if (!flow.ownsBloc) return;
    _messages = flow.bloc.stream.listen((state) {
      final message = state.message;
      if (!mounted || message == null) return;
      showAppToast(context, message);
      flow.bloc.clearMessage();
    });
  }

  @override
  void dispose() {
    _messages?.cancel();
    super.dispose();
  }
}

/// The Entries page for a contest opened from outside the feed: the
/// contest's own page once it is read, the page's top bar over a spinner
/// until then, and over a Retry if it cannot be read.
class _ContestEntriesPage extends StatefulWidget {
  const _ContestEntriesPage({
    required this.flow,
    required this.onAddEntry,
    this.readOnOpen = true,
  });

  final _ContestFlow flow;
  final Future<void> Function() onAddEntry;

  /// Reads the contest fresh as the page opens. Off for a page put back in
  /// the place of one that has just read it; it still reads when the bloc
  /// has nothing to show.
  final bool readOnOpen;

  @override
  State<_ContestEntriesPage> createState() => _ContestEntriesPageState();
}

class _ContestEntriesPageState extends State<_ContestEntriesPage> with _FlowMessages {
  @override
  _ContestFlow get flow => widget.flow;

  bool _loading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    listenForMessages();
    if (widget.readOnOpen || flow.post == null) {
      _load();
    } else {
      _loading = false;
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _failed = false;
    });
    final ok = await flow.load();
    if (!mounted) return;
    setState(() {
      _loading = false;
      _failed = !ok;
    });
  }

  @override
  Widget build(BuildContext context) {
    final post = flow.post;
    if (post != null) {
      return ValueListenableBuilder<List<ConnectTeammate>>(
        valueListenable: flow.people,
        builder: (context, people, _) => _FeedScope(
          bloc: flow.bloc,
          people: people,
          viewerUserId: flow.session.user.id,
          onOpenPerson: flow.onOpenPerson,
          child: _EntriesSheet(
            bloc: flow.bloc,
            initialPost: post,
            people: people,
            viewerUserId: flow.session.user.id,
            onOpenPerson: flow.onOpenPerson,
            onAddEntry: widget.onAddEntry,
          ),
        ),
      );
    }
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _EntriesTopBar(onBack: () => Navigator.of(context).maybePop()),
            Expanded(
              child: Center(
                child: _loading && !_failed
                    ? const SizedBox(
                        width: 28,
                        height: 28,
                        child: CircularProgressIndicator(strokeWidth: 2.5, color: _sheetPurple),
                      )
                    : Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text(
                            "Couldn't load this contest.",
                            style: TextStyle(color: _sheetMuted, fontSize: 14, fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: 8),
                          TextButton(onPressed: _load, child: const Text('Retry')),
                        ],
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The contest's card on a page of its own, over the Entries page, for
/// adding an entry: the card the feed shows, with its answer box opened as
/// the feed's card opens it. On [compose], the page is the entry's composer:
/// the box opens as the page appears (the photo picked first), and the page
/// closes once the entry has gone — or at once, when the photo picker is
/// backed out of, since there is then nothing to compose. An entry that did
/// not go keeps the page, and what was written, for another try; the bloc
/// has said why.
class _ContestCardPage extends StatefulWidget {
  const _ContestCardPage({required this.flow, this.compose = false});

  final _ContestFlow flow;

  /// Opens the answer box as the page appears, and closes the page once the
  /// entry has gone.
  final bool compose;

  @override
  State<_ContestCardPage> createState() => _ContestCardPageState();
}

class _ContestCardPageState extends State<_ContestCardPage> with _FlowMessages {
  @override
  _ContestFlow get flow => widget.flow;

  final _cardKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    listenForMessages();
    if (widget.compose) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _startComposing();
      });
    }
  }

  /// Opens the card's answer box as the feed's card does. The card does the
  /// asking — for a photo contest, the picker first — and if nothing came
  /// of it (the picker backed out of, the contest closed meanwhile), the
  /// page closes again onto the entries.
  Future<void> _startComposing() async {
    final card = _engagementState(_cardKey.currentContext);
    if (card == null) return;
    await card._startAnswer();
    if (mounted && !card._answering) Navigator.of(context).pop();
  }

  /// Sends the entry through the bloc; the page closes once it has gone.
  Future<bool> _submitEntry(ConnectPost post, String text, String? photoPath, String? taggedUserId) async {
    final sent = await flow.bloc.submitCaption(
      post.id,
      text,
      photoPath: photoPath,
      taggedUserId: taggedUserId,
    );
    if (sent && widget.compose && mounted) Navigator.of(context).pop();
    return sent;
  }

  /// The card's own state, found under [root]: the card is the feed's, and
  /// it opens its answer box itself.
  _EngagementBodyState? _engagementState(BuildContext? root) {
    _EngagementBodyState? found;
    void visit(Element element) {
      if (found != null) return;
      if (element is StatefulElement && element.state is _EngagementBodyState) {
        found = element.state as _EngagementBodyState;
        return;
      }
      element.visitChildren(visit);
    }

    root?.visitChildElements(visit);
    return found;
  }

  Future<void> _edit(ConnectPost post) async {
    final result = await Navigator.of(context).push<ContestDraft>(
      MaterialPageRoute(builder: (_) => ContestComposerPage(existing: post)),
    );
    if (!mounted || result == null) return;
    await flow.bloc.updatePost(post.id, await result.toPostDraft());
  }

  Future<void> _delete(ConnectPost post) async {
    final confirmed = await showDialog<bool>(
      context: context,
      barrierColor: const Color(0x76000000),
      builder: (_) => _DeletePostSheet(
        title: 'Delete post?',
        body: 'This will remove your ${post.tag.toLowerCase()} post from the company feed.',
      ),
    );
    if (confirmed != true || !mounted) return;
    await flow.bloc.deletePost(post.id);
    if (mounted) Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<ConnectState>(
      stream: flow.bloc.stream,
      initialData: flow.bloc.state,
      builder: (context, _) {
        final post = flow.post;
        return Scaffold(
          backgroundColor: _ConnectColors.bg,
          body: SafeArea(
            bottom: false,
            child: Column(
              children: [
                _ContestPageBar(
                  title: post == null ? 'Contest' : _contestTitle(post),
                  onBack: () => Navigator.of(context).maybePop(),
                ),
                Expanded(
                  child: post == null
                      ? const SizedBox.shrink()
                      : ValueListenableBuilder<List<ConnectTeammate>>(
                          valueListenable: flow.people,
                          builder: (context, people, _) => _FeedScope(
                            bloc: flow.bloc,
                            people: people,
                            viewerUserId: flow.session.user.id,
                            onOpenPerson: flow.onOpenPerson,
                            child: ListView(
                              padding: const EdgeInsets.fromLTRB(20.5, 24, 20.5, 24),
                              children: [_card(post)],
                            ),
                          ),
                        ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  /// The card as the feed draws a contest: violet, rounded, no border.
  Widget _card(ConnectPost post) {
    final canManage = post.author.userId.isNotEmpty && post.author.userId == flow.session.user.id;
    return DecoratedBox(
      key: _cardKey,
      decoration: BoxDecoration(
        color: _celebrationCardTint(post.type) ?? Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: _cardShadow(post.type),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: _EngagementBody(
          post: post,
          canManage: canManage,
          onEdit: () => _edit(post),
          onDelete: () => _delete(post),
          onSubmitCaption: (text, photoPath, taggedUserId) =>
              _submitEntry(post, text, photoPath, taggedUserId),
          onDeleteCaption: () => flow.bloc.deleteCaption(post.id),
          onVoteCaption: (entryId) => flow.bloc.voteCaption(post.id, entryId),
        ),
      ),
    );
  }
}

/// What the card page's bar calls the contest: its own name, else its kind.
String _contestTitle(ConnectPost post) {
  final title = _bodyString(post, 'title').trim();
  if (title.isNotEmpty) return title;
  return switch (post.type) {
    ConnectPostType.mostLikely => 'Most Likely',
    ConnectPostType.photoStoryChallenge => 'Best Photo',
    _ => 'Caption This',
  };
}

/// The card page's bar: the Entries page's, with the contest's name in it.
class _ContestPageBar extends StatelessWidget {
  const _ContestPageBar({required this.title, required this.onBack});

  final String title;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 60,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFF3F4F6), width: 1.114)),
      ),
      child: Row(
        children: [
          Semantics(
            button: true,
            label: 'Back',
            child: GestureDetector(
              onTap: onBack,
              behavior: HitTestBehavior.opaque,
              child: Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: const BoxDecoration(color: Color(0xFFF7F7F9), shape: BoxShape.circle),
                child: SvgPicture.asset('assets/icons/chevron_left_small.svg', width: 17.983, height: 17.983),
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontFamily: _soraFont,
                fontSize: 16,
                height: 24 / 16,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.2,
                color: _EngagementColors.ink,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
