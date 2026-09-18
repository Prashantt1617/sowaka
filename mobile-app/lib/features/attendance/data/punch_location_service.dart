import 'package:geolocator/geolocator.dart';

/// Why a location could not be read, in the terms the punch screen explains it.
enum PunchLocationProblem {
  /// Location services are switched off for the whole device.
  servicesOff,

  /// The person said no this time. Asking again is allowed.
  denied,

  /// The person said never. Only Settings can undo it.
  deniedForever,

  /// The fix never arrived, or took too long to be worth waiting for.
  unavailable,
}

class PunchLocationException implements Exception {
  const PunchLocationException(this.problem);
  final PunchLocationProblem problem;

  String get message => switch (problem) {
    PunchLocationProblem.servicesOff =>
      'Location is switched off on this device. Turn it on to punch in.',
    PunchLocationProblem.denied =>
      'Sowaka needs your location to check you are at the office.',
    PunchLocationProblem.deniedForever =>
      'Location is blocked for Sowaka. Allow it in Settings to punch in.',
    PunchLocationProblem.unavailable =>
      'Enable to fetch the location.',
  };
}

/// A reading, as the device reported it.
///
/// Deliberately not a verdict: whether this counts as being at the office is
/// the server's call, so nothing here decides anything.
class PunchReading {
  const PunchReading({
    required this.latitude,
    required this.longitude,
    this.accuracy,
    this.mocked = false,
  });

  final double latitude;
  final double longitude;

  /// The fix's own error radius in metres — the server refuses a reading too
  /// vague to place.
  final double? accuracy;

  /// The OS flagged this as coming from a mock provider.
  final bool mocked;

  Map<String, dynamic> toJson() => {
    'latitude': latitude,
    'longitude': longitude,
    if (accuracy != null) 'accuracy': accuracy,
    if (mocked) 'mocked': true,
  };

  @override
  String toString() =>
      '$latitude, $longitude (±${accuracy?.round() ?? '?'}m)'
      '${mocked ? ' [mocked]' : ''}';
}

/// Reads where the device is, for a punch.
class PunchLocationService {
  const PunchLocationService();

  /// Asks for a fix, prompting for permission if it has not been given.
  ///
  /// Throws [PunchLocationException] rather than returning null, so the caller
  /// has to say something useful about why — every one of these has its own
  /// remedy, and a single "location failed" leaves people stuck.
  /// Whether the OS will show its permission prompt on the next read.
  ///
  /// Asked so the app can explain itself first (node 2288:10500): the system
  /// dialog is the one chance to get a yes, and it is far more likely to be
  /// granted by someone who already knows why it is being asked.
  Future<bool> get needsPermission async =>
      await Geolocator.checkPermission() == LocationPermission.denied;

  /// The longest the whole check may take before it gives up.
  ///
  /// Every individual step already has its own limit, but a platform that
  /// simply never answers left someone holding a spinner at the door with no
  /// way forward. A refusal they can act on beats waiting forever.
  static const _overallLimit = Duration(seconds: 30);

  Future<PunchReading> read() =>
      _read().timeout(
        _overallLimit,
        onTimeout: () => throw const PunchLocationException(
          PunchLocationProblem.unavailable,
        ),
      );

  Future<PunchReading> _read() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const PunchLocationException(PunchLocationProblem.servicesOff);
    }

    LocationPermission permission;
    try {
      permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
    } catch (_) {
      // The platform refused to even ask — a build missing its usage
      // description reaches here. Nothing the employee can do about it, so it
      // reads as location being unavailable rather than as a refusal by them.
      throw const PunchLocationException(PunchLocationProblem.unavailable);
    }
    if (permission == LocationPermission.deniedForever) {
      throw const PunchLocationException(PunchLocationProblem.deniedForever);
    }
    if (permission == LocationPermission.denied) {
      throw const PunchLocationException(PunchLocationProblem.denied);
    }

    try {
      // High accuracy, because the whole question is which building this is.
      // Capped in time so a phone that cannot get a fix says so rather than
      // leaving someone holding a spinner at the door.
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 20),
        ),
      );
      return PunchReading(
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        mocked: position.isMocked,
      );
    } on PunchLocationException {
      rethrow;
    } catch (_) {
      throw const PunchLocationException(PunchLocationProblem.unavailable);
    }
  }

  /// Opens the OS settings page, for the case where only Settings can help.
  Future<void> openSettings() => Geolocator.openAppSettings();
}

/// A place the org accepts punches from, as the app is told about it.
class PunchOffice {
  const PunchOffice({
    required this.id,
    required this.name,
    required this.city,
    required this.radiusMeters,
  });

  final String id;
  final String name;
  final String city;
  final double radiusMeters;

  /// "Sowaka Office · Gurugram", or just the name when there is no city.
  String get label => city.isEmpty ? name : '$name · $city';

  factory PunchOffice.fromJson(Map<String, dynamic> json) => PunchOffice(
    id: json['id'] as String? ?? '',
    name: json['name'] as String? ?? 'Office',
    city: json['city'] as String? ?? '',
    radiusMeters: (json['radiusMeters'] as num?)?.toDouble() ?? 200,
  );
}
