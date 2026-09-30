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
/// attendance and leave: the counsellor, why they were matched, the sessions,
/// and one button to change the answers.
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
  HelpHome? _home;
  bool _loading = true;

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

  Future<void> _push(Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
    if (mounted) await _load();
  }

  Future<void> _editAnswers() async {
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
          CareCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CareEyebrow('Your counsellor'),
                const SizedBox(height: 12),
                const CareSectionTitle('Match with a counsellor'),
                const SizedBox(height: 8),
                const CareCopy(
                  'Four quick questions about what you’d like to talk about, '
                  'and we’ll suggest someone who fits.',
                  size: 13.5,
                ),
                const SizedBox(height: 16),
                CarePrimaryButton(
                  'Match with a counsellor',
                  icon: Icons.arrow_forward_rounded,
                  onTap: _editAnswers,
                ),
              ],
            ),
          )
        else if (match == null)
          CareCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CareEyebrow('Your counsellor'),
                const SizedBox(height: 12),
                const CareSectionTitle('Nobody is available yet.'),
                const SizedBox(height: 8),
                const CareCopy(
                  'One will be suggested here as soon as there is.',
                  size: 13.5,
                ),
              ],
            ),
          )
        else ...[
          CareCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CareEyebrow('Your counsellor'),
                const SizedBox(height: 16),
                CounsellorPerson(counsellor: match.counsellor),
                const SizedBox(height: 14),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Flexible(
                      child: CareLink(
                        'View profile & sessions',
                        size: 13,
                        onTap: () => _push(
                          CounsellorProfileScreen(
                            service: _service,
                            counsellorId: match.counsellor.userId,
                            backLabel: 'Profile',
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Flexible(
                      child: CareLink(
                        'Choose someone else',
                        icon: Icons.arrow_outward_rounded,
                        size: 13,
                        onTap: () => _push(
                          ChooseSomeoneScreen(
                            service: _service,
                            matchedId: match.counsellor.userId,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (match.reasons.isNotEmpty) ...[
            const SizedBox(height: 12),
            CareCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CareEyebrow('Why ${match.counsellor.firstName}'),
                  const SizedBox(height: 12),
                  ReasonList(match.reasons),
                  if (match.unmet.isNotEmpty) UnmetNote(match.unmet),
                ],
              ),
            ),
          ],
        ],
        if (sessions.isNotEmpty) ...[
          const SizedBox(height: 20),
          const CareSectionTitle('Your sessions', size: 17),
          const SizedBox(height: 10),
          for (final session in sessions)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: session.status == TalkSessionStatus.booked
                  ? SessionRow(
                      session: session,
                      title: 'Coming up',
                      onTap: () => _push(
                        SessionDetailsScreen(
                          session: session,
                          service: _service,
                          backLabel: 'Profile',
                        ),
                      ),
                    )
                  : SessionHistoryRow(
                      session: session,
                      onOpen: () => _push(
                        SessionDetailsScreen(
                          session: session,
                          service: _service,
                          backLabel: 'Profile',
                        ),
                      ),
                    ),
            ),
        ],
        if (match != null) ...[
          const SizedBox(height: 10),
          CarePrimaryButton(
            'Edit my answers',
            icon: Icons.arrow_forward_rounded,
            onTap: _editAnswers,
          ),
        ],
      ],
    );
  }
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
