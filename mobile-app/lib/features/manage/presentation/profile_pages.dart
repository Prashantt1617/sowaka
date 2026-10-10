part of '../../manager/presentation/manager_screen.dart';

// ── Which tabs a profile has, and who sees them ──────────────────────────────

/// The profile's tabs, in the order the design lays them out (node 3074:45389).
enum ProfileTab {
  request('Request'),
  attendance('Attendance'),
  workDetail('Work detail'),
  orgChart('Org chart'),
  grow('Grow'),
  rank('Rank'),
  counselor('Counselor'),
  documentation('Documentation');

  const ProfileTab(this.label);

  final String label;
}

/// What anyone in the company sees on a colleague's profile: their
/// attendance, who they are, where they sit, and where they stand on points.
/// Nothing about their requests, their reviews or their documents.
///
/// This is the one list to edit to widen or narrow the colleague view. The
/// server reads a colleague's month for anyone in the same company
/// (`getTeamMemberAttendance`).
const colleagueProfileTabs = [
  ProfileTab.attendance,
  ProfileTab.workDetail,
  ProfileTab.orgChart,
  ProfileTab.rank,
];

/// The tabs on someone else's profile.
///
/// Someone in the viewer's own reporting line — a report, or a report's
/// report — keeps everything their profile has always shown the viewer: their
/// day, their details, where they sit and their growth; the requests waiting on
/// the viewer when the viewer is the one who decides them; their documents when
/// HR has filed any. Rank is on every profile. Everyone else gets
/// [colleagueProfileTabs].
List<ProfileTab> memberProfileTabs({
  required bool inViewerChain,
  required bool viewerCanManage,
  required bool hasDocuments,
}) {
  if (!inViewerChain) return colleagueProfileTabs;
  return [
    if (viewerCanManage) ProfileTab.request,
    ProfileTab.attendance,
    ProfileTab.workDetail,
    ProfileTab.orgChart,
    ProfileTab.grow,
    ProfileTab.rank,
    if (hasDocuments) ProfileTab.documentation,
  ];
}

/// The tabs on one's own profile. Growth is reviewed by one's manager, so
/// someone with nobody above them has no Grow; the counsellor is there where
/// the company has Help.
List<ProfileTab> ownProfileTabs({
  required bool hasManager,
  required bool showsHelp,
}) => [
  ProfileTab.request,
  ProfileTab.attendance,
  ProfileTab.workDetail,
  ProfileTab.orgChart,
  if (hasManager) ProfileTab.grow,
  ProfileTab.rank,
  if (showsHelp) ProfileTab.counselor,
];

/// Another person's profile: a report's from the Team tab, or anyone's in the
/// company from wherever their name was tapped. Which tabs it carries is
/// [memberProfileTabs]'s to say.
class _TeamMemberProfilePage extends StatefulWidget {
  const _TeamMemberProfilePage({
    required this.member,
    required this.data,
    required this.bloc,
    required this.onNotifications,
    required this.onOpenComposer,
    this.canManage = true,
    this.publicOnly = false,
  });

  final TeamMember member;
  final ManagerDashboard data;
  final ManagerBloc bloc;
  final VoidCallback onNotifications;
  final VoidCallback onOpenComposer;

  /// Individual contributors view a teammate read-only: no request cards and
  /// no approve/decline actions.
  final bool canManage;

  /// Fetched as anyone in the company may see them rather than read from the
  /// viewer's own team, so only [colleagueProfileTabs] have anything to show.
  final bool publicOnly;

  @override
  State<_TeamMemberProfilePage> createState() => _TeamMemberProfilePageState();
}

class _TeamMemberProfilePageState extends State<_TeamMemberProfilePage> {
  int _tab = 0;

  late final ProfileApiService _profileService = ProfileApiService(
    session: widget.bloc.service.session,
  );

  @override
  Widget build(BuildContext context) {
    // Pushed as its own route, so it sits outside the shell's StreamBuilder
    // and would never hear the bloc. Without this the Approve and Decline
    // buttons here could not go busy: their spinner state is read once, at
    // build, and nothing would rebuild them.
    return StreamBuilder<ManagerState>(
      stream: widget.bloc.stream,
      initialData: widget.bloc.state,
      builder: (context, _) => _build(context),
    );
  }

  /// What is waiting on the viewer from this person, newest first: leave,
  /// overtime and corrections to decide, and their reimbursement claims, which
  /// HR decides from the dashboard and so only show here.
  List<(DateTime, Widget)> _openRequests(
    BuildContext context,
    ManagerDashboard data,
  ) {
    final bloc = widget.bloc;
    final member = widget.member;
    return <(DateTime date, Widget card)>[
      for (final leave in data.leaves.where(
        (item) =>
            item.userId == member.userId &&
            item.decision == LeaveDecision.pending,
      ))
        (
          leave.requestedOn,
          _ProfileRequestCard(
            iconAsset: _RequestIcons.leave,
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
            iconAsset: _RequestIcons.overtime,
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
            iconAsset: _RequestIcons.correction,
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
      for (final claim in data.reimbursements.where(
        (item) => item.userId == member.userId && item.status == 'Pending',
      ))
        (claim.createdAt, _ProfileClaimCard(claim: claim)),
    ]..sort((a, b) => b.$1.compareTo(a.$1));
  }

  Widget _build(BuildContext context) {
    final bloc = widget.bloc;
    final member = widget.member;
    // The dashboard as it stands now, not the copy handed over when this page
    // was pushed. Deciding a request updates the bloc, and reading the old
    // copy left the card sitting there, still pending, under its own toast.
    final data = bloc.state.dashboard ?? widget.data;
    final present = member.todayStatus == TeamPresenceStatus.present;
    final today = DateTime.now();
    final tabs = widget.publicOnly
        ? colleagueProfileTabs
        : memberProfileTabs(
            inViewerChain: member.inViewerChain,
            viewerCanManage: widget.canManage,
            hasDocuments: member.documents.isNotEmpty,
          );
    final selected = _tab.clamp(0, tabs.length - 1);
    // Whether they are in today is their attendance, so it shows only where
    // their Attendance tab does.
    final showsPresence = tabs.contains(ProfileTab.attendance);

    final content = switch (tabs[selected]) {
      ProfileTab.request => () {
        final open = _openRequests(context, data);
        return open.isEmpty
            ? const [_ProfileTabNote('No open requests.')]
            : [
                for (final (index, entry) in open.indexed) ...[
                  if (index > 0) const SizedBox(height: 12),
                  entry.$2,
                ],
              ];
      }(),
      // Today's card and the month below it, as on one's own profile — both
      // read by this member's shift, which the calendar fetches with the month.
      ProfileTab.attendance => [
        _MemberAttendanceCalendar(
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
            fullDayHours: shift.minFullDayHours,
          ),
        ),
      ],
      ProfileTab.workDetail => [
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
            iconAsset: 'assets/icons/profile_manager_head.svg',
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
      ProfileTab.orgChart => [
        if (member.orgChart.length > 1)
          _OrgChartCard(
            nodes: member.orgChart,
            selfName: member.name,
            selfPhotoUrl: member.photoUrl,
          )
        else
          const _ProfileTabNote('No reporting line to show yet.'),
      ],
      // No "your manager" line here: the reader usually is the manager, and
      // the month row's due card says what to do.
      ProfileTab.grow => [
        _ProfileGrowTab(data: data, bloc: bloc, memberId: member.id),
      ],
      ProfileTab.rank => [
        _RankHistory(service: _profileService, userId: member.userId),
      ],
      ProfileTab.documentation => [
        _DocumentationList(documents: member.documents),
      ],
      // Never on someone else's profile.
      ProfileTab.counselor => const <Widget>[],
    };

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
            onNotifications: widget.onNotifications,
            onQuickCreate: widget.onOpenComposer,
          ),
          _ProfilePageTopBar(
            // "Profile-Ananya" (node 3106:49189): whose page this is.
            title: 'Profile-${member.name.trim().split(' ').first}',
          ),
          Expanded(
            child: _ProfileScrollFrame(
              hero: _ProfileHero(
                avatar: _HeroAvatar(
                  dotColor: showsPresence
                      ? (present
                            ? const Color(0xFF00C950)
                            : const Color(0xFFDDDDDD))
                      : null,
                  child: _TeamMemberPhoto(member: member, size: 112),
                ),
                name: member.name,
                subtitle: [
                  member.designation,
                  member.team,
                ].where((value) => value.isNotEmpty).join(' • '),
                recognition: _nonEmpty(member.recognitionLabel),
              ),
              tabs: [for (final tab in tabs) tab.label],
              selected: selected,
              onChanged: (index) => setState(() => _tab = index),
              children: content,
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

/// A colleague who is not in the viewer's own team: fetched as anyone in the
/// company may see them, then shown as [_TeamMemberProfilePage] with only the
/// colleague tabs.
class _ColleagueProfileLoader extends StatefulWidget {
  const _ColleagueProfileLoader({
    required this.userId,
    required this.data,
    required this.bloc,
    required this.onNotifications,
    required this.onOpenComposer,
  });

  final String userId;
  final ManagerDashboard data;
  final ManagerBloc bloc;
  final VoidCallback onNotifications;
  final VoidCallback onOpenComposer;

  @override
  State<_ColleagueProfileLoader> createState() =>
      _ColleagueProfileLoaderState();
}

class _ColleagueProfileLoaderState extends State<_ColleagueProfileLoader> {
  late final _service = ProfileApiService(session: widget.bloc.service.session);
  late Future<TeamMember> _person = _service.fetchPerson(widget.userId);

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<TeamMember>(
      future: _person,
      builder: (context, snapshot) {
        if (snapshot.data case final person?) {
          return _TeamMemberProfilePage(
            member: person,
            data: widget.data,
            bloc: widget.bloc,
            onNotifications: widget.onNotifications,
            onOpenComposer: widget.onOpenComposer,
            canManage: false,
            publicOnly: true,
          );
        }
        final error = snapshot.error;
        return Scaffold(
          backgroundColor: const Color(0xFFF7F7F9),
          body: Column(
            children: [
              AppHomeHeader(
                profileAction: _ProfileAvatarAction(
                  initial: widget.data.managerInitial,
                  photoUrl: widget.data.managerPhotoUrl,
                  onTap: () => Navigator.of(context).pop(),
                  size: 30,
                  label: 'Close profile',
                ),
                onNotifications: widget.onNotifications,
                onQuickCreate: widget.onOpenComposer,
              ),
              const _ProfilePageTopBar(title: 'Profile'),
              Expanded(
                child: error == null
                    ? const Center(
                        child: CircularProgressIndicator(color: MColors.terra),
                      )
                    : ProfileEmptyNote(
                        error is ProfileApiException && error.statusCode == 404
                            ? 'This person is not in your company’s directory.'
                            : 'Could not open this profile.',
                        onRetry: () => setState(
                          () => _person = _service.fetchPerson(widget.userId),
                        ),
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
      },
    );
  }
}

/// The Rank tab: the point history (node 3605:30658), inset 16 inside the
/// tab as the design draws it.
class _RankHistory extends StatelessWidget {
  const _RankHistory({required this.service, this.userId});

  final ProfileApiService service;

  /// Whose profile it is. Null on one's own.
  final String? userId;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
    child: CreditHistoryView(service: service, userId: userId),
  );
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

/// 'Aug 5 2023', as the documents list dates a file (node 3106:50806).
String _documentDate(DateTime value) =>
    '${const ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][value.month - 1]} ${value.day} ${value.year}';

/// '₹1,24,500' or '₹124.50': Indian grouping, paise only when there are any.
String _rupees(double amount) {
  final whole = amount.truncate();
  final paise = ((amount - whole) * 100).round();
  final grouped = '$whole'.replaceAllMapped(
    RegExp(r'(\d)(?=(\d\d)+\d$)'),
    (match) => '${match[1]},',
  );
  return paise == 0
      ? '₹$grouped'
      : '₹$grouped.${paise.toString().padLeft(2, '0')}';
}

// ── The page around a profile ────────────────────────────────────────────────

/// The scrolling body every profile shares (nodes 3070:44930, 3074:45990):
/// who they are, the tabs pinned once they reach the top, and the open tab
/// under them.
class _ProfileScrollFrame extends StatelessWidget {
  const _ProfileScrollFrame({
    required this.hero,
    required this.tabs,
    required this.selected,
    required this.onChanged,
    required this.children,
    this.footer = const [],
  });

  final Widget hero;
  final List<String> tabs;
  final int selected;
  final ValueChanged<int> onChanged;
  final List<Widget> children;

  /// Below whichever tab is open — the log-out on one's own profile.
  final List<Widget> footer;

  /// Tablets get the phone's column rather than lines a foot long.
  static Widget _column(Widget child) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 620),
      child: child,
    ),
  );

  @override
  Widget build(BuildContext context) {
    return CustomScrollView(
      slivers: [
        SliverToBoxAdapter(
          child: _column(
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: hero,
            ),
          ),
        ),
        SliverPersistentHeader(
          pinned: true,
          delegate: _PinnedTabs(
            child: _column(
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: _ProfileTabs(
                  labels: tabs,
                  selected: selected,
                  onChanged: onChanged,
                ),
              ),
            ),
            selected: selected,
            tabs: tabs,
          ),
        ),
        SliverToBoxAdapter(
          child: _column(
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [...children, ...footer],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// The tab row, held at the top of the page once it scrolls there.
class _PinnedTabs extends SliverPersistentHeaderDelegate {
  _PinnedTabs({required this.child, required this.selected, required this.tabs});

  final Widget child;
  final int selected;
  final List<String> tabs;

  static const _height = 42.0;

  @override
  double get minExtent => _height;

  @override
  double get maxExtent => _height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlaps) =>
      ColoredBox(color: const Color(0xFFF7F7F9), child: child);

  @override
  bool shouldRebuild(_PinnedTabs old) =>
      old.selected != selected || old.tabs.join() != tabs.join();
}

/// Who the profile is (node 3106:50096): the photo, the name, the role. Someone
/// HR has recognised gets the warm card, the trophy and their title
/// (node 3106:49420).
class _ProfileHero extends StatelessWidget {
  const _ProfileHero({
    required this.avatar,
    required this.name,
    required this.subtitle,
    this.recognition,
    this.nameSize = 24,
    this.subtitleSize = 16,
  });

  final Widget avatar;
  final String name;
  final String subtitle;

  /// "Employee of the Month", as HR worded it.
  final String? recognition;
  final double nameSize;
  final double subtitleSize;

  @override
  Widget build(BuildContext context) {
    final recognition = this.recognition;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 16),
      decoration: BoxDecoration(
        color: recognition == null ? null : const Color(0xFFFFF8E6),
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        children: [
          Padding(padding: const EdgeInsets.only(bottom: 16), child: avatar),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text(
              name,
              textAlign: TextAlign.center,
              style: ProfileStyle.sora(
                nameSize,
                weight: FontWeight.w700,
                height: 32,
              ),
            ),
          ),
          if (subtitle.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
              child: Text(
                subtitle,
                textAlign: TextAlign.center,
                style: ProfileStyle.sora(
                  subtitleSize,
                  color: ProfileStyle.tertiary,
                  height: 24,
                ),
              ),
            ),
          if (recognition != null) ...[
            const _TrophyPulse(),
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: Container(
                height: 36,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF8E6),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: const Color(0xFFFFDF8D),
                    width: 1.114,
                  ),
                ),
                // As wide as its words, not the card.
                child: Center(
                  widthFactor: 1,
                  child: Text(
                    recognition,
                    style: ProfileStyle.sora(
                    14,
                    weight: FontWeight.w600,
                      color: const Color(0xFFFFBF1B),
                      height: 16.2,
                      spacing: -0.16,
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

/// The 112pt photo with its soft shadow and, where it is shown, the dot that
/// says whether they are in today. [overlay] sits on top — one's own camera.
class _HeroAvatar extends StatelessWidget {
  const _HeroAvatar({required this.child, this.dotColor, this.overlay});

  final Widget child;
  final Color? dotColor;
  final Widget? overlay;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 112,
      height: 112,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: 112,
            height: 112,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Color(0x1A000000),
                  blurRadius: 6,
                  spreadRadius: -1,
                  offset: Offset(0, 4),
                ),
                BoxShadow(
                  color: Color(0x1A000000),
                  blurRadius: 4,
                  spreadRadius: -2,
                  offset: Offset(0, 2),
                ),
              ],
            ),
            child: ClipOval(child: child),
          ),
          if (dotColor case final color?)
            Positioned(
              left: 88,
              top: 88,
              child: Container(
                width: 20,
                height: 20,
                decoration: BoxDecoration(
                  color: color,
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: const Color(0xFFF7F7F7),
                    width: 3.342,
                  ),
                ),
              ),
            ),
          ?overlay,
        ],
      ),
    );
  }
}

/// The recognition trophy (node 3106:49442): it lands from 120% to its own
/// size over the first 29% of every two seconds, ease-out, then holds — the
/// design's own keyframes. Still for anyone who has asked for less motion.
class _TrophyPulse extends StatefulWidget {
  const _TrophyPulse();

  @override
  State<_TrophyPulse> createState() => _TrophyPulseState();
}

class _TrophyPulseState extends State<_TrophyPulse>
    with SingleTickerProviderStateMixin {
  static const _landsBy = 0.29166;

  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 2),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final still = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (still) {
      _controller.stop();
      _controller.value = 1;
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final trophy = Image.asset(
      'assets/images/trophy.png',
      width: 151,
      height: 152,
      fit: BoxFit.cover,
    );
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final t = _controller.value;
        final scale = t >= _landsBy
            ? 1.0
            : 1.2 - 0.2 * Curves.easeOut.transform(t / _landsBy);
        return Transform.scale(scale: scale, child: child);
      },
      child: trophy,
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

  late final ProfileApiService _profileService = ProfileApiService(
    session: widget.bloc.service.session,
  );

  /// The Request tab: every request of theirs, newest first, or a line
  /// saying there are none.
  List<Widget> _requestTab(ManagerDashboard dashboard) {
    final entries = _myRequestEntries(dashboard);
    if (entries.isEmpty) {
      return const [_ProfileTabNote('No requests yet.')];
    }
    return [
      for (final (index, entry) in entries.indexed) ...[
        if (index > 0) const SizedBox(height: 12),
        entry.$2,
      ],
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

  /// One's own photo: tap it, or the camera, to change it.
  Widget _ownAvatar(AuthUser user) => _HeroAvatar(
    dotColor: const Color(0xFF00C950),
    overlay: Positioned(
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
            border: Border.all(color: const Color(0xFFF7F7F7), width: 2.5),
          ),
          // The same camera as the onboarding screen's "Add or take a photo".
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
    child: GestureDetector(
      onTap: _changePhoto,
      child: Stack(
        fit: StackFit.expand,
        children: [
          _ProfileAvatar(
            initials: _initials(user.name),
            profilePhotoUrl: user.profilePhotoUrl,
            size: 112,
          ),
          if (_uploadingPhoto)
            const ColoredBox(
              color: Color(0x66000000),
              child: Center(
                child: SizedBox(
                  width: 28,
                  height: 28,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    final dashboard = widget.dashboard;
    final bloc = widget.bloc;
    final onBack = widget.onBack;
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
    final worksHere = profileShowsWork(user.enabledTabs);
    final helpHere = profileShowsHelp(user.enabledTabs);
    final helpOnly = !worksHere && helpHere;
    final tabs = ownProfileTabs(
      hasManager: dashboard.hasManager,
      showsHelp: helpHere,
    );
    final selected = _tab.clamp(0, tabs.length - 1);
    final today = DateTime.now();
    final todayRecord = dashboard.attendance
        .where(
          (record) =>
              record.workDate.year == today.year &&
              record.workDate.month == today.month &&
              record.workDate.day == today.day,
        )
        .firstOrNull;

    final hero = _ProfileHero(
      avatar: _ownAvatar(user),
      name: user.name,
      subtitle: department.isNotEmpty
          ? '$designation • $department'
          : designation,
      recognition: _nonEmpty(user.recognition?.label),
      nameSize: helpOnly ? 26 : 24,
      subtitleSize: helpOnly ? 15 : 16,
    );
    // Room between whatever came last and the log-out, whichever kind of
    // profile this is; the privacy footnote under it is deliberately small —
    // a note about this person's own account, not company policy.
    final footer = [
      const SizedBox(height: 24),
      _LogoutButton(onPressed: widget.onLogout),
      const SizedBox(height: 14),
      _PrivacyAndDataRow(session: session),
      const SizedBox(height: 24),
    ];

    final content = switch (tabs[selected]) {
      ProfileTab.request => _requestTab(dashboard),
      ProfileTab.attendance => [
        _AttendanceCard(
          date: today,
          present: todayRecord?.punchIn != null,
          punchIn: todayRecord?.punchIn,
          punchOut: todayRecord?.punchOut,
          onPunch: dashboard.shift.punchesFromApp
              ? (type) => _startProfilePunch(context, bloc, dashboard, type)
              : null,
          autoPresent: dashboard.shift.markedPresentAutomatically,
          singlePunch: dashboard.shift.singlePunchDay,
          fullDayHours: dashboard.shift.minFullDayHours,
        ),
        const SizedBox(height: 33),
        _ProfileAttendanceCalendar(dashboard: dashboard),
      ],
      ProfileTab.workDetail => [
        _WorkDetailRow(
          iconAsset: 'assets/icons/profile_email.svg',
          label: 'Email',
          value: user.email,
        ),
        if (_nonEmpty(user.joiningDate) != null)
          _WorkDetailRow(
            iconAsset: 'assets/icons/profile_joining_date.svg',
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
            iconAsset: 'assets/icons/profile_manager_head.svg',
            label: 'Manager',
            value: name,
          ),
        if (_nonEmpty(user.employmentType) case final type?)
          _WorkDetailRow(
            iconAsset: 'assets/icons/work_employment_type.svg',
            label: 'Employment Type',
            value: _employmentTypeLabel(type),
          ),
        if (_nonEmpty(user.birthday) != null)
          _WorkDetailRow(
            icon: Icons.cake_outlined,
            label: 'Date of birth',
            value: _formatDate(user.birthday),
          ),
      ],
      ProfileTab.orgChart => [
        if (dashboard.myOrgChart.length > 1)
          _OrgChartCard(
            nodes: dashboard.myOrgChart,
            selfName: user.name,
            selfPhotoUrl: user.profilePhotoUrl,
          )
        else
          const _ProfileTabNote(
            'Your reporting line will show here once it is set up.',
          ),
      ],
      ProfileTab.grow => [
        _ProfileGrowTab(data: dashboard, bloc: bloc, managerName: reportsTo),
      ],
      ProfileTab.rank => [_RankHistory(service: _profileService)],
      ProfileTab.counselor => [HelpProfileSection(session: session)],
      // One's own documents are not loaded with the workspace.
      ProfileTab.documentation => const <Widget>[],
    };

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
            onNotifications: widget.onNotifications,
            onQuickCreate: widget.onOpenComposer,
          ),
          // Titled as the design draws it (node 3106:49749); a teammate's
          // page is "Profile-Ananya", so the two are never mistaken.
          _ProfilePageTopBar(onBack: onBack, title: 'My Profile'),
          Expanded(
            // The profile reads as tabs (node 3074:45990): one thing at a
            // time, rather than every section stacked. A company whose app is
            // Help alone has none of them — the counsellor is the profile.
            child: worksHere
                ? _ProfileScrollFrame(
                    hero: hero,
                    tabs: [for (final tab in tabs) tab.label],
                    selected: selected,
                    onChanged: (index) => setState(() => _tab = index),
                    footer: footer,
                    children: content,
                  )
                : SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 620),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            hero,
                            const SizedBox(height: 6),
                            if (helpHere) HelpProfileSection(session: session),
                            ...footer,
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

// ── Requests ─────────────────────────────────────────────────────────────────

/// The 3D icons the request cards wear (node 3070:45251).
abstract final class _RequestIcons {
  static const leave = 'assets/icons/team/calendar.png';
  static const correction = 'assets/icons/request_correction.png';
  static const reimbursement = 'assets/icons/request_reimbursement_money.png';

  /// Not drawn on the profile; the Quick Actions overtime card's hourglass,
  /// from the same family.
  static const overtime = 'assets/icons/action_card_overtime_hourglass.png';
}

/// One's own requests as cards, newest first: leave, overtime, corrections
/// and reimbursement claims, each with where it stands.
List<(DateTime date, Widget card)> _myRequestEntries(ManagerDashboard data) {
  return <(DateTime date, Widget card)>[
    for (final leave in data.myLeaves)
      (
        leave.requestedOn,
        _ProfileRequestCard(
          iconAsset: _RequestIcons.leave,
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
          iconAsset: _RequestIcons.overtime,
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
          iconAsset: _RequestIcons.correction,
          title: request.heading,
          rows: _attendanceRequestRows(request),
          decision: request.decision,
          readOnly: true,
        ),
      ),
    for (final claim in data.myReimbursements)
      (claim.createdAt, _ProfileClaimCard(claim: claim, showStatus: true)),
  ]..sort((a, b) => b.$1.compareTo(a.$1));
}

/// A request on a profile (node 3070:45251): its icon, what it is, the
/// details, and — when it is the viewer's to decide — Approve and Reject.
class _ProfileRequestCard extends StatelessWidget {
  const _ProfileRequestCard({
    required this.iconAsset,
    required this.title,
    required this.rows,
    required this.decision,
    this.onApprove,
    this.onReject,
    this.readOnly = false,
    this.approving = false,
    this.declining = false,
  });

  final String iconAsset;
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
        border: Border.all(color: ProfileStyle.line, width: 1.114),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _RequestIcon(asset: iconAsset),
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
                            style: ProfileStyle.sora(
                              16,
                              weight: FontWeight.w700,
                              height: 24,
                            ),
                          ),
                        ),
                        if (readOnly) _ProfileStatusPill(decision: decision),
                      ],
                    ),
                    for (final (index, row) in rows.indexed)
                      Padding(
                        padding: EdgeInsets.only(top: index == 0 ? 0 : 4),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              row.$1,
                              style: ProfileStyle.sora(
                                14,
                                color: ProfileStyle.tertiary,
                                height: 20,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                row.$2,
                                style: ProfileStyle.sora(14, height: 20),
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
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: _ProfileDecisionButton(
                    label: 'Approve',
                    background: busy ? MColors.line : const Color(0xFFDAFFD3),
                    foreground: busy
                        ? MColors.inkFaint
                        : const Color(0xFF34C759),
                    onTap: busy ? null : onApprove,
                    busy: approving,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _ProfileDecisionButton(
                    label: 'Reject',
                    background: busy ? MColors.line : const Color(0xFFFDDBDB),
                    foreground: busy
                        ? MColors.inkFaint
                        : const Color(0xFFFF383C),
                    onTap: busy ? null : onReject,
                    busy: declining,
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

/// A reimbursement claim (node 3070:45300): what it was for and how much.
/// HR decides these from the dashboard, so a manager only sees them here.
class _ProfileClaimCard extends StatelessWidget {
  const _ProfileClaimCard({required this.claim, this.showStatus = false});

  final ReimbursementClaim claim;

  /// On one's own profile, where it stands.
  final bool showStatus;

  @override
  Widget build(BuildContext context) {
    final what = _nonEmpty(claim.note) ?? claim.category;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: ProfileStyle.line),
      ),
      child: Row(
        children: [
          const _RequestIcon(asset: _RequestIcons.reimbursement),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Reimbursement',
                  style: ProfileStyle.sora(
                    14,
                    weight: FontWeight.w700,
                    height: 20,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '$what • ${_rupees(claim.amount)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: ProfileStyle.sora(
                    14,
                    color: ProfileStyle.tertiary,
                    height: 20,
                  ),
                ),
              ],
            ),
          ),
          if (showStatus) ...[
            const SizedBox(width: 8),
            _ProfileStatusPill(
              decision: switch (claim.status) {
                'Approved' || 'Paid' => LeaveDecision.approved,
                'Declined' => LeaveDecision.declined,
                _ => LeaveDecision.pending,
              },
            ),
          ],
        ],
      ),
    );
  }
}

/// The 40pt disc a request's 3D icon sits in.
class _RequestIcon extends StatelessWidget {
  const _RequestIcon({required this.asset});

  final String asset;

  @override
  Widget build(BuildContext context) => Container(
    width: 40,
    height: 40,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: const Color(0xFFF7F7F9),
      shape: BoxShape.circle,
      border: Border.all(color: ProfileStyle.line),
    ),
    // Drawn at 20pt; decoded near that rather than at the source's 1024.
    child: Image.asset(asset, width: 20, height: 20, cacheWidth: 80),
  );
}

/// Approve or Reject on a profile's request card (node 3070:45271): the
/// Team tab's own decision button — a tint behind coloured text, a spinner
/// while the decision is on its way — set in Sora on the design's soft shadow.
class _ProfileDecisionButton extends StatelessWidget {
  const _ProfileDecisionButton({
    required this.label,
    required this.background,
    required this.foreground,
    required this.onTap,
    this.busy = false,
  });

  final String label;
  final Color background;
  final Color foreground;
  final VoidCallback? onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        boxShadow: const [
          BoxShadow(color: Color(0x1A000000), blurRadius: 1.5, offset: Offset(0, 1)),
          BoxShadow(color: Color(0x1A000000), blurRadius: 1, offset: Offset(0, 1)),
        ],
      ),
      child: DefaultTextStyle.merge(
        style: const TextStyle(fontFamily: 'Sora', height: 20 / 14),
        child: _TeamDecisionButton(
          label: label,
          background: background,
          foreground: foreground,
          onTap: onTap,
          busy: busy,
          radius: 8,
        ),
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

// ── Attendance ───────────────────────────────────────────────────────────────

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

/// Today on the Attendance tab (node 3198:20917): the date and whether they
/// are in, how far into the working day they are, and the two punches.
class _AttendanceCard extends StatelessWidget {
  const _AttendanceCard({
    required this.date,
    required this.present,
    required this.punchIn,
    required this.punchOut,
    this.onPunch,
    this.autoPresent = false,
    this.singlePunch = false,
    this.fullDayHours = 0,
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

  /// The hours a full day asks for, from their shift; the bar fills against
  /// it. Zero leaves the bar out.
  final double fullDayHours;

  /// How much of a full day is behind them: from the punch-in to the
  /// punch-out, or to now while they are still in.
  double get _dayDone {
    final start = punchIn;
    if (start == null || fullDayHours <= 0) return 0;
    if (singlePunch) return 1;
    final end = punchOut ?? DateTime.now();
    final worked = end.difference(start).inMinutes / (fullDayHours * 60);
    return worked.clamp(0.0, 1.0);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(color: Color(0x0F000000), blurRadius: 6, offset: Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: const Color(0xFFF7F7F9),
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: ProfileStyle.line),
                ),
                child: SvgPicture.asset(
                  'assets/icons/attendance_card_small_icon.svg',
                  width: 16,
                  height: 16,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Attendance',
                  style: ProfileStyle.sora(
                    16,
                    weight: FontWeight.w600,
                    color: ProfileStyle.inkStrong,
                    height: 16.2,
                    spacing: -0.16,
                  ),
                ),
              ),
              SvgPicture.asset(
                'assets/icons/attendance_card_chevron.svg',
                width: 20,
                height: 20,
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: Text(
                  '${date.day.toString().padLeft(2, '0')} '
                  '${_monthName(date.month)}, ${_fullWeekday(date)}',
                  style: ProfileStyle.sora(
                    14,
                    weight: FontWeight.w600,
                    color: ProfileStyle.secondary,
                    height: 16.2,
                    spacing: -0.16,
                  ),
                ),
              ),
              _PresencePill(present: present || autoPresent),
            ],
          ),
          if (onPunch case final punch?) ...[
            if (punchIn == null) ...[
              const SizedBox(height: 16),
              SlideToPunch(
                label: 'Slide to Punch In',
                onComplete: () => punch('in'),
              ),
            ] else if (!singlePunch && punchOut == null) ...[
              const SizedBox(height: 16),
              SlideToPunch.filled(
                label: 'Slide to Punch Out',
                color: const Color(0xFF34A853),
                onComplete: () => punch('out'),
              ),
            ],
          ],
          if (autoPresent) ...[
            const SizedBox(height: 16),
            Text(
              'Present by default',
              style: ProfileStyle.sora(
                13,
                weight: FontWeight.w500,
                color: ProfileStyle.tertiary,
              ),
            ),
          ] else ...[
            if (fullDayHours > 0) ...[
              const SizedBox(height: 24),
              ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: SizedBox(
                  height: 6,
                  child: Stack(
                    children: [
                      const Positioned.fill(
                        child: ColoredBox(color: ProfileStyle.line),
                      ),
                      FractionallySizedBox(
                        widthFactor: _dayDone,
                        heightFactor: 1,
                        child: const DecoratedBox(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.all(Radius.circular(99)),
                            gradient: LinearGradient(
                              colors: [Color(0xFF0571A6), Color(0xFF0EA5E9)],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 6),
            ] else
              const SizedBox(height: 16),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  SizedBox(
                    width: 93,
                    child: _PunchTime(
                      label: 'PUNCH-IN',
                      value: _cardClock(punchIn),
                    ),
                  ),
                  Container(width: 1, height: 32, color: ProfileStyle.line),
                  SizedBox(
                    width: 93,
                    child: _PunchTime(
                      label: 'PUNCH-OUT',
                      // Not required where HR's shift asks for one punch.
                      value: singlePunch ? 'NR' : _cardClock(punchOut),
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

/// '09:42 AM', as today's card writes a punch (node 3198:20949); a dash
/// where there is none.
String _cardClock(DateTime? value) => value == null
    ? '—'
    : '${(value.hour % 12 == 0 ? 12 : value.hour % 12).toString().padLeft(2, '0')}:'
          '${value.minute.toString().padLeft(2, '0')} ${value.hour >= 12 ? 'PM' : 'AM'}';

class _PunchTime extends StatelessWidget {
  const _PunchTime({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: ProfileStyle.sora(
          10,
          weight: FontWeight.w500,
          color: ProfileStyle.tertiary,
          height: 15,
          spacing: 0.25,
        ),
      ),
      const SizedBox(height: 2),
      Text(
        value,
        style: ProfileStyle.sora(14, weight: FontWeight.w600, height: 20),
      ),
    ],
  );
}

/// "● Present", or "● Not Punched In" in grey.
class _PresencePill extends StatelessWidget {
  const _PresencePill({required this.present});

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
            style: ProfileStyle.sora(
              12,
              weight: FontWeight.w600,
              color: text,
              height: 16,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Where they sit, and their documents ──────────────────────────────────────

/// The reporting line (node 3106:49385): the chain above in a single column,
/// the person themselves highlighted with their photo, and whoever reports to
/// them hanging below. Anyone on it opens their own profile.
class _OrgChartCard extends StatelessWidget {
  const _OrgChartCard({
    required this.nodes,
    required this.selfName,
    this.selfPhotoUrl,
  });

  final List<OrgChartNode> nodes;
  final String selfName;
  final String? selfPhotoUrl;

  @override
  Widget build(BuildContext context) {
    final reports = nodes.where((item) => item.isReport).length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (index, node) in nodes.indexed) ...[
          if (index > 0 && !(node.isReport && !nodes[index - 1].isReport))
            // The line that joins one card to the next.
            Padding(
              padding: EdgeInsets.only(left: node.isReport ? 71 : 53),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Container(
                  width: 2,
                  height: 16,
                  color: const Color(0xFFDDDDDD),
                ),
              ),
            ),
          if (node.isReport && index > 0 && !nodes[index - 1].isReport)
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 16, 0, 8),
              child: Text(
                reports == 1 ? 'REPORTS TO THEM' : '$reports REPORT TO THEM',
                style: ProfileStyle.sora(
                  10,
                  weight: FontWeight.w700,
                  color: const Color(0xFF929292),
                  spacing: .5,
                ),
              ),
            ),
          Padding(
            padding: EdgeInsets.only(left: node.isReport ? 18 : 0),
            child: _OrgChartNodeCard(
              node: node,
              photo: node.isSelf
                  ? ProfilePhoto(name: selfName, url: selfPhotoUrl, size: 40)
                  : null,
              onTap: node.isSelf || node.userId.isEmpty
                  ? null
                  : () => openPersonProfile(node.userId),
            ),
          ),
        ],
      ],
    );
  }
}

class _OrgChartNodeCard extends StatelessWidget {
  const _OrgChartNodeCard({required this.node, this.photo, this.onTap});

  final OrgChartNode node;
  final Widget? photo;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final self = node.isSelf;
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(color: Color(0x1A000000), blurRadius: 3, offset: Offset(0, 1)),
          BoxShadow(color: Color(0x1A000000), blurRadius: 2, offset: Offset(0, 1)),
        ],
      ),
      child: Material(
        color: self ? const Color(0xFFF7F7FF) : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: self ? const Color(0xFFBEEDFF) : const Color(0xFFF7F7F9),
            width: 1.114,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(13.114),
            child: Row(
              children: [
                photo ??
                    Container(
                      width: 40,
                      height: 40,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: const Color(0xFFF7F7F7),
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: const Color(0xFFF7F7F9),
                          width: 1.114,
                        ),
                      ),
                      child: SvgPicture.asset(
                        'assets/icons/profile_org_person.svg',
                        width: 20,
                        height: 20,
                      ),
                    ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        node.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: ProfileStyle.sora(
                          14,
                          weight: FontWeight.w700,
                          height: 20,
                        ),
                      ),
                      if (node.designation.isNotEmpty)
                        Text(
                          node.designation.toUpperCase(),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: ProfileStyle.sora(
                            11,
                            weight: FontWeight.w600,
                            color: ProfileStyle.tertiary,
                            height: 16.5,
                            spacing: 0.55,
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The documents HR has filed for someone (node 3106:50795). A tap opens one.
class _DocumentationList extends StatelessWidget {
  const _DocumentationList({required this.documents});

  final List<EmployeeDocument> documents;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (index, document) in documents.indexed)
          Padding(
            padding: EdgeInsets.only(top: index == 0 ? 0 : 20),
            child: InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: document.url.isEmpty
                  ? null
                  : () async {
                      final opened = await openExternalLink(document.url);
                      if (!opened && context.mounted) {
                        showAppToast(context, 'Could not open this document.');
                      }
                    },
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(
                      color: Color(0xFFF7F7F7),
                      shape: BoxShape.circle,
                    ),
                    child: SvgPicture.asset(
                      'assets/icons/document_file.svg',
                      width: 20,
                      height: 20,
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          document.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: ProfileStyle.sora(
                            14,
                            weight: FontWeight.w500,
                            height: 20,
                          ),
                        ),
                        Row(
                          children: [
                            for (final (index, part) in [
                              if (document.uploadedAt case final uploaded?)
                                _documentDate(uploaded),
                              ?_nonEmpty(document.type),
                            ].indexed) ...[
                              if (index > 0) ...[
                                const SizedBox(width: 8),
                                // Drawn on a 24pt line from the top of the
                                // 20pt row, so it sits 2pt low; the row keeps
                                // its 20.
                                Transform.translate(
                                  offset: const Offset(0, 2),
                                  child: Text(
                                    '•',
                                    style: ProfileStyle.sora(
                                      14,
                                      color: ProfileStyle.tertiary,
                                      height: 20,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                              ],
                              Flexible(
                                child: Text(
                                  part,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: ProfileStyle.sora(
                                    12,
                                    color: ProfileStyle.tertiary,
                                    height: 20,
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// The bar under the app header: back, and whose profile this is
/// (node 3106:50080).
class _ProfilePageTopBar extends StatelessWidget {
  const _ProfilePageTopBar({this.onBack, this.title = 'Profile'});

  final VoidCallback? onBack;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      color: const Color(0xFFF7F7F9),
      child: Row(
        children: [
          DecoratedBox(
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Color(0x1A000000),
                  blurRadius: 1.5,
                  offset: Offset(0, 1),
                ),
                BoxShadow(
                  color: Color(0x1A000000),
                  blurRadius: 1,
                  offset: Offset(0, 1),
                ),
              ],
            ),
            child: Material(
              color: Colors.white,
              shape: const CircleBorder(
                side: BorderSide(color: ProfileStyle.line, width: 1.114),
              ),
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: onBack ?? () => Navigator.of(context).pop(),
                child: SizedBox(
                  width: 40,
                  height: 40,
                  child: Center(
                    child: SvgPicture.asset(
                      'assets/icons/chevron_back.svg',
                      width: 20,
                      height: 20,
                    ),
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: Text(
              title,
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: ProfileStyle.sora(16, weight: FontWeight.w700, height: 24),
            ),
          ),
          const SizedBox(width: 40),
        ],
      ),
    );
  }
}

/// The month on show with the arrows either side of it (node 3198:20958),
/// centred rather than pushed to the edges. A null [onNext] is a month that
/// has not happened yet: the arrow stays, faded.
class _MonthNav extends StatelessWidget {
  const _MonthNav({
    required this.label,
    required this.onPrevious,
    required this.onNext,
  });

  final String label;
  final VoidCallback onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    // The arrows are 32pt targets around a 20pt glyph, so 14 here is the
    // design's 20 between glyph and month.
    return SizedBox(
      height: 40,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AttendanceCalendarArrow(
            onPressed: onPrevious,
            asset: 'assets/icons/calendar_chevron_prev.svg',
          ),
          const SizedBox(width: 14),
          Text(
            label,
            style: ProfileStyle.sora(16, color: const Color(0xFF2A2A2A)),
          ),
          const SizedBox(width: 14),
          Opacity(
            opacity: onNext == null ? .3 : 1,
            child: AttendanceCalendarArrow(
              onPressed: onNext,
              asset: 'assets/icons/calendar_chevron_next.svg',
            ),
          ),
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
  Map<String, ServerDayStatus> _serverDays = const {};

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
        _serverDays = result.$5;
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
    serverDays: _serverDays,
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
        const SizedBox(height: 33),
        _MonthNav(
          label: '${_growMonthsLong[_month.month - 1]} ${_month.year}',
          onPrevious: () => _changeMonth(-1),
          onNext: canGoForward ? () => _changeMonth(1) : null,
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
          const SizedBox(height: 28),
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
  // Cached on disk by URL: a photo seen once is not fetched again, on this
  // scroll or the next launch. Keys are immutable, so the cache never goes stale.
  return CachedNetworkImageProvider(resolveMediaUrl(url));
}

class _TeamMemberPhoto extends StatelessWidget {
  const _TeamMemberPhoto({required this.member, required this.size});

  final TeamMember member;
  final double size;

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

  // The dot that says whether they are in is the profile's to draw
  // (`_HeroAvatar`), and only where their attendance is the viewer's to see.
  @override
  Widget build(BuildContext context) => _photo();
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
      padding: const EdgeInsets.only(bottom: 13),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: index == selected
                ? const Color(0xFF222222)
                : Colors.transparent,
            width: 1.114,
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
    serverDays: widget.dashboard.serverDays,
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
        _MonthNav(
          label: '${months[_month.month - 1]} ${_month.year}',
          onPrevious: () => setState(() {
            _month = DateTime(_month.year, _month.month - 1);
            _selected = null;
          }),
          onNext: canGoForward
              ? () => setState(() {
                  _month = DateTime(_month.year, _month.month + 1);
                  _selected = null;
                })
              : null,
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
        const SizedBox(height: 28),
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

class _ProfileColors {
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
    this.showTeamSections = false,
  });

  final String name;
  final String designation;
  final List<GrowthRecord> history;

  /// Opened from the Team tab's Feedback section: the My Team / Requests /
  /// Feedback bar stays above the page, as the design draws it (node
  /// 3165:59012), and the feedback form it opens keeps it too.
  final bool showTeamSections;

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
        builder: (_) => _FeedbackFormPage(
          bloc: widget.bloc,
          memberId: widget.memberId!,
          showTeamSections: widget.showTeamSections,
        ),
      ),
    );
    final dashboard = widget.bloc.state.dashboard ?? widget.data;

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
          if (widget.showTeamSections && widget.bloc.state.canManage)
            _PushedTeamSectionBar(bloc: widget.bloc, data: dashboard),
          if (!widget.embedded)
            _GrowthPageTopBar(
              name: widget.name,
              designation: widget.designation,
            ),
          Expanded(
            // Sora throughout, as the design sets this page (node 3165:59213).
            child: DefaultTextStyle.merge(
              style: const TextStyle(fontFamily: 'Sora'),
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
              guidance: param.description ?? '',
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
    this.managerName,
  });

  final String label;
  final double? score;
  final bool pending;

  /// "Feedback is given by your manager Tanvi", under the month, on the
  /// profile's Grow tab (node 3106:49749).
  final String? managerName;

  final bool missed;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    // The fill sits on the decoration with the shadow: on an unfilled box the
    // shadow showed through and greyed a row the design draws white (node
    // 3165:59260). The ink rides a transparent Material above it.
    return DecoratedBox(
      decoration: BoxDecoration(
        color: missed ? const Color(0xFFEBEBEB) : Colors.white,
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
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(19.114, 17.114, 19.114, 17.114),
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
    // Yellow wherever it shows: the new pills draw "Pending" the same on a
    // report's page as on one's own (node 3165:59267).
    if (pending)
      const _MonthChip(
        text: 'Pending',
        background: Color(0xFFFEFDDA),
        foreground: Color(0xFFFFCC00),
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
              scoreColor: const Color(0xFF222222),
              outOfColor: const Color(0xFF717171),
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
    // Node 3165:59202: this row sits flush against the white header above
    // it, 16 below it and 4 above the page; the back button is a 36px grey
    // disc, 10 from the name.
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      decoration: const BoxDecoration(color: Colors.white),
      child: Row(
        children: [
          Semantics(
            button: true,
            label: 'Back',
            child: Material(
              color: const Color(0xFFF7F7F9),
              shape: const CircleBorder(),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: onBack ?? () => Navigator.of(context).pop(),
                child: SizedBox(
                  width: 36,
                  height: 36,
                  child: Center(
                    child: SvgPicture.asset(
                      'assets/icons/chevron_left_small.svg',
                    ),
                  ),
                ),
              ),
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
  const _FeedbackFormPage({
    required this.bloc,
    required this.memberId,
    this.showTeamSections = false,
  });

  final ManagerBloc bloc;
  final int memberId;

  /// Opened from the Team tab: the section bar stays above the form (node
  /// 3165:59470).
  final bool showTeamSections;

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
                  showTeamSections: widget.showTeamSections,
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
