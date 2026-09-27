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
            approved ? 'Approve correction' : 'Decline correction',
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
                  label: approved ? 'Confirm approve' : 'Confirm decline',
                  icon: approved ? Icons.check_rounded : Icons.close_rounded,
                  // Same colours as the Approve and Reject buttons on the card
                  // this sheet was opened from.
                  background: approved ? MColors.approveTint : MColors.rejectTint,
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
    title: 'Attendance Correction',
    subtitle: '${request.who} · ${request.team}',
    decision: request.decision,
    managerNote: request.managerNote,
    summary: RequestSummary(
      screenTitle: 'Attendance Correction',
      successTitle: '',
      successBody: '',
      rows: [
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
      reason: request.note,
    ),
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

/// What the employee is asking for: the day type on current corrections, and
/// the punch times on ones raised before day types existed.
String _attendancePeriod(AttendanceRegularization request) {
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
  });

  final LeaveRequest leave;
  final ManagerBloc bloc;
  final String? photoUrl;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: MColors.bg,
      body: Column(
        children: [
          _TopBar(
            title: 'Leave',
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
                        leave.halfDay ? 'Half Day' : '${_days(leave.days)} day'
                            '${leave.days == 1 ? '' : 's'}',
                      ),
                      SummaryRow('Applied On', _summaryDate(leave.requestedOn)),
                      SummaryRow('Status', _statusLabel(leave.decision)),
                    ],
                    reason: leave.reason,
                    documentName: leave.documentName,
                    documentUrl: leave.documentUrl,
                  ),
                  showSuccess: false,
                ),
                if (leave.managerNote.isNotEmpty) ...[
                  const SizedBox(height: 18),
                  const _LeaveSectionLabel('YOUR NOTE'),
                  const SizedBox(height: 7),
                  _ReviewedDeclineNote(note: leave.managerNote),
                ],
              ],
            ),
          ),
          if (leave.decision == LeaveDecision.pending)
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

  static String _statusLabel(LeaveDecision decision) => switch (decision) {
    LeaveDecision.approved => 'Approved',
    LeaveDecision.declined => 'Declined',
    LeaveDecision.pending => 'Pending',
  };

  Future<void> _decide(BuildContext context, LeaveDecision decision) async {
    final result = await _showLeaveDecisionSheet(context, leave, decision);
    if (result == null || !context.mounted) return;
    bloc.add(DecideLeave(leave.id, decision, managerNote: result.managerNote));
  }
}


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
  });

  final String title;
  final String subtitle;
  final LeaveDecision decision;
  final String managerNote;
  final RequestSummary summary;
  final VoidCallback onApprove;
  final VoidCallback onDecline;

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
                        label: 'Decline',
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
  LeaveDecision.pending => 'Pending',
};

/// "Friday, 21 Aug" — shared by the request summary screens.
String _summaryDate(DateTime value) =>
    '${_fullWeekday(value)}, ${value.day} '
    '${const ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][value.month - 1]}';

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

Future<_DecisionSheetResult?> _showLeaveDecisionSheet(
  BuildContext context,
  LeaveRequest leave,
  LeaveDecision decision,
) async {
  final approve = decision == LeaveDecision.approved;
  // The colours the Approve and Reject buttons wear on the card this sheet
  // was opened from, so confirming looks like what was tapped.
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
                    approve ? 'Approve leave' : 'Decline leave',
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
                    label: 'Applied',
                    value: _requestTimestamp(leave.requestedOn),
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
                        'Explain why this leave request is being declined…',
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

class _OvertimeRequestDetailPage extends StatelessWidget {
  const _OvertimeRequestDetailPage({
    required this.request,
    required this.bloc,
    this.photoUrl,
  });

  final OvertimeRequest request;
  final ManagerBloc bloc;
  final String? photoUrl;

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
        SummaryRow('Applied On', _summaryDate(request.requestedOn)),
        SummaryRow('Status', _decisionText(request.decision)),
      ],
      reason: request.note,
    ),
    onDecline: () => _decide(context, LeaveDecision.declined),
    onApprove: () => _decide(context, LeaveDecision.approved),
  );

  Future<void> _decide(BuildContext context, LeaveDecision decision) async {
    final result = await _showRequestDecisionSheet(
      context,
      approve: decision == LeaveDecision.approved,
      requestName: 'overtime',
      person: request.who,
      chipLabel: request.hoursLabel,
      chipForeground: MColors.gold,
      chipBackground: MColors.goldTint,
      icon: Icons.schedule_rounded,
      value: _managerDate(request.workDate),
      trailing: request.hoursLabel,
    );
    if (result == null || !context.mounted) return;
    bloc.add(
      DecideOvertime(request.id, decision, managerNote: result.managerNote),
    );
    Navigator.of(context).pop();
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
