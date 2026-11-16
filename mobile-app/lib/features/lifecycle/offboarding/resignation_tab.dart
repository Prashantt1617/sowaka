/// The Resignation tab: on one's own profile (R2a before HR accepts, R2b on
/// notice), and the manager's view of a report's (R8b).
library;

import 'package:flutter/material.dart';

import '../../shared/app_toast.dart';
import 'offboarding_dates.dart';
import 'offboarding_models.dart';
import 'offboarding_page.dart';
import 'offboarding_store.dart';
import 'offboarding_ui.dart';
import 'resign_screens.dart';

/// "With manager" / "With HR" / "Accepted".
String resignationStatusLabel(ResignationView resignation) =>
    switch (resignation.status) {
      'with_manager' => 'With manager',
      'with_hr' => 'With HR',
      'accepted' => 'Accepted',
      'withdrawn' => 'Withdrawn',
      _ => resignation.status,
    };

/// The track a resignation follows: Sent → manager → HR → Accepted.
List<OffStep> resignationSteps(ResignationView resignation) {
  final manager = resignation.managerFirstName ?? 'Manager';
  final action = resignation.manager;
  final managerSub = switch (action?.action) {
    null => resignation.withManager ? 'Reviewing' : null,
    'change_day' =>
      'New last day ${action!.date == null ? '' : shortDay(action.date!)}'
          .trim(),
    'release_early' => 'Early release',
    _ => action!.at == null ? 'Accepted' : 'Accepted ${shortDay(action.at!)}',
  };
  return [
    OffStep(
      'Sent',
      OffStepState.done,
      sub: resignation.submittedAt == null
          ? null
          : shortDay(resignation.submittedAt!),
    ),
    OffStep(
      manager,
      resignation.withManager ? OffStepState.current : OffStepState.done,
      sub: managerSub,
    ),
    OffStep(
      'HR',
      resignation.withManager
          ? OffStepState.todo
          : resignation.withHr
          ? OffStepState.current
          : OffStepState.done,
      sub: resignation.withHr ? 'In review' : null,
    ),
    OffStep(
      'Accepted',
      resignation.accepted ? OffStepState.done : OffStepState.todo,
      sub: resignation.hrAcceptedAt == null
          ? null
          : shortDay(resignation.hrAcceptedAt!),
    ),
  ];
}

String _earlyRelease(ResignationView resignation) {
  final action = resignation.manager;
  if (action?.action == 'release_early' && action?.date != null) {
    return 'Yes · ${fullDay(action!.date!)}';
  }
  return 'None';
}

/// R2a / R2b: one's own Resignation tab. Shown only while a resignation is
/// open ([OffboardingStore.showsResignationTab]).
class OwnResignationTab extends StatefulWidget {
  const OwnResignationTab({
    super.key,
    required this.store,
    this.onOpenDocuments,
    this.today,
  });

  final OffboardingStore store;
  final VoidCallback? onOpenDocuments;
  final DateTime? today;

  @override
  State<OwnResignationTab> createState() => _OwnResignationTabState();
}

class _OwnResignationTabState extends State<OwnResignationTab> {
  OffboardingPageData? _page;
  bool _withdrawing = false;
  bool _loadingPage = false;

  @override
  void initState() {
    super.initState();
    widget.store.addListener(_storeChanged);
    _loadPage();
  }

  @override
  void dispose() {
    widget.store.removeListener(_storeChanged);
    super.dispose();
  }

  /// HR accepting while the tab is open brings the before-you-go list.
  void _storeChanged() {
    if (_page == null) _loadPage();
  }

  Future<void> _loadPage() async {
    final resignation = widget.store.resignation;
    if (_loadingPage ||
        resignation == null ||
        !resignation.accepted ||
        !widget.store.showsOffboardingPage) {
      return;
    }
    _loadingPage = true;
    try {
      final page = await widget.store.api.fetchOffboarding();
      if (mounted) setState(() => _page = page);
    } catch (_) {
      // The tab still shows the notice and the details without the list.
    } finally {
      _loadingPage = false;
    }
  }

  Future<void> _withdraw(ResignationView resignation) async {
    final manager = resignation.managerFirstName;
    final yes = await confirmOff(
      context,
      title: 'Withdraw your resignation?',
      body: manager == null
          ? 'It is cancelled and HR is told. Nothing else changes.'
          : 'It is cancelled and $manager and HR are told. Nothing else changes.',
      yes: 'Withdraw',
      no: 'Keep it',
    );
    if (!yes || !mounted) return;
    setState(() => _withdrawing = true);
    try {
      await widget.store.api.withdraw();
      await widget.store.refresh();
      if (mounted) showAppToast(context, 'Your resignation is withdrawn.');
    } catch (error) {
      if (mounted) showAppToast(context, error.toString());
    } finally {
      if (mounted) setState(() => _withdrawing = false);
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.store,
    builder: (context, _) {
      final resignation = widget.store.resignation;
      if (resignation == null) return const SizedBox.shrink();
      return resignation.accepted
          ? _onNotice(context, resignation)
          : _beforeAccepted(resignation);
    },
  );

  /// R2a.
  Widget _beforeAccepted(ResignationView resignation) => Column(
    key: const ValueKey('resignation-tab-open'),
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      OffCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Expanded(child: OffOverline('Where it stands')),
                OffStatusPill(
                  resignationStatusLabel(resignation),
                  key: const ValueKey('resignation-status'),
                ),
              ],
            ),
            const SizedBox(height: 16),
            OffStepper(resignationSteps(resignation)),
          ],
        ),
      ),
      const SizedBox(height: 12),
      OffDetailRows([
        if (resignation.submittedAt case final sent?)
          ('Sent on', fullDay(sent)),
        if (resignation.lastDayByNotice case final day?)
          ('Last day by notice period', fullDay(day)),
        if (resignation.manager case final action?
            when action.action == 'change_day' && action.date != null)
          (
            'Last day agreed by ${resignation.managerFirstName ?? 'your manager'}',
            fullDay(action.date!),
          ),
        if (resignation.manager case final action?
            when action.action == 'release_early' && action.date != null)
          ('Early release', fullDay(action.date!)),
        ('Reason', resignation.reason),
      ]),
      const OffPrivacyLine(resignationPrivacy),
      if (resignation.canWithdraw) ...[
        OffOutlineButton(
          key: const ValueKey('resignation-withdraw'),
          label: 'Withdraw resignation',
          busy: _withdrawing,
          onPressed: () => _withdraw(resignation),
        ),
        const SizedBox(height: 8),
        Text(
          'You can withdraw until HR accepts.',
          textAlign: TextAlign.center,
          style: offText(12, color: OffColors.secondary),
        ),
      ],
      const SizedBox(height: 16),
    ],
  );

  /// R2b: the countdown lives here, never on My Team.
  Widget _onNotice(BuildContext context, ResignationView resignation) {
    final page = _page;
    final items = page == null
        ? const <BeforeYouGoItem>[]
        : beforeYouGoItems(
            context,
            store: widget.store,
            data: page,
            managerFirst: resignation.managerFirstName,
            onChanged: _loadPage,
            onOpenDocuments: widget.onOpenDocuments,
            withSettlement: true,
          );
    return Column(
      key: const ValueKey('resignation-tab-notice'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OffNoticeCard(
          lastDay: page?.tl ?? resignation.lastDay,
          acceptedAt: resignation.hrAcceptedAt,
          noticeFrom: resignation.submittedAt,
          daysLeft: page?.daysLeft ?? resignation.daysLeft,
          today: widget.today,
        ),
        if (items.isNotEmpty) ...[
          const SizedBox(height: 12),
          BeforeYouGoCard(items: items),
        ],
        const SizedBox(height: 12),
        OffDetailRows([
          if (resignation.submittedAt case final sent?)
            ('Sent on', fullDay(sent)),
          ('Early release', _earlyRelease(resignation)),
          ('Reason', resignation.reason),
        ]),
        const OffPrivacyLine(resignationPrivacy),
        const SizedBox(height: 16),
      ],
    );
  }
}

/// R8b: a report's Resignation tab, for their manager. Where it stands, the
/// handover checklist and its note, the steps others track, Mark handover
/// done. Never any pay.
class ManagerLeaverTab extends StatefulWidget {
  const ManagerLeaverTab({
    super.key,
    required this.store,
    required this.userId,
    required this.name,
    this.today,
  });

  final OffboardingStore store;
  final String userId;
  final String name;
  final DateTime? today;

  @override
  State<ManagerLeaverTab> createState() => _ManagerLeaverTabState();
}

class _ManagerLeaverTabState extends State<ManagerLeaverTab> {
  LeaverView? _view;
  String? _error;
  bool _saving = false;
  bool _markingDone = false;
  final _newItem = TextEditingController();
  final _note = TextEditingController();
  String _savedNote = '';

  String get _first => firstName(widget.name) ?? widget.name;

  @override
  void initState() {
    super.initState();
    _note.addListener(() => setState(() {}));
    _load();
  }

  @override
  void dispose() {
    _newItem.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final view = await widget.store.api.fetchLeaver(widget.userId);
      if (!mounted) return;
      setState(() {
        _view = view;
        _error = null;
        _savedNote = view.handover.note ?? '';
        _note.text = _savedNote;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _save(List<String> items, {String? note}) async {
    setState(() => _saving = true);
    try {
      await widget.store.api.saveHandover(
        widget.userId,
        items: items,
        note: note ?? _savedNote,
      );
      await _load();
    } catch (error) {
      if (mounted) showAppToast(context, error.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  List<String> get _titles => [
    for (final item in _view?.handover.items ?? const <HandoverItem>[])
      item.title,
  ];

  Future<void> _add() async {
    final title = _newItem.text.trim();
    if (title.isEmpty) return;
    _newItem.clear();
    await _save([..._titles, title]);
  }

  Future<void> _remove(HandoverItem item) async {
    await _save([
      for (final row in _view!.handover.items)
        if (row.id != item.id) row.title,
    ]);
  }

  Future<void> _markDone() async {
    final handover = _view!.handover;
    final waiting = handover.items.length - handover.uploadedCount;
    if (waiting > 0) {
      final yes = await confirmOff(
        context,
        title: 'Mark the handover done?',
        body: waiting == 1
            ? '1 item is still waiting for $_first.'
            : '$waiting items are still waiting for $_first.',
        yes: 'Mark done',
        no: 'Not yet',
      );
      if (!yes || !mounted) return;
    }
    setState(() => _markingDone = true);
    try {
      await widget.store.api.markHandoverDone(widget.userId);
      await _load();
    } catch (error) {
      if (mounted) showAppToast(context, error.toString());
    } finally {
      if (mounted) setState(() => _markingDone = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final view = _view;
    if (view == null) {
      return OffLoadState(
        error: _error,
        onRetry: _error == null
            ? null
            : () => setState(() {
                _error = null;
                _load();
              }),
      );
    }
    final resignation =
        view.resignation ?? widget.store.resignationOf(widget.userId);
    return Column(
      key: const ValueKey('manager-leaver-tab'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (view.onNotice)
          OffNoticeCard(
            lastDay: view.tl ?? resignation?.lastDay,
            acceptedAt: view.acceptedAt,
            noticeFrom: resignation?.submittedAt,
            daysLeft: view.daysLeft,
            today: widget.today,
          )
        else if (resignation != null)
          OffCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    const Expanded(child: OffOverline('Where it stands')),
                    OffStatusPill(resignationStatusLabel(resignation)),
                  ],
                ),
                const SizedBox(height: 16),
                OffStepper(resignationSteps(resignation)),
              ],
            ),
          ),
        const SizedBox(height: 12),
        if (view.onNotice)
          _checklist(view)
        else
          OffCard(
            child: Text(
              'Once HR accepts, you add the handover checklist for $_first here.',
              style: offText(13, color: OffColors.secondary, height: 19),
            ),
          ),
        if (view.otherSteps.isNotEmpty) ...[
          const SizedBox(height: 12),
          OffCard(
            key: const ValueKey('manager-other-steps'),
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Other exit steps',
                  style: offText(15, weight: FontWeight.w600),
                ),
                for (final step in view.otherSteps)
                  OffTaskRow(
                    icon: step.systemKey == 'return_assets'
                        ? Icons.laptop_mac_outlined
                        : Icons.task_alt_rounded,
                    title: step.title,
                    subtitle: step.systemKey == 'return_assets'
                        ? 'Tracked by IT and admin'
                        : step.helper,
                    trailing: Text(
                      step.done ? 'Done' : 'To do',
                      style: offText(
                        12,
                        weight: FontWeight.w600,
                        color: step.done
                            ? OffColors.green
                            : OffColors.secondary,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
        const OffPrivacyLine(
          'This tab is private. Only you and HR can see it.',
        ),
        if (view.onNotice)
          view.handover.done
              ? Text(
                  view.handover.doneAt == null
                      ? 'Handover marked done'
                      : 'Handover marked done · ${shortDay(view.handover.doneAt!)}',
                  key: const ValueKey('manager-handover-done'),
                  textAlign: TextAlign.center,
                  style: offText(
                    13,
                    weight: FontWeight.w600,
                    color: OffColors.green,
                  ),
                )
              : OffPrimaryButton(
                  key: const ValueKey('manager-mark-handover-done'),
                  label: 'Mark handover done',
                  busy: _markingDone,
                  onPressed: view.handover.items.isEmpty ? null : _markDone,
                ),
        const SizedBox(height: 16),
      ],
    );
  }

  Widget _checklist(LeaverView view) {
    final handover = view.handover;
    final noteChanged = _note.text.trim() != _savedNote.trim();
    return OffCard(
      key: const ValueKey('manager-handover'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Handover checklist',
                  style: offText(15, weight: FontWeight.w600),
                ),
              ),
              if (handover.items.isNotEmpty)
                Text(
                  '${handover.uploadedCount} of ${handover.items.length} uploaded',
                  style: offText(12, color: OffColors.tertiary),
                ),
            ],
          ),
          const SizedBox(height: 12),
          OffOverline('Note for $_first'),
          const SizedBox(height: 6),
          TextField(
            key: const ValueKey('manager-handover-note'),
            controller: _note,
            minLines: 2,
            maxLines: 5,
            maxLength: 1000,
            style: offText(13, height: 19),
            decoration: InputDecoration(
              hintText: 'When you need these by, and who takes over',
              hintStyle: offText(13, color: OffColors.tertiary),
              counterText: '',
              isDense: true,
              filled: true,
              fillColor: OffColors.page,
              contentPadding: const EdgeInsets.all(12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
            ),
          ),
          if (noteChanged)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                key: const ValueKey('manager-handover-note-save'),
                onPressed: _saving
                    ? null
                    : () => _save(_titles, note: _note.text),
                child: Text(
                  'Save note',
                  style: offText(
                    13,
                    weight: FontWeight.w600,
                    color: OffColors.brand,
                  ),
                ),
              ),
            ),
          const SizedBox(height: 6),
          for (final item in handover.items)
            Padding(
              key: ValueKey('manager-handover-item-${item.id}'),
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  OffRing(done: item.uploaded),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.title,
                          style: offText(
                            14,
                            weight: FontWeight.w600,
                            height: 20,
                          ),
                        ),
                        Text(
                          item.upload == null
                              ? 'Waiting for $_first'
                              : [
                                  item.upload!.label,
                                  if (item.upload!.at case final at?)
                                    'Uploaded ${shortDay(at)}',
                                ].join(' · '),
                          style: offText(12, color: OffColors.secondary),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    key: ValueKey('manager-handover-remove-${item.id}'),
                    tooltip: 'Remove ${item.title}',
                    onPressed: _saving ? null : () => _remove(item),
                    icon: const Icon(
                      Icons.close_rounded,
                      size: 18,
                      color: OffColors.tertiary,
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Semantics(
                  label: 'New checklist item',
                  child: TextField(
                    key: const ValueKey('manager-handover-new'),
                    controller: _newItem,
                    style: offText(13),
                    onSubmitted: (_) => _add(),
                    decoration: InputDecoration(
                      hintText: 'Add an item, e.g. client contacts',
                      hintStyle: offText(13, color: OffColors.tertiary),
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 13,
                      ),
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
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                height: 44,
                child: FilledButton(
                  key: const ValueKey('manager-handover-add'),
                  onPressed: _saving ? null : _add,
                  style: FilledButton.styleFrom(
                    backgroundColor: OffColors.brand,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: Text(
                    'Add',
                    style: offText(
                      13,
                      weight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
