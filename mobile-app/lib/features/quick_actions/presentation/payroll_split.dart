part of 'quick_actions_screen.dart';

// ---------------------------------------------------------------- split

// Change my split (Figma 4473:68656, canvas HF4b) and its Review (4506:22931,
// canvas HF4c), as the designs set them: Sora throughout, the rupee sign from
// the app's own face. The words and states follow the canvas where it and
// Figma differ (the title, the footer's "All set" / "over", the success
// sheet); the colours are the brand's from Figma.

/// How the split flow ended, once the split is saved: what the person picked
/// on the success sheet. `_SplitPage` pops with it (null when nothing was
/// saved), so the FBP page that opened it can go on to a bill upload.
enum _SplitDone { uploadBill, backToFbp }

const _splitInk = Color(0xFF1F1F22);
const _splitMuted = Color(0xFF7A7A82);
const _splitFooterInk = Color(0xFF55555C);
const _splitOff = Color(0xFFC8C8CE);
const _splitCtaOff = Color(0xFFA9CDF2);
const _splitOver = Color(0xFFB42318);

TextStyle _splitText(
  double size,
  FontWeight weight, {
  Color color = _splitInk,
  double? height,
  double? letterSpacing,
}) => TextStyle(
  fontFamily: 'Sora',
  fontFamilyFallback: _soraFallback,
  color: color,
  fontSize: size,
  height: height,
  letterSpacing: letterSpacing,
  fontWeight: weight,
);

/// The emoji a flexible head is drawn with in the designs (⛽ 🌐 📱 📚 ✈️),
/// found from the name HR gave it so a renamed head keeps its picture. A
/// head the designs have no picture for gets a receipt.
String _splitHeadEmoji(String name) {
  final n = name.toLowerCase();
  bool any(List<String> words) => words.any(n.contains);
  if (any(['fuel', 'vehicle', 'petrol', 'car ', 'conveyance'])) return '⛽';
  if (any(['internet', 'broadband', 'wifi', 'wi-fi', 'data'])) return '🌐';
  if (any(['telephone', 'phone', 'mobile'])) return '📱';
  if (any(['book', 'periodical', 'newspaper', 'magazine'])) return '📚';
  if (any(['leave travel', 'lta', 'travel'])) return '✈️';
  if (any(['meal', 'food'])) return '🍽️';
  if (any(['gift'])) return '🎁';
  if (any(['uniform', 'dress'])) return '👔';
  if (any(['medical', 'health'])) return '🩺';
  if (any(['education', 'child', 'tuition'])) return '🎓';
  return '🧾';
}

/// "Nov to Mar 2027": the months a split runs. A split never leaves its
/// financial year, so the first month needs no year of its own.
String _splitMonths(DateTime? from, DateTime? to) {
  if (from == null) return '';
  if (to == null) return '${_shortMonthName(from.month)} ${from.year}';
  if (to.year == from.year && to.month == from.month) {
    return '${_shortMonthName(to.month)} ${to.year}';
  }
  return '${_shortMonthName(from.month)} to '
      '${_shortMonthName(to.month)} ${to.year}';
}

/// Change my split: each flexible head's share of the monthly pool, within
/// its limit, moved by the step HR set. Pops with a [_SplitDone] once the
/// split is saved.
class _SplitPage extends StatefulWidget {
  const _SplitPage();

  @override
  State<_SplitPage> createState() => _SplitPageState();
}

class _SplitPageState extends State<_SplitPage> {
  FbpSplit? _split;
  String? _error;
  final Map<String, int> _amounts = {};
  bool _busy = false;
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
      final split = await _PayrollScope.of(context).api.fetchSplit();
      if (!mounted) return;
      setState(() {
        _split = split;
        _amounts
          ..clear()
          ..addAll({for (final c in split.components) c.code: c.amountPaise});
      });
    } catch (error) {
      if (mounted) setState(() => _error = payrollErrorText(error));
    }
  }

  int get _total => _amounts.values.fold(0, (sum, value) => sum + value);

  bool get _changed =>
      _split?.components.any((c) => _amounts[c.code] != c.amountPaise) ?? false;

  Future<void> _review() async {
    final split = _split;
    if (split == null || _busy) return;
    setState(() => _busy = true);
    try {
      final amounts = Map<String, int>.of(_amounts);
      final review = await _PayrollScope.of(context).api.reviewSplit(amounts);
      if (!mounted) return;
      final done = await _pushPayroll<_SplitDone>(
        context,
        _SplitReviewPage(review: review, amounts: amounts),
      );
      // Saved: this page is done too; whoever opened it hears what was picked.
      if (done != null && mounted) Navigator.of(context).pop(done);
    } on PayrollApiException catch (error) {
      if (!mounted) return;
      showAppToast(context, error.message);
      // Locked since the page opened: read it again so it shows the lock.
      if (error.isSplitLocked) unawaited(_load());
    } catch (error) {
      if (mounted) showAppToast(context, payrollErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final split = _split;
    final ready = split != null && split.available;
    final editable = split?.editable ?? false;
    final left = (split?.poolPaise ?? 0) - _total;
    return _payrollPage(
      context,
      key: const ValueKey('payroll-split'),
      title: 'Change my split',
      // Locked for the FY: the lock and the way to HR stand in for Submit.
      footer: !ready || split.lockedForFy
          ? null
          : _SplitFooter(
              totalPaise: _total,
              poolPaise: split.poolPaise,
              enabled: editable && _changed && left >= 0,
              busy: _busy,
              onSubmit: _review,
            ),
      children: [
        if (split == null && _error == null)
          const _PrLoading()
        else if (split == null)
          _PrError(_error!, onRetry: _load)
        else if (!split.available)
          const _HubEmptyState(
            iconAsset: 'assets/icons/action_card_reimbursement_rupee.png',
            text: 'Your salary has no flexible heads to split.',
          )
        else ...[
          if (split.lockedForFy) ...[
            const KeyedSubtree(
              key: ValueKey('split-locked'),
              child: _PrNote(_splitLockedForFy),
            ),
            const _SplitTicketLink(about: _splitTicketAbout),
            const SizedBox(height: 12),
          ] else if (split.notConfigured) ...[
            const _PrNote(_splitNotSetUp),
            const RaiseTicketLink(about: _splitNotSetUp),
            const SizedBox(height: 12),
          ] else if (!split.window.open) ...[
            _PrNote(
              split.window.reason ?? 'Your split can\'t be changed right now.',
            ),
            const SizedBox(height: 12),
          ],
          for (final component in split.components) ...[
            _SplitHeadCard(
              component: component,
              amount: _amounts[component.code] ?? 0,
              enabled: editable,
              onChanged: (value) =>
                  setState(() => _amounts[component.code] = value),
            ),
            const SizedBox(height: 10),
          ],
          const SizedBox(height: 8),
        ],
      ],
    );
  }
}

const _splitLockedForFy =
    'Your split is locked for this FY. To change it, raise a ticket.';

const _splitTicketAbout = 'I would like to change my FBP split:';

/// "To change it, raise a ticket": the Support Desk with [about] filled in,
/// or the desk the Payroll pages were given when nothing else can open it.
class _SplitTicketLink extends StatelessWidget {
  const _SplitTicketLink({required this.about});

  final String about;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerLeft,
    child: InkWell(
      key: const ValueKey('split-raise-ticket'),
      borderRadius: BorderRadius.circular(8),
      onTap: () {
        if (!raiseSupportTicket(about: about)) {
          _PayrollScope.of(context).onRaiseTicket?.call();
        }
      },
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 44),
        child: Align(
          alignment: Alignment.centerLeft,
          widthFactor: 1,
          child: Text(
            'To change it, raise a ticket',
            style: _splitText(13.5, FontWeight.w600, color: _prBlue),
          ),
        ),
      ),
    ),
  );
}

const _splitNotSetUp =
    'HR hasn\'t finished setting up the flexible split yet, so it can\'t be '
    'changed now. Ask HR.';

/// The sticky footer: how much of the pool is assigned, what is left, and
/// the way on to Review.
class _SplitFooter extends StatelessWidget {
  const _SplitFooter({
    required this.totalPaise,
    required this.poolPaise,
    required this.enabled,
    required this.busy,
    required this.onSubmit,
  });

  final int totalPaise;
  final int poolPaise;
  final bool enabled;
  final bool busy;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final left = poolPaise - totalPaise;
    final base = _splitText(12.5, FontWeight.w600, color: _splitFooterInk);
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Color(0xFFEDEDF0))),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 13, 16, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text.rich(
                key: const ValueKey('split-total'),
                TextSpan(
                  style: base,
                  children: [
                    TextSpan(
                      text:
                          '${_rupees(totalPaise)} of '
                          '${_rupees(poolPaise)} assigned · ',
                    ),
                    TextSpan(
                      text: left == 0
                          ? 'All set'
                          : left > 0
                          ? '${_rupees(left)} left'
                          : '${_rupees(-left)} over',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: left < 0 ? _splitOver : _splitFooterInk,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              _SplitCta(
                key: const ValueKey('split-submit-split'),
                label: 'Submit Split',
                chevron: true,
                enabled: enabled,
                busy: busy,
                onTap: onSubmit,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The designs' full-width blue button: 46 high, corners of 12, a pale blue
/// until it can be pressed.
class _SplitCta extends StatelessWidget {
  const _SplitCta({
    super.key,
    required this.label,
    required this.enabled,
    required this.onTap,
    this.busy = false,
    this.chevron = false,
  });

  final String label;
  final bool enabled;
  final bool busy;
  final bool chevron;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final live = enabled || busy;
    return Semantics(
      button: true,
      enabled: enabled && !busy,
      label: label,
      child: Material(
        color: live ? _prBlue : _splitCtaOff,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: enabled && !busy ? onTap : null,
          borderRadius: BorderRadius.circular(12),
          child: SizedBox(
            height: 46,
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
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            label,
                            style: _splitText(
                              15,
                              FontWeight.w600,
                              color: Colors.white,
                            ),
                          ),
                          if (chevron) ...[
                            const SizedBox(width: 6),
                            SvgPicture.asset(
                              'assets/icons/payroll_split_chevron.svg',
                              width: 18,
                              height: 18,
                            ),
                          ],
                        ],
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The emoji in its white tile, as the head cards show it.
class _SplitEmojiTile extends StatelessWidget {
  const _SplitEmojiTile(this.emoji);

  final String emoji;

  @override
  Widget build(BuildContext context) => Container(
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
    child: ExcludeSemantics(
      child: Text(emoji, style: _splitText(20, FontWeight.w400, height: 1)),
    ),
  );
}

class _SplitHeadCard extends StatelessWidget {
  const _SplitHeadCard({
    required this.component,
    required this.amount,
    required this.enabled,
    required this.onChanged,
  });

  final FbpComponent component;
  final int amount;
  final bool enabled;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final step = component.stepPaise;
    final limit = component.limitPaise;
    // Without a step from HR the steppers stay off (the page says why).
    final canLower = enabled && step > 0 && amount > 0;
    final canRaise = enabled && step > 0 && amount < limit;
    // To the step before or after, so an odd amount lands back on the steps;
    // never below nothing or past the head's limit.
    int lower() => (((amount - 1) ~/ step) * step).clamp(0, limit);
    int raise() => ((amount ~/ step + 1) * step).clamp(0, limit);
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              _SplitEmojiTile(_splitHeadEmoji(component.name)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      component.name,
                      style: _splitText(15, FontWeight.w700),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Max ${_rupees(limit)}',
                      style: _splitText(
                        12,
                        FontWeight.w600,
                        color: _splitMuted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              color: const Color(0xFFF7F7F9),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                _StepButton(
                  key: ValueKey('split-minus-${component.code}'),
                  glyph: '−',
                  label: 'Lower ${component.name}',
                  onTap: canLower ? () => onChanged(lower()) : null,
                ),
                Expanded(
                  child: Text(
                    _rupees(amount),
                    key: ValueKey('split-amount-${component.code}'),
                    textAlign: TextAlign.center,
                    style: _splitText(17, FontWeight.w800),
                  ),
                ),
                _StepButton(
                  key: ValueKey('split-plus-${component.code}'),
                  glyph: '+',
                  label: 'Raise ${component.name}',
                  onTap: canRaise ? () => onChanged(raise()) : null,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({
    super.key,
    required this.glyph,
    required this.label,
    required this.onTap,
  });

  final String glyph;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    enabled: onTap != null,
    label: label,
    child: DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F000000),
            blurRadius: 1,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: SizedBox(
            width: 40,
            height: 40,
            child: Center(
              child: ExcludeSemantics(
                child: Text(
                  glyph,
                  style: _splitText(
                    20,
                    FontWeight.w600,
                    color: onTap == null ? _splitOff : _prBlue,
                    height: 1,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/// Review: the split as the server worked it out, receipt-style, the tax it
/// saves, and the promise to keep the bills, before it is sent.
class _SplitReviewPage extends StatefulWidget {
  const _SplitReviewPage({required this.review, required this.amounts});

  final FbpReview review;
  final Map<String, int> amounts;

  @override
  State<_SplitReviewPage> createState() => _SplitReviewPageState();
}

class _SplitReviewPageState extends State<_SplitReviewPage> {
  late FbpReview _review = widget.review;
  bool _agreed = false;
  bool _busy = false;

  Future<void> _submit() async {
    if (!_agreed || _busy) return;
    setState(() => _busy = true);
    final review = _review;
    final api = _PayrollScope.of(context).api;
    try {
      await api.saveSplit(widget.amounts, effectiveFrom: review.effectiveFrom);
      if (!mounted) return;
      // Saved: the success sheet says so and offers the way on. Swiped away,
      // it goes back to FBP.
      final choice = await showModalBottomSheet<_SplitDone>(
        context: context,
        backgroundColor: Colors.transparent,
        barrierColor: const Color(0x73141418),
        isScrollControlled: true,
        builder: (_) => _SplitDoneSheet(review: review),
      );
      if (!mounted) return;
      Navigator.of(context).pop(choice ?? _SplitDone.backToFbp);
    } on PayrollApiException catch (error) {
      if (!mounted) return;
      // Locked for the FY since the review: say so (the server's words),
      // nothing to review again.
      if (!error.isConflict || error.isSplitLocked) {
        setState(() => _busy = false);
        showAppToast(context, error.message);
        return;
      }
      // The month it would start from has moved on since the review: say
      // so, and show the split again for the new window before it is sent.
      showAppToast(context, PayrollApiException.windowMoved);
      try {
        final fresh = await api.reviewSplit(widget.amounts);
        if (!mounted) return;
        setState(() {
          _review = fresh;
          _agreed = false;
        });
      } catch (again) {
        if (mounted) showAppToast(context, payrollErrorText(again));
      } finally {
        if (mounted) setState(() => _busy = false);
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      showAppToast(context, payrollErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final review = _review;
    final saving = review.monthlyTaxSavingPaise ?? 0;
    final billsBy = review.billsDueOn;
    final closesOn = review.closesOn;
    return _payrollPage(
      context,
      key: const ValueKey('payroll-split-review'),
      title: 'Review',
      children: [
        _SplitReceipt(review: review),
        if (saving > 0) ...[
          const SizedBox(height: 14),
          _SplitSavingNote(savingPaise: saving),
        ],
        const SizedBox(height: 14),
        _SplitAgreement(
          agreed: _agreed,
          billsBy: billsBy,
          onChanged: (value) => setState(() => _agreed = value),
        ),
        if (closesOn != null) ...[
          const SizedBox(height: 8),
          Text(
            'You can change this again until ${_short(closesOn)}.',
            key: const ValueKey('split-closes'),
            textAlign: TextAlign.center,
            style: _splitText(
              12,
              FontWeight.w600,
              color: _splitMuted,
              height: 17.4 / 12,
            ),
          ),
        ],
        const SizedBox(height: 12),
        _SplitCta(
          key: const ValueKey('split-submit-declaration'),
          label: 'Submit declaration',
          enabled: _agreed,
          busy: _busy,
          onTap: _submit,
        ),
        const SizedBox(height: 8),
      ],
    );
  }
}

/// The new split as a receipt: the months it runs, each head with what
/// changed, the total, and a torn edge.
class _SplitReceipt extends StatelessWidget {
  const _SplitReceipt({required this.review});

  final FbpReview review;

  @override
  Widget build(BuildContext context) {
    final span = _splitMonths(review.effectiveFrom, review.effectiveTo);
    Widget divider() => SvgPicture.asset(
      'assets/icons/payroll_split_divider.svg',
      height: 28,
      width: double.infinity,
      fit: BoxFit.fill,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 18),
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Your new split${span.isEmpty ? '' : ' · $span'}'.toUpperCase(),
                style: _splitText(
                  13,
                  FontWeight.w600,
                  color: const Color(0xFF8E8E95),
                  letterSpacing: 0.8,
                ),
              ),
              divider(),
              for (final line in review.lines) _SplitReceiptLine(line: line),
              if (review.unassignedPaise > 0)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 7),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Not assigned',
                              style: _splitText(14.5, FontWeight.w600),
                            ),
                            Text(
                              'Paid with salary, taxed in full',
                              style: _splitText(
                                12,
                                FontWeight.w600,
                                color: _splitMuted,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        _rupees(review.unassignedPaise),
                        style: _splitText(
                          14.5,
                          FontWeight.w700,
                          color: _Q.gold,
                        ),
                      ),
                    ],
                  ),
                ),
              divider(),
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Expanded(
                    child: Text(
                      'Total',
                      style: _splitText(16, FontWeight.w800),
                    ),
                  ),
                  Text.rich(
                    key: const ValueKey('split-review-total'),
                    TextSpan(
                      children: [
                        TextSpan(
                          text: '${_rupees(review.totalPaise)} ',
                          style: _splitText(22, FontWeight.w800),
                        ),
                        TextSpan(
                          text: 'a month',
                          style: _splitText(
                            13,
                            FontWeight.w600,
                            color: _splitFooterInk,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        // The torn bottom edge.
        SizedBox(
          height: 12,
          child: Align(
            alignment: Alignment.topCenter,
            child: SvgPicture.asset(
              'assets/icons/payroll_split_receipt_edge.svg',
              height: 8,
              width: double.infinity,
              fit: BoxFit.fill,
            ),
          ),
        ),
      ],
    );
  }
}

class _SplitReceiptLine extends StatelessWidget {
  const _SplitReceiptLine({required this.line});

  final FbpReviewLine line;

  @override
  Widget build(BuildContext context) {
    final change = line.changePaise;
    return Padding(
      key: ValueKey('split-line-${line.code}'),
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: _splitHeadEmoji(line.name),
                    style: _splitText(14.5, FontWeight.w400),
                  ),
                  TextSpan(
                    text: ' ${line.name}',
                    style: _splitText(14.5, FontWeight.w600),
                  ),
                ],
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (line.isNew)
            const _SplitPill('New', color: _prBlue, tint: Color(0xFFE8F2F8))
          else if (change != 0)
            _SplitPill(
              _signedRupees(change),
              color: change > 0 ? _prGreen : _prRed,
              tint: change > 0 ? const Color(0xFFE7F8EC) : _prRedTint,
            ),
          if (line.isNew || change != 0) const SizedBox(width: 8),
          Text(
            _rupees(line.amountPaise),
            style: _splitText(14.5, FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

/// A head's change on the receipt: "+₹500" in green, "New" in blue.
class _SplitPill extends StatelessWidget {
  const _SplitPill(this.text, {required this.color, required this.tint});

  final String text;
  final Color color;
  final Color tint;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
    decoration: BoxDecoration(
      color: tint,
      borderRadius: BorderRadius.circular(9),
    ),
    child: Text(text, style: _splitText(11, FontWeight.w600, color: color)),
  );
}

/// "Saves about ₹940 a month in tax, once bills are approved."
class _SplitSavingNote extends StatelessWidget {
  const _SplitSavingNote({required this.savingPaise});

  final int savingPaise;

  @override
  Widget build(BuildContext context) {
    const ink = Color(0xFF065F46);
    final style = _splitText(
      13,
      FontWeight.w600,
      color: ink,
      height: 18.85 / 13,
    );
    return Container(
      key: const ValueKey('split-saving'),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFECFDF5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ExcludeSemantics(
            child: Text(
              '💰',
              style: style.copyWith(fontWeight: FontWeight.w400),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text.rich(
              TextSpan(
                style: style,
                children: [
                  const TextSpan(text: 'Saves about '),
                  TextSpan(
                    text: '${_rupees(savingPaise)} a month',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  const TextSpan(text: ' in tax, once bills are approved.'),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// "I'll keep bills for these heads and upload them by 31 Mar 2027.": the
/// box that has to be ticked before the split can be sent.
class _SplitAgreement extends StatelessWidget {
  const _SplitAgreement({
    required this.agreed,
    required this.billsBy,
    required this.onChanged,
  });

  final bool agreed;
  final DateTime? billsBy;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final text =
        'I\'ll keep bills for these heads and upload them'
        '${billsBy == null ? '' : ' by ${_longDate(billsBy!)}'}.';
    return Semantics(
      checked: agreed,
      label: text,
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          key: const ValueKey('split-agree'),
          onTap: () => onChanged(!agreed),
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: ExcludeSemantics(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 1),
                    child: AnimatedContainer(
                      key: const ValueKey('split-agree-box'),
                      duration: const Duration(milliseconds: 120),
                      width: 22,
                      height: 22,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: agreed ? _prBlue : Colors.white,
                        borderRadius: BorderRadius.circular(7),
                        border: Border.all(color: agreed ? _prBlue : _splitOff),
                      ),
                      child: agreed
                          ? SvgPicture.asset(
                              'assets/icons/payroll_split_check.svg',
                              width: 13,
                              height: 13,
                            )
                          : null,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      text,
                      style: _splitText(
                        13.5,
                        FontWeight.w600,
                        color: const Color(0xFF3A3A3F),
                        height: 19.58 / 13.5,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The success sheet once the split is saved (canvas HF4c): ✅, "Declaration
/// submitted", when the new split applies, and the two ways on.
class _SplitDoneSheet extends StatelessWidget {
  const _SplitDoneSheet({required this.review});

  final FbpReview review;

  /// "Your new split of ₹6,000 a month applies from November pay till March."
  static String body(FbpReview review) {
    final from = review.effectiveFrom;
    final to = review.effectiveTo;
    final till =
        to == null ||
            from == null ||
            (to.year == from.year && to.month == from.month)
        ? ''
        : ' till ${_monthName(to.month)}';
    final when = from == null
        ? ''
        : ' applies from ${_monthName(from.month)} pay$till';
    return 'Your new split of ${_rupees(review.totalPaise)} a month$when. '
        'Upload bills each month so these heads stay tax-free.';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('split-done-sheet'),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFFD5D6DC),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Center(
                child: Container(
                  width: 64,
                  height: 64,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    color: Color(0xFFECFDF5),
                    shape: BoxShape.circle,
                  ),
                  child: ExcludeSemantics(
                    child: Text(
                      '✅',
                      style: _splitText(30, FontWeight.w400, height: 1),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Text(
                'Declaration submitted',
                textAlign: TextAlign.center,
                style: _splitText(19, FontWeight.w700),
              ),
              const SizedBox(height: 14),
              Text(
                body(review),
                key: const ValueKey('split-done-body'),
                textAlign: TextAlign.center,
                style: _splitText(
                  13.5,
                  FontWeight.w500,
                  color: _splitFooterInk,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 14),
              _SplitCta(
                key: const ValueKey('split-done-upload'),
                label: 'Upload a bill',
                enabled: true,
                onTap: () => Navigator.of(context).pop(_SplitDone.uploadBill),
              ),
              const SizedBox(height: 14),
              Semantics(
                button: true,
                label: 'Back to FBP',
                child: Material(
                  key: const ValueKey('split-done-back'),
                  color: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: const BorderSide(color: _prBlue, width: 1.5),
                  ),
                  child: InkWell(
                    onTap: () =>
                        Navigator.of(context).pop(_SplitDone.backToFbp),
                    borderRadius: BorderRadius.circular(12),
                    child: SizedBox(
                      height: 46,
                      child: Center(
                        child: ExcludeSemantics(
                          child: Text(
                            'Back to FBP',
                            style: _splitText(
                              15,
                              FontWeight.w600,
                              color: _prBlue,
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
}
