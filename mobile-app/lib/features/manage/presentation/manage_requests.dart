part of '../../manager/presentation/manager_screen.dart';

Future<String?> _showAttendanceDecisionSheet(
  BuildContext context,
  AttendanceRegularization request,
  LeaveDecision decision,
) async {
  final note = TextEditingController();
  final approved = decision == LeaveDecision.approved;
  final result = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) => Padding(
      padding: EdgeInsets.fromLTRB(
        18,
        0,
        18,
        18 + MediaQuery.viewInsetsOf(sheetContext).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            request.isOutOfLocation
                ? (approved ? 'Approve request' : 'Reject request')
                : (approved ? 'Approve correction' : 'Decline correction'),
            style: const TextStyle(
              color: MColors.ink,
              fontSize: 20,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '${request.who} · ${_attendancePeriod(request)} · ${_shortAttendanceDate(request.workDate)}',
            style: const TextStyle(color: MColors.inkSoft, fontSize: 13.5),
          ),
          if (!approved) ...[
            const SizedBox(height: 16),
            TextField(
              controller: note,
              autofocus: true,
              maxLines: 2,
              decoration: InputDecoration(
                hintText:
                    'Add a note for ${request.who.split(' ').first} — why it can’t be approved…',
              ),
            ),
          ],
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: ActionButton(
                  label: 'Cancel',
                  background: Colors.white,
                  foreground: MColors.inkSoft,
                  border: MColors.line,
                  onTap: () => Navigator.pop(sheetContext),
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                flex: 2,
                child: ActionButton(
                  label: approved
                      ? 'Confirm approve'
                      : request.isOutOfLocation
                      ? 'Confirm reject'
                      : 'Confirm decline',
                  icon: approved ? Icons.check_rounded : Icons.close_rounded,
                  // Same colours as the Approve and Reject buttons on the card
                  // this sheet was opened from.
                  background: approved
                      ? MColors.approveTint
                      : MColors.rejectTint,
                  foreground: approved ? MColors.approveInk : MColors.rejectInk,
                  onTap: () {
                    if (!approved && note.text.trim().isEmpty) return;
                    Navigator.pop(sheetContext, note.text.trim());
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    ),
  );
  note.dispose();
  return result;
}

class _AttendanceCorrectionDetailPage extends StatelessWidget {
  const _AttendanceCorrectionDetailPage({
    required this.request,
    required this.bloc,
    this.photoUrl,
  });
  final AttendanceRegularization request;
  final ManagerBloc bloc;
  final String? photoUrl;

  @override
  Widget build(BuildContext context) => _RequestDetailScaffold(
    title: request.heading,
    subtitle: '${request.who} · ${request.team}',
    decision: request.decision,
    managerNote: request.managerNote,
    summary: RequestSummary(
      screenTitle: request.heading,
      successTitle: '',
      successBody: '',
      // An out of location request is about a punch: when, why, and where
      // from — the rough place, never raw coordinates.
      rows: request.isOutOfLocation
          ? [
              SummaryRow('Employee', '${request.who} · ${request.team}'),
              SummaryRow('Date', _summaryDate(request.workDate)),
              SummaryRow(
                'Time',
                _attendanceClock(
                  request.outsideLocation?.at ?? request.createdAt,
                ),
              ),
              SummaryRow('Reason', request.outsideLocation?.reason ?? '—'),
              SummaryRow('Location', request.outsideLocation?.place ?? '—'),
              SummaryRow('Status', _decisionText(request.decision)),
            ]
          : [
              SummaryRow('Employee', '${request.who} · ${request.team}'),
              SummaryRow('Work Date', _summaryDate(request.workDate)),
              // What the day holds now, then what approving would make it. A
              // correction is raised precisely because one of these is missing, so
              // both are shown even when they are blank.
              SummaryRow('Punch In', _attendanceClock(request.punchIn)),
              SummaryRow('Punch Out', _attendanceClock(request.punchOut)),
              SummaryRow('Marked As', _attendancePeriod(request)),
              SummaryRow('Raised On', _summaryDate(request.createdAt)),
              SummaryRow('Status', _decisionText(request.decision)),
            ],
      reason: request.isOutOfLocation ? '' : request.note,
    ),
    declineLabel: request.isOutOfLocation ? 'Reject' : 'Decline',
    onDecline: () => _decide(context, LeaveDecision.declined),
    onApprove: () => _decide(context, LeaveDecision.approved),
  );

  Future<void> _decide(BuildContext context, LeaveDecision decision) async {
    final note = await _showAttendanceDecisionSheet(context, request, decision);
    if (note == null || !context.mounted) return;
    await bloc.add(
      DecideAttendanceRegularization(request.id, decision, managerNote: note),
    );
    if (context.mounted) Navigator.pop(context);
  }
}

/// The rows a request card shows. An out of location request says why and
/// where from; a correction says what the day should become.
List<(String, String)> _attendanceRequestRows(
  AttendanceRegularization request,
) {
  if (request.isOutOfLocation) {
    return [
      ('Date:', _shortAttendanceDate(request.workDate)),
      ('Reason:', request.outsideLocation?.reason ?? '—'),
      ('Location:', request.outsideLocation?.place ?? '—'),
    ];
  }
  return [
    ('Date:', _shortAttendanceDate(request.workDate)),
    ('Correction:', _attendancePeriod(request)),
    ('Comment:', request.note),
  ];
}

/// What the employee is asking for: the day type on current corrections, and
/// the punch times on ones raised before day types existed.
String _attendancePeriod(AttendanceRegularization request) {
  if (request.isOutOfLocation)
    return request.outsideLocation?.reason ?? 'Out of location';
  if (request.dayTypeLabel.isNotEmpty) return request.dayTypeLabel;
  final inAt = request.requestedPunchIn;
  final outAt = request.requestedPunchOut;
  if (inAt != null && outAt != null) {
    return '${_attendanceClock(inAt)} – ${_attendanceClock(outAt)}';
  }
  if (inAt != null) return 'In ${_attendanceClock(inAt)}';
  if (outAt != null) return 'Out ${_attendanceClock(outAt)}';
  return 'No time given';
}

String _shortAttendanceDate(DateTime value) =>
    '${value.day} ${const ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][value.month - 1]}';
String _fullWeekday(DateTime value) => const [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
][value.weekday - 1];
String _attendanceClock(DateTime? value) => value == null
    ? '—'
    : '${value.hour % 12 == 0 ? 12 : value.hour % 12}:${value.minute.toString().padLeft(2, '0')} ${value.hour >= 12 ? 'PM' : 'AM'}';

class _LeaveTypeChip extends StatelessWidget {
  const _LeaveTypeChip({required this.type});

  final String type;
  static const large = false;

  @override
  Widget build(BuildContext context) {
    final colors = leavePalette(type);
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: large ? 12 : 9,
        vertical: large ? 6 : 4,
      ),
      decoration: BoxDecoration(
        color: colors.$2,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        type,
        style: TextStyle(
          color: colors.$1,
          fontSize: large ? 13 : 11.5,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _LeaveRequestDetailPage extends StatelessWidget {
  const _LeaveRequestDetailPage({
    required this.leave,
    required this.bloc,
    this.photoUrl,
    this.cancellation = false,
  });

  final LeaveRequest leave;
  final ManagerBloc bloc;
  final String? photoUrl;

  /// The page is about the employee's request to cancel this approved leave:
  /// its note, where it stands, and Approve / Decline while it waits.
  final bool cancellation;

  @override
  Widget build(BuildContext context) {
    final request = cancellation ? leave.cancelRequest : null;
    final waiting = cancellation
        ? leave.cancellationPending
        : leave.decision == LeaveDecision.pending;
    return Scaffold(
      backgroundColor: MColors.bg,
      body: Column(
        children: [
          _TopBar(
            title: cancellation ? 'Leave cancellation' : 'Leave',
            sub: '${leave.who} · ${leave.team}',
            onBack: () => Navigator.of(context).pop(),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
              children: [
                // The same summary the employee sees when the request is sent,
                // so both sides read the request the same way.
                RequestSummaryBody(
                  summary: RequestSummary(
                    screenTitle: 'Leave',
                    successTitle: '',
                    successBody: '',
                    rows: [
                      SummaryRow('Employee', '${leave.who} · ${leave.team}'),
                      SummaryRow('Leave Type', leave.type),
                      SummaryRow('Start Date', _summaryDate(leave.start)),
                      SummaryRow('End Date', _summaryDate(leave.end)),
                      SummaryRow(
                        'Duration',
                        leave.halfDay
                            ? 'Half Day'
                            : '${_days(leave.days)} day'
                                  '${leave.days == 1 ? '' : 's'}',
                      ),
                      SummaryRow('Applied On', _summaryDate(leave.requestedOn)),
                      if (request != null) ...[
                        SummaryRow(
                          'Cancellation Asked',
                          _summaryDate(request.requestedAt.toLocal()),
                        ),
                        SummaryRow(
                          'Cancellation',
                          _cancellationLabel(request.status),
                        ),
                      ],
                      SummaryRow('Status', _leaveStatusLabel(leave)),
                      if (leave.decision == LeaveDecision.cancelled &&
                          leave.cancelledAt != null)
                        SummaryRow(
                          'Cancelled On',
                          _summaryDate(leave.cancelledAt!.toLocal()),
                        ),
                    ],
                    reason: leave.reason,
                    documentName: leave.documentName,
                    documentUrl: leave.documentUrl,
                  ),
                  showSuccess: false,
                ),
                if (!cancellation && leave.managerNote.isNotEmpty) ...[
                  const SizedBox(height: 18),
                  const _LeaveSectionLabel('YOUR NOTE'),
                  const SizedBox(height: 7),
                  _ReviewedDeclineNote(note: leave.managerNote),
                ],
                // The employee's reason for taking the leave back, or for
                // asking to.
                if (_cancelNoteOf(leave) case final note?
                    when note.isNotEmpty &&
                        (cancellation ||
                            leave.decision == LeaveDecision.cancelled)) ...[
                  const SizedBox(height: 18),
                  const _LeaveSectionLabel('CANCELLATION NOTE'),
                  const SizedBox(height: 7),
                  _CancelNote(note: note),
                ],
                if (request != null && request.decisionNote.isNotEmpty) ...[
                  const SizedBox(height: 18),
                  const _LeaveSectionLabel('YOUR NOTE'),
                  const SizedBox(height: 7),
                  _ReviewedDeclineNote(note: request.decisionNote),
                ],
              ],
            ),
          ),
          if (waiting)
            Container(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              decoration: const BoxDecoration(
                color: Colors.white,
                border: Border(top: BorderSide(color: MColors.line)),
              ),
              child: SafeArea(
                top: false,
                child: Row(
                  children: [
                    Expanded(
                      child: ActionButton(
                        label: 'Approve',
                        icon: Icons.check_rounded,
                        background: MColors.approveTint,
                        foreground: MColors.approveInk,
                        onTap: () => _decide(context, LeaveDecision.approved),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: ActionButton(
                        label: 'Decline',
                        icon: Icons.close_rounded,
                        background: MColors.rejectTint,
                        foreground: MColors.rejectInk,
                        onTap: () => _decide(context, LeaveDecision.declined),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  static String _days(double value) =>
      value == value.roundToDouble() ? value.toStringAsFixed(0) : '$value';

  Future<void> _decide(BuildContext context, LeaveDecision decision) async {
    final result = await _showLeaveDecisionSheet(
      context,
      leave,
      decision,
      cancellation: cancellation,
    );
    if (result == null || !context.mounted) return;
    if (cancellation) {
      bloc.add(
        DecideLeaveCancellation(leave.id, decision, note: result.managerNote),
      );
    } else {
      bloc.add(
        DecideLeave(leave.id, decision, managerNote: result.managerNote),
      );
    }
  }
}

/// A leave's status in words. A cancelled one says what it had been: a
/// pending leave the employee withdrew, or an approved one whose cancellation
/// was agreed to.
String _leaveStatusLabel(LeaveRequest leave) =>
    leave.cancelledLabel ?? _decisionText(leave.decision);

/// Where a request to cancel an approved leave stands.
String _cancellationLabel(LeaveDecision status) => switch (status) {
  LeaveDecision.approved => 'Approved',
  LeaveDecision.declined => 'Declined',
  _ => 'Waiting on you',
};

/// The employee's note with the cancellation: on the request while it is
/// one, kept on the leave once cancelled.
String? _cancelNoteOf(LeaveRequest leave) =>
    leave.cancelNote.isNotEmpty ? leave.cancelNote : leave.cancelRequest?.note;

/// The frame every manager request detail shares: the summary the employee
/// sent, their own note once decided, and the two decision buttons pinned to
/// the bottom while it is still pending.
class _RequestDetailScaffold extends StatelessWidget {
  const _RequestDetailScaffold({
    required this.title,
    required this.subtitle,
    required this.decision,
    required this.managerNote,
    required this.summary,
    required this.onApprove,
    required this.onDecline,
    this.declineLabel = 'Decline',
    this.belowSummary,
  });

  final String title;
  final String subtitle;
  final LeaveDecision decision;
  final String managerNote;
  final RequestSummary summary;
  final VoidCallback onApprove;
  final VoidCallback onDecline;

  /// Shown straight under the summary — so under its Reason, the last thing
  /// it shows — such as overtime's decision dropdown.
  final Widget? belowSummary;

  /// An out of location request is rejected, not declined — the word the
  /// card and the manager both use.
  final String declineLabel;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: MColors.bg,
      body: Column(
        children: [
          _TopBar(
            title: title,
            sub: subtitle,
            onBack: () => Navigator.of(context).pop(),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
              children: [
                RequestSummaryBody(summary: summary, showSuccess: false),
                ?belowSummary,
                if (managerNote.isNotEmpty) ...[
                  const SizedBox(height: 18),
                  const _LeaveSectionLabel('YOUR NOTE'),
                  const SizedBox(height: 7),
                  _ReviewedDeclineNote(note: managerNote),
                ],
              ],
            ),
          ),
          if (decision == LeaveDecision.pending)
            Container(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              decoration: const BoxDecoration(
                color: Colors.white,
                border: Border(top: BorderSide(color: MColors.line)),
              ),
              child: SafeArea(
                top: false,
                // The same pair, in the same order and colours, as the card
                // this page was opened from: approve on the left in green,
                // decline on the right in red, equal widths.
                child: Row(
                  children: [
                    Expanded(
                      child: ActionButton(
                        label: 'Approve',
                        icon: Icons.check_rounded,
                        background: MColors.approveTint,
                        foreground: MColors.approveInk,
                        onTap: onApprove,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: ActionButton(
                        label: declineLabel,
                        icon: Icons.close_rounded,
                        background: MColors.rejectTint,
                        foreground: MColors.rejectInk,
                        onTap: onDecline,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

String _decisionText(LeaveDecision decision) => switch (decision) {
  LeaveDecision.approved => 'Approved',
  LeaveDecision.declined => 'Declined',
  LeaveDecision.cancelled => 'Cancelled',
  LeaveDecision.pending => 'Pending',
};

/// "Friday, 21 Aug" — shared by the request summary screens.
String _summaryDate(DateTime value) =>
    '${_fullWeekday(value)}, ${value.day} '
    '${const ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][value.month - 1]}';

/// The employee's note when they cancelled a leave, in the neutral grey a
/// cancelled request wears.
class _CancelNote extends StatelessWidget {
  const _CancelNote({required this.note});

  final String note;

  @override
  Widget build(BuildContext context) => Container(
    key: const ValueKey('leave-cancel-note'),
    width: double.infinity,
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0xFFEDEDF0),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Text(
      note,
      style: const TextStyle(
        color: Color(0xFF4E4E56),
        fontSize: 13,
        height: 1.4,
      ),
    ),
  );
}

class _ReviewedDeclineNote extends StatelessWidget {
  const _ReviewedDeclineNote({required this.note});

  final String note;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: MColors.terraTint,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Decline note',
          style: TextStyle(
            color: MColors.terraDeep,
            fontSize: 12,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 5),
        Text(
          note,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: MColors.inkSoft,
            fontSize: 13,
            height: 1.45,
          ),
        ),
      ],
    ),
  );
}

class _LeaveSectionLabel extends StatelessWidget {
  const _LeaveSectionLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(left: 4),
    child: Text(
      label,
      style: const TextStyle(
        color: MColors.inkFaint,
        fontSize: 11.5,
        fontWeight: FontWeight.w800,
        letterSpacing: 1,
      ),
    ),
  );
}

class _LeaveDetailRow extends StatelessWidget {
  const _LeaveDetailRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 13),
    child: Row(
      children: [
        Icon(icon, size: 19, color: MColors.inkFaint),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            label,
            style: const TextStyle(color: MColors.inkSoft, fontSize: 13.5),
          ),
        ),
        Text(
          value,
          style: const TextStyle(
            color: MColors.ink,
            fontSize: 13.5,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    ),
  );
}

class _DecisionSheetResult {
  const _DecisionSheetResult(this.managerNote);

  final String managerNote;
}

/// The same sheet for an employee's request to cancel an approved leave:
/// approving cancels the leave, declining keeps it, and a note is optional.
Future<_DecisionSheetResult?> _showLeaveCancellationDecisionSheet(
  BuildContext context,
  LeaveRequest leave,
  LeaveDecision decision,
) => _showLeaveDecisionSheet(context, leave, decision, cancellation: true);

Future<_DecisionSheetResult?> _showLeaveDecisionSheet(
  BuildContext context,
  LeaveRequest leave,
  LeaveDecision decision, {
  bool cancellation = false,
}) async {
  final approve = decision == LeaveDecision.approved;
  // Declining a leave needs a reason; declining a cancellation keeps the
  // leave, and a note is the manager's choice.
  final noteRequired = !approve && !cancellation;
  // The colours the Approve and Reject buttons wear on the card this sheet
  // was opened from, so confirming looks like what was tapped.
  final accent = approve ? MColors.approveTint : MColors.rejectTint;
  final accentInk = approve ? MColors.approveInk : MColors.rejectInk;
  return showModalBottomSheet<_DecisionSheetResult>(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    // The note's controller lives as long as the sheet does: disposed when
    // the sheet's own route is gone, not when its future completes (the
    // sheet is still animating out then, and rebuilds as the keyboard
    // goes).
    builder: (sheetContext) => _OwnedTextController(
      builder: (noteController) => StatefulBuilder(
        builder: (context, setSheetState) => Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(sheetContext).bottom,
          ),
          child: Container(
            padding: const EdgeInsets.fromLTRB(18, 10, 18, 20),
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            ),
            child: SafeArea(
              top: false,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 38,
                      height: 4,
                      decoration: BoxDecoration(
                        color: MColors.line,
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    cancellation
                        ? (approve
                              ? 'Approve cancellation'
                              : 'Decline cancellation')
                        : (approve ? 'Approve leave' : 'Decline leave'),
                    style: const TextStyle(
                      color: MColors.ink,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 7),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          leave.who,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: MColors.inkSoft,
                            fontSize: 13.5,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      _LeaveTypeChip(type: leave.type),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 13,
                      vertical: 11,
                    ),
                    decoration: BoxDecoration(
                      color: MColors.bg,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        SvgPicture.asset(
                          'assets/icons/calendar_header.svg',
                          width: 18,
                          height: 18,
                          colorFilter: const ColorFilter.mode(
                            MColors.inkFaint,
                            BlendMode.srcIn,
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: Text(
                            _leaveDateRange(leave),
                            style: const TextStyle(
                              color: MColors.ink,
                              fontSize: 13.5,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        Text(
                          '${leave.daysLabel}d',
                          style: const TextStyle(
                            color: MColors.inkSoft,
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  _LeaveDetailRow(
                    icon: Icons.schedule_rounded,
                    label: cancellation ? 'Cancellation asked' : 'Applied',
                    value: _requestTimestamp(
                      cancellation
                          ? leave.cancelRequest?.requestedAt ??
                                leave.requestedOn
                          : leave.requestedOn,
                    ),
                  ),
                  if (cancellation) ...[
                    Text(
                      approve
                          ? 'The leave will be cancelled and the days go '
                                'back to ${leave.who.split(' ').first}’s '
                                'balance.'
                          : 'The leave stays approved.',
                      style: const TextStyle(
                        color: MColors.inkSoft,
                        fontSize: 13,
                        height: 1.4,
                      ),
                    ),
                  ],
                  const SizedBox(height: 18),
                  if (!approve) ...[
                    Text(
                      cancellation
                          ? 'Note for ${leave.who.split(' ').first} (optional)'
                          : 'Reason for declining',
                      style: const TextStyle(
                        color: MColors.ink,
                        fontSize: 13.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: noteController,
                      autofocus: true,
                      maxLength: 500,
                      maxLines: 3,
                      onChanged: (_) => setSheetState(() {}),
                      decoration: _fieldDecoration(
                        cancellation
                            ? 'Why the leave is staying approved…'
                            : 'Explain why this leave request is being declined…',
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
                  Row(
                    children: [
                      Expanded(
                        flex: 10,
                        child: ActionButton(
                          label: 'Cancel',
                          background: Colors.white,
                          foreground: MColors.inkSoft,
                          border: MColors.line,
                          onTap: () => Navigator.pop(sheetContext),
                        ),
                      ),
                      const SizedBox(width: 11),
                      Expanded(
                        flex: 15,
                        child: ActionButton(
                          label: approve
                              ? 'Confirm approve'
                              : 'Confirm decline',
                          icon: approve ? Icons.check_rounded : null,
                          background:
                              noteRequired && noteController.text.trim().isEmpty
                              ? MColors.line
                              : accent,
                          foreground:
                              noteRequired && noteController.text.trim().isEmpty
                              ? MColors.inkFaint
                              : accentInk,
                          onTap:
                              noteRequired && noteController.text.trim().isEmpty
                              ? null
                              : () => Navigator.pop(
                                  sheetContext,
                                  _DecisionSheetResult(
                                    noteController.text.trim(),
                                  ),
                                ),
                        ),
                      ),
                    ],
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

/// A TextEditingController owned by the widget tree, for a sheet built in a
/// function: it is disposed with the sheet, after its exit animation.
class _OwnedTextController extends StatefulWidget {
  const _OwnedTextController({required this.builder});

  final Widget Function(TextEditingController controller) builder;

  @override
  State<_OwnedTextController> createState() => _OwnedTextControllerState();
}

class _OwnedTextControllerState extends State<_OwnedTextController> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(_controller);
}

String _leaveDateRange(LeaveRequest leave) {
  final start = '${leave.start.day} ${_monthName(leave.start.month)}';
  if (leave.start.year == leave.end.year &&
      leave.start.month == leave.end.month &&
      leave.start.day == leave.end.day) {
    return start;
  }
  return '$start – ${leave.end.day} ${_monthName(leave.end.month)}';
}

String _requestTimestamp(DateTime value) {
  final local = value.toLocal();
  final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
  final minute = local.minute.toString().padLeft(2, '0');
  final suffix = local.hour >= 12 ? 'PM' : 'AM';
  return '${local.day} ${_monthName(local.month)} ${local.year}, $hour:$minute $suffix';
}

class _RequestChip extends StatelessWidget {
  const _RequestChip({
    required this.label,
    required this.foreground,
    required this.background,
    this.large = false,
  });

  final String label;
  final Color foreground;
  final Color background;
  final bool large;

  @override
  Widget build(BuildContext context) => Container(
    padding: EdgeInsets.symmetric(
      horizontal: large ? 12 : 9,
      vertical: large ? 6 : 4,
    ),
    decoration: BoxDecoration(
      color: background,
      borderRadius: BorderRadius.circular(99),
    ),
    child: Text(
      label,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(
        color: foreground,
        fontSize: large ? 13 : 11.5,
        fontWeight: FontWeight.w800,
      ),
    ),
  );
}

/// A manager's choice of how approved overtime is compensated, as the
/// dropdown holds it.
enum OvertimeChoice {
  pay('pay', 0),
  compOffFull('comp_off', 1),
  compOffHalf('comp_off', 0.5);

  const OvertimeChoice(this.kind, this.days);

  final String kind;
  final double days;

  String get label => overtimeChoiceLabel(kind, days);

  /// What the server takes as `compensation`.
  Map<String, Object> get json => kind == 'pay'
      ? const {'kind': 'pay'}
      : {'kind': 'comp_off', 'days': days};

  /// The choice a stored kind and days stand for; null for none.
  static OvertimeChoice? of(String kind, double days) => switch (kind) {
    'pay' => OvertimeChoice.pay,
    'comp_off' =>
      days >= 1 ? OvertimeChoice.compOffFull : OvertimeChoice.compOffHalf,
    _ => null,
  };

  /// Why this can't be decided for [request], or null when it can: comp-off
  /// needs a Comp-off leave type for the employee, and a half-day claim can't
  /// be a full day off.
  String? blockedFor(OvertimeRequest request) {
    if (kind == 'pay') return null;
    if (!request.compOffAvailable) return "Comp-off isn't set up";
    if (this == OvertimeChoice.compOffFull && request.halfDayClaim) {
      return 'Needs a full day of overtime';
    }
    return null;
  }
}

class _OvertimeRequestDetailPage extends StatefulWidget {
  const _OvertimeRequestDetailPage({
    required this.request,
    required this.bloc,
    this.photoUrl,
  });

  final OvertimeRequest request;
  final ManagerBloc bloc;
  final String? photoUrl;

  @override
  State<_OvertimeRequestDetailPage> createState() =>
      _OvertimeRequestDetailPageState();
}

class _OvertimeRequestDetailPageState
    extends State<_OvertimeRequestDetailPage> {
  /// The manager's final call, starting from the employee's preference (or
  /// overtime pay, where the preference can no longer be given). Null on a
  /// request with no preference: approving it then leaves it as it was.
  late OvertimeChoice? _choice = _initialChoice();

  OvertimeRequest get request => widget.request;

  OvertimeChoice? _initialChoice() {
    final preferred = OvertimeChoice.of(
      request.preferredKind,
      request.preferredCompOffDays,
    );
    if (preferred == null) return null;
    return preferred.blockedFor(request) == null
        ? preferred
        : OvertimeChoice.pay;
  }

  @override
  Widget build(BuildContext context) => _RequestDetailScaffold(
    title: 'Overtime',
    subtitle: '${request.who} · ${request.team}',
    decision: request.decision,
    managerNote: request.managerNote,
    summary: RequestSummary(
      screenTitle: 'Overtime',
      successTitle: '',
      successBody: '',
      rows: [
        SummaryRow('Employee', '${request.who} · ${request.team}'),
        SummaryRow('Work Date', _summaryDate(request.workDate)),
        // Half day or full, as it was applied for. The clock times behind it
        // are derived from the shift policy, not chosen by anyone, so showing
        // them as "6:30 PM – 9:30 PM" invented a detail.
        SummaryRow('Duration', request.hoursLabel),
        // What the employee asked for: overtime pay, or comp-off and what it
        // would add. A request from before there was a choice has none.
        if (request.preferenceLabel.isNotEmpty)
          SummaryRow("Employee's preference", request.preferenceDetail),
        // Once approved, the final call — what payroll and the Comp-off
        // balance use.
        if (request.hasCompensationDecision)
          SummaryRow("Manager's decision", request.decisionDetail),
        SummaryRow('Applied On', _summaryDate(request.requestedOn)),
        SummaryRow('Status', _decisionText(request.decision)),
      ],
      reason: request.note,
    ),
    // Directly under the Reason: the manager's decision, which is final.
    belowSummary: request.decision == LeaveDecision.pending
        ? _OvertimeDecisionField(
            request: request,
            value: _choice,
            onChanged: (choice) => setState(() => _choice = choice),
          )
        : null,
    onDecline: () => _decide(context, LeaveDecision.declined),
    onApprove: () => _decide(context, LeaveDecision.approved),
  );

  Future<void> _decide(BuildContext context, LeaveDecision decision) async {
    final approve = decision == LeaveDecision.approved;
    final choice = approve ? _choice : null;
    final result = await _showRequestDecisionSheet(
      context,
      approve: approve,
      requestName: 'overtime',
      person: request.who,
      chipLabel: request.hoursLabel,
      chipForeground: MColors.gold,
      chipBackground: MColors.goldTint,
      icon: Icons.schedule_rounded,
      value: _managerDate(request.workDate),
      // What approving gives them, as decided: comp-off days, or overtime pay.
      trailing: switch (choice?.kind ?? request.compensationKind) {
        'comp_off' =>
          '+${formatDays(choice?.days ?? request.compOffDays)} Comp-off',
        'pay' => 'Overtime Pay',
        _ => request.hoursLabel,
      },
    );
    if (result == null || !context.mounted) return;
    widget.bloc.add(
      DecideOvertime(
        request.id,
        decision,
        managerNote: result.managerNote,
        compensation: choice?.json,
      ),
    );
    Navigator.of(context).pop();
  }
}

/// "Manager's decision": overtime pay, or a full or half day of comp-off,
/// preselected to what the employee asked for. Options that can't be given
/// are shown greyed out with the reason.
class _OvertimeDecisionField extends StatelessWidget {
  const _OvertimeDecisionField({
    required this.request,
    required this.value,
    required this.onChanged,
  });

  final OvertimeRequest request;
  final OvertimeChoice? value;
  final ValueChanged<OvertimeChoice> onChanged;

  @override
  Widget build(BuildContext context) {
    final choice = value;
    final preferred = OvertimeChoice.of(
      request.preferredKind,
      request.preferredCompOffDays,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Divider(height: 1, thickness: 1, color: Color(0xFFE8E8EC)),
        const SizedBox(height: 14),
        const Text(
          "Manager's decision",
          style: TextStyle(color: Color(0xFF6A6A6A), fontSize: 13.5),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: MColors.line),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<OvertimeChoice>(
              key: const ValueKey('overtime-manager-decision'),
              value: choice,
              isExpanded: true,
              hint: const Text(
                'As requested',
                style: TextStyle(color: MColors.inkFaint, fontSize: 14),
              ),
              icon: const Icon(
                Icons.keyboard_arrow_down_rounded,
                color: MColors.inkSoft,
              ),
              borderRadius: BorderRadius.circular(12),
              items: [
                for (final option in OvertimeChoice.values)
                  DropdownMenuItem(
                    value: option,
                    enabled: option.blockedFor(request) == null,
                    child: Text(
                      option.blockedFor(request) == null
                          ? option.label
                          : '${option.label} (${option.blockedFor(request)})',
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: option.blockedFor(request) == null
                            ? MColors.ink
                            : MColors.inkFaint,
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
              ],
              onChanged: (picked) {
                if (picked != null) onChanged(picked);
              },
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          switch (choice) {
            null => 'No preference was given: approving pays it and credits comp-off, as before.',
            OvertimeChoice.pay => 'Approving pays it with their salary.',
            _ =>
              'Approving adds +${formatDays(choice.days)} Comp-off to their balance instead of overtime pay.',
          },
          style: const TextStyle(
            color: MColors.inkSoft,
            fontSize: 12.5,
            height: 1.4,
          ),
        ),
        if (preferred != null && choice != null && choice != preferred) ...[
          const SizedBox(height: 4),
          Text(
            'This differs from their preference (${preferred.label}).',
            style: const TextStyle(
              color: MColors.terraDeep,
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
        const SizedBox(height: 14),
      ],
    );
  }
}

Future<_DecisionSheetResult?> _showRequestDecisionSheet(
  BuildContext context, {
  required bool approve,
  required String requestName,
  required String person,
  required String chipLabel,
  required Color chipForeground,
  required Color chipBackground,
  required IconData icon,
  required String value,
  required String trailing,
}) async {
  final accent = approve ? MColors.approveTint : MColors.rejectTint;
  final accentInk = approve ? MColors.approveInk : MColors.rejectInk;
  final noteController = TextEditingController();
  try {
    return await showModalBottomSheet<_DecisionSheetResult>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) => Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(sheetContext).bottom,
          ),
          child: Container(
            padding: const EdgeInsets.fromLTRB(18, 10, 18, 20),
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            ),
            child: SafeArea(
              top: false,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 38,
                      height: 4,
                      decoration: BoxDecoration(
                        color: MColors.line,
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    '${approve ? 'Approve' : 'Decline'} $requestName',
                    style: const TextStyle(
                      color: MColors.ink,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 7),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          person,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: MColors.inkSoft,
                            fontSize: 13.5,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      _RequestChip(
                        label: chipLabel,
                        foreground: chipForeground,
                        background: chipBackground,
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 13,
                      vertical: 11,
                    ),
                    decoration: BoxDecoration(
                      color: MColors.bg,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        Icon(icon, size: 18, color: MColors.inkFaint),
                        const SizedBox(width: 9),
                        Expanded(
                          child: Text(
                            value,
                            style: const TextStyle(
                              color: MColors.ink,
                              fontSize: 13.5,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        Text(
                          trailing,
                          style: const TextStyle(
                            color: MColors.inkSoft,
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  if (!approve) ...[
                    const Text(
                      'Reason for declining',
                      style: TextStyle(
                        color: MColors.ink,
                        fontSize: 13.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: noteController,
                      autofocus: true,
                      maxLength: 500,
                      maxLines: 3,
                      onChanged: (_) => setSheetState(() {}),
                      decoration: _fieldDecoration(
                        'Explain why this overtime request is being declined…',
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
                  Row(
                    children: [
                      Expanded(
                        flex: 10,
                        child: ActionButton(
                          label: 'Cancel',
                          background: Colors.white,
                          foreground: MColors.inkSoft,
                          border: MColors.line,
                          onTap: () => Navigator.pop(sheetContext),
                        ),
                      ),
                      const SizedBox(width: 11),
                      Expanded(
                        flex: 15,
                        child: ActionButton(
                          label: approve
                              ? 'Confirm approve'
                              : 'Confirm decline',
                          icon: approve
                              ? Icons.check_rounded
                              : Icons.close_rounded,
                          background:
                              !approve && noteController.text.trim().isEmpty
                              ? MColors.line
                              : accent,
                          foreground:
                              !approve && noteController.text.trim().isEmpty
                              ? MColors.inkFaint
                              : accentInk,
                          onTap: !approve && noteController.text.trim().isEmpty
                              ? null
                              : () => Navigator.pop(
                                  sheetContext,
                                  _DecisionSheetResult(
                                    noteController.text.trim(),
                                  ),
                                ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  } finally {
    noteController.dispose();
  }
}
