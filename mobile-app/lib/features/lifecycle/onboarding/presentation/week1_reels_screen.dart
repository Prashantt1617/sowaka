import 'dart:async';

import 'package:flutter/material.dart';

import '../../../profile/profile_launcher.dart';
import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import 'links.dart';
import 'onboarding_kit.dart';
import 'plant.dart';

/// A4 · the week-1 reels (6Zs §5.3): policies, tax regime, bank & PF,
/// probation goals — one input per reel, saved on every Next, picking up at
/// the first one not yet saved. Ends 4/4 with a new leaf.
class Week1ReelsScreen extends StatefulWidget {
  const Week1ReelsScreen({super.key, required this.shell});

  final OnboardingShell shell;

  @override
  State<Week1ReelsScreen> createState() => _Week1ReelsScreenState();
}

class _Week1ReelsScreenState extends State<Week1ReelsScreen> {
  Week1Data? _data;
  String? _error;

  /// 0–3 the reels, 4 the done moment.
  int _step = 0;
  bool _busy = false;
  bool _agreed = false;
  bool _allPolicies = false;
  String _regime = 'new';

  OnboardingShell get _shell => widget.shell;

  static const _durations = ['20 min', '2 min', '1 min', '3 min'];

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final data = await _shell.api.fetchWeek1();
      if (!mounted) return;
      setState(() {
        _data = data;
        _error = null;
        _step = data.resumeAt?.index ?? Week1Step.values.length;
        _regime = data.taxRegime ?? 'new';
        _agreed = data.policiesAckAt != null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    }
  }

  Future<void> _save(Week1Step step, Object value, {String? toast}) async {
    setState(() => _busy = true);
    try {
      var data = await _shell.api.saveWeek1(step, value);
      data ??= await _shell.api.fetchWeek1();
      if (!mounted) return;
      if (toast != null) showAppToast(context, toast);
      // On to the next reel not yet saved after this one, or the end.
      var next = step.index + 1;
      while (next < Week1Step.values.length && data.isDone(Week1Step.values[next])) {
        next++;
      }
      setState(() {
        _data = data;
        _step = next;
      });
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    if (data == null) {
      return OnbScaffold(shell: _shell, title: 'Week-1 tasks', showNav: false, body: OnbLoadState(error: _error, onRetry: _load));
    }
    if (_step >= Week1Step.values.length) return _done(data);
    final step = Week1Step.values[_step];
    final (body, button) = switch (step) {
      Week1Step.policies => (_policies(data), _policiesButton(data)),
      Week1Step.tax => (_tax(), OnbPrimaryButton(label: 'Confirm choice', busy: _busy, onTap: () => _save(step, _regime))),
      Week1Step.bankPf => (
        _bank(data),
        OnbPrimaryButton(label: 'All correct', busy: _busy, onTap: () => _save(step, {'confirmed': true})),
      ),
      Week1Step.goals => (
        _goals(data),
        OnbPrimaryButton(label: 'Got it', busy: _busy, onTap: () => _save(step, {'read': true})),
      ),
    };
    return OnbScaffold(
      shell: _shell,
      title: 'Week-1 tasks',
      showNav: false,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: OnbStoryBar(count: Week1Step.values.length, current: _step),
          ),
          Expanded(
            child: ListView(
              key: ValueKey('reel-${step.key}'),
              padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
              children: [
                Text('TASK ${_step + 1} OF 4 · ${_durations[_step].toUpperCase()}', style: OnbText.eyebrow),
                const SizedBox(height: 8),
                OnbRise(child: body),
              ],
            ),
          ),
        ],
      ),
      footer: OnbFooter(children: [button]),
    );
  }

  // ── 1 · Policies ──────────────────────────────────────────────────────────

  Widget _policies(Week1Data data) {
    final shown = _allPolicies ? data.policies : data.policies.take(3).toList();
    final more = data.policies.length - shown.length;
    final read = data.policiesAckAt != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Read the company policies', style: OnbText.display),
        const SizedBox(height: 14),
        if (data.policies.isEmpty)
          const Text('HR hasn’t added policies yet. You can still agree to the company’s policies.', style: OnbText.body),
        for (final policy in shown)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OnbCard(
              radius: 16,
              padding: const EdgeInsets.all(12),
              onTap: policy.url != null
                  ? () => openExternalLink(context, policy.url!)
                  : policy.body != null
                  ? () => showPolicySheet(context, policy)
                  : null,
              child: Row(
                children: [
                  const OnbIconTile('📄', size: 36),
                  const SizedBox(width: 12),
                  Expanded(child: Text(policy.title, style: OnbText.bodyStrong)),
                  if (read)
                    const OnbTag('Read', tone: OnbTone.done, icon: Icons.check_rounded)
                  else
                    Text(policyMeta(policy), style: OnbText.label),
                ],
              ),
            ),
          ),
        if (more > 0)
          OnbLink(label: '+ $more more ${more == 1 ? 'policy' : 'policies'}', onTap: () => setState(() => _allPolicies = true)),
        const SizedBox(height: 10),
        CheckboxListTile(
          key: const ValueKey('policies-agree'),
          value: _agreed,
          onChanged: (value) => setState(() => _agreed = value ?? false),
          controlAffinity: ListTileControlAffinity.leading,
          contentPadding: EdgeInsets.zero,
          activeColor: OnbColors.primary,
          title: const Text('I have read and agree to the company policies', style: OnbText.bodyStrong),
        ),
      ],
    );
  }

  Widget _policiesButton(Week1Data data) => OnbPrimaryButton(
    label: 'Agree and continue',
    busy: _busy,
    onTap: _agreed
        ? () => _save(Week1Step.policies, {
            'versions': [for (final p in data.policies) {'id': p.id, 'version': p.version}],
            'device': 'app',
          })
        : null,
  );

  // ── 2 · Tax regime ────────────────────────────────────────────────────────

  Widget _tax() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text('Choose your tax regime', style: OnbText.display),
      const SizedBox(height: 6),
      const Text(
        'This decides how much tax is taken from your salary. You can change it once a year.',
        style: OnbText.body,
      ),
      const SizedBox(height: 16),
      OnbChoiceCard(
        key: const ValueKey('regime-new'),
        title: 'New regime',
        badge: 'DEFAULT',
        subtitle: 'Lower tax rates, fewer deductions. Simpler for most people.',
        selected: _regime == 'new',
        onTap: () => setState(() => _regime = 'new'),
      ),
      const SizedBox(height: 10),
      OnbChoiceCard(
        key: const ValueKey('regime-old'),
        title: 'Old regime',
        subtitle: 'Higher rates, but you can claim rent (HRA), 80C savings and more.',
        selected: _regime == 'old',
        onTap: () => setState(() => _regime = 'old'),
      ),
    ],
  );

  // ── 3 · Bank and PF ───────────────────────────────────────────────────────

  Widget _bank(Week1Data data) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text('Check your bank and PF details', style: OnbText.display),
      const SizedBox(height: 6),
      const Text('We filled these in from your pre-boarding. Your salary goes here.', style: OnbText.body),
      const SizedBox(height: 16),
      OnbCard(
        child: Column(
          children: [
            _KeyValue('Bank', data.bankName ?? '—'),
            _KeyValue('Account', data.bankMasked ?? '—'),
            _KeyValue('IFSC', data.ifsc ?? '—'),
            _KeyValue('PF number (UAN)', data.uan ?? '—', last: true),
          ],
        ),
      ),
      const SizedBox(height: 6),
      if (data.bankChangeRequested)
        const Text('Your change is with HR. Payroll uses these details until they approve it.', style: OnbText.label)
      else
        OnbLink(key: const ValueKey('bank-edit'), label: 'Edit', icon: Icons.edit_outlined, onTap: () => _editBank(data)),
      const Text('A change goes to HR for approval. Payroll uses the details above until then.', style: OnbText.label),
    ],
  );

  Future<void> _editBank(Week1Data data) async {
    final change = await showOnbSheet<Map<String, String>>(context, builder: (_) => _BankEditSheet(data: data));
    if (change == null || !mounted) return;
    await _save(
      Week1Step.bankPf,
      {'change': change},
      toast: 'Sent to HR for approval',
    );
  }

  // ── 4 · Probation goals ───────────────────────────────────────────────────

  Widget _goals(Week1Data data) {
    final manager = data.managerName ?? 'Your manager';
    final months = data.probationMonths;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('What your probation looks like', style: OnbText.display),
        const SizedBox(height: 6),
        Text(
          [if (months != null) '$months months.', '$manager set these goals for you.'].join(' '),
          style: OnbText.body,
        ),
        const SizedBox(height: 16),
        if (data.goals.isEmpty)
          OnbCard(child: Text('$manager hasn’t set your goals yet. They’ll show here.', style: OnbText.body))
        else
          for (final (index, goal) in data.goals.indexed)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: OnbCard(
                radius: 16,
                padding: const EdgeInsets.all(12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(color: OnbColors.tint, shape: BoxShape.circle),
                      child: Text('${index + 1}', style: OnbText.bodyStrong.copyWith(color: OnbColors.primary)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(child: Text(goal, style: OnbText.bodyStrong)),
                  ],
                ),
              ),
            ),
        const SizedBox(height: 8),
        Text(
          [
            if (data.goalsLockOn != null) 'These lock on ${onbDay(data.goalsLockOn!)}.',
            'Questions? Ask ${data.managerName ?? 'your manager'} before then.',
          ].join(' '),
          style: OnbText.label,
        ),
        if (data.managerUserId != null && canOpenPersonProfile) ...[
          const SizedBox(height: 8),
          OnbLink(
            key: const ValueKey('ask-manager'),
            label: 'Ask ${data.managerName?.split(' ').first ?? 'your manager'} a question',
            onTap: () => openPersonProfile(data.managerUserId!),
          ),
        ],
      ],
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────

  Widget _done(Week1Data data) => OnbScaffold(
    shell: _shell,
    title: 'Week-1 tasks',
    showNav: false,
    body: ListView(
      key: const ValueKey('week1-done'),
      padding: const EdgeInsets.fromLTRB(20, 40, 20, 24),
      children: [
        const Center(child: Plant(stage: 1, size: 130, leaves: 1)),
        const SizedBox(height: 12),
        Text('4/4', style: OnbText.displayXl(48), textAlign: TextAlign.center),
        const SizedBox(height: 6),
        const Text('Week-1 tasks done', style: OnbText.display, textAlign: TextAlign.center),
        const SizedBox(height: 8),
        Text(
          'Your plant grew a new leaf. HR and ${data.managerName ?? 'your manager'} can see you’re all set.',
          style: OnbText.body,
          textAlign: TextAlign.center,
        ),
      ],
    ),
    footer: OnbFooter(children: [OnbPrimaryButton(label: 'Back to onboarding', onTap: () => Navigator.of(context).pop())]),
  );
}

class _KeyValue extends StatelessWidget {
  const _KeyValue(this.label, this.value, {this.last = false});

  final String label;
  final String value;
  final bool last;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(vertical: 10),
    decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: OnbColors.line))),
    child: Row(
      children: [
        Expanded(child: Text(label, style: OnbText.label)),
        Text(value, style: OnbText.bodyStrong),
      ],
    ),
  );
}

/// The new bank and PF details, for HR to approve.
class _BankEditSheet extends StatefulWidget {
  const _BankEditSheet({required this.data});

  final Week1Data data;

  @override
  State<_BankEditSheet> createState() => _BankEditSheetState();
}

class _BankEditSheetState extends State<_BankEditSheet> {
  final _bank = TextEditingController();
  final _account = TextEditingController();
  late final _ifsc = TextEditingController(text: widget.data.ifsc ?? '');
  late final _uan = TextEditingController(text: widget.data.uan ?? '');

  @override
  void dispose() {
    _bank.dispose();
    _account.dispose();
    _ifsc.dispose();
    _uan.dispose();
    super.dispose();
  }

  bool get _ready => _account.text.trim().isNotEmpty || _uan.text.trim() != (widget.data.uan ?? '') || _bank.text.trim().isNotEmpty;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Change bank or PF details', style: OnbText.h1),
        const SizedBox(height: 4),
        const Text('HR checks the change. Your salary goes to the current account until they approve it.', style: OnbText.label),
        const SizedBox(height: 16),
        OnbTextArea(controller: _bank, label: 'Bank name', minLines: 1, onChanged: (_) => setState(() {})),
        const SizedBox(height: 10),
        OnbTextArea(
          fieldKey: const ValueKey('bank-account'),
          controller: _account,
          label: 'Account number',
          minLines: 1,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 10),
        OnbTextArea(controller: _ifsc, label: 'IFSC', minLines: 1),
        const SizedBox(height: 10),
        OnbTextArea(controller: _uan, label: 'PF number (UAN)', minLines: 1, onChanged: (_) => setState(() {})),
        const SizedBox(height: 18),
        OnbPrimaryButton(
          label: 'Send to HR',
          onTap: _ready
              ? () => Navigator.of(context).pop({
                  if (_bank.text.trim().isNotEmpty) 'bankName': _bank.text.trim(),
                  if (_account.text.trim().isNotEmpty) 'accountNumber': _account.text.trim(),
                  if (_ifsc.text.trim().isNotEmpty) 'ifsc': _ifsc.text.trim().toUpperCase(),
                  if (_uan.text.trim().isNotEmpty) 'uan': _uan.text.trim(),
                })
              : null,
        ),
      ],
    ),
  );
}

/// A policy row's meta: how long it takes to read, else when it last
/// changed; never the raw version stamp.
String policyMeta(PolicyItem policy) {
  if (policy.readMinutes != null) return '${policy.readMinutes} min read';
  if (policy.updatedOn != null) return 'Updated ${onbDay(policy.updatedOn!)}';
  return 'Read';
}

/// A policy's text, read in the app.
Future<void> showPolicySheet(BuildContext context, PolicyItem policy) => showOnbSheet<void>(
  context,
  builder: (context) => SingleChildScrollView(
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(policy.title, style: OnbText.h1),
        if (policy.updatedOn != null || policy.readMinutes != null) ...[
          const SizedBox(height: 4),
          Text(
            [
              if (policy.readMinutes != null) '${policy.readMinutes} min read',
              if (policy.updatedOn != null) 'Updated ${onbDay(policy.updatedOn!)}',
            ].join(' · '),
            style: OnbText.label,
          ),
        ],
        const SizedBox(height: 14),
        Text(policy.body ?? policy.summary ?? '', style: OnbText.body),
      ],
    ),
  ),
);
