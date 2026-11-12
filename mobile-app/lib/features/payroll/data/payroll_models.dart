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
    this.pending = 0,
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

  /// fbp_bills: the bills still to upload (rejected ones are [rejected]).
  final int pending;
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
    pending: _int(json['pending']),
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
    this.cards = PayrollHomeCards.none,
  });

  /// The summary carousel: last pay period's salary, this FY's tax and the
  /// flexible split, each null when there is nothing to show.
  final PayrollHomeCards cards;

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
      cards: PayrollHomeCards.fromJson(_map(json['cards'])),
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

/// The Payroll home's summary cards (`cards` on GET /payroll/home).
class PayrollHomeCards {
  const PayrollHomeCards({this.salary, this.tax, this.fbp});

  static const none = PayrollHomeCards();

  /// The last pay period's salary; null with no salary structure for it.
  final PayrollSalaryCard? salary;

  /// Income tax withheld this FY; null from a server without it.
  final PayrollTaxCard? tax;

  /// The flexible split; null when the salary has no flexible heads.
  final PayrollFbpCard? fbp;

  factory PayrollHomeCards.fromJson(Map<String, dynamic> json) {
    final salary = json['salary'];
    final tax = json['tax'];
    final fbp = json['fbp'];
    return PayrollHomeCards(
      salary: salary is Map<String, dynamic>
          ? PayrollSalaryCard.fromJson(salary)
          : null,
      tax: tax is Map<String, dynamic> ? PayrollTaxCard.fromJson(tax) : null,
      fbp: fbp is Map<String, dynamic> ? PayrollFbpCard.fromJson(fbp) : null,
    );
  }
}

/// The last pay period's salary as the home's first card: its released
/// payslip, else an estimate; or, when HR has not set something up,
/// [notConfigured] with the server's [message] and no figures.
class PayrollSalaryCard {
  const PayrollSalaryCard({
    required this.period,
    required this.label,
    this.notConfigured = false,
    this.message,
    this.released = false,
    this.payslipId,
    this.daysPaid,
    this.daysInPeriod,
    this.grossPaise = 0,
    this.takeHomePaise = 0,
    this.deductionsPaise = 0,
    this.lopPaise = 0,
    this.lopDays = 0,
    this.overtimePaise = 0,
    this.reimbursementsPaise = 0,
  });

  /// "2026-10", and its month as the card names it ("October").
  final String period;
  final String label;
  final bool notConfigured;
  final String? message;

  /// The payslip is out: the figures are final, not an estimate.
  final bool released;
  final String? payslipId;

  /// Paid days of [daysInPeriod] (the period's base days); null when the
  /// server does not know them.
  final double? daysPaid;
  final int? daysInPeriod;
  final int grossPaise;
  final int takeHomePaise;
  final int deductionsPaise;
  final int lopPaise;
  final double lopDays;

  /// Paid on top of the gross, inside the take-home.
  final int overtimePaise;
  final int reimbursementsPaise;

  int get extrasPaise => overtimePaise + reimbursementsPaise;

  factory PayrollSalaryCard.fromJson(Map<String, dynamic> json) =>
      PayrollSalaryCard(
        period: _string(json['period']),
        label: _string(json['label']),
        notConfigured: _bool(json['notConfigured']),
        message: _stringOrNull(json['message']),
        released: _bool(json['released']),
        payslipId: _stringOrNull(json['payslipId']),
        daysPaid: (json['daysPaid'] as num?)?.toDouble(),
        daysInPeriod: switch (json['daysInPeriod']) {
          final num n when n > 0 => n.toInt(),
          _ => null,
        },
        grossPaise: _paise(json['grossPaise']),
        takeHomePaise: _paise(json['takeHomePaise']),
        deductionsPaise: _paise(json['deductionsPaise']),
        lopPaise: _paise(json['lopPaise']),
        lopDays: _number(json['lopDays']),
        overtimePaise: _paise(json['overtimePaise']),
        reimbursementsPaise: _paise(json['reimbursementsPaise']),
      );
}

/// Income tax withheld this FY, as the home's second card: the released
/// payslips' TDS before this pay period, and this period's own (its payslip,
/// else the estimate). [notConfigured] when the FY's tax rules are not set
/// up.
class PayrollTaxCard {
  const PayrollTaxCard({
    required this.fy,
    this.notConfigured = false,
    this.message,
    this.regime,
    this.regimeChosen = false,
    this.paidSoFarPaise = 0,
    this.paidBeforeThisMonthPaise = 0,
    this.thisMonthPaise,
    this.thisMonthReleased = false,
    this.fromMonth,
    this.toMonth,
    this.thisMonth,
  });

  final String fy;
  final bool notConfigured;
  final String? message;

  /// "new" | "old".
  final String? regime;
  final bool regimeChosen;
  final int paidSoFarPaise;
  final int paidBeforeThisMonthPaise;

  /// Null while this period's pay can't be worked out.
  final int? thisMonthPaise;
  final bool thisMonthReleased;

  /// The months [paidSoFarPaise] covers, and this pay period's month.
  final DateTime? fromMonth;
  final DateTime? toMonth;
  final DateTime? thisMonth;

  factory PayrollTaxCard.fromJson(Map<String, dynamic> json) => PayrollTaxCard(
    fy: _string(json['fy']),
    notConfigured: _bool(json['notConfigured']),
    message: _stringOrNull(json['message']),
    regime: _stringOrNull(json['regime']),
    regimeChosen: _bool(json['regimeChosen']),
    paidSoFarPaise: _paise(json['paidSoFarPaise']),
    paidBeforeThisMonthPaise: _paise(json['paidBeforeThisMonthPaise']),
    thisMonthPaise: _paiseOrNull(json['thisMonthPaise']),
    thisMonthReleased: _bool(json['thisMonthReleased']),
    fromMonth: payrollMonth(json['fromMonth']),
    toMonth: payrollMonth(json['toMonth']),
    thisMonth: payrollMonth(json['thisMonth']),
  );
}

/// One flexible head and what goes to it a month.
class PayrollFbpHead {
  const PayrollFbpHead({
    required this.code,
    required this.name,
    required this.amountPaise,
  });

  final String code;
  final String name;
  final int amountPaise;

  factory PayrollFbpHead.fromJson(Map<String, dynamic> json) => PayrollFbpHead(
    code: _string(json['code']),
    name: _string(json['name']),
    amountPaise: _paise(json['amountPaise']),
  );
}

/// The flexible pool as split, as the home's third card.
class PayrollFbpCard {
  const PayrollFbpCard({
    required this.heads,
    this.poolPaise,
    this.unassignedPaise,
  });

  /// Null while HR has not set the pool.
  final int? poolPaise;
  final List<PayrollFbpHead> heads;
  final int? unassignedPaise;

  int get assignedPaise => heads.fold(0, (sum, h) => sum + h.amountPaise);

  /// The pool, or what is split when the pool is not set.
  int get totalPaise => poolPaise ?? assignedPaise;

  factory PayrollFbpCard.fromJson(Map<String, dynamic> json) => PayrollFbpCard(
    poolPaise: _paiseOrNull(json['poolPaise']),
    heads: _list(json['heads']).map(PayrollFbpHead.fromJson).toList(),
    unassignedPaise: _paiseOrNull(json['unassignedPaise']),
  );
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

// ---------------------------------------------------------------- EPF

/// The PF put in through Sowaka payroll: the employee's and the employer's
/// EPF share (not the pension share) from released payslips.
class EpfSaved {
  const EpfSaved({
    required this.employeePaise,
    required this.employerEpfPaise,
    required this.months,
    this.sincePeriod,
    this.throughPeriod,
  });

  final int employeePaise;
  final int employerEpfPaise;
  final int months;

  /// The first and last month ("2026-04") with PF on a payslip.
  final String? sincePeriod;
  final String? throughPeriod;

  int get totalPaise => employeePaise + employerEpfPaise;

  factory EpfSaved.fromJson(Map<String, dynamic> json) => EpfSaved(
    employeePaise: _paise(json['employeePaise']),
    employerEpfPaise: _paise(json['employerEpfPaise']),
    months: _int(json['months']),
    sincePeriod: _stringOrNull(json['sincePeriod']),
    throughPeriod: _stringOrNull(json['throughPeriod']),
  );
}

/// A PF balance typed in from the EPFO passbook (by the person or HR), with
/// the PF payroll put in after its date.
class EpfBalance {
  const EpfBalance({
    required this.balancePaise,
    required this.asOn,
    required this.source,
    required this.addedSincePaise,
    required this.totalPaise,
  });

  final int balancePaise;
  final DateTime asOn;

  /// "employee" | "hr".
  final String source;
  final int addedSincePaise;

  /// [balancePaise] + [addedSincePaise]: what the card shows.
  final int totalPaise;

  static EpfBalance? fromJson(Map<String, dynamic> json) {
    final asOn = payrollDate(json['asOn']);
    if (asOn == null) return null;
    return EpfBalance(
      balancePaise: _paise(json['balancePaise']),
      asOn: asOn,
      source: _string(json['source']),
      addedSincePaise: _paise(json['addedSincePaise']),
      totalPaise: _paise(json['totalPaise']),
    );
  }
}

/// This month's PF from the salary structure, on the year's rates.
class EpfMonthly {
  const EpfMonthly({
    required this.employeePaise,
    required this.employerEpfPaise,
    required this.employerEpsPaise,
    required this.pfWagePaise,
    required this.ratePercent,
    required this.employerRatePercent,
  });

  final int employeePaise;
  final int employerEpfPaise;
  final int employerEpsPaise;

  /// The wage [ratePercent] is taken of.
  final int pfWagePaise;
  final double ratePercent;
  final double employerRatePercent;

  factory EpfMonthly.fromJson(Map<String, dynamic> json) => EpfMonthly(
    employeePaise: _paise(json['employeePaise']),
    employerEpfPaise: _paise(json['employerEpfPaise']),
    employerEpsPaise: _paise(json['employerEpsPaise']),
    pfWagePaise: _paise(json['pfWagePaise']),
    ratePercent: _number(json['ratePercent']),
    employerRatePercent: _number(json['employerRatePercent']),
  );
}

/// The EPF page: what Sowaka knows about the person's PF. The full balance,
/// with interest and past employers, is on EPFO.
class EpfSummary {
  const EpfSummary({
    required this.enrolled,
    required this.saved,
    this.notEnrolledReason,
    this.uan,
    this.uanLast4,
    this.balance,
    this.monthly,
    this.notSetUpMessage,
  });

  final bool enrolled;

  /// "no_salary_structure" | "pf_off_for_company" | "pf_off_for_you" |
  /// "not_deducted".
  final String? notEnrolledReason;

  /// The person's own UAN in full, for Copy; null when none is recorded.
  final String? uan;

  /// Its last four, when the UAN is on record but could not be read.
  final String? uanLast4;
  final EpfSaved saved;
  final EpfBalance? balance;

  /// Null when the year's statutory settings are missing
  /// ([notSetUpMessage] says so, ending "Ask HR.").
  final EpfMonthly? monthly;
  final String? notSetUpMessage;

  factory EpfSummary.fromJson(Map<String, dynamic> json) {
    final monthly = json['monthly'];
    final balance = json['balance'];
    return EpfSummary(
      enrolled: _bool(json['enrolled']),
      notEnrolledReason: _stringOrNull(json['notEnrolledReason']),
      uan: _stringOrNull(json['uan']),
      uanLast4: _stringOrNull(json['uanLast4']),
      saved: EpfSaved.fromJson(_map(json['savedThroughSowaka'])),
      balance: balance is Map<String, dynamic>
          ? EpfBalance.fromJson(balance)
          : null,
      monthly: monthly is Map<String, dynamic>
          ? EpfMonthly.fromJson(monthly)
          : null,
      notSetUpMessage: _stringOrNull(_map(json['notSetUp'])['message']),
    );
  }
}

// ---------------------------------------------------------------- salary summary

/// One line of the salary receipt (GET /payroll/me/salary): gross, loss of
/// pay, a deduction, overtime or reimbursements, with what it is in words.
class PayrollSalaryLine {
  const PayrollSalaryLine({
    required this.key,
    required this.label,
    required this.amountPaise,
    required this.kind,
    required this.explanation,
  });

  /// "gross" | "lop" | "overtime" | "epf" | "esi" | "income_tax" | "pt" |
  /// "lwf" | "reimbursements" | "other_deductions" | a pay head code.
  final String key;
  final String label;
  final int amountPaise;

  /// "earning" (adds to the take-home), "deduction" or "lop" (comes off it).
  final String kind;
  final String explanation;

  bool get isEarning => kind == 'earning';
  bool get isLop => kind == 'lop';

  factory PayrollSalaryLine.fromJson(Map<String, dynamic> json) =>
      PayrollSalaryLine(
        key: _string(json['key']),
        label: _string(json['label']),
        amountPaise: _paise(json['amountPaise']),
        kind: _string(json['kind']).isEmpty
            ? 'deduction'
            : _string(json['kind']),
        explanation: _string(json['explanation']),
      );
}

/// What the loss of pay is made of.
class PayrollSalaryLop {
  const PayrollSalaryLop({
    required this.days,
    this.absentDays = 0,
    this.halfDays = 0,
    this.missedPunchDays = 0,
    this.unpaidLeaveDays = 0,
    this.perDayPaise,
    this.enteredByHr = false,
  });

  final double days;
  final int absentDays;
  final int halfDays;
  final double missedPunchDays;
  final double unpaidLeaveDays;

  /// One day's pay: gross ÷ base days.
  final int? perDayPaise;
  final bool enteredByHr;

  factory PayrollSalaryLop.fromJson(Map<String, dynamic> json) =>
      PayrollSalaryLop(
        days: _number(json['days']),
        absentDays: _int(json['absentDays']),
        halfDays: _int(json['halfDays']),
        missedPunchDays: _number(json['missedPunchDays']),
        unpaidLeaveDays: _number(json['unpaidLeaveDays']),
        perDayPaise: _paiseOrNull(json['perDayPaise']),
        enteredByHr: _bool(json['enteredByHr']),
      );
}

/// One pay period's salary as a receipt: the released payslip's figures, or
/// the estimate from attendance so far, each line explained.
class PayrollSalarySummary {
  const PayrollSalarySummary({
    required this.period,
    required this.label,
    required this.released,
    required this.lines,
    required this.unpaidDays,
    this.payslipId,
    this.periodFrom,
    this.periodTo,
    this.daysPaid,
    this.daysInPeriod,
    this.baseDays,
    this.grossPaise,
    this.takeHomePaise,
    this.lop,
    this.payslipCount = 0,
    this.payslipsFrom,
    this.payslipsTo,
    this.notSetUp,
    this.view,
    this.currentPeriod,
    this.previousPeriod,
  });

  /// "2026-10"; [label] "October 2026".
  final String period;
  final String label;

  /// The side of the Previous Month | Current Month switch this is
  /// ("previous" or "current"), or null when a month was asked for; and the
  /// two pay periods the switch flips between ("2026-11", "2026-10").
  final String? view;
  final String? currentPeriod;
  final String? previousPeriod;

  /// The payslip is out: the figures are final.
  final bool released;
  final String? payslipId;
  final DateTime? periodFrom;
  final DateTime? periodTo;
  final double? daysPaid;
  final int? daysInPeriod;
  final int? baseDays;
  final int? grossPaise;
  final int? takeHomePaise;
  final List<PayrollSalaryLine> lines;
  final PayrollSalaryLop? lop;

  /// The unpaid-days list "Check unpaid days" opens.
  final PayrollMissingPunches unpaidDays;

  /// Released payslips: how many, and the first and last month.
  final int payslipCount;
  final DateTime? payslipsFrom;
  final DateTime? payslipsTo;

  /// Set (and the figures null) when the pay can't be worked out yet.
  final PayrollSalaryNotSetUp? notSetUp;

  bool get isEstimate => !released;

  factory PayrollSalarySummary.fromJson(Map<String, dynamic> json) {
    final payslips = _map(json['payslips']);
    final notSetUp = json['notSetUp'];
    return PayrollSalarySummary(
      period: _string(json['period']),
      label: _string(json['label']),
      released: _bool(json['released']),
      payslipId: _stringOrNull(json['payslipId']),
      periodFrom: payrollDate(json['periodFrom']),
      periodTo: payrollDate(json['periodTo']),
      daysPaid: (json['daysPaid'] as num?)?.toDouble(),
      daysInPeriod: (json['daysInPeriod'] as num?)?.toInt(),
      baseDays: (json['baseDays'] as num?)?.toInt(),
      grossPaise: _paiseOrNull(json['grossPaise']),
      takeHomePaise: _paiseOrNull(json['takeHomePaise']),
      lines: _list(json['lines']).map(PayrollSalaryLine.fromJson).toList(),
      lop: json['lop'] is Map<String, dynamic>
          ? PayrollSalaryLop.fromJson(json['lop'] as Map<String, dynamic>)
          : null,
      unpaidDays: PayrollMissingPunches.fromJson({
        'period': _string(json['period']),
        ..._map(json['unpaidDays']),
      }),
      payslipCount: _int(payslips['count']),
      payslipsFrom: payrollMonth(payslips['from']),
      payslipsTo: payrollMonth(payslips['to']),
      notSetUp: notSetUp is Map<String, dynamic>
          ? PayrollSalaryNotSetUp.fromJson(notSetUp)
          : null,
      view: _stringOrNull(json['view']),
      currentPeriod: _stringOrNull(json['currentPeriod']),
      previousPeriod: _stringOrNull(json['previousPeriod']),
    );
  }

  /// What the deduction lines (PF, tax, PT…) take, loss of pay apart.
  int get deductionsPaise => lines
      .where((line) => !line.isEarning && !line.isLop)
      .fold(0, (sum, line) => sum + line.amountPaise);

  /// The loss-of-pay line's amount, or 0.
  int get lopPaise => lines
      .where((line) => line.isLop)
      .fold(0, (sum, line) => sum + line.amountPaise);
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

  /// How much each − / + moves this head, as HR set it (Payroll in the app).
  /// 0 when HR has not set it: the steppers stay off and the split says it
  /// is not set up. There is no step made up here.
  final int stepPaise;
  final FbpBills bills;

  factory FbpComponent.fromJson(Map<String, dynamic> json) => FbpComponent(
    code: _string(json['code']),
    name: _string(json['name']),
    limitPaise: _paise(json['limitPaise']),
    amountPaise: _paise(json['amountPaise']),
    stepPaise: _paise(json['stepPaise']),
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
    this.notConfigured = false,
    this.missing = const [],
    this.billsAcknowledgedAt,
    this.serverEditable,
    this.lockedReason,
    this.closesOn,
  });

  final bool available;
  final int poolPaise;
  final int assignedPaise;
  final int unassignedPaise;
  final List<FbpComponent> components;
  final FbpWindow window;
  final DateTime? currentEffectiveFrom;
  final DateTime? billsDueOn;

  /// HR has not set something the split needs (the pool, the cutoff day,
  /// the bills date, the − / + step): it shows, but cannot be changed.
  final bool notConfigured;

  /// What is not set: "flexiblePoolPaise", "splitCutoffDay", "billsDue",
  /// "splitStepPaise".
  final List<String> missing;

  /// When the split in force had its "I'll keep bills" tick; null for one
  /// saved before that was kept, or no split yet.
  final DateTime? billsAcknowledgedAt;

  /// The server's own word on whether the split can change now; null from
  /// a server that does not send it.
  final bool? serverEditable;

  /// Why it can't: "locked_for_fy" once the FY's close date has passed.
  final String? lockedReason;

  /// While it can: the last day to change it.
  final DateTime? closesOn;

  /// The split is locked for the rest of this FY: a change goes through a
  /// ticket.
  bool get lockedForFy => lockedReason == 'locked_for_fy';

  /// The split can be changed now: the window is open, HR has set up
  /// everything it needs, and the server has not locked it.
  bool get editable =>
      available &&
      window.open &&
      !notConfigured &&
      serverEditable != false &&
      !lockedForFy;

  factory FbpSplit.fromJson(Map<String, dynamic> json) {
    final step = _paise(json['stepPaise']);
    final components = _list(json['components']).map((c) {
      final head = FbpComponent.fromJson(c);
      // A server that sends the step once, on the split, rather than per head.
      return head.stepPaise > 0 || step <= 0
          ? head
          : FbpComponent(
              code: head.code,
              name: head.name,
              limitPaise: head.limitPaise,
              amountPaise: head.amountPaise,
              stepPaise: step,
              bills: head.bills,
            );
    }).toList();
    return FbpSplit(
      available: _bool(json['available']),
      poolPaise: _paise(json['poolPaise']),
      assignedPaise: _paise(json['assignedPaise']),
      unassignedPaise: _paise(json['unassignedPaise']),
      components: components,
      window: FbpWindow.fromJson(_map(json['window'])),
      currentEffectiveFrom: payrollMonth(
        _map(json['current'])['effectiveFrom'],
      ),
      billsDueOn: payrollDate(json['billsDueOn']),
      notConfigured: _bool(json['notConfigured']),
      missing: [
        if (json['missing'] is List)
          for (final m in json['missing'] as List)
            if (m is String) m,
      ],
      billsAcknowledgedAt: _moment(
        _map(json['current'])['billsAcknowledgedAt'],
      ),
      serverEditable: json['editable'] is bool
          ? json['editable'] as bool
          : null,
      lockedReason: _stringOrNull(json['lockedReason']),
      closesOn: payrollDate(json['closesOn']),
    );
  }
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

// ---------------------------------------------------------------- earnings

/// One part of the yearly salary: Basic, House rent allowance, an FBP head …
class EarningsComponent {
  const EarningsComponent({
    required this.code,
    required this.name,
    required this.annualPaise,
  });

  final String code;
  final String name;
  final int annualPaise;

  factory EarningsComponent.fromJson(Map<String, dynamic> json) =>
      EarningsComponent(
        code: _string(json['code']),
        name: _string(json['name']),
        annualPaise: _paise(json['annualPaise']),
      );
}

/// One paid month of the year: a released payslip, or this pay period's
/// estimate.
class EarningsMonth {
  const EarningsMonth({
    required this.period,
    required this.label,
    required this.grossPaise,
    required this.netPaise,
    required this.unpaidDays,
    required this.isEstimate,
    this.payslipId,
  });

  /// "2026-10".
  final String period;

  /// "October 2026".
  final String label;

  /// Gross paid that month (after loss of pay).
  final int grossPaise;

  /// What reached the bank (or will, for the estimate).
  final int netPaise;

  /// Loss-of-pay days; halves count.
  final double unpaidDays;
  final bool isEstimate;

  /// The released payslip behind the month; null for the estimate.
  final String? payslipId;

  factory EarningsMonth.fromJson(Map<String, dynamic> json) => EarningsMonth(
    period: _string(json['period']),
    label: _string(json['label']),
    grossPaise: _paise(json['grossPaise']),
    netPaise: _paise(json['netPaise']),
    unpaidDays: _number(json['unpaidDays']),
    isEstimate: json['status'] == 'estimate',
    payslipId: _stringOrNull(json['payslipId']),
  );
}

/// Why a part of Earnings can't be shown yet: something HR sets up.
class EarningsNotSetUp {
  const EarningsNotSetUp({required this.reason, required this.message});

  final String reason;
  final String message;

  static EarningsNotSetUp? fromJson(Object? value) {
    final json = _map(value);
    if (json.isEmpty) return null;
    return EarningsNotSetUp(
      reason: _string(json['reason']),
      message: _string(json['message']),
    );
  }
}

/// A financial year's earnings (GET /payroll/me/earnings): the years with
/// pay, the year's gross and what came off it, the yearly salary, and each
/// paid month.
class PayrollEarnings {
  const PayrollEarnings({
    required this.fy,
    required this.current,
    required this.fys,
    required this.span,
    required this.grossPaise,
    required this.taxPaise,
    required this.pfPtPaise,
    required this.otherDeductionsPaise,
    required this.reimbursementsPaise,
    required this.takeHomePaise,
    required this.fromStructure,
    required this.components,
    required this.annualTotalPaise,
    required this.months,
    this.componentsNotSetUp,
    this.estimateNotSetUp,
  });

  /// "2026-27".
  final String fy;

  /// The year it is now: its gross is "so far".
  final bool current;

  /// The years with pay, newest first.
  final List<String> fys;

  /// "Apr–Oct"; null with no month paid.
  final String? span;
  final int grossPaise;
  final int taxPaise;
  final int pfPtPaise;
  final int otherDeductionsPaise;
  final int reimbursementsPaise;
  final int takeHomePaise;

  /// The yearly salary is the salary structure (the current year); else
  /// what the year's payslips were entitled to.
  final bool fromStructure;
  final List<EarningsComponent> components;
  final int annualTotalPaise;
  final List<EarningsMonth> months;
  final EarningsNotSetUp? componentsNotSetUp;
  final EarningsNotSetUp? estimateNotSetUp;

  factory PayrollEarnings.fromJson(Map<String, dynamic> json) =>
      PayrollEarnings(
        fy: _string(json['fy']),
        current: _bool(json['current']),
        fys: [
          if (json['fys'] is List)
            for (final fy in json['fys'] as List)
              if (fy is String) fy,
        ],
        span: _stringOrNull(json['span']),
        grossPaise: _paise(json['grossPaise']),
        taxPaise: _paise(json['taxPaise']),
        pfPtPaise: _paise(json['pfPtPaise']),
        otherDeductionsPaise: _paise(json['otherDeductionsPaise']),
        reimbursementsPaise: _paise(json['reimbursementsPaise']),
        takeHomePaise: _paise(json['takeHomePaise']),
        fromStructure: json['componentsSource'] != 'payslips',
        components: _list(
          json['components'],
        ).map(EarningsComponent.fromJson).toList(),
        annualTotalPaise: _paise(json['annualTotalPaise']),
        months: _list(json['months']).map(EarningsMonth.fromJson).toList(),
        componentsNotSetUp: EarningsNotSetUp.fromJson(
          json['componentsNotSetUp'],
        ),
        estimateNotSetUp: EarningsNotSetUp.fromJson(json['estimateNotSetUp']),
      );
}

// ---------------------------------------------------------------- downloads (Form 16)

/// The financial year a month falls in: April 2026 to March 2027 is
/// "2026-27".
String payrollFyOf(DateTime month) {
  final start = month.month >= 4 ? month.year : month.year - 1;
  return '$start-${((start + 1) % 100).toString().padLeft(2, '0')}';
}

/// "2026-27" as it is written for people: "FY 2026–27".
String payrollFyLabel(String fy) => 'FY ${fy.replaceFirst('-', '–')}';

/// One Form 16 file HR filed: a Part A, a Part B, or both in one PDF.
class Form16Document {
  const Form16Document({
    required this.id,
    required this.fy,
    required this.part,
    required this.fileName,
    this.size = 0,
    this.uploadedAt,
  });

  final String id;
  final String fy;

  /// "A", "B" or "combined".
  final String part;
  final String fileName;
  final int size;
  final DateTime? uploadedAt;

  factory Form16Document.fromJson(Map<String, dynamic> json) => Form16Document(
    id: _string(json['id']),
    fy: _string(json['fy']),
    part: _string(json['part']),
    fileName: _string(json['fileName']),
    size: _int(json['size']),
    uploadedAt: _moment(json['uploadedAt']),
  );
}

enum Form16Status {
  /// Files to download.
  ready,

  /// Not due yet: ready by [Form16Year.readyBy].
  pending,

  /// Past its due date with nothing filed: ask HR.
  missing,
}

/// One financial year's Form 16 for the signed-in person.
class Form16Year {
  const Form16Year({
    required this.fy,
    required this.status,
    required this.documents,
    this.readyBy,
  });

  final String fy;
  final Form16Status status;

  /// 15 June after the year ends, as the server works it out.
  final DateTime? readyBy;
  final List<Form16Document> documents;

  /// Both parts are there, in one file or two.
  bool get complete =>
      documents.any((d) => d.part == 'combined') ||
      (documents.any((d) => d.part == 'A') &&
          documents.any((d) => d.part == 'B'));

  factory Form16Year.fromJson(Map<String, dynamic> json) => Form16Year(
    fy: _string(json['fy']),
    status: switch (json['status']) {
      'ready' => Form16Status.ready,
      'missing' => Form16Status.missing,
      _ => Form16Status.pending,
    },
    readyBy: payrollDate(json['readyBy']),
    documents: _list(json['documents']).map(Form16Document.fromJson).toList(),
  );
}

/// Downloads › Form 16: the person's years, newest first, and the return
/// filing date the tip quotes.
class Form16Overview {
  const Form16Overview({
    required this.currentFy,
    required this.years,
    this.filingFy,
    this.filingLastDate,
  });

  final String currentFy;

  /// The last FY that has ended, and the last day to file its return.
  final String? filingFy;
  final DateTime? filingLastDate;
  final List<Form16Year> years;

  factory Form16Overview.fromJson(Map<String, dynamic> json) {
    final filing = _map(json['filing']);
    return Form16Overview(
      currentFy: _string(json['currentFy']),
      filingFy: _stringOrNull(filing['fy']),
      filingLastDate: payrollDate(filing['lastDate']),
      years: _list(json['years']).map(Form16Year.fromJson).toList(),
    );
  }
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
    this.closed,
  });

  final String fy;

  /// "new" | "old".
  final String regime;
  final bool chosen;

  /// Past the due date: when it closed and what was declared by then.
  final TaxDeclarationClosed? closed;

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
    closed: json['closed'] is Map<String, dynamic>
        ? TaxDeclarationClosed.fromJson(json['closed'])
        : null,
    sections: _list(
      json['sections'],
    ).map(TaxDeclarationSection.fromJson).toList(),
  );
}

/// A declaration past its last date: "Declaration closed on 30 Nov · You
/// declared ₹1,28,400 in 4 items", and where the rest can still go.
class TaxDeclarationClosed {
  const TaxDeclarationClosed({
    required this.itemsDeclared,
    required this.declaredPaise,
    required this.countedPaise,
    this.closedOn,
    this.lastPayPeriod,
    this.itrDueOn,
  });

  final DateTime? closedOn;

  /// Items the person declared above zero (payroll's PF is not one).
  final int itemsDeclared;

  /// The year's declared total, PF from payroll left out.
  final int declaredPaise;

  /// What counts against the caps on the old regime (0 on the new).
  final int countedPaise;

  /// The FY's last pay month (March).
  final DateTime? lastPayPeriod;

  /// The FY's income tax return due date (31 July after it ends).
  final DateTime? itrDueOn;

  factory TaxDeclarationClosed.fromJson(Map<String, dynamic> json) =>
      TaxDeclarationClosed(
        closedOn: payrollDate(json['closedOn']),
        itemsDeclared: _int(json['itemsDeclared']),
        declaredPaise: _int(json['declaredPaise']),
        countedPaise: _int(json['countedPaise']),
        lastPayPeriod: payrollMonth(json['lastPayPeriod']),
        itrDueOn: payrollDate(json['itrDueOn']),
      );
}

// ---------------------------------------------------------------- tax summary

/// One month of the year's tax: what its released payslip withheld, or the
/// figure a run would take now.
class TaxMonth {
  const TaxMonth({
    required this.period,
    required this.label,
    required this.status,
    this.amountPaise,
  });

  /// "2026-04".
  final String period;

  /// "April 2026".
  final String label;

  /// "paid" | "estimate" | "no_payslip" (before joining, or paid elsewhere).
  final String status;

  /// Null for a month with no payslip, and for estimates while the tax
  /// can't be worked out.
  final int? amountPaise;

  bool get isPaid => status == 'paid';
  bool get isEstimate => status == 'estimate';

  factory TaxMonth.fromJson(Map<String, dynamic> json) => TaxMonth(
    period: _string(json['period']),
    label: _string(json['label']),
    status: _string(json['status']),
    amountPaise: _paiseOrNull(json['amountPaise']),
  );
}

/// The financial year's income tax (GET /payroll/me/tax): the year's figure
/// from the TDS engine, what has been paid, the monthly figure now and the
/// regime with its last date to change. When HR has not set something up,
/// [notConfigured] with [reason] and [message], and no figures.
class TaxSummary {
  const TaxSummary({
    required this.fy,
    required this.regime,
    required this.chosen,
    required this.defaultRegime,
    required this.locked,
    required this.canChangeRegime,
    required this.notConfigured,
    required this.paidSoFarPaise,
    required this.months,
    required this.missing,
    this.regimeDueOn,
    this.proofsDueOn,
    this.reason,
    this.message,
    this.annualTaxPaise,
    this.paidThroughMonth,
    this.monthlyNowPaise,
    this.estimate = true,
  });

  final String fy;

  /// "new" | "old".
  final String regime;
  final bool chosen;
  final String defaultRegime;
  final DateTime? regimeDueOn;
  final DateTime? proofsDueOn;
  final bool locked;
  final bool canChangeRegime;
  final bool notConfigured;

  /// "tax_rules_not_set_up" | "tds_off" | "salary_not_set_up" |
  /// "statutory_not_set_up".
  final String? reason;
  final String? message;

  /// The deadlines HR has not set: "declarationDue", "proofsDue".
  final List<String> missing;
  final int? annualTaxPaise;
  final int paidSoFarPaise;

  /// The last month with a released payslip ("2026-09"), as its first day.
  final DateTime? paidThroughMonth;
  final int? monthlyNowPaise;
  final List<TaxMonth> months;
  final bool estimate;

  bool get isOld => regime == 'old';

  factory TaxSummary.fromJson(Map<String, dynamic> json) => TaxSummary(
    fy: _string(json['fy']),
    regime: _string(json['regime']) == 'old' ? 'old' : 'new',
    chosen: _bool(json['chosen']),
    defaultRegime: _string(json['defaultRegime']) == 'old' ? 'old' : 'new',
    regimeDueOn: payrollDate(json['regimeDueOn']),
    proofsDueOn: payrollDate(json['proofsDueOn']),
    locked: _bool(json['locked']),
    canChangeRegime: _bool(json['canChangeRegime']),
    notConfigured: _bool(json['notConfigured']),
    reason: _stringOrNull(json['reason']),
    message: _stringOrNull(json['message']),
    missing: [
      if (json['missing'] is List)
        for (final item in json['missing'] as List)
          if (item is String) item,
    ],
    annualTaxPaise: _paiseOrNull(json['annualTaxPaise']),
    paidSoFarPaise: _paise(json['paidSoFarPaise']),
    paidThroughMonth: payrollMonth(json['paidThroughMonth']),
    monthlyNowPaise: _paiseOrNull(json['monthlyNowPaise']),
    months: _list(json['months']).map(TaxMonth.fromJson).toList(),
    estimate: json['estimate'] != false,
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
    this.landlordPan,
  });

  final String id;
  final String fileName;
  final String contentType;
  final int size;
  final int amountPaise;
  final DateTime? uploadedAt;
  final DateTime? decidedAt;
  final String? reason;

  /// Rent only: the landlord's PAN sent with the proof.
  final String? landlordPan;

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
        landlordPan: _stringOrNull(json['landlordPan']),
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
    this.perMonth = false,
    this.monthsFrom,
    this.monthsTo,
    this.document,
    int? yearPaise,
  }) : _yearPaise = yearPaise;

  final String item;
  final String label;
  final String section;
  final int declaredPaise;
  final ProofStatus status;
  final InvestmentProofFile? proof;

  /// [declaredPaise] is a month's amount (rent), for [monthsFrom]–[monthsTo].
  final bool perMonth;
  final DateTime? monthsFrom;
  final DateTime? monthsTo;

  /// What to upload: "Interest certificate from the bank". Null from an
  /// older server.
  final String? document;

  final int? _yearPaise;

  /// The FY's amount, which the amount on a proof is set against: rent's is
  /// twelve months of it.
  int get yearPaise =>
      _yearPaise ??
      (perMonth || item == 'rentMonthly' ? declaredPaise * 12 : declaredPaise);

  factory InvestmentProofItem.fromJson(Map<String, dynamic> json) {
    final proof = json['proof'];
    final months = _map(json['months']);
    return InvestmentProofItem(
      item: _string(json['item']),
      label: _string(json['label']),
      section: _string(json['section']),
      declaredPaise: _paise(json['declaredPaise']),
      status: _proofStatus(json['status']),
      proof: proof is Map<String, dynamic>
          ? InvestmentProofFile.fromJson(proof)
          : null,
      perMonth: _bool(json['perMonth']),
      monthsFrom: payrollMonth(months['from']),
      monthsTo: payrollMonth(months['to']),
      document: _stringOrNull(json['document']),
      yearPaise: _paiseOrNull(json['yearPaise']),
    );
  }
}

/// One section's card on the proofs page: "80C" and the items under it.
class InvestmentProofSection {
  const InvestmentProofSection({
    required this.key,
    required this.label,
    required this.items,
  });

  final String key;
  final String label;
  final List<InvestmentProofItem> items;
}

/// Past the proofs due date: when it closed, what never made it, and the
/// two ways left — HR, for the FY's last pay month, or the tax return.
class InvestmentProofsClosed {
  const InvestmentProofsClosed({
    required this.submitted,
    required this.notSubmitted,
    required this.total,
    this.closedOn,
    this.lastPayPeriod,
    this.itrDueOn,
    this.counted,
  });

  /// "What counted": each item proved or not, for the year.
  final InvestmentProofsCounted? counted;

  final DateTime? closedOn;
  final int submitted;
  final int notSubmitted;
  final int total;

  /// The FY's last pay month (March).
  final DateTime? lastPayPeriod;

  /// The FY's income tax return due date (31 July after it ends).
  final DateTime? itrDueOn;

  factory InvestmentProofsClosed.fromJson(Map<String, dynamic> json) =>
      InvestmentProofsClosed(
        closedOn: payrollDate(json['closedOn']),
        submitted: _int(json['submitted']),
        notSubmitted: _int(json['notSubmitted']),
        total: _int(json['total']),
        lastPayPeriod: payrollMonth(json['lastPayPeriod']),
        itrDueOn: payrollDate(json['itrDueOn']),
        counted: json['counted'] is Map<String, dynamic>
            ? InvestmentProofsCounted.fromJson(json['counted'])
            : null,
      );
}

/// One line of "What counted": a declared item, proved or not.
class InvestmentProofCountedRow {
  const InvestmentProofCountedRow({
    required this.item,
    required this.label,
    required this.provedPaise,
    required this.notProvedPaise,
  });

  final String item;
  final String label;
  final int provedPaise;
  final int notProvedPaise;

  factory InvestmentProofCountedRow.fromJson(Map<String, dynamic> json) =>
      InvestmentProofCountedRow(
        item: _string(json['item']),
        label: _string(json['label']),
        provedPaise: _paise(json['provedPaise']),
        notProvedPaise: _paise(json['notProvedPaise']),
      );
}

/// What the closed proofs leave counting for the year, and the PF that
/// counts with no proof.
class InvestmentProofsCounted {
  const InvestmentProofsCounted({
    required this.rows,
    required this.provedPaise,
    required this.notProvedPaise,
    required this.pfPaise,
  });

  final List<InvestmentProofCountedRow> rows;
  final int provedPaise;
  final int notProvedPaise;
  final int pfPaise;

  factory InvestmentProofsCounted.fromJson(Map<String, dynamic> json) =>
      InvestmentProofsCounted(
        rows: _list(
          json['rows'],
        ).map(InvestmentProofCountedRow.fromJson).toList(),
        provedPaise: _paise(json['provedPaise']),
        notProvedPaise: _paise(json['notProvedPaise']),
        pfPaise: _paise(json['pfPaise']),
      );
}

class InvestmentProofs {
  const InvestmentProofs({
    required this.fy,
    required this.regime,
    required this.required,
    required this.locked,
    required this.items,
    this.dueOn,
    this.notConfigured = false,
    this.closed,
    this.sectionLabels = const {},
  });

  final String fy;
  final String regime;

  /// False on the new regime: nothing to prove.
  final bool required;
  final DateTime? dueOn;
  final bool locked;
  final List<InvestmentProofItem> items;

  /// HR has not set the proofs due date: nothing can be uploaded yet.
  final bool notConfigured;

  /// Set once the due date has passed.
  final InvestmentProofsClosed? closed;

  /// The server's sections in its order: key → card title.
  final Map<String, String> sectionLabels;

  int count(ProofStatus status) =>
      items.where((item) => item.status == status).length;

  /// The items in their section cards, in the server's order. An older
  /// server sends no sections: the items' own order, the key as the title.
  List<InvestmentProofSection> get sections {
    final order = <String>{
      ...sectionLabels.keys,
      for (final item in items) item.section,
    };
    return [
      for (final key in order)
        if (items.where((item) => item.section == key).toList()
            case final grouped when grouped.isNotEmpty)
          InvestmentProofSection(
            key: key,
            label: sectionLabels[key] ?? key,
            items: grouped,
          ),
    ];
  }

  factory InvestmentProofs.fromJson(Map<String, dynamic> json) {
    final closed = json['closed'];
    return InvestmentProofs(
      fy: _string(json['fy']),
      regime: _string(json['regime']),
      required: _bool(json['required']),
      dueOn: payrollDate(json['dueOn']),
      locked: _bool(json['locked']),
      notConfigured: _bool(json['notConfigured']),
      closed: closed is Map<String, dynamic>
          ? InvestmentProofsClosed.fromJson(closed)
          : null,
      sectionLabels: {
        for (final section in _list(json['sections']))
          _string(section['key']): _string(section['label']),
      },
      items: _list(json['items']).map(InvestmentProofItem.fromJson).toList(),
    );
  }

  InvestmentProofs replacing(InvestmentProofItem updated) => InvestmentProofs(
    fy: fy,
    regime: regime,
    required: required,
    dueOn: dueOn,
    locked: locked,
    notConfigured: notConfigured,
    closed: closed,
    sectionLabels: sectionLabels,
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
    this.reason,
    this.missing = const [],
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

  /// Why it is locked: "locked_for_fy"; null while open.
  final String? reason;

  /// What HR has not set for it, as the server names it.
  final List<String> missing;

  factory FbpLock.fromJson(Map<String, dynamic> json) => FbpLock(
    locked: _bool(json['locked']),
    notConfigured: _bool(json['notConfigured']),
    effectiveFrom: payrollMonth(json['effectiveFrom']),
    closesOn: payrollDate(json['closesOn']),
    reason: _stringOrNull(json['reason']),
    missing: [
      if (json['missing'] is List)
        for (final m in json['missing'] as List)
          if (m is String) m,
    ],
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
    this.monthlyDueOn,
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

  /// The last day to send this month's bills; null when HR has not set a
  /// monthly date (then [billsDueOn], the FY's, is the one shown).
  final DateTime? monthlyDueOn;
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
      monthlyDueOn: payrollDate(json['monthlyDueOn']),
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
