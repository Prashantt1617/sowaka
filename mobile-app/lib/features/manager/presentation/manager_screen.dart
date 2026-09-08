import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;

import '../../../routes/app_routes.dart';
import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import '../../auth/data/auth_session_store.dart';
import '../../connect/data/connect_models.dart';
import '../../connect/presentation/connect_feed_screen.dart';
import '../../manager_shell/presentation/app_home_header.dart';
import '../../notifications/presentation/notification_inbox_screen.dart';
import '../../games/presentation/web_game_screen.dart';
import '../../quick_actions/presentation/quick_actions_screen.dart';
import '../../../services/notification_service.dart';
import '../bloc/manager_bloc.dart';
import '../data/manager_models.dart';

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
  const ManagerScreen({super.key, required this.session});

  final AuthSession session;

  @override
  State<ManagerScreen> createState() => _ManagerScreenState();
}

class _ManagerScreenState extends State<ManagerScreen> {
  late final ManagerBloc _bloc;
  late final QuickActionsController _quickActionsController;
  final _connectComposerController = ConnectComposerController();
  bool _profileOpen = false;
  late AuthSession _session;
  StreamSubscription<Map<String, dynamic>>? _notificationSubscription;

  @override
  void initState() {
    super.initState();
    _session = widget.session;
    _quickActionsController = QuickActionsController()
      ..addListener(_refreshBackState);
    _bloc = ManagerBloc(session: widget.session)
      ..add(const LoadManagerDashboard());
    AppNotificationService.instance.attachSession(widget.session);
    _notificationSubscription = AppNotificationService.instance.opened.listen(
      _handleNotificationDestination,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      AppNotificationService.instance.consumePending();
    });
  }

  @override
  void dispose() {
    _quickActionsController
      ..removeListener(_refreshBackState)
      ..dispose();
    _bloc.dispose();
    _notificationSubscription?.cancel();
    super.dispose();
  }

  void _refreshBackState() {
    if (mounted) setState(() {});
  }

  ManagerTab get _defaultTab => widget.session.user.role == 'manager'
      ? ManagerTab.manage
      : ManagerTab.grow;

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
    } else if (state.view == ManagerView.leaveRequests) {
      _bloc.add(const CloseLeaveRequests());
    } else if (state.view == ManagerView.overtimeRequests) {
      _bloc.add(const CloseOvertimeRequests());
    } else if (state.view == ManagerView.attendanceCorrections) {
      _bloc.add(const CloseAttendanceCorrections());
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

  Future<void> _openNotifications(BuildContext context) async {
    await AppNotificationService.instance.requestPermission();
    if (!context.mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => NotificationInboxScreen(session: _session),
      ),
    );
  }

  void _handleNotificationDestination(Map<String, dynamic> data) {
    if (!mounted) return;
    final destination = '${data['destination'] ?? ''}';
    setState(() => _profileOpen = false);
    switch (destination) {
      case 'connect_post':
      case 'connect_comment':
      case 'employee_profile':
        _bloc.add(const ChangeManagerTab(ManagerTab.connect));
      case 'manage_leave':
        _bloc
          ..add(const ChangeManagerTab(ManagerTab.manage))
          ..add(const OpenLeaveRequests());
      case 'grow_feedback':
      case 'feedback_session':
        _bloc.add(const ChangeManagerTab(ManagerTab.grow));
      case 'nomination_submission':
      case 'nomination_review':
      case 'attendance_team':
      case 'attendance_report':
      case 'team_leave_calendar':
        _bloc.add(const ChangeManagerTab(ManagerTab.manage));
      case 'profile_leaves':
      case 'profile_recognition':
        setState(() => _profileOpen = true);
      default:
        _bloc.add(const ChangeManagerTab(ManagerTab.connect));
    }
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
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(message),
              behavior: SnackBarBehavior.floating,
              backgroundColor: MColors.ink,
            ),
          );
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
                    ],
                  ),
          ),
        );
      },
    );
  }
}
