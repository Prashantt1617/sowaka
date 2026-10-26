import 'dart:async';

import 'package:http/http.dart' as http;

/// The one HTTP client the app's API services share, with a time limit on
/// every request.
///
/// Each service used to make its own `http.Client()`, fifteen in all, each
/// with its own pool of connections to the same host: a fresh TLS handshake
/// per service, and none of them ever gave up on a request. A call the
/// server never answered held its spinner until the app was closed.
///
/// Never closed: it lives as long as the app. A service handed a client of
/// its own (the tests) uses that instead.
class ApiClient {
  ApiClient._();

  static final http.Client shared = TimedClient(http.Client());
}

/// Gives up on a request the server has not started answering in time, with
/// a [TimeoutException], which [NetworkStatus.isNetworkError] already counts
/// as the network failing.
///
/// The limit is on the answer, not the body after it: every reply the app
/// reads is small JSON that follows its headers at once. (A stall-timer on
/// the body stream never delivered the test binding's canned replies, which
/// every widget test that reaches the network relies on.)
class TimedClient extends http.BaseClient {
  TimedClient(this._inner);

  final http.Client _inner;

  /// Until the server starts answering an ordinary call.
  static const answer = Duration(seconds: 20);

  /// For an upload (a photo, a video, an attachment): the clock runs while
  /// the bytes go up, and a 50 MB video on a slow line takes minutes.
  static const upload = Duration(minutes: 4);

  static Duration limitFor(http.BaseRequest request) {
    final big = request is http.MultipartRequest ||
        request is http.StreamedRequest ||
        (request.contentLength ?? 0) > 256 * 1024;
    return big ? upload : answer;
  }

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      _inner.send(request).timeout(limitFor(request));

  @override
  void close() => _inner.close();
}
