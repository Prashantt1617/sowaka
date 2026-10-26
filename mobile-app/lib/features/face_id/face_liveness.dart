import 'package:flutter/services.dart';

/// Rekognition Face Liveness, streamed from the phone by AWS's own
/// FaceLivenessDetector (Amplify UI for Android and iOS), behind a platform
/// channel: Flutter has no official widget.
///
/// The server opens the session and reads its result; the phone only streams
/// the video, with short-lived credentials from a Cognito identity pool. Until
/// the native side is added — the Amplify Liveness package on each platform,
/// and a `sowaka/face_liveness` handler that shows FaceLivenessDetector for
/// the session and answers when it closes — this reports itself unavailable.
/// The server only asks for it once FACE_LIVENESS=on; until then the app's
/// own prompt (FaceCamera) is used.
class FaceLiveness {
  const FaceLiveness();

  static const _channel = MethodChannel('sowaka/face_liveness');

  Future<bool> isAvailable() async {
    try {
      return await _channel.invokeMethod<bool>('isAvailable') ?? false;
    } on MissingPluginException {
      return false;
    } on PlatformException {
      return false;
    }
  }

  /// Runs the check for a session the server opened. Returns 'succeeded'
  /// when the video was streamed (the server still decides the outcome),
  /// 'cancelled' when the person closed it, or 'error'.
  Future<String> run({
    required String sessionId,
    required String region,
    required String identityPoolId,
  }) async {
    try {
      final result = await _channel.invokeMethod<String>('start', {
        'sessionId': sessionId,
        'region': region,
        'identityPoolId': identityPoolId,
      });
      return result ?? 'error';
    } on MissingPluginException {
      return 'error';
    } on PlatformException {
      return 'error';
    }
  }
}
