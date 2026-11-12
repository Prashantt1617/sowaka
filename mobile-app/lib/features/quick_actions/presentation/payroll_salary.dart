part of 'quick_actions_screen.dart';

/// Payroll › "October salary" (Figma 4484:71428 / 4653:27605): one pay
/// period's pay as a receipt. A Previous Month | Current Month switch on
/// top — the pay period most recently over (its released payslip, else its
/// estimate) and the one running now (its estimate, `?view=current`) — then
/// the salary summary donut, the take-home and each line that makes it —
/// gross, loss of pay, every deduction — opening to say in plain words what
/// it is, from the server's own figures and the company's rules (GET
/// /payroll/me/salary). With [period] ("2026-10") that month alone, no
/// switch.
class _SalarySummaryPage extends StatefulWidget {
  const _SalarySummaryPage({this.period});

  final String? period;

  @override
  State<_SalarySummaryPage> createState() => _SalarySummaryPageState();
}

class _SalarySummaryPageState extends State<_SalarySummaryPage> {
  /// Each side of the switch, read once: false the previous pay period,
  /// true the current one.
  final _summaries = <bool, PayrollSalarySummary>{};
  final _errors = <bool, String>{};
  bool _current = false;
  bool _started = false;
  bool _downloading = false;

  /// The line opened to its explanation; one at a time.
  int? _open;
  bool _estimateOpen = false;

  PayrollSalarySummary? get _summary => _summaries[_current];
  String? get _error => _errors[_current];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    unawaited(_load(_current));
  }

  Future<void> _load(bool current) async {
    final api = _PayrollScope.of(context).api;
    try {
      final summary = await api.fetchSalarySummary(
        period: widget.period,
        current: current,
      );
      if (!mounted) return;
      setState(() {
        _summaries[current] = summary;
        _errors.remove(current);
      });
    } catch (error) {
      if (mounted) setState(() => _errors[current] = payrollErrorText(error));
    }
  }

  void _retry() {
    setState(() => _errors.remove(_current));
    unawaited(_load(_current));
  }

  void _switchTo(bool current) {
    if (current == _current) return;
    setState(() {
      _current = current;
      _open = null;
      _estimateOpen = false;
    });
    if (!_summaries.containsKey(current) && !_errors.containsKey(current)) {
      unawaited(_load(current));
    }
  }

  /// The released payslip behind this salary, as a PDF.
  Future<void> _download(String payslipId) async {
    if (_downloading) return;
    setState(() => _downloading = true);
    var ok = false;
    try {
      final (company, slip) = await _PayrollScope.of(
        context,
      ).api.fetchPayslip(payslipId);
      ok = await _sharePayslipPdf(slip, company);
    } catch (_) {
      ok = false;
    }
    if (!mounted) return;
    setState(() => _downloading = false);
    if (!ok) showAppToast(context, 'Could not prepare the payslip. Try again.');
  }

  String get _title {
    final month = payrollMonth(
      _summary?.period ??
          widget.period ??
          (_current
              ? _summaries[false]?.currentPeriod
              : _summaries[true]?.previousPeriod),
    );
    return month == null ? 'Salary' : '${_monthName(month.month)} salary';
  }

  /// The pay period payroll runs next, for "No payslips yet".
  String? get _firstPayrollPeriod {
    final previous = _summaries[false];
    if (previous != null) return previous.released ? null : previous.period;
    return _summaries[true]?.previousPeriod ?? _summary?.period;
  }

  @override
  Widget build(BuildContext context) {
    final summary = _summary;
    final payslipId = summary?.released == true ? summary?.payslipId : null;
    return _payrollPage(
      context,
      key: const ValueKey('payroll-salary'),
      title: _title,
      trailing: payslipId == null
          ? null
          : _PrDownloadButton(
              key: const ValueKey('payroll-salary-download'),
              onTap: () => _download(payslipId),
              busy: _downloading,
            ),
      children: [
        if (widget.period == null)
          Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: _PrSegmented(current: _current, onChanged: _switchTo),
          ),
        if (summary == null && _error == null)
          const _PrLoading()
        else if (summary == null)
          _PrError(_error!, onRetry: _retry)
        else ...[
          if (summary.notSetUp case final notSetUp?)
            _SalaryNotSetUpCard(period: summary.period, notSetUp: notSetUp)
          else ...[
            _SalaryDonutCard(summary: summary),
            const SizedBox(height: 12),
            _receipt(summary),
          ],
          const SizedBox(height: 12),
          _PastPayslipsRow(
            summary: summary,
            firstPayrollPeriod: _firstPayrollPeriod,
          ),
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
  const _PastPayslipsRow({required this.summary, this.firstPayrollPeriod});

  final PayrollSalarySummary summary;
  final String? firstPayrollPeriod;

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
      onTap: () => _pushPayroll<void>(
        context,
        _PayslipsPage(firstPayrollPeriod: firstPayrollPeriod),
      ),
      borderRadius: BorderRadius.circular(18),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            const _IllustrationTile(
              asset: 'assets/icons/payroll_payslip.png',
              size: 25,
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

/// "Previous Month | Current Month" (Figma "seg2"): the white thumb on the
/// side shown.
class _PrSegmented extends StatelessWidget {
  const _PrSegmented({required this.current, required this.onChanged});

  final bool current;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    Widget side(String label, bool value) {
      final on = current == value;
      return Expanded(
        child: Semantics(
          button: true,
          selected: on,
          child: GestureDetector(
            key: ValueKey(
              'payroll-salary-view-${value ? 'current' : 'previous'}',
            ),
            behavior: HitTestBehavior.opaque,
            onTap: () => onChanged(value),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              padding: const EdgeInsets.symmetric(vertical: 9),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: on ? Colors.white : Colors.transparent,
                borderRadius: BorderRadius.circular(10),
                boxShadow: on
                    ? const [
                        BoxShadow(
                          color: Color(0x14000000),
                          blurRadius: 1.5,
                          offset: Offset(0, 1),
                        ),
                      ]
                    : null,
              ),
              child: Text(
                label,
                maxLines: 1,
                style: TextStyle(
                  fontFamily: 'Sora',
                  fontFamilyFallback: _soraFallback,
                  color: on ? _prBlue : const Color(0xFF55555C),
                  fontSize: 13.5,
                  height: 17 / 13.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: const Color(0xFFE8E8EC),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [side('Previous Month', false), side('Current Month', true)],
      ),
    );
  }
}

/// "SALARY SUMMARY" (Figma "Sum"): the gross as a donut cut into what is
/// deducted, the loss of pay and the take-home, with the figures beside it.
/// Every figure is a line of the same summary, so it adds up with the
/// receipt below.
class _SalaryDonutCard extends StatelessWidget {
  const _SalaryDonutCard({required this.summary});

  final PayrollSalarySummary summary;

  static const deductionsColor = Color(0xFF9CCBFA);
  static const lopColor = Color(0xFFFF5A5F);
  static const takeHomeColor = Color(0xFF1E8BF5);

  @override
  Widget build(BuildContext context) {
    final s = summary;
    final deductions = s.deductionsPaise;
    final lop = s.lopPaise;
    final takeHome = s.takeHomePaise ?? 0;
    final lopDays = s.lop?.days ?? 0;
    final legend = TextStyle(
      fontFamily: 'Sora',
      fontFamilyFallback: _soraFallback,
      color: const Color(0xFF55555C),
      fontSize: 12.5,
      height: 16 / 12.5,
      fontWeight: FontWeight.w600,
    );
    final figure = const TextStyle(
      fontFamily: 'Sora',
      fontFamilyFallback: _soraFallback,
      color: Color(0xFF111827),
      fontSize: 12,
      height: 16 / 12,
      fontWeight: FontWeight.w700,
      fontFeatures: [FontFeature.tabularFigures()],
    );
    Widget row(Color color, String label, String value, {bool total = false}) {
      return Row(
        children: [
          Container(
            width: 9,
            height: 9,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(3),
            ),
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: total
                  ? legend.copyWith(
                      color: const Color(0xFF111827),
                      fontWeight: FontWeight.w700,
                    )
                  : legend,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            value,
            style: total
                ? figure.copyWith(fontSize: 15, height: 19 / 15)
                : figure,
          ),
        ],
      );
    }

    return Container(
      key: const ValueKey('payroll-salary-summary'),
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        boxShadow: const [
          BoxShadow(
            color: Color(0x08000000),
            blurRadius: 1,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'SALARY SUMMARY',
                  style: _PrText.label.copyWith(
                    fontSize: 13,
                    height: 18 / 13,
                    letterSpacing: .8,
                  ),
                ),
              ),
              if (s.isEstimate)
                const _PrPill('Estimate', color: _prBlue, tint: _prBlueTint),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              SizedBox(
                width: 108,
                height: 108,
                child: CustomPaint(
                  painter: _DonutPainter([
                    (deductions, deductionsColor),
                    (lop, lopColor),
                    (takeHome, takeHomeColor),
                  ]),
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _rupees(s.grossPaise ?? 0),
                          key: const ValueKey('payroll-salary-summary-gross'),
                          style: figure.copyWith(fontSize: 11.9),
                        ),
                        Text(
                          'gross',
                          style: figure.copyWith(
                            color: const Color(0xFF8E8E95),
                            fontSize: 9.7,
                            height: 12 / 9.7,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  children: [
                    row(
                      deductionsColor,
                      'Deductions',
                      '−${_rupees(deductions)}',
                    ),
                    const SizedBox(height: 9),
                    row(
                      lopColor,
                      lopDays > 0
                          ? 'Loss of pay · ${_payDays(lopDays)} '
                                '${lopDays == 1 ? 'day' : 'days'}'
                          : 'Loss of pay',
                      '−${_rupees(lop)}',
                    ),
                    const SizedBox(height: 9),
                    Container(
                      padding: const EdgeInsets.only(top: 2),
                      decoration: const BoxDecoration(
                        border: Border(
                          top: BorderSide(color: Color(0xFFF1F1F4)),
                        ),
                      ),
                      child: row(
                        takeHomeColor,
                        'Take-home',
                        _rupees(takeHome),
                        total: true,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A ring cut into [slices] by size, clockwise from the top; a ring with
/// nothing in it is drawn empty.
/// One turn, in radians.
const _fullTurn = 6.283185307179586;

class _DonutPainter extends CustomPainter {
  const _DonutPainter(this.slices);

  final List<(int, Color)> slices;

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 16.0;
    final rect = Rect.fromCircle(
      center: size.center(Offset.zero),
      radius: (size.shortestSide - stroke) / 2 - 4,
    );
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke;
    final total = slices.fold<int>(0, (sum, s) => sum + (s.$1 < 0 ? 0 : s.$1));
    if (total <= 0) {
      canvas.drawArc(
        rect,
        0,
        _fullTurn,
        false,
        paint..color = const Color(0xFFE8E8EC),
      );
      return;
    }
    var start = -_fullTurn / 4;
    for (final (value, color) in slices) {
      if (value <= 0) continue;
      final sweep = _fullTurn * value / total;
      canvas.drawArc(rect, start, sweep, false, paint..color = color);
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(_DonutPainter old) =>
      old.slices.length != slices.length ||
      [
        for (var i = 0; i < slices.length; i++) old.slices[i] != slices[i],
      ].any((changed) => changed);
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
