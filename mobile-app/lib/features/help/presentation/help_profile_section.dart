import 'package:flutter/material.dart';

import '../../auth/data/auth_models.dart';
import '../../care/presentation/care_theme.dart';
import '../../talk/data/talk_models.dart';
import '../data/help_api_service.dart';
import '../data/help_models.dart';
import 'choose_someone_screen.dart';
import 'counsellor_profile_screen.dart';
import 'help_onboarding.dart';
import 'help_widgets.dart';
import 'session_details_screen.dart';

/// The Help part of the profile, for a company whose app is Help rather than
/// attendance and leave: the counsellor, the sessions behind one row, and the
/// answers that chose them.
///
/// It fetches Help home itself so the profile screen keeps knowing only about
/// the manager dashboard.
class HelpProfileSection extends StatefulWidget {
  const HelpProfileSection({super.key, required this.session, this.service});

  final AuthSession session;

  /// Supplied only by tests; the app builds its own.
  final HelpApiService? service;

  @override
  State<HelpProfileSection> createState() => _HelpProfileSectionState();
}

class _HelpProfileSectionState extends State<HelpProfileSection> {
  late final HelpApiService _service =
      widget.service ?? HelpApiService(session: widget.session);
  // What was fetched last for this person, so opening the profile draws
  // immediately. The fresh answer replaces it a moment later.
  late HelpHome? _home = helpHomeFor(widget.session.user.id);
  late bool _loading = _home == null;

  @override
  void initState() {
    super.initState();
    _load();
    helpMatchChanged.addListener(_reload);
  }

  @override
  void dispose() {
    helpMatchChanged.removeListener(_reload);
    super.dispose();
  }

  /// The counsellor changed somewhere else in the app.
  void _reload() {
    if (mounted) _load();
  }

  Future<void> _load() async {
    try {
      final home = await _service.home();
      if (!mounted) return;
      setState(() {
        _home = home;
        _loading = false;
      });
    } catch (_) {
      // The rest of the profile is worth showing without this.
      if (mounted) setState(() => _loading = false);
    }
  }

  /// A page is opening, or open: a second tap does nothing.
  bool _opening = false;

  Future<void> _push(Widget screen) async {
    if (_opening) return;
    _opening = true;
    try {
      await Navigator.of(
        context,
      ).push(MaterialPageRoute(builder: (_) => screen));
    } finally {
      _opening = false;
    }
    if (mounted) await _load();
  }

  Future<void> _editAnswers() async {
    if (_opening) return;
    HelpIntake? intake;
    try {
      intake = await _service.intake();
    } catch (_) {
      // An unanswered intake opens the questions from the top.
    }
    if (!mounted) return;
    await _push(
      _AnswersScreen(service: _service, initial: intake ?? HelpIntake.empty),
    );
  }

  @override
  Widget build(BuildContext context) {
    final home = _home;
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 28),
        child: CareSpinner(),
      );
    }
    if (home == null) return const SizedBox.shrink();
    final match = home.match ?? home.noMatch;
    final sessions = [?home.upcoming, ...home.history];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Matching happens once. Afterwards the counsellor is changed by
        // choosing someone else or by editing the answers, never by being
        // asked the four questions again.
        if (match == null && !home.intakeDone)
          _PlainCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Match with a counsellor',
                  style: TextStyle(
                    fontFamily: careFont,
                    color: CareColors.ink,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Four quick questions about what you’d like to talk about, '
                  'and we’ll suggest someone who fits.',
                  style: TextStyle(
                    fontFamily: careFont,
                    color: _Profile.muted,
                    fontSize: 13,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 16),
                _OutlineAction('Answer the questions', onTap: _editAnswers),
              ],
            ),
          )
        else if (match == null)
          _PlainCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                Text(
                  'Nobody is available yet',
                  style: TextStyle(
                    fontFamily: careFont,
                    color: CareColors.ink,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                SizedBox(height: 6),
                Text(
                  'One will be suggested here as soon as there is.',
                  style: TextStyle(
                    fontFamily: careFont,
                    color: _Profile.muted,
                    fontSize: 13,
                    height: 1.45,
                  ),
                ),
              ],
            ),
          )
        else
          YourCounsellorCard(
            counsellor: match.counsellor,
            onProfile: () => _push(
              CounsellorProfileScreen(
                service: _service,
                counsellorId: match.counsellor.userId,
                backLabel: 'Profile',
              ),
            ),
            onChoose: () => _push(
              ChooseSomeoneScreen(
                service: _service,
                matchedId: match.counsellor.userId,
              ),
            ),
          ),
        const _SectionLabel('My wellbeing'),
        _LinkRow(
          icon: Icons.history_rounded,
          label: 'Session history',
          onTap: () => _push(
            SessionHistoryScreen(service: _service, sessions: sessions),
          ),
        ),
        // The answers behind the match, opened the same way as the sessions
        // rather than shouted about with a button of their own.
        if (match != null) ...[
          const SizedBox(height: 10),
          _LinkRow(
            icon: Icons.tune_rounded,
            label: 'My preferences',
            onTap: _editAnswers,
          ),
        ],
      ],
    );
  }
}

/// Every session this person has had or has coming, behind the one row on
/// the profile. A tap opens the session itself.
class SessionHistoryScreen extends StatelessWidget {
  const SessionHistoryScreen({
    super.key,
    required this.service,
    required this.sessions,
  });

  final HelpApiService service;
  final List<TalkSession> sessions;

  @override
  Widget build(BuildContext context) {
    final done = sessions
        .where((s) => s.status != TalkSessionStatus.booked)
        .length;
    final coming = sessions.length - done;
    return CarePage(
      backLabel: 'My Profile',
      children: [
        const CareEyebrow('My wellbeing'),
        const SizedBox(height: 10),
        const CareHeading('Session history', size: 26),
        const SizedBox(height: 6),
        CareCopy(
          sessions.isEmpty
              ? 'Your sessions will be listed here.'
              : '${coming == 0 ? 'None' : coming} coming up · $done completed',
          size: 14,
        ),
        const SizedBox(height: 16),
        for (final session in sessions)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: SessionRow(
              session: session,
              title: session.counsellorName,
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => SessionDetailsScreen(
                    session: session,
                    service: service,
                    backLabel: 'Session history',
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// The counsellor, drawn as the profile design has it: the photo, the name,
/// the years, then the way to their page and the way to somebody else.
/// The outlined blue pill the design uses for the quieter of two actions.
class _OutlineAction extends StatelessWidget {
  const _OutlineAction(this.label, {required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(100),
      child: InkWell(
        borderRadius: BorderRadius.circular(100),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(100),
            border: Border.all(color: CareColors.blue, width: 1.5),
          ),
          child: Text(
            label,
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.blue,
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}

/// A white card with a hairline, the profile's own surface.
class _PlainCard extends StatelessWidget {
  const _PlainCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: _Profile.line),
    ),
    child: child,
  );
}

/// A small uppercase label over a group, as the profile sets them.
class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(2, 22, 2, 8),
    child: Text(
      text.toUpperCase(),
      style: const TextStyle(
        fontFamily: careFont,
        color: _Profile.muted,
        fontSize: 11,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.9,
      ),
    ),
  );
}

/// One tappable line in a card: an icon, a label, a chevron.
class _LinkRow extends StatelessWidget {
  const _LinkRow({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: _Profile.line),
          ),
          child: Row(
            children: [
              Icon(icon, size: 19, color: CareColors.ink),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(
                    fontFamily: careFont,
                    color: CareColors.ink,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const Icon(
                Icons.chevron_right_rounded,
                size: 20,
                color: Color(0xFF9CA3AF),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The greys the profile screen uses, so this section sits in it rather than
/// beside it.
class _Profile {
  const _Profile._();

  static const muted = Color(0xFF6B7280);
  static const line = Color(0xFFECECEC);
}

/// The four questions on their own page, opened from the profile.
class _AnswersScreen extends StatelessWidget {
  const _AnswersScreen({required this.service, required this.initial});

  final HelpApiService service;
  final HelpIntake initial;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: CareColors.bg,
      body: SafeArea(
        bottom: false,
        child: HelpOnboarding(
          service: service,
          initial: initial,
          startOnReview: !initial.isBlank,
          onCancel: () => Navigator.of(context).pop(),
          onDone: () => Navigator.of(context).pop(),
        ),
      ),
    );
  }
}
