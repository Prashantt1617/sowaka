part of '../../manager/presentation/manager_screen.dart';

enum _TeamSection { myTeam, requests }

class _TeamHome extends StatefulWidget {
  const _TeamHome({
    required this.state,
    required this.bloc,
    required this.onOpenProfile,
    required this.onNotifications,
    required this.onOpenComposer,
  });

  final ManagerState state;
  final ManagerBloc bloc;
  final VoidCallback onOpenProfile;
  final VoidCallback onNotifications;
  final VoidCallback onOpenComposer;

  @override
  State<_TeamHome> createState() => _TeamHomeState();
}

class _TeamHomeState extends State<_TeamHome> {
  _TeamSection _section = _TeamSection.myTeam;

  @override
  Widget build(BuildContext context) {
    final data = widget.state.dashboard!;
    final canManage = widget.state.canManage;
    final pendingRequests =
        data.leaves.where((l) => l.decision == LeaveDecision.pending).length +
        data.overtime.where((o) => o.decision == LeaveDecision.pending).length +
        data.managerRegularizations
            .where((r) => r.decision == LeaveDecision.pending)
            .length;

    return ColoredBox(
      color: const Color(0xFFF7F7F9),
      child: Column(
        key: const ValueKey('team-home'),
        children: [
          ColoredBox(
            color: Colors.white,
            child: Column(
              children: [
                AppHomeHeader(
                  profileAction: _ProfileAvatarAction(
                    initial: data.managerInitial,
                    photoUrl: data.managerPhotoUrl,
                    onTap: widget.onOpenProfile,
                    size: 30,
                  ),
                  onNotifications: widget.onNotifications,
                  onQuickCreate: widget.onOpenComposer,
                ),
                // Requests are a manager capability: an individual contributor
                // gets the same team list, read-only, with no segment to
                // switch — and no white gap where the segment would have sat,
                // so the header meets the page background the way it does on
                // the Apply Leave and Reimbursement screens.
                if (canManage) ...[
                  const SizedBox(height: 14),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: _TeamSegmentedControl(
                      section: _section,
                      pendingRequests: pendingRequests,
                      onChanged: (value) => setState(() => _section = value),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),
          Expanded(
            child: !canManage || _section == _TeamSection.myTeam
                ? _MyTeamView(
                    data: data,
                    bloc: widget.bloc,
                    onNotifications: widget.onNotifications,
                    onOpenComposer: widget.onOpenComposer,
                    onOpenProfile: widget.onOpenProfile,
                    canManage: canManage,
                  )
                : _TeamRequestsView(data: data, bloc: widget.bloc),
          ),
        ],
      ),
    );
  }
}

class _TeamSegmentedControl extends StatelessWidget {
  const _TeamSegmentedControl({
    required this.section,
    required this.pendingRequests,
    required this.onChanged,
  });

  final _TeamSection section;
  final int pendingRequests;
  final ValueChanged<_TeamSection> onChanged;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFEBEBEB))),
      ),
      child: Row(
        children: [
          Expanded(
            child: _SegmentTab(
              label: 'My Team',
              selected: section == _TeamSection.myTeam,
              onTap: () => onChanged(_TeamSection.myTeam),
            ),
          ),
          Expanded(
            child: _SegmentTab(
              label: pendingRequests == 0
                  ? 'Requests'
                  : 'Requests · $pendingRequests',
              selected: section == _TeamSection.requests,
              onTap: () => onChanged(_TeamSection.requests),
            ),
          ),
        ],
      ),
    );
  }
}

class _SegmentTab extends StatelessWidget {
  const _SegmentTab({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        alignment: Alignment.center,
        padding: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: selected ? const Color(0xFF222222) : Colors.transparent,
              width: 2,
            ),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? const Color(0xFF222222) : const Color(0xFF717171),
            fontSize: 14,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

class _MyTeamView extends StatefulWidget {
  const _MyTeamView({
    required this.data,
    required this.bloc,
    required this.onNotifications,
    required this.onOpenComposer,
    required this.onOpenProfile,
    required this.canManage,
  });

  final ManagerDashboard data;
  final ManagerBloc bloc;
  final VoidCallback onNotifications;
  final VoidCallback onOpenComposer;
  final VoidCallback onOpenProfile;
  final bool canManage;

  @override
  State<_MyTeamView> createState() => _MyTeamViewState();
}

class _MyTeamViewState extends State<_MyTeamView> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final data = widget.data;
    final filtered = _query.isEmpty
        ? data.team
        : data.team
              .where(
                (member) =>
                    member.name.toLowerCase().contains(_query.toLowerCase()),
              )
              .toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
      children: [
        _FeedbackSearchField(
          query: _query,
          onChanged: (value) => setState(() => _query = value),
          onClear: () => setState(() => _query = ''),
          hint: 'Search employee',
        ),
        const SizedBox(height: 16),
        // The viewer's own card, matching the teammate cards in this section
        // and opening their personal profile.
        if (_query.isEmpty) ...[
          _MyTeamCard(
            name: data.managerName,
            team: data.managerTeam,
            initial: data.managerInitial,
            photoUrl: data.managerPhotoUrl,
            onTap: widget.onOpenProfile,
          ),
          const SizedBox(height: 12),
        ],
        if (filtered.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 40),
            child: Center(
              child: Text(
                data.team.isEmpty
                    ? 'No direct reports yet.'
                    : 'No teammates match "$_query".',
                style: const TextStyle(
                  color: MColors.inkFaint,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          )
        else
          ...filtered.map(
            (member) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _TeamMemberRow(
                member: member,
                canManage: widget.canManage,
                data: data,
                bloc: widget.bloc,
                onNotifications: widget.onNotifications,
                onOpenComposer: widget.onOpenComposer,
              ),
            ),
          ),
      ],
    );
  }
}

class _TeamMemberRow extends StatelessWidget {
  const _TeamMemberRow({
    required this.member,
    required this.canManage,
    required this.data,
    required this.bloc,
    required this.onNotifications,
    required this.onOpenComposer,
  });

  final TeamMember member;

  /// Read-only for individual contributors: no request counts, no decisions.
  final bool canManage;
  final ManagerDashboard data;
  final ManagerBloc bloc;
  final VoidCallback onNotifications;
  final VoidCallback onOpenComposer;

  @override
  Widget build(BuildContext context) {
    final pendingCount = canManage
        ? _pendingRequestCount(data, member.userId)
        : 0;
    final upcomingLeave = _upcomingLeaveFor(data, member.userId);
    final birthdaySoon = _isBirthdaySoon(member.birthday);
    final present = member.todayStatus == TeamPresenceStatus.present;

    return PressableCard(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => _TeamMemberProfilePage(
            member: member,
            data: data,
            bloc: bloc,
            onNotifications: onNotifications,
            onOpenComposer: onOpenComposer,
            canManage: canManage,
          ),
        ),
      ),
      padding: const EdgeInsets.all(17),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 56,
                height: 56,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    _TeamMemberPhoto(member: member, size: 56),
                    Positioned(
                      right: 0,
                      bottom: 0,
                      child: Container(
                        width: 14,
                        height: 14,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: present
                              ? const Color(0xFF00C950)
                              : const Color(0xFFDDDDDD),
                          border: Border.all(color: Colors.white, width: 1.5),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      member.isManager
                          ? '${member.name} (Manager)'
                          : member.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF222222),
                        fontWeight: FontWeight.w700,
                        fontSize: 17,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      member.team,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF717171),
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 4),
                    // No presence pill: the dot on the avatar already conveys
                    // present / not punched in.
                    if (pendingCount > 0)
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [_RequestCountPill(count: pendingCount)],
                      ),
                    if (upcomingLeave != null || birthdaySoon) ...[
                      const SizedBox(height: 4),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          if (upcomingLeave != null)
                            const _TagChip(
                              icon: Image(
                                image: AssetImage(
                                  'assets/icons/team_pill_leave_calendar.png',
                                ),
                              ),
                              label: 'Leave Upcoming',
                            ),
                          if (birthdaySoon)
                            _TagChip(
                              icon: SvgPicture.asset(
                                'assets/icons/team_pill_birthday_cupcake.svg',
                              ),
                              label: 'Birthday Soon',
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              SvgPicture.asset(
                'assets/icons/chevron_right_expand.svg',
                width: 20,
                height: 20,
                colorFilter: const ColorFilter.mode(
                  MColors.inkFaint,
                  BlendMode.srcIn,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The viewer's own row in the team list — same card as a teammate's, opening
/// their personal profile instead of a member page.
class _MyTeamCard extends StatelessWidget {
  const _MyTeamCard({
    required this.name,
    required this.team,
    required this.initial,
    required this.photoUrl,
    required this.onTap,
  });

  final String name;
  final String team;
  final String initial;
  final String? photoUrl;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableCard(
      onTap: onTap,
      padding: const EdgeInsets.all(17),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 56,
            height: 56,
            child: photoUrl == null || photoUrl!.isEmpty
                ? AvatarBadge(initial: initial, index: 0, size: 56)
                : ClipOval(
                    child: Image(
                      image: avatarImageProvider(photoUrl!),
                      width: 56,
                      height: 56,
                      fit: BoxFit.cover,
                    ),
                  ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$name (You)',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF222222),
                    fontWeight: FontWeight.w700,
                    fontSize: 17,
                  ),
                ),
                const SizedBox(height: 2),
                if (team.isNotEmpty)
                  Text(
                    team,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF717171),
                      fontSize: 14,
                    ),
                  ),
              ],
            ),
          ),
          SvgPicture.asset(
            'assets/icons/chevron_right_expand.svg',
            width: 20,
            height: 20,
            colorFilter: const ColorFilter.mode(
              MColors.inkFaint,
              BlendMode.srcIn,
            ),
          ),
        ],
      ),
    );
  }
}

class _RequestCountPill extends StatelessWidget {
  const _RequestCountPill({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: const Color(0xFFFFE6E6),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        '$count request${count == 1 ? '' : 's'}',
        style: const TextStyle(
          color: Color(0xFFFF5A5F),
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _TagChip extends StatelessWidget {
  const _TagChip({required this.icon, required this.label});

  /// Per node 546:5832: these chips use the exact Figma icon assets
  /// (calendar PNG, twemoji cupcake SVG), not generic Material icons.
  final Widget icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F7F9),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: const Color(0xFFEBEBEB)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(width: 20, height: 20, child: icon),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF484848),
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

int _pendingRequestCount(ManagerDashboard data, String userId) {
  if (userId.isEmpty) return 0;
  final leaves = data.leaves
      .where((l) => l.userId == userId && l.decision == LeaveDecision.pending)
      .length;
  final overtime = data.overtime
      .where((o) => o.userId == userId && o.decision == LeaveDecision.pending)
      .length;
  final corrections = data.managerRegularizations
      .where((r) => r.userId == userId && r.decision == LeaveDecision.pending)
      .length;
  return leaves + overtime + corrections;
}

LeaveRequest? _upcomingLeaveFor(ManagerDashboard data, String userId) {
  if (userId.isEmpty) return null;
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final upcoming =
      data.leaves
          .where(
            (l) =>
                l.userId == userId &&
                l.decision == LeaveDecision.approved &&
                !l.start.isBefore(today),
          )
          .toList()
        ..sort((a, b) => a.start.compareTo(b.start));
  return upcoming.firstOrNull;
}

bool _isBirthdaySoon(DateTime? birthday, {int windowDays = 14}) {
  if (birthday == null) return false;
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  var next = DateTime(now.year, birthday.month, birthday.day);
  if (next.isBefore(today)) {
    next = DateTime(now.year + 1, birthday.month, birthday.day);
  }
  final diff = next.difference(today).inDays;
  return diff >= 0 && diff <= windowDays;
}

enum _RequestViewMode {
  newestFirst,
  oldestFirst,
  leaveOnly,
  overtimeOnly,
  correctionOnly,
}

class _TeamRequestsView extends StatefulWidget {
  const _TeamRequestsView({required this.data, required this.bloc});

  final ManagerDashboard data;
  final ManagerBloc bloc;

  @override
  State<_TeamRequestsView> createState() => _TeamRequestsViewState();
}

class _TeamRequestsViewState extends State<_TeamRequestsView> {
  _RequestViewMode _mode = _RequestViewMode.newestFirst;
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final data = widget.data;
    final bloc = widget.bloc;
    final entries =
        <(DateTime date, String who, String kind, Widget card, bool pending)>[
      for (final leave in data.leaves)
        (
          leave.requestedOn,
          leave.who,
          'leave',
          _TeamRequestCard(
            onViewDetails: () => showRequestDetailsSheet(
              context,
              title: '${leave.type} leave · ${leave.who}',
              statusLabel: switch (leave.decision) {
                LeaveDecision.approved => 'Approved',
                LeaveDecision.declined => 'Declined',
                LeaveDecision.pending => 'Pending',
              },
              statusColor: _decisionInk(leave.decision),
              statusTint: _decisionTint(leave.decision),
              rows: [
                ('Employee', '${leave.who} · ${leave.team}'),
                ('Type', leave.type),
                ('Dates', _leaveDateRange(leave)),
                ('Days', leave.daysLabel),
                ('Applied on', _managerDate(leave.requestedOn)),
                ('Reason', leave.reason),
              ],
              responseLabel: switch (leave.decision) {
                LeaveDecision.pending => '',
                LeaveDecision.approved => 'You approved this',
                LeaveDecision.declined => 'You declined this',
              },
              responseNote: leave.managerNote,
            ),
            initial: leave.initial,
            avatarIndex: leave.avatarIndex,
            name: leave.who,
            role: leave.team,
            rows: [
              ('Type:', leave.type),
              ('Date:', _leaveDateRange(leave)),
              ('Comment:', leave.reason),
            ],
            decision: leave.decision,
            responseNote: leave.managerNote,
            onApprove: () =>
                bloc.add(DecideLeave(leave.id, LeaveDecision.approved)),
            onReject: () async {
              final reason = await _showDeclineReasonSheet(context);
              if (reason == null) return;
              bloc.add(
                DecideLeave(
                  leave.id,
                  LeaveDecision.declined,
                  managerNote: reason,
                ),
              );
            },
          ),
          leave.decision == LeaveDecision.pending,
        ),
      for (final request in data.overtime)
        (
          request.requestedOn,
          request.who,
          'overtime',
          _TeamRequestCard(
            onViewDetails: () => showRequestDetailsSheet(
              context,
              title: 'Overtime · ${request.who}',
              statusLabel: switch (request.decision) {
                LeaveDecision.approved => 'Approved',
                LeaveDecision.declined => 'Declined',
                LeaveDecision.pending => 'Pending',
              },
              statusColor: _decisionInk(request.decision),
              statusTint: _decisionTint(request.decision),
              rows: [
                ('Employee', '${request.who} · ${request.team}'),
                ('Work date', _managerDate(request.workDate)),
                ('Hours', request.hoursLabel),
                ('Time', request.timeRangeLabel),
                ('Applied on', _managerDate(request.requestedOn)),
                ('Note', request.note),
              ],
              responseLabel: switch (request.decision) {
                LeaveDecision.pending => '',
                LeaveDecision.approved => 'You approved this',
                LeaveDecision.declined => 'You declined this',
              },
              responseNote: request.managerNote,
            ),
            initial: request.initial,
            avatarIndex: request.avatarIndex,
            name: request.who,
            role: request.team,
            rows: [
              ('Type:', 'Overtime'),
              ('Date:', _managerDate(request.workDate)),
              ('Overtime hrs:', request.hoursLabel),
              (
                'Comment:',
                request.note.isEmpty ? request.timeRangeLabel : request.note,
              ),
            ],
            decision: request.decision,
            responseNote: request.managerNote,
            onApprove: () =>
                bloc.add(DecideOvertime(request.id, LeaveDecision.approved)),
            onReject: () async {
              final reason = await _showDeclineReasonSheet(context);
              if (reason == null) return;
              bloc.add(
                DecideOvertime(
                  request.id,
                  LeaveDecision.declined,
                  managerNote: reason,
                ),
              );
            },
          ),
          request.decision == LeaveDecision.pending,
        ),
      for (final request in data.managerRegularizations)
        (
          request.createdAt,
          request.who,
          'correction',
          _TeamRequestCard(
            onViewDetails: () => showRequestDetailsSheet(
              context,
              title: 'Attendance correction · ${request.who}',
              statusLabel: switch (request.decision) {
                LeaveDecision.approved => 'Approved',
                LeaveDecision.declined => 'Declined',
                LeaveDecision.pending => 'Pending',
              },
              statusColor: _decisionInk(request.decision),
              statusTint: _decisionTint(request.decision),
              rows: [
                ('Employee', '${request.who} · ${request.team}'),
                ('Work date', _shortAttendanceDate(request.workDate)),
                ('Punches asked for', _attendancePeriod(request)),
                ('Raised on', _managerDate(request.createdAt)),
                ('Reason', request.note),
              ],
              responseLabel: switch (request.decision) {
                LeaveDecision.pending => '',
                LeaveDecision.approved => 'You approved this',
                LeaveDecision.declined => 'You declined this',
              },
              responseNote: request.managerNote,
            ),
            initial: request.initial,
            avatarIndex: request.avatarIndex,
            name: request.who,
            role: request.team,
            rows: [
              ('Type:', 'Correction'),
              ('Date:', _shortAttendanceDate(request.workDate)),
              ('Correction:', _attendancePeriod(request)),
              ('Comment:', request.note),
            ],
            decision: request.decision,
            responseNote: request.managerNote,
            onApprove: () => bloc.add(
              DecideAttendanceRegularization(
                request.id,
                LeaveDecision.approved,
              ),
            ),
            onReject: () => bloc.add(
              DecideAttendanceRegularization(
                request.id,
                LeaveDecision.declined,
              ),
            ),
          ),
          request.decision == LeaveDecision.pending,
        ),
    ];

    var filtered = switch (_mode) {
      _RequestViewMode.leaveOnly =>
        entries.where((entry) => entry.$3 == 'leave').toList(),
      _RequestViewMode.overtimeOnly =>
        entries.where((entry) => entry.$3 == 'overtime').toList(),
      _RequestViewMode.correctionOnly =>
        entries.where((entry) => entry.$3 == 'correction').toList(),
      _RequestViewMode.newestFirst ||
      _RequestViewMode.oldestFirst => [...entries],
    };
    if (_query.isNotEmpty) {
      filtered = filtered
          .where(
            (entry) => entry.$2.toLowerCase().contains(_query.toLowerCase()),
          )
          .toList();
    }
    filtered.sort(
      (a, b) => _mode == _RequestViewMode.oldestFirst
          ? a.$1.compareTo(b.$1)
          : b.$1.compareTo(a.$1),
    );
    // Anything still waiting on this manager sits above what they have
    // already decided, whichever order the dates are in.
    filtered.sort((a, b) {
      final aPending = a.$5 ? 0 : 1;
      final bPending = b.$5 ? 0 : 1;
      return aPending.compareTo(bPending);
    });

    return ColoredBox(
      color: const Color(0xFFF7F7F9),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Team Requests',
                style: TextStyle(
                  color: Color(0xFF222222),
                  fontWeight: FontWeight.w600,
                  fontSize: 20,
                  letterSpacing: 0.4,
                ),
              ),
              _ViewByButton(
                mode: _mode,
                onChanged: (mode) => setState(() => _mode = mode),
              ),
            ],
          ),

          const SizedBox(height: 14),
          _FeedbackSearchField(
            query: _query,
            onChanged: (value) => setState(() => _query = value),
            onClear: () => setState(() => _query = ''),
            hint: 'Search employee',
          ),
          const SizedBox(height: 14),
          if (filtered.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 32),
              child: Column(
                children: [
                  const Icon(
                    Icons.task_alt_rounded,
                    size: 42,
                    color: MColors.sageDeep,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    entries.isEmpty
                        ? 'No requests from your team yet.'
                        : _query.isNotEmpty
                        ? 'No requests match "$_query".'
                        : 'No requests match this filter.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: MColors.inkSoft,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            )
          else
            for (final entry in filtered) ...[
              entry.$4,
              const SizedBox(height: 12),
            ],
        ],
      ),
    );
  }
}

class _ViewByButton extends StatelessWidget {
  const _ViewByButton({required this.mode, required this.onChanged});

  final _RequestViewMode mode;
  final ValueChanged<_RequestViewMode> onChanged;

  static const _labels = {
    _RequestViewMode.oldestFirst: 'Oldest to Newest',
    _RequestViewMode.newestFirst: 'Newest to Oldest',
    _RequestViewMode.leaveOnly: 'Leave Request',
    _RequestViewMode.correctionOnly: 'Correction Request',
    _RequestViewMode.overtimeOnly: 'Overtime Request',
  };

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => _showViewBySheet(context, mode, onChanged),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xFFF7F7F9),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFEBEBEB)),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'View by',
              style: TextStyle(
                color: Color(0xFF222222),
                fontSize: 12,
                fontWeight: FontWeight.w400,
              ),
            ),
            SizedBox(width: 6),
            Icon(Icons.expand_more_rounded, size: 14, color: Color(0xFF717171)),
          ],
        ),
      ),
    );
  }
}

void _showViewBySheet(
  BuildContext context,
  _RequestViewMode current,
  ValueChanged<_RequestViewMode> onChanged,
) {
  showModalBottomSheet<void>(
    context: context,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
    ),
    builder: (sheetContext) => SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(0, 12, 0, 4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFD1D5DB),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            const SizedBox(height: 12),
            for (final entry in _ViewByButton._labels.entries) ...[
              InkWell(
                onTap: () {
                  onChanged(entry.key);
                  Navigator.of(sheetContext).pop();
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 14,
                  ),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      entry.value,
                      style: TextStyle(
                        color: const Color(0xFF222222),
                        fontSize: 16,
                        fontWeight: entry.key == current
                            ? FontWeight.w700
                            : FontWeight.w400,
                        decoration: entry.key == current
                            ? TextDecoration.underline
                            : TextDecoration.none,
                        decorationColor: const Color(0xFF222222),
                      ),
                    ),
                  ),
                ),
              ),
              if (entry.key != _ViewByButton._labels.keys.last)
                const Divider(height: 1, color: Color(0xFFEBEBEB)),
            ],
          ],
        ),
      ),
    ),
  );
}

class _TeamRequestCard extends StatelessWidget {
  const _TeamRequestCard({
    this.onViewDetails,
    required this.initial,
    required this.avatarIndex,
    required this.name,
    required this.role,
    required this.rows,
    required this.decision,
    this.onApprove,
    this.onReject,
    this.responseNote = '',
  });

  final String initial;
  final int avatarIndex;
  final String name;
  final String role;
  final List<(String label, String value)> rows;
  final LeaveDecision decision;
  final VoidCallback? onApprove;
  final VoidCallback? onReject;

  /// The note left with the decision, shown once a request has been reviewed.
  final String responseNote;

  /// Opens the request in full — everything the employee filled in, and the
  /// response if it has been decided.
  final VoidCallback? onViewDetails;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFEBEBEB)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .1),
            blurRadius: 3,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AvatarBadge(initial: initial, index: avatarIndex, size: 35),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF222222),
                        fontWeight: FontWeight.w600,
                        fontSize: 16,
                      ),
                    ),
                    Text(
                      role,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF717171),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          for (final row in rows) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  row.$1,
                  style: const TextStyle(
                    color: Color(0xFF717171),
                    fontSize: 14,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    row.$2,
                    style: const TextStyle(
                      color: Color(0xFF222222),
                      fontSize: 14,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
          ],
          if (onViewDetails case final open?) ...[
            _ManagerViewDetailsLink(onTap: open),
            const SizedBox(height: 6),
          ],
          const SizedBox(height: 8),
          // Once a request has been decided, the card reports the outcome
          // instead of offering buttons that would do nothing.
          if (decision != LeaveDecision.pending)
            _RequestResponseBlock(decision: decision, note: responseNote)
          else
            Row(
              children: [
                Expanded(
                  child: _TeamDecisionButton(
                    label: 'Approve',
                    background: const Color(0xFFDAFFD3),
                    foreground: const Color(0xFF34C759),
                    onTap: onApprove!,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _TeamDecisionButton(
                    label: 'Reject',
                    background: const Color(0xFFFDDBDB),
                    foreground: const Color(0xFFFF383C),
                    onTap: onReject!,
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

/// What happened to a request, for the Reviewed list: the decision, who made
/// it when that was not this manager, and the note that went with it.
class _RequestResponseBlock extends StatelessWidget {
  const _RequestResponseBlock({required this.decision, required this.note});

  final LeaveDecision decision;
  final String note;

  @override
  Widget build(BuildContext context) {
    final approved = decision == LeaveDecision.approved;
    final foreground = approved
        ? const Color(0xFF2F7A4F)
        : const Color(0xFFB3261E);
    final background = approved
        ? const Color(0xFFE6F4EA)
        : const Color(0xFFFDECEA);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            approved ? 'Approved' : 'Declined',
            style: TextStyle(
              color: foreground,
              fontSize: 13,
              fontWeight: FontWeight.w800,
            ),
          ),
          if (note.trim().isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              note.trim(),
              style: TextStyle(
                color: foreground.withValues(alpha: .85),
                fontSize: 12.5,
                height: 1.4,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

Color _decisionInk(LeaveDecision decision) => switch (decision) {
  LeaveDecision.approved => const Color(0xFF2F7A4F),
  LeaveDecision.declined => const Color(0xFFB3261E),
  LeaveDecision.pending => const Color(0xFF8A6218),
};

Color _decisionTint(LeaveDecision decision) => switch (decision) {
  LeaveDecision.approved => const Color(0xFFE6F4EA),
  LeaveDecision.declined => const Color(0xFFFDECEA),
  LeaveDecision.pending => const Color(0xFFFBEFD2),
};

/// The "View details" line on a team request card.
class _ManagerViewDetailsLink extends StatelessWidget {
  const _ManagerViewDetailsLink({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerLeft,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: const Padding(
        padding: EdgeInsets.symmetric(vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'View details',
              style: TextStyle(
                color: Color(0xFF0571A6),
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
            SizedBox(width: 3),
            Icon(
              Icons.chevron_right_rounded,
              size: 15,
              color: Color(0xFF0571A6),
            ),
          ],
        ),
      ),
    ),
  );
}

class _TeamDecisionButton extends StatelessWidget {
  const _TeamDecisionButton({
    required this.label,
    required this.background,
    required this.foreground,
    required this.onTap,
    this.radius = 16,
  });

  final String label;
  final Color background;
  final Color foreground;
  final VoidCallback onTap;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: background,
      borderRadius: BorderRadius.circular(radius),
      child: InkWell(
        borderRadius: BorderRadius.circular(radius),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: foreground,
              fontWeight: FontWeight.w700,
              fontSize: 14,
            ),
          ),
        ),
      ),
    );
  }
}

/// Leave and overtime declines require a non-empty reason on the backend
/// (attendance corrections don't) — this collects one before the decision
/// fires, instead of letting the PATCH fail with a raw "A decline reason is
/// required" error. Returns null if the sheet was dismissed without one.
Future<String?> _showDeclineReasonSheet(BuildContext context) {
  final controller = TextEditingController();
  return showModalBottomSheet<String>(
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
                const Text(
                  'Reason for rejecting',
                  style: TextStyle(
                    color: MColors.ink,
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  "Let them know why this request isn't being approved.",
                  style: TextStyle(color: MColors.inkSoft, fontSize: 13.5),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: controller,
                  autofocus: true,
                  maxLength: 500,
                  maxLines: 3,
                  onChanged: (_) => setSheetState(() {}),
                  decoration: _fieldDecoration(
                    'Explain why this is being rejected…',
                  ),
                ),
                const SizedBox(height: 8),
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
                        label: 'Confirm reject',
                        background: controller.text.trim().isEmpty
                            ? MColors.line
                            : MColors.terra,
                        foreground: controller.text.trim().isEmpty
                            ? MColors.inkFaint
                            : Colors.white,
                        onTap: controller.text.trim().isEmpty
                            ? null
                            : () => Navigator.pop(
                                sheetContext,
                                controller.text.trim(),
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
}
