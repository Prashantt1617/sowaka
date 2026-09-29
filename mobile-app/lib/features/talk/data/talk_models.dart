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
  });

  final String userId;
  final String name;
  final String headline;
  final int slotMinutes;
  final String? photoUrl;

  String get initial => name.isEmpty ? '?' : name[0].toUpperCase();

  factory Counsellor.fromJson(Map<String, dynamic> json) => Counsellor(
    userId: json['userId'] as String? ?? '',
    name: json['name'] as String? ?? 'Counsellor',
    headline: json['headline'] as String? ?? '',
    slotMinutes: (json['slotMinutes'] as num?)?.toInt() ?? 50,
    photoUrl: json['photoUrl'] as String?,
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
  });

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
    );
  }
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
