import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:cached_network_image/cached_network_image.dart';

class ApiConfig {
  const ApiConfig._();

  // Hosted backend. Override for local dev with:
  //   flutter run --dart-define=API_BASE_URL=http://localhost:4000
  static const String _defaultBaseUrl = 'https://d3lwup4rvo6csf.cloudfront.net';

  /// Where the privacy policy is published.
  ///
  /// The app links out to the hosted page rather than carrying its own copy,
  /// so the policy people read is the same one the store listing points at and
  /// there is only ever one version of it. Override per environment with
  /// `--dart-define=PRIVACY_POLICY_URL=...`.
  static const String _defaultPrivacyPolicyUrl =
      'https://www.getsowaka.com/privacy-policy.index';

  static String get privacyPolicyUrl {
    const configured = String.fromEnvironment('PRIVACY_POLICY_URL');
    return configured.isNotEmpty ? configured : _defaultPrivacyPolicyUrl;
  }

  /// Where someone asks for their account and data to be deleted.
  ///
  /// A separate page from the policy because the stores ask for a route a
  /// person can use without the app installed, and because someone looking for
  /// it should not have to read a policy to find it. Override with
  /// `--dart-define=DATA_DELETION_URL=...`.
  static const String _defaultDataDeletionUrl =
      'https://www.getsowaka.com/datadeletion.index';

  static String get dataDeletionUrl {
    const configured = String.fromEnvironment('DATA_DELETION_URL');
    return configured.isNotEmpty ? configured : _defaultDataDeletionUrl;
  }

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
///
/// Given a [width], a picture of ours (`/media/...`) is asked for at that
/// width (`?w=`): the server keeps copies at 256, 720, 1080 and 1600 px and
/// sends the smallest at least that wide, rather than the camera's original
/// (1.8 MB on average). [original] asks for the upload as it came, for a
/// photo opened full screen. Anyone else's URL passes through untouched.
String resolveMediaUrl(String url, {int? width, bool original = false}) {
  final absolute = url.startsWith('/') ? '${ApiConfig.baseUrl}$url' : url;
  final ours = url.startsWith('/media/') || url.startsWith('${ApiConfig.baseUrl}/media/');
  if (!ours || (width == null && !original)) return absolute;
  final uri = Uri.parse(absolute);
  final query = Map<String, String>.of(uri.queryParameters)..remove('w')..remove('original');
  if (original) {
    query['original'] = '1';
  } else {
    query['w'] = '$width';
  }
  return uri.replace(queryParameters: query).toString();
}

/// The width a face is fetched and decoded at: the server's smallest copy,
/// sharp on the biggest avatar the app draws.
const int avatarImageWidth = 256;

/// The width a picture in the feed is fetched and decoded at: full width on
/// a phone at 3x. One width for every place a post's picture shows (card,
/// grid tile, poll option, entry), so each is downloaded and decoded once.
const int feedImageWidth = 1080;

/// [provider] decoded no wider than [width] pixels, at its own shape. A
/// 4000 px photo decoded whole for a 390 pt card held ~48 MB of memory.
ImageProvider _decodedAt(ImageProvider provider, int? width) =>
    width == null ? provider : ResizeImage(provider, width: width, allowUpscaling: false);

/// A picture or face the API handed back, as an image: `/media/...` paths
/// and absolute URLs fetched (asked for at [width] and decoded at it) and
/// cached on disk by URL, so one seen once is not fetched again, on this
/// scroll or the next launch — keys are immutable, so the cache never goes
/// stale — and legacy inline `data:` URIs decoded in place.
ImageProvider mediaImageProvider(String url, {int? width, bool original = false}) {
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
  if (original) return CachedNetworkImageProvider(resolveMediaUrl(url, original: true));
  // A URL the server already sized (a face comes as `?w=256`) keeps the
  // smaller of the two: a face shown in a feed card is still a face, and one
  // URL per face means one download.
  final given = int.tryParse(Uri.tryParse(url)?.queryParameters['w'] ?? '');
  final wanted = width == null ? given : (given == null ? width : (given < width ? given : width));
  return _decodedAt(CachedNetworkImageProvider(resolveMediaUrl(url, width: wanted)), wanted);
}

/// Image provider for any avatar the API hands back: the small copy,
/// decoded small.
ImageProvider avatarImageProvider(String url) => mediaImageProvider(url, width: avatarImageWidth);
