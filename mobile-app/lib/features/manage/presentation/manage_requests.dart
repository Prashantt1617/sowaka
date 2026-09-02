part of '../../manager/presentation/manager_screen.dart';

enum _RequestType { leave, overtime, attendance }

/// Requesters are the manager's own reports, who are already loaded in the
/// dashboard's team list with their photos — so the avatar resolves from there
/// rather than costing another round trip per request.
String? _requesterPhoto(ManagerState state, String userId) {
  if (userId.isEmpty) return null;
  for (final member in state.dashboard?.team ?? const <TeamMember>[]) {
    if (member.userId == userId) return member.photoUrl;
  }
  return null;
}

class _RequestList extends StatefulWidget {
  const _RequestList({
    required this.state,
    required this.bloc,
    required this.type,
  });

  final ManagerState state;
  final ManagerBloc bloc;
  final _RequestType type;

  @override
  State<_RequestList> createState() => _RequestListState();
}

class _RequestListState extends State<_RequestList> {
  bool _reviewed = false;

  @override
  Widget build(BuildContext context) {
    final isLeave = widget.type == _RequestType.leave;
    final isOvertime = widget.type == _RequestType.overtime;
    final pendingCount = switch (widget.type) {
      _RequestType.leave =>
        widget.state.dashboard!.leaves
            .where((item) => item.decision == LeaveDecision.pending)
            .length,
      _RequestType.overtime =>
        widget.state.dashboard!.overtime
            .where((item) => item.decision == LeaveDecision.pending)
            .length,
      _RequestType.attendance =>
        widget.state.dashboard!.managerRegularizations
            .where((item) => item.decision == LeaveDecision.pending)
            .length,
    };
    final close = switch (widget.type) {
      _RequestType.leave => const CloseLeaveRequests(),
      _RequestType.overtime => const CloseOvertimeRequests(),
      _RequestType.attendance => const CloseAttendanceCorrections(),
    };
    final title = switch (widget.type) {
      _RequestType.leave => 'Leave requests',
      _RequestType.overtime => 'Overtime requests',
      _RequestType.attendance => 'Attendance corrections',
    };

    return Column(
      key: ValueKey('${widget.type.name}-requests'),
      children: [
        _TopBar(
          title: title,
          sub: 'Review requests from your team',
          onBack: () => widget.bloc.add(close),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
          child: Row(
            children: [
              Expanded(
                child: _RequestFilterButton(
                  label: pendingCount == 0
                      ? 'Pending'
                      : 'Pending · $pendingCount',
                  selected: !_reviewed,
                  onTap: () => setState(() => _reviewed = false),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _RequestFilterButton(
                  label: 'Reviewed',
                  selected: _reviewed,
                  onTap: () => setState(() => _reviewed = true),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: Builder(
            builder: (context) {
              if (isLeave) {
                final items = widget.state.dashboard!.leaves
                    .where(
                      (item) => _reviewed
                          ? item.decision != LeaveDecision.pending
                          : item.decision == LeaveDecision.pending,
                    )
                    .toList();
                return _RequestListBody(
                  empty: items.isEmpty,
                  reviewed: _reviewed,
                  children: items
                      .map(
                        (item) => _LeaveCard(
                          leave: item,
                          bloc: widget.bloc,
                          photoUrl: _requesterPhoto(widget.state, item.userId),
                        ),
                      )
                      .toList(),
                );
              }
              if (isOvertime) {
                final items = widget.state.dashboard!.overtime
                    .where(
                      (item) => _reviewed
                          ? item.decision != LeaveDecision.pending
                          : item.decision == LeaveDecision.pending,
                    )
                    .toList();
                return _RequestListBody(
                  empty: items.isEmpty,
                  reviewed: _reviewed,
                  children: items
                      .map(
                        (item) => _OvertimeRequestCard(
                          request: item,
                          bloc: widget.bloc,
                          photoUrl: _requesterPhoto(widget.state, item.userId),
                        ),
                      )
                      .toList(),
                );
              }
              final items = widget.state.dashboard!.managerRegularizations
                  .where(
                    (item) => _reviewed
                        ? item.decision != LeaveDecision.pending
                        : item.decision == LeaveDecision.pending,
                  )
                  .toList();
              return _RequestListBody(
                empty: items.isEmpty,
                reviewed: _reviewed,
                children: items
                    .map(
                      (item) => _AttendanceCorrectionCard(
                        request: item,
                        bloc: widget.bloc,
                        photoUrl: _requesterPhoto(widget.state, item.userId),
                      ),
                    )
                    .toList(),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _RequestFilterButton extends StatelessWidget {
  const _RequestFilterButton({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    borderRadius: BorderRadius.circular(12),
    onTap: onTap,
    child: AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      padding: const EdgeInsets.symmetric(vertical: 11),
      decoration: BoxDecoration(
        color: selected ? MColors.terra : Colors.white,
        border: Border.all(color: selected ? MColors.terra : MColors.line),
        borderRadius: BorderRadius.circular(12),
      ),
      alignment: Alignment.center,
      child: Text(
        label,
        style: TextStyle(
          color: selected ? Colors.white : MColors.inkSoft,
          fontSize: 13.5,
          fontWeight: FontWeight.w800,
        ),
      ),
    ),
  );
}

class _RequestListBody extends StatelessWidget {
  const _RequestListBody({
    required this.empty,
    required this.reviewed,
    required this.children,
  });

  final bool empty;
  final bool reviewed;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    if (empty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                reviewed ? Icons.history_rounded : Icons.task_alt_rounded,
                size: 42,
                color: MColors.sageDeep,
              ),
              const SizedBox(height: 12),
              Text(
                reviewed
                    ? 'No reviewed requests yet.'
                    : 'No requests waiting on you.',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: MColors.inkSoft,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 32),
      itemCount: children.length,
      separatorBuilder: (_, _) => const SizedBox(height: 12),
      itemBuilder: (_, index) => children[index],
    );
  }
}

class _AttendanceCorrectionCard extends StatelessWidget {
  const _AttendanceCorrectionCard({
    required this.request,
    required this.bloc,
    this.photoUrl,
  });
  final AttendanceRegularization request;
  final ManagerBloc bloc;
  final String? photoUrl;

  @override
  Widget build(BuildContext context) => PressableCard(
    onTap: () => Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            _AttendanceCorrectionDetailPage(
              request: request,
              bloc: bloc,
              photoUrl: photoUrl,
            ),
      ),
    ),
    padding: EdgeInsets.zero,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(15, 15, 15, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  AvatarBadge(
                    initial: request.initial,
                    index: request.avatarIndex,
                    size: 42,
                    photoUrl: photoUrl,
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          request.who,
                          style: const TextStyle(
                            color: MColors.ink,
                            fontWeight: FontWeight.w800,
                            fontSize: 15.5,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${request.team} · ${_appliedTimestamp(request.createdAt)}',
                          style: const TextStyle(
                            color: MColors.inkFaint,
                            fontSize: 12.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (request.decision != LeaveDecision.pending)
                    _LeaveStatusPill(decision: request.decision),
                ],
              ),
              const SizedBox(height: 13),
              _AttendanceDatePanel(request: request),
              const SizedBox(height: 12),
              Text(
                request.note,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: MColors.inkSoft,
                  fontSize: 13.5,
                  height: 1.55,
                ),
              ),
              if (request.decision == LeaveDecision.declined &&
                  request.managerNote.isNotEmpty) ...[
                const SizedBox(height: 11),
                _ReviewedDeclineNote(note: request.managerNote),
              ],
            ],
          ),
        ),
        if (request.decision == LeaveDecision.pending)
          Padding(
            padding: const EdgeInsets.fromLTRB(15, 0, 15, 15),
            child: Row(
              children: [
                Expanded(
                  child: ActionButton(
                    label: 'Decline',
                    icon: Icons.close_rounded,
                    background: Colors.white,
                    foreground: MColors.inkSoft,
                    border: MColors.line,
                    onTap: () => _decide(context, LeaveDecision.declined),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ActionButton(
                    label: 'Approve',
                    icon: Icons.check_rounded,
                    background: MColors.sageDeep,
                    foreground: Colors.white,
                    onTap: () => _decide(context, LeaveDecision.approved),
                  ),
                ),
              ],
            ),
          ),
      ],
    ),
  );

  Future<void> _decide(BuildContext context, LeaveDecision decision) async {
    final note = await _showAttendanceDecisionSheet(context, request, decision);
    if (note == null || !context.mounted) return;
    bloc.add(
      DecideAttendanceRegularization(request.id, decision, managerNote: note),
    );
  }
}

class _AttendanceDatePanel extends StatelessWidget {
  const _AttendanceDatePanel({required this.request});
  final AttendanceRegularization request;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
    decoration: BoxDecoration(
      color: MColors.terraTint,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Row(
      children: [
        SvgPicture.asset(
          'assets/icons/calendar_header.svg',
          width: 18,
          height: 18,
          colorFilter: const ColorFilter.mode(MColors.terra, BlendMode.srcIn),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            '${_fullWeekday(request.workDate)}, ${_shortAttendanceDate(request.workDate)}',
            style: const TextStyle(
              color: MColors.terra,
              fontSize: 14.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        Text(
          _attendancePeriod(request),
          style: TextStyle(
            color: MColors.terra.withValues(alpha: .85),
            fontSize: 12.5,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

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
                  background: approved ? MColors.sageDeep : MColors.live,
                  foreground: Colors.white,
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
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: MColors.bg,
    body: Column(
      children: [
        _TopBar(
          title: 'Attendance correction',
          sub: '${request.who} · ${request.team}',
          onBack: () => Navigator.pop(context),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
            children: [
              PressableCard(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Row(
                      children: [
                        AvatarBadge(
                          initial: request.initial,
                          index: request.avatarIndex,
                          size: 50,
                          photoUrl: photoUrl,
                        ),
                        const SizedBox(width: 13),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                request.who,
                                style: const TextStyle(
                                  color: MColors.ink,
                                  fontSize: 17,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                _appliedTimestamp(request.createdAt),
                                style: const TextStyle(
                                  color: MColors.inkFaint,
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (request.decision != LeaveDecision.pending)
                          _LeaveStatusPill(decision: request.decision),
                      ],
                    ),
                    const SizedBox(height: 16),
                    _AttendanceDatePanel(request: request),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              const _LeaveSectionLabel('PUNCH TIMES'),
              const SizedBox(height: 7),
              PressableCard(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 5,
                ),
                child: Column(
                  children: [
                    _LeaveDetailRow(
                      icon: Icons.schedule_rounded,
                      label: 'Punch in',
                      value: _attendanceClock(request.punchIn),
                    ),
                    const Divider(height: 1, color: MColors.line),
                    _LeaveDetailRow(
                      icon: Icons.schedule_rounded,
                      label: 'Punch out',
                      value: _attendanceClock(request.punchOut),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              const _LeaveSectionLabel('REASON'),
              const SizedBox(height: 7),
              PressableCard(
                padding: const EdgeInsets.all(16),
                child: Text(
                  request.note,
                  style: const TextStyle(
                    color: MColors.ink,
                    fontSize: 14.5,
                    height: 1.65,
                  ),
                ),
              ),
              if (request.managerNote.isNotEmpty) ...[
                const SizedBox(height: 18),
                const _LeaveSectionLabel('YOUR NOTE'),
                const SizedBox(height: 7),
                _ReviewedDeclineNote(note: request.managerNote),
              ],
            ],
          ),
        ),
        if (request.decision == LeaveDecision.pending)
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
                      label: 'Decline',
                      icon: Icons.close_rounded,
                      background: Colors.white,
                      foreground: MColors.inkSoft,
                      border: MColors.line,
                      onTap: () => _decide(context, LeaveDecision.declined),
                    ),
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    flex: 2,
                    child: ActionButton(
                      label: 'Approve',
                      icon: Icons.check_rounded,
                      background: MColors.sageDeep,
                      foreground: Colors.white,
                      onTap: () => _decide(context, LeaveDecision.approved),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    ),
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

/// Summarises the punch times an employee is asking to have recorded.
String _attendancePeriod(AttendanceRegularization request) {
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

class _LeaveCard extends StatelessWidget {
  const _LeaveCard({required this.leave, required this.bloc, this.photoUrl});

  final String? photoUrl;
  final LeaveRequest leave;
  final ManagerBloc bloc;

  @override
  Widget build(BuildContext context) {
    final colors = leavePalette(leave.type);
    return PressableCard(
      onTap: () => _openDetails(context),
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(15, 15, 15, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    AvatarBadge(
                      initial: leave.initial,
                      index: leave.avatarIndex,
                      size: 42,
                      photoUrl: photoUrl,
                    ),
                    const SizedBox(width: 11),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            leave.who,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: MColors.ink,
                              fontWeight: FontWeight.w800,
                              fontSize: 15.5,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${leave.team} · ${_appliedTimestamp(leave.requestedOn)}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: MColors.inkFaint,
                              fontSize: 12.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (leave.decision != LeaveDecision.pending) ...[
                      const SizedBox(width: 8),
                      _LeaveStatusPill(decision: leave.decision),
                    ],
                  ],
                ),
                const SizedBox(height: 13),
                _LeaveDatePanel(leave: leave, colors: colors),
                const SizedBox(height: 10),
                _LeaveTypeChip(type: leave.type),
                const SizedBox(height: 11),
                Text(
                  leave.reason,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: MColors.inkSoft,
                    fontSize: 13.5,
                    height: 1.55,
                  ),
                ),
                if (leave.decision == LeaveDecision.declined &&
                    leave.managerNote.isNotEmpty) ...[
                  const SizedBox(height: 11),
                  _ReviewedDeclineNote(note: leave.managerNote),
                ],
              ],
            ),
          ),
          if (leave.decision == LeaveDecision.pending)
            Padding(
              padding: const EdgeInsets.fromLTRB(15, 0, 15, 15),
              child: Row(
                children: [
                  Expanded(
                    child: ActionButton(
                      label: 'Decline',
                      icon: Icons.close_rounded,
                      background: Colors.white,
                      foreground: MColors.inkSoft,
                      border: MColors.line,
                      onTap: () =>
                          _confirmDecision(context, LeaveDecision.declined),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: ActionButton(
                      label: 'Approve',
                      icon: Icons.check_rounded,
                      background: MColors.sageDeep,
                      foreground: Colors.white,
                      onTap: () =>
                          _confirmDecision(context, LeaveDecision.approved),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  void _openDetails(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            _LeaveRequestDetailPage(leave: leave, bloc: bloc, photoUrl: photoUrl),
      ),
    );
  }

  Future<void> _confirmDecision(
    BuildContext context,
    LeaveDecision decision,
  ) async {
    final result = await _showLeaveDecisionSheet(context, leave, decision);
    if (result != null && context.mounted) {
      bloc.add(
        DecideLeave(leave.id, decision, managerNote: result.managerNote),
      );
    }
  }
}

class _LeaveDatePanel extends StatelessWidget {
  const _LeaveDatePanel({required this.leave, required this.colors});

  final LeaveRequest leave;
  final (Color, Color) colors;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
      decoration: BoxDecoration(
        color: colors.$2,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(Icons.calendar_month_rounded, size: 18, color: colors.$1),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _leaveDateRange(leave),
              style: TextStyle(
                color: colors.$1,
                fontSize: 14.5,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Text(
            '${leave.days} ${leave.days == 1 ? 'day' : 'days'}',
            style: TextStyle(
              color: colors.$1.withValues(alpha: .85),
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _LeaveTypeChip extends StatelessWidget {
  const _LeaveTypeChip({required this.type, this.large = false});

  final String type;
  final bool large;

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

class _LeaveStatusPill extends StatelessWidget {
  const _LeaveStatusPill({required this.decision});

  final LeaveDecision decision;

  @override
  Widget build(BuildContext context) {
    final (label, color, background) = switch (decision) {
      LeaveDecision.approved => (
        'Approved',
        MColors.sageDeep,
        MColors.sageTint,
      ),
      LeaveDecision.declined => (
        'Declined',
        MColors.terraDeep,
        MColors.terraTint,
      ),
      LeaveDecision.pending => ('Pending', MColors.gold, MColors.goldTint),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (decision == LeaveDecision.approved) ...[
            Icon(Icons.check_rounded, size: 13, color: color),
            const SizedBox(width: 5),
          ],
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
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
    final colors = leavePalette(leave.type);
    return Scaffold(
      backgroundColor: MColors.bg,
      body: Column(
        children: [
          _TopBar(
            title: 'Leave request',
            sub: '${leave.who} · ${leave.team}',
            onBack: () => Navigator.of(context).pop(),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
              children: [
                PressableCard(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          AvatarBadge(
                            initial: leave.initial,
                            index: leave.avatarIndex,
                            size: 50,
                            photoUrl: photoUrl,
                          ),
                          const SizedBox(width: 13),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  leave.who,
                                  style: const TextStyle(
                                    color: MColors.ink,
                                    fontSize: 17,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  _appliedTimestamp(leave.requestedOn),
                                  style: const TextStyle(
                                    color: MColors.inkFaint,
                                    fontSize: 13,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          leave.decision == LeaveDecision.pending
                              ? _LeaveTypeChip(type: leave.type, large: true)
                              : _LeaveStatusPill(decision: leave.decision),
                        ],
                      ),
                      const SizedBox(height: 16),
                      IntrinsicHeight(
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Expanded(
                              child: _LeaveInfoTile(
                                label: 'DATES',
                                value: _leaveDateRange(leave),
                                background: colors.$2,
                                foreground: colors.$1,
                              ),
                            ),
                            const SizedBox(width: 12),
                            _LeaveInfoTile(
                              label: 'DURATION',
                              value:
                                  '${leave.days} ${leave.days == 1 ? 'day' : 'days'}',
                              background: const Color(0xFFF8F4EE),
                              foreground: MColors.ink,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                const _LeaveSectionLabel('REASON'),
                const SizedBox(height: 7),
                PressableCard(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    leave.reason,
                    style: const TextStyle(
                      color: MColors.ink,
                      fontSize: 14.5,
                      height: 1.65,
                    ),
                  ),
                ),
                if (leave.decision == LeaveDecision.declined &&
                    leave.managerNote.isNotEmpty) ...[
                  const SizedBox(height: 18),
                  const _LeaveSectionLabel('DECLINE NOTE'),
                  const SizedBox(height: 7),
                  PressableCard(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                      leave.managerNote,
                      style: const TextStyle(
                        color: MColors.ink,
                        fontSize: 14.5,
                        height: 1.65,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 18),
                const _LeaveSectionLabel('REQUEST DETAILS'),
                const SizedBox(height: 7),
                PressableCard(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 5,
                  ),
                  child: Column(
                    children: [
                      _LeaveDetailRow(
                        icon: Icons.event_available_rounded,
                        label: 'Leave type',
                        value: leave.type,
                      ),
                      const Divider(height: 1, color: MColors.line),
                      _LeaveDetailRow(
                        icon: Icons.schedule_rounded,
                        label: 'Requested',
                        value: _requestTimestamp(leave.requestedOn),
                      ),
                    ],
                  ),
                ),
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
                      flex: 10,
                      child: ActionButton(
                        label: 'Decline',
                        icon: Icons.close_rounded,
                        background: Colors.white,
                        foreground: MColors.inkSoft,
                        border: MColors.line,
                        onTap: () => _decide(context, LeaveDecision.declined),
                      ),
                    ),
                    const SizedBox(width: 11),
                    Expanded(
                      flex: 14,
                      child: ActionButton(
                        label: 'Approve',
                        icon: Icons.check_rounded,
                        background: MColors.sageDeep,
                        foreground: Colors.white,
                        onTap: () => _decide(context, LeaveDecision.approved),
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

  Future<void> _decide(BuildContext context, LeaveDecision decision) async {
    final result = await _showLeaveDecisionSheet(context, leave, decision);
    if (result == null || !context.mounted) return;
    bloc.add(DecideLeave(leave.id, decision, managerNote: result.managerNote));
  }
}

class _LeaveInfoTile extends StatelessWidget {
  const _LeaveInfoTile({
    required this.label,
    required this.value,
    required this.background,
    required this.foreground,
  });

  final String label;
  final String value;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              color: foreground.withValues(alpha: .75),
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: .7,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            value,
            style: TextStyle(
              color: foreground,
              fontSize: 15,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
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

Future<_DecisionSheetResult?> _showLeaveDecisionSheet(
  BuildContext context,
  LeaveRequest leave,
  LeaveDecision decision,
) async {
  final approve = decision == LeaveDecision.approved;
  final accent = approve ? MColors.sageDeep : MColors.terra;
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
                          '${leave.days}d',
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
                              : Colors.white,
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

String _appliedTimestamp(DateTime value) {
  return 'applied ${daysAgo(value)} ago · ${_requestTimestamp(value)}';
}

String _requestTimestamp(DateTime value) {
  final local = value.toLocal();
  final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
  final minute = local.minute.toString().padLeft(2, '0');
  final suffix = local.hour >= 12 ? 'PM' : 'AM';
  return '${local.day} ${_monthName(local.month)} ${local.year}, $hour:$minute $suffix';
}

class _OvertimeRequestCard extends StatelessWidget {
  const _OvertimeRequestCard({
    required this.request,
    required this.bloc,
    this.photoUrl,
  });

  final String? photoUrl;
  final OvertimeRequest request;
  final ManagerBloc bloc;

  @override
  Widget build(BuildContext context) {
    return PressableCard(
      onTap: () => _openDetails(context),
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(15, 15, 15, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    AvatarBadge(
                      initial: request.initial,
                      index: request.avatarIndex,
                      size: 42,
                      photoUrl: photoUrl,
                    ),
                    const SizedBox(width: 11),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            request.who,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: MColors.ink,
                              fontWeight: FontWeight.w800,
                              fontSize: 15.5,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${request.team} · applied ${daysAgo(request.requestedOn)} ago',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: MColors.inkFaint,
                              fontSize: 12.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    request.decision == LeaveDecision.pending
                        ? _RequestChip(
                            label: request.hoursLabel,
                            foreground: MColors.gold,
                            background: MColors.goldTint,
                          )
                        : _LeaveStatusPill(decision: request.decision),
                  ],
                ),
                const SizedBox(height: 13),
                _RequestHighlightPanel(
                  icon: Icons.schedule_rounded,
                  value: _managerDate(request.workDate),
                  trailing: request.hoursLabel,
                  foreground: MColors.gold,
                  background: MColors.goldTint,
                ),
                const SizedBox(height: 11),
                Text(
                  request.note.isEmpty ? request.timeRangeLabel : request.note,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: MColors.inkSoft,
                    fontSize: 13.5,
                    height: 1.55,
                  ),
                ),
              ],
            ),
          ),
          if (request.decision == LeaveDecision.pending)
            Padding(
              padding: const EdgeInsets.fromLTRB(15, 0, 15, 15),
              child: Row(
                children: [
                  Expanded(
                    child: ActionButton(
                      label: 'Decline',
                      icon: Icons.close_rounded,
                      background: Colors.white,
                      foreground: MColors.inkSoft,
                      border: MColors.line,
                      onTap: () =>
                          _confirmDecision(context, LeaveDecision.declined),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: ActionButton(
                      label: 'Approve',
                      icon: Icons.check_rounded,
                      background: MColors.sageDeep,
                      foreground: Colors.white,
                      onTap: () =>
                          _confirmDecision(context, LeaveDecision.approved),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  void _openDetails(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            _OvertimeRequestDetailPage(
              request: request,
              bloc: bloc,
              photoUrl: photoUrl,
            ),
      ),
    );
  }

  Future<void> _confirmDecision(
    BuildContext context,
    LeaveDecision decision,
  ) async {
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
    if (result != null && context.mounted) {
      bloc.add(
        DecideOvertime(request.id, decision, managerNote: result.managerNote),
      );
    }
  }
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

class _RequestHighlightPanel extends StatelessWidget {
  const _RequestHighlightPanel({
    required this.icon,
    required this.value,
    required this.trailing,
    required this.foreground,
    required this.background,
  });

  final IconData icon;
  final String value;
  final String trailing;
  final Color foreground;
  final Color background;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
    decoration: BoxDecoration(
      color: background,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Row(
      children: [
        Icon(icon, size: 18, color: foreground),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            value,
            style: TextStyle(
              color: foreground,
              fontSize: 14.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        Text(
          trailing,
          style: TextStyle(
            color: foreground.withValues(alpha: .85),
            fontSize: 12.5,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
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
  Widget build(BuildContext context) => _ManagerRequestDetailPage(
    title: 'Overtime request',
    photoUrl: photoUrl,
    person: request.who,
    team: request.team,
    initial: request.initial,
    avatarIndex: request.avatarIndex,
    requestedOn: request.requestedOn,
    chip: request.decision == LeaveDecision.pending
        ? _RequestChip(
            label: request.hoursLabel,
            foreground: MColors.gold,
            background: MColors.goldTint,
            large: true,
          )
        : _LeaveStatusPill(decision: request.decision),
    primaryLabel: 'WORK DATE',
    primaryValue: _managerDate(request.workDate),
    primaryForeground: MColors.gold,
    primaryBackground: MColors.goldTint,
    secondaryLabel: 'DURATION',
    secondaryValue: request.hoursLabel,
    noteLabel: request.note.isEmpty ? null : 'NOTE',
    note: request.note.isEmpty ? null : request.note,
    details: [
      (Icons.schedule_rounded, 'Time', request.timeRangeLabel),
      (
        Icons.schedule_rounded,
        'Requested',
        '${daysAgo(request.requestedOn)} ago',
      ),
    ],
    pending: request.decision == LeaveDecision.pending,
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

class _ManagerRequestDetailPage extends StatelessWidget {
  const _ManagerRequestDetailPage({
    required this.title,
    required this.person,
    required this.team,
    required this.initial,
    required this.avatarIndex,
    required this.requestedOn,
    required this.chip,
    required this.primaryLabel,
    required this.primaryValue,
    required this.primaryForeground,
    required this.primaryBackground,
    required this.secondaryLabel,
    required this.secondaryValue,
    required this.details,
    required this.pending,
    required this.onDecline,
    required this.onApprove,
    this.noteLabel,
    this.note,
    this.photoUrl,
  });

  final String title;
  final String person;
  final String team;
  final String initial;
  final int avatarIndex;
  final String? photoUrl;
  final DateTime requestedOn;
  final Widget chip;
  final String primaryLabel;
  final String primaryValue;
  final Color primaryForeground;
  final Color primaryBackground;
  final String secondaryLabel;
  final String secondaryValue;
  final List<(IconData, String, String)> details;
  final bool pending;
  final VoidCallback onDecline;
  final VoidCallback onApprove;
  final String? noteLabel;
  final String? note;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: MColors.bg,
    body: Column(
      children: [
        _TopBar(
          title: title,
          sub: '$person · $team',
          onBack: () => Navigator.of(context).pop(),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
            children: [
              PressableCard(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Row(
                      children: [
                        AvatarBadge(
                          initial: initial,
                          index: avatarIndex,
                          size: 50,
                          photoUrl: photoUrl,
                        ),
                        const SizedBox(width: 13),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                person,
                                style: const TextStyle(
                                  color: MColors.ink,
                                  fontSize: 17,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Applied ${daysAgo(requestedOn)} ago',
                                style: const TextStyle(
                                  color: MColors.inkFaint,
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        Flexible(child: chip),
                      ],
                    ),
                    const SizedBox(height: 16),
                    IntrinsicHeight(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(
                            child: _LeaveInfoTile(
                              label: primaryLabel,
                              value: primaryValue,
                              background: primaryBackground,
                              foreground: primaryForeground,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _LeaveInfoTile(
                              label: secondaryLabel,
                              value: secondaryValue,
                              background: const Color(0xFFF8F4EE),
                              foreground: MColors.ink,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              if (note != null) ...[
                const SizedBox(height: 18),
                _LeaveSectionLabel(noteLabel!),
                const SizedBox(height: 7),
                PressableCard(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    note!,
                    style: const TextStyle(
                      color: MColors.ink,
                      fontSize: 14.5,
                      height: 1.65,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 18),
              const _LeaveSectionLabel('REQUEST DETAILS'),
              const SizedBox(height: 7),
              PressableCard(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 5,
                ),
                child: Column(
                  children: [
                    for (var index = 0; index < details.length; index++) ...[
                      _LeaveDetailRow(
                        icon: details[index].$1,
                        label: details[index].$2,
                        value: details[index].$3,
                      ),
                      if (index != details.length - 1)
                        const Divider(height: 1, color: MColors.line),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
        if (pending)
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
                    flex: 10,
                    child: ActionButton(
                      label: 'Decline',
                      icon: Icons.close_rounded,
                      background: Colors.white,
                      foreground: MColors.inkSoft,
                      border: MColors.line,
                      onTap: onDecline,
                    ),
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    flex: 14,
                    child: ActionButton(
                      label: 'Approve',
                      icon: Icons.check_rounded,
                      background: MColors.sageDeep,
                      foreground: Colors.white,
                      onTap: onApprove,
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
  final accent = approve ? MColors.sageDeep : MColors.live;
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
                              : Colors.white,
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
