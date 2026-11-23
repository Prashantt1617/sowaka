import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../../services/api_config.dart' show avatarImageProvider;
import '../../../../profile/profile_launcher.dart';
import '../../data/new_joiners_api.dart';
import '../../data/onboarding_api.dart';
import '../../onboarding_launcher.dart';
import '../onboarding_kit.dart';

/// Teams › New joiners, the one joiners list in the app: the people who have
/// joined the viewer's own team (same manager), shown to their manager, buddy
/// and teammates from the day they are marked joined to the end of their first
/// month (HR assigns the onboarding tasks on the dashboard, so there
/// is no task page here). View only: each card opens the person's profile. A
/// joiner without an account yet shows "Profile opens on their first day" and
/// opens nothing. Cards as the Team tab draws its people (My Team).
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
      color: OnbColors.primary,
      onRefresh: _load,
      child: ListView(
        key: const ValueKey('new-joiners-tab'),
        physics: const AlwaysScrollableScrollPhysics(),
        // The Team tab's own list (My Team): 16 at the sides, 20 on top.
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 32),
        children: [
          if (joiners.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 40),
              child: Center(
                child: Text(
                  'No new joiners right now.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: _NewJoinerLook.faint, fontSize: 13.5, fontWeight: FontWeight.w600),
                ),
              ),
            )
          else
            for (final (i, card) in joiners.indexed) ...[
              if (i > 0) const SizedBox(height: 16),
              NewJoinerRow(card: card, onTap: card.userId == null ? null : () => _open(card.userId!)),
            ],
        ],
      ),
    );
  }
}

/// The Team tab's people card, as My Team draws it (node 2488:89724): white,
/// 16 radius, a hairline and a soft shadow, a 56 photo, the name in Sora 17
/// and the designation under it.
abstract final class _NewJoinerLook {
  static const ink = Color(0xFF222222);
  static const soft = Color(0xFF717171);
  static const faint = Color(0xFF9197A2);
  static const line = Color(0xFFEBEBEB);
  static const joiningBg = Color(0xFFE6EEFF);
  static const joiningFg = Color(0xFF0571A6);
  static const noteBg = Color(0xFFF1F1F4);

  /// The app's initials colours (manager_shared.dart avatarColors).
  static const avatars = [
    Color(0xFFBE5A36),
    Color(0xFF4F8C89),
    Color(0xFF8A6AA0),
    Color(0xFFC98A2E),
    Color(0xFF7E8B6E),
    Color(0xFFC0392B),
    Color(0xFF3563C4),
  ];
}

/// One new joiner: photo (initial), name, role, and the joining day; a
/// joiner without an account yet says when their profile opens instead of
/// opening one.
class NewJoinerRow extends StatelessWidget {
  const NewJoinerRow({super.key, required this.card, this.onTap});

  final NewJoinerCard card;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final role = card.roleLine;
    final note = onTap == null ? (card.profileNote ?? 'Profile opens on their first day') : null;
    final body = Container(
      padding: const EdgeInsets.all(17.114),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _NewJoinerLook.line, width: 1.114),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: .1), blurRadius: 1.5, offset: const Offset(0, 1)),
          BoxShadow(color: Colors.black.withValues(alpha: .1), blurRadius: 1, offset: const Offset(0, 1)),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _NewJoinerPhoto(name: card.name, photoUrl: card.photoUrl, seed: card.journeyId),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  card.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontFamily: 'Sora', color: _NewJoinerLook.ink, fontWeight: FontWeight.w700, fontSize: 17, height: 25.5 / 17),
                ),
                if (role != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    role,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontFamily: 'Sora', color: _NewJoinerLook.soft, fontSize: 14, height: 20 / 14),
                  ),
                ],
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _NewJoinerPill(card.joiningLine, background: _NewJoinerLook.joiningBg, foreground: _NewJoinerLook.joiningFg),
                      if (note != null) _NewJoinerPill(note, background: _NewJoinerLook.noteBg, foreground: _NewJoinerLook.soft),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
    return Semantics(
      button: onTap != null,
      label: [card.name, ?role, card.joiningLine, if (onTap != null) 'Open profile' else ?note].join(', '),
      excludeSemantics: true,
      child: KeyedSubtree(
        key: ValueKey('new-joiner-${card.journeyId}'),
        child: onTap == null
            ? body
            : Material(
                color: Colors.transparent,
                child: InkWell(borderRadius: BorderRadius.circular(16), onTap: onTap, child: body),
              ),
      ),
    );
  }
}

/// The 56 photo, or the first letter on one of the app's initials colours
/// (the same joiner, the same colour).
class _NewJoinerPhoto extends StatelessWidget {
  const _NewJoinerPhoto({required this.name, required this.seed, this.photoUrl});

  final String name;
  final String seed;
  final String? photoUrl;

  static const size = 56.0;

  @override
  Widget build(BuildContext context) {
    final trimmed = name.trim();
    final letter = trimmed.isEmpty || trimmed == '—' ? '?' : trimmed[0].toUpperCase();
    final colour = _NewJoinerLook.avatars[seed.codeUnits.fold<int>(0, (a, c) => a + c) % _NewJoinerLook.avatars.length];
    final initial = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: colour, shape: BoxShape.circle),
      alignment: Alignment.center,
      child: Text(letter, style: const TextStyle(color: Colors.white, fontSize: size * .42, fontWeight: FontWeight.w800)),
    );
    final url = photoUrl;
    if (url == null || url.isEmpty) return initial;
    return ClipOval(
      child: SizedBox(
        width: size,
        height: size,
        child: Image(
          image: avatarImageProvider(url),
          width: size,
          height: size,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => initial,
          frameBuilder: (_, child, frame, wasSyncLoaded) => frame == null && !wasSyncLoaded ? initial : child,
        ),
      ),
    );
  }
}

/// A small rounded label under the name, as the Team tab's day pills ("Late",
/// "WFH") are drawn: "Joins tomorrow", "Profile opens on their first day".
class _NewJoinerPill extends StatelessWidget {
  const _NewJoinerPill(this.label, {required this.background, required this.foreground});

  final String label;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(6)),
    child: Text(
      label,
      style: TextStyle(fontFamily: 'Sora', color: foreground, fontSize: 12, height: 16.2 / 12, letterSpacing: -0.16),
    ),
  );
}
