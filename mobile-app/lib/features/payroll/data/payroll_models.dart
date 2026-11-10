// What the Payroll screens read and send, as docs/payroll-employee-api.md
// (branch payroll-employee-backend) describes it. Money is integer paise
// everywhere; a day is "YYYY-MM-DD", a month "YYYY-MM", a financial year
// "2026-27".

int _paise(Object? value) => (value as num?)?.round() ?? 0;
int? _paiseOrNull(Object? value) => (value as num?)?.round();
double _number(Object? value) => (value as num?)?.toDouble() ?? 0;
int _int(Object? value) => (value as num?)?.toInt() ?? 0;
String _string(Object? value) => value is String ? value : '';
String? _stringOrNull(Object? value) =>
    value is String && value.isNotEmpty ? value : null;
bool _bool(Object? value) => value == true;
Map<String, dynamic> _map(Object? value) =>
    value is Map<String, dynamic> ? value : const {};
List<Map<String, dynamic>> _list(Object? value) => [
  if (value is List)
    for (final item in value)
      if (item is Map<String, dynamic>) item,
];

/// "2026-10-31" as a calendar date (no time zone), or null.
DateTime? payrollDate(Object? value) {
  if (value is! String || value.length < 10) return null;
  final parsed = DateTime.tryParse(value.substring(0, 10));
  return parsed == null
      ? null
      : DateTime(parsed.year, parsed.month, parsed.day);
}

/// "2026-11" as the first of that month, or null.
DateTime? payrollMonth(Object? value) {
  if (value is! String || value.length < 7) return null;
  final year = int.tryParse(value.substring(0, 4));
  final month = int.tryParse(value.substring(5, 7));
  if (year == null || month == null) return null;
  return DateTime(year, month);
}

/// A month as the API writes it: "2026-11".
String payrollPeriod(DateTime month) =>
    '${month.year.toString().padLeft(4, '0')}-'
    '${month.month.toString().padLeft(2, '0')}';

DateTime? _moment(Object? value) =>
    value is String ? DateTime.tryParse(value)?.toLocal() : null;

// ---------------------------------------------------------------- home

/// One employee deduction on the month's salary: PF, income tax, PT …
class PayrollDeduction {
  const PayrollDeduction({
    required this.key,
    required this.label,
    required this.amountPaise,
  });

  /// "epf" | "esi" | "pt" | "lwf" | "income_tax" | a pay head code.
  final String key;
  final String label;
  final int amountPaise;

  factory PayrollDeduction.fromJson(Map<String, dynamic> json) =>
      PayrollDeduction(
        key: _string(json['key']),
        label: _string(json['label']),
        amountPaise: _paise(json['amountPaise']),
      );
}

/// This month's salary: an estimate from the structure and attendance so
/// far, or the released payslip's figures.
class PayrollSalary {
  const PayrollSalary({
    required this.period,
    required this.status,
    required this.grossPaise,
    required this.lopDays,
    required this.lopPaise,
    required this.deductions,
    required this.netPaise,
    required this.reimbursementsPaise,
    required this.takeHomePaise,
    this.overtimePaise = 0,
    this.payslipId,
    this.periodFrom,
    this.periodTo,
    this.baseDays,
  });

  /// The pay period ("2026-11"), as the company pays it: with a 26th-to-25th
  /// cycle, November's runs from 26 October.
  final String period;

  /// "estimate" | "final".
  final String status;
  final String? payslipId;

  /// The pay period's first and last day, when the server sends them.
  final DateTime? periodFrom;
  final DateTime? periodTo;

  /// The days the month's pay is spread over in this pay period (loss of pay
  /// is the pay divided by these, times the days lost); null when not sent.
  final int? baseDays;
  final int grossPaise;
  final double lopDays;
  final int lopPaise;

  /// Approved overtime paid on the released payslip (0 on an estimate).
  final int overtimePaise;
  final List<PayrollDeduction> deductions;
  final int netPaise;
  final int reimbursementsPaise;
  final int takeHomePaise;

  bool get isEstimate => status != 'final';

  factory PayrollSalary.fromJson(Map<String, dynamic> json) => PayrollSalary(
    period: _string(json['period']),
    status: _string(json['status']).isEmpty
        ? 'estimate'
        : _string(json['status']),
    payslipId: _stringOrNull(json['payslipId']),
    periodFrom: payrollDate(json['periodFrom']),
    periodTo: payrollDate(json['periodTo']),
    baseDays: switch (json['baseDays']) {
      final num n when n > 0 => n.toInt(),
      _ => null,
    },
    grossPaise: _paise(json['grossPaise']),
    lopDays: _number(json['lopDays']),
    lopPaise: _paise(json['lopPaise']),
    overtimePaise: _paise(json['overtimePaise']),
    deductions: _list(
      json['deductions'],
    ).map(PayrollDeduction.fromJson).toList(),
    netPaise: _paise(json['netPaise']),
    reimbursementsPaise: _paise(json['reimbursementsPaise']),
    takeHomePaise: _paise(json['takeHomePaise']),
  );
}

/// Why the month's pay can't be shown yet: something HR sets up is missing
/// (the year's statutory settings, or the pay cycle). Shown instead of
/// figures; [message] is the server's, ending "Ask HR.".
class PayrollSalaryNotSetUp {
  const PayrollSalaryNotSetUp({
    required this.reason,
    required this.message,
    this.fy,
  });

  /// "statutory_not_set_up" | "pay_period_not_set_up" | ….
  final String reason;
  final String message;
  final String? fy;

  static const fallback =
      'Your pay can\'t be worked out yet: payroll is not fully set up. Ask HR.';

  factory PayrollSalaryNotSetUp.fromJson(Map<String, dynamic> json) =>
      PayrollSalaryNotSetUp(
        reason: _string(json['reason']),
        message: _stringOrNull(json['message']) ?? fallback,
        fy: _stringOrNull(json['fy']),
      );
}

/// Something on the Payroll home that needs doing, and by when.
class PayrollTodo {
  const PayrollTodo({
    required this.kind,
    this.dueOn,
    this.count = 0,
    this.period,
    this.effectiveFrom,
    this.submitted = false,
    this.rejected = 0,
    this.inReview = 0,
    this.notUploaded = 0,
    this.regime,
    this.chosen = false,
  });

  /// "missing_punches" | "flexible_split" | "fbp_bills" | "tax_regime" |
  /// "investment_proofs".
  final String kind;
  final DateTime? dueOn;
  final int count;
  final String? period;
  final DateTime? effectiveFrom;
  final bool submitted;
  final int rejected;
  final int inReview;
  final int notUploaded;
  final String? regime;
  final bool chosen;

  factory PayrollTodo.fromJson(Map<String, dynamic> json) => PayrollTodo(
    kind: _string(json['kind']),
    dueOn: payrollDate(json['dueOn']),
    count: _int(json['count']),
    period: _stringOrNull(json['period']),
    effectiveFrom: payrollMonth(json['effectiveFrom']),
    submitted: _bool(json['submitted']),
    rejected: _int(json['rejected']),
    inReview: _int(json['inReview']),
    notUploaded: _int(json['notUploaded']),
    regime: _stringOrNull(json['regime']),
    chosen: _bool(json['chosen']),
  );
}

/// The month's days with a punch missing: how many, and the last day to fix
/// them.
class PayrollMissingPunches {
  const PayrollMissingPunches({
    required this.period,
    required this.count,
    required this.locked,
    this.fixBy,
  });

  final String period;
  final int count;
  final DateTime? fixBy;
  final bool locked;

  factory PayrollMissingPunches.fromJson(Map<String, dynamic> json) =>
      PayrollMissingPunches(
        period: _string(json['period']),
        count: _int(json['count']),
        fixBy: payrollDate(json['fixBy']),
        locked: _bool(json['locked']),
      );
}

/// Where the tax year's declaration stands.
class PayrollDeclarationState {
  const PayrollDeclarationState({
    required this.fy,
    required this.regime,
    required this.chosen,
    required this.status,
    required this.locked,
    this.dueOn,
  });

  final String fy;
  final String regime;
  final bool chosen;

  /// "not_started" | "saved" | "submitted".
  final String status;
  final bool locked;
  final DateTime? dueOn;

  factory PayrollDeclarationState.fromJson(Map<String, dynamic> json) =>
      PayrollDeclarationState(
        fy: _string(json['fy']),
        regime: _string(json['regime']).isEmpty
            ? 'new'
            : _string(json['regime']),
        chosen: _bool(json['chosen']),
        status: _string(json['status']),
        locked: _bool(json['locked']),
        dueOn: payrollDate(json['dueOn']),
      );
}

/// The Payroll home in one read: the month's salary, what needs doing, and
/// where the split, declaration and proofs stand.
class PayrollHome {
  const PayrollHome({
    required this.period,
    required this.fy,
    required this.hasSalaryStructure,
    required this.todo,
    this.salary,
    this.salaryNotSetUp,
    this.missingPunches,
    this.declaration,
    this.hasSplit = false,
    this.proofs,
  });

  /// The person's salary has flexible (FBP) heads to split: the server sends
  /// a split summary only then. Without one there is no FBP to show.
  final bool hasSplit;

  /// Where their investment proofs stand, approved ones included.
  final PayrollProofsSummary? proofs;

  final String period;
  final String fy;
  final bool hasSalaryStructure;
  final PayrollSalary? salary;

  /// Set (and [salary] null) when the pay can't be worked out until HR sets
  /// something up: the card says so rather than show made-up figures.
  final PayrollSalaryNotSetUp? salaryNotSetUp;
  final List<PayrollTodo> todo;
  final PayrollMissingPunches? missingPunches;
  final PayrollDeclarationState? declaration;

  factory PayrollHome.fromJson(Map<String, dynamic> json) {
    final salary = json['salary'];
    final notSetUp = json['salaryNotSetUp'];
    final missing = json['missingPunches'];
    final declaration = json['declaration'];
    final proofs = json['proofs'];
    return PayrollHome(
      hasSplit: json['split'] is Map,
      proofs: proofs is Map<String, dynamic>
          ? PayrollProofsSummary.fromJson(proofs)
          : null,
      period: _string(json['period']),
      fy: _string(json['fy']),
      hasSalaryStructure: json['hasSalaryStructure'] != false,
      salary: salary is Map<String, dynamic>
          ? PayrollSalary.fromJson(salary)
          : null,
      salaryNotSetUp: notSetUp is Map<String, dynamic>
          ? PayrollSalaryNotSetUp.fromJson(notSetUp)
          : null,
      todo: _list(json['todo']).map(PayrollTodo.fromJson).toList(),
      missingPunches: missing is Map<String, dynamic>
          ? PayrollMissingPunches.fromJson(missing)
          : null,
      declaration: declaration is Map<String, dynamic>
          ? PayrollDeclarationState.fromJson(declaration)
          : null,
    );
  }
}

/// The proofs line of the payroll home: whether any are needed this year and
/// how many stand where.
class PayrollProofsSummary {
  const PayrollProofsSummary({
    required this.required,
    required this.notUploaded,
    required this.uploaded,
    required this.approved,
    required this.rejected,
  });

  final bool required;
  final int notUploaded;
  final int uploaded;
  final int approved;
  final int rejected;

  int get total => notUploaded + uploaded + approved + rejected;

  factory PayrollProofsSummary.fromJson(Map<String, dynamic> json) {
    int n(Object? v) => v is num ? v.toInt() : 0;
    return PayrollProofsSummary(
      required: json['required'] == true,
      notUploaded: n(json['notUploaded']),
      uploaded: n(json['uploaded']),
      approved: n(json['approved']),
      rejected: n(json['rejected']),
    );
  }
}

// ---------------------------------------------------------------- missing punches

/// A past working day with a punch missing.
class MissingPunchDay {
  const MissingPunchDay({
    required this.date,
    required this.trigger,
    required this.status,
    required this.label,
    this.punchIn,
    this.punchOut,
    this.requestStatus,
  });

  final DateTime date;
  final DateTime? punchIn;
  final DateTime? punchOut;
  final String trigger;
  final String status;
  final String label;

  /// "pending" | "approved" | "declined", once a correction was asked for.
  final String? requestStatus;

  factory MissingPunchDay.fromJson(Map<String, dynamic> json) =>
      MissingPunchDay(
        date: payrollDate(json['date']) ?? DateTime(1970),
        punchIn: _moment(json['punchIn']),
        punchOut: _moment(json['punchOut']),
        trigger: _string(json['trigger']),
        status: _string(json['status']),
        label: _string(json['label']),
        requestStatus: _stringOrNull(_map(json['request'])['status']),
      );
}

class MissingPunches {
  const MissingPunches({
    required this.period,
    required this.count,
    required this.locked,
    required this.days,
    this.fixBy,
  });

  final String period;
  final int count;
  final DateTime? fixBy;
  final bool locked;
  final List<MissingPunchDay> days;

  factory MissingPunches.fromJson(Map<String, dynamic> json) => MissingPunches(
    period: _string(json['period']),
    count: _int(json['count']),
    fixBy: payrollDate(json['fixBy']),
    locked: _bool(json['locked']),
    days: _list(json['days']).map(MissingPunchDay.fromJson).toList(),
  );
}

// ---------------------------------------------------------------- flexible split

/// This year's bills for one flexible head.
class FbpBills {
  const FbpBills({this.approved = 0, this.inReview = 0, this.rejected = 0});

  final int approved;
  final int inReview;
  final int rejected;

  factory FbpBills.fromJson(Map<String, dynamic> json) => FbpBills(
    approved: _int(json['approved']),
    inReview: _int(json['inReview']),
    rejected: _int(json['rejected']),
  );
}

/// One flexible head the pool is split across: Fuel & vehicle, Internet …
class FbpComponent {
  const FbpComponent({
    required this.code,
    required this.name,
    required this.limitPaise,
    required this.amountPaise,
    required this.stepPaise,
    this.bills = const FbpBills(),
  });

  final String code;
  final String name;
  final int limitPaise;
  final int amountPaise;

  /// The +/− step the server suggests; any whole-rupee amount is accepted.
  final int stepPaise;
  final FbpBills bills;

  factory FbpComponent.fromJson(Map<String, dynamic> json) => FbpComponent(
    code: _string(json['code']),
    name: _string(json['name']),
    limitPaise: _paise(json['limitPaise']),
    amountPaise: _paise(json['amountPaise']),
    stepPaise: _paise(json['stepPaise']) > 0
        ? _paise(json['stepPaise'])
        : 10000,
    bills: FbpBills.fromJson(_map(json['bills'])),
  );
}

/// When a change to the split can be made, and from which month it applies.
class FbpWindow {
  const FbpWindow({
    required this.open,
    this.effectiveFrom,
    this.effectiveTo,
    this.closesOn,
    this.reason,
  });

  final bool open;
  final DateTime? effectiveFrom;
  final DateTime? effectiveTo;
  final DateTime? closesOn;
  final String? reason;

  factory FbpWindow.fromJson(Map<String, dynamic> json) => FbpWindow(
    open: _bool(json['open']),
    effectiveFrom: payrollMonth(json['effectiveFrom']),
    effectiveTo: payrollMonth(json['effectiveTo']),
    closesOn: payrollDate(json['closesOn']),
    reason: _stringOrNull(json['reason']),
  );
}

/// The person's flexible split: the monthly pool, each head's share of it,
/// and whether it can be changed now.
class FbpSplit {
  const FbpSplit({
    required this.available,
    required this.poolPaise,
    required this.assignedPaise,
    required this.unassignedPaise,
    required this.components,
    required this.window,
    this.currentEffectiveFrom,
    this.billsDueOn,
  });

  final bool available;
  final int poolPaise;
  final int assignedPaise;
  final int unassignedPaise;
  final List<FbpComponent> components;
  final FbpWindow window;
  final DateTime? currentEffectiveFrom;
  final DateTime? billsDueOn;

  factory FbpSplit.fromJson(Map<String, dynamic> json) => FbpSplit(
    available: _bool(json['available']),
    poolPaise: _paise(json['poolPaise']),
    assignedPaise: _paise(json['assignedPaise']),
    unassignedPaise: _paise(json['unassignedPaise']),
    components: _list(json['components']).map(FbpComponent.fromJson).toList(),
    window: FbpWindow.fromJson(_map(json['window'])),
    currentEffectiveFrom: payrollMonth(_map(json['current'])['effectiveFrom']),
    billsDueOn: payrollDate(json['billsDueOn']),
  );
}

class FbpReviewLine {
  const FbpReviewLine({
    required this.code,
    required this.name,
    required this.previousPaise,
    required this.amountPaise,
    required this.changePaise,
    required this.isNew,
  });

  final String code;
  final String name;
  final int previousPaise;
  final int amountPaise;
  final int changePaise;
  final bool isNew;

  factory FbpReviewLine.fromJson(Map<String, dynamic> json) => FbpReviewLine(
    code: _string(json['code']),
    name: _string(json['name']),
    previousPaise: _paise(json['previousPaise']),
    amountPaise: _paise(json['amountPaise']),
    changePaise: _paise(json['changePaise']),
    isNew: _bool(json['isNew']),
  );
}

/// A split as it will be once saved, checked by the server but not kept.
class FbpReview {
  const FbpReview({
    required this.lines,
    required this.totalPaise,
    required this.poolPaise,
    required this.unassignedPaise,
    this.effectiveFrom,
    this.effectiveTo,
    this.closesOn,
    this.monthlyTaxSavingPaise,
    this.billsDueOn,
  });

  final DateTime? effectiveFrom;
  final DateTime? effectiveTo;
  final DateTime? closesOn;
  final List<FbpReviewLine> lines;
  final int totalPaise;
  final int poolPaise;
  final int unassignedPaise;
  final int? monthlyTaxSavingPaise;
  final DateTime? billsDueOn;

  factory FbpReview.fromJson(Map<String, dynamic> json) => FbpReview(
    effectiveFrom: payrollMonth(json['effectiveFrom']),
    effectiveTo: payrollMonth(json['effectiveTo']),
    closesOn: payrollDate(json['closesOn']),
    lines: _list(json['lines']).map(FbpReviewLine.fromJson).toList(),
    totalPaise: _paise(json['totalPaise']),
    poolPaise: _paise(json['poolPaise']),
    unassignedPaise: _paise(json['unassignedPaise']),
    monthlyTaxSavingPaise: _paiseOrNull(json['monthlyTaxSavingPaise']),
    billsDueOn: payrollDate(json['billsDueOn']),
  );
}

// ---------------------------------------------------------------- declaration

class TaxDeclarationItem {
  const TaxDeclarationItem({
    required this.key,
    required this.label,
    required this.amountPaise,
    this.readOnly = false,
    this.proofNeeded = false,
  });

  /// "epf" | "ppf" | "elss" | "lifeInsurance" | "other80C" | "nps" |
  /// "healthSelf" | "healthParents" | "rentMonthly" | "homeLoanInterest".
  final String key;
  final String label;
  final int amountPaise;
  final bool readOnly;
  final bool proofNeeded;

  factory TaxDeclarationItem.fromJson(Map<String, dynamic> json) =>
      TaxDeclarationItem(
        key: _string(json['key']),
        label: _string(json['label']),
        amountPaise: _paise(json['amountPaise']),
        readOnly: _bool(json['readOnly']),
        proofNeeded: _bool(json['proofNeeded']),
      );
}

/// One section of the declaration — 80C, 80CCD(1B), 80D, HRA, 24(b) — with
/// its cap, what was declared under it and what of that counts.
class TaxDeclarationSection {
  const TaxDeclarationSection({
    required this.key,
    required this.label,
    required this.declaredPaise,
    required this.countedPaise,
    required this.applicable,
    required this.items,
    this.capPaise,
    this.note,
  });

  final String key;
  final String label;

  /// Null: no cap (rent).
  final int? capPaise;
  final int declaredPaise;
  final int countedPaise;
  final bool applicable;
  final String? note;
  final List<TaxDeclarationItem> items;

  factory TaxDeclarationSection.fromJson(Map<String, dynamic> json) =>
      TaxDeclarationSection(
        key: _string(json['key']),
        label: _string(json['label']),
        capPaise: _paiseOrNull(json['capPaise']),
        declaredPaise: _paise(json['declaredPaise']),
        countedPaise: _paise(json['countedPaise']),
        applicable: json['applicable'] != false,
        note: _stringOrNull(json['note']),
        items: _list(json['items']).map(TaxDeclarationItem.fromJson).toList(),
      );
}

/// One financial year's regime and investment declaration.
class TaxDeclaration {
  const TaxDeclaration({
    required this.fy,
    required this.regime,
    required this.chosen,
    required this.status,
    required this.locked,
    required this.sections,
    this.dueOn,
    this.proofsDueOn,
    this.submittedAt,
    this.metro = false,
    this.selfSenior = false,
    this.parentsSenior = false,
  });

  final String fy;

  /// "new" | "old".
  final String regime;
  final bool chosen;

  /// "not_started" | "saved" | "submitted".
  final String status;
  final bool locked;
  final DateTime? dueOn;
  final DateTime? proofsDueOn;
  final DateTime? submittedAt;
  final bool metro;
  final bool selfSenior;
  final bool parentsSenior;
  final List<TaxDeclarationSection> sections;

  bool get isOld => regime == 'old';

  factory TaxDeclaration.fromJson(Map<String, dynamic> json) => TaxDeclaration(
    fy: _string(json['fy']),
    regime: _string(json['regime']) == 'old' ? 'old' : 'new',
    chosen: _bool(json['chosen']),
    status: _string(json['status']),
    locked: _bool(json['locked']),
    dueOn: payrollDate(json['dueOn']),
    proofsDueOn: payrollDate(json['proofsDueOn']),
    submittedAt: _moment(json['submittedAt']),
    metro: _bool(json['metro']),
    selfSenior: _bool(json['selfSenior']),
    parentsSenior: _bool(json['parentsSenior']),
    sections: _list(
      json['sections'],
    ).map(TaxDeclarationSection.fromJson).toList(),
  );
}

// ---------------------------------------------------------------- proofs

enum ProofStatus { notUploaded, uploaded, approved, rejected }

ProofStatus _proofStatus(Object? value) => switch (value) {
  'uploaded' => ProofStatus.uploaded,
  'approved' => ProofStatus.approved,
  'rejected' => ProofStatus.rejected,
  _ => ProofStatus.notUploaded,
};

/// The file sent for one item, and what HR made of it.
class InvestmentProofFile {
  const InvestmentProofFile({
    required this.id,
    required this.fileName,
    required this.amountPaise,
    this.size = 0,
    this.contentType = '',
    this.uploadedAt,
    this.decidedAt,
    this.reason,
  });

  final String id;
  final String fileName;
  final String contentType;
  final int size;
  final int amountPaise;
  final DateTime? uploadedAt;
  final DateTime? decidedAt;
  final String? reason;

  factory InvestmentProofFile.fromJson(Map<String, dynamic> json) =>
      InvestmentProofFile(
        id: _string(json['id']),
        fileName: _string(json['fileName']),
        contentType: _string(json['contentType']),
        size: _int(json['size']),
        amountPaise: _paise(json['amountPaise']),
        uploadedAt: _moment(json['uploadedAt']),
        decidedAt: _moment(json['decidedAt']),
        reason: _stringOrNull(json['reason']),
      );
}

/// One declared investment that needs a proof.
class InvestmentProofItem {
  const InvestmentProofItem({
    required this.item,
    required this.label,
    required this.section,
    required this.declaredPaise,
    required this.status,
    this.proof,
  });

  final String item;
  final String label;
  final String section;
  final int declaredPaise;
  final ProofStatus status;
  final InvestmentProofFile? proof;

  factory InvestmentProofItem.fromJson(Map<String, dynamic> json) {
    final proof = json['proof'];
    return InvestmentProofItem(
      item: _string(json['item']),
      label: _string(json['label']),
      section: _string(json['section']),
      declaredPaise: _paise(json['declaredPaise']),
      status: _proofStatus(json['status']),
      proof: proof is Map<String, dynamic>
          ? InvestmentProofFile.fromJson(proof)
          : null,
    );
  }
}

class InvestmentProofs {
  const InvestmentProofs({
    required this.fy,
    required this.regime,
    required this.required,
    required this.locked,
    required this.items,
    this.dueOn,
  });

  final String fy;
  final String regime;

  /// False on the new regime: nothing to prove.
  final bool required;
  final DateTime? dueOn;
  final bool locked;
  final List<InvestmentProofItem> items;

  int count(ProofStatus status) =>
      items.where((item) => item.status == status).length;

  factory InvestmentProofs.fromJson(Map<String, dynamic> json) =>
      InvestmentProofs(
        fy: _string(json['fy']),
        regime: _string(json['regime']),
        required: _bool(json['required']),
        dueOn: payrollDate(json['dueOn']),
        locked: _bool(json['locked']),
        items: _list(json['items']).map(InvestmentProofItem.fromJson).toList(),
      );

  InvestmentProofs replacing(InvestmentProofItem updated) => InvestmentProofs(
    fy: fy,
    regime: regime,
    required: required,
    dueOn: dueOn,
    locked: locked,
    items: [
      for (final item in items) item.item == updated.item ? updated : item,
    ],
  );
}

// ---------------------------------------------------------------- FBP

/// Whether the flexible split can still change this financial year
/// (GET /payroll/me/fbp › lock).
class FbpLock {
  const FbpLock({
    required this.locked,
    required this.notConfigured,
    this.effectiveFrom,
    this.closesOn,
  });

  /// No change made now can reach this FY's pay: the split stays as it is
  /// until the FY ends (a change goes through HR).
  final bool locked;

  /// HR has not set the split cutoff day, so when a change applies is not
  /// known: not locked, but not set up either.
  final bool notConfigured;

  /// While open: the month a change made now starts from, and the last day
  /// to make it for that month.
  final DateTime? effectiveFrom;
  final DateTime? closesOn;

  factory FbpLock.fromJson(Map<String, dynamic> json) => FbpLock(
    locked: _bool(json['locked']),
    notConfigured: _bool(json['notConfigured']),
    effectiveFrom: payrollMonth(json['effectiveFrom']),
    closesOn: payrollDate(json['closesOn']),
  );
}

/// One flexible head on the FBP page: this month's amount and this FY's
/// bills so far.
class FbpHeadSummary {
  const FbpHeadSummary({
    required this.code,
    required this.name,
    required this.amountPaise,
    required this.months,
    required this.approved,
    required this.inReview,
    required this.rejected,
    required this.toUpload,
    required this.needsAction,
  });

  final String code;
  final String name;
  final int amountPaise;

  /// The months this FY so far that want a bill.
  final int months;
  final int approved;
  final int inReview;
  final int rejected;
  final int toUpload;

  /// Bills still to send: not uploaded or rejected.
  final int needsAction;

  factory FbpHeadSummary.fromJson(Map<String, dynamic> json) => FbpHeadSummary(
    code: _string(json['code']),
    name: _string(json['name']),
    amountPaise: _paise(json['amountPaise']),
    months: _int(json['months']),
    approved: _int(json['approved']),
    inReview: _int(json['inReview']),
    rejected: _int(json['rejected']),
    toUpload: _int(json['toUpload']),
    needsAction: _int(json['needsAction']),
  );
}

/// The FBP page: the month's split, each head's bills, and the lock.
class FbpPlan {
  const FbpPlan({
    required this.available,
    required this.fy,
    required this.period,
    required this.assignedPaise,
    required this.heads,
    required this.toUpload,
    required this.toReupload,
    required this.lock,
    this.poolPaise,
    this.unassignedPaise,
    this.declaredFrom,
    this.declaredAt,
    this.billsDueOn,
    this.missing = const [],
  });

  /// False when the salary has no flexible heads.
  final bool available;
  final String fy;

  /// The month the summary is for, "2026-10".
  final String period;

  /// Null while HR has not set the pool on the salary template.
  final int? poolPaise;
  final int assignedPaise;

  /// Paid with salary and taxed in full; null while there is no pool.
  final int? unassignedPaise;

  /// The split this month's amounts come from; null when none was declared.
  final DateTime? declaredFrom;
  final DateTime? declaredAt;
  final List<FbpHeadSummary> heads;
  final int toUpload;
  final int toReupload;
  final DateTime? billsDueOn;
  final FbpLock lock;

  /// What HR has not set: "flexiblePoolPaise", "billsDue", "splitCutoffDay".
  final List<String> missing;

  factory FbpPlan.fromJson(Map<String, dynamic> json) {
    final summary = _map(json['summary']);
    final declared = _map(json['declared']);
    return FbpPlan(
      available: _bool(json['available']),
      fy: _string(json['fy']),
      period: _string(json['period']),
      poolPaise: _paiseOrNull(json['poolPaise']),
      assignedPaise: _paise(json['assignedPaise']),
      unassignedPaise: _paiseOrNull(json['unassignedPaise']),
      declaredFrom: payrollMonth(declared['effectiveFrom']),
      declaredAt: _moment(declared['submittedAt']),
      heads: _list(json['heads']).map(FbpHeadSummary.fromJson).toList(),
      toUpload: _int(summary['toUpload']),
      toReupload: _int(summary['toReupload']),
      billsDueOn: payrollDate(json['billsDueOn']),
      lock: FbpLock.fromJson(_map(json['lock'])),
      missing: [
        for (final item in json['missing'] as List<dynamic>? ?? const [])
          if (item is String) item,
      ],
    );
  }
}

enum FbpBillStatus { approved, inReview, rejected, notUploaded }

FbpBillStatus _fbpBillStatus(Object? value) => switch (value) {
  'approved' => FbpBillStatus.approved,
  'in_review' => FbpBillStatus.inReview,
  'rejected' => FbpBillStatus.rejected,
  _ => FbpBillStatus.notUploaded,
};

/// The bill sent for a month, as HR sees it.
class FbpBill {
  const FbpBill({
    required this.id,
    required this.amountPaise,
    this.fileName,
    this.uploadedAt,
    this.decidedAt,
    this.reason,
  });

  final String id;
  final int amountPaise;
  final String? fileName;
  final DateTime? uploadedAt;
  final DateTime? decidedAt;

  /// HR's note when it was rejected.
  final String? reason;

  factory FbpBill.fromJson(Map<String, dynamic> json) => FbpBill(
    id: _string(json['id']),
    amountPaise: _paise(json['amountPaise']),
    fileName: _stringOrNull(json['fileName']),
    uploadedAt: _moment(json['uploadedAt']),
    decidedAt: _moment(json['decidedAt']),
    reason: _stringOrNull(json['reason']),
  );
}

/// One month of a head: its amount and where its bill stands.
class FbpMonth {
  const FbpMonth({
    required this.period,
    required this.amountPaise,
    required this.status,
    required this.canUpload,
    this.bill,
  });

  /// "2026-08".
  final String period;
  final int amountPaise;
  final FbpBillStatus status;
  final FbpBill? bill;

  /// A bill can be sent for it now.
  final bool canUpload;

  factory FbpMonth.fromJson(Map<String, dynamic> json) {
    final bill = json['bill'];
    return FbpMonth(
      period: _string(json['period']),
      amountPaise: _paise(json['amountPaise']),
      status: _fbpBillStatus(json['status']),
      canUpload: _bool(json['canUpload']),
      bill: bill is Map<String, dynamic> ? FbpBill.fromJson(bill) : null,
    );
  }
}

/// One head's page (GET /payroll/me/fbp/:code): every month of this FY so
/// far and its bill.
class FbpHead {
  const FbpHead({
    required this.code,
    required this.name,
    required this.fy,
    required this.amountPaise,
    required this.months,
    this.billType,
    this.billsDueOn,
    this.uploadsBlocked,
  });

  final String code;
  final String name;
  final String fy;
  final int amountPaise;
  final List<FbpMonth> months;

  /// The bill type new bills go in as, as HR named it ("Fuel").
  final String? billType;
  final DateTime? billsDueOn;

  /// Why bills can't be sent now (not set up, or closed), fit to show; null
  /// while they can.
  final String? uploadsBlocked;

  factory FbpHead.fromJson(Map<String, dynamic> json) => FbpHead(
    code: _string(json['code']),
    name: _string(json['name']),
    fy: _string(json['fy']),
    amountPaise: _paise(json['amountPaise']),
    months: _list(json['months']).map(FbpMonth.fromJson).toList(),
    billType: _stringOrNull(json['billType']),
    billsDueOn: payrollDate(json['billsDueOn']),
    uploadsBlocked: _stringOrNull(_map(json['uploadsBlocked'])['message']),
  );
}
