/// One of the company's own policies, as `GET /policies` sends it. Its words
/// live in the database, so changing them needs no release.
///
/// A company with none keeps the policies the app writes for itself from its
/// shift rules; see the Policies page in the Actions tab.
class PolicyDocument {
  const PolicyDocument({
    required this.key,
    required this.title,
    required this.body,
    this.summary = '',
    this.order = 0,
    this.updatedAt,
    this.version = 1,
    this.textUpdatedAt,
    this.ackRequired = false,
    this.changeNote = '',
    this.readMinutes,
    this.acknowledgedAt,
    this.acknowledgedVersion,
  });

  /// One row of the list, or null for a row this app cannot show: no key, no
  /// title or no text. A bad row is skipped, never a crash.
  static PolicyDocument? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final key = _string(raw['key']).trim();
    final title = _string(raw['title']).trim();
    final body = _string(raw['body']);
    if (key.isEmpty || title.isEmpty || body.trim().isEmpty) return null;
    final order = raw['order'];
    final version = raw['version'];
    final ackVersion = raw['acknowledgedVersion'];
    final minutes = raw['readMinutes'];
    return PolicyDocument(
      key: key,
      title: title,
      body: body,
      summary: _string(raw['summary']).trim(),
      order: order is num ? order.toDouble() : 0,
      updatedAt: DateTime.tryParse(_string(raw['updatedAt']))?.toLocal(),
      version: version is num && version >= 1 ? version.toInt() : 1,
      textUpdatedAt: DateTime.tryParse(_string(raw['textUpdatedAt']))?.toLocal(),
      // A server older than acknowledgements says nothing: read only, as before.
      ackRequired: raw['ackRequired'] == true,
      changeNote: _string(raw['changeNote']).trim(),
      readMinutes: minutes is num && minutes >= 1 ? minutes.toInt() : null,
      acknowledgedAt: DateTime.tryParse(_string(raw['acknowledgedAt']))?.toLocal(),
      acknowledgedVersion: ackVersion is num ? ackVersion.toInt() : null,
    );
  }

  /// 'leave', 'attendance', 'overtime', 'claims', or any other.
  final String key;

  /// Its name: 'Leave'.
  final String title;

  /// Plain text; see [parsePolicyBody] for the little it formats.
  final String body;

  /// One line under the name in the list; empty when there is none.
  final String summary;
  final double order;
  final DateTime? updatedAt;

  /// The text's version, 1 up: what an acknowledgement is of.
  final int version;

  /// When the text last changed ([updatedAt] also moves on a reorder).
  final DateTime? textUpdatedAt;

  /// Whether the person is asked to acknowledge it; false is read only.
  final bool ackRequired;

  /// What changed in this version, shown with "Updated"; empty for the first.
  final String changeNote;

  /// About how long it takes to read, from the server; null from an older one.
  final int? readMinutes;

  /// This person's acknowledgement, of whichever version they read.
  final DateTime? acknowledgedAt;
  final int? acknowledgedVersion;

  /// Acknowledged at the version in force now.
  bool get isAcknowledged => acknowledgedVersion != null && acknowledgedVersion == version;

  /// Acknowledged once, and the text has changed since: "Updated".
  bool get isUpdatedSinceAck => acknowledgedVersion != null && acknowledgedVersion != version;

  /// Still to acknowledge: needed, and not at this version.
  bool get needsAck => ackRequired && !isAcknowledged;

  /// "Version 2 · 4 min read".
  String get versionLine => [
    'Version $version',
    if (readMinutes != null) '$readMinutes min read',
  ].join(' · ');

  Map<String, dynamic> toJson() => {
    'key': key,
    'title': title,
    'summary': summary,
    'body': body,
    'order': order,
    if (updatedAt != null) 'updatedAt': updatedAt!.toUtc().toIso8601String(),
    'version': version,
    if (textUpdatedAt != null) 'textUpdatedAt': textUpdatedAt!.toUtc().toIso8601String(),
    'ackRequired': ackRequired,
    if (changeNote.isNotEmpty) 'changeNote': changeNote,
    'readMinutes': ?readMinutes,
    if (acknowledgedAt != null) 'acknowledgedAt': acknowledgedAt!.toUtc().toIso8601String(),
    'acknowledgedVersion': ?acknowledgedVersion,
  };
}

/// The policies from `{policies: [...]}`, in the order given, without the
/// rows this app cannot show.
List<PolicyDocument> parsePolicyDocuments(Map<String, dynamic> json) {
  final rows = json['policies'];
  if (rows is! List) return const [];
  return [for (final row in rows) ?PolicyDocument.tryParse(row)];
}

/// What a policy is called in the list and on its page's bar: 'Leave' reads
/// "Leave policy", as the built-in ones always have, and a title that
/// already says so is left alone.
String policyHeading(String title) {
  final trimmed = title.trim();
  return RegExp(r'\b(policy|policies)$', caseSensitive: false).hasMatch(trimmed)
      ? trimmed
      : '$trimmed policy';
}

/// "Updated 10 Oct 2026", from when the text last changed.
String policyUpdatedLabel(DateTime at) {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return 'Updated ${at.day} ${months[at.month - 1]} ${at.year}';
}

/// "15 Dec 2026".
String policyDateLabel(DateTime at) => policyUpdatedLabel(at).substring('Updated '.length);

/// One piece of a policy's page.
sealed class PolicyBlock {
  const PolicyBlock();
}

/// A "## " line: a section heading, drawn between the cards.
final class PolicyHeading extends PolicyBlock {
  const PolicyHeading(this.text);
  final String text;

  @override
  bool operator ==(Object other) =>
      other is PolicyHeading && other.text == text;

  @override
  int get hashCode => text.hashCode;

  @override
  String toString() => 'PolicyHeading($text)';
}

/// A paragraph: everything between blank lines, drawn as one card. Its lines
/// keep their breaks; a "- " line is a bullet.
final class PolicyCard extends PolicyBlock {
  const PolicyCard(this.lines);
  final List<PolicyLine> lines;

  @override
  bool operator ==(Object other) {
    if (other is! PolicyCard || other.lines.length != lines.length) {
      return false;
    }
    for (var i = 0; i < lines.length; i++) {
      if (other.lines[i] != lines[i]) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hashAll(lines);

  @override
  String toString() => 'PolicyCard($lines)';
}

class PolicyLine {
  const PolicyLine(this.text, {this.bullet = false});
  final String text;
  final bool bullet;

  @override
  bool operator ==(Object other) =>
      other is PolicyLine && other.text == text && other.bullet == bullet;

  @override
  int get hashCode => Object.hash(text, bullet);

  @override
  String toString() => bullet ? '- $text' : text;
}

/// A policy's text as the page draws it. Deliberately small, so what is
/// written is what shows:
///
/// * a blank line ends a paragraph, and each paragraph is its own card;
/// * a line starting "- " is a bullet;
/// * a line starting "## " is a section heading.
///
/// Nothing else is formatting, and nothing is markup: the text is shown as
/// text, so an angle bracket is only ever an angle bracket.
List<PolicyBlock> parsePolicyBody(String body) {
  final blocks = <PolicyBlock>[];
  var lines = <PolicyLine>[];
  void closeCard() {
    if (lines.isEmpty) return;
    blocks.add(PolicyCard(List.unmodifiable(lines)));
    lines = <PolicyLine>[];
  }

  final normalised = body.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  for (final raw in normalised.split('\n')) {
    final line = raw.trim();
    if (line.isEmpty) {
      closeCard();
    } else if (line == '##' || line.startsWith('## ')) {
      closeCard();
      final text = line.substring(2).trim();
      if (text.isNotEmpty) blocks.add(PolicyHeading(text));
    } else if (line == '-' || line.startsWith('- ')) {
      final text = line.substring(1).trim();
      if (text.isNotEmpty) lines.add(PolicyLine(text, bullet: true));
    } else {
      lines.add(PolicyLine(line));
    }
  }
  closeCard();
  return blocks;
}

String _string(Object? value) => value is String ? value : '';

/// How many of [policies] are still to acknowledge (needed, and not at the
/// version in force): one count for the Actions tile ("3 to acknowledge"),
/// the Policies screen and onboarding's "Acknowledge policies" task.
int policiesToAcknowledge(Iterable<PolicyDocument> policies) =>
    policies.where((p) => p.needsAck).length;
