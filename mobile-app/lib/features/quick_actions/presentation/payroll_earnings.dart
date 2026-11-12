part of 'quick_actions_screen.dart';

// ---------------------------------------------------------------- earnings

/// Earnings (Figma 4541:24589, and 4541:24741 with the months open): a
/// financial year's pay. A dropdown of the years with pay in the header, the
/// year's gross with the tax, PF and professional tax taken off it and the
/// take-home, the yearly salary part by part, and each paid month behind a
/// "Month by month" fold — the current one an estimate that opens the salary
/// summary, a past one its payslip. Every figure is the server's
/// (GET /payroll/me/earnings).
class _EarningsPage extends StatefulWidget {
  const _EarningsPage();

  @override
  State<_EarningsPage> createState() => _EarningsPageState();
}

class _EarningsPageState extends State<_EarningsPage> {
  PayrollEarnings? _earnings;
  String? _error;
  bool _started = false;

  /// The year being read, while a switch is on its way.
  String? _loadingFy;

  /// The month whose payslip is being fetched.
  String? _opening;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    unawaited(_load());
  }

  Future<void> _load([String? fy]) async {
    setState(() {
      _error = null;
      _loadingFy = fy;
    });
    try {
      final earnings = await _PayrollScope.of(
        context,
      ).api.fetchEarnings(fy: fy);
      if (!mounted) return;
      setState(() {
        _earnings = earnings;
        _loadingFy = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _loadingFy = null);
      // A failed switch keeps the year on screen; a failed first read says so.
      if (_earnings == null) {
        setState(() => _error = payrollErrorText(error));
      } else {
        showAppToast(context, payrollErrorText(error));
      }
    }
  }

  Future<void> _pickYear(PayrollEarnings earnings) async {
    if (_loadingFy != null) return;
    final labels = {for (final fy in earnings.fys) _fyLabel(fy): fy};
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => _LeavePickerSheet(
        options: labels.keys.toList(),
        selected: _fyLabel(earnings.fy),
      ),
    );
    if (!mounted || picked == null) return;
    final fy = labels[picked];
    if (fy != null && fy != _earnings?.fy && _loadingFy == null) {
      unawaited(_load(fy));
    }
  }

  Future<void> _openMonth(EarningsMonth month) async {
    if (month.isEstimate) {
      await _pushPayroll<void>(context, const _SalarySummaryPage());
      return;
    }
    final id = month.payslipId;
    if (id == null || _opening != null) return;
    setState(() => _opening = month.period);
    try {
      final (company, slip) = await _PayrollScope.of(
        context,
      ).api.fetchPayslip(id);
      if (!mounted) return;
      setState(() => _opening = null);
      await _pushPayroll<void>(
        context,
        _PayslipPage(slip: slip, company: company),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _opening = null);
      showAppToast(context, payrollErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final earnings = _earnings;
    return _payrollPage(
      context,
      key: const ValueKey('payroll-earnings'),
      title: 'Earnings',
      trailing: earnings == null || earnings.fys.isEmpty
          ? null
          : _EarningsYearButton(
              label: _fyLabel(_loadingFy ?? earnings.fy),
              onTap: () => _pickYear(earnings),
            ),
      children: [
        if (earnings == null && _error == null)
          const _PrLoading()
        else if (earnings == null)
          _PrError(_error!, onRetry: _load)
        else if (earnings.fys.isEmpty && earnings.months.isEmpty) ...[
          const _HubEmptyState(
            iconAsset: 'assets/icons/request_reimbursement_money.png',
            text:
                'No pay yet — your earnings show here once payroll has run '
                'for you.',
          ),
          if (earnings.componentsNotSetUp case final notSetUp?) ...[
            const SizedBox(height: 12),
            _PrNote(notSetUp.message),
          ],
        ] else
          AnimatedOpacity(
            opacity: _loadingFy == null ? 1 : .5,
            duration: const Duration(milliseconds: 150),
            child: _EarningsBody(
              earnings: earnings,
              opening: _opening,
              onMonth: _openMonth,
            ),
          ),
      ],
    );
  }
}

/// "2026-27" → "FY 2026–27".
String _fyLabel(String fy) => 'FY ${fy.replaceFirst('-', '–')}';

/// The type and colours of the Earnings frames.
abstract final class _Er {
  static const ink = Color(0xFF1F1F22);
  static const muted = Color(0xFF55555C);
  static const label = Color(0xFF8E8E95);
  static const link = Color(0xFF1C6EA4);
  static const hairline = Color(0xFFF1F1F4);
  static const dash = Color(0xFFDCDCE1);

  static const _sora = TextStyle(
    fontFamily: 'Sora',
    fontFamilyFallback: _soraFallback,
    color: ink,
  );

  /// "EARNED · FY 2026–27", "YEARLY SALARY".
  static final section = _sora.copyWith(
    color: label,
    fontSize: 13,
    height: 1.26,
    letterSpacing: .8,
    fontWeight: FontWeight.w600,
  );
  static final lineLabel = _sora.copyWith(
    fontSize: 14.5,
    height: 1.26,
    fontWeight: FontWeight.w600,
  );
  static final lineValue = lineLabel.copyWith(fontWeight: FontWeight.w700);
  static final lineTotal = lineLabel.copyWith(fontWeight: FontWeight.w800);
  static final monthTitle = _sora.copyWith(
    fontSize: 15,
    height: 1.26,
    fontWeight: FontWeight.w700,
  );
  static final monthSub = _sora.copyWith(
    color: muted,
    fontSize: 12.5,
    height: 1.26,
    fontWeight: FontWeight.w600,
  );
}

/// The header's year dropdown: "FY 2026–27 ⌄" on a soft pill.
class _EarningsYearButton extends StatelessWidget {
  const _EarningsYearButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'Financial year, $label',
    excludeSemantics: true,
    child: Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14000000),
            blurRadius: 1.5,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Material(
        color: const Color(0xFFF7F7F9),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: const BorderSide(color: Color(0xFFEBEBEB)),
        ),
        child: InkWell(
          key: const ValueKey('earnings-fy-picker'),
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 9),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label,
                  maxLines: 1,
                  style: _Er._sora.copyWith(
                    color: _Er.link,
                    fontSize: 13.5,
                    height: 1.26,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(width: 4),
                SvgPicture.asset(
                  'assets/icons/payroll_earnings_fy_chevron.svg',
                  width: 16,
                  height: 16,
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

/// A white Earnings card, without the form card's shadow.
class _EarningsCard extends StatelessWidget {
  const _EarningsCard({
    required this.padding,
    required this.radius,
    required this.children,
  });

  final EdgeInsets padding;
  final double radius;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(radius),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    ),
  );
}

class _EarningsBody extends StatelessWidget {
  const _EarningsBody({
    required this.earnings,
    required this.opening,
    required this.onMonth,
  });

  final PayrollEarnings earnings;
  final String? opening;
  final ValueChanged<EarningsMonth> onMonth;

  @override
  Widget build(BuildContext context) {
    final e = earnings;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _EarnedCard(earnings: e),
        const SizedBox(height: 24),
        Text('Yearly salary'.toUpperCase(), style: _Er.section),
        const SizedBox(height: 12),
        if (e.components.isEmpty && e.componentsNotSetUp != null)
          _PrNote(e.componentsNotSetUp!.message)
        else if (e.components.isEmpty)
          const _PrNote(
            'Your yearly salary shows here once HR sets up your pay.',
          )
        else ...[
          _EarningsCard(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            radius: 18,
            children: [
              for (final (index, c) in e.components.indexed) ...[
                if (index > 0) const _EarningsRule(),
                _EarningsLine(c.name, _rupees(c.annualPaise), minHeight: 46),
              ],
              const _EarningsRule(dashed: true),
              _EarningsLine(
                'Total a year',
                _rupees(e.annualTotalPaise),
                key: const ValueKey('earnings-annual-total'),
                minHeight: 46,
                strong: true,
              ),
            ],
          ),
          if (!e.fromStructure) ...[
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Text(
                'What this year\'s payslips paid in full, before unpaid days.',
                style: _PrText.caption,
              ),
            ),
          ],
        ],
        const SizedBox(height: 14),
        if (e.months.isEmpty)
          const _PrNote('No month of this year has been paid yet.')
        else
          _EarningsMonthsCard(
            months: e.months,
            opening: opening,
            onMonth: onMonth,
          ),
        if (e.estimateNotSetUp case final notSetUp?) ...[
          const SizedBox(height: 12),
          _PrNote(notSetUp.message),
        ],
        const SizedBox(height: 12),
      ],
    );
  }
}

/// The year so far: gross on top, what came off it, and the take-home.
class _EarnedCard extends StatelessWidget {
  const _EarnedCard({required this.earnings});

  final PayrollEarnings earnings;

  @override
  Widget build(BuildContext context) {
    final e = earnings;
    return _EarningsCard(
      padding: const EdgeInsets.all(20),
      radius: 22,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Earned · ${_fyLabel(e.fy)}'.toUpperCase(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: _Er.section,
              ),
            ),
            if (e.span case final span?)
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFEDEDF0),
                  borderRadius: BorderRadius.circular(12.5),
                ),
                child: Text(
                  span,
                  style: _Er._sora.copyWith(
                    color: _Er.muted,
                    fontSize: 12,
                    height: 1.26,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          _rupees(e.grossPaise),
          key: const ValueKey('earnings-gross'),
          style: _Er._sora.copyWith(
            fontSize: 34,
            height: 37.4 / 34,
            letterSpacing: -0.6,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          e.current ? 'Gross pay so far this year' : 'Gross pay for the year',
          style: _Er._sora.copyWith(
            color: _Er.muted,
            fontSize: 13,
            height: 1.26,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 14),
        const _EarningsRule(),
        _EarningsLine('Income tax (TDS)', '− ${_rupees(e.taxPaise)}'),
        const _EarningsRule(),
        _EarningsLine('PF and professional tax', '− ${_rupees(e.pfPtPaise)}'),
        if (e.otherDeductionsPaise > 0) ...[
          const _EarningsRule(),
          _EarningsLine(
            'Other deductions',
            '− ${_rupees(e.otherDeductionsPaise)}',
          ),
        ],
        if (e.reimbursementsPaise > 0) ...[
          const _EarningsRule(),
          _EarningsLine(
            'Reimbursements',
            '+ ${_rupees(e.reimbursementsPaise)}',
          ),
        ],
        const _EarningsRule(dashed: true),
        _EarningsLine(
          'Take-home',
          _rupees(e.takeHomePaise),
          key: const ValueKey('earnings-take-home'),
          strong: true,
        ),
      ],
    );
  }
}

class _EarningsLine extends StatelessWidget {
  const _EarningsLine(
    this.label,
    this.value, {
    super.key,
    this.strong = false,
    this.minHeight = 40,
  });

  final String label;
  final String value;
  final bool strong;
  final double minHeight;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: BoxConstraints(minHeight: minHeight),
    child: Row(
      children: [
        Expanded(
          child: Text(label, style: strong ? _Er.lineTotal : _Er.lineLabel),
        ),
        const SizedBox(width: 12),
        Text(value, style: strong ? _Er.lineTotal : _Er.lineValue),
      ],
    ),
  );
}

/// The hairline between rows; dashed above a total.
class _EarningsRule extends StatelessWidget {
  const _EarningsRule({this.dashed = false});

  final bool dashed;

  @override
  Widget build(BuildContext context) {
    if (!dashed) {
      return const Divider(height: 1, thickness: 1, color: _Er.hairline);
    }
    return SizedBox(
      height: 1,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final count = (constraints.maxWidth / 6).floor();
          return Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              for (var i = 0; i < count; i++)
                const SizedBox(
                  width: 3,
                  height: 1,
                  child: ColoredBox(color: _Er.dash),
                ),
            ],
          );
        },
      ),
    );
  }
}

/// "Month by month": folded by default, a tap opens every paid month.
class _EarningsMonthsCard extends StatefulWidget {
  const _EarningsMonthsCard({
    required this.months,
    required this.opening,
    required this.onMonth,
  });

  final List<EarningsMonth> months;
  final String? opening;
  final ValueChanged<EarningsMonth> onMonth;

  @override
  State<_EarningsMonthsCard> createState() => _EarningsMonthsCardState();
}

class _EarningsMonthsCardState extends State<_EarningsMonthsCard> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    return _EarningsCard(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      radius: 22,
      children: [
        Semantics(
          button: true,
          expanded: _open,
          child: InkWell(
            key: const ValueKey('earnings-months-toggle'),
            onTap: () => setState(() => _open = !_open),
            borderRadius: BorderRadius.circular(12),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 44),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Month by month',
                      style: _Er.lineLabel.copyWith(color: _Er.link),
                    ),
                  ),
                  Transform.flip(
                    flipY: _open,
                    child: SvgPicture.asset(
                      'assets/icons/payroll_earnings_months_chevron.svg',
                      width: 18,
                      height: 18,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        if (_open)
          for (final (index, month) in widget.months.indexed) ...[
            if (index > 0) const _EarningsRule(),
            _EarningsMonthRow(
              month: month,
              busy: widget.opening == month.period,
              onTap: () => widget.onMonth(month),
            ),
          ],
      ],
    );
  }
}

class _EarningsMonthRow extends StatelessWidget {
  const _EarningsMonthRow({
    required this.month,
    required this.busy,
    required this.onTap,
  });

  final EarningsMonth month;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final unpaid = month.unpaidDays;
    final sub = [
      'Gross ${_rupees(month.grossPaise)}',
      if (unpaid > 0)
        '${_payDays(unpaid)} ${unpaid == 1 ? 'day' : 'days'} unpaid',
      if (month.isEstimate) 'Estimate',
    ].join(' · ');
    return InkWell(
      key: ValueKey('earnings-month-${month.period}'),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(month.label, style: _Er.monthTitle),
                  const SizedBox(height: 3),
                  Text(sub, style: _Er.monthSub),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Text(_rupees(month.netPaise), style: _Er.lineValue),
            const SizedBox(width: 12),
            if (busy)
              const SizedBox(
                width: 18,
                height: 18,
                child: Padding(
                  padding: EdgeInsets.all(2),
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: _prBlue,
                  ),
                ),
              )
            else
              SvgPicture.asset(
                'assets/icons/payroll_proofs_chevron.svg',
                width: 18,
                height: 18,
              ),
          ],
        ),
      ),
    );
  }
}

/// For tests only: Earnings, to push inside [PayrollScreen]'s navigator
/// until the Payroll home links to it.
@visibleForTesting
Widget payrollEarningsPageForTesting() => const _EarningsPage();
