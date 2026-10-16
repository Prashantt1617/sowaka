part of 'connect_feed_screen.dart';

// Birthdays and work anniversaries, beyond the single card each person gets.
//
// The server keeps one post per person, so each person's wishes (the post's
// comments) stay theirs. On top of that:
//
// - the person whose day it is finds their own card pinned at the top of
//   their feed for the day: their photo, what the day is, how many wishes
//   they have not seen yet and "View all wishes" (frames 3840:81136, the
//   anniversary, and 3840:81108, the birthday);
// - everyone else sees one day's cards of the company in one row, "Celebrations
//   of the day", a small card per person with its own Wish button, each opening
//   that person's own wishes (frame 3886:93781). The server marks the posts
//   that go together (`celebrationGroup`).
//
// The wishes themselves are drawn in celebration_wishes_sheet.dart.

bool _isCelebration(ConnectPostType type) =>
    type == ConnectPostType.birthday || type == ConnectPostType.anniversary;

/// Whether [viewerUserId] is the person [post] celebrates.
bool _isCelebrant(ConnectPost post, String? viewerUserId) {
  if (!_isCelebration(post.type)) return false;
  final person = _bodyString(post, 'personUserId');
  return person.isNotEmpty && person == viewerUserId;
}

/// The key one day's celebration cards of a company share, or '' when the
/// card stands alone.
String _celebrationGroupOf(ConnectPost post) =>
    _isCelebration(post.type) ? _bodyString(post, 'celebrationGroup') : '';

/// The feed's cards in order: one post each, except a day's celebration
/// posts, drawn as one row where the first of them sits. The rest of the day
/// joins it from wherever it is in the list — even from a later page.
List<List<ConnectPost>> _feedCards(List<ConnectPost> posts) {
  final clubs = <String, List<ConnectPost>>{};
  for (final post in posts) {
    final key = _celebrationGroupOf(post);
    if (key.isNotEmpty) (clubs[key] ??= []).add(post);
  }
  final cards = <List<ConnectPost>>[];
  final placed = <String>{};
  for (final post in posts) {
    final key = _celebrationGroupOf(post);
    if (key.isEmpty) {
      cards.add([post]);
    } else if (placed.add(key)) {
      cards.add(clubs[key]!);
    }
  }
  return cards;
}

/// What a wish starts as, ready to send or change.
String _wishTextFor(ConnectPost post) {
  final firstName = _firstNameOf(post);
  if (post.type == ConnectPostType.birthday) {
    return 'Happy Birthday, $firstName! 🎂 Hope you have an amazing day!';
  }
  final years = _yearsOf(post);
  final company = _bodyString(post, 'companyName');
  return 'Congratulations on $years ${years == 1 ? 'year' : 'years'} with '
      '${company.isEmpty ? 'us' : company}, $firstName! 🎉';
}

String _firstNameOf(ConnectPost post) =>
    _bodyString(post, 'personName').trim().split(' ').first;

int _yearsOf(ConnectPost post) => (post.body['years'] as num?)?.toInt() ?? 1;

/// The wishes on a celebration card: what colleagues wrote to the person, not
/// the person's own words or the replies in a thread.
List<ConnectComment> _wishesOn(ConnectPost post) {
  final person = _bodyString(post, 'personUserId');
  return post.comments
      .where((comment) => comment.parentId == null && comment.userId != person)
      .toList();
}

/// One face per person who wished, the latest first.
List<ConnectComment> _wishersOf(ConnectPost post, {String? except}) {
  final seen = <String>{};
  return [
    for (final wish in _wishesOn(post).reversed)
      if (wish.userId != except &&
          seen.add(wish.userId.isEmpty ? wish.id : wish.userId))
        wish,
  ];
}

/// Whether [viewerUserId] has wished the person: sent a wish, or tapped the
/// card's button on an older app.
bool _hasWished(ConnectPost post, String viewerUserId) =>
    post.actionValue != null ||
    _wishesOn(post).any((wish) => wish.userId == viewerUserId);

/// The wishes the celebrant has not seen yet, as the server counts them.
int _newWishCount(ConnectPost post) =>
    (post.body['newWishCount'] as num?)?.toInt() ?? 0;

/// The person's team, as the small card names it: the server's, else what
/// leads the card's subtitle ("Designer · turns a year wiser today").
String _departmentOf(ConnectPost post) {
  final department = _bodyString(post, 'personDepartment');
  if (department.isNotEmpty) return department;
  return _bodyString(post, 'subtitle').split(' · ').first.trim();
}

const _monthNames = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', //
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/// "Since Oct 2023": when the person joined, from the server's date or, on a
/// card from before it sent one, the subtitle's "joined October 2023".
String _sinceLabel(ConnectPost post) {
  final joined = DateTime.tryParse(_bodyString(post, 'joinedOn'));
  if (joined != null) {
    final utc = joined.toUtc();
    return 'Since ${_monthNames[utc.month - 1]} ${utc.year}';
  }
  final match = RegExp(
    r'joined ([A-Za-z]{3})[A-Za-z]* (\d{4})',
  ).firstMatch(_bodyString(post, 'subtitle'));
  return match == null ? '' : 'Since ${match.group(1)} ${match.group(2)}';
}

/// The day an India calendar shows now, as the server keys the clubs.
String _todayInIndia({int daysAgo = 0}) {
  final now = DateTime.now().toUtc().add(
    Duration(hours: 5, minutes: 30, days: -daysAgo),
  );
  String two(int value) => value.toString().padLeft(2, '0');
  return '${now.year}-${two(now.month)}-${two(now.day)}';
}

/// Sora at a Figma size and weight; [height] in pixels, as Figma gives line
/// heights, or Sora's "normal" when left out.
TextStyle _celebrationText(
  double size,
  FontWeight weight,
  Color color, {
  double? height,
  double spacing = 0,
}) => TextStyle(
  fontFamily: _soraFont,
  fontSize: size,
  fontWeight: weight,
  fontVariations: [FontVariation.weight(weight.value.toDouble())],
  color: color,
  height: height == null ? 1.26 : height / size,
  letterSpacing: spacing,
);

/// Palette from frames 3840:81136, 3840:81108 and 3886:93781.
class _CelebrationColors {
  const _CelebrationColors._();

  static const birthdayCard = Color(0xFFEFEAFE);
  static const anniversaryCard = Color(0xFFFFF4D6);

  /// accents/purple, accents/orange and accents/yellow.
  static const purple = Color(0xFFCB30E0);
  static const orange = Color(0xFFFF8D28);
  static const yellow = Color(0xFFFFCC00);

  static const tileBorder = Color(0xFFD2CEFF);
  static const title = Color(0xFF111827);
  static const newPill = Color(0xFFE8F4FC);
  static const newPillText = Color(0xFF0571A6);
  static const main = Color(0xFF222222);
  static const tertiary = Color(0xFF717171);
  static const night = Color(0xFF160D2C);
  static const photoBorder = Color(0xFFEBEBEB);
}

/// A person's face, or their initials while it loads or where they have none.
class _CelebrationPhoto extends StatelessWidget {
  const _CelebrationPhoto({
    required this.initials,
    required this.photoUrl,
    required this.size,
    this.color = _ConnectColors.gold,
  });

  final String initials;
  final String photoUrl;
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final fallback = ColoredBox(
      color: color,
      child: Center(
        child: Text(
          initials.isEmpty ? '?' : initials,
          style: _celebrationText(size * 0.32, FontWeight.w700, Colors.white),
        ),
      ),
    );
    if (photoUrl.isEmpty) {
      return SizedBox.square(dimension: size, child: fallback);
    }
    return Image(
      image: _remoteImage(photoUrl),
      width: size,
      height: size,
      fit: BoxFit.cover,
      errorBuilder: (_, _, _) =>
          SizedBox.square(dimension: size, child: fallback),
    );
  }
}

/// Wishers' faces overlapping, the last circle "+N" for the rest (node
/// 3840:81153 on the celebrant's bar, 3844:81261 on a small card).
class _WisherFaces extends StatelessWidget {
  const _WisherFaces({
    required this.wishers,
    required this.size,
    required this.ring,
    required this.ringWidth,
    required this.moreColor,
    required this.moreText,
    this.moreRing,
  });

  final List<ConnectComment> wishers;
  final double size;

  /// The ring each face sits in — the colour behind them.
  final Color ring;
  final double ringWidth;
  final Color moreColor;
  final Color moreText;
  final Color? moreRing;

  static const _shown = 2;

  @override
  Widget build(BuildContext context) {
    final faces = wishers.take(_shown).toList();
    final more = wishers.length - faces.length;
    final circles = <Widget>[
      for (final wish in faces)
        Container(
          width: size,
          height: size,
          clipBehavior: Clip.antiAlias,
          foregroundDecoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: ring, width: ringWidth),
          ),
          decoration: const BoxDecoration(shape: BoxShape.circle),
          child: _CelebrationPhoto(
            initials: _initials(wish.name),
            photoUrl: wish.photoUrl ?? '',
            size: size,
            color: _avatarColorFor(wish.userId),
          ),
        ),
      if (more > 0)
        Container(
          width: size,
          height: size,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: moreColor,
            shape: BoxShape.circle,
            border: moreRing == null
                ? null
                : Border.all(color: moreRing!, width: ringWidth),
          ),
          child: Text(
            '+$more',
            maxLines: 1,
            style: _celebrationText(10, FontWeight.w400, moreText),
          ),
        ),
    ];
    if (circles.isEmpty) return const SizedBox.shrink();
    // 8 of each circle under the next (mr -8).
    final step = size - 8;
    return SizedBox(
      width: size + step * (circles.length - 1),
      height: size,
      child: Stack(
        children: [
          for (var i = 0; i < circles.length; i++)
            Positioned(left: step * i, top: 0, child: circles[i]),
        ],
      ),
    );
  }
}

// ------------------------------------------------- the celebrant's own card

/// The celebrant's own card: "Work Anniversary" (frame 3840:81136) or
/// "Birthday Wishes" (3840:81108), how many wishes are new, and "View all
/// wishes" over the faces of who wished.
class _CelebrantCard extends StatelessWidget {
  const _CelebrantCard({
    super.key,
    required this.post,
    required this.onViewAll,
  });

  final ConnectPost post;
  final VoidCallback onViewAll;

  @override
  Widget build(BuildContext context) {
    final birthday = post.type == ConnectPostType.birthday;
    final accent = birthday
        ? _CelebrationColors.purple
        : _CelebrationColors.orange;
    final fresh = _newWishCount(post);
    return Container(
      key: ValueKey('celebrant-card-${post.id}'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: birthday
            ? _CelebrationColors.birthdayCard
            : _CelebrationColors.anniversaryCard,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // node 3840:81138
          SizedBox(
            height: 24.5,
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    birthday ? 'Birthday Wishes' : 'Work Anniversary',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: _celebrationText(
                      16,
                      FontWeight.w700,
                      _CelebrationColors.title,
                      height: 24,
                    ),
                  ),
                ),
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 220),
                  transitionBuilder: (child, animation) => FadeTransition(
                    opacity: animation,
                    child: ScaleTransition(scale: animation, child: child),
                  ),
                  child: fresh > 0
                      ? Container(
                          key: ValueKey('celebrant-new-$fresh'),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: _CelebrationColors.newPill,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            '$fresh new',
                            style: _celebrationText(
                              11,
                              FontWeight.w700,
                              _CelebrationColors.newPillText,
                              height: 16.5,
                            ),
                          ),
                        )
                      : const SizedBox.shrink(),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (birthday) _birthdayBody(accent) else _anniversaryBody(accent),
          const SizedBox(height: 16),
          _ViewAllWishesBar(post: post, accent: accent, onTap: onViewAll),
        ],
      ),
    );
  }

  Widget _photo(double size) => _PersonTap(
    userId: _bodyString(post, 'personUserId'),
    child: Container(
      width: size,
      height: size,
      clipBehavior: Clip.antiAlias,
      decoration: const BoxDecoration(shape: BoxShape.circle),
      foregroundDecoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: _CelebrationColors.photoBorder),
      ),
      child: _CelebrationPhoto(
        initials: _bodyString(post, 'personInitials'),
        photoUrl: _bodyString(post, 'photoUrl'),
        size: size,
      ),
    ),
  );

  /// node 3840:81115: the photo, "Happy Birthday" and their name.
  Widget _birthdayBody(Color accent) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          _photo(73),
          const SizedBox(width: 12),
          Expanded(
            child: SizedBox(
              height: 55,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Happy Birthday',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: _celebrationText(24, FontWeight.w700, accent),
                  ),
                  const SizedBox(height: 1),
                  Text(
                    _bodyString(post, 'personName'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: _celebrationText(14, FontWeight.w400, accent),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// node 3935:54034: "Congratulations! Name", the photo, and the years.
  Widget _anniversaryBody(Color accent) {
    final years = _yearsOf(post);
    final company = _bodyString(post, 'companyName');
    final since = _sinceLabel(post);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text.rich(
          TextSpan(
            children: [
              const TextSpan(text: 'Congratulations! '),
              TextSpan(
                text: _bodyString(post, 'personName'),
                style: _celebrationText(14, FontWeight.w600, accent),
              ),
            ],
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: _celebrationText(14, FontWeight.w400, accent),
        ),
        const SizedBox(height: 4),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              _photo(94),
              const SizedBox(width: 12),
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    // node 3840:81145: the big number, in a 77-high box.
                    ConstrainedBox(
                      constraints: const BoxConstraints(minWidth: 81),
                      child: Text(
                        '$years',
                        key: const ValueKey('celebrant-years'),
                        textAlign: TextAlign.center,
                        style:
                            _celebrationText(
                              96,
                              FontWeight.w700,
                              accent,
                              height: 77,
                            ).copyWith(
                              leadingDistribution: TextLeadingDistribution.even,
                            ),
                      ),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            years == 1 ? 'year' : 'years',
                            style: _celebrationText(
                              24,
                              FontWeight.w700,
                              accent,
                            ),
                          ),
                          const SizedBox(height: 1),
                          Text(
                            company.isEmpty ? 'with the team' : 'at $company',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: _celebrationText(
                              14,
                              FontWeight.w400,
                              accent,
                            ),
                          ),
                          if (since.isNotEmpty) ...[
                            const SizedBox(height: 1),
                            SizedBox(
                              height: 21,
                              child: Align(
                                alignment: Alignment.centerLeft,
                                child: Text(
                                  since,
                                  style: _celebrationText(
                                    10,
                                    FontWeight.w400,
                                    accent,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// "View all wishes" (node 3840:81151): the faces of who wished, and an
/// arrow, on the card's accent.
class _ViewAllWishesBar extends StatelessWidget {
  const _ViewAllWishesBar({
    required this.post,
    required this.accent,
    required this.onTap,
  });

  final ConnectPost post;
  final Color accent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final wishers = _wishersOf(post);
    return Material(
      color: accent,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        key: const ValueKey('view-all-wishes'),
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 3),
                  child: Row(
                    children: [
                      if (wishers.isNotEmpty) ...[
                        _WisherFaces(
                          wishers: wishers,
                          size: 24,
                          ring: accent,
                          ringWidth: 1.5,
                          moreColor: Colors.white,
                          moreText: accent,
                          moreRing: accent,
                        ),
                        const SizedBox(width: 8),
                      ],
                      Flexible(
                        child: SizedBox(
                          height: 24,
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child: Text(
                              'View all wishes',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: _celebrationText(
                                12,
                                FontWeight.w600,
                                Colors.white,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              // The design's left arrow, turned to point on (node 3840:81159).
              Transform.flip(
                flipX: true,
                child: SvgPicture.asset(
                  'assets/icons/celebration_wishes_arrow.svg',
                  width: 20,
                  height: 20,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// -------------------------------------------- everyone else's row of cards

/// "Celebrations of the day" (node 3416:24559): a row of small cards, one per
/// person, scrolling sideways past the edge of the feed.
class _CelebrationsSection extends StatelessWidget {
  const _CelebrationsSection({
    required this.posts,
    required this.viewerUserId,
    required this.keyFor,
    required this.onOpenWishes,
  });

  final List<ConnectPost> posts;
  final String viewerUserId;

  /// Each card carries its post's own key, so a notification about it scrolls
  /// to that very card — down the feed and along the row.
  final GlobalKey Function(ConnectPost post) keyFor;

  /// Opens [post]'s wishes with [initialText] in the box.
  final Future<void> Function(ConnectPost post, {String initialText})
  onOpenWishes;

  String get _title {
    final group = _celebrationGroupOf(posts.first);
    if (group.endsWith(':${_todayInIndia()}')) return 'Celebrations of the day';
    if (group.endsWith(':${_todayInIndia(daysAgo: 1)}')) {
      return "Yesterday's celebrations";
    }
    final day = DateTime.tryParse(group.split(':').last);
    return day == null
        ? 'Celebrations'
        : 'Celebrations · ${day.day} ${_monthNames[day.month - 1]}';
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const ValueKey('celebrations-section'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // node 3416:24560
        Text(
          _title,
          style: _celebrationText(
            18,
            FontWeight.w700,
            _CelebrationColors.main,
            height: 24,
            spacing: -0.16,
          ),
        ),
        const SizedBox(height: 16),
        // Unclipped, so the row runs on past the feed's margin to the edge of
        // the screen, as the design shows the next card peeking in.
        SingleChildScrollView(
          key: const ValueKey('celebrations-row'),
          scrollDirection: Axis.horizontal,
          clipBehavior: Clip.none,
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var i = 0; i < posts.length; i++) ...[
                  if (i > 0) const SizedBox(width: 12),
                  _CelebrationTile(
                    key: keyFor(posts[i]),
                    post: posts[i],
                    viewerUserId: viewerUserId,
                    onOpenWishes: onOpenWishes,
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// One person's small card (frames 3844:81237, 3844:81186 and 3844:81272):
/// the day, their photo with a cupcake or their years on it, their name and
/// team, and "Wish" — or, once wished, who else did.
class _CelebrationTile extends StatelessWidget {
  const _CelebrationTile({
    super.key,
    required this.post,
    required this.viewerUserId,
    required this.onOpenWishes,
  });

  final ConnectPost post;
  final String viewerUserId;
  final Future<void> Function(ConnectPost post, {String initialText})
  onOpenWishes;

  @override
  Widget build(BuildContext context) {
    final birthday = post.type == ConnectPostType.birthday;
    final background = birthday
        ? _CelebrationColors.birthdayCard
        : _CelebrationColors.anniversaryCard;
    final accent = birthday
        ? _CelebrationColors.purple
        : _CelebrationColors.yellow;
    final wished = _hasWished(post, viewerUserId);
    final radius = BorderRadius.circular(20);
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 260),
      child: Container(
        key: ValueKey('celebration-tile-${post.id}'),
        width: 165,
        decoration: BoxDecoration(
          color: background,
          borderRadius: radius,
          boxShadow: const [
            BoxShadow(
              color: Color(0x0FFF5A5F),
              blurRadius: 6,
              offset: Offset(0, 2),
            ),
          ],
        ),
        // Figma draws the 1.11 stroke inside the card, over its padding.
        foregroundDecoration: BoxDecoration(
          borderRadius: radius,
          border: Border.all(color: _CelebrationColors.tileBorder, width: 1.11),
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: radius,
            onTap: () => onOpenWishes(post),
            child: Stack(
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Text(
                        birthday ? 'Birthday' : 'Work Anniversary',
                        textAlign: TextAlign.center,
                        maxLines: 1,
                        style: _celebrationText(
                          13,
                          FontWeight.w600,
                          accent,
                          height: 18,
                        ),
                      ),
                      const SizedBox(height: 4),
                      _profile(),
                      const SizedBox(height: 4),
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 220),
                        transitionBuilder: (child, animation) => FadeTransition(
                          opacity: animation,
                          child: SizeTransition(
                            sizeFactor: animation,
                            alignment: Alignment.topCenter,
                            child: child,
                          ),
                        ),
                        child: wished
                            ? _wishedWith(accent, background)
                            : _wishButton(accent, background),
                      ),
                    ],
                  ),
                ),
                if (birthday)
                  // node 3844:81245: the cupcake, tipped back 8.66°, on the
                  // photo's corner.
                  Positioned(
                    left: 98,
                    top: 103.79,
                    width: 36.561,
                    height: 36.561,
                    child: Center(
                      child: Transform.rotate(
                        angle: -8.66 * math.pi / 180,
                        child: SvgPicture.asset(
                          'assets/icons/celebration_cupcake.svg',
                          width: 32.094,
                          height: 32.094,
                        ),
                      ),
                    ),
                  )
                else
                  // node 3844:81280: their years, in gold, on a white disc.
                  Positioned(
                    left: 101,
                    top: 107.79,
                    child: _YearsBadge(years: _yearsOf(post)),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// node 3844:81239: the photo, then name and team.
  Widget _profile() {
    final person = _bodyString(post, 'personUserId');
    final radius = BorderRadius.circular(24);
    return _PersonTap(
      userId: person,
      child: Column(
        children: [
          Container(
            width: 90,
            height: 90,
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              borderRadius: radius,
              boxShadow: const [
                BoxShadow(
                  color: Color(0x1A000000),
                  blurRadius: 6,
                  offset: Offset(0, 4),
                ),
              ],
            ),
            foregroundDecoration: BoxDecoration(
              borderRadius: radius,
              border: Border.all(color: Colors.white, width: 2.23),
            ),
            child: _CelebrationPhoto(
              initials: _bodyString(post, 'personInitials'),
              photoUrl: _bodyString(post, 'photoUrl'),
              size: 90,
              color: post.type == ConnectPostType.birthday
                  ? _ConnectColors.gold
                  : _ConnectColors.plum,
            ),
          ),
          const SizedBox(height: 12),
          // node 3844:81242: the name's 24 line overlaps the team's by 4.
          SizedBox(
            width: 133,
            height: 38,
            child: Stack(
              children: [
                Positioned(
                  left: 0,
                  right: 0,
                  top: 0,
                  child: Text(
                    _bodyString(post, 'personName'),
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: _celebrationText(
                      12,
                      FontWeight.w700,
                      _CelebrationColors.main,
                      height: 24,
                      spacing: -0.16,
                    ),
                  ),
                ),
                Positioned(
                  left: 0,
                  right: 0,
                  top: 20,
                  child: Text(
                    _departmentOf(post),
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: _celebrationText(
                      10,
                      FontWeight.w600,
                      _CelebrationColors.tertiary,
                      height: 18,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// node 3844:81258 and 3844:81260: "Wish Subham", then who has.
  Widget _wishButton(Color accent, Color background) {
    final wishers = _wishersOf(post, except: viewerUserId);
    return Column(
      key: const ValueKey('wish'),
      children: [
        Material(
          color: accent,
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            key: ValueKey('celebration-wish-${post.id}'),
            borderRadius: BorderRadius.circular(16),
            onTap: () => onOpenWishes(post, initialText: _wishTextFor(post)),
            child: SizedBox(
              width: 133,
              height: 35,
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text(
                    'Wish ${_firstNameOf(post)}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: _celebrationText(
                      12,
                      FontWeight.w600,
                      Colors.white,
                      height: 16.2,
                      spacing: -0.16,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 4),
        SizedBox(
          height: 23,
          child: Padding(
            padding: const EdgeInsets.only(bottom: 3),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (wishers.isNotEmpty) ...[
                  _WisherFaces(
                    wishers: wishers,
                    size: 20,
                    ring: background,
                    ringWidth: 1,
                    moreColor: accent,
                    moreText: Colors.white,
                  ),
                  const SizedBox(width: 8),
                ],
                Flexible(
                  child: Text(
                    wishers.isEmpty ? 'Be first to wish' : 'Wished',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: _celebrationText(
                      12,
                      FontWeight.w400,
                      _CelebrationColors.night,
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

  /// node 3844:81230: "You Wished with" and the others who did.
  Widget _wishedWith(Color accent, Color background) {
    final others = _wishersOf(post, except: viewerUserId);
    return Padding(
      key: const ValueKey('wished'),
      padding: const EdgeInsets.only(bottom: 3),
      child: Column(
        children: [
          Text(
            others.isEmpty ? 'You Wished' : 'You Wished with',
            style: _celebrationText(
              12,
              FontWeight.w400,
              _CelebrationColors.night,
            ),
          ),
          if (others.isNotEmpty) ...[
            const SizedBox(height: 8),
            _WisherFaces(
              wishers: others,
              size: 20,
              ring: background,
              ringWidth: 1,
              moreColor: accent,
              moreText: Colors.white,
            ),
          ],
        ],
      ),
    );
  }
}

/// A work anniversary's years on the small card's photo: a white disc, the
/// number set in gold. The design's own "3" is a stock picture of that one
/// number, so the gold is drawn here to say any number.
class _YearsBadge extends StatelessWidget {
  const _YearsBadge({required this.years});

  final int years;

  static const _gold = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0xFFF6E3A8),
      Color(0xFFD8A93F),
      Color(0xFFF2D27E),
      Color(0xFFB98A2C),
    ],
    stops: [0, 0.4, 0.65, 1],
  );

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 30,
      height: 30,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
      ),
      child: SizedBox(
        width: 22,
        height: 19,
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: ShaderMask(
            blendMode: BlendMode.srcIn,
            shaderCallback: _gold.createShader,
            child: Text(
              '$years',
              key: const ValueKey('celebration-years'),
              style: _celebrationText(
                19,
                FontWeight.w800,
                Colors.white,
                height: 19,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
