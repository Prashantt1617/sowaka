part of 'quick_actions_screen.dart';

// ---------------------------------------------------------------- FBP

/// Takes a photo of a bill with the camera ([_takeProofPhoto]); tests put
/// their own here.
PayrollFilePicker payrollFbpCamera = _takeProofPhoto;

/// Picks a photo of a bill from the gallery ([_chooseProofPhoto]); tests put
/// their own here.
PayrollFilePicker payrollFbpGallery = _chooseProofPhoto;

/// The type the FBP pages are set in (Figma 4473:67946): Sora, with the
/// app's own face behind it for the rupee sign.
TextStyle _fbpType(
  double size, {
  FontWeight weight = FontWeight.w600,
  Color color = const Color(0xFF1F1F22),
  double? height,
  double? letterSpacing,
  String family = 'Sora',
}) => TextStyle(
  fontFamily: family,
  fontFamilyFallback: _soraFallback,
  fontSize: size,
  fontWeight: weight,
  color: color,
  height: height,
  letterSpacing: letterSpacing,
);

const _fbpInk = Color(0xFF1F1F22);
const _fbpMuted = Color(0xFF55555C);
const _fbpAlert = Color(0xFFB42318);
const _fbpDone = Color(0xFF15803D);

/// π, for the donut's arcs (the library does not import dart:math).
const _fbpPi = 3.141592653589793;

/// "2026-27" → "FY 26–27".
String _fbpFyLabel(String fy) =>
    fy.length == 7 ? 'FY ${fy.substring(2, 4)}–${fy.substring(5)}' : 'FY $fy';

/// FBP (Figma 4473:67946, locked 4473:68242): the month's split as a donut,
/// what is left to send, each head with its bills this year, and the way
/// into Change my split — or, once the split is locked for the year, the
/// way to HR.
class _FbpPage extends StatefulWidget {
  const _FbpPage();

  @override
  State<_FbpPage> createState() => _FbpPageState();
}

class _FbpPageState extends State<_FbpPage> {
  FbpPlan? _plan;
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
    setState(() => _error = null);
    try {
      final plan = await _PayrollScope.of(context).api.fetchFbp();
      if (mounted) setState(() => _plan = plan);
    } on PayrollApiException catch (error) {
      if (!mounted) return;
      // A server without the FBP routes yet: the split, as the card opened
      // before there was an FBP page.
      if (error.statusCode == 404 &&
          error.message == PayrollApiException.unavailable) {
        await Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(builder: (_) => const _SplitPage()),
        );
        return;
      }
      setState(() => _error = error.message);
    } catch (error) {
      if (mounted) setState(() => _error = payrollErrorText(error));
    }
  }

  /// Opens a page and reads the FBP again when it closes: a bill sent or a
  /// split saved changes what it shows.
  Future<void> _open(Widget page) async {
    await _pushPayroll<void>(context, page);
    if (mounted) unawaited(_load());
  }

  /// Change my split, then the FBP read again. Closing its success sheet on
  /// "Upload a bill" goes straight to the sheet for the first bill due.
  Future<void> _openSplit() async {
    final done = await _pushPayroll<_SplitDone>(context, const _SplitPage());
    if (!mounted) return;
    await _load();
    if (done == _SplitDone.uploadBill && mounted) await _uploadFirstBill();
  }

  /// The bill sheet for the first head that wants one: this month's if it
  /// can be sent, else the first month that can.
  Future<void> _uploadFirstBill() async {
    final plan = _plan;
    if (plan == null) return;
    final api = _PayrollScope.of(context).api;
    for (final summary in plan.heads.where((h) => h.needsAction > 0)) {
      final FbpHead head;
      try {
        head = await api.fetchFbpHead(summary.code);
      } catch (error) {
        if (mounted) showAppToast(context, payrollErrorText(error));
        return;
      }
      if (!mounted) return;
      final open = head.months.where((m) => m.canUpload).toList();
      if (open.isEmpty) continue;
      final month = open.firstWhere(
        (m) => m.period == plan.period,
        orElse: () => open.first,
      );
      final updated = await _showFbpBillSheet(context, head, month);
      if (updated != null && mounted) {
        showAppToast(context, 'Bill sent for review');
        unawaited(_load());
      }
      return;
    }
  }

  void _raiseTicket(FbpPlan plan) {
    final about =
        'I would like to change my FBP split for ${_fbpFyLabel(plan.fy)}:';
    if (!raiseSupportTicket(about: about)) {
      _PayrollScope.of(context).onRaiseTicket?.call();
    }
  }

  @override
  Widget build(BuildContext context) {
    final plan = _plan;
    return _payrollPage(
      context,
      key: const ValueKey('payroll-fbp-page'),
      title: 'FBP',
      children: [
        if (plan == null && _error == null)
          const _PrLoading()
        else if (plan == null)
          _PrError(_error!, onRetry: _load)
        else if (!plan.available)
          const _HubEmptyState(
            iconAsset: 'assets/icons/action_card_reimbursement_rupee.png',
            text: 'Your salary has no flexible heads to split.',
          )
        else
          ..._body(plan),
      ],
    );
  }

  List<Widget> _body(FbpPlan plan) {
    final heads = [
      for (final head in plan.heads)
        if (head.amountPaise > 0 || head.months > 0) head,
    ];
    final month = payrollMonth(plan.period);
    final unassigned = plan.unassignedPaise ?? 0;
    final todo = [
      if (plan.toUpload > 0)
        '${plan.toUpload} ${plan.toUpload == 1 ? 'bill' : 'bills'} to upload',
      if (plan.toReupload > 0) '${plan.toReupload} to re-upload',
    ];
    final locked = plan.lock.locked;
    // This month's bills date when HR set one; else the FY's last date.
    final dueOn = plan.monthlyDueOn ?? plan.billsDueOn;
    return [
      const _FbpTip(
        'Until a bill is approved, that FBP money is taxed like salary. We '
        'work out your tax every month, so even a late bill gives tax back '
        'over the months left.',
      ),
      if (!locked)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: _FbpSummaryCard(
            title: month == null
                ? 'FBP summary'
                : 'FBP summary · ${_monthName(month.month)}',
            grossPaise: plan.poolPaise ?? plan.assignedPaise,
            slices: [
              for (final (index, head) in heads.indexed)
                if (head.amountPaise > 0)
                  (
                    label: head.name,
                    paise: head.amountPaise,
                    color: _FbpDonutPainter.colorAt(index),
                  ),
              if (unassigned > 0)
                (
                  label: 'Not assigned',
                  paise: unassigned,
                  color: _FbpDonutPainter.unassigned,
                ),
            ],
          ),
        ),
      Padding(
        padding: EdgeInsets.only(top: locked ? 18 : 0, bottom: 10),
        child: Text(
          todo.isEmpty
              ? 'All bills sent for review'
              : [...todo, if (dueOn != null) 'by ${_short(dueOn)}'].join(' · '),
          key: const ValueKey('fbp-todo'),
          style: _fbpType(13.5, color: todo.isEmpty ? _fbpDone : _fbpAlert),
        ),
      ),
      Container(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Expanded(
                  child: Text(
                    _rupees(plan.poolPaise ?? plan.assignedPaise),
                    style: _fbpType(22, weight: FontWeight.w800),
                  ),
                ),
                Text('a month', style: _fbpType(13, color: _fbpMuted)),
              ],
            ),
            Padding(
              padding: const EdgeInsets.only(top: 4, bottom: 6),
              child: Text(
                plan.declaredAt == null
                    ? 'Not declared yet: your salary\'s amounts'
                    : 'Declared in ${_monthName(plan.declaredAt!.month)}',
                style: _fbpType(13, color: _fbpMuted),
              ),
            ),
            for (final (index, head) in heads.indexed)
              _FbpHeadRow(
                key: ValueKey('fbp-head-${head.code}'),
                first: index == 0,
                icon: _FbpHeadIcon(name: head.name),
                name: head.name,
                count: head.needsAction,
                subtitle: head.months == 0
                    ? 'No bills needed yet'
                    : '${head.approved} of ${head.months} bills approved',
                amount: _rupees(head.amountPaise),
                onTap: () =>
                    _open(_FbpHeadPage(code: head.code, name: head.name)),
              ),
            if (unassigned > 0)
              _FbpHeadRow(
                key: const ValueKey('fbp-head-unassigned'),
                first: heads.isEmpty,
                icon: Image.asset(
                  'assets/icons/payroll_fbp_not_assigned.png',
                  width: 24,
                  height: 24,
                  fit: BoxFit.cover,
                ),
                name: 'Not assigned',
                subtitle: 'Paid with salary, taxed in full',
                amount: _rupees(unassigned),
                amountColor: const Color(0xFFB45309),
              ),
            if (locked) ...[
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Container(
                  key: const ValueKey('fbp-split-locked'),
                  height: 46,
                  decoration: BoxDecoration(
                    color: const Color(0xFFEDEDF0),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      SvgPicture.asset(
                        'assets/icons/payroll_fbp_lock.svg',
                        width: 18,
                        height: 18,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Split locked for this FY',
                        style: _fbpType(14.5, color: _fbpMuted),
                      ),
                    ],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: InkWell(
                  key: const ValueKey('fbp-raise-ticket'),
                  onTap: () => _raiseTicket(plan),
                  borderRadius: BorderRadius.circular(8),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 44),
                    child: Center(
                      child: Text(
                        'To change it, raise a ticket',
                        style: _fbpType(13.5, color: _prBlue),
                      ),
                    ),
                  ),
                ),
              ),
            ] else ...[
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Material(
                  color: _prBlue,
                  borderRadius: BorderRadius.circular(12),
                  child: InkWell(
                    key: const ValueKey('fbp-change-split'),
                    onTap: _openSplit,
                    borderRadius: BorderRadius.circular(12),
                    child: SizedBox(
                      height: 46,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            'Change my split',
                            style: _fbpType(15, color: Colors.white),
                          ),
                          const SizedBox(width: 6),
                          SvgPicture.asset(
                            'assets/icons/payroll_fbp_chevron_white.svg',
                            width: 18,
                            height: 18,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              if (plan.lock.closesOn case final closesOn?)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    'You can change your split till ${_short(closesOn)}',
                    textAlign: TextAlign.center,
                    style: _fbpType(12.5, color: const Color(0xFF6B6B72)),
                  ),
                ),
            ],
          ],
        ),
      ),
    ];
  }
}

/// The green line of context on top of the FBP page.
class _FbpTip extends StatelessWidget {
  const _FbpTip(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final style = _fbpType(
      13.5,
      color: const Color(0xFF065F46),
      height: 19.58 / 13.5,
    );
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFECFDF5),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('💡', style: style.copyWith(fontWeight: FontWeight.w400)),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: style)),
        ],
      ),
    );
  }
}

typedef _FbpSlice = ({String label, int paise, Color color});

/// FBP SUMMARY · OCTOBER: the month's split as a donut around the gross,
/// with each head's amount beside it.
class _FbpSummaryCard extends StatelessWidget {
  const _FbpSummaryCard({
    required this.title,
    required this.grossPaise,
    required this.slices,
  });

  final String title;
  final int grossPaise;
  final List<_FbpSlice> slices;

  @override
  Widget build(BuildContext context) => Container(
    key: const ValueKey('fbp-summary'),
    constraints: const BoxConstraints(minHeight: 178),
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
        Text(
          title.toUpperCase(),
          style: _fbpType(
            13,
            color: const Color(0xFF8E8E95),
            letterSpacing: 0.8,
          ),
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            SizedBox(
              width: 108,
              height: 108,
              child: CustomPaint(
                key: const ValueKey('fbp-donut'),
                painter: _FbpDonutPainter([
                  for (final s in slices) (s.paise, s.color),
                ]),
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _rupees(grossPaise),
                        style: _fbpType(
                          11.88,
                          weight: FontWeight.w700,
                          family: 'Plus Jakarta Sans',
                        ),
                      ),
                      Text(
                        'gross',
                        style: _fbpType(
                          9.72,
                          weight: FontWeight.w700,
                          color: const Color(0xFF8E8E95),
                          family: 'Plus Jakarta Sans',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                children: [
                  for (final (index, slice) in slices.indexed) ...[
                    if (index > 0) const SizedBox(height: 9),
                    Row(
                      children: [
                        Container(
                          width: 9,
                          height: 9,
                          decoration: BoxDecoration(
                            color: slice.color,
                            borderRadius: BorderRadius.circular(3),
                          ),
                        ),
                        const SizedBox(width: 7),
                        Expanded(
                          child: Text(
                            slice.label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: _fbpType(
                              12.5,
                              color: _fbpMuted,
                              family: 'Plus Jakarta Sans',
                            ),
                          ),
                        ),
                        Text(
                          _rupees(slice.paise),
                          style: _fbpType(
                            13,
                            weight: FontWeight.w700,
                            family: 'Plus Jakarta Sans',
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

/// The month's split as a ring: one arc per head, clockwise from the top in
/// the legend's order, the part not assigned last.
class _FbpDonutPainter extends CustomPainter {
  const _FbpDonutPainter(this.slices);

  final List<(int, Color)> slices;

  static const _palette = [
    Color(0xFF0571A6),
    Color(0xFF6FB4F8),
    Color(0xFFBBDDFC),
    Color(0xFF3A8FC4),
    Color(0xFF9CCBFA),
    Color(0xFF0B4F75),
  ];
  static const unassigned = Color(0xFFFF5A5F);

  static Color colorAt(int index) => _palette[index % _palette.length];

  /// The ring's outer diameter and width, as drawn in the 108-wide tile.
  static const _diameter = 97.0;
  static const _width = 14.5;

  @override
  void paint(Canvas canvas, Size size) {
    final radius = _diameter / 2 - _width / 2;
    final rect = Rect.fromCircle(
      center: size.center(Offset.zero),
      radius: radius,
    );
    final total = slices.fold<int>(0, (sum, s) => sum + s.$1);
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = _width
      ..strokeCap = StrokeCap.butt;
    if (total <= 0) {
      canvas.drawArc(
        rect,
        0,
        2 * _fbpPi,
        false,
        paint..color = const Color(0xFFEDEDF0),
      );
      return;
    }
    var start = -_fbpPi / 2;
    for (final (paise, color) in slices) {
      if (paise <= 0) continue;
      final sweep = 2 * _fbpPi * paise / total;
      canvas.drawArc(rect, start, sweep, false, paint..color = color);
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(_FbpDonutPainter old) =>
      old.slices.length != slices.length ||
      [
        for (var i = 0; i < slices.length; i++) old.slices[i] != slices[i],
      ].any((changed) => changed);
}

/// A head's picture, as the design draws it: the fuel pump and the globe as
/// emoji, the phone as a picture; any other head its claim picture.
class _FbpHeadIcon extends StatelessWidget {
  const _FbpHeadIcon({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final n = name.toLowerCase();
    bool any(List<String> words) => words.any(n.contains);
    final emoji = any(['fuel', 'vehicle', 'petrol', 'conveyance', 'car '])
        ? '⛽'
        : any(['internet', 'broadband', 'wifi', 'wi-fi'])
        ? '🌐'
        : null;
    if (emoji != null) {
      return Text(
        emoji,
        style: const TextStyle(fontSize: 20, height: 1, color: _fbpInk),
      );
    }
    if (any(['phone', 'mobile', 'telephone'])) {
      // The picture is drawn a little larger than its tile and cropped.
      return SizedBox(
        width: 24,
        height: 24,
        child: ClipRect(
          child: OverflowBox(
            maxWidth: 24 * 1.1068,
            maxHeight: 24 * 1.1068,
            child: Image.asset(
              'assets/icons/payroll_fbp_telephone.png',
              width: 24 * 1.1068,
              height: 24 * 1.1068,
              fit: BoxFit.cover,
            ),
          ),
        ),
      );
    }
    return Image.asset(
      _claimCategoryIcon(name),
      width: 24,
      height: 24,
      fit: BoxFit.cover,
    );
  }
}

/// One head on the FBP card: its picture, name and the bills still to send,
/// how many are approved, this month's amount, and the way into its bills.
class _FbpHeadRow extends StatelessWidget {
  const _FbpHeadRow({
    super.key,
    required this.first,
    required this.icon,
    required this.name,
    required this.subtitle,
    required this.amount,
    this.count = 0,
    this.amountColor = _fbpInk,
    this.onTap,
  });

  final bool first;
  final Widget icon;
  final String name;
  final String subtitle;
  final String amount;
  final int count;
  final Color amountColor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final row = Container(
      padding: EdgeInsets.only(top: first ? 14 : 15, bottom: 14),
      decoration: first
          ? null
          : const BoxDecoration(
              border: Border(top: BorderSide(color: Color(0xFFF1F1F4))),
            ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(11),
              border: Border.all(color: const Color(0xFFF0F0F2)),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x0F000000),
                  blurRadius: 3,
                  offset: Offset(0, 2),
                ),
              ],
            ),
            child: icon,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: _fbpType(15, weight: FontWeight.w700),
                      ),
                    ),
                    if (count > 0)
                      Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: Container(
                          key: const ValueKey('fbp-head-count'),
                          height: 20,
                          constraints: const BoxConstraints(minWidth: 20),
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: const Color(0xFFFF3B30),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            '$count',
                            style: _fbpType(
                              11,
                              weight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(subtitle, style: _fbpType(12.5, color: _fbpMuted)),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Text(
            amount,
            style: _fbpType(14.5, weight: FontWeight.w700, color: amountColor),
          ),
          // The chevron's own artwork sits inset, so the gap reads as 12.
          const SizedBox(width: 8),
          SizedBox(
            width: 18,
            child: onTap == null
                ? null
                : SvgPicture.asset(
                    'assets/icons/payroll_fbp_chevron.svg',
                    width: 18,
                    height: 18,
                  ),
          ),
        ],
      ),
    );
    return onTap == null ? row : InkWell(onTap: onTap, child: row);
  }
}

// ---------------------------------------------------------------- a head

/// A head's bills (Figma 4506:23098): every month from April to this one,
/// each approved, in review, rejected with HR's reason, or still to upload.
class _FbpHeadPage extends StatefulWidget {
  const _FbpHeadPage({required this.code, required this.name});

  final String code;
  final String name;

  @override
  State<_FbpHeadPage> createState() => _FbpHeadPageState();
}

class _FbpHeadPageState extends State<_FbpHeadPage> {
  FbpHead? _head;
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
    setState(() => _error = null);
    try {
      final head = await _PayrollScope.of(
        context,
      ).api.fetchFbpHead(widget.code);
      if (mounted) setState(() => _head = head);
    } catch (error) {
      if (mounted) setState(() => _error = payrollErrorText(error));
    }
  }

  Future<void> _upload(FbpHead head, FbpMonth month) async {
    final updated = await _showFbpBillSheet(context, head, month);
    if (updated == null || !mounted) return;
    setState(() => _head = updated);
    showAppToast(context, 'Bill sent for review');
  }

  @override
  Widget build(BuildContext context) {
    final head = _head;
    return _payrollPage(
      context,
      key: ValueKey('payroll-fbp-head-${widget.code}'),
      title: head?.name ?? widget.name,
      children: [
        if (head == null && _error == null)
          const _PrLoading()
        else if (head == null)
          _PrError(_error!, onRetry: _load)
        else ...[
          Padding(
            padding: const EdgeInsets.only(bottom: 15),
            child: Text(
              '${_rupees(head.amountPaise)} a month · ${_fbpFyLabel(head.fy)}',
              style: _fbpType(
                14,
                weight: FontWeight.w400,
                color: const Color(0xFF717171),
                height: 16.2 / 14,
                letterSpacing: -0.16,
              ),
            ),
          ),
          if (head.uploadsBlocked case final blocked?) ...[
            _PrNote(blocked),
            if (mentionsHrOrSupport(blocked)) RaiseTicketLink(about: blocked),
            const SizedBox(height: 12),
          ],
          if (head.months.isEmpty)
            const _HubEmptyState(
              iconAsset: 'assets/icons/action_card_reimbursement_money.png',
              text: 'No bills are needed for this head yet.',
            )
          else
            ClipRRect(
              borderRadius: BorderRadius.circular(18),
              child: ColoredBox(
                color: Colors.white,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final (index, month) in head.months.indexed)
                      _FbpMonthRow(
                        key: ValueKey('fbp-month-${month.period}'),
                        month: month,
                        // No line under the last month, nor above a
                        // rejected one (its own tint sets it apart).
                        divider:
                            index < head.months.length - 1 &&
                            month.status != FbpBillStatus.rejected &&
                            head.months[index + 1].status !=
                                FbpBillStatus.rejected,
                        onUpload: () => _upload(head, month),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ],
    );
  }
}

class _FbpMonthRow extends StatelessWidget {
  const _FbpMonthRow({
    super.key,
    required this.month,
    required this.divider,
    required this.onUpload,
  });

  final FbpMonth month;
  final bool divider;
  final VoidCallback onUpload;

  static final _title = _fbpType(
    14,
    color: const Color(0xFF222222),
    height: 16.2 / 14,
    letterSpacing: -0.16,
  );
  static final _sub = _fbpType(
    12,
    weight: FontWeight.w400,
    color: const Color(0xFF717171),
    height: 16.2 / 12,
    letterSpacing: -0.16,
  );

  @override
  Widget build(BuildContext context) {
    final rejected = month.status == FbpBillStatus.rejected;
    final bill = month.bill;
    final subtitle = switch (month.status) {
      FbpBillStatus.rejected => [
        if (bill?.uploadedAt case final at?) 'Uploaded ${_short(at)}',
        if (bill?.decidedAt case final at?) 'rejected ${_short(at)}',
      ].join(' · '),
      FbpBillStatus.notUploaded =>
        '${_rupees(month.amountPaise)} taxed until uploaded',
      _ => _rupees(month.amountPaise),
    };
    final trailing = switch (month.status) {
      FbpBillStatus.approved => const _PrPill(
        'Approved',
        color: Color(0xFF008A58),
        tint: Color(0xFFE6F7ED),
      ),
      FbpBillStatus.inReview => const _PrPill(
        'In review',
        color: Color(0xFFA05A00),
        tint: Color(0xFFFFF3C7),
      ),
      FbpBillStatus.rejected => const _PrPill(
        'Rejected',
        color: Color(0xFFC62A2A),
        tint: Color(0xFFFDECEE),
      ),
      FbpBillStatus.notUploaded when month.canUpload => _FbpOutlineButton(
        key: ValueKey('fbp-upload-${month.period}'),
        label: 'Upload',
        onTap: onUpload,
        height: 37,
        width: 77,
        style: _fbpType(
          12,
          color: _prBlue,
          height: 16.2 / 12,
          letterSpacing: -0.16,
        ),
      ),
      FbpBillStatus.notUploaded => const _PrPill(
        'Not uploaded',
        color: Color(0xFF6B7280),
        tint: Color(0xFFF3F4F6),
      ),
    };
    final details = Row(
      children: [
        Expanded(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_periodLabel(month.period), style: _title),
              const SizedBox(height: 3),
              Text(subtitle, style: _sub),
            ],
          ),
        ),
        const SizedBox(width: 8),
        trailing,
      ],
    );
    if (!rejected) {
      return Container(
        height: 64,
        padding: const EdgeInsets.only(left: 16, right: 12),
        decoration: divider
            ? const BoxDecoration(
                border: Border(bottom: BorderSide(color: Color(0xFFF1F1F3))),
              )
            : null,
        child: details,
      );
    }
    return Container(
      color: const Color(0xFFFFF7F7),
      padding: const EdgeInsets.fromLTRB(16, 13, 12, 13),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          details,
          if (bill?.reason case final reason?) ...[
            const SizedBox(height: 10),
            Text(
              reason,
              key: ValueKey('fbp-reason-${month.period}'),
              style: _fbpType(
                12,
                weight: FontWeight.w400,
                color: const Color(0xFFC62A2A),
                height: 19 / 12,
              ),
            ),
          ],
          if (month.canUpload) ...[
            const SizedBox(height: 10),
            Material(
              color: _prBlue,
              borderRadius: BorderRadius.circular(11),
              child: InkWell(
                key: ValueKey('fbp-reupload-${month.period}'),
                onTap: onUpload,
                borderRadius: BorderRadius.circular(11),
                child: SizedBox(
                  height: 43,
                  child: Center(
                    child: Text(
                      'Re-upload bill',
                      style: _fbpType(
                        13,
                        weight: FontWeight.w400,
                        color: Colors.white,
                        height: 18 / 13,
                        letterSpacing: -0.16,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The design's outline button: brand blue on white, a little rounded.
class _FbpOutlineButton extends StatelessWidget {
  const _FbpOutlineButton({
    super.key,
    required this.label,
    required this.onTap,
    required this.height,
    required this.style,
    this.width,
  });

  final String label;
  final VoidCallback? onTap;
  final double height;
  final double? width;
  final TextStyle style;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(11),
      side: const BorderSide(color: _prBlue),
    ),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(11),
      child: SizedBox(
        height: height,
        width: width,
        child: Center(child: Text(label, style: style)),
      ),
    ),
  );
}

// ---------------------------------------------------------------- the bill sheet

/// Opens the bill sheet for [month] of [head]; the head as it then stands
/// once a bill was sent, else null.
Future<FbpHead?> _showFbpBillSheet(
  BuildContext context,
  FbpHead head,
  FbpMonth month,
) {
  final scope = _PayrollScope.of(context);
  return showModalBottomSheet<FbpHead>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _FbpBillSheet(
      head: head,
      month: month,
      api: scope.api,
      pickFile: scope.pickFile ?? _pickProofFile,
      takePhoto: payrollFbpCamera,
      choosePhoto: payrollFbpGallery,
    ),
  );
}

/// Upload / Re-upload a month's bill (the design canvas's HF4a sheet, in
/// the frame of Figma 4567:25245): "Upload fuel bill" and the month, the
/// amount on the bill (the month's amount to start), the bill as a photo or
/// PDF, and Submit for review once a file is attached.
class _FbpBillSheet extends StatefulWidget {
  const _FbpBillSheet({
    required this.head,
    required this.month,
    required this.api,
    required this.pickFile,
    required this.takePhoto,
    required this.choosePhoto,
  });

  final FbpHead head;
  final FbpMonth month;
  final PayrollApiService api;
  final PayrollFilePicker pickFile;
  final PayrollFilePicker takePhoto;
  final PayrollFilePicker choosePhoto;

  @override
  State<_FbpBillSheet> createState() => _FbpBillSheetState();
}

class _FbpBillSheetState extends State<_FbpBillSheet> {
  late final _amount = TextEditingController(
    text: _RupeeInputFormatter.format((widget.month.amountPaise / 100).round()),
  )..addListener(() => setState(() {}));
  PayrollUpload? _file;
  bool _busy = false;
  String? _error;

  static const _edge = Color(0xFFE3E3E8);
  static const _ink = Color(0xFF1F1F22);
  static const _grey = Color(0xFF6B6B72);

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  int get _amountPaise => _RupeeInputFormatter.parse(_amount.text) * 100;

  /// "fuel" for the Fuel bill type; the head's own name without one.
  String get _what => (widget.head.billType ?? widget.head.name).toLowerCase();

  TextStyle _type(
    double size, {
    FontWeight weight = FontWeight.w600,
    Color color = _ink,
    double? height,
  }) => _fbpType(
    size,
    weight: weight,
    color: color,
    height: height,
    family: 'Plus Jakarta Sans',
  );

  Future<void> _pick(PayrollFilePicker picker) async {
    if (_busy) return;
    final file = await picker(context);
    if (file != null && mounted) {
      setState(() {
        _file = file;
        _error = null;
      });
    }
  }

  Future<void> _submit() async {
    final file = _file;
    if (file == null || _amountPaise <= 0 || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final navigator = Navigator.of(context);
    try {
      final updated = await widget.api.uploadFbpBill(
        code: widget.head.code,
        period: widget.month.period,
        file: file,
        amountPaise: _amountPaise,
      );
      if (mounted) navigator.pop(updated);
    } catch (error) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = payrollErrorText(error);
        });
      }
    }
  }

  Widget _round(
    IconData icon,
    String tooltip,
    VoidCallback? onTap, {
    double size = 40,
    Color color = const Color(0xFFEDEDF0),
  }) => Tooltip(
    message: tooltip,
    child: Material(
      color: color,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: SizedBox(
          width: size,
          height: size,
          child: Icon(icon, size: 18, color: const Color(0xFF3A3A3F)),
        ),
      ),
    ),
  );

  Widget _sourceButton(String label, Key key, PayrollFilePicker picker) =>
      Expanded(
        child: Material(
          color: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: _prBlue, width: 1.5),
          ),
          child: InkWell(
            key: key,
            onTap: _busy ? null : () => _pick(picker),
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              height: 44,
              child: Center(
                child: Text(label, style: _type(14, color: _prBlue)),
              ),
            ),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final file = _file;
    final ready = file != null && _amountPaise > 0 && !_busy;
    final rejected = widget.month.status == FbpBillStatus.rejected;
    final extension = file == null || !file.name.contains('.')
        ? ''
        : file.name.split('.').last.toUpperCase();
    final box = BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: _edge, width: 1.5),
    );
    return Container(
      key: const ValueKey('fbp-bill-sheet'),
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.92,
      ),
      decoration: const BoxDecoration(
        color: Color(0xFFF6F6F8),
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      padding: EdgeInsets.fromLTRB(
        18,
        12,
        18,
        26 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 44,
                  height: 5,
                  decoration: BoxDecoration(
                    color: const Color(0xFFDCDCE1),
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${rejected ? 'Re-upload' : 'Upload'} $_what bill',
                      style: _type(20),
                    ),
                  ),
                  _round(
                    Icons.close_rounded,
                    'Close',
                    _busy ? null : () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                _periodLabel(widget.month.period),
                style: _type(16, weight: FontWeight.w400, color: _grey),
              ),
              const SizedBox(height: 18),
              Text('Amount on bill', style: _type(15)),
              const SizedBox(height: 8),
              TextField(
                key: const ValueKey('fbp-bill-amount'),
                controller: _amount,
                enabled: !_busy,
                keyboardType: TextInputType.number,
                inputFormatters: const [_RupeeInputFormatter()],
                style: _type(16),
                decoration: InputDecoration(
                  hintText: '₹0',
                  isDense: true,
                  filled: true,
                  fillColor: Colors.white,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 14,
                  ),
                  border: _inputEdge(_edge),
                  enabledBorder: _inputEdge(_edge),
                  disabledBorder: _inputEdge(_edge),
                  focusedBorder: _inputEdge(_prBlue),
                ),
              ),
              const SizedBox(height: 16),
              Text('Bill', style: _type(15)),
              const SizedBox(height: 8),
              if (file == null)
                CustomPaint(
                  key: const ValueKey('fbp-bill-drop'),
                  foregroundPainter: const _DashedRoundRectPainter(
                    color: Color(0xFFC8C8CE),
                    radius: 14,
                  ),
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Column(
                      children: [
                        Text(
                          'Add a photo or PDF. Make sure the total and date '
                          'can be read.',
                          textAlign: TextAlign.center,
                          style: _type(
                            13,
                            weight: FontWeight.w500,
                            color: _fbpMuted,
                            height: 1.4,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            _sourceButton(
                              'Take photo',
                              const ValueKey('fbp-bill-take-photo'),
                              widget.takePhoto,
                            ),
                            const SizedBox(width: 8),
                            _sourceButton(
                              'Gallery',
                              const ValueKey('fbp-bill-gallery'),
                              widget.choosePhoto,
                            ),
                            const SizedBox(width: 8),
                            _sourceButton(
                              'Choose file',
                              const ValueKey('fbp-bill-pick'),
                              widget.pickFile,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                )
              else
                Container(
                  key: const ValueKey('fbp-bill-file'),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  decoration: box,
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 48,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: const Color(0xFFFDECEC),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          extension.isEmpty ? 'FILE' : extension,
                          style: _type(
                            10,
                            weight: FontWeight.w800,
                            color: _fbpAlert,
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              file.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: _type(14, weight: FontWeight.w700),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '${(file.size / 1024).ceil()} KB',
                              style: _type(
                                12,
                                weight: FontWeight.w500,
                                color: _grey,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      _round(
                        Icons.close_rounded,
                        'Remove file',
                        _busy ? null : () => setState(() => _file = null),
                        size: 36,
                        color: const Color(0xFFF2F2F4),
                      ),
                    ],
                  ),
                ),
              if (_error case final error?) ...[
                const SizedBox(height: 12),
                Text(
                  error,
                  key: const ValueKey('fbp-bill-error'),
                  style: _type(13, color: _prError),
                ),
                if (mentionsHrOrSupport(error)) RaiseTicketLink(about: error),
              ],
              const SizedBox(height: 22),
              Semantics(
                button: true,
                enabled: ready,
                label: 'Submit for review',
                child: Material(
                  color: ready || _busy ? _prBlue : const Color(0xFFE4E4E7),
                  borderRadius: BorderRadius.circular(16),
                  child: InkWell(
                    key: const ValueKey('fbp-bill-submit'),
                    onTap: ready ? _submit : null,
                    borderRadius: BorderRadius.circular(16),
                    child: SizedBox(
                      height: 56,
                      child: Center(
                        child: _busy
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
                                  'Submit for review',
                                  style: _type(
                                    16,
                                    weight: FontWeight.w700,
                                    color: ready
                                        ? Colors.white
                                        : const Color(0xFF8E8E95),
                                  ),
                                ),
                              ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static OutlineInputBorder _inputEdge(Color color) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(14),
    borderSide: BorderSide(color: color, width: 1.5),
  );
}
