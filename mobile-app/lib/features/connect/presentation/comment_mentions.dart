part of 'connect_feed_screen.dart';

// Tagging people in a comment: type "@", pick a colleague from the list that
// opens above the box, and their name goes into the comment as "@Full Name".
// The server is told who was picked, notifies them, and sends the tags back
// with the comment so the names can be drawn as links to their profiles.

/// The "@" being typed in one comment box, and the people picked so far.
class _CommentMentions {
  _CommentMentions(this.controller);

  final TextEditingController controller;

  /// In the order they were picked, the latest last.
  final List<ConnectTeammate> _picked = [];

  int get _cursor {
    final value = controller.value;
    final offset = value.selection.isValid
        ? value.selection.baseOffset
        : value.text.length;
    return offset.clamp(0, value.text.length);
  }

  /// What follows the "@" under the cursor, or null when not tagging. An "@"
  /// counts only at the start or after a space, so an email address is not a
  /// tag, and the tag ends after two words or a picked name's trailing space.
  String? get query {
    final before = controller.text.substring(0, _cursor);
    final at = before.lastIndexOf('@');
    if (at < 0) return null;
    if (at > 0 && !RegExp(r'\s').hasMatch(before[at - 1])) return null;
    final typed = before.substring(at + 1);
    if (typed.length > 30 || typed.contains('\n')) return null;
    if (typed.split(' ').length > 2) return null;
    return typed;
  }

  /// Up to five colleagues whose name, or any word of it, starts with what
  /// was typed. Never the writer themselves.
  List<ConnectTeammate> matches(
    List<ConnectTeammate> people, {
    required String viewerUserId,
  }) {
    final typed = query;
    if (typed == null) return const [];
    final needle = typed.trim().toLowerCase();
    return people
        .where((person) {
          if (person.userId.isEmpty || person.userId == viewerUserId) {
            return false;
          }
          if (needle.isEmpty) return true;
          final name = person.name.toLowerCase();
          return name.startsWith(needle) ||
              name.split(' ').any((word) => word.startsWith(needle));
        })
        .take(5)
        .toList();
  }

  /// Puts "@Full Name " in place of what was typed after the "@".
  void pick(ConnectTeammate person) {
    final cursor = _cursor;
    final text = controller.text;
    final at = text.substring(0, cursor).lastIndexOf('@');
    if (at < 0) return;
    final inserted = '@${person.name} ';
    controller.value = TextEditingValue(
      text: text.replaceRange(at, cursor, inserted),
      selection: TextSelection.collapsed(offset: at + inserted.length),
    );
    _picked
      ..removeWhere((picked) => picked.userId == person.userId)
      ..add(person);
  }

  /// The people picked whose name is still in [text]: a tag deleted while
  /// typing is not sent. Two people with the same name read the same in the
  /// text, so the one picked last is the one meant. A name counts only where
  /// it stands whole — "@Ana" inside "@Ana Bisht" or "@Anaya" is not Ana.
  List<ConnectMention> mentionsIn(String text) {
    final byName = {for (final person in _picked) person.name: person};
    final names = byName.keys.toList();
    return [
      for (final person in byName.values)
        if (_tagsIn(text, person.name, names).isNotEmpty)
          ConnectMention(userId: person.userId, name: person.name),
    ];
  }

  /// Puts back the people of a comment that did not go, so sending it again
  /// tags them again.
  void restore(List<ConnectMention> mentions) {
    for (final mention in mentions) {
      _picked
        ..removeWhere((picked) => picked.userId == mention.userId)
        ..add(
          ConnectTeammate(
            userId: mention.userId,
            name: mention.name,
            initials: '',
          ),
        );
    }
  }

  void clear() => _picked.clear();
}

/// Where "@[name]" stands whole in [text]: not run on into more of a word
/// ("@Ana" in "@Anaya"), and not the start of a longer one of [names] at the
/// same spot ("@Ana" in "@Ana Bisht").
List<int> _tagsIn(String text, String name, Iterable<String> names) {
  final tag = '@$name';
  final found = <int>[];
  for (var at = text.indexOf(tag); at >= 0; at = text.indexOf(tag, at + 1)) {
    final end = at + tag.length;
    if (end < text.length && _nameCharacter.hasMatch(text[end])) continue;
    final inLonger = names.any(
      (other) => other.length > name.length && text.startsWith('@$other', at),
    );
    if (!inLonger) found.add(at);
  }
  return found;
}

/// What carries a name on past its end: a letter, a mark or a digit. So
/// "@Ana," and "@Ana's" are Ana, and "@Anaya" is not.
final _nameCharacter = RegExp(r'[\p{L}\p{M}\p{N}]', unicode: true);

/// The colleagues matching the "@" being typed, drawn above the comment box.
class _MentionSuggestions extends StatelessWidget {
  const _MentionSuggestions({required this.people, required this.onPick});

  final List<ConnectTeammate> people;
  final ValueChanged<ConnectTeammate> onPick;

  @override
  Widget build(BuildContext context) {
    if (people.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFEBEBEB)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14000000),
            blurRadius: 12,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final person in people)
            InkWell(
              onTap: () => onPick(person),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                child: Row(
                  children: [
                    _InitialAvatar(
                      initials: person.initials,
                      color: _ConnectColors.blue,
                      photoUrl: person.photoUrl ?? '',
                      size: 28,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            person.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0xFF242424),
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          if (person.department.isNotEmpty)
                            Text(
                              person.department,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Color(0xFF717171),
                                fontSize: 11,
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
      ),
    );
  }
}

/// A comment's text with the people tagged in it drawn as links to their
/// profiles. Without tags it is [plain], exactly as before.
Widget _commentBody(
  ConnectComment comment, {
  required TextStyle style,
  required Widget plain,
  ValueChanged<String>? onOpenPerson,
}) {
  if (comment.mentions.isEmpty) return plain;
  final text = comment.text;
  // Each tag where it stands whole, earliest first, linked to the person the
  // comment carries for that name. Two people of one name (an older comment)
  // are told apart by order: the first such tag is the first of them.
  final byName = <String, List<ConnectMention>>{};
  for (final mention in comment.mentions) {
    (byName[mention.name] ??= []).add(mention);
  }
  final tags = <(int, ConnectMention)>[
    for (final MapEntry(key: name, value: people) in byName.entries)
      for (final (index, at) in _tagsIn(text, name, byName.keys).indexed)
        (at, people[math.min(index, people.length - 1)]),
  ]..sort((a, b) => a.$1.compareTo(b.$1));
  final spans = <InlineSpan>[];
  var index = 0;
  for (final (at, tagged) in tags) {
    if (at > index) spans.add(TextSpan(text: text.substring(index, at)));
    spans.add(
      WidgetSpan(
        alignment: PlaceholderAlignment.baseline,
        baseline: TextBaseline.alphabetic,
        child: GestureDetector(
          onTap: onOpenPerson == null ? null : () => onOpenPerson(tagged.userId),
          child: Text(
            '@${tagged.name}',
            style: style.copyWith(
              color: _ConnectColors.blue,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
    );
    index = at + tagged.name.length + 1;
  }
  if (index < text.length) spans.add(TextSpan(text: text.substring(index)));
  return Text.rich(TextSpan(style: style, children: spans));
}
