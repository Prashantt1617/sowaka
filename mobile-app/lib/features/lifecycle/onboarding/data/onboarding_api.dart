import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart' show debugPrint;
import 'package:http/http.dart' as http;

import '../../../../services/api_client.dart';
import '../../../../services/api_config.dart';
import '../../../auth/data/auth_models.dart';
import '../../../manager/data/dashboard_cache.dart';
import '../../../shared/network_status.dart';
import 'onboarding_models.dart';

/// A lifecycle call that did not work. [message] is fit to show.
class OnboardingApiException implements Exception {
  const OnboardingApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  static const failed = 'Something went wrong. Try again.';
  static const offline = 'No internet connection';
  static const tooSlow = 'This is taking too long. Try again.';
  static const notAvailable = 'Not available';

  /// The server said the lifecycle is off for this company (404 "Not
  /// available"), or does not have the routes yet.
  bool get isOff => statusCode == 404;

  @override
  String toString() => message;
}

String onboardingErrorText(Object error) =>
    error is OnboardingApiException ? error.message : OnboardingApiException.failed;

/// Everything the onboarding screens read and write
/// (CONTRACT.md, "App — joiner and manager"). The screens only ever talk to
/// this, so the tests hand them a fake.
abstract class OnboardingApi {
  /// The signed-in person, for "mine" on replies.
  String? get viewerId;

  /// [read] answered from this person's last replies on the device, never
  /// the network: what the screen showed last time, to paint at once while
  /// the live read runs. Null when a reply it needs was never kept.
  Future<T?> fromDevice<T>(Future<T> Function(OnboardingApi api) read);

  // Joiner
  Future<LifecycleMe> fetchMe();

  /// The joining portal's address, signed in as them (`POST
  /// /lifecycle/portal-session`): the portal's `/app` entry with a fresh
  /// portal session in its fragment. Fails once the portal has closed.
  Future<Uri> portalSessionUrl();
  Future<OnboardingHome> fetchHome();
  Future<TaskView?> taskAction(String taskId, String action, {String? note});
  Future<Week1Data> fetchWeek1();
  Future<Week1Data?> saveWeek1(Week1Step step, Object value);
  Future<IntroPost> fetchIntro();
  Future<IntroPost> saveIntro(IntroPost intro);
  Future<IntroPost> postIntro();
  Future<List<PersonToMeet>> fetchPeople();

  /// A6 whole: the people, the meet-by day, and whether it closed.
  Future<PeopleToMeetView> fetchPeopleView();

  /// "Week 1, done!" was seen (on the server, so it shows on no other device).
  Future<void> markWeekDoneSeen();
  Future<List<PersonToMeet>?> markPerson(String id, String action);
  Future<List<StarterTask>> fetchStarterTasks();
  Future<StarterTask?> markStarterTaskDone(String id, {String? note});
  Future<List<OneOnOneNote>> fetchNotes();
  Future<OneOnOneNote?> noteAction(String id, String action, {String? text});
  Future<Meeting> fetchMeeting(String id);
  Future<Meeting?> answerMeeting(String id, String met, {DateTime? newTime});
  Future<SurveyState> fetchSurvey();
  Future<void> sendSurvey(SurveyAnswers answers);
  Future<ProbationView> fetchProbation();
  Future<void> saveCheckin(int month, String text, {int? rating, List<int>? goalRatings, String? win, String? ask});
  Future<RevealView> fetchReveal();
  Future<void> revealSeen();
  Future<Uint8List> download(String url);

  // Manager
  Future<List<JoinerSummary>> fetchJoiners();
  Future<JoinerDetail> fetchJoiner(String journeyId);
  Future<void> saveSetup(
    String journeyId, {
    List<SetupPerson>? people,
    String? buddyUserId,
    String? welcomeNote,
    List<String>? goals,
  });
  Future<void> assignStarterTask(
    String journeyId, {
    required String title,
    List<String> links = const [],
    String? note,
    DateTime? dueAt,
  });
  Future<void> replyStarterTask(String id, String text);
  Future<void> addNote(String journeyId, String text, {required bool shared});
  Future<void> managerTaskDone(String journeyId, String taskId);

  /// M2 "Post a welcome": the manager's welcome for the joiner on Connect.
  Future<void> postWelcome(String journeyId, String text);
  Future<void> saveProbationMonth(
    String journeyId,
    int month, {
    List<String>? goals,
    CheckinEntry? checkin,
    String? review,
    List<String>? feedback,
    bool? askAck,
    List<String>? nextGoals,
  });
  Future<List<DirectoryPerson>> fetchDirectory();
}

/// [OnboardingApi] over HTTP, with the signed-in person's token.
class HttpOnboardingApi implements OnboardingApi {
  HttpOnboardingApi({required this.session, String? baseUrl, http.Client? client})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
      _client = client ?? ApiClient.shared;

  static const requestTimeout = Duration(seconds: 30);

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;

  @override
  String? get viewerId => session.user.id.isEmpty ? null : session.user.id;

  // ── The device's copy (DashboardCache, as the manager dashboard keeps its own) ──
  //
  // Every lifecycle GET that answers is kept by path, per person, in memory
  // and on the device; [fromDevice] replays a read against those replies, so
  // the same parsing runs on them as on a live reply.

  static final Map<String, Map<String, Map<String, dynamic>>> _keptByUser = {};
  static final Map<String, Future<void>> _loading = {};
  static final Set<String> _pendingWrite = {};
  static final Map<String, DateTime> _writeStartedAt = {};
  static const _replayKey = #onboardingReplay;

  String get _cacheKey => 'lifecycle-${session.user.id}';

  Future<Map<String, Map<String, dynamic>>> _kept() async {
    final user = session.user.id;
    final held = _keptByUser[user];
    if (held != null) return held;
    await (_loading[user] ??= DashboardCache.read(_cacheKey).then((replies) {
      _keptByUser.putIfAbsent(user, () => replies ?? {});
    }));
    return _keptByUser[user] ??= {};
  }

  void _keep(String path, Map<String, dynamic>? json, DateTime startedAt) {
    if (!DashboardCache.writeAllowed(startedAt)) return;
    final user = session.user.id;
    if (user.isEmpty) return;
    final kept = _keptByUser[user] ??= {};
    if (json == null) {
      if (kept.remove(path) == null) return;
    } else {
      kept[path] = json;
    }
    // One write for the replies that land together (no timer left behind).
    final first = _writeStartedAt[user];
    _writeStartedAt[user] = first == null || startedAt.isBefore(first) ? startedAt : first;
    if (_pendingWrite.add(user)) {
      final key = _cacheKey;
      scheduleMicrotask(() {
        _pendingWrite.remove(user);
        final began = _writeStartedAt.remove(user) ?? startedAt;
        unawaited(DashboardCache.write(key, Map.of(kept), startedAt: began));
      });
    }
  }

  @override
  Future<T?> fromDevice<T>(Future<T> Function(OnboardingApi api) read) async {
    if (session.user.id.isEmpty) return null;
    await _kept();
    try {
      return await runZoned(() => read(this), zoneValues: {_replayKey: true});
    } catch (error) {
      if (error is! _NotKept) debugPrint('Kept lifecycle reply not usable: $error');
      return null;
    }
  }

  /// Signed out, or someone else signed in: the copies in memory go (the
  /// files go with [DashboardCache.clearAll]).
  static void forgetKept() {
    _pendingWrite.clear();
    _writeStartedAt.clear();
    _keptByUser.clear();
    _loading.clear();
  }

  // ── Joiner ────────────────────────────────────────────────────────────────

  @override
  Future<LifecycleMe> fetchMe() async {
    try {
      return LifecycleMe.fromJson(await _json('GET', '/lifecycle/me'));
    } on OnboardingApiException catch (error) {
      // Off for the company (or a server without the routes): nothing shows.
      if (error.isOff) return LifecycleMe.off;
      rethrow;
    }
  }

  @override
  Future<Uri> portalSessionUrl() async {
    final url = Uri.tryParse('${(await _json('POST', '/lifecycle/portal-session'))['url'] ?? ''}');
    if (url == null || !url.hasScheme) throw const OnboardingApiException(OnboardingApiException.failed);
    return url;
  }

  @override
  Future<OnboardingHome> fetchHome() async =>
      OnboardingHome.fromJson(await _json('GET', '/lifecycle/onboarding'));

  @override
  Future<TaskView?> taskAction(String taskId, String action, {String? note}) async {
    final json = await _json(
      'POST',
      '/lifecycle/onboarding/tasks/${Uri.encodeComponent(taskId)}',
      body: {'action': action, if (note != null && note.isNotEmpty) 'note': note},
    );
    return json['task'] is Map ? TaskView.fromJson(Map<String, dynamic>.from(json['task'] as Map)) : null;
  }

  @override
  Future<Week1Data> fetchWeek1() async => Week1Data.fromJson(await _json('GET', '/lifecycle/onboarding/week1'));

  @override
  Future<Week1Data?> saveWeek1(Week1Step step, Object value) async {
    final json = await _json('PUT', '/lifecycle/onboarding/week1', body: {'step': step.key, 'value': value});
    return json.containsKey('policies') || json.containsKey('bank') ? Week1Data.fromJson(json) : null;
  }

  @override
  Future<IntroPost> fetchIntro() async => IntroPost.fromJson(await _json('GET', '/lifecycle/onboarding/intro'));

  @override
  Future<IntroPost> saveIntro(IntroPost intro) async =>
      IntroPost.fromJson(await _json('PUT', '/lifecycle/onboarding/intro', body: intro.toJson()));

  @override
  Future<IntroPost> postIntro() async =>
      IntroPost.fromJson(await _json('POST', '/lifecycle/onboarding/intro/post'));

  @override
  Future<List<PersonToMeet>> fetchPeople() async => _people(await _json('GET', '/lifecycle/onboarding/people'));

  @override
  Future<List<PersonToMeet>?> markPerson(String id, String action) async {
    final json = await _json(
      'POST',
      '/lifecycle/onboarding/people/${Uri.encodeComponent(id)}',
      body: {'action': action},
    );
    return json['people'] is List ? _people(json) : null;
  }

  @override
  Future<PeopleToMeetView> fetchPeopleView() async =>
      PeopleToMeetView.fromJson(await _json('GET', '/lifecycle/onboarding/people'));

  @override
  Future<void> markWeekDoneSeen() async {
    await _json('POST', '/lifecycle/onboarding/week-done/seen');
  }

  List<PersonToMeet> _people(Map<String, dynamic> json) => [
    for (final item in json['people'] as List? ?? const [])
      if (item is Map) PersonToMeet.fromJson(Map<String, dynamic>.from(item)),
  ];

  @override
  Future<List<StarterTask>> fetchStarterTasks() async {
    final json = await _json('GET', '/lifecycle/onboarding/starter-tasks');
    return [
      for (final item in json['tasks'] as List? ?? const [])
        if (item is Map) StarterTask.fromJson(Map<String, dynamic>.from(item)),
    ];
  }

  @override
  Future<StarterTask?> markStarterTaskDone(String id, {String? note}) async {
    final json = await _json(
      'POST',
      '/lifecycle/onboarding/starter-tasks/${Uri.encodeComponent(id)}/done',
      body: {if (note != null && note.trim().isNotEmpty) 'note': note.trim()},
    );
    final task = json['task'];
    return task is Map ? StarterTask.fromJson(Map<String, dynamic>.from(task)) : null;
  }

  @override
  Future<List<OneOnOneNote>> fetchNotes() async {
    final json = await _json('GET', '/lifecycle/onboarding/notes');
    return [
      for (final item in json['notes'] as List? ?? const [])
        if (item is Map) OneOnOneNote.fromJson(Map<String, dynamic>.from(item), viewerId: viewerId),
    ];
  }

  @override
  Future<OneOnOneNote?> noteAction(String id, String action, {String? text}) async {
    final json = await _json(
      'POST',
      '/lifecycle/onboarding/notes/${Uri.encodeComponent(id)}',
      body: {'action': action, 'text': ?text},
    );
    final note = json['note'];
    return note is Map ? OneOnOneNote.fromJson(Map<String, dynamic>.from(note), viewerId: viewerId) : null;
  }

  @override
  Future<Meeting> fetchMeeting(String id) async {
    final json = await _json('GET', '/lifecycle/onboarding/meetings/${Uri.encodeComponent(id)}');
    return Meeting.fromJson(json['meeting'] is Map ? Map<String, dynamic>.from(json['meeting'] as Map) : json);
  }

  @override
  Future<Meeting?> answerMeeting(String id, String met, {DateTime? newTime}) async {
    final json = await _json(
      'POST',
      '/lifecycle/onboarding/meetings/${Uri.encodeComponent(id)}',
      body: {'met': met, if (newTime != null) 'newTime': newTime.toUtc().toIso8601String()},
    );
    final meeting = json['meeting'] is Map ? Map<String, dynamic>.from(json['meeting'] as Map) : json;
    return meeting.containsKey('id') ? Meeting.fromJson(meeting) : null;
  }

  @override
  Future<SurveyState> fetchSurvey() async => SurveyState.fromJson(await _json('GET', '/lifecycle/onboarding/survey'));

  @override
  Future<void> sendSurvey(SurveyAnswers answers) async {
    await _json('POST', '/lifecycle/onboarding/survey', body: {'answers': answers.toJson()});
  }

  @override
  Future<ProbationView> fetchProbation() async =>
      ProbationView.fromJson(await _json('GET', '/lifecycle/onboarding/probation'));

  @override
  Future<void> saveCheckin(int month, String text, {int? rating, List<int>? goalRatings, String? win, String? ask}) async {
    await _json(
      'PUT',
      '/lifecycle/onboarding/probation/$month/checkin',
      body: {
        'text': text,
        'rating': ?rating,
        if (goalRatings != null && goalRatings.isNotEmpty) 'goalRatings': [for (final r in goalRatings) r > 0 ? r : null],
        if (win != null && win.trim().isNotEmpty) 'win': win.trim(),
        if (ask != null && ask.trim().isNotEmpty) 'ask': ask.trim(),
      },
    );
  }

  @override
  Future<RevealView> fetchReveal() async => RevealView.fromJson(await _json('GET', '/lifecycle/onboarding/reveal'));

  @override
  Future<void> revealSeen() async {
    await _json('POST', '/lifecycle/onboarding/reveal/seen');
  }

  @override
  Future<Uint8List> download(String url) async {
    final uri = Uri.parse(url.startsWith('/') ? '$_baseUrl$url' : url);
    final request = http.Request('GET', uri)..headers['Authorization'] = 'Bearer ${session.token}';
    final http.Response response;
    try {
      response = await _client.send(request).then(http.Response.fromStream).timeout(requestTimeout);
    } catch (error) {
      throw _networkFailure(error);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw OnboardingApiException('Could not open the letter. Try again.', statusCode: response.statusCode);
    }
    return response.bodyBytes;
  }

  // ── Manager ───────────────────────────────────────────────────────────────

  @override
  Future<List<JoinerSummary>> fetchJoiners() async {
    final Map<String, dynamic> json;
    try {
      json = await _json('GET', '/lifecycle/manager/joiners');
    } on OnboardingApiException catch (error) {
      if (error.isOff) return const [];
      rethrow;
    }
    return [
      for (final item in json['joiners'] as List? ?? const [])
        if (item is Map) JoinerSummary.fromJson(Map<String, dynamic>.from(item)),
    ];
  }

  @override
  Future<JoinerDetail> fetchJoiner(String journeyId) async => JoinerDetail.fromJson(
    await _json('GET', '/lifecycle/manager/joiners/${Uri.encodeComponent(journeyId)}'),
    viewerId: viewerId,
  );

  @override
  Future<void> saveSetup(
    String journeyId, {
    List<SetupPerson>? people,
    String? buddyUserId,
    String? welcomeNote,
    List<String>? goals,
  }) async {
    await _json(
      'PUT',
      '/lifecycle/manager/joiners/${Uri.encodeComponent(journeyId)}/setup',
      body: {
        if (people != null) 'people': [for (final person in people) person.toJson()],
        'buddyUserId': ?buddyUserId,
        if (welcomeNote != null) 'welcomeNote': {'kind': 'text', 'text': welcomeNote},
        'goals': ?goals,
      },
    );
  }

  @override
  Future<void> assignStarterTask(
    String journeyId, {
    required String title,
    List<String> links = const [],
    String? note,
    DateTime? dueAt,
  }) async {
    await _json(
      'POST',
      '/lifecycle/manager/joiners/${Uri.encodeComponent(journeyId)}/starter-tasks',
      body: {
        'title': title,
        if (links.isNotEmpty) 'links': links,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
        if (dueAt != null) 'dueAt': lifecycleYmd(dueAt),
      },
    );
  }

  @override
  Future<void> replyStarterTask(String id, String text) async {
    await _json('POST', '/lifecycle/manager/starter-tasks/${Uri.encodeComponent(id)}/reply', body: {'text': text});
  }

  @override
  Future<void> addNote(String journeyId, String text, {required bool shared}) async {
    await _json(
      'POST',
      '/lifecycle/manager/joiners/${Uri.encodeComponent(journeyId)}/notes',
      body: {'text': text, 'shared': shared},
    );
  }

  @override
  Future<void> managerTaskDone(String journeyId, String taskId) async {
    await _json(
      'POST',
      '/lifecycle/manager/joiners/${Uri.encodeComponent(journeyId)}/tasks/${Uri.encodeComponent(taskId)}',
      body: {'action': 'done'},
    );
  }

  @override
  Future<void> postWelcome(String journeyId, String text) async {
    await _json('POST', '/lifecycle/manager/joiners/${Uri.encodeComponent(journeyId)}/welcome', body: {'text': text});
  }

  @override
  Future<void> saveProbationMonth(
    String journeyId,
    int month, {
    List<String>? goals,
    CheckinEntry? checkin,
    String? review,
    List<String>? feedback,
    bool? askAck,
    List<String>? nextGoals,
  }) async {
    final reviewing = review != null || (feedback != null && feedback.isNotEmpty);
    await _json(
      'PUT',
      '/lifecycle/manager/joiners/${Uri.encodeComponent(journeyId)}/probation/$month',
      body: {
        'goals': ?goals,
        if (checkin != null)
          'checkin': {
            'text': checkin.text,
            if (checkin.rating != null) 'rating': checkin.rating,
            if (checkin.goalRatings.any((r) => r > 0)) 'goalRatings': [for (final r in checkin.goalRatings) r > 0 ? r : null],
          },
        if (reviewing)
          'review': {
            'text': review ?? '',
            if (feedback != null && feedback.isNotEmpty) 'feedback': feedback,
            if (askAck == true) 'askAck': true,
            if (nextGoals != null && nextGoals.isNotEmpty) 'nextGoals': nextGoals,
          },
      },
    );
  }

  @override
  Future<List<DirectoryPerson>> fetchDirectory() async {
    final json = await _json('GET', '/connect/audience-lists/people');
    return [
      for (final item in json['people'] as List? ?? const [])
        if (item is Map) DirectoryPerson.fromJson(Map<String, dynamic>.from(item)),
    ];
  }

  // ── Transport ─────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> _json(String method, String path, {Map<String, dynamic>? body}) async {
    if (Zone.current[_replayKey] == true) {
      if (method != 'GET') throw const _NotKept();
      final kept = _keptByUser[session.user.id]?[path];
      if (kept == null) throw const _NotKept();
      return Map<String, dynamic>.from(kept);
    }
    final startedAt = DateTime.now();
    final json = await _live(method, path, body: body);
    if (method == 'GET') _keep(path, json, startedAt);
    return json;
  }

  Future<Map<String, dynamic>> _live(String method, String path, {Map<String, dynamic>? body}) async {
    final startedAt = DateTime.now();
    final request = http.Request(method, Uri.parse('$_baseUrl$path'))
      ..headers.addAll({'Authorization': 'Bearer ${session.token}', 'Content-Type': 'application/json'});
    if (body != null) request.body = jsonEncode(body);
    final http.Response response;
    try {
      response = await _client.send(request).then(http.Response.fromStream).timeout(requestTimeout);
    } catch (error) {
      throw _networkFailure(error);
    }
    NetworkStatus.reportSuccess();
    Map<String, dynamic> json;
    try {
      final decoded = response.body.isEmpty ? null : jsonDecode(utf8.decode(response.bodyBytes));
      json = decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
    } on FormatException {
      json = <String, dynamic>{};
    }
    final status = response.statusCode;
    if (status < 200 || status >= 300) {
      final said = [json['error'], json['message']].whereType<String>().map((s) => s.trim()).firstWhere(
        (s) => s.isNotEmpty,
        orElse: () => '',
      );
      // Off for the company, or gone: the device's copy of it goes too.
      if (method == 'GET' && status == 404) _keep(path, null, startedAt);
      throw OnboardingApiException(
        switch (status) {
          404 when said.isEmpty || said.startsWith('Route not found') => OnboardingApiException.notAvailable,
          _ when said.isEmpty => OnboardingApiException.failed,
          _ => said,
        },
        statusCode: status,
      );
    }
    return json;
  }

  OnboardingApiException _networkFailure(Object error) {
    NetworkStatus.reportFailure(error, probe: Uri.parse('$_baseUrl/health'));
    return OnboardingApiException(switch (error) {
      TimeoutException() => OnboardingApiException.tooSlow,
      _ when NetworkStatus.isNetworkError(error) => OnboardingApiException.offline,
      _ => OnboardingApiException.failed,
    });
  }
}

/// A replayed read needed a reply the device never kept.
class _NotKept implements Exception {
  const _NotKept();
}
