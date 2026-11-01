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
    this.payslipId,
  });

  final String period;

  /// "estimate" | "final".
  final String status;
  final String? payslipId;
  final int grossPaise;
  final double lopDays;
  final int lopPaise;
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
    grossPaise: _paise(json['grossPaise']),
    lopDays: _number(json['lopDays']),
    lopPaise: _paise(json['lopPaise']),
    deductions: _list(
      json['deductions'],
    ).map(PayrollDeduction.fromJson).toList(),
    netPaise: _paise(json['netPaise']),
    reimbursementsPaise: _paise(json['reimbursementsPaise']),
    takeHomePaise: _paise(json['takeHomePaise']),
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
    this.missingPunches,
    this.declaration,
  });

  final String period;
  final String fy;
  final bool hasSalaryStructure;
  final PayrollSalary? salary;
  final List<PayrollTodo> todo;
  final PayrollMissingPunches? missingPunches;
  final PayrollDeclarationState? declaration;

  factory PayrollHome.fromJson(Map<String, dynamic> json) {
    final salary = json['salary'];
    final missing = json['missingPunches'];
    final declaration = json['declaration'];
    return PayrollHome(
      period: _string(json['period']),
      fy: _string(json['fy']),
      hasSalaryStructure: json['hasSalaryStructure'] != false,
      salary: salary is Map<String, dynamic>
          ? PayrollSalary.fromJson(salary)
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
