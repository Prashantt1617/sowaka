part of 'quick_actions_screen.dart';

/// Picks a proof file. Tests hand in their own; the app opens the system
/// picker ([_pickProofFile]).
typedef PayrollFilePicker = Future<PayrollUpload?> Function(BuildContext);

/// Actions › Payroll: the month's salary, what needs doing before payroll
/// runs, and the ways into payslips, the flexible split and the tax
/// declaration. Its pages stack inside the Actions tab, as Placements' do, so
/// the app's header and bottom bar stay on screen and every page wears the
/// same hub header (back button on grey, Sora title) as Leave or
/// Reimbursement.
///
/// Missing punches are not rebuilt here: [onFixMissingPunches] opens the
/// Attendance list on its "Missed punch" heading, where a day is corrected
/// through the same sheet and request as anywhere else in the app.
class PayrollScreen extends StatefulWidget {
  const PayrollScreen({
    super.key,
    required this.api,
    required this.onClose,
    required this.profileAction,
    required this.onNotifications,
    required this.onQuickCreate,
    required this.onFixMissingPunches,
    this.onRaiseTicket,
    this.pickFile,
  });

  final PayrollApiService api;

  /// Leaves Payroll for the Actions home.
  final VoidCallback onClose;
  final Widget profileAction;
  final VoidCallback onNotifications;
  final VoidCallback onQuickCreate;
  final ValueChanged<PayrollMissingPunches?> onFixMissingPunches;

  /// "Can't find a payslip?" when no signed-in shell can raise a Support
  /// Desk ticket itself ([raiseSupportTicket]): the desk.
  final VoidCallback? onRaiseTicket;
  final PayrollFilePicker? pickFile;

  @override
  State<PayrollScreen> createState() => _PayrollScreenState();
}

class _PayrollScreenState extends State<PayrollScreen> {
  final _nav = GlobalKey<NavigatorState>();

  /// Back within Payroll: one page back, or false on its home, where Back
  /// leaves it.
  bool back() {
    final nav = _nav.currentState;
    if (nav == null || !nav.canPop()) return false;
    nav.pop();
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return _PayrollScope(
      screen: widget,
      child: Navigator(
        key: _nav,
        onGenerateRoute: (_) =>
            MaterialPageRoute<void>(builder: (_) => const _PayrollHomePage()),
      ),
    );
  }
}

class _PayrollScope extends InheritedWidget {
  const _PayrollScope({required this.screen, required super.child});

  final PayrollScreen screen;

  static PayrollScreen of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_PayrollScope>()!.screen;

  @override
  bool updateShouldNotify(_PayrollScope old) => screen != old.screen;
}

/// A Payroll page in the hub frame every Actions page uses.
Widget _payrollPage(
  BuildContext context, {
  required String title,
  required List<Widget> children,
  Key? key,
  VoidCallback? onBack,
  Widget? footer,
  bool closeIcon = false,
}) {
  final scope = _PayrollScope.of(context);
  return _HubScaffold(
    key: key,
    title: title,
    onBack: onBack ?? () => Navigator.of(context).maybePop(),
    closeIcon: closeIcon,
    profileAction: scope.profileAction,
    onNotifications: scope.onNotifications,
    onQuickCreate: scope.onQuickCreate,
    footer: footer,
    backgroundColor: const Color(0xFFF7F7F9),
    children: children,
  );
}

Future<T?> _pushPayroll<T>(BuildContext context, Widget page) =>
    Navigator.of(context).push<T>(MaterialPageRoute<T>(builder: (_) => page));

// ---------------------------------------------------------------- text

/// The type the hub cards are set in: Sora for titles, figures and captions,
/// with the app's own face behind it for the rupee sign.
class _PrText {
  static const label = TextStyle(
    fontFamily: 'Sora',
    color: Color(0xFF9CA3AF),
    fontSize: 12,
    height: 16 / 12,
    fontWeight: FontWeight.w600,
    letterSpacing: .3,
  );
  static const title = TextStyle(
    fontFamily: 'Sora',
    fontFamilyFallback: _soraFallback,
    color: Color(0xFF111827),
    fontSize: 14,
    height: 20 / 14,
    fontWeight: FontWeight.w600,
  );
  static const sub = TextStyle(
    fontFamily: 'Sora',
    fontFamilyFallback: _soraFallback,
    color: Color(0xFF6B7280),
    fontSize: 12,
    height: 16 / 12,
  );
  static const amount = TextStyle(
    fontFamily: 'Sora',
    fontFamilyFallback: _soraFallback,
    color: Color(0xFF111827),
    fontSize: 14,
    height: 20 / 14,
    fontWeight: FontWeight.w700,
  );
  static const caption = TextStyle(
    fontFamily: 'Sora',
    fontFamilyFallback: _soraFallback,
    color: Color(0xFF717171),
    fontSize: 12,
    height: 16.2 / 12,
    letterSpacing: -0.16,
  );
  static const row = TextStyle(
    color: Color(0xFF222222),
    fontSize: 14,
    height: 20 / 14,
    fontWeight: FontWeight.w500,
  );
  static const link = TextStyle(
    color: Color(0xFF0571A6),
    fontSize: 12,
    fontWeight: FontWeight.w700,
  );
}

const _prGreen = Color(0xFF16A34A);
const _prGreenTint = Color(0xFFF0FDF4);
const _prRed = Color(0xFFB3261E);
const _prRedTint = Color(0xFFFEE2E2);
const _prBlue = Color(0xFF0571A6);
const _prBlueTint = Color(0xFFE0F2FE);
const _prError = Color(0xFFC4382E);

// ---------------------------------------------------------------- format

/// ₹1,06,400 — whole rupees, Indian grouping.
String _rupees(int paise) {
  final negative = paise < 0;
  final digits = (paise.abs() / 100).round().toString();
  final grouped = digits.replaceAllMapped(
    RegExp(r'(\d)(?=(\d\d)+\d$)'),
    (m) => '${m[1]},',
  );
  return '${negative ? '−' : ''}₹$grouped';
}

/// +₹500 / −₹500.
String _signedRupees(int paise) =>
    paise < 0 ? _rupees(paise) : '+${_rupees(paise)}';

String _payDays(double days) => days == days.roundToDouble()
    ? days.round().toString()
    : days.toStringAsFixed(1);

/// "2026-10" → "October 2026".
String _periodLabel(String period) {
  final month = payrollMonth(period);
  return month == null ? period : '${_monthName(month.month)} ${month.year}';
}

String _shortMonthName(int month) => const [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
][month - 1];

/// "31 Mar 2027".
String _longDate(DateTime date) =>
    '${date.day} ${_shortMonthName(date.month)} ${date.year}';

/// "Nov to Mar 2027" — the months a split runs.
String _monthSpan(DateTime? from, DateTime? to) {
  if (from == null) return '';
  if (to == null || (to.year == from.year && to.month == from.month)) {
    return '${_shortMonthName(from.month)} ${from.year}';
  }
  return from.year == to.year
      ? '${_shortMonthName(from.month)} to ${_shortMonthName(to.month)} ${to.year}'
      : '${_shortMonthName(from.month)} ${from.year} to '
            '${_shortMonthName(to.month)} ${to.year}';
}

// ---------------------------------------------------------------- shared bits

/// A status on a soft pill, as the request cards set theirs.
class _PrPill extends StatelessWidget {
  const _PrPill(
    this.text, {
    required this.color,
    required this.tint,
    this.icon,
  });

  final String text;
  final Color color;
  final Color tint;

  /// A small glyph after the text — the Estimate pill's "i".
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    decoration: BoxDecoration(
      color: tint,
      borderRadius: BorderRadius.circular(99),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          text,
          style: TextStyle(
            fontFamily: 'Sora',
            fontFamilyFallback: _soraFallback,
            color: color,
            fontSize: 11,
            height: 16.5 / 11,
            fontWeight: FontWeight.w600,
          ),
        ),
        if (icon case final glyph?) ...[
          const SizedBox(width: 4),
          Icon(glyph, size: 13, color: color),
        ],
      ],
    ),
  );
}

class _PrChevron extends StatelessWidget {
  const _PrChevron();

  @override
  Widget build(BuildContext context) => const Icon(
    Icons.chevron_right_rounded,
    size: 20,
    color: Color(0xFF9CA3AF),
  );
}

/// The form's submit button (the Apply leave footer's), for use inside a
/// sheet: brand blue once it can be pressed, muted until then.
class _PrButton extends StatelessWidget {
  const _PrButton({
    required this.label,
    required this.onPressed,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final live = onPressed != null || busy;
    return Semantics(
      button: true,
      enabled: onPressed != null && !busy,
      label: label,
      child: Material(
        color: live ? _prBlue : const Color(0xFF96B7C7),
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: busy ? null : onPressed,
          borderRadius: BorderRadius.circular(16),
          child: SizedBox(
            height: 49,
            child: Center(
              child: busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : ExcludeSemantics(
                      child: Text(
                        label,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          height: 16.2 / 16,
                          letterSpacing: -0.16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Typed rupees shown as they read everywhere else: "₹1,50,000".
class _RupeeInputFormatter extends TextInputFormatter {
  const _RupeeInputFormatter();

  static String format(int rupees) => rupees <= 0 ? '' : _rupees(rupees * 100);

  /// The whole rupees in [text], or 0.
  static int parse(String text) =>
      int.tryParse(text.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0;

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final digits = newValue.text.replaceAll(RegExp(r'[^0-9]'), '');
    final capped = digits.length > 9 ? digits.substring(0, 9) : digits;
    final text = capped.isEmpty ? '' : format(int.parse(capped));
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }
}

/// A tinted line of context at the top of a page.
class _PrNote extends StatelessWidget {
  const _PrNote(this.text, {this.good = false, this.bold});

  final String text;

  /// Green, for good news (a tax saving); blue otherwise.
  final bool good;

  /// A part of [text] set in bold.
  final String? bold;

  @override
  Widget build(BuildContext context) {
    final color = good ? _prGreen : _prBlue;
    final style = TextStyle(
      color: good ? const Color(0xFF166534) : const Color(0xFF075985),
      fontSize: 13,
      height: 1.45,
      fontWeight: FontWeight.w500,
    );
    final emphasis = bold;
    final at = emphasis == null ? -1 : text.indexOf(emphasis);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: good ? _prGreenTint : _prBlueTint,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            good ? Icons.savings_outlined : Icons.info_outline_rounded,
            size: 18,
            color: color,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: at < 0
                ? Text(text, style: style)
                : Text.rich(
                    TextSpan(
                      style: style,
                      children: [
                        TextSpan(text: text.substring(0, at)),
                        TextSpan(
                          text: emphasis,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        TextSpan(text: text.substring(at + emphasis!.length)),
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _PrLoading extends StatelessWidget {
  const _PrLoading();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 48),
    child: Center(
      child: CircularProgressIndicator(strokeWidth: 2.5, color: _prBlue),
    ),
  );
}

/// A read that failed: what went wrong, and a way to try again.
class _PrError extends StatelessWidget {
  const _PrError(this.message, {required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _HubEmptyState(
        iconAsset: 'assets/icons/request_reimbursement_money.png',
        text: message,
        buttonLabel: 'Try again',
        onTap: onRetry,
      ),
      // "… not set up yet. Ask HR.": the way to HR, as a Support Desk ticket.
      if (mentionsHrOrSupport(message))
        RaiseTicketLink(about: message, center: true),
    ],
  );
}

/// The one-off "done" page after the split or the declaration is sent: the
/// success summary every request in the app ends on.
class _PayrollDonePage extends StatelessWidget {
  const _PayrollDonePage({required this.summary});

  final RequestSummary summary;

  @override
  Widget build(BuildContext context) {
    void close() => Navigator.of(context).popUntil((route) => route.isFirst);
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) close();
      },
      child: _payrollPage(
        context,
        key: const ValueKey('payroll-done'),
        title: summary.screenTitle,
        closeIcon: true,
        onBack: close,
        children: [RequestSummaryBody(summary: summary, showSuccess: true)],
      ),
    );
  }
}

// ---------------------------------------------------------------- home

class _PayrollHomePage extends StatefulWidget {
  const _PayrollHomePage();

  @override
  State<_PayrollHomePage> createState() => _PayrollHomePageState();
}

class _PayrollHomePageState extends State<_PayrollHomePage> {
  PayrollHome? _home;
  String? _error;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    unawaited(_load());
  }

  Future<void> _load() async {
    final api = _PayrollScope.of(context).api;
    try {
      final home = await api.fetchHome();
      if (!mounted) return;
      setState(() {
        _home = home;
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = payrollErrorText(error));
    }
  }

  /// Opens a page and reads the home again when it closes: a split saved or
  /// a proof sent changes what is left to do.
  Future<void> _open(Widget page) async {
    await _pushPayroll<void>(context, page);
    if (mounted) unawaited(_load());
  }

  void _fixPunches() =>
      _PayrollScope.of(context).onFixMissingPunches(_home?.missingPunches);

  @override
  Widget build(BuildContext context) {
    final scope = _PayrollScope.of(context);
    final home = _home;
    return _payrollPage(
      context,
      key: const ValueKey('payroll-home'),
      title: 'Payroll',
      onBack: scope.onClose,
      children: [
        if (home == null && _error == null)
          const _PrLoading()
        else if (home == null)
          _PrError(_error!, onRetry: _load)
        else
          ..._homeV2(home),
      ],
    );
  }

  Widget _todoRow(PayrollTodo todo) {
    String plural(int n, String one, String many) => n == 1 ? one : many;
    final (
      String asset,
      String title,
      String subtitle,
      VoidCallback onTap,
    ) = switch (todo.kind) {
      'missing_punches' => (
        'assets/icons/attendance_review_clock.png',
        'Fix ${todo.count} unpaid ${plural(todo.count, 'day', 'days')}',
        'Missed punches and absences are unpaid until fixed',
        _fixPunches,
      ),
      'flexible_split' => (
        'assets/icons/action_card_reimbursement_rupee.png',
        'Choose your FBP split',
        todo.effectiveFrom == null
            ? 'Split your flexible pay'
            : 'From ${_monthName(todo.effectiveFrom!.month)} pay',
        () => _open(const _SplitPage()),
      ),
      'fbp_bills' => (
        'assets/icons/action_card_reimbursement_money.png',
        'Re-upload FBP bills',
        // Listed only when a bill was sent back.
        [
          if (todo.rejected > 0) '${todo.rejected} rejected',
          if (todo.inReview > 0) '${todo.inReview} in review',
        ].join(' · '),
        () => _open(const _FbpPage()),
      ),
      'tax_regime' => (
        'assets/icons/action_card_policies_pencil.png',
        'Choose tax regime',
        todo.regime == 'old' ? 'Old regime for now' : 'New regime by default',
        () => _open(const _DeclarationPage()),
      ),
      'investment_proofs' => (
        'assets/icons/leave_year_approved_badge.png',
        'Upload investment proofs',
        [
          if (todo.notUploaded > 0) '${todo.notUploaded} to upload',
          if (todo.rejected > 0) '${todo.rejected} rejected',
        ].join(' · '),
        () => _open(const _ProofsPage()),
      ),
      _ => (
        'assets/icons/request_reimbursement_money.png',
        todo.kind,
        '',
        () {},
      ),
    };
    return _PrTodoRow(
      key: ValueKey('payroll-todo-${todo.kind}'),
      asset: asset,
      title: title,
      subtitle: subtitle,
      dueOn: todo.dueOn,
      onTap: onTap,
    );
  }
}

/// What the loss-of-pay line says when opened: the pay period's base days,
/// as the run divides by them ([baseDays] from the server), never the
/// calendar month's.
String payrollLopTip(int? baseDays) {
  final perDay = baseDays == null
      ? 'monthly pay ÷ the paid days in this pay period'
      : 'monthly pay ÷ $baseDays paid days in this pay period';
  return 'Days without pay in this pay period: absences, half days and '
      'punches not fixed. Loss of pay = $perDay × days lost.';
}

/// What the Estimate pill opens to: the attendance it is worked out from.
String payrollEstimateNote(PayrollSalary salary) {
  final from = salary.periodFrom;
  final to = salary.periodTo;
  final days = from == null || to == null
      ? 'in this pay period'
      : 'in this pay period (${_short(from)} – ${_short(to)})';
  return 'Worked out from your attendance $days till today. It can change '
      'if leave or punches change before payroll runs.';
}

/// The salary card when the pay can't be worked out yet: what is missing and
/// who sets it up, with no figures.
class _SalaryNotSetUpCard extends StatelessWidget {
  const _SalaryNotSetUpCard({required this.period, required this.notSetUp});

  final String period;
  final PayrollSalaryNotSetUp notSetUp;

  @override
  Widget build(BuildContext context) {
    final month = payrollMonth(period);
    return _FormCard(
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '${month == null ? 'This month' : _monthName(month.month)} salary'
                    .toUpperCase(),
                style: _PrText.label,
              ),
            ),
            const _PrPill('Not set up', color: _Q.gold, tint: _Q.goldTint),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          notSetUp.message,
          key: const ValueKey('payroll-salary-not-set-up'),
          style: _PrText.sub,
        ),
        if (mentionsHrOrSupport(notSetUp.message))
          RaiseTicketLink(about: notSetUp.message),
      ],
    );
  }
}

/// The month's salary, as a bill: the take-home on top, then each line that
/// makes it, each opening to say what it is.
class _SalaryCard extends StatefulWidget {
  const _SalaryCard({required this.salary, required this.onUnpaidDays});

  final PayrollSalary salary;
  final VoidCallback onUnpaidDays;

  @override
  State<_SalaryCard> createState() => _SalaryCardState();
}

class _SalaryCardState extends State<_SalaryCard> {
  int? _open;
  bool _estimateOpen = false;

  static String? _explain(String key) => switch (key) {
    'epf' => '12% of your basic pay, saved in your PF account for retirement.',
    'income_tax' =>
      'Your estimated tax for the year, split across the months left.',
    'pt' => 'A fixed tax set by your state.',
    'esi' => 'Employees\' State Insurance: medical cover for you and family.',
    'lwf' => 'Labour welfare fund, set by your state.',
    _ => null,
  };

  @override
  Widget build(BuildContext context) {
    final salary = widget.salary;
    final month = payrollMonth(salary.period);
    final rows =
        <({String label, String value, String? info, bool unpaidLink})>[
          (
            label: 'Gross salary',
            value: _rupees(salary.grossPaise),
            info: 'Your fixed monthly pay before any deductions.',
            unpaidLink: false,
          ),
          if (salary.lopDays > 0)
            (
              label:
                  'Loss of pay · ${_payDays(salary.lopDays)} '
                  '${salary.lopDays == 1 ? 'day' : 'days'}',
              value: '− ${_rupees(salary.lopPaise)}',
              info: payrollLopTip(salary.baseDays),
              unpaidLink: true,
            ),
          if (salary.overtimePaise > 0)
            (
              label: 'Overtime',
              value: '+ ${_rupees(salary.overtimePaise)}',
              info:
                  'Your approved overtime this month, paid by your salary '
                  'template\'s overtime rule.',
              unpaidLink: false,
            ),
          for (final d in salary.deductions)
            (
              label: d.label,
              value: '− ${_rupees(d.amountPaise)}',
              info: _explain(d.key),
              unpaidLink: false,
            ),
          if (salary.reimbursementsPaise > 0)
            (
              label: 'Reimbursements',
              value: '+ ${_rupees(salary.reimbursementsPaise)}',
              info: 'Flexible heads and other claims paid with your salary.',
              unpaidLink: false,
            ),
        ];
    return _FormCard(
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '${month == null ? 'This month' : _monthName(month.month)} salary'
                    .toUpperCase(),
                style: _PrText.label,
              ),
            ),
            if (salary.isEstimate)
              InkWell(
                key: const ValueKey('payroll-estimate'),
                onTap: () => setState(() => _estimateOpen = !_estimateOpen),
                borderRadius: BorderRadius.circular(99),
                child: const _PrPill(
                  'Estimate',
                  color: _prBlue,
                  tint: _prBlueTint,
                  icon: Icons.info_outline_rounded,
                ),
              )
            else
              const _PrPill('Final', color: _prGreen, tint: _prGreenTint),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          _rupees(salary.takeHomePaise),
          style: const TextStyle(
            fontFamily: 'Sora',
            fontFamilyFallback: _soraFallback,
            color: Color(0xFF111827),
            fontSize: 26,
            height: 34 / 26,
            letterSpacing: -0.4,
            fontWeight: FontWeight.w700,
          ),
        ),
        if (_estimateOpen) ...[
          const SizedBox(height: 8),
          Text(payrollEstimateNote(salary), style: _PrText.sub),
        ],
        const SizedBox(height: 10),
        const Divider(height: 1, thickness: 1, color: Color(0xFFEBEBEB)),
        const SizedBox(height: 4),
        for (final (index, row) in rows.indexed) ...[
          InkWell(
            onTap: row.info == null
                ? null
                : () => setState(() => _open = _open == index ? null : index),
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  Expanded(child: Text(row.label, style: _PrText.row)),
                  Text(
                    row.value,
                    style: _PrText.row.copyWith(
                      fontFamily: 'Sora',
                      fontFamilyFallback: _soraFallback,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  SizedBox(
                    width: 24,
                    child: row.info == null
                        ? null
                        : AnimatedRotation(
                            turns: _open == index ? .5 : 0,
                            duration: const Duration(milliseconds: 150),
                            child: const Icon(
                              Icons.keyboard_arrow_down_rounded,
                              size: 20,
                              color: Color(0xFF9CA3AF),
                            ),
                          ),
                  ),
                ],
              ),
            ),
          ),
          if (_open == index && row.info != null)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: const Color(0xFFF7F7F9),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(row.info!, style: _PrText.sub),
            ),
          if (row.unpaidLink)
            Align(
              alignment: Alignment.centerLeft,
              child: InkWell(
                key: const ValueKey('payroll-unpaid-days'),
                onTap: widget.onUnpaidDays,
                borderRadius: BorderRadius.circular(8),
                child: const Padding(
                  padding: EdgeInsets.only(bottom: 6),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('Check unpaid days', style: _PrText.link),
                      SizedBox(width: 3),
                      Icon(
                        Icons.chevron_right_rounded,
                        size: 15,
                        color: _prBlue,
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
        const SizedBox(height: 4),
        const Divider(height: 1, thickness: 1, color: Color(0xFFEBEBEB)),
        const SizedBox(height: 12),
        Row(
          children: [
            const Expanded(
              child: Text(
                'Take-home',
                style: TextStyle(
                  fontFamily: 'Sora',
                  color: Color(0xFF111827),
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Text(
              _rupees(salary.takeHomePaise),
              style: _PrText.amount.copyWith(fontSize: 16),
            ),
          ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------- payslips

class _PayslipsPage extends StatefulWidget {
  const _PayslipsPage();

  @override
  State<_PayslipsPage> createState() => _PayslipsPageState();
}

class _PayslipsPageState extends State<_PayslipsPage> {
  Future<(PayslipCompany, List<Payslip>)>? _future;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= _PayrollScope.of(context).api.fetchPayslips(limit: 12);
  }

  void _retry() => setState(
    () => _future = _PayrollScope.of(context).api.fetchPayslips(limit: 12),
  );

  @override
  Widget build(BuildContext context) {
    final raiseTicket = _PayrollScope.of(context).onRaiseTicket;
    return _payrollPage(
      context,
      key: const ValueKey('payroll-payslips'),
      title: 'Payslips',
      children: [
        FutureBuilder<(PayslipCompany, List<Payslip>)>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return _PrError(
                payrollErrorText(snapshot.error!),
                onRetry: _retry,
              );
            }
            if (!snapshot.hasData) return const _PrLoading();
            final (company, slips) = snapshot.data!;
            if (slips.isEmpty) {
              return const _HubEmptyState(
                iconAsset: 'assets/icons/request_reimbursement_money.png',
                text:
                    'No payslips yet — they appear here once payroll has run '
                    'for you.',
              );
            }
            return _FormCard(
              children: [
                for (final (index, slip) in slips.indexed) ...[
                  if (index > 0)
                    const Divider(
                      height: 1,
                      thickness: 1,
                      color: Color(0xFFF3F4F6),
                    ),
                  InkWell(
                    key: ValueKey('payslip-row-${slip.id}'),
                    onTap: () => _pushPayroll<void>(
                      context,
                      _PayslipPage(slip: slip, company: company),
                    ),
                    borderRadius: BorderRadius.circular(12),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _periodLabel(slip.period),
                                  style: _PrText.title,
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  slip.paidAt == null
                                      ? 'Released'
                                      : 'Credited ${_short(slip.paidAt!)}',
                                  style: _PrText.sub,
                                ),
                              ],
                            ),
                          ),
                          Text(
                            _rupees(slip.netPayablePaise),
                            style: _PrText.amount,
                          ),
                          const SizedBox(width: 4),
                          const _PrChevron(),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            );
          },
        ),
        if (raiseTicket != null || canRaiseSupportTicket) ...[
          const SizedBox(height: 16),
          Center(
            child: InkWell(
              key: const ValueKey('payslips-raise-ticket'),
              // Straight to a new Support Desk ticket (PR #101), else the desk.
              onTap: () {
                if (!raiseSupportTicket(about: 'I can\'t find a payslip:')) {
                  raiseTicket?.call();
                }
              },
              borderRadius: BorderRadius.circular(8),
              child: const Padding(
                padding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                child: Text(
                  'Can\'t find a payslip? Raise a ticket',
                  style: _PrText.link,
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

/// One month's payslip: net pay on top, then what was earned and what was
/// taken off, with any loss of pay explained in the same words HR sees.
class _PayslipPage extends StatefulWidget {
  const _PayslipPage({required this.slip, required this.company});

  final Payslip slip;
  final PayslipCompany company;

  @override
  State<_PayslipPage> createState() => _PayslipPageState();
}

class _PayslipPageState extends State<_PayslipPage> {
  bool _downloading = false;

  Future<void> _download() async {
    if (_downloading) return;
    setState(() => _downloading = true);
    try {
      final pdf = await buildPayslipPdf(
        slip: widget.slip,
        company: widget.company,
      );
      await Printing.sharePdf(
        bytes: pdf,
        filename: 'payslip-${widget.slip.period}.pdf',
      );
    } catch (_) {
      if (mounted) {
        showAppToast(context, 'Could not prepare the payslip. Try again.');
      }
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final slip = widget.slip;
    final docked = slip.lines.where((line) => line.days > 0).toList();
    final covered = slip.paidLeaveDaysApplied;
    final deductions = slip.deductions.where((d) => !d.hidden).toList();
    final totalDeductions = slip.otherDeductionsPaise;
    return _payrollPage(
      context,
      key: ValueKey('payslip-${slip.id}'),
      title: _periodLabel(slip.period),
      children: [
        // The figure that matters.
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: const Color(0xFFECFDF5),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFD1FAE5)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Total net pay',
                      style: TextStyle(
                        fontSize: 13,
                        color: Color(0xFF047857),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  if (slip.paidAt != null)
                    Text(
                      'Credited ${_short(slip.paidAt!)}',
                      style: const TextStyle(
                        fontSize: 12,
                        color: Color(0xFF047857),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                _rupees(slip.netPayablePaise),
                style: const TextStyle(
                  fontSize: 30,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF111827),
                ),
              ),
              if (slip.workingDays > 0)
                Text(
                  '${slip.payableDays} of ${slip.workingDays} days paid',
                  style: const TextStyle(
                    fontSize: 12,
                    color: Color(0xFF047857),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFEBEBEB)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const _PayslipSectionLabel('Earnings'),
              const SizedBox(height: 6),
              for (final e in slip.earnings.where((e) => !e.hidden))
                _PayslipRow(
                  e.name,
                  _rupees(e.fullPaise),
                  sub: e.fullPaise != e.paidPaise ? 'Monthly rate' : null,
                ),
              if (slip.overtimePaise > 0)
                _PayslipRow('Overtime', _rupees(slip.overtimePaise)),
              if (slip.reimbursementsPaise > 0)
                _PayslipRow(
                  'Reimbursements',
                  _rupees(slip.reimbursementsPaise),
                ),
              if (slip.lopDays > 0)
                _PayslipRow(
                  'Loss of pay · ${_payDays(slip.lopDays)} '
                      '${slip.lopDays == 1 ? 'day' : 'days'}',
                  '− ${_rupees(slip.lossOfPayPaise)}',
                  sub: [
                    for (final line in docked)
                      '${line.name} ${line.count} → ${_payDays(line.days)}d',
                    if (covered > 0)
                      '${_payDays(covered)} ${covered == 1 ? 'day' : 'days'} '
                          'covered by paid leave',
                  ].join(' · '),
                  strong: true,
                ),
              const Divider(height: 22),
              const _PayslipSectionLabel('Deductions'),
              const SizedBox(height: 6),
              for (final d in deductions)
                _PayslipRow(d.name, '− ${_rupees(d.fullPaise)}'),
              if (deductions.isEmpty) const _PayslipRow('No deductions', '—'),
              if (totalDeductions > 0)
                _PayslipRow(
                  'Total deductions',
                  '− ${_rupees(totalDeductions)}',
                  strong: true,
                ),
              const Divider(height: 22),
              _PayslipRow(
                'Net payable',
                _rupees(slip.netPayablePaise),
                strong: true,
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: _downloading ? null : _download,
            style: FilledButton.styleFrom(
              backgroundColor: _prBlue,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            icon: _downloading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.download_rounded),
            label: Text(_downloading ? 'Preparing…' : 'Download payslip'),
          ),
        ),
        const SizedBox(height: 24),
      ],
    );
  }
}

class _PayslipSectionLabel extends StatelessWidget {
  const _PayslipSectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text.toUpperCase(),
    style: const TextStyle(
      fontSize: 11,
      letterSpacing: 1,
      color: Color(0xFF717171),
      fontWeight: FontWeight.w700,
    ),
  );
}

class _PayslipRow extends StatelessWidget {
  const _PayslipRow(this.label, this.value, {this.sub, this.strong = false});

  final String label;
  final String value;
  final String? sub;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    final weight = strong ? FontWeight.w700 : FontWeight.w500;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: weight,
                    color: const Color(0xFF222222),
                  ),
                ),
                if (sub case final note? when note.isNotEmpty)
                  Text(
                    note,
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(0xFF717171),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Text(
            value,
            style: TextStyle(
              fontSize: 15,
              fontWeight: weight,
              color: const Color(0xFF222222),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- declaration

/// Investment declaration: the regime, and on the old one what was invested
/// under each section, against the section's cap.
class _DeclarationPage extends StatefulWidget {
  const _DeclarationPage();

  @override
  State<_DeclarationPage> createState() => _DeclarationPageState();
}

class _DeclarationPageState extends State<_DeclarationPage> {
  TaxDeclaration? _declaration;
  String? _error;
  String _regime = 'new';
  final Map<String, TextEditingController> _fields = {};
  bool _busy = false;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    unawaited(_load());
  }

  @override
  void dispose() {
    for (final field in _fields.values) {
      field.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final declaration = await _PayrollScope.of(context).api
          .fetchDeclaration();
      if (!mounted) return;
      setState(() {
        _declaration = declaration;
        _regime = declaration.regime;
        for (final section in declaration.sections) {
          for (final item in section.items.where((item) => !item.readOnly)) {
            final rupees = (item.amountPaise / 100).round();
            final field = _fields[item.key] ??= TextEditingController()
              ..addListener(_changed);
            field.text = _RupeeInputFormatter.format(rupees);
          }
        }
      });
    } catch (error) {
      if (mounted) setState(() => _error = payrollErrorText(error));
    }
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  int _paiseOf(TaxDeclarationItem item) {
    if (item.readOnly) return item.amountPaise;
    return _RupeeInputFormatter.parse(_fields[item.key]?.text ?? '') * 100;
  }

  Future<void> _submit() async {
    final declaration = _declaration;
    if (declaration == null || _busy) return;
    setState(() => _busy = true);
    try {
      final saved = await _PayrollScope.of(context).api.saveDeclaration(
        regime: _regime,
        items: {
          for (final section in declaration.sections)
            for (final item in section.items)
              if (!item.readOnly) item.key: _paiseOf(item),
        },
        submit: true,
        fy: declaration.fy,
      );
      if (!mounted) return;
      final proofsBy = saved.proofsDueOn;
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => _PayrollDonePage(
            summary: RequestSummary(
              screenTitle: 'Tax',
              successTitle: 'Declaration submitted',
              successBody: saved.isOld
                  ? 'Your tax is worked out with these from the next payroll.'
                        '${proofsBy == null ? '' : ' Upload the proofs by ${_short(proofsBy)}.'}'
                  : 'Your tax is worked out on the new regime from the next '
                        'payroll.',
              rows: [
                SummaryRow('Financial year', 'FY ${saved.fy}'),
                SummaryRow('Regime', saved.isOld ? 'Old regime' : 'New regime'),
                if (saved.isOld)
                  for (final section in saved.sections)
                    if (section.declaredPaise > 0)
                      SummaryRow(section.label, _rupees(section.countedPaise)),
              ],
            ),
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      showAppToast(context, payrollErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final declaration = _declaration;
    final locked = declaration?.locked ?? false;
    final old = _regime == 'old';
    return _payrollPage(
      context,
      key: const ValueKey('payroll-declaration'),
      title: 'Investment declaration',
      footer: declaration == null
          ? null
          : _FormSubmitBar(
              label: 'Submit declaration',
              enabled: !locked,
              busy: _busy,
              onTap: _submit,
            ),
      children: [
        if (declaration == null && _error == null)
          const _PrLoading()
        else if (declaration == null)
          _PrError(_error!, onRetry: _load)
        else ...[
          Text(
            [
              'FY ${declaration.fy}',
              if (locked)
                'closed'
              else if (declaration.dueOn != null)
                'by ${_short(declaration.dueOn!)}',
              '${old ? 'old' : 'new'} regime',
            ].join(' · '),
            style: _PrText.caption,
          ),
          const SizedBox(height: 8),
          IgnorePointer(
            ignoring: locked,
            child: LeaveViewSwitch(
              key: const ValueKey('regime-switch'),
              history: !old,
              firstLabel: 'Old regime',
              secondLabel: 'New regime',
              onChanged: (isNew) =>
                  setState(() => _regime = isNew ? 'new' : 'old'),
            ),
          ),
          const SizedBox(height: 12),
          if (locked) ...[
            _PrNote(
              'The last date to change your declaration has passed'
              '${declaration.dueOn == null ? '' : ' (${_short(declaration.dueOn!)})'}.',
            ),
            const SizedBox(height: 12),
          ],
          if (!old)
            const _PrNote(
              'On the new regime your investments don\'t lower your tax, so '
              'there is nothing to declare. What you enter on the old regime '
              'is kept in case you switch back.',
            )
          else ...[
            for (final section in declaration.sections) ...[
              _DeclarationSectionCard(
                section: section,
                fields: _fields,
                enabled: !locked,
                amountOf: _paiseOf,
              ),
              const SizedBox(height: 12),
            ],
            _PolicyRow(
              key: const ValueKey('declaration-proofs'),
              label: 'Investment proofs',
              subtitle: declaration.proofsDueOn == null
                  ? 'Upload a proof for each investment'
                  : 'Upload by ${_short(declaration.proofsDueOn!)}',
              onTap: () => _pushPayroll<void>(context, const _ProofsPage()),
            ),
          ],
        ],
      ],
    );
  }
}

class _DeclarationSectionCard extends StatelessWidget {
  const _DeclarationSectionCard({
    required this.section,
    required this.fields,
    required this.enabled,
    required this.amountOf,
  });

  final TaxDeclarationSection section;
  final Map<String, TextEditingController> fields;
  final bool enabled;
  final int Function(TaxDeclarationItem) amountOf;

  static String _title(TaxDeclarationSection section) => switch (section.key) {
    '80CCD1B' => 'NPS (80CCD 1B)',
    '80D' => '80D health insurance',
    'HRA' => 'Rent (HRA)',
    '24B' => 'Home loan interest',
    _ => section.label,
  };

  @override
  Widget build(BuildContext context) {
    final cap = section.capPaise;
    final declared = section.items.fold<int>(
      0,
      (sum, item) => sum + amountOf(item),
    );
    final over = cap != null && declared > cap;
    return _FormCard(
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                _title(section),
                style: _PrText.title.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
            if (cap != null) Text('Max ${_rupees(cap)}', style: _PrText.sub),
          ],
        ),
        for (final item in section.items) ...[
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Text(
                  item.key == 'rentMonthly' ? 'Rent a month' : item.label,
                  style: const TextStyle(
                    color: Color(0xFF222222),
                    fontSize: 13.5,
                    height: 1.35,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                width: 132,
                child: item.readOnly
                    ? Container(
                        height: 42,
                        alignment: Alignment.centerRight,
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF7F7F9),
                          border: Border.all(color: const Color(0xFFE5E7EB)),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          _rupees(item.amountPaise),
                          style: const TextStyle(
                            color: Color(0xFF6B7280),
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      )
                    : _AmountField(
                        key: ValueKey('declare-${item.key}'),
                        controller: fields[item.key]!,
                        enabled: enabled,
                      ),
              ),
            ],
          ),
        ],
        if (over) ...[
          const SizedBox(height: 10),
          Text(
            '${_rupees(declared)} declared — only ${_rupees(cap)} counts.',
            key: ValueKey('cap-${section.key}'),
            style: const TextStyle(
              color: _prError,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ],
    );
  }
}

/// A rupee amount, typed as whole rupees.
class _AmountField extends StatelessWidget {
  const _AmountField({
    super.key,
    required this.controller,
    required this.enabled,
  });

  final TextEditingController controller;
  final bool enabled;

  @override
  Widget build(BuildContext context) => Container(
    height: 42,
    decoration: BoxDecoration(
      color: enabled ? Colors.white : const Color(0xFFF7F7F9),
      border: Border.all(color: const Color(0xFFE5E7EB)),
      borderRadius: BorderRadius.circular(12),
    ),
    alignment: Alignment.center,
    child: TextField(
      controller: controller,
      enabled: enabled,
      keyboardType: TextInputType.number,
      inputFormatters: const [_RupeeInputFormatter()],
      textAlign: TextAlign.right,
      style: const TextStyle(
        fontSize: 14,
        color: Color(0xFF111827),
        fontWeight: FontWeight.w600,
      ),
      decoration: const InputDecoration(
        isDense: true,
        hintText: '₹0',
        hintStyle: TextStyle(color: Color(0x80111827)),
        filled: false,
        border: InputBorder.none,
        enabledBorder: InputBorder.none,
        focusedBorder: InputBorder.none,
        disabledBorder: InputBorder.none,
        errorBorder: InputBorder.none,
        focusedErrorBorder: InputBorder.none,
        contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      ),
    ),
  );
}
