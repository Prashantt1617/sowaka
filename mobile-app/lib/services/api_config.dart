import 'dart:convert';

import 'package:flutter/widgets.dart';

class ApiConfig {
  const ApiConfig._();

  // Hosted backend. Override for local dev with:
  //   flutter run --dart-define=API_BASE_URL=http://localhost:4000
  static const String _defaultBaseUrl = 'https://d3lwup4rvo6csf.cloudfront.net';

  static String get baseUrl {
    const configured = String.fromEnvironment('API_BASE_URL');
    if (configured.isNotEmpty) return configured;
    return _defaultBaseUrl;
  }
}

/// Resolves an image reference from the API into something loadable.
///
/// Media held in the server's Mongo fallback comes back as a root-relative path
/// (`/media/...`) rather than an absolute URL, because clients reach the API on
/// different hosts — a phone over the LAN, desktop over localhost — so each has
/// to resolve it against its own base. Absolute URLs pass through untouched.
String resolveMediaUrl(String url) {
  if (url.startsWith('/')) return '${ApiConfig.baseUrl}$url';
  return url;
}

/// Image provider for any avatar/media reference the API hands back, covering
/// both the relative `/media/...` paths and legacy inline `data:` URIs that
/// predate them (`NetworkImage` can't load a `data:` URI).
ImageProvider avatarImageProvider(String url) {
  if (url.startsWith('data:')) {
    final comma = url.indexOf(',');
    if (comma != -1) {
      try {
        return MemoryImage(base64Decode(url.substring(comma + 1)));
      } catch (_) {
        // Fall through — a malformed data URI just fails to load.
      }
    }
  }
  return NetworkImage(resolveMediaUrl(url));
}
