part of '../../manager/presentation/manager_screen.dart';

class _TeamMemberProfilePage extends StatelessWidget {
  const _TeamMemberProfilePage({
    required this.member,
    required this.data,
    required this.bloc,
    required this.onNotifications,
    required this.onOpenComposer,
    this.canManage = true,
  });

  final TeamMember member;
  final ManagerDashboard data;
  final ManagerBloc bloc;
  final VoidCallback onNotifications;
  final VoidCallback onOpenComposer;

  /// Individual contributors view a teammate read-only: no request cards and
  /// no approve/decline actions.
  final bool canManage;

  @override
  Widget build(BuildContext context) {
    final present = member.todayStatus == TeamPresenceStatus.present;
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
              ('Correction:', _attendancePeriod(request)),
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
            profileAction: _ProfileAvatarAction(
              initial: data.managerInitial,
              photoUrl: data.managerPhotoUrl,
              onTap: () => Navigator.of(context).pop(),
              size: 30,
              label: 'Close profile',
            ),
            onNotifications: onNotifications,
            onQuickCreate: onOpenComposer,
          ),
          // A teammate's attendance calendar is a manager view; both the
          // top-bar icon and the card's "view calendar" action are hidden
          // for everyone else (each takes a nullable callback).
          _ProfilePageTopBar(
            onCalendarTap: !canManage
                ? null
                : () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => _TeamMemberAttendancePage(
                        member: member,
                        data: data,
                        bloc: bloc,
                        onNotifications: onNotifications,
                        onOpenComposer: onOpenComposer,
                      ),
                    ),
                  ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
              children: [
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
                      const SizedBox(height: 4),
                      Text(
                        [
                          member.designation,
                          member.team,
                        ].where((value) => value.isNotEmpty).join(' • '),
                        style: const TextStyle(
                          color: Color(0xFF717171),
                          fontSize: 16,
                          height: 24 / 16,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                ),
                // Punch in/out sits above the requests here, matching the
                // signed-in user's own profile.
                const SizedBox(height: 16),
                _AttendanceCard(
                  date: today,
                  present: present,
                  punchIn: member.punchIn,
                  punchOut: member.punchOut,
                  onViewCalendar: !canManage
                      ? null
                      : () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => _TeamMemberAttendancePage(
                              member: member,
                              data: data,
                              bloc: bloc,
                              onNotifications: onNotifications,
                              onOpenComposer: onOpenComposer,
                            ),
                          ),
                        ),
                ),
                if (canManage && openRequests.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  _RequestsSection(
                    title: 'Open Requests',
                    entries: openRequests,
                  ),
                ],
                const SizedBox(height: 22),
                const _SectionTitle(title: 'Profile'),
                const SizedBox(height: 8),
                _InfoCard(
                  children: [
                    if (member.email.isNotEmpty)
                      _ProfileRow(
                        iconAsset: 'assets/icons/profile_email.svg',
                        label: 'Email',
                        value: member.email,
                      ),
                    if (member.employeeId case final id?)
                      _ProfileRow(
                        iconAsset: 'assets/icons/profile_employee_id.svg',
                        label: 'Employee ID',
                        value: id,
                      ),
                    if (member.joiningDate case final joined?)
                      _ProfileRow(
                        iconAsset: 'assets/icons/profile_joining_date.svg',
                        label: 'Joining Date',
                        value: _joiningDateLabel(joined),
                      ),
                    if (member.birthday case final born?)
                      _ProfileRow(
                        icon: Icons.cake_outlined,
                        label: 'Date of birth',
                        value: _joiningDateLabel(born),
                      ),
                  ],
                ),
                const SizedBox(height: 22),
                const _SectionTitle(title: 'Work Role'),
                const SizedBox(height: 8),
                _InfoCard(
                  children: [
                    _ProfileRow(
                      iconAsset: 'assets/icons/work_department.svg',
                      label: 'Department',
                      value: member.team,
                    ),
                    _ProfileRow(
                      iconAsset: 'assets/icons/work_manager.svg',
                      label: 'Manager',
                      value: member.managerName ?? data.managerName,
                    ),
                    if (member.employmentType case final type?)
                      _ProfileRow(
                        iconAsset: 'assets/icons/work_employment_type.svg',
                        label: 'Employment Type',
                        value: _employmentTypeLabel(type),
                      ),
                  ],
                ),
                if (member.orgChart.length > 1) ...[
                  const SizedBox(height: 22),
                  const _SectionTitle(title: 'Org Chart'),
                  const SizedBox(height: 8),
                  _OrgChartCard(nodes: member.orgChart),
                ],
                if (member.documents.isNotEmpty) ...[
                  const SizedBox(height: 22),
                  const _SectionTitle(title: 'Documentation'),
                  const SizedBox(height: 8),
                  _DocumentationCard(documents: member.documents),
                ],
                // Only a manager can review someone, and only downward —
                // never their own manager.
                if (canManage && !member.isManager) ...[
                  const SizedBox(height: 22),
                  _GiveFeedbackButton(
                    // A review already sent this cycle is still editable, so
                    // the button says so rather than inviting a second one.
                    label:
                        member.history.any(
                          (record) =>
                              record.period ==
                              _EmployeeGrowthPage._currentPeriod(),
                        )
                        ? 'Edit Feedback'
                        : 'Give Feedback',
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => _FeedbackFormPage(
                            bloc: bloc,
                            memberId: member.id,
                          ),
                        ),
                      );
                    },
                  ),
                ],
              ],
            ),
          ),
          _BottomTabs(
            state: bloc.state,
            bloc: bloc,
            onBeforeChange: () =>
                Navigator.of(context).popUntil((route) => route.isFirst),
          ),
        ],
      ),
    );
  }
}

String _joiningDateLabel(DateTime value) =>
    '${const ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][value.month - 1]} ${value.day}, ${value.year}';

/// `employeeType` arrives as a backend token (e.g. `full_time_permanent`).
String _employmentTypeLabel(String value) => value
    .replaceAll('_', ' ')
    .split(' ')
    .where((word) => word.isNotEmpty)
    .map((word) => '${word[0].toUpperCase()}${word.substring(1)}')
    .join(' ');

class _OrgChartCard extends StatelessWidget {
  const _OrgChartCard({required this.nodes});

  final List<OrgChartNode> nodes;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: MColors.line),
      ),
      child: Column(
        children: [
          for (final (index, node) in nodes.indexed) ...[
            if (index > 0)
              Container(width: 1, height: 12, color: const Color(0xFFDDDDDD)),
            if (node.isReport && !nodes[index - 1].isReport) ...[
              Align(
                alignment: Alignment.centerLeft,
                child: Padding(
                  padding: const EdgeInsets.only(left: 4, bottom: 6),
                  child: Text(
                    nodes.where((item) => item.isReport).length == 1
                        ? 'REPORTS TO THEM'
                        : '${nodes.where((item) => item.isReport).length} REPORT TO THEM',
                    style: const TextStyle(
                      color: Color(0xFF929292),
                      fontSize: 10,
                      letterSpacing: .5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ],
            Container(
              margin: EdgeInsets.only(left: node.isReport ? 18 : 0),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: node.isSelf ? const Color(0xFFF0F7FC) : Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: node.isSelf
                      ? const Color(0xFF0571A6)
                      : const Color(0xFFEBEBEB),
                ),
              ),
              child: Row(
                children: [
                  Container(
                    width: 32,
                    height: 32,
                    decoration: const BoxDecoration(
                      color: Color(0xFFF2F2F2),
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: SvgPicture.asset(
                        'assets/icons/work_manager.svg',
                        width: 18,
                        height: 18,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          node.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: MColors.ink,
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        if (node.designation.isNotEmpty)
                          Text(
                            node.designation.toUpperCase(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0xFF929292),
                              fontSize: 10,
                              letterSpacing: .4,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _DocumentationCard extends StatelessWidget {
  const _DocumentationCard({required this.documents});

  final List<EmployeeDocument> documents;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: MColors.line),
      ),
      child: Column(
        children: [
          for (final (index, document) in documents.indexed) ...[
            if (index > 0)
              const Divider(height: 1, thickness: 1, color: Color(0xFFF2F2F2)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(
                children: [
                  Container(
                    width: 32,
                    height: 32,
                    decoration: const BoxDecoration(
                      color: Color(0xFFF2F2F2),
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: SvgPicture.asset(
                        'assets/icons/document_file.svg',
                        width: 18,
                        height: 18,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          document.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: MColors.ink,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (document.uploadedAt case final uploaded?)
                          Text(
                            _joiningDateLabel(uploaded),
                            style: const TextStyle(
                              color: Color(0xFF929292),
                              fontSize: 11,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _GiveFeedbackButton extends StatelessWidget {
  const _GiveFeedbackButton({
    required this.onTap,
    this.label = 'Give Feedback',
  });

  final VoidCallback onTap;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF0571A6),
      borderRadius: BorderRadius.circular(28),
      child: InkWell(
        borderRadius: BorderRadius.circular(28),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(
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

class _ProfileScreen extends StatefulWidget {
  const _ProfileScreen({
    required this.session,
    required this.dashboard,
    required this.bloc,
    required this.onBack,
    required this.onLogout,
    required this.onNotifications,
    required this.onOpenComposer,
    required this.onProfilePhotoUpdated,
  });

  final AuthSession session;
  final ManagerDashboard dashboard;
  final ManagerBloc bloc;
  final VoidCallback onBack;
  final Future<void> Function() onLogout;
  final VoidCallback onNotifications;
  final VoidCallback onOpenComposer;
  final Future<void> Function(String photoUrl) onProfilePhotoUpdated;

  @override
  State<_ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<_ProfileScreen> {
  bool _uploadingPhoto = false;

  Future<void> _changePhoto() async {
    if (_uploadingPhoto) return;
    final file = await pickImageFrom(context);
    if (file == null) return;
    final path = file.path;
    if (!mounted) return;

    // A profile photo is shown in a circle everywhere, so it is cropped square
    // here rather than centre-cropped at render time and cut differently on
    // every screen.
    final cropped = await cropImageFile(
      context,
      path: path,
      title: 'Crop your photo',
      initial: CropShape.square,
      allowShapeChange: false,
    );
    if (cropped == null || !mounted) return;

    setState(() => _uploadingPhoto = true);
    try {
      final photoUrl = await widget.bloc.service.updateProfilePhoto(
        path: cropped,
        filename: file.name.replaceAll(RegExp(r'\.[^.]+$'), '.png'),
      );
      widget.bloc.setManagerPhoto(photoUrl);
      await widget.onProfilePhotoUpdated(photoUrl);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not update your photo. Try again.'),
            behavior: SnackBarBehavior.floating,
            backgroundColor: MColors.ink,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _uploadingPhoto = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    final dashboard = widget.dashboard;
    final bloc = widget.bloc;
    final onBack = widget.onBack;
    final onLogout = widget.onLogout;
    final onNotifications = widget.onNotifications;
    final onOpenComposer = widget.onOpenComposer;
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
            onQuickCreate: onOpenComposer,
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
                            SizedBox(
                              width: 112,
                              height: 112,
                              child: Stack(
                                clipBehavior: Clip.none,
                                children: [
                                  GestureDetector(
                                    onTap: _changePhoto,
                                    child: Container(
                                      width: 112,
                                      height: 112,
                                      decoration: const BoxDecoration(
                                        shape: BoxShape.circle,
                                        boxShadow: [
                                          BoxShadow(
                                            color: Color(0x1A000000),
                                            blurRadius: 6,
                                            offset: Offset(0, 4),
                                          ),
                                          BoxShadow(
                                            color: Color(0x1A000000),
                                            blurRadius: 4,
                                            offset: Offset(0, 2),
                                          ),
                                        ],
                                      ),
                                      clipBehavior: Clip.antiAlias,
                                      child: Stack(
                                        fit: StackFit.expand,
                                        children: [
                                          _ProfileAvatar(
                                            initials: _initials(user.name),
                                            profilePhotoUrl:
                                                user.profilePhotoUrl,
                                            size: 112,
                                          ),
                                          if (_uploadingPhoto)
                                            const ColoredBox(
                                              color: Color(0x66000000),
                                              child: Center(
                                                child: SizedBox(
                                                  width: 28,
                                                  height: 28,
                                                  child:
                                                      CircularProgressIndicator(
                                                        strokeWidth: 2.5,
                                                        color: Colors.white,
                                                      ),
                                                ),
                                              ),
                                            ),
                                        ],
                                      ),
                                    ),
                                  ),
                                  Positioned(
                                    left: 88,
                                    top: 88,
                                    child: Container(
                                      width: 20,
                                      height: 20,
                                      decoration: BoxDecoration(
                                        color: const Color(0xFF00C950),
                                        shape: BoxShape.circle,
                                        border: Border.all(
                                          color: const Color(0xFFF7F7F7),
                                          width: 3.34,
                                        ),
                                      ),
                                    ),
                                  ),
                                  Positioned(
                                    right: -2,
                                    top: -2,
                                    child: GestureDetector(
                                      onTap: _changePhoto,
                                      child: Container(
                                        width: 32,
                                        height: 32,
                                        decoration: BoxDecoration(
                                          color: MColors.terra,
                                          shape: BoxShape.circle,
                                          border: Border.all(
                                            color: const Color(0xFFF7F7F7),
                                            width: 2.5,
                                          ),
                                        ),
                                        child: const Icon(
                                          Icons.camera_alt_rounded,
                                          size: 15,
                                          color: Colors.white,
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 14),
                            Text(
                              user.name,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Color(0xFF222222),
                                fontSize: 24,
                                height: 32 / 24,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 4),
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
                        onPunch: dashboard.shift.punchesFromApp
                            ? (type) =>
                                  _startProfilePunch(context, bloc, dashboard, type)
                            : null,
                        autoPresent: dashboard.shift.markedPresentAutomatically,
                        singlePunch: dashboard.shift.singlePunchDay,
                      ),
                      _MyRequestsSection(data: dashboard),
                      const SizedBox(height: 18),
                      const _SectionTitle(title: 'Profile'),
                      const SizedBox(height: 8),
                      _InfoCard(
                        children: [
                          _ProfileRow(
                            iconAsset: 'assets/icons/profile_email.svg',
                            label: 'Email',
                            value: user.email,
                          ),
                          _ProfileRow(
                            iconAsset: 'assets/icons/profile_joining_date.svg',
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
                            iconAsset: 'assets/icons/work_department.svg',
                            label: 'Department / team',
                            value: department,
                          ),
                          _ProfileRow(
                            iconAsset: 'assets/icons/work_manager.svg',
                            label: 'Reports to',
                            value: reportsTo,
                          ),
                        ],
                      ),
                      if (dashboard.myOrgChart.length > 1) ...[
                        const SizedBox(height: 22),
                        const _SectionTitle(title: 'Org Chart'),
                        const SizedBox(height: 8),
                        _OrgChartCard(nodes: dashboard.myOrgChart),
                      ],
                      const SizedBox(height: 18),
                      _LogoutButton(onPressed: onLogout),
                      // Below the logout button and deliberately small: it is
                      // a footnote about this person's own account, not a
                      // company policy competing for attention.
                      const SizedBox(height: 14),
                      _PrivacyAndDataRow(session: session),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
              ),
            ),
          ),
          _BottomTabs(state: bloc.state, bloc: bloc, onBeforeChange: onBack),
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
                    background: MColors.approveTint,
                    foreground: MColors.approveInk,
                    onTap: onApprove!,
                    radius: 8,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _TeamDecisionButton(
                    label: 'Reject',
                    background: MColors.rejectTint,
                    foreground: MColors.rejectInk,
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

/// Opens the punch screen from a profile, and reloads the month after it.
///
/// The profile has no state of its own to hang this on, so it is a function
/// rather than a method: the punch screen owns the sequence and the bloc owns
/// what comes back.
Future<void> _startProfilePunch(
  BuildContext context,
  ManagerBloc bloc,
  ManagerDashboard dashboard,
  String type,
) async {
  final now = DateTime.now();
  final requestedToday = dashboard.regularizations.any(
    (request) =>
        request.workDate.year == now.year &&
        request.workDate.month == now.month &&
        request.workDate.day == now.day &&
        request.decision == LeaveDecision.pending,
  );
  final outcome = await Navigator.of(context).push<PunchOutcome>(
    MaterialPageRoute(
      builder: (_) => PunchScreen(
        api: bloc.api,
        type: type,
        alreadyRequestedToday: requestedToday,
        geofenced: dashboard.shift.punchIsGeofenced,
        // The profile card's slider has already been dragged.
        startImmediately: true,
      ),
    ),
  );
  if (outcome?.punched == true || outcome?.requested == true) {
    await bloc.add(LoadAttendanceMonth(DateTime.now()));
  }
}

class _AttendanceCard extends StatelessWidget {
  const _AttendanceCard({
    required this.date,
    required this.present,
    required this.punchIn,
    required this.punchOut,
    this.onViewCalendar,
    this.onPunch,
    this.autoPresent = false,
    this.singlePunch = false,
  });

  final DateTime date;
  final bool present;
  final DateTime? punchIn;
  final DateTime? punchOut;

  /// Starts a punch, for the people whose org punches from the app (nodes
  /// 2303:53902 and 2303:54154). Null on a biometric or auto-punch policy, and
  /// on the manager's read-only view of someone else's profile — nobody
  /// punches on another person's behalf.
  final ValueChanged<String>? onPunch;

  /// This person is marked present without punching, so there are no times to
  /// show. Empty punch columns would read as a day that went wrong.
  final bool autoPresent;

  /// One punch makes the day. There is no punch-out to take or to show.
  final bool singlePunch;

  /// Only the manager's read-only view of a report links through to the full
  /// calendar; the signed-in user's own profile omits it.
  final VoidCallback? onViewCalendar;

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
              _AttendanceStatusDot(present: present),
            ],
          ),
          if (onPunch case final punch?) ...[
            const SizedBox(height: 16),
            if (punchIn == null)
              SlideToPunch(
                label: 'Slide to Punch In',
                onComplete: () => punch('in'),
              )
            else if (!singlePunch && punchOut == null)
              SlideToPunch.filled(
                label: 'Slide to Punch Out',
                color: const Color(0xFF34A853),
                onComplete: () => punch('out'),
              ),
          ],
          const SizedBox(height: 16),
          if (autoPresent)
            const Text(
              'Present by deafult',
              style: TextStyle(
                color: MColors.inkSoft,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            )
          else
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
                    // Not required where HR's shift asks for one punch.
                    value: singlePunch ? 'NR' : _attendanceClock(punchOut),
                  ),
                ),
              ],
            ),
          if (onViewCalendar case final open?) ...[
            const SizedBox(height: 16),
            InkWell(
              onTap: open,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SvgPicture.asset(
                    'assets/icons/calendar_view_link.svg',
                    width: 16,
                    height: 16,
                  ),
                  const SizedBox(width: 6),
                  const Text(
                    'View Calendar',
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
        ],
      ),
    );
  }
}

class _AttendanceStatusDot extends StatelessWidget {
  const _AttendanceStatusDot({required this.present});

  final bool present;

  @override
  Widget build(BuildContext context) {
    final bg = present ? const Color(0xFFF0FDF4) : const Color(0xFFF3F4F6);
    final dot = present ? const Color(0xFF00C950) : const Color(0xFF9CA3AF);
    final text = present ? const Color(0xFF008236) : const Color(0xFF6B7280);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
          ),
          const SizedBox(width: 4),
          Text(
            present ? 'Present' : 'Not Punched In',
            style: TextStyle(
              color: text,
              fontSize: 12,
              fontWeight: FontWeight.w600,
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
  // Collapsed by default so a long request history doesn't bury the rest of
  // the profile.
  bool _expanded = false;

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
              ('Correction:', _attendancePeriod(request)),
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
      decoration: const BoxDecoration(color: Color(0xFFF7F7F9)),
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
    required this.onNotifications,
    required this.onOpenComposer,
  });

  final TeamMember member;
  final ManagerDashboard data;
  final ManagerBloc bloc;
  final VoidCallback onNotifications;
  final VoidCallback onOpenComposer;

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
  AttendanceDayView? _selectedDay;
  List<AttendanceRecord> _records = const [];
  /// This member's own shift takes one punch, so their days show one.
  bool _singlePunch = false;
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
        _singlePunch = result.$3;
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
    setState(() {
      _month = DateTime(_month.year, _month.month + delta);
      _selectedDay = null;
    });
    await _load();
  }

  void _openDay(AttendanceDayView day) {
    setState(() {
      _selectedDay = _isSameCalendarDay(_selectedDay?.date ?? _month, day.date)
          ? null
          : day;
    });
  }

  /// Day shown in the detail strip: the tapped day, else today when the shown
  /// month contains it.
  AttendanceDayView? _detailDay(List<AttendanceDayView> days) {
    if (_selectedDay case final selected?) {
      return days
              .where((day) => _isSameCalendarDay(day.date, selected.date))
              .firstOrNull ??
          selected;
    }
    final now = DateTime.now();
    if (_month.year != now.year || _month.month != now.month) return null;
    return days.where((day) => _isSameCalendarDay(day.date, now)).firstOrNull;
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
      shift: widget.data.shift,
    );
    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F9),
      body: Column(
        children: [
          AppHomeHeader(
            profileAction: widget.data.managerPhotoUrl == null
                ? AvatarBadge(
                    initial: widget.data.managerInitial,
                    index: 1,
                    size: 30,
                  )
                : ClipOval(
                    child: Image(
                      image: _profileImage(widget.data.managerPhotoUrl!),
                      width: 30,
                      height: 30,
                      fit: BoxFit.cover,
                    ),
                  ),
            onNotifications: widget.onNotifications,
            onQuickCreate: widget.onOpenComposer,
          ),
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
                              dimmed: !matchesAttendanceFilter(day, _filter),
                              selected: _isSameCalendarDay(
                                day.date,
                                _selectedDay?.date ?? _month,
                              ),
                              onTap: () => _openDay(day),
                            ),
                          ),
                        )
                      else ...[
                        AttendanceMonthGrid(
                          month: _month,
                          days: days,
                          filter: _filter,
                          selectedDate: _selectedDay?.date,
                          onTap: _openDay,
                        ),
                        if (_detailDay(days) case final detail?) ...[
                          const SizedBox(height: 16),
                          AttendanceDayDetail(
                            day: detail,
                            singlePunch: _singlePunch,
                          ),
                        ],
                      ],
                    ],
                  ),
          ),
          _BottomTabs(
            state: widget.bloc.state,
            bloc: widget.bloc,
            onBeforeChange: () =>
                Navigator.of(context).popUntil((route) => route.isFirst),
          ),
        ],
      ),
    );
  }
}

/// Seeded/uploaded photos without S3 configured fall back to `data:` URIs
/// (see `_remoteImage` in connect_feed_screen.dart) — `Image.network` can't
/// load those, only real http(s) URLs, so profile photos need the same split.
ImageProvider _profileImage(String url) {
  if (url.startsWith('data:')) {
    final base64Part = url.split(',').last;
    return MemoryImage(base64Decode(base64Part));
  }
  return NetworkImage(resolveMediaUrl(url));
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
      child: Image(
        image: _profileImage(url),
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
            : Image(
                image: _profileImage(url),
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
    this.icon,
    this.iconAsset,
    required this.label,
    required this.value,
  }) : assert(
         icon != null || iconAsset != null,
         'provide either icon or iconAsset',
       );

  final IconData? icon;

  /// Preferred over [icon]: the glyph exported from Figma.
  final String? iconAsset;
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
            child: iconAsset != null
                ? Center(
                    child: SvgPicture.asset(iconAsset!, width: 20, height: 20),
                  )
                : Icon(icon, size: 20, color: _ProfileColors.ink),
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

/// The footnotes under the logout button: the published privacy policy, and
/// the page where someone asks for their account and data to be deleted.
///
/// Both link out to the hosted pages rather than carrying a copy of the text,
/// so what people read here is the same thing the store listings point at.
/// Deletion gets its own link rather than living inside the policy: someone
/// looking for it should not have to read a policy to find it.
class _PrivacyAndDataRow extends StatelessWidget {
  const _PrivacyAndDataRow({required this.session});

  final AuthSession session;

  @override
  Widget build(BuildContext context) {
    // Wrapped rather than a Row: three footnotes do not fit on one line on a
    // small phone, and a second centred line reads better than a squeeze.
    return Wrap(
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        _FootnoteLink(
          label: 'Privacy policy',
          url: ApiConfig.privacyPolicyUrl,
          onFallback: _showFallback,
        ),
        const _FootnoteDot(),
        _FootnoteLink(
          label: 'Delete my account',
          url: ApiConfig.dataDeletionUrl,
          onFallback: _showFallback,
        ),
        const _FootnoteDot(),
        // The only way back from a block, which is why the block dialog
        // points here.
        _FootnoteLink(
          label: 'Blocked people',
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => BlockedPeopleScreen(session: session),
            ),
          ),
        ),
      ],
    );
  }

  static void _showFallback(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(22, 14, 22, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFFE5E7EB),
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              const Text(
                'Sowaka data and privacy',
                style: TextStyle(
                  color: MColors.ink,
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'Sowaka holds what your employer needs to run HR: your name, '
                'work email and employee ID, your attendance and leave '
                'records, reimbursement claims and receipts, performance '
                'reviews, and anything you post on Connect.',
                style: TextStyle(
                  color: MColors.inkSoft,
                  fontSize: 13.5,
                  height: 1.55,
                ),
              ),
              const SizedBox(height: 14),
              const Text(
                'Deleting your account',
                style: TextStyle(
                  color: MColors.ink,
                  fontSize: 14.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'Your account is created by your employer and closes when you '
                'leave. To have it closed and your personal data deleted '
                'sooner, email your HR team and support@getsowaka.com from '
                'your work address. We confirm within 7 working days and '
                'delete within 30 — except records your employer must keep by '
                'law, such as attendance and payroll history, which are kept '
                'for the statutory period and then removed.',
                style: TextStyle(
                  color: MColors.inkSoft,
                  fontSize: 13.5,
                  height: 1.55,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                ApiConfig.privacyPolicyUrl,
                style: const TextStyle(
                  color: Color(0xFF0571A6),
                  fontSize: 12.5,
                ),
              ),
              Text(
                ApiConfig.dataDeletionUrl,
                style: const TextStyle(
                  color: Color(0xFF0571A6),
                  fontSize: 12.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FootnoteDot extends StatelessWidget {
  const _FootnoteDot();

  @override
  Widget build(BuildContext context) {
    return const Text(
      '  ·  ',
      style: TextStyle(color: Color(0xFFD1D5DB), fontSize: 11.5),
    );
  }
}

/// One small underlined link. Given a `url` it opens the browser and falls
/// back to the sheet when nothing opens; given an `onTap` it just runs that.
class _FootnoteLink extends StatelessWidget {
  const _FootnoteLink({
    required this.label,
    this.url,
    this.onFallback,
    this.onTap,
  });

  final String label;
  final String? url;
  final void Function(BuildContext context)? onFallback;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () async {
        final target = url;
        if (target == null) {
          onTap?.call();
          return;
        }
        final opened = await openExternalLink(target);
        if (opened || !context.mounted) return;
        onFallback?.call(context);
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Text(
          label,
          style: const TextStyle(
            color: Color(0xFF9CA3AF),
            fontSize: 11.5,
            fontWeight: FontWeight.w500,
            decoration: TextDecoration.underline,
            decorationColor: Color(0xFFD1D5DB),
          ),
        ),
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
  static const inkFaint = Color(0xFFA79D92);
  static const line = Color(0xFFF0E8DD);
  static const terra = Color(0xFFBE5A36);
  static const sage = Color(0xFF7E8B6E);
}

/// Manager's read-only growth timeline for one report: overall score with the
/// trend chart, then a card per review period. The current period offers the
/// "Give Feedback" action that opens the rating form.
class _EmployeeGrowthPage extends StatefulWidget {
  const _EmployeeGrowthPage({
    required this.name,
    required this.designation,
    required this.history,
    required this.data,
    required this.bloc,
    required this.onNotifications,
    required this.onOpenComposer,
    this.memberId,
    this.embedded = false,
    this.onOpenProfile,
  });

  final String name;
  final String designation;
  final List<GrowthRecord> history;

  /// True when rendered as the Grow tab itself (an individual contributor's
  /// only Grow view) rather than pushed as a route: the shell already provides
  /// the bottom nav, and there's nothing to navigate back to.
  final bool embedded;

  /// Makes the header avatar open the signed-in user's profile, matching every
  /// other tab. Without it the avatar here was inert.
  final VoidCallback? onOpenProfile;
  final ManagerDashboard data;
  final ManagerBloc bloc;
  final VoidCallback onNotifications;
  final VoidCallback onOpenComposer;

  /// Null when the page shows the signed-in user's own growth: you cannot
  /// review yourself, so the "feedback is due" action is hidden.
  final int? memberId;

  static String _currentPeriod() {
    final now = DateTime.now();
    return '${now.year}-${now.month.toString().padLeft(2, '0')}';
  }

  @override
  State<_EmployeeGrowthPage> createState() => _EmployeeGrowthPageState();
}

class _EmployeeGrowthPageState extends State<_EmployeeGrowthPage> {
  /// The month on show, as 'YYYY-MM'. Any month from the first review to now
  /// can be picked — including ones nobody reviewed, which is where "pending"
  /// and "missed" come from. Null means the current month.
  String? _selectedPeriod;

  /// Every month from the first review (or this month, if there are none) up
  /// to this one, oldest first.
  List<String> _periodsFor(List<GrowthRecord> history, String current) {
    final first = history.isEmpty ? current : history.first.period;
    return _monthsBetween(first, current);
  }

  Future<void> _pickMonth(List<String> periods, String selected) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => _MonthPickerSheet(periods: periods, selected: selected),
    );
    if (picked != null && mounted) setState(() => _selectedPeriod = picked);
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<ManagerState>(
      stream: widget.bloc.stream,
      initialData: widget.bloc.state,
      builder: (context, snapshot) {
        final live = snapshot.data?.dashboard;
        // Prefer live state so a review sent from here appears immediately.
        final current = widget.memberId == null
            ? (live?.growthHistory ?? widget.history)
            : (live?.team
                      .where((member) => member.id == widget.memberId)
                      .firstOrNull
                      ?.history ??
                  widget.history);
        return _build(context, current);
      },
    );
  }

  /// True when this growth page belongs to the viewer's own manager.
  bool get _isOwnManager =>
      widget.memberId != null &&
      (widget.data.team
              .where((member) => member.id == widget.memberId)
              .firstOrNull
              ?.isManager ??
          false);

  Widget _build(BuildContext context, List<GrowthRecord> history) {
    final period = _EmployeeGrowthPage._currentPeriod();
    final periods = _periodsFor(history, period);
    final selected = periods.contains(_selectedPeriod)
        ? _selectedPeriod!
        : period;
    final selectedIndex = history.indexWhere((r) => r.period == selected);
    final record = selectedIndex >= 0 ? history[selectedIndex] : null;
    final isCurrent = selected == period;
    final ownPage = widget.memberId == null;
    // Only a report can be reviewed from here: not yourself, and not the
    // person you report to — feedback only flows downward.
    final canReview = widget.memberId != null && !_isOwnManager;

    Future<void> openForm() => Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            _FeedbackFormPage(bloc: widget.bloc, memberId: widget.memberId!),
      ),
    );

    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F9),
      body: Column(
        children: [
          AppHomeHeader(
            profileAction: switch (widget.onOpenProfile) {
              final open? => _ProfileAvatarAction(
                initial: widget.data.managerInitial,
                photoUrl: widget.data.managerPhotoUrl,
                onTap: open,
                size: 30,
              ),
              _ when widget.data.managerPhotoUrl == null => AvatarBadge(
                initial: widget.data.managerInitial,
                index: 1,
                size: 30,
              ),
              _ => ClipOval(
                child: Image(
                  image: _profileImage(widget.data.managerPhotoUrl!),
                  width: 30,
                  height: 30,
                  fit: BoxFit.cover,
                ),
              ),
            },
            onNotifications: widget.onNotifications,
            onQuickCreate: widget.onOpenComposer,
          ),
          if (!widget.embedded)
            _GrowthPageTopBar(
              name: widget.name,
              designation: widget.designation,
            ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
              children: [
                // Node 2406:74936 — someone with nothing reviewed yet is told
                // who reviews them and why, before anything else.
                if (ownPage && history.isEmpty && widget.data.hasManager) ...[
                  _GrowIntroBanner(approverName: widget.data.approverName),
                  const SizedBox(height: 12),
                ],
                // The score card always shows the latest reviewed month, even
                // while an unreviewed one is picked below — a pending month has
                // no score of its own to show.
                if (history.isEmpty)
                  _EmptyScoreCard(current: period)
                else
                  _GrowthScoreSection(
                    history: history,
                    selectedIndex: selectedIndex >= 0 ? selectedIndex : null,
                    onSelect: (index) =>
                        setState(() => _selectedPeriod = history[index].period),
                    deltaMessageFor: (label, delta) => ownPage
                        ? 'Your overall score for $label '
                              '${delta >= 0 ? 'increased' : 'decreased'} by '
                              '${delta.abs().toStringAsFixed(1)} points compared '
                              'to last month.'
                        : "${widget.name}'s overall score for $label "
                              '${delta >= 0 ? 'increased' : 'decreased'} by '
                              '${delta.abs().toStringAsFixed(1)} points compared '
                              'to last month.',
                  ),
                const SizedBox(height: 12),
                _MonthStatusRow(
                  label: _shortPeriod(selected),
                  score: record?.overallScore,
                  pending: record == null && isCurrent,
                  missed: record == null && !isCurrent,
                  onTap: periods.length > 1
                      ? () => _pickMonth(periods, selected)
                      : null,
                ),
                const SizedBox(height: 12),
                // A reviewed month: the scores and the manager's notes.
                if (record != null) ...[
                  // A review sent this cycle can still be edited by the person
                  // who wrote it, until the cycle closes.
                  if (isCurrent && canReview) ...[
                    _FeedbackSubmittedCard(period: period, onEdit: openForm),
                    const SizedBox(height: 12),
                  ],
                  _GrowthMonthCard(
                    record: record,
                    expanded: true,
                    collapsible: false,
                    onToggle: () {},
                  ),
                ]
                // This month, not reviewed yet.
                else if (isCurrent) ...[
                  if (canReview)
                    _FeedbackDuePeriodCard(
                      period: period,
                      onGiveFeedback: openForm,
                    )
                  else if (ownPage) ...[
                    // What the review will cover, in HR's words — so the month
                    // reads as "here is what counts" rather than standing empty.
                    const _EvaluatedNote(),
                    for (final (index, param)
                        in widget.data.myParameters.indexed) ...[
                      const SizedBox(height: 12),
                      _GuidanceCard(
                        name: param.name,
                        guidance: param.description ?? '',
                        initiallyOpen: index == 0,
                      ),
                    ],
                  ],
                ]
                // A past month nobody reviewed.
                else
                  const _FeedbackMissedCard(),
              ],
            ),
          ),
          if (!widget.embedded)
            _BottomTabs(
              state: widget.bloc.state,
              bloc: widget.bloc,
              onBeforeChange: () =>
                  Navigator.of(context).popUntil((route) => route.isFirst),
            ),
        ],
      ),
    );
  }
}

const _growMonthsShort = [
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

const _growMonthsLong = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/// '2026-06' as 'Jun 2026'.
String _shortPeriod(String period) {
  final parts = period.split('-');
  final month = parts.length == 2 ? int.tryParse(parts[1]) : null;
  if (month == null || month < 1 || month > 12) return period;
  return '${_growMonthsShort[month - 1]} ${parts[0]}';
}

/// Every 'YYYY-MM' from [first] to [last] inclusive, oldest first. Empty or
/// reversed input gives just [last].
List<String> _monthsBetween(String first, String last) {
  (int, int)? parse(String value) {
    final parts = value.split('-');
    if (parts.length != 2) return null;
    final year = int.tryParse(parts[0]);
    final month = int.tryParse(parts[1]);
    if (year == null || month == null) return null;
    return (year, month);
  }

  final from = parse(first);
  final to = parse(last);
  if (from == null || to == null) return [last];
  final out = <String>[];
  var (year, month) = from;
  while (year < to.$1 || (year == to.$1 && month <= to.$2)) {
    out.add('$year-${month.toString().padLeft(2, '0')}');
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return out.isEmpty ? [last] : out;
}

/// Who reviews you, and why (node 2406:74936). Shown until the first review
/// arrives, which is when someone is most likely to wonder what Grow is for.
class _GrowIntroBanner extends StatelessWidget {
  const _GrowIntroBanner({required this.approverName});

  final String approverName;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(13.035),
      decoration: BoxDecoration(
        color: const Color(0xFFEEF0FF),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFEBEBEB), width: 1.035),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Image.asset('assets/icons/grow/seedling.png', width: 41, height: 41),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'Your manager, $approverName, reviews your performance against '
              "your KPIs every month, so you know what's going well and where "
              'you can grow.',
              style: const TextStyle(
                color: Color(0xFF484848),
                fontSize: 12,
                height: 16.2 / 12,
                letterSpacing: -0.16,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The score card before there is any score (node 2406:74872): the months
/// ahead laid out, so it reads as "this fills in" rather than "this is broken".
class _EmptyScoreCard extends StatelessWidget {
  const _EmptyScoreCard({required this.current});

  /// This month, 'YYYY-MM' — the axis runs from here across the next five.
  final String current;

  @override
  Widget build(BuildContext context) {
    final start = current;
    final parts = start.split('-');
    final year = int.tryParse(parts.first) ?? DateTime.now().year;
    final month = int.tryParse(parts.last) ?? DateTime.now().month;
    final labels = [
      for (var i = 0; i < 6; i++) _growMonthsShort[(month - 1 + i) % 12],
    ];
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Color(0x12000000),
            blurRadius: 7,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 20, 20, 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'OVERALL SCORE',
                  style: TextStyle(
                    color: Color(0xFF717171),
                    fontSize: 11.5,
                    height: 17.25 / 11.5,
                    letterSpacing: 0.6,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                SizedBox(height: 8),
                Text(
                  'You can track your monthly overall scores here.',
                  style: TextStyle(
                    color: Color(0xFF717171),
                    fontSize: 12.5,
                    height: 18.75 / 12.5,
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 16),
            child: SizedBox(
              height: 110,
              width: double.infinity,
              child: CustomPaint(
                painter: _EmptyChartPainter(
                  labels: labels,
                  // Semantic year is unused on the axis, but keeps the painter
                  // from repainting identical months across a year change.
                  year: year,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyChartPainter extends CustomPainter {
  _EmptyChartPainter({required this.labels, required this.year});

  final List<String> labels;
  final int year;

  static const _brand = Color(0xFF0571A6);
  static const _muted = Color(0xFF717171);

  @override
  void paint(Canvas canvas, Size size) {
    const inset = 20.0;
    final baseline = size.height * 0.66;
    final left = inset;
    final right = size.width - inset;
    final step = (right - left) / (labels.length - 1);

    // A flat line where the scores will go.
    canvas.drawLine(
      Offset(left, baseline),
      Offset(right, baseline),
      Paint()
        ..color = const Color(0xFFE5E7EB)
        ..strokeWidth = 1.5
        ..strokeCap = StrokeCap.round,
    );

    // This month's axis label in brand blue, the rest muted.
    for (var i = 0; i < labels.length; i++) {
      final painter = TextPainter(
        text: TextSpan(
          text: labels[i],
          style: TextStyle(
            color: i == 0 ? _brand : _muted,
            fontSize: 9,
            fontWeight: FontWeight.w700,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      painter.paint(
        canvas,
        Offset(
          left + step * i - painter.width / 2,
          size.height - painter.height,
        ),
      );
    }

    // One point, this month, with a "-/5" marker above it: nothing scored yet.
    final point = Offset(left, baseline);
    canvas.drawLine(
      Offset(point.dx, 22),
      point,
      Paint()
        ..color = _brand.withValues(alpha: 0.35)
        ..strokeWidth = 1,
    );
    canvas.drawCircle(point, 5, Paint()..color = _brand);
    canvas.drawCircle(
      point,
      5,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );

    final tag = TextPainter(
      text: const TextSpan(
        text: '-/5',
        style: TextStyle(
          color: Colors.white,
          fontSize: 9.5,
          fontWeight: FontWeight.w700,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final pill = RRect.fromRectAndRadius(
      Rect.fromCenter(
        center: Offset(point.dx, 10),
        width: tag.width + 14,
        height: 18,
      ),
      const Radius.circular(9),
    );
    canvas.drawRRect(pill, Paint()..color = _brand);
    tag.paint(canvas, Offset(point.dx - tag.width / 2, 10 - tag.height / 2));
  }

  @override
  bool shouldRepaint(_EmptyChartPainter old) =>
      old.year != year || old.labels.join() != labels.join();
}

/// The month on show and how it stands (node 2406:74811). Tapping it opens the
/// month picker; a past month nobody reviewed is greyed (node 2412:78385).
class _MonthStatusRow extends StatelessWidget {
  const _MonthStatusRow({
    required this.label,
    required this.score,
    required this.pending,
    required this.missed,
    required this.onTap,
  });

  final String label;
  final double? score;
  final bool pending;
  final bool missed;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: missed ? const Color(0xFFEBEBEB) : Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: missed ? const Color(0xFFEBEBEB) : const Color(0xFFF0EEF8),
              width: 1.114,
            ),
          ),
          child: Row(
            children: [
              Text(
                label,
                style: const TextStyle(
                  color: Color(0xFF101828),
                  fontSize: 13,
                  height: 19.5 / 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 4),
              if (onTap != null)
                Transform.rotate(
                  angle: -math.pi / 2,
                  child: SvgPicture.asset(
                    'assets/icons/chevron_left_small.svg',
                    width: 18,
                    height: 18,
                  ),
                ),
              const Spacer(),
              if (pending)
                const _MonthChip(
                  text: 'Pending',
                  background: Color(0xFFFEFDDA),
                  foreground: Color(0xFFFFCC00),
                )
              else if (score != null)
                _MonthChip(
                  text: '${score!.toStringAsFixed(1)} / 5',
                  background: const Color(0xFFE6F1F8),
                  foreground: const Color(0xFF0571A6),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MonthChip extends StatelessWidget {
  const _MonthChip({
    required this.text,
    required this.background,
    required this.foreground,
  });

  final String text;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: foreground,
          fontSize: 14,
          height: 16.2 / 14,
          letterSpacing: -0.16,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// "Your performance is evaluated…" (node 2412:80161), above the parameters of
/// a month not yet reviewed.
class _EvaluatedNote extends StatelessWidget {
  const _EvaluatedNote();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(18, 22, 18, 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFF0EEF8), width: 1.114),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D000000),
            blurRadius: 5,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: const Text(
        'Your performance is evaluated by your manager across below parameters.',
        style: TextStyle(
          color: Color(0xFF717171),
          fontSize: 12.5,
          height: 18.75 / 12.5,
        ),
      ),
    );
  }
}

/// One KPI, with HR's guidance behind a toggle (node 2408:77421). The plus
/// turns into a cross when open — the same icon, rotated, as the design does.
class _GuidanceCard extends StatefulWidget {
  const _GuidanceCard({
    required this.name,
    required this.guidance,
    this.initiallyOpen = false,
  });

  final String name;

  /// What HR wrote for this KPI in HRMS. A KPI with none has nothing to open.
  final String guidance;
  final bool initiallyOpen;

  @override
  State<_GuidanceCard> createState() => _GuidanceCardState();
}

class _GuidanceCardState extends State<_GuidanceCard> {
  late bool _open = widget.initiallyOpen && widget.guidance.trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final hasGuidance = widget.guidance.trim().isNotEmpty;
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEBEBEB)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x12000000),
            blurRadius: 7,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: hasGuidance ? () => setState(() => _open = !_open) : null,
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        widget.name,
                        style: const TextStyle(
                          color: Color(0xFF222222),
                          fontSize: 15,
                          height: 22.5 / 15,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    if (hasGuidance)
                      AnimatedRotation(
                        turns: _open ? 0.125 : 0,
                        duration: const Duration(milliseconds: 180),
                        child: SvgPicture.asset(
                          'assets/icons/grow/plus.svg',
                          width: 20,
                          height: 20,
                          colorFilter: const ColorFilter.mode(
                            Color(0xFF222222),
                            BlendMode.srcIn,
                          ),
                        ),
                      ),
                  ],
                ),
                if (_open) ...[
                  const SizedBox(height: 8),
                  const Divider(
                    height: 1.114,
                    thickness: 1.114,
                    color: Color(0xFFF3F4F6),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    widget.guidance.trim(),
                    style: const TextStyle(
                      color: Color(0xFF484848),
                      fontSize: 13.5,
                      height: 21.6 / 13.5,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A past month nobody reviewed (node 2412:78838).
class _FeedbackMissedCard extends StatelessWidget {
  const _FeedbackMissedCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F7F9),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFDDDDDD), width: 1.114),
      ),
      child: const Text(
        'Feedback missed',
        style: TextStyle(
          color: Color(0xFF717171),
          fontSize: 12.5,
          height: 18.75 / 12.5,
        ),
      ),
    );
  }
}

/// "Select Month" (node 2408:76097): a wheel of the months that can be shown,
/// with the one on show pre-selected.
class _MonthPickerSheet extends StatefulWidget {
  const _MonthPickerSheet({required this.periods, required this.selected});

  final List<String> periods;
  final String selected;

  @override
  State<_MonthPickerSheet> createState() => _MonthPickerSheetState();
}

class _MonthPickerSheetState extends State<_MonthPickerSheet> {
  late int _index = math.max(0, widget.periods.indexOf(widget.selected));
  late final _controller = FixedExtentScrollController(initialItem: _index);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// Month names alone read cleanly, but only while every option is in the
  /// same year — across a year boundary two Januaries would be ambiguous.
  String _label(String period) {
    final years = widget.periods.map((p) => p.split('-').first).toSet();
    final parts = period.split('-');
    final month = int.tryParse(parts.last) ?? 1;
    final name = _growMonthsLong[(month - 1).clamp(0, 11)];
    return years.length > 1 ? '$name ${parts.first}' : name;
  }

  @override
  Widget build(BuildContext context) {
    const itemExtent = 52.0;
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
      padding: const EdgeInsets.only(bottom: 32),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFD1D5DB),
                borderRadius: BorderRadius.circular(100),
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Select Month',
              style: TextStyle(
                color: Color(0xFF222222),
                fontSize: 16,
                height: 22 / 16,
                letterSpacing: 0.2,
                fontWeight: FontWeight.w600,
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
              child: SizedBox(
                height: itemExtent * 5,
                child: Stack(
                  children: [
                    ListWheelScrollView.useDelegate(
                      controller: _controller,
                      itemExtent: itemExtent,
                      physics: const FixedExtentScrollPhysics(),
                      diameterRatio: 100,
                      onSelectedItemChanged: (value) =>
                          setState(() => _index = value),
                      childDelegate: ListWheelChildBuilderDelegate(
                        childCount: widget.periods.length,
                        builder: (context, i) {
                          final distance = (i - _index).abs();
                          return Center(
                            child: Opacity(
                              opacity: distance == 0
                                  ? 1
                                  : distance == 1
                                  ? 0.45
                                  : 0.2,
                              child: Text(
                                _label(widget.periods[i]),
                                style: TextStyle(
                                  color: distance == 0
                                      ? const Color(0xFF222222)
                                      : const Color(0xFF717171),
                                  fontSize: distance == 0
                                      ? 20
                                      : distance == 1
                                      ? 16
                                      : 14,
                                  letterSpacing: distance == 0 ? 0.2 : 0.4,
                                  fontWeight: distance == 0
                                      ? FontWeight.w600
                                      : FontWeight.w400,
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                    // The hairlines either side of the chosen row.
                    IgnorePointer(
                      child: Column(
                        children: [
                          const SizedBox(height: itemExtent * 2),
                          Container(height: 1, color: const Color(0xFFDDDDDD)),
                          const SizedBox(height: itemExtent - 2),
                          Container(height: 1, color: const Color(0xFFDDDDDD)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF0571A6),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  onPressed: () =>
                      Navigator.of(context).pop(widget.periods[_index]),
                  child: const Text(
                    'Select',
                    style: TextStyle(
                      fontSize: 16,
                      height: 22 / 16,
                      letterSpacing: 0.2,
                      fontWeight: FontWeight.w600,
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

class _GrowthScoreSection extends StatelessWidget {
  const _GrowthScoreSection({
    required this.history,
    required this.selectedIndex,
    required this.onSelect,
    this.deltaMessageFor,
  });

  final List<GrowthRecord> history;
  final int? selectedIndex;
  final ValueChanged<int> onSelect;

  /// The sentence shown when the points chip is tapped, given the month's
  /// label and the change. Null leaves the chip inert.
  final String Function(String label, double delta)? deltaMessageFor;

  @override
  Widget build(BuildContext context) {
    final values = history.map((record) => record.overallScore).toList();
    final effectiveIndex = history.isEmpty
        ? 0
        : (selectedIndex ?? history.length - 1).clamp(0, history.length - 1);
    final selected = history.isEmpty ? null : history[effectiveIndex];
    final previous = effectiveIndex > 0
        ? history[effectiveIndex - 1].overallScore
        : null;

    // Score and chart share one card: tapping a point moves the score above it,
    // so splitting them across two cards broke that relationship visually.
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Color(0x12000000),
            blurRadius: 7,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The month is named once on this page, by the row directly below
          // this card — which is also what changes it. Printing it here too
          // said the same month twice, one line apart.
          _OverallScoreCard(
            overall: selected?.overallScore ?? 0,
            previousScore: previous,
            showAveragesNote: true,
            boxed: false,
            onDeltaTap: (deltaMessageFor == null || selected == null)
                ? null
                : (delta) {
                    final messenger = ScaffoldMessenger.of(context);
                    messenger
                      ..hideCurrentSnackBar()
                      ..showSnackBar(
                        SnackBar(
                          behavior: SnackBarBehavior.floating,
                          content: Text(
                            deltaMessageFor!(
                              _periodTitle(selected.period),
                              delta,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      );
                  },
          ),
          if (history.isNotEmpty) ...[
            const SizedBox(height: 16),
            _GrowthChart(
              records: history,
              values: values,
              color: const Color(0xFF0571A6),
              selectedIndex: effectiveIndex,
              onSelect: onSelect,
            ),
          ],
        ],
      ),
    );
  }
}

class _GrowthPageTopBar extends StatelessWidget {
  const _GrowthPageTopBar({
    required this.name,
    required this.designation,
    this.onBack,
  });

  final String name;
  final String designation;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    // Per node 861:7716: this row sits flush against AppHomeHeader above
    // it — both white, no visible seam — unlike the grey fill this had.
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 14, 12),
      decoration: const BoxDecoration(color: Colors.white),
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
          const SizedBox(width: 10),
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
                    fontSize: 16,
                    height: 24 / 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  designation,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF717171),
                    fontSize: 12.5,
                    fontWeight: FontWeight.w400,
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

/// The counterpart for a period whose review has been sent. It stays editable
/// until the cycle closes, and the status stays Submitted throughout — a later
/// edit replaces the review rather than starting a new one.
class _FeedbackSubmittedCard extends StatelessWidget {
  const _FeedbackSubmittedCard({required this.period, required this.onEdit});

  final String period;

  /// Reopens the review. Only the person who wrote it sees this card: the
  /// employee's own page shows the month's scores instead.
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF3FAF5),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFBFE3CC)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  _periodTitle(period),
                  style: const TextStyle(
                    color: MColors.ink,
                    fontSize: 15.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFDCF0E3),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Text(
                  'Submitted',
                  style: TextStyle(
                    color: Color(0xFF2F7A4F),
                    fontSize: 11.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'You can keep editing this review until the cycle ends.',
            style: TextStyle(color: MColors.inkSoft, fontSize: 13),
          ),
          ...[
            const SizedBox(height: 14),
            Align(
              alignment: Alignment.centerLeft,
              child: Material(
                color: Colors.white,
                borderRadius: BorderRadius.circular(10),
                child: InkWell(
                  borderRadius: BorderRadius.circular(10),
                  onTap: onEdit,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 18,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFFBFE3CC)),
                    ),
                    child: const Text(
                      'Edit feedback',
                      style: TextStyle(
                        color: Color(0xFF2F7A4F),
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
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
}

class _FeedbackDuePeriodCard extends StatelessWidget {
  const _FeedbackDuePeriodCard({
    required this.period,
    required this.onGiveFeedback,
  });

  final String period;
  final VoidCallback onGiveFeedback;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFBEB),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFF5C86B)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  _periodTitle(period),
                  style: const TextStyle(
                    color: MColors.ink,
                    fontSize: 15.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Feedback is due for this month',
            style: TextStyle(color: MColors.inkSoft, fontSize: 13),
          ),
          const SizedBox(height: 14),
          Align(
            alignment: Alignment.centerLeft,
            child: Material(
              color: const Color(0xFFE8862B),
              borderRadius: BorderRadius.circular(10),
              child: InkWell(
                borderRadius: BorderRadius.circular(10),
                onTap: onGiveFeedback,
                child: const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                  child: Text(
                    'Give Feedback',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                    ),
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

/// The feedback form as a pushed route. Grow and the team-member profile both
/// open this, so giving feedback never switches tabs or changes what the
/// Manage tab is showing underneath.
class _FeedbackFormPage extends StatefulWidget {
  const _FeedbackFormPage({required this.bloc, required this.memberId});

  final ManagerBloc bloc;
  final int memberId;

  @override
  State<_FeedbackFormPage> createState() => _FeedbackFormPageState();
}

class _FeedbackFormPageState extends State<_FeedbackFormPage> {
  StreamSubscription<ManagerState>? _subscription;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    // Loads the member's parameters into bloc state for the form to edit.
    widget.bloc.add(OpenFeedbackRecord(widget.memberId));
    // Saving or sending clears the selected member on the bloc. That is the
    // signal the form is finished, so close the route rather than sitting on a
    // spinner waiting for a member that will never come back.
    _subscription = widget.bloc.stream.listen((state) {
      if (!mounted) return;
      if (state.selectedMember != null) {
        _loaded = true;
        return;
      }
      if (_loaded && Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      }
    });
  }

  @override
  void dispose() {
    // Cancel first: clearing the draft below would otherwise re-enter the
    // listener and try to pop a route that is already going away.
    _subscription?.cancel();
    widget.bloc.add(const CloseFeedbackRecord());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<ManagerState>(
      stream: widget.bloc.stream,
      initialData: widget.bloc.state,
      builder: (context, snapshot) {
        final state = snapshot.data ?? widget.bloc.state;
        if (state.selectedMember == null) {
          // Either still loading, or already persisted and about to pop.
          return const Scaffold(
            backgroundColor: Color(0xFFF7F7F9),
            body: Center(
              child: CircularProgressIndicator(color: MColors.terra),
            ),
          );
        }
        return Scaffold(
          backgroundColor: const Color(0xFFF7F7F9),
          body: Column(
            children: [
              Expanded(
                child: _RecordFeedback(
                  state: state,
                  bloc: widget.bloc,
                  onClose: () => Navigator.of(context).pop(),
                ),
              ),
              _BottomTabs(
                state: state,
                bloc: widget.bloc,
                onBeforeChange: () =>
                    Navigator.of(context).popUntil((route) => route.isFirst),
              ),
            ],
          ),
        );
      },
    );
  }
}
