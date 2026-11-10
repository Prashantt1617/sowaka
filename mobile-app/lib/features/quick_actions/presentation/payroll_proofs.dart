part of 'quick_actions_screen.dart';

// ---------------------------------------------------------------- proofs

/// Investment proofs: one file per declared investment, and where each
/// stands with HR.
class _ProofsPage extends StatefulWidget {
  const _ProofsPage();

  @override
  State<_ProofsPage> createState() => _ProofsPageState();
}

class _ProofsPageState extends State<_ProofsPage> {
  InvestmentProofs? _proofs;
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
      final proofs = await _PayrollScope.of(context).api.fetchProofs();
      if (mounted) setState(() => _proofs = proofs);
    } catch (error) {
      if (mounted) setState(() => _error = payrollErrorText(error));
    }
  }

  static String _sectionTitle(String section) => switch (section) {
    '80C' => '80C',
    '80CCD1B' => 'NPS (80CCD 1B)',
    '80D' => '80D',
    'HRA' => 'Rent (HRA)',
    '24B' => 'Home loan',
    _ => section,
  };

  Future<void> _upload(InvestmentProofItem item) async {
    final proofs = _proofs;
    if (proofs == null) return;
    final scope = _PayrollScope.of(context);
    final updated = await showModalBottomSheet<InvestmentProofItem>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ProofUploadSheet(
        item: item,
        fy: proofs.fy,
        api: scope.api,
        pickFile: scope.pickFile ?? _pickProofFile,
      ),
    );
    if (updated == null || !mounted) return;
    setState(() => _proofs = _proofs?.replacing(updated));
    showAppToast(context, 'Proof sent for review');
  }

  Future<void> _view(InvestmentProofItem item) async {
    final proof = item.proof;
    if (proof == null) return;
    String? url;
    try {
      url = await _PayrollScope.of(context).api.proofFileUrl(item.item);
    } catch (_) {
      // The details still show; only the file link is missing.
    }
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => _PrSheet(
        title: item.label,
        subtitle: item.status == ProofStatus.approved
            ? 'Approved'
            : 'In review',
        children: [
          RequestSummaryBody(
            showSuccess: false,
            summary: RequestSummary(
              screenTitle: item.label,
              successTitle: '',
              successBody: '',
              rows: [
                SummaryRow('Amount on proof', _rupees(proof.amountPaise)),
                if (proof.uploadedAt != null)
                  SummaryRow('Uploaded', _longDate(proof.uploadedAt!)),
                if (item.status == ProofStatus.approved &&
                    proof.decidedAt != null)
                  SummaryRow('Approved', _longDate(proof.decidedAt!)),
              ],
              documentName: proof.fileName,
              documentUrl: url == null || url.isEmpty ? null : url,
            ),
          ),
          const SizedBox(height: 20),
          _PrButton(
            label: 'Close',
            onPressed: () => Navigator.of(sheetContext).pop(),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final proofs = _proofs;
    final sections = <String, List<InvestmentProofItem>>{};
    for (final item in proofs?.items ?? const <InvestmentProofItem>[]) {
      (sections[item.section] ??= []).add(item);
    }
    final toUpload = proofs?.count(ProofStatus.notUploaded) ?? 0;
    final rejected = proofs?.count(ProofStatus.rejected) ?? 0;
    return _payrollPage(
      context,
      key: const ValueKey('payroll-proofs'),
      title: 'Investment proofs',
      children: [
        if (proofs == null && _error == null)
          const _PrLoading()
        else if (proofs == null)
          _PrError(_error!, onRetry: _load)
        else if (!proofs.required || proofs.items.isEmpty)
          _HubEmptyState(
            iconAsset: 'assets/icons/leave_year_approved_badge.png',
            // Nothing to prove has two reasons: the new regime, or an old
            // regime with nothing declared above zero.
            text: proofs.regime == 'old'
                ? 'Nothing declared that needs a proof. Declare your '
                      'investments under Tax to upload proofs for them.'
                : 'No proofs needed — you are on the new regime.',
          )
        else ...[
          _PrNote(
            proofs.locked
                ? 'The last date to upload proofs has passed.'
                : proofs.dueOn == null
                ? 'Upload a proof for each investment you declared.'
                : 'Last date to upload all proofs is ${_short(proofs.dueOn!)}.',
            bold: proofs.dueOn == null ? null : _short(proofs.dueOn!),
          ),
          const SizedBox(height: 10),
          Text(
            toUpload + rejected == 0
                ? (proofs.count(ProofStatus.approved) == proofs.items.length
                      ? 'All proofs approved'
                      : 'All proofs sent for review')
                : [
                    if (toUpload > 0) '$toUpload to upload',
                    if (rejected > 0) '$rejected to re-upload',
                  ].join(' · '),
            key: const ValueKey('proofs-summary'),
            style: _PrText.caption.copyWith(
              fontWeight: FontWeight.w600,
              color: toUpload + rejected == 0 ? _prGreen : _prError,
            ),
          ),
          const SizedBox(height: 12),
          for (final entry in sections.entries) ...[
            _FormCard(
              children: [
                Text(
                  _sectionTitle(entry.key),
                  style: _PrText.title.copyWith(fontWeight: FontWeight.w700),
                ),
                for (final item in entry.value) ...[
                  const Divider(
                    height: 20,
                    thickness: 1,
                    color: Color(0xFFF3F4F6),
                  ),
                  _ProofRow(
                    item: item,
                    locked: proofs.locked,
                    onUpload: () => _upload(item),
                    onView: () => _view(item),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 12),
          ],
        ],
      ],
    );
  }
}

class _ProofRow extends StatelessWidget {
  const _ProofRow({
    required this.item,
    required this.locked,
    required this.onUpload,
    required this.onView,
  });

  final InvestmentProofItem item;
  final bool locked;
  final VoidCallback onUpload;
  final VoidCallback onView;

  @override
  Widget build(BuildContext context) {
    final rejected = item.status == ProofStatus.rejected;
    final trailing = switch (item.status) {
      ProofStatus.notUploaded when !locked => _OutlineAction(
        key: ValueKey('proof-upload-${item.item}'),
        label: 'Upload',
        onTap: onUpload,
      ),
      ProofStatus.notUploaded => const _PrPill(
        'Not uploaded',
        color: Color(0xFF6B7280),
        tint: Color(0xFFF3F4F6),
      ),
      ProofStatus.uploaded => InkWell(
        key: ValueKey('proof-view-${item.item}'),
        onTap: onView,
        borderRadius: BorderRadius.circular(99),
        child: _PrPill('In review', color: _Q.gold, tint: _Q.goldTint),
      ),
      ProofStatus.approved => InkWell(
        key: ValueKey('proof-view-${item.item}'),
        onTap: onView,
        borderRadius: BorderRadius.circular(99),
        child: const _PrPill('Approved', color: _prGreen, tint: _prGreenTint),
      ),
      ProofStatus.rejected => const _PrPill(
        'Rejected',
        color: _prRed,
        tint: _prRedTint,
      ),
    };
    return Column(
      key: ValueKey('proof-${item.item}'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.label,
                    style: _PrText.row.copyWith(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    item.item == 'rentMonthly'
                        ? '${_rupees(item.declaredPaise)} a month'
                        : _rupees(item.declaredPaise),
                    style: _PrText.sub,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            trailing,
          ],
        ),
        if (rejected) ...[
          if (item.proof?.reason case final reason? when reason.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              reason,
              style: const TextStyle(
                color: _prRed,
                fontSize: 12.5,
                height: 1.4,
              ),
            ),
          ],
          if (!locked) ...[
            const SizedBox(height: 10),
            SizedBox(
              height: 42,
              child: FilledButton(
                key: ValueKey('proof-reupload-${item.item}'),
                onPressed: onUpload,
                style: FilledButton.styleFrom(
                  backgroundColor: _prBlue,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  textStyle: const TextStyle(
                    fontFamily: 'Plus Jakarta Sans',
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                child: const Text('Re-upload proof'),
              ),
            ),
          ],
        ],
      ],
    );
  }
}

/// The header's Apply button turned outline: the brand blue on white.
class _OutlineAction extends StatelessWidget {
  const _OutlineAction({super.key, required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(16),
      side: const BorderSide(color: _prBlue, width: 1.2),
    ),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
        child: Text(
          label,
          style: const TextStyle(
            fontFamily: 'Sora',
            color: _prBlue,
            fontSize: 12,
            height: 16.2 / 12,
            letterSpacing: -0.16,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    ),
  );
}

/// A bottom sheet in the correction sheet's frame: white, round top, the
/// handle, a title and a line under it.
class _PrSheet extends StatelessWidget {
  const _PrSheet({
    required this.title,
    required this.subtitle,
    required this.children,
  });

  final String title;
  final String subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    padding: EdgeInsets.fromLTRB(
      16,
      12,
      16,
      24 + MediaQuery.viewInsetsOf(context).bottom,
    ),
    decoration: const BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
    ),
    child: SafeArea(
      top: false,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _SheetHandle(),
            const SizedBox(height: 12),
            Text(
              title,
              style: const TextStyle(
                color: Color(0xFF2A2A2A),
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              subtitle,
              style: const TextStyle(color: Color(0xFF6A6A6A), fontSize: 14),
            ),
            const SizedBox(height: 20),
            ...children,
          ],
        ),
      ),
    ),
  );
}

class _ProofUploadSheet extends StatefulWidget {
  const _ProofUploadSheet({
    required this.item,
    required this.fy,
    required this.api,
    required this.pickFile,
  });

  final InvestmentProofItem item;
  final String fy;
  final PayrollApiService api;
  final PayrollFilePicker pickFile;

  @override
  State<_ProofUploadSheet> createState() => _ProofUploadSheetState();
}

class _ProofUploadSheetState extends State<_ProofUploadSheet> {
  late final _amount = TextEditingController(
    text: _RupeeInputFormatter.format(
      (widget.item.declaredPaise / 100).round(),
    ),
  )..addListener(() => setState(() {}));
  PayrollUpload? _file;
  bool _busy = false;
  String? _error;

  static String _document(String item) => switch (item) {
    'ppf' => 'Passbook or statement',
    'elss' => 'Account statement',
    'lifeInsurance' => 'Premium receipt',
    'healthSelf' || 'healthParents' => 'Premium receipt',
    'nps' => 'NPS contribution statement',
    'rentMonthly' => 'Rent receipts',
    'homeLoanInterest' => 'Interest certificate from the bank',
    _ => 'Receipt or certificate',
  };

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  int get _amountPaise => _RupeeInputFormatter.parse(_amount.text) * 100;

  Future<void> _pick() async {
    final file = await widget.pickFile(context);
    if (file != null && mounted) setState(() => _file = file);
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
      final updated = await widget.api.uploadProof(
        item: widget.item.item,
        file: file,
        amountPaise: _amountPaise,
        fy: widget.fy,
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
    final item = widget.item;
    final file = _file;
    const label = TextStyle(
      color: Color(0xFF2A2A2A),
      fontSize: 12,
      fontWeight: FontWeight.w600,
    );
    return _PrSheet(
      title: item.status == ProofStatus.rejected
          ? 'Re-upload proof'
          : 'Upload proof',
      subtitle: '${item.label} · ${_document(item.item)}',
      children: [
        const Text('Proof', style: label),
        const SizedBox(height: 8),
        if (file == null)
          InkWell(
            key: const ValueKey('proof-pick'),
            onTap: _pick,
            borderRadius: BorderRadius.circular(12),
            child: CustomPaint(
              foregroundPainter: const _DashedRoundRectPainter(
                color: Color(0xFFD1D5DB),
                radius: 12,
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 20),
                child: Column(
                  children: [
                    SvgPicture.asset(
                      'assets/icons/upload_receipt.svg',
                      width: 20,
                      height: 20,
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Add a photo or PDF',
                      style: TextStyle(
                        color: Color(0xFF2A2A2A),
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    const Text(
                      'Up to 5 MB. Make sure the amount and date can be read.',
                      style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12),
                    ),
                  ],
                ),
              ),
            ),
          )
        else
          Container(
            key: const ValueKey('proof-file'),
            padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
            decoration: BoxDecoration(
              border: Border.all(color: const Color(0xFFE5E7EB)),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                _IconTile(
                  icon: file.name.toLowerCase().endsWith('.pdf')
                      ? Icons.picture_as_pdf_rounded
                      : Icons.image_rounded,
                  color: _prBlue,
                  tint: _prBlueTint,
                  size: 36,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        file.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFF111827),
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        '${(file.size / 1024).ceil()} KB',
                        style: const TextStyle(
                          color: Color(0xFF6B7280),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Remove file',
                  onPressed: _busy ? null : () => setState(() => _file = null),
                  icon: const Icon(
                    Icons.close_rounded,
                    size: 18,
                    color: Color(0xFF6B7280),
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 16),
        const Text('Amount on proof', style: label),
        const SizedBox(height: 8),
        TextField(
          key: const ValueKey('proof-amount'),
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
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: Color(0xFFDDDDDD)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: Color(0xFFDDDDDD)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: _prBlue, width: 1.5),
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
        _PrButton(
          label: 'Submit for review',
          busy: _busy,
          onPressed: file == null || _amountPaise <= 0 || _busy
              ? null
              : _submit,
        ),
      ],
    );
  }
}

/// The system picker, for a PDF, JPEG or PNG of at most 5 MB.
Future<PayrollUpload?> _pickProofFile(BuildContext context) async {
  try {
    final result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png'],
      withData: true,
    );
    if (result == null || result.files.isEmpty || !context.mounted) {
      return null;
    }
    final file = result.files.single;
    final bytes = file.bytes;
    if (file.size > PayrollApiService.maxProofBytes) {
      showAppToast(context, 'Choose a file smaller than 5 MB.');
      return null;
    }
    if (bytes == null) {
      showAppToast(context, 'Could not read the selected file.');
      return null;
    }
    return PayrollUpload(name: file.name, bytes: bytes);
  } catch (_) {
    if (context.mounted) {
      showAppToast(context, 'Could not open the file picker.');
    }
    return null;
  }
}
