part of 'connect_feed_screen.dart';

// Tagging people in a comment: type "@", pick a colleague from the list that
// opens above the box, and their name goes into the comment as "@Full Name".
// The server is told who was picked, notifies them, and sends the tags back
// with the comment so the names can be drawn as links to their profiles.

/// The "@" being typed in one comment box, and the people picked so far.
class _CommentMentions {
  _CommentMentions(this.controller);

  final TextEditingController controller;
  final Map<String, ConnectTeammate> _picked = {};

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
    _picked[person.userId] = person;
  }

  /// The people picked whose name is still in [text]: a tag deleted while
  /// typing is not sent.
  List<ConnectMention> mentionsIn(String text) => [
    for (final person in _picked.values)
      if (text.contains('@${person.name}'))
        ConnectMention(userId: person.userId, name: person.name),
  ];

  void clear() => _picked.clear();
}

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
  final spans = <InlineSpan>[];
  var index = 0;
  while (index < text.length) {
    // The earliest tag from here on; the longest name wins a tie, so
    // "@Ananya Bisht" is not read as "@Ananya".
    ConnectMention? next;
    var nextAt = -1;
    for (final mention in comment.mentions) {
      final at = text.indexOf('@${mention.name}', index);
      if (at < 0) continue;
      if (nextAt < 0 ||
          at < nextAt ||
          (at == nextAt && mention.name.length > next!.name.length)) {
        next = mention;
        nextAt = at;
      }
    }
    if (next == null) {
      spans.add(TextSpan(text: text.substring(index)));
      break;
    }
    if (nextAt > index) spans.add(TextSpan(text: text.substring(index, nextAt)));
    final tagged = next;
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
    index = nextAt + tagged.name.length + 1;
  }
  return Text.rich(TextSpan(style: style, children: spans));
}
