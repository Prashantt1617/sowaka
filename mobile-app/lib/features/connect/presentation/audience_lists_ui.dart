// Who a post is for (Figma section 3809:77133): the "Who can see this post"
// sheet, and the person's own lists in it, Snapchat-style shortcuts of people,
// made and changed in a picker of the whole company and a review sheet.
//
// The screens only: the composer hands in how to load people and lists and how
// to save them, so this file knows nothing of the API.
import 'dart:async';
import 'dart:ui' show ImageFilter;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../services/api_config.dart';
import '../../shared/app_toast.dart';

/// Someone who can be put on a list.
class AudiencePerson {
  const AudiencePerson({
    required this.id,
    required this.name,
    this.initials = '',
    this.designation = '',
    this.department = '',
    this.city = '',
    this.photoUrl,
    this.avatarColor = '#BE5A36',
  });

  final String id;
  final String name;
  final String initials;
  final String designation;
  final String department;
  final String city;
  final String? photoUrl;
  final String avatarColor;

  /// "3D Artist · 3D · Gurugram", leaving out what is not known.
  String get subtitle => [
    designation,
    department,
    city,
  ].map((part) => part.trim()).where((part) => part.isNotEmpty).join(' · ');
}

/// One of the person's saved lists.
class AudienceListSummary {
  const AudienceListSummary({
    required this.id,
    required this.name,
    required this.memberIds,
  });

  final String id;
  final String name;
  final List<String> memberIds;
}

/// What the sheet picked: everyone, the person's team, or one of their lists.
sealed class AudienceChoice {
  const AudienceChoice();
}

class PublicAudience extends AudienceChoice {
  const PublicAudience();
}

class TeamAudience extends AudienceChoice {
  const TeamAudience();
}

class ListAudience extends AudienceChoice {
  const ListAudience(this.list);
  final AudienceListSummary list;
}

/// A list as the picker and review sheet leave it, before it is saved.
class AudienceListDraft {
  const AudienceListDraft({required this.name, required this.memberIds});
  final String name;
  final List<String> memberIds;
}

// ------------------------------------------------------------------- styles

abstract final class _A {
  static const font = 'Sora';
  static const ink = Color(0xFF222222);
  static const soft = Color(0xFF484848);
  static const muted = Color(0xFF767676);
  static const hint = Color(0xFF9197A2);
  static const line = Color(0xFFEBEBEB);
  static const page = Color(0xFFF7F7F9);
  static const brand = Color(0xFF0571A6);
  static const teal = Color(0xFF208AA7);
  static const tealText = Color(0xFF12738F);
  static const selectedRow = Color(0xFFF5FAFC);
  static const chip = Color(0xFFE9F6FA);
  static const box = Color(0xFFA8A8A8);
  static const handle = Color(0xFFD1D5DB);
  static const icons = 'assets/icons';

  static TextStyle text(
    double size, {
    FontWeight weight = FontWeight.w400,
    Color color = ink,
    double? height,
    double spacing = 0,
  }) => TextStyle(
    fontFamily: font,
    fontSize: size,
    fontWeight: weight,
    color: color,
    height: height == null ? null : height / size,
    letterSpacing: spacing,
  );
}

const _hairline = BorderSide(color: _A.line, width: 1.115);

Color _hex(String value, Color fallback) {
  final hex = value.replaceFirst('#', '');
  if (hex.length != 6) return fallback;
  final parsed = int.tryParse(hex, radix: 16);
  return parsed == null ? fallback : Color(0xFF000000 | parsed);
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.person, this.size = 35.983, this.ring = false});

  final AudiencePerson person;
  final double size;
  final bool ring;

  @override
  Widget build(BuildContext context) {
    final url = person.photoUrl;
    final initials = person.initials.isNotEmpty
        ? person.initials
        : person.name
              .trim()
              .split(RegExp(r'\s+'))
              .take(2)
              .map((p) => p.isEmpty ? '' : p[0].toUpperCase())
              .join();
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: _hex(person.avatarColor, const Color(0xFFBE5A36)),
        border: ring ? Border.all(color: Colors.white, width: 1.115) : null,
      ),
      clipBehavior: Clip.antiAlias,
      alignment: Alignment.center,
      child: url != null && url.isNotEmpty
          ? CachedNetworkImage(
              // The server sends "/media/…": made whole as the feed's faces are.
              imageUrl: resolveMediaUrl(url),
              width: size,
              height: size,
              fit: BoxFit.cover,
              errorWidget: (_, _, _) => _initialsText(initials),
            )
          : _initialsText(initials),
    );
  }

  Widget _initialsText(String initials) => Text(
    initials,
    style: _A.text(size * 0.36, weight: FontWeight.w600, color: Colors.white),
  );
}

class _Checkbox extends StatelessWidget {
  const _Checkbox({required this.checked});

  final bool checked;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 120),
      width: 17.983,
      height: 17.983,
      decoration: BoxDecoration(
        color: checked ? _A.brand : Colors.white,
        borderRadius: BorderRadius.circular(2),
        border: Border.all(color: checked ? _A.brand : _A.box, width: 1.115),
      ),
      alignment: Alignment.center,
      child: checked
          ? SvgPicture.asset(
              '${_A.icons}/audience_tick.svg',
              width: 12.999,
              height: 12.999,
              colorFilter: const ColorFilter.mode(
                Colors.white,
                BlendMode.srcIn,
              ),
            )
          : null,
    );
  }
}

/// The grab handle at the top of both sheets.
class _Handle extends StatelessWidget {
  const _Handle();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 12, bottom: 4),
    child: Center(
      child: Container(
        width: 40,
        height: 4,
        decoration: BoxDecoration(
          color: _A.handle,
          borderRadius: BorderRadius.circular(999),
        ),
      ),
    ),
  );
}

// ------------------------------------------------------------ audience sheet

/// The "Who can see this post" sheet (node 3809:76109). Returns the choice, or
/// null when it is dismissed without one. Lists are made, changed and removed
/// from here through the callbacks, which save them; after a new list is made
/// the sheet closes on it.
Future<AudienceChoice?> showAudienceSheet(
  BuildContext context, {
  required AudienceChoice current,
  required bool showTeam,
  required Future<List<AudienceListSummary>> Function() loadLists,
  required Future<List<AudiencePerson>> Function() loadPeople,
  required Future<AudienceListSummary> Function(AudienceListDraft draft)
  createList,
  required Future<AudienceListSummary> Function(
    String id,
    AudienceListDraft draft,
  )
  updateList,
  required Future<void> Function(String id) deleteList,
}) async {
  final outcome = _SheetOutcome(current);
  final picked = await showModalBottomSheet<AudienceChoice>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    barrierColor: const Color(0x73000000),
    builder: (_) => _AudienceSheet(
      outcome: outcome,
      showTeam: showTeam,
      loadLists: loadLists,
      loadPeople: loadPeople,
      createList: createList,
      updateList: updateList,
      deleteList: deleteList,
    ),
  );
  // Dismissed after removing or renaming the list in use: the post follows.
  return picked ?? outcome.changedCurrent;
}

/// What the sheet did to the choice in use while it was open.
class _SheetOutcome {
  _SheetOutcome(this.current);
  AudienceChoice current;
  AudienceChoice? changedCurrent;
}

class _AudienceSheet extends StatefulWidget {
  const _AudienceSheet({
    required this.outcome,
    required this.showTeam,
    required this.loadLists,
    required this.loadPeople,
    required this.createList,
    required this.updateList,
    required this.deleteList,
  });

  final _SheetOutcome outcome;
  final bool showTeam;
  final Future<List<AudienceListSummary>> Function() loadLists;
  final Future<List<AudiencePerson>> Function() loadPeople;
  final Future<AudienceListSummary> Function(AudienceListDraft draft)
  createList;
  final Future<AudienceListSummary> Function(String id, AudienceListDraft draft)
  updateList;
  final Future<void> Function(String id) deleteList;

  @override
  State<_AudienceSheet> createState() => _AudienceSheetState();
}

class _AudienceSheetState extends State<_AudienceSheet> {
  List<AudienceListSummary>? _lists;
  bool _failed = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    unawaited(_reload());
  }

  Future<void> _reload() async {
    try {
      final lists = await widget.loadLists();
      if (!mounted) return;
      setState(() {
        _lists = [
          ...lists,
        ]..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
        _failed = false;
      });
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  bool _isCurrent(AudienceChoice choice) {
    final current = widget.outcome.current;
    return switch ((current, choice)) {
      (PublicAudience(), PublicAudience()) => true,
      (TeamAudience(), TeamAudience()) => true,
      (ListAudience(list: final a), ListAudience(list: final b)) =>
        a.id == b.id,
      _ => false,
    };
  }

  Future<void> _create() async {
    AudienceListSummary? saved;
    // Saved from inside the picker, so a failed save keeps the selection.
    final draft = await _openPicker(
      context,
      loadPeople: widget.loadPeople,
      save: (draft) async => saved = await widget.createList(draft),
    );
    if (draft == null || saved == null || !mounted) return;
    Navigator.of(context).pop(ListAudience(saved!));
  }

  Future<void> _edit(AudienceListSummary list) async {
    AudienceListSummary? saved;
    final draft = await _openPicker(
      context,
      loadPeople: widget.loadPeople,
      save: (draft) async => saved = await widget.updateList(list.id, draft),
      initialName: list.name,
      initialSelected: list.memberIds,
    );
    if (draft == null || saved == null || !mounted) return;
    if (_isCurrent(ListAudience(list))) {
      widget.outcome
        ..current = ListAudience(saved!)
        ..changedCurrent = ListAudience(saved!);
    }
    setState(() => _busy = true);
    await _reload();
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _delete(AudienceListSummary list) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(
          'Delete “${list.name}”?',
          style: _A.text(16, weight: FontWeight.w600),
        ),
        content: Text(
          'Posts already shared with it stay visible to the people they went to.',
          style: _A.text(13, color: _A.soft, height: 19.5),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(
              'Cancel',
              style: _A.text(13, weight: FontWeight.w600, color: _A.muted),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(
              'Delete',
              style: _A.text(
                13,
                weight: FontWeight.w600,
                color: const Color(0xFFD92D20),
              ),
            ),
          ),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await widget.deleteList(list.id);
      if (_isCurrent(ListAudience(list))) {
        widget.outcome
          ..current = const PublicAudience()
          ..changedCurrent = const PublicAudience();
        // The post was going to it: it goes to everyone now, and that is said.
        if (mounted) showAppToast(context, 'Audience set to Public');
      }
      await _reload();
    } catch (error) {
      if (mounted) {
        showAppToast(
          context,
          _message(error, "That list couldn't be deleted. Try again."),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _listMenu(AudienceListSummary list, Offset at) async {
    final picked = await showMenu<String>(
      context: context,
      position: RelativeRect.fromLTRB(at.dx - 140, at.dy, at.dx, at.dy),
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      items: [
        PopupMenuItem(
          value: 'edit',
          child: Text('Edit list', style: _A.text(13)),
        ),
        PopupMenuItem(
          value: 'delete',
          child: Text(
            'Delete list',
            style: _A.text(13, color: const Color(0xFFD92D20)),
          ),
        ),
      ],
    );
    if (picked == 'edit') unawaited(_edit(list));
    if (picked == 'delete') unawaited(_delete(list));
  }

  @override
  Widget build(BuildContext context) {
    final lists = _lists;
    return Container(
      constraints: const BoxConstraints(maxHeight: 698.917, maxWidth: 420),
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
        child: Stack(
          children: [
            SingleChildScrollView(
              padding: const EdgeInsets.only(bottom: 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _Handle(),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      spacing: 8,
                      children: [
                        const _SheetLabel('Who can see this post'),
                        _AudienceRow(
                          key: const ValueKey('audience-public'),
                          icon: 'audience_public.svg',
                          title: 'Public',
                          subtitle: 'Everyone in the company',
                          selected: _isCurrent(const PublicAudience()),
                          onTap: () =>
                              Navigator.of(context).pop(const PublicAudience()),
                        ),
                        if (widget.showTeam)
                          _AudienceRow(
                            key: const ValueKey('audience-team'),
                            icon: 'audience_team.svg',
                            title: 'Team',
                            subtitle: 'Your direct reports',
                            selected: _isCurrent(const TeamAudience()),
                            onTap: () =>
                                Navigator.of(context).pop(const TeamAudience()),
                          ),
                        const _SheetLabel('Your lists'),
                        if (lists == null && !_failed)
                          const Padding(
                            padding: EdgeInsets.symmetric(vertical: 14),
                            child: Center(
                              child: SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: _A.brand,
                                ),
                              ),
                            ),
                          )
                        else if (_failed && lists == null)
                          Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 20,
                              vertical: 8,
                            ),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    "Your lists couldn't load.",
                                    style: _A.text(11, color: _A.muted),
                                  ),
                                ),
                                TextButton(
                                  onPressed: _reload,
                                  child: Text(
                                    'Retry',
                                    style: _A.text(
                                      11,
                                      weight: FontWeight.w600,
                                      color: _A.brand,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          )
                        else
                          for (final list in lists!)
                            _AudienceRow(
                              key: ValueKey('audience-list-${list.id}'),
                              icon: 'audience_list.svg',
                              title: list.name,
                              subtitle:
                                  '${list.memberIds.length} ${list.memberIds.length == 1 ? 'person' : 'people'}',
                              selected: _isCurrent(ListAudience(list)),
                              onTap: () =>
                                  Navigator.of(context).pop(ListAudience(list)),
                              onLongPressAt: (at) => _listMenu(list, at),
                              trailingMenu: (at) => _listMenu(list, at),
                            ),
                        _AudienceRow(
                          key: const ValueKey('audience-create'),
                          icon: 'audience_plus.svg',
                          title: 'Create custom list',
                          subtitle: 'Pick people by team, city, role or name',
                          create: true,
                          onTap: _create,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            if (_busy)
              const Positioned.fill(
                child: ColoredBox(
                  color: Color(0x66FFFFFF),
                  child: Center(
                    child: CircularProgressIndicator(
                      color: _A.brand,
                      strokeWidth: 2.5,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _SheetLabel extends StatelessWidget {
  const _SheetLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
    child: Text(
      text.toUpperCase(),
      style: _A.text(10, color: _A.muted, height: 15, spacing: 0.3),
    ),
  );
}

class _AudienceRow extends StatelessWidget {
  const _AudienceRow({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.selected = false,
    this.create = false,
    this.onLongPressAt,
    this.trailingMenu,
  });

  final String icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool selected;
  final bool create;
  final ValueChanged<Offset>? onLongPressAt;
  final ValueChanged<Offset>? trailingMenu;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPressAt == null
            ? null
            : () {
                final box = context.findRenderObject() as RenderBox?;
                final at = box == null
                    ? Offset.zero
                    : box.localToGlobal(
                        Offset(box.size.width, box.size.height / 2),
                      );
                onLongPressAt!(at);
              },
        child: Container(
          constraints: const BoxConstraints(minHeight: 58),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
          decoration: const BoxDecoration(border: Border(bottom: _hairline)),
          child: Row(
            spacing: 12,
            children: [
              Container(
                width: 31.993,
                height: 31.993,
                decoration: BoxDecoration(
                  color: create ? Colors.white : _A.page,
                  shape: BoxShape.circle,
                  border: create
                      ? Border.all(color: _A.brand, width: 1.115)
                      : null,
                ),
                alignment: Alignment.center,
                child: SvgPicture.asset(
                  '${_A.icons}/$icon',
                  width: 15.997,
                  height: 15.997,
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 2,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: _A.text(
                        13,
                        weight: FontWeight.w600,
                        color: create ? _A.brand : _A.ink,
                        height: 19.5,
                      ),
                    ),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: _A.text(9, color: _A.muted, height: 12.6),
                    ),
                  ],
                ),
              ),
              if (selected)
                SvgPicture.asset(
                  '${_A.icons}/audience_selected.svg',
                  width: 16,
                  height: 16,
                ),
              if (trailingMenu != null)
                Builder(
                  builder: (buttonContext) => InkResponse(
                    key: ValueKey(
                      '${key is ValueKey ? (key as ValueKey).value : ''}-menu',
                    ),
                    radius: 18,
                    onTap: () {
                      final box =
                          buttonContext.findRenderObject() as RenderBox?;
                      final at = box == null
                          ? Offset.zero
                          : box.localToGlobal(
                              Offset(box.size.width, box.size.height),
                            );
                      trailingMenu!(at);
                    },
                    child: Padding(
                      padding: const EdgeInsets.all(4),
                      child: SvgPicture.asset(
                        '${_A.icons}/audience_more.svg',
                        width: 16,
                        height: 16,
                      ),
                    ),
                  ),
                ),
              if (create)
                RotatedBox(
                  quarterTurns: 3,
                  child: SvgPicture.asset(
                    '${_A.icons}/audience_chevron.svg',
                    width: 16.99,
                    height: 16.99,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

String _message(Object error, String fallback) {
  final text = error
      .toString()
      .replaceFirst(RegExp(r'^(Exception|[A-Za-z]+Exception): ?'), '')
      .trim();
  return text.isEmpty || text.length > 140 ? fallback : text;
}

// -------------------------------------------------------------------- picker

/// The most people a list can hold — the server's own limit.
const int maxAudienceListMembers = 500;

/// Opens the picker; [save] puts the list up from inside it, so a save that
/// fails leaves the picker open with everything still ticked. Hands back the
/// draft once saved (or, with no [save], once reviewed).
Future<AudienceListDraft?> _openPicker(
  BuildContext context, {
  required Future<List<AudiencePerson>> Function() loadPeople,
  Future<void> Function(AudienceListDraft draft)? save,
  String initialName = '',
  List<String> initialSelected = const [],
}) {
  return Navigator.of(context).push<AudienceListDraft>(
    MaterialPageRoute(
      builder: (_) => AudienceListPicker(
        loadPeople: loadPeople,
        save: save,
        initialName: initialName,
        initialSelected: initialSelected,
        editing: initialSelected.isNotEmpty || initialName.isNotEmpty,
      ),
    ),
  );
}

/// The whole company, A to Z, to pick a list from (node 3809:76434). Search
/// takes several names at once, comma separated: everyone each one matches
/// shows, and a name that matches exactly one person ticks them.
class AudienceListPicker extends StatefulWidget {
  const AudienceListPicker({
    super.key,
    required this.loadPeople,
    this.save,
    this.initialName = '',
    this.initialSelected = const [],
    this.editing = false,
  });

  final Future<List<AudiencePerson>> Function() loadPeople;

  /// Saves the list from the review sheet. Failing, it throws, and the
  /// picker stays open with the selection as it was.
  final Future<void> Function(AudienceListDraft draft)? save;
  final String initialName;
  final List<String> initialSelected;
  final bool editing;

  @override
  State<AudienceListPicker> createState() => _AudienceListPickerState();
}

class _AudienceListPickerState extends State<AudienceListPicker> {
  final _search = TextEditingController();
  late final _name = TextEditingController(text: widget.initialName);
  List<AudiencePerson>? _people;
  bool _failed = false;

  /// Ticked, in the order they were ticked.
  late final List<String> _selected = [...widget.initialSelected];

  /// Search terms that have ticked their one match, and who: a term typed
  /// away again unticks them, unless they were ticked by hand since.
  final Map<String, String> _autoPicked = {};

  /// Ticked by hand, so a search term going away leaves them ticked.
  final Set<String> _handPicked = {};
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _search.addListener(_searchChanged);
    unawaited(_load());
  }

  @override
  void dispose() {
    _search.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final people = await widget.loadPeople();
      if (!mounted) return;
      setState(() {
        _people = [
          ...people,
        ]..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
        _failed = false;
      });
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  List<String> get _terms => _search.text
      .split(',')
      .map((term) => term.trim().toLowerCase())
      .where((term) => term.isNotEmpty)
      .toList();

  /// The terms followed by a comma: finished, rather than still being typed.
  List<String> get _completedTerms {
    final parts = _search.text.split(',');
    return parts
        .take(parts.length - 1)
        .map((term) => term.trim().toLowerCase())
        .where((term) => term.isNotEmpty)
        .toList();
  }

  /// A term that names a whole team or city is a filter, not a person.
  bool _isFilter(String term, List<AudiencePerson> people) => people.any(
    (person) =>
        person.department.toLowerCase() == term ||
        person.city.toLowerCase() == term,
  );

  bool _matches(AudiencePerson person, String term) =>
      person.name.toLowerCase().contains(term) ||
      person.designation.toLowerCase().contains(term) ||
      person.department.toLowerCase().contains(term) ||
      person.city.toLowerCase().contains(term);

  /// What the search shows: everyone with no search; otherwise everyone any
  /// term matches, still A to Z.
  List<AudiencePerson> get _shown {
    final people = _people ?? const <AudiencePerson>[];
    final terms = _terms;
    if (terms.isEmpty) return people;
    return people
        .where((person) => terms.any((term) => _matches(person, term)))
        .toList();
  }

  void _searchChanged() {
    final people = _people;
    if (people != null) {
      final completed = _completedTerms;
      // A term typed away again lets its pick go, unless ticked by hand.
      for (final term in [..._autoPicked.keys]) {
        if (completed.contains(term)) continue;
        final id = _autoPicked.remove(term)!;
        if (!_handPicked.contains(id)) _selected.remove(id);
      }
      for (final term in completed) {
        if (_autoPicked.containsKey(term) || _isFilter(term, people)) continue;
        final byName = people
            .where((person) => person.name.toLowerCase().contains(term))
            .toList();
        if (byName.length == 1 && _selected.length < maxAudienceListMembers) {
          final id = byName.single.id;
          _autoPicked[term] = id;
          if (!_selected.contains(id)) _selected.add(id);
        }
      }
    }
    setState(() {});
  }

  bool _room(int adding) {
    if (_selected.length + adding <= maxAudienceListMembers) return true;
    showAppToast(
      context,
      'A list can have up to $maxAudienceListMembers people.',
    );
    return false;
  }

  /// "Team 3D", "City Gurugram": a term that names a whole team or city.
  List<String> get _filterChips {
    final people = _people ?? const <AudiencePerson>[];
    final chips = <String>[];
    for (final term in _terms) {
      final team = people
          .map((p) => p.department)
          .firstWhere((d) => d.toLowerCase() == term, orElse: () => '');
      if (team.isNotEmpty && !chips.contains('Team $team')) {
        chips.add('Team $team');
      }
      final city = people
          .map((p) => p.city)
          .firstWhere((c) => c.toLowerCase() == term, orElse: () => '');
      if (city.isNotEmpty && !chips.contains('City $city')) {
        chips.add('City $city');
      }
    }
    return chips;
  }

  void _toggle(AudiencePerson person) {
    if (_selected.remove(person.id)) {
      _handPicked.remove(person.id);
    } else {
      if (!_room(1)) return;
      _selected.add(person.id);
      _handPicked.add(person.id);
    }
    setState(() {});
  }

  void _toggleAll(List<AudiencePerson> shown) {
    final all =
        shown.isNotEmpty &&
        shown.every((person) => _selected.contains(person.id));
    if (all) {
      _selected.removeWhere((id) => shown.any((person) => person.id == id));
      _handPicked.removeWhere((id) => shown.any((person) => person.id == id));
    } else {
      final missing = shown.where((p) => !_selected.contains(p.id)).toList();
      if (!_room(missing.length)) return;
      for (final person in missing) {
        _selected.add(person.id);
        _handPicked.add(person.id);
      }
    }
    setState(() {});
  }

  List<AudiencePerson> get _selectedPeople {
    final byId = {
      for (final person in _people ?? const <AudiencePerson>[])
        person.id: person,
    };
    return [for (final id in _selected) ?byId[id]];
  }

  Future<void> _review() async {
    FocusScope.of(context).unfocus();
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: const Color(0x73000000),
      builder: (_) => _ReviewSheet(
        name: _name,
        members: _selectedPeople,
        editing: widget.editing,
        onRemove: (person) => setState(() => _selected.remove(person.id)),
      ),
    );
    if (done != true || !mounted) return;
    final draft = AudienceListDraft(
      name: _name.text.trim(),
      memberIds: _selectedPeople.map((p) => p.id).toList(),
    );
    final save = widget.save;
    if (save != null) {
      setState(() => _saving = true);
      try {
        await save(draft);
      } catch (error) {
        // The picker stays, everything still ticked, for another go.
        if (!mounted) return;
        setState(() => _saving = false);
        showAppToast(
          context,
          _message(error, "That list couldn't be saved. Try again."),
        );
        return;
      }
    }
    if (mounted) Navigator.of(context).pop(draft);
  }

  @override
  Widget build(BuildContext context) {
    final shown = _shown;
    final chips = _filterChips;
    final allShownTicked =
        shown.isNotEmpty &&
        shown.every((person) => _selected.contains(person.id));
    final selectedPeople = _selectedPeople;
    return Scaffold(
      backgroundColor: _A.page,
      body: Column(
        children: [
          Container(
            color: Colors.white,
            child: SafeArea(
              bottom: false,
              child: Container(
                height: 63.986,
                decoration: const BoxDecoration(
                  border: Border(bottom: _hairline),
                ),
                child: Row(
                  children: [
                    SizedBox(
                      width: 43.999,
                      height: 43.999,
                      child: IconButton(
                        key: const ValueKey('audience-picker-back'),
                        padding: EdgeInsets.zero,
                        onPressed: () => Navigator.of(context).maybePop(),
                        icon: SvgPicture.asset(
                          '${_A.icons}/audience_back.svg',
                          width: 17.983,
                          height: 17.983,
                        ),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        widget.editing ? 'Edit list' : 'New custom list',
                        textAlign: TextAlign.center,
                        style: _A.text(14, weight: FontWeight.w600, height: 21),
                      ),
                    ),
                    const SizedBox(width: 43.999),
                  ],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _SearchField(controller: _search),
                if (chips.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Wrap(
                      spacing: 7,
                      runSpacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          'Filtering by',
                          style: _A.text(9, color: _A.muted, height: 13.5),
                        ),
                        for (final chip in chips)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 7,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: _A.chip,
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              chip,
                              style: _A.text(9, color: _A.brand, height: 13.5),
                            ),
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          Container(
            height: 46,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: const BoxDecoration(border: Border(bottom: _hairline)),
            child: Row(
              children: [
                Expanded(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: GestureDetector(
                      key: const ValueKey('audience-select-all'),
                      behavior: HitTestBehavior.opaque,
                      onTap: () => _toggleAll(shown),
                      child: Text(
                        'Select all',
                        style: _A.text(
                          11,
                          weight: FontWeight.w600,
                          height: 16.5,
                        ),
                      ),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(right: 10),
                  child: Text(
                    '${shown.length} ${shown.length == 1 ? 'person' : 'people'}',
                    style: _A.text(9, color: _A.muted, height: 13.5),
                  ),
                ),
                GestureDetector(
                  onTap: () => _toggleAll(shown),
                  child: _Checkbox(checked: allShownTicked),
                ),
              ],
            ),
          ),
          Expanded(
            child: Stack(
              children: [
                if (_people == null && !_failed)
                  const Center(
                    child: CircularProgressIndicator(
                      color: _A.brand,
                      strokeWidth: 2.5,
                    ),
                  )
                else if (_failed && _people == null)
                  Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          "Couldn't load people.",
                          style: _A.text(13, color: _A.soft),
                        ),
                        TextButton(
                          onPressed: _load,
                          child: Text(
                            'Retry',
                            style: _A.text(
                              13,
                              weight: FontWeight.w600,
                              color: _A.brand,
                            ),
                          ),
                        ),
                      ],
                    ),
                  )
                else if (shown.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 48),
                    child: Align(
                      alignment: Alignment.topCenter,
                      child: Text(
                        'No one matches that search',
                        style: _A.text(13, color: _A.muted),
                      ),
                    ),
                  )
                else
                  ListView.builder(
                    key: const ValueKey('audience-people'),
                    padding: const EdgeInsets.only(bottom: 108),
                    keyboardDismissBehavior:
                        ScrollViewKeyboardDismissBehavior.onDrag,
                    itemCount: shown.length,
                    itemExtent: 66,
                    itemBuilder: (context, index) {
                      final person = shown[index];
                      return _PersonRow(
                        person: person,
                        selected: _selected.contains(person.id),
                        onTap: () => _toggle(person),
                      );
                    },
                  ),
                Positioned(
                  left: 10,
                  right: 10,
                  // 17 from the screen's foot, as drawn (node 3809:76583).
                  bottom: 17,
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 180),
                    transitionBuilder: (child, animation) => FadeTransition(
                      opacity: animation,
                      child: SlideTransition(
                        position: Tween(
                          begin: const Offset(0, 0.3),
                          end: Offset.zero,
                        ).animate(animation),
                        child: child,
                      ),
                    ),
                    child: selectedPeople.isEmpty
                        ? const SizedBox.shrink()
                        : Stack(
                            alignment: Alignment.center,
                            children: [
                              // While the list is being saved the bar waits,
                              // with a spinner on it.
                              AbsorbPointer(
                                absorbing: _saving,
                                child: _SelectionBar(
                                  people: selectedPeople,
                                  onTap: _review,
                                ),
                              ),
                              if (_saving)
                                const SizedBox(
                                  key: ValueKey('audience-saving'),
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                ),
                            ],
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
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.controller});

  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 54,
      padding: const EdgeInsets.symmetric(horizontal: 17.114),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: _A.line, width: 1.114),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1A000000),
            blurRadius: 3,
            offset: Offset(0, 1),
          ),
          BoxShadow(
            color: Color(0x1A000000),
            blurRadius: 2,
            offset: Offset(0, 1),
            spreadRadius: -1,
          ),
        ],
      ),
      child: Row(
        spacing: 12,
        children: [
          SvgPicture.asset(
            '${_A.icons}/audience_search.svg',
            width: 20,
            height: 20,
          ),
          Expanded(
            child: TextField(
              key: const ValueKey('audience-search'),
              controller: controller,
              textInputAction: TextInputAction.search,
              cursorColor: _A.brand,
              style: _A.text(16),
              // Bare: the app's input theme would draw a second box inside.
              decoration: InputDecoration(
                isCollapsed: true,
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: EdgeInsets.zero,
                hintText: 'Search name',
                hintStyle: _A.text(16, color: _A.hint),
              ),
            ),
          ),
          ValueListenableBuilder<TextEditingValue>(
            valueListenable: controller,
            // Always there, as drawn; it clears the search when there is one.
            builder: (context, value, _) => GestureDetector(
              key: const ValueKey('audience-search-clear'),
              onTap: controller.clear,
              child: Container(
                width: 23.995,
                height: 23.995,
                decoration: const BoxDecoration(
                  color: Color(0xFFDDDDDD),
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: SvgPicture.asset(
                  '${_A.icons}/audience_clear.svg',
                  width: 12.999,
                  height: 12.999,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PersonRow extends StatelessWidget {
  const _PersonRow({
    required this.person,
    required this.selected,
    required this.onTap,
  });

  final AudiencePerson person;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? _A.selectedRow : Colors.white,
      child: InkWell(
        key: ValueKey('audience-person-${person.id}'),
        onTap: onTap,
        child: Container(
          // The design's rows run 8.5 past the screen, so the box sits nearer
          // the edge than the one on "Select all"; kept as drawn.
          padding: const EdgeInsets.fromLTRB(16, 8, 7.5, 8),
          decoration: const BoxDecoration(border: Border(bottom: _hairline)),
          child: Row(
            spacing: 11,
            children: [
              _Avatar(person: person),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 3,
                  children: [
                    Text(
                      person.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: _A.text(13, weight: FontWeight.w600, height: 19.5),
                    ),
                    if (person.subtitle.isNotEmpty)
                      Text(
                        person.subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: _A.text(9, color: _A.muted, height: 12.6),
                      ),
                  ],
                ),
              ),
              _Checkbox(checked: selected),
            ],
          ),
        ),
      ),
    );
  }
}

/// The bar floating over the list once anyone is ticked (node 3809:76583).
class _SelectionBar extends StatelessWidget {
  const _SelectionBar({required this.people, required this.onTap});

  final List<AudiencePerson> people;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final faces = people.take(3).toList();
    return ClipRRect(
      key: const ValueKey('audience-selection-bar'),
      borderRadius: BorderRadius.circular(16),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 8, sigmaY: 8),
        child: GestureDetector(
          onTap: onTap,
          child: Container(
            height: 64,
            padding: const EdgeInsets.fromLTRB(12, 8, 9, 8),
            decoration: BoxDecoration(
              color: const Color(0xF5FFFFFF),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: _A.line, width: 1.115),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x1F222222),
                  blurRadius: 18,
                  offset: Offset(0, 4),
                ),
              ],
            ),
            child: Row(
              spacing: 10,
              children: [
                SizedBox(
                  width: 27.985 + (faces.length - 1) * 18.985,
                  height: 27.985,
                  child: Stack(
                    children: [
                      for (final (index, person) in faces.indexed)
                        Positioned(
                          left: index * 18.985,
                          child: _Avatar(
                            person: person,
                            size: 27.985,
                            ring: true,
                          ),
                        ),
                    ],
                  ),
                ),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    spacing: 2,
                    children: [
                      Text(
                        '${people.length} ${people.length == 1 ? 'person' : 'people'} selected',
                        style: _A.text(12, weight: FontWeight.w600, height: 18),
                      ),
                      Text(
                        'Review & name your list',
                        style: _A.text(8, color: _A.muted, height: 12),
                      ),
                    ],
                  ),
                ),
                Container(
                  key: const ValueKey('audience-review'),
                  width: 41.995,
                  height: 41.995,
                  decoration: const BoxDecoration(
                    color: _A.brand,
                    shape: BoxShape.circle,
                  ),
                  alignment: Alignment.center,
                  child: RotatedBox(
                    quarterTurns: 2,
                    child: SvgPicture.asset(
                      '${_A.icons}/audience_bar_arrow.svg',
                      width: 17.983,
                      height: 17.983,
                      colorFilter: const ColorFilter.mode(
                        Colors.white,
                        BlendMode.srcIn,
                      ),
                    ),
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

// --------------------------------------------------------------- review sheet

/// Naming the list and a last look at who is on it (node 3809:76737). Pops
/// true to save; anything else goes back to the picker.
class _ReviewSheet extends StatefulWidget {
  const _ReviewSheet({
    required this.name,
    required this.members,
    required this.editing,
    required this.onRemove,
  });

  final TextEditingController name;
  final List<AudiencePerson> members;
  final bool editing;
  final ValueChanged<AudiencePerson> onRemove;

  @override
  State<_ReviewSheet> createState() => _ReviewSheetState();
}

class _ReviewSheetState extends State<_ReviewSheet> {
  late final List<AudiencePerson> _members = [...widget.members];

  @override
  void initState() {
    super.initState();
    widget.name.addListener(_changed);
  }

  @override
  void dispose() {
    widget.name.removeListener(_changed);
    super.dispose();
  }

  void _changed() => setState(() {});

  void _remove(AudiencePerson person) {
    widget.onRemove(person);
    setState(() => _members.remove(person));
    if (_members.isEmpty) Navigator.of(context).pop(false);
  }

  @override
  Widget build(BuildContext context) {
    final count = _members.length;
    final ready = count > 0 && widget.name.text.trim().isNotEmpty;
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: keyboard),
      child: Container(
        constraints: const BoxConstraints(maxHeight: 698.917, maxWidth: 420),
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
          child: Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const _Handle(),
                // Bounded by the sheet, so the members list below takes what
                // is left and scrolls instead of running past the bottom.
                Flexible(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      spacing: 8,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  spacing: 2,
                                  children: [
                                    Text(
                                      'Review list',
                                      style: _A.text(
                                        15,
                                        weight: FontWeight.w600,
                                        height: 22.5,
                                      ),
                                    ),
                                    Text(
                                      '$count ${count == 1 ? 'person' : 'people'} selected',
                                      style: _A.text(
                                        9,
                                        color: _A.muted,
                                        height: 13.5,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              GestureDetector(
                                key: const ValueKey('audience-review-collapse'),
                                onTap: () => Navigator.of(context).pop(false),
                                child: Container(
                                  width: 35.983,
                                  height: 35.983,
                                  decoration: const BoxDecoration(
                                    color: _A.page,
                                    shape: BoxShape.circle,
                                  ),
                                  alignment: Alignment.center,
                                  child: SvgPicture.asset(
                                    '${_A.icons}/audience_collapse.svg',
                                    width: 16.99,
                                    height: 16.99,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          spacing: 7,
                          children: [
                            Text(
                              'List name',
                              style: _A.text(10, color: _A.soft, height: 15),
                            ),
                            Container(
                              height: 41.995,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                              ),
                              alignment: Alignment.centerLeft,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(9),
                                border: Border.all(
                                  color: _A.teal,
                                  width: 1.115,
                                ),
                              ),
                              child: TextField(
                                key: const ValueKey('audience-list-name'),
                                controller: widget.name,
                                maxLength: 40,
                                textCapitalization:
                                    TextCapitalization.sentences,
                                cursorColor: _A.teal,
                                style: _A.text(13, height: 19.5),
                                decoration: InputDecoration(
                                  isCollapsed: true,
                                  counterText: '',
                                  filled: false,
                                  border: InputBorder.none,
                                  enabledBorder: InputBorder.none,
                                  focusedBorder: InputBorder.none,
                                  contentPadding: EdgeInsets.zero,
                                  hintText: 'Name your list',
                                  hintStyle: _A.text(
                                    13,
                                    color: _A.hint,
                                    height: 19.5,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                        Padding(
                          padding: const EdgeInsets.only(bottom: 7),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  'Members',
                                  style: _A.text(
                                    10,
                                    color: _A.soft,
                                    height: 15,
                                  ),
                                ),
                              ),
                              GestureDetector(
                                key: const ValueKey('audience-add-more'),
                                behavior: HitTestBehavior.opaque,
                                onTap: () => Navigator.of(context).pop(false),
                                child: Row(
                                  spacing: 3,
                                  children: [
                                    SvgPicture.asset(
                                      '${_A.icons}/audience_add_more.svg',
                                      width: 13.993,
                                      height: 13.993,
                                    ),
                                    Text(
                                      'Add more people',
                                      style: _A.text(
                                        10,
                                        weight: FontWeight.w600,
                                        color: _A.tealText,
                                        height: 15,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        Flexible(
                          child: Container(
                            decoration: const BoxDecoration(
                              border: Border(top: _hairline, bottom: _hairline),
                            ),
                            child: ListView.builder(
                              shrinkWrap: true,
                              padding: EdgeInsets.zero,
                              itemCount: _members.length,
                              itemBuilder: (context, index) {
                                final person = _members[index];
                                return Container(
                                  key: ValueKey('audience-member-${person.id}'),
                                  height: 60,
                                  padding: const EdgeInsets.symmetric(
                                    vertical: 7,
                                  ),
                                  decoration: BoxDecoration(
                                    border: index == _members.length - 1
                                        ? null
                                        : const Border(bottom: _hairline),
                                  ),
                                  child: Row(
                                    spacing: 10,
                                    children: [
                                      _Avatar(person: person),
                                      Expanded(
                                        child: Column(
                                          mainAxisAlignment:
                                              MainAxisAlignment.center,
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          spacing: 3,
                                          children: [
                                            Text(
                                              person.name,
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: _A.text(
                                                13,
                                                weight: FontWeight.w600,
                                                height: 19.5,
                                              ),
                                            ),
                                            if (person.subtitle.isNotEmpty)
                                              Text(
                                                person.subtitle,
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                                style: _A.text(
                                                  9,
                                                  color: _A.muted,
                                                  height: 12.6,
                                                ),
                                              ),
                                          ],
                                        ),
                                      ),
                                      SizedBox(
                                        width: 31.993,
                                        height: 31.993,
                                        child: IconButton(
                                          key: ValueKey(
                                            'audience-remove-${person.id}',
                                          ),
                                          padding: EdgeInsets.zero,
                                          onPressed: () => _remove(person),
                                          icon: SvgPicture.asset(
                                            '${_A.icons}/audience_remove.svg',
                                            width: 13.993,
                                            height: 13.993,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                );
                              },
                            ),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(top: 8, bottom: 6),
                          child: Text(
                            'This list will appear under “Who can see this post”.',
                            textAlign: TextAlign.center,
                            style: _A.text(10, color: _A.muted, height: 12),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(bottom: 14),
                          child: SizedBox(
                            height: 48,
                            child: Material(
                              color: ready
                                  ? _A.teal
                                  : _A.teal.withValues(alpha: 0.45),
                              borderRadius: BorderRadius.circular(10),
                              child: InkWell(
                                key: const ValueKey('audience-save'),
                                borderRadius: BorderRadius.circular(10),
                                onTap: ready
                                    ? () => Navigator.of(context).pop(true)
                                    : null,
                                child: Center(
                                  child: Text(
                                    '${widget.editing ? 'Save list' : 'Create list'} · $count',
                                    style: _A.text(
                                      13,
                                      weight: FontWeight.w600,
                                      color: Colors.white,
                                      height: 19.5,
                                    ),
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
              ],
            ),
          ),
        ),
      ),
    );
  }
}
