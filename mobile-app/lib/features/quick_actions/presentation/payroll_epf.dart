part of 'quick_actions_screen.dart';

/// Opens a page in the browser. Tests swap it for one that records the link.
@visibleForTesting
Future<bool> Function(Uri) payrollOpenExternal = (uri) =>
    launchUrl(uri, mode: LaunchMode.externalApplication);

/// The EPFO pages the EPF page sends people to: the member passbook, and the
/// member portal for the nominee and a transfer.
const _epfoPassbook = 'https://passbook.epfindia.gov.in/MemberPassBook/login';
const _epfoMemberPortal =
    'https://unifiedportal-mem.epfindia.gov.in/memberinterface/';

/// The EPF page on its own, in the Payroll frame [screen] gives it, so a test
/// can open it without the Payroll home linking to it.
@visibleForTesting
class PayrollEpfPreview extends StatelessWidget {
  const PayrollEpfPreview({super.key, required this.screen});

  final PayrollScreen screen;

  @override
  Widget build(BuildContext context) => _PayrollScope(
    screen: screen,
    child: Navigator(
      onGenerateRoute: (_) =>
          MaterialPageRoute<void>(builder: (_) => const _EpfPage()),
    ),
  );
}

/// "1012 3456 7890".
String _uanText(String uan) => uan.length == 12
    ? '${uan.substring(0, 4)} ${uan.substring(4, 8)} ${uan.substring(8)}'
    : uan;

/// 12 → "12", 8.33 → "8.33".
String _percent(double rate) => rate == rate.roundToDouble()
    ? rate.round().toString()
    : rate.toStringAsFixed(2).replaceFirst(RegExp(r'0+$'), '');

/// "30 Sep" this year, "30 Sep 2025" before it.
String _epfDay(DateTime day) => day.year == DateTime.now().year
    ? '${day.day} ${_shortMonthName(day.month)}'
    : _longDate(day);

/// "2026-04" → "Apr 2026".
String _epfMonth(String period) {
  final month = payrollMonth(period);
  return month == null
      ? period
      : '${_shortMonthName(month.month)} ${month.year}';
}

/// Actions › Payroll › EPF: what Sowaka knows about the person's PF. Sowaka
/// cannot read EPFO, so the card is the balance the person (or HR) copied
/// from the passbook plus what payroll has put in since, or, until there is
/// one, the PF put in through Sowaka payroll. The monthly split is the salary
/// structure's, on the year's statutory rates. Passbook, nominee and transfer
/// open on the EPFO website, with the UAN to copy.
class _EpfPage extends StatefulWidget {
  const _EpfPage();

  @override
  State<_EpfPage> createState() => _EpfPageState();
}

class _EpfPageState extends State<_EpfPage> {
  EpfSummary? _epf;
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
    final api = _PayrollScope.of(context).api;
    if (_error != null) setState(() => _error = null);
    try {
      final epf = await api.fetchEpf();
      if (!mounted) return;
      setState(() {
        _epf = epf;
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = payrollErrorText(error));
    }
  }

  void _raiseTicket() {
    if (!raiseSupportTicket(about: 'PF question:')) {
      _PayrollScope.of(context).onRaiseTicket?.call();
    }
  }

  Future<void> _editBalance() async {
    final epf = _epf;
    if (epf == null) return;
    final api = _PayrollScope.of(context).api;
    final updated = await showModalBottomSheet<EpfSummary>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _EpfBalanceSheet(api: api, current: epf.balance),
    );
    if (updated == null || !mounted) return;
    setState(() => _epf = updated);
    showAppToast(context, 'PF balance saved');
  }

  Future<void> _openEpfo(_EpfoLink link) async {
    final epf = _epf;
    if (epf == null) return;
    final addBalance = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _EpfoSheet(link: link, uan: epf.uan),
    );
    if (addBalance == true && mounted) await _editBalance();
  }

  @override
  Widget build(BuildContext context) {
    final epf = _epf;
    final canRaise =
        canRaiseSupportTicket ||
        _PayrollScope.of(context).onRaiseTicket != null;
    return _payrollPage(
      context,
      key: const ValueKey('payroll-epf'),
      title: 'EPF',
      children: [
        if (epf == null && _error == null)
          const _PrLoading()
        else if (epf == null)
          _PrError(_error!, onRetry: _load)
        else if (!epf.enrolled)
          ..._notEnrolled(epf)
        else ...[
          _EpfBalanceCard(epf: epf),
          ..._underBalance(epf),
          const _EpfSection('Every month'),
          if (epf.monthly case final monthly?) ...[
            _EpfMonthlyCard(monthly: monthly),
            Padding(
              padding: const EdgeInsets.fromLTRB(2, 8, 2, 0),
              child: Text(
                _monthlyNote(monthly),
                key: const ValueKey('epf-monthly-note'),
                style: _Er._sora.copyWith(
                  color: const Color(0xFF6B6B72),
                  fontSize: 12.5,
                  height: 17.5 / 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ] else ...[
            _PrNote(
              epf.notSetUpMessage ??
                  'Your monthly PF can\'t be worked out yet. Ask HR.',
            ),
            RaiseTicketLink(about: epf.notSetUpMessage),
          ],
          const _EpfSection('Manage on EPFO'),
          _EarningsCard(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            radius: 18,
            children: [
              for (final (index, link) in _EpfoLink.values.indexed) ...[
                if (index > 0) const _EpfHairline(),
                _EpfoRow(link: link, onTap: () => _openEpfo(link)),
              ],
            ],
          ),
        ],
        if (epf != null && canRaise)
          Padding(
            padding: const EdgeInsets.only(top: 14),
            child: Center(
              child: InkWell(
                key: const ValueKey('epf-raise-ticket'),
                onTap: _raiseTicket,
                borderRadius: BorderRadius.circular(8),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 44),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    child: Center(
                      widthFactor: 1,
                      child: Text(
                        'PF question? Raise a ticket',
                        style: _Er._sora.copyWith(
                          color: _Er.link,
                          fontSize: 13.5,
                          height: 1.26,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  /// What sits under the balance card, outside it: the PF payroll added
  /// since the passbook's date, or, until there is a balance, the way to add
  /// one.
  List<Widget> _underBalance(EpfSummary epf) {
    final balance = epf.balance;
    final small = _Er._sora.copyWith(
      fontSize: 12.5,
      height: 17.5 / 12.5,
      fontWeight: FontWeight.w600,
    );
    if (balance != null) {
      if (balance.addedSincePaise <= 0) return const [];
      return [
        Padding(
          padding: const EdgeInsets.fromLTRB(2, 8, 2, 0),
          child: Text(
            '+ ${_rupees(balance.addedSincePaise)} added through payroll '
            'since ${_epfDay(balance.asOn)}',
            key: const ValueKey('epf-added-since'),
            style: small.copyWith(color: _prGreen),
          ),
        ),
      ];
    }
    return [
      if (epf.saved.months == 0)
        Padding(
          padding: const EdgeInsets.fromLTRB(2, 8, 2, 0),
          child: Text(
            'PF from your payslips shows here after your first salary.',
            style: small.copyWith(color: const Color(0xFF6B6B72)),
          ),
        ),
      Align(
        alignment: Alignment.centerLeft,
        child: InkWell(
          key: const ValueKey('epf-add-balance'),
          onTap: _editBalance,
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(2, 10, 2, 4),
            child: Text(
              'Add your balance from the EPFO passbook ›',
              style: small.copyWith(color: _Er.link),
            ),
          ),
        ),
      ),
    ];
  }

  /// "12% of ₹15,000 from you. Your employer's 12% is split between PF and
  /// pension." — the rates and the wage as the server worked them out.
  static String _monthlyNote(EpfMonthly m) {
    final mine =
        '${_percent(m.ratePercent)}% of ${_rupees(m.pfWagePaise)} from you.';
    final theirs = m.employerEpsPaise > 0
        ? 'Your employer\'s ${_percent(m.employerRatePercent)}% is split '
              'between PF and pension.'
        : 'Your employer\'s ${_percent(m.employerRatePercent)}% all goes to '
              'your PF.';
    return '$mine $theirs';
  }

  List<Widget> _notEnrolled(EpfSummary epf) {
    final why = switch (epf.notEnrolledReason) {
      'no_salary_structure' =>
        'It shows here once HR sets up your pay and PF is part of it.',
      'pf_off_for_company' => 'Your company doesn\'t deduct PF through Sowaka.',
      _ => 'If you think it should be, ask HR.',
    };
    return [
      KeyedSubtree(
        key: const ValueKey('epf-not-enrolled'),
        child: _HubEmptyState(
          iconAsset: 'assets/icons/request_reimbursement_money.png',
          text: 'PF isn\'t deducted from your salary\n$why',
        ),
      ),
      if (epf.saved.totalPaise > 0)
        _PrNote(
          '${_rupees(epf.saved.totalPaise)} was put in your PF through '
          'Sowaka earlier. Your full balance is on EPFO.',
        ),
    ];
  }
}

/// "EVERY MONTH", "MANAGE ON EPFO": 24 above, 12 below.
class _EpfSection extends StatelessWidget {
  const _EpfSection(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 24, bottom: 12),
    child: Text(text.toUpperCase(), style: _Er.section),
  );
}

class _EpfHairline extends StatelessWidget {
  const _EpfHairline();

  @override
  Widget build(BuildContext context) =>
      const Divider(height: 1, thickness: 1, color: _Er.hairline);
}

/// "As on 30 Sep", "Since Apr 2026": the grey tag on the balance card.
class _EpfTag extends StatelessWidget {
  const _EpfTag(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    decoration: BoxDecoration(
      color: const Color(0xFFEDEDF0),
      borderRadius: BorderRadius.circular(12.5),
    ),
    child: Text(
      text,
      style: _Er._sora.copyWith(
        color: _Er.muted,
        fontSize: 12,
        height: 1.26,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

/// The top card (Figma 4506:23390): the passbook balance with what payroll
/// added since, or the PF put in through Sowaka until a balance is added,
/// and the UAN. Nothing else: the rest sits under the card.
class _EpfBalanceCard extends StatelessWidget {
  const _EpfBalanceCard({required this.epf});

  final EpfSummary epf;

  @override
  Widget build(BuildContext context) {
    final balance = epf.balance;
    final saved = epf.saved;
    final since = saved.sincePeriod;
    final uan = epf.uan;
    final tag = balance != null
        ? 'As on ${_epfDay(balance.asOn)}'
        : since != null
        ? 'Since ${_epfMonth(since)}'
        : null;
    return _EarningsCard(
      padding: const EdgeInsets.all(20),
      radius: 22,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                (balance == null ? 'PF saved through Sowaka' : 'PF balance')
                    .toUpperCase(),
                style: _Er.section,
              ),
            ),
            if (tag != null) ...[const SizedBox(width: 8), _EpfTag(tag)],
          ],
        ),
        const SizedBox(height: 10),
        Text(
          _rupees(balance?.totalPaise ?? saved.totalPaise),
          key: const ValueKey('epf-hero'),
          style: _Er._sora.copyWith(
            fontSize: 34,
            height: 37.4 / 34,
            letterSpacing: -0.6,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          uan != null
              ? 'UAN ${_uanText(uan)}'
              : epf.uanLast4 != null
              ? 'UAN ending ${epf.uanLast4}'
              : 'UAN not on record yet. Ask HR to add it.',
          key: const ValueKey('epf-uan'),
          style: _Er._sora.copyWith(
            color: _Er.muted,
            fontSize: 13,
            height: 1.26,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

/// You put in / Employer puts in / Employer to pension (EPS) (Figma
/// 4506:23401).
class _EpfMonthlyCard extends StatelessWidget {
  const _EpfMonthlyCard({required this.monthly});

  final EpfMonthly monthly;

  @override
  Widget build(BuildContext context) {
    final rows = [
      ('You put in', monthly.employeePaise),
      ('Employer puts in', monthly.employerEpfPaise),
      if (monthly.employerEpsPaise > 0)
        ('Employer to pension (EPS)', monthly.employerEpsPaise),
    ];
    return _EarningsCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      radius: 18,
      children: [
        for (final (index, (label, paise)) in rows.indexed) ...[
          if (index > 0) const _EpfHairline(),
          ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 46),
            child: Row(
              children: [
                Expanded(child: Text(label, style: _Er.lineLabel)),
                const SizedBox(width: 12),
                Text(
                  _rupees(paise),
                  key: ValueKey('epf-monthly-$index'),
                  style: _Er.lineValue,
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

enum _EpfoLink {
  passbook(
    name: 'Passbook',
    sub: 'See every PF credit and interest',
    title: 'Open EPFO passbook',
    url: _epfoPassbook,
  ),
  nominee(
    name: 'Nominee',
    sub: 'Add or change who gets your PF',
    title: 'Update nominee on EPFO',
    url: _epfoMemberPortal,
  ),
  transfer(
    name: 'Transfer an old PF account',
    sub: 'Move PF from a previous employer',
    title: 'Transfer PF on EPFO',
    url: _epfoMemberPortal,
  );

  const _EpfoLink({
    required this.name,
    required this.sub,
    required this.title,
    required this.url,
  });

  final String name;
  final String sub;
  final String title;
  final String url;
}

/// A "Manage on EPFO" row (Figma 4506:23416): title, grey line, and the
/// external-link mark.
class _EpfoRow extends StatelessWidget {
  const _EpfoRow({required this.link, required this.onTap});

  final _EpfoLink link;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    key: ValueKey('epf-link-${link.name}'),
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(link.name, style: _Er.monthTitle),
                const SizedBox(height: 3),
                Text(link.sub, style: _Er.monthSub),
              ],
            ),
          ),
          const SizedBox(width: 12),
          SvgPicture.asset(
            'assets/icons/payroll_epf_external.svg',
            width: 18,
            height: 18,
          ),
        ],
      ),
    ),
  );
}

/// "This opens on the EPFO website …", the UAN to copy, and the way out to
/// EPFO. Pops true when the person chose to add their balance instead.
class _EpfoSheet extends StatefulWidget {
  const _EpfoSheet({required this.link, required this.uan});

  final _EpfoLink link;
  final String? uan;

  @override
  State<_EpfoSheet> createState() => _EpfoSheetState();
}

class _EpfoSheetState extends State<_EpfoSheet> {
  bool _copied = false;

  Future<void> _copy() async {
    final uan = widget.uan;
    if (uan == null) return;
    await Clipboard.setData(ClipboardData(text: uan));
    if (mounted) setState(() => _copied = true);
  }

  Future<void> _continue() async {
    final navigator = Navigator.of(context);
    var opened = false;
    try {
      opened = await payrollOpenExternal(Uri.parse(widget.link.url));
    } catch (_) {
      opened = false;
    }
    if (!mounted) return;
    if (!opened) {
      showAppToast(context, 'Couldn\'t open the EPFO website. Try again.');
      return;
    }
    navigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    final uan = widget.uan;
    return _PrSheet(
      title: widget.link.title,
      subtitle:
          'This opens on the EPFO website. Log in with your UAN, password '
          'and the OTP sent to your phone.',
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
          decoration: BoxDecoration(
            color: const Color(0xFFF7F7F9),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Your UAN', style: _PrText.sub),
                    const SizedBox(height: 2),
                    Text(
                      uan == null ? 'Not on record yet' : _uanText(uan),
                      key: const ValueKey('epf-sheet-uan'),
                      style: const TextStyle(
                        fontFamily: 'Sora',
                        fontFamilyFallback: _soraFallback,
                        color: Color(0xFF111827),
                        fontSize: 17,
                        height: 24 / 17,
                        letterSpacing: .4,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              if (uan != null)
                Semantics(
                  button: true,
                  child: Material(
                    color: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(11),
                      side: const BorderSide(color: _prBlue, width: 1.5),
                    ),
                    child: InkWell(
                      key: const ValueKey('epf-copy-uan'),
                      onTap: _copy,
                      borderRadius: BorderRadius.circular(11),
                      child: Container(
                        height: 38,
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        alignment: Alignment.center,
                        child: Text(
                          _copied ? 'Copied' : 'Copy',
                          style: const TextStyle(
                            color: _prBlue,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        if (uan == null) ...[
          const SizedBox(height: 8),
          const Text(
            'Ask HR to add your UAN: you log in on EPFO with it.',
            style: _PrText.caption,
          ),
        ],
        const SizedBox(height: 20),
        KeyedSubtree(
          key: const ValueKey('epf-continue'),
          child: _PrButton(label: 'Continue to EPFO', onPressed: _continue),
        ),
        if (widget.link == _EpfoLink.passbook) ...[
          const SizedBox(height: 8),
          Center(
            child: InkWell(
              key: const ValueKey('epf-sheet-add-balance'),
              onTap: () => Navigator.of(context).pop(true),
              borderRadius: BorderRadius.circular(8),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 10,
                ),
                child: Text(
                  'Copied your balance? Add it to Sowaka',
                  style: _PrText.link.copyWith(fontSize: 13),
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

/// The balance from the EPFO passbook and the date it is as on. Pops the
/// page as it reads once saved.
class _EpfBalanceSheet extends StatefulWidget {
  const _EpfBalanceSheet({required this.api, this.current});

  final PayrollApiService api;
  final EpfBalance? current;

  @override
  State<_EpfBalanceSheet> createState() => _EpfBalanceSheetState();
}

class _EpfBalanceSheetState extends State<_EpfBalanceSheet> {
  late final _amount = TextEditingController(
    text: _RupeeInputFormatter.format(
      ((widget.current?.balancePaise ?? 0) / 100).round(),
    ),
  )..addListener(() => setState(() {}));
  late DateTime _asOn = widget.current?.asOn ?? _dateOnly(DateTime.now());
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  int get _amountPaise => _RupeeInputFormatter.parse(_amount.text) * 100;

  Future<void> _pickDate() async {
    final today = _dateOnly(DateTime.now());
    final picked = await showDatePicker(
      context: context,
      initialDate: _asOn.isAfter(today) ? today : _asOn,
      firstDate: DateTime(1990),
      lastDate: today,
      helpText: 'Balance as on',
    );
    if (picked != null && mounted) setState(() => _asOn = picked);
  }

  Future<void> _save() async {
    if (_amountPaise <= 0 || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final navigator = Navigator.of(context);
    try {
      final updated = await widget.api.saveEpfBalance(
        balancePaise: _amountPaise,
        asOn: _asOn,
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

  @override
  Widget build(BuildContext context) {
    const label = TextStyle(
      color: Color(0xFF2A2A2A),
      fontSize: 12,
      fontWeight: FontWeight.w600,
    );
    OutlineInputBorder border(Color color, [double width = 1]) =>
        OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: color, width: width),
        );
    return _PrSheet(
      title: widget.current == null
          ? 'Add your PF balance'
          : 'Update PF balance',
      subtitle:
          'Copy the total from your EPFO passbook and the date it is as on. '
          'Sowaka adds the PF from your payslips after that date.',
      children: [
        const Text('Balance', style: label),
        const SizedBox(height: 8),
        TextField(
          key: const ValueKey('epf-balance-amount'),
          controller: _amount,
          keyboardType: TextInputType.number,
          inputFormatters: const [_RupeeInputFormatter()],
          style: const TextStyle(fontSize: 13, color: Color(0xFF2A2A2A)),
          decoration: InputDecoration(
            hintText: '₹0',
            filled: true,
            fillColor: Colors.white,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 15,
              vertical: 13,
            ),
            border: border(const Color(0xFFDDDDDD)),
            enabledBorder: border(const Color(0xFFDDDDDD)),
            focusedBorder: border(_prBlue, 1.5),
          ),
        ),
        const SizedBox(height: 16),
        const Text('As on', style: label),
        const SizedBox(height: 8),
        InkWell(
          key: const ValueKey('epf-balance-date'),
          onTap: _pickDate,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
            decoration: BoxDecoration(
              border: Border.all(color: const Color(0xFFDDDDDD)),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    _longDate(_asOn),
                    style: const TextStyle(
                      fontSize: 13,
                      color: Color(0xFF2A2A2A),
                    ),
                  ),
                ),
                const Icon(
                  Icons.calendar_today_rounded,
                  size: 16,
                  color: Color(0xFF9CA3AF),
                ),
              ],
            ),
          ),
        ),
        if (_error case final error?) ...[
          const SizedBox(height: 10),
          Text(
            error,
            style: const TextStyle(
              color: _prError,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
        const SizedBox(height: 26),
        KeyedSubtree(
          key: const ValueKey('epf-balance-save'),
          child: _PrButton(
            label: 'Save balance',
            busy: _busy,
            onPressed: _amountPaise <= 0 || _busy ? null : _save,
          ),
        ),
      ],
    );
  }
}
