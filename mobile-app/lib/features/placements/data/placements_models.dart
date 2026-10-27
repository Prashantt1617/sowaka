/// Actions › Placements: a recruitment company's clients (the companies it
/// hires for), its candidates (the server's "customers") and the placements
/// that join the two. Shapes as `/placements` sends them.
library;

/// Where a placement has got to, in the order a placement moves through them.
enum PlacementStatus {
  shortlisted('shortlisted', 'Profile shared'),
  interviewing('interviewing', 'Interview scheduled'),
  offered('offered', 'Selected'),
  joined('joined', 'Joined'),
  dropped('dropped', 'Rejected / dropped');

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

/// Where a candidate stands across their placements.
enum CandidateStage {
  notPlaced('not_placed', 'Not placed'),
  inProcess('in_process', 'In process'),
  joined('joined', 'Joined');

  const CandidateStage(this.key, this.label);
  final String key;
  final String label;

  static CandidateStage fromKey(Object? value) {
    for (final stage in values) {
      if (stage.key == '$value') return stage;
    }
    return notPlaced;
  }

  /// From their placements, as the server works it out: joined anywhere,
  /// else in process anywhere, else not placed.
  static CandidateStage of(Iterable<PlacementStatus> statuses) {
    if (statuses.contains(PlacementStatus.joined)) return joined;
    if (statuses.any(
      (s) =>
          s == PlacementStatus.shortlisted ||
          s == PlacementStatus.interviewing ||
          s == PlacementStatus.offered,
    )) {
      return inProcess;
    }
    return notPlaced;
  }
}

/// One open role at a client, with what it pays.
class PlacementDesignation {
  const PlacementDesignation({
    this.id = '',
    required this.title,
    this.budgetRupees,
    this.perYear = false,
    this.description = '',
  });

  factory PlacementDesignation.fromJson(Map<String, dynamic> json) =>
      PlacementDesignation(
        id: _text(json['id']),
        title: _text(json['title']),
        budgetRupees: _number(json['budgetRupees']),
        perYear: json['budgetPeriod'] == 'year',
        description: _text(json['description']),
      );

  /// Empty for one not saved yet; the server gives it one.
  final String id;
  final String title;
  final double? budgetRupees;
  final bool perYear;
  final String description;

  Map<String, dynamic> toJson() => {
    if (id.isNotEmpty) 'id': id,
    'title': title,
    'budgetRupees': budgetRupees,
    'budgetPeriod': perYear ? 'year' : 'month',
    'description': description,
  };

  /// "₹35,000 / month", or empty with no budget.
  String get budgetLabel => budgetRupees == null
      ? ''
      : '${rupees(budgetRupees!)} / ${perYear ? 'year' : 'month'}';
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
    this.designations = const [],
    this.feeRupees,
    this.feePaid = false,
    this.feePaidAt,
    this.feeReference = '',
    this.createdByUserId = '',
    this.createdAt,
    this.updatedAt,
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
        designations: [
          for (final item in json['designations'] as List<dynamic>? ?? const [])
            if (item is Map<String, dynamic>)
              PlacementDesignation.fromJson(item),
        ],
        feeRupees: _number(json['feeRupees']),
        feePaid: json['feePaid'] == true,
        feePaidAt: _time(json['feePaidAt']),
        feeReference: _text(json['feeReference']),
        createdByUserId: _text(json['createdByUserId']),
        createdAt: _time(json['createdAt']),
        updatedAt: _time(json['updatedAt']),
      );

  final String id;
  final String name;
  final String contactName;
  final String phone;
  final String email;
  final String industry;

  /// Where the company is: a city or a full address ("Company location").
  final String city;
  final String notes;

  /// The roles open there, each with its budget.
  final List<PlacementDesignation> designations;

  /// The one-time onboarding fee, and whether it was received.
  final double? feeRupees;
  final bool feePaid;
  final DateTime? feePaidAt;
  final String feeReference;
  final String createdByUserId;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  /// The role named [title] here, if the client has it.
  PlacementDesignation? designationNamed(String title) {
    final key = title.trim().toLowerCase();
    for (final role in designations) {
      if (role.title.trim().toLowerCase() == key) return role;
    }
    return null;
  }

  /// The line under the name in a picker: whatever there is of industry and
  /// city.
  String get subtitle =>
      [industry, city].where((part) => part.isNotEmpty).join(' · ');
}

/// A candidate the agency places (the server's "customer").
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
    this.address = '',
    this.notes = '',
    this.stage = CandidateStage.notPlaced,
    this.createdByUserId = '',
    this.createdAt,
    this.updatedAt,
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
        address: _text(json['address']),
        notes: _text(json['notes']),
        stage: CandidateStage.fromKey(json['stage']),
        createdByUserId: _text(json['createdByUserId']),
        createdAt: _time(json['createdAt']),
        updatedAt: _time(json['updatedAt']),
      );

  final String id;
  final String name;
  final String phone;
  final String email;

  /// Their designation: current or preferred role.
  final String currentRole;
  final double? experienceYears;
  final List<String> skills;
  final String city;
  final String address;

  /// The introduction: skills, strengths and what they are looking for.
  final String notes;
  final CandidateStage stage;
  final String createdByUserId;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  /// "Sales executive · 2 yrs", whatever there is of it.
  String get subtitle => [
    currentRole,
    if (experienceYears != null) yearsLabel(experienceYears!),
  ].where((part) => part.isNotEmpty).join(' · ');
}

/// "2 yrs", "1 yr", "2.5 yrs".
String yearsLabel(double years) {
  final shown = years == years.roundToDouble()
      ? years.round().toString()
      : years.toStringAsFixed(1);
  return '$shown ${years == 1 ? 'yr' : 'yrs'}';
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
    this.createdByUserId = '',
    this.createdAt,
    this.updatedAt,
    this.history = const [],
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
    createdByUserId: _text(json['createdByUserId']),
    createdAt: _time(json['createdAt']),
    updatedAt: _time(json['updatedAt']),
    history: [
      for (final item in json['history'] as List<dynamic>? ?? const [])
        if (item is Map<String, dynamic>)
          PlacementStatusChange(
            status: PlacementStatus.fromKey(item['status']),
            at: _time(item['at']),
            byUserId: _text(item['byUserId']),
          ),
    ],
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

  /// Remarks: feedback from the client or the candidate.
  final String notes;
  final String createdByUserId;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  /// Every status it has had, oldest first.
  final List<PlacementStatusChange> history;

  /// When it got to its current status: the last change, else when it was made.
  DateTime? get statusAt => history.isNotEmpty ? history.last.at : createdAt;
}

/// One status a placement had, and who set it.
class PlacementStatusChange {
  const PlacementStatusChange({
    required this.status,
    this.at,
    this.byUserId = '',
  });

  final PlacementStatus status;
  final DateTime? at;
  final String byUserId;
}

/// A client's page: the client, and every placement at it.
class PlacementClientPage {
  const PlacementClientPage({required this.client, required this.placements});
  final PlacementClient client;
  final List<Placement> placements;
}

/// A candidate's page: them, their placements, and the clients those are at
/// (for each role's budget).
class PlacementCandidatePage {
  const PlacementCandidatePage({
    required this.candidate,
    required this.placements,
    required this.clients,
  });
  final PlacementCustomer candidate;
  final List<Placement> placements;
  final List<PlacementClient> clients;

  PlacementClient? clientOf(Placement placement) {
    for (final client in clients) {
      if (client.id == placement.clientId) return client;
    }
    return null;
  }
}

/// "₹2,500", "₹1,20,000": grouped the Indian way, no paise unless there are.
String rupees(double amount) {
  final whole = amount.truncate();
  final paise = ((amount - whole) * 100).round();
  final digits = whole.abs().toString();
  String grouped;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    final last = digits.substring(digits.length - 3);
    var rest = digits.substring(0, digits.length - 3);
    final parts = <String>[];
    while (rest.length > 2) {
      parts.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) parts.insert(0, rest);
    grouped = '${parts.join(',')},$last';
  }
  return '₹${amount < 0 ? '-' : ''}$grouped${paise == 0 ? '' : '.${paise.toString().padLeft(2, '0')}'}';
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
