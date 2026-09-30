import '../../help/data/help_topics.dart';

/// Care: the catalogue of media behind the activities, the ten topics'
/// text, and what someone wrote this week.
class CareTrack {
  const CareTrack({
    required this.id,
    required this.title,
    required this.meta,
    this.url,
  });

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

/// One clip of a stretch and the steps, counted from 1, it shows. A clip
/// that covers several steps advances them evenly over its length.
class MoveClip {
  const MoveClip({required this.url, required this.steps});

  final String url;
  final List<int> steps;

  factory MoveClip.fromJson(Map<String, dynamic> json) => MoveClip(
    url: json['url'] as String? ?? '',
    steps: [
      for (final s in (json['steps'] as List<dynamic>? ?? const []))
        (s as num).toInt(),
    ],
  );
}

/// A piece of kept writing: a letter, a story, a life area, a love letter.
class CareWriting {
  const CareWriting({
    required this.key,
    required this.fields,
    required this.createdAt,
    required this.updatedAt,
  });

  final String key;
  final Map<String, String> fields;
  final DateTime createdAt;
  final DateTime updatedAt;

  String field(String name) => fields[name] ?? '';

  factory CareWriting.fromJson(Map<String, dynamic> json) => CareWriting(
    key: json['key'] as String? ?? '',
    fields: {
      for (final e
          in (json['fields'] as Map<String, dynamic>? ?? const {}).entries)
        e.key: '${e.value ?? ''}',
    },
    createdAt:
        DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
    updatedAt:
        DateTime.tryParse(json['updatedAt'] as String? ?? '') ?? DateTime.now(),
  );
}

class CareCatalog {
  const CareCatalog({
    this.webBase = '',
    this.topics = const [],
    this.stretches = const [],
    this.moods = const [],
    this.moveClips = const {},
    this.breatheSounds = const {},
    this.meditations = const [],
    this.affirmations = const [],
    this.rest = const [],
    this.stories = const [],
    this.sounds = const [],
    this.prompts = const [],
    this.topicVideos = const {},
  });

  /// Where the Care pages live on the web, e.g. https://care.getsowaka.com.
  /// Empty means the app shows its own screens.
  final String webBase;

  /// The topics on Help home, as Sowaka has worded them; a new one here
  /// appears in the app on its next open.
  final List<HelpTopic> topics;

  /// Move's stretches and Breathe's moods as the catalogue words them; the
  /// app's built-in text stands in when these are empty.
  final List<Map<String, dynamic>> stretches;
  final List<Map<String, dynamic>> moods;

  /// Stretch key → its clips, in order.
  final Map<String, List<MoveClip>> moveClips;

  /// Mood key → the sound behind the breath.
  final Map<String, String?> breatheSounds;
  final List<CareTrack> meditations;
  final List<CareTrack> affirmations;
  final List<CareTrack> rest;
  final List<CareTrack> stories;
  final List<CareTrack> sounds;
  final List<String> prompts;
  final Map<String, String?> topicVideos;

  static const empty = CareCatalog();

  List<MoveClip> clipsFor(String stretch) => moveClips[stretch] ?? const [];

  static List<CareTrack> _tracks(dynamic raw) => [
    for (final row in (raw as List<dynamic>? ?? const []))
      CareTrack.fromJson(row as Map<String, dynamic>),
  ];

  static Map<String, String?> _urls(dynamic raw) => {
    for (final entry
        in (raw as Map<String, dynamic>? ?? const <String, dynamic>{}).entries)
      entry.key: entry.value as String?,
  };

  factory CareCatalog.fromJson(Map<String, dynamic> json) {
    final listen =
        json['listen'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final sleep =
        json['sleep'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    return CareCatalog(
      webBase: (json['webBase'] as String? ?? '').replaceAll(
        RegExp(r'/+$'),
        '',
      ),
      topics: [
        for (final row in (json['topics'] as List<dynamic>? ?? const []))
          HelpTopic.fromJson(row as Map<String, dynamic>),
      ],
      stretches: [
        for (final row in (json['stretches'] as List<dynamic>? ?? const []))
          row as Map<String, dynamic>,
      ],
      moods: [
        for (final row in (json['moods'] as List<dynamic>? ?? const []))
          row as Map<String, dynamic>,
      ],
      moveClips: {
        for (final entry
            in (json['moveClips'] as Map<String, dynamic>? ??
                    const <String, dynamic>{})
                .entries)
          entry.key: [
            for (final row in (entry.value as List<dynamic>? ?? const []))
              MoveClip.fromJson(row as Map<String, dynamic>),
          ],
      },
      breatheSounds: _urls(json['breatheSounds']),
      meditations: _tracks(listen['meditations']),
      affirmations: _tracks(listen['affirmations']),
      rest: _tracks(sleep['rest']),
      stories: _tracks(sleep['stories']),
      sounds: _tracks(sleep['sounds']),
      prompts: [
        for (final p in (json['prompts'] as List<dynamic>? ?? const [])) '$p',
      ],
      topicVideos: _urls(json['topicVideos']),
    );
  }
}

class JournalEntry {
  const JournalEntry({
    required this.id,
    required this.text,
    this.prompt,
    required this.context,
    required this.createdAt,
  });

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
  const JournalView({
    required this.entries,
    required this.clearsAt,
    required this.email,
  });

  final List<JournalEntry> entries;

  /// When the week's writing is mailed and cleared.
  final DateTime clearsAt;
  final String email;

  factory JournalView.fromJson(Map<String, dynamic> json) => JournalView(
    entries: [
      for (final row in (json['entries'] as List<dynamic>? ?? const []))
        JournalEntry.fromJson(row as Map<String, dynamic>),
    ],
    clearsAt:
        DateTime.tryParse(json['clearsAt'] as String? ?? '') ?? DateTime.now(),
    email: json['email'] as String? ?? '',
  );
}
