import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import 'connect_models.dart';

class ConnectApiService {
  ConnectApiService({
    required this.session,
    String? baseUrl,
    http.Client? client,
  }) : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
       _client = client ?? http.Client();

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;

  Future<List<ConnectPost>> fetchFeed() async {
    final json = await _request('GET', '/connect/feed');
    final values = json['posts'] as List<dynamic>? ?? const [];
    return values
        .map((value) => ConnectPost.fromJson(value as Map<String, dynamic>))
        .toList();
  }

  bool _hasUpload(ConnectPostDraft draft) =>
      draft.media != null ||
      draft.mediaList.isNotEmpty ||
      draft.pollOptionImages.any((item) => item != null);

  Future<ConnectPost> createPost(ConnectPostDraft draft) async {
    if (_hasUpload(draft)) {
      final json = await _multipartRequest('POST', '/connect/posts', draft);
      return ConnectPost.fromJson(json['post'] as Map<String, dynamic>);
    }
    final json = await _request('POST', '/connect/posts', body: draft.toJson());
    return ConnectPost.fromJson(json['post'] as Map<String, dynamic>);
  }

  Future<ConnectPost> updatePost(String postId, ConnectPostDraft draft) async {
    if (_hasUpload(draft)) {
      final json = await _multipartRequest(
        'PATCH',
        '/connect/posts/$postId',
        draft,
      );
      return ConnectPost.fromJson(json['post'] as Map<String, dynamic>);
    }
    final json = await _request(
      'PATCH',
      '/connect/posts/$postId',
      body: draft.toJson(),
    );
    return ConnectPost.fromJson(json['post'] as Map<String, dynamic>);
  }

  Future<void> deletePost(String postId) async {
    await _request('DELETE', '/connect/posts/$postId');
  }

  Future<ConnectPost> toggleReaction(String postId) async {
    final json = await _request('POST', '/connect/posts/$postId/reaction');
    return ConnectPost.fromJson(json['post'] as Map<String, dynamic>);
  }

  Future<ConnectPost> addComment(
    String postId,
    String text, {
    String? parentId,
  }) async {
    final json = await _request(
      'POST',
      '/connect/posts/$postId/comments',
      body: {'text': text, 'parentId': ?parentId},
    );
    return ConnectPost.fromJson(json['post'] as Map<String, dynamic>);
  }

  Future<ConnectPost> reactToComment(String postId, String commentId) async {
    final json = await _request(
      'POST',
      '/connect/posts/$postId/comments/$commentId/reaction',
    );
    return ConnectPost.fromJson(json['post'] as Map<String, dynamic>);
  }

  Future<ConnectPost> performAction(String postId, {String? optionId}) async {
    final json = await _request(
      'POST',
      '/connect/posts/$postId/actions',
      body: optionId == null ? null : {'optionId': optionId},
    );
    return ConnectPost.fromJson(json['post'] as Map<String, dynamic>);
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final uri = Uri.parse('$_baseUrl$path');
    final headers = {
      'Authorization': 'Bearer ${session.token}',
      'Content-Type': 'application/json',
    };
    final response = await switch (method) {
      'GET' => _client.get(uri, headers: headers),
      'POST' => _client.post(
        uri,
        headers: headers,
        body: body == null ? null : jsonEncode(body),
      ),
      'PATCH' => _client.patch(
        uri,
        headers: headers,
        body: body == null ? null : jsonEncode(body),
      ),
      'DELETE' => _client.delete(uri, headers: headers),
      _ => throw UnsupportedError('Unsupported method $method'),
    };

    final decoded = _decodeResponse(response);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded;
    }
    final message = decoded['message'] as String? ?? 'Connect request failed';
    throw ConnectApiException(message, response.statusCode);
  }

  Future<Map<String, dynamic>> _multipartRequest(
    String method,
    String path,
    ConnectPostDraft draft,
  ) async {
    final request = http.MultipartRequest(method, Uri.parse('$_baseUrl$path'));
    request.headers['Authorization'] = 'Bearer ${session.token}';
    request.fields['type'] = connectPostTypeToWire(draft.type);
    request.fields['removeMedia'] = draft.removeMedia ? 'true' : 'false';
    request.fields['body'] = jsonEncode(draft.body);
    final mediaFiles = draft.mediaList.isNotEmpty
        ? draft.mediaList
        : (draft.media != null ? [draft.media!] : const <ConnectMediaAttachment>[]);
    for (final attachment in mediaFiles) {
      request.files.add(
        await http.MultipartFile.fromPath(
          'media',
          attachment.path,
          filename: attachment.name,
          contentType: _mediaType(attachment.mimeType),
        ),
      );
    }
    // Options without an image are skipped when uploading, so the backend
    // needs to know which option index each uploaded file actually belongs
    // to rather than assuming a gap-free 1:1 order.
    final pollOptionImageIndexes = <int>[];
    for (final (index, attachment) in draft.pollOptionImages.indexed) {
      if (attachment == null) continue;
      pollOptionImageIndexes.add(index);
      request.files.add(
        await http.MultipartFile.fromPath(
          'pollOptionImages',
          attachment.path,
          filename: attachment.name,
          contentType: _mediaType(attachment.mimeType),
        ),
      );
    }
    if (pollOptionImageIndexes.isNotEmpty) {
      request.fields['pollOptionImageIndexes'] = jsonEncode(
        pollOptionImageIndexes,
      );
    }
    final streamed = await _client.send(request);
    final response = await http.Response.fromStream(streamed);
    final decoded = _decodeResponse(response);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded;
    }
    final message = decoded['message'] as String? ?? 'Connect request failed';
    throw ConnectApiException(message, response.statusCode);
  }

  Map<String, dynamic> _decodeResponse(http.Response response) {
    if (response.body.trim().isEmpty) return <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) return decoded;
    } on FormatException {
      // Proxies and hosting platforms may return plain text or HTML errors,
      // especially when an upload exceeds their configured request limit.
    }

    final plainText = response.body
        .replaceAll(RegExp(r'<[^>]*>'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    throw ConnectApiException(
      plainText.isEmpty
          ? 'The server returned an invalid response'
          : plainText.substring(0, plainText.length.clamp(0, 240)),
      response.statusCode,
    );
  }

  MediaType _mediaType(String value) {
    final parts = value.split('/');
    if (parts.length != 2 || parts.any((part) => part.trim().isEmpty)) {
      return MediaType('application', 'octet-stream');
    }
    return MediaType(parts[0], parts[1]);
  }
}

class ConnectApiException implements Exception {
  const ConnectApiException(this.message, this.statusCode);

  final String message;
  final int statusCode;

  @override
  String toString() => message;
}
