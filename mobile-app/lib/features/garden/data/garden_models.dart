/// Gratitude Garden: what the server sends, parsed once.
///
/// Every person in the company has a tree. A note is a flower or a fruit
/// someone put on it, with a few words. The whole company reads it.
class GardenKind {
  const GardenKind(this.key, this.name, this.meaning, {required this.isFlower});

  final String key;
  final String name;
  final String meaning;
  final bool isFlower;

  String get asset => 'assets/garden/kinds/$key.svg';
}

/// The thirteen kinds, in the order the picker shows them. Meanings are fixed
/// and shown wherever the sprite appears, so a tree reads without opening a
/// single note.
const List<GardenKind> gardenKinds = [
  GardenKind('sunflower', 'Sunflower', 'You bring warmth to the room', isFlower: true),
  GardenKind('hibiscus', 'Hibiscus', 'You showed up when it mattered', isFlower: true),
  GardenKind('tulip', 'Tulip', 'A simple, whole-hearted thank you', isFlower: true),
  GardenKind('blossom', 'Blossom', 'You made my day lighter', isFlower: true),
  GardenKind('daisy', 'Daisy', 'A kindness I noticed', isFlower: true),
  GardenKind('lotus', 'Lotus', 'Calm when things were not', isFlower: true),
  GardenKind('rose', 'Rose', 'Deep gratitude, no small thing', isFlower: true),
  GardenKind('apple', 'Apple', 'You helped me learn something', isFlower: false),
  GardenKind('orange', 'Orange', 'You energised the whole team', isFlower: false),
  GardenKind('strawberry', 'Strawberry', 'You made a hard week sweeter', isFlower: false),
  GardenKind('grapes', 'Grapes', 'You brought people together', isFlower: false),
  GardenKind('mango', 'Mango', 'You went the extra mile', isFlower: false),
  GardenKind('lemon', 'Lemon', 'You kept us honest and fresh', isFlower: false),
];

GardenKind kindOf(String key) => gardenKinds.firstWhere(
  (kind) => kind.key == key,
  orElse: () => gardenKinds.first,
);

class GardenPerson {
  const GardenPerson({
    required this.userId,
    required this.name,
    required this.department,
    required this.isMe,
    this.photoUrl,
  });

  final String userId;
  final String name;
  final String department;
  final bool isMe;
  final String? photoUrl;

  String get firstName => name.split(' ').first;
  String get initial => name.isEmpty ? '?' : name[0].toUpperCase();

  factory GardenPerson.fromJson(Map<String, dynamic> json) => GardenPerson(
    userId: json['userId'] as String? ?? '',
    name: json['name'] as String? ?? 'Someone',
    department: json['department'] as String? ?? '',
    isMe: json['isMe'] == true,
    photoUrl: json['photoUrl'] as String?,
  );
}

/// One flower or fruit on a tree, as the garden overview carries it.
class GardenSprite {
  const GardenSprite({required this.id, required this.kind, required this.fromUserId});

  final String id;
  final String kind;
  final String fromUserId;

  factory GardenSprite.fromJson(Map<String, dynamic> json) => GardenSprite(
    id: json['id'] as String? ?? '',
    kind: json['kind'] as String? ?? 'daisy',
    fromUserId: json['fromUserId'] as String? ?? '',
  );
}

class GardenView {
  const GardenView({
    required this.season,
    required this.daysLeft,
    required this.people,
    required this.trees,
    required this.givenToday,
    required this.dailyLimit,
  });

  final String season;
  final int daysLeft;
  final List<GardenPerson> people;

  /// What is on each tree this season, keyed by the owner's id.
  final Map<String, List<GardenSprite>> trees;
  final int givenToday;
  final int dailyLimit;

  int get leftToday => (dailyLimit - givenToday).clamp(0, dailyLimit);
  GardenPerson? get me => people.where((p) => p.isMe).firstOrNull;

  factory GardenView.fromJson(Map<String, dynamic> json) {
    final trees = <String, List<GardenSprite>>{};
    for (final entry in (json['trees'] as Map<String, dynamic>? ?? const {}).entries) {
      trees[entry.key] = [
        for (final row in (entry.value as List<dynamic>? ?? const []))
          GardenSprite.fromJson(row as Map<String, dynamic>),
      ];
    }
    return GardenView(
      season: json['season'] as String? ?? '',
      daysLeft: (json['daysLeft'] as num?)?.toInt() ?? 0,
      people: [
        for (final row in (json['people'] as List<dynamic>? ?? const []))
          GardenPerson.fromJson(row as Map<String, dynamic>),
      ],
      trees: trees,
      givenToday: (json['givenToday'] as num?)?.toInt() ?? 0,
      dailyLimit: (json['dailyLimit'] as num?)?.toInt() ?? 3,
    );
  }
}

class GardenNote {
  const GardenNote({
    required this.id,
    required this.kind,
    required this.note,
    required this.fromUserId,
    required this.fromName,
    required this.toUserId,
    required this.toName,
    required this.createdAt,
    required this.removable,
    this.fromPhotoUrl,
    this.toPhotoUrl,
  });

  final String id;
  final String kind;
  final String note;
  final String fromUserId;
  final String fromName;
  final String? fromPhotoUrl;
  final String toUserId;
  final String toName;
  final String? toPhotoUrl;
  final DateTime createdAt;

  /// On the viewer's own tree, so they may take it off.
  final bool removable;

  GardenKind get kindInfo => kindOf(kind);

  factory GardenNote.fromJson(Map<String, dynamic> json) {
    final from = json['from'] as Map<String, dynamic>? ?? const {};
    final to = json['to'] as Map<String, dynamic>? ?? const {};
    return GardenNote(
      id: json['id'] as String? ?? '',
      kind: json['kind'] as String? ?? 'daisy',
      note: json['note'] as String? ?? '',
      fromUserId: from['userId'] as String? ?? '',
      fromName: from['name'] as String? ?? 'Someone',
      fromPhotoUrl: from['photoUrl'] as String?,
      toUserId: to['userId'] as String? ?? '',
      toName: to['name'] as String? ?? 'Someone',
      toPhotoUrl: to['photoUrl'] as String?,
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
      removable: json['removable'] == true,
    );
  }
}

class TreeView {
  const TreeView({required this.person, required this.notes});

  final GardenPerson person;
  final List<GardenNote> notes;

  factory TreeView.fromJson(Map<String, dynamic> json) => TreeView(
    person: GardenPerson.fromJson(json['person'] as Map<String, dynamic>? ?? const {}),
    notes: [
      for (final row in (json['notes'] as List<dynamic>? ?? const []))
        GardenNote.fromJson(row as Map<String, dynamic>),
    ],
  );
}
