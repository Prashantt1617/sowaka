import 'dart:async';
import '../../manage/presentation/team_faces_layout.dart';
import 'dart:math' as math;
import 'dart:ui' as ui;


import '../../shared/image_crop_sheet.dart';
import '../../shared/image_source_sheet.dart';
import '../../shared/photo_viewer.dart';
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
import '../../connect/bloc/connect_bloc.dart';
import '../../connect/data/connect_models.dart';
import '../../connect/presentation/blocked_people_screen.dart';
import '../../connect/presentation/connect_feed_screen.dart';
import '../../manager_shell/presentation/app_home_header.dart';
import '../../manager_shell/presentation/app_bottom_nav.dart';
import '../../notifications/notification_badge.dart';
import '../../notifications/presentation/notification_inbox_screen.dart';
import '../../games/data/games_api_service.dart';
import '../../games/data/games_models.dart';
import '../../games/presentation/games_home.dart';
import '../../games/presentation/web_game_screen.dart';
import '../../games/presentation/web_games_home.dart';
import '../../policies/data/policies_api_service.dart';
import '../../attendance/presentation/punch_screen.dart';
import '../../attendance/presentation/punch_out_gate.dart';
import '../../attendance/presentation/slide_to_punch.dart';
import '../../quick_actions/presentation/quick_actions_screen.dart';
import '../../requests/presentation/request_summary.dart';
import '../../../services/notification_service.dart';
import '../bloc/manager_bloc.dart';
import '../../shared/startup_prefs.dart';
import '../data/dashboard_cache.dart';
import '../data/manager_api_service.dart';
import '../data/manager_models.dart';
import '../../shared/app_toast.dart';
import '../../support/presentation/support_desk_screen.dart';
import '../../support/support_launcher.dart';
import '../../shared/network_status.dart';
import '../../shared/offline_banner.dart';
import '../../help/data/help_api_service.dart';
import '../../help/presentation/help_profile_section.dart';
import '../../help/presentation/help_tab.dart';
import '../../care/presentation/care_tab.dart';
import '../../garden/presentation/garden_screen.dart';
import '../../garden/presentation/floating_tree.dart';
import '../../profile/profile.dart';
import '../../lifecycle/offboarding/offboarding.dart'
    show
        ManagerLeaverTab,
        OffboardingApi,
        ManagerResignationRequests,
        OffboardingRoutes,
        OffboardingStore,
        OwnResignationTab,
        ResignEntryRow,
        openOffboardingDestination;
import '../../face_id/face_check_screen.dart' show FaceCheckOutcome;
import '../../face_id/face_setup_screen.dart';
import '../../lifecycle/onboarding/data/onboarding_api.dart';
import '../../lifecycle/onboarding/data/onboarding_models.dart';
import '../../lifecycle/onboarding/onboarding_launcher.dart';
import '../../lifecycle/onboarding/presentation/manager/joiners_tab.dart';
import '../../lifecycle/onboarding/presentation/manager/new_joiners_tab.dart';
import '../../lifecycle/onboarding/presentation/manager/team_kit.dart';

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
    this.onOpenGameChallenge,
  });

  final AuthSession session;

  /// Supplied only by tests: what a tapped challenge notification opens,
  /// instead of the game's own screen.
  final void Function(String gameKey, String challengeId)? onOpenGameChallenge;

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
  /// The tab one's own profile opens on, and a count of openings so a profile
  /// opened afresh (from the feed, say, while it was open) starts on it again.
  ProfileTab? _profileOpenOn = ProfileTab.workDetail;
  int _profileOpenings = 0;
  /// Whether the punch screen has already been offered this session, so
  /// closing it does not bring it straight back on the next rebuild.
  bool _punchPrompted = false;
  late AuthSession _session;
  StreamSubscription<Map<String, dynamic>>? _notificationSubscription;
  StreamSubscription<Map<String, dynamic>>? _receivedSubscription;
  StreamSubscription<ManagerTab>? _tabWatch;
  AppLifecycleListener? _lifecycle;

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
    // A launch with no connection has nothing to show; the moment the
    // connection is back the dashboard loads itself.
    NetworkStatus.offline.addListener(_onNetworkChanged);
    AppNotificationService.instance.attachSession(widget.session);
    // The punch screen opens by itself once a working day, on the first
    // launch of the day, for people on a geotagged shift. A sign-in or
    // onboarding has just taken screens of their time, so the launch that
    // follows one holds it — and only that launch: the day's showing is not
    // spent, so the next launch opens on it.
    if (widget.justOnboarded) {
      // The sign-in before onboarding set a hold; this launch is the one it
      // covers, so it is taken here rather than set again — otherwise the
      // next launch would still be held.
      unawaited(const StartupPrefs().takePunchPromptHold());
    } else {
      unawaited(
        const StartupPrefs().takePunchPromptHold().then((held) async {
          final shown = held || await const StartupPrefs().punchPromptShown();
          if (mounted) setState(() => _punchPromptUsed = shown);
        }),
      );
    }
    _notificationSubscription = AppNotificationService.instance.opened.listen(
      _handleNotificationDestination,
    );
    // A notification about a request means the request list on screen is
    // already out of date: read it now rather than on the next poll. Only a
    // request's notification names its type; a post's or a support reply's
    // reads nothing.
    _receivedSubscription = AppNotificationService.instance.received.listen(
      (data) {
        NotificationBadge.arrived();
        final type = '${data['type'] ?? ''}';
        if (type.isNotEmpty) _bloc.refreshRequestsNow(type);
        // A resignation, HR accepting, a handover: the screens about leaving
        // read again, so what the push says is already there when it is opened.
        if (OffboardingStore.isOffboardingPush(data)) {
          unawaited(OffboardingStore.of(_session).refresh());
        }
      },
    );
    // The Team and Action tabs stay built; coming back to one reads what may
    // have moved on since (a report resigning, HR accepting).
    _tabWatch = _bloc.stream.map((state) => state.tab).distinct().listen((tab) {
      if (tab == ManagerTab.manage || tab == ManagerTab.quick) {
        unawaited(OffboardingStore.of(_session).revalidate());
      }
    });
    // The bell's dot: anything unread since the inbox was last opened, read
    // now and again whenever the app comes back to the front.
    unawaited(NotificationBadge.refresh(_session));
    // The minute's poll of leaves runs only while the app is in front.
    _lifecycle = AppLifecycleListener(
      onPause: () => _bloc.setInBackground(true),
      onResume: () {
        _bloc.setInBackground(false);
        unawaited(NotificationBadge.refresh(_session));
        unawaited(LifecycleMeStore.instance.refresh(HttpOnboardingApi(session: _session)));
        // Back to the front: what HR or the manager did meanwhile shows.
        final offboarding = OffboardingStore.of(_session);
        if (offboarding.loaded) unawaited(offboarding.refresh());
      },
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // The tablet rail lives above the navigator, so it reads the bloc from
      // here rather than from a context it cannot see. Published after the
      // frame: assigning during initState rebuilds an ancestor mid-build, and
      // the rail silently never appears.
      activeManagerBloc.value = _bloc;
      AppNotificationService.instance.consumePending();
    });
    // A name tapped anywhere — a post's author, a commenter — opens their
    // profile through here.
    registerPersonProfileOpener(_openTeamMember);
    // "Ask HR", "contact support": anywhere, a ticket at the Support Desk.
    registerSupportTicketOpener(_raiseSupportTicket);
    // The inbox wears the shell's header, this avatar included.
    registerInboxProfileAction(_inboxProfileAction);
    // A profile's Post tab shares this feed's directory, composer and list.
    _profileFeed = _connectComposerController;
    // The lifecycle's onboarding screens open over the shell from anywhere;
    // what `/lifecycle/me` says decides whether they show at all.
    registerOnboardingShell(_onboardingShell);
    // Teams › Joiners' "Reach out": a game, a post on Connect.
    TeamReachOutDoors.openComposer = (context) {
      Navigator.of(context).popUntil((route) => route.isFirst);
      _openConnectComposer();
    };
    TeamReachOutDoors.openGames = (context) {
      if (!visibleTabs(_session.user.enabledTabs).contains(ManagerTab.games)) return;
      Navigator.of(context).popUntil((route) => route.isFirst);
      _bloc.add(const ChangeManagerTab(ManagerTab.games));
    };
    unawaited(LifecycleMeStore.instance.refresh(HttpOnboardingApi(session: widget.session)));
  }

  @override
  void dispose() {
    if (identical(_profileFeed, _connectComposerController)) _profileFeed = null;
    unregisterPersonProfileOpener(_openTeamMember);
    unregisterSupportTicketOpener(_raiseSupportTicket);
    unregisterInboxProfileAction(_inboxProfileAction);
    unregisterOnboardingShell(_onboardingShell);
    NetworkStatus.offline.removeListener(_onNetworkChanged);
    activeManagerBloc.value = null;
    _quickActionsController
      ..removeListener(_refreshBackState)
      ..dispose();
    if (_ownsBloc) _bloc.dispose();
    _notificationSubscription?.cancel();
    _receivedSubscription?.cancel();
    _tabWatch?.cancel();
    _lifecycle?.dispose();
    // The feed's bloc, kept by the controller for the session, goes with it.
    _connectComposerController.dispose();
    super.dispose();
  }

  void _onNetworkChanged() {
    if (!mounted || NetworkStatus.offline.value) return;
    // Nothing loaded, or only the device's copy: the live one now.
    if (_bloc.state.dashboard == null || _bloc.state.fromCache) {
      _bloc.add(const LoadManagerDashboard());
    }
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
          // The confirmation's "View attendance" lands on the calendar.
          onViewAttendance: () =>
              _bloc.add(const ChangeManagerTab(ManagerTab.quick)),
        ),
        fullscreenDialog: true,
      ),
    );
    if (mounted) showPunchToast(context, outcome);
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
        state.teamSection != TeamSection.myTeam) {
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

  /// One's own profile: from the avatar, Actions and anywhere else on Work
  /// detail; [on] puts another tab first (Post from the feed, Org chart from
  /// the Team tab or an org chart — [openingTabFor]).
  void _openProfile({ProfileTab? on = ProfileTab.workDetail}) => setState(() {
    _profileOpen = true;
    _profileOpenOn = on;
    _profileOpenings++;
  });

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

  /// The avatar over the inbox: it leaves the inbox for the profile.
  Widget _inboxProfileAction(VoidCallback closeInbox) {
    final dashboard = _bloc.state.dashboard;
    return _ProfileAvatarAction(
      initial: dashboard?.managerInitial ?? '',
      photoUrl: dashboard?.managerPhotoUrl,
      onTap: () {
        closeInbox();
        _openProfile();
      },
      size: 30,
    );
  }

  /// The onboarding screens' view of the app around them: the header, the
  /// tabs, the face setup, a new photo and the feed.
  OnboardingShell _onboardingShell() {
    final dashboard = _bloc.state.dashboard;
    final user = _session.user;
    return OnboardingShell(
      api: HttpOnboardingApi(session: _session),
      profileAction: _ProfileAvatarAction(
        initial: dashboard?.managerInitial ?? '',
        photoUrl: dashboard?.managerPhotoUrl,
        onTap: _openProfile,
        size: 30,
      ),
      onNotifications: () => _openNotifications(context),
      tabs: visibleTabs(_session.user.enabledTabs),
      selectedTab: _bloc.state.tab,
      onSelectTab: (tab) {
        Navigator.of(context).popUntil((route) => route.isFirst);
        _bloc.add(ChangeManagerTab(tab, fresh: true));
      },
      registerFace: (context) async {
        await Navigator.of(context).push<FaceCheckOutcome>(
          MaterialPageRoute(builder: (_) => FaceSetupScreen(api: _bloc.api, onboarding: true)),
        );
        return FaceCheckOutcome.enrolledThisRun;
      },
      changePhoto: _changeOnboardingPhoto,
      openPost: (postId) {
        _bloc.add(const ChangeManagerTab(ManagerTab.connect));
        WidgetsBinding.instance.addPostFrameCallback(
          (_) => _connectComposerController.openPost(postId),
        );
      },
      // Final designs: a joiner task's page in the app (Do in Sowaka, Review,
      // a profile section, the first punch-in), opened over the onboarding
      // screen it was tapped on.
      openAppScreen: _openAppScreenOver,
      viewerName: user.name,
      viewerDesignation: user.designation,
      viewerDepartment: user.department,
      viewerPhotoUrl: user.profilePhotoUrl,
    );
  }

  /// A page of the app opened from an onboarding task, OVER the screen it
  /// was tapped on: no pop back to the tabs and no tab switch, so Back
  /// returns to that screen exactly as it was (the same list, scroll and
  /// look-ahead stage). Completes when the page closes, so the task reads
  /// its state again.
  Future<void> _openAppScreenOver(BuildContext from, String screen) {
    final navigator = Navigator.of(from);
    void toTabs() => navigator.popUntil((route) => route.isFirst);
    // Your profile: the Work detail tab, or the Grow tab for "Review your KPIs".
    if (screen == 'profile' || screen == 'kpis') {
      return navigator.push<void>(
        MaterialPageRoute(
          builder: (route) => StreamBuilder<ManagerState>(
            stream: _bloc.stream,
            initialData: _bloc.state,
            builder: (context, snapshot) {
              final dashboard = (snapshot.data ?? _bloc.state).dashboard;
              if (dashboard == null) return const SizedBox.shrink();
              // The page the shell draws the profile on (it sits over the tabs there).
              return Scaffold(
                backgroundColor: const Color(0xFFF7F7F9),
                body: OfflineAware(
                  child: _ProfileScreen(
                key: const ValueKey('onboarding-profile'),
                openOn: screen == 'kpis' ? ProfileTab.grow : ProfileTab.workDetail,
                session: _session,
                dashboard: dashboard,
                bloc: _bloc,
                onBack: () => Navigator.of(route).maybePop(),
                onLogout: _logout,
                onOpenComposer: () {
                  toTabs();
                  _openConnectComposer();
                },
                onNotifications: () => _openNotifications(route),
                onProfilePhotoUpdated: _updateProfilePhoto,
                onOpenDocuments: () {
                  toTabs();
                  _bloc.add(const ChangeManagerTab(ManagerTab.quick));
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    if (mounted) _quickActionsController.openPayroll();
                  });
                },
                  ),
                ),
              );
            },
          ),
        ),
      );
    }
    final entry = switch (screen) {
      'leave' || 'leave_balance' => QuickActionsEntry.leave,
      'overtime' => QuickActionsEntry.overtime,
      'shift' => QuickActionsEntry.calendar,
      'tax' || 'payroll' || 'payroll_policy' => QuickActionsEntry.payroll,
      'punch' => QuickActionsEntry.punchTour,
      _ => null,
    };
    if (entry == null) return Future.value();
    return navigator.push<void>(
      MaterialPageRoute(
        builder: (_) => _ActionsPageOver(
          bloc: _bloc,
          entry: entry,
          onNotifications: (context) => _openNotifications(context),
          onOpenProfile: () {
            toTabs();
            _openProfile();
          },
          onOpenComposer: () {
            toTabs();
            _openConnectComposer();
          },
        ),
      ),
    );
  }

  /// A new profile photo from the intro post: chosen, cropped square and
  /// saved as the profile's photo, as the profile's own camera does.
  Future<String?> _changeOnboardingPhoto(BuildContext context) async {
    final file = await pickImageFrom(context);
    if (file == null || !context.mounted) return null;
    final cropped = await cropImageFile(
      context,
      path: file.path,
      title: 'Crop your photo',
      initial: CropShape.square,
      allowShapeChange: false,
      maxEdge: 1024,
    );
    if (cropped == null) return null;
    try {
      final photoUrl = await _bloc.service.updateProfilePhoto(
        path: cropped,
        filename: file.name.replaceAll(RegExp(r'\.[^.]+$'), '.png'),
      );
      _bloc.setManagerPhoto(photoUrl);
      await _updateProfilePhoto(photoUrl);
      return photoUrl;
    } catch (error) {
      if (context.mounted) {
        showAppToast(
          context,
          error is ManagerApiException ? error.message : 'Could not update your photo. Try again.',
        );
      }
      return null;
    }
  }

  /// Takes a tapped notification to the thing it is about, not just to a
  /// tab: the post, the request queue, the person, the review.
  void _handleNotificationDestination(Map<String, dynamic> data) {
    if (!mounted) return;
    final destination = '${data['destination'] ?? ''}';
    final postId = '${data['postId'] ?? ''}';
    final employeeUserId = '${data['employeeUserId'] ?? ''}';
    setState(() => _profileOpen = false);
    Navigator.of(context).popUntil((route) => route.isFirst);
    // Onboarding's own (meetings, starter tasks, shared notes, nudges, a
    // joiner for their manager): their screens open over the shell.
    if (openOnboardingDestination(context, data)) return;
    // Offboarding's (a resignation, HR accepting, the handover, the exit
    // interview): the tab or page it is about, once the store has read it.
    if (openOffboardingDestination(data, OffboardingStore.of(_session), _offboardingRoutes)) {
      return;
    }
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
        // Over the Team tab, and only for someone in the viewer's own team:
        // a push about anyone else lands on the Team tab alone.
        _bloc.add(const ChangeManagerTab(ManagerTab.manage));
        if (_teamMember(employeeUserId) != null) {
          _openTeamMember(employeeUserId, ProfileEntry.elsewhere);
        }
      // The requests queue, under either name the server has used.
      case 'manage_leave':
      case 'requests_queue':
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
      // A reply, a resolution or an identity notice on one of the person's
      // own Support desk tickets: the desk opens with the ticket on top.
      case 'support_ticket':
        _bloc.add(const ChangeManagerTab(ManagerTab.quick));
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _openSupportTicket('${data['ticketId'] ?? ''}');
        });
      // A colleague's game challenge (received, answered, or its result):
      // the Games tab, with the game open on that challenge.
      case 'game_challenge':
        if (visibleTabs(_session.user.enabledTabs).contains(ManagerTab.games)) {
          _bloc.add(const ChangeManagerTab(ManagerTab.games));
        }
        final gameKey = '${data['gameKey'] ?? ''}';
        final challengeId = '${data['challengeId'] ?? ''}';
        if (gameKey.isNotEmpty) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) _openGameChallenge(gameKey, challengeId);
          });
        }
      case '':
        _openRequestNotification(data);
      default:
        _bloc.add(const ChangeManagerTab(ManagerTab.connect));
    }
  }

  /// Where an offboarding push opens, in this shell.
  late final OffboardingRoutes _offboardingRoutes = OffboardingRoutes(
    openRequests: (resignationId) {
      if (!mounted) return;
      OffboardingStore.of(_session).focusResignation(resignationId);
      _openTeamRequests();
    },
    openOwnResignation: () {
      if (mounted) _openProfile(on: ProfileTab.resignation);
    },
    openOffboarding: ({section}) {
      if (!mounted) return;
      _bloc.add(const ChangeManagerTab(ManagerTab.quick));
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _quickActionsController.openOffboarding(section: section);
      });
    },
    openLeaver: (userId) {
      if (!mounted) return;
      _bloc.add(const ChangeManagerTab(ManagerTab.manage));
      if (_teamMember(userId) != null) {
        _openTeamMember(userId, ProfileEntry.elsewhere, on: ProfileTab.resignation);
      }
    },
  );

  void _openGameChallenge(String gameKey, String challengeId) {
    final hook = widget.onOpenGameChallenge;
    if (hook != null) {
      hook(gameKey, challengeId);
      return;
    }
    unawaited(
      openGameChallenge(
        context,
        _session,
        gameKey: gameKey,
        challengeId: challengeId,
      ).then((opened) {
        if (!opened && mounted) {
          showAppToast(context, 'That game is not available any more.');
        }
      }),
    );
  }

  /// "Ask HR" anywhere in the app: the Support Desk, straight on a new ticket.
  void _raiseSupportTicket({String? about}) => _openSupportTicket('', raise: true, about: about);

  void _openSupportTicket(String ticketId, {bool raise = false, String? about}) {
    final dashboard = _bloc.state.dashboard;
    if (!mounted) return;
    openSupportDesk(
      context,
      session: _session,
      ticketId: ticketId.isEmpty ? null : ticketId,
      raise: raise,
      about: about,
      onNotifications: () => _openNotifications(context),
      profileAction: _ProfileAvatarAction(
        initial: dashboard?.managerInitial ?? '',
        photoUrl: dashboard?.managerPhotoUrl,
        onTap: _openProfile,
        size: 30,
      ),
      // The shell's tabs under the desk; a pick comes back to the shell
      // first, once anything unsent is let go.
      tabs: visibleTabs(_session.user.enabledTabs),
      selectedTab: _bloc.state.tab,
      onSelectTab: (tab) {
        Navigator.of(context).popUntil((route) => route.isFirst);
        _bloc.add(ChangeManagerTab(tab, fresh: true));
      },
    );
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

  /// Opens someone's profile by userId, over whatever is on screen: one's own
  /// profile when it is the viewer; a teammate's from the loaded team, with
  /// everything [memberProfileTabs] gives a report; anyone else in the company
  /// fetched as the colleague view ([colleagueProfileTabs]). False only when
  /// there is nobody to open. Registered as [openPersonProfile], so other
  /// libraries reach it without importing the shell.
  bool _openTeamMember(String userId, ProfileEntry from, {ProfileTab? on}) {
    final dashboard = _bloc.state.dashboard;
    if (!mounted || userId.isEmpty || dashboard == null) return false;
    final openOn = on ?? openingTabFor(from);
    if (userId == _session.user.id) {
      Navigator.of(context).popUntil((route) => route.isFirst);
      _openProfile(on: openOn);
      return true;
    }
    final member = _teamMember(userId);
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => member != null
            ? _TeamMemberProfilePage(
                member: member,
                data: dashboard,
                bloc: _bloc,
                onNotifications: () => _openNotifications(context),
                onOpenComposer: _connectComposerController.openComposer,
                canManage: _bloc.state.canManage,
                openOn: openOn,
              )
            : _ColleagueProfileLoader(
                userId: userId,
                data: dashboard,
                bloc: _bloc,
                onNotifications: () => _openNotifications(context),
                onOpenComposer: _connectComposerController.openComposer,
                openOn: openOn,
              ),
      ),
    );
    return true;
  }

  /// Signs out. The profile has already asked ([confirmLogOut]).
  Future<void> _logout() async {
    // Every copy on this phone goes with them — dashboard and feed — and a
    // load still in flight cannot put one back.
    await DashboardCache.clearAll();
    HttpOnboardingApi.forgetKept();
    OffboardingApi.forgetKept();
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
    forgetGames();
    // What the web pages kept on the phone (the Games home, Odd One Out's
    // local storage, keyed by name rather than by person): cleared, so the
    // next account does not inherit it. Bounded, like the rest.
    await clearGamesWebData().timeout(const Duration(seconds: 3), onTimeout: () {});
    forgetPolicies();
    LifecycleMeStore.instance.clear();
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

        // No connection and nothing loaded: the banner over a skeleton of
        // the home, as the feed apps do it.
        if (state.dashboard == null && NetworkStatus.offline.value) {
          return const OfflineSkeletonScreen();
        }

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
          // Said, with a way to try again: it used to be the words alone,
          // and the only way out was closing the app.
          return Scaffold(
            backgroundColor: const Color(0xFFF7F7F9),
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      state.error ?? 'Could not load manager view',
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    TextButton(
                      key: const ValueKey('manager-load-retry'),
                      onPressed: () => _bloc.add(const LoadManagerDashboard()),
                      child: const Text('Try again'),
                    ),
                  ],
                ),
              ),
            ),
          );
        }

        // Someone whose day starts with a punch from the app opens onto that
        // screen (node 2412:86630) rather than having to find it: the punch is
        // the first thing they came here to do, and a day that never got one
        // is a day they have to correct later.
        final dashboard = state.dashboard!;
        // Never on the device's copy: whether today has a punch is the
        // server's to say.
        if (!state.fromCache && !_punchPrompted && !_punchPromptUsed && _shouldOfferPunch(dashboard)) {
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
            body: OfflineAware(
              // The profile opens over the tabs, which stay built beneath it
              // (hidden, their videos paused): swapping the tabs out for the
              // profile built every one of them again on the way back, with a
              // new feed, socket and directory read each time.
              child: Stack(
                fit: StackFit.expand,
                children: [
                  Offstage(
                    offstage: _profileOpen,
                    child: TickerMode(
                      enabled: !_profileOpen,
                      child: Stack(
                        children: [
                          Column(
                            children: [
                              Expanded(
                                // Read from a context below the offline banner,
                                // which has already taken the status-bar inset
                                // while it shows; the screen's own context would
                                // put that inset back under the banner.
                                child: Builder(
                                  builder: (context) => MediaQuery.removePadding(
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
                  ),
                  if (_profileOpen)
                    _ProfileScreen(
                      key: ValueKey(_profileOpenings),
                      openOn: _profileOpenOn,
                      session: _session,
                      dashboard: state.dashboard!,
                      bloc: _bloc,
                      onBack: _closeProfile,
                      onLogout: _logout,
                      onOpenComposer: _connectComposerController.openComposer,
                      onNotifications: () => _openNotifications(context),
                      onProfilePhotoUpdated: _updateProfilePhoto,
                      // "Save your documents" on the Resignation tab (R2b):
                      // Action › Payroll, where the payslips and Form 16 are.
                      onOpenDocuments: () {
                        _closeProfile();
                        _bloc.add(const ChangeManagerTab(ManagerTab.quick));
                        WidgetsBinding.instance.addPostFrameCallback((_) {
                          if (mounted) _quickActionsController.openPayroll();
                        });
                      },
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// One page of the Actions tab (leave, overtime, the attendance calendar,
/// payroll, or its home with Day 1's punch spotlight) opened over an
/// onboarding screen: the same screen the tab shows, on its own route with
/// the app's tabs under it, so Back returns to where it was opened from.
class _ActionsPageOver extends StatefulWidget {
  const _ActionsPageOver({
    required this.bloc,
    required this.entry,
    required this.onNotifications,
    required this.onOpenProfile,
    required this.onOpenComposer,
  });

  final ManagerBloc bloc;
  final QuickActionsEntry entry;
  final void Function(BuildContext context) onNotifications;
  final VoidCallback onOpenProfile;
  final VoidCallback onOpenComposer;

  @override
  State<_ActionsPageOver> createState() => _ActionsPageOverState();
}

class _ActionsPageOverState extends State<_ActionsPageOver> {
  final _controller = QuickActionsController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bloc = widget.bloc;
    return StreamBuilder<ManagerState>(
      stream: bloc.stream,
      initialData: bloc.state,
      builder: (context, snapshot) {
        final state = snapshot.data ?? bloc.state;
        final dashboard = state.dashboard;
        if (dashboard == null) return const SizedBox.shrink();
        final keyboardOpen = MediaQuery.viewInsetsOf(context).bottom > 0;
        return ListenableBuilder(
          listenable: _controller,
          builder: (context, child) => PopScope(
            // Inside the page (a leave form, a payslip) Back is the page's
            // own; from its first screen it closes this route.
            canPop: !_controller.canGoBack,
            onPopInvokedWithResult: (didPop, result) {
              if (!didPop) _controller.handleBack();
            },
            child: child!,
          ),
          child: Scaffold(
            key: ValueKey('actions-page-over-${widget.entry.name}'),
            backgroundColor: const Color(0xFFF7F7F9),
            body: OfflineAware(
              child: Column(
                children: [
                  Expanded(
                    child: Builder(
                      builder: (context) => MediaQuery.removePadding(
                        context: context,
                        removeBottom: true,
                        child: QuickActionsScreen(
                          bloc: bloc,
                          dashboard: dashboard,
                          controller: _controller,
                          entry: widget.entry,
                          onExit: () => Navigator.of(this.context).pop(),
                          onNotifications: () => widget.onNotifications(this.context),
                          onOpenComposer: widget.onOpenComposer,
                          profileAction: _ProfileAvatarAction(
                            initial: dashboard.managerInitial,
                            photoUrl: dashboard.managerPhotoUrl,
                            onTap: widget.onOpenProfile,
                            size: 30,
                          ),
                        ),
                      ),
                    ),
                  ),
                  if (!keyboardOpen)
                    _BottomTabs(
                      state: state,
                      bloc: bloc,
                      onBeforeChange: () => Navigator.of(this.context).popUntil((route) => route.isFirst),
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
