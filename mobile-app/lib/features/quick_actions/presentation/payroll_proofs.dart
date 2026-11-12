part of 'quick_actions_screen.dart';

// ---------------------------------------------------------------- proofs

/// Investment proofs (Figma 4484:73360): the deadline, then one card per
/// declaration section with each declared item, its amount and where its
/// proof stands with HR. A rejected item turns its card pink, says why and
/// offers the re-upload. Past the due date the page is the closed state
/// (Figma 4484:73735): what never made it, and what can still be done.
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

  Future<void> _upload(InvestmentProofItem item) async {
    final proofs = _proofs;
    if (proofs == null) return;
    final scope = _PayrollScope.of(context);
    final updated = await showModalBottomSheet<InvestmentProofItem>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: const Color(0x73000000),
      builder: (_) => _ProofUploadSheet(
        item: item,
        fy: proofs.fy,
        api: scope.api,
        pickFile: scope.pickFile ?? _pickProofFile,
        takePhoto: payrollProofCamera,
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

  /// "Have the proofs now?": a Support Desk ticket to HR, already saying
  /// what it is about.
  void _askHr(InvestmentProofs proofs, InvestmentProofsClosed closed) {
    final month = closed.lastPayPeriod;
    final about =
        'My investment proofs for FY ${proofs.fy} weren\'t all submitted'
        '${closed.closedOn == null ? '' : ' by ${_short(closed.closedOn!)}'}. '
        'Can they still be accepted'
        '${month == null ? '' : ' for ${_monthName(month.month)} pay'}?';
    if (!raiseSupportTicket(about: about)) {
      _PayrollScope.of(context).onRaiseTicket?.call();
    }
  }

  List<Widget> _sectionCards(InvestmentProofs proofs, {required bool open}) => [
    for (final section in proofs.sections) ...[
      _ProofSectionCard(
        key: ValueKey('proof-section-${section.key}'),
        section: section,
        open: open,
        onUpload: _upload,
        onView: _view,
      ),
      const SizedBox(height: 12),
    ],
  ];

  @override
  Widget build(BuildContext context) {
    final proofs = _proofs;
    final closed = proofs?.closed;
    final scope = _PayrollScope.of(context);
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
        else if (closed != null) ...[
          _ProofsClosedCard(closed: closed),
          if (closed.counted case final counted?
              when counted.rows.isNotEmpty) ...[
            const SizedBox(height: 8),
            const _ProofsSectionLabel('What counted'),
            _ProofsCountedCard(counted: counted),
            const _ProofsReceiptEdge(),
          ],
          if (closed.notSubmitted > 0) ...[
            const SizedBox(height: 8),
            const _ProofsSectionLabel('What you can still do'),
            _ProofsAskHrCard(
              lastPayPeriod: closed.lastPayPeriod,
              onTap: canRaiseSupportTicket || scope.onRaiseTicket != null
                  ? () => _askHr(proofs, closed)
                  : null,
            ),
            const SizedBox(height: 8),
            _ProofsClaimBackCard(itrDueOn: closed.itrDueOn),
          ],
        ] else ...[
          if (proofs.notConfigured || proofs.dueOn == null) ...[
            // HR has not set the last date: nothing can go up yet, and no
            // date is made up in its place.
            const _ProofsBanner(
              key: ValueKey('proofs-not-set-up'),
              text:
                  'The last date for proofs is not set up yet, so they can\'t '
                  'be uploaded. Ask HR.',
              tone: _ProofsBannerTone.waiting,
            ),
            const RaiseTicketLink(
              about:
                  'The last date for investment proofs is not set up, so I '
                  'can\'t upload mine.',
            ),
          ] else
            _ProofsBanner(
              key: const ValueKey('proofs-deadline'),
              text:
                  'Last date to upload all proofs is ${_short(proofs.dueOn!)}.',
              bold: _short(proofs.dueOn!),
            ),
          const SizedBox(height: 12),
          ..._sectionCards(
            proofs,
            open:
                !proofs.locked && !proofs.notConfigured && proofs.dueOn != null,
          ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------- the list

/// The Sora weights the proofs designs use, with the app's face behind them
/// for the rupee sign.
TextStyle _proofType(
  double size, {
  FontWeight weight = FontWeight.w600,
  Color color = _proofInk,
  double? height,
  double letterSpacing = 0,
}) => TextStyle(
  fontFamily: 'Sora',
  fontFamilyFallback: _soraFallback,
  fontSize: size,
  fontWeight: weight,
  color: color,
  height: height,
  letterSpacing: letterSpacing,
);

const _proofInk = Color(0xFF1F1F22);
const _proofMuted = Color(0xFF55555C);

enum _ProofsBannerTone { deadline, waiting }

/// The tinted line at the top: "💡 Last date to upload all proofs is 31 Jan."
class _ProofsBanner extends StatelessWidget {
  const _ProofsBanner({
    super.key,
    required this.text,
    this.bold,
    this.tone = _ProofsBannerTone.deadline,
  });

  final String text;
  final String? bold;
  final _ProofsBannerTone tone;

  @override
  Widget build(BuildContext context) {
    final waiting = tone == _ProofsBannerTone.waiting;
    final color = waiting ? const Color(0xFF92400E) : const Color(0xFF065F46);
    final style = _proofType(13.5, color: color, height: 19.58 / 13.5);
    final emphasis = bold;
    final at = emphasis == null ? -1 : text.indexOf(emphasis);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: waiting ? const Color(0xFFFEF3C7) : const Color(0xFFECFDF5),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '💡',
            style: _proofType(
              13.5,
              weight: FontWeight.w400,
              color: color,
              height: 19.58 / 13.5,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: at < 0
                ? Text(text, style: style)
                : Text.rich(
                    TextSpan(
                      style: style,
                      children: [
                        TextSpan(text: text.substring(0, at)),
                        TextSpan(
                          text: emphasis,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        TextSpan(text: text.substring(at + emphasis!.length)),
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// A status on its soft chip: Approved, In review, Rejected, Closed.
class _ProofChip extends StatelessWidget {
  const _ProofChip(this.text, {required this.color, required this.tint});

  const _ProofChip.approved()
    : this(
        'Approved',
        color: const Color(0xFF15803D),
        tint: const Color(0xFFE7F8EC),
      );
  const _ProofChip.inReview()
    : this(
        'In review',
        color: const Color(0xFF92400E),
        tint: const Color(0xFFFEF3C7),
      );
  const _ProofChip.rejected()
    : this(
        'Rejected',
        color: const Color(0xFFB42318),
        tint: const Color(0xFFFDECEC),
      );
  const _ProofChip.quiet(String text)
    : this(text, color: _proofMuted, tint: const Color(0xFFEDEDF0));

  final String text;
  final Color color;
  final Color tint;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    decoration: BoxDecoration(
      color: tint,
      borderRadius: BorderRadius.circular(11.5),
    ),
    child: Text(
      text,
      style: _proofType(12, weight: FontWeight.w700, color: color),
    ),
  );
}

/// "Upload": brand blue on white, the height of the row's two lines.
class _ProofUploadButton extends StatelessWidget {
  const _ProofUploadButton({super.key, required this.onTap});

  final VoidCallback onTap;

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
      child: Container(
        height: 38,
        padding: const EdgeInsets.symmetric(horizontal: 15),
        alignment: Alignment.center,
        child: Text('Upload', style: _proofType(14, color: _prBlue)),
      ),
    ),
  );
}

/// A filled brand-blue button: "Re-upload proof" in a card, "Submit for
/// review" on the sheet.
class _ProofFilledButton extends StatelessWidget {
  const _ProofFilledButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.height = 44,
    this.radius = 12,
    this.fontSize = 14.5,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final double height;
  final double radius;
  final double fontSize;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final live = onPressed != null || busy;
    return Semantics(
      button: true,
      enabled: onPressed != null && !busy,
      label: label,
      child: Material(
        color: live ? _prBlue : const Color(0xFF96B7C7),
        borderRadius: BorderRadius.circular(radius),
        child: InkWell(
          onTap: busy ? null : onPressed,
          borderRadius: BorderRadius.circular(radius),
          child: SizedBox(
            height: height,
            width: double.infinity,
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
                      child: Text(
                        label,
                        style: _proofType(
                          fontSize,
                          color: Colors.white,
                          letterSpacing: fontSize >= 16 ? -0.16 : 0,
                        ),
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

/// One section's card: its title, then each declared item under a hairline.
/// A card with a rejected item turns pink.
class _ProofSectionCard extends StatelessWidget {
  const _ProofSectionCard({
    super.key,
    required this.section,
    required this.open,
    required this.onUpload,
    required this.onView,
  });

  final InvestmentProofSection section;

  /// Before the due date (and with one set): uploads are taken.
  final bool open;
  final ValueChanged<InvestmentProofItem> onUpload;
  final ValueChanged<InvestmentProofItem> onView;

  @override
  Widget build(BuildContext context) {
    // The rows bring their own side padding: a rejected one runs pink to the
    // card's edges (the canvas's `.it.rj`), clipped by its round corners.
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.only(top: 14, bottom: 4),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
            child: Text(
              section.label,
              style: _proofType(15, weight: FontWeight.w700),
            ),
          ),
          for (final item in section.items)
            _ProofRow(
              item: item,
              open: open,
              onUpload: () => onUpload(item),
              onView: () => onView(item),
            ),
        ],
      ),
    );
  }
}

class _ProofRow extends StatelessWidget {
  const _ProofRow({
    required this.item,
    required this.open,
    required this.onUpload,
    required this.onView,
  });

  final InvestmentProofItem item;
  final bool open;
  final VoidCallback onUpload;
  final VoidCallback onView;

  /// "₹50,000", or rent's "₹15,000 a month · Apr to Mar".
  static String amountLine(InvestmentProofItem item) {
    final amount = _rupees(item.declaredPaise);
    final monthly = item.perMonth || item.item == 'rentMonthly';
    if (!monthly) return amount;
    final from = item.monthsFrom;
    final to = item.monthsTo;
    return from == null || to == null
        ? '$amount a month'
        : '$amount a month · ${_shortMonthName(from.month)} to '
              '${_shortMonthName(to.month)}';
  }

  @override
  Widget build(BuildContext context) {
    final rejected = item.status == ProofStatus.rejected;
    final trailing = switch (item.status) {
      ProofStatus.notUploaded when open => _ProofUploadButton(
        key: ValueKey('proof-upload-${item.item}'),
        onTap: onUpload,
      ),
      ProofStatus.notUploaded => const _ProofChip.quiet('Not uploaded'),
      ProofStatus.uploaded => InkWell(
        key: ValueKey('proof-view-${item.item}'),
        onTap: onView,
        borderRadius: BorderRadius.circular(11.5),
        child: const _ProofChip.inReview(),
      ),
      ProofStatus.approved => InkWell(
        key: ValueKey('proof-view-${item.item}'),
        onTap: onView,
        borderRadius: BorderRadius.circular(11.5),
        child: const _ProofChip.approved(),
      ),
      ProofStatus.rejected => const _ProofChip.rejected(),
    };
    final reason = item.proof?.reason;
    const hairline = Border(top: BorderSide(color: Color(0xFFF1F1F4)));
    final body = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.label, style: _proofType(14.5)),
                  const SizedBox(height: 2),
                  Text(
                    amountLine(item),
                    style: _proofType(12.5, color: _proofMuted),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            trailing,
          ],
        ),
        if (rejected && reason != null && reason.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(
            reason,
            key: ValueKey('proof-reason-${item.item}'),
            style: _proofType(
              13.5,
              color: const Color(0xFF7A1F17),
              height: 20.25 / 13.5,
            ),
          ),
        ],
        if (rejected && open) ...[
          const SizedBox(height: 10),
          _ProofFilledButton(
            key: ValueKey('proof-reupload-${item.item}'),
            label: 'Re-upload proof',
            onPressed: onUpload,
          ),
        ],
      ],
    );
    if (rejected) {
      return Container(
        key: ValueKey('proof-${item.item}'),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: const BoxDecoration(
          color: _proofRejectedTint,
          border: hairline,
        ),
        child: body,
      );
    }
    return Padding(
      key: ValueKey('proof-${item.item}'),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        padding: const EdgeInsets.only(top: 13, bottom: 12),
        decoration: const BoxDecoration(border: hairline),
        child: body,
      ),
    );
  }
}

const _proofRejectedTint = Color(0xFFFFF7F7);

// ---------------------------------------------------------------- closed

/// A 40-point white tile with a picture in it, as the closed state's rows
/// lead with.
class _ProofsIconTile extends StatelessWidget {
  const _ProofsIconTile({
    required this.child,
    this.radius = 11,
    this.border = true,
    this.shadow = const BoxShadow(
      color: Color(0x0F000000),
      blurRadius: 3,
      offset: Offset(0, 2),
    ),
  });

  final Widget child;
  final double radius;
  final bool border;
  final BoxShadow shadow;

  @override
  Widget build(BuildContext context) => Container(
    width: 40,
    height: 40,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(radius),
      border: border ? Border.all(color: const Color(0xFFF0F0F2)) : null,
      boxShadow: [shadow],
    ),
    child: child,
  );
}

/// "Proofs closed on 31 Jan · 4 of 6 proofs weren't submitted · Closed".
class _ProofsClosedCard extends StatelessWidget {
  const _ProofsClosedCard({required this.closed});

  final InvestmentProofsClosed closed;

  @override
  Widget build(BuildContext context) {
    final missing = closed.notSubmitted;
    final line = missing == 0
        ? (closed.total == 1
              ? 'Your proof was submitted'
              : 'All ${closed.total} proofs were submitted')
        : '$missing of ${closed.total} '
              '${closed.total == 1 ? 'proof' : 'proofs'} '
              '${missing == 1 ? 'wasn’t' : 'weren’t'} submitted';
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        key: const ValueKey('proofs-closed'),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
        ),
        child: Row(
          children: [
            _ProofsIconTile(
              child: Image.asset(
                'assets/icons/payroll_proofs_lock.png',
                width: 25,
                height: 25,
                fit: BoxFit.cover,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    closed.closedOn == null
                        ? 'Proofs closed'
                        : 'Proofs closed on ${_short(closed.closedOn!)}',
                    style: _proofType(15, weight: FontWeight.w700),
                  ),
                  const SizedBox(height: 3),
                  Text(line, style: _proofType(12.5, color: _proofMuted)),
                ],
              ),
            ),
            const SizedBox(width: 12),
            const _ProofChip.quiet('Closed'),
          ],
        ),
      ),
    );
  }
}

/// The receipt's torn edge under the closed card.
class _ProofsReceiptEdge extends StatelessWidget {
  const _ProofsReceiptEdge();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: SizedBox(
      height: 12,
      width: double.infinity,
      child: Align(
        alignment: Alignment.topCenter,
        child: SvgPicture.asset(
          'assets/icons/payroll_proofs_zigzag.svg',
          width: double.infinity,
          height: 8,
          fit: BoxFit.fill,
        ),
      ),
    ),
  );
}

/// "WHAT YOU CAN STILL DO".
class _ProofsSectionLabel extends StatelessWidget {
  const _ProofsSectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 24, bottom: 12),
    child: Text(
      text.toUpperCase(),
      style: _proofType(13, color: const Color(0xFF8E8E95), letterSpacing: 0.8),
    ),
  );
}

/// The totals' rule: 1.5 points of dashes.
class _ProofsDashedLine extends StatelessWidget {
  const _ProofsDashedLine();

  @override
  Widget build(BuildContext context) => const SizedBox(
    height: 1.5,
    width: double.infinity,
    child: CustomPaint(painter: _ProofsDashPainter()),
  );
}

class _ProofsDashPainter extends CustomPainter {
  const _ProofsDashPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFFDCDCE1)
      ..strokeWidth = size.height;
    final y = size.height / 2;
    for (double x = 0; x < size.width; x += 7) {
      canvas.drawLine(
        Offset(x, y),
        Offset((x + 4).clamp(0, size.width), y),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// "What counted": each declared item, proved or not, with the totals —
/// the top of a receipt, its torn edge ([_ProofsReceiptEdge]) under it.
class _ProofsCountedCard extends StatelessWidget {
  const _ProofsCountedCard({required this.counted});

  final InvestmentProofsCounted counted;

  static const _muted = Color(0xFFB0B0B6);

  Widget _cell(
    String text, {
    bool figure = false,
    bool muted = false,
    TextStyle? style,
  }) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Text(
      text,
      textAlign: figure ? TextAlign.right : TextAlign.left,
      style:
          style ??
          _proofType(
            13,
            weight: muted
                ? FontWeight.w500
                : (figure ? FontWeight.w700 : FontWeight.w500),
            color: muted ? _muted : _proofInk,
          ).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
    ),
  );

  Widget _figure(int paise) => paise > 0
      ? _cell(_rupees(paise), figure: true)
      : _cell('—', figure: true, muted: true);

  TableRow _row(List<Widget> cells, {Border? border}) => TableRow(
    decoration: BoxDecoration(border: border),
    children: cells,
  );

  @override
  Widget build(BuildContext context) {
    const line = Border(top: BorderSide(color: Color(0xFFF1F1F4)));
    final head = _proofType(
      11.5,
      weight: FontWeight.w700,
      color: const Color(0xFF8E8E95),
      letterSpacing: 0.6,
    );
    final total = _proofType(14, weight: FontWeight.w800);
    final pf = counted.pfPaise;
    const columns = {
      0: FlexColumnWidth(1.4),
      1: FlexColumnWidth(),
      2: FlexColumnWidth(),
    };
    return Container(
      key: const ValueKey('proofs-counted'),
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 18),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Table(
            columnWidths: columns,
            children: [
              _row([
                _cell('DECLARED ITEM', style: head),
                _cell('PROVED', figure: true, style: head),
                _cell('NOT PROVED', figure: true, style: head),
              ]),
              for (final row in counted.rows)
                _row([
                  _cell(row.label),
                  _figure(row.provedPaise),
                  _figure(row.notProvedPaise),
                ], border: line),
            ],
          ),
          const _ProofsDashedLine(),
          Table(
            columnWidths: columns,
            children: [
              _row([
                _cell('Total', style: total),
                _cell(
                  _rupees(counted.provedPaise),
                  figure: true,
                  style: total.copyWith(color: const Color(0xFF047857)),
                ),
                _cell(
                  _rupees(counted.notProvedPaise),
                  figure: true,
                  style: total.copyWith(color: const Color(0xFFB42318)),
                ),
              ]),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            pf > 0
                ? 'Your PF (${_rupees(pf)}), standard deduction and approved '
                      'FBP bills still count. They don’t need proofs.'
                : 'Standard deduction and approved FBP bills still count. '
                      'They don’t need proofs.',
            style: _proofType(
              12,
              weight: FontWeight.w500,
              color: const Color(0xFF7A7A82),
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}

/// "Have the proofs now? Ask HR if they can still accept them for March
/// pay ›": a Support Desk ticket.
class _ProofsAskHrCard extends StatelessWidget {
  const _ProofsAskHrCard({
    required this.lastPayPeriod,
    required this.onTap,
    this.inkKey = const ValueKey('proofs-ask-hr'),
    this.title = 'Have the proofs now?',
    this.subtitle,
  });

  final DateTime? lastPayPeriod;
  final VoidCallback? onTap;
  final Key inkKey;
  final String title;

  /// In place of "Ask HR if they can still accept them for March pay".
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final month = lastPayPeriod;
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        key: inkKey,
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              _ProofsIconTile(
                radius: 12,
                border: false,
                shadow: const BoxShadow(
                  color: Color(0x14000000),
                  blurRadius: 1.5,
                  offset: Offset(0, 1),
                ),
                child: Image.asset(
                  'assets/icons/payroll_proofs_hr.png',
                  width: 24,
                  height: 24,
                  fit: BoxFit.cover,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: _proofType(15, weight: FontWeight.w700)),
                    const SizedBox(height: 3),
                    Text(
                      subtitle ??
                          (month == null
                              ? 'Ask HR if they can still accept them'
                              : 'Ask HR if they can still accept them for '
                                    '${_monthName(month.month)} pay'),
                      style: _proofType(12.5, color: _proofMuted),
                    ),
                  ],
                ),
              ),
              if (onTap != null) ...[
                const SizedBox(width: 12),
                SvgPicture.asset(
                  'assets/icons/payroll_proofs_chevron.svg',
                  width: 18,
                  height: 18,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// "Claim it back when you file": the tax return still takes them.
class _ProofsClaimBackCard extends StatelessWidget {
  const _ProofsClaimBackCard({
    required this.itrDueOn,
    this.cardKey = const ValueKey('proofs-claim-back'),
    this.body,
  });

  final DateTime? itrDueOn;
  final Key cardKey;

  /// In place of the proofs' own words.
  final String? body;

  @override
  Widget build(BuildContext context) {
    final due = itrDueOn;
    return Container(
      key: cardKey,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _ProofsIconTile(child: _TaxPicture()),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Claim it back when you file',
                  style: _proofType(15, weight: FontWeight.w700),
                ),
                const SizedBox(height: 2),
                Text(
                  body ??
                      'The extra tax isn’t lost. Claim these in your return'
                          '${due == null ? '' : ' by ${_longDate(due)}'} with '
                          'the same documents, and get it back as a refund. '
                          'Your Form 16 will show only the proved items.',
                  style: _proofType(
                    12.5,
                    color: _proofMuted,
                    height: 17.5 / 12.5,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The tax calendar picture (Figma "image 96"), cropped as Figma crops it:
/// to 120% of its 24-point box, nudged up and left.
class _TaxPicture extends StatelessWidget {
  const _TaxPicture();

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 24,
    height: 24,
    child: ClipRect(
      child: OverflowBox(
        maxWidth: 28.8,
        maxHeight: 28.8,
        // 28.8 in 24: left −9.69%, top −11.84% of the box.
        alignment: const Alignment(-0.031, 0.184),
        child: Image.asset(
          'assets/icons/payroll_proofs_tax.png',
          width: 28.8,
          height: 28.8,
          fit: BoxFit.cover,
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------- sheets

/// The header's Apply button turned outline: the brand blue on white. The
/// proofs page now draws Figma's own Upload button; this stays for the other
/// Payroll pages that take it.
// ignore: unused_element
class _OutlineAction extends StatelessWidget {
  // ignore: unused_element_parameter
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

/// Takes a photo of a proof. The app opens the camera ([_takeProofPhoto]);
/// tests put their own here.
PayrollFilePicker payrollProofCamera = _takeProofPhoto;

/// Upload / Re-upload proof (Figma 4567:25245), self-contained so the bill
/// sheets can read the same: title, "`item` · `document`", the document as
/// a label over a "Photo or PDF" box with Take photo and Choose file, the
/// amount on the proof (the declared amount to start), and Submit for
/// review.
class _ProofUploadSheet extends StatefulWidget {
  const _ProofUploadSheet({
    required this.item,
    required this.fy,
    required this.api,
    required this.pickFile,
    required this.takePhoto,
  });

  final InvestmentProofItem item;
  final String fy;
  final PayrollApiService api;
  final PayrollFilePicker pickFile;
  final PayrollFilePicker takePhoto;

  @override
  State<_ProofUploadSheet> createState() => _ProofUploadSheetState();
}

class _ProofUploadSheetState extends State<_ProofUploadSheet> {
  // The declared amount for the year to start (rent: twelve months of it).
  late final _amount = TextEditingController(
    text: _RupeeInputFormatter.format((widget.item.yearPaise / 100).round()),
  )..addListener(() => setState(() {}));
  late final _pan = TextEditingController(
    text: widget.item.proof?.landlordPan ?? '',
  )..addListener(() => setState(() {}));
  PayrollUpload? _file;

  String get _panText => _pan.text.trim().toUpperCase();

  /// Typed but not a PAN; left empty is fine.
  bool get _panInvalid =>
      _panText.isNotEmpty &&
      !RegExp(r'^[A-Z]{5}[0-9]{4}[A-Z]$').hasMatch(_panText);
  bool _busy = false;
  String? _error;

  /// An older server sends no document hint: the app's own words.
  static String _document(InvestmentProofItem item) =>
      item.document ??
      switch (item.item) {
        'ppf' => 'PPF passbook or statement',
        'elss' => 'ELSS statement from the fund',
        'lifeInsurance' ||
        'healthSelf' ||
        'healthParents' => 'Premium receipt from the insurer',
        'nps' => 'NPS contribution statement',
        'rentMonthly' => 'Rent receipts or the rent agreement',
        'homeLoanInterest' => 'Interest certificate from the bank',
        _ => 'Receipt or certificate',
      };

  static const _border = Color(0xFFDDDDDD);

  @override
  void dispose() {
    _amount.dispose();
    _pan.dispose();
    super.dispose();
  }

  int get _amountPaise => _RupeeInputFormatter.parse(_amount.text) * 100;

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
    if (file == null || _amountPaise <= 0 || _panInvalid || _busy) return;
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
        landlordPan: _panText.isEmpty ? null : _panText,
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

  Widget _outline(String label, VoidCallback onTap, Key key) => Expanded(
    child: Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(11),
        side: const BorderSide(color: _prBlue),
      ),
      child: InkWell(
        key: key,
        onTap: _busy ? null : onTap,
        borderRadius: BorderRadius.circular(11),
        child: SizedBox(
          height: 43,
          child: Center(
            child: Text(
              label,
              style: _proofType(
                13,
                weight: FontWeight.w400,
                color: _prBlue,
                height: 18 / 13,
                letterSpacing: -0.16,
              ),
            ),
          ),
        ),
      ),
    ),
  );

  /// No file yet: "Photo or PDF", Take photo, Choose file.
  Widget _dropBox() => Container(
    key: const ValueKey('proof-drop'),
    padding: const EdgeInsets.all(9),
    decoration: BoxDecoration(
      border: Border.all(color: _border, width: 1.035),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Text(
            'Photo or PDF',
            textAlign: TextAlign.center,
            style: _proofType(
              12,
              weight: FontWeight.w400,
              color: const Color(0xFF717171),
              height: 16.2 / 12,
              letterSpacing: -0.16,
            ),
          ),
        ),
        Row(
          children: [
            _outline(
              'Take photo',
              () => _pick(widget.takePhoto),
              const ValueKey('proof-take-photo'),
            ),
            const SizedBox(width: 8),
            _outline(
              'Choose file',
              () => _pick(widget.pickFile),
              const ValueKey('proof-pick'),
            ),
          ],
        ),
      ],
    ),
  );

  /// The chosen file in the box's place: its type, name and size, and ×
  /// to take it off and choose again.
  Widget _fileRow(PayrollUpload file) {
    final name = file.name;
    final type = name.contains('.')
        ? name.split('.').last.toUpperCase()
        : 'FILE';
    final pdf = type == 'PDF';
    final kb = (file.size / 1024).ceil();
    return Container(
      key: const ValueKey('proof-file'),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: _border, width: 1.035),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 48,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: pdf ? const Color(0xFFFDECEC) : _prBlueTint,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              type.length > 4 ? type.substring(0, 4) : type,
              style: _proofType(
                10,
                weight: FontWeight.w800,
                color: pdf ? const Color(0xFFB42318) : _prBlue,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: _proofType(14, weight: FontWeight.w700),
                ),
                const SizedBox(height: 2),
                Text(
                  kb >= 1024
                      ? '${(kb / 1024).toStringAsFixed(1)} MB'
                      : '$kb KB',
                  style: _proofType(
                    12,
                    weight: FontWeight.w500,
                    color: const Color(0xFF6B6B72),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Material(
            color: const Color(0xFFF2F2F4),
            shape: const CircleBorder(),
            child: InkWell(
              key: const ValueKey('proof-remove-file'),
              customBorder: const CircleBorder(),
              onTap: _busy ? null : () => setState(() => _file = null),
              child: const SizedBox(
                width: 36,
                height: 36,
                child: Tooltip(
                  message: 'Remove file',
                  child: Icon(
                    Icons.close_rounded,
                    size: 16,
                    color: _proofMuted,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  InputDecoration _fieldDecoration(String hint) {
    OutlineInputBorder edge(Color color, [double width = 1]) =>
        OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: color, width: width),
        );
    return InputDecoration(
      hintText: hint,
      hintStyle: _proofType(
        14,
        weight: FontWeight.w400,
        color: const Color(0xFF9CA3AF),
      ),
      isDense: true,
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
      border: edge(_border),
      enabledBorder: edge(_border),
      disabledBorder: edge(_border),
      focusedBorder: edge(_prBlue, 1.5),
    );
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final file = _file;
    final document = _document(item);
    final rent = item.perMonth || item.item == 'rentMonthly';
    final label = _proofType(
      12,
      color: const Color(0xFF2A2A2A),
      height: 18 / 12,
    );
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        boxShadow: [
          BoxShadow(
            color: Color(0x1F000000),
            blurRadius: 16,
            offset: Offset(0, -4),
          ),
        ],
      ),
      padding: EdgeInsets.only(
        bottom: 24 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 12, bottom: 4),
                child: Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: const Color(0xFFD1D5DB),
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            item.status == ProofStatus.rejected
                                ? 'Re-upload proof'
                                : 'Upload proof',
                            style: _proofType(
                              16,
                              color: const Color(0xFF2A2A2A),
                            ),
                          ),
                        ),
                        // The canvas's ×: close without sending.
                        Material(
                          color: const Color(0xFFEDEDF0),
                          shape: const CircleBorder(),
                          child: InkWell(
                            key: const ValueKey('proof-sheet-close'),
                            customBorder: const CircleBorder(),
                            onTap: _busy
                                ? null
                                : () => Navigator.of(context).pop(),
                            child: const SizedBox(
                              width: 40,
                              height: 40,
                              child: Tooltip(
                                message: 'Close',
                                child: Icon(
                                  Icons.close_rounded,
                                  size: 18,
                                  color: Color(0xFF3A3A3F),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(
                      '${item.label} · $document',
                      style: _proofType(
                        14,
                        weight: FontWeight.w400,
                        color: const Color(0xFF6A6A6A),
                      ),
                    ),
                    const SizedBox(height: 14),
                    Text(
                      document,
                      style: _proofType(
                        12,
                        color: const Color(0xFF484848),
                        height: 16.2 / 12,
                        letterSpacing: -0.16,
                      ),
                    ),
                    const SizedBox(height: 10),
                    if (file == null) _dropBox() else _fileRow(file),
                    const SizedBox(height: 16),
                    Text('Amount on proof', style: label),
                    const SizedBox(height: 8),
                    TextField(
                      key: const ValueKey('proof-amount'),
                      controller: _amount,
                      enabled: !_busy,
                      keyboardType: TextInputType.number,
                      inputFormatters: const [_RupeeInputFormatter()],
                      style: _proofType(
                        14,
                        weight: FontWeight.w400,
                        color: const Color(0xFF222222),
                        height: 16.2 / 14,
                        letterSpacing: -0.16,
                      ),
                      decoration: _fieldDecoration('₹0'),
                    ),
                    if (rent) ...[
                      const SizedBox(height: 16),
                      Text('Landlord PAN', style: label),
                      const SizedBox(height: 8),
                      TextField(
                        key: const ValueKey('proof-landlord-pan'),
                        controller: _pan,
                        enabled: !_busy,
                        textCapitalization: TextCapitalization.characters,
                        inputFormatters: [
                          FilteringTextInputFormatter.allow(
                            RegExp('[A-Za-z0-9]'),
                          ),
                          LengthLimitingTextInputFormatter(10),
                          TextInputFormatter.withFunction(
                            (_, next) =>
                                next.copyWith(text: next.text.toUpperCase()),
                          ),
                        ],
                        style: _proofType(
                          14,
                          weight: FontWeight.w400,
                          color: const Color(0xFF222222),
                          height: 16.2 / 14,
                          letterSpacing: -0.16,
                        ),
                        decoration: _fieldDecoration('ABCDE1234F'),
                      ),
                      if (_panInvalid) ...[
                        const SizedBox(height: 6),
                        Text(
                          'A PAN is 10 characters, like ABCDE1234F.',
                          key: const ValueKey('proof-pan-error'),
                          style: _proofType(12, color: _prError),
                        ),
                      ],
                    ],
                    if (_error case final error?) ...[
                      const SizedBox(height: 10),
                      Text(
                        error,
                        key: const ValueKey('proof-upload-error'),
                        style: _proofType(13, color: _prError),
                      ),
                      if (mentionsHrOrSupport(error))
                        RaiseTicketLink(about: error),
                    ],
                    const SizedBox(height: 26),
                    _ProofFilledButton(
                      label: 'Submit for review',
                      height: 56,
                      radius: 16,
                      fontSize: 16,
                      busy: _busy,
                      onPressed:
                          file == null ||
                              _amountPaise <= 0 ||
                              _panInvalid ||
                              _busy
                          ? null
                          : _submit,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
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

/// The camera, straight away, on a phone; elsewhere there is none, so the
/// file picker opens instead. Sized as every other photo the app takes.
Future<PayrollUpload?> _takeProofPhoto(BuildContext context) async {
  final platform = Theme.of(context).platform;
  if (platform != TargetPlatform.iOS && platform != TargetPlatform.android) {
    return _pickProofFile(context);
  }
  try {
    final picked = await image_picker.ImagePicker().pickImage(
      source: image_picker.ImageSource.camera,
      maxWidth: 2048,
      maxHeight: 2048,
      imageQuality: 90,
    );
    if (picked == null || !context.mounted) return null;
    final bytes = await picked.readAsBytes();
    if (!context.mounted) return null;
    if (bytes.length > PayrollApiService.maxProofBytes) {
      showAppToast(context, 'That photo is over 5 MB. Try again.');
      return null;
    }
    final name = picked.name.contains('.') ? picked.name : '${picked.name}.jpg';
    return PayrollUpload(name: name, bytes: bytes);
  } on PlatformException catch (error) {
    // A denied camera permission arrives here rather than as a crash.
    if (context.mounted) {
      showAppToast(
        context,
        error.code == 'camera_access_denied'
            ? 'Sowaka needs permission for the camera. Turn it on in Settings.'
            : 'Could not open the camera. Choose a file instead.',
      );
    }
    return null;
  }
}
