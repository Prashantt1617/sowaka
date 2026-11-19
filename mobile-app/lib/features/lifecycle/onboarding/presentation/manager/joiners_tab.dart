import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart';
import '../../onboarding_launcher.dart';
import '../onboarding_kit.dart';
import 'new_joiners_section.dart';
import 'team_kit.dart';

/// Teams › Joiners (MgrTeamsProto): everyone joining or in probation the
/// viewer is connected to, in one card — photo with the plant, name,
/// designation, stage. Tap one for their page.
class JoinersTab extends StatefulWidget {
  const JoinersTab({super.key, this.shell});

  /// Supplied by tests; the signed-in shell's otherwise.
  final OnboardingShell? shell;

  /// How many joiners the pill counts: set by whichever read them last
  /// (this tab, or My Team's joiners).
  static final count = ValueNotifier<int>(0);

  @override
  State<JoinersTab> createState() => _JoinersTabState();
}

class _JoinersTabState extends State<JoinersTab> {
  List<JoinerSummary>? _joiners;
  bool _offline = false;
  String? _error;

  OnboardingShell? get _shell => widget.shell ?? currentOnboardingShell();

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final shell = _shell;
    if (shell == null) return;
    if (_joiners == null) {
      final kept = await shell.api.fromDevice((api) => api.fetchJoiners());
      if (kept != null && mounted && _joiners == null) _show(kept);
    }
    try {
      final live = await shell.api.fetchJoiners();
      if (!mounted) return;
      _offline = false;
      _error = null;
      _show(live);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        if (_joiners != null) {
          _offline = true;
        } else {
          _error = onboardingErrorText(error);
        }
      });
    }
  }

  void _show(List<JoinerSummary> joiners) {
    setState(() => _joiners = sortJoinersByUrgency(joiners));
    JoinersTab.count.value = joiners.length;
  }

  Future<void> _open(JoinerSummary joiner) async {
    final shell = _shell;
    if (shell == null) return;
    await openJoiner(context, joiner.journeyId, shell: shell, summary: joiner);
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final shell = _shell;
    final joiners = _joiners;
    if (shell == null) return const SizedBox.shrink();
    if (joiners == null) return OnbLoadState(error: _error, onRetry: _load);
    final now = shell.now();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        key: const ValueKey('joiners-tab'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          if (_offline) const Padding(padding: EdgeInsets.only(bottom: 10), child: JoinersOfflineNote()),
          if (joiners.isEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: OnbColors.line)),
              child: const Column(
                children: [
                  Text('No joiners right now', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: TeamColors.ink)),
                  SizedBox(height: 6),
                  Text(
                    'People joining or in probation who report to you show here.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: OnbColors.text3),
                  ),
                ],
              ),
            )
          else
            TeamListCard(
              children: [
                for (final (i, joiner) in joiners.indexed)
                  JoinerListRow(joiner: joiner, now: now, divider: i < joiners.length - 1, onTap: () => _open(joiner)),
              ],
            ),
        ],
      ),
    );
  }
}
