/// Talk: counsellors, when they are free, and the sessions someone has booked.
///
/// Everything here is what the server sends, parsed once. Times are instants;
/// the screens show them in the phone's own zone.
class Counsellor {
  const Counsellor({
    required this.userId,
    required this.name,
    required this.headline,
    required this.slotMinutes,
    this.photoUrl,
    this.about = '',
    this.yearsExperience,
    this.languages = const [],
    this.focusLabels = const [],
    this.ageRange = '',
    this.gender = '',
  });

  final String userId;
  final String name;
  final String headline;
  final int slotMinutes;
  final String? photoUrl;

  /// The Help profile: a paragraph on their approach, and the facts.
  final String about;
  final int? yearsExperience;
  final List<String> languages;
  final List<String> focusLabels;
  final String ageRange;
  final String gender;

  String get initial => name.isEmpty ? '?' : name[0].toUpperCase();
  String get firstName => name.trim().split(' ').first;

  /// 'Counsellor · 8 years of experience'
  String get experienceLine =>
      yearsExperience == null ? 'Counsellor' : 'Counsellor · $yearsExperience years of experience';

  factory Counsellor.fromJson(Map<String, dynamic> json) => Counsellor(
    userId: json['userId'] as String? ?? '',
    name: json['name'] as String? ?? 'Counsellor',
    headline: json['headline'] as String? ?? '',
    slotMinutes: (json['slotMinutes'] as num?)?.toInt() ?? 50,
    photoUrl: json['photoUrl'] as String?,
    about: json['about'] as String? ?? '',
    yearsExperience: (json['yearsExperience'] as num?)?.toInt(),
    languages: [for (final l in (json['languages'] as List<dynamic>? ?? const [])) '$l'],
    focusLabels: [for (final l in (json['focusLabels'] as List<dynamic>? ?? const [])) '$l'],
    ageRange: json['ageRange'] as String? ?? '',
    gender: json['gender'] as String? ?? '',
  );
}

/// One bookable start on one day, and who is free then.
class TalkSlot {
  const TalkSlot({
    required this.startsAt,
    required this.endsAt,
    required this.label,
    required this.counsellorIds,
  });

  final DateTime startsAt;
  final DateTime endsAt;

  /// 'HH:mm' in the counsellor's own zone, as the server labels it.
  final String label;
  final List<String> counsellorIds;

  factory TalkSlot.fromJson(Map<String, dynamic> json) => TalkSlot(
    startsAt: DateTime.parse(json['startsAt'] as String),
    endsAt: DateTime.parse(json['endsAt'] as String),
    label: json['label'] as String? ?? '',
    counsellorIds: [
      for (final id in (json['counsellorIds'] as List<dynamic>? ?? const []))
        '$id',
    ],
  );
}

enum TalkSessionStatus { booked, completed, cancelled }

class TalkSession {
  const TalkSession({
    required this.id,
    required this.counsellorId,
    required this.counsellorName,
    required this.counsellorHeadline,
    required this.startsAt,
    required this.endsAt,
    required this.status,
    this.counsellorPhotoUrl,
    this.joinUrl,
    this.placeholderLink = false,
    this.checkIn,
    this.review,
    this.counsellorYears,
    this.counsellorLanguages = const [],
    this.counsellorFocusLabels = const [],
  });

  /// The rest of the counsellor, so a session can show the same card the
  /// list does.
  final int? counsellorYears;
  final List<String> counsellorLanguages;
  final List<String> counsellorFocusLabels;

  /// The counsellor as the list and the profile know them.
  Counsellor get counsellor => Counsellor(
    userId: counsellorId,
    name: counsellorName,
    headline: counsellorHeadline,
    slotMinutes: endsAt.difference(startsAt).inMinutes,
    photoUrl: counsellorPhotoUrl,
    yearsExperience: counsellorYears,
    languages: counsellorLanguages,
    focusLabels: counsellorFocusLabels,
  );

  final String id;
  final String counsellorId;
  final String counsellorName;
  final String counsellorHeadline;
  final String? counsellorPhotoUrl;
  final DateTime startsAt;
  final DateTime endsAt;
  final TalkSessionStatus status;
  final String? joinUrl;

  /// The link is a stand-in from a server with no Zoom credentials.
  final bool placeholderLink;

  /// How they said they felt just before joining, once they have.
  final SessionCheckIn? checkIn;

  /// What they made of it afterwards, once they have said.
  final SessionReview? review;

  TalkSession withCheckIn(SessionCheckIn? value) => TalkSession(
    id: id,
    counsellorId: counsellorId,
    counsellorName: counsellorName,
    counsellorHeadline: counsellorHeadline,
    startsAt: startsAt,
    endsAt: endsAt,
    status: status,
    counsellorPhotoUrl: counsellorPhotoUrl,
    joinUrl: joinUrl,
    placeholderLink: placeholderLink,
    checkIn: value,
    review: review,
    counsellorYears: counsellorYears,
    counsellorLanguages: counsellorLanguages,
    counsellorFocusLabels: counsellorFocusLabels,
  );

  String get counsellorInitial =>
      counsellorName.isEmpty ? '?' : counsellorName[0].toUpperCase();

  factory TalkSession.fromJson(Map<String, dynamic> json) {
    final counsellor =
        json['counsellor'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    return TalkSession(
      id: json['id'] as String? ?? '',
      counsellorId: counsellor['userId'] as String? ?? '',
      counsellorName: counsellor['name'] as String? ?? 'Counsellor',
      counsellorHeadline: counsellor['headline'] as String? ?? '',
      counsellorPhotoUrl: counsellor['photoUrl'] as String?,
      startsAt: DateTime.parse(json['startsAt'] as String),
      endsAt: DateTime.parse(json['endsAt'] as String),
      status: switch (json['status']) {
        'completed' => TalkSessionStatus.completed,
        'cancelled' => TalkSessionStatus.cancelled,
        _ => TalkSessionStatus.booked,
      },
      joinUrl: json['joinUrl'] as String?,
      placeholderLink: json['placeholderLink'] == true,
      checkIn: json['checkIn'] is Map<String, dynamic>
          ? SessionCheckIn.fromJson(json['checkIn'] as Map<String, dynamic>)
          : null,
      review: json['review'] is Map<String, dynamic>
          ? SessionReview.fromJson(json['review'] as Map<String, dynamic>)
          : null,
      counsellorYears: (counsellor['yearsExperience'] as num?)?.toInt(),
      counsellorLanguages: [
        for (final l in (counsellor['languages'] as List<dynamic>? ?? const [])) '$l',
      ],
      counsellorFocusLabels: [
        for (final l in (counsellor['focusLabels'] as List<dynamic>? ?? const [])) '$l',
      ],
    );
  }
}

/// The five answers to "how are you feeling?", asked just before joining.
class SessionFeeling {
  const SessionFeeling(this.key, this.label, this.face);

  final String key;
  final String label;
  final String face;
}

const sessionFeelings = [
  SessionFeeling('low', 'Low', '😔'),
  SessionFeeling('anxious', 'Anxious', '😟'),
  SessionFeeling('okay', 'Okay', '😐'),
  SessionFeeling('hopeful', 'Hopeful', '🙂'),
  SessionFeeling('good', 'Good', '😊'),
];

SessionFeeling feelingOf(String key) =>
    sessionFeelings.firstWhere((f) => f.key == key, orElse: () => sessionFeelings[2]);

class SessionCheckIn {
  const SessionCheckIn({required this.feeling, this.note = ''});

  final String feeling;
  final String note;

  factory SessionCheckIn.fromJson(Map<String, dynamic> json) => SessionCheckIn(
    feeling: json['feeling'] as String? ?? 'okay',
    note: json['note'] as String? ?? '',
  );
}

/// What someone made of a session afterwards: one to five, and words if
/// they had any.
class SessionReview {
  const SessionReview({required this.rating, this.note = ''});

  final int rating;
  final String note;

  /// What each rating says, in the order the stars are tapped.
  static const labels = [
    'Not for me',
    'Could be better',
    'Okay',
    'Really good',
    'Exactly what I needed',
  ];

  String get label => rating >= 1 && rating <= 5 ? labels[rating - 1] : '';

  factory SessionReview.fromJson(Map<String, dynamic> json) => SessionReview(
    rating: (json['rating'] as num?)?.toInt() ?? 0,
    note: json['note'] as String? ?? '',
  );
}

class TalkSessions {
  const TalkSessions({required this.upcoming, required this.past});

  final List<TalkSession> upcoming;
  final List<TalkSession> past;

  static const empty = TalkSessions(upcoming: [], past: []);

  factory TalkSessions.fromJson(Map<String, dynamic> json) => TalkSessions(
    upcoming: [
      for (final row in (json['upcoming'] as List<dynamic>? ?? const []))
        TalkSession.fromJson(row as Map<String, dynamic>),
    ],
    past: [
      for (final row in (json['past'] as List<dynamic>? ?? const []))
        TalkSession.fromJson(row as Map<String, dynamic>),
    ],
  );
}
