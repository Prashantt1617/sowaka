part of 'quick_actions_screen.dart';

/// Payroll › Salary › "Past payslips" (Figma 4484:71811): every released
/// payslip, newest first, as the payroll run produced it (GET
/// /payslips/mine — the run's own payslip rows, the ones the dashboard's
/// Payroll Runs › payslip shows), each opening to the slip itself.
///
/// With none released yet it says when the first will come:
/// [firstPayrollPeriod] ("2026-10") is the pay period payroll runs next.
class _PayslipsPage extends StatefulWidget {
  const _PayslipsPage({this.firstPayrollPeriod});

  final String? firstPayrollPeriod;

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

  String get _emptyText {
    final month = payrollMonth(widget.firstPayrollPeriod);
    return month == null
        ? 'Your first payslip will show here after your first payroll.'
        : 'Your first payslip will show here after '
              '${_monthName(month.month)} payroll.';
  }

  @override
  Widget build(BuildContext context) {
    return _payrollPage(
      context,
      key: const ValueKey('payroll-payslips'),
      title: 'Past payslip',
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
            if (slips.isEmpty) return _PayslipsEmpty(text: _emptyText);
            return Container(
              key: const ValueKey('payslips-list'),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Column(
                children: [
                  for (final (index, slip) in slips.indexed)
                    _PayslipListRow(
                      slip: slip,
                      divided: index > 0,
                      onTap: () => _pushPayroll<void>(
                        context,
                        _PayslipPage(slip: slip, company: company),
                      ),
                    ),
                ],
              ),
            );
          },
        ),
        const SizedBox(height: 14),
        const _PayslipTicketLink(),
      ],
    );
  }
}

/// "September 2026 · Credited 30 Sep · ₹1,13,533 ›".
class _PayslipListRow extends StatelessWidget {
  const _PayslipListRow({
    required this.slip,
    required this.divided,
    required this.onTap,
  });

  final Payslip slip;
  final bool divided;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    key: ValueKey('payslip-row-${slip.id}'),
    onTap: onTap,
    child: Container(
      padding: EdgeInsets.only(top: divided ? 15 : 14, bottom: 14),
      decoration: divided
          ? const BoxDecoration(
              border: Border(top: BorderSide(color: Color(0xFFF1F1F4))),
            )
          : null,
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _periodLabel(slip.period),
                  style: _PrText.title.copyWith(
                    fontSize: 15,
                    height: 19 / 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  slip.paidAt == null
                      ? 'Released'
                      : 'Credited ${_short(slip.paidAt!)}',
                  style: _PrText.sub.copyWith(
                    color: const Color(0xFF55555C),
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Text(
            _rupees(slip.netPayablePaise),
            style: _PrText.amount.copyWith(
              fontSize: 14.5,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(width: 12),
          const Icon(
            Icons.chevron_right_rounded,
            size: 18,
            color: Color(0xFF9CA3AF),
          ),
        ],
      ),
    ),
  );
}

/// "No payslips yet" (Figma 4484:72115).
class _PayslipsEmpty extends StatelessWidget {
  const _PayslipsEmpty({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    key: const ValueKey('payslips-empty'),
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
    ),
    child: Column(
      children: [
        Container(
          width: 48,
          height: 48,
          margin: const EdgeInsets.only(bottom: 6),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(13),
            border: Border.all(color: const Color(0xFFF0F0F2)),
            boxShadow: const [
              BoxShadow(
                color: Color(0x0F000000),
                blurRadius: 3,
                offset: Offset(0, 2),
              ),
            ],
          ),
          child: Image.asset(
            'assets/icons/payroll_payslip.png',
            width: 30,
            height: 30,
            fit: BoxFit.cover,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'No payslips yet',
          textAlign: TextAlign.center,
          style: _PrText.title.copyWith(
            fontSize: 16,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          text,
          textAlign: TextAlign.center,
          style: _PrText.sub.copyWith(
            color: const Color(0xFF55555C),
            fontSize: 13.5,
            height: 19.58 / 13.5,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    ),
  );
}

/// "Can't find a payslip? Raise a ticket", straight to a new Support Desk
/// ticket (PR #101), else the desk.
class _PayslipTicketLink extends StatelessWidget {
  const _PayslipTicketLink();

  @override
  Widget build(BuildContext context) {
    final raiseTicket = _PayrollScope.of(context).onRaiseTicket;
    if (raiseTicket == null && !canRaiseSupportTicket) {
      return const SizedBox.shrink();
    }
    return Center(
      child: InkWell(
        key: const ValueKey('payslips-raise-ticket'),
        onTap: () {
          if (!raiseSupportTicket(about: 'I can\'t find a payslip:')) {
            raiseTicket?.call();
          }
        },
        borderRadius: BorderRadius.circular(8),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Center(
              widthFactor: 1,
              child: Text(
                'Can\'t find a payslip? Raise a ticket',
                style: _PrText.link.copyWith(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Shares one released payslip as a PDF, drawn on the phone from the run's
/// own payslip row ([buildPayslipPdf]). False when it could not be made.
Future<bool> _sharePayslipPdf(Payslip slip, PayslipCompany company) async {
  try {
    final pdf = await buildPayslipPdf(slip: slip, company: company);
    await Printing.sharePdf(bytes: pdf, filename: 'payslip-${slip.period}.pdf');
    return true;
  } catch (_) {
    return false;
  }
}

/// The header's download button (Figma "dl"): a 34 px outlined square.
class _PrDownloadButton extends StatelessWidget {
  const _PrDownloadButton({super.key, required this.onTap, this.busy = false});

  final VoidCallback? onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'Download payslip',
    child: Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Color(0xFF1E8BF5)),
      ),
      child: InkWell(
        onTap: busy ? null : onTap,
        borderRadius: BorderRadius.circular(12),
        child: SizedBox(
          width: 34,
          height: 34,
          child: Center(
            child: busy
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: _prBlue,
                    ),
                  )
                : const Icon(
                    Icons.file_download_outlined,
                    size: 18,
                    color: Color(0xFF1E8BF5),
                  ),
          ),
        ),
      ),
    ),
  );
}

/// One month's payslip as a receipt (Figma 4484:72211, "August salary"):
/// net pay on top, then what was earned, the loss of pay, the gross paid,
/// what was taken off and the net — every figure the payroll run's own
/// payslip row, as the dashboard's payslip shows it.
class _PayslipPage extends StatefulWidget {
  const _PayslipPage({required this.slip, required this.company});

  final Payslip slip;
  final PayslipCompany company;

  @override
  State<_PayslipPage> createState() => _PayslipPageState();
}

class _PayslipPageState extends State<_PayslipPage> {
  bool _downloading = false;
  bool _lopOpen = false;

  Future<void> _download() async {
    if (_downloading) return;
    setState(() => _downloading = true);
    final ok = await _sharePayslipPdf(widget.slip, widget.company);
    if (!mounted) return;
    setState(() => _downloading = false);
    if (!ok) showAppToast(context, 'Could not prepare the payslip. Try again.');
  }

  void _raiseTicket() {
    final month = payrollMonth(widget.slip.period);
    final about =
        'Something on my ${month == null ? '' : '${_periodLabel(widget.slip.period)} '}'
        'payslip doesn\'t look right:';
    if (!raiseSupportTicket(about: about)) {
      _PayrollScope.of(context).onRaiseTicket?.call();
    }
  }

  String get _title {
    final month = payrollMonth(widget.slip.period);
    return month == null ? 'Payslip' : '${_monthName(month.month)} salary';
  }

  @override
  Widget build(BuildContext context) {
    final slip = widget.slip;
    final earnings = slip.earnings.where((e) => !e.hidden).toList();
    final hiddenEarnings = slip.earnings
        .where((e) => e.hidden)
        .fold(0, (sum, e) => sum + e.fullPaise);
    final deductions = slip.deductions.where((d) => !d.hidden).toList();
    final hiddenDeductions = slip.deductions
        .where((d) => d.hidden)
        .fold(0, (sum, d) => sum + d.fullPaise);
    final lopPaise = slip.lossOfPayPaise;
    // What the slip paid as gross: the earnings after loss of pay, plus
    // overtime (the run's own gross).
    final grossPaid = slip.monthlyPaise - lopPaise + slip.overtimePaise;
    final docked = slip.lines.where((line) => line.days > 0).toList();
    final covered = slip.paidLeaveDaysApplied;
    final raiseTicket = _PayrollScope.of(context).onRaiseTicket;
    final canRaise = raiseTicket != null || canRaiseSupportTicket;
    return _payrollPage(
      context,
      key: ValueKey('payslip-${slip.id}'),
      title: _title,
      trailing: _PrDownloadButton(
        key: const ValueKey('payslip-download'),
        onTap: _download,
        busy: _downloading,
      ),
      children: [
        Container(
          key: const ValueKey('payslip-receipt'),
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 18),
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'NET PAY',
                      style: _PrText.label.copyWith(
                        fontSize: 13,
                        height: 18 / 13,
                        letterSpacing: .8,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  _PrPill(
                    slip.paidAt == null
                        ? 'Released'
                        : 'Credited ${_short(slip.paidAt!)}',
                    color: _prGreen,
                    tint: _prGreenTint,
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                _rupees(slip.netPayablePaise),
                key: const ValueKey('payslip-net'),
                style: const TextStyle(
                  fontFamily: 'Sora',
                  fontFamilyFallback: _soraFallback,
                  color: Color(0xFF111827),
                  fontSize: 34,
                  height: 1.1,
                  letterSpacing: -.6,
                  fontWeight: FontWeight.w700,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
              if (slip.workingDays > 0) ...[
                const SizedBox(height: 6),
                Text(
                  '${slip.payableDays} of ${slip.workingDays} days paid',
                  style: _PrText.sub.copyWith(
                    color: const Color(0xFF55555C),
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              const _ReceiptCut(),
              const _PayslipHeading('Earnings'),
              for (final e in earnings)
                _PayslipLine(e.name, _rupees(e.fullPaise)),
              if (hiddenEarnings > 0)
                _PayslipLine('Other earnings', _rupees(hiddenEarnings)),
              if (slip.overtimePaise > 0)
                _PayslipLine('Overtime', _rupees(slip.overtimePaise)),
              if (slip.lopDays > 0 || lopPaise > 0) ...[
                _PayslipLopLine(
                  days: slip.lopDays,
                  amountPaise: lopPaise,
                  open: _lopOpen,
                  onTap: () => setState(() => _lopOpen = !_lopOpen),
                ),
                if (_lopOpen)
                  Container(
                    key: const ValueKey('payslip-lop-info'),
                    width: double.infinity,
                    margin: const EdgeInsets.only(bottom: 6),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 11,
                      vertical: 9,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF7F7F9),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      [
                        for (final line in docked)
                          '${line.name}: ${line.count} → '
                              '${_payDays(line.days)} '
                              '${line.days == 1 ? 'day' : 'days'}',
                        if (covered > 0)
                          '${_payDays(covered)} '
                              '${covered == 1 ? 'day' : 'days'} covered by '
                              'paid leave',
                        if (slip.workingDays > 0)
                          'One day\'s pay is '
                              '${_rupees((slip.monthlyPaise / slip.workingDays).round())} '
                              '(${_rupees(slip.monthlyPaise)} ÷ '
                              '${slip.workingDays} days)',
                      ].join('\n'),
                      style: _PrText.sub.copyWith(
                        color: const Color(0xFF55555C),
                        fontSize: 12.5,
                        height: 1.4,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
              ],
              _PayslipLine(
                'Gross pay',
                _rupees(grossPaid),
                strong: true,
                ruled: true,
              ),
              const _ReceiptCut(),
              const _PayslipHeading('Deductions'),
              for (final d in deductions)
                _PayslipLine(d.name, '− ${_rupees(d.fullPaise)}'),
              if (hiddenDeductions > 0)
                _PayslipLine(
                  'Other deductions',
                  '− ${_rupees(hiddenDeductions)}',
                ),
              if (slip.deductions.isEmpty)
                const _PayslipLine('No deductions', '—'),
              _PayslipLine(
                'Total deductions',
                '− ${_rupees(slip.otherDeductionsPaise)}',
                strong: true,
                ruled: true,
              ),
              if (slip.reimbursementsPaise > 0) ...[
                const _ReceiptCut(),
                _PayslipLine(
                  'Reimbursements',
                  '+ ${_rupees(slip.reimbursementsPaise)}',
                ),
              ],
              const _ReceiptCut(),
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    const Expanded(
                      child: Text(
                        'Net pay',
                        style: TextStyle(
                          fontFamily: 'Sora',
                          fontFamilyFallback: _soraFallback,
                          color: Color(0xFF111827),
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      _rupees(slip.netPayablePaise),
                      key: const ValueKey('payslip-total'),
                      style: const TextStyle(
                        fontFamily: 'Sora',
                        fontFamilyFallback: _soraFallback,
                        color: Color(0xFF111827),
                        fontSize: 22,
                        letterSpacing: -.3,
                        fontWeight: FontWeight.w700,
                        fontFeatures: [FontFeature.tabularFigures()],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(
          height: 12,
          width: double.infinity,
          child: CustomPaint(painter: _ZigZagEdgePainter(Colors.white)),
        ),
        if (canRaise) ...[
          Padding(
            padding: const EdgeInsets.only(top: 20, bottom: 10),
            child: Text(
              'Something on this payslip doesn\'t look right?',
              textAlign: TextAlign.center,
              style: _PrText.sub.copyWith(
                color: const Color(0xFF55555C),
                fontSize: 13.5,
                height: 18 / 13.5,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Material(
            color: Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: const BorderSide(color: Color(0xFF1E8BF5)),
            ),
            child: InkWell(
              key: const ValueKey('payslip-raise-ticket'),
              onTap: _raiseTicket,
              borderRadius: BorderRadius.circular(12),
              child: SizedBox(
                height: 46,
                child: Center(
                  child: Text(
                    'Raise a ticket',
                    style: _PrText.link.copyWith(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
        const SizedBox(height: 24),
      ],
    );
  }
}

/// "EARNINGS", "DEDUCTIONS".
class _PayslipHeading extends StatelessWidget {
  const _PayslipHeading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 6, bottom: 2),
    child: Text(
      text.toUpperCase(),
      style: _PrText.label.copyWith(
        fontSize: 12.5,
        height: 16 / 12.5,
        letterSpacing: .8,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

/// A payslip line: name and amount, 40 px tall; [strong] lines (Gross pay,
/// Total deductions) sit under a hairline ([ruled]).
class _PayslipLine extends StatelessWidget {
  const _PayslipLine(
    this.label,
    this.value, {
    this.strong = false,
    this.ruled = false,
  });

  final String label;
  final String value;
  final bool strong;
  final bool ruled;

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontFamily: 'Sora',
      fontFamilyFallback: _soraFallback,
      color: const Color(0xFF111827),
      fontSize: 14.5,
      height: 20 / 14.5,
      fontWeight: strong ? FontWeight.w700 : FontWeight.w600,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    final row = ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 40),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          const SizedBox(width: 12),
          Text(value, style: style),
        ],
      ),
    );
    if (!ruled) return row;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: DecoratedBox(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: Color(0xFFEFEFF2))),
        ),
        child: row,
      ),
    );
  }
}

/// "Loss of pay · 3 days ›   − ₹12,000": opens to what made it.
class _PayslipLopLine extends StatelessWidget {
  const _PayslipLopLine({
    required this.days,
    required this.amountPaise,
    required this.open,
    required this.onTap,
  });

  final double days;
  final int amountPaise;
  final bool open;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    expanded: open,
    child: InkWell(
      key: const ValueKey('payslip-lop'),
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 40),
        child: Row(
          children: [
            Expanded(
              child: Row(
                children: [
                  Flexible(
                    child: Text(
                      'Loss of pay · ${_payDays(days)} '
                      '${days == 1 ? 'day' : 'days'}',
                      style: _PrText.link.copyWith(
                        fontFamily: 'Sora',
                        fontFamilyFallback: _soraFallback,
                        fontSize: 14.5,
                        height: 20 / 14.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  AnimatedRotation(
                    turns: open ? .25 : 0,
                    duration: const Duration(milliseconds: 150),
                    child: const Icon(
                      Icons.chevron_right_rounded,
                      size: 16,
                      color: _prBlue,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Text(
              '− ${_rupees(amountPaise)}',
              style: const TextStyle(
                fontFamily: 'Sora',
                fontFamilyFallback: _soraFallback,
                color: Color(0xFF111827),
                fontSize: 14.5,
                height: 20 / 14.5,
                fontWeight: FontWeight.w600,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
