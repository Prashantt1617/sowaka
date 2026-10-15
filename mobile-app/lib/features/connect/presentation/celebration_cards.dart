part of 'connect_feed_screen.dart';

// Birthdays and work anniversaries, beyond the single card each person gets.
//
// The server keeps one post per person, so each person's wishes (the post's
// comments) stay theirs. On top of that:
//
// - the person whose day it is finds their own card pinned at the top of
//   their feed for the day, and on it their wishes and "View all wishes",
//   which opens the post's comments;
// - everyone else sees one day's cards of the company clubbed into one, a row
//   per person, each row opening that person's own wish thread. The server
//   marks the posts that go together (`celebrationGroup`); one on its own is
//   drawn as the usual card.
//
// Figma: 3840:81136 (birthday, as the celebrant sees it), 3840:81108
// (anniversary, likewise), 3886:93781 (the clubbed card).

bool _isCelebration(ConnectPostType type) =>
    type == ConnectPostType.birthday || type == ConnectPostType.anniversary;

/// Whether [viewerUserId] is the person [post] celebrates.
bool _isCelebrant(ConnectPost post, String? viewerUserId) {
  if (!_isCelebration(post.type)) return false;
  final person = _bodyString(post, 'personUserId');
  return person.isNotEmpty && person == viewerUserId;
}

/// The celebrant's own card for today, which the server pins for them.
bool _isPinnedForCelebrant(ConnectPost post) =>
    post.body['pinnedForCelebrant'] == true;

/// The key one day's celebration cards of a company share, or '' when the
/// card stands alone.
String _celebrationGroupOf(ConnectPost post) =>
    _isCelebration(post.type) ? _bodyString(post, 'celebrationGroup') : '';

/// The feed's cards in order: one post each, except a club of celebration
/// posts, drawn as one card where the first of them sits. The rest of the
/// club joins it from wherever it is in the list — even from a later page.
List<List<ConnectPost>> _feedCards(List<ConnectPost> posts) {
  final clubs = <String, List<ConnectPost>>{};
  for (final post in posts) {
    final key = _celebrationGroupOf(post);
    if (key.isNotEmpty) (clubs[key] ??= []).add(post);
  }
  final cards = <List<ConnectPost>>[];
  final placed = <String>{};
  for (final post in posts) {
    final club = clubs[_celebrationGroupOf(post)];
    if (club == null || club.length < 2) {
      cards.add([post]);
    } else if (placed.add(_celebrationGroupOf(post))) {
      cards.add(club);
    }
  }
  return cards;
}

/// What a wish starts as, ready to send or change — the same words the
/// person's own card puts in its box.
String _wishTextFor(ConnectPost post) {
  final firstName = _bodyString(post, 'personName').split(' ').first;
  if (post.type == ConnectPostType.birthday) {
    return 'Happy Birthday, $firstName! 🎂 Hope you have an amazing day!';
  }
  final years = (post.body['years'] as num?)?.toInt() ?? 1;
  final company = _bodyString(post, 'companyName');
  return 'Congratulations on $years ${years == 1 ? 'year' : 'years'} with '
      '${company.isEmpty ? 'us' : company}, $firstName! 🎉';
}

/// The wishes on a celebration card: what the colleagues wrote to the
/// person, not the person's own replies.
List<ConnectComment> _wishesOn(ConnectPost post) {
  final person = _bodyString(post, 'personUserId');
  return post.comments
      .where((comment) => comment.parentId == null && comment.userId != person)
      .toList();
}

String _wishCountLabel(int count) => switch (count) {
  0 => 'No wishes yet',
  1 => '1 wish',
  _ => '$count wishes',
};

/// The day an India calendar shows now, as the server keys the clubs.
String _todayInIndia() {
  final now = DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30));
  String two(int value) => value.toString().padLeft(2, '0');
  return '${now.year}-${two(now.month)}-${two(now.day)}';
}

class _PinnedChip extends StatelessWidget {
  const _PinnedChip();

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('celebrant-pinned'),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: _ConnectColors.terraTint,
        borderRadius: BorderRadius.circular(99),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.push_pin_rounded, size: 11, color: _ConnectColors.terra),
          SizedBox(width: 3),
          Text(
            'Pinned',
            style: TextStyle(
              color: _ConnectColors.terra,
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

/// Up to three faces, overlapping, the latest first.
class _FaceStack extends StatelessWidget {
  const _FaceStack({required this.comments, this.size = 28});

  final List<ConnectComment> comments;
  final double size;

  @override
  Widget build(BuildContext context) {
    final seen = <String>{};
    final faces = [
      for (final comment in comments.reversed)
        if (seen.add(comment.userId)) comment,
    ].take(3).toList();
    if (faces.isEmpty) return const SizedBox.shrink();
    final step = size * 0.68;
    return SizedBox(
      width: size + step * (faces.length - 1),
      height: size,
      child: Stack(
        children: [
          for (var i = faces.length - 1; i >= 0; i--)
            Positioned(
              left: step * i,
              child: Container(
                padding: const EdgeInsets.all(1.5),
                decoration: const BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                ),
                child: _InitialAvatar(
                  initials: _initials(faces[i].name),
                  color: _avatarColorFor(faces[i].id),
                  size: size - 3,
                  photoUrl: faces[i].photoUrl ?? '',
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// On the celebrant's own card, in place of a button to wish themselves: who
/// has wished them, the latest wish, and "View all wishes", which opens the
/// post's comments.
class _CelebrantWishes extends StatelessWidget {
  const _CelebrantWishes({required this.post, required this.onViewAll});

  final ConnectPost post;
  final VoidCallback? onViewAll;

  @override
  Widget build(BuildContext context) {
    final wishes = _wishesOn(post);
    final latest = wishes.isEmpty ? null : wishes.last;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _FaceStack(comments: wishes),
            if (wishes.isNotEmpty) const SizedBox(width: 8),
            Flexible(
              child: Text(
                wishes.isEmpty
                    ? 'Your wishes will show up here'
                    : '${_wishCountLabel(wishes.length)} for you',
                key: const ValueKey('celebrant-wish-count'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: _ConnectColors.ink,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
        if (latest != null) ...[
          const SizedBox(height: 6),
          Text(
            '“${latest.text}” — ${latest.name.split(' ').first}',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: _ConnectColors.inkSoft,
              fontSize: 12.5,
              height: 1.35,
            ),
          ),
        ],
        const SizedBox(height: 14),
        KeyedSubtree(
          key: const ValueKey('view-all-wishes'),
          child: _ActionButton(
            label: 'View all wishes',
            onTap: onViewAll ?? () {},
          ),
        ),
      ],
    );
  }
}

/// One day's birthdays and work anniversaries of the company in one card: a
/// row per person, each with their own wishes. "Wish" sends the wish the
/// person's own card would and opens their thread with it written; the count
/// opens the thread as it is.
class _CelebrationsCard extends StatelessWidget {
  const _CelebrationsCard({
    super.key,
    required this.posts,
    required this.onWish,
    required this.onOpenWishes,
  });

  final List<ConnectPost> posts;

  /// Marks the wish sent on [post], as the single card's button does.
  final Future<void> Function(ConnectPost post) onWish;

  /// Opens [post]'s comments — that person's wishes — with [initialText] in
  /// the box.
  final Future<void> Function(ConnectPost post, {String initialText})
  onOpenWishes;

  @override
  Widget build(BuildContext context) {
    final group = _celebrationGroupOf(posts.first);
    final today = group.endsWith(':${_todayInIndia()}');
    return DecoratedBox(
      key: const ValueKey('celebrations-card'),
      decoration: BoxDecoration(
        gradient: _celebrationGradient,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _ConnectColors.cardBorder, width: 1.129),
        boxShadow: _cardShadow(ConnectPostType.birthday),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                    ),
                    child: const Text('🎉', style: TextStyle(fontSize: 20)),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Celebrations',
                          style: TextStyle(
                            color: _ConnectColors.ink,
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _timeAgo(posts.first.publishedAt),
                          style: const TextStyle(
                            color: _ConnectColors.faint,
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 2),
              child: Text(
                today
                    ? '${posts.length} people are celebrating today!'
                    : '${posts.length} people celebrated',
                style: const TextStyle(
                  color: _ConnectColors.ink,
                  fontSize: 17,
                  height: 1.25,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, 6),
              child: Text(
                'Each wish goes to that person.',
                style: TextStyle(color: _ConnectColors.inkSoft, fontSize: 12.5),
              ),
            ),
            for (var i = 0; i < posts.length; i++) ...[
              if (i > 0)
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16),
                  child: Divider(height: 1, color: Color(0x66EBEBEB)),
                ),
              _CelebrationRow(
                post: posts[i],
                onWish: () async {
                  final wished = posts[i].actionValue != null;
                  if (!wished) await onWish(posts[i]);
                  await onOpenWishes(
                    posts[i],
                    initialText: wished ? '' : _wishTextFor(posts[i]),
                  );
                },
                onOpenWishes: () => onOpenWishes(posts[i]),
              ),
            ],
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}

class _CelebrationRow extends StatelessWidget {
  const _CelebrationRow({
    required this.post,
    required this.onWish,
    required this.onOpenWishes,
  });

  final ConnectPost post;
  final VoidCallback onWish;
  final VoidCallback onOpenWishes;

  @override
  Widget build(BuildContext context) {
    final birthday = post.type == ConnectPostType.birthday;
    final years = (post.body['years'] as num?)?.toInt() ?? 1;
    final company = _bodyString(post, 'companyName');
    final what = birthday
        ? 'Birthday'
        : '$years ${years == 1 ? 'year' : 'years'} at '
              '${company.isEmpty ? 'the company' : company}';
    final wishes = _wishesOn(post);
    final wished = post.actionValue != null;
    return Padding(
      key: ValueKey('celebration-row-${post.id}'),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Row(
        children: [
          _PersonTap(
            userId: _bodyString(post, 'personUserId'),
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                _InitialAvatar(
                  initials: _bodyString(post, 'personInitials'),
                  color: birthday ? _ConnectColors.gold : _ConnectColors.plum,
                  size: 48,
                  photoUrl: _bodyString(post, 'photoUrl'),
                ),
                Positioned(
                  right: -4,
                  bottom: -4,
                  child: Container(
                    width: 22,
                    height: 22,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                      border: Border.all(color: _ConnectColors.cardBorder),
                    ),
                    child: Text(
                      birthday ? '🎂' : '🎉',
                      style: const TextStyle(fontSize: 11),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _PersonTap(
                  userId: _bodyString(post, 'personUserId'),
                  child: Text(
                    _bodyString(post, 'personName'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: _ConnectColors.ink,
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  what,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: _ConnectColors.inkSoft,
                    fontSize: 12.5,
                  ),
                ),
                const SizedBox(height: 2),
                InkWell(
                  key: ValueKey('celebration-wishes-${post.id}'),
                  borderRadius: BorderRadius.circular(8),
                  onTap: onOpenWishes,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _FaceStack(comments: wishes, size: 20),
                        if (wishes.isNotEmpty) const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            wishes.isEmpty
                                ? 'No wishes yet'
                                : 'View ${_wishCountLabel(wishes.length)}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: _ConnectColors.blue,
                              fontSize: 12.5,
                              fontWeight: FontWeight.w700,
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
          const SizedBox(width: 10),
          InkWell(
            key: ValueKey('celebration-wish-${post.id}'),
            borderRadius: BorderRadius.circular(99),
            onTap: onWish,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: wished ? Colors.white : _ConnectColors.blue,
                borderRadius: BorderRadius.circular(99),
                border: Border.all(
                  color: wished
                      ? _ConnectColors.cardBorder
                      : _ConnectColors.blue,
                ),
              ),
              child: Text(
                wished ? 'Wished ✓' : (birthday ? '🎂 Wish' : '🎉 Wish'),
                style: TextStyle(
                  color: wished ? _ConnectColors.inkSoft : Colors.white,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
