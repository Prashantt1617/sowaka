/// Actions › Placements: a recruitment company's clients (the companies it
/// hires for), its customers (the candidates it places) and the placements
/// that join the two. Shapes as `/placements` sends them.
library;

/// Where a placement has got to, in the order a placement moves through them.
enum PlacementStatus {
  shortlisted('shortlisted', 'Shortlisted'),
  interviewing('interviewing', 'Interviewing'),
  offered('offered', 'Offered'),
  joined('joined', 'Joined'),
  dropped('dropped', 'Dropped');

  const PlacementStatus(this.key, this.label);

  /// As the server spells it.
  final String key;

  /// As the app shows it.
  final String label;

  /// The status the server sent, or Shortlisted — where every placement
  /// starts — for anything it did not recognise.
  static PlacementStatus fromKey(Object? value) {
    final key = '${value ?? ''}'.trim().toLowerCase();
    for (final status in values) {
      if (status.key == key) return status;
    }
    return shortlisted;
  }
}

/// A company the agency recruits for.
class PlacementClient {
  const PlacementClient({
    required this.id,
    required this.name,
    this.contactName = '',
    this.phone = '',
    this.email = '',
    this.industry = '',
    this.city = '',
    this.notes = '',
    this.createdAt,
  });

  factory PlacementClient.fromJson(Map<String, dynamic> json) =>
      PlacementClient(
        id: _text(json['id']),
        name: _text(json['name']),
        contactName: _text(json['contactName']),
        phone: _text(json['phone']),
        email: _text(json['email']),
        industry: _text(json['industry']),
        city: _text(json['city']),
        notes: _text(json['notes']),
        createdAt: _time(json['createdAt']),
      );

  final String id;
  final String name;
  final String contactName;
  final String phone;
  final String email;
  final String industry;
  final String city;
  final String notes;
  final DateTime? createdAt;

  /// The line under the name in a picker: whatever there is of industry and
  /// city.
  String get subtitle =>
      [industry, city].where((part) => part.isNotEmpty).join(' · ');
}

/// A candidate the agency places.
class PlacementCustomer {
  const PlacementCustomer({
    required this.id,
    required this.name,
    this.phone = '',
    this.email = '',
    this.currentRole = '',
    this.experienceYears,
    this.skills = const [],
    this.city = '',
    this.notes = '',
    this.createdAt,
  });

  factory PlacementCustomer.fromJson(Map<String, dynamic> json) =>
      PlacementCustomer(
        id: _text(json['id']),
        name: _text(json['name']),
        phone: _text(json['phone']),
        email: _text(json['email']),
        currentRole: _text(json['currentRole']),
        experienceYears: _number(json['experienceYears']),
        skills: [
          for (final skill in json['skills'] as List<dynamic>? ?? const [])
            if ('$skill'.trim().isNotEmpty) '$skill'.trim(),
        ],
        city: _text(json['city']),
        notes: _text(json['notes']),
        createdAt: _time(json['createdAt']),
      );

  final String id;
  final String name;
  final String phone;
  final String email;
  final String currentRole;
  final double? experienceYears;
  final List<String> skills;
  final String city;
  final String notes;
  final DateTime? createdAt;

  /// The line under the name in a picker: role, then phone.
  String get subtitle =>
      [currentRole, phone].where((part) => part.isNotEmpty).join(' · ');
}

/// A candidate put forward to a client for a position.
class Placement {
  const Placement({
    required this.id,
    required this.customerId,
    required this.customerName,
    required this.clientId,
    required this.clientName,
    required this.position,
    required this.status,
    this.interviewDate,
    this.joiningDate,
    this.ctcRupees,
    this.feeRupees,
    this.notes = '',
    this.createdAt,
    this.updatedAt,
  });

  factory Placement.fromJson(Map<String, dynamic> json) => Placement(
    id: _text(json['id']),
    customerId: _text(json['customerId']),
    customerName: _text(json['customerName']),
    clientId: _text(json['clientId']),
    clientName: _text(json['clientName']),
    position: _text(json['position']),
    status: PlacementStatus.fromKey(json['status']),
    interviewDate: _day(json['interviewDate']),
    joiningDate: _day(json['joiningDate']),
    ctcRupees: _number(json['ctcRupees']),
    feeRupees: _number(json['feeRupees']),
    notes: _text(json['notes']),
    createdAt: _time(json['createdAt']),
    updatedAt: _time(json['updatedAt']),
  );

  final String id;
  final String customerId;
  final String customerName;
  final String clientId;
  final String clientName;
  final String position;
  final PlacementStatus status;

  /// Calendar days, with no time or zone: `YYYY-MM-DD` on the wire.
  final DateTime? interviewDate;
  final DateTime? joiningDate;
  final double? ctcRupees;
  final double? feeRupees;
  final String notes;
  final DateTime? createdAt;
  final DateTime? updatedAt;
}

/// The hub's counts.
class PlacementsSummary {
  const PlacementsSummary({
    required this.clients,
    required this.customers,
    required this.total,
    required this.byStatus,
  });

  factory PlacementsSummary.fromJson(Map<String, dynamic> json) {
    final placements = json['placements'] is Map<String, dynamic>
        ? json['placements'] as Map<String, dynamic>
        : const <String, dynamic>{};
    final byStatus = placements['byStatus'] is Map<String, dynamic>
        ? placements['byStatus'] as Map<String, dynamic>
        : const <String, dynamic>{};
    final counts = {
      for (final status in PlacementStatus.values)
        status: _number(byStatus[status.key])?.round() ?? 0,
    };
    return PlacementsSummary(
      clients: _number(json['clients'])?.round() ?? 0,
      customers: _number(json['customers'])?.round() ?? 0,
      total:
          _number(placements['total'])?.round() ??
          counts.values.fold<int>(0, (sum, count) => sum + count),
      byStatus: counts,
    );
  }

  final int clients;
  final int customers;
  final int total;
  final Map<PlacementStatus, int> byStatus;

  int count(PlacementStatus status) => byStatus[status] ?? 0;
}

/// `YYYY-MM-DD`, the way the server takes a calendar day.
String placementDay(DateTime day) =>
    '${day.year.toString().padLeft(4, '0')}-'
    '${day.month.toString().padLeft(2, '0')}-'
    '${day.day.toString().padLeft(2, '0')}';

String _text(Object? value) => value == null ? '' : '$value'.trim();

double? _number(Object? value) => switch (value) {
  num() => value.toDouble(),
  String() => double.tryParse(value.trim()),
  _ => null,
};

DateTime? _time(Object? value) =>
    value is String ? DateTime.tryParse(value)?.toLocal() : null;

/// A calendar day as the server writes it, read as that day wherever the
/// phone is: "2026-11-02" is the 2nd, never the 1st west of Greenwich.
DateTime? _day(Object? value) {
  if (value is! String || value.length < 10) return null;
  final parsed = DateTime.tryParse(value.substring(0, 10));
  return parsed == null
      ? null
      : DateTime(parsed.year, parsed.month, parsed.day);
}
