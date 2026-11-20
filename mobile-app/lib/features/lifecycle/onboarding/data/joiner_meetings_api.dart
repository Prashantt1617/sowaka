import 'onboarding_api.dart';

/// Someone in the joiner's department (Meetings › Your team).
class TeamPerson {
  const TeamPerson({required this.userId, required this.name, this.designation, this.photoUrl, this.tag});

  factory TeamPerson.fromJson(Map<String, dynamic> json) => TeamPerson(
    userId: json['userId'] is String ? json['userId'] as String : '',
    name: json['name'] is String ? json['name'] as String : '',
    designation: json['designation'] is String ? json['designation'] as String : null,
    photoUrl: json['photoUrl'] is String ? json['photoUrl'] as String : null,
    tag: json['tag'] is String ? json['tag'] as String : null,
  );

  final String userId;
  final String name;
  final String? designation;
  final String? photoUrl;

  /// 'manager' | 'buddy' | null.
  final String? tag;
}

/// The joiner's department as the company records it, and everyone in it but them.
class JoinerTeam {
  const JoinerTeam({required this.department, required this.people});

  factory JoinerTeam.fromJson(Map<String, dynamic> json) => JoinerTeam(
    department: json['department'] is String ? json['department'] as String : '',
    people: [
      if (json['people'] is List)
        for (final p in json['people'] as List)
          if (p is Map) TeamPerson.fromJson(Map<String, dynamic>.from(p)),
    ],
  );

  final String department;
  final List<TeamPerson> people;
}

/// The joiner's Meetings writes and Your team (backend joinerMeetings.ts):
/// Mark as met on any meeting row, their own agenda notes, the department.
/// Its own source so the screens' tests hand in a fake.
abstract class JoinerMeetingsSource {
  /// Marks the row met on the record the other side reads.
  Future<void> markMet(String rowId);

  /// The joiner's own notes on the row, one per agenda point.
  Future<void> saveNotes(String rowId, List<String> notes);

  Future<JoinerTeam> fetchTeam();

  /// The last [fetchTeam] answer kept on the device, to paint at once.
  Future<JoinerTeam?> keptTeam();
}

class HttpJoinerMeetingsSource implements JoinerMeetingsSource {
  HttpJoinerMeetingsSource(this.api);

  final HttpOnboardingApi api;

  String _row(String rowId) => '/lifecycle/onboarding/meeting-rows/${Uri.encodeComponent(rowId)}';

  @override
  Future<void> markMet(String rowId) async {
    await api.request('POST', _row(rowId), body: {'action': 'met'});
  }

  @override
  Future<void> saveNotes(String rowId, List<String> notes) async {
    await api.request('PUT', '${_row(rowId)}/notes', body: {'notes': notes});
  }

  @override
  Future<JoinerTeam> fetchTeam() async => JoinerTeam.fromJson(await api.request('GET', '/lifecycle/onboarding/team'));

  @override
  Future<JoinerTeam?> keptTeam() => api.fromDevice((_) => fetchTeam());
}

/// The source for the signed-in app; null under a test's fake API.
JoinerMeetingsSource? joinerMeetingsSourceFor(OnboardingApi api) => api is HttpOnboardingApi ? HttpJoinerMeetingsSource(api) : null;
