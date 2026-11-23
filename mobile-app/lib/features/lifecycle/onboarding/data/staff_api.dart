import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../../services/api_client.dart';
import '../../../../services/api_config.dart';
import '../../../auth/data/auth_models.dart';
import 'onboarding_api.dart';
import 'onboarding_models.dart' show PlantState;

/// HR and IT & admin in the app (Onboarding · Final designs, canvas page 4;
/// docs/lifecycle/FINAL-DESIGNS.md §4.4, routes `/lifecycle/staff/…`):
/// Actions › Onboarding's four cards, a person's page with that role's tasks
/// and her whole onboarding, the full profile, and each task's screen. Every
/// count, pill, due text and percentage comes from the server; the screens
/// only lay them out.

String? _str(Object? v) => v is String && v.isNotEmpty ? v : null;
int _int(Object? v) => v is num ? v.toInt() : 0;
Map<String, dynamic> _map(Object? v) => v is Map ? v.cast<String, dynamic>() : const {};
List<Map<String, dynamic>> _maps(Object? v) => v is List ? v.whereType<Map>().map((m) => m.cast<String, dynamic>()).toList() : const [];
List<String> _strings(Object? v) => v is List ? v.map((x) => x is String ? x : '').toList() : const [];

/// Who the screens are for: HR or IT & admin.
enum StaffRole {
  hr,
  it;

  static StaffRole parse(Object? v) => v == 'it' ? StaffRole.it : StaffRole.hr;

  /// "Viewing as HR" / "Viewing as IT & admin".
  String get label => this == StaffRole.it ? 'IT & admin' : 'HR';
}

/// A pill's words and tone, as the server sends them.
class StaffPill {
  const StaffPill(this.text, this.tone);

  static StaffPill? maybe(Object? json) {
    final map = _map(json);
    final text = _str(map['text']);
    return text == null ? null : StaffPill(text, _str(map['tone']) ?? 'grey');
  }

  final String text;

  /// green | red | amber | grey | blue (rows) ; ok | warn | todo | soon (lists).
  final String tone;
}

/// `/lifecycle/me` · `staff`: the Actions tile for HR or IT & admin.
class StaffTile {
  const StaffTile({required this.role, required this.open, required this.late, required this.dueToday, this.pill});

  static StaffTile? maybe(Object? json) {
    final map = _map(json);
    if (map.isEmpty) return null;
    return StaffTile(role: StaffRole.parse(map['role']), open: _int(map['open']), late: _int(map['late']), dueToday: _int(map['dueToday']), pill: _str(map['pill']));
  }

  final StaffRole role;
  final int open;
  final int late;
  final int dueToday;

  /// "3 late" | "2 due today" | "4 to do"; absent when all is done.
  final String? pill;
}

/// One person on a card or in "View all employees".
class StaffPerson {
  const StaffPerson({required this.journeyId, required this.name, required this.initials, required this.stepLabel, required this.pill, this.photoUrl});

  factory StaffPerson.fromJson(Map<String, dynamic> json) => StaffPerson(
    journeyId: '${json['journeyId'] ?? ''}',
    name: _str(json['name']) ?? '—',
    initials: _str(json['initials']) ?? '',
    photoUrl: _str(json['photoUrl']),
    stepLabel: _str(json['stepLabel']) ?? '',
    pill: StaffPill.maybe(json['pill']) ?? const StaffPill('All done', 'green'),
  );

  final String journeyId;
  final String name;
  final String initials;
  final String? photoUrl;
  final String stepLabel;
  final StaffPill pill;
}

/// Joining soon / Week 1 / Month 1 / Probation.
class StaffCard {
  const StaffCard({required this.key, required this.title, required this.count, required this.late, required this.people});

  factory StaffCard.fromJson(Map<String, dynamic> json) => StaffCard(
    key: _str(json['key']) ?? '',
    title: _str(json['title']) ?? '',
    count: _int(json['count']),
    late: _int(json['late']),
    people: _maps(json['people']).map(StaffPerson.fromJson).toList(),
  );

  final String key;
  final String title;
  final int count;
  final int late;
  final List<StaffPerson> people;
}

/// GET /lifecycle/staff/onboarding
class StaffOnboarding {
  const StaffOnboarding({required this.viewingAs, required this.canSwitch, required this.cards, required this.everyone});

  factory StaffOnboarding.fromJson(Map<String, dynamic> json) => StaffOnboarding(
    viewingAs: StaffRole.parse(json['viewingAs']),
    canSwitch: json['canSwitch'] == true,
    cards: _maps(json['cards']).map(StaffCard.fromJson).toList(),
    everyone: _maps(json['everyone']).map(StaffPerson.fromJson).toList(),
  );

  final StaffRole viewingAs;
  final bool canSwitch;
  final List<StaffCard> cards;
  final List<StaffPerson> everyone;
}

/// The person page's hero (the team page's `joiner`).
class StaffJoiner {
  const StaffJoiner({
    required this.journeyId,
    required this.name,
    required this.first,
    required this.stepLabel,
    required this.plantStage,
    required this.reportsTo,
    required this.statusLabel,
    this.statusWarn = false,
    this.userId,
    this.photoUrl,
    this.designation,
    this.department,
    this.buddy,
  });

  factory StaffJoiner.fromJson(Map<String, dynamic> json) {
    final status = _map(json['status']);
    final name = _str(json['name']) ?? '—';
    return StaffJoiner(
      journeyId: '${json['journeyId'] ?? ''}',
      userId: _str(json['userId']),
      name: name,
      first: _str(json['first']) ?? name.split(' ').first,
      photoUrl: _str(json['photoUrl']),
      designation: _str(json['designation']),
      department: _str(json['department']),
      reportsTo: _str(json['reportsTo']) ?? '',
      buddy: _str(json['buddy']),
      stepLabel: _str(json['stepLabel']) ?? '',
      plantStage: _int(json['plantStage']),
      statusLabel: _str(status['label']) ?? '',
      statusWarn: status['warn'] == true,
    );
  }

  final String journeyId;
  final String? userId;
  final String name;
  final String first;
  final String? photoUrl;
  final String? designation;
  final String? department;

  /// 'you' or the manager's name.
  final String reportsTo;

  /// 'you', the buddy's name, or none yet.
  final String? buddy;
  final String stepLabel;
  final int plantStage;
  final String statusLabel;
  final bool statusWarn;

  PlantState get plant => PlantState(stage: plantStage);
}

/// One of my rows for the joiner (a meeting or an HR / IT task).
class StaffTaskRow {
  const StaffTaskRow({
    required this.id,
    required this.title,
    required this.kind,
    required this.step,
    required this.stepLabel,
    required this.done,
    required this.locked,
    this.early = false,
    this.pair,
    this.how,
    this.note,
    this.pill,
    this.due,
    this.opens,
    this.agenda = const [],
  });

  factory StaffTaskRow.fromJson(Map<String, dynamic> json) => StaffTaskRow(
    id: '${json['id'] ?? ''}',
    title: _str(json['title']) ?? '',
    kind: _str(json['kind']) ?? 'task',
    step: _int(json['step']),
    stepLabel: _str(json['stepLabel']) ?? '',
    early: json['early'] == true,
    done: json['done'] == true,
    locked: json['locked'] == true,
    pair: _str(json['pair']),
    how: _str(json['how']),
    note: _str(json['note']),
    pill: StaffPill.maybe(json['pill']),
    due: StaffPill.maybe(json['due']),
    opens: _str(json['opens']),
    agenda: _strings(json['agenda']),
  );

  final String id;
  final String title;

  /// help | approve | review | task | meet | team | goal | doc | chat (the row's icon).
  final String kind;
  final int step;
  final String stepLabel;
  final bool early;
  final bool done;
  final bool locked;
  final String? pair;
  final String? how;
  final String? note;

  /// A stage pill ("Month 6") on a row that opens later.
  final StaffPill? pill;

  /// "2 days late" (red), "Due today" (amber), "Due Thu" (grey).
  final StaffPill? due;

  /// meeting | kit | handover | payroll | form | letter | accesses | plain.
  final String? opens;
  final List<String> agenda;

  bool get isMeeting => kind == 'meet' || opens == 'meeting';

  /// What the row's pill says: when it is due, else the stage it opens in.
  StaffPill? get shownPill => locked || done ? null : (due ?? pill);
}

/// A row on "Priya’s onboarding": Profile, Meetings, Tasks, Check-ins, Sowaka tour, Watch list, Devices and accesses.
class StaffStat {
  const StaffStat({required this.key, required this.title, required this.done, required this.total, required this.unit, required this.flag});

  factory StaffStat.fromJson(Map<String, dynamic> json) => StaffStat(
    key: _str(json['key']) ?? '',
    title: _str(json['title']) ?? '',
    done: _int(json['done']),
    total: _int(json['total']),
    unit: _str(json['unit']) ?? '',
    flag: StaffPill.maybe(json['flag']) ?? const StaffPill('', 'todo'),
  );

  final String key;
  final String title;
  final int done;
  final int total;
  final String unit;
  final StaffPill flag;

  /// "86%" for the profile, "2/4" for the rest.
  String get value => key == 'prof' ? '$done%' : '$done/$total';
  double get fraction => total <= 0 ? 0 : done / total;
}

/// A row in one of those lists.
class StaffListRow {
  const StaffListRow({required this.title, required this.status, required this.tone, this.meta, this.comingUp = false});

  factory StaffListRow.fromJson(Map<String, dynamic> json) => StaffListRow(
    title: _str(json['title']) ?? '',
    meta: _str(json['meta']),
    status: _str(json['status']) ?? '',
    tone: _str(json['tone']) ?? 'todo',
    comingUp: json['comingUp'] == true,
  );

  final String title;
  final String? meta;
  final String status;

  /// ok | todo | warn | soon
  final String tone;
  final bool comingUp;
}

/// GET /lifecycle/staff/joiners/:journeyId
class StaffJoinerPage {
  const StaffJoinerPage({
    required this.joiner,
    required this.viewingAs,
    required this.step,
    required this.cardTitle,
    required this.toDo,
    required this.tasks,
    required this.status,
    required this.stats,
    required this.lists,
  });

  factory StaffJoinerPage.fromJson(Map<String, dynamic> json) {
    final card = _map(json['card']);
    final onboarding = _map(json['onboarding']);
    final lists = _map(json['lists']);
    return StaffJoinerPage(
      joiner: StaffJoiner.fromJson(_map(json['joiner'])),
      viewingAs: StaffRole.parse(json['viewingAs']),
      step: _int(json['step']),
      cardTitle: _str(card['title']) ?? '',
      toDo: _int(card['toDo']),
      tasks: _maps(json['tasks']).map(StaffTaskRow.fromJson).toList(),
      status: _str(onboarding['status']) ?? '',
      stats: _maps(onboarding['rows']).map(StaffStat.fromJson).toList(),
      lists: {for (final e in lists.entries) e.key: _maps(e.value).map(StaffListRow.fromJson).toList()},
    );
  }

  final StaffJoiner joiner;
  final StaffRole viewingAs;

  /// The joiner's step (the rows' `step` numbers).
  final int step;

  /// "Your tasks for Priya"
  final String cardTitle;
  final int toDo;
  final List<StaffTaskRow> tasks;
  final String status;
  final List<StaffStat> stats;
  final Map<String, List<StaffListRow>> lists;
}

class StaffProfileRow {
  const StaffProfileRow(this.label, this.value);

  final String label;

  /// Absent: "Not filled yet".
  final String? value;
}

class StaffSection {
  const StaffSection({required this.key, required this.title, required this.missing, required this.rows, this.meta});

  factory StaffSection.fromJson(Map<String, dynamic> json) => StaffSection(
    key: _str(json['key']) ?? '',
    title: _str(json['title']) ?? '',
    missing: _int(json['missing']),
    meta: _str(json['meta']),
    rows: _maps(json['rows']).map((r) => StaffProfileRow(_str(r['label']) ?? '', _str(r['value']))).toList(),
  );

  final String key;
  final String title;
  final int missing;
  final List<StaffProfileRow> rows;

  /// The tax section's "FY 2026–27".
  final String? meta;
}

/// GET /lifecycle/staff/joiners/:journeyId/profile
class StaffProfile {
  const StaffProfile({required this.name, required this.pct, required this.sections});

  factory StaffProfile.fromJson(Map<String, dynamic> json) => StaffProfile(
    name: _str(json['name']) ?? '—',
    pct: _int(json['pct']),
    sections: _maps(json['sections']).map(StaffSection.fromJson).toList(),
  );

  final String name;
  final int pct;
  final List<StaffSection> sections;
}

class StaffIdCard {
  const StaffIdCard({required this.company, required this.name, required this.photoUploaded, this.designation, this.department, this.employeeId, this.bloodGroup, this.emergencyContact});

  factory StaffIdCard.fromJson(Map<String, dynamic> json) => StaffIdCard(
    company: _str(json['company']) ?? '',
    name: _str(json['name']) ?? '—',
    designation: _str(json['designation']),
    department: _str(json['department']),
    employeeId: _str(json['employeeId']),
    bloodGroup: _str(json['bloodGroup']),
    emergencyContact: _str(json['emergencyContact']),
    photoUploaded: json['photo'] == 'uploaded',
  );

  final String company;
  final String name;
  final String? designation;
  final String? department;
  final String? employeeId;
  final String? bloodGroup;
  final String? emergencyContact;
  final bool photoUploaded;
}

class StaffAccess {
  const StaffAccess({required this.id, required this.title, required this.ready, required this.details});

  factory StaffAccess.fromJson(Map<String, dynamic> json) => StaffAccess(
    id: '${json['id'] ?? ''}',
    title: _str(json['title']) ?? '',
    ready: json['ready'] == true,
    details: _maps(json['details']).map((d) => (label: _str(d['label']) ?? '', value: _str(d['value']) ?? '')).toList(),
  );

  final String id;
  final String title;
  final bool ready;
  final List<({String label, String value})> details;
}

/// GET /lifecycle/staff/joiners/:journeyId/tasks/:key — what the task's screen needs.
class StaffTaskScreen {
  const StaffTaskScreen({
    required this.key,
    required this.done,
    this.checks = const {},
    this.possessive = 'their',
    this.idCard,
    this.accessCardNo,
    this.ticks,
    this.sections = const [],
    this.cheque,
    this.facts = const [],
    this.letterState,
    this.preview,
    this.accesses = const [],
    this.agenda = const [],
    this.notes = const [],
  });

  factory StaffTaskScreen.fromJson(Map<String, dynamic> json) {
    final meeting = _map(json['meeting']);
    final letter = _map(json['letter']);
    final preview = _map(json['preview']);
    final cheque = _map(json['cheque']);
    return StaffTaskScreen(
      key: _str(json['key']) ?? '',
      done: json['done'] == true,
      checks: {for (final e in _map(json['checks']).entries) e.key: '${e.value}'},
      possessive: _str(json['possessive']) ?? 'their',
      idCard: json['idCard'] is Map ? StaffIdCard.fromJson(_map(json['idCard'])) : null,
      accessCardNo: _str(json['accessCardNo']),
      ticks: json['ticks'] is List ? (json['ticks'] as List).whereType<num>().map((n) => n.toInt()).toList() : null,
      sections: _maps(json['sections']).map(StaffSection.fromJson).toList(),
      cheque: cheque.isEmpty ? null : cheque['uploaded'] == true,
      facts: _maps(json['facts']).map((f) => (label: _str(f['label']) ?? '', value: _str(f['value']) ?? '')).toList(),
      letterState: _str(letter['state']),
      preview: preview.isEmpty
          ? null
          : (head: _str(preview['head']) ?? '', title: _str(preview['title']) ?? '', paragraphs: _strings(preview['paragraphs'])),
      accesses: _maps(json['accesses']).map(StaffAccess.fromJson).toList(),
      agenda: _strings(meeting['agenda']),
      notes: _strings(meeting['notes']),
    );
  }

  final String key;
  final bool done;

  /// The kept "Looks right / Ask" and "Matches / Doesn’t match" answers.
  final Map<String, String> checks;

  /// her | his | their (from the profile's gender), for the screens' copy.
  final String possessive;
  final StaffIdCard? idCard;
  final String? accessCardNo;

  /// The kit checklist's ticked boxes (their positions), as they were left;
  /// null when it was never ticked.
  final List<int>? ticks;
  final List<StaffSection> sections;

  /// Null: the joiner's documents ask for no cancelled cheque; else whether it is uploaded.
  final bool? cheque;
  final List<({String label, String value})> facts;

  /// draft | ready | sent
  final String? letterState;
  final ({String head, String title, List<String> paragraphs})? preview;
  final List<StaffAccess> accesses;
  final List<String> agenda;
  final List<String> notes;
}

/// Everything the HR / IT screens read and write. The screens only talk to
/// this, so the tests hand them a fake.
abstract class StaffApi {
  Future<StaffOnboarding> fetchOnboarding({StaffRole? as});
  Future<StaffJoinerPage> fetchJoiner(String journeyId, {StaffRole? as});
  Future<StaffProfile> fetchProfile(String journeyId, {StaffRole? as});
  Future<StaffTaskScreen> fetchTask(String journeyId, String key, {StaffRole? as});

  /// Done / undo, with the screen's answers (checks, access card number, the
  /// checklist's ticks, accesses ready). No [action]: the answers are only kept.
  Future<StaffJoinerPage> taskAction(
    String journeyId,
    String key, {
    String? action,
    Map<String, String>? checks,
    String? accessCardNo,
    List<int>? ticks,
    Map<String, bool>? accesses,
    StaffRole? as,
  });

  /// My own notes on one of my meetings' agenda points.
  Future<void> saveNotes(String journeyId, String key, List<String> notes, {StaffRole? as});
}

class HttpStaffApi implements StaffApi {
  HttpStaffApi({required this.session, String? baseUrl, http.Client? client})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
      _client = client ?? ApiClient.shared;

  /// The signed-in shell's API, when it talks to the server.
  static StaffApi? from(OnboardingApi api) => api is HttpOnboardingApi ? HttpStaffApi(session: api.session) : null;

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;

  String _q(StaffRole? as) => as == null ? '' : '?as=${as.name}';
  String _j(String id) => Uri.encodeComponent(id);

  Future<Map<String, dynamic>> _json(String method, String path, {Map<String, dynamic>? body}) async {
    final request = http.Request(method, Uri.parse('$_baseUrl$path'))
      ..headers.addAll({'Authorization': 'Bearer ${session.token}', 'Content-Type': 'application/json'});
    if (body != null) request.body = jsonEncode(body);
    final http.Response response;
    try {
      response = await _client.send(request).then(http.Response.fromStream).timeout(HttpOnboardingApi.requestTimeout);
    } on TimeoutException {
      throw const OnboardingApiException(OnboardingApiException.tooSlow);
    } catch (_) {
      throw const OnboardingApiException(OnboardingApiException.offline);
    }
    Map<String, dynamic> json = const {};
    try {
      final decoded = response.body.isEmpty ? null : jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map<String, dynamic>) json = decoded;
    } catch (_) {}
    if (response.statusCode >= 400) {
      throw OnboardingApiException(_str(json['error']) ?? OnboardingApiException.failed, statusCode: response.statusCode);
    }
    return json;
  }

  @override
  Future<StaffOnboarding> fetchOnboarding({StaffRole? as}) async => StaffOnboarding.fromJson(await _json('GET', '/lifecycle/staff/onboarding${_q(as)}'));

  @override
  Future<StaffJoinerPage> fetchJoiner(String journeyId, {StaffRole? as}) async =>
      StaffJoinerPage.fromJson(await _json('GET', '/lifecycle/staff/joiners/${_j(journeyId)}${_q(as)}'));

  @override
  Future<StaffProfile> fetchProfile(String journeyId, {StaffRole? as}) async =>
      StaffProfile.fromJson(await _json('GET', '/lifecycle/staff/joiners/${_j(journeyId)}/profile${_q(as)}'));

  @override
  Future<StaffTaskScreen> fetchTask(String journeyId, String key, {StaffRole? as}) async =>
      StaffTaskScreen.fromJson(await _json('GET', '/lifecycle/staff/joiners/${_j(journeyId)}/tasks/${_j(key)}${_q(as)}'));

  @override
  Future<StaffJoinerPage> taskAction(
    String journeyId,
    String key, {
    String? action,
    Map<String, String>? checks,
    String? accessCardNo,
    List<int>? ticks,
    Map<String, bool>? accesses,
    StaffRole? as,
  }) async => StaffJoinerPage.fromJson(
    await _json('POST', '/lifecycle/staff/joiners/${_j(journeyId)}/tasks/${_j(key)}${_q(as)}', body: {
      'action': ?action,
      'checks': ?checks,
      'accessCardNo': ?accessCardNo,
      'ticks': ?ticks,
      'accesses': ?accesses,
    }),
  );

  @override
  Future<void> saveNotes(String journeyId, String key, List<String> notes, {StaffRole? as}) =>
      _json('PUT', '/lifecycle/staff/joiners/${_j(journeyId)}/tasks/${_j(key)}/notes${_q(as)}', body: {'notes': notes});
}
