import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../profile/profile_launcher.dart';
import '../../data/new_joiners_api.dart';
import '../../data/onboarding_api.dart';
import '../../onboarding_launcher.dart';
import '../onboarding_kit.dart';
import 'team_kit.dart';

/// Teams › New joiners: everyone joining the viewer's team or department,
/// from the day before they join to the end of their first month — for every
/// teammate, not only the manager, buddy and head of department (who keep
/// Teams › Joiners and its task pages). View only: each card opens the
/// person's profile, and there is nothing to do here. A joiner without an
/// account yet shows "Profile opens on their first day" and opens nothing.
/// `GET /lifecycle/team/new-joiners`.
class NewJoinersTab extends StatefulWidget {
  const NewJoinersTab({super.key, this.shell, this.api, this.openProfile});

  /// Supplied by tests; the signed-in shell's otherwise.
  final OnboardingShell? shell;
  final NewJoinersApi? api;

  /// Opens a profile by userId; [openPersonProfile] otherwise.
  final void Function(String userId)? openProfile;

  /// How many new joiners the viewer has: the pill shows while there are any.
  static final count = ValueNotifier<int>(0);

  /// Whether Teams shows the "New joiners" pill: while the company has the
  /// lifecycle on and the list is not empty ([open] keeps it while on screen).
  static bool showsPill({required bool lifecycleOn, required int joiners, required bool open}) =>
      open || (lifecycleOn && joiners > 0);

  static NewJoinersApi? _apiOf(OnboardingShell? shell, NewJoinersApi? api) =>
      api ?? (shell == null ? null : HttpNewJoinersApi.from(shell.api));

  /// Reads the count for the pill (the Team tab calls it as it opens).
  static Future<void> refreshCount({OnboardingShell? shell, NewJoinersApi? api}) async {
    final source = _apiOf(shell ?? currentOnboardingShell(), api);
    if (source == null) return;
    try {
      count.value = (await source.fetchNewJoiners()).length;
    } catch (_) {}
  }

  @override
  State<NewJoinersTab> createState() => _NewJoinersTabState();
}

class _NewJoinersTabState extends State<NewJoinersTab> {
  List<NewJoinerCard>? _joiners;
  String? _error;

  NewJoinersApi? get _api => NewJoinersTab._apiOf(widget.shell ?? currentOnboardingShell(), widget.api);

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final api = _api;
    if (api == null) return;
    try {
      final rows = await api.fetchNewJoiners();
      if (!mounted) return;
      setState(() {
        _joiners = rows;
        _error = null;
      });
      NewJoinersTab.count.value = rows.length;
    } catch (error) {
      if (mounted && _joiners == null) setState(() => _error = onboardingErrorText(error));
    }
  }

  void _open(String userId) {
    final open = widget.openProfile;
    if (open != null) {
      open(userId);
    } else {
      openPersonProfile(userId);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_api == null) return const SizedBox.shrink();
    final joiners = _joiners;
    if (joiners == null) return OnbLoadState(error: _error, onRetry: _load);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        key: const ValueKey('new-joiners-tab'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          if (joiners.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 24),
              child: Text('No new joiners right now.', textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: OnbColors.text3)),
            )
          else
            TeamListCard(
              children: [
                for (final (i, card) in joiners.indexed)
                  NewJoinerRow(
                    card: card,
                    divider: i < joiners.length - 1,
                    onTap: card.userId == null ? null : () => _open(card.userId!),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

/// One new joiner: photo (initials), name, role, the joining line, and a
/// chevron when the profile opens; else the note that it opens on Day 1.
class NewJoinerRow extends StatelessWidget {
  const NewJoinerRow({super.key, required this.card, this.onTap, this.divider = true});

  final NewJoinerCard card;
  final VoidCallback? onTap;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final role = card.roleLine;
    final note = onTap == null ? (card.profileNote ?? 'Profile opens on their first day') : null;
    return Semantics(
      button: onTap != null,
      label: [card.name, ?role, card.joiningLine, if (onTap != null) 'Open profile' else ?note].join(', '),
      excludeSemantics: true,
      child: Material(
        key: ValueKey('new-joiner-${card.journeyId}'),
        color: Colors.white,
        child: InkWell(
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 76),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(border: divider ? const Border(bottom: BorderSide(color: OnbColors.line)) : null),
            child: Row(
              children: [
                OnbAvatar(name: card.name, photoUrl: card.photoUrl, size: 48),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(card.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: TeamColors.ink)),
                      if (role != null) ...[
                        const SizedBox(height: 3),
                        Text(role, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                      ],
                      const SizedBox(height: 3),
                      Text(card.joiningLine, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.primary)),
                      if (note != null) ...[
                        const SizedBox(height: 3),
                        Text(note, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                      ],
                    ],
                  ),
                ),
                if (onTap != null) ...[
                  const SizedBox(width: 8),
                  const Icon(Icons.chevron_right_rounded, size: 18, color: OnbColors.icon),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
