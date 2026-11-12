part of 'quick_actions_screen.dart';

// ---------------------------------------------------------------- tax

/// Payroll › Tax (Figma 4484:72847, 4484:72988, 4484:73196): the year's
/// income tax as the TDS engine sees it now — what has been paid, the figure
/// a month from here, each month of the year — and the regime, with the
/// declaration and its proofs on the old one, and Form 16. A regime is picked
/// on its card and kept with "Save tax regime"; it is saved through the
/// declaration, so it follows the declaration's last date and lock.
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

  /// The regime picked on the card and not saved yet.
  String? _picked;

  /// "Save tax regime" is on its way.
  bool _saving = false;

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

  void _pick(String regime) {
    final tax = _tax;
    if (tax == null || _saving || !tax.canChangeRegime) return;
    setState(() {
      _picked = regime == tax.regime ? null : regime;
      _saved = false;
    });
  }

  /// There is a pick to keep: a change, or a first choice of the default.
  bool _canSave(TaxSummary tax) =>
      tax.canChangeRegime && (_picked != null || !tax.chosen);

  Future<void> _save() async {
    final tax = _tax;
    if (tax == null || _saving || !_canSave(tax)) return;
    final regime = _picked ?? tax.regime;
    setState(() {
      _saving = true;
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
        _picked = null;
        _saving = false;
        _saved = true;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      showAppToast(context, payrollErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final tax = _tax;
    final showSave = tax != null && _regimeOpen && _canSave(tax);
    return _payrollPage(
      context,
      key: const ValueKey('payroll-tax'),
      title: 'Tax',
      footer: showSave
          ? ColoredBox(
              color: const Color(0xFFF7F7F9),
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                  child: _ProofFilledButton(
                    key: const ValueKey('tax-regime-save'),
                    label: 'Save tax regime',
                    busy: _saving,
                    onPressed: _save,
                  ),
                ),
              ),
            )
          : null,
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
          Text('MANAGE', style: _taxLabel),
          const SizedBox(height: 12),
          _manage(tax),
          if ((_picked ?? tax.regime) != 'old')
            Padding(
              key: const ValueKey('tax-new-regime-note'),
              padding: const EdgeInsets.fromLTRB(2, 8, 2, 0),
              child: Text(
                'On the new regime you don\'t need to declare investments '
                'or upload proofs.',
                style: _proofType(
                  12.5,
                  color: const Color(0xFF6B6B72),
                  height: 17.5 / 12.5,
                ),
              ),
            ),
          // Form 16 only where the company shows it in the app.
          if (tax.form16Enabled) ...[
            const SizedBox(height: 12),
            _TaxCard(
              child: _TaxManageRow(
                key: const ValueKey('tax-form16'),
                picture: ClipRect(
                  child: Image.asset(
                    'assets/icons/payroll_tax_form16.png',
                    width: 25,
                    height: 25,
                    fit: BoxFit.cover,
                  ),
                ),
                title: 'Download Form 16',
                subtitle: 'You need Form 16 to file your income tax return',
                trailing: const _TaxChevron(),
                onTap: () => _pushPayroll<void>(
                  context,
                  const _DownloadsPage(startTab: 'form16', form16: true),
                ),
              ),
            ),
          ],
        ],
      ],
    );
  }

  Widget _manage(TaxSummary tax) {
    final regime = _picked ?? tax.regime;
    final old = tax.regime == 'old';
    final due = tax.regimeDueOn;
    final regimeName = [
      old ? 'Old regime' : 'New regime',
      if (tax.regime == tax.defaultRegime) ' (default)',
    ].join();
    final when = due == null
        ? 'last date not set'
        : tax.locked
        ? 'closed ${_short(due)}'
        : tax.canChangeRegime
        ? 'change by ${_short(due)}'
        : 'can\'t be changed yet';
    // On the new regime there is nothing to declare or prove: the rows stay,
    // greyed, and say so.
    const notNeeded = 'Not needed on the new regime';
    return _TaxCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _TaxManageRow(
            key: const ValueKey('tax-regime'),
            picture: const _TaxPicture(),
            title: 'Tax regime',
            subtitle: '$regimeName · $when',
            trailing: AnimatedRotation(
              turns: _regimeOpen ? .5 : 0,
              duration: const Duration(milliseconds: 150),
              child: SvgPicture.asset(
                'assets/icons/payroll_tax_chevron_down.svg',
                width: 18,
                height: 18,
              ),
            ),
            expanded: _regimeOpen,
            onTap: () => setState(() => _regimeOpen = !_regimeOpen),
          ),
          if (_regimeOpen) _regimePicker(tax, regime),
          _TaxManageRow(
            key: const ValueKey('tax-declaration'),
            divided: true,
            picture: Image.asset(
              'assets/icons/action_card_policies_pencil.png',
              width: 24,
              height: 24,
              fit: BoxFit.cover,
            ),
            title: 'Investment declaration',
            subtitle: !old
                ? notNeeded
                : due == null
                ? 'Declare your investments'
                : tax.locked
                ? 'Closed ${_short(due)}'
                : 'By ${_short(due)}',
            trailing: const _TaxChevron(),
            onTap: old ? () => _open(const _DeclarationPage()) : null,
          ),
          _TaxManageRow(
            key: const ValueKey('tax-proofs'),
            divided: true,
            picture: Image.asset(
              'assets/icons/payroll_tax_checklist.png',
              width: 24,
              height: 24,
              fit: BoxFit.cover,
            ),
            title: 'Investment proofs',
            subtitle: !old
                ? notNeeded
                : tax.proofsDueOn == null
                ? 'Upload a proof for each investment'
                : 'Due ${_short(tax.proofsDueOn!)}',
            trailing: const _TaxChevron(),
            onTap: old ? () => _open(const _ProofsPage()) : null,
          ),
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
          _RegimeOption(
            key: const ValueKey('tax-regime-old'),
            label: 'Old regime',
            on: regime == 'old',
            isDefault: tax.defaultRegime == 'old',
            enabled: tax.canChangeRegime && !_saving,
            onTap: () => _pick('old'),
          ),
          const SizedBox(height: 8),
          _RegimeOption(
            key: const ValueKey('tax-regime-new'),
            label: 'New regime',
            on: regime == 'new',
            isDefault: tax.defaultRegime == 'new',
            enabled: tax.canChangeRegime && !_saving,
            onTap: () => _pick('new'),
          ),
          if (closed != null) ...[
            const SizedBox(height: 8),
            Text(
              closed,
              key: const ValueKey('tax-regime-closed'),
              style: _PrText.sub,
            ),
            if (mentionsHrOrSupport(closed)) RaiseTicketLink(about: closed),
          ] else if (_saved && _picked == null && due != null) ...[
            const SizedBox(height: 8),
            Text(
              'Saved · last date to change ${_short(due)}',
              key: const ValueKey('tax-regime-saved'),
              style: _proofType(12.5, color: const Color(0xFF15803D)),
            ),
          ],
        ],
      ),
    );
  }
}

/// "TAX · FY 2026–27", "MANAGE": the hub's small capitals.
final _taxLabel = _proofType(
  13,
  color: const Color(0xFF8E8E95),
  letterSpacing: 0.8,
);

/// A white card of the Tax page's lists, 16 in and rounded 18.
class _TaxCard extends StatelessWidget {
  const _TaxCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
    ),
    child: child,
  );
}

class _TaxChevron extends StatelessWidget {
  const _TaxChevron();

  @override
  Widget build(BuildContext context) => SvgPicture.asset(
    'assets/icons/payroll_proofs_chevron.svg',
    width: 18,
    height: 18,
  );
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
    const line = BorderSide(color: Color(0xFFF1F1F4));
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _TaxCardHead(
            fy: tax.fy,
            pill: _TaxTag(tax.isOld ? 'Old regime' : 'New regime'),
          ),
          const SizedBox(height: 10),
          Text(
            _rupees(tax.annualTaxPaise ?? 0),
            key: const ValueKey('tax-annual'),
            style: _proofType(
              34,
              weight: FontWeight.w800,
              height: 37.4 / 34,
              letterSpacing: -0.6,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Your tax for the year · ${tax.estimate ? 'estimate' : 'final'}',
            style: _proofType(13, color: _proofMuted),
          ),
          const SizedBox(height: 16),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
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
                    child: _TaxStat(
                      value: _rupees(monthly),
                      label: 'A month now',
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),
          Semantics(
            button: true,
            expanded: open,
            child: InkWell(
              key: const ValueKey('tax-months'),
              onTap: onToggle,
              child: Container(
                constraints: const BoxConstraints(minHeight: 44),
                decoration: const BoxDecoration(border: Border(top: line)),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Month by month',
                        style: _proofType(14.5, color: _prBlue),
                      ),
                    ),
                    AnimatedRotation(
                      turns: open ? .5 : 0,
                      duration: const Duration(milliseconds: 150),
                      child: SvgPicture.asset(
                        'assets/icons/payroll_tax_chevron_down_blue.svg',
                        width: 18,
                        height: 18,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (open)
            for (final (i, month) in tax.months.indexed)
              _TaxMonthRow(month: month, first: i == 0),
        ],
      ),
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
        child: Text('TAX · FY ${fy.replaceFirst('-', '–')}', style: _taxLabel),
      ),
      pill,
    ],
  );
}

/// The card's tag: brand blue on its pale tint, "New regime".
class _TaxTag extends StatelessWidget {
  const _TaxTag(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    decoration: BoxDecoration(
      color: const Color(0xFFE8F2F8),
      borderRadius: BorderRadius.circular(12.5),
    ),
    child: Text(
      text,
      style: _proofType(12, weight: FontWeight.w700, color: _prBlue),
    ),
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
        Text(value, style: _proofType(16, weight: FontWeight.w800)),
        const SizedBox(height: 2),
        Text(label, style: _proofType(12, color: const Color(0xFF6B6B72))),
      ],
    ),
  );
}

/// The ink of a month already paid, and of one still to come.
const _taxPaidInk = Color(0xFF222222);
const _taxComingInk = Color(0xFF9CA3AF);

/// A month of the year: dark with what was deducted once paid, grey with
/// the figure a run would take for the months to come.
class _TaxMonthRow extends StatelessWidget {
  const _TaxMonthRow({required this.month, required this.first});

  final TaxMonth month;

  /// The first row sits a little further from "Month by month".
  final bool first;

  @override
  Widget build(BuildContext context) {
    final paid = month.isPaid;
    final amount = month.amountPaise;
    final style = _proofType(
      14.5,
      color: paid ? _taxPaidInk : _taxComingInk,
    ).copyWith(fontFeatures: const [FontFeature.tabularFigures()]);
    return Container(
      key: ValueKey('tax-month-${month.period}'),
      padding: EdgeInsets.only(top: first ? 12 : 8, bottom: 4),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Color(0xFFF1F1F4))),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              month.label.isEmpty ? _periodLabel(month.period) : month.label,
              style: style,
            ),
          ),
          Text(amount == null ? '—' : _rupees(amount), style: style),
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

/// A row of the Manage list: the picture on its tile, what it is, where it
/// stands. A row with nothing to open (the declaration on the new regime) is
/// greyed.
class _TaxManageRow extends StatelessWidget {
  const _TaxManageRow({
    super.key,
    required this.picture,
    required this.title,
    required this.subtitle,
    required this.trailing,
    required this.onTap,
    this.expanded,
    this.divided = false,
  });

  final Widget picture;
  final String title;
  final String subtitle;
  final Widget trailing;
  final VoidCallback? onTap;

  /// For a row that opens in place: whether it is open.
  final bool? expanded;

  /// A hairline above: every row after the first.
  final bool divided;

  @override
  Widget build(BuildContext context) {
    final live = onTap != null;
    final muted = live ? null : const Color(0xFF717171);
    return Semantics(
      button: live,
      enabled: live,
      expanded: expanded,
      child: InkWell(
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
              _ProofsIconTile(child: picture),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: _proofType(
                        15,
                        weight: FontWeight.w700,
                        color: muted ?? _proofInk,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      style: _proofType(12.5, color: muted ?? _proofMuted),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              trailing,
            ],
          ),
        ),
      ),
    );
  }
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
        color: on ? const Color(0xFFF1F7FE) : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: on ? _prBlue : const Color(0xFFE4E4E8)),
        ),
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(14),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 52),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 15),
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
                      style: _proofType(15, weight: FontWeight.w700),
                    ),
                  ),
                  if (isDefault)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEDEDF0),
                        borderRadius: BorderRadius.circular(10.5),
                      ),
                      child: Text(
                        'Default',
                        style: _proofType(
                          12,
                          weight: FontWeight.w700,
                          color: _proofMuted,
                        ),
                      ),
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
