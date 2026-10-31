/// The face check as the server describes it: whether the company uses it,
/// whether this person has set it up, the consent they are asked to agree
/// to, how the check is run, and who their manager is (for the fallback).
class FaceIdStatus {
  const FaceIdStatus({
    required this.checkAtPunch,
    required this.enrolled,
    required this.consent,
    required this.liveness,
    required this.maxAttempts,
    required this.failedAttempts,
    required this.fallbackAvailable,
    this.managerName,
  });

  factory FaceIdStatus.fromJson(Map<String, dynamic> json) => FaceIdStatus(
    checkAtPunch: json['checkAtPunch'] == true,
    enrolled: json['enrolled'] == true,
    consent: FaceConsent.fromJson(
      json['consent'] as Map<String, dynamic>? ?? const {},
    ),
    liveness: FaceLivenessConfig.fromJson(
      json['liveness'] as Map<String, dynamic>? ?? const {},
    ),
    maxAttempts: (json['maxAttempts'] as num?)?.toInt() ?? 3,
    failedAttempts: (json['failedAttempts'] as num?)?.toInt() ?? 0,
    fallbackAvailable: json['fallbackAvailable'] == true,
    managerName: json['managerName'] as String?,
  );

  final bool checkAtPunch;
  final bool enrolled;
  final FaceConsent consent;
  final FaceLivenessConfig liveness;
  final int maxAttempts;
  final int failedAttempts;
  final bool fallbackAvailable;

  /// Who a punch sent instead of the check goes to; null when nobody is set.
  final String? managerName;
}

/// The line the person ticks, as the server has it, word for word. The
/// version goes back with the enrolment, so the record says which line was
/// agreed to.
class FaceConsent {
  const FaceConsent({required this.version, required this.agree});

  factory FaceConsent.fromJson(Map<String, dynamic> json) => FaceConsent(
    version: json['version'] as String? ?? '',
    agree: json['agree'] as String? ?? '',
  );

  final String version;
  final String agree;
}

/// How the live-person check runs: Rekognition Face Liveness streamed from
/// the phone ('aws'), or the app's burst with the server's screen detector
/// ('device').
class FaceLivenessConfig {
  const FaceLivenessConfig({
    required this.mode,
    this.region,
    this.identityPoolId,
  });

  factory FaceLivenessConfig.fromJson(Map<String, dynamic> json) =>
      FaceLivenessConfig(
        mode: json['mode'] as String? ?? 'device',
        region: json['region'] as String?,
        identityPoolId: json['identityPoolId'] as String?,
      );

  final String mode;
  final String? region;
  final String? identityPoolId;

  bool get aws => mode == 'aws';
}

/// One check, as the server judged it. A failure is a result, not an error:
/// it says why, how many tries are left and whether the manager can be asked.
class FaceCheckResult {
  const FaceCheckResult({
    required this.passed,
    required this.reason,
    required this.message,
    this.token,
    this.attemptsLeft = 0,
    this.fallbackAvailable = false,
  });

  factory FaceCheckResult.fromJson(Map<String, dynamic> json) =>
      FaceCheckResult(
        passed: json['passed'] == true,
        reason: json['reason'] as String? ?? 'not_a_match',
        message:
            json['message'] as String? ??
            "This doesn't match the face set up for your account.",
        token: json['token'] as String?,
        attemptsLeft: (json['attemptsLeft'] as num?)?.toInt() ?? 0,
        fallbackAvailable: json['fallbackAvailable'] == true,
      );

  final bool passed;
  final String reason;
  final String message;

  /// Spent by the punch that follows; valid for a few minutes, once.
  final String? token;
  final int attemptsLeft;
  final bool fallbackAvailable;

  /// Whether the check could not be judged (a poor picture, the detector
  /// unsure, the service down) rather than the face not matching: not one of
  /// the day's tries.
  bool get inconclusive => !const {'not_a_match', 'other_person', 'already_enrolled_elsewhere', 'matched'}.contains(reason);

  /// The camera's headline for a failed check: four or five words, phrased
  /// as the fix where there is one.
  String get title => switch (reason) {
    'no_face' => 'Face not detected',
    'multiple_faces' => 'Only one face in the frame',
    'too_dark' => 'Too dark here',
    'too_bright' => 'Turn away from the window',
    'blurry' => 'Hold the phone still',
    'face_turned' => 'Face the camera',
    'eyes_closed' => 'Keep your eyes open',
    'face_covered' => 'Uncover your face',
    'too_small' => 'Move a little closer',
    'uncertain' => 'Move a little closer',
    'spoof' => 'Please use your face, not a photo or a screen',
    'liveness_failed' => 'Please use your face, not a photo or a screen',
    'unavailable' => 'Face check unavailable',
    _ => "We couldn't confirm it's you",
  };
}

/// A Face Liveness session the server opened for the phone to stream into.
class FaceLivenessSession {
  const FaceLivenessSession({
    required this.sessionId,
    required this.region,
    required this.identityPoolId,
  });

  factory FaceLivenessSession.fromJson(Map<String, dynamic> json) =>
      FaceLivenessSession(
        sessionId: json['sessionId'] as String? ?? '',
        region: json['region'] as String? ?? 'ap-south-1',
        identityPoolId: json['identityPoolId'] as String? ?? '',
      );

  final String sessionId;
  final String region;
  final String identityPoolId;
}
