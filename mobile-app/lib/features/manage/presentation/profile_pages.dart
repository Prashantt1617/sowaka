part of '../../manager/presentation/manager_screen.dart';

class _TeamMemberProfilePage extends StatelessWidget {
  const _TeamMemberProfilePage({
    required this.member,
    required this.data,
    required this.bloc,
  });

  final TeamMember member;
  final ManagerDashboard data;
  final ManagerBloc bloc;

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
              (
                'Overtime hrs:',
                request.hours > 0
                    ? '${request.hours.toStringAsFixed(request.hours == request.hours.roundToDouble() ? 0 : 1)} hrs'
                    : request.duration,
              ),
              (
                'Comment:',
                request.note.isEmpty ? request.project : request.note,
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
          _ProfilePageTopBar(onCalendarTap: () => _showCalendarStub(context)),
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
  });

  final AuthSession session;
  final ManagerDashboard dashboard;
  final VoidCallback onBack;
  final Future<void> Function() onLogout;

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
      child: SingleChildScrollView(
        key: const ValueKey('profile-screen'),
        child: Column(
          children: [
            _ProfileBanner(
              name: user.name,
              designation: designation,
              company: user.company,
              initials: _initials(user.name),
              profilePhotoUrl: user.profilePhotoUrl,
              managerScore: user.role.toLowerCase() == 'manager'
                  ? dashboard.managerScore
                  : null,
              onBack: onBack,
            ),
            Transform.translate(
              offset: const Offset(0, -18),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 22),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 620),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
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
          const SizedBox(height: 16),
          InkWell(
            onTap: () => _showCalendarStub(context),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.calendar_month_rounded,
                  size: 16,
                  color: Color(0xFF0571A6),
                ),
                SizedBox(width: 6),
                Text(
                  'View calendar',
                  style: TextStyle(
                    color: Color(0xFF0571A6),
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
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
              (
                'Overtime hrs:',
                request.hours > 0
                    ? '${request.hours.toStringAsFixed(request.hours == request.hours.roundToDouble() ? 0 : 1)} hrs'
                    : request.duration,
              ),
              (
                'Comment:',
                request.note.isEmpty ? request.project : request.note,
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

void _showCalendarStub(BuildContext context) {
  ScaffoldMessenger.of(context).showSnackBar(
    const SnackBar(
      content: Text('Viewing a teammate’s full calendar is coming soon'),
    ),
  );
}

class _ProfilePageTopBar extends StatelessWidget {
  const _ProfilePageTopBar({required this.onCalendarTap});

  final VoidCallback onCalendarTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 52, 14, 12),
      decoration: const BoxDecoration(
        color: Color(0xFFF7F7F9),
        border: Border(bottom: BorderSide(color: MColors.line)),
      ),
      child: Row(
        children: [
          RoundIconButton(
            icon: Icons.chevron_left_rounded,
            onTap: () => Navigator.of(context).pop(),
          ),
          const Expanded(
            child: Text(
              'Profile',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: MColors.ink,
                fontSize: 16.5,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          RoundIconButton(
            icon: Icons.calendar_month_rounded,
            onTap: onCalendarTap,
          ),
        ],
      ),
    );
  }
}

class _TeamMemberPhoto extends StatelessWidget {
  const _TeamMemberPhoto({required this.member, required this.size});

  final TeamMember member;
  final double size;

  @override
  Widget build(BuildContext context) {
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

class _ProfileBanner extends StatelessWidget {
  const _ProfileBanner({
    required this.name,
    required this.designation,
    required this.company,
    required this.initials,
    required this.profilePhotoUrl,
    required this.managerScore,
    required this.onBack,
  });

  final String name;
  final String designation;
  final String company;
  final String initials;
  final String? profilePhotoUrl;
  final double? managerScore;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Colors.white,
      child: SafeArea(
        bottom: false,
        child: Stack(
          children: [
            Positioned(
              left: 18,
              top: 8,
              child: Material(
                color: Colors.white.withValues(alpha: .72),
                shape: const CircleBorder(),
                child: IconButton(
                  key: const ValueKey('profile-back'),
                  tooltip: 'Back',
                  onPressed: onBack,
                  icon: const Icon(Icons.chevron_left_rounded),
                  color: _ProfileColors.inkSoft,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 18, 24, 40),
              child: Center(
                child: Column(
                  children: [
                    Container(
                      width: 92,
                      height: 92,
                      decoration: BoxDecoration(
                        color: _ProfileColors.sage,
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 3),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x24462D1C),
                            blurRadius: 18,
                            offset: Offset(0, 8),
                          ),
                        ],
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: _ProfileAvatar(
                        initials: initials,
                        profilePhotoUrl: profilePhotoUrl,
                      ),
                    ),
                    const SizedBox(height: 14),
                    Text(
                      name,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: _ProfileColors.ink,
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -.35,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      designation,
                      style: const TextStyle(
                        color: _ProfileColors.inkSoft,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (managerScore != null) ...[
                      const SizedBox(height: 11),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF7F7F9),
                          borderRadius: BorderRadius.circular(99),
                          border: Border.all(color: const Color(0xFFEBEBEB)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.star_rounded,
                              size: 15,
                              color: _ProfileColors.gold,
                            ),
                            const SizedBox(width: 5),
                            Text(
                              'Manager score · ${managerScore!.toStringAsFixed(1)}',
                              style: const TextStyle(
                                color: _ProfileColors.gold,
                                fontSize: 11.5,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 14),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 11,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF7F7F9),
                        borderRadius: BorderRadius.circular(99),
                        border: Border.all(color: const Color(0xFFEBEBEB)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.apartment_rounded,
                            size: 14,
                            color: _ProfileColors.inkSoft,
                          ),
                          const SizedBox(width: 5),
                          Flexible(
                            child: Text(
                              company,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: _ProfileColors.inkSoft,
                                fontSize: 11.5,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
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
  const _ProfileAvatar({required this.initials, required this.profilePhotoUrl});

  final String initials;
  final String? profilePhotoUrl;

  @override
  Widget build(BuildContext context) {
    final url = _nonEmpty(profilePhotoUrl);
    final fallback = Center(
      child: Text(
        initials,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 31,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
    if (url == null) return fallback;

    return Image.network(
      url,
      width: 92,
      height: 92,
      fit: BoxFit.cover,
      errorBuilder: (_, _, _) => fallback,
      loadingBuilder: (context, child, progress) =>
          progress == null ? child : fallback,
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
