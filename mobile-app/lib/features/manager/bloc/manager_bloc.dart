import 'dart:async';
import 'dart:typed_data';

import '../../auth/data/auth_models.dart';
import '../data/manager_api_service.dart';
import '../data/requests_socket_service.dart';
import '../data/manager_models.dart';

enum ManagerLoadStatus { initial, loading, ready, failure }

enum FeedbackFilter { all, pending, done }

class ManagerState {
  const ManagerState({
    required this.status,
    this.fromCache = false,
    required this.tab,
    required this.view,
    required this.canManage,
    this.teamSection = TeamSection.myTeam,
    this.dashboard,
    this.selectedMemberId,
    this.recordParams = const <FeedbackParam>[],
    this.recordExtra = '',
    this.feedbackFilter = FeedbackFilter.all,
    this.searchQuery = '',
    this.showGiven = false,
    this.awardPickerKey,
    this.applyLeaveOpen = false,
    this.applyLeaveSent = false,
    this.message,
    this.error,
  });

  factory ManagerState.initial({
    required bool canManage,
    ManagerTab firstTab = ManagerTab.connect,
  }) {
    return ManagerState(
      status: ManagerLoadStatus.initial,
      // Everyone lands on Connect: the feed is what the app is opened for, and
      // a manager's own tabs are one tap away.
      tab: firstTab,
      view: ManagerView.home,
      canManage: canManage,
    );
  }

  /// The dashboard on show is the device's copy from last time, not yet
  /// confirmed by the server. Nothing time-sensitive is decided on it.
  final bool fromCache;

  final ManagerLoadStatus status;
  final ManagerTab tab;
  final ManagerView view;
  final bool canManage;
  final TeamSection teamSection;
  final ManagerDashboard? dashboard;
  final int? selectedMemberId;
  final List<FeedbackParam> recordParams;
  final String recordExtra;
  final FeedbackFilter feedbackFilter;
  final String searchQuery;
  final bool showGiven;
  final String? awardPickerKey;
  final bool applyLeaveOpen;
  final bool applyLeaveSent;
  final String? message;
  final String? error;

  TeamMember? get selectedMember {
    final data = dashboard;
    final id = selectedMemberId;
    if (data == null || id == null) return null;
    for (final member in data.team) {
      if (member.id == id) return member;
    }
    return null;
  }

  ManagerState copyWith({
    ManagerLoadStatus? status,
    bool? fromCache,
    ManagerTab? tab,
    ManagerView? view,
    bool? canManage,
    TeamSection? teamSection,
    ManagerDashboard? dashboard,
    int? selectedMemberId,
    bool clearSelectedMember = false,
    List<FeedbackParam>? recordParams,
    String? recordExtra,
    FeedbackFilter? feedbackFilter,
    String? searchQuery,
    bool? showGiven,
    String? awardPickerKey,
    bool clearAwardPicker = false,
    bool? applyLeaveOpen,
    bool? applyLeaveSent,
    String? message,
    bool clearMessage = false,
    String? error,
  }) {
    return ManagerState(
      status: status ?? this.status,
      fromCache: fromCache ?? this.fromCache,
      tab: tab ?? this.tab,
      view: view ?? this.view,
      canManage: canManage ?? this.canManage,
      teamSection: teamSection ?? this.teamSection,
      dashboard: dashboard ?? this.dashboard,
      selectedMemberId: clearSelectedMember
          ? null
          : selectedMemberId ?? this.selectedMemberId,
      recordParams: recordParams ?? this.recordParams,
      recordExtra: recordExtra ?? this.recordExtra,
      feedbackFilter: feedbackFilter ?? this.feedbackFilter,
      searchQuery: searchQuery ?? this.searchQuery,
      showGiven: showGiven ?? this.showGiven,
      awardPickerKey: clearAwardPicker
          ? null
          : awardPickerKey ?? this.awardPickerKey,
      applyLeaveOpen: applyLeaveOpen ?? this.applyLeaveOpen,
      applyLeaveSent: applyLeaveSent ?? this.applyLeaveSent,
      message: clearMessage ? null : message ?? this.message,
      error: error ?? this.error,
    );
  }
}

sealed class ManagerEvent {
  const ManagerEvent();
}

class LoadManagerDashboard extends ManagerEvent {
  const LoadManagerDashboard();
}

class ChangeManagerTab extends ManagerEvent {
  const ChangeManagerTab(this.tab);
  final ManagerTab tab;
}

class OpenFeedbackList extends ManagerEvent {
  const OpenFeedbackList();
}

class CloseFeedbackList extends ManagerEvent {
  const CloseFeedbackList();
}

/// Switches the Team tab between the team list and the request queue.
class ShowTeamSection extends ManagerEvent {
  const ShowTeamSection(this.section);
  final TeamSection section;
}

class OpenFeedbackRecord extends ManagerEvent {
  const OpenFeedbackRecord(this.memberId);
  final int memberId;
}

class CloseFeedbackRecord extends ManagerEvent {
  const CloseFeedbackRecord();
}

class ChangeFeedbackFilter extends ManagerEvent {
  const ChangeFeedbackFilter(this.filter);
  final FeedbackFilter filter;
}

class ChangeFeedbackSearch extends ManagerEvent {
  const ChangeFeedbackSearch(this.query);
  final String query;
}

class ToggleGivenFeedback extends ManagerEvent {
  const ToggleGivenFeedback();
}

class UpdateFeedbackScore extends ManagerEvent {
  const UpdateFeedbackScore(this.index, this.score);
  final int index;
  final double score;
}

class UpdateFeedbackNote extends ManagerEvent {
  const UpdateFeedbackNote(this.index, this.note);
  final int index;
  final String note;
}

class UpdateFeedbackExtra extends ManagerEvent {
  const UpdateFeedbackExtra(this.extra);
  final String extra;
}

class SaveFeedback extends ManagerEvent {
  const SaveFeedback();
}

class SendFeedback extends ManagerEvent {
  const SendFeedback();
}

class DecideLeave extends ManagerEvent {
  const DecideLeave(this.leaveId, this.decision, {this.managerNote = ''});
  final String leaveId;
  final LeaveDecision decision;
  final String managerNote;
}

class DecideOvertime extends ManagerEvent {
  const DecideOvertime(this.overtimeId, this.decision, {this.managerNote = ''});
  final String overtimeId;
  final LeaveDecision decision;
  final String managerNote;
}

class OpenAwardPicker extends ManagerEvent {
  const OpenAwardPicker(this.awardKey);
  final String awardKey;
}

class CloseAwardPicker extends ManagerEvent {
  const CloseAwardPicker();
}

class NominateAward extends ManagerEvent {
  const NominateAward(this.awardKey, this.memberId, this.reason);
  final String awardKey;
  final int memberId;
  final String reason;
}

class OpenApplyLeave extends ManagerEvent {
  const OpenApplyLeave();
}

class CloseApplyLeave extends ManagerEvent {
  const CloseApplyLeave();
}

class SubmitLeaveApplication extends ManagerEvent {
  const SubmitLeaveApplication({
    required this.type,
    required this.startDate,
    required this.endDate,
    required this.reason,
    this.halfDay = false,
    this.documentName,
    this.documentBytes,
  });

  final String type;
  final DateTime startDate;
  final DateTime endDate;
  final String reason;
  final bool halfDay;

  /// Optional supporting document — a medical note, a booking.
  final String? documentName;
  final Uint8List? documentBytes;
}

class SubmitOvertimeApplication extends ManagerEvent {
  const SubmitOvertimeApplication({
    required this.workDate,
    required this.startTime,
    required this.endTime,
    required this.duration,
    required this.note,
  });
  final DateTime workDate;
  final DateTime startTime;
  final DateTime endTime;

  /// 'half_day' or 'full_day', as picked on the form.
  final String duration;
  final String note;
}

class SubmitReimbursementApplication extends ManagerEvent {
  const SubmitReimbursementApplication({
    required this.expenseDate,
    required this.amount,
    required this.category,
    required this.receiptName,
    required this.receiptBytes,
    required this.note,
  });
  final DateTime expenseDate;
  final String amount;
  final String category;
  final String receiptName;
  final Uint8List? receiptBytes;
  final String note;
}

class LoadAttendanceMonth extends ManagerEvent {
  const LoadAttendanceMonth(this.month);
  final DateTime month;
}

/// A punch the punch screen already sent, folded into the dashboard.
///
/// Without this the record exists on the server and nowhere on the phone, so
/// the home card shows no time and offers the slider again.
class PunchRecorded extends ManagerEvent {
  const PunchRecorded(this.record);

  final AttendanceRecord record;
}

class RecordPunch extends ManagerEvent {
  const RecordPunch(this.type);
  final String type;
}

class SubmitAttendanceRegularization extends ManagerEvent {
  const SubmitAttendanceRegularization({
    required this.workDate,
    required this.dayType,
    required this.note,
  });
  final DateTime workDate;

  /// What the day should be recorded as: full_day, half_day, wfh or leave.
  final String dayType;
  final String note;
}

class DecideAttendanceRegularization extends ManagerEvent {
  const DecideAttendanceRegularization(
    this.id,
    this.decision, {
    this.managerNote = '',
  });
  final String id;
  final LeaveDecision decision;
  final String managerNote;
}

class ClearManagerMessage extends ManagerEvent {
  const ClearManagerMessage();
}

class ManagerBloc {
  ManagerBloc({required AuthSession session, ManagerApiService? service})
    : this.session = session,
      _service = service ?? ManagerApiService(session: session),
      _state = ManagerState.initial(
        canManage: session.user.role == 'manager',
        // Land on the first tab the company shows. That is Connect for every
        // company today, but a list is a list.
        firstTab: visibleTabs(session.user.enabledTabs).first,
      );

  /// Who is signed in. The bottom bar reads the company's tab list from here.
  final AuthSession session;

  final ManagerApiService _service;

  /// The punch screen talks to the server directly — it has its own sequence of
  /// reading the device, being refused and offering a way out, which does not
  /// fit a single event and a single state.
  ManagerApiService get api => _service;

  final StreamController<ManagerState> _controller =
      StreamController<ManagerState>.broadcast();

  ManagerState _state;
  Timer? _leavePollingTimer;
  bool _refreshingLeaves = false;

  /// A change arrived while a refresh was already on its way; read again once
  /// it lands, or the newest request waits for the next minute's poll.
  bool _refreshLeavesAgain = false;

  /// The person's own live channel: a request raised to them or decided for
  /// them shows at once, not on the next minute's poll.
  RequestsSocketService? _requestsSocket;
  StreamSubscription<String>? _requestsChangedSub;
  StreamSubscription<void>? _requestsReconnectSub;
  Timer? _listsRefreshDebounce;

  /// Lists a change has asked for that the coalesced read has not taken yet.
  final Set<_RequestList> _listsDue = <_RequestList>{};
  bool _refreshingLists = false;

  /// The month the attendance calendar is on. Every read of attendance — the
  /// full load, a refresh after a change — is for this month, so a calendar
  /// paged back to September is never handed October's days.
  DateTime _attendanceMonth = _monthOf(DateTime.now());
  DateTime get attendanceMonth => _attendanceMonth;

  ManagerState get state => _state;
  ManagerApiService get service => _service;

  Stream<ManagerState> get stream => _controller.stream;

  /// Anything that changes something on the server, keyed so that a second
  /// tap on the same button while the first is still travelling is dropped
  /// rather than filing a duplicate request or deciding a request twice.
  static String? _mutationKey(ManagerEvent event) => switch (event) {
    SubmitLeaveApplication() => 'leave:apply',
    SubmitOvertimeApplication() => 'overtime:apply',
    SubmitReimbursementApplication() => 'reimbursement:apply',
    SubmitAttendanceRegularization() => 'attendance:apply',
    DecideLeave(:final leaveId, :final decision) =>
      'leave:decide:$leaveId:${decision.name}',
    DecideOvertime(:final overtimeId, :final decision) =>
      'overtime:decide:$overtimeId:${decision.name}',
    DecideAttendanceRegularization(:final id, :final decision) =>
      'attendance:decide:$id:${decision.name}',
    SaveFeedback() => 'feedback:save',
    SendFeedback() => 'feedback:send',
    NominateAward() => 'award:nominate',
    PunchRecorded() => 'attendance:punch',
    _ => null,
  };

  final Set<String> _inFlight = <String>{};

  /// True while [event]'s button should read as busy.
  bool isBusy(ManagerEvent event) {
    final key = _mutationKey(event);
    return key != null && _inFlight.contains(key);
  }

  Future<bool> add(ManagerEvent event) async {
    final key = _mutationKey(event);
    if (key == null) return _handle(event);
    if (!_inFlight.add(key)) return false;
    _emit(_state);
    try {
      return await _handle(event);
    } finally {
      _inFlight.remove(key);
      _emit(_state);
    }
  }

  void setManagerPhoto(String url) {
    _emit(
      _state.copyWith(
        dashboard: _state.dashboard?.copyWith(managerPhotoUrl: url),
      ),
    );
  }

  void dispose() {
    _leavePollingTimer?.cancel();
    _listsRefreshDebounce?.cancel();
    _requestsChangedSub?.cancel();
    _requestsReconnectSub?.cancel();
    _requestsSocket?.dispose();
    _controller.close();
  }

  /// Something about this person's requests changed on the server — from the
  /// live channel or a notification that arrived while the app was open,
  /// whose [kind] says which, or a reconnection after time away (no kind:
  /// anything may have, so every list).
  ///
  /// Only the request lists are read again, never the whole dashboard: the
  /// attendance calendar keeps the month it is on, and a resume costs a few
  /// calls rather than a dozen. Leaves are read straight away (the cheap,
  /// common case); the rest is coalesced so a burst becomes one read. A kind
  /// that is not about a request — a post, a support reply — reads nothing.
  void refreshRequestsNow([String? kind]) {
    if (_state.dashboard == null) return;
    final lists = kind == null ? _RequestList.values.toSet() : _listsFor(kind);
    if (lists.remove(_RequestList.leaves)) {
      unawaited(_refreshLeavesSilently());
    }
    if (lists.isEmpty) return;
    _listsDue.addAll(lists);
    _listsRefreshDebounce?.cancel();
    _listsRefreshDebounce = Timer(const Duration(milliseconds: 600), () {
      unawaited(_refreshListsSilently());
    });
  }

  /// The lists a change of [kind] can touch: the server's own kinds on the
  /// live channel (`leave_decided`, `correction_requested`, `punch_out`, …)
  /// and the `type` a notification carries (`leave`, `attendance`, …).
  static Set<_RequestList> _listsFor(String kind) => switch (kind) {
    _ when kind.startsWith('leave') => {_RequestList.leaves},
    _ when kind.startsWith('overtime') => {_RequestList.overtime},
    _ when kind.startsWith('reimbursement') => {_RequestList.claims},
    // A correction and a punch both change the attendance month.
    _
        when kind.startsWith('correction') ||
            kind.startsWith('attendance') ||
            kind.startsWith('punch') =>
      {_RequestList.attendance},
    _ => <_RequestList>{},
  };

  void _listenForRequestChanges() {
    if (_requestsSocket != null) return;
    final socket = RequestsSocketService(session: session);
    // Every event on this channel is about a request; one that does not say
    // which reads them all.
    _requestsChangedSub = socket.changes.listen(
      (kind) => refreshRequestsNow(kind.isEmpty ? null : kind),
    );
    _requestsReconnectSub = socket.reconnects.listen((_) => refreshRequestsNow());
    socket.connect();
    _requestsSocket = socket;
  }

  void _emit(ManagerState state) {
    _state = state;
    if (!_controller.isClosed) {
      _controller.add(state);
    }
  }

  Future<bool> _handle(ManagerEvent event) async {
    try {
      switch (event) {
        case LoadManagerDashboard():
          // What the device remembers comes up at once, marked as such;
          // then the live core; then the inboxes and claims behind it.
          final remembered = _state.dashboard == null
              ? await _service.fetchDashboardFromCache()
              : null;
          if (remembered != null) {
            _emit(_state.copyWith(
              status: ManagerLoadStatus.ready,
              dashboard: remembered,
              fromCache: true,
              error: null,
            ));
          } else if (_state.dashboard == null) {
            _emit(_state.copyWith(status: ManagerLoadStatus.loading));
          }
          try {
            // The month the calendar is on, not always this one. Only this
            // month's load is kept on the device: the copy is read back for
            // this month at the next launch.
            final month = _attendanceMonth;
            final dashboard = await _service.fetchDashboard(
              previous: _state.dashboard,
              attendanceMonth: month,
              keep: _sameMonth(month, DateTime.now()),
              onCore: (core) => _emit(_state.copyWith(
                status: ManagerLoadStatus.ready,
                dashboard: _keepCalendarMonth(core, month),
                fromCache: false,
                error: null,
              )),
            );
            _emit(
              _state.copyWith(
                status: ManagerLoadStatus.ready,
                dashboard: _keepCalendarMonth(dashboard, month),
                fromCache: false,
                error: null,
              ),
            );
          } finally {
            // Whatever the live load did, the minute's refresh runs: it is
            // what brings a copy up to date once the network is back.
            if (_state.dashboard != null) {
              _startLeavePolling();
              _listenForRequestChanges();
            }
          }
        case ChangeManagerTab(:final tab):
          // Team is open to everyone now — individual contributors get the
          // same list read-only (no requests segment, no decisions), so this
          // no longer blocks the switch.
          _emit(
            _state.copyWith(
              tab: tab,
              view: ManagerView.home,
              clearSelectedMember: true,
              clearAwardPicker: true,
              applyLeaveOpen: false,
            ),
          );
        case LoadAttendanceMonth(:final month):
          // Taken before the read, so the calendar turns the moment it is
          // asked to and a refresh meanwhile reads the new month.
          final previous = _attendanceMonth;
          final wanted = _monthOf(month);
          _attendanceMonth = wanted;
          try {
            final result = await _service.fetchAttendance(
              wanted,
              DateTime(wanted.year, wanted.month + 1, 0),
            );
            // Paged on while this was on its way: that month's read lands
            // instead, and this one would put the wrong days under it.
            if (!_sameMonth(_attendanceMonth, wanted)) return true;
            final data = _state.dashboard;
            _emit(
              _state.copyWith(
                dashboard: data?.copyWith(
                  attendance: result.$1,
                  regularizations: result.$2,
                  serverDays: result.$3,
                ),
              ),
            );
          } catch (_) {
            // Not read: the calendar goes back to the month it has the days
            // for, unless it has been paged on since.
            if (_sameMonth(_attendanceMonth, wanted)) {
              _attendanceMonth = previous;
            }
            rethrow;
          }
        case RecordPunch(:final type):
          final record = await _service.recordPunch(type);
          _mergePunch(record, type == 'in' ? 'Punched in' : 'Punched out');
        case PunchRecorded(:final record):
          _mergePunch(record, null);
        case SubmitAttendanceRegularization(
          :final workDate,
          :final dayType,
          :final note,
        ):
          final request = await _service.submitAttendanceRegularization(
            workDate: workDate,
            dayType: dayType,
            note: note,
          );
          final data = _state.dashboard;
          _emit(
            _state.copyWith(
              dashboard: data?.copyWith(
                regularizations: [request, ...data.regularizations],
              ),
              message: 'Regularization sent to your manager',
            ),
          );
        case DecideAttendanceRegularization(
          :final id,
          :final decision,
          :final managerNote,
        ):
          final updated = await _service.decideAttendanceRegularization(
            id,
            decision,
            managerNote,
          );
          final data = _state.dashboard;
          _emit(
            _state.copyWith(
              dashboard: data?.copyWith(
                managerRegularizations: data.managerRegularizations
                    .map((item) => item.id == id ? updated : item)
                    .toList(),
              ),
              message: decision == LeaveDecision.approved
                  ? 'Attendance correction approved'
                  : 'Attendance correction declined',
            ),
          );
        case OpenFeedbackList():
          _emit(_state.copyWith(view: ManagerView.feedbackList));
        case CloseFeedbackList():
          _emit(
            _state.copyWith(
              view: ManagerView.home,
              searchQuery: '',
              feedbackFilter: FeedbackFilter.all,
            ),
          );
        case ShowTeamSection(:final section):
          _emit(_state.copyWith(view: ManagerView.home, teamSection: section));
        case OpenFeedbackRecord(:final memberId):
          final member = _state.dashboard?.team
              .where((item) => item.id == memberId)
              .firstOrNull;
          if (member == null) return false;
          _emit(
            _state.copyWith(
              selectedMemberId: member.id,
              recordParams: member.params
                  .map((param) => param.copyWith())
                  .toList(),
              recordExtra: member.extra,
            ),
          );
        case CloseFeedbackRecord():
          _emit(
            _state.copyWith(
              clearSelectedMember: true,
              recordParams: const <FeedbackParam>[],
              recordExtra: '',
            ),
          );
        case ChangeFeedbackFilter(:final filter):
          _emit(_state.copyWith(feedbackFilter: filter));
        case ChangeFeedbackSearch(:final query):
          _emit(_state.copyWith(searchQuery: query));
        case ToggleGivenFeedback():
          _emit(_state.copyWith(showGiven: !_state.showGiven));
        case UpdateFeedbackScore(:final index, :final score):
          final next = _state.recordParams.indexed.map((entry) {
            return entry.$1 == index
                ? entry.$2.copyWith(score: score)
                : entry.$2;
          }).toList();
          _emit(_state.copyWith(recordParams: next));
        case UpdateFeedbackNote(:final index, :final note):
          final next = _state.recordParams.indexed.map((entry) {
            return entry.$1 == index ? entry.$2.copyWith(note: note) : entry.$2;
          }).toList();
          _emit(_state.copyWith(recordParams: next));
        case UpdateFeedbackExtra(:final extra):
          _emit(_state.copyWith(recordExtra: extra));
        case SaveFeedback():
          await _persistFeedback(
            FeedbackStatus.saved,
            'Saved — ready for the session',
          );
        case SendFeedback():
          final member = _state.selectedMember;
          await _persistFeedback(
            FeedbackStatus.sent,
            member == null ? 'Sent' : 'Sent to ${member.name.split(' ').first}',
          );
        case DecideLeave(:final leaveId, :final decision, :final managerNote):
          final updatedLeave = await _service.decideLeave(
            leaveId,
            decision,
            managerNote,
          );
          final data = _state.dashboard;
          if (data == null) return false;
          final leaves = data.leaves.map((leave) {
            return leave.id == leaveId ? updatedLeave : leave;
          }).toList();
          // The days-available count is only recomputed server-side on
          // request, not pushed here automatically — without this, approving
          // shows correctly in the request history but the balance number
          // stays stuck at whatever it was when the dashboard first loaded.
          // Only matters when the decider's own balance is affected (e.g.
          // self-approval); failure here shouldn't block the decision itself.
          final refreshedBalance = await _service
              .fetchLeaveBalance()
              .catchError((_) => data.leaveBalance);
          _emit(
            _state.copyWith(
              dashboard: data.copyWith(
                leaves: leaves,
                leaveBalance: refreshedBalance,
              ),
              message: decision == LeaveDecision.approved
                  ? 'Leave approved'
                  : 'Leave declined',
            ),
          );
        case DecideOvertime(
          :final overtimeId,
          :final decision,
          :final managerNote,
        ):
          final updated = await _service.decideOvertimeRequest(
            overtimeId,
            decision,
            managerNote,
          );
          final data = _state.dashboard;
          if (data == null) return false;
          final overtime = data.overtime.map((request) {
            return request.id == overtimeId ? updated : request;
          }).toList();
          _emit(
            _state.copyWith(
              dashboard: data.copyWith(overtime: overtime),
              message: decision == LeaveDecision.approved
                  ? 'Overtime approved'
                  : 'Overtime declined',
            ),
          );
        case OpenAwardPicker(:final awardKey):
          _emit(_state.copyWith(awardPickerKey: awardKey));
        case CloseAwardPicker():
          _emit(_state.copyWith(clearAwardPicker: true));
        case NominateAward(:final awardKey, :final memberId, :final reason):
          final data = _state.dashboard;
          if (data == null) return false;
          final member = data.recognitionCandidates
              .where((item) => item.id == memberId)
              .firstOrNull;
          if (member == null) return false;
          await _service.nominateAward(awardKey, member, reason);
          final awards = data.awards.map((award) {
            return award.key == awardKey
                ? award.copyWith(nomineeId: memberId, reason: reason)
                : award;
          }).toList();
          final historyEntry = Nomination(
            period: '',
            category: awardKey,
            employeeName: member.name,
            reason: reason,
          );
          _emit(
            _state.copyWith(
              dashboard: data.copyWith(
                awards: awards,
                recognitionHistory: [historyEntry, ...data.recognitionHistory],
              ),
              clearAwardPicker: true,
              message: 'Nomination submitted',
            ),
          );
        case OpenApplyLeave():
          _emit(_state.copyWith(applyLeaveOpen: true, applyLeaveSent: false));
        case CloseApplyLeave():
          _emit(_state.copyWith(applyLeaveOpen: false, applyLeaveSent: false));
        case SubmitLeaveApplication(
          :final type,
          :final startDate,
          :final endDate,
          :final reason,
          :final halfDay,
          :final documentName,
          :final documentBytes,
        ):
          final leave = await _service.submitLeaveApplication(
            // The template's key for the type picked, so one HR added in the
            // dashboard is sent as itself.
            type: _state.dashboard?.shift.leaveKeyFor(type) ?? type,
            startDate: startDate,
            endDate: endDate,
            reason: reason,
            halfDay: halfDay,
            documentName: documentName,
            documentBytes: documentBytes,
          );
          final data = _state.dashboard;
          _emit(
            _state.copyWith(
              dashboard: data?.copyWith(myLeaves: [leave, ...data.myLeaves]),
              applyLeaveSent: true,
            ),
          );
        case SubmitOvertimeApplication(
          :final workDate,
          :final startTime,
          :final endTime,
          :final duration,
          :final note,
        ):
          final request = await _service.submitOvertime(
            workDate: workDate,
            startTime: startTime,
            endTime: endTime,
            duration: duration,
            note: note,
          );
          final data = _state.dashboard;
          _emit(
            _state.copyWith(
              dashboard: data?.copyWith(
                myOvertime: [request, ...data.myOvertime],
              ),
            ),
          );
        case SubmitReimbursementApplication(
          :final expenseDate,
          :final amount,
          :final category,
          :final receiptName,
          :final receiptBytes,
          :final note,
        ):
          final claim = await _service.submitReimbursement(
            expenseDate: expenseDate,
            amount: amount,
            category: category,
            receiptName: receiptName,
            receiptBytes: receiptBytes,
            note: note,
          );
          final data = _state.dashboard;
          _emit(
            _state.copyWith(
              dashboard: data?.copyWith(
                myReimbursements: [claim, ...data.myReimbursements],
              ),
            ),
          );
        case ClearManagerMessage():
          _emit(_state.copyWith(clearMessage: true));
      }
      return true;
    } catch (error) {
      _emit(
        _state.copyWith(
          status: _state.dashboard == null
              ? ManagerLoadStatus.failure
              : ManagerLoadStatus.ready,
          error: _state.dashboard == null ? error.toString() : null,
          message: _state.dashboard == null ? null : error.toString(),
        ),
      );
      return false;
    }
  }

  static String _currentPeriodKey() {
    final now = DateTime.now();
    return '${now.year}-${now.month.toString().padLeft(2, '0')}';
  }

  Future<void> _persistFeedback(FeedbackStatus status, String message) async {
    final data = _state.dashboard;
    final selected = _state.selectedMember;
    if (data == null || selected == null) return;

    final params = _state.recordParams;
    final overall = params.isEmpty
        ? selected.score
        : params.fold<double>(0, (sum, item) => sum + item.score) /
              params.length;
    await _service.saveFeedback(
      member: selected,
      status: status,
      params: params,
      extra: _state.recordExtra,
    );
    // A sent review must also land in the member's history, otherwise the
    // growth timeline keeps showing the period as still due.
    final period = _currentPeriodKey();
    final team = data.team.map((member) {
      if (member.id != selected.id) return member;
      final history = status == FeedbackStatus.sent
          ? <GrowthRecord>[
              ...member.history.where((record) => record.period != period),
              GrowthRecord(
                period: period,
                overallScore: overall,
                parameters: params,
                sentAt: DateTime.now(),
                managerName: data.managerName,
              ),
            ]
          : member.history;
      return member.copyWith(
        status: status,
        params: params,
        extra: _state.recordExtra,
        score: overall,
        history: history,
        previousScore: status == FeedbackStatus.sent
            ? member.history
                  .where((record) => record.period != period)
                  .map((record) => record.overallScore)
                  .lastOrNull
            : member.previousScore,
      );
    }).toList();
    _emit(
      _state.copyWith(
        dashboard: data.copyWith(team: team),
        clearSelectedMember: true,
        recordParams: const <FeedbackParam>[],
        recordExtra: '',
        message: message,
      ),
    );
  }

  /// Once a minute. Every five seconds was four hundred calls in a sitting,
  /// each competing with whatever the person was actually waiting for; a
  /// decision on a leave can show up a minute late.
  void _startLeavePolling() {
    _leavePollingTimer?.cancel();
    _leavePollingTimer = Timer.periodic(const Duration(seconds: 60), (_) {
      unawaited(_refreshLeavesSilently());
    });
  }

  /// The policy is re-read on the same poll, but only once a minute — it
  /// changes rarely, and the app should not need a restart when it does.
  DateTime? _policyReadAt;

  /// The team list with each report's review brought up to date, leaving
  /// everything else about them untouched.
  static List<TeamMember> _mergeFeedback(
    List<TeamMember> team,
    FeedbackSnapshot feedback,
  ) {
    return [
      for (final member in team)
        if (feedback.team[member.userId] case final row?)
          member.copyWith(
            score: (row['score'] as num?)?.toDouble(),
            status: switch (row['feedbackStatus']) {
              'sent' => FeedbackStatus.sent,
              'saved' => FeedbackStatus.saved,
              _ => null,
            },
            params: (row['parameters'] as List<dynamic>?)
                ?.map((v) => FeedbackParam.fromJson(v as Map<String, dynamic>))
                .toList(),
            extra: row['extra'] as String?,
          )
        else
          member,
    ];
  }

  Future<void> _refreshLeavesSilently() async {
    final data = _state.dashboard;
    if (data == null) return;
    if (_refreshingLeaves) {
      _refreshLeavesAgain = true;
      return;
    }
    _refreshingLeaves = true;
    try {
      final readPolicy =
          _policyReadAt == null ||
          DateTime.now().difference(_policyReadAt!) > const Duration(minutes: 1);
      // Feedback rides the same throttle: a review stays editable until the
      // cycle closes, so an employee holding the page open should see a
      // revision without signing out.
      final feedbackFuture = readPolicy
          ? _service.fetchFeedbackSnapshot().then<FeedbackSnapshot?>((v) => v).catchError((_) => null)
          : Future<FeedbackSnapshot?>.value(null);
      // Kept separate from the leave calls: an older server without this
      // route must not stop the leaves refreshing too.
      final policyFuture = readPolicy
          ? _service.fetchShiftPolicy().catchError((_) => data.shift)
          : Future<ShiftPolicy>.value(data.shift);
      final myLeavesFuture = _service.fetchMyLeaves();
      final managerLeavesFuture = _state.canManage
          ? _service.fetchManagerLeaves()
          : Future<List<LeaveRequest>>.value(data.leaves);
      final myLeaves = await myLeavesFuture;
      final managerLeaves = await managerLeavesFuture;
      final shift = await policyFuture;
      final feedback = await feedbackFuture;
      if (readPolicy) _policyReadAt = DateTime.now();
      final latest = _state.dashboard;
      if (latest == null || _controller.isClosed) return;
      _emit(
        _state.copyWith(
          dashboard: latest.copyWith(
            leaves: managerLeaves,
            myLeaves: myLeaves,
            shift: shift,
            growthHistory: feedback?.growthHistory,
            cycleEndsOn: feedback?.cycleEndsOn,
            team: feedback == null ? null : _mergeFeedback(latest.team, feedback),
          ),
        ),
      );
    } catch (_) {
      // Polling is best-effort; foreground actions still surface errors.
    } finally {
      _refreshingLeaves = false;
      if (_refreshLeavesAgain) {
        _refreshLeavesAgain = false;
        unawaited(_refreshLeavesSilently());
      }
    }
  }

  /// Reads again the lists [refreshRequestsNow] has asked for — overtime,
  /// claims, the attendance month with its corrections — each the person's
  /// own and, where they decide them, their inbox. Nothing else on the
  /// dashboard is touched, and attendance is read for the month on screen.
  Future<void> _refreshListsSilently() async {
    if (_state.dashboard == null || _listsDue.isEmpty) return;
    // One read at a time; whatever arrives meanwhile goes in the next.
    if (_refreshingLists) return;
    _refreshingLists = true;
    final lists = Set.of(_listsDue);
    _listsDue.clear();
    final overtime = lists.contains(_RequestList.overtime);
    final claims = lists.contains(_RequestList.claims);
    final attendance = lists.contains(_RequestList.attendance);
    final manages = _state.canManage;
    final month = _attendanceMonth;
    // Each list on its own: one the server refuses keeps what is on screen
    // rather than holding the others back.
    Future<T?> read<T>(bool wanted, Future<T> Function() fetch) => wanted
        ? fetch().then<T?>((value) => value).catchError((_) => null)
        : Future<T?>.value(null);
    try {
      final myOvertimeFuture = read(overtime, _service.fetchMyOvertime);
      final overtimeFuture = read(overtime, _service.fetchManagerOvertime);
      final myClaimsFuture = read(claims, _service.fetchMyReimbursements);
      final claimsFuture = read(
        claims && manages,
        _service.fetchManagerReimbursements,
      );
      final attendanceFuture = read(
        attendance,
        () => _service.fetchAttendance(
          month,
          DateTime(month.year, month.month + 1, 0),
        ),
      );
      final correctionsFuture = read(
        attendance && manages,
        _service.fetchManagerAttendanceRegularizations,
      );
      final myOvertime = await myOvertimeFuture;
      final overtimeInbox = await overtimeFuture;
      final myClaims = await myClaimsFuture;
      final claimsInbox = await claimsFuture;
      final monthDays = await attendanceFuture;
      final corrections = await correctionsFuture;
      final latest = _state.dashboard;
      if (latest == null || _controller.isClosed) return;
      // The calendar paged on while this was out: its own read brings that
      // month, and this one is not put under it.
      final days = _sameMonth(month, _attendanceMonth) ? monthDays : null;
      _emit(
        _state.copyWith(
          dashboard: latest.copyWith(
            myOvertime: myOvertime,
            overtime: overtimeInbox,
            myReimbursements: myClaims,
            reimbursements: claimsInbox,
            attendance: days?.$1,
            regularizations: days?.$2,
            serverDays: days?.$3,
            managerRegularizations: corrections,
          ),
        ),
      );
    } finally {
      _refreshingLists = false;
      if (_listsDue.isNotEmpty && !_controller.isClosed) {
        unawaited(_refreshListsSilently());
      }
    }
  }

  /// [loaded] with the attendance already on screen kept in place of its own,
  /// when it was read for [month] and the calendar has since been paged on.
  ManagerDashboard _keepCalendarMonth(ManagerDashboard loaded, DateTime month) {
    final current = _state.dashboard;
    if (current == null || _sameMonth(month, _attendanceMonth)) return loaded;
    return loaded.copyWith(
      attendance: current.attendance,
      regularizations: current.regularizations,
      serverDays: current.serverDays,
    );
  }

  /// Folds a punch into the day it belongs to.
  ///
  /// Replaces the day's record rather than appending, so punching out does not
  /// leave the morning's punch-in sitting beside it.
  void _mergePunch(AttendanceRecord record, String? message) {
    final data = _state.dashboard;
    if (data == null) return;
    final attendance = [
      for (final item in data.attendance)
        if (!_sameDate(item.workDate, record.workDate)) item,
      record,
    ];
    _emit(
      _state.copyWith(
        dashboard: data.copyWith(attendance: attendance),
        message: message,
      ),
    );
  }
}

bool _sameDate(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

bool _sameMonth(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month;

DateTime _monthOf(DateTime date) => DateTime(date.year, date.month);

/// The request lists a change can touch, each read again on its own.
enum _RequestList { leaves, overtime, attendance, claims }
