import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart';
import '../../data/team_joiners_api.dart';
import '../../onboarding_launcher.dart';
import '../onboarding_kit.dart';
import 'new_joiners_section.dart';
import 'team_kit.dart';
import 'team_side_screens.dart';

/// Teams › Joiners (MgrTeamsProto): everyone joining or in probation the
/// viewer is connected to, in one card — photo with the plant, name,
/// designation, stage. Tap one for their page.
class JoinersTab extends StatefulWidget {
  const JoinersTab({super.key, this.shell, this.teamApi});

  /// Supplied by tests; the signed-in shell's otherwise.
  final OnboardingShell? shell;

  /// `/lifecycle/team/joiners` (direct reports, buddies and a head of
  /// department's line); from the shell's session when not given. Without
  /// one (an offline test shell) the manager's own `/manager/joiners`.
  final TeamJoinersApi? teamApi;

  /// How many joiners the pill counts: set by whichever read them last
  /// (this tab, or My Team's joiners).
  static final count = ValueNotifier<int>(0);

  @override
  State<JoinersTab> createState() => _JoinersTabState();
}

/// A row on the list: the joiner as the rows draw them, and how the viewer
/// is connected to them.
typedef _Row = ({JoinerSummary joiner, TeamRelation relation, String? relationLine});

class _JoinersTabState extends State<JoinersTab> {
  List<_Row>? _joiners;
  bool _offline = false;
  String? _error;

  OnboardingShell? get _shell => widget.shell ?? currentOnboardingShell();

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  TeamJoinersApi? get _team {
    final shell = _shell;
    return widget.teamApi ?? (shell == null ? null : HttpTeamJoinersApi.from(shell.api));
  }

  static _Row _report(JoinerSummary j) => (joiner: j, relation: TeamRelation.report, relationLine: null);

  static _Row _fromTeam(TeamJoinerRow r) => (
    joiner: JoinerSummary(
      journeyId: r.journeyId,
      name: r.name,
      designation: r.designation,
      photoUrl: r.photoUrl,
      dayLabel: r.stepLabel.isEmpty ? null : r.stepLabel,
      plant: r.plant,
      preboarding: r.preboarding,
      todayCount: r.toDo,
    ),
    relation: r.relation,
    relationLine: r.relationLine,
  );

  Future<List<_Row>> _fetch(OnboardingShell shell) async {
    final team = _team;
    if (team != null) return [for (final r in await team.fetchJoiners()) _fromTeam(r)];
    return [for (final j in await shell.api.fetchJoiners()) _report(j)];
  }

  Future<void> _load() async {
    final shell = _shell;
    if (shell == null) return;
    if (_joiners == null && _team == null) {
      final kept = await shell.api.fromDevice((api) => api.fetchJoiners());
      if (kept != null && mounted && _joiners == null) _show([for (final j in kept) _report(j)]);
    }
    try {
      final live = await _fetch(shell);
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

  void _show(List<_Row> rows) {
    final order = sortJoinersByUrgency([for (final r in rows) r.joiner]);
    final byId = {for (final r in rows) r.joiner.journeyId: r};
    setState(() => _joiners = [for (final j in order) byId[j.journeyId]!]);
    JoinersTab.count.value = rows.length;
  }

  /// Your report: their page as their manager. A buddy's or a head of
  /// department's joiner: the team side's page for them.
  Future<void> _open(_Row row) async {
    final shell = _shell;
    final team = _team;
    if (shell == null) return;
    if (row.relation == TeamRelation.report || team == null) {
      await openJoiner(context, row.joiner.journeyId, shell: shell, summary: row.joiner);
    } else {
      await Navigator.of(context).push<void>(
        MaterialPageRoute(
          builder: (_) => TeamJoinerScreen(api: team, journeyId: row.joiner.journeyId, reachOutWays: _reachOutWays),
        ),
      );
    }
    if (mounted) await _load();
  }

  /// A buddy's or a head of department's ways to reach out: a game, a post on Connect.
  List<TeamReachOutWay> _reachOutWays(BuildContext context, TeamJoinerPage page) {
    void composer() {
      final open = TeamReachOutDoors.openComposer;
      if (open != null) open(context);
    }

    return [
      TeamReachOutWay(
        key: 'game',
        title: 'Send a game',
        meta: 'A quick one to break the ice',
        icon: Icons.sports_esports_outlined,
        tint: TeamTaskKind.team.tint,
        fg: TeamTaskKind.team.fg,
        onTap: () {
          final open = TeamReachOutDoors.openGames;
          if (open != null) open(context);
        },
      ),
      TeamReachOutWay(
        key: 'announce',
        title: 'Make an announcement',
        meta: 'Share the news with everyone',
        icon: Icons.campaign_outlined,
        tint: TeamColors.warnBg,
        fg: TeamColors.warnFg,
        onTap: composer,
      ),
      TeamReachOutWay(
        key: 'introduce',
        title: 'Introduce to the team',
        meta: 'A post for your team',
        icon: TeamTaskKind.team.icon,
        tint: TeamColors.okBg,
        fg: TeamColors.okFg,
        onTap: composer,
      ),
    ];
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
                    'People joining or in probation you’re connected to show here.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: OnbColors.text3),
                  ),
                ],
              ),
            )
          else
            TeamListCard(
              children: [
                for (final (i, row) in joiners.indexed)
                  JoinerListRow(
                    joiner: row.joiner,
                    now: now,
                    relation: row.relationLine,
                    relationIsYou: row.relation == TeamRelation.buddy,
                    divider: i < joiners.length - 1,
                    onTap: () => _open(row),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}
