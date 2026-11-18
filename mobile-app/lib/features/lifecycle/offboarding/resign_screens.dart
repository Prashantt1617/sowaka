/// R0 (the Resign row on Work detail), R1 (the Resign form) and R1b (Send
/// your resignation? sheet).
library;

import 'package:flutter/material.dart';

import '../../shared/app_toast.dart';
import 'offboarding_dates.dart';
import 'offboarding_models.dart';
import 'offboarding_store.dart';
import 'offboarding_ui.dart';

/// The reasons the form offers when the server sends none (it sends its
/// `reasons` with `GET /lifecycle/resignation`, and those win). The canvas
/// draws only "Better opportunity"; the rest follow the exit interview's
/// list.
const resignReasons = [
  'Better opportunity',
  'Growth',
  'Pay',
  'Work-life balance',
  'Relocation',
  'Higher studies',
  'Personal',
  'Other',
];

/// Decision 7 (CONTRACT.md): the one privacy line on a resignation.
const resignationPrivacy = 'Only your manager and HR can see this.';

/// R0: at the bottom of one's own Work detail, under a divider, while the
/// lifecycle is on and the server says this person may resign. Nothing
/// otherwise.
class ResignEntryRow extends StatelessWidget {
  const ResignEntryRow({super.key, required this.store, this.onSent});

  final OffboardingStore store;

  /// After "Yes, send it": the profile opens its Resignation tab.
  final VoidCallback? onSent;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (context, _) {
      if (!store.canResign) return const SizedBox.shrink();
      return Column(
        key: const ValueKey('resign-entry'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 8),
          const Divider(height: 1, color: OffColors.line),
          const SizedBox(height: 6),
          OffTaskRow(
            key: const ValueKey('resign-entry-row'),
            icon: Icons.logout_rounded,
            title: 'Resign',
            subtitle: 'Start your resignation',
            onTap: () async {
              final sent = await Navigator.of(context).push<bool>(
                MaterialPageRoute(builder: (_) => ResignScreen(store: store)),
              );
              if (sent == true) onSent?.call();
            },
          ),
        ],
      );
    },
  );
}

/// R1: the reason (required), a note (optional), and the last day the notice
/// period gives. No date picker. Continue opens [ResignConfirmSheet]; the
/// route pops with true once the resignation is sent.
class ResignScreen extends StatefulWidget {
  const ResignScreen({super.key, required this.store});

  final OffboardingStore store;

  @override
  State<ResignScreen> createState() => _ResignScreenState();
}

class _ResignScreenState extends State<ResignScreen> {
  String? _reason;
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  String? get _managerFirst => firstName(widget.store.session.user.managerName);

  Future<void> _pickReason() async {
    final picked = await showOffSheet<String>(
      context,
      (context) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const OffSheetHandle(),
          Text('Reason', style: offText(18, weight: FontWeight.w700)),
          const SizedBox(height: 8),
          for (final reason
              in widget.store.reasons.isEmpty
                  ? resignReasons
                  : widget.store.reasons)
            ListTile(
              key: ValueKey('resign-reason-$reason'),
              contentPadding: EdgeInsets.zero,
              title: Text(
                reason,
                style: offText(
                  15,
                  weight: reason == _reason ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
              trailing: reason == _reason
                  ? const Icon(Icons.check_rounded, color: OffColors.brand)
                  : null,
              onTap: () => Navigator.of(context).pop(reason),
            ),
        ],
      ),
    );
    if (picked != null && mounted) setState(() => _reason = picked);
  }

  Future<void> _continue() async {
    final reason = _reason;
    if (reason == null) return;
    final sent = await showOffSheet<bool>(
      context,
      (_) => ResignConfirmSheet(
        store: widget.store,
        reason: reason,
        note: _note.text,
      ),
    );
    if (sent == true && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.store.resignationState;
    final lastDay = state.lastDayByNotice;
    final who = _managerFirst ?? 'your manager';
    return OffScaffold(
      key: const ValueKey('resign-screen'),
      title: 'Resign',
      close: true,
      bottom: OffPrimaryButton(
        key: const ValueKey('resign-continue'),
        label: 'Continue',
        onPressed: _reason == null ? null : _continue,
      ),
      children: [
        OffCard(
          color: OffColors.inset,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const OffOverline('Reason', color: OffColors.secondary),
              const SizedBox(height: 8),
              Material(
                color: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: const BorderSide(color: OffColors.line),
                ),
                child: InkWell(
                  key: const ValueKey('resign-reason'),
                  borderRadius: BorderRadius.circular(12),
                  onTap: _pickReason,
                  child: SizedBox(
                    height: 46,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              _reason ?? 'Choose a reason',
                              style: offText(
                                14,
                                color: _reason == null
                                    ? OffColors.tertiary
                                    : OffColors.ink,
                              ),
                            ),
                          ),
                          const Icon(
                            Icons.keyboard_arrow_down_rounded,
                            color: OffColors.secondary,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              const OffOverline('Note (optional)', color: OffColors.secondary),
              const SizedBox(height: 8),
              TextField(
                key: const ValueKey('resign-note'),
                controller: _note,
                minLines: 4,
                maxLines: 8,
                maxLength: 1000,
                style: offText(14, height: 20),
                decoration: InputDecoration(
                  hintText: "Anything you'd like $who and HR to know…",
                  hintStyle: offText(14, color: OffColors.tertiary),
                  counterText: '',
                  filled: true,
                  fillColor: Colors.white,
                  contentPadding: const EdgeInsets.all(14),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: OffColors.line),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: OffColors.line),
                  ),
                ),
              ),
              if (lastDay != null) ...[
                const SizedBox(height: 16),
                const OffOverline(
                  'Last day by notice period',
                  color: OffColors.secondary,
                ),
                const SizedBox(height: 6),
                Text(
                  fullDay(lastDay),
                  key: const ValueKey('resign-last-day'),
                  style: offText(15, weight: FontWeight.w600),
                ),
                if (state.noticeDays > 0)
                  Text(
                    '${state.noticeDays} days from the day you send it',
                    style: offText(12, color: OffColors.secondary),
                  ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 14),
        const OffPrivacyLine(
          "Most people tell their manager before sending this. This form doesn't replace that conversation.",
          icon: Icons.chat_bubble_outline_rounded,
        ),
        const OffPrivacyLine(resignationPrivacy),
      ],
    );
  }
}

/// R1b: "Send your resignation?", the reason and the notice period, then
/// "Yes, send it" or "Not now". Pops with true once sent.
class ResignConfirmSheet extends StatefulWidget {
  const ResignConfirmSheet({
    super.key,
    required this.store,
    required this.reason,
    this.note,
  });

  final OffboardingStore store;
  final String reason;
  final String? note;

  @override
  State<ResignConfirmSheet> createState() => _ResignConfirmSheetState();
}

class _ResignConfirmSheetState extends State<ResignConfirmSheet> {
  bool _sending = false;

  Future<void> _send() async {
    setState(() => _sending = true);
    try {
      await widget.store.api.resign(reason: widget.reason, note: widget.note);
      await widget.store.refresh();
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _sending = false);
      showAppToast(context, error.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.store.resignationState;
    final manager = firstName(widget.store.session.user.managerName);
    final route = manager == null
        ? 'It goes to HR.'
        : 'It goes to $manager first, then HR.';
    return Column(
      key: const ValueKey('resign-confirm'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const OffSheetHandle(),
        Text(
          'Send your resignation?',
          style: offText(20, weight: FontWeight.w700, height: 26),
        ),
        const SizedBox(height: 8),
        Text(
          '$route Your last day is set from your notice period. You can withdraw it until HR accepts.',
          style: offText(14, color: OffColors.secondary, height: 20),
        ),
        const SizedBox(height: 16),
        OffDetailRows([
          ('Reason', widget.reason),
          if (state.noticeDays > 0)
            ('Notice period', '${state.noticeDays} days'),
          if (state.lastDayByNotice case final day?)
            ('Last day by notice', fullDay(day)),
        ]),
        const SizedBox(height: 20),
        OffPrimaryButton(
          key: const ValueKey('resign-send'),
          label: 'Yes, send it',
          busy: _sending,
          onPressed: _send,
        ),
        const SizedBox(height: 10),
        OffOutlineButton(
          key: const ValueKey('resign-not-now'),
          label: 'Not now',
          onPressed: _sending ? null : () => Navigator.of(context).pop(false),
        ),
      ],
    );
  }
}
