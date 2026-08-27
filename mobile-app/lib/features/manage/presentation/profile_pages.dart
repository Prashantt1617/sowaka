part of '../../manager/presentation/manager_screen.dart';

class _TeamMemberProfilePage extends StatelessWidget {
  const _TeamMemberProfilePage({
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
    final present = member.todayStatus == TeamPresenceStatus.present;
    final nomination = data.awards
        .where((item) => item.nomineeId == member.id)
        .firstOrNull;
    final today = DateTime.now();

    final openRequests = <(DateTime date, Widget card)>[
      for (final leave in data.leaves.where(
        (item) =>
            item.userId == member.userId &&
            item.decision == LeaveDecision.pending,
      ))
        (
          leave.requestedOn,
          _ProfileRequestCard(
            icon: Icons.calendar_month_rounded,
            title: '${leave.type} Request',
            rows: [
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
        (item) =>
            item.userId == member.userId &&
            item.decision == LeaveDecision.pending,
      ))
        (
          request.requestedOn,
          _ProfileRequestCard(
            icon: Icons.schedule_rounded,
            title: 'Overtime Request',
            rows: [
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
        (item) =>
            item.userId == member.userId &&
            item.decision == LeaveDecision.pending,
      ))
        (
          request.createdAt,
          _ProfileRequestCard(
            icon: Icons.edit_calendar_rounded,
            title: 'Attendance Correction',
            rows: [
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
    ]..sort((a, b) => b.$1.compareTo(a.$1));

    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F9),
      body: Column(
        children: [
          AppHomeHeader(
            profileAction: Semantics(
              button: true,
              label: 'Close profile',
              child: InkWell(
                borderRadius: BorderRadius.circular(99),
                onTap: () => Navigator.of(context).pop(),
                child: AvatarBadge(
                  initial: data.managerInitial,
                  index: 1,
                  size: 30,
                ),
              ),
            ),
            onNotifications: onNotifications,
            onQuickCreate: () => ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Quick create coming soon')),
            ),
          ),
          _ProfilePageTopBar(
            onCalendarTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => _TeamMemberAttendancePage(
                  member: member,
                  data: data,
                  bloc: bloc,
                ),
              ),
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
              children: [
                if (nomination != null)
                  _NominationHero(member: member, nomination: nomination)
                else
                  Center(
                    child: Column(
                      children: [
                        _TeamMemberPhoto(
                          member: member,
                          size: 112,
                          showStatus: true,
                        ),
                        const SizedBox(height: 14),
                        Text(
                          member.name,
                          style: const TextStyle(
                            color: MColors.ink,
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -.3,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          [
                            member.designation,
                            member.team,
                          ].where((value) => value.isNotEmpty).join(' · '),
                          style: const TextStyle(
                            color: MColors.inkSoft,
                            fontSize: 13.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                if (openRequests.isNotEmpty) ...[
                  const SizedBox(height: 22),
                  _RequestsSection(
                    title: 'Open Requests',
                    entries: openRequests,
                  ),
                ],
                const SizedBox(height: 22),
                _AttendanceCard(
                  date: today,
                  present: present,
                  punchIn: member.punchIn,
                  punchOut: member.punchOut,
                ),
                const SizedBox(height: 22),
                const _SectionTitle(title: 'Work Role'),
                const SizedBox(height: 8),
                _InfoCard(
                  children: [
                    _ProfileRow(
                      icon: Icons.apartment_rounded,
                      label: 'Department',
                      value: member.team,
                    ),
                    _ProfileRow(
                      icon: Icons.person_outline_rounded,
                      label: 'Manager',
                      value: data.managerName,
                    ),
                  ],
                ),
                const SizedBox(height: 22),
                _GiveFeedbackButton(
                  onTap: () {
                    bloc.add(OpenFeedbackRecord(member.id));
                    Navigator.of(context).pop();
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _GiveFeedbackButton extends StatelessWidget {
  const _GiveFeedbackButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF0571A6),
      borderRadius: BorderRadius.circular(28),
      child: InkWell(
        borderRadius: BorderRadius.circular(28),
        onTap: onTap,
        child: const Padding(
          padding: EdgeInsets.symmetric(vertical: 16),
          child: Text(
            'Give Feedback',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.white,
              fontSize: 16,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    );
  }
}

class _ProfileScreen extends StatelessWidget {
  const _ProfileScreen({
    required this.session,
    required this.dashboard,
    required this.onBack,
    required this.onLogout,
    required this.onNotifications,
  });

  final AuthSession session;
  final ManagerDashboard dashboard;
  final VoidCallback onBack;
  final Future<void> Function() onLogout;
  final VoidCallback onNotifications;

  @override
  Widget build(BuildContext context) {
    final user = session.user;
    final designation =
        _nonEmpty(user.designation) ??
        (user.role.toLowerCase() == 'manager'
            ? 'People Manager'
            : 'Team Member');
    final department = _nonEmpty(user.department) ?? dashboard.managerTeam;
    final reportsTo = _nonEmpty(user.managerName) ?? dashboard.approverName;
    final today = DateTime.now();
    final todayRecord = dashboard.attendance
        .where(
          (record) =>
              record.workDate.year == today.year &&
              record.workDate.month == today.month &&
              record.workDate.day == today.day,
        )
        .firstOrNull;

    return ColoredBox(
      color: const Color(0xFFF7F7F9),
      child: Column(
        key: const ValueKey('profile-screen'),
        children: [
          AppHomeHeader(
            profileAction: _ProfileAvatar(
              initials: _initials(user.name),
              profilePhotoUrl: user.profilePhotoUrl,
              size: 30,
            ),
            onNotifications: onNotifications,
            onQuickCreate: () => ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Quick create coming soon')),
            ),
          ),
          _ProfilePageTopBar(onBack: onBack),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 20, 16, 28),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 620),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(
                        child: Column(
                          children: [
                            Container(
                              width: 112,
                              height: 112,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: Colors.white,
                                  width: 3,
                                ),
                                boxShadow: const [
                                  BoxShadow(
                                    color: Color(0x1A000000),
                                    blurRadius: 6,
                                    offset: Offset(0, 2),
                                  ),
                                ],
                              ),
                              clipBehavior: Clip.antiAlias,
                              child: _ProfileAvatar(
                                initials: _initials(user.name),
                                profilePhotoUrl: user.profilePhotoUrl,
                                size: 112,
                              ),
                            ),
                            const SizedBox(height: 14),
                            Text(
                              user.name,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: MColors.ink,
                                fontSize: 24,
                                fontWeight: FontWeight.w800,
                                letterSpacing: -.3,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              designation,
                              style: const TextStyle(
                                color: MColors.inkSoft,
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 22),
                      _AttendanceCard(
                        date: today,
                        present: todayRecord?.punchIn != null,
                        punchIn: todayRecord?.punchIn,
                        punchOut: todayRecord?.punchOut,
                      ),
                      _MyRequestsSection(data: dashboard),
                      const SizedBox(height: 18),
                      const _SectionTitle(title: 'Profile'),
                      const SizedBox(height: 8),
                      _InfoCard(
                        children: [
                          _ProfileRow(
                            icon: Icons.alternate_email_rounded,
                            label: 'Email',
                            value: user.email,
                          ),
                          _ProfileRow(
                            icon: Icons.event_available_outlined,
                            label: 'Joined',
                            value: _formatDate(user.joiningDate),
                          ),
                          _ProfileRow(
                            icon: Icons.cake_outlined,
                            label: 'Date of birth',
                            value: _formatDate(user.birthday),
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      const _SectionTitle(title: 'Work Role'),
                      const SizedBox(height: 8),
                      _InfoCard(
                        children: [
                          _ProfileRow(
                            icon: Icons.groups_outlined,
                            label: 'Department / team',
                            value: department,
                          ),
                          _ProfileRow(
                            icon: Icons.account_tree_outlined,
                            label: 'Reports to',
                            value: reportsTo,
                          ),
                        ],
                      ),
                      if (user.recognition != null) ...[
                        const SizedBox(height: 18),
                        const _SectionTitle(title: 'Recognition'),
                        const SizedBox(height: 8),
                        _RecognitionCard(recognition: user.recognition!),
                      ],
                      const SizedBox(height: 18),
                      _LogoutButton(onPressed: onLogout),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileRequestCard extends StatelessWidget {
  const _ProfileRequestCard({
    required this.icon,
    required this.title,
    required this.rows,
    required this.decision,
    this.onApprove,
    this.onReject,
    this.readOnly = false,
  });

  final IconData icon;
  final String title;
  final List<(String label, String value)> rows;
  final LeaveDecision decision;
  final VoidCallback? onApprove;
  final VoidCallback? onReject;
  final bool readOnly;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
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
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: const Color(0xFFF7F7F9),
                  border: Border.all(color: const Color(0xFFEBEBEB)),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, size: 20, color: const Color(0xFF222222)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            title,
                            style: const TextStyle(
                              color: Color(0xFF222222),
                              fontWeight: FontWeight.w700,
                              fontSize: 16,
                            ),
                          ),
                        ),
                        if (readOnly) _ProfileStatusPill(decision: decision),
                      ],
                    ),
                    const SizedBox(height: 6),
                    for (final row in rows)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Row(
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
                      ),
                  ],
                ),
              ),
            ],
          ),
          if (!readOnly) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _TeamDecisionButton(
                    label: 'Approve',
                    background: const Color(0xFFDAFFD3),
                    foreground: const Color(0xFF34C759),
                    onTap: onApprove!,
                    radius: 8,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _TeamDecisionButton(
                    label: 'Reject',
                    background: const Color(0xFFFDDBDB),
                    foreground: const Color(0xFFFF383C),
                    onTap: onReject!,
                    radius: 8,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _ProfileStatusPill extends StatelessWidget {
  const _ProfileStatusPill({required this.decision});

  final LeaveDecision decision;

  @override
  Widget build(BuildContext context) {
    final (label, color, background) = switch (decision) {
      LeaveDecision.pending => (
        'PENDING',
        const Color(0xFFD97706),
        const Color(0x4DFFD700),
      ),
      LeaveDecision.approved => (
        'APPROVED',
        const Color(0xFF28CA08),
        const Color(0x4D66FF00),
      ),
      LeaveDecision.declined => (
        'DECLINED',
        const Color(0xFFDC2626),
        const Color(0x4DFF3838),
      ),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w700,
          letterSpacing: .25,
        ),
      ),
    );
  }
}

class _AttendanceCard extends StatelessWidget {
  const _AttendanceCard({
    required this.date,
    required this.present,
    required this.punchIn,
    required this.punchOut,
  });

  final DateTime date;
  final bool present;
  final DateTime? punchIn;
  final DateTime? punchOut;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFF0571A6), width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${_shortAttendanceDate(date)}, ${_fullWeekday(date)}',
                  style: const TextStyle(
                    color: MColors.ink,
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              _PresencePill(present: present),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _PunchColumn(
                  label: 'PUNCH-IN',
                  value: _attendanceClock(punchIn),
                ),
              ),
              Expanded(
                child: _PunchColumn(
                  label: 'PUNCH-OUT',
                  value: _attendanceClock(punchOut),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _RequestsSection extends StatefulWidget {
  const _RequestsSection({required this.title, required this.entries});

  final String title;
  final List<(DateTime date, Widget card)> entries;

  @override
  State<_RequestsSection> createState() => _RequestsSectionState();
}

class _RequestsSectionState extends State<_RequestsSection> {
  bool _expanded = true;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () => setState(() => _expanded = !_expanded),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    widget.title,
                    style: const TextStyle(
                      color: MColors.ink,
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                AnimatedRotation(
                  turns: _expanded ? 0 : 0.5,
                  duration: const Duration(milliseconds: 180),
                  child: const Icon(
                    Icons.expand_more_rounded,
                    color: MColors.ink,
                    size: 20,
                  ),
                ),
              ],
            ),
          ),
        ),
        if (_expanded) ...[
          const SizedBox(height: 6),
          for (final entry in widget.entries) ...[
            entry.$2,
            const SizedBox(height: 12),
          ],
        ],
      ],
    );
  }
}

class _MyRequestsSection extends StatelessWidget {
  const _MyRequestsSection({required this.data});

  final ManagerDashboard data;

  @override
  Widget build(BuildContext context) {
    final myRequests = <(DateTime date, Widget card)>[
      for (final leave in data.myLeaves)
        (
          leave.requestedOn,
          _ProfileRequestCard(
            icon: Icons.calendar_month_rounded,
            title: '${leave.type} Request',
            rows: [
              ('Date:', _leaveDateRange(leave)),
              ('Comment:', leave.reason),
            ],
            decision: leave.decision,
            readOnly: true,
          ),
        ),
      for (final request in data.myOvertime)
        (
          request.requestedOn,
          _ProfileRequestCard(
            icon: Icons.schedule_rounded,
            title: 'Overtime Request',
            rows: [
              ('Date:', _managerDate(request.workDate)),
              ('Overtime hrs:', request.hoursLabel),
              (
                'Comment:',
                request.note.isEmpty ? request.timeRangeLabel : request.note,
              ),
            ],
            decision: request.decision,
            readOnly: true,
          ),
        ),
      for (final request in data.regularizations)
        (
          request.createdAt,
          _ProfileRequestCard(
            icon: Icons.edit_calendar_rounded,
            title: 'Attendance Correction',
            rows: [
              ('Date:', _shortAttendanceDate(request.workDate)),
              ('Correction:', _attendancePeriod(request.period)),
              ('Comment:', request.note),
            ],
            decision: request.decision,
            readOnly: true,
          ),
        ),
    ]..sort((a, b) => b.$1.compareTo(a.$1));

    if (myRequests.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 18),
      child: _RequestsSection(title: 'My Requests', entries: myRequests),
    );
  }
}

class _ProfilePageTopBar extends StatelessWidget {
  const _ProfilePageTopBar({
    this.onCalendarTap,
    this.onBack,
    this.title = 'Profile',
  });

  final VoidCallback? onCalendarTap;
  final VoidCallback? onBack;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 14, 12),
      decoration: const BoxDecoration(
        color: Color(0xFFF7F7F9),
        border: Border(bottom: BorderSide(color: MColors.line)),
      ),
      child: Row(
        children: [
          RoundIconButton(
            onTap: onBack ?? () => Navigator.of(context).pop(),
            child: SvgPicture.asset(
              'assets/icons/chevron_left_small.svg',
              width: 18,
              height: 18,
            ),
          ),
          Expanded(
            child: Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: MColors.ink,
                fontSize: 16.5,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          if (onCalendarTap != null)
            RoundIconButton(
              onTap: onCalendarTap!,
              child: SvgPicture.asset(
                'assets/icons/calendar_header.svg',
                width: 20,
                height: 20,
              ),
            )
          else
            const SizedBox(width: 38),
        ],
      ),
    );
  }
}

bool _isSameCalendarDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

class _TeamMemberAttendancePage extends StatefulWidget {
  const _TeamMemberAttendancePage({
    required this.member,
    required this.data,
    required this.bloc,
  });

  final TeamMember member;
  final ManagerDashboard data;
  final ManagerBloc bloc;

  @override
  State<_TeamMemberAttendancePage> createState() =>
      _TeamMemberAttendancePageState();
}

class _TeamMemberAttendancePageState extends State<_TeamMemberAttendancePage> {
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  bool _listView = false;
  AttendanceFilter? _filter;
  bool _loading = true;
  bool _failed = false;
  List<AttendanceRecord> _records = const [];
  List<AttendanceRegularization> _regularizations = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final from = DateTime(_month.year, _month.month, 1);
      final to = DateTime(_month.year, _month.month + 1, 0);
      final result = await widget.bloc.service.fetchTeamMemberAttendance(
        widget.member.userId,
        from,
        to,
      );
      if (!mounted) return;
      setState(() {
        _records = result.$1;
        _regularizations = result.$2;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _failed = true;
        _loading = false;
      });
    }
  }

  Future<void> _changeMonth(int delta) async {
    setState(() => _month = DateTime(_month.year, _month.month + delta));
    await _load();
  }

  void _openDay(AttendanceDayView day) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => _ReadOnlyAttendanceDaySheet(day: day),
    );
  }

  @override
  Widget build(BuildContext context) {
    final memberLeaves = widget.data.leaves
        .where((item) => item.userId == widget.member.userId)
        .toList();
    final memberOvertime = widget.data.overtime
        .where((item) => item.userId == widget.member.userId)
        .toList();
    final days = buildAttendanceDays(
      month: _month,
      records: _records,
      regularizations: _regularizations,
      leaves: memberLeaves,
      holidays: widget.data.holidays,
      overtime: memberOvertime,
      weekoffDays: widget.data.weekoffDays,
    );
    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F9),
      body: Column(
        children: [
          _ProfilePageTopBar(title: "${widget.member.name}'s Attendance"),
          Expanded(
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(color: MColors.terra),
                  )
                : _failed
                ? Center(
                    child: Text(
                      'Could not load attendance for this month.',
                      style: const TextStyle(color: MColors.inkSoft),
                    ),
                  )
                : ListView(
                    padding: const EdgeInsets.fromLTRB(16, 20, 16, 28),
                    children: [
                      Row(
                        children: [
                          AttendanceCalendarArrow(
                            onPressed: () => _changeMonth(-1),
                            asset: 'assets/icons/calendar_chevron_prev.svg',
                          ),
                          Expanded(
                            child: Text(
                              '${_monthName(_month.month)} ${_month.year}',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Color(0xFF2A2A2A),
                                fontSize: 16,
                                fontWeight: FontWeight.w400,
                              ),
                            ),
                          ),
                          AttendanceCalendarArrow(
                            onPressed: () => _changeMonth(1),
                            asset: 'assets/icons/calendar_chevron_next.svg',
                          ),
                        ],
                      ),
                      const SizedBox(height: 24),
                      LeaveViewSwitch(
                        history: _listView,
                        onChanged: (list) => setState(() => _listView = list),
                        firstLabel: 'Grid',
                        secondLabel: 'List',
                      ),
                      const SizedBox(height: 16),
                      AttendanceFilterChips(
                        selected: _filter,
                        onChanged: (filter) => setState(() => _filter = filter),
                        onLateTapped: () =>
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                  "Late arrivals aren't tracked yet — no threshold is configured.",
                                ),
                              ),
                            ),
                      ),
                      const SizedBox(height: 20),
                      if (_listView)
                        ...days.map(
                          (day) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: AttendanceListCard(
                              day: day,
                              today: _isSameCalendarDay(
                                day.date,
                                DateTime.now(),
                              ),
                              dimmed: !matchesAttendanceFilter(
                                day.kind,
                                _filter,
                              ),
                              onTap: () => _openDay(day),
                            ),
                          ),
                        )
                      else
                        AttendanceMonthGrid(
                          month: _month,
                          days: days,
                          filter: _filter,
                          onTap: _openDay,
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _ReadOnlyAttendanceDaySheet extends StatelessWidget {
  const _ReadOnlyAttendanceDaySheet({required this.day});

  final AttendanceDayView day;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(
        20,
        12,
        20,
        24 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFD1D5DB),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
          ),
          const SizedBox(height: 20),
          Text(
            '${_fullWeekday(day.date)}, ${_shortAttendanceDate(day.date)}',
            style: const TextStyle(
              color: MColors.ink,
              fontSize: 16,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            day.title,
            style: const TextStyle(color: MColors.inkSoft, fontSize: 14),
          ),
          if (day.record?.punchIn != null || day.record?.punchOut != null) ...[
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: _PunchColumn(
                    label: 'PUNCH-IN',
                    value: _attendanceClock(day.record?.punchIn),
                  ),
                ),
                Expanded(
                  child: _PunchColumn(
                    label: 'PUNCH-OUT',
                    value: _attendanceClock(day.record?.punchOut),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _TeamMemberPhoto extends StatelessWidget {
  const _TeamMemberPhoto({
    required this.member,
    required this.size,
    this.showStatus = false,
  });

  final TeamMember member;
  final double size;
  final bool showStatus;

  Widget _photo() {
    final url = member.photoUrl;
    if (url == null || url.isEmpty) {
      return AvatarBadge(
        initial: member.initial,
        index: member.avatarIndex,
        size: size,
      );
    }
    return ClipOval(
      child: Image.network(
        url,
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => AvatarBadge(
          initial: member.initial,
          index: member.avatarIndex,
          size: size,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final photo = _photo();
    if (!showStatus) return photo;
    final present = member.todayStatus == TeamPresenceStatus.present;
    final dotSize = size * .18;
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          photo,
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              width: dotSize,
              height: dotSize,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: present
                    ? const Color(0xFF00C950)
                    : const Color(0xFFDDDDDD),
                border: Border.all(color: Colors.white, width: dotSize * .18),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BouncingTrophy extends StatefulWidget {
  const _BouncingTrophy();

  @override
  State<_BouncingTrophy> createState() => _BouncingTrophyState();
}

class _BouncingTrophyState extends State<_BouncingTrophy>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _scale;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 583),
      vsync: this,
    );
    _scale = Tween(
      begin: 1.2,
      end: 1.0,
    ).chain(CurveTween(curve: const Cubic(0, 0, 0.58, 1))).animate(_controller);
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ScaleTransition(
      scale: _scale,
      child: Image.asset(
        'assets/images/trophy.png',
        width: 151,
        height: 152,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => const Icon(
          Icons.emoji_events_rounded,
          size: 72,
          color: Color(0xFFC98A2E),
        ),
      ),
    );
  }
}

class _NominationHero extends StatelessWidget {
  const _NominationHero({required this.member, required this.nomination});

  final TeamMember member;
  final AwardNomination nomination;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
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
        children: [
          _TeamMemberPhoto(member: member, size: 92),
          const SizedBox(height: 14),
          Text(
            member.name,
            style: const TextStyle(
              color: MColors.ink,
              fontSize: 21,
              fontWeight: FontWeight.w800,
              letterSpacing: -.3,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            [
              member.designation,
              member.team,
            ].where((value) => value.isNotEmpty).join(' · '),
            style: const TextStyle(
              color: MColors.inkSoft,
              fontSize: 13.5,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 12),
          const _BouncingTrophy(),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF8E6),
              border: Border.all(color: const Color(0xFFFFDF8D)),
              borderRadius: BorderRadius.circular(99),
            ),
            child: Text(
              nomination.title,
              style: const TextStyle(
                color: Color(0xFFFFBF1B),
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PunchColumn extends StatelessWidget {
  const _PunchColumn({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: MColors.inkFaint,
            fontSize: 10.5,
            fontWeight: FontWeight.w800,
            letterSpacing: .6,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            color: MColors.ink,
            fontSize: 14.5,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 4),
      decoration: _cardDecoration,
      child: Column(children: children),
    );
  }
}

class _ProfileAvatar extends StatelessWidget {
  const _ProfileAvatar({
    required this.initials,
    required this.profilePhotoUrl,
    this.size = 92,
  });

  final String initials;
  final String? profilePhotoUrl;
  final double size;

  @override
  Widget build(BuildContext context) {
    final url = _nonEmpty(profilePhotoUrl);
    final fallback = Container(
      color: _ProfileColors.sage,
      alignment: Alignment.center,
      child: Text(
        initials,
        style: TextStyle(
          color: Colors.white,
          fontSize: size * .336,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
    return ClipOval(
      child: SizedBox(
        width: size,
        height: size,
        child: url == null
            ? fallback
            : Image.network(
                url,
                width: size,
                height: size,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => fallback,
                loadingBuilder: (context, child, progress) =>
                    progress == null ? child : fallback,
              ),
      ),
    );
  }
}

class _ProfileRow extends StatelessWidget {
  const _ProfileRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: const BoxDecoration(
              color: Color(0xFFF7F7F7),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 20, color: _ProfileColors.ink),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label.toUpperCase(), style: _ProfileText.label),
                const SizedBox(height: 2),
                Text(
                  value.isEmpty ? 'Not available' : value,
                  style: _ProfileText.value,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RecognitionCard extends StatelessWidget {
  const _RecognitionCard({required this.recognition});

  final UserRecognition recognition;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: _cardDecoration,
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: _ProfileColors.goldTint,
              borderRadius: BorderRadius.circular(13),
            ),
            child: const Icon(
              Icons.workspace_premium_rounded,
              color: _ProfileColors.gold,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  recognition.label.isEmpty ? 'Recognition' : recognition.label,
                  style: const TextStyle(
                    color: _ProfileColors.ink,
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                if (recognition.period.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    recognition.period,
                    style: const TextStyle(
                      color: _ProfileColors.inkSoft,
                      fontSize: 12.5,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LogoutButton extends StatelessWidget {
  const _LogoutButton({required this.onPressed});

  final Future<void> Function() onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: _ProfileColors.line, width: 1.5),
      ),
      child: InkWell(
        key: const ValueKey('profile-logout'),
        borderRadius: BorderRadius.circular(14),
        onTap: onPressed,
        child: const Padding(
          padding: EdgeInsets.symmetric(vertical: 14),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.logout_rounded, size: 19, color: _ProfileColors.terra),
              SizedBox(width: 8),
              Text(
                'Log out',
                style: TextStyle(
                  color: _ProfileColors.terra,
                  fontSize: 14.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty);
  final initials = parts.take(2).map((part) => part[0].toUpperCase()).join();
  return initials.isEmpty ? '?' : initials;
}

String? _nonEmpty(String? value) {
  final normalized = value?.trim();
  return normalized == null || normalized.isEmpty ? null : normalized;
}

String _formatDate(String? value) {
  final parsed = DateTime.tryParse(value ?? '');
  if (parsed == null) return '';
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return '${parsed.day.toString().padLeft(2, '0')} ${months[parsed.month - 1]} ${parsed.year}';
}

const _cardDecoration = BoxDecoration(
  color: Colors.white,
  borderRadius: BorderRadius.all(Radius.circular(16)),
  border: Border.fromBorderSide(BorderSide(color: _ProfileColors.line)),
  boxShadow: [
    BoxShadow(color: Color(0x0A462D1C), blurRadius: 22, offset: Offset(0, 10)),
  ],
);

class _ProfileText {
  static const label = TextStyle(
    color: _ProfileColors.inkFaint,
    fontSize: 11,
    fontWeight: FontWeight.w700,
    letterSpacing: .55,
  );

  static const value = TextStyle(
    color: _ProfileColors.ink,
    fontSize: 14.5,
    fontWeight: FontWeight.w700,
  );
}

class _ProfileColors {
  static const ink = Color(0xFF2A2420);
  static const inkSoft = Color(0xFF6E655C);
  static const inkFaint = Color(0xFFA79D92);
  static const line = Color(0xFFF0E8DD);
  static const terra = Color(0xFFBE5A36);
  static const gold = Color(0xFFC98A2E);
  static const goldTint = Color(0xFFF4ECDD);
  static const sage = Color(0xFF7E8B6E);
}
