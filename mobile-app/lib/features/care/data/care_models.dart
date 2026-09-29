import '../../help/data/help_topics.dart';

/// Care: the catalogue of media behind the activities, the ten topics'
/// text, and what someone wrote this week.
class CareTrack {
  const CareTrack({required this.id, required this.title, required this.meta, this.url});

  final String id;
  final String title;

  /// '5 min · Guided meditation'
  final String meta;

  /// Where the file is. Null until Sowaka provides it.
  final String? url;

  factory CareTrack.fromJson(Map<String, dynamic> json) => CareTrack(
    id: json['id'] as String? ?? '',
    title: json['title'] as String? ?? '',
    meta: json['meta'] as String? ?? '',
    url: json['url'] as String?,
  );
}

class CareCatalog {
  const CareCatalog({
    this.topics = const [],
    this.moveVideos = const {},
    this.meditations = const [],
    this.affirmations = const [],
    this.rest = const [],
    this.stories = const [],
    this.sounds = const [],
    this.prompts = const [],
    this.topicVideos = const {},
  });

  /// The ten topics on Help home, as Sowaka has worded them.
  final List<HelpTopic> topics;

  /// `<stretch>/<step from 1>` → video url.
  final Map<String, String?> moveVideos;
  final List<CareTrack> meditations;
  final List<CareTrack> affirmations;
  final List<CareTrack> rest;
  final List<CareTrack> stories;
  final List<CareTrack> sounds;
  final List<String> prompts;
  final Map<String, String?> topicVideos;

  static const empty = CareCatalog();

  String? moveVideo(String stretch, int step) => moveVideos['$stretch/$step'];

  static List<CareTrack> _tracks(dynamic raw) => [for (final row in (raw as List<dynamic>? ?? const [])) CareTrack.fromJson(row as Map<String, dynamic>)];

  static Map<String, String?> _urls(dynamic raw) => {
    for (final entry in (raw as Map<String, dynamic>? ?? const <String, dynamic>{}).entries) entry.key: entry.value as String?,
  };

  factory CareCatalog.fromJson(Map<String, dynamic> json) {
    final listen = json['listen'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final sleep = json['sleep'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    return CareCatalog(
      topics: [for (final row in (json['topics'] as List<dynamic>? ?? const [])) HelpTopic.fromJson(row as Map<String, dynamic>)],
      moveVideos: _urls(json['moveVideos']),
      meditations: _tracks(listen['meditations']),
      affirmations: _tracks(listen['affirmations']),
      rest: _tracks(sleep['rest']),
      stories: _tracks(sleep['stories']),
      sounds: _tracks(sleep['sounds']),
      prompts: [for (final p in (json['prompts'] as List<dynamic>? ?? const [])) '$p'],
      topicVideos: _urls(json['topicVideos']),
    );
  }
}

class JournalEntry {
  const JournalEntry({required this.id, required this.text, this.prompt, required this.context, required this.createdAt});

  final String id;
  final String text;
  final String? prompt;

  /// `general`, `topic:<id>` or `tool:<id>`.
  final String context;
  final DateTime createdAt;

  factory JournalEntry.fromJson(Map<String, dynamic> json) => JournalEntry(
    id: json['id'] as String? ?? '',
    text: json['text'] as String? ?? '',
    prompt: json['prompt'] as String?,
    context: json['context'] as String? ?? 'general',
    createdAt: DateTime.parse(json['createdAt'] as String),
  );
}

class JournalView {
  const JournalView({required this.entries, required this.clearsAt, required this.email});

  final List<JournalEntry> entries;

  /// When the week's writing is mailed and cleared.
  final DateTime clearsAt;
  final String email;

  factory JournalView.fromJson(Map<String, dynamic> json) => JournalView(
    entries: [for (final row in (json['entries'] as List<dynamic>? ?? const [])) JournalEntry.fromJson(row as Map<String, dynamic>)],
    clearsAt: DateTime.tryParse(json['clearsAt'] as String? ?? '') ?? DateTime.now(),
    email: json['email'] as String? ?? '',
  );
}
