import 'dart:math' as math;
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../manager/bloc/manager_bloc.dart';
import '../../manager/data/manager_models.dart';
import '../../manager_shell/presentation/app_home_header.dart';

class QuickActionsController extends ChangeNotifier {
  _QuickActionsScreenState? _state;

  bool get canGoBack => _state != null && _state!._page != _QuickPage.home;

  void handleBack() => _state?._back();

  void _attach(_QuickActionsScreenState state) {
    _state = state;
  }

  void _detach(_QuickActionsScreenState state) {
    if (identical(_state, state)) _state = null;
  }

  void _navigationChanged() => notifyListeners();
}

enum _QuickPage {
  home,
  leave,
  applyLeave,
  overtime,
  applyOvertime,
  reimbursements,
  applyReimbursement,
  policies,
  policy,
  calendar,
  wizard,
  success,
}

enum _QuickFlow { leave, overtime, reimbursement }

enum AttendanceFilter {
  present,
  late,
  halfDay,
  leave,
  leaveApplied,
  correction,
  correctionAwaits,
  holiday,
}

enum AttendanceKind {
  present,
  attention,
  weekoff,
  halfDay,
  leaveApproved,
  leavePending,
  holiday,
  future,
  regularizationPending,
}

class AttendanceDayView {
  const AttendanceDayView({
    required this.date,
    required this.kind,
    required this.title,
    required this.cellLabel,
    this.record,
    this.regularization,
    this.leave,
    this.holiday,
    this.late = false,
    this.earlyOut = false,
  });

  final DateTime date;
  final AttendanceKind kind;
  final String title;
  final String cellLabel;
  final AttendanceRecord? record;
  final AttendanceRegularization? regularization;
  final LeaveRequest? leave;
  final CompanyHoliday? holiday;

  /// Arrived after the shift start plus its grace, per the org's shift policy.
  final bool late;

  /// Left before the shift end less its grace.
  final bool earlyOut;
}

List<AttendanceDayView> buildAttendanceDays({
  required DateTime month,
  required List<AttendanceRecord> records,
  required List<AttendanceRegularization> regularizations,
  required List<LeaveRequest> leaves,
  required List<CompanyHoliday> holidays,
  required List<OvertimeRequest> overtime,
  required ShiftPolicy shift,
}) {
  final recordsByDate = {
    for (final record in records)
      _QuickActionsScreenState._dateKey(record.workDate): record,
  };
  final requestsByDate = {
    for (final request in regularizations)
      _QuickActionsScreenState._dateKey(request.workDate): request,
  };
  final now = DateTime.now();
  final count = DateTime(month.year, month.month + 1, 0).day;
  return List.generate(count, (index) {
    final date = DateTime(month.year, month.month, index + 1);
    final key = _QuickActionsScreenState._dateKey(date);
    final record = recordsByDate[key];
    final regularization = requestsByDate[key];
    LeaveRequest? leave;
    for (final item in leaves) {
      if (!date.isBefore(_dateOnly(item.start)) &&
          !date.isAfter(_dateOnly(item.end))) {
        leave = item;
        break;
      }
    }
    CompanyHoliday? holiday;
    for (final item in holidays) {
      if (_sameDay(item.date, date)) {
        holiday = item;
        break;
      }
    }
    OvertimeRequest? overtimeItem;
    for (final item in overtime) {
      if (_sameDay(item.workDate, date)) {
        overtimeItem = item;
        break;
      }
    }
    final future = date.isAfter(_dateOnly(now));
    final weekoff = shift.isWeekOff(date);
    final complete = record?.punchIn != null && record?.punchOut != null;
    final duration = complete
        ? record!.punchOut!.difference(record.punchIn!)
        : null;
    final approvedRegularization =
        regularization?.status.toLowerCase() == 'approved';
    final pendingRegularization =
        regularization != null &&
        regularization.status.toLowerCase() == 'pending';
    final leaveStatus = leave?.decision;
    final overtimeSuffix = overtimeItem == null
        ? ''
        : ' · ${overtimeItem.decision == LeaveDecision.approved ? 'OT · Approved' : 'OT'}';

    if (holiday != null) {
      return AttendanceDayView(
        date: date,
        kind: AttendanceKind.holiday,
        title: holiday.name,
        cellLabel: 'Holiday',
        holiday: holiday,
        leave: leave,
        record: record,
      );
    }
    if (leave != null && leaveStatus != LeaveDecision.declined) {
      final approved = leaveStatus == LeaveDecision.approved;
      return AttendanceDayView(
        date: date,
        kind: approved
            ? AttendanceKind.leaveApproved
            : AttendanceKind.leavePending,
        title: 'Leave · ${approved ? 'Approved' : 'Pending'}',
        cellLabel: approved ? 'Approved' : 'Pending',
        leave: leave,
        record: record,
      );
    }
    if (approvedRegularization) {
      // The device record may not reflect the correction yet, so fall back
      // to the approved request's own requested times for display.
      final displayRecord = AttendanceRecord(
        workDate: date,
        punchIn: record?.punchIn ?? regularization?.requestedPunchIn,
        punchOut: record?.punchOut ?? regularization?.requestedPunchOut,
      );
      final punchIn = displayRecord.punchIn;
      final punchOut = displayRecord.punchOut;
      return AttendanceDayView(
        date: date,
        kind: AttendanceKind.present,
        title: 'Present (regularised)',
        cellLabel: '',
        record: displayRecord,
        regularization: regularization,
        late: punchIn != null && shift.isLate(punchIn),
        earlyOut: punchOut != null && shift.isEarlyOut(punchOut),
      );
    }
    if (pendingRegularization) {
      return AttendanceDayView(
        date: date,
        kind: AttendanceKind.regularizationPending,
        title: 'Regularization · Pending',
        cellLabel: 'Pending',
        record: record,
        regularization: regularization,
      );
    }
    if (complete) {
      // Three bands, all from the shift HR configured: a full day, a half day,
      // and below that a day short enough to need a correction.
      final fullDay = duration! >= shift.minFullDay;
      final halfDay = !fullDay && duration >= shift.minHalfDay;
      final short = !fullDay && !halfDay;
      final late = shift.isLate(record!.punchIn!);
      final earlyOut = shift.isEarlyOut(record.punchOut!);
      final flags = [
        if (late) 'Late',
        if (earlyOut) 'Early out',
      ].join(' · ');
      final label = short
          ? 'Short day'
          : halfDay
          ? 'Half day'
          : 'Present';
      return AttendanceDayView(
        date: date,
        kind: short
            ? AttendanceKind.attention
            : halfDay
            ? AttendanceKind.halfDay
            : AttendanceKind.present,
        title:
            '$label · ${_QuickActionsScreenState._duration(duration)}'
            '${flags.isEmpty ? '' : ' · $flags'}$overtimeSuffix',
        cellLabel: short
            ? 'Short'
            : halfDay
            ? 'Half day'
            : (late ? 'Late' : (overtimeItem == null ? '' : 'OT')),
        record: record,
        late: late,
        earlyOut: earlyOut,
      );
    }
    if (record != null || (!future && !weekoff)) {
      final missing = record?.punchIn == null
          ? 'missing punch-in'
          : 'missing punch-out';
      return AttendanceDayView(
        date: date,
        kind: AttendanceKind.attention,
        title: 'Needs attention · $missing',
        cellLabel: 'Attention',
        record: record,
        regularization: regularization,
      );
    }
    if (weekoff) {
      return AttendanceDayView(
        date: date,
        kind: AttendanceKind.weekoff,
        title: 'Weekly off',
        cellLabel: 'Week off',
      );
    }
    return AttendanceDayView(
      date: date,
      kind: AttendanceKind.future,
      title: future ? 'Working day' : 'No record',
      cellLabel: '',
    );
  });
}

const int _maxLeaveApplyDays = 30;

class QuickActionsScreen extends StatefulWidget {
  const QuickActionsScreen({
    super.key,
    required this.bloc,
    required this.dashboard,
    required this.controller,
    required this.profileAction,
    required this.onNotifications,
    required this.onOpenComposer,
  });

  final ManagerBloc bloc;
  final ManagerDashboard dashboard;
  final QuickActionsController controller;
  final Widget profileAction;
  final VoidCallback onNotifications;
  final VoidCallback onOpenComposer;

  @override
  State<QuickActionsScreen> createState() => _QuickActionsScreenState();
}

class _QuickActionsScreenState extends State<QuickActionsScreen> {
  _QuickPage _page = _QuickPage.home;
  _QuickFlow _flow = _QuickFlow.leave;
  int _step = 0;
  String? _choice;
  DateTime _from = DateTime.now();
  DateTime _to = DateTime.now();
  DateTime? _leaveFrom;
  DateTime? _leaveTo;
  String? _leaveType;
  String _leaveDuration = 'Full Day';
  bool _leaveHistoryView = false;
  final _leaveReason = TextEditingController();
  String? _leaveAttachmentName;
  bool _dateChosen = false;
  String? _uploadName;
  Uint8List? _uploadBytes;
  final _text = TextEditingController();
  final Map<String, String> _answers = {};
  _Policy? _policy;
  bool _submitting = false;
  DateTime _attendanceMonth = DateTime(
    DateTime.now().year,
    DateTime.now().month,
  );
  bool _attendanceListView = false;
  AttendanceFilter? _attendanceFilter;
  AttendanceDayView? _selectedCalendarDay;
  bool _overtimeHistoryView = false;
  DateTime? _overtimeDate;
  /// 'Full day' or 'Half day' — the only two durations overtime is claimed as,
  /// matching what HR configured. The hours behind them come from the shift.
  String? _overtimeDuration;
  final _overtimeNote = TextEditingController();
  bool _reimbursementHistoryView = false;
  DateTime? _reimbursementDate;
  String? _reimbursementCategory;
  final _reimbursementAmount = TextEditingController();
  final _reimbursementDescription = TextEditingController();
  String? _reimbursementReceiptName;
  Uint8List? _reimbursementReceiptBytes;

  @override
  void initState() {
    super.initState();
    widget.controller._attach(this);
    // The Apply button is disabled until the form is complete, so typing has
    // to rebuild the header.
    _reimbursementAmount.addListener(_onReimbursementFieldChanged);
    _reimbursementDescription.addListener(_onReimbursementFieldChanged);
    _leaveReason.addListener(_onLeaveFieldChanged);
  }

  void _onLeaveFieldChanged() {
    if (_page == _QuickPage.applyLeave) setState(() {});
  }

  @override
  void dispose() {
    widget.controller._detach(this);
    _text.dispose();
    _leaveReason.dispose();
    _overtimeNote.dispose();
    _reimbursementAmount.removeListener(_onReimbursementFieldChanged);
    _reimbursementDescription.removeListener(_onReimbursementFieldChanged);
    _leaveReason.removeListener(_onLeaveFieldChanged);
    _reimbursementAmount.dispose();
    _reimbursementDescription.dispose();
    super.dispose();
  }

  void _onReimbursementFieldChanged() {
    if (_page == _QuickPage.applyReimbursement) setState(() {});
  }

  /// The types this org offers, from the dashboard payload.
  List<ReimbursementType> get _reimbursementTypes =>
      widget.dashboard.reimbursementTypes;

  /// The chosen type, or null before one is picked.
  ReimbursementType? get _pickedReimbursementType {
    for (final type in _reimbursementTypes) {
      if (type.name == _reimbursementCategory) return type;
    }
    return null;
  }

  /// Set when the amount is over the chosen type's cap — the server refuses
  /// this too, so catching it here saves a round trip and a rejected claim.
  String? get _reimbursementCapError {
    final type = _pickedReimbursementType;
    final amount = double.tryParse(_reimbursementAmount.text.trim());
    if (type == null || amount == null || amount <= 0) return null;
    if (type.allows(amount)) return null;
    return '${type.name} claims are capped at ₹${formatDays(type.maxLimit)}.';
  }

  /// Every field on the reimbursement form is required, and the amount has to
  /// sit under the cap on the type that was chosen.
  bool get _reimbursementComplete {
    final amount = double.tryParse(_reimbursementAmount.text.trim());
    return _reimbursementCategory != null &&
        _reimbursementDate != null &&
        amount != null &&
        amount > 0 &&
        _reimbursementCapError == null &&
        _reimbursementDescription.text.trim().isNotEmpty &&
        _reimbursementReceiptBytes != null;
  }

  void _open(_QuickPage page) {
    setState(() => _page = page);
    widget.controller._navigationChanged();
  }

  void _back() {
    setState(() {
      if (_page == _QuickPage.policy) {
        _page = _QuickPage.policies;
      } else if (_page == _QuickPage.applyLeave) {
        _page = _QuickPage.leave;
      } else if (_page == _QuickPage.applyOvertime) {
        _page = _QuickPage.overtime;
      } else if (_page == _QuickPage.applyReimbursement) {
        _page = _QuickPage.reimbursements;
      } else if (_page == _QuickPage.wizard && _step > 0) {
        _step--;
        _restoreStepInput(_stepsForCurrentFlow()[_step]);
      } else if (_page == _QuickPage.wizard || _page == _QuickPage.success) {
        _page = switch (_flow) {
          _QuickFlow.leave => _QuickPage.leave,
          _QuickFlow.overtime => _QuickPage.overtime,
          _QuickFlow.reimbursement => _QuickPage.reimbursements,
        };
      } else {
        _page = _QuickPage.home;
      }
    });
    widget.controller._navigationChanged();
  }

  void _restoreStepInput(_FlowStep step) {
    _choice = step.kind == _StepKind.choice || step.kind == _StepKind.dropdown
        ? _answers[step.label]
        : null;
    _text.text = step.kind == _StepKind.text
        ? (_answers[step.label] ?? '')
        : '';
    _dateChosen = step.kind == _StepKind.date || step.kind == _StepKind.dates;
    if (step.kind == _StepKind.upload) {
      _uploadName = _answers[step.label];
    }
  }

  void _backToEdit() {
    setState(() {
      _step--;
      _restoreStepInput(_stepsForCurrentFlow()[_step]);
    });
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 220),
      child: switch (_page) {
        _QuickPage.home => _home(),
        _QuickPage.leave => _leaveHub(),
        _QuickPage.applyLeave => _applyLeaveForm(),
        _QuickPage.overtime => _overtimeHub(),
        _QuickPage.applyOvertime => _applyOvertimeForm(),
        _QuickPage.reimbursements => _reimbursementHub(),
        _QuickPage.applyReimbursement => _applyReimbursementForm(),
        _QuickPage.policies => _policies(),
        _QuickPage.policy => _policyDetail(),
        _QuickPage.calendar => _calendar(),
        _QuickPage.wizard => _wizard(),
        _QuickPage.success => _success(),
      },
    );
  }

  Widget _home() {
    final today = DateTime.now();
    final todayRecord = widget.dashboard.attendance
        .where((record) => _sameDay(record.workDate, today))
        .firstOrNull;
    final punchIn = todayRecord?.punchIn;
    final punchOut = todayRecord?.punchOut;
    // How long the shift runs, from the org's shift policy — never a fixed day.
    final standardShift = widget.dashboard.shift.window;
    final expectedOut = punchIn?.add(standardShift);
    final progress = punchIn == null
        ? 0.0
        : ((punchOut ?? DateTime.now()).difference(punchIn).inMinutes /
                  standardShift.inMinutes)
              .clamp(0.0, 1.0);

    final monthStart = DateTime(today.year, today.month, 1);
    final todayOnly = _dateOnly(today);
    final needsCorrection =
        widget.dashboard.attendance.any(
          (record) =>
              !record.workDate.isBefore(monthStart) &&
              record.workDate.isBefore(todayOnly) &&
              record.punchIn != null &&
              record.punchOut == null &&
              !widget.dashboard.shift.isWeekOff(record.workDate) &&
              !widget.dashboard.holidays.any(
                (holiday) => _sameDay(holiday.date, record.workDate),
              ),
        ) ||
        widget.dashboard.regularizations.any(
          (request) => request.decision == LeaveDecision.pending,
        );

    final leaveDaysAvailable = _accruingLeaveLabels.fold<double>(
      0,
      (total, label) => total + _balanceFor(label)!.remaining,
    );

    return Column(
      key: const ValueKey('quick-home'),
      children: [
        AppHomeHeader(
          profileAction: widget.profileAction,
          onNotifications: widget.onNotifications,
          onQuickCreate: _showQuickCreateComingSoon,
        ),
        Expanded(
          child: ColoredBox(
            color: const Color(0xFFF7F7F9),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 20, 16, 28),
              children: [
                _HomeAttendanceCard(
                  date: today,
                  punchIn: punchIn,
                  punchOut: punchOut,
                  expectedOut: expectedOut,
                  progress: progress,
                  needsCorrection: needsCorrection,
                  onTap: () => _open(_QuickPage.calendar),
                ),
                const SizedBox(height: 16),
                const _HomeSectionLabel('Actions'),
                const SizedBox(height: 2),
                GridView(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  // Without this the grid inherits MediaQuery.padding, which
                  // on a notched phone injected ~59px above the first row —
                  // the long-standing gap under the "Actions" label that never
                  // reproduced on desktop.
                  padding: EdgeInsets.zero,
                  // Fixed row height rather than an aspect ratio: the tiles hold
                  // a fixed-height icon plus two text lines, so deriving height
                  // from width overflows on narrow windows.
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                    // 38 icon + 10 + title + 2 + up to two subtitle lines,
                    // plus 14px padding top and bottom.
                    mainAxisExtent: 142,
                  ),
                  children: [
                    _HomeActionCard(
                      icon: Icons.card_giftcard_rounded,
                      color: const Color(0xFFBE5A36),
                      tint: const Color(0xFFF6E5DB),
                      title: 'Leave',
                      subtitle: '$leaveDaysAvailable days available',
                      onTap: () => _open(_QuickPage.leave),
                      imageAsset: 'assets/icons/action_card_leave_calendar.png',
                    ),
                    if (widget.dashboard.overtimeEnabled)
                      _HomeActionCard(
                        icon: Icons.hourglass_bottom_rounded,
                        color: const Color(0xFFC98A2E),
                        tint: const Color(0xFFF4ECDD),
                        title: 'Overtime',
                        subtitle: 'Request & view hours',
                        onTap: () => _open(_QuickPage.overtime),
                        imageAsset:
                            'assets/icons/action_card_overtime_hourglass.png',
                      ),
                    _HomeActionCard(
                      icon: Icons.payments_rounded,
                      color: const Color(0xFF4F8C89),
                      tint: const Color(0xFFDEEBE9),
                      title: 'Reimbursement',
                      subtitle: 'Track your claims',
                      onTap: () => _open(_QuickPage.reimbursements),
                      imageAsset:
                          'assets/icons/action_card_reimbursement_money.png',
                    ),
                    _HomeActionCard(
                      icon: Icons.edit_note_rounded,
                      color: const Color(0xFF8A6AA0),
                      tint: const Color(0xFFEEE6F0),
                      title: 'View Policies',
                      subtitle: 'Company guidelines',
                      onTap: () => _open(_QuickPage.policies),
                      imageAsset:
                          'assets/icons/action_card_policies_pencil.png',
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _leaveHub() {
    final today = _dateOnly(DateTime.now());
    final requests = [...widget.dashboard.myLeaves]
      ..sort((a, b) => b.start.compareTo(a.start));
    final visible = requests
        .where(
          (item) => _leaveHistoryView
              ? _dateOnly(item.end).isBefore(today)
              : !_dateOnly(item.end).isBefore(today),
        )
        .toList();
    return _HubScaffold(
      key: const ValueKey('leave-hub'),
      title: 'Leave',
      onBack: _back,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: _showQuickCreateComingSoon,
      trailing: _LeaveHeaderButton(onTap: _openBlankLeaveForm),
      backgroundColor: const Color(0xFFF7F7F9),
      children: [
        const _HomeSectionLabel('Leave Balance'),
        const SizedBox(height: 12),
        SizedBox(
          height: 108,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (final label in _accruingLeaveLabels) ...[
                _LeaveBalanceCard(label: label, item: _balanceFor(label)!),
                const SizedBox(width: 8),
              ],
            ],
          ),
        ),
        const SizedBox(height: 4),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: RichText(
            text: TextSpan(
              style: const TextStyle(color: _Q.inkSoft, fontSize: 12),
              children: [
                const TextSpan(text: 'For more information check out our '),
                TextSpan(
                  text: 'leave policy',
                  style: const TextStyle(
                    color: Color(0xFF0571A6),
                    fontWeight: FontWeight.w700,
                  ),
                  recognizer: TapGestureRecognizer()
                    ..onTap = () => _open(_QuickPage.policies),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        LeaveViewSwitch(
          history: _leaveHistoryView,
          onChanged: (history) => setState(() => _leaveHistoryView = history),
        ),
        const SizedBox(height: 12),
        if (visible.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 32),
            child: Center(
              child: Text(
                _leaveHistoryView ? 'No past leave yet.' : 'No upcoming leave.',
                style: const TextStyle(
                  color: _Q.inkFaint,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          )
        else
          ...visible.map(
            (request) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _LeaveRequestCard(request: request),
            ),
          ),
      ],
    );
  }

  /// The leave types HR has left switched on, in the order the policy lists
  /// them. Switching a type off in the dashboard takes it out of the picker,
  /// the balance strip and the day counts here.
  List<String> get _leaveLabels => widget.dashboard.shift.applicableLeaveLabels;

  /// The same list without comp-off, which is earned from overtime rather than
  /// accrued, so it does not belong in the balance strip.
  List<String> get _accruingLeaveLabels => [
    for (final label in _leaveLabels)
      if (_balanceFor(label) != null && _leaveKeyFor(label) != 'comp_off')
        label,
  ];

  /// The policy key behind a display name, so a type HR renames still finds
  /// its balance and its window.
  String _leaveKeyFor(String label) =>
      widget.dashboard.shift.windowForLeave(label)?.key ??
      switch (label) {
        'Casual Leave' => 'casual',
        'Sick Leave' => 'sick',
        'Earned Leave' => 'earned',
        'Comp-off' => 'comp_off',
        _ => '',
      };

  LeaveBalanceItem? _balanceFor(String label) {
    final balance = widget.dashboard.leaveBalance;
    return switch (_leaveKeyFor(label)) {
      'casual' => balance.casual,
      'sick' => balance.sick,
      'earned' => balance.earned,
      'comp_off' => balance.compOff,
      _ => null,
    };
  }

  Widget _applyLeaveForm() {
    final double? balanceForType = _leaveType == null
        ? null
        : _balanceFor(_leaveType!)?.remaining;
    return _HubScaffold(
      key: const ValueKey('apply-leave'),
      title: 'Leave',
      onBack: _back,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: _showQuickCreateComingSoon,
      trailing: _LeaveHeaderButton(
        enabled: _leaveFormComplete,
        onTap: _submitLeaveApplication,
      ),
      backgroundColor: const Color(0xFFF7F7F9),
      children: [
        if (_leaveFormBlockedReason case final reason?) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFFEE2E2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              reason,
              style: const TextStyle(
                color: Color(0xFFB3261E),
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(height: 12),
        ],
        if (balanceForType != null) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFDBEAFE),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              'Available balance: ${formatDays(balanceForType)} '
              '${switch (_leaveType) {
                'Casual Leave' => 'casual',
                'Sick Leave' => 'sick',
                'Earned Leave' => 'earned',
                _ => 'comp-off',
              }} days',
              style: const TextStyle(
                color: Color(0xFF2563EB),
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(height: 12),
        ],
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: .04),
                blurRadius: 2,
                offset: const Offset(0, 1),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _LeaveFieldLabel('Leave Type'),
              _LeaveDropdownField(
                value: _leaveType ?? 'Select leave type',
                filled: _leaveType != null,
                onTap: _pickLeaveType,
              ),
              const SizedBox(height: 16),
              _LeaveFieldLabel('Start Date'),
              _LeaveDropdownField(
                value: _leaveFrom == null ? 'Select date' : _short(_leaveFrom!),
                filled: _leaveFrom != null,
                onTap: () => _pickLeaveFormDate(isStart: true),
              ),
              const SizedBox(height: 16),
              _LeaveFieldLabel('End Date'),
              _LeaveDropdownField(
                value: _leaveTo == null ? 'Select date' : _short(_leaveTo!),
                filled: _leaveTo != null,
                onTap: () => _pickLeaveFormDate(isStart: false),
              ),
              const SizedBox(height: 16),
              _LeaveFieldLabel('Duration'),
              _LeaveDropdownField(
                value: _leaveDurationLabel,
                filled: true,
                onTap: _pickLeaveDuration,
              ),
              const SizedBox(height: 16),
              _LeaveFieldLabel('Reason'),
              Container(
                decoration: BoxDecoration(
                  border: Border.all(color: const Color(0xFFE5E7EB)),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: TextField(
                  controller: _leaveReason,
                  maxLines: 3,
                  style: const TextStyle(
                    fontSize: 14,
                    color: Color(0xFF111827),
                  ),
                  decoration: const InputDecoration(
                    hintText: 'Add a reason...',
                    hintStyle: TextStyle(color: Color(0x80111827)),
                    filled: false,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    disabledBorder: InputBorder.none,
                    errorBorder: InputBorder.none,
                    focusedErrorBorder: InputBorder.none,
                    contentPadding: EdgeInsets.all(12),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              _LeaveFieldLabel('Attachment (Optional)'),
              _LeaveAttachmentField(
                fileName: _leaveAttachmentName,
                onPicked: (name) => setState(() => _leaveAttachmentName = name),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _pickLeaveType() async {
    String left(LeaveBalanceItem item) =>
        '${formatDays(item.remaining)}/${formatDays(item.total)}';
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => _LeavePickerSheet(
        options: _leaveLabels,
        selected: _leaveType,
        unavailable: {
          if (_leaveFrom case final from?)
            for (final label in _leaveLabels)
              if (leaveRangeProblem(
                    policy: widget.dashboard.shift,
                    holidayDates: _holidayKeys,
                    typeLabel: label,
                    from: from,
                    to: _leaveTo ?? from,
                    today: DateTime.now(),
                    maxDays: _maxLeaveApplyDays,
                    availableDays: _balanceFor(label)?.remaining,
                  )
                  case final reason?)
                label: reason,
        },
        trailingLabels: {
          for (final label in _leaveLabels)
            if (_balanceFor(label) != null) label: left(_balanceFor(label)!),
        },
      ),
    );
    if (picked == null || !mounted) return;
    setState(() => _leaveType = picked);
  }

  Future<void> _pickLeaveDuration() async {
    // A half day only makes sense on a single date.
    if (!_isSingleDayLeave) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('A half day can only be applied for a single date.'),
        ),
      );
      return;
    }
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => _LeavePickerSheet(
        options: const ['Full Day', 'Half Day'],
        selected: _leaveDuration,
      ),
    );
    if (picked == null || !mounted) return;
    setState(() => _leaveDuration = picked);
  }

  Future<void> _pickLeaveFormDate({required bool isStart}) async {
    final today = _dateOnly(DateTime.now());
    final initial = isStart
        ? (_leaveFrom ?? today)
        : (_leaveTo ?? _leaveFrom ?? today);
    final window = _leaveWindow;
    final first = window == null ? today : _dateOnly(window.earliestFrom(today));
    final last = window == null
        ? today.add(const Duration(days: 365))
        : _dateOnly(window.latestFrom(today));
    final start = initial.isBefore(first)
        ? first
        : initial.isAfter(last)
        ? last
        : initial;
    final picked = await showDatePicker(
      context: context,
      initialDate: start,
      firstDate: first,
      lastDate: last,
      selectableDayPredicate: _canSelectLeaveDay,
      builder: _pickerTheme,
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (isStart) {
        _leaveFrom = picked;
        if (_leaveTo != null && _leaveTo!.isBefore(picked)) _leaveTo = picked;
      } else {
        _leaveTo = picked;
        if (_leaveFrom != null && _leaveFrom!.isAfter(picked)) {
          _leaveFrom = picked;
        }
      }
      // Half day is single-date only, so a widened range drops back to a full
      // day rather than silently submitting an impossible combination.
      if (!_isSingleDayLeave) _leaveDuration = 'Full Day';
    });
  }

  /// "Full Day · 3 days" — the duration choice plus the days it will consume,
  /// so the count is visible before applying.
  String get _leaveDurationLabel {
    final from = _leaveFrom;
    if (from == null) return _leaveDuration;
    if (_leaveDuration == 'Half Day') return 'Half Day · 0.5 day';
    final days = _leaveDaysBetween(from, _leaveTo ?? from);
    return 'Full Day · $days ${days == 1 ? 'day' : 'days'}';
  }

  /// Every leave field except the attachment, which stays optional. The range
  /// must also cost at least one day — an all-week-off range is not a leave.
  bool get _leaveFormComplete {
    if (_leaveType == null || _leaveFrom == null) return false;
    if (_leaveReason.text.trim().isEmpty) return false;
    // One rule, shared with every other apply-leave surface: the Apply button
    // is off for anything the server would refuse.
    return _leaveFormBlockedReason == null;
  }

  /// Why the leave form cannot be submitted yet, for the line at the top of
  /// the form. Null once everything is in order.
  String? get _leaveFormBlockedReason {
    final from = _leaveFrom;
    final type = _leaveType;
    if (type == null || from == null) return null;
    return leaveRangeProblem(
      policy: widget.dashboard.shift,
      holidayDates: _holidayKeys,
      typeLabel: type,
      from: from,
      to: _leaveTo ?? from,
      today: DateTime.now(),
      maxDays: _maxLeaveApplyDays,
      halfDay: _leaveDuration == 'Half Day',
      availableDays: _balanceFor(type)?.remaining,
    );
  }

  /// The company holidays this employee observes, as yyyy-mm-dd keys.
  Set<String> get _holidayKeys => {
    for (final holiday in widget.dashboard.holidays)
      '${holiday.date.year.toString().padLeft(4, '0')}-'
          '${holiday.date.month.toString().padLeft(2, '0')}-'
          '${holiday.date.day.toString().padLeft(2, '0')}',
  };

  /// True when the leave covers exactly one date — the only case where a half
  /// day can be applied.
  bool get _isSingleDayLeave {
    final from = _leaveFrom;
    if (from == null) return true;
    final to = _leaveTo ?? from;
    return _sameDay(from, to);
  }

  /// Whether the day selected on the calendar can be applied for under any
  /// leave type the org runs. No type is chosen at this point, so a day counts
  /// as applicable if at least one type's window covers it.
  bool get _calendarDayApplicable => _calendarDayBlockedReason == null &&
      _selectedCalendarDay != null;

  /// The leave types that would accept [date] — the windows differ per type,
  /// so a day can be too far ahead for casual and fine for earned.
  List<String> _leaveTypesFor(DateTime date) => [
    for (final label in _leaveLabels)
      if (leaveRangeProblem(
            policy: widget.dashboard.shift,
            holidayDates: _holidayKeys,
            typeLabel: label,
            from: _dateOnly(date),
            to: _dateOnly(date),
            today: DateTime.now(),
            maxDays: _maxLeaveApplyDays,
            availableDays: _balanceFor(label)?.remaining,
          ) ==
          null)
        label,
  ];

  /// Why the selected day cannot be applied for, or null when it can.
  String? get _calendarDayBlockedReason {
    final selected = _selectedCalendarDay;
    if (selected == null) return 'no day is selected.';
    final date = _dateOnly(selected.date);
    final labels = _leaveLabels;
    if (labels.isEmpty) return 'no leave types are set up.';
    String? firstReason;
    for (final label in labels) {
      final reason = leaveRangeProblem(
        policy: widget.dashboard.shift,
        holidayDates: _holidayKeys,
        typeLabel: label,
        from: date,
        to: date,
        today: DateTime.now(),
        maxDays: _maxLeaveApplyDays,
        availableDays: _balanceFor(label)?.remaining,
      );
      if (reason == null) return null;
      firstReason ??= reason;
    }
    // Every type refused it. A week-off or holiday refusal is the same
    // whichever type asked, so that message reads correctly; otherwise it is
    // a window, and the windows differ per type.
    return firstReason != null &&
            (firstReason.contains('week-off') || firstReason.contains('holiday'))
        ? firstReason.replaceFirst('That day is a ', 'this is a ')
        : 'this day is outside the window for every leave type.';
  }

  void _applyLeaveFor(DateTime date) {
    // Opens on a type this day can be applied for. Landing on the form with
    // no type, then discovering casual does not reach the date, was the
    // long way round to the same answer.
    final types = _leaveTypesFor(date);
    setState(() {
      _leaveFrom = date;
      _leaveTo = date;
      _leaveType = types.length == 1 ? types.first : null;
      _leaveDuration = 'Full Day';
      _leaveReason.clear();
      _leaveAttachmentName = null;
      _selectedCalendarDay = null;
      _page = _QuickPage.applyLeave;
    });
    widget.controller._navigationChanged();
  }

  void _showQuickCreateComingSoon() {
    widget.onOpenComposer();
  }

  void _openBlankLeaveForm() {
    setState(() {
      _leaveFrom = null;
      _leaveTo = null;
      _leaveType = null;
      _leaveDuration = 'Full Day';
      _leaveReason.clear();
      _leaveAttachmentName = null;
      _page = _QuickPage.applyLeave;
    });
    widget.controller._navigationChanged();
  }

  Future<void> _submitLeaveApplication() async {
    if (!_leaveFormComplete) return;
    final type = _leaveType!;
    final from = _leaveFrom!;
    final to = _leaveTo ?? from;
    final sent = await widget.bloc.add(
      SubmitLeaveApplication(
        type: type.replaceAll(' Leave', ''),
        startDate: from,
        endDate: to,
        reason: _leaveReason.text.trim(),
        halfDay: _leaveDuration == 'Half Day' && _isSingleDayLeave,
      ),
    );
    if (!mounted || !sent) return;
    setState(() {
      _leaveHistoryView = false;
      _page = _QuickPage.leave;
    });
    widget.controller._navigationChanged();
  }

  Widget _overtimeHub() {
    final requests = widget.dashboard.myOvertime;
    // Summarises every request shown in the list below. Scoping this to the
    // current calendar month meant a pending request from an earlier month sat
    // in the list while the totals above it read zero.
    final thisMonth = requests;
    final totalHours = thisMonth
        .where((request) => request.decision != LeaveDecision.declined)
        .fold<double>(0, (sum, request) => sum + request.hours);
    final approvedHours = thisMonth
        .where((request) => request.decision == LeaveDecision.approved)
        .fold<double>(0, (sum, request) => sum + request.hours);
    final pendingHours = thisMonth
        .where((request) => request.decision == LeaveDecision.pending)
        .fold<double>(0, (sum, request) => sum + request.hours);
    final visible = requests
        .where(
          (request) => _overtimeHistoryView
              ? request.decision != LeaveDecision.pending
              : request.decision == LeaveDecision.pending,
        )
        .toList();
    return _HubScaffold(
      key: const ValueKey('overtime-hub'),
      title: 'Overtime',
      onBack: _back,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: _showQuickCreateComingSoon,
      trailing: _LeaveHeaderButton(
        label: 'Apply Overtime',
        onTap: _openOvertimeForm,
      ),
      backgroundColor: const Color(0xFFF7F7F9),
      children: [
        _QuickStatsCard(
          label: 'Overview',
          stats: [
            (_hoursMinutesLabel(totalHours), 'Total', const Color(0xFF111827)),
            // Same order as the reimbursement overview: total, pending, then
            // approved.
            (
              _hoursMinutesLabel(pendingHours),
              'Pending',
              const Color(0xFFFB2C36),
            ),
            (
              _hoursMinutesLabel(approvedHours),
              'Approved',
              const Color(0xFF16A34A),
            ),
          ],
        ),
        const SizedBox(height: 16),
        LeaveViewSwitch(
          history: _overtimeHistoryView,
          onChanged: (value) => setState(() => _overtimeHistoryView = value),
          firstLabel: 'Requests',
        ),
        const SizedBox(height: 16),
        if (visible.isEmpty)
          const _InfoCard('Nothing here yet.')
        else
          ...visible.map(
            (request) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _QuickRequestCard(
                title: _short(request.workDate),
                subtitle: request.note.isEmpty
                    ? request.timeRangeLabel
                    : request.note,
                status: _decision(request.decision),
                statusColor: switch (request.decision) {
                  LeaveDecision.approved => const Color(0xFF16A34A),
                  _ => const Color(0xFFFB2C36),
                },
                footerText: request.hoursLabel,
                onViewDetails: () => showRequestDetailsSheet(
                  context,
                  title: 'Overtime',
                  statusLabel: _decision(request.decision),
                  statusColor: switch (request.decision) {
                    LeaveDecision.approved => const Color(0xFF16A34A),
                    LeaveDecision.declined => const Color(0xFF6B7280),
                    LeaveDecision.pending => const Color(0xFFFB2C36),
                  },
                  statusTint: switch (request.decision) {
                    LeaveDecision.approved => const Color(0xFFDCFCE7),
                    LeaveDecision.declined => const Color(0xFFF3F4F6),
                    LeaveDecision.pending => const Color(0xFFFEE2E2),
                  },
                  rows: [
                    ('Work date', _short(request.workDate)),
                    ('Hours', request.hoursLabel),
                    ('Time', request.timeRangeLabel),
                    ('Applied on', _short(request.requestedOn)),
                    ('Note', request.note),
                  ],
                  responseLabel: switch (request.decision) {
                    LeaveDecision.pending => '',
                    LeaveDecision.approved => 'Approved by your manager',
                    LeaveDecision.declined => 'Declined by your manager',
                  },
                  responseNote: request.managerNote,
                ),
              ),
            ),
          ),
      ],
    );
  }

  void _openOvertimeForm() {
    setState(() {
      _overtimeDate = null;
      _overtimeDuration = null;
      _overtimeNote.clear();
      _page = _QuickPage.applyOvertime;
    });
    widget.controller._navigationChanged();
  }

  Widget _applyOvertimeForm() {
    return _HubScaffold(
      key: const ValueKey('apply-overtime'),
      title: 'Overtime',
      onBack: _back,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: _showQuickCreateComingSoon,
      trailing: _LeaveHeaderButton(
        label: 'Apply Overtime',
        // Off until the date and duration are both valid for the policy.
        enabled: _overtimeFormComplete,
        onTap: _submitOvertimeApplication,
      ),
      backgroundColor: const Color(0xFFF7F7F9),
      children: [
        _FormCard(
          children: [
            _LeaveFieldLabel('Date'),
            _LeaveDropdownField(
              value: _overtimeDate == null
                  ? 'Select date'
                  : _short(_overtimeDate!),
              filled: _overtimeDate != null,
              onTap: _pickOvertimeDate,
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Duration'),
            _LeaveDropdownField(
              value: _overtimeDuration ?? 'Select duration',
              filled: _overtimeDuration != null,
              onTap: _pickOvertimeDuration,
            ),
            if (_overtimeDuration != null) ...[
              const SizedBox(height: 8),
              Text(
                _overtimeDuration == 'Full day'
                    ? 'A full day of overtime earns 1 comp-off day.'
                    : 'A half day of overtime earns 0.5 comp-off days.',
                style: const TextStyle(
                  color: Color(0xFF717171),
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
            const SizedBox(height: 16),
            _LeaveFieldLabel('Reason'),
            _FormTextArea(controller: _overtimeNote, height: 85.6),
          ],
        ),
      ],
    );
  }

  Future<void> _pickOvertimeDuration() async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => _LeavePickerSheet(
        options: const ['Full day', 'Half day'],
        selected: _overtimeDuration,
        trailingLabels: const {
          'Full day': 'comp-off +1',
          'Half day': 'comp-off +0.5',
        },
      ),
    );
    if (picked == null || !mounted) return;
    // A full day is only claimable on a week-off or holiday, so a date already
    // chosen may no longer be valid for the new duration.
    setState(() {
      _overtimeDuration = picked;
      final date = _overtimeDate;
      if (date != null && !_canSelectOvertimeFormDay(date)) _overtimeDate = null;
    });
  }

  Future<void> _pickOvertimeDate() async {
    final today = _dateOnly(DateTime.now());
    // Today is claimable: a day worked today is overtime like any other.
    final lastSelectable = today;
    final initial = _overtimeDate ?? lastSelectable;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial.isAfter(lastSelectable) ? lastSelectable : initial,
      firstDate: today.subtract(const Duration(days: 365)),
      lastDate: lastSelectable,
      selectableDayPredicate: _canSelectOvertimeFormDay,
      builder: _pickerTheme,
    );
    if (picked == null || !mounted) return;
    setState(() => _overtimeDate = picked);
  }

  /// The hours a duration is worth, from the shift the employee is on — never
  /// a fixed eight.
  Duration get _overtimeWorked => _overtimeDuration == 'Full day'
      ? widget.dashboard.shift.minFullDay
      : widget.dashboard.shift.minHalfDay;

  bool _canSelectOvertimeFormDay(DateTime day) {
    final today = _dateOnly(DateTime.now());
    // Today counts — only a future day is out. How far back is the policy's.
    if (day.isAfter(today)) return false;
    return !day.isBefore(_overtimeWindowStart);
  }

  /// Whether the overtime form holds something the server would accept: a
  /// duration, and a date inside the backdating window.
  bool get _overtimeFormComplete {
    final date = _overtimeDate;
    if (date == null || _overtimeDuration == null) return false;
    return _canSelectOvertimeFormDay(date);
  }

  Future<void> _submitOvertimeApplication() async {
    final date = _overtimeDate;
    final duration = _overtimeDuration;
    if (date == null || duration == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pick a date and a duration to continue.')),
      );
      return;
    }
    // The claim carries the hours the duration is worth on this employee's own
    // shift, so the server classifies it as the same thing they picked.
    final worked = _overtimeWorked;
    final start = widget.dashboard.shift.startMinutes ?? 9 * 60;
    final startDateTime = DateTime(
      date.year, date.month, date.day, start ~/ 60, start % 60,
    );
    final sent = await widget.bloc.add(
      SubmitOvertimeApplication(
        workDate: date,
        startTime: startDateTime,
        endTime: startDateTime.add(worked),
        note: _overtimeNote.text.trim(),
      ),
    );
    if (!mounted || !sent) return;
    setState(() => _page = _QuickPage.overtime);
    widget.controller._navigationChanged();
  }

  Widget _reimbursementHub() {
    final claims = widget.dashboard.myReimbursements;
    // Every claim in the list below, for the same reason as overtime.
    final thisMonth = claims;
    final claimed = thisMonth.fold<double>(
      0,
      (sum, claim) => sum + claim.amount,
    );
    // Approved counts as reimbursed here: it has cleared review and is no
    // longer pending, and the card only has the two buckets. Counting only
    // 'Paid' meant approved claims fell out of both and read as zero.
    final reimbursed = thisMonth
        .where((claim) => claim.status == 'Paid' || claim.status == 'Approved')
        .fold<double>(0, (sum, claim) => sum + claim.amount);
    final pending = thisMonth
        .where((claim) => claim.status == 'Pending')
        .fold<double>(0, (sum, claim) => sum + claim.amount);
    final visible = claims
        .where(
          (claim) => _reimbursementHistoryView
              ? claim.status != 'Pending'
              : claim.status == 'Pending',
        )
        .toList();
    return _HubScaffold(
      key: const ValueKey('reimbursement-hub'),
      title: 'Reimbursement',
      onBack: _back,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: _showQuickCreateComingSoon,
      trailing: _LeaveHeaderButton(
        label: 'Apply',
        onTap: _openReimbursementForm,
      ),
      backgroundColor: const Color(0xFFF7F7F9),
      children: [
        _QuickStatsCard(
          label: 'Overview',
          stats: [
            (_money(claimed), 'Total Claimed', const Color(0xFF111827)),
            (_money(pending), 'Pending', const Color(0xFFFB2C36)),
            (_money(reimbursed), 'Approved', const Color(0xFF16A34A)),
          ],
        ),
        const SizedBox(height: 16),
        LeaveViewSwitch(
          history: _reimbursementHistoryView,
          onChanged: (value) =>
              setState(() => _reimbursementHistoryView = value),
          firstLabel: 'Claims',
        ),
        const SizedBox(height: 16),
        if (visible.isEmpty)
          const _InfoCard('Nothing here yet.')
        else
          ...visible.map(
            (claim) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _QuickRequestCard(
                title: claim.category,
                subtitle: _short(claim.expenseDate),
                status: '${_money(claim.amount)} · ${claim.statusLabel}',
                statusColor: switch (claim.status) {
                  'Paid' || 'Approved' => const Color(0xFF16A34A),
                  _ => const Color(0xFFFB2C36),
                },
                onViewDetails: () => showRequestDetailsSheet(
                  context,
                  title: '${claim.category} claim',
                  statusLabel: claim.statusLabel,
                  statusColor: switch (claim.status) {
                    'Paid' || 'Approved' => const Color(0xFF16A34A),
                    'Declined' => const Color(0xFF6B7280),
                    _ => const Color(0xFFFB2C36),
                  },
                  statusTint: switch (claim.status) {
                    'Paid' || 'Approved' => const Color(0xFFDCFCE7),
                    'Declined' => const Color(0xFFF3F4F6),
                    _ => const Color(0xFFFEE2E2),
                  },
                  rows: [
                    ('Type', claim.category),
                    ('Amount', _money(claim.amount)),
                    ('Expense date', _short(claim.expenseDate)),
                    ('Claimed on', _short(claim.createdAt)),
                    if (claim.receiptName.isNotEmpty)
                      ('Receipt', claim.receiptName),
                    ('Note', claim.note),
                  ],
                  responseLabel: switch (claim.status) {
                    'Paid' || 'Approved' => 'Approved by HR',
                    'Declined' => 'Declined by HR',
                    _ => '',
                  },
                  responseNote: claim.managerNote,
                ),
              ),
            ),
          ),
      ],
    );
  }

  void _openReimbursementForm() {
    setState(() {
      _reimbursementDate = null;
      _reimbursementCategory = null;
      _reimbursementAmount.clear();
      _reimbursementDescription.clear();
      _reimbursementReceiptName = null;
      _reimbursementReceiptBytes = null;
      _page = _QuickPage.applyReimbursement;
    });
    widget.controller._navigationChanged();
  }

  Widget _applyReimbursementForm() {
    return _HubScaffold(
      key: const ValueKey('apply-reimbursement'),
      title: 'Reimbursement',
      onBack: _back,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: _showQuickCreateComingSoon,
      trailing: _LeaveHeaderButton(
        label: 'Apply',
        enabled: _reimbursementComplete,
        onTap: _submitReimbursementApplication,
      ),
      backgroundColor: const Color(0xFFF7F7F9),
      children: [
        _FormCard(
          children: [
            _LeaveFieldLabel('Expense Category'),
            _LeaveDropdownField(
              value: _reimbursementCategory ?? 'Select category',
              filled: _reimbursementCategory != null,
              onTap: _pickReimbursementCategory,
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Amount (₹)'),
            _FormTextField(
              controller: _reimbursementAmount,
              hintText: 'Enter amount',
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
            ),
            if (_reimbursementCapError != null) ...[
              const SizedBox(height: 8),
              Text(
                _reimbursementCapError!,
                style: const TextStyle(
                  color: Color(0xFFC4382E),
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
            const SizedBox(height: 16),
            _LeaveFieldLabel('Date'),
            if (_pickedReimbursementType != null) ...[
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(
                  _pickedReimbursementType!.backdateDays == 0
                      ? 'Can only be claimed for today.'
                      : 'Can be claimed up to ${_pickedReimbursementType!.backdateDays} days back.',
                  style: const TextStyle(
                    color: Color(0xFF717171),
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
            _LeaveDropdownField(
              value: _reimbursementDate == null
                  ? 'Select date'
                  : _short(_reimbursementDate!),
              filled: _reimbursementDate != null,
              onTap: _pickReimbursementDate,
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Description'),
            _FormTextArea(
              controller: _reimbursementDescription,
              height: 65.6,
              hintText: 'Brief description...',
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Receipt'),
            _ReceiptUploadField(
              fileName: _reimbursementReceiptName,
              onPicked: (file) => setState(() {
                _reimbursementReceiptName = file?.name;
                _reimbursementReceiptBytes = file?.bytes;
              }),
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _pickReimbursementCategory() async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => _LeavePickerSheet(
        options: _reimbursementTypes.map((type) => type.name).toList(),
        selected: _reimbursementCategory,
        trailingLabels: {
          for (final type in _reimbursementTypes)
            type.name: [
              if (type.maxLimit > 0) 'up to ₹${formatDays(type.maxLimit)}',
              type.backdateDays == 0
                  ? 'today only'
                  : '${type.backdateDays}d back',
            ].join(' · '),
        },
      ),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _reimbursementCategory = picked;
      // The new type may not reach back as far as the date already chosen.
      final date = _reimbursementDate;
      final type = _pickedReimbursementType;
      if (date != null && type != null &&
          date.isBefore(type.earliestClaimableFrom(_dateOnly(DateTime.now())))) {
        _reimbursementDate = null;
      }
    });
  }

  Future<void> _pickReimbursementDate() async {
    final today = _dateOnly(DateTime.now());
    final initial = _reimbursementDate ?? today;
    // Only as far back as this type allows — the server refuses anything older.
    final earliest = _pickedReimbursementType?.earliestClaimableFrom(today)
        ?? today.subtract(const Duration(days: 365));
    final picked = await showDatePicker(
      context: context,
      initialDate: initial.isAfter(today) || initial.isBefore(earliest) ? today : initial,
      firstDate: earliest,
      lastDate: today,
      builder: _pickerTheme,
    );
    if (picked == null || !mounted) return;
    setState(() => _reimbursementDate = picked);
  }

  Future<void> _submitReimbursementApplication() async {
    if (!_reimbursementComplete) return;
    final date = _reimbursementDate!;
    final category = _reimbursementCategory!;
    final amount = double.parse(_reimbursementAmount.text.trim());
    final sent = await widget.bloc.add(
      SubmitReimbursementApplication(
        expenseDate: date,
        amount: amount.toStringAsFixed(2),
        category: category,
        receiptName: _reimbursementReceiptName ?? '',
        receiptBytes: _reimbursementReceiptBytes,
        note: _reimbursementDescription.text.trim(),
      ),
    );
    if (!mounted || !sent) return;
    setState(() => _page = _QuickPage.reimbursements);
    widget.controller._navigationChanged();
  }

  Widget _policies() {
    return _HubScaffold(
      key: const ValueKey('policies'),
      title: 'Policies',
      onBack: _back,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: _showQuickCreateComingSoon,
      backgroundColor: const Color(0xFFF7F7F9),
      children: [
        // One list, one treatment — the coloured icon tiles made four policies
        // read as four unrelated products.
        ..._policiesData.map(
          (policy) => Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: _PolicyRow(
              title: policy.title,
              onTap: () => setState(() {
                _policy = policy;
                _page = _QuickPage.policy;
              }),
            ),
          ),
        ),
      ],
    );
  }

  Widget _policyDetail() {
    final policy = _policy!;
    // Written from what HR saved, so the app never states a rule the policy
    // does not. Paragraphs are separated by blank lines in the source text.
    final body = switch (policy.title) {
      'Leave' => _leavePolicyText(),
      'Attendance' => _attendancePolicyText(),
      'Overtime' => _overtimePolicyText(),
      'Reimbursement' || 'Claims' => _claimsPolicyText(),
      _ => policy.body,
    };
    final paragraphs = body
        .split('\n\n')
        .map((part) => part.trim())
        .where((part) => part.isNotEmpty)
        .toList();
    return _HubScaffold(
      key: ValueKey('policy-${policy.title}'),
      title: '${policy.title} policy',
      onBack: _back,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: _showQuickCreateComingSoon,
      backgroundColor: const Color(0xFFF7F7F9),
      children: [
        Text(policy.title, style: _QText.heroSmall),
        const SizedBox(height: 6),
        const Text(
          'As your company has it set up today.',
          style: TextStyle(color: _Q.inkSoft, fontSize: 13),
        ),
        const SizedBox(height: 16),
        for (final paragraph in paragraphs) ...[
          _FormCard(
            children: [
              Text(
                paragraph,
                style: const TextStyle(
                  color: Color(0xFF2A2A2A),
                  fontSize: 14.5,
                  height: 1.6,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
        ],
      ],
    );
  }

  /// The leave policy in words, from the types HR runs and the windows set.
  String _leavePolicyText() {
    final types = widget.dashboard.shift.leaveTypes;
    if (types.isEmpty) {
      return 'Your leave types and balances are set by HR. Check the Leave '
          'screen for what you have left this year.';
    }
    final lines = <String>[];
    for (final type in types) {
      final balance = _balanceFor(type.name);
      final allowance = balance == null
          ? type.name
          : '${type.name} — ${formatDays(balance.total)} days a year, '
                '${formatDays(balance.remaining)} left';
      final window = type.allowBackdated && type.backdatedDays > 0
          ? 'Can be applied up to ${type.advanceDays} days ahead, or up to '
                '${type.backdatedDays} days after the fact.'
          : 'Can be applied up to ${type.advanceDays} days ahead, and not for '
                'a day already past.';
      lines.add('$allowance.\n$window');
    }
    return '${lines.join('\n\n')}\n\nWeek-offs and company holidays inside a '
        'leave range are not counted against your balance.';
  }

  /// Attendance in words, from the shift HR saved for this employee.
  String _attendancePolicyText() {
    final shift = widget.dashboard.shift;
    final correction = shift.correction;
    final days = <String>[
      for (var index = 0; index < 7; index++)
        if (shift.isWeekOffWeekday(index)) _fullWeekdayNames[index],
    ];
    return [
      if (shift.startTime.isNotEmpty && shift.endTime.isNotEmpty)
        'Your shift runs ${shift.startTime}–${shift.endTime}'
            '${shift.name.isEmpty ? '' : ' (${shift.name})'}.',
      'A day counts as a full day at ${formatDays(shift.minFullDayHours)} '
          'hours and as a half day at ${formatDays(shift.minHalfDayHours)}.',
      'You are marked late after ${shift.lateGraceMinutes} minutes past the '
          'start, and as an early-out if you leave more than '
          '${shift.earlyOutGraceMinutes} minutes before the end.',
      if (days.isNotEmpty) 'Week-offs: ${days.join(', ')}.',
      if (correction.punchFormat.isNotEmpty)
        'Punches are captured by ${correction.punchFormat}.',
      if (correction.triggers.isNotEmpty)
        'A correction can be raised for: '
            '${correction.triggers.join(', ').toLowerCase()} — up to '
            '${correction.backdateDays} days back.',
      'Week-offs and company holidays are not up for correction; claim '
          'overtime if you worked one.',
    ].join('\n\n');
  }

  /// Overtime in words: whether it is open to this employee, what each
  /// duration is worth as comp-off, and how far back it may go.
  String _overtimePolicyText() {
    final shift = widget.dashboard.shift;
    if (!widget.dashboard.overtimeEnabled) {
      return 'Overtime is not enabled for your team. Speak to HR if you think '
          'it should be.';
    }
    return [
      'Overtime is claimed as a full day or a half day, and needs your '
          "manager's approval.",
      'A full day is ${formatDays(shift.minFullDayHours)} hours and credits 1 '
          'day of comp-off. A half day is '
          '${formatDays(shift.minHalfDayHours)} hours and credits 0.5.',
      'Claims reach back up to ${shift.overtimeBackdateDays} days.',
    ].join('\n\n');
  }

  /// Claims in words, from the reimbursement types HR set up.
  String _claimsPolicyText() {
    final types = widget.dashboard.reimbursementTypes;
    if (types.isEmpty) {
      return 'Your company has not set up reimbursement types yet.';
    }
    return [
      for (final type in types)
        [
          type.name,
          if (type.description.isNotEmpty) type.description,
          type.maxLimit > 0
              ? 'Capped at ${_money(type.maxLimit)} per claim.'
              : 'No cap per claim.',
          type.backdateDays > 0
              ? 'Can be claimed up to ${type.backdateDays} days after the '
                    'expense.'
              : 'Must be claimed on the day of the expense.',
        ].join(' — '),
    ].join('\n\n');
  }

  Widget _calendar() {
    final days = _attendanceDays();
    return _HubScaffold(
      key: const ValueKey('calendar'),
      title: 'Attendance',
      onBack: _back,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: _showQuickCreateComingSoon,
      backgroundColor: const Color(0xFFF7F7F9),
      trailing: _LeaveHeaderButton(
        // Off unless the selected day is one some leave type can actually be
        // applied for — opening the form on a day the policy refuses only
        // moves the disappointment one screen later.
        enabled: _calendarDayApplicable,
        onTap: _calendarDayApplicable
            ? () => _applyLeaveFor(_selectedCalendarDay!.date)
            : null,
      ),
      children: [
        Row(
          children: [
            AttendanceCalendarArrow(
              onPressed: () => _changeAttendanceMonth(-1),
              asset: 'assets/icons/calendar_chevron_prev.svg',
            ),
            Expanded(
              child: Text(
                '${_monthName(_attendanceMonth.month)} ${_attendanceMonth.year}',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFF2A2A2A),
                  fontSize: 16,
                  fontWeight: FontWeight.w400,
                ),
              ),
            ),
            AttendanceCalendarArrow(
              onPressed: () => _changeAttendanceMonth(1),
              asset: 'assets/icons/calendar_chevron_next.svg',
            ),
          ],
        ),
        const SizedBox(height: 24),
        LeaveViewSwitch(
          history: _attendanceListView,
          onChanged: (list) => setState(() => _attendanceListView = list),
          firstLabel: 'Grid',
          secondLabel: 'List',
        ),
        const SizedBox(height: 16),
        AttendanceFilterChips(
          selected: _attendanceFilter,
          onChanged: (filter) => setState(() => _attendanceFilter = filter),
        ),
        const SizedBox(height: 20),
        Text(
          switch (_selectedCalendarDay) {
            null => 'Tap a working day you can still apply for, then Apply '
                'Leave.',
            final day when !_calendarDayApplicable =>
              '${_short(day.date)} — ${_calendarDayBlockedReason ?? 'this day '
                  'cannot be applied for.'}',
            final day => switch (_leaveTypesFor(day.date)) {
              // Naming the types matters when only some of them reach this
              // far: casual runs out long before earned does.
              final types when types.length < _leaveLabels.length =>
                'Selected ${_short(day.date)} — can be applied as '
                    '${types.join(' or ')}.',
              _ =>
                'Selected ${_short(day.date)} — tap Apply Leave, or tap the '
                    'date again to clear.',
            },
          },
          style: _QText.subtitle,
        ),
        const SizedBox(height: 20),
        if (_attendanceListView)
          ...days.map(
            (day) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: AttendanceListCard(
                day: day,
                today: _sameDay(day.date, DateTime.now()),
                dimmed: !matchesAttendanceFilter(day, _attendanceFilter),
                selected: _sameDay(day.date, _selectedCalendarDay?.date),
                onTap: () => _openAttendanceDay(day),
              ),
            ),
          )
        else ...[
          AttendanceMonthGrid(
            month: _attendanceMonth,
            days: days,
            filter: _attendanceFilter,
            selectedDate: _selectedCalendarDay?.date,
            onTap: _openAttendanceDay,
          ),
          if (_calendarDetailDay(days) case final detail?) ...[
            const SizedBox(height: 16),
            AttendanceDayDetail(
              day: detail,
              onRequestCorrection: _correctionBlockedReason(detail) == null
                  ? () => _showRegularization(detail.date)
                  : null,
              correctionBlockedReason: _correctionBlockedReason(detail),
            ),
          ],
        ],
      ],
    );
  }

  /// Day shown in the detail strip under the grid: the tapped day when one is
  /// selected, otherwise today (only when today falls in the shown month).
  AttendanceDayView? _calendarDetailDay(List<AttendanceDayView> days) {
    if (_selectedCalendarDay case final selected?) {
      return days
              .where((day) => _sameDay(day.date, selected.date))
              .firstOrNull ??
          selected;
    }
    final now = DateTime.now();
    if (_attendanceMonth.year != now.year ||
        _attendanceMonth.month != now.month) {
      return null;
    }
    return days.where((day) => _sameDay(day.date, now)).firstOrNull;
  }

  List<AttendanceDayView> _attendanceDays() => buildAttendanceDays(
    month: _attendanceMonth,
    records: widget.dashboard.attendance,
    regularizations: widget.dashboard.regularizations,
    leaves: widget.dashboard.myLeaves,
    holidays: widget.dashboard.holidays,
    overtime: widget.dashboard.myOvertime,
    shift: widget.dashboard.shift,
  );

  Future<void> _changeAttendanceMonth(int delta) async {
    final month = DateTime(
      _attendanceMonth.year,
      _attendanceMonth.month + delta,
    );
    setState(() {
      _attendanceMonth = month;
      _selectedCalendarDay = null;
    });
    await widget.bloc.add(LoadAttendanceMonth(month));
  }

  /// Tapping a day selects it; the detail strip below the grid then shows its
  /// punches and, when a correction is possible, the link that opens the form.
  void _openAttendanceDay(AttendanceDayView day) {
    setState(() {
      if (day.kind == AttendanceKind.attention) {
        _selectedCalendarDay = day;
        return;
      }
      _selectedCalendarDay = _sameDay(_selectedCalendarDay?.date, day.date)
          ? null
          : day;
    });
  }

  /// Why this day cannot be regularised, or null when it can. Everything here
  /// mirrors what the server enforces, so the button is never a dead end: HR
  /// chooses which of the four cases may be corrected and how far back a
  /// request may reach, both under Shifts › Attendance correction.
  String? _correctionBlockedReason(AttendanceDayView day) {
    final rules = widget.dashboard.shift.correction;
    final today = _dateOnly(DateTime.now());
    final date = _dateOnly(day.date);

    if (date.isAfter(today)) return 'A future day cannot be regularised.';
    if (day.kind == AttendanceKind.regularizationPending) {
      return 'A correction for this day is already with your manager.';
    }
    if (day.regularization?.status.toLowerCase() == 'approved') {
      return 'This day has already been corrected.';
    }
    // Nothing to correct on a day nobody was due to work. Overtime is the
    // route for a week-off or holiday that was actually worked.
    if (day.kind == AttendanceKind.weekoff) {
      return 'This is a week-off — claim overtime if you worked it.';
    }
    if (day.kind == AttendanceKind.holiday) {
      return 'This is a company holiday — claim overtime if you worked it.';
    }
    if (day.kind == AttendanceKind.leaveApproved ||
        day.kind == AttendanceKind.leavePending) {
      return 'This day is booked as leave.';
    }
    if (date.isBefore(rules.earliestFrom(today))) {
      return 'Corrections can only be raised up to '
          '${rules.backdateDays} days back.';
    }
    final trigger = CorrectionRules.triggerFor(
      punchIn: day.record?.punchIn,
      punchOut: day.record?.punchOut,
    );
    if (!rules.allows(trigger)) {
      return trigger == 'Both punches present'
          ? 'Both punches are recorded — your company does not allow a '
                'correction for a complete day.'
          : '$trigger cannot be corrected under your company policy.';
    }
    return null;
  }

  /// Correction request: the employee supplies the punch times they believe
  /// should be recorded. At least one of the two is required. Routed to their
  /// manager for approval by the backend.
  Future<void> _showRegularization(DateTime day) async {
    final note = TextEditingController();
    TimeOfDay? punchIn;
    TimeOfDay? punchOut;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setSheetState) {
          Future<void> pick(bool isStart) async {
            final current = isStart ? punchIn : punchOut;
            final picked = await showTimePicker(
              context: context,
              initialTime: current ?? const TimeOfDay(hour: 9, minute: 0),
              builder: _pickerTheme,
            );
            if (picked == null) return;
            setSheetState(() {
              if (isStart) {
                punchIn = picked;
              } else {
                punchOut = picked;
              }
            });
          }

          void toggleMeridiem(bool isStart) {
            final current = isStart ? punchIn : punchOut;
            if (current == null) return;
            final shifted = TimeOfDay(
              hour: (current.hour + 12) % 24,
              minute: current.minute,
            );
            setSheetState(() {
              if (isStart) {
                punchIn = shifted;
              } else {
                punchOut = shifted;
              }
            });
          }

          return Container(
            padding: EdgeInsets.fromLTRB(
              16,
              12,
              16,
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
                const _SheetHandle(),
                const SizedBox(height: 12),
                const Text(
                  'Request Correction',
                  style: TextStyle(
                    color: Color(0xFF2A2A2A),
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  '${_fullWeekdayNames[day.weekday - 1]}, ${day.day} ${_monthName(day.month)}',
                  style: const TextStyle(
                    color: Color(0xFF6A6A6A),
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 16),
                _CorrectionTimeField(
                  label: 'Punch-in',
                  value: punchIn,
                  onPickTime: () => pick(true),
                  onToggleMeridiem: () => toggleMeridiem(true),
                ),
                const SizedBox(height: 16),
                _CorrectionTimeField(
                  label: 'Punch-out',
                  value: punchOut,
                  onPickTime: () => pick(false),
                  onToggleMeridiem: () => toggleMeridiem(false),
                ),
                const SizedBox(height: 16),
                const Row(
                  children: [
                    Text(
                      'Notes ',
                      style: TextStyle(
                        color: Color(0xFF2A2A2A),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      '(optional)',
                      style: TextStyle(color: Color(0xFF929292), fontSize: 12),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: note,
                  minLines: 3,
                  maxLines: 3,
                  style: const TextStyle(
                    fontSize: 13,
                    color: Color(0xFF2A2A2A),
                  ),
                  decoration: InputDecoration(
                    hintText: 'Add a note for your manager...',
                    hintStyle: const TextStyle(
                      color: Color(0xFF929292),
                      fontSize: 13,
                    ),
                    filled: true,
                    fillColor: Colors.white,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 15,
                      vertical: 13,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: Color(0xFFDDDDDD)),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: Color(0xFFDDDDDD)),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(
                        color: Color(0xFF0571A6),
                        width: 1.5,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 26),
                _SheetPrimaryButton(
                  label: 'Submit for review',
                  color: const Color(0xFF0571A6),
                  onPressed: () async {
                    if (punchIn == null && punchOut == null) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Enter a punch-in or punch-out time'),
                        ),
                      );
                      return;
                    }
                    DateTime? at(TimeOfDay? time) => time == null
                        ? null
                        : DateTime(
                            day.year,
                            day.month,
                            day.day,
                            time.hour,
                            time.minute,
                          );
                    final from = at(punchIn);
                    final to = at(punchOut);
                    if (from != null && to != null && !to.isAfter(from)) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Punch-out must be after punch-in'),
                        ),
                      );
                      return;
                    }
                    final ok = await widget.bloc.add(
                      SubmitAttendanceRegularization(
                        workDate: day,
                        punchIn: from,
                        punchOut: to,
                        note: note.text.trim(),
                      ),
                    );
                    if (ok && dialogContext.mounted) {
                      Navigator.pop(dialogContext);
                    }
                  },
                ),
              ],
            ),
          );
        },
      ),
    );
    note.dispose();
  }

  static String _dateKey(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
  static String _duration(Duration value) {
    final hours = value.inHours;
    final minutes = value.inMinutes.remainder(60);
    return minutes == 0 ? '${hours}h' : '${hours}h ${minutes}m';
  }

  static String _monthName(int month) => const [
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
  ][month - 1];

  Widget _wizard() {
    final steps = _stepsForCurrentFlow();
    final review = _step == steps.length;
    final step = review ? null : steps[_step];
    final color = _flowColor(_flow);
    return _HubScaffold(
      key: ValueKey('wizard-${_flow.name}-$_step'),
      title: _flowTitle(_flow),
      onBack: _back,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: _showQuickCreateComingSoon,
      footer: _WizardFooter(
        color: color,
        label: _submitting
            ? 'Submitting…'
            : review
            ? _flowCta(_flow)
            : step!.optional && !_hasStepValue(step)
            ? 'Skip'
            : _step == steps.length - 1
            ? 'Review'
            : 'Continue',
        secondary: review
            ? 'Back to edit'
            : _step > 0
            ? 'Back'
            : null,
        onSecondary: review
            ? _backToEdit
            : _step > 0
            ? _back
            : null,
        secondaryAfter: review || _step > 0,
        onTap: !_submitting && (review || _canContinue(step!))
            ? () => _advance(step)
            : null,
      ),
      children: [
        Row(
          children: List.generate(
            steps.length + 1,
            (index) => Expanded(
              child: Container(
                height: 4,
                margin: EdgeInsets.only(right: index == steps.length ? 0 : 5),
                decoration: BoxDecoration(
                  color: index <= _step ? color : _Q.line,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 28),
        if (review) ...[
          const Text('Review & confirm', style: _QText.heroSmall),
          const SizedBox(height: 6),
          const Text(
            'Check the details below before sending.',
            style: _QText.subtitle,
          ),
          const SizedBox(height: 20),
          _reviewCard(),
          const SizedBox(height: 14),
          _InfoCard(
            "You'll be able to track this under ${_trackLabel(_flow)}.",
          ),
        ] else ...[
          Text(step!.question, style: _QText.heroSmall),
          const SizedBox(height: 6),
          Text(step.subtitle, style: _QText.subtitle),
          const SizedBox(height: 24),
          _stepInput(step, color),
        ],
      ],
    );
  }

  bool _canContinue(_FlowStep step) {
    return switch (step.kind) {
      _StepKind.choice || _StepKind.dropdown => _choice != null,
      _StepKind.text when step.money => _wizardAmountAllowed(),
      _StepKind.text => _text.text.trim().isNotEmpty || step.optional,
      _StepKind.dates => _dateChosen && _wizardLeaveDatesAllowed,
      _StepKind.date => _dateChosen && _wizardSingleDateAllowed,
      _StepKind.upload => true,
    };
  }

  /// A leave range the policy would accept: the right type, inside its window,
  /// and with at least one day that actually costs leave.
  bool get _wizardLeaveDatesAllowed {
    if (_flow != _QuickFlow.leave) return true;
    final type = _answers['Type'] ?? _choice;
    if (type == null) return false;
    return leaveRangeProblem(
          policy: widget.dashboard.shift,
          holidayDates: _holidayKeys,
          typeLabel: type,
          from: _from,
          to: _to,
          today: DateTime.now(),
          maxDays: _maxLeaveApplyDays,
          availableDays: _balanceFor(type)?.remaining,
        ) ==
        null;
  }

  /// The single date an overtime claim or a reimbursement is for.
  bool get _wizardSingleDateAllowed => switch (_flow) {
    _QuickFlow.overtime => _canSelectOvertimeDay(_from),
    _QuickFlow.reimbursement =>
      _wizardReimbursementType == null ||
          !_from.isBefore(
            _dateOnly(
              _wizardReimbursementType!.earliestClaimableFrom(
                _dateOnly(DateTime.now()),
              ),
            ),
          ),
    _ => true,
  };

  /// The reimbursement type picked on the wizard's first step, if any.
  ReimbursementType? get _wizardReimbursementType {
    final name = _answers['Type'] ?? _choice;
    for (final type in _reimbursementTypes) {
      if (type.name == name) return type;
    }
    return null;
  }

  /// A money step is complete when it parses and, for a reimbursement, sits
  /// under the cap on the type that was chosen.
  bool _wizardAmountAllowed() {
    final amount = double.tryParse(_text.text.replaceAll(',', '').trim()) ?? 0;
    if (amount <= 0) return false;
    if (_flow != _QuickFlow.reimbursement) return true;
    return _wizardReimbursementType?.allows(amount) ?? true;
  }

  bool _hasStepValue(_FlowStep step) {
    return switch (step.kind) {
      _StepKind.upload => _uploadBytes != null && _uploadName != null,
      _StepKind.text => _text.text.trim().isNotEmpty,
      _StepKind.choice || _StepKind.dropdown => _choice != null,
      _StepKind.dates || _StepKind.date => _dateChosen,
    };
  }

  Future<void> _advance(_FlowStep? step, {bool skip = false}) async {
    final steps = _stepsForCurrentFlow();
    if (step == null) {
      setState(() => _submitting = true);
      bool submitted;
      if (_flow == _QuickFlow.leave) {
        submitted = await widget.bloc.add(
          SubmitLeaveApplication(
            type: _answers['Type'] ?? 'Casual',
            startDate: _from,
            endDate: _to,
            reason: _answers['Note'] ?? '',
          ),
        );
      } else if (_flow == _QuickFlow.overtime) {
        // The claim has to carry the duration that was chosen — a full day
        // submitted as a half day is filed, and paid back, as the wrong thing.
        // The hours come from the org's shift policy, never a fixed day.
        final shift = widget.dashboard.shift;
        final worked = (_answers['Duration'] ?? _choice) == 'Full day'
            ? shift.minFullDay
            : shift.minHalfDay;
        submitted = await widget.bloc.add(
          SubmitOvertimeApplication(
            workDate: _from,
            startTime: _from,
            endTime: _from.add(worked),
            note: _answers['Note'] ?? '',
          ),
        );
      } else {
        submitted = await widget.bloc.add(
          SubmitReimbursementApplication(
            expenseDate: _from,
            amount: _answers['Amount'] ?? '',
            category: _answers['Type'] ?? '',
            receiptName: _answers['Bill'] ?? '',
            receiptBytes: _uploadBytes,
            note: _answers['Note'] ?? '',
          ),
        );
      }
      if (!mounted) return;
      setState(() {
        _submitting = false;
        if (submitted) _page = _QuickPage.success;
      });
      if (submitted) widget.controller._navigationChanged();
      return;
    }
    if (!skip) {
      switch (step.kind) {
        case _StepKind.choice:
        case _StepKind.dropdown:
          _answers[step.label] = _choice!;
        case _StepKind.text:
          _answers[step.label] = _text.text.trim();
        case _StepKind.dates:
          _answers[step.label] = '${_short(_from)}–${_short(_to)}';
        case _StepKind.date:
          _answers[step.label] = _short(_from);
        case _StepKind.upload:
          _answers[step.label] = _uploadName ?? '';
      }
    }
    setState(() {
      _step = (_step + 1).clamp(0, steps.length);
      _choice = null;
      _text.clear();
      _dateChosen = false;
    });
  }

  Widget _stepInput(_FlowStep step, Color color) {
    return switch (step.kind) {
      _StepKind.choice => Column(
        children: step.options!
            .map(
              (option) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _ChoiceCard(
                  option: option,
                  selected: _choice == option.label,
                  color: color,
                  onTap: () {
                    setState(() => _choice = option.label);
                    Future<void>.delayed(const Duration(milliseconds: 160), () {
                      if (mounted && _choice == option.label) _advance(step);
                    });
                  },
                ),
              ),
            )
            .toList(),
      ),
      _StepKind.dropdown => Container(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFE6E6EA)),
        ),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<String>(
            value: _choice,
            isExpanded: true,
            hint: const Text('Select'),
            borderRadius: BorderRadius.circular(14),
            items: step.options!
                .map(
                  (option) => DropdownMenuItem(
                    value: option.label,
                    child: Text(
                      option.label,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFF1A1A1A),
                      ),
                    ),
                  ),
                )
                .toList(),
            onChanged: (value) => setState(() => _choice = value),
          ),
        ),
      ),
      _StepKind.text => TextField(
        controller: _text,
        autofocus: true,
        onChanged: (_) => setState(() {}),
        keyboardType: step.money ? TextInputType.number : TextInputType.text,
        maxLines: step.money ? 1 : 4,
        decoration: InputDecoration(
          prefixText: step.money ? '₹  ' : null,
          hintText: step.placeholder,
          fillColor: Colors.white,
        ),
      ),
      _StepKind.dates => _PaperCard(
        child: _MonthCalendar(
          from: _dateChosen ? _from : null,
          to: _dateChosen ? _to : null,
          firstDate: _leaveWindowStart,
          lastDate: _leaveWindowEnd,
          selectableDayPredicate: _canSelectLeaveDay,
          onPick: (day) => setState(() {
            if (!_dateChosen || !_sameDay(_from, _to)) {
              _from = day;
              _to = day;
              _dateChosen = true;
            } else if (day.isBefore(_from)) {
              _from = day;
            } else {
              final span = day.difference(_from).inDays + 1;
              if (span > _maxLeaveApplyDays) {
                _from = day;
                _to = day;
                return;
              }
              _to = day;
            }
          }),
          selectionLabel: _dateChosen ? _rangeLabel(_from, _to) : null,
        ),
      ),
      _StepKind.date => _PaperCard(
        child: _MonthCalendar(
          from: _dateChosen ? _from : null,
          firstDate: switch (_flow) {
            _QuickFlow.overtime => _overtimeWindowStart,
            _QuickFlow.reimbursement => _reimbursementWindowStart,
            _ => null,
          },
          lastDate: switch (_flow) {
            _QuickFlow.overtime || _QuickFlow.reimbursement => _dateOnly(
              DateTime.now(),
            ),
            _ => null,
          },
          selectableDayPredicate: _flow == _QuickFlow.overtime
              ? _canSelectOvertimeDay
              : _flow == _QuickFlow.reimbursement
              ? (day) {
                  final today = _dateOnly(DateTime.now());
                  if (day.isAfter(today)) return false;
                  // Only as far back as this type allows.
                  final type = _wizardReimbursementType;
                  if (type == null) return true;
                  return !day.isBefore(type.earliestClaimableFrom(today));
                }
              : null,
          onPick: (day) => setState(() {
            _from = day;
            _to = day;
            _dateChosen = true;
          }),
          selectionLabel: _dateChosen
              ? '${_short(_from)} · ${_weekday(_from.weekday)}'
              : null,
        ),
      ),
      _StepKind.upload => _UploadCard(
        color: color,
        tint: _Q.tealTint,
        value: _uploadName,
        bytes: _uploadBytes,
        onChanged: (file) => setState(() {
          _uploadName = file?.name;
          _uploadBytes = file?.bytes;
        }),
      ),
    };
  }

  bool get _hasBillPreview =>
      _flow == _QuickFlow.reimbursement &&
      _uploadBytes != null &&
      _uploadName != null;

  bool get _billIsImage {
    final n = (_uploadName ?? '').toLowerCase();
    return n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.png');
  }

  /// Formats a review value — reimbursement amounts get an "Rs." prefix.
  String _reviewValue(String key, String value) {
    if (value.isEmpty) return '—';
    if (key == 'Amount' && _flow == _QuickFlow.reimbursement) {
      return 'Rs. $value';
    }
    return value;
  }

  Widget _reviewCard() {
    // The Bill row is rendered separately as a viewable preview.
    final entries = <MapEntry<String, String>>[
      ..._answers.entries.where((e) => !(_hasBillPreview && e.key == 'Bill')),
      if (_flow == _QuickFlow.leave)
        MapEntry('Approver', widget.dashboard.approverName),
      if (_flow == _QuickFlow.overtime)
        MapEntry('Approver', widget.dashboard.approverName),
    ];
    return _PaperCard(
      child: Column(
        children: [
          ...entries.indexed.map((entry) {
            final isLast = entry.$1 == entries.length - 1 && !_hasBillPreview;
            return Container(
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(
                border: isLast
                    ? null
                    : const Border(bottom: BorderSide(color: _Q.line)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 88,
                    child: Text(entry.$2.key, style: _QText.mini),
                  ),
                  Expanded(
                    child: Text(
                      _reviewValue(entry.$2.key, entry.$2.value),
                      textAlign: TextAlign.right,
                      style: const TextStyle(
                        color: _Q.ink,
                        fontSize: 13.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
            );
          }),
          if (_hasBillPreview) _billReviewRow(),
        ],
      ),
    );
  }

  Widget _billReviewRow() {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Bill', style: _QText.mini),
          const SizedBox(height: 8),
          GestureDetector(
            onTap: _showBillPreview,
            child: Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: _Q.line),
              ),
              clipBehavior: Clip.antiAlias,
              child: _billIsImage
                  ? Column(
                      children: [
                        ConstrainedBox(
                          constraints: const BoxConstraints(maxHeight: 200),
                          child: Image.memory(
                            Uint8List.fromList(_uploadBytes!),
                            width: double.infinity,
                            fit: BoxFit.cover,
                          ),
                        ),
                        _billCaption(
                          Icons.zoom_out_map_rounded,
                          'Tap to view full bill',
                        ),
                      ],
                    )
                  : _billCaption(
                      Icons.picture_as_pdf_rounded,
                      _uploadName ?? 'Bill.pdf',
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _billCaption(IconData icon, String label) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
      child: Row(
        children: [
          Icon(icon, size: 18, color: _Q.inkFaint),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: _Q.inkSoft,
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _showBillPreview() {
    if (_uploadBytes == null) return;
    showDialog<void>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.82),
      builder: (context) => GestureDetector(
        onTap: () => Navigator.of(context).pop(),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Center(
            child: _billIsImage
                ? InteractiveViewer(
                    child: Image.memory(
                      Uint8List.fromList(_uploadBytes!),
                      fit: BoxFit.contain,
                    ),
                  )
                : Container(
                    padding: const EdgeInsets.all(28),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.picture_as_pdf_rounded,
                          size: 48,
                          color: _Q.ink,
                        ),
                        const SizedBox(height: 12),
                        Text(
                          _uploadName ?? 'Bill.pdf',
                          style: const TextStyle(
                            color: _Q.ink,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'PDF preview opens after submission',
                          style: TextStyle(color: _Q.inkSoft, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
          ),
        ),
      ),
    );
  }

  Widget _success() {
    return Center(
      key: ValueKey('success-${_flow.name}'),
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 88,
              height: 88,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _flow == _QuickFlow.leave
                    ? _Q.terraTint
                    : _flow == _QuickFlow.overtime
                    ? _Q.goldTint
                    : _Q.tealTint,
              ),
              child: Icon(
                Icons.check_circle_rounded,
                color: _flowColor(_flow),
                size: 52,
              ),
            ),
            const SizedBox(height: 24),
            const Text('Request sent!', style: _QText.heroSmall),
            const SizedBox(height: 10),
            Text(
              _flow == _QuickFlow.reimbursement
                  ? "Sent to finance. You'll get a notification when it's actioned."
                  : "Sent to ${widget.dashboard.approverName}. You'll get a notification when it's actioned.",
              textAlign: TextAlign.center,
              style: _QText.subtitle,
            ),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.white,
                border: Border.all(color: _Q.line),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.location_on_outlined,
                    color: _flowColor(_flow),
                    size: 18,
                  ),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      'Track it under ${_trackLabel(_flow)}',
                      style: const TextStyle(color: _Q.ink, fontSize: 13),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 26),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: _flowColor(_flow),
                  padding: const EdgeInsets.symmetric(vertical: 15),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                onPressed: _back,
                child: const Text(
                  'View my requests',
                  style: TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
            ),
            TextButton(
              onPressed: () => _open(_QuickPage.home),
              child: const Text('Back to dashboard'),
            ),
          ],
        ),
      ),
    );
  }

  List<_FlowStep> _stepsForCurrentFlow() {
    if (_flow == _QuickFlow.reimbursement) {
      final steps = _flowSteps[_QuickFlow.reimbursement]!;
      // The expense types are HR's list, not a fixed four. Each option carries
      // its cap and its backdating window, and the two steps that follow say
      // what the chosen one allows rather than making people find out on
      // submit.
      final chosen = _wizardReimbursementType;
      return [
        for (final step in steps)
          if (step.label == 'Type')
            _FlowStep(
              label: step.label,
              kind: step.kind,
              question: step.question,
              subtitle: _reimbursementTypes.isEmpty
                  ? 'No expense types are configured yet.'
                  : 'Pick a category.',
              options: [
                for (final type in _reimbursementTypes)
                  _FlowOption(
                    type.name,
                    Icons.receipt_long_rounded,
                    [
                      if (type.maxLimit > 0) 'up to ₹${formatDays(type.maxLimit)}',
                      type.backdateDays == 0 ? 'today only' : '${type.backdateDays}d back',
                    ].join(' · '),
                  ),
              ],
            )
          else if (step.label == 'Date' && chosen != null)
            _FlowStep(
              label: step.label,
              kind: step.kind,
              question: step.question,
              subtitle: chosen.backdateDays == 0
                  ? '${chosen.name} can only be claimed for today.'
                  : '${chosen.name} can be claimed up to ${chosen.backdateDays} days back.',
            )
          else if (step.label == 'Amount' && chosen != null && chosen.maxLimit > 0)
            _FlowStep(
              label: step.label,
              kind: step.kind,
              question: step.question,
              subtitle: '${chosen.name} is capped at ₹${formatDays(chosen.maxLimit)}.',
              money: true,
            )
          else
            step,
      ];
    }
    if (_flow != _QuickFlow.leave) return _flowSteps[_flow]!;
    final leaveSteps = _flowSteps[_QuickFlow.leave]!;
    return [
      _FlowStep(
        label: leaveSteps.first.label,
        kind: leaveSteps.first.kind,
        question: leaveSteps.first.question,
        subtitle: leaveSteps.first.subtitle,
        // Straight from the policy: a type HR switched off — or dropped
        // entirely — never reaches the app, so it is not offered here.
        options: [
          for (final label in _leaveLabels)
            _FlowOption(_shortLeaveLabel(label), _leaveIcon(label)),
        ],
      ),
      ...leaveSteps.skip(1),
    ];
  }

  /// 'Casual Leave' reads as 'Casual' in the wizard, where 'leave' is already
  /// the question. Anything HR names differently is shown as they named it.
  static String _shortLeaveLabel(String label) {
    const known = {
      'Casual Leave': 'Casual',
      'Sick Leave': 'Sick',
      'Earned Leave': 'Earned',
    };
    return known[label] ?? label;
  }

  static IconData _leaveIcon(String label) => switch (label) {
    'Sick Leave' => Icons.thermostat_rounded,
    'Casual Leave' => Icons.coffee_rounded,
    'Earned Leave' => Icons.flight_takeoff_rounded,
    'Comp-off' => Icons.swap_horiz_rounded,
    _ => Icons.event_available_rounded,
  };

  /// The first and last day the chosen leave type can be applied for.
  DateTime? get _leaveWindowStart {
    final window = _leaveWindow;
    final today = _dateOnly(DateTime.now());
    return window == null ? today : _dateOnly(window.earliestFrom(today));
  }

  DateTime? get _leaveWindowEnd {
    final window = _leaveWindow;
    return window == null
        ? null
        : _dateOnly(window.latestFrom(_dateOnly(DateTime.now())));
  }

  /// Overtime is claimed for a day already worked, so the window runs back
  /// from today by however many days the policy allows.
  DateTime get _overtimeWindowStart {
    final today = _dateOnly(DateTime.now());
    return today.subtract(
      Duration(days: widget.dashboard.shift.overtimeBackdateDays),
    );
  }

  /// The same for a claim, from the type's own backdating window.
  DateTime? get _reimbursementWindowStart {
    final today = _dateOnly(DateTime.now());
    final type = _wizardReimbursementType;
    return type == null ? null : _dateOnly(type.earliestClaimableFrom(today));
  }

  LeaveTypeWindow? get _leaveWindow {
    final label = _leaveType ?? _answers['Type'] ?? _choice;
    return label == null ? null : widget.dashboard.shift.windowForLeave(label);
  }

  /// Applying is bounded by what HR configured for that type — how far ahead,
  /// and whether it can be backdated at all. Without this the form accepted
  /// dates the server then refused.
  bool _canSelectLeaveDay(DateTime day) {
    final today = _dateOnly(DateTime.now());
    final window = _leaveWindow;
    if (window == null) return !day.isBefore(today);
    return !day.isBefore(_dateOnly(window.earliestFrom(today))) &&
        !day.isAfter(_dateOnly(window.latestFrom(today)));
  }

  /// Calendar days in the range, less the company's week-off days (Sunday by
  /// default) and company holidays — neither is charged as leave.
  int _leaveDaysBetween(DateTime from, DateTime to) {
    var days = 0;
    for (
      var day = from;
      !day.isAfter(to);
      day = day.add(const Duration(days: 1))
    ) {
      if (_isWeekoffDay(day) || _isCompanyHoliday(day)) continue;
      days += 1;
    }
    return days;
  }

  bool _isCompanyHoliday(DateTime day) {
    return widget.dashboard.holidays.any(
      (holiday) => _sameDay(holiday.date, day),
    );
  }

  /// A week-off, from the grid HR set under Shifts › Policies. Per week of the
  /// month, so the 2nd Saturday can be off while the 1st is not.
  bool _isWeekoffDay(DateTime day) => widget.dashboard.shift.isWeekOff(day);

  // Overtime day rules: any *past* day for half-day; only a week-off or
  // company holiday for full-day. Duration was chosen on the previous step.
  bool _canSelectOvertimeDay(DateTime day) {
    final today = _dateOnly(DateTime.now());
    // Today counts: a week-off worked today is overtime like any other. Only
    // a future day is out.
    if (day.isAfter(today)) return false;
    return !day.isBefore(_overtimeWindowStart);
  }

  /// Whether the window holds any day the current choice can be claimed for.
  /// A full day is week-offs and holidays only, so a short backdating window
  /// can contain none — better said out loud than left as a dead calendar.
  bool get _overtimeWindowHasADay {
    final today = _dateOnly(DateTime.now());
    for (
      var day = _overtimeWindowStart;
      !day.isAfter(today);
      day = day.add(const Duration(days: 1))
    ) {
      if (_canSelectOvertimeDay(day)) return true;
    }
    return false;
  }
}

class AttendanceCalendarArrow extends StatelessWidget {
  const AttendanceCalendarArrow({required this.onPressed, required this.asset});
  final VoidCallback onPressed;
  final String asset;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.transparent,
    child: InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(99),
      child: SizedBox(
        width: 32,
        height: 32,
        child: Center(child: SvgPicture.asset(asset, width: 20, height: 20)),
      ),
    ),
  );
}

class AttendanceFilterChips extends StatelessWidget {
  const AttendanceFilterChips({
    required this.selected,
    required this.onChanged,
  });

  final AttendanceFilter? selected;
  final ValueChanged<AttendanceFilter?> onChanged;

  @override
  Widget build(BuildContext context) {
    void toggle(AttendanceFilter filter) =>
        onChanged(selected == filter ? null : filter);

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _AttendanceFilterChip(
            label: 'Present',
            selected: selected == AttendanceFilter.present,
            onTap: () => toggle(AttendanceFilter.present),
          ),
          const SizedBox(width: 8),
          _AttendanceFilterChip(
            label: 'Late',
            selected: selected == AttendanceFilter.late,
            onTap: () => toggle(AttendanceFilter.late),
            leading: SvgPicture.asset(
              'assets/icons/filter_late_clock.svg',
              width: 12,
              height: 12,
            ),
          ),
          const SizedBox(width: 8),
          _AttendanceFilterChip(
            label: 'Half-day',
            selected: selected == AttendanceFilter.halfDay,
            onTap: () => toggle(AttendanceFilter.halfDay),
            leading: const Text(
              '½',
              style: TextStyle(
                color: Color(0xFF6B7280),
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 8),
          _AttendanceFilterChip(
            label: 'Leave',
            selected: selected == AttendanceFilter.leave,
            onTap: () => toggle(AttendanceFilter.leave),
          ),
          const SizedBox(width: 8),
          _AttendanceFilterChip(
            label: 'Leave Applied',
            selected: selected == AttendanceFilter.leaveApplied,
            onTap: () => toggle(AttendanceFilter.leaveApplied),
            leading: CustomPaint(
              size: const Size(8, 8),
              painter: const _DashedRoundRectPainter(
                color: Color(0xFF717171),
                radius: 2,
              ),
            ),
          ),
          const SizedBox(width: 8),
          _AttendanceFilterChip(
            label: 'Correction',
            selected: selected == AttendanceFilter.correction,
            onTap: () => toggle(AttendanceFilter.correction),
          ),
          const SizedBox(width: 8),
          _AttendanceFilterChip(
            label: 'Correction Awaits',
            selected: selected == AttendanceFilter.correctionAwaits,
            onTap: () => toggle(AttendanceFilter.correctionAwaits),
            leading: CustomPaint(
              size: const Size(8, 8),
              painter: const _DashedRoundRectPainter(
                color: Color(0xFF717171),
                radius: 2,
              ),
            ),
          ),
          const SizedBox(width: 8),
          _AttendanceFilterChip(
            label: 'Holiday',
            selected: selected == AttendanceFilter.holiday,
            onTap: () => toggle(AttendanceFilter.holiday),
          ),
        ],
      ),
    );
  }
}

class _AttendanceFilterChip extends StatelessWidget {
  const _AttendanceFilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
    this.leading,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(99),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          color: selected ? _Q.ink : Colors.white,
          borderRadius: BorderRadius.circular(99),
          border: Border.all(
            color: selected ? _Q.ink : const Color(0xFFE5E7EB),
            width: .8,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (leading != null) ...[leading!, const SizedBox(width: 6)],
            Text(
              label,
              style: TextStyle(
                color: selected ? Colors.white : const Color(0xFF6B7280),
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AttendanceCellStyle {
  const _AttendanceCellStyle({
    required this.color,
    this.bold = true,
    this.dashedBorder,
    this.fill,
  });
  final Color color;
  final bool bold;
  final Color? dashedBorder;
  final Color? fill;
}

_AttendanceCellStyle _attendanceGridCellStyle(AttendanceKind kind) =>
    switch (kind) {
      AttendanceKind.present => const _AttendanceCellStyle(
        color: Color(0xFF28CA08),
      ),
      AttendanceKind.halfDay => const _AttendanceCellStyle(
        color: Color(0xFF34C759),
      ),
      AttendanceKind.weekoff => const _AttendanceCellStyle(
        color: Color(0xFF6A6A6A),
        bold: false,
        fill: Color(0xFFF2F2F2),
      ),
      AttendanceKind.holiday => const _AttendanceCellStyle(
        color: Color(0xFF717171),
        bold: false,
        fill: Color(0xFFF2F2F2),
      ),
      // "Correction Required" — action needed, not yet requested.
      AttendanceKind.attention => const _AttendanceCellStyle(
        color: Color(0xFFFF383C),
      ),
      // "Correction Awaits" — already requested, pending manager decision.
      AttendanceKind.regularizationPending => const _AttendanceCellStyle(
        color: Color(0xFFFF1400),
        dashedBorder: Color(0xFF0571A6),
      ),
      AttendanceKind.leaveApproved => const _AttendanceCellStyle(
        color: Color(0xFF0571A6),
      ),
      AttendanceKind.leavePending => const _AttendanceCellStyle(
        color: Color(0xFF0571A6),
        dashedBorder: Color(0xFF0571A6),
      ),
      AttendanceKind.future => const _AttendanceCellStyle(
        color: Color(0xFF2A2A2A),
        bold: false,
      ),
    };

Color _attendanceListRowColor(AttendanceKind kind) => switch (kind) {
  AttendanceKind.present || AttendanceKind.halfDay => const Color(0xFF34C759),
  AttendanceKind.weekoff || AttendanceKind.holiday => const Color(0xFF717171),
  AttendanceKind.attention ||
  AttendanceKind.regularizationPending => const Color(0xFFFF383C),
  AttendanceKind.leaveApproved ||
  AttendanceKind.leavePending => const Color(0xFF0571A6),
  AttendanceKind.future => const Color(0xFF2A2A2A),
};

Color _attendanceListRowBackground(AttendanceKind kind) => switch (kind) {
  AttendanceKind.weekoff || AttendanceKind.holiday => const Color(0xFFF2F2F2),
  AttendanceKind.future ||
  AttendanceKind.leavePending => const Color(0xFFFAFAFA),
  _ => Colors.white,
};

bool _attendanceListShowsChevron(AttendanceKind kind) =>
    kind != AttendanceKind.weekoff &&
    kind != AttendanceKind.holiday &&
    kind != AttendanceKind.future;

class AttendanceListCard extends StatelessWidget {
  const AttendanceListCard({
    required this.day,
    required this.today,
    required this.onTap,
    this.dimmed = false,
    this.selected = false,
  });
  final AttendanceDayView day;
  final bool today;
  final VoidCallback onTap;
  final bool dimmed;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final color = dimmed ? _Q.inkFaint : _attendanceListRowColor(day.kind);
    final showChevron = !dimmed && _attendanceListShowsChevron(day.kind);
    final background = selected
        ? const Color(0xFFDBEAFE)
        : _attendanceListRowBackground(day.kind);
    return Material(
      color: background,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          decoration: (selected || today)
              ? BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: const Color(0xFF0571A6),
                    width: selected ? 1.4 : 1,
                  ),
                )
              : null,
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              SizedBox(
                width: 40,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _weekday(day.date.weekday).substring(0, 3).toUpperCase(),
                      style: TextStyle(
                        color: color,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      '${day.date.day}',
                      style: TextStyle(
                        color: color,
                        fontSize: 18,
                        height: 1.15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  day.title,
                  style: TextStyle(
                    color: color,
                    fontSize: 14,
                    height: 1.25,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (showChevron) ...[
                const SizedBox(width: 6),
                Icon(Icons.chevron_right_rounded, size: 14, color: color),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class AttendanceMonthGrid extends StatelessWidget {
  const AttendanceMonthGrid({
    required this.month,
    required this.days,
    required this.onTap,
    this.filter,
    this.selectedDate,
  });
  final DateTime month;
  final List<AttendanceDayView> days;
  final ValueChanged<AttendanceDayView> onTap;
  final AttendanceFilter? filter;
  final DateTime? selectedDate;

  @override
  Widget build(BuildContext context) {
    final leading = (DateTime(month.year, month.month, 1).weekday - 1) % 7;
    return Column(
      children: [
        Row(
          children: List.generate(7, (index) {
            final isWeekend = index >= 5;
            return Expanded(
              child: Text(
                const ['M', 'T', 'W', 'T', 'F', 'S', 'S'][index],
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: isWeekend
                      ? const Color(0xFFDDDDDD)
                      : const Color(0xFF6A6A6A),
                  fontSize: 11,
                  fontWeight: FontWeight.w400,
                ),
              ),
            );
          }),
        ),
        const SizedBox(height: 8),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 7,
            mainAxisSpacing: 8,
            crossAxisSpacing: 0,
            childAspectRatio: 1.1,
          ),
          itemCount: leading + days.length,
          itemBuilder: (context, index) {
            if (index < leading) return const SizedBox.shrink();
            final day = days[index - leading];
            return _AttendanceMonthCell(
              day: day,
              today: _sameDay(day.date, DateTime.now()),
              dimmed: !matchesAttendanceFilter(day, filter),
              selected: _sameDay(day.date, selectedDate),
              onTap: () => onTap(day),
            );
          },
        ),
      ],
    );
  }
}

class _AttendanceMonthCell extends StatelessWidget {
  const _AttendanceMonthCell({
    required this.day,
    required this.today,
    required this.onTap,
    this.dimmed = false,
    this.selected = false,
  });
  final AttendanceDayView day;
  final bool today;
  final VoidCallback onTap;
  final bool dimmed;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final style = dimmed
        ? const _AttendanceCellStyle(color: _Q.inkFaint, bold: false)
        : _attendanceGridCellStyle(day.kind);
    final isHalfDay = !dimmed && day.kind == AttendanceKind.halfDay;
    final dashedColor = (today || selected) ? null : style.dashedBorder;
    final content = Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          decoration: BoxDecoration(
            color: selected ? const Color(0xFFDBEAFE) : style.fill,
            borderRadius: BorderRadius.circular(8),
            border: (today || selected)
                ? Border.all(color: const Color(0xFF0571A6), width: 1.6)
                : null,
          ),
          alignment: Alignment.center,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '${day.date.day}',
                style: TextStyle(
                  color: style.color,
                  fontSize: 13,
                  height: 1,
                  fontWeight: style.bold ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
              if (isHalfDay) ...[
                const SizedBox(height: 1),
                Text(
                  '½',
                  style: TextStyle(
                    color: style.color,
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                    height: 1,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
    return dashedColor != null
        ? CustomPaint(
            foregroundPainter: _DashedRoundRectPainter(
              color: dashedColor,
              radius: 8,
            ),
            child: content,
          )
        : content;
  }
}

const _fullWeekdayNames = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

String _hoursMinutesLabel(double hours) {
  final totalMinutes = (hours * 60).round();
  final h = totalMinutes ~/ 60;
  final m = totalMinutes % 60;
  return m == 0 ? '${h}h' : '${h}h ${m}m';
}


Widget _pickerTheme(BuildContext context, Widget? child) {
  final base = Theme.of(context);
  final colorScheme = ColorScheme.fromSeed(
    seedColor: const Color(0xFF0571A6),
    brightness: Brightness.light,
  ).copyWith(surface: Colors.white, onSurface: const Color(0xFF111827));
  return Theme(
    data: base.copyWith(
      colorScheme: colorScheme,
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: const Color(0xFF0571A6)),
      ),
    ),
    child: child!,
  );
}

typedef AttendanceTagStyle = ({Color bg, Color fg, String label});

AttendanceTagStyle attendanceTagStyle(AttendanceKind kind) => switch (kind) {
  AttendanceKind.present => (
    bg: const Color(0xFFDCFCE7),
    fg: const Color(0xFF28CA08),
    label: 'Present',
  ),
  AttendanceKind.halfDay => (
    bg: const Color(0xFFDCFCE7),
    fg: const Color(0xFF34C759),
    label: 'Half day',
  ),
  AttendanceKind.weekoff => (
    bg: const Color(0xFFF2F2F2),
    fg: const Color(0xFF6A6A6A),
    label: 'Weekly off',
  ),
  AttendanceKind.holiday => (
    bg: const Color(0xFFF2F2F2),
    fg: const Color(0xFF717171),
    label: 'Holiday',
  ),
  AttendanceKind.attention => (
    bg: const Color(0xFFFEE0E0),
    fg: const Color(0xFFFF383C),
    label: 'Correction Required',
  ),
  AttendanceKind.regularizationPending => (
    bg: const Color(0xFFFEE0E0),
    fg: const Color(0xFFFF383C),
    label: 'Correction Awaits',
  ),
  AttendanceKind.leaveApproved => (
    bg: const Color(0xFFDBEAFE),
    fg: const Color(0xFF0571A6),
    label: 'On Leave',
  ),
  AttendanceKind.leavePending => (
    bg: const Color(0xFFDBEAFE),
    fg: const Color(0xFF0571A6),
    label: 'Leave Applied',
  ),
  AttendanceKind.future => (
    bg: const Color(0xFFF2F2F2),
    fg: const Color(0xFF2A2A2A),
    label: 'Upcoming',
  ),
};

/// Punch clock label. Punch data is imported from the attendance hardware via
/// the SQL bridge, so a day with no imported record renders as an em dash.
String attendancePunchClock(DateTime? value) => value == null
    ? '—'
    : '${value.hour % 12 == 0 ? 12 : value.hour % 12}:${value.minute.toString().padLeft(2, '0')} ${value.hour >= 12 ? 'PM' : 'AM'}';

/// Read-only detail for one calendar day: date, status tag and the punch-in /
/// punch-out pair. Shared by the employee's own calendar and the manager's
/// read-only view of a team member's calendar.
class AttendanceDayDetail extends StatelessWidget {
  const AttendanceDayDetail({
    super.key,
    required this.day,
    this.onRequestCorrection,
    this.correctionBlockedReason,
  });

  final AttendanceDayView day;

  /// Shown as the "Apply for a correction" link on days that need one. Omitted
  /// on the manager's read-only view of a report.
  final VoidCallback? onRequestCorrection;

  /// Why a correction cannot be raised for this day — outside the backdating
  /// window, or a case HR does not allow. Shown in place of the link, so the
  /// answer is on the day itself rather than at the end of a form.
  final String? correctionBlockedReason;

  @override
  Widget build(BuildContext context) {
    final tag = attendanceTagStyle(day.kind);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                '${_fullWeekdayNames[day.date.weekday - 1]}, ${day.date.day} ${_monthName(day.date.month)}',
                style: const TextStyle(
                  color: Color(0xFF2A2A2A),
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: tag.bg,
                borderRadius: BorderRadius.circular(9999),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 4,
                    height: 4,
                    decoration: BoxDecoration(
                      color: tag.fg,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    tag.label,
                    style: TextStyle(
                      color: tag.fg,
                      fontSize: 10,
                      fontWeight: FontWeight.w400,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        Container(
          height: 71,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: _AttendancePunchCell(
                  label: 'Punch-in',
                  value: attendancePunchClock(day.record?.punchIn),
                  alignEnd: false,
                ),
              ),
              Container(width: 1, color: const Color(0xFFDDDDDD)),
              Expanded(
                child: _AttendancePunchCell(
                  label: 'Punch-out',
                  value: attendancePunchClock(day.record?.punchOut),
                  alignEnd: true,
                ),
              ),
            ],
          ),
        ),
        if (onRequestCorrection case final request?) ...[
          const SizedBox(height: 12),
          InkWell(
            onTap: request,
            child: const Text(
              'Missed Punch-in or out. Apply for a correction',
              style: TextStyle(
                color: Color(0xFF0571A6),
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ] else if (correctionBlockedReason case final reason?) ...[
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(
                Icons.lock_outline_rounded,
                size: 13,
                color: Color(0xFF929292),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  reason,
                  style: const TextStyle(
                    color: Color(0xFF929292),
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

class _AttendancePunchCell extends StatelessWidget {
  const _AttendancePunchCell({
    required this.label,
    required this.value,
    required this.alignEnd,
  });

  final String label;
  final String value;
  final bool alignEnd;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: alignEnd
        ? CrossAxisAlignment.end
        : CrossAxisAlignment.start,
    mainAxisSize: MainAxisSize.min,
    children: [
      Text(
        label,
        style: const TextStyle(
          color: Color(0xFF929292),
          fontSize: 10,
          fontWeight: FontWeight.w400,
        ),
      ),
      const SizedBox(height: 4),
      Text(
        value,
        style: const TextStyle(
          color: Color(0xFF2A2A2A),
          fontSize: 16,
          fontWeight: FontWeight.w600,
        ),
      ),
    ],
  );
}

class _DashedRoundRectPainter extends CustomPainter {
  const _DashedRoundRectPainter({required this.color, required this.radius});
  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..addRRect(
        RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(radius)),
      );
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    for (final metric in path.computeMetrics()) {
      for (double distance = 0; distance < metric.length; distance += 8) {
        canvas.drawPath(metric.extractPath(distance, distance + 4), paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DashedRoundRectPainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.radius != radius;
}

class _SheetHandle extends StatelessWidget {
  const _SheetHandle();
  @override
  Widget build(BuildContext context) => Center(
    child: Container(
      width: 44,
      height: 5,
      decoration: BoxDecoration(
        color: const Color(0xFFE9E2D8),
        borderRadius: BorderRadius.circular(4),
      ),
    ),
  );
}

class _SheetPrimaryButton extends StatelessWidget {
  const _SheetPrimaryButton({
    required this.label,
    required this.onPressed,
    this.color = const Color(0xFFC75C36),
  });
  final String label;
  final VoidCallback onPressed;
  final Color color;
  @override
  Widget build(BuildContext context) => SizedBox(
    height: 58,
    child: FilledButton(
      onPressed: onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: color,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(17)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
      ),
      child: Text(label),
    ),
  );
}

/// One punch row on the correction sheet: a wide box showing the time and a
/// narrow AM/PM box, matching the paired fields in the design.
class _CorrectionTimeField extends StatelessWidget {
  const _CorrectionTimeField({
    required this.label,
    required this.value,
    required this.onPickTime,
    required this.onToggleMeridiem,
  });

  final String label;
  final TimeOfDay? value;
  final VoidCallback onPickTime;
  final VoidCallback onToggleMeridiem;

  static const _boxBorder = Color(0xFFE5E7EB);

  @override
  Widget build(BuildContext context) {
    final hour = value == null
        ? null
        : (value!.hour % 12 == 0 ? 12 : value!.hour % 12);
    final clock = value == null
        ? ''
        : '$hour:${value!.minute.toString().padLeft(2, '0')}';
    final meridiem = value == null ? 'AM' : (value!.hour >= 12 ? 'PM' : 'AM');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label.toUpperCase(),
          style: const TextStyle(
            color: Color(0xFF9CA3AF),
            fontSize: 12,
            height: 16 / 12,
            letterSpacing: .3,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            Expanded(
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: onPickTime,
                child: Container(
                  height: 42,
                  alignment: Alignment.centerLeft,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: BoxDecoration(
                    border: Border.all(color: _boxBorder, width: .8),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    clock.isEmpty ? '--:--' : clock,
                    style: TextStyle(
                      color: clock.isEmpty
                          ? const Color(0xFF9CA3AF)
                          : const Color(0xFF2A2A2A),
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 18),
            InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: value == null ? null : onToggleMeridiem,
              child: Container(
                width: 89,
                height: 42,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  border: Border.all(color: _boxBorder, width: .8),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      meridiem,
                      style: TextStyle(
                        color: value == null
                            ? const Color(0xFF9CA3AF)
                            : const Color(0xFF2A2A2A),
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(width: 4),
                    // This toggles AM/PM in place rather than drilling into
                    // another screen, so the chevron should read as a
                    // dropdown indicator (pointing down), not a nav arrow —
                    // rotate the shared right-pointing asset 90°.
                    Transform.rotate(
                      angle: math.pi / 2,
                      child: SvgPicture.asset(
                        'assets/icons/list_row_chevron.svg',
                        width: 14,
                        height: 14,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _HubScaffold extends StatelessWidget {
  const _HubScaffold({
    super.key,
    required this.title,
    required this.onBack,
    required this.children,
    required this.profileAction,
    required this.onNotifications,
    required this.onQuickCreate,
    this.footer,
    this.trailing,
    this.backgroundColor,
  });

  final String title;
  final VoidCallback onBack;
  final List<Widget> children;
  final Widget profileAction;
  final VoidCallback onNotifications;
  final VoidCallback onQuickCreate;
  final Widget? footer;
  final Widget? trailing;
  final Color? backgroundColor;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        AppHomeHeader(
          profileAction: profileAction,
          onNotifications: onNotifications,
          onQuickCreate: onQuickCreate,
        ),
        // AppHomeHeader above already wraps itself in a SafeArea, so
        // applying another top-safe-area here (they're siblings, not
        // nested — Flutter doesn't dedupe that) double-pads under the
        // notch on a real iPhone while looking fine on macOS/simulator
        // where the top inset is 0.
        SafeArea(
          top: false,
          bottom: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(16, 8, 18, 12),
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(bottom: BorderSide(color: Color(0xFFF3F4F6))),
            ),
            child: Row(
              children: [
                Material(
                  color: const Color(0xFFF7F7F9),
                  borderRadius: BorderRadius.circular(12),
                  child: InkWell(
                    onTap: onBack,
                    borderRadius: BorderRadius.circular(12),
                    child: SizedBox(
                      width: 38,
                      height: 38,
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
                const SizedBox(width: 10),
                Expanded(child: Text(title, style: _QText.topbar)),
                ?trailing,
              ],
            ),
          ),
        ),
        Expanded(
          child: ColoredBox(
            color: backgroundColor ?? _Q.bg,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 20, 18, 28),
              children: children,
            ),
          ),
        ),
        ?footer,
      ],
    );
  }
}

class _LeaveHeaderButton extends StatelessWidget {
  const _LeaveHeaderButton({
    required this.onTap,
    this.enabled = true,
    this.label = 'Apply Leave',
  });

  final VoidCallback? onTap;
  final bool enabled;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: enabled ? const Color(0xFF0571A6) : const Color(0xFFE5E7EB),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Text(
            label,
            style: TextStyle(
              color: enabled ? Colors.white : const Color(0xFF9CA3AF),
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}

class _LeaveBalanceCard extends StatelessWidget {
  const _LeaveBalanceCard({required this.label, required this.item});

  final String label;
  final LeaveBalanceItem item;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 144,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEBEBEB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF222222),
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '${formatDays(item.remaining)}/${formatDays(item.total)}',
            style: const TextStyle(
              color: Color(0xFF222222),
              fontSize: 16,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'days available',
            style: TextStyle(color: Color(0xFF222222), fontSize: 10),
          ),
        ],
      ),
    );
  }
}

class LeaveViewSwitch extends StatelessWidget {
  const LeaveViewSwitch({
    required this.history,
    required this.onChanged,
    this.firstLabel = 'Upcoming',
    this.secondLabel = 'History',
  });

  final bool history;
  final ValueChanged<bool> onChanged;
  final String firstLabel;
  final String secondLabel;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Expanded(
            child: _LeaveViewSwitchItem(
              label: firstLabel,
              selected: !history,
              onTap: () => onChanged(false),
            ),
          ),
          Expanded(
            child: _LeaveViewSwitchItem(
              label: secondLabel,
              selected: history,
              onTap: () => onChanged(true),
            ),
          ),
        ],
      ),
    );
  }
}

class _LeaveViewSwitchItem extends StatelessWidget {
  const _LeaveViewSwitchItem({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: selected ? Colors.white : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          boxShadow: selected
              ? [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: .1),
                    blurRadius: 1.5,
                  ),
                ]
              : null,
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: selected ? const Color(0xFF0571A6) : const Color(0xFF9CA3AF),
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

class _LeaveRequestCard extends StatelessWidget {
  const _LeaveRequestCard({required this.request});

  final LeaveRequest request;

  @override
  Widget build(BuildContext context) {
    final (label, color, tint) = switch (request.decision) {
      LeaveDecision.approved => (
        'Approved',
        const Color(0xFF16A34A),
        const Color(0xFFDCFCE7),
      ),
      LeaveDecision.pending => (
        'Pending',
        const Color(0xFFFF383C),
        const Color(0xFFFEE2E2),
      ),
      LeaveDecision.declined => (
        'Declined',
        const Color(0xFF6B7280),
        const Color(0xFFF3F4F6),
      ),
    };
    final range = _sameDay(request.start, request.end)
        ? _short(request.start)
        : '${_short(request.start)} – ${_short(request.end)}';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .04),
            blurRadius: 2,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${request.type} Leave',
                  style: const TextStyle(
                    color: Color(0xFF111827),
                    fontSize: 14,
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
                  color: tint,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  label,
                  style: TextStyle(
                    color: color,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Text(
                range,
                style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12),
              ),
              const SizedBox(width: 16),
              Text(
                '${request.daysLabel} day${request.days == 1 ? '' : 's'}',
                style: const TextStyle(
                  color: Color(0xFF111827),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Everything a request was filled in with, plus what came back. Opened from
/// the "View details" line on any history card, so the employee can read their
/// own submission and the response without asking their manager.
Future<void> showRequestDetailsSheet(
  BuildContext context, {
  required String title,
  required String statusLabel,
  required Color statusColor,
  required Color statusTint,
  required List<(String label, String value)> rows,
  String responseLabel = '',
  String responseNote = '',
}) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: Colors.white,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (sheetContext) => SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 14, 20, 20),
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
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(
                      color: Color(0xFF111827),
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: statusTint,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    statusLabel,
                    style: TextStyle(
                      color: statusColor,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            for (final row in rows)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 116,
                      child: Text(
                        row.$1,
                        style: const TextStyle(
                          color: Color(0xFF9CA3AF),
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        row.$2.trim().isEmpty ? '—' : row.$2,
                        style: const TextStyle(
                          color: Color(0xFF111827),
                          fontSize: 13.5,
                          height: 1.45,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            if (responseLabel.isNotEmpty) ...[
              const SizedBox(height: 4),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 11,
                ),
                decoration: BoxDecoration(
                  color: statusTint,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      responseLabel,
                      style: TextStyle(
                        color: statusColor,
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    if (responseNote.trim().isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        responseNote.trim(),
                        style: TextStyle(
                          color: statusColor.withValues(alpha: .85),
                          fontSize: 12.5,
                          height: 1.45,
                        ),
                      ),
                    ],
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

/// The "View details" line every history card carries.
class _ViewDetailsLink extends StatelessWidget {
  const _ViewDetailsLink({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerLeft,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: const Padding(
        padding: EdgeInsets.symmetric(vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'View details',
              style: TextStyle(
                color: Color(0xFF0571A6),
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
            SizedBox(width: 3),
            Icon(
              Icons.chevron_right_rounded,
              size: 15,
              color: Color(0xFF0571A6),
            ),
          ],
        ),
      ),
    ),
  );
}

/// A policy in the list: its name and nothing else, in the app's own palette.
class _PolicyRow extends StatelessWidget {
  const _PolicyRow({required this.title, required this.onTap});

  final String title;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    borderRadius: BorderRadius.circular(16),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        child: Row(
          children: [
            Expanded(
              child: Text(
                '$title policy',
                style: const TextStyle(
                  color: Color(0xFF2A2A2A),
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const Icon(
              Icons.chevron_right_rounded,
              size: 20,
              color: Color(0xFF9CA3AF),
            ),
          ],
        ),
      ),
    ),
  );
}

class _QuickStatsCard extends StatelessWidget {
  const _QuickStatsCard({required this.label, required this.stats});

  final String label;
  final List<(String value, String caption, Color color)> stats;

  @override
  Widget build(BuildContext context) {
    return _FormCard(
      children: [
        Text(
          label.toUpperCase(),
          style: const TextStyle(
            color: Color(0xFF9CA3AF),
            fontSize: 12,
            fontWeight: FontWeight.w600,
            letterSpacing: .3,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: stats
              .map(
                (stat) => Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        stat.$1,
                        style: TextStyle(
                          color: stat.$3,
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        stat.$2,
                        style: const TextStyle(
                          color: Color(0xFF9CA3AF),
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ),
                ),
              )
              .toList(),
        ),
      ],
    );
  }
}

class _QuickRequestCard extends StatelessWidget {
  const _QuickRequestCard({
    required this.title,
    required this.subtitle,
    required this.status,
    required this.statusColor,
    this.footerText,
    this.onViewDetails,
  });

  final String title;
  final String subtitle;
  final String status;
  final Color statusColor;
  final String? footerText;

  /// Opens everything the request was filled in with, plus the response.
  final VoidCallback? onViewDetails;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .04),
            blurRadius: 2,
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
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: Color(0xFF111827),
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: Color(0xFF6B7280),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(
                status,
                style: TextStyle(
                  color: statusColor,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          if (footerText != null) ...[
            const SizedBox(height: 10),
            const Divider(height: 1, color: Color(0xFFF3F4F6)),
            const SizedBox(height: 10),
            Row(
              children: [
                SvgPicture.asset(
                  'assets/icons/schedule_clock_gray.svg',
                  width: 14,
                  height: 14,
                ),
                const SizedBox(width: 6),
                Text(
                  footerText!,
                  style: const TextStyle(
                    color: Color(0xFF6B7280),
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ],
          if (onViewDetails case final open?) ...[
            const SizedBox(height: 4),
            _ViewDetailsLink(onTap: open),
          ],
        ],
      ),
    );
  }
}

class _FormCard extends StatelessWidget {
  const _FormCard({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .04),
            blurRadius: 2,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: children,
      ),
    );
  }
}

class _FormTextArea extends StatelessWidget {
  const _FormTextArea({
    required this.controller,
    this.height,
    this.hintText = 'Add a reason...',
  });

  final TextEditingController controller;
  final double? height;
  final String hintText;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      decoration: BoxDecoration(
        border: Border.all(color: const Color(0xFFE5E7EB)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: TextField(
        controller: controller,
        maxLines: height == null ? 3 : null,
        expands: height != null,
        textAlignVertical: TextAlignVertical.top,
        style: const TextStyle(fontSize: 14, color: Color(0xFF111827)),
        decoration: InputDecoration(
          hintText: hintText,
          hintStyle: const TextStyle(color: Color(0x80111827)),
          // The wrapping Container already draws the border. `border` alone
          // doesn't suppress the theme's enabled/focused outlines, which is
          // what produced a second border inside this one.
          filled: false,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          disabledBorder: InputBorder.none,
          errorBorder: InputBorder.none,
          focusedErrorBorder: InputBorder.none,
          contentPadding: const EdgeInsets.all(12),
        ),
      ),
    );
  }
}

class _FormTextField extends StatelessWidget {
  const _FormTextField({
    required this.controller,
    required this.hintText,
    this.keyboardType,
  });

  final TextEditingController controller;
  final String hintText;
  final TextInputType? keyboardType;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: const Color(0xFFE5E7EB)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: TextField(
        controller: controller,
        keyboardType: keyboardType,
        style: const TextStyle(fontSize: 14, color: Color(0xFF111827)),
        decoration: InputDecoration(
          hintText: hintText,
          hintStyle: const TextStyle(color: Color(0x80111827)),
          filled: false,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          disabledBorder: InputBorder.none,
          errorBorder: InputBorder.none,
          focusedErrorBorder: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 11,
          ),
        ),
      ),
    );
  }
}

class _ReceiptUploadField extends StatelessWidget {
  const _ReceiptUploadField({required this.fileName, required this.onPicked});

  final String? fileName;
  final ValueChanged<PlatformFile?> onPicked;

  Future<void> _pick(BuildContext context) async {
    try {
      final result = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png'],
        withData: true,
      );
      if (result == null || result.files.isEmpty || !context.mounted) return;
      onPicked(result.files.single);
    } catch (_) {
      // File picking was cancelled or unsupported on this platform.
    }
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => _pick(context),
      borderRadius: BorderRadius.circular(12),
      child: CustomPaint(
        foregroundPainter: const _DashedRoundRectPainter(
          color: Color(0xFFE5E7EB),
          radius: 12,
        ),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              SvgPicture.asset(
                'assets/icons/upload_receipt.svg',
                width: 16,
                height: 16,
              ),
              const SizedBox(width: 8),
              Text(
                fileName ?? 'Upload receipt',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LeaveFieldLabel extends StatelessWidget {
  const _LeaveFieldLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          color: Color(0xFF9CA3AF),
          fontSize: 12,
          fontWeight: FontWeight.w600,
          letterSpacing: .3,
        ),
      ),
    );
  }
}

class _LeaveDropdownField extends StatelessWidget {
  const _LeaveDropdownField({
    required this.value,
    required this.filled,
    required this.onTap,
  });

  final String value;
  final bool filled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: double.infinity,
        height: 41.6,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        alignment: Alignment.centerLeft,
        decoration: BoxDecoration(
          border: Border.all(color: const Color(0xFFE5E7EB)),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          value,
          style: TextStyle(
            color: filled ? const Color(0xFF111827) : const Color(0xFF9CA3AF),
            fontSize: 14,
          ),
        ),
      ),
    );
  }
}

class _LeavePickerSheet extends StatelessWidget {
  const _LeavePickerSheet({
    required this.options,
    required this.selected,
    this.trailingLabels = const {},
    this.unavailable = const {},
  });

  final List<String> options;
  final String? selected;

  /// Types that cannot cover the dates already chosen, mapped to why. They are
  /// shown greyed rather than hidden, so the reason is visible where the
  /// choice is made.
  final Map<String, String> unavailable;

  /// Optional right-aligned note per option — the leave picker uses it to show
  /// the remaining balance ("10/12") next to each type.
  final Map<String, String> trailingLabels;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(0, 12, 0, 4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFD1D5DB),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            const SizedBox(height: 12),
            for (final option in options) ...[
              InkWell(
                onTap: unavailable.containsKey(option)
                    ? null
                    : () => Navigator.of(context).pop(option),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 20,
                    vertical: 14,
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              option,
                              style: TextStyle(
                                color: unavailable.containsKey(option)
                                    ? const Color(0xFF9CA3AF)
                                    : const Color(0xFF222222),
                                fontSize: 16,
                                fontWeight: option == selected
                                    ? FontWeight.w700
                                    : FontWeight.w400,
                              ),
                            ),
                            if (unavailable[option] case final reason?) ...[
                              const SizedBox(height: 2),
                              Text(
                                reason,
                                style: const TextStyle(
                                  color: Color(0xFF9CA3AF),
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                      if (trailingLabels[option] case final label?)
                        Text(
                          label,
                          style: TextStyle(
                            color: unavailable.containsKey(option)
                                ? const Color(0xFFB6BCC6)
                                : const Color(0xFF6B7280),
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              if (option != options.last)
                const Divider(height: 1, color: Color(0xFFEBEBEB)),
            ],
          ],
        ),
      ),
    );
  }
}

class _LeaveAttachmentField extends StatelessWidget {
  const _LeaveAttachmentField({required this.fileName, required this.onPicked});

  final String? fileName;
  final ValueChanged<String?> onPicked;

  Future<void> _pick(BuildContext context) async {
    try {
      final result = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png'],
      );
      if (result == null || result.files.isEmpty || !context.mounted) return;
      onPicked(result.files.single.name);
    } catch (_) {
      // File picking was cancelled or unsupported on this platform.
    }
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => _pick(context),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          border: Border.all(color: const Color(0xFFE5E7EB), width: 1.6),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SvgPicture.asset(
              'assets/icons/upload_receipt.svg',
              width: 16,
              height: 16,
            ),
            const SizedBox(width: 8),
            Text(
              fileName ?? 'Upload document',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _HomeSectionLabel extends StatelessWidget {
  const _HomeSectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text.toUpperCase(),
    style: const TextStyle(
      color: Color(0xFF717171),
      fontSize: 12,
      fontWeight: FontWeight.w800,
      letterSpacing: .9,
    ),
  );
}

class _HomeAttendanceCard extends StatelessWidget {
  const _HomeAttendanceCard({
    required this.date,
    required this.punchIn,
    required this.punchOut,
    required this.expectedOut,
    required this.progress,
    required this.needsCorrection,
    required this.onTap,
  });

  final DateTime date;
  final DateTime? punchIn;
  final DateTime? punchOut;
  final DateTime? expectedOut;
  final double progress;
  final bool needsCorrection;
  final VoidCallback onTap;

  static String _clock(DateTime? value) {
    if (value == null) return '-';
    final hour = value.hour % 12 == 0 ? 12 : value.hour % 12;
    final minute = value.minute.toString().padLeft(2, '0');
    return '$hour:$minute ${value.hour >= 12 ? 'PM' : 'AM'}';
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFFEBEBEB)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: .05),
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: const BoxDecoration(
                    color: Color(0xFFF7F7F9),
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: SvgPicture.asset(
                      'assets/icons/attendance_card_small_icon.svg',
                      width: 18,
                      height: 18,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                const Expanded(
                  child: Text(
                    'Attendance',
                    style: TextStyle(
                      color: Color(0xFF222222),
                      fontSize: 16.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                SvgPicture.asset(
                  'assets/icons/chevron_right_expand.svg',
                  width: 20,
                  height: 20,
                  colorFilter: const ColorFilter.mode(
                    Color(0xFF717171),
                    BlendMode.srcIn,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(
              '${date.day} ${_monthName(date.month)} ${date.year}',
              style: const TextStyle(
                color: Color(0xFF222222),
                fontSize: 15,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(99),
              child: LinearProgressIndicator(
                value: progress,
                minHeight: 6,
                backgroundColor: const Color(0xFFEBEBEB),
                valueColor: const AlwaysStoppedAnimation(Color(0xFF0571A6)),
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Text(
                  _clock(punchIn),
                  style: const TextStyle(
                    color: Color(0xFF717171),
                    fontSize: 12,
                  ),
                ),
                const Spacer(),
                Text(
                  expectedOut == null ? '-' : _clock(expectedOut),
                  style: const TextStyle(
                    color: Color(0xFF717171),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'PUNCH-IN',
                        style: TextStyle(
                          color: Color(0xFF717171),
                          fontSize: 10.5,
                          fontWeight: FontWeight.w800,
                          letterSpacing: .6,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _clock(punchIn),
                        style: const TextStyle(
                          color: Color(0xFF222222),
                          fontSize: 14.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(width: 1, height: 32, color: const Color(0xFFEBEBEB)),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'PUNCH-OUT',
                        style: TextStyle(
                          color: Color(0xFF717171),
                          fontSize: 10.5,
                          fontWeight: FontWeight.w800,
                          letterSpacing: .6,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _clock(punchOut),
                        style: const TextStyle(
                          color: Color(0xFF222222),
                          fontSize: 14.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (needsCorrection) ...[
              const SizedBox(height: 12),
              const Text(
                'Attendance correction required for few dates. Please regularize to avoid loss of pay.',
                style: TextStyle(
                  color: Color(0xFFFF383C),
                  fontSize: 12.5,
                  height: 1.4,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _HomeActionCard extends StatelessWidget {
  const _HomeActionCard({
    required this.icon,
    required this.color,
    required this.tint,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.imageAsset,
  });

  final IconData icon;
  final Color color;
  final Color tint;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final String? imageAsset;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFEBEBEB)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: .05),
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _IconTile(
              icon: icon,
              color: color,
              tint: tint,
              size: 38,
              imageAsset: imageAsset,
            ),
            const SizedBox(height: 10),
            Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Color(0xFF222222),
                fontSize: 15,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              subtitle,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Color(0xFF717171), fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _SingleActionFooter extends StatelessWidget {
  const _SingleActionFooter({
    required this.color,
    required this.label,
    required this.onTap,
    this.outlined = false,
  });
  final Color color;
  final String label;
  final VoidCallback onTap;
  final bool outlined;

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: Container(
      padding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: _Q.line)),
      ),
      child: SizedBox(
        width: double.infinity,
        child: outlined
            ? OutlinedButton(
                style: OutlinedButton.styleFrom(
                  foregroundColor: color,
                  side: BorderSide(color: color, width: 1.5),
                  padding: const EdgeInsets.symmetric(vertical: 15),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(15),
                  ),
                ),
                onPressed: onTap,
                child: Text(
                  label,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              )
            : FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: color,
                  padding: const EdgeInsets.symmetric(vertical: 15),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(15),
                  ),
                ),
                onPressed: onTap,
                child: Text(
                  label,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
      ),
    ),
  );
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.icon,
    required this.color,
    required this.tint,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final Color color;
  final Color tint;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(18),
          child: Container(
            padding: const EdgeInsets.all(15),
            decoration: BoxDecoration(
              border: Border.all(color: _Q.line),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Row(
              children: [
                _IconTile(icon: icon, color: color, tint: tint),
                const SizedBox(width: 13),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: _QText.cardTitle),
                      if (subtitle != null) ...[
                        const SizedBox(height: 3),
                        Text(subtitle!, style: _QText.cardSubtitle),
                      ],
                    ],
                  ),
                ),
                SvgPicture.asset(
                  'assets/icons/chevron_right_expand.svg',
                  width: 20,
                  height: 20,
                  colorFilter: const ColorFilter.mode(
                    _Q.inkFaint,
                    BlendMode.srcIn,
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

class _ChoiceCard extends StatelessWidget {
  const _ChoiceCard({
    required this.option,
    required this.selected,
    required this.color,
    required this.onTap,
  });

  final _FlowOption option;
  final bool selected;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? color.withValues(alpha: .1) : Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(15),
          decoration: BoxDecoration(
            border: Border.all(color: selected ? color : _Q.line, width: 1.5),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            children: [
              Icon(option.icon, color: selected ? color : _Q.inkSoft),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(option.label, style: _QText.cardTitle),
                    if (option.hint != null) ...[
                      const SizedBox(height: 2),
                      Text(option.hint!, style: _QText.cardSubtitle),
                    ],
                  ],
                ),
              ),
              Icon(
                selected ? Icons.check_circle_rounded : Icons.circle_outlined,
                color: selected ? color : _Q.inkFaint,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MonthCalendar extends StatefulWidget {
  const _MonthCalendar({
    required this.onPick,
    this.from,
    this.to,
    this.selectionLabel,
    this.selectableDayPredicate,
    this.firstDate,
    this.lastDate,
  });

  final DateTime? from;
  final DateTime? to;
  final ValueChanged<DateTime> onPick;
  final String? selectionLabel;
  final bool Function(DateTime day)? selectableDayPredicate;

  /// The window HR allows for this request. Days outside it are left blank
  /// rather than drawn greyed out, and the month arrows stop at its edges —
  /// so the calendar only ever offers days that can actually be applied for.
  final DateTime? firstDate;
  final DateTime? lastDate;

  @override
  State<_MonthCalendar> createState() => _MonthCalendarState();
}

class _MonthCalendarState extends State<_MonthCalendar> {
  late DateTime _month = _openingMonth();

  DateTime _openingMonth() {
    final start = widget.from ?? widget.firstDate ?? DateTime.now();
    return DateTime(start.year, start.month);
  }

  bool get _canGoBack {
    final first = widget.firstDate;
    if (first == null) return true;
    return DateTime(_month.year, _month.month - 1, 1).isAfter(
      DateTime(first.year, first.month, 0),
    );
  }

  bool get _canGoForward {
    final last = widget.lastDate;
    if (last == null) return true;
    return DateTime(_month.year, _month.month + 1, 1).isBefore(
      DateTime(last.year, last.month + 1, 1),
    );
  }

  void _shift(int delta) {
    setState(() => _month = DateTime(_month.year, _month.month + delta));
  }

  @override
  Widget build(BuildContext context) {
    final leading = DateTime(_month.year, _month.month).weekday % 7;
    final count = DateTime(_month.year, _month.month + 1, 0).day;
    final cells = leading + count;
    return Column(
      children: [
        Row(
          children: [
            Opacity(
              opacity: _canGoBack ? 1 : .25,
              child: _CalendarArrow(
                icon: Icons.chevron_left_rounded,
                onTap: _canGoBack ? () => _shift(-1) : null,
              ),
            ),
            Expanded(
              child: Text(
                '${_monthName(_month.month)} ${_month.year}',
                textAlign: TextAlign.center,
                style: _QText.cardTitle,
              ),
            ),
            Opacity(
              opacity: _canGoForward ? 1 : .25,
              child: _CalendarArrow(
                icon: Icons.chevron_right_rounded,
                onTap: _canGoForward ? () => _shift(1) : null,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: const ['S', 'M', 'T', 'W', 'T', 'F', 'S']
              .map(
                (day) => Expanded(
                  child: Text(
                    day,
                    textAlign: TextAlign.center,
                    style: _QText.mini,
                  ),
                ),
              )
              .toList(),
        ),
        const SizedBox(height: 5),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: ((cells + 6) ~/ 7) * 7,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 7,
            mainAxisExtent: 40,
            mainAxisSpacing: 3,
            crossAxisSpacing: 3,
          ),
          itemBuilder: (context, index) {
            final number = index - leading + 1;
            if (number < 1 || number > count) return const SizedBox();
            final day = DateTime(_month.year, _month.month, number);
            // Outside the window: not drawn at all, so the only dates on show
            // are ones this request can actually be made for.
            if (widget.firstDate != null && day.isBefore(widget.firstDate!)) {
              return const SizedBox();
            }
            if (widget.lastDate != null && day.isAfter(widget.lastDate!)) {
              return const SizedBox();
            }
            final enabled = widget.selectableDayPredicate?.call(day) ?? true;
            final selected =
                _sameDay(day, widget.from) || _sameDay(day, widget.to);
            final between =
                widget.from != null &&
                widget.to != null &&
                day.isAfter(widget.from!) &&
                day.isBefore(widget.to!);
            return InkWell(
              onTap: enabled ? () => widget.onPick(day) : null,
              borderRadius: BorderRadius.circular(11),
              child: Container(
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected
                      ? _Q.terra
                      : between
                      ? _Q.terraTint
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(between ? 0 : 11),
                ),
                child: Text(
                  '$number',
                  style: TextStyle(
                    color: !enabled
                        ? _Q.inkFaint.withValues(alpha: .45)
                        : selected
                        ? Colors.white
                        : _Q.ink,
                    fontSize: 14,
                    fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                  ),
                ),
              ),
            );
          },
        ),
        if (widget.selectionLabel != null) ...[
          const SizedBox(height: 14),
          Text(
            widget.selectionLabel!,
            style: const TextStyle(
              color: _Q.terra,
              fontSize: 15,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ],
    );
  }
}

class _CalendarArrow extends StatelessWidget {
  const _CalendarArrow({required this.icon, required this.onTap});
  final IconData icon;

  /// Null at the edge of the allowed window, which greys the arrow out.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: _Q.terraTint,
    borderRadius: BorderRadius.circular(10),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: SizedBox(
        width: 32,
        height: 32,
        child: Icon(icon, color: _Q.terra, size: 19),
      ),
    ),
  );
}

class _UploadCard extends StatelessWidget {
  const _UploadCard({
    required this.color,
    required this.tint,
    required this.value,
    required this.bytes,
    required this.onChanged,
  });
  final Color color;
  final Color tint;
  final String? value;
  final Uint8List? bytes;
  final ValueChanged<PlatformFile?> onChanged;

  bool get _canPreviewImage {
    return bytes != null &&
        (_extension == 'jpg' || _extension == 'jpeg' || _extension == 'png');
  }

  String? get _extension => value?.split('.').last.toLowerCase();

  Future<void> _pickFile(BuildContext context) async {
    try {
      final result = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png'],
        withData: true,
      );
      if (result == null || result.files.isEmpty || !context.mounted) return;
      final file = result.files.single;
      if (file.size > 5 * 1024 * 1024) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Choose a file smaller than 5 MB.')),
        );
        return;
      }
      if (file.bytes == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not read the selected file.')),
        );
        return;
      }
      onChanged(file);
    } catch (_) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open the file picker.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => _pickFile(context),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 30, horizontal: 16),
            decoration: BoxDecoration(
              color: value == null ? Colors.white : tint,
              border: Border.all(
                color: value == null ? _Q.line : color,
                width: 1.5,
              ),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              children: [
                if (_canPreviewImage) ...[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 220),
                      child: Image.memory(
                        bytes!,
                        width: double.infinity,
                        fit: BoxFit.contain,
                        errorBuilder: (_, _, _) => const SizedBox.shrink(),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                ],
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: tint,
                    borderRadius: BorderRadius.circular(15),
                  ),
                  child: Icon(
                    value == null
                        ? Icons.add_a_photo_rounded
                        : _extension == 'pdf'
                        ? Icons.picture_as_pdf_rounded
                        : Icons.image_rounded,
                    color: color,
                    size: 26,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  value ?? 'Tap to upload bill',
                  style: _QText.cardTitle.copyWith(
                    color: value == null ? _Q.ink : color,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  value == null
                      ? 'Photo or PDF, up to 5 MB'
                      : _extension == 'pdf'
                      ? 'PDF selected · Tap to replace'
                      : 'Image selected · Tap to replace',
                  style: _QText.cardSubtitleFaint,
                ),
              ],
            ),
          ),
        ),
        if (value != null)
          TextButton(
            onPressed: () => onChanged(null),
            child: const Text('Remove'),
          ),
      ],
    );
  }
}

class _WizardFooter extends StatelessWidget {
  const _WizardFooter({
    required this.color,
    required this.label,
    required this.onTap,
    this.secondary,
    this.onSecondary,
    this.secondaryAfter = false,
  });

  final Color color;
  final String label;
  final VoidCallback? onTap;
  final String? secondary;
  final VoidCallback? onSecondary;
  final bool secondaryAfter;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        color: Colors.white,
        padding: const EdgeInsets.fromLTRB(18, 10, 18, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (secondary != null && !secondaryAfter)
              TextButton(onPressed: onSecondary, child: Text(secondary!)),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: color,
                  disabledBackgroundColor: _Q.line,
                  padding: const EdgeInsets.symmetric(vertical: 15),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                onPressed: onTap,
                child: Text(
                  label,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
            ),
            if (secondary != null && secondaryAfter)
              TextButton(onPressed: onSecondary, child: Text(secondary!)),
          ],
        ),
      ),
    );
  }
}

class _PaperCard extends StatelessWidget {
  const _PaperCard({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: _Q.line),
        borderRadius: BorderRadius.circular(18),
      ),
      child: child,
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _Q.terraTint,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline_rounded, color: _Q.terra, size: 20),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(color: _Q.ink, fontSize: 13, height: 1.45),
            ),
          ),
        ],
      ),
    );
  }
}

class _IconTile extends StatelessWidget {
  const _IconTile({
    required this.icon,
    required this.color,
    required this.tint,
    this.size = 44,
    this.imageAsset,
  });
  final IconData icon;
  final Color color;
  final Color tint;
  final double size;
  final String? imageAsset;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      // The illustrated icons carry their own colour, so they sit on white;
      // only the flat glyph icons need a tinted plate behind them.
      color: imageAsset != null ? Colors.white : tint,
      borderRadius: BorderRadius.circular(13),
    ),
    child: imageAsset != null
        ? Padding(
            padding: const EdgeInsets.all(5),
            child: Image.asset(imageAsset!, fit: BoxFit.contain),
          )
        : Icon(icon, color: color, size: 22),
  );
}

enum _StepKind { choice, dropdown, dates, date, text, upload }

class _FlowStep {
  const _FlowStep({
    required this.label,
    required this.kind,
    required this.question,
    required this.subtitle,
    this.options,
    this.placeholder,
    this.optional = false,
    this.money = false,
  });

  final String label;
  final _StepKind kind;
  final String question;
  final String subtitle;
  final List<_FlowOption>? options;
  final String? placeholder;
  final bool optional;
  final bool money;
}

class _FlowOption {
  const _FlowOption(this.label, this.icon, [this.hint]);
  final String label;
  final IconData icon;
  final String? hint;
}

class _Policy {
  const _Policy(this.title, this.icon, this.color, this.tint, this.body);
  final String title;
  final IconData icon;
  final Color color;
  final Color tint;
  final String body;
}

const _flowSteps = <_QuickFlow, List<_FlowStep>>{
  _QuickFlow.leave: [
    _FlowStep(
      label: 'Type',
      kind: _StepKind.choice,
      question: 'What type of leave?',
      subtitle: 'Pick the category that fits.',
      options: [
        _FlowOption('Sick', Icons.thermostat_rounded),
        _FlowOption('Casual', Icons.coffee_rounded),
        _FlowOption('Earned', Icons.flight_takeoff_rounded),
      ],
    ),
    _FlowStep(
      label: 'Dates',
      kind: _StepKind.dates,
      question: 'Which dates?',
      subtitle: 'Pick a start and end date.',
    ),
    _FlowStep(
      label: 'Note',
      kind: _StepKind.text,
      question: 'Add a note',
      subtitle: 'Optional — helps your manager.',
      placeholder: 'e.g. Family function out of town…',
      optional: true,
    ),
  ],
  _QuickFlow.overtime: [
    _FlowStep(
      label: 'Duration',
      kind: _StepKind.dropdown,
      question: 'How long?',
      subtitle: 'Overtime is claimed as a full day or a half day.',
      options: [
        _FlowOption('Full day', Icons.schedule_rounded, 'Comp-off +1 day'),
        _FlowOption('Half day', Icons.timelapse_rounded, 'Comp-off +0.5 day'),
      ],
    ),
    _FlowStep(
      label: 'Day',
      kind: _StepKind.date,
      question: 'Which day did you work overtime?',
      subtitle: 'The day you worked the extra hours.',
    ),
    _FlowStep(
      label: 'Project',
      kind: _StepKind.text,
      question: 'Which project?',
      subtitle: 'The project this overtime was for.',
      placeholder: 'e.g. Apollo',
    ),
    _FlowStep(
      label: 'Note',
      kind: _StepKind.text,
      question: 'Add a note',
      subtitle: 'Optional — what did you work on?',
      placeholder: 'e.g. Release hotfix for Apollo…',
      optional: true,
    ),
  ],
  // Type comes first because everything after it depends on which one was
  // picked: how far back the date may go, and what the amount is capped at.
  _QuickFlow.reimbursement: [
    _FlowStep(
      label: 'Type',
      kind: _StepKind.choice,
      question: 'What type of expense?',
      subtitle: 'Pick a category.',
      // Replaced at render time with the org's own types, their caps and
      // their backdating windows — see _stepsForCurrentFlow.
      options: [],
    ),
    _FlowStep(
      label: 'Date',
      kind: _StepKind.date,
      question: 'When was the expense?',
      subtitle: 'Pick the date on the bill.',
    ),
    _FlowStep(
      label: 'Amount',
      kind: _StepKind.text,
      question: 'How much?',
      subtitle: 'Amount you paid.',
      money: true,
    ),
    _FlowStep(
      label: 'Bill',
      kind: _StepKind.upload,
      question: 'Upload your receipt',
      subtitle: 'Optional — choose a photo or PDF up to 5 MB.',
      optional: true,
    ),
    _FlowStep(
      label: 'Note',
      kind: _StepKind.text,
      question: 'Add a note',
      subtitle: 'Optional.',
      placeholder: 'e.g. Cab to client office…',
      optional: true,
    ),
  ],
};

const _policiesData = <_Policy>[
  _Policy(
    'Leave',
    Icons.calendar_month_rounded,
    _Q.terra,
    _Q.terraTint,
    '12 sick + 12 casual + 18 earned days a year. Apply at least 2 days ahead for planned leave; your manager approves within 48 hours. Unused earned leave carries over up to 30 days.',
  ),
  _Policy(
    'Attendance',
    Icons.access_time_filled_rounded,
    _Q.gold,
    _Q.goldTint,
    'Core hours are 11am–4pm, 9 hours a day. Mark in/out on the tracker. Three late marks in a month need a manager note. Work-from-home up to 8 days a month.',
  ),
  _Policy(
    'Payroll',
    Icons.payments_rounded,
    _Q.teal,
    _Q.tealTint,
    'Salary is credited on the last working day of the month. Payslips live on the Payroll tab. Raise any discrepancy within 7 days of credit and finance will resolve it.',
  ),
  _Policy(
    'POSH',
    Icons.shield_rounded,
    _Q.plum,
    _Q.plumTint,
    'Sowaka has zero tolerance for harassment. Complaints go to the Internal Committee and are handled confidentially, with resolution within 90 days. You can raise one anonymously.',
  ),
  _Policy(
    'Overtime',
    Icons.schedule_rounded,
    _Q.sage,
    _Q.sageTint,
    'Overtime needs prior manager approval and is claimed as a full day or a half day. Approved overtime earns comp-off — a full day adds 1 day to your comp-off balance, a half day adds 0.5.',
  ),
  // Play requires an in-app route to account deletion, and people ask where
  // their data goes anyway — so it is a policy page like any other.
  _Policy(
    'Your data',
    Icons.privacy_tip_rounded,
    _Q.teal,
    _Q.tealTint,
    'Sowaka holds what your employer needs to run HR: your name, work email '
        'and employee ID, your attendance and leave records, reimbursement '
        'claims and receipts, performance reviews, and anything you post on '
        'Connect.\n\n'
        'Your account belongs to your employer, so it is closed when you '
        'leave. To have your account and personal data deleted sooner, email '
        'your HR team and privacy@getsowaka.com from your work address. We '
        'confirm within 7 working days and delete within 30, except for '
        'records your employer must keep by law — attendance and payroll '
        'history, which are retained for the statutory period and then '
        'removed.\n\n'
        'You can ask for a copy of your data the same way. Sowaka does not '
        'sell your data or use it for advertising.',
  ),
];

class _Q {
  static const bg = Color(0xFFF8F4EE);
  static const ink = Color(0xFF2A2420);
  static const inkSoft = Color(0xFF6E655C);
  static const inkFaint = Color(0xFFA79D92);
  static const line = Color(0xFFF0E8DD);
  static const terra = Color(0xFFBE5A36);
  static const terraDeep = Color(0xFF7C3318);
  static const terraTint = Color(0xFFF6E5DB);
  static const gold = Color(0xFFC98A2E);
  static const goldTint = Color(0xFFF4ECDD);
  static const teal = Color(0xFF4F8C89);
  static const tealTint = Color(0xFFDEEBE9);
  static const plum = Color(0xFF8A6AA0);
  static const plumTint = Color(0xFFEEE6F0);
  static const sage = Color(0xFF4C5840);
  static const sageTint = Color(0xFFE7EFE4);
}

class _QText {
  static const eyebrow = TextStyle(
    color: _Q.terra,
    fontSize: 11,
    fontWeight: FontWeight.w800,
    letterSpacing: 1.45,
  );
  static const heroSmall = TextStyle(
    color: _Q.ink,
    fontSize: 23,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.4,
  );
  static const topbar = TextStyle(
    color: _Q.ink,
    fontSize: 19,
    fontWeight: FontWeight.w800,
  );
  static const section = TextStyle(
    color: _Q.inkFaint,
    fontSize: 12,
    fontWeight: FontWeight.w800,
    letterSpacing: .9,
  );
  static const subtitle = TextStyle(
    color: _Q.inkSoft,
    fontSize: 13.5,
    height: 1.45,
  );
  static const cardTitle = TextStyle(
    color: _Q.ink,
    fontSize: 15,
    fontWeight: FontWeight.w800,
  );
  static const cardSubtitle = TextStyle(
    color: _Q.inkSoft,
    fontSize: 12.5,
    height: 1.35,
  );
  static const cardSubtitleFaint = TextStyle(
    color: _Q.inkFaint,
    fontSize: 12.5,
    height: 1.35,
  );
  static const mini = TextStyle(
    color: _Q.inkFaint,
    fontSize: 11.5,
    fontWeight: FontWeight.w700,
  );
}

String _short(DateTime date) {
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
  return '${date.day} ${months[date.month - 1]}';
}

String _monthName(int month) {
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
  return months[month - 1];
}

bool matchesAttendanceFilter(AttendanceDayView day, AttendanceFilter? filter) {
  if (filter == null) return true;
  final kind = day.kind;
  return switch (filter) {
    AttendanceFilter.present => kind == AttendanceKind.present,
    AttendanceFilter.late => day.late,
    AttendanceFilter.halfDay => kind == AttendanceKind.halfDay,
    AttendanceFilter.leave => kind == AttendanceKind.leaveApproved,
    AttendanceFilter.leaveApplied => kind == AttendanceKind.leavePending,
    AttendanceFilter.correction => kind == AttendanceKind.attention,
    AttendanceFilter.correctionAwaits =>
      kind == AttendanceKind.regularizationPending,
    AttendanceFilter.holiday => kind == AttendanceKind.holiday,
  };
}

bool _sameDay(DateTime? a, DateTime? b) =>
    a != null &&
    b != null &&
    a.year == b.year &&
    a.month == b.month &&
    a.day == b.day;

DateTime _dateOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

String _rangeLabel(DateTime from, DateTime to) {
  final days = to.difference(from).inDays + 1;
  return _sameDay(from, to)
      ? '${_short(from)} · 1 day'
      : '${_short(from)} – ${_short(to)} · $days days';
}

String _weekday(int weekday) =>
    const ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][weekday - 1];

String _decision(LeaveDecision decision) => switch (decision) {
  LeaveDecision.approved => 'Approved',
  LeaveDecision.declined => 'Declined',
  LeaveDecision.pending => 'Pending',
};

String _money(double value) {
  final digits = value.round().toString();
  final buffer = StringBuffer();
  for (var index = 0; index < digits.length; index++) {
    if (index > 0 && (digits.length - index) % 3 == 0) buffer.write(',');
    buffer.write(digits[index]);
  }
  return '₹$buffer';
}

Color _flowColor(_QuickFlow flow) => switch (flow) {
  _QuickFlow.leave => _Q.terra,
  _QuickFlow.overtime => _Q.gold,
  _QuickFlow.reimbursement => _Q.teal,
};

String _flowTitle(_QuickFlow flow) => switch (flow) {
  _QuickFlow.leave => 'Apply for leave',
  _QuickFlow.overtime => 'Apply for overtime',
  _QuickFlow.reimbursement => 'Claim reimbursement',
};

String _flowCta(_QuickFlow flow) => switch (flow) {
  _QuickFlow.leave || _QuickFlow.overtime => 'Send to manager',
  _QuickFlow.reimbursement => 'Send to finance',
};

String _trackLabel(_QuickFlow flow) => switch (flow) {
  _QuickFlow.leave => 'Manage leave → My requests',
  _QuickFlow.overtime => 'Overtime → My requests',
  _QuickFlow.reimbursement => 'Reimbursements → My claims',
};
