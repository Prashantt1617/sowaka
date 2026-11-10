part of 'quick_actions_screen.dart';

// ---------------------------------------------------------------- tax

/// Payroll › Tax (R 3 / R 3b): the year's income tax as the TDS engine sees
/// it now — what has been paid, the figure a month from here, each month of
/// the year — and the regime, with the declaration and its proofs on the old
/// one. The regime is saved through the declaration, so it follows the
/// declaration's last date and lock.
class _TaxSummaryPage extends StatefulWidget {
  const _TaxSummaryPage();

  @override
  State<_TaxSummaryPage> createState() => _TaxSummaryPageState();
}

/// The Tax page on its own, inside Payroll's frame, for tests: Payroll's
/// home opens it from its Tax card.
@visibleForTesting
class PayrollTaxSummaryHarness extends StatelessWidget {
  const PayrollTaxSummaryHarness({super.key, required this.screen});

  /// Supplies the API and the header's actions, as Payroll does.
  final PayrollScreen screen;

  @override
  Widget build(BuildContext context) => _PayrollScope(
    screen: screen,
    child: Navigator(
      onGenerateRoute: (_) =>
          MaterialPageRoute<void>(builder: (_) => const _TaxSummaryPage()),
    ),
  );
}

class _TaxSummaryPageState extends State<_TaxSummaryPage> {
  TaxSummary? _tax;
  String? _error;
  bool _started = false;
  bool _monthsOpen = false;
  bool _regimeOpen = false;

  /// The regime being saved, shown picked while the save is on its way.
  String? _saving;

  /// The last pick was saved.
  bool _saved = false;

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
      final tax = await _PayrollScope.of(context).api.fetchTaxSummary();
      if (mounted) setState(() => _tax = tax);
    } catch (error) {
      if (mounted) setState(() => _error = payrollErrorText(error));
    }
  }

  /// A page of its own (the declaration, the proofs), and a fresh read when
  /// it closes: a declaration changes the year's tax.
  Future<void> _open(Widget page) async {
    await _pushPayroll<void>(context, page);
    if (mounted) unawaited(_load());
  }

  Future<void> _pick(String regime) async {
    final tax = _tax;
    if (tax == null || _saving != null || !tax.canChangeRegime) return;
    if (regime == tax.regime && tax.chosen) return;
    setState(() {
      _saving = regime;
      _saved = false;
    });
    final api = _PayrollScope.of(context).api;
    try {
      // The declaration's own save, with no amounts: what was declared on
      // the old regime is kept. On the new one there is nothing more to send.
      await api.saveDeclaration(
        regime: regime,
        submit: regime == 'new',
        fy: tax.fy,
      );
      final fresh = await api.fetchTaxSummary(fy: tax.fy);
      if (!mounted) return;
      setState(() {
        _tax = fresh;
        _saving = null;
        _saved = true;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = null);
      showAppToast(context, payrollErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final tax = _tax;
    return _payrollPage(
      context,
      key: const ValueKey('payroll-tax'),
      title: 'Tax',
      children: [
        if (tax == null && _error == null)
          const _PrLoading()
        else if (tax == null)
          _PrError(_error!, onRetry: _load)
        else ...[
          if (tax.notConfigured)
            _TaxNotSetUpCard(tax: tax)
          else
            _TaxYearCard(
              tax: tax,
              open: _monthsOpen,
              onToggle: () => setState(() => _monthsOpen = !_monthsOpen),
            ),
          const SizedBox(height: 24),
          const _HomeSectionLabel('Manage'),
          const SizedBox(height: 12),
          _manage(tax),
          if ((_saving ?? tax.regime) != 'old') ...[
            const SizedBox(height: 8),
            const Padding(
              key: ValueKey('tax-new-regime-note'),
              padding: EdgeInsets.symmetric(horizontal: 2),
              child: Text(
                'On the new regime you don\'t need to declare investments '
                'or upload proofs.',
                style: TextStyle(
                  color: Color(0xFF6B7280),
                  fontSize: 12.5,
                  height: 1.4,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ],
      ],
    );
  }

  Widget _manage(TaxSummary tax) {
    final regime = _saving ?? tax.regime;
    final old = regime == 'old';
    final due = tax.regimeDueOn;
    final regimeName = [
      old ? 'Old regime' : 'New regime',
      if (regime == tax.defaultRegime) ' (default)',
    ].join();
    final when = due == null
        ? 'last date not set'
        : tax.locked
        ? 'closed ${_short(due)}'
        : tax.canChangeRegime
        ? 'change by ${_short(due)}'
        : 'can\'t be changed yet';
    const divider = Divider(height: 1, thickness: 1, color: Color(0xFFF3F4F6));
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .04),
            blurRadius: 2,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _TaxManageRow(
            key: const ValueKey('tax-regime'),
            asset: 'assets/icons/action_card_reimbursement_rupee.png',
            title: 'Tax regime',
            subtitle: '$regimeName · $when',
            trailing: AnimatedRotation(
              turns: _regimeOpen ? .5 : 0,
              duration: const Duration(milliseconds: 150),
              child: const Icon(
                Icons.keyboard_arrow_down_rounded,
                size: 20,
                color: Color(0xFF9CA3AF),
              ),
            ),
            expanded: _regimeOpen,
            onTap: () => setState(() => _regimeOpen = !_regimeOpen),
          ),
          if (_regimeOpen) _regimePicker(tax, regime),
          if (old) ...[
            divider,
            _TaxManageRow(
              key: const ValueKey('tax-declaration'),
              asset: 'assets/icons/action_card_policies_pencil.png',
              title: 'Investment declaration',
              subtitle: due == null
                  ? 'Declare your investments'
                  : tax.locked
                  ? 'Closed ${_short(due)}'
                  : 'By ${_short(due)}',
              trailing: const _PrChevron(),
              onTap: () => _open(const _DeclarationPage()),
            ),
            divider,
            _TaxManageRow(
              key: const ValueKey('tax-proofs'),
              asset: 'assets/icons/leave_year_approved_badge.png',
              title: 'Investment proofs',
              subtitle: tax.proofsDueOn == null
                  ? 'Upload a proof for each investment'
                  : 'Due ${_short(tax.proofsDueOn!)}',
              trailing: const _PrChevron(),
              onTap: () => _open(const _ProofsPage()),
            ),
          ],
        ],
      ),
    );
  }

  Widget _regimePicker(TaxSummary tax, String regime) {
    final due = tax.regimeDueOn;
    // Why the regime can't be changed, when it can't.
    final String? closed = tax.canChangeRegime
        ? null
        : tax.locked && due != null
        ? 'The last date to change your regime was ${_short(due)}. To change '
              'it now, ask HR.'
        : due == null
        ? 'HR has not set the last date to change your regime yet. Ask HR.'
        : tax.reason == 'tax_rules_not_set_up' && tax.message != null
        ? tax.message
        : 'Your regime can\'t be changed right now. Ask HR.';
    return Padding(
      key: const ValueKey('tax-regime-picker'),
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (key, label) in const [
            ('old', 'Old regime'),
            ('new', 'New regime'),
          ]) ...[
            _RegimeOption(
              key: ValueKey('tax-regime-$key'),
              label: label,
              on: regime == key,
              isDefault: tax.defaultRegime == key,
              enabled: tax.canChangeRegime && _saving == null,
              onTap: () => _pick(key),
            ),
            const SizedBox(height: 8),
          ],
          if (_saving != null)
            const Text('Saving…', style: _PrText.sub)
          else if (closed != null) ...[
            Text(
              closed,
              key: const ValueKey('tax-regime-closed'),
              style: _PrText.sub,
            ),
            if (mentionsHrOrSupport(closed)) RaiseTicketLink(about: closed),
          ] else if (_saved && due != null)
            Text(
              'Saved · last date to change ${_short(due)}',
              key: const ValueKey('tax-regime-saved'),
              style: const TextStyle(
                color: Color(0xFF15803D),
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
              ),
            ),
        ],
      ),
    );
  }
}

/// The year's tax: the figure, what has been paid and the month's figure
/// now, opening to every month of the year.
class _TaxYearCard extends StatelessWidget {
  const _TaxYearCard({
    required this.tax,
    required this.open,
    required this.onToggle,
  });

  final TaxSummary tax;
  final bool open;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final through = tax.paidThroughMonth;
    final monthly = tax.monthlyNowPaise;
    const line = Divider(height: 1, thickness: 1, color: Color(0xFFF3F4F6));
    return _FormCard(
      children: [
        _TaxCardHead(
          fy: tax.fy,
          pill: tax.estimate
              ? const _PrPill('Estimate', color: _prBlue, tint: _prBlueTint)
              : const _PrPill('Final', color: _prGreen, tint: _prGreenTint),
        ),
        const SizedBox(height: 10),
        Text(
          _rupees(tax.annualTaxPaise ?? 0),
          key: const ValueKey('tax-annual'),
          style: const TextStyle(
            fontFamily: 'Sora',
            fontFamilyFallback: _soraFallback,
            color: Color(0xFF111827),
            fontSize: 34,
            height: 1.1,
            letterSpacing: -0.6,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Your tax for the year · ${tax.isOld ? 'old' : 'new'} regime',
          style: _PrText.sub.copyWith(
            fontSize: 13,
            color: const Color(0xFF4B5563),
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: _TaxStat(
                value: _rupees(tax.paidSoFarPaise),
                label: through == null
                    ? 'Paid so far'
                    : 'Paid till ${_shortMonthName(through.month)}',
              ),
            ),
            if (monthly != null) ...[
              const SizedBox(width: 8),
              Expanded(
                child: _TaxStat(value: _rupees(monthly), label: 'A month now'),
              ),
            ],
          ],
        ),
        const SizedBox(height: 14),
        line,
        InkWell(
          key: const ValueKey('tax-months'),
          onTap: onToggle,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 44),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Month by month',
                    style: _PrText.link.copyWith(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                AnimatedRotation(
                  turns: open ? .5 : 0,
                  duration: const Duration(milliseconds: 150),
                  child: const Icon(
                    Icons.keyboard_arrow_down_rounded,
                    size: 20,
                    color: _prBlue,
                  ),
                ),
              ],
            ),
          ),
        ),
        if (open)
          for (final month in tax.months) ...[line, _TaxMonthRow(month: month)],
      ],
    );
  }
}

class _TaxCardHead extends StatelessWidget {
  const _TaxCardHead({required this.fy, required this.pill});

  /// "2026-27".
  final String fy;
  final Widget pill;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(
          'TAX · FY ${fy.replaceFirst('-', '–')}',
          style: _PrText.label,
        ),
      ),
      pill,
    ],
  );
}

class _TaxStat extends StatelessWidget {
  const _TaxStat({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    decoration: BoxDecoration(
      color: const Color(0xFFF7F7F9),
      borderRadius: BorderRadius.circular(14),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(value, style: _PrText.amount.copyWith(fontSize: 16)),
        const SizedBox(height: 2),
        Text(label, style: _PrText.sub.copyWith(fontWeight: FontWeight.w600)),
      ],
    ),
  );
}

/// A month of the year: dark with what was deducted once paid, grey with
/// the figure a run would take for the months to come.
class _TaxMonthRow extends StatelessWidget {
  const _TaxMonthRow({required this.month});

  final TaxMonth month;

  @override
  Widget build(BuildContext context) {
    final paid = month.isPaid;
    final amount = month.amountPaise;
    final color = paid ? const Color(0xFF111827) : const Color(0xFF9CA3AF);
    return ConstrainedBox(
      key: ValueKey('tax-month-${month.period}'),
      constraints: const BoxConstraints(minHeight: 40),
      child: Row(
        children: [
          Expanded(
            child: Text(
              month.label.isEmpty ? _periodLabel(month.period) : month.label,
              style: _PrText.row.copyWith(
                color: color,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Text(
            amount == null ? '—' : _rupees(amount),
            style: _PrText.amount.copyWith(
              color: color,
              fontWeight: paid ? FontWeight.w700 : FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// The card when the year's tax can't be worked out: what is missing and
/// who sets it up, with no figures.
class _TaxNotSetUpCard extends StatelessWidget {
  const _TaxNotSetUpCard({required this.tax});

  final TaxSummary tax;

  @override
  Widget build(BuildContext context) {
    final message =
        tax.message ??
        'Your tax for the year can\'t be worked out yet. Ask HR.';
    return _FormCard(
      children: [
        _TaxCardHead(
          fy: tax.fy,
          pill: const _PrPill('Not set up', color: _Q.gold, tint: _Q.goldTint),
        ),
        const SizedBox(height: 10),
        Text(
          message,
          key: const ValueKey('tax-not-set-up'),
          style: _PrText.sub.copyWith(fontSize: 13, height: 1.45),
        ),
        if (mentionsHrOrSupport(message)) RaiseTicketLink(about: message),
      ],
    );
  }
}

/// A row of the Manage list: the picture, what it is, where it stands.
class _TaxManageRow extends StatelessWidget {
  const _TaxManageRow({
    super.key,
    required this.asset,
    required this.title,
    required this.subtitle,
    required this.trailing,
    required this.onTap,
    this.expanded,
  });

  final String asset;
  final String title;
  final String subtitle;
  final Widget trailing;
  final VoidCallback onTap;

  /// For a row that opens in place: whether it is open.
  final bool? expanded;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    expanded: expanded,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            _IllustrationTile(asset: asset),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: _PrText.title.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 2),
                  // The app's face, as the declaration's own rows set it:
                  // "New regime (default) · change by 30 Nov" on one line.
                  Text(
                    subtitle,
                    style: const TextStyle(
                      color: Color(0xFF6B7280),
                      fontSize: 12,
                      height: 1.35,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 4),
            trailing,
          ],
        ),
      ),
    ),
  );
}

/// One regime to pick: a radio, its name, and "Default" on the company's
/// default.
class _RegimeOption extends StatelessWidget {
  const _RegimeOption({
    super.key,
    required this.label,
    required this.on,
    required this.isDefault,
    required this.enabled,
    required this.onTap,
  });

  final String label;
  final bool on;
  final bool isDefault;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    inMutuallyExclusiveGroup: true,
    checked: on,
    enabled: enabled,
    child: Opacity(
      opacity: enabled || on ? 1 : .6,
      child: Material(
        color: on ? const Color(0xFFF0F8FC) : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(
            color: on ? _prBlue : const Color(0xFFE5E7EB),
            width: 1.5,
          ),
        ),
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(14),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 52),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Row(
                children: [
                  Container(
                    width: 20,
                    height: 20,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: on ? _prBlue : const Color(0xFFC8C8CE),
                        width: 2,
                      ),
                    ),
                    child: on
                        ? Container(
                            width: 9,
                            height: 9,
                            decoration: const BoxDecoration(
                              color: _prBlue,
                              shape: BoxShape.circle,
                            ),
                          )
                        : null,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      label,
                      style: _PrText.title.copyWith(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  if (isDefault)
                    const _PrPill(
                      'Default',
                      color: Color(0xFF4B5563),
                      tint: Color(0xFFF3F4F6),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
