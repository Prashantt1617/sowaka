part of 'quick_actions_screen.dart';

// ---------------------------------------------------------------- split

/// Change my split: each flexible head's share of the monthly pool, within
/// its limit.
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
      await _pushPayroll<void>(
        context,
        _SplitReviewPage(review: review, amounts: amounts),
      );
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
    final left = (split?.poolPaise ?? 0) - _total;
    return _payrollPage(
      context,
      key: const ValueKey('payroll-split'),
      title: 'Change my split',
      footer: !ready
          ? null
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: double.infinity,
                  color: const Color(0xFFF7F7F9),
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                  child: Text.rich(
                    key: const ValueKey('split-total'),
                    TextSpan(
                      style: _PrText.sub,
                      children: [
                        TextSpan(
                          text:
                              '${_rupees(_total)} of '
                              '${_rupees(split.poolPaise)} assigned · ',
                        ),
                        TextSpan(
                          text: left == 0
                              ? 'All set'
                              : left > 0
                              ? '${_rupees(left)} left'
                              : '${_rupees(-left)} over',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: left < 0
                                ? _prError
                                : const Color(0xFF111827),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                _FormSubmitBar(
                  label: 'Review split',
                  enabled: split.window.open && _changed && left >= 0,
                  busy: _busy,
                  onTap: _review,
                ),
              ],
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
          if (split.window.open)
            Text(
              [
                if (split.window.effectiveFrom != null)
                  'Applies from ${_monthName(split.window.effectiveFrom!.month)} pay',
                if (split.window.closesOn != null)
                  'change by ${_short(split.window.closesOn!)}',
              ].join(' · '),
              style: _PrText.caption,
            )
          else
            _PrNote(
              split.window.reason ?? 'Your split can\'t be changed right now.',
            ),
          const SizedBox(height: 12),
          for (final component in split.components) ...[
            _SplitHeadCard(
              component: component,
              amount: _amounts[component.code] ?? 0,
              enabled: split.window.open,
              onChanged: (value) =>
                  setState(() => _amounts[component.code] = value),
            ),
            const SizedBox(height: 12),
          ],
        ],
      ],
    );
  }
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
    final canLower = enabled && amount > 0;
    final canRaise = enabled && amount < component.limitPaise;
    final bills = component.bills;
    return _FormCard(
      children: [
        Row(
          children: [
            _IllustrationTile(asset: _claimCategoryIcon(component.name)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(component.name, style: _PrText.title),
                  const SizedBox(height: 2),
                  Text(
                    'Max ${_rupees(component.limitPaise)}',
                    style: _PrText.sub,
                  ),
                ],
              ),
            ),
            if (bills.rejected > 0)
              _PrPill(
                '${bills.rejected} rejected',
                color: _prRed,
                tint: _prRedTint,
              )
            else if (bills.inReview > 0)
              _PrPill(
                '${bills.inReview} in review',
                color: _Q.gold,
                tint: _Q.goldTint,
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
                icon: Icons.remove_rounded,
                label: 'Lower ${component.name}',
                onTap: canLower
                    ? () => onChanged((amount - step).clamp(0, amount))
                    : null,
              ),
              Expanded(
                child: Text(
                  _rupees(amount),
                  key: ValueKey('split-amount-${component.code}'),
                  textAlign: TextAlign.center,
                  style: _PrText.amount.copyWith(fontSize: 16),
                ),
              ),
              _StepButton(
                key: ValueKey('split-plus-${component.code}'),
                icon: Icons.add_rounded,
                label: 'Raise ${component.name}',
                onTap: canRaise
                    ? () => onChanged(
                        (amount + step).clamp(0, component.limitPaise),
                      )
                    : null,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: label,
    child: Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: SizedBox(
          width: 40,
          height: 40,
          child: Icon(
            icon,
            size: 20,
            color: onTap == null ? const Color(0xFFD1D5DB) : _prBlue,
          ),
        ),
      ),
    ),
  );
}

/// Review split: the split as the server worked it out, the tax it saves,
/// and the promise to keep the bills, before it is saved.
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
      final span = _monthSpan(review.effectiveFrom, review.effectiveTo);
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => _PayrollDonePage(
            summary: RequestSummary(
              screenTitle: 'FBP',
              successTitle: 'Split submitted',
              successBody:
                  'Your new split of ${_rupees(review.totalPaise)} a month '
                  '${span.isEmpty ? '' : 'applies $span. '}'
                  'Upload bills each month so these heads stay tax-free.',
              rows: [
                for (final line in review.lines)
                  SummaryRow(line.name, _rupees(line.amountPaise)),
                SummaryRow('Total', '${_rupees(review.totalPaise)} a month'),
              ],
            ),
          ),
        ),
      );
    } on PayrollApiException catch (error) {
      if (!mounted) return;
      if (!error.isConflict) {
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
    return _payrollPage(
      context,
      key: const ValueKey('payroll-split-review'),
      title: 'Review split',
      footer: _FormSubmitBar(
        label: 'Submit split',
        enabled: _agreed,
        busy: _busy,
        onTap: _submit,
      ),
      children: [
        _FormCard(
          children: [
            Text(
              'Your new split · '
                      '${_monthSpan(review.effectiveFrom, review.effectiveTo)}'
                  .toUpperCase(),
              style: _PrText.label,
            ),
            const SizedBox(height: 10),
            const Divider(height: 1, thickness: 1, color: Color(0xFFEBEBEB)),
            const SizedBox(height: 4),
            for (final line in review.lines)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    Image.asset(
                      _claimCategoryIcon(line.name),
                      width: 20,
                      height: 20,
                    ),
                    const SizedBox(width: 8),
                    Expanded(child: Text(line.name, style: _PrText.row)),
                    if (line.isNew)
                      const _PrPill('New', color: _prBlue, tint: _prBlueTint)
                    else if (line.changePaise != 0)
                      _PrPill(
                        _signedRupees(line.changePaise),
                        color: line.changePaise > 0 ? _prGreen : _prRed,
                        tint: line.changePaise > 0 ? _prGreenTint : _prRedTint,
                      ),
                    const SizedBox(width: 8),
                    Text(_rupees(line.amountPaise), style: _PrText.amount),
                  ],
                ),
              ),
            if (review.unassignedPaise > 0)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Not assigned', style: _PrText.row),
                          Text(
                            'Paid with salary, taxed in full',
                            style: _PrText.sub,
                          ),
                        ],
                      ),
                    ),
                    Text(
                      _rupees(review.unassignedPaise),
                      style: _PrText.amount.copyWith(color: _Q.gold),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 4),
            const Divider(height: 1, thickness: 1, color: Color(0xFFEBEBEB)),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                const Expanded(
                  child: Text(
                    'Total',
                    style: TextStyle(
                      fontFamily: 'Sora',
                      color: Color(0xFF111827),
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Text(
                  _rupees(review.totalPaise),
                  style: _PrText.amount.copyWith(fontSize: 16),
                ),
                const Text(' a month', style: _PrText.sub),
              ],
            ),
          ],
        ),
        if (saving > 0) ...[
          const SizedBox(height: 12),
          _PrNote(
            'Saves about ${_rupees(saving)} a month in tax, once bills are '
            'approved.',
            good: true,
            bold: '${_rupees(saving)} a month',
          ),
        ],
        const SizedBox(height: 12),
        Material(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            key: const ValueKey('split-agree'),
            onTap: () => setState(() => _agreed = !_agreed),
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 10, 16, 10),
              child: Row(
                children: [
                  Checkbox(
                    value: _agreed,
                    activeColor: _prBlue,
                    side: const BorderSide(
                      color: Color(0xFFD1D5DB),
                      width: 1.5,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(5),
                    ),
                    onChanged: (value) =>
                        setState(() => _agreed = value ?? false),
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      'I\'ll keep bills for these heads and upload them'
                      '${billsBy == null ? '' : ' by ${_longDate(billsBy)}'}.',
                      style: const TextStyle(
                        color: Color(0xFF222222),
                        fontSize: 13,
                        height: 1.45,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        if (review.closesOn != null) ...[
          const SizedBox(height: 10),
          Text(
            'You can change this again until ${_short(review.closesOn!)}.',
            textAlign: TextAlign.center,
            style: _PrText.caption,
          ),
        ],
      ],
    );
  }
}
