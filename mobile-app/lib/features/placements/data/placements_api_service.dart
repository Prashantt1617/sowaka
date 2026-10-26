import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../services/api_client.dart';
import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import '../../shared/network_status.dart';
import 'placements_models.dart';

/// A Placements call that did not work. [message] is always fit to show: the
/// server's own words when it gave a reason, plain ones otherwise, so no
/// screen ever shows a route or a stack.
class PlacementsApiException implements Exception {
  const PlacementsApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  /// A server without the Placements routes yet.
  static const unavailable =
      'Placements aren\'t available yet. Try again later.';
  static const failed = 'Something went wrong. Try again.';
  static const offline = 'No internet connection';
  static const tooSlow = 'Placements are taking too long. Try again.';

  @override
  String toString() => message;
}

/// What a Placements screen says when a call fails: the API's own words, and
/// a plain line for anything else — never an exception's text.
String placementsErrorText(Object error) => error is PlacementsApiException
    ? error.message
    : PlacementsApiException.failed;

/// Actions › Placements: `/placements` on the API. Only a company with the
/// feature is answered; anyone else gets a 403.
class PlacementsApiService {
  PlacementsApiService({
    required this.session,
    String? baseUrl,
    http.Client? client,
  }) : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
       _client = client ?? ApiClient.shared;

  /// How long a call may take before it counts as failed, so no spinner
  /// waits on a server that never answers.
  static const requestTimeout = Duration(seconds: 20);

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;

  Future<PlacementsSummary> fetchSummary() async =>
      PlacementsSummary.fromJson(await _json('GET', '/placements/summary'));

  /// Clients by name; [query] narrows them on the server.
  /// The company's clients, or with [mine] only those the signed-in person added.
  Future<List<PlacementClient>> fetchClients({
    String query = '',
    bool mine = false,
  }) async {
    final json = await _json(
      'GET',
      _withQuery('/placements/clients', query, mine: mine),
    );
    return [
      for (final item in json['clients'] as List<dynamic>? ?? const [])
        if (item is Map<String, dynamic>) PlacementClient.fromJson(item),
    ];
  }

  Future<PlacementClient> createClient({
    required String name,
    String contactName = '',
    String phone = '',
    String email = '',
    String industry = '',
    String city = '',
    String notes = '',
  }) async {
    final json = await _json(
      'POST',
      '/placements/clients',
      body: {
        'name': name,
        ..._present({
          'contactName': contactName,
          'phone': phone,
          'email': email,
          'industry': industry,
          'city': city,
          'notes': notes,
        }),
      },
    );
    return PlacementClient.fromJson(_object(json, 'client'));
  }

  /// Candidates by name; [query] narrows them on the server.
  Future<List<PlacementCustomer>> fetchCustomers({
    String query = '',
    bool mine = false,
  }) async {
    final json = await _json(
      'GET',
      _withQuery('/placements/customers', query, mine: mine),
    );
    return [
      for (final item in json['customers'] as List<dynamic>? ?? const [])
        if (item is Map<String, dynamic>) PlacementCustomer.fromJson(item),
    ];
  }

  Future<PlacementCustomer> createCustomer({
    required String name,
    required String phone,
    String email = '',
    String currentRole = '',
    double? experienceYears,
    List<String> skills = const [],
    String city = '',
    String notes = '',
  }) async {
    final json = await _json(
      'POST',
      '/placements/customers',
      body: {
        'name': name,
        'phone': phone,
        ..._present({
          'email': email,
          'currentRole': currentRole,
          'city': city,
          'notes': notes,
        }),
        'experienceYears': ?experienceYears,
        if (skills.isNotEmpty) 'skills': skills,
      },
    );
    return PlacementCustomer.fromJson(_object(json, 'customer'));
  }

  /// The placements this person made, newest first as the server orders
  /// them; [status] keeps one status only.
  /// A client's page: the client and every placement at it.
  Future<PlacementClientPage> fetchClient(String id) async {
    final json = await _json(
      'GET',
      '/placements/clients/${Uri.encodeComponent(id)}',
    );
    return PlacementClientPage(
      client: PlacementClient.fromJson(_object(json, 'client')),
      placements: _placements(json),
    );
  }

  /// A candidate's page: them, their placements and those clients.
  Future<PlacementCandidatePage> fetchCandidate(String id) async {
    final json = await _json(
      'GET',
      '/placements/customers/${Uri.encodeComponent(id)}',
    );
    return PlacementCandidatePage(
      candidate: PlacementCustomer.fromJson(_object(json, 'customer')),
      placements: _placements(json),
      clients: [
        for (final item in json['clients'] as List<dynamic>? ?? const [])
          if (item is Map<String, dynamic>) PlacementClient.fromJson(item),
      ],
    );
  }

  /// Adds a client ([id] null) or saves every field of one.
  Future<PlacementClient> saveClient({
    String? id,
    required String name,
    required String location,
    required List<PlacementDesignation> designations,
    required bool feePaid,
    required String feeReference,
  }) async {
    final json = await _json(
      id == null ? 'POST' : 'PATCH',
      id == null
          ? '/placements/clients'
          : '/placements/clients/${Uri.encodeComponent(id)}',
      body: {
        'name': name.trim(),
        'city': location.trim(),
        'designations': [for (final role in designations) role.toJson()],
        'feePaid': feePaid,
        'feeReference': feeReference.trim(),
      },
    );
    return PlacementClient.fromJson(_object(json, 'client'));
  }

  Future<void> deleteClient(String id) =>
      _json('DELETE', '/placements/clients/${Uri.encodeComponent(id)}');

  /// Adds a candidate ([id] null) or saves every field of one.
  Future<PlacementCustomer> saveCandidate({
    String? id,
    required String name,
    required String phone,
    required String address,
    double? experienceYears,
    required String designation,
    required String introduction,
  }) async {
    final json = await _json(
      id == null ? 'POST' : 'PATCH',
      id == null
          ? '/placements/customers'
          : '/placements/customers/${Uri.encodeComponent(id)}',
      body: {
        'name': name.trim(),
        'phone': phone.trim(),
        'address': address.trim(),
        'experienceYears': experienceYears,
        'currentRole': designation.trim(),
        'notes': introduction.trim(),
      },
    );
    return PlacementCustomer.fromJson(_object(json, 'customer'));
  }

  /// Takes a candidate off the lists, with why; HR can restore them.
  Future<void> removeCandidate(String id, String reason) => _json(
    'POST',
    '/placements/customers/${Uri.encodeComponent(id)}/remove',
    body: {'reason': reason},
  );

  /// Saves every field of a placement the app edits, clearing what is empty.
  Future<Placement> savePlacement(
    String id, {
    required PlacementStatus status,
    DateTime? interviewDate,
    DateTime? joiningDate,
    double? ctcRupees,
    String notes = '',
  }) async {
    final json = await _json(
      'PATCH',
      '/placements/${Uri.encodeComponent(id)}',
      body: {
        'status': status.key,
        'interviewDate': interviewDate == null
            ? null
            : placementDay(interviewDate),
        'joiningDate': joiningDate == null ? null : placementDay(joiningDate),
        'ctcRupees': ctcRupees,
        'notes': notes.trim(),
      },
    );
    return Placement.fromJson(_object(json, 'placement'));
  }

  List<Placement> _placements(Map<String, dynamic> json) => [
    for (final item in json['placements'] as List<dynamic>? ?? const [])
      if (item is Map<String, dynamic>) Placement.fromJson(item),
  ];

  Future<List<Placement>> fetchMyPlacements({PlacementStatus? status}) async {
    final json = await _json(
      'GET',
      '/placements?mine=1${status == null ? '' : '&status=${status.key}'}',
    );
    return [
      for (final item in json['placements'] as List<dynamic>? ?? const [])
        if (item is Map<String, dynamic>) Placement.fromJson(item),
    ];
  }

  Future<Placement> createPlacement({
    required String customerId,
    required String clientId,
    required String position,
    PlacementStatus status = PlacementStatus.shortlisted,
    DateTime? interviewDate,
    DateTime? joiningDate,
    double? ctcRupees,
    double? feeRupees,
    String notes = '',
  }) async {
    final json = await _json(
      'POST',
      '/placements',
      body: {
        'customerId': customerId,
        'clientId': clientId,
        'position': position,
        'status': status.key,
        if (interviewDate != null) 'interviewDate': placementDay(interviewDate),
        if (joiningDate != null) 'joiningDate': placementDay(joiningDate),
        'ctcRupees': ?ctcRupees,
        'feeRupees': ?feeRupees,
        ..._present({'notes': notes}),
      },
    );
    return Placement.fromJson(_object(json, 'placement'));
  }

  /// Changes what is given and leaves the rest.
  Future<Placement> updatePlacement(
    String id, {
    PlacementStatus? status,
    DateTime? interviewDate,
    DateTime? joiningDate,
    double? ctcRupees,
    double? feeRupees,
    String? notes,
  }) async {
    final json = await _json(
      'PATCH',
      '/placements/${Uri.encodeComponent(id)}',
      body: {
        if (status != null) 'status': status.key,
        if (interviewDate != null) 'interviewDate': placementDay(interviewDate),
        if (joiningDate != null) 'joiningDate': placementDay(joiningDate),
        'ctcRupees': ?ctcRupees,
        'feeRupees': ?feeRupees,
        'notes': ?notes,
      },
    );
    return Placement.fromJson(_object(json, 'placement'));
  }

  /// The optional text fields that were filled in; an empty one is left out
  /// rather than sent as "".
  Map<String, String> _present(Map<String, String> fields) => {
    for (final MapEntry(:key, :value) in fields.entries)
      if (value.trim().isNotEmpty) key: value.trim(),
  };

  String _withQuery(String path, String query, {bool mine = false}) {
    final params = [
      if (mine) 'mine=1',
      if (query.trim().isNotEmpty)
        'q=${Uri.encodeQueryComponent(query.trim())}',
    ];
    return params.isEmpty ? path : '$path?${params.join('&')}';
  }

  Map<String, dynamic> _object(Map<String, dynamic> json, String key) =>
      json[key] is Map<String, dynamic>
      ? json[key] as Map<String, dynamic>
      : const <String, dynamic>{};

  Future<Map<String, dynamic>> _json(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) {
    final request = http.Request(method, Uri.parse('$_baseUrl$path'))
      ..headers.addAll({
        'Authorization': 'Bearer ${session.token}',
        'Content-Type': 'application/json',
      });
    if (body != null) request.body = jsonEncode(body);
    return _send(request);
  }

  Future<Map<String, dynamic>> _send(http.BaseRequest request) async {
    final http.Response response;
    try {
      response = await _client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(requestTimeout);
    } catch (error) {
      NetworkStatus.reportFailure(error, probe: Uri.parse('$_baseUrl/health'));
      throw PlacementsApiException(switch (error) {
        TimeoutException() => PlacementsApiException.tooSlow,
        _ when NetworkStatus.isNetworkError(error) =>
          PlacementsApiException.offline,
        _ => PlacementsApiException.failed,
      });
    }
    NetworkStatus.reportSuccess();
    Map<String, dynamic> json;
    try {
      final decoded = response.body.isEmpty
          ? null
          : jsonDecode(utf8.decode(response.bodyBytes));
      // A proxy's page or anything else that is not the API's own reply.
      json = decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
    } on FormatException {
      json = <String, dynamic>{};
    }
    final status = response.statusCode;
    if (status < 200 || status >= 300) {
      final said = json['message'] is String
          ? (json['message'] as String).trim()
          : '';
      throw PlacementsApiException(switch (status) {
        // No such route: a server that predates Placements. A 404 the routes
        // send themselves ("Placement not found") says so in their own words.
        404 when said.isEmpty || said.startsWith('Route not found') =>
          PlacementsApiException.unavailable,
        >= 500 => PlacementsApiException.failed,
        _ when said.isEmpty => PlacementsApiException.failed,
        _ => said,
      }, statusCode: status);
    }
    return json;
  }
}
