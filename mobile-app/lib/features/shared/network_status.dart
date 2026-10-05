import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// Whether the phone can reach the server, as the last request found it.
///
/// Nothing asks the OS: a request that fails to connect is the only fact
/// that matters, and the next one that succeeds clears it. While offline a
/// probe asks the server every ten seconds, so the banner leaves on its own
/// the moment the connection is back — nobody has to tap anything.
class NetworkStatus {
  const NetworkStatus._();

  static final ValueNotifier<bool> offline = ValueNotifier<bool>(false);
  static Timer? _probe;
  static Uri? _probeUri;

  /// Errors that mean the request never reached a server, as opposed to a
  /// server that answered with a refusal.
  static bool isNetworkError(Object error) =>
      error is SocketException ||
      error is HandshakeException ||
      error is http.ClientException ||
      error is TimeoutException;

  /// A request failed. Only a network error counts; everything else is the
  /// server talking, which means the network is fine.
  static void reportFailure(Object error, {Uri? probe}) {
    if (!isNetworkError(error)) return;
    _probeUri = probe ?? _probeUri;
    if (!offline.value) offline.value = true;
    _probe ??= Timer.periodic(const Duration(seconds: 10), (_) => _check());
  }

  /// A request got through, so the network is back.
  static void reportSuccess() {
    _probe?.cancel();
    _probe = null;
    if (offline.value) offline.value = false;
  }

  static Future<void> _check() async {
    try {
      final uri = _probeUri;
      if (uri == null) {
        await InternetAddress.lookup('getsowaka.com');
      } else {
        // Any answer at all is the server reachable; a refusal is still an answer.
        await http.get(uri).timeout(const Duration(seconds: 6));
      }
      reportSuccess();
    } catch (_) {
      // Still offline; the next tick asks again.
    }
  }
}

/// An HTTP client that tells [NetworkStatus] how each request fared, for
/// services that call the client directly rather than through one wrapper.
class ReportingClient extends http.BaseClient {
  ReportingClient(this._inner, {this.probe});

  final http.Client _inner;

  /// Where to ask whether the server is back; any reply counts.
  final Uri? probe;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    try {
      final response = await _inner.send(request);
      NetworkStatus.reportSuccess();
      return response;
    } catch (error) {
      NetworkStatus.reportFailure(error, probe: probe);
      rethrow;
    }
  }

  @override
  void close() => _inner.close();
}
