part of 'quick_actions_screen.dart';

// ---------------------------------------------------------------- missed punches

/// Missed punches (Figma 4473:67442): a month's days with a punch missing or
/// graded absent, oldest first, each with its check-in and check-out, and
/// the line under the month that says how many can still be fixed and by
/// when. Payroll's "Fix N missing punches" to-do and the salary's "Check
/// unpaid days" both open it (GET /payroll/missing-punches).
///
/// A day that can still be fixed opens the correction the Attendance list
/// gives it ([PayrollScreen.onFixPunchDay]); one that can't says why and has
/// no chevron. A day already sent wears its request's state.
class _MissedPunchesPage extends StatefulWidget {
  const _MissedPunchesPage({this.period});

  /// The month to open on ("2026-10"); this month when null.
  final String? period;

  @override
  State<_MissedPunchesPage> createState() => _MissedPunchesPageState();
}

class _MissedPunchesPageState extends State<_MissedPunchesPage> {
  late DateTime _month;
  MissingPunches? _data;
  String? _error;
  bool _started = false;

  /// The day whose correction is open, so a second tap does not open two.
  DateTime? _fixing;

  static DateTime get _thisMonth {
    final now = DateTime.now();
    return DateTime(now.year, now.month);
  }

  bool get _canGoForward => DateTime(
    _month.year,
    _month.month + 1,
  ).isBefore(DateTime(_thisMonth.year, _thisMonth.month + 1));

  @override
  void initState() {
    super.initState();
    final asked = payrollMonth(widget.period);
    // Never a month still to come: the server refuses one.
    _month = asked == null || asked.isAfter(_thisMonth) ? _thisMonth : asked;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    unawaited(_load());
  }

  Future<void> _load() async {
    final month = _month;
    setState(() {
      _data = null;
      _error = null;
    });
    try {
      final data = await _PayrollScope.of(
        context,
      ).api.fetchMissingPunches(period: payrollPeriod(month));
      // Paged on while this was on its way: that month's read lands instead.
      if (!mounted || month != _month) return;
      setState(() => _data = data);
    } catch (error) {
      if (mounted && month == _month) {
        setState(() => _error = payrollErrorText(error));
      }
    }
  }

  void _step(int delta) {
    final month = DateTime(_month.year, _month.month + delta);
    if (month.isAfter(_thisMonth)) return;
    setState(() => _month = month);
    unawaited(_load());
  }

  Future<void> _fix(MissingPunchDay day) async {
    if (_fixing != null) return;
    setState(() => _fixing = day.date);
    try {
      await _PayrollScope.of(context).onFixPunchDay(day);
    } finally {
      if (mounted) setState(() => _fixing = null);
    }
    // A correction sent changes the day's tag and the count.
    if (mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final days = [...?data?.days]..sort((a, b) => a.date.compareTo(b.date));
    return _payrollPage(
      context,
      key: const ValueKey('payroll-missed-punches'),
      title: 'Missed punches',
      children: [
        _MissedPunchesMonthNav(
          month: _month,
          onPrevious: () => _step(-1),
          onNext: _canGoForward ? () => _step(1) : null,
        ),
        if (data == null && _error == null)
          const _PrLoading()
        else if (data == null)
          _PrError(_error!, onRetry: _load)
        else ...[
          Padding(
            padding: const EdgeInsets.only(top: 2, bottom: 14),
            child: Text(
              _missedPunchesNote(data),
              key: const ValueKey('missed-punches-note'),
              textAlign: TextAlign.center,
              style: _Mp.note.copyWith(
                color: data.count > 0 ? _prRed : _Er.label,
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (days.isEmpty)
            const _HubEmptyState(
              iconAsset: 'assets/icons/action_card_leave_calendar.png',
              text: 'No missed punches this month.',
            ),
          for (final (i, day) in days.indexed) ...[
            if (i > 0) const SizedBox(height: 10),
            _MissedPunchCard(
              day: day,
              onTap: _fixable(day) ? () => _fix(day) : null,
            ),
          ],
        ],
      ],
    );
  }
}

/// A day that opens a correction: still inside its window, and not already
/// put right.
bool _fixable(MissingPunchDay day) =>
    day.canFix && day.requestStatus != 'approved';

/// "12 days to fix by 20 Oct", "1 day to fix", or "Nothing to fix".
String _missedPunchesNote(MissingPunches data) {
  if (data.count <= 0) return 'Nothing to fix';
  final days = '${data.count} ${data.count == 1 ? 'day' : 'days'} to fix';
  final fixBy = data.fixBy;
  return fixBy == null ? days : '$days by ${_short(fixBy)}';
}

/// The type of the Missed punches frame, on the Earnings face.
abstract final class _Mp {
  static const label = Color(0xFF7A7A82);
  static const divider = Color(0xFFE4E4E8);

  static final month = _Er._sora.copyWith(
    fontSize: 20,
    height: 1.26,
    letterSpacing: -0.2,
    fontWeight: FontWeight.w400,
  );
  static final note = _Er._sora.copyWith(
    fontSize: 13.5,
    height: 1.26,
    fontWeight: FontWeight.w600,
  );
  static final weekday = _Er._sora.copyWith(
    fontSize: 13,
    height: 1.26,
    fontWeight: FontWeight.w600,
  );
  static final dayNumber = _Er._sora.copyWith(
    fontSize: 22,
    height: 24.2 / 22,
    fontWeight: FontWeight.w700,
  );
  static final punchLabel = _Er._sora.copyWith(
    color: label,
    fontSize: 12.5,
    height: 1.26,
    fontWeight: FontWeight.w600,
  );
  static final punchValue = _Er._sora.copyWith(
    fontSize: 18,
    height: 1.26,
    fontWeight: FontWeight.w600,
  );
  static final closed = _Er._sora.copyWith(
    color: _Er.label,
    fontSize: 12,
    height: 1.35,
    fontWeight: FontWeight.w500,
  );
}

/// "‹ October 2026 ›": the month, and the ways to the one before and after
/// (none after this month).
class _MissedPunchesMonthNav extends StatelessWidget {
  const _MissedPunchesMonthNav({
    required this.month,
    required this.onPrevious,
    required this.onNext,
  });

  final DateTime month;
  final VoidCallback onPrevious;

  /// Null on this month: there is nothing to fix ahead of today.
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    Widget arrow(String key, String asset, VoidCallback? onTap, String label) =>
        Semantics(
          button: true,
          enabled: onTap != null,
          label: label,
          child: Opacity(
            opacity: onTap == null ? .3 : 1,
            child: InkWell(
              key: ValueKey(key),
              onTap: onTap,
              customBorder: const CircleBorder(),
              child: SizedBox(
                width: 44,
                height: 44,
                child: Center(
                  child: SvgPicture.asset(asset, width: 22, height: 22),
                ),
              ),
            ),
          ),
        );
    return Row(
      children: [
        arrow(
          'missed-punches-previous',
          'assets/icons/payroll_missed_month_prev.svg',
          onPrevious,
          'Previous month',
        ),
        Expanded(
          child: Text(
            '${_monthName(month.month)} ${month.year}',
            key: const ValueKey('missed-punches-month'),
            textAlign: TextAlign.center,
            maxLines: 1,
            style: _Mp.month,
          ),
        ),
        arrow(
          'missed-punches-next',
          'assets/icons/payroll_missed_month_next.svg',
          onNext,
          'Next month',
        ),
      ],
    );
  }
}

/// One day: its weekday and date, the two punches ("NA" for a check-in
/// that never came, "—" for a check-out), and a chevron when it can be
/// fixed. A day sent for correction carries the request's state; one that
/// can no longer be fixed says why underneath.
class _MissedPunchCard extends StatelessWidget {
  const _MissedPunchCard({required this.day, required this.onTap});

  final MissingPunchDay day;

  /// Null when the day can't be fixed.
  final VoidCallback? onTap;

  static const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /// "10:02 AM", on the phone's clock, as the Attendance list shows it.
  static String _clock(DateTime at) {
    final hour = at.hour % 12 == 0 ? 12 : at.hour % 12;
    return '$hour:${at.minute.toString().padLeft(2, '0')} '
        '${at.hour >= 12 ? 'PM' : 'AM'}';
  }

  @override
  Widget build(BuildContext context) {
    final weekday = day.weekday.isNotEmpty
        ? day.weekday
        : _weekdays[day.date.weekday - 1];
    final tag = switch (day.requestStatus) {
      'pending' => const _PrPill('Sent', color: _prBlue, tint: _prBlueTint),
      'approved' => const _PrPill('Fixed', color: _prGreen, tint: _prGreenTint),
      'declined' => const _PrPill('Declined', color: _prRed, tint: _prRedTint),
      _ => null,
    };
    final closed = onTap == null ? day.closedMessage : null;
    final punchIn = day.punchIn;
    final punchOut = day.punchOut;

    Widget punch(String label, String value, {Color? color}) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, maxLines: 1, style: _Mp.punchLabel),
        const SizedBox(height: 4),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: _Mp.punchValue.copyWith(color: color),
        ),
      ],
    );

    return Material(
      key: ValueKey(
        'missed-punch-${payrollPeriod(day.date)}-'
        '${day.date.day.toString().padLeft(2, '0')}',
      ),
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 14, 12, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  SizedBox(
                    width: 60,
                    child: Column(
                      children: [
                        Text(weekday, maxLines: 1, style: _Mp.weekday),
                        const SizedBox(height: 1),
                        Text(
                          '${day.date.day}',
                          maxLines: 1,
                          style: _Mp.dayNumber,
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: punch(
                        'Check-in',
                        punchIn == null ? 'NA' : _clock(punchIn),
                        color: punchIn == null ? _prError : null,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.only(left: 13, right: 12),
                      decoration: const BoxDecoration(
                        border: Border(left: BorderSide(color: _Mp.divider)),
                      ),
                      child: punch(
                        'Check-out',
                        punchOut == null ? '—' : _clock(punchOut),
                      ),
                    ),
                  ),
                  if (onTap != null)
                    SvgPicture.asset(
                      'assets/icons/payroll_fbp_chevron.svg',
                      key: const ValueKey('missed-punch-chevron'),
                      width: 18,
                      height: 18,
                    )
                  else
                    const SizedBox(width: 18),
                ],
              ),
              // Under the punches, so the two columns line up card to card.
              if (tag != null || closed != null)
                Padding(
                  padding: const EdgeInsets.only(left: 72, top: 10),
                  child: Row(
                    children: [
                      ?tag,
                      if (tag != null && closed != null)
                        const SizedBox(width: 8),
                      if (closed != null)
                        Expanded(
                          child: Text(
                            closed,
                            key: const ValueKey('missed-punch-closed'),
                            style: _Mp.closed,
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The Missed punches page on its own, inside a [PayrollScreen]'s navigator,
/// for tests and screenshots.
Widget payrollMissedPunchesPageForTesting({String? period}) =>
    _MissedPunchesPage(period: period);
