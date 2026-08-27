part of '../../manager/presentation/manager_screen.dart';

enum _TeamSection { myTeam, requests }

class _TeamHome extends StatefulWidget {
  const _TeamHome({
    required this.state,
    required this.bloc,
    required this.onOpenProfile,
    required this.onNotifications,
  });

  final ManagerState state;
  final ManagerBloc bloc;
  final VoidCallback onOpenProfile;
  final VoidCallback onNotifications;

  @override
  State<_TeamHome> createState() => _TeamHomeState();
}

class _TeamHomeState extends State<_TeamHome> {
  _TeamSection _section = _TeamSection.myTeam;

  @override
  Widget build(BuildContext context) {
    final data = widget.state.dashboard!;
    final pendingRequests =
        data.leaves.where((l) => l.decision == LeaveDecision.pending).length +
        data.overtime.where((o) => o.decision == LeaveDecision.pending).length +
        data.managerRegularizations
            .where((r) => r.decision == LeaveDecision.pending)
            .length;

    return ColoredBox(
      color: Colors.white,
      child: Column(
        key: const ValueKey('team-home'),
        children: [
          AppHomeHeader(
            profileAction: Semantics(
              button: true,
              label: 'Open profile',
              child: InkWell(
                borderRadius: BorderRadius.circular(99),
                onTap: widget.onOpenProfile,
                child: AvatarBadge(
                  initial: data.managerInitial,
                  index: 1,
                  size: 30,
                ),
              ),
            ),
            onNotifications: widget.onNotifications,
            onQuickCreate: () => ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Quick create coming soon')),
            ),
          ),
          const SizedBox(height: 14),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: _TeamSegmentedControl(
              section: _section,
              pendingRequests: pendingRequests,
              onChanged: (value) => setState(() => _section = value),
            ),
          ),
          const SizedBox(height: 14),
          Expanded(
            child: _section == _TeamSection.myTeam
                ? _MyTeamView(
                    data: data,
                    bloc: widget.bloc,
                    onNotifications: widget.onNotifications,
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
  });

  final ManagerDashboard data;
  final ManagerBloc bloc;
  final VoidCallback onNotifications;

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
                data: data,
                bloc: widget.bloc,
                onNotifications: widget.onNotifications,
              ),
            ),
          ),
      ],
    );
  }
}

class _RecognitionSection extends StatelessWidget {
  const _RecognitionSection({required this.data, required this.bloc});

  final ManagerDashboard data;
  final ManagerBloc bloc;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionTitle(
          title: 'Recognition',
          trailing:
              '${data.awards.where((a) => a.nomineeId != null).length} of ${data.awards.length} named',
        ),
        const SizedBox(height: 6),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Text(
            'Nominate someone for ${_monthName(DateTime.now().month)}’s awards.',
            style: const TextStyle(color: MColors.inkSoft, fontSize: 13.5),
          ),
        ),
        const SizedBox(height: 13),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: data.awards.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1.08,
          ),
          itemBuilder: (context, index) {
            return _AwardCard(
              award: data.awards[index],
              team: data.recognitionCandidates,
              onNominate: () =>
                  bloc.add(OpenAwardPicker(data.awards[index].key)),
            );
          },
        ),
        if (data.recognitionHistory.isNotEmpty) ...[
          const SizedBox(height: 12),
          Center(
            child: TextButton.icon(
              onPressed: () =>
                  _showPastNominations(context, data.recognitionHistory),
              icon: const Icon(Icons.history_rounded, size: 18),
              label: Text(
                'View past nominations (${data.recognitionHistory.length})',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ],
        const SizedBox(height: 18),
      ],
    );
  }
}

class _TeamMemberRow extends StatelessWidget {
  const _TeamMemberRow({
    required this.member,
    required this.data,
    required this.bloc,
    required this.onNotifications,
  });

  final TeamMember member;
  final ManagerDashboard data;
  final ManagerBloc bloc;
  final VoidCallback onNotifications;

  @override
  Widget build(BuildContext context) {
    final pendingCount = _pendingRequestCount(data, member.userId);
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
          ),
        ),
      ),
      padding: const EdgeInsets.all(17),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              SizedBox(
                width: 56,
                height: 56,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    AvatarBadge(
                      initial: member.initial,
                      index: member.avatarIndex,
                      size: 56,
                    ),
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
                      member.name,
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
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _PresencePill(present: present),
              if (pendingCount > 0) _RequestCountPill(count: pendingCount),
            ],
          ),
          if (upcomingLeave != null || birthdaySoon) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (upcomingLeave != null)
                  const _TagChip(
                    icon: Icons.calendar_today_rounded,
                    iconColor: MColors.terra,
                    label: 'Leave Upcoming',
                  ),
                if (birthdaySoon)
                  const _TagChip(
                    icon: Icons.cake_rounded,
                    iconColor: MColors.gold,
                    label: 'Birthday Soon',
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _PresencePill extends StatelessWidget {
  const _PresencePill({required this.present});

  final bool present;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: present ? const Color(0xFFEAFFE6) : const Color(0xFF717171),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        present ? 'Present' : 'Not Punched In',
        style: TextStyle(
          color: present ? const Color(0xFF43D27C) : Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w500,
        ),
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
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

class _TagChip extends StatelessWidget {
  const _TagChip({
    required this.icon,
    required this.label,
    this.iconColor = const Color(0xFF484848),
  });

  final IconData icon;
  final String label;
  final Color iconColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F7F9),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: const Color(0xFFEBEBEB)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: iconColor),
          const SizedBox(width: 5),
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
    final entries = <(DateTime date, String who, String kind, Widget card)>[
      for (final leave in data.leaves.where(
        (l) => l.decision == LeaveDecision.pending,
      ))
        (
          leave.requestedOn,
          leave.who,
          'leave',
          _TeamRequestCard(
            initial: leave.initial,
            avatarIndex: leave.avatarIndex,
            name: leave.who,
            role: leave.team,
            rows: [
              ('Type:', leave.type),
              ('Date:', _leaveDateRange(leave)),
              ('Comment:', leave.reason),
            ],
            decision: LeaveDecision.pending,
            onApprove: () =>
                bloc.add(DecideLeave(leave.id, LeaveDecision.approved)),
            onReject: () =>
                bloc.add(DecideLeave(leave.id, LeaveDecision.declined)),
          ),
        ),
      for (final request in data.overtime.where(
        (o) => o.decision == LeaveDecision.pending,
      ))
        (
          request.requestedOn,
          request.who,
          'overtime',
          _TeamRequestCard(
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
            decision: LeaveDecision.pending,
            onApprove: () =>
                bloc.add(DecideOvertime(request.id, LeaveDecision.approved)),
            onReject: () =>
                bloc.add(DecideOvertime(request.id, LeaveDecision.declined)),
          ),
        ),
      for (final request in data.managerRegularizations.where(
        (r) => r.decision == LeaveDecision.pending,
      ))
        (
          request.createdAt,
          request.who,
          'correction',
          _TeamRequestCard(
            initial: request.initial,
            avatarIndex: request.avatarIndex,
            name: request.who,
            role: request.team,
            rows: [
              ('Type:', 'Correction'),
              ('Date:', _shortAttendanceDate(request.workDate)),
              ('Correction:', _attendancePeriod(request.period)),
              ('Comment:', request.note),
            ],
            decision: LeaveDecision.pending,
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

    return ColoredBox(
      color: const Color(0xFFF7F7F9),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          _RecognitionSection(data: data, bloc: widget.bloc),
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
                        ? 'No requests waiting on you.'
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
    required this.initial,
    required this.avatarIndex,
    required this.name,
    required this.role,
    required this.rows,
    required this.decision,
    this.onApprove,
    this.onReject,
    this.readOnly = false,
  });

  final String initial;
  final int avatarIndex;
  final String name;
  final String role;
  final List<(String label, String value)> rows;
  final LeaveDecision decision;
  final VoidCallback? onApprove;
  final VoidCallback? onReject;
  final bool readOnly;

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
          const SizedBox(height: 8),
          if (readOnly)
            const Text(
              'Awaiting HR review',
              style: TextStyle(
                color: Color(0xFF9CA3AF),
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            )
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
