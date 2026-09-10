part of '../../manager/presentation/manager_screen.dart';

class _ApplyLeaveSheet extends StatefulWidget {
  const _ApplyLeaveSheet({required this.state, required this.bloc});

  final ManagerState state;
  final ManagerBloc bloc;

  @override
  State<_ApplyLeaveSheet> createState() => _ApplyLeaveSheetState();
}

class _ApplyLeaveSheetState extends State<_ApplyLeaveSheet> {
  String _type = '';
  late DateTime _startDate;
  late DateTime _endDate;
  int _step = 0;
  final TextEditingController _reasonController = TextEditingController();

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _startDate = DateTime(now.year, now.month, now.day);
    _endDate = _startDate;
    // Only the types HR has switched on, named as the policy names them.
    _type = _leaveTypeLabels.isEmpty ? 'Casual' : _leaveTypeLabels.first;
  }

  /// The short labels for the types this employee may apply for.
  List<String> get _leaveTypeLabels => [
    for (final label in _shift.applicableLeaveLabels)
      if (_shift.windowForLeave(label)?.key != 'comp_off')
        label.replaceAll(' Leave', ''),
  ];

  ShiftPolicy get _shift =>
      widget.state.dashboard?.shift ?? const ShiftPolicy();

  /// The window HR set for the type currently chosen.
  LeaveTypeWindow? get _window => _shift.windowForLeave(_type);

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _selectDate({required bool start}) async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final selected = await showDatePicker(
      context: context,
      initialDate: _canSelectLeaveDay(start ? _startDate : _endDate)
          ? (start ? _startDate : _endDate)
          : (_window?.allowBackdated ?? true)
          ? today
          : today,
      firstDate: _window == null
          ? today.subtract(const Duration(days: 365))
          : _window!.earliestFrom(today),
      lastDate: _window == null
          ? today.add(const Duration(days: 365))
          : _window!.latestFrom(today),
      selectableDayPredicate: (day) {
        final date = DateTime(day.year, day.month, day.day);
        if (!_canSelectLeaveDay(date)) return false;
        if (!start && date.isBefore(_startDate)) return false;
        if (!start &&
            date.difference(_startDate).inDays >= _maxLeaveApplyDays) {
          return false;
        }
        return true;
      },
    );
    if (selected == null || !mounted) return;
    setState(() {
      if (start) {
        _startDate = selected;
        if (_endDate.isBefore(selected)) _endDate = selected;
      } else {
        _endDate = selected;
      }
    });
  }

  /// The same rule the quick-actions form and the server use.
  String? get _datesBlockedReason => leaveRangeProblem(
    policy: _shift,
    holidayDates: _holidayKeys,
    typeLabel: _type,
    from: _startDate,
    to: _endDate,
    today: DateTime.now(),
    maxDays: _maxLeaveApplyDays,
  );

  bool get _datesApplicable => _datesBlockedReason == null;

  /// Company holidays this employee observes, as yyyy-mm-dd keys.
  Set<String> get _holidayKeys => {
    for (final holiday
        in widget.state.dashboard?.holidays ?? const <CompanyHoliday>[])
      '${holiday.date.year.toString().padLeft(4, '0')}-'
          '${holiday.date.month.toString().padLeft(2, '0')}-'
          '${holiday.date.day.toString().padLeft(2, '0')}',
  };

  /// A day that can be picked at all: a working day inside the type's window.
  bool _canSelectLeaveDay(DateTime day) {
    if (_shift.isWeekOff(day) || _isCompanyHoliday(day)) return false;
    final window = _shift.windowForLeave(_type);
    if (window == null) return true;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final earliest = window.earliestFrom(today);
    final latest = window.latestFrom(today);
    return !day.isBefore(
          DateTime(earliest.year, earliest.month, earliest.day),
        ) &&
        !day.isAfter(DateTime(latest.year, latest.month, latest.day));
  }

  bool _isCompanyHoliday(DateTime day) {
    final holidays =
        widget.state.dashboard?.holidays ?? const <CompanyHoliday>[];
    return holidays.any(
      (holiday) =>
          holiday.date.year == day.year &&
          holiday.date.month == day.month &&
          holiday.date.day == day.day,
    );
  }

  bool _rangeHasBlockedDay() {
    for (
      var day = _startDate;
      !day.isAfter(_endDate);
      day = day.add(const Duration(days: 1))
    ) {
      if (!_canSelectLeaveDay(day)) return true;
    }
    return false;
  }

  void _continueFromDates() {
    if (_endDate.isBefore(_startDate)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('End date cannot be before start date')),
      );
      return;
    }
    if (_endDate.difference(_startDate).inDays + 1 > _maxLeaveApplyDays) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Leave cannot exceed 30 days')),
      );
      return;
    }
    if (_rangeHasBlockedDay()) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Leave cannot include weekends or holidays'),
        ),
      );
      return;
    }
    setState(() => _step = 1);
  }

  void _submit() {
    final reason = _reasonController.text.trim();
    if (reason.length < 3) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a reason for leave')),
      );
      return;
    }
    widget.bloc.add(
      SubmitLeaveApplication(
        type: _type,
        startDate: _startDate,
        endDate: _endDate,
        reason: reason,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final androidNavClearance =
        Theme.of(context).platform == TargetPlatform.android ? 72.0 : 0.0;
    final bottomClearance = math.max(
      math.max(
        math.max(mediaQuery.viewPadding.bottom, mediaQuery.padding.bottom),
        mediaQuery.systemGestureInsets.bottom,
      ),
      androidNavClearance,
    );

    return Positioned.fill(
      child: GestureDetector(
        onTap: () => widget.bloc.add(const CloseApplyLeave()),
        child: Container(
          color: MColors.ink.withValues(alpha: .44),
          alignment: Alignment.bottomCenter,
          child: GestureDetector(
            onTap: () {},
            child: SafeArea(
              top: false,
              bottom: false,
              child: Container(
                width: double.infinity,
                margin: EdgeInsets.only(bottom: bottomClearance),
                padding: const EdgeInsets.fromLTRB(18, 10, 18, 24),
                decoration: const BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                ),
                child: widget.state.applyLeaveSent
                    ? Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const IconBox(
                            icon: Icons.check_rounded,
                            color: Colors.white,
                            tint: MColors.sage,
                            size: 62,
                            iconSize: 28,
                          ),
                          const SizedBox(height: 16),
                          const Text(
                            'Request sent',
                            style: TextStyle(
                              color: MColors.ink,
                              fontSize: 21,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 5),
                          const Text(
                            'Your manager will be notified.',
                            style: TextStyle(color: MColors.inkSoft),
                          ),
                          const SizedBox(height: 18),
                          ActionButton(
                            label: 'Done',
                            background: MColors.terra,
                            foreground: Colors.white,
                            onTap: () =>
                                widget.bloc.add(const CloseApplyLeave()),
                          ),
                        ],
                      )
                    : Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Center(
                            child: Container(
                              width: 38,
                              height: 4,
                              decoration: BoxDecoration(
                                color: MColors.line,
                                borderRadius: BorderRadius.circular(99),
                              ),
                            ),
                          ),
                          const SizedBox(height: 18),
                          const Text(
                            'Apply for leave',
                            style: TextStyle(
                              color: MColors.ink,
                              fontSize: 21,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 14),
                          if (_step == 0) ...[
                            TextFormField(
                              key: ValueKey(
                                'leave-start-${_startDate.toIso8601String()}',
                              ),
                              readOnly: true,
                              initialValue: MaterialLocalizations.of(
                                context,
                              ).formatMediumDate(_startDate),
                              onTap: () => _selectDate(start: true),
                              decoration: _fieldDecoration('Start date'),
                            ),
                            const SizedBox(height: 10),
                            TextFormField(
                              key: ValueKey(
                                'leave-end-${_endDate.toIso8601String()}',
                              ),
                              readOnly: true,
                              initialValue: MaterialLocalizations.of(
                                context,
                              ).formatMediumDate(_endDate),
                              onTap: () => _selectDate(start: false),
                              decoration: _fieldDecoration('End date'),
                            ),
                            const SizedBox(height: 10),
                            const Text(
                              'Weekends and company holidays are unavailable.',
                              style: TextStyle(
                                color: MColors.inkFaint,
                                fontSize: 12.5,
                              ),
                            ),
                          ] else ...[
                            Wrap(
                              spacing: 8,
                              children: _leaveTypeLabels.map((
                                type,
                              ) {
                                final selected = _type == type;
                                return ChoiceChip(
                                  label: Text(type),
                                  selected: selected,
                                  onSelected: (_) =>
                                      setState(() => _type = type),
                                  selectedColor: MColors.ink,
                                  labelStyle: TextStyle(
                                    color: selected
                                        ? Colors.white
                                        : MColors.inkSoft,
                                    fontWeight: FontWeight.w800,
                                  ),
                                  backgroundColor: Colors.white,
                                  side: const BorderSide(color: MColors.line),
                                );
                              }).toList(),
                            ),
                            const SizedBox(height: 14),
                            TextFormField(
                              controller: _reasonController,
                              maxLines: 3,
                              maxLength: 500,
                              decoration: _fieldDecoration('Reason'),
                            ),
                          ],
                          if (_step == 0)
                            if (_datesBlockedReason case final reason?) ...[
                            const SizedBox(height: 12),
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
                          ],
                          const SizedBox(height: 16),
                          ActionButton(
                            label: _step == 0
                                ? 'Apply leave'
                                : 'Submit request',
                            // Off for dates the policy will not accept, so the
                            // form never opens on a request that cannot be made.
                            background: _step == 0 && !_datesApplicable
                                ? const Color(0xFFE5E7EB)
                                : MColors.terra,
                            foreground: _step == 0 && !_datesApplicable
                                ? const Color(0xFF9CA3AF)
                                : Colors.white,
                            onTap: _step == 0
                                ? (_datesApplicable ? _continueFromDates : null)
                                : _submit,
                          ),
                          if (_step == 1)
                            TextButton(
                              onPressed: () => setState(() => _step = 0),
                              child: const Text('Back'),
                            ),
                        ],
                      ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
