import 'dart:async';
import 'dart:typed_data';

import '../../auth/data/auth_models.dart';
import '../data/manager_api_service.dart';
import '../data/manager_models.dart';

enum ManagerLoadStatus { initial, loading, ready, failure }

enum FeedbackFilter { all, pending, done }

class ManagerState {
  const ManagerState({
    required this.status,
    required this.tab,
    required this.view,
    required this.canManage,
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

  factory ManagerState.initial({required bool canManage}) {
    return ManagerState(
      status: ManagerLoadStatus.initial,
      tab: canManage ? ManagerTab.manage : ManagerTab.grow,
      view: ManagerView.home,
      canManage: canManage,
    );
  }

  final ManagerLoadStatus status;
  final ManagerTab tab;
  final ManagerView view;
  final bool canManage;
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
    ManagerTab? tab,
    ManagerView? view,
    bool? canManage,
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
      tab: tab ?? this.tab,
      view: view ?? this.view,
      canManage: canManage ?? this.canManage,
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

class OpenLeaveRequests extends ManagerEvent {
  const OpenLeaveRequests();
}

class CloseLeaveRequests extends ManagerEvent {
  const CloseLeaveRequests();
}

class OpenOvertimeRequests extends ManagerEvent {
  const OpenOvertimeRequests();
}

class CloseOvertimeRequests extends ManagerEvent {
  const CloseOvertimeRequests();
}

class OpenAttendanceCorrections extends ManagerEvent {
  const OpenAttendanceCorrections();
}

class CloseAttendanceCorrections extends ManagerEvent {
  const CloseAttendanceCorrections();
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
  });

  final String type;
  final DateTime startDate;
  final DateTime endDate;
  final String reason;
}

class SubmitOvertimeApplication extends ManagerEvent {
  const SubmitOvertimeApplication({
    required this.workDate,
    required this.startTime,
    required this.endTime,
    required this.note,
  });
  final DateTime workDate;
  final DateTime startTime;
  final DateTime endTime;
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

class RecordPunch extends ManagerEvent {
  const RecordPunch(this.type);
  final String type;
}

class SubmitAttendanceRegularization extends ManagerEvent {
  const SubmitAttendanceRegularization({
    required this.workDate,
    required this.punchIn,
    required this.punchOut,
    required this.note,
  });
  final DateTime workDate;
  final DateTime? punchIn;
  final DateTime? punchOut;
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
    : _service = service ?? ManagerApiService(session: session),
      _state = ManagerState.initial(canManage: session.user.role == 'manager');

  final ManagerApiService _service;
  final StreamController<ManagerState> _controller =
      StreamController<ManagerState>.broadcast();

  ManagerState _state;
  Timer? _leavePollingTimer;
  bool _refreshingLeaves = false;

  ManagerState get state => _state;
  ManagerApiService get service => _service;

  Stream<ManagerState> get stream => _controller.stream;

  Future<bool> add(ManagerEvent event) => _handle(event);

  void dispose() {
    _leavePollingTimer?.cancel();
    _controller.close();
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
          _emit(_state.copyWith(status: ManagerLoadStatus.loading));
          final dashboard = await _service.fetchDashboard();
          _startLeavePolling();
          _emit(
            _state.copyWith(
              status: ManagerLoadStatus.ready,
              dashboard: dashboard,
              error: null,
            ),
          );
        case ChangeManagerTab(:final tab):
          if (tab == ManagerTab.manage && !_state.canManage) return false;
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
          final from = DateTime(month.year, month.month, 1);
          final to = DateTime(month.year, month.month + 1, 0);
          final result = await _service.fetchAttendance(from, to);
          final data = _state.dashboard;
          _emit(
            _state.copyWith(
              dashboard: data?.copyWith(
                attendance: result.$1,
                regularizations: result.$2,
              ),
            ),
          );
        case RecordPunch(:final type):
          final record = await _service.recordPunch(type);
          final data = _state.dashboard;
          if (data != null) {
            final attendance = [
              for (final item in data.attendance)
                if (!_sameDate(item.workDate, record.workDate)) item,
              record,
            ];
            _emit(
              _state.copyWith(
                dashboard: data.copyWith(attendance: attendance),
                message: type == 'in' ? 'Punched in' : 'Punched out',
              ),
            );
          }
        case SubmitAttendanceRegularization(
          :final workDate,
          :final punchIn,
          :final punchOut,
          :final note,
        ):
          final request = await _service.submitAttendanceRegularization(
            workDate: workDate,
            punchIn: punchIn,
            punchOut: punchOut,
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
        case OpenLeaveRequests():
          _emit(_state.copyWith(view: ManagerView.leaveRequests));
        case CloseLeaveRequests():
          _emit(_state.copyWith(view: ManagerView.home));
        case OpenOvertimeRequests():
          _emit(_state.copyWith(view: ManagerView.overtimeRequests));
        case CloseOvertimeRequests():
          _emit(_state.copyWith(view: ManagerView.home));
        case OpenAttendanceCorrections():
          _emit(_state.copyWith(view: ManagerView.attendanceCorrections));
        case CloseAttendanceCorrections():
          _emit(_state.copyWith(view: ManagerView.home));
        case OpenFeedbackRecord(:final memberId):
          final member = _state.dashboard?.team
              .where((item) => item.id == memberId)
              .firstOrNull;
          if (member == null) return false;
          _emit(
            _state.copyWith(
              view: ManagerView.feedbackRecord,
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
              view: ManagerView.feedbackList,
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
          _emit(
            _state.copyWith(
              dashboard: data.copyWith(leaves: leaves),
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
        ):
          final leave = await _service.submitLeaveApplication(
            type: type,
            startDate: startDate,
            endDate: endDate,
            reason: reason,
          );
          final data = _state.dashboard;
          _emit(
            _state.copyWith(
              dashboard: data?.copyWith(myLeaves: [leave, ...data.myLeaves]),
              applyLeaveSent: true,
              message: 'Leave request submitted',
            ),
          );
        case SubmitOvertimeApplication(
          :final workDate,
          :final startTime,
          :final endTime,
          :final note,
        ):
          final request = await _service.submitOvertime(
            workDate: workDate,
            startTime: startTime,
            endTime: endTime,
            note: note,
          );
          final data = _state.dashboard;
          _emit(
            _state.copyWith(
              dashboard: data?.copyWith(
                myOvertime: [request, ...data.myOvertime],
              ),
              message: 'Overtime request submitted',
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
              message: 'Reimbursement claim submitted',
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
    final team = data.team.map((member) {
      if (member.id != selected.id) return member;
      return member.copyWith(
        status: status,
        params: params,
        extra: _state.recordExtra,
        score: overall,
      );
    }).toList();
    _emit(
      _state.copyWith(
        dashboard: data.copyWith(team: team),
        view: ManagerView.feedbackList,
        clearSelectedMember: true,
        recordParams: const <FeedbackParam>[],
        recordExtra: '',
        message: message,
      ),
    );
  }

  void _startLeavePolling() {
    _leavePollingTimer?.cancel();
    _leavePollingTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      unawaited(_refreshLeavesSilently());
    });
  }

  Future<void> _refreshLeavesSilently() async {
    final data = _state.dashboard;
    if (data == null || _refreshingLeaves) return;
    _refreshingLeaves = true;
    try {
      final myLeavesFuture = _service.fetchMyLeaves();
      final managerLeavesFuture = _state.canManage
          ? _service.fetchManagerLeaves()
          : Future<List<LeaveRequest>>.value(data.leaves);
      final myLeaves = await myLeavesFuture;
      final managerLeaves = await managerLeavesFuture;
      final latest = _state.dashboard;
      if (latest == null || _controller.isClosed) return;
      _emit(
        _state.copyWith(
          dashboard: latest.copyWith(leaves: managerLeaves, myLeaves: myLeaves),
        ),
      );
    } catch (_) {
      // Polling is best-effort; foreground actions still surface errors.
    } finally {
      _refreshingLeaves = false;
    }
  }
}

bool _sameDate(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;
