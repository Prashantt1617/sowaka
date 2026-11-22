import 'dart:typed_data';

import '../../../../services/api_config.dart';
import '../data/joiner_meetings_api.dart';
import '../data/onboarding_api.dart';
import 'joiner_models.dart';

/// The joiner's reads and writes (FINAL-DESIGNS.md §4.2). The screens only
/// talk to this, so the tests hand them a fake.
abstract class JoinerApi {
  Future<JoinerOnboarding> fetch();

  /// Last time's answer from the device, to paint at once; null when none.
  Future<JoinerOnboarding?> kept();

  /// Review → `looks_good`, Read and acknowledge (a PDF) → `acknowledged`,
  /// More tasks → `opened` / `done`, the confirmation letter → `opened`.
  Future<JoinerOnboarding> taskAction(String taskId, String action);

  /// Mark as met (true) or not (false), the tick the teammate reads too.
  Future<void> setMet(String rowId, bool met);

  /// The joiner's own notes on a meeting, one per agenda point.
  Future<void> saveNotes(String rowId, List<String> notes);

  Future<JoinerCheckin> fetchCheckin(String id);

  /// `null` values are skipped long answers.
  Future<JoinerCheckin> sendCheckin(String id, List<({String questionId, Object? value})> answers);

  /// A "Fill in a form" task: its questions, and the answers once sent.
  Future<JoinerForm> fetchForm(String taskId);

  /// Submit: one value per question (null = left empty); saved to the profile.
  Future<JoinerForm> sendForm(String taskId, Map<String, String?> answers);

  /// A file answer, uploaded before Submit: its id is the answer.
  Future<({String fileId, String name})> uploadFormFile(String taskId, String filename, Uint8List bytes);

  Future<JoinerGoals> fetchGoals();
  Future<JoinerGoals> saveGoal(int month, int index, {String? status, String? note});

  Future<void> markWatched(String itemId);

  /// The Sowaka tour lesson done.
  Future<void> lessonDone(String lesson);

  Future<JoinerTeam> fetchTeam();

  /// The Sign task's documents.
  Future<List<JoinerLetter>> letters();
  Future<List<JoinerLetter>> openLetter(String id);
  Future<List<JoinerLetter>> signLetter(String id, String typedName);

  /// A server file (PDF) the joiner may read.
  Future<Uint8List> download(String path);

  /// What a media URL needs: the full address and the sign-in header.
  ({Uri uri, Map<String, String> headers})? media(String path);
}

class HttpJoinerApi implements JoinerApi {
  HttpJoinerApi(this.api);

  /// The signed-in shell's API, when it talks to the server.
  static JoinerApi? from(OnboardingApi api) => api is HttpOnboardingApi ? HttpJoinerApi(api) : null;

  final HttpOnboardingApi api;

  static const _base = '/lifecycle/joiner';
  String _e(String s) => Uri.encodeComponent(s);

  @override
  Future<JoinerOnboarding> fetch() async => JoinerOnboarding.fromJson(await api.request('GET', '$_base/onboarding'));

  @override
  Future<JoinerOnboarding?> kept() => api.fromDevice((_) => fetch());

  @override
  Future<JoinerOnboarding> taskAction(String taskId, String action) async =>
      JoinerOnboarding.fromJson(await api.request('POST', '$_base/tasks/${_e(taskId)}', body: {'action': action}));

  @override
  Future<void> setMet(String rowId, bool met) async {
    await api.request('POST', '/lifecycle/onboarding/meeting-rows/${_e(rowId)}', body: {'action': met ? 'met' : 'unmet'});
  }

  @override
  Future<void> saveNotes(String rowId, List<String> notes) async {
    await api.request('PUT', '/lifecycle/onboarding/meeting-rows/${_e(rowId)}/notes', body: {'notes': notes});
  }

  @override
  Future<JoinerCheckin> fetchCheckin(String id) async => JoinerCheckin.fromJson(await api.request('GET', '$_base/checkins/${_e(id)}'));

  @override
  Future<JoinerCheckin> sendCheckin(String id, List<({String questionId, Object? value})> answers) async => JoinerCheckin.fromJson(
    await api.request('POST', '$_base/checkins/${_e(id)}', body: {
      'answers': [for (final a in answers) {'questionId': a.questionId, 'value': a.value}],
    }),
  );

  @override
  Future<JoinerForm> fetchForm(String taskId) async => JoinerForm.fromJson(await api.request('GET', '$_base/forms/${_e(taskId)}'));

  @override
  Future<JoinerForm> sendForm(String taskId, Map<String, String?> answers) async => JoinerForm.fromJson(
    await api.request('POST', '$_base/forms/${_e(taskId)}', body: {
      'answers': [for (final a in answers.entries) {'questionId': a.key, 'value': a.value}],
    }),
  );

  @override
  Future<({String fileId, String name})> uploadFormFile(String taskId, String filename, Uint8List bytes) async {
    final json = await api.upload('$_base/forms/${_e(taskId)}/files', filename: filename, bytes: bytes);
    return (fileId: '${json['fileId'] ?? ''}', name: '${json['name'] ?? filename}');
  }

  @override
  Future<JoinerGoals> fetchGoals() async => JoinerGoals.fromJson(await api.request('GET', '$_base/goals'));

  @override
  Future<JoinerGoals> saveGoal(int month, int index, {String? status, String? note}) async => JoinerGoals.fromJson(
    await api.request('PUT', '$_base/goals/$month/$index', body: {'status': ?status, 'note': ?note}),
  );

  @override
  Future<void> markWatched(String itemId) async {
    await api.request('POST', '$_base/watch/${_e(itemId)}', body: {});
  }

  @override
  Future<void> lessonDone(String lesson) async {
    await api.markTourLessonDone(lesson);
  }

  @override
  Future<JoinerTeam> fetchTeam() async => JoinerTeam.fromJson(await api.request('GET', '/lifecycle/onboarding/team'));

  @override
  Future<List<JoinerLetter>> letters() async => joinerLettersOf(await api.request('GET', '$_base/letters'));

  @override
  Future<List<JoinerLetter>> openLetter(String id) async => joinerLettersOf(await api.request('POST', '$_base/letters/${_e(id)}/opened'));

  @override
  Future<List<JoinerLetter>> signLetter(String id, String typedName) async =>
      joinerLettersOf(await api.request('POST', '$_base/letters/${_e(id)}/sign', body: {'method': 'type', 'typedName': typedName}));

  @override
  Future<Uint8List> download(String path) => api.download(path);

  @override
  ({Uri uri, Map<String, String> headers})? media(String path) => (
    uri: Uri.parse(path.startsWith('/') ? '${ApiConfig.baseUrl}$path' : path),
    headers: {'Authorization': 'Bearer ${api.session.token}'},
  );
}
