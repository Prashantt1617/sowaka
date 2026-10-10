part of 'connect_feed_screen.dart';

// Setting up a contest ("New post-engagement", frames 3417:51828 and
// 3464:62471): pick the format from the pills, name it on a live preview of
// the card it will become, choose how long it runs, and go live — or press
// Done to see it in the composer first ("New Post-Media", frame 3515:68767).
//
// A company with the Games tab sets contests up there instead ("New
// post-engagement game created", frame 3677:40066): the format is picked on
// the Games tab, so the screen opens on it with no pills and no Done, and Go
// live publishes from here — see [openContestComposer].

/// The three contest formats, as the pills offer them (node 3417:52959).
enum ContestFormat { caption, content, mostLikely }

extension ContestFormatMeta on ContestFormat {
  /// The pill's label. Upper-cased where it is drawn.
  String get label => switch (this) {
    ContestFormat.caption => 'Caption This',
    ContestFormat.content => 'Best Photo',
    ContestFormat.mostLikely => 'Most Likely',
  };

  /// The pill's 3D icon (nodes 3417:53523, 3417:53072, 3454:61971).
  String get icon => switch (this) {
    ContestFormat.caption => '$_engagementIcons/contest_caption.png',
    ContestFormat.content => '$_engagementIcons/contest_photo.png',
    ContestFormat.mostLikely => '$_engagementIcons/contest_most_likely.png',
  };

  ConnectPostType get postType => switch (this) {
    ContestFormat.caption => ConnectPostType.captionChallenge,
    ContestFormat.content => ConnectPostType.photoStoryChallenge,
    ContestFormat.mostLikely => ConnectPostType.mostLikely,
  };

  /// The heading a card falls back to when nobody names the contest — the
  /// same defaults the server applies.
  String get defaultTitle => switch (this) {
    ContestFormat.caption => 'Caption this',
    ContestFormat.content => 'Caught red handed',
    ContestFormat.mostLikely => 'Most Likely',
  };

  static ContestFormat? fromType(ConnectPostType type) => switch (type) {
    ConnectPostType.captionChallenge => ContestFormat.caption,
    ConnectPostType.photoStoryChallenge => ContestFormat.content,
    ConnectPostType.mostLikely => ContestFormat.mostLikely,
    _ => null,
  };
}

/// What the contest screen hands back: the post to publish, the picture it
/// carries if the format takes one, and whether it should go live at once.
class ContestDraft {
  const ContestDraft({
    required this.format,
    required this.body,
    this.photoPath,
    this.existingMediaUrl,
    this.goLive = false,
  });

  final ContestFormat format;
  final Map<String, dynamic> body;

  /// A picture picked on this phone, still to be uploaded.
  final String? photoPath;

  /// The picture an existing contest already has, shown while editing.
  final String? existingMediaUrl;

  /// "Go live" rather than "Done": publish straight away.
  final bool goLive;

  String get title => '${body['title'] ?? ''}';
  String get task => '${body['task'] ?? ''}';
  String get closesAt => '${body['closesAt'] ?? ''}';

  /// The post as the API takes it, with the picture attached when there is a
  /// new one.
  Future<ConnectPostDraft> toPostDraft() async {
    final photo = photoPath;
    if (photo == null) {
      return ConnectPostDraft(type: format.postType, body: body);
    }
    return ConnectPostDraft(
      type: format.postType,
      body: body,
      media: ConnectMediaAttachment(
        path: photo,
        name: photo.split(Platform.pathSeparator).last,
        size: await File(photo).length(),
        mimeType: 'image/jpeg',
      ),
    );
  }
}

const _composerInk = Color(0xFF222222);
const _composerTertiary = Color(0xFF717171);
const _composerSecondary = Color(0xFF484848);
const _composerBrand = Color(0xFF0571A6);
const _composerMuted = Color(0xFF96B7C7);
const _composerSurface = Color(0xFFF7F7F9);

/// Whether contests are set up from the Games tab rather than from the
/// Connect composer: true for a company whose app has the Games tab, whose
/// Explore games section creates them. Without it (convrse today) the
/// composer's Contest chip stays the way in.
bool contestsStartFromGames(List<String> enabledTabs) =>
    visibleTabs(enabledTabs).contains(ManagerTab.games);

/// Opens the contest screen from outside the Connect feed — the Games tab's
/// Create on Caption This, Best Photo or Most Likely — with [format] already
/// chosen, and publishes the contest when Go live is pressed. The screen
/// stays open with a spinner on Go live until the contest is up, so a failed
/// upload loses nothing typed. Returns the post as the server made it, or
/// null if they backed out.
///
/// [feed] is the shell's [ConnectComposerController]. While the Connect feed
/// is mounted the contest goes up through it — the same path the composer's
/// Contest chip uses — so it lands at the top of the feed at once with the
/// feed's own "Post published" (or its error). Without one, or before the
/// feed has mounted, it goes straight to the server with [session].
Future<ConnectPost?> openContestComposer(
  BuildContext context, {
  required AuthSession session,
  ContestFormat? format,
  ConnectComposerController? feed,
}) async {
  ConnectPost? created;
  await Navigator.of(context).push<ContestDraft>(
    MaterialPageRoute(
      builder: (_) => ContestComposerPage(
        initialFormat: format ?? ContestFormat.caption,
        publish: (draft) async {
          created = await _publishContest(
            context,
            draft,
            session: session,
            feed: feed,
          );
          return created != null;
        },
      ),
    ),
  );
  return created;
}

Future<ConnectPost?> _publishContest(
  BuildContext context,
  ContestDraft contest, {
  required AuthSession session,
  ConnectComposerController? feed,
}) async {
  final ConnectPostDraft draft;
  try {
    draft = await contest.toPostDraft();
  } catch (_) {
    if (context.mounted) {
      showAppToast(context, 'That picture could not be read. Pick it again.');
    }
    return null;
  }
  final viaFeed = feed?._state;
  if (viaFeed != null && viaFeed.mounted) {
    // The feed says "Post published", or why not, itself.
    return viaFeed._bloc.publishPost(draft);
  }
  try {
    final post = await ConnectApiService(session: session).createPost(draft);
    if (context.mounted) showAppToast(context, 'Post published');
    return post;
  } catch (error) {
    if (context.mounted) showAppToast(context, error.toString());
    return null;
  }
}

class ContestComposerPage extends StatefulWidget {
  const ContestComposerPage({
    super.key,
    this.existing,
    this.draft,
    this.initialFormat,
    this.publish,
  });

  /// A contest already in the feed, being edited.
  final ConnectPost? existing;

  /// A draft from earlier in this composer session ("Edit" on its preview).
  final ContestDraft? draft;

  /// The format chosen before the screen opened — on the Games tab. The
  /// screen opens on it without the format pills or Done (frame 3677:40066):
  /// Go live is the one way out.
  final ContestFormat? initialFormat;

  /// Puts the contest up from this screen when Go live is pressed, and says
  /// whether it went up; the screen closes, handing back the draft, only if
  /// it did. Without it Go live hands the draft straight back, for the
  /// Connect composer to post.
  final Future<bool> Function(ContestDraft draft)? publish;

  @override
  State<ContestComposerPage> createState() => _ContestComposerPageState();
}

class _ContestComposerPageState extends State<ContestComposerPage> {
  late ContestFormat _format;
  final _title = TextEditingController();
  final _task = TextEditingController();
  String _closesAt = '';
  String? _photoPath;
  String? _existingMediaUrl;

  /// The rest of an existing post's body (a Most Likely question, its
  /// label), carried through untouched.
  Map<String, dynamic> _carried = const {};

  /// Go live was pressed and the contest is on its way up.
  bool _publishing = false;

  bool get _editing => widget.existing != null;

  /// Opened from the Games tab with the format already picked there.
  bool get _formatPicked =>
      widget.initialFormat != null &&
      widget.existing == null &&
      widget.draft == null;

  @override
  void initState() {
    super.initState();
    final existing = widget.existing;
    final draft = widget.draft;
    if (existing != null) {
      _format =
          ContestFormatMeta.fromType(existing.type) ?? ContestFormat.caption;
      _title.text = _bodyString(existing, 'title');
      _task.text = _bodyString(existing, 'task');
      _closesAt = _bodyString(existing, 'closesAt');
      final media = _bodyString(existing, 'mediaUrl');
      _existingMediaUrl = media.isEmpty ? null : media;
      _carried = {
        if (_bodyString(existing, 'label').isNotEmpty)
          'label': _bodyString(existing, 'label'),
        if (_bodyString(existing, 'question').isNotEmpty)
          'question': _bodyString(existing, 'question'),
      };
    } else if (draft != null) {
      _format = draft.format;
      _title.text = draft.title;
      _task.text = draft.task;
      _closesAt = draft.closesAt;
      _photoPath = draft.photoPath;
      _existingMediaUrl = draft.existingMediaUrl;
    } else {
      _format = widget.initialFormat ?? ContestFormat.caption;
      _title.text = _format.defaultTitle;
    }
    for (final controller in [_title, _task]) {
      controller.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _task.dispose();
    super.dispose();
  }

  bool get _hasPicture => _photoPath != null || _existingMediaUrl != null;

  bool get _canPost {
    return switch (_format) {
      ContestFormat.caption => _title.text.trim().isNotEmpty && _hasPicture,
      ContestFormat.content => _task.text.trim().isNotEmpty,
      ContestFormat.mostLikely => _title.text.trim().isNotEmpty,
    };
  }

  void _chooseFormat(ContestFormat format) {
    if (_editing || format == _format) return;
    setState(() {
      // A name still at the old format's default follows the new format.
      if (_title.text.trim().isEmpty ||
          _title.text.trim() == _format.defaultTitle) {
        _title.text = format.defaultTitle;
      }
      _format = format;
    });
  }

  Future<void> _pickPhoto() async {
    final picked = await pickImageFrom(context);
    if (picked == null || !mounted) return;
    // Cropped to the card's own well, so what is lined up here is what the
    // feed shows.
    final cropped = await cropImageFile(
      context,
      path: picked.path,
      title: 'Crop the picture',
      initial: CropShape.challengeCard,
      allowShapeChange: false,
    );
    if (cropped == null || !mounted) return;
    setState(() => _photoPath = cropped);
  }

  /// "Select time" (node 3464:62883): a contest runs for a day or two.
  Future<void> _pickCloseTime() async {
    final days = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => _CloseTimeSheet(selectedDays: _selectedDays),
    );
    if (days == null || !mounted) return;
    setState(() {
      _closesAt = DateTime.now()
          .add(Duration(days: days))
          .toUtc()
          .toIso8601String();
    });
  }

  /// Which of the two lengths the current closing time matches, if either.
  int? get _selectedDays {
    final when = DateTime.tryParse(_closesAt);
    if (when == null) return null;
    final hours = when.difference(DateTime.now()).inMinutes / 60;
    if (hours > 0 && hours <= 24) return 1;
    if (hours > 24 && hours <= 48) return 2;
    return null;
  }

  String get _closesText {
    final when = DateTime.tryParse(_closesAt);
    if (when == null) return 'Click to select close time';
    return 'Closes ${_weekdayTime(when)}';
  }

  Future<void> _finish({required bool goLive}) async {
    if (!_canPost || _publishing) return;
    final title = _title.text.trim();
    final body = <String, dynamic>{
      ..._carried,
      'title': _format == ContestFormat.content
          ? (title.isEmpty ? _format.defaultTitle : title)
          : title,
      'closesAt': _closesAt,
      if (_format != ContestFormat.mostLikely) 'task': _task.text.trim(),
    };
    final draft = ContestDraft(
      format: _format,
      body: body,
      photoPath: _photoPath,
      existingMediaUrl: _existingMediaUrl,
      goLive: goLive,
    );
    final publish = widget.publish;
    if (publish != null && goLive && !_editing) {
      setState(() => _publishing = true);
      final published = await publish(draft);
      if (!mounted) return;
      if (!published) {
        // Why it failed has been said; what was typed stays for another go.
        setState(() => _publishing = false);
        return;
      }
    }
    if (!mounted) return;
    Navigator.of(context).pop(draft);
  }

  @override
  Widget build(BuildContext context) {
    final ready = _canPost;
    // Nobody leaves while the contest is on its way up: it would go live
    // all the same, behind them.
    return PopScope(
      canPop: !_publishing,
      child: Scaffold(
        backgroundColor: _composerSurface,
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              _ContestHeader(
                title: 'Contest',
                onBack: () {
                  if (!_publishing) Navigator.of(context).pop();
                },
                // From the Games tab there is no composer to come back to, so
                // there is no Done (frame 3677:40066).
                actionLabel: _formatPicked ? null : 'Done',
                onAction: ready ? () => _finish(goLive: false) : null,
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
                  children: [
                    if (!_formatPicked) ...[
                      const _ComposerFieldLabel('SELECT THE CONTEST'),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 10,
                        runSpacing: 8,
                        children: [
                          for (final format in ContestFormat.values)
                            _ContestPill(
                              format: format,
                              selected: format == _format,
                              // An existing contest keeps its format: its
                              // entries were made for it.
                              onTap: _editing && format != _format
                                  ? null
                                  : () => _chooseFormat(format),
                            ),
                        ],
                      ),
                      const SizedBox(height: 22),
                    ],
                    // Where it is going, above the card it will be (node
                    // 3677:40080). An edit is already there.
                    if (!_editing) ...[
                      const _ComposerFieldLabel(
                        'THIS CONTEST WILL BE POSTED ON THE FEED',
                      ),
                      const SizedBox(height: 22),
                    ],
                    _ContestPreviewCard(
                      format: _format,
                      title: _format == ContestFormat.content
                          ? _ContestHeadingField(
                              controller: _task,
                              hint:
                                  'Post a photo of someone looking angry in the office.',
                            )
                          : _ContestTitleField(
                              controller: _title,
                              hint: _format.defaultTitle,
                            ),
                      closesText: _closesText,
                      onTapCloses: _pickCloseTime,
                      media: _format == ContestFormat.caption
                          ? _ContestCarousel(
                              photoPath: _photoPath,
                              existingUrl: _existingMediaUrl,
                              onPick: _pickPhoto,
                            )
                          : null,
                    ),
                  ],
                ),
              ),
              // Go live sits at the foot of the form (node 3417:52366): the
              // form's 20 gap and 12 above it, 8 and the form's 32 below.
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 32, 20, 40),
                child: Semantics(
                  button: true,
                  enabled: ready && !_publishing,
                  child: GestureDetector(
                    onTap: ready && !_publishing
                        ? () => _finish(goLive: true)
                        : null,
                    behavior: HitTestBehavior.opaque,
                    child: Container(
                      // The label's 16.2 and 16 either side, spinner or not.
                      height: 16.2 + 32,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        // Muted until the contest has what it needs
                        // (#96B7C7, Brand/Primary-Pressed).
                        color: ready && !_publishing
                            ? _composerBrand
                            : _composerMuted,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: _publishing
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Text(
                              _editing ? 'Save' : 'Go live',
                              style: const TextStyle(
                                fontFamily: _soraFont,
                                fontSize: 16,
                                height: 16.2 / 16,
                                fontWeight: FontWeight.w600,
                                letterSpacing: -0.16,
                                color: Colors.white,
                              ),
                            ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The form header the composer screens share (node 3417:51831): a round
/// back button, the screen's name, and the pill on the right.
class _ContestHeader extends StatelessWidget {
  const _ContestHeader({
    required this.title,
    required this.onBack,
    required this.actionLabel,
    required this.onAction,
  });

  final String title;
  final VoidCallback onBack;

  /// The pill on the right ("Done"). Null draws none.
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 60,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(
          bottom: BorderSide(color: Color(0xFFF3F4F6), width: 1.114),
        ),
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
                decoration: const BoxDecoration(
                  color: _composerSurface,
                  shape: BoxShape.circle,
                ),
                child: SvgPicture.asset(
                  'assets/icons/chevron_left_small.svg',
                  width: 17.983,
                  height: 17.983,
                ),
              ),
            ),
          ),
          const SizedBox(width: 14),
          Text(
            title,
            style: const TextStyle(
              fontFamily: _soraFont,
              fontSize: 16,
              height: 24 / 16,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.2,
              color: _composerInk,
            ),
          ),
          const Spacer(),
          if (actionLabel case final actionLabel?)
            GestureDetector(
              onTap: onAction,
              behavior: HitTestBehavior.opaque,
              child: Container(
                width: 80,
                padding: const EdgeInsets.symmetric(vertical: 8),
                decoration: BoxDecoration(
                  color: onAction == null ? _composerMuted : _composerBrand,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text(
                  actionLabel,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontFamily: _soraFont,
                    fontSize: 12,
                    height: 16.2 / 12,
                    fontWeight: FontWeight.w400,
                    letterSpacing: -0.16,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A small grey caps label over a part of the form — "SELECT THE CONTEST",
/// "THIS CONTEST WILL BE POSTED ON THE FEED" (node 3677:40082).
class _ComposerFieldLabel extends StatelessWidget {
  const _ComposerFieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontFamily: _soraFont,
        fontSize: 11,
        height: 16.5 / 11,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.9,
        color: _composerTertiary,
      ),
    );
  }
}

/// One format pill (node 3417:53522): lilac and outlined in brand blue when
/// chosen, grey otherwise.
class _ContestPill extends StatelessWidget {
  const _ContestPill({
    required this.format,
    required this.selected,
    required this.onTap,
  });

  final ContestFormat format;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: format.label,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: selected ? const Color(0xFFDDDAFF) : _composerSurface,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: selected ? _composerBrand : const Color(0xFFEBEBEB),
              width: 1.114,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Image.asset(
                format.icon,
                width: 24,
                height: 24,
                fit: BoxFit.cover,
              ),
              const SizedBox(width: 6),
              Text(
                format.label.toUpperCase(),
                style: TextStyle(
                  fontFamily: _soraFont,
                  fontSize: 12,
                  height: 18 / 12,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.3,
                  color: selected ? _composerBrand : _composerSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The contest as it will look in the feed, in the composer (node
/// 3417:53527). Its name is typed straight onto the card.
class _ContestPreviewCard extends StatelessWidget {
  const _ContestPreviewCard({
    required this.format,
    required this.title,
    required this.closesText,
    this.onTapCloses,
    this.media,
    this.bottomPadding = 18,
  });

  final ContestFormat format;
  final Widget title;
  final String closesText;
  final VoidCallback? onTapCloses;
  final Widget? media;
  final double bottomPadding;

  @override
  Widget build(BuildContext context) {
    final closes = Text(
      closesText,
      style: const TextStyle(
        fontFamily: _soraFont,
        fontSize: 11,
        height: 16.5 / 11,
        fontWeight: FontWeight.w400,
        color: _EngagementColors.onCard,
      ),
    );
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: _EngagementColors.card,
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1A6D28D9),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _EngagementHeaderView(
            points: 10,
            avatar: const _SowakaMark(),
            name: const _EngagementHeaderName('Sowaka Engagement'),
            trailing: Padding(
              padding: const EdgeInsets.all(4),
              child: SvgPicture.asset(
                '$_engagementIcons/dots_menu_light.svg',
                width: 19.985,
                height: 19.985,
              ),
            ),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(22, 14, 22, bottomPadding),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                title,
                if (format == ContestFormat.mostLikely)
                  const Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: Text(
                      'Nominate the teammate who fits this tag',
                      style: TextStyle(
                        fontFamily: _soraFont,
                        fontSize: 12,
                        height: 16.2 / 12,
                        fontWeight: FontWeight.w600,
                        letterSpacing: -0.16,
                        color: _EngagementColors.onCard,
                      ),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: onTapCloses == null
                        ? closes
                        : GestureDetector(
                            onTap: onTapCloses,
                            behavior: HitTestBehavior.opaque,
                            child: closes,
                          ),
                  ),
                ),
                ?media,
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The contest's name, typed onto the card in the card's own type.
class _ContestTitleField extends StatelessWidget {
  const _ContestTitleField({required this.controller, required this.hint});

  final TextEditingController controller;
  final String hint;

  @override
  Widget build(BuildContext context) {
    return _CardTextField(
      controller: controller,
      hint: hint,
      maxLength: 80,
      style: const TextStyle(
        fontFamily: _soraFont,
        fontSize: 24,
        height: 28 / 24,
        fontWeight: FontWeight.w700,
        color: Colors.white,
      ),
    );
  }
}

/// A photo contest's task, typed onto the card as its heading.
class _ContestHeadingField extends StatelessWidget {
  const _ContestHeadingField({required this.controller, required this.hint});

  final TextEditingController controller;
  final String hint;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: _CardTextField(
        controller: controller,
        hint: hint,
        maxLength: 400,
        maxLines: 4,
        style: const TextStyle(
          fontFamily: _soraFont,
          fontSize: 20,
          height: 1.26,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.16,
          color: _EngagementColors.onCard,
        ),
      ),
    );
  }
}

class _CardTextField extends StatelessWidget {
  const _CardTextField({
    required this.controller,
    required this.hint,
    required this.style,
    required this.maxLength,
    this.maxLines = 2,
  });

  final TextEditingController controller;
  final String hint;
  final TextStyle style;
  final int maxLength;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      minLines: 1,
      maxLines: maxLines,
      maxLength: maxLength,
      cursorColor: Colors.white,
      textCapitalization: TextCapitalization.sentences,
      style: style,
      // The card is the field: the app's InputDecorationTheme would fill and
      // outline it otherwise.
      decoration: InputDecoration(
        isDense: true,
        counterText: '',
        filled: false,
        border: InputBorder.none,
        enabledBorder: InputBorder.none,
        focusedBorder: InputBorder.none,
        contentPadding: EdgeInsets.zero,
        hintText: hint,
        hintStyle: style.copyWith(color: style.color?.withValues(alpha: 0.6)),
      ),
    );
  }
}

/// The picture row under a caption contest's name (node 3417:53559): the
/// picture in the middle in the chosen slide's thick ring — or "Upload
/// Image" until there is one. Once a picture is in, the upload tile peeks in from the
/// card's right edge as the carousel's next slide, to change it.
class _ContestCarousel extends StatelessWidget {
  const _ContestCarousel({
    required this.photoPath,
    required this.existingUrl,
    required this.onPick,
  });

  final String? photoPath;
  final String? existingUrl;
  final VoidCallback onPick;

  /// The picked picture's width with its frame: 210 and 6 either side.
  static const double _framed = 210 + 12;
  static const Color _pickedRing = Color(0xFFCEFCFA);

  @override
  Widget build(BuildContext context) {
    final hasPicture = photoPath != null || existingUrl != null;
    return SizedBox(
      height: 196,
      child: LayoutBuilder(
        builder: (context, constraints) {
          // What shows of the next slide: from the picture's frame out to the
          // card's edge, which lies past the 22 of padding around this row.
          final peek = (constraints.maxWidth - _framed) / 2 + 22;
          return Stack(
            clipBehavior: Clip.none,
            alignment: Alignment.topCenter,
            children: [
              if (hasPicture)
                Positioned(
                  top: 16 + (176 - 135) / 2,
                  left:
                      (constraints.maxWidth + _framed) / 2 -
                      _UploadPeekTile.tucked,
                  child: Semantics(
                    button: true,
                    label: 'Change picture',
                    child: GestureDetector(
                      onTap: onPick,
                      child: _UploadPeekTile(visibleWidth: peek),
                    ),
                  ),
                ),
              Positioned(
                // The picture's 6 of frame lies outside its 210x159, so the
                // framed picture starts 6 higher than the upload tile.
                top: hasPicture ? 16 + 8.5 - 6 : 16 + 8.5,
                child: GestureDetector(
                  onTap: onPick,
                  child: hasPicture
                      ? Container(
                          width: _framed,
                          height: 159 + 12,
                          decoration: BoxDecoration(
                            color: _pickedRing,
                            borderRadius: BorderRadius.circular(18),
                            // The chosen slide's pale cyan ring (node
                            // 3417:53076).
                            border: Border.all(color: _pickedRing, width: 6),
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: photoPath != null
                                ? Image.file(
                                    File(photoPath!),
                                    fit: BoxFit.cover,
                                  )
                                : Image(
                                    image: _remoteImage(existingUrl!),
                                    fit: BoxFit.cover,
                                  ),
                          ),
                        )
                      : const _UploadImageTile(
                          width: 210,
                          height: 159,
                          border: 6,
                        ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// The upload tile as the carousel's next slide: its leading edge tucked
/// under the picture's frame, the rest run off the card's edge, and only the
/// tray icon in the strip that shows. Its words would be cut in half there.
class _UploadPeekTile extends StatelessWidget {
  const _UploadPeekTile({required this.visibleWidth});

  /// How far the tile runs under the picture's frame.
  static const double tucked = 20;

  /// The strip between the picture's frame and the card's edge.
  final double visibleWidth;

  @override
  Widget build(BuildContext context) {
    return Container(
      // Past the card's edge, which clips it.
      width: tucked + visibleWidth + 24,
      height: 135,
      padding: const EdgeInsets.only(left: tucked - 4),
      alignment: Alignment.centerLeft,
      decoration: BoxDecoration(
        color: const Color(0xFFEAEEEF),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white, width: 4),
      ),
      child: SizedBox(
        width: visibleWidth,
        child: const Center(
          child: SizedBox(
            width: 38,
            height: 40,
            child: FittedBox(child: _UploadTrayIcon()),
          ),
        ),
      ),
    );
  }
}

/// The upload tray from the exported art, cropped the way the design crops
/// it (node 3452:60175), at its 56x59.
class _UploadTrayIcon extends StatelessWidget {
  const _UploadTrayIcon();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 56,
      height: 59,
      child: ClipRect(
        child: OverflowBox(
          alignment: Alignment.topLeft,
          maxWidth: 136,
          maxHeight: 100.5,
          child: Transform.translate(
            offset: const Offset(-40, 0),
            child: Image.asset(
              '$_engagementIcons/upload_image.png',
              width: 136,
              height: 100.5,
              fit: BoxFit.fill,
            ),
          ),
        ),
      ),
    );
  }
}

/// "Upload Image — Upload the image of your choice from the library."
/// (node 3452:60175). The tray icon is the exported art, cropped the way the
/// design crops it.
class _UploadImageTile extends StatelessWidget {
  const _UploadImageTile({
    required this.width,
    required this.height,
    required this.border,
  });

  final double width;
  final double height;
  final double border;

  @override
  Widget build(BuildContext context) {
    // Drawn at the design's 210x159 and scaled to whichever slot it sits in.
    return SizedBox(
      width: width,
      height: height,
      child: FittedBox(
        child: Container(
          width: 210,
          height: 159,
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: const Color(0xFFEAEEEF),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.white, width: 6),
          ),
          child: Stack(
            children: [
              const Positioned(
                left: 71 - 6,
                top: 15 - 6,
                width: 56,
                height: 59,
                child: _UploadTrayIcon(),
              ),
              const Positioned(
                left: 0,
                right: 0,
                top: 96 - 6,
                child: Text(
                  'Upload Image',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: _soraFont,
                    fontSize: 12,
                    height: 13.333 / 12,
                    fontWeight: FontWeight.w600,
                    color: _composerSecondary,
                  ),
                ),
              ),
              // Centred on the tile, as the design sets it (x 17, 175 wide).
              const Positioned(
                left: 17 - 6,
                width: 175,
                top: 113 - 6,
                child: Text(
                  'Upload the image of your choice from the library.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: _soraFont,
                    fontSize: 10,
                    height: 13.333 / 10,
                    fontWeight: FontWeight.w300,
                    color: Colors.black,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "Select time — 1 day / 2 day" (node 3464:62883).
class _CloseTimeSheet extends StatelessWidget {
  const _CloseTimeSheet({required this.selectedDays});

  final int? selectedDays;

  @override
  Widget build(BuildContext context) {
    Widget option(int days) {
      final selected = (selectedDays ?? 1) == days;
      return GestureDetector(
        onTap: () => Navigator.of(context).pop(days),
        behavior: HitTestBehavior.opaque,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
          decoration: BoxDecoration(
            color: selected ? _composerBrand : null,
            borderRadius: BorderRadius.circular(10),
            border: selected ? null : Border.all(color: _composerBrand),
          ),
          child: Text(
            '$days day',
            style: TextStyle(
              fontFamily: _soraFont,
              fontSize: 16,
              height: 22 / 16,
              fontWeight: FontWeight.w400,
              letterSpacing: 0.4,
              color: selected ? Colors.white : _composerBrand,
            ),
          ),
        ),
      );
    }

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        boxShadow: [
          BoxShadow(
            color: Color(0x1F000000),
            blurRadius: 16,
            offset: Offset(0, -4),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        // The sheet is drawn 137 tall (node 3464:62883), a little more than
        // its contents and their 24 below.
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 137),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
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
                          borderRadius: BorderRadius.all(Radius.circular(999)),
                        ),
                      ),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Select time',
                        style: TextStyle(
                          fontFamily: _soraFont,
                          fontSize: 16,
                          height: 22 / 16,
                          fontWeight: FontWeight.w400,
                          letterSpacing: 0.4,
                          color: _composerInk,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          option(1),
                          const SizedBox(width: 26),
                          option(2),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A contest waiting in the composer ("New Post-Media", node 3515:68792):
/// "Edit" to reopen the contest screen, a cross to drop it, and the card as
/// it will appear.
class _ContestDraftPreview extends StatelessWidget {
  const _ContestDraftPreview({
    required this.draft,
    required this.onEdit,
    required this.onRemove,
  });

  final ContestDraft draft;
  final VoidCallback onEdit;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final when = DateTime.tryParse(draft.closesAt);
    final title = draft.format == ContestFormat.content
        ? Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              draft.task,
              style: const TextStyle(
                fontFamily: _soraFont,
                fontSize: 20,
                height: 1.26,
                fontWeight: FontWeight.w600,
                letterSpacing: -0.16,
                color: _EngagementColors.onCard,
              ),
            ),
          )
        // On the preview's violet header, white as the composer draws it.
        : _EngagementTitle(draft.title, color: Colors.white);
    final hasPicture =
        draft.photoPath != null || draft.existingMediaUrl != null;
    return Padding(
      padding: const EdgeInsets.only(top: 21),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                GestureDetector(
                  onTap: onEdit,
                  behavior: HitTestBehavior.opaque,
                  child: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 4),
                    child: Text(
                      'Edit',
                      style: TextStyle(
                        fontFamily: _soraFont,
                        fontSize: 14,
                        height: 21 / 14,
                        fontWeight: FontWeight.w600,
                        color: _composerBrand,
                      ),
                    ),
                  ),
                ),
                const Spacer(),
                Semantics(
                  button: true,
                  label: 'Remove contest',
                  child: GestureDetector(
                    onTap: onRemove,
                    behavior: HitTestBehavior.opaque,
                    child: SvgPicture.asset(
                      'assets/icons/composer_close.svg',
                      width: 15.999,
                      height: 15.999,
                    ),
                  ),
                ),
              ],
            ),
          ),
          _ContestPreviewCard(
            format: draft.format,
            title: title,
            closesText: when == null ? '' : 'Closes ${_weekdayTime(when)}',
            bottomPadding: 28,
            media: draft.format == ContestFormat.caption && hasPicture
                ? Padding(
                    padding: const EdgeInsets.only(top: 16, bottom: 4),
                    child: Center(
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: SizedBox(
                          width: 308,
                          height: 221.163,
                          child: Stack(
                            clipBehavior: Clip.none,
                            children: [
                              const Positioned(
                                left: 10.73 - 49.72,
                                top: -23.57,
                                child: _BurstAt(),
                              ),
                              Positioned(
                                left: 10.73,
                                top: 0,
                                child: _TiltedLocalPhoto(
                                  path: draft.photoPath,
                                  url: draft.existingMediaUrl,
                                ),
                              ),
                              // The gold medal sticker at the picture's
                              // corner (node 3515:68933).
                              Positioned(
                                left: 10.73 + 246,
                                top: -0.35,
                                child: _Sticker(
                                  boxWidth: 73.659,
                                  boxHeight: 73.659,
                                  degrees: 16.48,
                                  child: _gifSticker(
                                    '$_engagementIcons/medal_sticker.gif',
                                    59.276,
                                    59.276,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  )
                : null,
          ),
        ],
      ),
    );
  }
}

/// [_TiltedPhoto] for a picture that may still be on this phone.
class _TiltedLocalPhoto extends StatelessWidget {
  const _TiltedLocalPhoto({this.path, this.url});

  final String? path;
  final String? url;

  @override
  Widget build(BuildContext context) {
    if (path == null) return _TiltedPhoto(url: url ?? '');
    return _TiltedFrame(child: Image.file(File(path!), fit: BoxFit.cover));
  }
}
