// The joiner's own details (app build 90), as `joinerDetails.ts` answers:
// the Employee profile's sections (`GET /lifecycle/joiner/profile`), each
// filled once in the app, and the payroll details form
// (`GET /lifecycle/joiner/payroll`): bank account, PF and nominees.

Map<String, dynamic> _map(Object? v) => v is Map ? v.cast<String, dynamic>() : const {};
List<Map<String, dynamic>> _maps(Object? v) => v is List ? [for (final x in v) if (x is Map) x.cast<String, dynamic>()] : const [];
List<String> _strs(Object? v) => v is List ? [for (final x in v) if (x is String && x.isNotEmpty) x] : const [];
String? _str(Object? v) => v is String && v.trim().isNotEmpty ? v : null;
int _int(Object? v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;

/// One section of the Employee profile, as the app may fill it.
class JoinerProfileDetailSection {
  const JoinerProfileDetailSection({
    required this.key,
    required this.title,
    this.state = 'todo',
    this.filled = false,
    this.editable = false,
    this.locked = false,
    this.savedInApp = false,
    this.missingDocuments = const [],
  });

  factory JoinerProfileDetailSection.fromJson(Map<String, dynamic> j) => JoinerProfileDetailSection(
    key: _str(j['key']) ?? '',
    title: _str(j['title']) ?? '',
    state: _str(j['state']) ?? 'todo',
    filled: j['filled'] == true,
    editable: j['editable'] == true,
    // HR approved the section (HR's approval lock); read-only.
    locked: j['locked'] == true,
    savedInApp: _str(j['savedInAppAt']) != null,
    missingDocuments: _strs(j['missingDocuments']),
  );

  final String key;
  final String title;

  /// 'done' (fields and documents), 'saved' (fields, documents still with
  /// HR) or 'todo'.
  final String state;
  final bool filled;

  /// Still empty, never saved in the app and not approved by HR: fill it once.
  final bool editable;
  final bool locked;
  final bool savedInApp;

  /// The documents HR still needs for this section (the app does not take uploads).
  final List<String> missingDocuments;
}

class JoinerProfileDetails {
  const JoinerProfileDetails({
    this.sections = const [],
    this.values = const {},
    this.genders = const [],
    this.marital = const [],
    this.qualifications = const [],
    this.relations = const [],
  });

  factory JoinerProfileDetails.fromJson(Map<String, dynamic> j) {
    final options = _map(j['options']);
    return JoinerProfileDetails(
      sections: [for (final s in _maps(j['sections'])) JoinerProfileDetailSection.fromJson(s)],
      values: _map(j['values']),
      genders: _strs(options['genders']),
      marital: _strs(options['marital']),
      qualifications: _strs(options['qualifications']),
      relations: _strs(options['relations']),
    );
  }

  final List<JoinerProfileDetailSection> sections;

  /// The answers (`personal`, `contact`, `emergencyContact`, `bank`, `pf`,
  /// `education`, `experience`, `ids`), secrets as their last four.
  final Map<String, dynamic> values;
  final List<String> genders;
  final List<String> marital;
  final List<String> qualifications;

  /// How an emergency contact is related.
  final List<String> relations;

  JoinerProfileDetailSection? section(String key) => sections.where((s) => s.key == key).firstOrNull;

  Map<String, dynamic> value(String key) => _map(values[key]);
}

class PfNominee {
  const PfNominee({required this.name, required this.relation, required this.share});

  factory PfNominee.fromJson(Map<String, dynamic> j) =>
      PfNominee(name: _str(j['name']) ?? '', relation: _str(j['relation']) ?? '', share: _int(j['share']));

  final String name;
  final String relation;
  final int share;

  Map<String, Object> toJson() => {'name': name, 'relation': relation, 'share': share};
}

/// The payroll details form: what was sent (or payroll's, or pre-boarding's).
class JoinerPayroll {
  const JoinerPayroll({
    this.holderName,
    this.bankName,
    this.ifsc,
    this.accountLast4,
    this.firstJob = false,
    this.uan,
    this.uanLast4,
    this.nominees = const [],
    this.relations = const [],
    this.state = 'todo',
    this.editable = true,
    this.hrNote,
    this.taskDone = false,
  });

  factory JoinerPayroll.fromJson(Map<String, dynamic> j) {
    final bank = _map(j['bank']);
    final pf = _map(j['pf']);
    return JoinerPayroll(
      holderName: _str(bank['holderName']),
      bankName: _str(bank['bankName']),
      ifsc: _str(bank['ifsc']),
      accountLast4: _str(bank['accountLast4']),
      firstJob: pf['firstJob'] == true,
      uan: _str(pf['uan']),
      uanLast4: _str(pf['uanLast4']),
      nominees: [for (final n in _maps(j['nominees'])) PfNominee.fromJson(n)],
      relations: _strs(j['relations']),
      state: _str(j['state']) ?? 'todo',
      editable: j['editable'] != false,
      hrNote: _str(j['hrNote']),
      taskDone: j['taskDone'] == true,
    );
  }

  final String? holderName;
  final String? bankName;
  final String? ifsc;
  final String? accountLast4;
  final bool firstJob;

  /// The UAN in full when it is the joiner's own from pre-boarding; else its last four.
  final String? uan;
  final String? uanLast4;
  final List<PfNominee> nominees;
  final List<String> relations;

  /// 'todo' | 'pending' (with HR) | 'approved' (in payroll) | 'declined' (sent back).
  final String state;
  final bool editable;
  final String? hrNote;
  final bool taskDone;
}
