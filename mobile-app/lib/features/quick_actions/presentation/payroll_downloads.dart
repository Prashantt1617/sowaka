part of 'quick_actions_screen.dart';

// ---------------------------------------------------------------- downloads

/// Hands a finished PDF to the person: the share sheet, as a payslip's
/// "Download payslip" does. Tests hand in their own ([PayrollDownloadsScreen]).
typedef PayrollPdfSaver =
    Future<void> Function(Uint8List bytes, String fileName);

Future<void> _sharePdf(Uint8List bytes, String fileName) =>
    Printing.sharePdf(bytes: bytes, filename: fileName);

class _DownloadsHooks extends InheritedWidget {
  const _DownloadsHooks({required this.savePdf, required super.child});

  final PayrollPdfSaver savePdf;

  static PayrollPdfSaver saverOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_DownloadsHooks>()?.savePdf ??
      _sharePdf;

  @override
  bool updateShouldNotify(_DownloadsHooks old) => savePdf != old.savePdf;
}

/// Downloads on its own, outside Payroll's home, with [payroll]'s service and
/// callbacks: for tests and previews.
@visibleForTesting
class PayrollDownloadsScreen extends StatelessWidget {
  const PayrollDownloadsScreen({
    super.key,
    required this.payroll,
    this.startTab,
    this.savePdf,
    this.form16 = false,
  });

  final PayrollScreen payroll;

  /// "payslips" (the default) or "form16".
  final String? startTab;
  final PayrollPdfSaver? savePdf;

  /// The company shows Form 16 in the app ([PayrollHome.form16Enabled]).
  final bool form16;

  @override
  Widget build(BuildContext context) => _PayrollScope(
    screen: payroll,
    child: _DownloadsHooks(
      savePdf: savePdf ?? _sharePdf,
      child: Navigator(
        onGenerateRoute: (_) => MaterialPageRoute<void>(
          builder: (_) => _DownloadsPage(startTab: startTab, form16: form16),
        ),
      ),
    ),
  );
}

/// Payroll › Downloads: every released payslip as a PDF, a year's in one
/// file, and the Form 16 HR filed for each financial year.
///
/// Payslip PDFs are drawn on the phone ([buildPayslipPdf]), as the payslip
/// page's own download is; Form 16 is a file HR uploaded, fetched through a
/// short-lived link.
///
/// Form 16 is there only when the company shows it in the app ([form16],
/// from [PayrollHome.form16Enabled] or [TaxSummary.form16Enabled]): Sowaka
/// switches it on per company. Without it the page is payslips alone, with
/// no tabs, and never asks for Form 16.
class _DownloadsPage extends StatefulWidget {
  const _DownloadsPage({this.startTab, this.form16 = false});

  /// "payslips" (the default) or "form16".
  final String? startTab;

  /// The company shows Form 16 in the app.
  final bool form16;

  @override
  State<_DownloadsPage> createState() => _DownloadsPageState();
}

class _DownloadsPageState extends State<_DownloadsPage> {
  late bool _form16 = widget.form16 && widget.startTab == 'form16';

  Future<(PayslipCompany, List<Payslip>)>? _payslips;
  Future<Form16Overview>? _form16s;

  /// What is being prepared: a slip id, `fy:<fy>` for a year's slips, or a
  /// Form 16 document id.
  String? _busy;

  PayrollApiService get _api => _PayrollScope.of(context).api;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _load();
  }

  /// Reads the open tab's list the first time it is shown.
  void _load() {
    if (_form16) {
      _form16s ??= _api.fetchForm16();
    } else {
      // Two years' worth: the whole of this FY and of the last.
      _payslips ??= _api.fetchPayslips(limit: 24);
    }
  }

  void _pick(bool form16) {
    if (form16 == _form16 || (form16 && !widget.form16)) return;
    setState(() {
      _form16 = form16;
      _load();
    });
  }

  void _retry() => setState(() {
    if (_form16) {
      _form16s = null;
    } else {
      _payslips = null;
    }
    _load();
  });

  Future<void> _prepare(
    String key,
    Future<(Uint8List, String)> Function() build,
    String failed,
  ) async {
    if (_busy != null) return;
    final save = _DownloadsHooks.saverOf(context);
    setState(() => _busy = key);
    try {
      final (bytes, name) = await build();
      await save(bytes, name);
    } catch (error) {
      if (mounted) {
        showAppToast(
          context,
          error is PayrollApiException ? error.message : failed,
        );
      }
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  void _downloadSlip(Payslip slip, PayslipCompany company) => _prepare(
    slip.id,
    () async => (
      await buildPayslipPdf(slip: slip, company: company),
      'payslip-${slip.period}.pdf',
    ),
    'Could not prepare the payslip. Try again.',
  );

  void _downloadYear(
    String fy,
    List<Payslip> slips,
    PayslipCompany company,
  ) => _prepare(
    'fy:$fy',
    () async => (
      await buildPayslipsPdf(
        // Oldest first, as a year reads.
        slips: slips.reversed.toList(),
        company: company,
        title: 'Payslips · ${slips.first.employeeName} · ${payrollFyLabel(fy)}',
      ),
      'payslips-FY$fy.pdf',
    ),
    'Could not prepare the payslips. Try again.',
  );

  void _downloadForm16(Form16Document document) => _prepare(
    document.id,
    () => _api.downloadForm16(document),
    'Could not download the Form 16. Try again.',
  );

  Future<void> _chooseForm16(Form16Year year) async {
    if (year.documents.length == 1) {
      return _downloadForm16(year.documents.first);
    }
    final picked = await showModalBottomSheet<Form16Document>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => _PrSheet(
        title: 'Form 16 · ${payrollFyLabel(year.fy)}',
        subtitle: 'HR filed it as separate parts. Download each one.',
        children: [
          _FormCard(
            children: [
              for (final (index, document) in year.documents.indexed) ...[
                if (index > 0) const _DownloadsDivider(),
                _DownloadRow(
                  key: ValueKey('form16-part-${document.id}'),
                  title: _partTitle(document.part),
                  subtitle: 'PDF',
                  label: 'Download ${_partTitle(document.part)}',
                  onDownload: () => Navigator.of(sheetContext).pop(document),
                ),
              ],
            ],
          ),
        ],
      ),
    );
    if (picked != null && mounted) _downloadForm16(picked);
  }

  static String _partTitle(String part) => switch (part) {
    'A' => 'Part A',
    'B' => 'Part B',
    _ => 'Part A and Part B',
  };

  @override
  Widget build(BuildContext context) {
    final raiseTicket = _PayrollScope.of(context).onRaiseTicket;
    return _payrollPage(
      context,
      key: const ValueKey('payroll-downloads'),
      title: 'Downloads',
      children: [
        if (widget.form16) ...[
          LeaveViewSwitch(
            key: const ValueKey('downloads-tabs'),
            history: _form16,
            firstLabel: 'Payslips',
            secondLabel: 'Form 16',
            onChanged: _pick,
          ),
          const SizedBox(height: 16),
        ],
        if (_form16) _form16Tab() else _payslipsTab(),
        if (raiseTicket != null || canRaiseSupportTicket) ...[
          const SizedBox(height: 16),
          Center(
            child: InkWell(
              key: const ValueKey('downloads-raise-ticket'),
              // Straight to a new Support Desk ticket, else the desk.
              onTap: () {
                if (!raiseSupportTicket(
                  about: _form16
                      ? 'I can\'t find my Form 16:'
                      : 'I can\'t find a payslip:',
                )) {
                  raiseTicket?.call();
                }
              },
              borderRadius: BorderRadius.circular(8),
              child: const Padding(
                padding: EdgeInsets.symmetric(horizontal: 8, vertical: 12),
                child: Text(
                  'Can\'t find a document? Raise a ticket',
                  style: _PrText.link,
                ),
              ),
            ),
          ),
        ],
        const SizedBox(height: 24),
      ],
    );
  }

  // ------------------------------------------------------------ payslips

  Widget _payslipsTab() => FutureBuilder<(PayslipCompany, List<Payslip>)>(
    future: _payslips,
    builder: (context, snapshot) {
      if (snapshot.hasError) {
        return _PrError(payrollErrorText(snapshot.error!), onRetry: _retry);
      }
      if (!snapshot.hasData) return const _PrLoading();
      final (company, all) = snapshot.data!;
      // One slip a month (a month paid twice keeps its newest), by FY.
      final seen = <String>{};
      final years = <String, List<Payslip>>{};
      for (final slip in all) {
        final month = payrollMonth(slip.period);
        if (month == null || !seen.add(slip.period)) continue;
        (years[payrollFyOf(month)] ??= []).add(slip);
      }
      if (years.isEmpty) {
        return const _HubEmptyState(
          iconAsset: 'assets/icons/request_reimbursement_money.png',
          text:
              'No payslips yet — they appear here once payroll has run for '
              'you.',
        );
      }
      final fys = years.keys.toList()..sort((a, b) => b.compareTo(a));
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (index, fy) in fys.indexed) ...[
            if (index > 0) const SizedBox(height: 24),
            _HomeSectionLabel(payrollFyLabel(fy)),
            const SizedBox(height: 12),
            _FormCard(
              children: [
                for (final (i, slip) in years[fy]!.indexed) ...[
                  if (i > 0) const _DownloadsDivider(),
                  _DownloadRow(
                    key: ValueKey('download-slip-${slip.id}'),
                    title: _periodLabel(slip.period),
                    subtitle:
                        '${slip.paidAt == null ? 'Released' : 'Credited ${_short(slip.paidAt!)}'}'
                        ' · PDF',
                    label: 'Download ${_periodLabel(slip.period)} payslip',
                    busy: _busy == slip.id,
                    onDownload: () => _downloadSlip(slip, company),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 14),
            _DownloadAllButton(
              key: ValueKey('download-all-$fy'),
              // The newest year is "all"; an older one names itself.
              label: index == 0
                  ? 'Download all as one PDF'
                  : 'Download ${payrollFyLabel(fy)} as one PDF',
              busy: _busy == 'fy:$fy',
              onPressed: () => _downloadYear(fy, years[fy]!, company),
            ),
          ],
        ],
      );
    },
  );

  // ------------------------------------------------------------ Form 16

  Widget _form16Tab() => FutureBuilder<Form16Overview>(
    future: _form16s,
    builder: (context, snapshot) {
      if (snapshot.hasError) {
        return _PrError(payrollErrorText(snapshot.error!), onRetry: _retry);
      }
      if (!snapshot.hasData) return const _PrLoading();
      final overview = snapshot.data!;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (overview.filingFy case final fy?)
            if (overview.filingLastDate case final last?) ...[
              _DownloadsTip(fy: fy, lastDate: last),
              const SizedBox(height: 16),
            ],
          if (overview.years.isEmpty)
            const _HubEmptyState(
              iconAsset: 'assets/icons/request_reimbursement_money.png',
              text:
                  'No Form 16 yet — HR adds it here after the financial '
                  'year ends, by 15 June.',
            )
          else
            _FormCard(
              children: [
                for (final (index, year) in overview.years.indexed) ...[
                  if (index > 0) const _DownloadsDivider(),
                  _form16Row(year),
                ],
              ],
            ),
        ],
      );
    },
  );

  Widget _form16Row(Form16Year year) {
    final key = ValueKey('form16-${year.fy}');
    final title = payrollFyLabel(year.fy);
    if (year.status != Form16Status.ready || year.documents.isEmpty) {
      final readyBy = year.readyBy;
      return Opacity(
        key: key,
        opacity: .55,
        child: _DownloadRow(
          title: title,
          subtitle: year.status == Form16Status.missing
              ? 'Not added by HR yet'
              : readyBy == null
              ? 'Not ready yet'
              : 'Ready by ${_longDate(readyBy)}',
        ),
      );
    }
    final parts = year.complete
        ? 'Part A and Part B'
        : year.documents.map((d) => _partTitle(d.part)).join(' and ');
    return _DownloadRow(
      key: key,
      title: title,
      subtitle: '$parts · PDF',
      label: 'Download Form 16 for $title',
      busy: year.documents.any((d) => d.id == _busy),
      onDownload: () => _chooseForm16(year),
    );
  }
}

/// "You need Form 16 to file your income tax return…": the tip over the
/// years, with the return's last date for the FY that ended last.
class _DownloadsTip extends StatelessWidget {
  const _DownloadsTip({required this.fy, required this.lastDate});

  final String fy;
  final DateTime lastDate;

  @override
  Widget build(BuildContext context) {
    final date = _longDate(lastDate);
    final past = _dateOnly(DateTime.now()).isAfter(lastDate);
    const style = TextStyle(
      color: Color(0xFF166534),
      fontSize: 13,
      height: 1.45,
      fontWeight: FontWeight.w500,
    );
    return Container(
      key: const ValueKey('form16-tip'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _prGreenTint,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.lightbulb_outline_rounded,
            size: 18,
            color: _prGreen,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text.rich(
              TextSpan(
                style: style,
                children: [
                  TextSpan(
                    text:
                        'You need Form 16 to file your income tax return. '
                        'Last date to file for ${payrollFyLabel(fy)} '
                        '${past ? 'was' : 'is'} ',
                  ),
                  TextSpan(
                    text: date,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const TextSpan(text: '.'),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DownloadsDivider extends StatelessWidget {
  const _DownloadsDivider();

  @override
  Widget build(BuildContext context) =>
      const Divider(height: 1, thickness: 1, color: Color(0xFFF3F4F6));
}

/// A document: what it is, a line under it, and its download button (none
/// while it is not ready).
class _DownloadRow extends StatelessWidget {
  const _DownloadRow({
    super.key,
    required this.title,
    required this.subtitle,
    this.label,
    this.onDownload,
    this.busy = false,
  });

  final String title;
  final String subtitle;

  /// What the button says to a screen reader.
  final String? label;
  final VoidCallback? onDownload;
  final bool busy;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 12),
    child: Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: _PrText.title),
              const SizedBox(height: 2),
              Text(subtitle, style: _PrText.sub),
            ],
          ),
        ),
        if (onDownload != null) ...[
          const SizedBox(width: 12),
          Semantics(
            button: true,
            label: label ?? 'Download $title',
            child: Material(
              color: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: const BorderSide(color: _prBlue, width: 1.5),
              ),
              child: InkWell(
                onTap: busy ? null : onDownload,
                borderRadius: BorderRadius.circular(12),
                child: SizedBox(
                  width: 40,
                  height: 40,
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
                        : const ExcludeSemantics(
                            child: Icon(
                              Icons.download_rounded,
                              size: 20,
                              color: _prBlue,
                            ),
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

/// "Download all as one PDF": an outlined button under a year's payslips.
class _DownloadAllButton extends StatelessWidget {
  const _DownloadAllButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.busy = false,
  });

  final String label;
  final VoidCallback onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 46,
    child: OutlinedButton.icon(
      onPressed: busy ? null : onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: _prBlue,
        backgroundColor: Colors.white,
        side: const BorderSide(color: _prBlue, width: 1.5),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      icon: busy
          ? const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2, color: _prBlue),
            )
          : const Icon(Icons.download_rounded, size: 20),
      label: Text(
        busy ? 'Preparing…' : label,
        style: const TextStyle(
          fontFamily: 'Sora',
          fontFamilyFallback: _soraFallback,
          fontSize: 14,
          height: 20 / 14,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
  );
}
