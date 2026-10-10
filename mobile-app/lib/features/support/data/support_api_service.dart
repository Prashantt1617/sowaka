import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import '../../shared/network_status.dart';
import 'support_models.dart';

/// A Support call that did not work. [message] is always fit to show: the
/// API turns a missing route, a server fault or a dead connection into plain
/// words here, so no screen ever shows a route or a stack.
class SupportApiException implements Exception {
  const SupportApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  /// A server without the Support routes yet — production, until the
  /// backend ships them.
  static const unavailable =
      'Support desk isn\'t available yet. Try again later.';
  static const failed = 'Something went wrong. Try again.';
  static const offline = 'No internet connection';
  static const tooSlow = 'The support desk is taking too long. Try again.';

  @override
  String toString() => message;
}

/// What a Support screen says when a call fails: the API's own words, and a
/// plain line for anything else — never an exception's text.
String supportErrorText(Object error) =>
    error is SupportApiException ? error.message : SupportApiException.failed;

/// A file chosen to go with a request or a reply: read from [path] on a
/// device, or handed over as [bytes] (tests, the web).
class SupportUpload {
  const SupportUpload({
    required this.name,
    required this.size,
    this.path,
    this.bytes,
  });

  final String name;
  final int size;
  final String? path;
  final Uint8List? bytes;

  /// What the server is told the file is. It accepts images and PDFs only.
  MediaType get mediaType {
    final extension = name.contains('.')
        ? name.split('.').last.toLowerCase()
        : '';
    return switch (extension) {
      'pdf' => MediaType('application', 'pdf'),
      'png' => MediaType('image', 'png'),
      'heic' => MediaType('image', 'heic'),
      'heif' => MediaType('image', 'heif'),
      'webp' => MediaType('image', 'webp'),
      _ => MediaType('image', 'jpeg'),
    };
  }
}

/// The employee's Support desk: `/support` on the API.
class SupportApiService {
  SupportApiService({
    required this.session,
    String? baseUrl,
    http.Client? client,
  }) : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
       _client = client ?? testClient ?? http.Client();

  /// Answers every request the Support screens make, in tests. The screens
  /// build their own service from the session, so this is where a test
  /// reaches it.
  @visibleForTesting
  static http.Client? testClient;

  /// At most this many files go with one message, each under [maxFileBytes].
  static const maxFiles = 5;
  static const maxFileBytes = 10 * 1024 * 1024;

  /// How long a call may take before it counts as failed: a message left on
  /// "Sending…" for good is worse than one marked to retry. Files get longer,
  /// as five photos on a slow connection are a minute's upload.
  static const requestTimeout = Duration(seconds: 30);
  static const uploadTimeout = Duration(minutes: 2);

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;

  Future<List<SupportTopic>> fetchTopics() async {
    final json = await _json('GET', '/support/topics');
    return [
      for (final item in json['topics'] as List<dynamic>? ?? const [])
        if (item is Map<String, dynamic>) SupportTopic.fromJson(item),
    ];
  }

  /// The person's own tickets, the most recently active first.
  Future<List<SupportTicket>> fetchTickets() async {
    final json = await _json('GET', '/support/tickets');
    return [
      for (final item in json['tickets'] as List<dynamic>? ?? const [])
        if (item is Map<String, dynamic>) SupportTicket.fromJson(item),
    ];
  }

  /// Raises a request. The server opens the thread with it and adds its
  /// automatic reply, and hands both back.
  Future<SupportThread> createTicket({
    required String topic,
    required String text,
    List<SupportUpload> files = const [],
  }) async {
    final json = files.isEmpty
        ? await _json(
            'POST',
            '/support/tickets',
            body: {'topic': topic, 'text': text},
          )
        : await _multipart(
            '/support/tickets',
            fields: {'topic': topic, 'text': text},
            files: files,
          );
    return SupportThread.fromJson(json);
  }

  /// The ticket and its thread. Reading it marks the HR team's replies read.
  Future<SupportThread> fetchTicket(String id) async =>
      SupportThread.fromJson(await _json('GET', '/support/tickets/${_id(id)}'));

  /// A reply on the thread. Refused once the ticket is resolved.
  Future<SupportMessage> sendMessage(
    String ticketId, {
    required String text,
    List<SupportUpload> files = const [],
  }) async {
    final path = '/support/tickets/${_id(ticketId)}/messages';
    final json = files.isEmpty
        ? await _json('POST', path, body: {'text': text})
        : await _multipart(path, fields: {'text': text}, files: files);
    return SupportMessage.fromJson(
      json['message'] as Map<String, dynamic>? ?? const {},
    );
  }

  String _id(String id) => Uri.encodeComponent(id);

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

  Future<Map<String, dynamic>> _multipart(
    String path, {
    required Map<String, String> fields,
    required List<SupportUpload> files,
  }) async {
    final request = http.MultipartRequest('POST', Uri.parse('$_baseUrl$path'))
      ..headers['Authorization'] = 'Bearer ${session.token}'
      ..fields.addAll(fields);
    for (final file in files) {
      final bytes = file.bytes;
      final path = file.path;
      if (bytes != null) {
        request.files.add(
          http.MultipartFile.fromBytes(
            'files',
            bytes,
            filename: file.name,
            contentType: file.mediaType,
          ),
        );
      } else if (path != null) {
        request.files.add(
          await http.MultipartFile.fromPath(
            'files',
            path,
            filename: file.name,
            contentType: file.mediaType,
          ),
        );
      }
    }
    return _send(request, limit: uploadTimeout);
  }

  Future<Map<String, dynamic>> _send(
    http.BaseRequest request, {
    Duration limit = requestTimeout,
  }) async {
    final http.Response response;
    try {
      response = await _client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(limit);
    } catch (error) {
      NetworkStatus.reportFailure(error, probe: Uri.parse('$_baseUrl/health'));
      throw SupportApiException(switch (error) {
        TimeoutException() => SupportApiException.tooSlow,
        _ when NetworkStatus.isNetworkError(error) =>
          SupportApiException.offline,
        _ => SupportApiException.failed,
      });
    }
    NetworkStatus.reportSuccess();
    Map<String, dynamic> json;
    try {
      final body = response.body.isEmpty
          ? null
          : jsonDecode(utf8.decode(response.bodyBytes));
      // A proxy's page or anything else that is not the API's own reply.
      json = body is Map<String, dynamic> ? body : <String, dynamic>{};
    } on FormatException {
      json = <String, dynamic>{};
    }
    final status = response.statusCode;
    if (status < 200 || status >= 300) {
      final said = json['message'] is String
          ? (json['message'] as String).trim()
          : '';
      throw SupportApiException(switch (status) {
        // No such route: a server that predates the desk. A 404 the desk
        // itself sends ("Ticket not found") says so in its own words.
        404 when said.isEmpty || said.startsWith('Route not found') =>
          SupportApiException.unavailable,
        >= 500 => SupportApiException.failed,
        _ when said.isEmpty => SupportApiException.failed,
        _ => said,
      }, statusCode: status);
    }
    return json;
  }
}
