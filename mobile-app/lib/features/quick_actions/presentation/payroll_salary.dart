part of 'quick_actions_screen.dart';

/// Payroll › "October salary": one pay period's pay as a receipt (Figma
/// R 2). The take-home on top, then each line that makes it — gross, loss of
/// pay, every deduction — opening to say in plain words what it is, from the
/// server's own figures and the company's rules (GET /payroll/me/salary).
/// The previous pay period unless [period] ("2026-10") is given; an estimate
/// until its payslip is released.
class _SalarySummaryPage extends StatefulWidget {
  const _SalarySummaryPage({this.period});

  final String? period;

  @override
  State<_SalarySummaryPage> createState() => _SalarySummaryPageState();
}

class _SalarySummaryPageState extends State<_SalarySummaryPage> {
  PayrollSalarySummary? _summary;
  String? _error;
  bool _started = false;

  /// The line opened to its explanation; one at a time.
  int? _open;
  bool _estimateOpen = false;

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
      final summary = await api.fetchSalarySummary(period: widget.period);
      if (!mounted) return;
      setState(() {
        _summary = summary;
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = payrollErrorText(error));
    }
  }

  void _retry() {
    setState(() => _error = null);
    unawaited(_load());
  }

  String get _title {
    final month = payrollMonth(_summary?.period ?? widget.period);
    return month == null ? 'Salary' : '${_monthName(month.month)} salary';
  }

  @override
  Widget build(BuildContext context) {
    final summary = _summary;
    return _payrollPage(
      context,
      key: const ValueKey('payroll-salary'),
      title: _title,
      children: [
        if (summary == null && _error == null)
          const _PrLoading()
        else if (summary == null)
          _PrError(_error!, onRetry: _retry)
        else ...[
          if (summary.notSetUp case final notSetUp?)
            _SalaryNotSetUpCard(period: summary.period, notSetUp: notSetUp)
          else
            _receipt(summary),
          const SizedBox(height: 12),
          _PastPayslipsRow(summary: summary),
        ],
      ],
    );
  }

  Widget _receipt(PayrollSalarySummary s) {
    final month = payrollMonth(s.period);
    final heading =
        '${month == null ? 'This month' : _monthName(month.month)} salary'
            .toUpperCase();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          key: const ValueKey('payroll-salary-receipt'),
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 18),
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      heading,
                      style: _PrText.label.copyWith(
                        fontSize: 13,
                        height: 18 / 13,
                        letterSpacing: .8,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  // No pill once the payslip is out: the figures are final.
                  if (s.isEstimate)
                    Semantics(
                      button: true,
                      expanded: _estimateOpen,
                      child: InkWell(
                        key: const ValueKey('payroll-salary-estimate'),
                        onTap: () =>
                            setState(() => _estimateOpen = !_estimateOpen),
                        borderRadius: BorderRadius.circular(99),
                        child: const _PrPill(
                          'Estimate',
                          color: _prBlue,
                          tint: _prBlueTint,
                          icon: Icons.info_outline_rounded,
                        ),
                      ),
                    ),
                ],
              ),
              if (s.daysPaid != null && s.baseDays != null) ...[
                const SizedBox(height: 12),
                _PrPill(
                  '${_payDays(s.daysPaid!)} of ${s.baseDays} days paid',
                  color: _prGreen,
                  tint: _prGreenTint,
                ),
              ],
              const SizedBox(height: 10),
              Text(
                _rupees(s.takeHomePaise ?? 0),
                key: const ValueKey('payroll-salary-take-home'),
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
              if (_estimateOpen && s.isEstimate)
                Container(
                  key: const ValueKey('payroll-salary-estimate-note'),
                  width: double.infinity,
                  margin: const EdgeInsets.only(top: 10),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 11,
                    vertical: 9,
                  ),
                  decoration: BoxDecoration(
                    color: _prBlueTint,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Text(
                    'Based on your attendance till today. It can change if '
                    'leave or punches change before payroll.',
                    style: TextStyle(
                      color: Color(0xFF075985),
                      fontSize: 12.5,
                      height: 1.4,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              const _ReceiptCut(),
              for (final (index, line) in s.lines.indexed) _line(index, line),
              const _ReceiptCut(),
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  const Expanded(
                    child: Text(
                      'Take-home',
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
                    _rupees(s.takeHomePaise ?? 0),
                    key: const ValueKey('payroll-salary-total'),
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
            ],
          ),
        ),
        // The receipt's torn edge.
        const Padding(
          padding: EdgeInsets.only(bottom: 4),
          child: SizedBox(
            height: 12,
            width: double.infinity,
            child: CustomPaint(painter: _ZigZagEdgePainter(Colors.white)),
          ),
        ),
      ],
    );
  }

  Widget _line(int index, PayrollSalaryLine line) {
    final open = _open == index;
    final value = line.isEarning && line.key == 'gross'
        ? _rupees(line.amountPaise)
        : line.isEarning
        ? '+ ${_rupees(line.amountPaise)}'
        : '− ${_rupees(line.amountPaise)}';
    final hasInfo = line.explanation.isNotEmpty;
    return Column(
      key: ValueKey('payroll-salary-line-${line.key}'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          button: hasInfo,
          expanded: hasInfo ? open : null,
          child: InkWell(
            onTap: hasInfo
                ? () => setState(() => _open = open ? null : index)
                : null,
            borderRadius: BorderRadius.circular(8),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 44),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        line.label,
                        style: _PrText.row.copyWith(
                          color: const Color(0xFF111827),
                          fontSize: 14.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      value,
                      style: TextStyle(
                        fontFamily: 'Sora',
                        fontFamilyFallback: _soraFallback,
                        color: const Color(0xFF111827),
                        fontSize: 14.5,
                        height: 20 / 14.5,
                        // The gross stands out; what comes off it does not.
                        fontWeight: line.key == 'gross'
                            ? FontWeight.w700
                            : FontWeight.w600,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 16,
                      child: hasInfo
                          ? AnimatedRotation(
                              turns: open ? .5 : 0,
                              duration: const Duration(milliseconds: 150),
                              child: const Icon(
                                Icons.keyboard_arrow_down_rounded,
                                size: 16,
                                color: Color(0xFF9CA3AF),
                              ),
                            )
                          : null,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        if (open && hasInfo)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 6),
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
            decoration: BoxDecoration(
              color: const Color(0xFFF7F7F9),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              line.explanation,
              key: ValueKey('payroll-salary-info-${line.key}'),
              style: _PrText.sub.copyWith(
                color: const Color(0xFF55555C),
                fontSize: 12.5,
                height: 1.4,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        // The link tucks up into the row's padding (−10 above, −4 below), as
        // on the receipt.
        if (line.isLop)
          SizedBox(
            height: 30,
            child: OverflowBox(
              alignment: const Alignment(-1, 3 / 7),
              maxHeight: 44,
              child: InkWell(
                key: const ValueKey('payroll-salary-unpaid-days'),
                onTap: () => _PayrollScope.of(
                  context,
                ).onFixMissingPunches(_summary?.unpaidDays),
                borderRadius: BorderRadius.circular(8),
                child: SizedBox(
                  height: 44,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Check unpaid days',
                        style: _PrText.link.copyWith(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(width: 4),
                      const Icon(
                        Icons.chevron_right_rounded,
                        size: 16,
                        color: _prBlue,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// "Past payslips · April to September 2026": the payslips list.
class _PastPayslipsRow extends StatelessWidget {
  const _PastPayslipsRow({required this.summary});

  final PayrollSalarySummary summary;

  String get _span {
    final from = summary.payslipsFrom;
    final to = summary.payslipsTo;
    if (summary.payslipCount == 0 || from == null) return 'None released yet';
    final last = to ?? from;
    if (from.year == last.year && from.month == last.month) {
      return '${_monthName(from.month)} ${from.year}';
    }
    return from.year == last.year
        ? '${_monthName(from.month)} to ${_monthName(last.month)} ${last.year}'
        : '${_monthName(from.month)} ${from.year} to '
              '${_monthName(last.month)} ${last.year}';
  }

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    borderRadius: BorderRadius.circular(18),
    child: InkWell(
      key: const ValueKey('payroll-salary-past-payslips'),
      onTap: () => _pushPayroll<void>(context, const _PayslipsPage()),
      borderRadius: BorderRadius.circular(18),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            const _IllustrationTile(
              asset: 'assets/icons/request_reimbursement_money.png',
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Past payslips',
                    style: _PrText.title.copyWith(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    _span,
                    style: _PrText.sub.copyWith(
                      color: const Color(0xFF55555C),
                      fontSize: 12.5,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.chevron_right_rounded,
              size: 18,
              color: Color(0xFF9CA3AF),
            ),
          ],
        ),
      ),
    ),
  );
}

/// The receipt's dashed cut line, reaching 4 px past the card's padding.
class _ReceiptCut extends StatelessWidget {
  const _ReceiptCut();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 16, bottom: 8),
    child: LayoutBuilder(
      builder: (context, constraints) => SizedBox(
        height: 1.5,
        width: constraints.maxWidth,
        child: OverflowBox(
          minWidth: constraints.maxWidth + 8,
          maxWidth: constraints.maxWidth + 8,
          child: const CustomPaint(
            size: Size(double.infinity, 1.5),
            painter: _DashedLinePainter(),
          ),
        ),
      ),
    ),
  );
}

class _DashedLinePainter extends CustomPainter {
  const _DashedLinePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFFDCDCE1)
      ..strokeWidth = 1.5;
    const dash = 4.5;
    const gap = 3.0;
    final y = size.height / 2;
    for (var x = 0.0; x < size.width; x += dash + gap) {
      canvas.drawLine(
        Offset(x, y),
        Offset((x + dash).clamp(0, size.width), y),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_DashedLinePainter old) => false;
}

/// A row of 16 px teeth hanging from the receipt: its torn bottom edge.
class _ZigZagEdgePainter extends CustomPainter {
  const _ZigZagEdgePainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    const tooth = 16.0;
    final depth = size.height.clamp(0, 8).toDouble();
    final path = Path()..moveTo(0, 0);
    for (var x = 0.0; x < size.width; x += tooth) {
      final mid = (x + tooth / 2).clamp(0, size.width).toDouble();
      final end = (x + tooth).clamp(0, size.width).toDouble();
      path
        ..lineTo(mid, depth)
        ..lineTo(end, 0);
    }
    path.close();
    canvas.drawPath(path, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_ZigZagEdgePainter old) => old.color != color;
}

/// The salary summary on its own, for tests and for a link straight to it:
/// [screen] carries what the Payroll pages read (the API, the header's
/// actions, the unpaid-days list) without the Payroll home underneath.
@visibleForTesting
class PayrollSalarySummaryHost extends StatelessWidget {
  const PayrollSalarySummaryHost({
    super.key,
    required this.screen,
    this.period,
  });

  final PayrollScreen screen;
  final String? period;

  @override
  Widget build(BuildContext context) => _PayrollScope(
    screen: screen,
    child: Navigator(
      onGenerateRoute: (_) => MaterialPageRoute<void>(
        builder: (_) => _SalarySummaryPage(period: period),
      ),
    ),
  );
}
