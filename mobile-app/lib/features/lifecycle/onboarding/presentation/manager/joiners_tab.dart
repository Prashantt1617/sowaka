import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart' show PlantState;
import '../../data/team_joiners_api.dart';
import '../../onboarding_launcher.dart';
import '../onboarding_kit.dart';
import 'team_joiner_screens.dart';
import 'team_kit.dart';

/// Teams › Joiners (Onboarding · Final designs, MgrProtoJoiners / BuddyProto /
/// HodProto): everyone joining or in probation the viewer is connected to —
/// direct reports, the people they are a buddy for, and for a head of
/// department the reporting line — each with their face and plant, name,
/// designation, "You’re the buddy" / "Reports to …" and their stage. Tap one
/// for their page. `GET /lifecycle/team/joiners`.
class JoinersTab extends StatefulWidget {
  const JoinersTab({super.key, this.shell, this.teamApi});

  /// Supplied by tests; the signed-in shell's otherwise.
  final OnboardingShell? shell;
  final TeamJoinersApi? teamApi;

  /// The Joiners pill's count: how many joiners the viewer is connected to.
  static final count = ValueNotifier<int>(0);

  /// Whether Teams shows the "Joiners" pill: only for someone with joiners there (a manager, buddy or
  /// someone up the line). HR and IT & admin with none work from Actions › Onboarding instead.
  /// [open] keeps it while its section is on screen.
  static bool showsPill({required bool lifecycleOn, required int joiners, required bool open}) => open || (lifecycleOn && joiners > 0);

  /// Reads the count for the pill (the Team tab calls it as it opens).
  static Future<void> refreshCount({OnboardingShell? shell, TeamJoinersApi? api}) async {
    final s = shell ?? currentOnboardingShell();
    final team = api ?? (s == null ? null : HttpTeamJoinersApi.from(s.api));
    if (team == null) return;
    try {
      count.value = (await team.fetchJoiners()).length;
    } catch (_) {}
  }

  @override
  State<JoinersTab> createState() => _JoinersTabState();
}

class _JoinersTabState extends State<JoinersTab> {
  List<TeamJoinerRow>? _joiners;
  String? _error;

  OnboardingShell? get _shell => widget.shell ?? currentOnboardingShell();

  TeamJoinersApi? get _team {
    final shell = _shell;
    return widget.teamApi ?? (shell == null ? null : HttpTeamJoinersApi.from(shell.api));
  }

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final team = _team;
    if (team == null) return;
    try {
      final rows = await team.fetchJoiners();
      if (!mounted) return;
      setState(() {
        _joiners = rows;
        _error = null;
      });
      JoinersTab.count.value = rows.length;
    } catch (error) {
      if (mounted && _joiners == null) setState(() => _error = onboardingErrorText(error));
    }
  }

  Future<void> _open(TeamJoinerRow row) async {
    final shell = _shell;
    final team = _team;
    if (shell == null || team == null) return;
    await openTeamJoiner(context, shell: shell, api: team, journeyId: row.journeyId);
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final joiners = _joiners;
    if (_shell == null || _team == null) return const SizedBox.shrink();
    if (joiners == null) return OnbLoadState(error: _error, onRetry: _load);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        key: const ValueKey('joiners-tab'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          if (joiners.isNotEmpty)
            TeamListCard(
              children: [
                for (final (i, row) in joiners.indexed)
                  TeamJoinerListRow(row: row, divider: i < joiners.length - 1, onTap: () => _open(row)),
              ],
            ),
        ],
      ),
    );
  }
}

/// One joiner in the list: photo (initials) with the plant, name,
/// designation, the relation line, the stage pill and a chevron.
class TeamJoinerListRow extends StatelessWidget {
  const TeamJoinerListRow({super.key, required this.row, required this.onTap, this.divider = true});

  final TeamJoinerRow row;
  final VoidCallback onTap;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final pre = row.preboarding;
    final buddy = row.relation == TeamRelation.buddy;
    return Semantics(
      button: true,
      label: 'Open ${row.name}',
      excludeSemantics: true,
      child: Material(
        key: ValueKey('joiner-row-${row.journeyId}'),
        color: Colors.white,
        child: InkWell(
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 76),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(border: divider ? const Border(bottom: BorderSide(color: OnbColors.line)) : null),
            child: Row(
              children: [
                TeamAvatarWithPlant(name: row.name, photoUrl: row.photoUrl, plant: PlantState(stage: row.plantStage)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(row.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: TeamColors.ink)),
                      if (row.designation != null) ...[
                        const SizedBox(height: 3),
                        Text(row.designation!, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                      ],
                      if (row.relationLine != null) ...[
                        const SizedBox(height: 3),
                        Text(
                          row.relationLine!,
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: buddy ? TeamColors.reachOut : OnbColors.text3),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                TeamPill(row.stepLabel, background: pre ? OnbColors.screen : TeamColors.blueBg, foreground: pre ? OnbColors.text2 : OnbColors.primary, height: 26),
                const SizedBox(width: 4),
                const Icon(Icons.chevron_right_rounded, size: 18, color: OnbColors.icon),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
