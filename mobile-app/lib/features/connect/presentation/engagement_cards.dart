part of 'connect_feed_screen.dart';

// The engagement contests as the feed draws them (section 3692, frames
// 3684:41607, 3684:42011 and 3684:42329): one violet card for all three
// formats under a dark author band — a caption contest, a photo contest and
// Most Likely, the tag contest — each counting down to its close.

/// The Sora face the engagement designs are set in. Scoped to these cards —
/// the rest of the app stays on Plus Jakarta Sans.
const String _soraFont = 'Sora';

const String _engagementIcons = 'assets/icons/engagement';

/// The green "Game CTA" art, shared with the Games tab, which draws the same
/// button (imgGameCta in both frames).
const String _gameCtaAsset = 'assets/games_home/game_cta.png';

/// Palette from the engagement frames.
class _EngagementColors {
  const _EngagementColors._();

  static const card = Color(0xFFA08CFF);

  /// The dark band the author row sits on (node 3684:41608), and the hard
  /// shadow under a caption bubble.
  static const band = Color(0xFF160D2C);
  static const headerDivider = Color(0x66C4B5FD);
  static const points = Color(0xFFFFE786);

  /// The closing line and subtitles, set on the violet.
  static const onCard = Color(0xFFEBEBEB);
  static const livePill = Color(0xFFCCFF44);
  static const liveGreen = Color(0xFF34C759);
  static const ink = Color(0xFF222222);
  static const inkSecondary = Color(0xFF484848);
  static const inkTertiary = Color(0xFF717171);
  static const border = Color(0xFFEBEBEB);
  static const brand = Color(0xFF0571A6);
  static const ctaText = Color(0xFF078442);
  static const answerFill = Color(0xFFF7F4FF);
  static const answerBorder = Color(0xFFECE8FF);
  static const answerHint = Color(0xFF9992C5);
  static const turnFill = Color(0xFFE7E1FF);
  static const turnText = Color(0xFF8272F2);
  static const you = Color(0xFF675AFF);
  static const dotIdle = Color(0xFFD9D9D9);

  // The tag bars, by rank.
  static const yellow = Color(0xFFFFCC00);
  static const blue = Color(0xFF0088FF);
  static const mint = Color(0xFF00C8B3);
  static const muted = Color(0xFF96B7C7);
}

/// What every card in the feed may need without it being threaded through
/// each constructor: the bloc (the entries sheet votes through it), the
/// org-wide directory (for tagging, and for faces the entries do not carry),
/// and the way to a colleague's profile.
class _FeedScope extends InheritedWidget {
  _FeedScope({
    required this.bloc,
    required this.people,
    required this.viewerUserId,
    required this.onOpenPerson,
    required super.child,
  });

  final ConnectBloc bloc;
  final List<ConnectTeammate> people;

  /// Kept alongside the list so a picker can leave the viewer out of it —
  /// tagging yourself is refused by the server, so it should not be offered.
  final String viewerUserId;

  /// Opens a person's profile. Null where the host cannot navigate.
  final ValueChanged<String>? onOpenPerson;

  late final Map<String, String> _photos = {
    for (final person in people)
      if ((person.photoUrl ?? '').isNotEmpty) person.userId: person.photoUrl!,
  };

  /// Their photo from the directory. Entries and leaderboard rows carry a
  /// name and initials but no face, and the directory already has one.
  String? photoFor(String userId) => _photos[userId];

  static _FeedScope? of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_FeedScope>();

  @override
  bool updateShouldNotify(_FeedScope old) =>
      old.people != people ||
      old.viewerUserId != viewerUserId ||
      old.onOpenPerson != onOpenPerson ||
      old.bloc != bloc;
}

/// Makes a face or a name open that person's profile. Inert when there is no
/// person behind it (a system post) or nowhere to go.
class _PersonTap extends StatelessWidget {
  const _PersonTap({
    required this.userId,
    required this.child,
    this.onOpenPerson,
  });

  final String userId;
  final Widget child;

  /// Supplied by widgets that live outside the feed (the sheets); everything
  /// in the feed finds it on [_FeedScope].
  final ValueChanged<String>? onOpenPerson;

  @override
  Widget build(BuildContext context) {
    final open = onOpenPerson ?? _FeedScope.of(context)?.onOpenPerson;
    if (open == null || userId.isEmpty) return child;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => open(userId),
      child: child,
    );
  }
}

/// "2h ago" — the relative stamp the engagement and poll cards show.
String _relativeTime(DateTime? value) {
  if (value == null) return '';
  final diff = DateTime.now().difference(value);
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  return '${diff.inDays}d ago';
}

/// Avatar colours, picked per person so the same face keeps its colour.
List<Color> _avatarGradientFor(String userId) {
  const palettes = [
    [Color(0xFFFF5A5F), Color(0xFFFF8C8F)],
    [Color(0xFF4F8C89), Color(0xFF7FB3B0)],
    [Color(0xFF8A6AA0), Color(0xFFB394C6)],
    [Color(0xFFC98A2E), Color(0xFFE0B063)],
    [Color(0xFF4C5840), Color(0xFF77856A)],
  ];
  return palettes[userId.hashCode.abs() % palettes.length];
}

const _closesWeekdays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/// "Friday, 5 pm" for an instant, in the reader's own zone. The minutes show
/// only when there are some, as the design writes it.
String _weekdayTime(DateTime when) {
  final local = when.toLocal();
  final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
  final minute = local.minute == 0
      ? ''
      : ':${local.minute.toString().padLeft(2, '0')}';
  final meridiem = local.hour < 12 ? 'am' : 'pm';
  return '${_closesWeekdays[local.weekday - 1]}, $hour$minute $meridiem';
}

/// When a contest closes, from its stored instant. Null when it has no
/// closing time, or one that cannot be read.
DateTime? _closesAtOf(ConnectPost post) {
  final raw = _bodyString(post, 'closesAt');
  return raw.isEmpty ? null : DateTime.tryParse(raw);
}

/// The time now, as the contest cards read it. A test sets its own, to run a
/// countdown out on fake time rather than waiting on the wall clock.
@visibleForTesting
DateTime Function() contestClock = DateTime.now;

/// Closed by the server, or by the clock since the feed was loaded: the
/// countdown reaching zero closes the way in at once rather than leaving a
/// button the server would refuse.
bool _contestClosed(ConnectPost post) {
  if (post.challengeClosed) return true;
  final closesAt = _closesAtOf(post);
  return closesAt != null && !contestClock().isBefore(closesAt);
}

/// The countdown a contest card shows under its name: "END IN: 02:14" —
/// hours and minutes left, so one closing in two days reads "END IN: 48:00" —
/// and "Ended" once [closesAt] has passed. Empty when there is no closing
/// time. The minutes are whole ones gone by, as a clock shows them: with 30
/// seconds left it reads "END IN: 00:00".
String contestCountdownLabel(DateTime? closesAt, DateTime now) {
  if (closesAt == null) return '';
  final left = closesAt.difference(now);
  if (left <= Duration.zero) return 'Ended';
  final hours = left.inHours.toString().padLeft(2, '0');
  final minutes = (left.inMinutes % 60).toString().padLeft(2, '0');
  return 'END IN: $hours:$minutes';
}

int _pointsPerVote(ConnectPost post) =>
    (post.body['pointsPerVote'] as num?)?.toInt() ?? 10;

/// A round face: their photo where there is one (the entry's own, else the
/// directory's), otherwise their initial on the person's gradient.
class _EngagementAvatar extends StatelessWidget {
  const _EngagementAvatar({
    required this.userId,
    required this.initials,
    required this.size,
    this.photoUrl,
    this.borderColor,
    this.fontSize,
  });

  final String userId;
  final String initials;
  final double size;
  final String? photoUrl;
  final Color? borderColor;
  final double? fontSize;

  @override
  Widget build(BuildContext context) {
    final photo = (photoUrl ?? '').isNotEmpty
        ? photoUrl!
        : (_FeedScope.of(context)?.photoFor(userId) ?? '');
    final letter = Text(
      initials.isEmpty ? '?' : initials.characters.first,
      style: TextStyle(
        fontFamily: _soraFont,
        fontSize: fontSize ?? size * 0.36,
        fontWeight: FontWeight.w600,
        color: Colors.white,
      ),
    );
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: borderColor == null ? null : Border.all(color: borderColor!),
        gradient: LinearGradient(
          begin: const Alignment(-0.72, -0.69),
          end: const Alignment(0.72, 0.69),
          colors: _avatarGradientFor(userId),
        ),
      ),
      child: photo.isEmpty
          ? letter
          : Image(
              image: _remoteImage(photo),
              width: size,
              height: size,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => letter,
            ),
    );
  }
}

/// The author strip on every engagement card (node 3248:23499): Sowaka's mark
/// and "Sowaka Engagement" on an official contest, the poster's own face and
/// name on one a colleague posted, with what a vote is worth under it.
class _EngagementHeader extends StatelessWidget {
  const _EngagementHeader({
    required this.post,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  final ConnectPost post;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    // A contest HR publishes speaks for the company and carries its mark; one
    // a colleague posts is theirs. The server decides which.
    final official = _isOfficialPost(post);
    final author = post.author;
    return _EngagementHeaderView(
      // The feed card's author row sits on the dark band (node 3684:41608).
      dark: true,
      points: _pointsPerVote(post),
      avatar: official
          ? const _SowakaMark()
          : _PersonTap(
              userId: author.userId,
              child: _EngagementAvatar(
                userId: author.userId,
                initials: author.initials,
                photoUrl: author.photoUrl,
                size: 47.996,
                fontSize: 18,
              ),
            ),
      name: official
          ? const _EngagementHeaderName('Sowaka Engagement')
          : _PersonTap(
              userId: author.userId,
              child: _EngagementHeaderName(author.name),
            ),
      trailing: _PostMenuButton(
        canManage: canManage,
        onEdit: onEdit,
        onDelete: onDelete,
        icon: SvgPicture.asset(
          '$_engagementIcons/dots_menu_light.svg',
          width: 19.985,
          height: 19.985,
        ),
      ),
    );
  }
}

class _SowakaMark extends StatelessWidget {
  const _SowakaMark();

  @override
  Widget build(BuildContext context) {
    return ClipOval(
      child: Image.asset(
        'assets/images/sowaka_logo.png',
        width: 47.996,
        height: 47.996,
        fit: BoxFit.cover,
      ),
    );
  }
}

class _EngagementHeaderName extends StatelessWidget {
  const _EngagementHeaderName(this.name);

  final String name;

  @override
  Widget build(BuildContext context) {
    return Text(
      name,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(
        fontFamily: _soraFont,
        fontSize: 16,
        height: 24 / 16,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.16,
        color: Colors.white,
      ),
    );
  }
}

/// The header's layout, shared by the feed card and the contest composer's
/// preview of it.
class _EngagementHeaderView extends StatelessWidget {
  const _EngagementHeaderView({
    required this.points,
    required this.avatar,
    required this.name,
    this.trailing,
    this.dark = false,
  });

  final int points;
  final Widget avatar;
  final Widget name;
  final Widget? trailing;

  /// On the feed the row sits on a dark band; the composer's preview of the
  /// card keeps it on the violet (node 3677:40098).
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      // The author row runs 317 wide in a 308 body, so the dots sit 9 past
      // the body's right edge (node 3248:23500).
      padding: const EdgeInsets.fromLTRB(22, 18, 12.915, 14),
      decoration: BoxDecoration(
        color: dark ? _EngagementColors.band : null,
        border: const Border(
          bottom: BorderSide(
            color: _EngagementColors.headerDivider,
            width: 1.129,
          ),
        ),
      ),
      child: Row(
        children: [
          avatar,
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                name,
                Row(
                  children: [
                    Image.asset(
                      '$_engagementIcons/star.png',
                      width: 14,
                      height: 14,
                      fit: BoxFit.contain,
                    ),
                    const SizedBox(width: 4),
                    // Narrow phones and larger text both eat into this line,
                    // so it gives way rather than running off the card.
                    Flexible(
                      child: Text(
                        '$points pts per vote received',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: _soraFont,
                          fontSize: 12,
                          height: 16.2 / 12,
                          fontWeight: FontWeight.w600,
                          letterSpacing: -0.16,
                          color: _EngagementColors.points,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// The contest's name, in dark ink on the violet (node 3684:41627). The
/// composer's preview keeps it white, as its frame draws it.
class _EngagementTitle extends StatelessWidget {
  const _EngagementTitle(this.text, {this.color = _EngagementColors.ink});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    // Whoever sets up a contest writes the title, so it wraps rather than
    // running off the card.
    return Text(
      text,
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(
        fontFamily: _soraFont,
        fontSize: 24,
        height: 28 / 24,
        fontWeight: FontWeight.w700,
        color: color,
      ),
    );
  }
}

/// The lime "LIVE" pill (node 3248:23524), or a muted "CLOSED" once the
/// closing time has passed.
class _LivePill extends StatelessWidget {
  const _LivePill({required this.closed});

  final bool closed;

  @override
  Widget build(BuildContext context) {
    final accent = closed
        ? _EngagementColors.inkTertiary
        : _EngagementColors.liveGreen;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: BoxDecoration(
        color: closed ? Colors.white : _EngagementColors.livePill,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: accent, width: 1.114),
        boxShadow: const [
          BoxShadow(
            color: Color(0x407186FF),
            blurRadius: 2,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Opacity(
            opacity: 0.94,
            child: Container(
              width: 5.989,
              height: 5.989,
              decoration: BoxDecoration(color: accent, shape: BoxShape.circle),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            closed ? 'CLOSED' : 'LIVE',
            style: TextStyle(
              fontFamily: _soraFont,
              fontSize: 10,
              height: 18 / 10,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.3,
              color: accent,
            ),
          ),
        ],
      ),
    );
  }
}

/// "END IN: 02:14" and the live pill, side by side (node 3684:41630).
class _CountdownRow extends StatelessWidget {
  const _CountdownRow({
    required this.closesAt,
    required this.closed,
    required this.onEnded,
  });

  final DateTime? closesAt;
  final bool closed;
  final VoidCallback onEnded;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _ContestCountdown(closesAt: closesAt, onEnded: onEnded),
        ),
        const SizedBox(width: 8),
        _LivePill(closed: closed),
      ],
    );
  }
}

/// The countdown itself, ticking down a minute at a time. It wakes only when
/// the minute it shows changes, and tells the card once the contest ends so
/// the way in closes with it — the server refuses entries and votes from
/// then on.
class _ContestCountdown extends StatefulWidget {
  const _ContestCountdown({required this.closesAt, required this.onEnded});

  final DateTime? closesAt;
  final VoidCallback onEnded;

  @override
  State<_ContestCountdown> createState() => _ContestCountdownState();
}

class _ContestCountdownState extends State<_ContestCountdown> {
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  @override
  void didUpdateWidget(_ContestCountdown old) {
    super.didUpdateWidget(old);
    if (old.closesAt != widget.closesAt) _schedule();
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  void _schedule() {
    _tick?.cancel();
    _tick = null;
    final closesAt = widget.closesAt;
    if (closesAt == null) return;
    final left = closesAt.difference(contestClock());
    if (left <= Duration.zero) return;
    // Just past the moment the shown minute rolls over — or the close itself.
    final untilNext = Duration(
      microseconds: left.inMicroseconds % Duration.microsecondsPerMinute,
    );
    _tick = Timer(untilNext + const Duration(milliseconds: 1), _onTick);
  }

  void _onTick() {
    if (!mounted) return;
    setState(() {});
    final closesAt = widget.closesAt;
    if (closesAt != null && !contestClock().isBefore(closesAt)) {
      widget.onEnded();
      return;
    }
    _schedule();
  }

  @override
  Widget build(BuildContext context) {
    return Text(
      contestCountdownLabel(widget.closesAt, contestClock()),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(
        fontFamily: _soraFont,
        fontSize: 11,
        height: 16.5 / 11,
        fontWeight: FontWeight.w600,
        color: _EngagementColors.inkSecondary,
      ),
    );
  }
}

/// The dots and "2 of 6" under a carousel (node 3248:23550).
class _EngagementPager extends StatelessWidget {
  const _EngagementPager({
    required this.count,
    required this.page,
    required this.labelColor,
  });

  final int count;
  final int page;
  final Color labelColor;

  /// The slider draws six dots (node 3684:41659). A contest with more
  /// entries shows the six around the one in view, so the row never runs
  /// off the card; "7 of 30" under it says where that is.
  static const int _maxDots = 6;

  @override
  Widget build(BuildContext context) {
    final shown = math.min(count, _maxDots);
    final first = (page - shown ~/ 2).clamp(0, count - shown);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var index = first; index < first + shown; index++) ...[
              if (index > first) const SizedBox(width: 4),
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: index == page
                      ? _EngagementColors.brand
                      : _EngagementColors.dotIdle,
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 8),
        Text(
          '${page + 1} of $count',
          style: TextStyle(
            fontFamily: _soraFont,
            fontSize: 13,
            height: 19.5 / 13,
            fontWeight: FontWeight.w400,
            color: labelColor,
          ),
        ),
      ],
    );
  }
}

/// The big lime button — "Add your answer", "Nominate", "Add your photo"
/// (node 3684:41671). The button is the exported Game CTA art, drawn 308 by
/// 67 and cropped the way the design crops it; the label sits on its top
/// face.
class _EngagementCta extends StatelessWidget {
  const _EngagementCta({required this.label, required this.onTap});

  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Center(
      // A narrow phone gives the card less than the 308 the art is drawn at;
      // it shrinks to fit rather than overflowing.
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Semantics(
          button: true,
          label: label,
          child: GestureDetector(
            onTap: onTap,
            behavior: HitTestBehavior.opaque,
            child: SizedBox(
              width: 308,
              height: 67,
              child: Stack(
                children: [
                  Positioned.fill(
                    child: ClipRect(
                      child: OverflowBox(
                        alignment: Alignment.topLeft,
                        minWidth: 0,
                        minHeight: 0,
                        maxWidth: double.infinity,
                        maxHeight: double.infinity,
                        child: Transform.translate(
                          offset: const Offset(-15.954, -48.186),
                          child: Image.asset(
                            _gameCtaAsset,
                            width: 338.061,
                            height: 165.209,
                            fit: BoxFit.fill,
                          ),
                        ),
                      ),
                    ),
                  ),
                  Positioned(
                    left: 13,
                    right: 12,
                    top: 8,
                    bottom: 16,
                    child: Center(
                      child: Text(
                        label,
                        maxLines: 1,
                        style: const TextStyle(
                          fontFamily: _soraFont,
                          fontSize: 20,
                          height: 24 / 20,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.16,
                          color: _EngagementColors.ctaText,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// "View Entries", underlined in dark ink on the violet (node 3684:41674).
class _ViewEntriesLink extends StatelessWidget {
  const _ViewEntriesLink({required this.onTap, this.verticalPadding = 8});

  final VoidCallback onTap;
  final double verticalPadding;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Padding(
        padding: EdgeInsets.symmetric(
          horizontal: 16,
          vertical: verticalPadding,
        ),
        child: const Text(
          'View Entries',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontFamily: _soraFont,
            fontSize: 16,
            height: 16.2 / 16,
            fontWeight: FontWeight.w600,
            letterSpacing: -0.16,
            color: _EngagementColors.ink,
            decoration: TextDecoration.underline,
            decorationColor: _EngagementColors.ink,
          ),
        ),
      ),
    );
  }
}

/// The violet circle with the white paper plane (node 3261:24205).
class _SendCircle extends StatelessWidget {
  const _SendCircle({required this.onTap, this.busy = false});

  final VoidCallback? onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Send',
      child: GestureDetector(
        onTap: busy ? null : onTap,
        behavior: HitTestBehavior.opaque,
        child: SizedBox(
          width: 44,
          height: 44,
          child: Stack(
            alignment: Alignment.center,
            children: [
              SvgPicture.asset(
                '$_engagementIcons/send_circle.svg',
                width: 44,
                height: 44,
              ),
              if (busy)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              else
                SvgPicture.asset(
                  '$_engagementIcons/send_white.svg',
                  width: 21,
                  height: 21,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The answer box — "Type your answer...", "Tag @teammate..." — with its
/// send circle (node 3261:24203).
class _AnswerField extends StatelessWidget {
  const _AnswerField({
    required this.controller,
    required this.hint,
    required this.onSend,
    this.focusNode,
    this.busy = false,
    this.enabled = true,
    this.maxLength,
  });

  final TextEditingController controller;
  final String hint;
  final VoidCallback onSend;
  final FocusNode? focusNode;
  final bool busy;
  final bool enabled;
  final int? maxLength;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 59,
      padding: const EdgeInsets.only(left: 21, right: 8),
      decoration: BoxDecoration(
        color: _EngagementColors.answerFill,
        border: Border.all(color: _EngagementColors.answerBorder, width: 2),
        borderRadius: const BorderRadius.only(
          topLeft: Radius.circular(8),
          topRight: Radius.circular(21),
          bottomLeft: Radius.circular(21),
          bottomRight: Radius.circular(21),
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x3334266A),
            blurRadius: 12,
            spreadRadius: -3,
            offset: Offset(0, 7),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: controller,
              focusNode: focusNode,
              enabled: enabled,
              maxLength: maxLength,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => onSend(),
              style: const TextStyle(
                fontFamily: _soraFont,
                fontSize: 13,
                color: _EngagementColors.ink,
              ),
              // The container draws the box; the app's InputDecorationTheme
              // would otherwise fill and outline the field a second time.
              decoration: InputDecoration(
                isDense: true,
                counterText: '',
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                disabledBorder: InputBorder.none,
                contentPadding: EdgeInsets.zero,
                hintText: hint,
                hintStyle: const TextStyle(
                  fontFamily: _soraFont,
                  fontSize: 13,
                  color: _EngagementColors.answerHint,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          _SendCircle(onTap: enabled ? onSend : null, busy: busy),
        ],
      ),
    );
  }
}

/// The "YOUR TAKE" tab that sits on the tag box (node 3103:48521).
class _TurnLabel extends StatelessWidget {
  const _TurnLabel();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 34,
      padding: const EdgeInsets.only(left: 9, right: 26),
      decoration: const BoxDecoration(
        color: _EngagementColors.turnFill,
        borderRadius: BorderRadius.vertical(top: Radius.circular(17)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 22,
            height: 22,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                SvgPicture.asset(
                  '$_engagementIcons/user_badge.svg',
                  width: 22,
                  height: 22,
                ),
                Positioned(
                  left: 3,
                  top: 2,
                  child: SvgPicture.asset(
                    '$_engagementIcons/user_round.svg',
                    width: 14,
                    height: 14,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          const Text(
            'YOUR TAKE',
            style: TextStyle(
              fontFamily: _soraFont,
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: _EngagementColors.turnText,
            ),
          ),
        ],
      ),
    );
  }
}

/// A decoration rotated inside the box the design draws around it.
class _Sticker extends StatelessWidget {
  const _Sticker({
    required this.boxWidth,
    required this.boxHeight,
    required this.degrees,
    required this.child,
  });

  final double boxWidth;
  final double boxHeight;
  final double degrees;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: SizedBox(
        width: boxWidth,
        height: boxHeight,
        child: Center(
          child: Transform.rotate(angle: degrees * math.pi / 180, child: child),
        ),
      ),
    );
  }
}

/// The white scribble burst at a picture's corner (node 3684:41668), or its
/// violet twin on the photo contest's card. [boxWidth] and [boxHeight] are
/// the box the design rotates it in, which differs with the angle.
Widget _burstSticker({
  bool violet = false,
  double degrees = -59.8,
  double? boxWidth,
  double? boxHeight,
}) => _Sticker(
  boxWidth: boxWidth ?? (violet ? 57.044 : 70),
  boxHeight: boxHeight ?? (violet ? 57.191 : 69.939),
  degrees: degrees,
  child: SvgPicture.asset(
    violet
        ? '$_engagementIcons/scribble_burst_violet.svg'
        : '$_engagementIcons/scribble_burst.svg',
    width: 51.089,
    height: 51.259,
  ),
);

/// An animated GIF sticker, decoded at the size it is shown rather than at
/// the size it was exported.
Widget _gifSticker(String asset, double width, double height) => Builder(
  builder: (context) {
    final ratio = MediaQuery.devicePixelRatioOf(context);
    return Image.asset(
      asset,
      width: width,
      height: height,
      fit: BoxFit.cover,
      cacheWidth: (width * ratio).round(),
    );
  },
);

/// The yellow speech bubble with its dark outline that sits on a caption's
/// lower corner (node 3684:41715), on the same hard shadow as the caption.
class _CommentBubbleSticker extends StatelessWidget {
  const _CommentBubbleSticker();

  static const double _boxWidth = 37.591;
  static const double _boxHeight = 40.201;

  Widget _bubble({bool shadow = false}) => _Sticker(
    boxWidth: _boxWidth,
    boxHeight: _boxHeight,
    degrees: 17.52,
    // The art runs a pixel past its 29 by 33 frame on each side, and two
    // below, for its stroke.
    child: SizedBox(
      width: 29,
      height: 33,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(
            left: -1,
            top: -1,
            child: SvgPicture.asset(
              '$_engagementIcons/comment_bubble_yellow.svg',
              width: 31,
              height: 35.9965,
              colorFilter: shadow
                  ? const ColorFilter.mode(
                      _EngagementColors.band,
                      BlendMode.srcIn,
                    )
                  : null,
            ),
          ),
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: _boxWidth,
      height: _boxHeight + 4,
      child: Stack(
        children: [
          Positioned(left: 0, top: 4, child: _bubble(shadow: true)),
          Positioned(left: 0, top: 0, child: _bubble()),
        ],
      ),
    );
  }
}

/// The yellow camera on the photo contest's picture (node 3684:42130): the
/// doodle drawn 51.3 by 45.4, turned 12.18 degrees in its 59.5 by 55.2 box.
class _CameraSticker extends StatelessWidget {
  const _CameraSticker();

  @override
  Widget build(BuildContext context) {
    return _Sticker(
      boxWidth: 59.47,
      boxHeight: 55.2,
      degrees: 12.18,
      child: SizedBox(
        width: 51.29,
        height: 45.38,
        // The art runs past that frame by its stroke (2.43% either side,
        // 2.76% above and 2.73% below).
        child: OverflowBox(
          maxWidth: 53.78,
          maxHeight: 47.87,
          child: SvgPicture.asset(
            '$_engagementIcons/camera_doodle.svg',
            width: 53.78,
            height: 47.87,
          ),
        ),
      ),
    );
  }
}

/// The little dark figure on the Most Likely card (nodes 3684:42458-42459,
/// 3687:42462): a round head with two white eyes on a half-round body, 41
/// by 40. Each shape's art runs past its frame by half its stroke.
class _GhostSticker extends StatelessWidget {
  const _GhostSticker();

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: SizedBox(
        width: 41,
        height: 40,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned(
              left: 7 - 2.157,
              top: -2.157,
              child: SvgPicture.asset(
                '$_engagementIcons/ghost_head.svg',
                width: 31.3148,
                height: 32.3148,
              ),
            ),
            Positioned(
              left: -2.157,
              top: 20 - 2.157,
              child: SvgPicture.asset(
                '$_engagementIcons/ghost_body.svg',
                width: 45.3149,
                height: 24.3148,
              ),
            ),
            for (final left in const [12.0, 21.0])
              Positioned(
                left: left,
                top: 7,
                child: SvgPicture.asset(
                  '$_engagementIcons/ghost_eye.svg',
                  width: 8,
                  height: 7,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Shown where the entry box would be once a contest has closed.
class _EngagementClosedNote extends StatelessWidget {
  const _EngagementClosedNote();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 12),
      child: Text(
        'This contest has closed.',
        textAlign: TextAlign.center,
        style: TextStyle(
          fontFamily: _soraFont,
          fontSize: 12,
          height: 16.2 / 12,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.16,
          color: _EngagementColors.inkSecondary,
        ),
      ),
    );
  }
}

/// The white card inside a photo or tag contest — "Team's snap", "Who's been
/// tagged" (node 3103:48155).
class _EngagementInnerCard extends StatelessWidget {
  const _EngagementInnerCard({required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _EngagementColors.border, width: 1.129),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              label,
              style: const TextStyle(
                fontFamily: _soraFont,
                fontSize: 12,
                height: 16.2 / 12,
                fontWeight: FontWeight.w600,
                letterSpacing: -0.16,
                color: _EngagementColors.ink,
              ),
            ),
          ),
          Container(
            padding: const EdgeInsets.only(top: 8),
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: _EngagementColors.border)),
            ),
            child: child,
          ),
        ],
      ),
    );
  }
}

/// A small filled or outlined button inside the white cards — "Vote",
/// "See all nominations" (node 3327:20719).
class _SmallEngagementButton extends StatelessWidget {
  const _SmallEngagementButton({
    required this.label,
    required this.onTap,
    this.filled = true,
    this.onLongPress,
  });

  final String label;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final active = onTap != null;
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        decoration: BoxDecoration(
          color: filled ? _EngagementColors.brand : Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: filled || active
                ? _EngagementColors.brand
                : _EngagementColors.border,
            width: 1.129,
          ),
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontFamily: _soraFont,
            fontSize: 12,
            height: 17 / 12,
            fontWeight: FontWeight.w600,
            letterSpacing: -0.16,
            color: filled
                ? Colors.white
                : (active
                      ? _EngagementColors.brand
                      : _EngagementColors.inkTertiary),
          ),
        ),
      ),
    );
  }
}

/// Asks before an entry comes down: it may already hold votes, and deleting
/// gives those up with the points they earned.
Future<void> _confirmDeleteEntry(
  BuildContext context,
  ConnectCaptionEntry entry,
  Future<void> Function()? onDelete, {
  String noun = 'entry',
}) async {
  if (onDelete == null) return;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text('Delete your $noun?'),
      content: Text(
        entry.votes == 0
            ? 'You can enter again straight after.'
            : 'It has ${entry.votes} vote${entry.votes == 1 ? '' : 's'}. '
                  'Deleting gives up those votes and the points they earned.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(dialogContext, true),
          child: const Text('Delete'),
        ),
      ],
    ),
  );
  if (confirmed == true) await onDelete();
}

/// The colour a tag bar takes: the podium's yellow, blue and mint, the muted
/// blue-grey after that — and, past the podium, green for the person the
/// viewer tagged and brand blue for the viewer themselves (node 3332:23582).
Color _tagBarColor(ConnectCaptionEntry row, ConnectPost post) {
  final rank = row.rank ?? 0;
  switch (rank) {
    case 1:
      return _EngagementColors.yellow;
    case 2:
      return _EngagementColors.blue;
    case 3:
      return _EngagementColors.mint;
  }
  if (row.userId == post.myTaggedUserId) return _EngagementColors.liveGreen;
  if (row.isMine) return _EngagementColors.brand;
  return _EngagementColors.muted;
}

/// One contest card body, for all three formats: the heading, the format's
/// own content, then the way in — the lime button, the answer box once it is
/// tapped, or nothing once you have entered.
class _EngagementBody extends StatefulWidget {
  const _EngagementBody({
    required this.post,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
    required this.onSubmitCaption,
    required this.onDeleteCaption,
    required this.onVoteCaption,
  });

  final ConnectPost post;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  /// Sends the entry; false when it did not go.
  final Future<bool> Function(
    String text,
    String? photoPath,
    String? taggedUserId,
  )?
  onSubmitCaption;
  final Future<void> Function()? onDeleteCaption;
  final Future<void> Function(String entryId)? onVoteCaption;

  @override
  State<_EngagementBody> createState() => _EngagementBodyState();
}

class _EngagementBodyState extends State<_EngagementBody> {
  final _answer = TextEditingController();
  final _answerFocus = FocusNode();
  final _pages = PageController();
  int _page = 0;

  /// The lime button was tapped: the answer box replaces it.
  bool _answering = false;
  bool _busy = false;

  /// The picture chosen for a photo entry, before it is sent.
  String? _photoPath;

  /// Most Likely: the colleague picked from the suggestions.
  ConnectTeammate? _picked;

  /// The suggestions live in the app's overlay rather than in the card, so
  /// they can hang over the content above the box. Painting them out of the
  /// card's bounds would look right but take no taps.
  final _portal = OverlayPortalController();
  final _link = LayerLink();

  ConnectPost get _post => widget.post;
  bool get _isCaption => _post.type == ConnectPostType.captionChallenge;
  bool get _isPhoto => _post.type == ConnectPostType.photoStoryChallenge;
  bool get _isTag => _post.type == ConnectPostType.mostLikely;

  bool get _closed => _contestClosed(_post);

  Widget _countdownRow() => _CountdownRow(
    closesAt: _closesAtOf(_post),
    closed: _closed,
    onEnded: () {
      if (!mounted) return;
      setState(() {
        _answering = false;
        _syncPortal();
      });
    },
  );

  @override
  void initState() {
    super.initState();
    _answer.addListener(() {
      if (!_isTag) return;
      // Typing past a chosen name means they are looking for someone else.
      if (_picked != null && _query != _picked!.name.toLowerCase()) {
        _picked = null;
      }
      setState(_syncPortal);
    });
    _answerFocus.addListener(() {
      if (_isTag) setState(_syncPortal);
    });
  }

  @override
  void didUpdateWidget(_EngagementBody old) {
    super.didUpdateWidget(old);
    // The carousel shrinks when an entry comes down; keep the page in range.
    final count = _pageCount;
    if (count > 0 && _page >= count) _page = count - 1;
  }

  @override
  void dispose() {
    _answer.dispose();
    _answerFocus.dispose();
    _pages.dispose();
    super.dispose();
  }

  /// The typed name, without the '@' the design shows in front of it.
  String get _query =>
      _answer.text.trim().replaceFirst(RegExp(r'^@+'), '').toLowerCase();

  void _syncPortal() {
    final wanted = _answering && _answerFocus.hasFocus && _picked == null;
    if (wanted && !_portal.isShowing) {
      _portal.show();
    } else if (!wanted && _portal.isShowing) {
      _portal.hide();
    }
  }

  /// Everyone in the org, minus whoever is looking — you cannot tag yourself.
  List<ConnectTeammate> get _matches {
    final scope = _FeedScope.of(context);
    if (scope == null || scope.people.isEmpty) return const [];
    final typed = _query;
    return scope.people
        .where(
          (person) =>
              person.userId.isNotEmpty && person.userId != scope.viewerUserId,
        )
        .where(
          (person) =>
              typed.isEmpty || person.name.toLowerCase().contains(typed),
        )
        .take(24)
        .toList();
  }

  int get _pageCount {
    if (_isTag) return (_post.captionLeaderboard.length / 3).ceil();
    return _post.captionEntries.length;
  }

  /// The lime button: opens the answer box — for a photo contest, the photo
  /// picker first, since the picture is the entry.
  Future<void> _startAnswer() async {
    if (widget.onSubmitCaption == null || _closed) return;
    if (_isPhoto) {
      final picked = await _pickPhoto();
      if (!picked) return;
    }
    if (!mounted) return;
    setState(() => _answering = true);
    _answerFocus.requestFocus();
  }

  Future<bool> _pickPhoto() async {
    final picked = await pickImageFrom(context);
    if (picked == null || !mounted) return false;
    // Cropped to the card's own photo well, so what someone lines up here is
    // exactly what the feed shows.
    final cropped = await cropImageFile(
      context,
      path: picked.path,
      title: 'Crop your photo',
      initial: CropShape.challengeCard,
      allowShapeChange: false,
    );
    if (cropped == null || !mounted) return false;
    setState(() => _photoPath = cropped);
    return true;
  }

  Future<void> _submit() async {
    final submit = widget.onSubmitCaption;
    if (submit == null || _busy) return;
    final text = _answer.text.trim();
    String? taggedUserId;
    if (_isTag) {
      // A name typed in full counts as a pick, so someone who knows the
      // spelling does not have to go back and hunt for the row.
      final typed = _query;
      final chosen =
          _picked ??
          _matches.where((p) => p.name.toLowerCase() == typed).firstOrNull;
      if (chosen == null) {
        showAppToast(context, 'Pick a colleague from the list');
        return;
      }
      taggedUserId = chosen.userId;
    } else if (_isPhoto) {
      // The picture is the entry; a story under it is welcome, not required.
      if (_photoPath == null) {
        showAppToast(context, 'Add the photo you caught');
        return;
      }
    } else if (text.isEmpty) {
      return;
    }
    setState(() => _busy = true);
    try {
      final sent = await submit(
        _isTag ? '' : text,
        _isPhoto ? _photoPath : null,
        taggedUserId,
      );
      // An entry that did not go keeps what was written and the photo, for
      // another try; the feed has said why.
      if (!sent || !mounted) return;
      _answer.clear();
      _answerFocus.unfocus();
      setState(() {
        _photoPath = null;
        _picked = null;
        _answering = false;
        _syncPortal();
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _untag() async {
    final remove = widget.onDeleteCaption;
    if (remove == null || _busy) return;
    setState(() => _busy = true);
    try {
      await remove();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _openEntries() =>
      _openEntriesSheet(context, _post, onAddEntry: _startAnswer);

  /// Votes on their way. The server flips a vote, so a second tap on the
  /// same entry before the first is answered would take it straight back.
  final _voting = <String>{};

  Future<void> _vote(String entryId) async {
    final vote = widget.onVoteCaption;
    if (vote == null || _closed || !_voting.add(entryId)) return;
    try {
      await vote(entryId);
    } finally {
      _voting.remove(entryId);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _EngagementHeader(
          post: _post,
          canManage: widget.canManage,
          onEdit: widget.onEdit,
          onDelete: widget.onDelete,
        ),
        Padding(
          // 14 top, 18 bottom, 22 each side (node 3248:23516).
          padding: const EdgeInsets.fromLTRB(22, 14, 22, 18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ..._heading(),
              if (_isCaption) ..._captionContent(),
              if (_isPhoto) ..._photoContent(),
              if (_isTag) ..._tagContent(),
            ],
          ),
        ),
      ],
    );
  }

  List<Widget> _heading() {
    final title = _bodyString(_post, 'title');
    if (_isPhoto) {
      // A photo contest leads with its task — "Post a photo of someone…" —
      // set as the heading (node 3388:30098); its name stands in when there
      // is no task.
      final task = _bodyString(_post, 'task');
      return [
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            task.isNotEmpty
                ? task
                : (title.isEmpty ? 'Caught red handed' : title),
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            // Bold and dark, at the line height Figma's "normal" gives Sora
            // (node 3684:42031).
            style: const TextStyle(
              fontFamily: _soraFont,
              fontSize: 20,
              height: 1.26,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.16,
              color: _EngagementColors.ink,
            ),
          ),
        ),
        // 8 around the row and 4 more above it (node 3684:42111).
        Padding(
          padding: const EdgeInsets.only(top: 12, bottom: 8),
          child: _countdownRow(),
        ),
      ];
    }
    if (_isTag) {
      // The tag is the title ("Lunch Thief"). Older posts asked a question
      // instead; where there is one it reads in place of the standard line.
      final question = _bodyString(_post, 'question');
      return [
        _EngagementTitle(title.isEmpty ? 'Most Likely' : title),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            question.isNotEmpty
                ? question
                : 'Nominate the teammate who fits this tag',
            style: const TextStyle(
              fontFamily: _soraFont,
              fontSize: 12,
              height: 16.2 / 12,
              fontWeight: FontWeight.w600,
              letterSpacing: -0.16,
              color: _EngagementColors.inkSecondary,
            ),
          ),
        ),
        // 8 around the row and 4 more above it (node 3684:42446).
        Padding(
          padding: const EdgeInsets.only(top: 12, bottom: 8),
          child: _countdownRow(),
        ),
      ];
    }
    final task = _bodyString(_post, 'task');
    return [
      _EngagementTitle(title.isEmpty ? 'Caption this' : title),
      if (task.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            task,
            style: const TextStyle(
              fontFamily: _soraFont,
              fontSize: 12,
              height: 16.2 / 12,
              fontWeight: FontWeight.w600,
              letterSpacing: -0.16,
              color: _EngagementColors.inkSecondary,
            ),
          ),
        ),
      Padding(padding: const EdgeInsets.only(top: 4), child: _countdownRow()),
    ];
  }

  // ---- Caption contest --------------------------------------------------

  /// The width the design draws the contest's content at; a narrower phone
  /// scales the whole well down rather than squeezing it out of shape.
  static const double _wellWidth = 308;

  /// How far the caption bubbles ride up over the picture (its -46 margin).
  static const double _bubbleOverlap = 46;
  static const double _photoBoxHeight = 221.163;
  static const double _photoBoxWidth = 286.54;

  List<Widget> _captionContent() {
    final entries = _post.captionEntries;
    final mediaUrl = _bodyString(_post, 'mediaUrl');
    final wellHeight = entries.isEmpty
        ? _photoBoxHeight
        : _photoBoxHeight - _bubbleOverlap + 80;
    const photoLeft = (_wellWidth - _photoBoxWidth) / 2;
    const bubbleTop = _photoBoxHeight - _bubbleOverlap;
    final well = SizedBox(
      width: _wellWidth,
      height: wellHeight,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(
            left: photoLeft,
            top: 0,
            child: _TiltedPhoto(url: mediaUrl),
          ),
          if (entries.isNotEmpty) ...[
            Positioned(
              left: 0,
              right: 0,
              top: bubbleTop,
              // The bubble's hard shadow hangs 4 below it.
              height: 80 + 4,
              child: PageView.builder(
                controller: _pages,
                itemCount: entries.length,
                onPageChanged: (index) => setState(() => _page = index),
                itemBuilder: (context, index) => Align(
                  alignment: Alignment.topLeft,
                  child: _captionBubble(entries[index]),
                ),
              ),
            ),
            // The yellow speech bubble at the caption's lower corner
            // (node 3684:41715), over every page alike. The caption's 56 of
            // face and gap, then its own 227.7 and 52.88.
            const Positioned(
              left: 56 + 227.7,
              top: bubbleTop + 52.88,
              child: _CommentBubbleSticker(),
            ),
          ],
          // The white scribble burst at the picture's top-left corner
          // (node 3684:41668): 17 left of the card's edge, 68.88 down its
          // body, which puts it here against the picture.
          const Positioned(
            left: photoLeft - 49.72,
            top: -21.35,
            child: _BurstAt(),
          ),
          // The chat bubble that pops up over the picture's corner
          // (node 3684:41709).
          Positioned(
            left: photoLeft + 203.28,
            top: -41.35,
            child: _Sticker(
              boxWidth: 111.802,
              boxHeight: 113,
              degrees: 12.13,
              child: SizedBox(
                width: 93.852,
                height: 95.412,
                child: ClipRect(
                  child: OverflowBox(
                    alignment: Alignment.topLeft,
                    maxWidth: 120.32,
                    maxHeight: 122.32,
                    child: Transform.translate(
                      offset: const Offset(-4.8, -4.67),
                      child: _gifSticker(
                        '$_engagementIcons/message_bubble.gif',
                        120.32,
                        122.32,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
    final mine = _post.myCaptionEntryId != null;
    return [
      Padding(
        padding: const EdgeInsets.only(top: 16, bottom: 4),
        child: Column(
          children: [
            Center(
              child: FittedBox(fit: BoxFit.scaleDown, child: well),
            ),
            if (entries.isNotEmpty) ...[
              const SizedBox(height: 10),
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: _EngagementPager(
                  count: entries.length,
                  page: _page.clamp(0, entries.length - 1),
                  labelColor: _EngagementColors.onCard,
                ),
              ),
            ],
          ],
        ),
      ),
      if (_closed)
        const _EngagementClosedNote()
      // Once you have captioned there is nothing left to type: the card shows
      // your caption among the others and the link to the entries.
      else if (!mine)
        if (_answering)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: _AnswerField(
              controller: _answer,
              focusNode: _answerFocus,
              hint: 'Type your answer...',
              maxLength: 140,
              busy: _busy,
              enabled: widget.onSubmitCaption != null,
              onSend: _submit,
            ),
          )
        else
          _EngagementCta(label: 'Add your answer', onTap: _startAnswer),
      _ViewEntriesLink(onTap: _openEntries, verticalPadding: mine ? 12 : 8),
    ];
  }

  /// One caption riding on the picture: their face, the caption in the pink
  /// speech bubble on its hard dark shadow, and the vote arrow
  /// (node 3684:41643).
  Widget _captionBubble(ConnectCaptionEntry entry) {
    final canVote = !entry.isMine && !_closed && widget.onVoteCaption != null;
    return Row(
      children: [
        _PersonTap(
          userId: entry.userId,
          child: _EngagementAvatar(
            userId: entry.userId,
            initials: entry.initials,
            size: 48,
            borderColor: _EngagementColors.border,
            fontSize: 18,
          ),
        ),
        const SizedBox(width: 8),
        GestureDetector(
          // Your own caption cannot be voted for; holding it offers to take
          // it down, which is the only way to rewrite it.
          onLongPress: entry.isMine
              ? () => _confirmDeleteEntry(
                  context,
                  entry,
                  widget.onDeleteCaption,
                  noun: 'caption',
                )
              : null,
          child: SizedBox(
            width: 249.583,
            height: 80,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                // The design's drop shadow is solid, 4 straight down, and
                // follows the bubble's outline, tail and all, rather than its
                // bounding box.
                Positioned(
                  left: 0,
                  top: 4,
                  child: SvgPicture.asset(
                    '$_engagementIcons/caption_bubble.svg',
                    width: 249.583,
                    height: 80,
                    colorFilter: const ColorFilter.mode(
                      _EngagementColors.band,
                      BlendMode.srcIn,
                    ),
                  ),
                ),
                SvgPicture.asset(
                  '$_engagementIcons/caption_bubble.svg',
                  width: 249.583,
                  height: 80,
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(40, 12, 20, 12),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (entry.isMine) ...[
                              const Text(
                                'YOU',
                                style: TextStyle(
                                  fontFamily: _soraFont,
                                  fontSize: 10,
                                  height: 16.2 / 10,
                                  fontWeight: FontWeight.w600,
                                  letterSpacing: -0.16,
                                  color: _EngagementColors.you,
                                ),
                              ),
                              const SizedBox(height: 4),
                            ],
                            Text(
                              '“${entry.text}',
                              maxLines: entry.isMine ? 2 : 3,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: _soraFont,
                                fontSize: 12,
                                height: 16.2 / 12,
                                fontWeight: FontWeight.w600,
                                letterSpacing: -0.16,
                                color: _EngagementColors.ink,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 6),
                      Semantics(
                        button: canVote,
                        label: entry.votedByViewer ? 'Voted' : 'Vote',
                        child: GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: canVote ? () => _vote(entry.id) : null,
                          child: Padding(
                            padding: const EdgeInsets.only(bottom: 2),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                SvgPicture.asset(
                                  '$_engagementIcons/arrow_up_thick.svg',
                                  width: 18,
                                  height: 18,
                                ),
                                Text(
                                  '${entry.votes} vote${entry.votes == 1 ? '' : 's'}',
                                  style: TextStyle(
                                    fontFamily: _soraFont,
                                    fontSize: 10,
                                    height: 16.2 / 10,
                                    fontWeight: entry.votedByViewer
                                        ? FontWeight.w700
                                        : FontWeight.w400,
                                    letterSpacing: -0.16,
                                    color: entry.votedByViewer
                                        ? _EngagementColors.you
                                        : _EngagementColors.inkTertiary,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  // ---- Photo contest ----------------------------------------------------

  List<Widget> _photoContent() {
    final entries = _post.captionEntries;
    final mine = _post.myCaptionEntryId != null;
    final card = _EngagementInnerCard(
      label: 'Team’s snap',
      child: entries.isEmpty
          ? const _EmptySnap()
          : SizedBox(
              height: 201 + 13 + 32,
              child: PageView.builder(
                controller: _pages,
                itemCount: entries.length,
                onPageChanged: (index) => setState(() => _page = index),
                itemBuilder: (context, index) => _snapPage(entries[index]),
              ),
            ),
    );
    return [
      Stack(
        clipBehavior: Clip.none,
        children: [
          card,
          // The violet scribble at the card's corner (node 3684:42058).
          Positioned(
            left: 241.87,
            top: -0.48,
            child: _burstSticker(violet: true, degrees: 7.11),
          ),
          // The yellow camera at the photo's lower corner, hanging past the
          // card's edge (node 3684:42130). Held from the card's foot, so it
          // stays on the picture's corner whatever the card holds.
          const Positioned(left: 263.8, bottom: 46.76, child: _CameraSticker()),
        ],
      ),
      if (entries.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 4),
          child: _EngagementPager(
            count: entries.length,
            page: _page.clamp(0, entries.length - 1),
            labelColor: _EngagementColors.inkSecondary,
          ),
        )
      else
        const SizedBox(height: 12),
      if (_closed)
        const _EngagementClosedNote()
      else if (!mine)
        if (_answering && _photoPath != null) ...[
          _PickedPhoto(
            path: _photoPath!,
            onRemove: () => setState(() {
              _photoPath = null;
              _answering = false;
            }),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: _AnswerField(
              controller: _answer,
              focusNode: _answerFocus,
              hint: 'Your story (optional)...',
              maxLength: 200,
              busy: _busy,
              enabled: widget.onSubmitCaption != null,
              onSend: _submit,
            ),
          ),
        ] else
          _EngagementCta(label: 'Add your photo', onTap: _startAnswer),
      _ViewEntriesLink(onTap: _openEntries, verticalPadding: mine ? 12 : 8),
    ];
  }

  /// One entrant's photo, who sent it, its votes and the Vote button
  /// (node 3327:20710).
  Widget _snapPage(ConnectCaptionEntry entry) {
    final closed = _closed;
    final canVote = !entry.isMine && !closed && widget.onVoteCaption != null;
    final String label;
    if (entry.isMine) {
      label = 'Yours';
    } else if (entry.votedByViewer) {
      label = 'Voted';
    } else {
      label = closed ? 'Closed' : 'Vote';
    }
    return Column(
      children: [
        Center(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              width: 272,
              height: 201,
              child: (entry.photoUrl ?? '').isEmpty
                  ? const ColoredBox(color: Color(0xFFF2F2F5))
                  : Image(
                      image: _remoteImage(entry.photoUrl!),
                      fit: BoxFit.cover,
                      // Filled across and held at the top, as the design crops it.
                      alignment: Alignment.topCenter,
                    ),
            ),
          ),
        ),
        const SizedBox(height: 13),
        Row(
          children: [
            _PersonTap(
              userId: entry.userId,
              child: _EngagementAvatar(
                userId: entry.userId,
                initials: entry.initials,
                size: 32,
                fontSize: 13,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '${entry.votes} vote${entry.votes == 1 ? '' : 's'}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: _soraFont,
                  fontSize: 14,
                  height: 16.2 / 14,
                  fontWeight: FontWeight.w600,
                  letterSpacing: -0.16,
                  color: _EngagementColors.inkTertiary,
                ),
              ),
            ),
            const SizedBox(width: 8),
            _SmallEngagementButton(
              label: label,
              filled: canVote && !entry.votedByViewer,
              onTap: canVote ? () => _vote(entry.id) : null,
              // Holding your own photo offers to take it down.
              onLongPress: entry.isMine && !closed
                  ? () => _confirmDeleteEntry(
                      context,
                      entry,
                      widget.onDeleteCaption,
                      noun: 'photo',
                    )
                  : null,
            ),
          ],
        ),
      ],
    );
  }

  // ---- Most Likely (tag) contest ----------------------------------------

  List<Widget> _tagContent() {
    final board = _post.captionLeaderboard;
    final pages = _pageCount;
    final tagged = _post.myTaggedUserId;
    final maxPoints = board.fold<int>(
      0,
      (top, row) => math.max(top, row.points),
    );
    // As tall as the fullest page — the first — so one nomination is one row
    // and not one row over two rows of empty card.
    double listHeight(int rows) => 4 + rows * 47.996 + (rows - 1) * 12;
    final shownRows = math.min(board.length, 3);
    final card = _EngagementInnerCard(
      label: 'Who’s been tagged',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (board.isEmpty)
            const SizedBox(
              height: 48,
              child: Center(
                child: Text(
                  'Be the first one to play',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: _soraFont,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: _EngagementColors.inkTertiary,
                  ),
                ),
              ),
            )
          else
            SizedBox(
              height: listHeight(shownRows),
              child: PageView.builder(
                controller: _pages,
                itemCount: pages,
                onPageChanged: (index) => setState(() => _page = index),
                itemBuilder: (context, index) {
                  final rows = board.skip(index * 3).take(3).toList();
                  return Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Column(
                      children: [
                        for (final (i, row) in rows.indexed) ...[
                          if (i > 0) const SizedBox(height: 12),
                          _TagBar(
                            row: row,
                            color: _tagBarColor(row, _post),
                            maxPoints: maxPoints,
                          ),
                        ],
                      ],
                    ),
                  );
                },
              ),
            ),
          const SizedBox(height: 13),
          Align(
            alignment: Alignment.centerLeft,
            child: _SmallEngagementButton(
              label: 'See all nominations',
              onTap: _openEntries,
            ),
          ),
        ],
      ),
    );
    return [
      Stack(
        clipBehavior: Clip.none,
        children: [
          card,
          // The little dark figure in the card's lower corner, beside "See
          // all nominations" (nodes 3684:42458-42459). Held from the card's
          // foot, so it rides up with it when there are fewer than three
          // rows.
          const Positioned(left: 244, bottom: 5.45, child: _GhostSticker()),
          // The white scribble burst at the card's lower-left, cut by the
          // contest card's edge (node 3687:42559).
          Positioned(
            left: -42,
            bottom: -40.75,
            child: _burstSticker(
              degrees: -145.35,
              boxWidth: 71.17,
              boxHeight: 71.214,
            ),
          ),
        ],
      ),
      if (pages > 0)
        Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 4),
          child: _EngagementPager(
            count: pages,
            page: _page.clamp(0, pages - 1),
            labelColor: _EngagementColors.inkSecondary,
          ),
        )
      else
        const SizedBox(height: 12),
      if (_closed)
        const _EngagementClosedNote()
      else if (tagged != null)
        _taggedRow(tagged)
      else if (_answering)
        Padding(padding: const EdgeInsets.only(top: 12), child: _tagAnswer())
      else
        _EngagementCta(label: 'Nominate', onTap: _startAnswer),
    ];
  }

  /// The "YOUR TAKE" box with the colleague suggestions floating above it
  /// (nodes 3103:48515, 3103:48560), so the list never pushes the card
  /// around as you type.
  Widget _tagAnswer() {
    // Resolved here, under the feed, because the overlay builds outside this
    // subtree and cannot reach the directory itself.
    final matches = _matches;
    return OverlayPortal(
      controller: _portal,
      overlayChildBuilder: (_) {
        if (matches.isEmpty) return const SizedBox.shrink();
        return Positioned(
          width: 227,
          child: CompositedTransformFollower(
            link: _link,
            targetAnchor: Alignment.topLeft,
            followerAnchor: Alignment.bottomLeft,
            offset: const Offset(0, 6),
            child: _ColleagueSuggestions(
              people: matches,
              onPick: (person) {
                setState(() {
                  _picked = person;
                  _answer.text = '@${person.name}';
                  _answer.selection = TextSelection.collapsed(
                    offset: _answer.text.length,
                  );
                  _syncPortal();
                });
              },
            ),
          ),
        );
      },
      child: SizedBox(
        height: 28 + 59,
        child: Stack(
          children: [
            const Positioned(left: 0, top: 0, child: _TurnLabel()),
            Positioned(
              left: 0,
              right: 0,
              top: 28,
              child: CompositedTransformTarget(
                link: _link,
                child: _AnswerField(
                  controller: _answer,
                  focusNode: _answerFocus,
                  hint: 'Tag @teammate...',
                  busy: _busy,
                  enabled: widget.onSubmitCaption != null,
                  onSend: _submit,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Your own tag, once it is in. It cannot be edited — the point has already
  /// moved to them — so the only action is to take it back and pick again.
  Widget _taggedRow(String taggedUserId) {
    final them = _post.captionLeaderboard
        .where((row) => row.userId == taggedUserId)
        .firstOrNull;
    final name = them?.name ?? 'your pick';
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Container(
        height: 59,
        padding: const EdgeInsets.only(left: 12, right: 18),
        decoration: BoxDecoration(
          color: _EngagementColors.answerFill,
          border: Border.all(color: _EngagementColors.answerBorder, width: 2),
          borderRadius: BorderRadius.circular(21),
        ),
        child: Row(
          children: [
            _PersonTap(
              userId: taggedUserId,
              child: _EngagementAvatar(
                userId: taggedUserId,
                initials: them?.initials ?? '?',
                size: 32,
                fontSize: 13,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'You tagged $name',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: _soraFont,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: _EngagementColors.ink,
                ),
              ),
            ),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: _untag,
              behavior: HitTestBehavior.opaque,
              child: Text(
                _busy ? '…' : 'Remove',
                style: const TextStyle(
                  fontFamily: _soraFont,
                  fontSize: 12,
                  height: 16.2 / 12,
                  fontWeight: FontWeight.w600,
                  letterSpacing: -0.16,
                  color: _EngagementColors.brand,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The scribble burst at the caption picture's top-left corner.
class _BurstAt extends StatelessWidget {
  const _BurstAt();

  @override
  Widget build(BuildContext context) => _burstSticker();
}

/// The caption contest's picture: tilted, in a thick white frame
/// (node 3248:23532).
class _TiltedPhoto extends StatelessWidget {
  const _TiltedPhoto({required this.url});

  final String url;

  @override
  Widget build(BuildContext context) {
    return _TiltedFrame(
      child: url.isEmpty
          ? const ColoredBox(color: Color(0xFFF2F2F5))
          : Image(image: _remoteImage(url), fit: BoxFit.cover),
    );
  }
}

/// The tilted white frame around a caption contest's picture. The design
/// draws the picture 272 by 201 with its 6 of white outside it, so the frame
/// is 284 by 213 — the picture keeps its full size inside it.
class _TiltedFrame extends StatelessWidget {
  const _TiltedFrame({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 286.54,
      height: 221.163,
      child: Center(
        child: Transform.rotate(
          angle: -4.37 * math.pi / 180,
          child: Container(
            width: 272 + 12,
            height: 201 + 12,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: Colors.white, width: 6),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: child,
            ),
          ),
        ),
      ),
    );
  }
}

/// A photo contest nobody has entered yet.
class _EmptySnap extends StatelessWidget {
  const _EmptySnap();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 272,
        height: 201,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: const Color(0xFFF2F2F5),
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Text(
          'Be the first one to catch',
          style: TextStyle(
            fontFamily: _soraFont,
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: _EngagementColors.inkTertiary,
          ),
        ),
      ),
    );
  }
}

/// The photo just picked for an entry, with a cross to drop it.
class _PickedPhoto extends StatelessWidget {
  const _PickedPhoto({required this.path, required this.onRemove});

  final String path;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Stack(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Image.file(
              File(path),
              height: 180,
              width: double.infinity,
              fit: BoxFit.cover,
            ),
          ),
          Positioned(
            right: 8,
            top: 8,
            child: GestureDetector(
              onTap: onRemove,
              behavior: HitTestBehavior.opaque,
              child: Container(
                padding: const EdgeInsets.all(5),
                decoration: const BoxDecoration(
                  color: Color(0x99000000),
                  shape: BoxShape.circle,
                ),
                child: SvgPicture.asset(
                  '$_engagementIcons/cross.svg',
                  width: 14,
                  height: 14,
                  colorFilter: const ColorFilter.mode(
                    Colors.white,
                    BlendMode.srcIn,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One nominee on the tag card: the bar in their rank's colour, their face
/// at its end and their points (node 3103:48275). Names are left off the
/// feed card, as the design draws it; the entries sheet shows them.
class _TagBar extends StatelessWidget {
  const _TagBar({
    required this.row,
    required this.color,
    required this.maxPoints,
  });

  final ConnectCaptionEntry row;
  final Color color;
  final int maxPoints;

  @override
  Widget build(BuildContext context) {
    // The design's bars run from a fifth of the width for nobody to about
    // half for the leader (141.67 of 273 for 110 points, 94.44 for 50).
    final share = maxPoints == 0 ? 0.0 : row.points / maxPoints;
    final fraction = (0.2 + 0.32 * share).clamp(0.0, 1.0);
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final fill = width * fraction;
        return Container(
          height: 47.996,
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: color, width: 1.114),
          ),
          child: Stack(
            children: [
              Positioned(
                left: 0,
                top: 0,
                bottom: 0,
                width: fill,
                child: ColoredBox(color: color),
              ),
              Positioned(
                left: fill,
                top: 5.42,
                child: _PersonTap(
                  userId: row.userId,
                  child: _EngagementAvatar(
                    userId: row.userId,
                    initials: row.initials,
                    size: 33,
                    fontSize: 13,
                  ),
                ),
              ),
              Positioned(
                right: 12,
                top: 0,
                bottom: 0,
                child: Center(
                  child: Text(
                    '${row.points}pt',
                    style: TextStyle(
                      fontFamily: _soraFont,
                      fontSize: 16,
                      height: 24 / 16,
                      fontWeight: FontWeight.w700,
                      color: color,
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// The colleague picker that floats over the card while you type
/// (node 3103:48560) — 227 wide, capped at 144 tall so it scrolls rather than
/// growing past the card.
class _ColleagueSuggestions extends StatelessWidget {
  const _ColleagueSuggestions({required this.people, required this.onPick});

  final List<ConnectTeammate> people;
  final ValueChanged<ConnectTeammate> onPick;

  static const _gradients = [
    [Color(0xFF667EEA), Color(0xFF764BA2)],
    [Color(0xFFEA66E1), Color(0xFF8C4BA2)],
    [Color(0xFF9FEA66), Color(0xFF89A24B)],
  ];

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: Container(
        width: 227,
        constraints: const BoxConstraints(maxHeight: 144),
        decoration: BoxDecoration(
          color: const Color(0xFFF7F7F9),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: _EngagementColors.border, width: 1.114),
          boxShadow: const [
            BoxShadow(
              color: Color(0x1A6D28D9),
              blurRadius: 16,
              offset: Offset(0, 4),
            ),
          ],
        ),
        child: ListView.separated(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
          shrinkWrap: true,
          itemCount: people.length,
          separatorBuilder: (_, _) => const SizedBox(height: 12),
          itemBuilder: (context, index) {
            final person = people[index];
            final photo = person.photoUrl ?? '';
            return Listener(
              behavior: HitTestBehavior.opaque,
              onPointerDown: (_) => onPick(person),
              child: Container(
                decoration: BoxDecoration(
                  border: index == 0
                      ? const Border(
                          bottom: BorderSide(
                            color: Color(0xFFF5F5F5),
                            width: 1.114,
                          ),
                        )
                      : null,
                ),
                child: Row(
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      alignment: Alignment.center,
                      clipBehavior: Clip.antiAlias,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: _gradients[index % _gradients.length],
                        ),
                      ),
                      child: photo.isNotEmpty
                          ? Image(
                              image: _remoteImage(photo),
                              width: 36,
                              height: 36,
                              fit: BoxFit.cover,
                            )
                          : Text(
                              person.initials.characters.take(2).toString(),
                              style: const TextStyle(
                                fontFamily: _soraFont,
                                fontSize: 11.52,
                                height: 17.28 / 11.52,
                                fontWeight: FontWeight.w700,
                                color: Colors.white,
                              ),
                            ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            person.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontFamily: _soraFont,
                              fontSize: 14,
                              height: 21 / 14,
                              fontWeight: FontWeight.w600,
                              color: _EngagementColors.ink,
                            ),
                          ),
                          if (person.department.isNotEmpty)
                            Text(
                              person.department,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: _soraFont,
                                fontSize: 12,
                                height: 18 / 12,
                                fontWeight: FontWeight.w400,
                                color: _EngagementColors.inkTertiary,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
