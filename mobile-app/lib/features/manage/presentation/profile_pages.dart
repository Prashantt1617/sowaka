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
    // Pushed as its own route, so it sits outside the shell's StreamBuilder
    // and would never hear the bloc. Without this the Approve and Decline
    // buttons here could not go busy: their spinner state is read once, at
    // build, and nothing would rebuild them.
    return StreamBuilder<ManagerState>(
      stream: bloc.stream,
      initialData: bloc.state,
      builder: (context, _) => _build(context),
    );
  }

  Widget _build(BuildContext context) {
    final present = member.todayStatus == TeamPresenceStatus.present;
    final today = DateTime.now();
    // The dashboard as it stands now, not the copy handed over when this page
    // was pushed. Deciding a request updates the bloc, and reading the old
    // copy left the card sitting there, still pending, under its own toast.
    final data = bloc.state.dashboard ?? this.data;

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
            title: '${leave.type} leave request',
            rows: [
              ('Date:', _leaveDateRange(leave)),
              ('Comment:', leave.reason),
            ],
            decision: LeaveDecision.pending,
            approving: bloc.isBusy(
              DecideLeave(leave.id, LeaveDecision.approved),
            ),
            declining: bloc.isBusy(
              DecideLeave(leave.id, LeaveDecision.declined),
            ),
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
            approving: bloc.isBusy(
              DecideOvertime(request.id, LeaveDecision.approved),
            ),
            declining: bloc.isBusy(
              DecideOvertime(request.id, LeaveDecision.declined),
            ),
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
            icon: request.isOutOfLocation
                ? Icons.location_off_rounded
                : Icons.edit_calendar_rounded,
            title: request.heading,
            rows: _attendanceRequestRows(request),
            decision: LeaveDecision.pending,
            approving: bloc.isBusy(
              DecideAttendanceRegularization(
                request.id,
                LeaveDecision.approved,
              ),
            ),
            declining: bloc.isBusy(
              DecideAttendanceRegularization(
                request.id,
                LeaveDecision.declined,
              ),
            ),
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
          _ProfilePageTopBar(
            // "Profile-Ananya" (node 3106:49189): whose page this is.
            title: 'Profile-${member.name.trim().split(' ').first}',
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
                          color: Color(0xFF222222),
                          fontSize: 24,
                          height: 32 / 24,
                          fontWeight: FontWeight.w700,
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
                const SizedBox(height: 16),
                _MemberProfileTabs(
                  member: member,
                  canManage: canManage,
                  openRequests: openRequests,
                  // No "your manager" line here: the reader usually is the
                  // manager, and the month row's due card says what to do.
                  grow: _ProfileGrowTab(
                    data: data,
                    bloc: bloc,
                    memberId: member.id,
                  ),
                  // Today's card and the month below it, as on one's own
                  // profile — both read by this member's shift, which the
                  // calendar fetches with the month.
                  attendance: _MemberAttendanceCalendar(
                    member: member,
                    data: data,
                    bloc: bloc,
                    todayCard: (shift) => _AttendanceCard(
                      date: today,
                      present: present,
                      punchIn: member.punchIn,
                      punchOut: member.punchOut,
                      autoPresent: shift.markedPresentAutomatically,
                      singlePunch: shift.singlePunchDay,
                    ),
                  ),
                ),
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

/// Whether the profile carries the working day: attendance, requests, the
/// reporting line. True for every company that has any of the work tabs, and
/// for one that was never given a list at all, so nobody loses what they had.
bool profileShowsWork(List<String> enabledTabs) =>
    enabledTabs.isEmpty ||
    enabledTabs.contains('actions') ||
    enabledTabs.contains('team') ||
    enabledTabs.contains('grow');

/// Whether the profile carries Help: the counsellor, why they were matched,
/// and the sessions. A company with Help and no work tabs sees this instead.
bool profileShowsHelp(List<String> enabledTabs) => enabledTabs.contains('talk');

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
  /// Which profile tab is open. Request first, as the design opens it.
  int _tab = 0;

  /// The Request tab: every request of theirs, newest first, or a line
  /// saying there are none.
  List<Widget> _requestTab(ManagerDashboard dashboard) {
    final entries = _MyRequestsSection.entriesFor(dashboard);
    if (entries.isEmpty) {
      return const [_ProfileTabNote('No requests yet.')];
    }
    return [
      for (final entry in entries)
        Padding(padding: const EdgeInsets.only(bottom: 12), child: entry.$2),
    ];
  }

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
      // Shown in a circle at well under 200pt; a full-resolution PNG of an
      // iPhone photo is many megabytes for no visible gain.
      maxEdge: 1024,
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
    } catch (error) {
      if (mounted) {
        // The server's own reason, when it gave one: "5 MB or smaller" is
        // something a person can act on, "try again" is not.
        final reason = error is ManagerApiException ? error.message : null;
        showAppToast(
          context,
          reason ?? 'Could not update your photo. Try again.',
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
    // Nobody above them: the row goes rather than reading "Your manager",
    // which is a placeholder, not an answer.
    final reportsTo = dashboard.hasManager
        ? (_nonEmpty(user.managerName) ?? _nonEmpty(dashboard.approverName))
        : null;
    // What this company's app is for.
    final tabs = user.enabledTabs;
    final worksHere = profileShowsWork(tabs);
    final helpHere = profileShowsHelp(tabs);
    // Growth is reviewed by one's manager; without one there is nothing to
    // show there, so the tab is not offered.
    final profileTabs = [
      'Details',
      'Attendance',
      'Requests',
      if (dashboard.hasManager) 'Grow',
      'Org chart',
      if (helpHere) 'Counselor',
    ];
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
          // Titled as the design draws it (node 3106:49749); a teammate's
          // page is "Profile-Ananya", so the two are never mistaken.
          _ProfilePageTopBar(onBack: onBack, title: 'My Profile'),
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
                                        // The same camera as the onboarding
                                        // screen's "Add or take a photo".
                                        child: Center(
                                          child: SvgPicture.asset(
                                            'assets/onboarding/camera.svg',
                                            width: 16,
                                            height: 16,
                                            colorFilter: const ColorFilter.mode(
                                              Colors.white,
                                              BlendMode.srcIn,
                                            ),
                                          ),
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
                              style: TextStyle(
                                color: const Color(0xFF222222),
                                fontSize: !worksHere && helpHere ? 26 : 24,
                                height: 32 / 24,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              !worksHere && helpHere && department.isNotEmpty
                                  ? '$designation • $department'
                                  : designation,
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: MColors.inkSoft,
                                fontSize: !worksHere && helpHere ? 15 : 16,
                                fontWeight: !worksHere && helpHere
                                    ? FontWeight.w400
                                    : FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 22),
                      if (!worksHere && helpHere)
                        HelpProfileSection(session: session),
                      // The profile reads as tabs (node 3074:45990): one
                      // thing at a time, rather than every section stacked.
                      if (worksHere) ...[
                        _ProfileTabs(
                          labels: profileTabs,
                          selected: _tab.clamp(0, profileTabs.length - 1),
                          onChanged: (index) => setState(() => _tab = index),
                        ),
                        const SizedBox(height: 16),
                        ...switch (profileTabs[_tab.clamp(
                          0,
                          profileTabs.length - 1,
                        )]) {
                          'Requests' => _requestTab(dashboard),
                          'Attendance' => [
                            _AttendanceCard(
                              date: today,
                              present: todayRecord?.punchIn != null,
                              punchIn: todayRecord?.punchIn,
                              punchOut: todayRecord?.punchOut,
                              onPunch: dashboard.shift.punchesFromApp
                                  ? (type) => _startProfilePunch(
                                      context,
                                      bloc,
                                      dashboard,
                                      type,
                                    )
                                  : null,
                              autoPresent:
                                  dashboard.shift.markedPresentAutomatically,
                              singlePunch: dashboard.shift.singlePunchDay,
                            ),
                            const SizedBox(height: 24),
                            _ProfileAttendanceCalendar(dashboard: dashboard),
                          ],
                          'Details' => [
                            _WorkDetailRow(
                              iconAsset: 'assets/icons/profile_email.svg',
                              label: 'Email',
                              value: user.email,
                            ),
                            if (_nonEmpty(user.joiningDate) != null)
                              _WorkDetailRow(
                                iconAsset:
                                    'assets/icons/profile_joining_date.svg',
                                label: 'Joining Date',
                                value: _formatDate(user.joiningDate),
                              ),
                            _WorkDetailRow(
                              iconAsset: 'assets/icons/work_department.svg',
                              label: 'Department',
                              value: department,
                            ),
                            if (reportsTo case final name?)
                              _WorkDetailRow(
                                iconAsset: 'assets/icons/work_manager.svg',
                                label: 'Manager',
                                value: name,
                              ),
                            if (_nonEmpty(user.birthday) != null)
                              _WorkDetailRow(
                                icon: Icons.cake_outlined,
                                label: 'Date of birth',
                                value: _formatDate(user.birthday),
                              ),
                          ],
                          'Org chart' => [
                            if (dashboard.myOrgChart.length > 1)
                              _OrgChartCard(nodes: dashboard.myOrgChart)
                            else
                              const _ProfileTabNote(
                                'Your reporting line will show here once it '
                                'is set up.',
                              ),
                          ],
                          'Grow' => [
                            _ProfileGrowTab(
                              data: dashboard,
                              bloc: bloc,
                              managerName: reportsTo,
                            ),
                          ],
                          _ => [HelpProfileSection(session: session)],
                        },
                      ],
                      // Room between whatever came last and the log-out,
                      // whichever kind of profile this is.
                      const SizedBox(height: 24),
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
    this.approving = false,
    this.declining = false,
  });

  final IconData icon;
  final String title;
  final List<(String label, String value)> rows;
  final LeaveDecision decision;
  final VoidCallback? onApprove;
  final VoidCallback? onReject;
  final bool readOnly;

  /// The decision is in flight; see [_TeamRequestCard.approving].
  final bool approving;
  final bool declining;
  bool get busy => approving || declining;

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
                    background: busy ? MColors.line : MColors.approveTint,
                    foreground: busy ? MColors.inkFaint : MColors.approveInk,
                    onTap: busy ? null : onApprove,
                    busy: approving,
                    radius: 8,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _TeamDecisionButton(
                    label: 'Reject',
                    background: busy ? MColors.line : MColors.rejectTint,
                    foreground: busy ? MColors.inkFaint : MColors.rejectInk,
                    onTap: busy ? null : onReject,
                    busy: declining,
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
        onRecorded: (record) => bloc.add(PunchRecorded(record)),
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
              'Present by default',
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

  /// Every request of theirs as a card, newest first.
  static List<(DateTime date, Widget card)> entriesFor(ManagerDashboard data) {
    final myRequests = <(DateTime date, Widget card)>[
      for (final leave in data.myLeaves)
        (
          leave.requestedOn,
          _ProfileRequestCard(
            icon: Icons.calendar_month_rounded,
            title: '${leave.type} leave request',
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
            icon: request.isOutOfLocation
                ? Icons.location_off_rounded
                : Icons.edit_calendar_rounded,
            title: request.heading,
            rows: _attendanceRequestRows(request),
            decision: request.decision,
            readOnly: true,
          ),
        ),
    ]..sort((a, b) => b.$1.compareTo(a.$1));
    return myRequests;
  }

  @override
  Widget build(BuildContext context) {
    final myRequests = entriesFor(data);
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

/// A report's month, under today's card on their Attendance tab: the same
/// month row, headings, list and calendar as one's own profile, read from the
/// server a month at a time since only the viewer's own days come with the
/// dashboard.
class _MemberAttendanceCalendar extends StatefulWidget {
  const _MemberAttendanceCalendar({
    required this.member,
    required this.data,
    required this.bloc,
    required this.todayCard,
  });

  final TeamMember member;
  final ManagerDashboard data;
  final ManagerBloc bloc;

  /// Today's card, built once the member's shift is known so it reads the
  /// day the way their own profile does.
  final Widget Function(ShiftPolicy shift) todayCard;

  @override
  State<_MemberAttendanceCalendar> createState() =>
      _MemberAttendanceCalendarState();
}

class _MemberAttendanceCalendarState extends State<_MemberAttendanceCalendar> {
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  AttendanceFilter? _filter;
  bool _loading = true;
  bool _failed = false;
  DateTime? _selected;
  List<AttendanceRecord> _records = const [];

  /// This member's own shift, which grades their days: a server that predates
  /// sending it leaves this null and the viewer's shift stands in, with the
  /// single-punch flag it did send.
  ShiftPolicy? _shift;
  bool _singlePunch = false;
  List<AttendanceRegularization> _regularizations = const [];

  ShiftPolicy get _policy => _shift ?? widget.data.shift;
  bool get _single => _shift?.singlePunchDay ?? _singlePunch;
  bool get _autoPresent => _policy.markedPresentAutomatically;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    // The month asked for; a reply for a month no longer on show is dropped,
    // so two quick taps on the arrows cannot leave one month's days under
    // another month's heading.
    final month = _month;
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final from = DateTime(month.year, month.month, 1);
      final to = DateTime(month.year, month.month + 1, 0);
      final result = await widget.bloc.service.fetchTeamMemberAttendance(
        widget.member.userId,
        from,
        to,
      );
      if (!mounted || month != _month) return;
      setState(() {
        _records = result.$1;
        _regularizations = result.$2;
        _singlePunch = result.$3;
        _shift = result.$4;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || month != _month) return;
      setState(() {
        _failed = true;
        _loading = false;
      });
    }
  }

  Future<void> _changeMonth(int delta) async {
    setState(() {
      _month = DateTime(_month.year, _month.month + delta);
      _selected = null;
    });
    await _load();
  }

  List<AttendanceDayView> get _days => buildAttendanceDays(
    month: _month,
    records: _records,
    regularizations: _regularizations,
    leaves: widget.data.leaves
        .where((item) => item.userId == widget.member.userId)
        .toList(),
    holidays: widget.data.holidays,
    overtime: widget.data.overtime
        .where((item) => item.userId == widget.member.userId)
        .toList(),
    shift: _policy,
  );

  String? _pendingNoticeFor(AttendanceDayView day) {
    if (day.correctionPending) {
      return 'Their missed punch request is under review for this day.';
    }
    if (day.kind == AttendanceKind.leavePending) {
      return 'Their leave request is under review for this day.';
    }
    return null;
  }

  Future<void> _showDaySheet(AttendanceDayView day) =>
      showModalBottomSheet<void>(
        context: context,
        backgroundColor: const Color(0xFFF7F7F9),
        isScrollControlled: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        builder: (_) => SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: const Color(0xFFE5E7EB),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                AttendanceDayDetail(
                  day: day,
                  pendingNotice: _pendingNoticeFor(day),
                  singlePunch: _single,
                  autoPresent: _autoPresent,
                ),
              ],
            ),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final canGoForward =
        _month.year < now.year ||
        (_month.year == now.year && _month.month < now.month);
    final days = _loading || _failed ? const <AttendanceDayView>[] : _days;
    final selectedDay = _selected == null
        ? (_month.year == now.year && _month.month == now.month
              ? days
                    .where((day) => _isSameCalendarDay(day.date, now))
                    .firstOrNull
              : null)
        : days
              .where((day) => _isSameCalendarDay(day.date, _selected!))
              .firstOrNull;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        widget.todayCard(_policy),
        const SizedBox(height: 20),
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
                  fontFamily: 'Sora',
                  color: Color(0xFF2A2A2A),
                  fontSize: 16,
                  fontWeight: FontWeight.w400,
                ),
              ),
            ),
            Opacity(
              opacity: canGoForward ? 1 : .3,
              child: AttendanceCalendarArrow(
                onPressed: canGoForward ? () => _changeMonth(1) : null,
                asset: 'assets/icons/calendar_chevron_next.svg',
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (_loading)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 40),
            child: Center(
              child: CircularProgressIndicator(color: MColors.terra),
            ),
          )
        else if (_failed)
          const _ProfileTabNote('Could not load attendance for this month.')
        else ...[
          AttendanceFilterChips(
            selected: _filter,
            counts: {
              for (final filter in AttendanceFilter.values)
                filter: days
                    .where((day) => matchesAttendanceFilter(day, filter))
                    .length,
            },
            onChanged: (filter) => setState(() {
              _filter = filter;
              _selected = null;
            }),
          ),
          const SizedBox(height: 16),
          if (_filter case final filter?) ...[
            if (!days.any((day) => matchesAttendanceFilter(day, filter)))
              const _ProfileTabNote('Nothing under this heading this month.'),
            ...days
                .where((day) => matchesAttendanceFilter(day, filter))
                .map(
                  (day) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: AttendanceListCard(
                      day: day,
                      today: _isSameCalendarDay(day.date, now),
                      pendingNotice: _pendingNoticeFor(day),
                      singlePunch: _single,
                      autoPresent: _autoPresent,
                      onTap: () => _showDaySheet(day),
                    ),
                  ),
                ),
          ] else ...[
            AttendanceMonthGrid(
              month: _month,
              days: days,
              filter: _filter,
              selectedDate: _selected,
              onTap: (day) => setState(() => _selected = day.date),
            ),
            if (selectedDay != null) ...[
              const SizedBox(height: 16),
              AttendanceDayDetail(
                day: selectedDay,
                pendingNotice: _pendingNoticeFor(selectedDay),
                singlePunch: _single,
                autoPresent: _autoPresent,
              ),
            ],
          ],
        ],
      ],
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

/// The profile's tabs (node 3074:45990): labels 24 apart, the open one bold
/// with a line under it, the row scrolling when the labels run past the edge.
class _ProfileTabs extends StatelessWidget {
  const _ProfileTabs({
    required this.labels,
    required this.selected,
    required this.onChanged,
  });

  final List<String> labels;
  final int selected;
  final ValueChanged<int> onChanged;

  /// Up to this many tabs share the bar equally; more scroll.
  static const _fitsAcross = 3;

  Widget _tab(int index, {required bool stretched}) => InkWell(
    onTap: () => onChanged(index),
    child: Container(
      padding: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: index == selected
                ? const Color(0xFF222222)
                : Colors.transparent,
          ),
        ),
      ),
      child: Text(
        labels[index],
        textAlign: stretched ? TextAlign.center : TextAlign.start,
        style: TextStyle(
          fontFamily: 'Sora',
          color: index == selected
              ? const Color(0xFF222222)
              : const Color(0xFF717171),
          fontSize: 14,
          height: 20 / 14,
          fontWeight: index == selected ? FontWeight.w700 : FontWeight.w500,
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    // A short list — a colleague's Attendance · Details · Org chart — fills
    // the bar in equal parts; a long one scrolls at its natural widths.
    final stretched = labels.length <= _fitsAcross;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Stack(
        alignment: Alignment.bottomLeft,
        children: [
          Container(height: 1, color: const Color(0xFFEBEBEB)),
          if (stretched)
            Row(
              children: [
                for (var index = 0; index < labels.length; index++)
                  Expanded(child: _tab(index, stretched: true)),
              ],
            )
          else
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              clipBehavior: Clip.none,
              child: Row(
                children: [
                  for (var index = 0; index < labels.length; index++)
                    Padding(
                      padding: EdgeInsets.only(
                        right: index == labels.length - 1 ? 0 : 24,
                      ),
                      child: _tab(index, stretched: false),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// One line of the Work detail tab (node 3074:45990): the glyph in a soft
/// disc, then the label over its value.
class _WorkDetailRow extends StatelessWidget {
  const _WorkDetailRow({
    this.icon,
    this.iconAsset,
    required this.label,
    required this.value,
  }) : assert(
         icon != null || iconAsset != null,
         'provide either icon or iconAsset',
       );

  final IconData? icon;
  final String? iconAsset;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              color: Color(0xFFF7F7F7),
              shape: BoxShape.circle,
            ),
            child: iconAsset != null
                ? SvgPicture.asset(
                    iconAsset!,
                    width: 20,
                    height: 20,
                    colorFilter: const ColorFilter.mode(
                      Color(0xFF222222),
                      BlendMode.srcIn,
                    ),
                  )
                : Icon(icon, size: 20, color: const Color(0xFF222222)),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: Color(0xFF717171),
                    fontSize: 14,
                    height: 20 / 14,
                    fontWeight: FontWeight.w400,
                  ),
                ),
                Text(
                  value,
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: Color(0xFF222222),
                    fontSize: 14,
                    height: 20 / 14,
                    fontWeight: FontWeight.w500,
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

/// A tab with nothing in it yet says so, quietly.
class _ProfileTabNote extends StatelessWidget {
  const _ProfileTabNote(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 28),
    child: Text(
      text,
      textAlign: TextAlign.center,
      style: const TextStyle(
        fontFamily: 'Sora',
        color: Color(0xFF9197A2),
        fontSize: 13,
        height: 1.4,
        fontWeight: FontWeight.w500,
      ),
    ),
  );
}

/// The Attendance tab's calendar (node 3198:20867): a month at a time, the
/// headings with their counts, and the day that was tapped underneath.
class _ProfileAttendanceCalendar extends StatefulWidget {
  const _ProfileAttendanceCalendar({required this.dashboard});

  final ManagerDashboard dashboard;

  @override
  State<_ProfileAttendanceCalendar> createState() =>
      _ProfileAttendanceCalendarState();
}

class _ProfileAttendanceCalendarState
    extends State<_ProfileAttendanceCalendar> {
  late DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  AttendanceFilter? _filter;
  DateTime? _selected;

  List<AttendanceDayView> get _days => buildAttendanceDays(
    month: _month,
    records: widget.dashboard.attendance,
    regularizations: widget.dashboard.regularizations,
    leaves: widget.dashboard.myLeaves,
    holidays: widget.dashboard.holidays,
    overtime: widget.dashboard.myOvertime,
    shift: widget.dashboard.shift,
  );

  @override
  Widget build(BuildContext context) {
    final days = _days;
    final now = DateTime.now();
    final canGoForward =
        _month.year < now.year ||
        (_month.year == now.year && _month.month < now.month);
    final selectedDay = _selected == null
        ? days
              .where(
                (day) =>
                    day.date.year == now.year &&
                    day.date.month == now.month &&
                    day.date.day == now.day,
              )
              .firstOrNull
        : days
              .where(
                (day) =>
                    day.date.year == _selected!.year &&
                    day.date.month == _selected!.month &&
                    day.date.day == _selected!.day,
              )
              .firstOrNull;
    const months = [
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            AttendanceCalendarArrow(
              onPressed: () => setState(() {
                _month = DateTime(_month.year, _month.month - 1);
                _selected = null;
              }),
              asset: 'assets/icons/calendar_chevron_prev.svg',
            ),
            Expanded(
              child: Text(
                '${months[_month.month - 1]} ${_month.year}',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: 'Sora',
                  color: Color(0xFF2A2A2A),
                  fontSize: 16,
                  fontWeight: FontWeight.w400,
                ),
              ),
            ),
            Opacity(
              opacity: canGoForward ? 1 : .3,
              child: AttendanceCalendarArrow(
                onPressed: canGoForward
                    ? () => setState(() {
                        _month = DateTime(_month.year, _month.month + 1);
                        _selected = null;
                      })
                    : null,
                asset: 'assets/icons/calendar_chevron_next.svg',
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        AttendanceFilterChips(
          selected: _filter,
          counts: {
            for (final filter in AttendanceFilter.values)
              filter: days
                  .where((day) => matchesAttendanceFilter(day, filter))
                  .length,
          },
          // A new heading is a new question: the day opened under the last
          // one closes with it.
          onChanged: (filter) => setState(() {
            _filter = filter;
            _selected = null;
          }),
        ),
        const SizedBox(height: 16),
        // A heading opens the days it covers, the same list Quick Actions
        // shows (node 3214:40887); without one the month is the calendar.
        if (_filter case final filter?) ...[
          if (!days.any((day) => matchesAttendanceFilter(day, filter)))
            const _ProfileTabNote('Nothing under this heading this month.'),
          ...days
              .where((day) => matchesAttendanceFilter(day, filter))
              .map(
                (day) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: AttendanceListCard(
                    day: day,
                    today: _isSameCalendarDay(day.date, now),
                    pendingNotice: _pendingNoticeFor(day),
                    singlePunch: widget.dashboard.shift.singlePunchDay,
                    autoPresent:
                        widget.dashboard.shift.markedPresentAutomatically,
                    onTap: () => _showDaySheet(day),
                  ),
                ),
              ),
        ] else ...[
          AttendanceMonthGrid(
            month: _month,
            days: days,
            filter: _filter,
            selectedDate: _selected,
            onTap: (day) => setState(() => _selected = day.date),
          ),
          if (selectedDay != null) ...[
            const SizedBox(height: 16),
            AttendanceDayDetail(
              day: selectedDay,
              pendingNotice: _pendingNoticeFor(selectedDay),
              singlePunch: widget.dashboard.shift.singlePunchDay,
              autoPresent: widget.dashboard.shift.markedPresentAutomatically,
            ),
          ],
        ],
      ],
    );
  }

  String? _pendingNoticeFor(AttendanceDayView day) {
    if (day.correctionPending) {
      return 'Your missed punched request is currently under review by your '
          'manager for this day.';
    }
    if (day.kind == AttendanceKind.leavePending) {
      return 'Your leave request is currently under review by your manager '
          'for this day.';
    }
    return null;
  }

  /// A listed day opens in a sheet, as on Quick Actions. Read-only here:
  /// corrections and leave are raised from Quick Actions.
  Future<void> _showDaySheet(AttendanceDayView day) =>
      showModalBottomSheet<void>(
        context: context,
        backgroundColor: const Color(0xFFF7F7F9),
        isScrollControlled: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        builder: (_) => SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: const Color(0xFFE5E7EB),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                AttendanceDayDetail(
                  day: day,
                  pendingNotice: _pendingNoticeFor(day),
                  singlePunch: widget.dashboard.shift.singlePunchDay,
                  autoPresent:
                      widget.dashboard.shift.markedPresentAutomatically,
                ),
              ],
            ),
          ),
        ),
      );
}

/// A report's profile as tabs (node 3070:44930): what is waiting on you,
/// their day, their details, where they sit, their growth (where a manager
/// also gives feedback), and their documents.
class _MemberProfileTabs extends StatefulWidget {
  const _MemberProfileTabs({
    required this.member,
    required this.canManage,
    required this.openRequests,
    required this.attendance,
    required this.grow,
  });

  final TeamMember member;
  final bool canManage;
  final List<(DateTime date, Widget card)> openRequests;
  final Widget attendance;
  final Widget grow;

  @override
  State<_MemberProfileTabs> createState() => _MemberProfileTabsState();
}

class _MemberProfileTabsState extends State<_MemberProfileTabs> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final member = widget.member;
    // Anyone can be looked up: their day, their details and where they sit.
    // Requests, growth and documents are a manager's business, so they show
    // only for someone in the viewer's own reporting line.
    final managed = member.inViewerChain;
    final labels = [
      'Details',
      'Attendance',
      if (managed && widget.canManage) 'Requests',
      if (managed) 'Grow',
      'Org chart',
      if (managed && member.documents.isNotEmpty) 'Documentation',
    ];
    final tab = labels[_tab.clamp(0, labels.length - 1)];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ProfileTabs(
          labels: labels,
          selected: _tab.clamp(0, labels.length - 1),
          onChanged: (index) => setState(() => _tab = index),
        ),
        const SizedBox(height: 16),
        ...switch (tab) {
          'Requests' =>
            widget.openRequests.isEmpty
                ? const [_ProfileTabNote('No open requests.')]
                : [
                    for (final entry in widget.openRequests)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: entry.$2,
                      ),
                  ],
          'Attendance' => [widget.attendance],
          'Details' => [
            if (member.email.isNotEmpty)
              _WorkDetailRow(
                iconAsset: 'assets/icons/profile_email.svg',
                label: 'Email',
                value: member.email,
              ),
            if (member.employeeId case final id?)
              _WorkDetailRow(
                iconAsset: 'assets/icons/profile_employee_id.svg',
                label: 'Employee ID',
                value: id,
              ),
            if (member.joiningDate case final joined?)
              _WorkDetailRow(
                iconAsset: 'assets/icons/profile_joining_date.svg',
                label: 'Joining Date',
                value: _joiningDateLabel(joined),
              ),
            _WorkDetailRow(
              iconAsset: 'assets/icons/work_department.svg',
              label: 'Department',
              value: member.team,
            ),
            if (_nonEmpty(member.managerName) case final name?)
              _WorkDetailRow(
                iconAsset: 'assets/icons/work_manager.svg',
                label: 'Manager',
                value: name,
              ),
            if (member.employmentType case final type?)
              _WorkDetailRow(
                iconAsset: 'assets/icons/work_employment_type.svg',
                label: 'Employment Type',
                value: _employmentTypeLabel(type),
              ),
            if (member.birthday case final born?)
              _WorkDetailRow(
                icon: Icons.cake_outlined,
                label: 'Date of birth',
                value: _joiningDateLabel(born),
              ),
          ],
          'Org chart' => [
            if (member.orgChart.length > 1)
              _OrgChartCard(nodes: member.orgChart)
            else
              const _ProfileTabNote('No reporting line to show yet.'),
          ],
          'Grow' => [widget.grow],
          _ => [_DocumentationCard(documents: member.documents)],
        },
      ],
    );
  }
}

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

  /// True when this growth page belongs to one of the viewer's own direct
  /// reports — the only people they may review. Never themselves.
  bool get _reportsToViewer =>
      widget.memberId != null &&
      (widget.data.team
              .where((member) => member.id == widget.memberId)
              .firstOrNull
              ?.reportsToViewer ??
          false);

  Widget _build(BuildContext context, List<GrowthRecord> history) {
    final period = _EmployeeGrowthPage._currentPeriod();
    final periods = _periodsFor(history, period);
    final selected = periods.contains(_selectedPeriod)
        ? _selectedPeriod!
        : period;
    final ownPage = widget.memberId == null;
    // Only a report can be reviewed from here: not yourself, and not the
    // person you report to — feedback only flows downward.
    final canReview = _reportsToViewer;

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
              children: _growthContent(
                context: context,
                data: widget.data,
                history: history,
                selected: selected,
                period: period,
                ownPage: ownPage,
                canReview: canReview,
                onSelectPeriod: (picked) =>
                    setState(() => _selectedPeriod = picked),
                onPickMonth: periods.length > 1
                    ? () => _pickMonth(periods, selected)
                    : null,
                openForm: openForm,
              ),
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

/// What a growth page shows under its header: the score card and chart, the
/// month on show, and that month's cards. The Grow page and the profile's
/// Grow tab both read this, so they cannot drift apart.
List<Widget> _growthContent({
  required BuildContext context,
  required ManagerDashboard data,
  required List<GrowthRecord> history,
  required String selected,
  required String period,
  required bool ownPage,
  required bool canReview,
  required ValueChanged<String> onSelectPeriod,
  required VoidCallback? onPickMonth,
  required VoidCallback openForm,

  /// On the profile (node 3106:49749) the month row also says who reviews you.
  String? managerLine,
}) {
  final record = history.where((r) => r.period == selected).firstOrNull;
  final isCurrent = selected == period;
  return [
    // Before the first review (node 2406:74746): who reviews
    // you and why, where someone is most likely to wonder.
    if (history.isEmpty && ownPage) ...[
      _GrowIntroBanner(managerName: _nonEmpty(data.approverName)),
      const SizedBox(height: 12),
    ],
    // The score card shows the month picked below when it was
    // reviewed, else the latest review — a pending or missed
    // month has no score of its own to show.
    if (history.isEmpty)
      _EmptyScoreCard(current: period)
    else
      _GrowthScoreSection(
        history: history,
        selectedPeriod: selected,
        currentPeriod: period,
        onSelect: onSelectPeriod,
      ),
    const SizedBox(height: 12),
    _MonthStatusRow(
      label: _shortPeriod(selected),
      managerName: managerLine,
      score: record?.overallScore,
      pending: record == null && isCurrent,
      warmPending: canReview,
      missed: record == null && !isCurrent,
      onTap: onPickMonth,
    ),
    const SizedBox(height: 12),
    // A reviewed month: each parameter's score and the manager's
    // insight, one card each (node 2406:74944).
    if (record != null) ...[
      // A review sent this cycle can still be edited by the person
      // who wrote it, until the cycle closes.
      if (isCurrent && canReview) ...[
        _FeedbackSubmittedCard(onEdit: openForm),
        const SizedBox(height: 12),
      ],
      for (final (index, param) in record.parameters.indexed)
        Padding(
          padding: EdgeInsets.only(
            bottom: index == record.parameters.length - 1 ? 0 : 12,
          ),
          child: _GrowthParamCard(
            param: param,
            // Older records carried one note for the whole
            // review; show it rather than leave the insight blank.
            fallback: record.parameters
                .map((item) => item.note.trim())
                .firstWhere((value) => value.isNotEmpty, orElse: () => ''),
          ),
        ),
    ]
    // This month, not reviewed yet.
    else if (isCurrent) ...[
      if (canReview)
        _FeedbackDuePeriodCard(onGiveFeedback: openForm)
      else if (ownPage && data.myParameters.isNotEmpty) ...[
        // What the month is reviewed on (node 2412:80204): a line
        // saying so, then each KPI with HR's guidance behind it.
        const _GrowNote(
          'Your performance is evaluated by your manager across '
          'below parameters.',
        ),
        const SizedBox(height: 12),
        for (final (index, param) in data.myParameters.indexed)
          Padding(
            padding: EdgeInsets.only(
              bottom: index == data.myParameters.length - 1 ? 0 : 12,
            ),
            child: _GuidanceCard(
              name: param.name,
              guidance: param.description ?? param.subtitle ?? '',
              initiallyOpen: index == 0,
            ),
          ),
      ],
    ]
    // A past month nobody reviewed.
    else
      const _FeedbackMissedCard(),
  ];
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

/// The profile's Grow tab (node 3106:49749): growth in place, on one's own
/// profile and on a report's. On a report's it is also where a manager gives
/// feedback — the month row offers the form when a review is due.
class _ProfileGrowTab extends StatefulWidget {
  const _ProfileGrowTab({
    required this.data,
    required this.bloc,
    this.managerName,
    this.memberId,
  });

  final ManagerDashboard data;
  final ManagerBloc bloc;

  /// Who reviews the person on show; said under the month on their own tab.
  final String? managerName;

  /// Null on one's own profile. A report's id on theirs.
  final int? memberId;

  @override
  State<_ProfileGrowTab> createState() => _ProfileGrowTabState();
}

class _ProfileGrowTabState extends State<_ProfileGrowTab> {
  String? _selectedPeriod;

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
        final data = snapshot.data?.dashboard ?? widget.data;
        final member = widget.memberId == null
            ? null
            : data.team
                  .where((member) => member.id == widget.memberId)
                  .firstOrNull;
        final history = member?.history ?? data.growthHistory;
        final period = _EmployeeGrowthPage._currentPeriod();
        final periods = _monthsBetween(
          history.isEmpty ? period : history.first.period,
          period,
        );
        final selected = periods.contains(_selectedPeriod)
            ? _selectedPeriod!
            : period;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: _growthContent(
            context: context,
            data: data,
            history: history,
            selected: selected,
            period: period,
            ownPage: member == null,
            // Feedback only flows downward: a report, never yourself.
            canReview: member?.reportsToViewer ?? false,
            onSelectPeriod: (picked) =>
                setState(() => _selectedPeriod = picked),
            onPickMonth: periods.length > 1
                ? () => _pickMonth(periods, selected)
                : null,
            openForm: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => _FeedbackFormPage(
                  bloc: widget.bloc,
                  memberId: widget.memberId!,
                ),
              ),
            ),
            managerLine: widget.managerName,
          ),
        );
      },
    );
  }
}

/// Before the first review (node 2406:74746): who reviews you and why.
class _GrowIntroBanner extends StatelessWidget {
  const _GrowIntroBanner({required this.managerName});

  final String? managerName;

  @override
  Widget build(BuildContext context) {
    final who = managerName == null
        ? 'Your manager'
        : 'Your manager, $managerName,';
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFEEF0FF),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFEBEBEB)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text('🌱', style: TextStyle(fontSize: 30, height: 1)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              '$who reviews your performance against your KPIs every '
              "month, so you know what's going well and where you can grow.",
              style: const TextStyle(
                fontFamily: 'Sora',
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

/// A quiet line in a card of its own (node 2412:80204).
class _GrowNote extends StatelessWidget {
  const _GrowNote(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: const Color(0xFFF0EEF8), width: 1.114),
      boxShadow: const [
        BoxShadow(
          color: Color(0x0D000000),
          blurRadius: 10,
          offset: Offset(0, 2),
        ),
      ],
    ),
    child: Text(
      text,
      style: const TextStyle(
        fontFamily: 'Sora',
        color: Color(0xFF717171),
        fontSize: 12.5,
        height: 18.75 / 12.5,
      ),
    ),
  );
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

    // The last month on the axis in brand blue, the rest muted.
    for (var i = 0; i < labels.length; i++) {
      final painter = TextPainter(
        text: TextSpan(
          text: labels[i],
          style: TextStyle(
            fontFamily: 'Sora',
            color: i == labels.length - 1 ? _brand : _muted,
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
    this.warmPending = false,
    this.managerName,
  });

  final String label;
  final double? score;
  final bool pending;

  /// "Feedback is given by your manager Tanvi", under the month, on the
  /// profile's Grow tab (node 3106:49749).
  final String? managerName;

  /// Orange on a report's page, where "pending" is the viewer's to act on;
  /// yellow on one's own, where it is only news (nodes 2406:75231, 2412:80204).
  final bool warmPending;
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
            boxShadow: const [
              BoxShadow(
                color: Color(0x0D000000),
                blurRadius: 10,
                offset: Offset(0, 2),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: _rowChildren()),
              if (managerName case final name?) ...[
                const SizedBox(height: 10),
                Text.rich(
                  TextSpan(
                    style: const TextStyle(
                      fontFamily: 'Sora',
                      color: Color(0xFF717171),
                      fontSize: 12.5,
                      height: 18.75 / 12.5,
                    ),
                    children: [
                      const TextSpan(
                        text: 'Feedback is given by your manager ',
                      ),
                      TextSpan(
                        text: name,
                        style: const TextStyle(
                          color: Color(0xFF0571A6),
                          fontWeight: FontWeight.w700,
                          decoration: TextDecoration.underline,
                          decorationColor: Color(0xFF0571A6),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _rowChildren() => [
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
      _MonthChip(
        text: 'Pending',
        background: const Color(0xFFFEFDDA),
        foreground: warmPending
            ? const Color(0xFFFF8D28)
            : const Color(0xFFFFCC00),
      )
    else if (score != null)
      _MonthChip(
        text: '${score!.toStringAsFixed(1)} / 5',
        background: const Color(0xFFEEF0FF),
        foreground: const Color(0xFF675AFF),
        fontSize: 13,
        fontWeight: FontWeight.w700,
      ),
  ];
}

class _MonthChip extends StatelessWidget {
  const _MonthChip({
    required this.text,
    required this.background,
    required this.foreground,
    this.fontSize = 14,
    this.fontWeight = FontWeight.w600,
  });

  final String text;
  final Color background;
  final Color foreground;
  final double fontSize;
  final FontWeight fontWeight;

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
          fontSize: fontSize,
          height: fontSize == 13 ? 19.5 / 13 : 16.2 / 14,
          letterSpacing: fontSize == 13 ? 0 : -0.16,
          fontWeight: fontWeight,
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
            blurRadius: 14,
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
    required this.selectedPeriod,
    required this.currentPeriod,
    required this.onSelect,
    this.deltaMessageFor,
  });

  final List<GrowthRecord> history;

  /// The month picked below. A month with no review of its own shows the
  /// latest review here, as the design does for a pending or missed month.
  final String selectedPeriod;
  final String currentPeriod;
  final ValueChanged<String> onSelect;

  /// The sentence shown when the points chip is tapped, given the month's
  /// label and the change. Null leaves the chip inert.
  final String Function(String label, double delta)? deltaMessageFor;

  @override
  Widget build(BuildContext context) {
    final picked = history.indexWhere((r) => r.period == selectedPeriod);
    final shownIndex = picked >= 0 ? picked : history.length - 1;
    final shown = history[shownIndex];
    final previous = shownIndex > 0
        ? history[shownIndex - 1].overallScore
        : null;

    // Score and chart share one card (node 2406:74944): the month named
    // above the score is the point the chart has filled in.
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Color(0x12000000),
            blurRadius: 14,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
            child: _OverallScoreCard(
              eyebrow: _periodTitle(shown.period),
              labelColor: const Color(0xFF484848),
              overall: shown.overallScore,
              previousScore: previous,
              showAveragesNote: true,
              boxed: false,
              onDeltaTap: deltaMessageFor == null
                  ? null
                  : (delta) {
                      showAppToast(
                        context,
                        deltaMessageFor!(_periodTitle(shown.period), delta),
                      );
                    },
            ),
          ),
          const SizedBox(height: 12),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
            child: _GrowthChart(
              periods: _GrowthChart.windowEndingAt(currentPeriod),
              scores: {for (final r in history) r.period: r.overallScore},
              highlightPeriod: shown.period,
              currentPeriod: currentPeriod,
              firstReviewed: history.first.period,
              onSelect: onSelect,
            ),
          ),
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
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
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
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: Color(0xFF222222),
                    fontSize: 16,
                    height: 16.2 / 16,
                    letterSpacing: -0.16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  designation,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: Color(0xFF717171),
                    fontSize: 12,
                    height: 16.2 / 12,
                    letterSpacing: -0.16,
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

class _FeedbackSubmittedCard extends StatelessWidget {
  const _FeedbackSubmittedCard({required this.onEdit});

  /// Reopens the review. Only the person who wrote it sees this card: the
  /// employee's own page shows the month's scores instead.
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) => _GrowActionCard(
    background: const Color(0xFFF4FAF1),
    border: const Color(0xFF34C759),
    text: 'You can edit the feedback till the cycle ends.',
    buttonColor: const Color(0xFF34C759),
    onTap: onEdit,
  );
}

/// A line and a button in a tinted card: "feedback is due" in amber, "you can
/// still edit it" in green (nodes 2406:75231, 2412:81964).
class _GrowActionCard extends StatelessWidget {
  const _GrowActionCard({
    required this.background,
    required this.border,
    required this.text,
    required this.buttonColor,
    required this.onTap,
  });

  final Color background;
  final Color border;
  final String text;
  final Color buttonColor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: border, width: 1.114),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D000000),
            blurRadius: 10,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            text,
            style: const TextStyle(
              fontFamily: 'Sora',
              color: Color(0xFF717171),
              fontSize: 12.5,
              height: 18.75 / 12.5,
            ),
          ),
          const SizedBox(height: 6),
          Material(
            color: buttonColor,
            borderRadius: BorderRadius.circular(8),
            child: InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: onTap,
              child: const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Text(
                  'Give Feedback',
                  style: TextStyle(
                    fontFamily: 'Sora',
                    color: Colors.white,
                    fontSize: 10,
                    height: 16.2 / 10,
                    letterSpacing: -0.16,
                    fontWeight: FontWeight.w600,
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

class _FeedbackDuePeriodCard extends StatelessWidget {
  const _FeedbackDuePeriodCard({required this.onGiveFeedback});

  final VoidCallback onGiveFeedback;

  @override
  Widget build(BuildContext context) => _GrowActionCard(
    background: const Color(0xFFFAF8F1),
    border: const Color(0xFFFFCC00),
    text: 'Feedback is due for this month',
    buttonColor: const Color(0xFFFF8D28),
    onTap: onGiveFeedback,
  );
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
    // Feedback goes to direct reports only. Whatever screen sent us here, a
    // person can never open a review of themselves, a peer or their manager.
    final target = widget.bloc.state.dashboard?.team
        .where((member) => member.id == widget.memberId)
        .firstOrNull;
    if (target == null || !target.reportsToViewer || target.isSelf) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && Navigator.of(context).canPop()) {
          Navigator.of(context).pop();
        }
      });
      return;
    }
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
