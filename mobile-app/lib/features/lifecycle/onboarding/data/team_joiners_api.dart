import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../../services/api_client.dart';
import '../../../../services/api_config.dart';
import '../../../auth/data/auth_models.dart';
import 'onboarding_api.dart';
import 'onboarding_models.dart' show PlantState;

/// Teams › Joiners for the manager, the buddy and the head of department
/// (backend services/lifecycle/teamTasks.ts, routes `/lifecycle/team/…`):
/// how I'm connected to a joiner, their page, my full task list for them,
/// and the confirmation approval.

/// How the viewer is connected to the joiner.
enum TeamRelation {
  report,
  buddy,
  line;

  static TeamRelation parse(Object? value) => switch (value) {
    'buddy' => TeamRelation.buddy,
    'line' => TeamRelation.line,
    _ => TeamRelation.report,
  };
}

/// A task's look (the artifact's icon and tint per kind).
enum TeamKind { help, approve, review, task, meet, team, goal, doc, chat }

TeamKind _kind(Object? value) => TeamKind.values.firstWhere((k) => k.name == value, orElse: () => TeamKind.task);

/// A review's or an approval's state.
enum TeamReviewState { waiting, ready, reviewed, back }

TeamReviewState? _review(Object? value) {
  for (final s in TeamReviewState.values) {
    if (s.name == value) return s;
  }
  return null;
}

String? _str(Object? v) => v is String && v.isNotEmpty ? v : null;
int _int(Object? v) => v is num ? v.toInt() : 0;

class TeamJoinerRow {
  const TeamJoinerRow({
    required this.journeyId,
    required this.name,
    required this.relation,
    required this.step,
    required this.stepLabel,
    required this.plant,
    this.userId,
    this.designation,
    this.photoUrl,
    this.managerName,
    this.approverName,
    this.approverIsYou = false,
    this.toDo = 0,
    this.preboarding = false,
  });

  factory TeamJoinerRow.fromJson(Map<String, dynamic> json) => TeamJoinerRow(
    journeyId: '${json['journeyId'] ?? ''}',
    userId: _str(json['userId']),
    approverName: _str(json['approverName']),
    approverIsYou: json['approverIsYou'] == true,
    name: _str(json['name']) ?? '—',
    designation: _str(json['designation']),
    photoUrl: _str(json['photoUrl']),
    relation: TeamRelation.parse(json['relation']),
    managerName: _str(json['managerName']),
    step: _int(json['step']),
    stepLabel: _str(json['stepLabel']) ?? '',
    plant: PlantState.fromJson(json['plant']),
    toDo: _int(json['toDo']),
    preboarding: json['preboarding'] == true,
  );

  final String journeyId;

  /// The joiner's account (absent before they join), for their profile.
  final String? userId;
  final String name;
  final String? designation;
  final String? photoUrl;
  final TeamRelation relation;
  final String? managerName;

  /// Who approves their confirmation (the head of department); [approverIsYou] when it is the viewer.
  final String? approverName;
  final bool approverIsYou;
  final int step;
  final String stepLabel;
  final PlantState plant;
  final int toDo;
  final bool preboarding;

  /// The list's third line: "You’re the buddy", "Reports to Sunny Kapoor", or none for a report.
  String? get relationLine => switch (relation) {
    TeamRelation.buddy => 'You’re the buddy',
    TeamRelation.line => managerName == null || managerName!.isEmpty ? null : 'Reports to $managerName',
    TeamRelation.report => null,
  };
}

class TeamTask {
  const TeamTask({
    required this.id,
    required this.title,
    required this.kind,
    required this.step,
    required this.done,
    this.early = false,
    this.pair,
    this.note,
    this.canTick = false,
    this.opens,
    this.reviewState,
    this.agenda = const [],
    this.fromJourney = false,
    this.doneByName,
    this.recommended,
    this.recommendedNote,
  });

  factory TeamTask.fromJson(Map<String, dynamic> json) => TeamTask(
    id: '${json['id'] ?? ''}',
    title: _str(json['title']) ?? '',
    kind: _kind(json['kind']),
    step: _int(json['step']),
    early: json['early'] == true,
    done: json['done'] == true,
    pair: _str(json['pair']),
    note: _str(json['note']),
    canTick: json['canTick'] == true,
    opens: _str(json['opens']),
    reviewState: _review(json['reviewState']),
    agenda: (json['agenda'] as List?)?.whereType<String>().toList() ?? const [],
    fromJourney: json['source'] == 'journey',
    doneByName: _str(json['doneByName']),
    recommended: _str((json['recommended'] as Map?)?['outcome']),
    recommendedNote: _str((json['recommended'] as Map?)?['note']),
  );

  final String id;
  final String title;
  final TeamKind kind;
  final int step;
  final bool early;
  final bool done;
  final String? pair;
  final String? note;
  final bool canTick;

  /// 'meeting', 'approval' or 'recommend' (the manager's confirm/extend): the row opens a screen.
  final String? opens;
  final TeamReviewState? reviewState;
  final List<String> agenda;
  final bool fromJourney;
  final String? doneByName;

  /// `mgr_recommend` only: 'confirm' or 'extend' once the manager has recommended, and their note.
  final String? recommended;
  final String? recommendedNote;

  bool get isApproval => kind == TeamKind.approve;

  TeamTask copyWith({bool? done}) => TeamTask(
    id: id, title: title, kind: kind, step: step, early: early, done: done ?? this.done, pair: pair, note: note,
    canTick: canTick, opens: opens, reviewState: reviewState, agenda: agenda, fromJourney: fromJourney, doneByName: doneByName,
    recommended: recommended, recommendedNote: recommendedNote,
  );
}

class TeamJoinerPage {
  const TeamJoinerPage({
    required this.journeyId,
    required this.name,
    required this.first,
    required this.relation,
    required this.steps,
    required this.step,
    required this.tasks,
    required this.status,
    this.userId,
    this.designation,
    this.department,
    this.photoUrl,
    this.managerName,
    this.buddyName,
    this.approverName,
    this.approverIsYou = false,
    this.readOnly = false,
    this.plant = const PlantState(),
    this.delayed = 0,
    this.canBrowseSteps = true,
    this.preboarding = false,
  });

  factory TeamJoinerPage.fromJson(Map<String, dynamic> json) {
    final j = (json['joiner'] as Map?)?.cast<String, dynamic>() ?? const {};
    return TeamJoinerPage(
      journeyId: '${j['journeyId'] ?? ''}',
      userId: _str(j['userId']),
      approverName: _str(json['approverName']),
      approverIsYou: json['approverIsYou'] == true,
      readOnly: json['readOnly'] == true,
      name: _str(j['name']) ?? '—',
      first: _str(j['first']) ?? '',
      designation: _str(j['designation']),
      department: _str(j['department']),
      photoUrl: _str(j['photoUrl']),
      managerName: _str(j['managerName']),
      buddyName: _str(j['buddyName']),
      plant: PlantState.fromJson(j['plant']),
      status: _str(j['status']) ?? 'On track',
      delayed: _int(j['delayed']),
      preboarding: j['preboarding'] == true,
      relation: TeamRelation.parse(json['relation']),
      steps: (json['steps'] as List?)?.whereType<String>().toList() ?? const [],
      step: _int(json['step']),
      canBrowseSteps: json['canBrowseSteps'] != false,
      tasks: ((json['tasks'] as List?) ?? const [])
          .whereType<Map>()
          .map((t) => TeamTask.fromJson(t.cast<String, dynamic>()))
          .toList(),
    );
  }

  final String journeyId;

  /// The joiner's account (absent before they join), for their profile.
  final String? userId;
  final String name;
  final String first;

  /// Who approves their confirmation (the head of department); [approverIsYou] when it is the viewer.
  final String? approverName;
  final bool approverIsYou;

  /// Up the reporting line but not the head of department: following along, no tasks.
  final bool readOnly;
  final String? designation;
  final String? department;
  final String? photoUrl;
  final String? managerName;
  final String? buddyName;
  final PlantState plant;
  final String status;
  final int delayed;
  final bool preboarding;
  final TeamRelation relation;
  final List<String> steps;
  final int step;
  final bool canBrowseSteps;
  final List<TeamTask> tasks;

  String get stepLabel => step >= 0 && step < steps.length ? steps[step] : '';

  /// The main card's title: "Help Priya with" for a buddy, "Your tasks for Priya" otherwise.
  String get tasksTitle => relation == TeamRelation.buddy ? 'Help $first with' : 'Your tasks for $first';

  String get reportsLine => relation == TeamRelation.report
      ? 'Reports to you'
      : (managerName == null || managerName!.isEmpty ? '' : 'Reports to $managerName');

  String get buddyLine => relation == TeamRelation.buddy
      ? 'You’re the buddy'
      : (buddyName == null || buddyName!.isEmpty ? 'No buddy yet' : 'Buddy: $buddyName');

  /// What is still to do now (the red count).
  List<TeamTask> get openNow => tasks
      .where((t) => t.step == step && !t.done && (t.canTick || t.opens == 'meeting' || t.opens == 'recommend' || t.reviewState == TeamReviewState.ready))
      .toList();
}

class TeamApprovalFact {
  const TeamApprovalFact(this.label, this.value, this.ok);
  final String label;
  final String value;
  final bool ok;
}

class TeamApproval {
  const TeamApproval({
    required this.state,
    required this.managerName,
    this.recommendedBy,
    this.outcome,
    this.note,
    this.recommendedAt,
    this.facts = const [],
    this.answerNote,
  });

  factory TeamApproval.fromJson(Map<String, dynamic> json) {
    final rec = (json['recommendation'] as Map?)?.cast<String, dynamic>();
    final answer = (json['answer'] as Map?)?.cast<String, dynamic>();
    return TeamApproval(
      state: _review(json['state']) ?? TeamReviewState.waiting,
      managerName: _str(json['managerName']) ?? '',
      recommendedBy: _str(rec?['byName']),
      outcome: _str(rec?['outcome']),
      note: _str(rec?['note']),
      recommendedAt: DateTime.tryParse('${rec?['at'] ?? ''}')?.toLocal(),
      answerNote: _str(answer?['note']),
      facts: ((json['facts'] as List?) ?? const [])
          .whereType<Map>()
          .map((f) => TeamApprovalFact('${f['label'] ?? ''}', '${f['value'] ?? ''}', f['ok'] == true))
          .toList(),
    );
  }

  final TeamReviewState state;
  final String managerName;
  final String? recommendedBy;

  /// 'confirm' or 'extend'.
  final String? outcome;
  final String? note;
  final DateTime? recommendedAt;
  final List<TeamApprovalFact> facts;
  final String? answerNote;
}

/// The team side's calls. The screens only talk to this, so tests hand them a fake.
abstract class TeamJoinersApi {
  Future<List<TeamJoinerRow>> fetchJoiners();
  Future<TeamJoinerPage> fetchJoiner(String journeyId);

  /// `done` or `undo`; the page as it is after.
  Future<TeamJoinerPage> taskAction(String journeyId, String taskId, String action);
  Future<TeamApproval> fetchApproval(String journeyId);

  /// `approve` or `discuss`.
  Future<TeamApproval> answerApproval(String journeyId, String action, {String? comment});

  /// The manager's recommendation on `mgr_recommend`: `confirm` or `extend`, with an optional note.
  Future<TeamJoinerPage> recommend(String journeyId, String outcome, {String? note}) =>
      throw UnimplementedError('recommend');
}

class HttpTeamJoinersApi implements TeamJoinersApi {
  HttpTeamJoinersApi({required this.session, String? baseUrl, http.Client? client})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
      _client = client ?? ApiClient.shared;

  /// The signed-in shell's API, when it talks to the server.
  static TeamJoinersApi? from(OnboardingApi api) => api is HttpOnboardingApi ? HttpTeamJoinersApi(session: api.session) : null;

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;

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
  Future<List<TeamJoinerRow>> fetchJoiners() async {
    final json = await _json('GET', '/lifecycle/team/joiners');
    return ((json['joiners'] as List?) ?? const [])
        .whereType<Map>()
        .map((r) => TeamJoinerRow.fromJson(r.cast<String, dynamic>()))
        .toList();
  }

  @override
  Future<TeamJoinerPage> fetchJoiner(String journeyId) async =>
      TeamJoinerPage.fromJson(await _json('GET', '/lifecycle/team/joiners/${Uri.encodeComponent(journeyId)}'));

  @override
  Future<TeamJoinerPage> taskAction(String journeyId, String taskId, String action) async => TeamJoinerPage.fromJson(
    await _json(
      'POST',
      '/lifecycle/team/joiners/${Uri.encodeComponent(journeyId)}/tasks/${Uri.encodeComponent(taskId)}',
      body: {'action': action},
    ),
  );

  @override
  Future<TeamJoinerPage> recommend(String journeyId, String outcome, {String? note}) async => TeamJoinerPage.fromJson(
    await _json(
      'POST',
      '/lifecycle/team/joiners/${Uri.encodeComponent(journeyId)}/tasks/mgr_recommend',
      body: {'action': 'recommend', 'outcome': outcome, if (note != null && note.trim().isNotEmpty) 'note': note.trim()},
    ),
  );

  @override
  Future<TeamApproval> fetchApproval(String journeyId) async =>
      TeamApproval.fromJson(await _json('GET', '/lifecycle/team/joiners/${Uri.encodeComponent(journeyId)}/approval'));

  @override
  Future<TeamApproval> answerApproval(String journeyId, String action, {String? comment}) async => TeamApproval.fromJson(
    await _json(
      'POST',
      '/lifecycle/team/joiners/${Uri.encodeComponent(journeyId)}/approval',
      body: {'action': action, if (comment != null && comment.trim().isNotEmpty) 'comment': comment.trim()},
    ),
  );
}
