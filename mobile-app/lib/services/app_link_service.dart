import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';

import 'notification_service.dart';

/// The links in notification emails open the app on the thing they are about.
///
/// A link is `https://go.getsowaka.com/open?type=leave&view=inbox&requestId=…`:
/// the app's own domain, which iOS (universal links) and Android (app links)
/// hand to the app when it is installed, with the same fields in the query
/// that a push carries in its `data`. So a link goes where the push would:
/// through [AppNotificationService.openDestination], which the home screen
/// listens to, and which keeps the link until the home screen is up when the
/// app was closed or someone still has to sign in.
class AppLinkService {
  AppLinkService._();
  static final instance = AppLinkService._();

  /// The domain the links are on; the manifest and the entitlements name it too.
  static const host = 'go.getsowaka.com';

  StreamSubscription<Uri>? _subscription;
  Uri? _last;
  DateTime? _lastAt;

  /// Reads the link the app was opened from, if any, and listens for the
  /// next ones. Never throws: a phone without the plugin just has no links.
  Future<void> start() async {
    if (kIsWeb) return;
    try {
      final links = AppLinks();
      _subscription = links.uriLinkStream.listen(
        open,
        onError: (Object error) => debugPrint('App link not read: $error'),
      );
      final initial = await links.getInitialLink();
      if (initial != null) open(initial);
    } catch (error) {
      debugPrint('App links not set up: $error');
    }
  }

  /// Takes a link where it points. The same link twice within a moment (the
  /// plugin reports the opening link on both paths on some phones) counts once.
  void open(Uri uri) {
    final now = DateTime.now();
    if (_last == uri &&
        _lastAt != null &&
        now.difference(_lastAt!) < const Duration(seconds: 2)) {
      return;
    }
    _last = uri;
    _lastAt = now;
    final data = appLinkDestination(uri);
    if (data == null) return;
    AppNotificationService.instance.openDestination(data);
  }

  void dispose() {
    _subscription?.cancel();
    _subscription = null;
  }
}

/// What a link asks the app to open, as a push's `data` would say it, or null
/// for a link that is not one of ours (another path, or nothing to open).
///
/// Two spellings open the same thing: `https://go.getsowaka.com/open?…`, the
/// one emails carry, and `sowaka://open?…`, which the page at that address
/// offers when the phone did not hand the https link to the app.
Map<String, dynamic>? appLinkDestination(Uri uri) {
  final path = uri.path.endsWith('/') && uri.path.length > 1
      ? uri.path.substring(0, uri.path.length - 1)
      : uri.path;
  final ours = uri.scheme == 'sowaka'
      ? uri.host == 'open' && (path.isEmpty || path == '/')
      : path == '/open';
  if (!ours) return null;
  final data = <String, dynamic>{};
  uri.queryParameters.forEach((key, value) {
    if (key.isNotEmpty && value.isNotEmpty) data[key] = value;
  });
  return data.isEmpty ? null : data;
}
