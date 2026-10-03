import 'dart:async';
import '../../manage/presentation/team_faces_layout.dart';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:ui' as ui;


import '../../shared/image_crop_sheet.dart';
import '../../shared/image_source_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;

import '../../../routes/app_routes.dart';
import '../../../services/api_config.dart';
import '../../manager_shell/presentation/tablet_shell.dart';
import '../../../services/linkified_text.dart';
import '../../auth/data/auth_api_service.dart';
import '../../auth/data/auth_models.dart';
import '../../auth/data/auth_session_store.dart';
import '../../connect/data/connect_models.dart';
import '../../connect/presentation/blocked_people_screen.dart';
import '../../connect/presentation/connect_feed_screen.dart';
import '../../manager_shell/presentation/app_home_header.dart';
import '../../notifications/presentation/notification_inbox_screen.dart';
import '../../games/presentation/web_game_screen.dart';
import '../../attendance/presentation/punch_screen.dart';
import '../../attendance/presentation/slide_to_punch.dart';
import '../../quick_actions/presentation/quick_actions_screen.dart';
import '../../requests/presentation/request_summary.dart';
import '../../../services/notification_service.dart';
import '../bloc/manager_bloc.dart';
import '../../shared/startup_prefs.dart';
import '../data/manager_api_service.dart';
import '../data/manager_models.dart';
import '../../shared/app_toast.dart';
import '../../manager_shell/presentation/tab_specs.dart';
import '../../help/data/help_api_service.dart';
import '../../help/presentation/help_profile_section.dart';
import '../../help/presentation/help_tab.dart';
import '../../care/presentation/care_tab.dart';
import '../../garden/presentation/garden_screen.dart';
import '../../garden/presentation/floating_tree.dart';

part '../../connect/presentation/connect_tab.dart';
part '../../games/presentation/games_tab.dart';
part '../../grow/presentation/grow_tab.dart';
part '../../manage/presentation/apply_leave_sheet.dart';
part '../../manage/presentation/feedback_components.dart';
part '../../manage/presentation/manage_requests.dart';
part '../../manage/presentation/manage_tab.dart';
part '../../manage/presentation/profile_pages.dart';
part '../../manage/presentation/team_home.dart';
part '../../manager_shell/presentation/manager_navigation.dart';
part '../../manager_shell/presentation/manager_shared.dart';
part '../../manager_shell/presentation/manager_tab_content.dart';

const int _maxLeaveApplyDays = 30;

class ManagerScreen extends StatefulWidget {
  const ManagerScreen({
    super.key,
    required this.session,
    this.justOnboarded = false,
    this.bloc,
  });

  final AuthSession session;

  /// Supplied only by tests, which drive the screen from a fake service
  /// rather than the network. Null everywhere else, and the screen makes
  /// its own.
  final ManagerBloc? bloc;

  /// Straight out of onboarding: the punch screen waits until next launch.
  final bool justOnboarded;

  @override
  State<ManagerScreen> createState() => _ManagerScreenState();
}

class _ManagerScreenState extends State<ManagerScreen> {
  late final ManagerBloc _bloc;

  /// False when a test supplied the bloc: it owns it, and disposing it here
  /// would close a stream the test still reads.
  late final bool _ownsBloc;
  late final QuickActionsController _quickActionsController;
  final _connectComposerController = ConnectComposerController();
  bool _profileOpen = false;
  /// Whether the punch screen has already been offered this session, so
  /// closing it does not bring it straight back on the next rebuild.
  bool _punchPrompted = false;
  late AuthSession _session;
  StreamSubscription<Map<String, dynamic>>? _notificationSubscription;

  @override
  void initState() {
    super.initState();
    _session = widget.session;
    _quickActionsController = QuickActionsController()
      ..addListener(_refreshBackState);
    final supplied = widget.bloc;
    _ownsBloc = supplied == null;
    _bloc = supplied ?? ManagerBloc(session: widget.session);
    if (_ownsBloc) _bloc.add(const LoadManagerDashboard());
    AppNotificationService.instance.attachSession(widget.session);
    // Onboarding has just taken two screens of their time; the punch screen
    // holds until the next launch. It opens by itself once a working day, on
    // the first launch of the day, for people on a geotagged shift.
    if (widget.justOnboarded) {
      unawaited(const StartupPrefs().markPunchPromptShown());
    } else {
      unawaited(
        const StartupPrefs().punchPromptShown().then((shown) {
          if (mounted) setState(() => _punchPromptUsed = shown);
        }),
      );
    }
    _notificationSubscription = AppNotificationService.instance.opened.listen(
      _handleNotificationDestination,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // The tablet rail lives above the navigator, so it reads the bloc from
      // here rather than from a context it cannot see. Published after the
      // frame: assigning during initState rebuilds an ancestor mid-build, and
      // the rail silently never appears.
      activeManagerBloc.value = _bloc;
      AppNotificationService.instance.consumePending();
    });
  }

  @override
  void dispose() {
    activeManagerBloc.value = null;
    _quickActionsController
      ..removeListener(_refreshBackState)
      ..dispose();
    if (_ownsBloc) _bloc.dispose();
    _notificationSubscription?.cancel();
    super.dispose();
  }

  void _refreshBackState() {
    if (mounted) setState(() {});
  }

  /// Whether the punch screen has already had today's showing on this device.
  ///
  /// It gets one a day: the first launch of a working day. Read once here so
  /// the build method never waits on storage.
  bool _punchPromptUsed = true;

  /// Whether to open the day on the punch screen.
  ///
  /// Only for people on a geotagged shift, only before the day's first punch,
  /// and never on a day nobody was due to work — the week-offs HR set on the
  /// shift and the company holidays. Opening a week-off on "Ready to start
  /// your day?" is the app misreading its own policy.
  bool _shouldOfferPunch(ManagerDashboard dashboard) {
    if (!dashboard.shift.punchIsGeofenced) return false;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    if (dashboard.shift.isWeekOff(today)) return false;
    if (dashboard.holidays.any(
      (holiday) =>
          holiday.date.year == today.year &&
          holiday.date.month == today.month &&
          holiday.date.day == today.day,
    )) {
      return false;
    }
    final record = dashboard.attendance
        .where(
          (entry) =>
              entry.workDate.year == today.year &&
              entry.workDate.month == today.month &&
              entry.workDate.day == today.day,
        )
        .firstOrNull;
    return record?.punchIn == null;
  }

  /// Whether a correction for today is already with the manager.
  bool _requestedToday(ManagerDashboard dashboard) {
    final now = DateTime.now();
    return dashboard.regularizations.any(
      (request) =>
          request.workDate.year == now.year &&
          request.workDate.month == now.month &&
          request.workDate.day == now.day &&
          request.decision == LeaveDecision.pending,
    );
  }

  Future<void> _offerPunch(ManagerDashboard dashboard) async {
    if (!mounted) return;
    final outcome = await Navigator.of(context).push<PunchOutcome>(
      MaterialPageRoute(
        builder: (_) => PunchScreen(
          api: _bloc.api,
          type: 'in',
          onRecorded: (record) => _bloc.add(PunchRecorded(record)),
          // A request already in for today: they can still come in and punch,
          // but they are not asked to raise a second one for the same day.
          alreadyRequestedToday: _requestedToday(dashboard),
          geofenced: dashboard.shift.punchIsGeofenced,
          // Not coming in at all is the other answer to this screen.
          onRequestWfh: () {
            _bloc.add(const ChangeManagerTab(ManagerTab.quick));
            _quickActionsController.openLeave();
          },
        ),
        fullscreenDialog: true,
      ),
    );
    if ((outcome?.punched == true || outcome?.requested == true) && mounted) {
      await _bloc.add(LoadAttendanceMonth(DateTime.now()));
    }
  }

  /// Where the app opens, and where back returns to.
  ///
  /// Connect, unless the punch screen has had today's showing and the day
  /// still has no punch — then Quick Actions, where the punch card is.
  ManagerTab get _defaultTab {
    final dashboard = _bloc.state.dashboard;
    if (_punchPromptUsed && dashboard != null && _shouldOfferPunch(dashboard)) {
      return ManagerTab.quick;
    }
    return ManagerTab.connect;
  }

  bool _hasBackTarget(ManagerState state) {
    return _profileOpen ||
        state.awardPickerKey != null ||
        state.applyLeaveOpen ||
        state.view != ManagerView.home ||
        (state.tab == ManagerTab.quick && _quickActionsController.canGoBack) ||
        state.tab != _defaultTab;
  }

  void _handleBack(ManagerState state) {
    if (_profileOpen) {
      setState(() => _profileOpen = false);
    } else if (state.awardPickerKey != null) {
      _bloc.add(const CloseAwardPicker());
    } else if (state.applyLeaveOpen) {
      _bloc.add(const CloseApplyLeave());
    } else if (state.view == ManagerView.feedbackList) {
      _bloc.add(const CloseFeedbackList());
    } else if (state.tab == ManagerTab.manage &&
        state.teamSection == TeamSection.requests) {
      _bloc.add(const ShowTeamSection(TeamSection.myTeam));
    } else if (state.tab == ManagerTab.quick &&
        _quickActionsController.canGoBack) {
      _quickActionsController.handleBack();
    } else if (state.tab != _defaultTab) {
      _bloc.add(ChangeManagerTab(_defaultTab));
    }
  }

  /// The composer lives inside the Connect feed, so the tab has to be showing
  /// before it can open — switch first, then open once that frame is built.
  void _openConnectComposer() {
    if (_bloc.state.tab != ManagerTab.connect) {
      _bloc.add(const ChangeManagerTab(ManagerTab.connect));
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _connectComposerController.openComposer();
      });
      return;
    }
    _connectComposerController.openComposer();
  }

  void _openProfile() => setState(() => _profileOpen = true);

  void _closeProfile() => setState(() => _profileOpen = false);

  Future<void> _updateProfilePhoto(String photoUrl) async {
    setState(() {
      _session = _session.copyWith(
        user: _session.user.copyWith(profilePhotoUrl: photoUrl),
      );
    });
    await AuthSessionStore().save(_session);
  }

  Future<void> _openNotifications(BuildContext context) =>
      openNotificationInbox(context, _session);

  /// Takes a tapped notification to the thing it is about, not just to a
  /// tab: the post, the request queue, the person, the review.
  void _handleNotificationDestination(Map<String, dynamic> data) {
    if (!mounted) return;
    final destination = '${data['destination'] ?? ''}';
    final postId = '${data['postId'] ?? ''}';
    final employeeUserId = '${data['employeeUserId'] ?? ''}';
    setState(() => _profileOpen = false);
    Navigator.of(context).popUntil((route) => route.isFirst);
    switch (destination) {
      case 'connect_post':
      case 'connect_comment':
        _bloc.add(const ChangeManagerTab(ManagerTab.connect));
        if (postId.isNotEmpty) {
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => _connectComposerController.openPost(
              postId,
              comments: destination == 'connect_comment',
            ),
          );
        }
      case 'employee_profile':
        if (!_openTeamMember(employeeUserId)) {
          _bloc.add(const ChangeManagerTab(ManagerTab.manage));
        }
      case 'manage_leave':
        _openTeamRequests();
      case 'manage_attendance':
      case 'attendance_team':
      case 'attendance_report':
      case 'team_leave_calendar':
      case 'nomination_submission':
      case 'nomination_review':
        _bloc.add(const ChangeManagerTab(ManagerTab.manage));
      case 'grow_feedback':
      case 'feedback_session':
        _bloc.add(const ChangeManagerTab(ManagerTab.grow));
        final member = _teamMember(employeeUserId);
        if (member != null && _bloc.state.canManage) {
          _bloc.add(OpenFeedbackRecord(member.id));
        }
      case 'profile_leaves':
      case 'profile_recognition':
        setState(() => _profileOpen = true);
      case '':
        _openRequestNotification(data);
      default:
        _bloc.add(const ChangeManagerTab(ManagerTab.connect));
    }
  }

  /// Requests carry no destination, only what kind they are and whose side
  /// the reader is on: `inbox` is the manager's queue, `mine` the person's own.
  void _openRequestNotification(Map<String, dynamic> data) {
    final type = '${data['type'] ?? ''}';
    final inbox = '${data['view'] ?? ''}' == 'inbox' && _bloc.state.canManage;
    if (inbox) {
      _openTeamRequests();
      return;
    }
    _bloc.add(const ChangeManagerTab(ManagerTab.quick));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      switch (type) {
        case 'leave':
          _quickActionsController.openLeave();
        case 'overtime':
          _quickActionsController.openOvertime();
        case 'attendance':
          _quickActionsController.openCalendar();
      }
    });
  }

  /// The manager's request queue: the Requests half of the Team tab, where
  /// leave, overtime and corrections all sit together.
  void _openTeamRequests() {
    _bloc
      ..add(const ChangeManagerTab(ManagerTab.manage))
      ..add(const ShowTeamSection(TeamSection.requests));
  }

  TeamMember? _teamMember(String userId) {
    if (userId.isEmpty) return null;
    final dashboard = _bloc.state.dashboard;
    if (dashboard == null) return null;
    return [...dashboard.team, ...dashboard.recognitionCandidates]
        .where((member) => member.userId == userId)
        .firstOrNull;
  }

  /// Opens a teammate's profile page over the Manage tab. False when the
  /// person is not someone this viewer can see.
  bool _openTeamMember(String userId) {
    final member = _teamMember(userId);
    final dashboard = _bloc.state.dashboard;
    if (member == null || dashboard == null) return false;
    _bloc.add(const ChangeManagerTab(ManagerTab.manage));
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => _TeamMemberProfilePage(
          member: member,
          data: dashboard,
          bloc: _bloc,
          onNotifications: () => _openNotifications(context),
          onOpenComposer: _connectComposerController.openComposer,
          canManage: _bloc.state.canManage,
        ),
      ),
    );
    return true;
  }

  Future<void> _logout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Log out?'),
        content: const Text('You will need to sign in again to continue.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Log out'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    // The server forgets the device, then the session, before the phone
    // does, so pushes for this account stop landing here and the token dies
    // now. The device first: unregistering needs the token that logout
    // revokes. Bounded, and never in the way: offline, the phone still
    // signs out.
    final token = _session.token;
    await AppNotificationService.instance
        .detachSession()
        .timeout(const Duration(seconds: 4), onTimeout: () {});
    await AuthApiService()
        .logout(token)
        .timeout(const Duration(seconds: 4))
        .catchError((_) {});
    // Nothing of theirs is left behind for whoever signs in next.
    forgetHelpHome();
    await AuthSessionStore().clear();
    if (!mounted) return;
    Navigator.of(
      context,
    ).pushNamedAndRemoveUntil(AppRoutes.login, (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<ManagerState>(
      stream: _bloc.stream,
      initialData: _bloc.state,
      builder: (context, snapshot) {
        final state = snapshot.data ?? _bloc.state;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          final message = state.message;
          if (!mounted || message == null) return;
          showAppToast(context, message);
          _bloc.add(const ClearManagerMessage());
        });

        if (state.status == ManagerLoadStatus.loading ||
            state.status == ManagerLoadStatus.initial) {
          return const Scaffold(
            backgroundColor: const Color(0xFFF7F7F9),
            body: Center(
              child: CircularProgressIndicator(color: MColors.terra),
            ),
          );
        }

        if (state.status == ManagerLoadStatus.failure ||
            state.dashboard == null) {
          return Scaffold(
            backgroundColor: const Color(0xFFF7F7F9),
            body: Center(
              child: Text(state.error ?? 'Could not load manager view'),
            ),
          );
        }

        // Someone whose day starts with a punch from the app opens onto that
        // screen (node 2412:86630) rather than having to find it: the punch is
        // the first thing they came here to do, and a day that never got one
        // is a day they have to correct later.
        final dashboard = state.dashboard!;
        if (!_punchPrompted && !_punchPromptUsed && _shouldOfferPunch(dashboard)) {
          _punchPrompted = true;
          unawaited(const StartupPrefs().markPunchPromptShown());
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => _offerPunch(dashboard),
          );
        }

        final keyboardOpen = MediaQuery.viewInsetsOf(context).bottom > 0;

        return PopScope(
          canPop: !_hasBackTarget(state),
          onPopInvokedWithResult: (didPop, result) {
            if (!didPop) _handleBack(state);
          },
          child: Scaffold(
            backgroundColor: const Color(0xFFF7F7F9),
            body: _profileOpen
                ? _ProfileScreen(
                    session: _session,
                    dashboard: state.dashboard!,
                    bloc: _bloc,
                    onBack: _closeProfile,
                    onLogout: _logout,
                    onOpenComposer: _connectComposerController.openComposer,
                    onNotifications: () => _openNotifications(context),
                    onProfilePhotoUpdated: _updateProfilePhoto,
                  )
                : Stack(
                    children: [
                      Column(
                        children: [
                          Expanded(
                            child: MediaQuery.removePadding(
                              context: context,
                              removeBottom: true,
                              child: _TabContent(
                                session: _session,
                                state: state,
                                bloc: _bloc,
                                quickActionsController: _quickActionsController,
                                connectComposerController:
                                    _connectComposerController,
                                onOpenProfile: _openProfile,
                              ),
                            ),
                          ),
                          if (!keyboardOpen)
                            _BottomTabs(
                              state: state,
                              bloc: _bloc,
                              onOpenComposer: _openConnectComposer,
                            ),
                        ],
                      ),
                      if (state.applyLeaveOpen)
                        _ApplyLeaveSheet(state: state, bloc: _bloc),
                      // Their own tree, over every tab, when the garden is on.
                      if (!keyboardOpen)
                        Positioned.fill(
                          child: FloatingTree(session: _session, refreshKey: state.tab),
                        ),
                    ],
                  ),
          ),
        );
      },
    );
  }
}
