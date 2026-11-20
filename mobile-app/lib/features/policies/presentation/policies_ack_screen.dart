import 'dart:async';

import 'package:flutter/material.dart';

import '../../lifecycle/onboarding/presentation/onboarding_kit.dart';
import '../../shared/app_toast.dart';
import '../../support/presentation/support_ui.dart' show SupportBackButton;
import '../data/policies_api_service.dart';
import '../data/policies_models.dart';

/// Where the policies come from and where an acknowledgement goes: the
/// server's ([PoliciesApiService]) in the app, a fake in tests.
abstract class PoliciesSource {
  Future<List<PolicyDocument>> load();
  Future<List<PolicyDocument>?> cached();
  Future<List<PolicyDocument>> acknowledge(String key, int version);
}

class HttpPoliciesSource implements PoliciesSource {
  HttpPoliciesSource(this.api);
  final PoliciesApiService api;

  @override
  Future<List<PolicyDocument>> load() => api.policies();

  @override
  Future<List<PolicyDocument>?> cached() => api.policiesFromCache();

  @override
  Future<List<PolicyDocument>> acknowledge(String key, int version) => api.acknowledge(key, version);
}

/// The new-joiner artifact's Policies (Policies · from the task / from
/// Actions / one has been updated): the list with Acknowledge, Acknowledged
/// (with the date), Updated or Read on each, and a policy's page with "I've
/// read this policy" and Acknowledge. A policy HR has changed since comes
/// back as Updated, with what changed on top, and is acknowledged again.
///
/// The same screen opens from onboarding's "Acknowledge policies" task (with
/// [shell], inside the onboarding pages) and from Actions (without).
class PoliciesAckScreen extends StatefulWidget {
  const PoliciesAckScreen({super.key, required this.source, this.shell, this.openKey});

  final PoliciesSource source;

  /// The onboarding pages' header and tabs; null draws the plain page.
  final OnboardingShell? shell;

  /// Opens straight on this policy.
  final String? openKey;

  @override
  State<PoliciesAckScreen> createState() => _PoliciesAckScreenState();
}

class _PoliciesAckScreenState extends State<PoliciesAckScreen> {
  List<PolicyDocument>? _policies;
  String? _error;
  String? _openKey;
  bool _agreed = false;
  bool _busy = false;

  /// Acknowledged in this visit: "Acknowledged today".
  final Set<String> _ackedNow = {};

  @override
  void initState() {
    super.initState();
    _openKey = widget.openKey;
    unawaited(_first());
  }

  Future<void> _first() async {
    final kept = await widget.source.cached().catchError((_) => null);
    if (kept != null && mounted && _policies == null) setState(() => _policies = kept);
    await _load();
  }

  Future<void> _load() async {
    try {
      final list = await widget.source.load();
      if (mounted) setState(() { _policies = list; _error = null; });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  PolicyDocument? get _open {
    final key = _openKey;
    if (key == null) return null;
    for (final p in _policies ?? const <PolicyDocument>[]) {
      if (p.key == key) return p;
    }
    return null;
  }

  void _back() {
    if (_openKey != null && widget.openKey == null) {
      setState(() { _openKey = null; _agreed = false; });
    } else {
      Navigator.of(context).maybePop();
    }
  }

  Future<void> _acknowledge(PolicyDocument policy) async {
    if (!_agreed || _busy) return;
    setState(() => _busy = true);
    try {
      final list = await widget.source.acknowledge(policy.key, policy.version);
      if (!mounted) return;
      setState(() { _policies = list; _ackedNow.add(policy.key); _busy = false; });
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      showAppToast(context, '$error');
      // A 409 is a newer text: the reload shows it as Updated.
      unawaited(_load());
    }
  }

  @override
  Widget build(BuildContext context) {
    final open = _open;
    final title = open == null ? 'Policies' : 'Policy';
    final body = _policies == null
        ? (_error == null
              ? const Center(child: CircularProgressIndicator())
              : _Retry(message: _error!, onRetry: _load))
        : open == null
        ? _list(_policies!)
        : _read(open);
    final footer = open == null || !open.ackRequired ? null : _footer(open);
    final shell = widget.shell;
    if (shell != null) {
      return OnbScaffold(shell: shell, title: title, onBack: _back, body: body, footer: footer);
    }
    return PopScope(
      canPop: _openKey == null || widget.openKey != null,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        backgroundColor: OnbColors.screen,
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                color: Colors.white,
                child: Row(
                  children: [
                    SupportBackButton(onTap: _back),
                    const SizedBox(width: 10),
                    Expanded(child: Semantics(header: true, child: Text(title, style: OnbText.screenTitle))),
                  ],
                ),
              ),
              Expanded(child: body),
              ?footer,
            ],
          ),
        ),
      ),
    );
  }

  Widget _list(List<PolicyDocument> policies) {
    final pending = policiesToAcknowledge(policies);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          if (pending > 0) ...[
            Container(
              key: const ValueKey('policies-pending'),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(color: OnbColors.amberTint, borderRadius: BorderRadius.circular(20)),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                    child: const Icon(Icons.task_outlined, size: 20, color: OnbColors.amber),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('$pending to acknowledge', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text)),
                        const SizedBox(height: 2),
                        const Text('Read each one and acknowledge it', style: TextStyle(fontSize: 12, color: OnbColors.text2)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],
          if (policies.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Text('Your company has not added its policies yet.', style: OnbText.body),
            )
          else
            Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: OnbColors.line),
              ),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  for (final (i, p) in policies.indexed)
                    _PolicyRow(
                      policy: p,
                      ackedToday: _ackedNow.contains(p.key),
                      last: i == policies.length - 1,
                      onTap: () => setState(() { _openKey = p.key; _agreed = false; }),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _read(PolicyDocument p) {
    final updated = p.isUpdatedSinceAck || (p.version > 1 && p.changeNote.isNotEmpty && !p.isAcknowledged);
    final changedOn = p.textUpdatedAt ?? p.updatedAt;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      children: [
        if (updated && p.changeNote.isNotEmpty) ...[
          Container(
            key: const ValueKey('policy-what-changed'),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(color: OnbColors.skyTint, borderRadius: BorderRadius.circular(16)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  changedOn == null ? 'UPDATED' : 'UPDATED · ${policyDateLabel(changedOn)}',
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.9, color: OnbColors.primary),
                ),
                const SizedBox(height: 6),
                const Text('What changed', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: OnbColors.text)),
                const SizedBox(height: 6),
                Text(p.changeNote, style: const TextStyle(fontSize: 13, height: 1.45, color: OnbColors.text2)),
              ],
            ),
          ),
          const SizedBox(height: 12),
        ],
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: OnbColors.line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Semantics(
                header: true,
                child: Text(
                  policyHeading(p.title),
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.2, color: OnbColors.text),
                ),
              ),
              const SizedBox(height: 2),
              Text(p.versionLine, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
              for (final block in parsePolicyBody(p.body)) ...[
                const SizedBox(height: 12),
                switch (block) {
                  PolicyHeading(:final text) => Semantics(
                    header: true,
                    child: Text(text, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: OnbColors.text)),
                  ),
                  PolicyCard(:final lines) => Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (final line in lines)
                        Text(
                          line.bullet ? '•  ${line.text}' : line.text,
                          style: const TextStyle(fontSize: 13, height: 1.55, color: OnbColors.text2),
                        ),
                    ],
                  ),
                },
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _footer(PolicyDocument p) {
    final acked = p.isAcknowledged;
    final updated = p.isUpdatedSinceAck;
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: OnbColors.line)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: acked
              ? Container(
                  key: const ValueKey('policy-acked'),
                  constraints: const BoxConstraints(minHeight: 52),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: OnbColors.successTint, borderRadius: BorderRadius.circular(14)),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.check_rounded, size: 18, color: OnbColors.successText),
                      const SizedBox(width: 8),
                      Text(
                        _ackedNow.contains(p.key) || p.acknowledgedAt == null
                            ? 'Acknowledged today'
                            : 'Acknowledged ${policyDateLabel(p.acknowledgedAt!)}',
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: OnbColors.successText),
                      ),
                    ],
                  ),
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Semantics(
                      checked: _agreed,
                      child: InkWell(
                        key: const ValueKey('policy-agree'),
                        onTap: () => setState(() => _agreed = !_agreed),
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(minHeight: 44),
                          child: Row(
                            children: [
                              AnimatedContainer(
                                duration: const Duration(milliseconds: 120),
                                width: 24,
                                height: 24,
                                decoration: BoxDecoration(
                                  color: _agreed ? OnbColors.primary : Colors.white,
                                  borderRadius: BorderRadius.circular(7),
                                  border: _agreed ? null : Border.all(color: OnbColors.lineDark, width: 2),
                                ),
                                child: _agreed ? const Icon(Icons.check_rounded, size: 16, color: Colors.white) : null,
                              ),
                              const SizedBox(width: 12),
                              Text(
                                updated ? 'I’ve read what changed' : 'I’ve read this policy',
                                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      height: 52,
                      child: FilledButton(
                        key: const ValueKey('policy-ack'),
                        onPressed: _agreed && !_busy ? () => _acknowledge(p) : null,
                        style: FilledButton.styleFrom(
                          backgroundColor: OnbColors.primary,
                          disabledBackgroundColor: OnbColors.line,
                          disabledForegroundColor: OnbColors.icon,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          textStyle: OnbText.button(context),
                        ),
                        child: _busy
                            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : Text(updated ? 'Acknowledge the update' : 'Acknowledge'),
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}

class _PolicyRow extends StatelessWidget {
  const _PolicyRow({required this.policy, required this.ackedToday, required this.last, required this.onTap});

  final PolicyDocument policy;
  final bool ackedToday;
  final bool last;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = policy;
    final (label, bg, fg) = p.isAcknowledged
        ? ('Acknowledged', OnbColors.successTint, OnbColors.successText)
        : p.isUpdatedSinceAck
        ? ('Updated', OnbColors.tint, OnbColors.primary)
        : p.ackRequired
        ? ('Acknowledge', OnbColors.amberTint, OnbColors.amber)
        : ('Read', OnbColors.screen, OnbColors.text2);
    final meta = p.isAcknowledged
        ? 'Acknowledged ${ackedToday || p.acknowledgedAt == null ? 'today' : policyDateLabel(p.acknowledgedAt!)}'
        : p.versionLine;
    return Semantics(
      button: true,
      label: '${policyHeading(p.title)}. $meta. $label',
      child: InkWell(
        key: ValueKey('policy-${p.key}'),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 68),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            border: last ? null : const Border(bottom: BorderSide(color: OnbColors.line)),
          ),
          child: ExcludeSemantics(
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(color: OnbColors.screen, borderRadius: BorderRadius.circular(12)),
                  child: const Icon(Icons.description_outlined, size: 20, color: OnbColors.text2),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(policyHeading(p.title), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text)),
                      const SizedBox(height: 2),
                      Text(meta, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  height: 26,
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
                  child: Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: fg)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Retry extends StatelessWidget {
  const _Retry({required this.message, required this.onRetry});
  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message, textAlign: TextAlign.center, style: OnbText.body),
          const SizedBox(height: 12),
          OnbLink(label: 'Try again', onTap: onRetry),
        ],
      ),
    ),
  );
}
