/// Face ID as the server describes it: whether the company uses it, whether
/// this person has set it up, the consent they are asked to agree to, and how
/// the check is run.
class FaceIdStatus {
  const FaceIdStatus({
    required this.setupRequired,
    required this.checkAtPunch,
    required this.enrolled,
    required this.consent,
    required this.liveness,
    required this.maxAttempts,
    required this.failedAttempts,
    required this.fallbackAvailable,
  });

  factory FaceIdStatus.fromJson(Map<String, dynamic> json) => FaceIdStatus(
    setupRequired: json['setupRequired'] == true,
    checkAtPunch: json['checkAtPunch'] == true,
    enrolled: json['enrolled'] == true,
    consent: FaceConsent.fromJson(json['consent'] as Map<String, dynamic>? ?? const {}),
    liveness: FaceLivenessConfig.fromJson(json['liveness'] as Map<String, dynamic>? ?? const {}),
    maxAttempts: (json['maxAttempts'] as num?)?.toInt() ?? 3,
    failedAttempts: (json['failedAttempts'] as num?)?.toInt() ?? 0,
    fallbackAvailable: json['fallbackAvailable'] == true,
  );

  final bool setupRequired;
  final bool checkAtPunch;
  final bool enrolled;
  final FaceConsent consent;
  final FaceLivenessConfig liveness;
  final int maxAttempts;
  final int failedAttempts;
  final bool fallbackAvailable;
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
/// the phone ('aws'), or the app's own blink-or-turn prompt ('device').
class FaceLivenessConfig {
  const FaceLivenessConfig({required this.mode, this.region, this.identityPoolId});

  factory FaceLivenessConfig.fromJson(Map<String, dynamic> json) => FaceLivenessConfig(
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

  factory FaceCheckResult.fromJson(Map<String, dynamic> json) => FaceCheckResult(
    passed: json['passed'] == true,
    reason: json['reason'] as String? ?? 'not_a_match',
    message: json['message'] as String? ?? "This doesn't match the face set up for your account.",
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

  /// The status row's heading for a failed check.
  String get title => switch (reason) {
    'no_face' => 'Face not detected',
    'multiple_faces' => 'More than one face',
    'too_dark' => 'Too dark',
    'too_bright' => 'Too bright',
    'blurry' => 'Picture is blurry',
    'face_turned' => 'Look straight ahead',
    'eyes_closed' => 'Eyes closed',
    'face_covered' => 'Face covered',
    'too_small' => 'Move closer',
    'liveness_failed' => 'Liveness check failed',
    'unavailable' => 'Face check unavailable',
    _ => 'Face not matched',
  };
}

/// A Face Liveness session the server opened for the phone to stream into.
class FaceLivenessSession {
  const FaceLivenessSession({required this.sessionId, required this.region, required this.identityPoolId});

  factory FaceLivenessSession.fromJson(Map<String, dynamic> json) => FaceLivenessSession(
    sessionId: json['sessionId'] as String? ?? '',
    region: json['region'] as String? ?? 'ap-south-1',
    identityPoolId: json['identityPoolId'] as String? ?? '',
  );

  final String sessionId;
  final String region;
  final String identityPoolId;
}
