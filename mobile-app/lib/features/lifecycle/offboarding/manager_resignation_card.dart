/// R7: a report's resignation in Team › Requests. Accept, Change last day,
/// or Release early; never Reject.
library;

import 'package:flutter/material.dart';

import '../../shared/app_toast.dart';
import 'offboarding_dates.dart';
import 'offboarding_models.dart';
import 'offboarding_store.dart';
import 'offboarding_ui.dart';

/// The manager's resignation cards, above the other requests: the ones
/// waiting on them, then the ones they have passed to HR. Nothing while the
/// lifecycle is off or nobody has resigned. [query] filters by name, as the
/// Requests search does.
class ManagerResignationRequests extends StatelessWidget {
  const ManagerResignationRequests({
    super.key,
    required this.store,
    this.query = '',
    this.today,
  });

  final OffboardingStore store;
  final String query;
  final DateTime? today;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (context, _) {
      final needle = query.trim().toLowerCase();
      final shown =
          [
            for (final resignation in store.managerResignations)
              if (!resignation.accepted &&
                  (needle.isEmpty ||
                      (resignation.name ?? '').toLowerCase().contains(needle)))
                resignation,
          ]..sort(
            (a, b) => (a.withManager ? 0 : 1).compareTo(b.withManager ? 0 : 1),
          );
      if (shown.isEmpty) return const SizedBox.shrink();
      return Column(
        key: const ValueKey('manager-resignations'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final resignation in shown) ...[
            ResignationRequestCard(
              store: store,
              resignation: resignation,
              today: today,
            ),
            const SizedBox(height: 12),
          ],
        ],
      );
    },
  );
}

/// The last day an early release can be: the day before the last day by
/// notice (the server refuses that day itself: "An early release is before
/// the last day by notice"), never before [today]. Null when no such day is
/// left; a year from today when the notice day is unknown.
DateTime? lastEarlyReleaseDay({
  required DateTime? lastDayByNotice,
  required DateTime today,
}) {
  if (lastDayByNotice == null) return today.add(const Duration(days: 365));
  final last = DateTime(
    lastDayByNotice.year,
    lastDayByNotice.month,
    lastDayByNotice.day - 1,
  );
  return last.isBefore(today) ? null : last;
}

class ResignationRequestCard extends StatefulWidget {
  const ResignationRequestCard({
    super.key,
    required this.store,
    required this.resignation,
    this.today,
  });

  final OffboardingStore store;
  final ResignationView resignation;
  final DateTime? today;

  @override
  State<ResignationRequestCard> createState() => _ResignationRequestCardState();
}

class _ResignationRequestCardState extends State<ResignationRequestCard> {
  String? _busy;

  /// Brought into view from a push about it; outlined for a moment.
  bool _focused = false;

  ResignationView get _r => widget.resignation;

  @override
  void initState() {
    super.initState();
    widget.store.addListener(_maybeFocus);
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeFocus());
  }

  @override
  void dispose() {
    widget.store.removeListener(_maybeFocus);
    super.dispose();
  }

  void _maybeFocus() {
    if (!mounted || !widget.store.takeFocus(_r.id)) return;
    setState(() => _focused = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      Scrollable.ensureVisible(
        context,
        duration: const Duration(milliseconds: 300),
        alignment: 0.1,
      );
    });
    Future<void>.delayed(const Duration(seconds: 3), () {
      if (mounted) setState(() => _focused = false);
    });
  }

  Future<void> _act(String action, {DateTime? date}) async {
    setState(() => _busy = action);
    try {
      await widget.store.api.actOnResignation(
        _r.id,
        action: action,
        date: date == null ? null : dateKey(date),
      );
      await widget.store.refresh();
      if (mounted) showAppToast(context, 'Sent to HR to confirm.');
    } catch (error) {
      if (mounted) showAppToast(context, error.toString());
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<DateTime?> _pick({
    required String help,
    required DateTime first,
    required DateTime last,
    DateTime? initial,
  }) {
    final start =
        initial == null || initial.isBefore(first) || initial.isAfter(last)
        ? first
        : initial;
    return showDatePicker(
      context: context,
      helpText: help,
      initialDate: start,
      firstDate: first,
      lastDate: last,
    );
  }

  Future<void> _changeDay() async {
    final today = dayOnly(widget.today ?? DateTime.now());
    final date = await _pick(
      help: 'New last day',
      first: today,
      last: today.add(const Duration(days: 365)),
      initial: _r.lastDayByNotice,
    );
    if (date != null && mounted) await _act('change_day', date: date);
  }

  DateTime? get _lastEarlyDay => lastEarlyReleaseDay(
    lastDayByNotice: _r.lastDayByNotice,
    today: dayOnly(widget.today ?? DateTime.now()),
  );

  Future<void> _releaseEarly() async {
    final today = dayOnly(widget.today ?? DateTime.now());
    final last = _lastEarlyDay;
    if (last == null) {
      showAppToast(
        context,
        'The last day by notice is today or tomorrow: there is no earlier day to release on.',
      );
      return;
    }
    final date = await _pick(
      help: 'Release on',
      first: today,
      last: last,
      initial: today,
    );
    if (date != null && mounted) await _act('release_early', date: date);
  }

  @override
  Widget build(BuildContext context) {
    final r = _r;
    final name = r.name ?? 'Someone';
    final action = r.manager;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: _focused ? OffColors.brand : Colors.transparent,
          width: 2,
        ),
      ),
      child: OffCard(
        key: ValueKey('resignation-request-${r.id}'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                OffAvatar(initialsOf(name), photoUrl: r.photoUrl),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Resignation · $name',
                        style: offText(15, weight: FontWeight.w600, height: 20),
                      ),
                      if (r.designation case final role?)
                        Text(
                          role,
                          style: offText(12, color: OffColors.secondary),
                        ),
                    ],
                  ),
                ),
                if (!r.withManager)
                  OffStatusPill(r.withHr ? 'With HR' : 'Accepted'),
              ],
            ),
            const SizedBox(height: 12),
            for (final (label, value) in [
              if (r.submittedAt case final sent?) ('Sent:', weekdayDay(sent)),
              ('Reason:', r.reason),
              if (r.noticeDays > 0) ('Notice period:', '${r.noticeDays} days'),
              if (r.lastDayByNotice case final day?)
                ('Last day by notice:', weekdayDay(day)),
              if (action case final a?
                  when a.action == 'change_day' && a.date != null)
                ('You agreed:', weekdayDay(a.date!)),
              if (action case final a?
                  when a.action == 'release_early' && a.date != null)
                ('Release on:', weekdayDay(a.date!)),
            ])
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 130,
                      child: Text(
                        label,
                        style: offText(13, color: OffColors.secondary),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        value,
                        style: offText(13, weight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
              ),
            if (r.note case final note?) ...[
              const SizedBox(height: 6),
              Container(
                key: const ValueKey('resignation-request-note'),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: OffColors.inset,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text('“$note”', style: offText(13, height: 19)),
              ),
            ],
            if (r.withManager) ...[
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: _TintButton(
                      key: ValueKey('resignation-accept-${r.id}'),
                      label: 'Accept',
                      busy: _busy == 'accept',
                      foreground: OffColors.green,
                      background: OffColors.greenTint,
                      onPressed: _busy == null ? () => _act('accept') : null,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _TintButton(
                      key: ValueKey('resignation-change-day-${r.id}'),
                      label: 'Change last day',
                      busy: _busy == 'change_day',
                      foreground: OffColors.ink,
                      background: OffColors.inset,
                      onPressed: _busy == null ? _changeDay : null,
                    ),
                  ),
                ],
              ),
              Center(
                child: TextButton(
                  key: ValueKey('resignation-release-early-${r.id}'),
                  onPressed: _busy == null ? _releaseEarly : null,
                  child: _busy == 'release_early'
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(
                          'Release early',
                          style: offText(
                            13,
                            weight: FontWeight.w600,
                            color: OffColors.brand,
                          ),
                        ),
                ),
              ),
            ],
            const OffPrivacyLine(
              'This request is private. Only you and HR can see it.',
            ),
          ],
        ),
      ),
    );
  }
}

class _TintButton extends StatelessWidget {
  const _TintButton({
    super.key,
    required this.label,
    required this.foreground,
    required this.background,
    required this.onPressed,
    this.busy = false,
  });

  final String label;
  final Color foreground;
  final Color background;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 40,
    child: TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        backgroundColor: background,
        foregroundColor: foreground,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      child: busy
          ? SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: foreground,
              ),
            )
          : Text(
              label,
              style: offText(13, weight: FontWeight.w600, color: foreground),
            ),
    ),
  );
}
