import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../../services/api_client.dart';
import '../../../../services/api_config.dart';
import '../../../auth/data/auth_models.dart';
import 'onboarding_api.dart';

/// Teams › Joiners for the manager, the buddy and the head of department
/// (Onboarding · Final designs, docs/lifecycle/FINAL-DESIGNS.md §4.3; server
/// services/lifecycle/teamApp.ts, routes `/lifecycle/team/…`). Every name,
/// count, stage and status here is the server's: the screens never count or
/// fill them in.

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

String? _str(Object? v) => v is String && v.isNotEmpty ? v : null;
int _int(Object? v) => v is num ? v.toInt() : 0;
int? _intOrNull(Object? v) => v is num ? v.toInt() : null;
List<String> _strings(Object? v) => (v as List?)?.whereType<String>().toList() ?? const [];
List<Map<String, dynamic>> _maps(Object? v) => ((v as List?) ?? const []).whereType<Map>().map((m) => m.cast<String, dynamic>()).toList();
Map<String, dynamic> _map(Object? v) => (v as Map?)?.cast<String, dynamic>() ?? const {};

/// One row on Teams › Joiners (`TeamJoinerRow`).
class TeamJoinerRow {
  const TeamJoinerRow({
    required this.journeyId,
    required this.name,
    required this.initials,
    required this.relation,
    required this.step,
    required this.stepLabel,
    this.userId,
    this.designation,
    this.photoUrl,
    this.relationLine,
    this.plantStage = 0,
    this.preboarding = false,
    this.toDo = 0,
  });

  factory TeamJoinerRow.fromJson(Map<String, dynamic> json) => TeamJoinerRow(
    journeyId: '${json['journeyId'] ?? ''}',
    userId: _str(json['userId']),
    name: _str(json['name']) ?? '—',
    initials: _str(json['initials']) ?? '',
    designation: _str(json['designation']),
    photoUrl: _str(json['photoUrl']),
    relation: TeamRelation.parse(json['relation']),
    relationLine: _str(json['relationLine']),
    step: _int(json['step']),
    stepLabel: _str(json['stepLabel']) ?? '',
    plantStage: _int(json['plantStage']),
    preboarding: json['preboarding'] == true,
    toDo: _int(json['toDo']),
  );

  final String journeyId;
  final String? userId;
  final String name;
  final String initials;
  final String? designation;
  final String? photoUrl;
  final TeamRelation relation;

  /// "You’re the buddy", "Reports to Sunny Kapoor"; none for a direct report.
  final String? relationLine;

  /// 0 Before Day 1, 1 Day 1, 2 Week 1, 3 … Month n, then Confirmed.
  final int step;

  /// "Joins 1 Dec", "Day 1", "Week 1", "Month 1" … "Confirmed".
  final String stepLabel;
  final int plantStage;
  final bool preboarding;
  final int toDo;
}

/// A tone the server gives a pill.
enum TeamTone { blue, green, grey, amber, red, ok, todo, warn, soon }

TeamTone _tone(Object? v) => TeamTone.values.firstWhere((t) => t.name == v, orElse: () => TeamTone.grey);

/// A pill on a row ("Ready to read", "Waiting for Priya", "Week 1" …).
class TeamPillText {
  const TeamPillText(this.text, this.tone);
  final String text;
  final TeamTone tone;

  static TeamPillText? fromJson(Object? json) {
    final m = _map(json);
    final text = _str(m['text']);
    return text == null ? null : TeamPillText(text, _tone(m['tone']));
  }
}

/// One of my tasks for the joiner (`TeamTask`).
class TeamTask {
  const TeamTask({
    required this.id,
    required this.title,
    required this.kind,
    required this.step,
    required this.stepLabel,
    this.early = false,
    this.done = false,
    this.locked = false,
    this.pair,
    this.how,
    this.note,
    this.pill,
    this.opens,
    this.canTick = false,
    this.agenda = const [],
    this.notes = const [],
    this.startsAt,
    this.sent,
    this.month,
    this.checkinId,
    this.doneByName,
  });

  factory TeamTask.fromJson(Map<String, dynamic> json) => TeamTask(
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
    pill: TeamPillText.fromJson(json['pill']),
    opens: _str(json['opens']),
    canTick: json['canTick'] == true,
    agenda: _strings(json['agenda']),
    notes: _strings(json['notes']),
    startsAt: DateTime.tryParse('${json['startsAt'] ?? ''}')?.toLocal(),
    sent: _str(json['sent']),
    month: _intOrNull(json['month']),
    checkinId: _str(json['checkinId']),
    doneByName: _str(json['doneByName']),
  );

  final String id;
  final String title;

  /// help | approve | review | task | meet | team | goal | doc | chat: its icon tile.
  final String kind;
  final int step;
  final String stepLabel;
  final bool early;
  final bool done;
  final bool locked;
  final String? pair;

  /// HR's how-to line from the template.
  final String? how;
  final String? note;
  final TeamPillText? pill;

  /// The screen the row opens: meeting, buddy, schedule, chat, feed, goals,
  /// checkin, review, approval, around, groups, invite, plain; null: a tick.
  final String? opens;
  final bool canTick;
  final List<String> agenda;

  /// A meeting's own notes (only mine) and the time set for it.
  final List<String> notes;
  final DateTime? startsAt;

  /// The welcome message or the feed post, once sent: the words that went out.
  final String? sent;
  final int? month;
  final String? checkinId;
  final String? doneByName;

  bool get isMeeting => opens == 'meeting';

  TeamTask copyWith({bool? done}) => TeamTask(
    id: id, title: title, kind: kind, step: step, stepLabel: stepLabel, early: early, done: done ?? this.done, locked: locked,
    pair: pair, how: how, note: note, pill: pill, opens: opens, canTick: canTick, agenda: agenda, notes: notes,
    startsAt: startsAt, sent: sent, month: month, checkinId: checkinId, doneByName: doneByName,
  );
}

/// One number on View progress (`ProgressStat`).
class TeamProgressStat {
  const TeamProgressStat({required this.key, required this.title, required this.done, required this.total, required this.unit, required this.flag, required this.flagTone});

  factory TeamProgressStat.fromJson(Map<String, dynamic> json) {
    final flag = _map(json['flag']);
    return TeamProgressStat(
      key: _str(json['key']) ?? '',
      title: _str(json['title']) ?? '',
      done: _int(json['done']),
      total: _int(json['total']),
      unit: _str(json['unit']) ?? '',
      flag: _str(flag['text']) ?? '',
      flagTone: _tone(flag['tone']),
    );
  }

  /// meet | ci | tasks | watch | tour | dev | prof: the list it opens.
  final String key;
  final String title;
  final int done;
  final int total;
  final String unit;
  final String flag;
  final TeamTone flagTone;
}

/// One row of a progress list (`ProgressListRow`).
class TeamProgressListRow {
  const TeamProgressListRow({required this.title, required this.status, required this.tone, this.meta, this.comingUp = false});

  factory TeamProgressListRow.fromJson(Map<String, dynamic> json) => TeamProgressListRow(
    title: _str(json['title']) ?? '',
    meta: _str(json['meta']),
    status: _str(json['status']) ?? '',
    tone: _tone(json['tone']),
    comingUp: json['comingUp'] == true,
  );

  final String title;
  final String? meta;
  final String status;
  final TeamTone tone;
  final bool comingUp;
}

/// A Day-1 or Week-1 meeting the manager schedules (MgrSchedule).
class TeamScheduleMeeting {
  const TeamScheduleMeeting({required this.rowKey, required this.title, required this.step, this.withName, this.withInitials, this.startsAt});

  factory TeamScheduleMeeting.fromJson(Map<String, dynamic> json) => TeamScheduleMeeting(
    rowKey: '${json['rowKey'] ?? ''}',
    title: _str(json['title']) ?? '',
    step: _int(json['step']),
    withName: _str(json['withName']),
    withInitials: _str(json['withInitials']),
    startsAt: DateTime.tryParse('${json['startsAt'] ?? ''}')?.toLocal(),
  );

  final String rowKey;
  final String title;

  /// 1 Day 1, 2 Week 1.
  final int step;
  final String? withName;
  final String? withInitials;
  final DateTime? startsAt;
}

/// Who the joiner is, at the top of every page (`TeamJoinerPage.joiner`).
class TeamJoiner {
  const TeamJoiner({
    required this.journeyId,
    required this.name,
    required this.first,
    required this.initials,
    required this.reportsTo,
    required this.stepLabel,
    required this.step,
    required this.statusLabel,
    this.userId,
    this.photoUrl,
    this.designation,
    this.department,
    this.buddy,
    this.plantStage = 0,
    this.preboarding = false,
    this.statusWarn = false,
    this.delayedTitle,
    this.delayedDays = 0,
    this.delayedOwner,
    this.tj,
  });

  factory TeamJoiner.fromJson(Map<String, dynamic> json) {
    final status = _map(json['status']);
    final delayed = json['delayed'] is Map ? _map(json['delayed']) : null;
    return TeamJoiner(
      journeyId: '${json['journeyId'] ?? ''}',
      userId: _str(json['userId']),
      name: _str(json['name']) ?? '—',
      first: _str(json['first']) ?? '',
      initials: _str(json['initials']) ?? '',
      photoUrl: _str(json['photoUrl']),
      designation: _str(json['designation']),
      department: _str(json['department']),
      reportsTo: _str(json['reportsTo']) ?? '',
      buddy: _str(json['buddy']),
      stepLabel: _str(json['stepLabel']) ?? '',
      step: _int(json['step']),
      plantStage: _int(json['plantStage']),
      preboarding: json['preboarding'] == true,
      statusLabel: _str(status['label']) ?? '',
      statusWarn: status['warn'] == true,
      delayedTitle: _str(delayed?['title']),
      delayedDays: _int(delayed?['waitingDays']),
      delayedOwner: _str(delayed?['ownerLabel']),
      tj: _str(json['tj']),
    );
  }

  final String journeyId;
  final String? userId;
  final String name;
  final String first;
  final String initials;
  final String? photoUrl;
  final String? designation;
  final String? department;

  /// 'you' or their manager's name.
  final String reportsTo;

  /// 'you', their buddy's name, or null (no buddy yet).
  final String? buddy;
  final String stepLabel;
  final int step;
  final int plantStage;
  final bool preboarding;

  /// "On track", "Joining soon", "Confirmation due", "1 task delayed".
  final String statusLabel;
  final bool statusWarn;
  final String? delayedTitle;
  final int delayedDays;
  final String? delayedOwner;

  /// Their joining day, YYYY-MM-DD.
  final String? tj;
}

/// A joiner's page for the viewer (`TeamJoinerPage`).
class TeamJoinerPage {
  const TeamJoinerPage({
    required this.joiner,
    required this.relation,
    required this.cardTitle,
    required this.toDo,
    required this.tasks,
    this.readOnly = false,
    this.stats = const [],
    this.joiningOn,
    this.joiningTime,
    this.joiningPlace,
    this.lists = const {},
    this.reachOut = const [],
    this.schedule = const [],
  });

  factory TeamJoinerPage.fromJson(Map<String, dynamic> json) {
    final card = _map(json['card']);
    final progress = _map(json['progress']);
    final joining = progress['joining'] is Map ? _map(progress['joining']) : null;
    final lists = _map(json['lists']);
    return TeamJoinerPage(
      joiner: TeamJoiner.fromJson(_map(json['joiner'])),
      relation: TeamRelation.parse(json['relation']),
      readOnly: json['readOnly'] == true,
      cardTitle: _str(card['title']) ?? '',
      toDo: _int(card['toDo']),
      tasks: _maps(json['tasks']).map(TeamTask.fromJson).toList(),
      stats: _maps(progress['rows']).map(TeamProgressStat.fromJson).toList(),
      joiningOn: _str(joining?['on']),
      joiningTime: _str(joining?['time']),
      joiningPlace: _str(joining?['place']),
      lists: {for (final e in lists.entries) e.key: _maps(e.value).map(TeamProgressListRow.fromJson).toList()},
      reachOut: _strings(json['reachOut']),
      schedule: _maps(json['schedule']).map(TeamScheduleMeeting.fromJson).toList(),
    );
  }

  final TeamJoiner joiner;
  final TeamRelation relation;
  final bool readOnly;

  /// "Your tasks for Priya" or "Help Priya with".
  final String cardTitle;

  /// The card's count ("2 to do"; 0 → All done).
  final int toDo;

  /// Mine, in step order.
  final List<TeamTask> tasks;
  final List<TeamProgressStat> stats;

  /// JOINING DETAILS before Day 1.
  final String? joiningOn;
  final String? joiningTime;
  final String? joiningPlace;

  /// meet | tasks | ci | watch | tour | dev | prof.
  final Map<String, List<TeamProgressListRow>> lists;

  /// The ways to reach out, in order: welcome_message, announcement, feed, game, team_post, chat.
  final List<String> reachOut;

  /// The manager's: every Day-1 and Week-1 meeting.
  final List<TeamScheduleMeeting> schedule;

  TeamJoinerPage withTask(TeamTask row) => TeamJoinerPage(
    joiner: joiner, relation: relation, readOnly: readOnly, cardTitle: cardTitle, toDo: toDo,
    tasks: [for (final t in tasks) t.id == row.id ? row : t],
    stats: stats, joiningOn: joiningOn, joiningTime: joiningTime, joiningPlace: joiningPlace, lists: lists, reachOut: reachOut, schedule: schedule,
  );
}

/// Someone the manager can make the buddy.
class TeamBuddyOption {
  const TeamBuddyOption({required this.userId, required this.name, this.designation, this.photoUrl});

  factory TeamBuddyOption.fromJson(Map<String, dynamic> json) => TeamBuddyOption(
    userId: '${json['userId'] ?? ''}',
    name: _str(json['name']) ?? '—',
    designation: _str(json['designation']),
    photoUrl: _str(json['photoUrl']),
  );

  final String userId;
  final String name;
  final String? designation;
  final String? photoUrl;
}

/// A goal on "Comment on Rahul’s goals".
class TeamGoal {
  const TeamGoal({required this.index, required this.text, this.status, this.note, this.comment});

  factory TeamGoal.fromJson(Map<String, dynamic> json) => TeamGoal(
    index: _int(json['index']),
    text: _str(json['text']) ?? '',
    status: _str(json['status']),
    note: _str(json['note']),
    comment: _str(json['comment']),
  );

  final int index;
  final String text;

  /// start | progress | well.
  final String? status;
  final String? note;
  final String? comment;
}

/// A question and what the joiner answered.
class TeamCheckinAnswer {
  const TeamCheckinAnswer({required this.question, required this.type, this.value});
  final String question;

  /// rating | yes_no | short | long | choice.
  final String type;
  final Object? value;
}

/// A check-in as the manager reads it (MgrReview).
class TeamCheckin {
  const TeamCheckin({required this.title, required this.state, this.sentAt, this.answers = const []});

  factory TeamCheckin.fromJson(Map<String, dynamic> json) {
    final answers = {for (final a in _maps(json['answers'])) '${a['questionId'] ?? ''}': a['value']};
    return TeamCheckin(
      title: _str(json['title']) ?? '',
      state: _str(json['state']) ?? 'waiting',
      sentAt: DateTime.tryParse('${json['sentAt'] ?? ''}')?.toLocal(),
      answers: [
        for (final q in _maps(json['questions']))
          TeamCheckinAnswer(question: _str(q['text']) ?? '', type: _str(q['type']) ?? 'short', value: answers['${q['id'] ?? ''}']),
      ],
    );
  }

  final String title;

  /// waiting | ready | read.
  final String state;
  final DateTime? sentAt;
  final List<TeamCheckinAnswer> answers;
}

/// A fact on the confirmation review and the approval.
class TeamFact {
  const TeamFact(this.label, this.value);
  final String label;
  final String value;

  static List<TeamFact> listOf(Object? json) => [for (final f in _maps(json)) TeamFact(_str(f['label']) ?? '', _str(f['value']) ?? '')];
}

/// The manager's recommendation (sent, or as the head of department reads it).
class TeamRecommendation {
  const TeamRecommendation({required this.outcome, this.extendMonths, this.kpis = '', this.strengths = '', this.next = '', this.note, this.byName, this.at});

  factory TeamRecommendation.fromJson(Map<String, dynamic> json) => TeamRecommendation(
    outcome: _str(json['outcome']) ?? 'confirm',
    extendMonths: _intOrNull(json['extendMonths']),
    kpis: _str(json['kpis']) ?? '',
    strengths: _str(json['strengths']) ?? '',
    next: _str(json['next']) ?? '',
    note: _str(json['note']),
    byName: _str(json['byName']),
    at: DateTime.tryParse('${json['at'] ?? ''}')?.toLocal(),
  );

  /// confirm | extend.
  final String outcome;
  final int? extendMonths;
  final String kpis;
  final String strengths;
  final String next;
  final String? note;
  final String? byName;
  final DateTime? at;
}

/// MgrConfReview's facts and who approves.
class TeamReviewView {
  const TeamReviewView({this.facts = const [], this.approverName, this.sent});

  factory TeamReviewView.fromJson(Map<String, dynamic> json) => TeamReviewView(
    facts: TeamFact.listOf(json['facts']),
    approverName: _str(json['approverName']),
    sent: json['sent'] is Map ? TeamRecommendation.fromJson(_map(json['sent'])) : null,
  );

  final List<TeamFact> facts;
  final String? approverName;
  final TeamRecommendation? sent;
}

/// HodApprove: the recommendation, the facts and the answer.
class TeamConfirmation {
  const TeamConfirmation({required this.state, this.recommendation, this.facts = const [], this.answerComment, this.answerMonths});

  factory TeamConfirmation.fromJson(Map<String, dynamic> json) {
    final answer = json['answer'] is Map ? _map(json['answer']) : null;
    return TeamConfirmation(
      state: _str(json['state']) ?? 'waiting',
      recommendation: json['recommendation'] is Map ? TeamRecommendation.fromJson(_map(json['recommendation'])) : null,
      facts: TeamFact.listOf(json['facts']),
      answerComment: _str(answer?['comment']),
      answerMonths: _intOrNull(answer?['extendMonths']),
    );
  }

  /// waiting | ready | approved | extended.
  final String state;
  final TeamRecommendation? recommendation;
  final List<TeamFact> facts;
  final String? answerComment;
  final int? answerMonths;
}

/// The team side's calls. The screens only talk to this, so tests hand them a fake.
abstract class TeamJoinersApi {
  Future<List<TeamJoinerRow>> fetchJoiners();
  Future<TeamJoinerPage> fetchPage(String journeyId);

  /// A tick: `done` or `undo`.
  Future<TeamJoinerPage> rowAction(String journeyId, String rowId, String action);
  Future<List<String>> saveNotes(String journeyId, String rowId, List<String> notes);
  Future<({List<TeamBuddyOption> options, String? current})> buddyOptions(String journeyId);
  Future<TeamJoinerPage> assignBuddy(String journeyId, String buddyUserId);
  Future<TeamJoinerPage> schedule(String journeyId, Map<String, DateTime> times);
  Future<TeamJoinerPage> welcomeMessage(String journeyId, String text);
  Future<TeamJoinerPage> feedPost(String journeyId, String text);
  Future<List<TeamGoal>> goals(String journeyId, int month);
  Future<List<TeamGoal>> commentOnGoals(String journeyId, int month, Map<int, String> comments);
  Future<TeamCheckin> checkin(String journeyId, String checkinId);
  Future<TeamCheckin> markCheckinRead(String journeyId, String checkinId);
  Future<TeamReviewView> review(String journeyId);
  Future<TeamJoinerPage> sendReview(String journeyId, {required String outcome, int? extendMonths, required String kpis, required String strengths, required String next});
  Future<TeamConfirmation> confirmation(String journeyId);
  Future<TeamConfirmation> answerConfirmation(String journeyId, String action, {int? extendMonths, String? comment});
  Future<TeamJoinerPage> seniorMeeting(String journeyId, {required String mode, required DateTime startsAt, List<String> journeyIds = const []});
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

  String _j(String journeyId) => '/lifecycle/team/joiners/${Uri.encodeComponent(journeyId)}';

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

  Future<TeamJoinerPage> _page(String method, String path, {Map<String, dynamic>? body}) async =>
      TeamJoinerPage.fromJson(await _json(method, path, body: body));

  @override
  Future<List<TeamJoinerRow>> fetchJoiners() async =>
      _maps((await _json('GET', '/lifecycle/team/joiners'))['joiners']).map(TeamJoinerRow.fromJson).toList();

  @override
  Future<TeamJoinerPage> fetchPage(String journeyId) => _page('GET', '${_j(journeyId)}/page');

  @override
  Future<TeamJoinerPage> rowAction(String journeyId, String rowId, String action) =>
      _page('POST', '${_j(journeyId)}/rows/${Uri.encodeComponent(rowId)}', body: {'action': action});

  @override
  Future<List<String>> saveNotes(String journeyId, String rowId, List<String> notes) async =>
      _strings((await _json('PUT', '${_j(journeyId)}/rows/${Uri.encodeComponent(rowId)}/notes', body: {'notes': notes}))['notes']);

  @override
  Future<({List<TeamBuddyOption> options, String? current})> buddyOptions(String journeyId) async {
    final json = await _json('GET', '${_j(journeyId)}/buddy-options');
    return (options: _maps(json['options']).map(TeamBuddyOption.fromJson).toList(), current: _str(json['current']));
  }

  @override
  Future<TeamJoinerPage> assignBuddy(String journeyId, String buddyUserId) =>
      _page('POST', '${_j(journeyId)}/buddy', body: {'buddyUserId': buddyUserId});

  @override
  Future<TeamJoinerPage> schedule(String journeyId, Map<String, DateTime> times) => _page(
    'POST',
    '${_j(journeyId)}/schedule',
    body: {
      'meetings': [for (final e in times.entries) {'rowKey': e.key, 'startsAt': e.value.toUtc().toIso8601String()}],
    },
  );

  @override
  Future<TeamJoinerPage> welcomeMessage(String journeyId, String text) => _page('POST', '${_j(journeyId)}/welcome-message', body: {'text': text});

  @override
  Future<TeamJoinerPage> feedPost(String journeyId, String text) => _page('POST', '${_j(journeyId)}/feed', body: {'text': text});

  @override
  Future<List<TeamGoal>> goals(String journeyId, int month) async =>
      _maps((await _json('GET', '${_j(journeyId)}/goals/$month'))['goals']).map(TeamGoal.fromJson).toList();

  @override
  Future<List<TeamGoal>> commentOnGoals(String journeyId, int month, Map<int, String> comments) async => _maps(
    (await _json(
      'POST',
      '${_j(journeyId)}/goals/$month',
      body: {
        'comments': [for (final e in comments.entries) {'index': e.key, 'text': e.value}],
      },
    ))['goals'],
  ).map(TeamGoal.fromJson).toList();

  @override
  Future<TeamCheckin> checkin(String journeyId, String checkinId) async =>
      TeamCheckin.fromJson(await _json('GET', '${_j(journeyId)}/checkins/${Uri.encodeComponent(checkinId)}'));

  @override
  Future<TeamCheckin> markCheckinRead(String journeyId, String checkinId) async =>
      TeamCheckin.fromJson(await _json('POST', '${_j(journeyId)}/checkins/${Uri.encodeComponent(checkinId)}/read'));

  @override
  Future<TeamReviewView> review(String journeyId) async => TeamReviewView.fromJson(await _json('GET', '${_j(journeyId)}/review'));

  @override
  Future<TeamJoinerPage> sendReview(String journeyId, {required String outcome, int? extendMonths, required String kpis, required String strengths, required String next}) =>
      _page(
        'POST',
        '${_j(journeyId)}/review',
        body: {'outcome': outcome, 'extendMonths': ?extendMonths, 'kpis': kpis, 'strengths': strengths, 'next': next},
      );

  @override
  Future<TeamConfirmation> confirmation(String journeyId) async => TeamConfirmation.fromJson(await _json('GET', '${_j(journeyId)}/confirmation'));

  @override
  Future<TeamConfirmation> answerConfirmation(String journeyId, String action, {int? extendMonths, String? comment}) async => TeamConfirmation.fromJson(
    await _json(
      'POST',
      '${_j(journeyId)}/confirmation',
      body: {'action': action, 'extendMonths': ?extendMonths, if (comment != null && comment.trim().isNotEmpty) 'comment': comment.trim()},
    ),
  );

  @override
  Future<TeamJoinerPage> seniorMeeting(String journeyId, {required String mode, required DateTime startsAt, List<String> journeyIds = const []}) => _page(
    'POST',
    '${_j(journeyId)}/senior-meeting',
    body: {'mode': mode, 'startsAt': startsAt.toUtc().toIso8601String(), if (journeyIds.isNotEmpty) 'journeyIds': journeyIds},
  );
}
