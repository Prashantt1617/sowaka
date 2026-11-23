import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../../services/api_client.dart';
import '../../../../services/api_config.dart';
import '../../../auth/data/auth_models.dart';
import 'onboarding_api.dart';

/// The probation decision on the team side (server services/lifecycle/
/// teamApp.ts): the manager's confirmation review and the head of
/// department's approval. HR assigns every other onboarding task on the
/// dashboard, so this is all a manager, buddy or head of department does for
/// a joiner in the app. Reached from an Actions card while one waits
/// (`/lifecycle/me` `confirmations`) and from their pushes. Every name, fact
/// and state here is the server's.

String? _str(Object? v) => v is String && v.isNotEmpty ? v : null;
int? _intOrNull(Object? v) => v is num ? v.toInt() : null;
List<Map<String, dynamic>> _maps(Object? v) => ((v as List?) ?? const []).whereType<Map>().map((m) => m.cast<String, dynamic>()).toList();
Map<String, dynamic> _map(Object? v) => (v as Map?)?.cast<String, dynamic>() ?? const {};

/// One confirmation waiting on the viewer (`/lifecycle/me` `confirmations`):
/// the manager's review to write, or the head of department's approval.
class PendingConfirmation {
  const PendingConfirmation({required this.journeyId, required this.kind, required this.name, required this.title});

  factory PendingConfirmation.fromJson(Map<String, dynamic> json) => PendingConfirmation(
    journeyId: '${json['journeyId'] ?? ''}',
    kind: json['kind'] == 'approval' ? ConfirmationKind.approval : ConfirmationKind.review,
    name: _str(json['name']) ?? '',
    title: _str(json['title']) ?? '',
  );

  static List<PendingConfirmation> listOf(Object? json) =>
      [for (final m in _maps(json)) PendingConfirmation.fromJson(m)].where((c) => c.journeyId.isNotEmpty).toList();

  final String journeyId;
  final ConfirmationKind kind;

  /// The joiner's name.
  final String name;

  /// "Confirmation review for Priya", "Approve Priya’s confirmation".
  final String title;
}

enum ConfirmationKind { review, approval }

/// The joiner at the top of the review and the approval.
class ConfirmationJoiner {
  const ConfirmationJoiner({required this.journeyId, required this.name, required this.first, this.userId, this.photoUrl, this.designation, this.department});

  factory ConfirmationJoiner.fromJson(Map<String, dynamic> json) {
    final name = _str(json['name']) ?? '—';
    return ConfirmationJoiner(
      journeyId: '${json['journeyId'] ?? ''}',
      userId: _str(json['userId']),
      name: name,
      first: _str(json['first']) ?? name.trim().split(RegExp(r'\s+')).first,
      photoUrl: _str(json['photoUrl']),
      designation: _str(json['designation']),
      department: _str(json['department']),
    );
  }

  final String journeyId;
  final String? userId;
  final String name;
  final String first;
  final String? photoUrl;
  final String? designation;
  final String? department;

  /// "Designer · Design", the parts there are.
  String? get roleLine {
    final parts = [?designation, ?department];
    return parts.isEmpty ? null : parts.join(' · ');
  }
}

/// A fact on the confirmation review and the approval.
class ConfirmationFact {
  const ConfirmationFact(this.label, this.value);
  final String label;
  final String value;

  static List<ConfirmationFact> listOf(Object? json) => [for (final f in _maps(json)) ConfirmationFact(_str(f['label']) ?? '', _str(f['value']) ?? '')];
}

/// The manager's recommendation (sent, or as the head of department reads it).
class Recommendation {
  const Recommendation({required this.outcome, this.extendMonths, this.kpis = '', this.strengths = '', this.next = '', this.note, this.byName, this.at});

  factory Recommendation.fromJson(Map<String, dynamic> json) => Recommendation(
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

  /// "Confirm", "Extend by 2 months".
  String get label => outcome == 'extend' ? 'Extend by ${extendMonths ?? 3} month${extendMonths == 1 ? '' : 's'}' : 'Confirm';
}

/// The manager's review (MgrConfReview): their probation's facts, who
/// approves, and what was sent once it is.
class ConfirmationReview {
  const ConfirmationReview({required this.joiner, this.facts = const [], this.approverName, this.sent});

  factory ConfirmationReview.fromJson(Map<String, dynamic> json) => ConfirmationReview(
    joiner: ConfirmationJoiner.fromJson(_map(json['joiner'])),
    facts: ConfirmationFact.listOf(json['facts']),
    approverName: _str(json['approverName']),
    sent: json['sent'] is Map ? Recommendation.fromJson(_map(json['sent'])) : null,
  );

  final ConfirmationJoiner joiner;
  final List<ConfirmationFact> facts;
  final String? approverName;
  final Recommendation? sent;
}

/// The head of department's approval (HodApprove): the recommendation, the
/// facts and the answer.
class ConfirmationApproval {
  const ConfirmationApproval({required this.joiner, required this.state, this.recommendation, this.facts = const [], this.answerComment, this.answerMonths});

  factory ConfirmationApproval.fromJson(Map<String, dynamic> json) {
    final answer = json['answer'] is Map ? _map(json['answer']) : null;
    return ConfirmationApproval(
      joiner: ConfirmationJoiner.fromJson(_map(json['joiner'])),
      state: _str(json['state']) ?? 'waiting',
      recommendation: json['recommendation'] is Map ? Recommendation.fromJson(_map(json['recommendation'])) : null,
      facts: ConfirmationFact.listOf(json['facts']),
      answerComment: _str(answer?['comment']),
      answerMonths: _intOrNull(answer?['extendMonths']),
    );
  }

  final ConfirmationJoiner joiner;

  /// waiting | ready | approved | extended.
  final String state;
  final Recommendation? recommendation;
  final List<ConfirmationFact> facts;
  final String? answerComment;
  final int? answerMonths;
}

/// The calls. The screens only talk to this, so tests hand them a fake.
abstract class ConfirmationApi {
  Future<ConfirmationReview> review(String journeyId);
  Future<ConfirmationReview> sendReview(String journeyId, {required String outcome, int? extendMonths, required String kpis, required String strengths, required String next});
  Future<ConfirmationApproval> approval(String journeyId);
  Future<ConfirmationApproval> answerApproval(String journeyId, String action, {int? extendMonths, String? comment});
}

class HttpConfirmationApi implements ConfirmationApi {
  HttpConfirmationApi({required this.session, String? baseUrl, http.Client? client})
    : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
      _client = client ?? ApiClient.shared;

  /// The signed-in shell's API, when it talks to the server.
  static ConfirmationApi? from(OnboardingApi api) => api is HttpOnboardingApi ? HttpConfirmationApi(session: api.session) : null;

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

  @override
  Future<ConfirmationReview> review(String journeyId) async => ConfirmationReview.fromJson(await _json('GET', '${_j(journeyId)}/review'));

  @override
  Future<ConfirmationReview> sendReview(String journeyId, {required String outcome, int? extendMonths, required String kpis, required String strengths, required String next}) async =>
      ConfirmationReview.fromJson(
        await _json(
          'POST',
          '${_j(journeyId)}/review',
          body: {'outcome': outcome, 'extendMonths': ?extendMonths, 'kpis': kpis, 'strengths': strengths, 'next': next},
        ),
      );

  @override
  Future<ConfirmationApproval> approval(String journeyId) async => ConfirmationApproval.fromJson(await _json('GET', '${_j(journeyId)}/confirmation'));

  @override
  Future<ConfirmationApproval> answerApproval(String journeyId, String action, {int? extendMonths, String? comment}) async => ConfirmationApproval.fromJson(
    await _json(
      'POST',
      '${_j(journeyId)}/confirmation',
      body: {'action': action, 'extendMonths': ?extendMonths, if (comment != null && comment.trim().isNotEmpty) 'comment': comment.trim()},
    ),
  );
}
