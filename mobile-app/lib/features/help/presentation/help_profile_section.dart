import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

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

  /// The answers behind the match, shown as the preferences they set. Null
  /// until read, or when they could not be.
  HelpIntake? _intake;

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
    // The preferences are read alongside, and never hold up the counsellor.
    unawaited(_loadIntake());
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

  Future<void> _loadIntake() async {
    try {
      final intake = await _service.intake();
      if (mounted) setState(() => _intake = intake);
    } catch (_) {
      // Without them the row still opens the questions.
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
          _CounsellorCard(
            counsellor: match.counsellor,
            onProfile: () => _push(
              CounsellorProfileScreen(
                service: _service,
                counsellorId: match.counsellor.userId,
                backLabel: 'Profile',
              ),
            ),
            onChange: () => _push(
              ChooseSomeoneScreen(
                service: _service,
                matchedId: match.counsellor.userId,
              ),
            ),
          ),
        const _SectionLabel('My wellbeing'),
        const SizedBox(height: 8),
        _LinkRow(
          emoji: '📋',
          label: 'Session history',
          onTap: () => _push(
            SessionHistoryScreen(service: _service, sessions: sessions),
          ),
        ),
        // The answers behind the match, each with its own way back into the
        // questions, rather than shouted about with a button of their own.
        if (match != null) ...[
          const _SectionLabel('My preferences'),
          if (_intake case final intake?) ...[
            const SizedBox(height: 8),
            _PreferenceRow(
              label: 'Preferred language',
              value: intake.languages.isEmpty
                  ? 'No preference'
                  : intake.languages.join(' or '),
              onEdit: _editAnswers,
            ),
            const SizedBox(height: 8),
            _PreferenceRow(
              label: 'My concern',
              value: intake.topics
                  .map((id) => helpTopicById(id)?.label)
                  .whereType<String>()
                  .join(', ')
                  .ifEmpty('Not answered yet'),
              onEdit: _editAnswers,
            ),
          ] else ...[
            const SizedBox(height: 8),
            _LinkRow(
              emoji: '🎯',
              label: 'Answer the questions again',
              onTap: _editAnswers,
            ),
          ],
        ],
      ],
    );
  }
}

extension on String {
  String ifEmpty(String fallback) => isEmpty ? fallback : this;
}

/// The profile's own surface for its cards (node 3106:50649): white, a
/// hairline, a soft lift.
BoxDecoration _cardDecoration() => BoxDecoration(
  color: Colors.white,
  borderRadius: BorderRadius.circular(16),
  border: Border.all(color: _Profile.line, width: 1.129),
  boxShadow: const [
    BoxShadow(color: Color(0x1A000000), blurRadius: 3, offset: Offset(0, 1)),
    BoxShadow(
      color: Color(0x1A000000),
      blurRadius: 2,
      spreadRadius: -1,
      offset: Offset(0, 1),
    ),
  ],
);

TextStyle _sora(
  double size, {
  FontWeight weight = FontWeight.w400,
  Color color = _Profile.ink,
  double? height,
  double spacing = 0,
}) => TextStyle(
  fontFamily: 'Sora',
  fontSize: size,
  fontWeight: weight,
  color: color,
  height: height == null ? null : height / size,
  letterSpacing: spacing,
);

/// The counsellor on one's profile (node 3106:50649): their photo, name and
/// years, then their page and the way to someone else.
class _CounsellorCard extends StatelessWidget {
  const _CounsellorCard({
    required this.counsellor,
    required this.onProfile,
    required this.onChange,
  });

  final Counsellor counsellor;
  final VoidCallback onProfile;
  final VoidCallback onChange;

  @override
  Widget build(BuildContext context) {
    final years = counsellor.yearsExperience;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: _cardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              CounsellorFace(counsellor: counsellor, size: 44, round: true),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      counsellor.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: _sora(15, weight: FontWeight.w600, height: 22.5),
                    ),
                    Text(
                      years == null ? 'Counsellor' : '$years yrs experience',
                      style: _sora(12, color: _Profile.muted, height: 18),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: _OutlineAction('View profile', onTap: onProfile)),
              const SizedBox(width: 8),
              Expanded(
                child: _OutlineAction('Change', onTap: onChange, quiet: true),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// One answer behind the match, and the way to change it (node 3165:58667).
class _PreferenceRow extends StatelessWidget {
  const _PreferenceRow({
    required this.label,
    required this.value,
    required this.onEdit,
  });

  final String label;
  final String value;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: _cardDecoration(),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: _sora(13, color: _Profile.muted, height: 19.5),
                ),
                Text(
                  value,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: _sora(15, weight: FontWeight.w600, height: 22.5),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: onEdit,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'Edit',
                style: _sora(
                  13,
                  weight: FontWeight.w600,
                  color: CareColors.blue,
                  height: 19.5,
                ),
              ),
            ),
          ),
        ],
      ),
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
  const _OutlineAction(this.label, {required this.onTap, this.quiet = false});

  final String label;
  final VoidCallback onTap;

  /// No outline and grey words: the second of two actions.
  final bool quiet;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: quiet ? Colors.transparent : Colors.white,
      borderRadius: BorderRadius.circular(100),
      child: InkWell(
        borderRadius: BorderRadius.circular(100),
        onTap: onTap,
        child: Container(
          height: 42,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(100),
            border: quiet
                ? null
                : Border.all(color: CareColors.blue, width: 1.129),
          ),
          child: Text(
            label,
            style: _sora(
              14,
              weight: FontWeight.w600,
              color: quiet ? _Profile.muted : CareColors.blue,
              height: 20,
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
    decoration: _cardDecoration(),
    child: child,
  );
}

/// A small uppercase label over a group, as the profile sets them.
class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 16),
    child: Text(
      text.toUpperCase(),
      style: _sora(
        12,
        weight: FontWeight.w700,
        color: _Profile.muted,
        height: 18,
        spacing: 0.3,
      ),
    ),
  );
}

/// One tappable line in a card (node 3106:50666): an emoji, a label, a
/// chevron.
class _LinkRow extends StatelessWidget {
  const _LinkRow({
    required this.emoji,
    required this.label,
    required this.onTap,
  });

  final String emoji;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: _cardDecoration(),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: 16 + 1.129,
              vertical: 14 + 1.129,
            ),
            child: Row(
              children: [
                Text(emoji, style: const TextStyle(fontSize: 16, height: 1.5)),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    label,
                    style: _sora(14, weight: FontWeight.w600, height: 21),
                  ),
                ),
                SvgPicture.asset(
                  'assets/icons/profile_row_chevron.svg',
                  width: 16,
                  height: 16,
                ),
              ],
            ),
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

  static const ink = Color(0xFF111827);
  static const muted = Color(0xFF6B7280);
  static const line = Color(0xFFF0F0F0);
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
