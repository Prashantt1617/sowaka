part of 'quick_actions_screen.dart';

// ---------------------------------------------------------------- earnings

/// Earnings: a financial year's pay. The years with pay to switch between,
/// the year's gross with the tax, PF and professional tax taken off it and
/// the take-home, the yearly salary part by part, and each paid month — the
/// current one an estimate that opens the salary summary, a past one its
/// payslip. Every figure is the server's (GET /payroll/me/earnings).
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
        ] else ...[
          if (earnings.fys.isNotEmpty) ...[
            _EarningsYearSwitch(
              years: earnings.fys,
              selected: _loadingFy ?? earnings.fy,
              onChanged: (fy) {
                if (fy != earnings.fy && _loadingFy == null) {
                  unawaited(_load(fy));
                }
              },
            ),
            const SizedBox(height: 14),
          ],
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
      ],
    );
  }
}

/// "2026-27" → "FY 2026–27".
String _fyLabel(String fy) => 'FY ${fy.replaceFirst('-', '–')}';

/// The financial years with pay, as the Leave page's Upcoming / History
/// switch: grey track, the chosen year on white.
class _EarningsYearSwitch extends StatelessWidget {
  const _EarningsYearSwitch({
    required this.years,
    required this.selected,
    required this.onChanged,
  });

  final List<String> years;
  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    Widget item(String fy) {
      final on = fy == selected;
      return Semantics(
        selected: on,
        button: true,
        child: InkWell(
          key: ValueKey('earnings-fy-$fy'),
          onTap: () => onChanged(fy),
          borderRadius: BorderRadius.circular(8),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
            decoration: BoxDecoration(
              color: on ? Colors.white : Colors.transparent,
              borderRadius: BorderRadius.circular(8),
              boxShadow: on
                  ? const [
                      BoxShadow(
                        color: Color(0x1A000000),
                        blurRadius: 1.5,
                        offset: Offset(0, 1),
                      ),
                    ]
                  : null,
            ),
            child: Text(
              _fyLabel(fy),
              textAlign: TextAlign.center,
              maxLines: 1,
              style: TextStyle(
                fontFamily: 'Sora',
                color: on ? _prBlue : const Color(0xFF9CA3AF),
                fontSize: 12,
                height: 16 / 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      );
    }

    // Up to three years share the track; more scroll sideways.
    final fits = years.length <= 3;
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(12),
      ),
      child: fits
          ? Row(
              children: [
                for (final (index, fy) in years.indexed) ...[
                  if (index > 0) const SizedBox(width: 4),
                  Expanded(child: item(fy)),
                ],
              ],
            )
          : SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final (index, fy) in years.indexed) ...[
                    if (index > 0) const SizedBox(width: 4),
                    item(fy),
                  ],
                ],
              ),
            ),
    );
  }
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
        const _HomeSectionLabel('Yearly salary'),
        const SizedBox(height: 12),
        if (e.components.isEmpty && e.componentsNotSetUp != null)
          _PrNote(e.componentsNotSetUp!.message)
        else if (e.components.isEmpty)
          const _PrNote(
            'Your yearly salary shows here once HR sets up your pay.',
          )
        else ...[
          _FormCard(
            children: [
              for (final (index, c) in e.components.indexed) ...[
                if (index > 0) const _EarningsRule(),
                _EarningsLine(c.name, _rupees(c.annualPaise)),
              ],
              const _EarningsRule(dashed: true),
              _EarningsLine(
                'Total a year',
                _rupees(e.annualTotalPaise),
                key: const ValueKey('earnings-annual-total'),
                strong: true,
              ),
            ],
          ),
          if (!e.fromStructure) ...[
            const SizedBox(height: 8),
            Text(
              'What this year\'s payslips paid in full, before unpaid days.',
              style: _PrText.caption,
            ),
          ],
        ],
        const SizedBox(height: 24),
        const _HomeSectionLabel('Month by month'),
        const SizedBox(height: 12),
        if (e.months.isEmpty)
          const _PrNote('No month of this year has been paid yet.')
        else
          _FormCard(
            children: [
              for (final (index, month) in e.months.indexed) ...[
                if (index > 0) const _EarningsRule(),
                _EarningsMonthRow(
                  month: month,
                  busy: opening == month.period,
                  onTap: () => onMonth(month),
                ),
              ],
            ],
          ),
        if (e.estimateNotSetUp case final notSetUp?) ...[
          const SizedBox(height: 12),
          _PrNote(notSetUp.message),
        ],
        const SizedBox(height: 24),
      ],
    );
  }
}

/// The year so far: gross on top, what came off it, and the take-home.
class _EarnedCard extends StatelessWidget {
  const _EarnedCard({required this.earnings});

  final PayrollEarnings earnings;

  static const _taxColor = Color(0xFF7CC3E6);
  static const _pfColor = Color(0xFFD1D5DB);

  @override
  Widget build(BuildContext context) {
    final e = earnings;
    final deducted = e.pfPtPaise + e.otherDeductionsPaise;
    final bar = [
      (e.takeHomePaise, _prBlue, 'Take-home'),
      (e.taxPaise, _taxColor, 'Tax'),
      (
        deducted,
        _pfColor,
        e.otherDeductionsPaise > 0 ? 'PF, PT and other' : 'PF and PT',
      ),
    ].where((part) => part.$1 > 0).toList();
    return _FormCard(
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Earned · ${_fyLabel(e.fy)}'.toUpperCase(),
                style: _PrText.label,
              ),
            ),
            if (e.span case final span?)
              _PrPill(
                span,
                color: const Color(0xFF4B5563),
                tint: const Color(0xFFF3F4F6),
              ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          _rupees(e.grossPaise),
          key: const ValueKey('earnings-gross'),
          style: const TextStyle(
            fontFamily: 'Sora',
            fontFamilyFallback: _soraFallback,
            color: Color(0xFF111827),
            fontSize: 28,
            height: 36 / 28,
            letterSpacing: -0.5,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          e.current ? 'Gross pay so far this year' : 'Gross pay for the year',
          style: _PrText.sub,
        ),
        if (bar.isNotEmpty) ...[
          const SizedBox(height: 14),
          Semantics(
            label:
                'Of ${_rupees(e.grossPaise)}: take-home '
                '${_rupees(e.takeHomePaise)}, tax ${_rupees(e.taxPaise)}, '
                'PF and professional tax ${_rupees(deducted)}',
            child: SizedBox(
              height: 12,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final (index, part) in bar.indexed) ...[
                    if (index > 0) const SizedBox(width: 3),
                    Expanded(
                      // Shares of the bar, in whole rupees so the flex stays small.
                      flex: (part.$1 / 100).round().clamp(1, 1 << 30),
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: part.$2,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 14,
            runSpacing: 6,
            children: [
              for (final part in bar)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: part.$2,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(part.$3, style: _PrText.sub),
                  ],
                ),
            ],
          ),
        ],
        const SizedBox(height: 12),
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
  const _EarningsLine(this.label, this.value, {super.key, this.strong = false});

  final String label;
  final String value;
  final bool strong;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: const BoxConstraints(minHeight: 44),
    child: Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: strong
                ? _PrText.title.copyWith(fontWeight: FontWeight.w700)
                : _PrText.row,
          ),
        ),
        const SizedBox(width: 12),
        Text(
          value,
          style: strong
              ? _PrText.amount.copyWith(fontSize: 16)
              : _PrText.row.copyWith(
                  fontFamily: 'Sora',
                  fontFamilyFallback: _soraFallback,
                  fontWeight: FontWeight.w600,
                ),
        ),
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
      return const Divider(height: 1, thickness: 1, color: Color(0xFFF3F4F6));
    }
    return SizedBox(
      height: 1.5,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final count = (constraints.maxWidth / 8).floor();
          return Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              for (var i = 0; i < count; i++)
                const SizedBox(
                  width: 4,
                  height: 1.5,
                  child: ColoredBox(color: Color(0xFFD1D5DB)),
                ),
            ],
          );
        },
      ),
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
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(month.label, style: _PrText.title),
                  const SizedBox(height: 2),
                  Text(sub, style: _PrText.sub),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Text(_rupees(month.netPaise), style: _PrText.amount),
            const SizedBox(width: 4),
            if (busy)
              const SizedBox(
                width: 20,
                height: 20,
                child: Padding(
                  padding: EdgeInsets.all(3),
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: _prBlue,
                  ),
                ),
              )
            else
              const _PrChevron(),
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
