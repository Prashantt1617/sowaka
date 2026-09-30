import 'package:flutter/material.dart';

import '../../care/presentation/care_theme.dart';
import '../../talk/data/talk_api_service.dart';
import '../../talk/data/talk_models.dart';
import '../../talk/presentation/talk_format.dart';
import '../data/help_api_service.dart';
import '../data/help_models.dart';
import 'help_booking_screen.dart';
import 'help_widgets.dart';
import 'session_details_screen.dart';

/// What tapping the book button does: open the slots from here; hand this
/// counsellor back to a counsellor-first booking, which then shows their
/// slots; or hand them back to a time-first booking that has its slot.
enum ProfileAction { book, bookBack, chooseForTime }

/// A counsellor: About & match, and the person's sessions with them.
class CounsellorProfileScreen extends StatefulWidget {
  const CounsellorProfileScreen({
    super.key,
    required this.service,
    required this.counsellorId,
    required this.backLabel,
    this.action = ProfileAction.book,
    this.fixedSlot,
    this.openOnSessions = false,
  });

  final HelpApiService service;
  final String counsellorId;
  final String backLabel;
  final ProfileAction action;

  /// The slot already chosen, on the time-first route.
  final TalkSlot? fixedSlot;
  final bool openOnSessions;

  @override
  State<CounsellorProfileScreen> createState() =>
      _CounsellorProfileScreenState();
}

class _CounsellorProfileScreenState extends State<CounsellorProfileScreen> {
  CounsellorDetail? _detail;
  String? _error;
  late bool _sessionsTab = widget.openOnSessions;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final detail = await widget.service.counsellor(widget.counsellorId);
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(
        () => _error = error is TalkApiException
            ? error.message
            : 'Could not load this profile.',
      );
    }
  }

  Future<void> _book(Counsellor c) async {
    if (widget.action != ProfileAction.book) {
      Navigator.of(context).pop(c);
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) =>
            HelpBookingScreen(service: widget.service, counsellor: c),
      ),
    );
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    final slot = widget.fixedSlot;
    return CarePage(
      backLabel: widget.backLabel,
      children: [
        if (_error case final message?)
          CareNotice(message, onRetry: _load)
        else if (detail == null)
          const CareSpinner()
        else ...[
          CareEyebrow(
            detail.matched ? 'Your counsellor' : 'Get to know your counsellor',
          ),
          const SizedBox(height: 14),
          CounsellorPerson(counsellor: detail.counsellor, large: true),
          const SizedBox(height: 18),
          if (slot != null)
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: CareColors.sage,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.schedule_rounded,
                    size: 18,
                    color: CareColors.blue,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Free ${talkDate(slot.startsAt)} at ${talkTime(slot.startsAt)}',
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: CareColors.ink,
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            )
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _Tab(
                  'About & match',
                  selected: !_sessionsTab,
                  onTap: () => setState(() => _sessionsTab = false),
                ),
                _Tab(
                  'Your sessions (${detail.upcoming.length + detail.past.length})',
                  selected: _sessionsTab,
                  onTap: () => setState(() => _sessionsTab = true),
                ),
              ],
            ),
          const SizedBox(height: 20),
          if (_sessionsTab && slot == null)
            _sessions(detail)
          else
            _about(detail),
          const SizedBox(height: 26),
          CarePrimaryButton(
            widget.action == ProfileAction.chooseForTime
                ? 'Choose ${detail.counsellor.firstName} for this time'
                : 'Book with ${detail.counsellor.firstName}',
            icon: Icons.arrow_forward_rounded,
            onTap: () => _book(detail.counsellor),
          ),
          if (!detail.matched) ...[
            const SizedBox(height: 10),
            const CareMicro(
              'Your current counsellor and session history stay in place while you explore.',
              align: TextAlign.center,
            ),
          ],
        ],
      ],
    );
  }

  Widget _about(CounsellorDetail detail) {
    final c = detail.counsellor;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (detail.reasons.isNotEmpty) ...[
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: CareColors.blueTint,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CareSectionTitle(
                  detail.matched
                      ? 'Why you’re matched'
                      : 'How ${c.firstName} fits what you shared',
                  size: 15,
                ),
                const SizedBox(height: 10),
                ReasonList(detail.reasons),
                if (detail.unmet.isNotEmpty) UnmetNote(detail.unmet),
              ],
            ),
          ),
          const SizedBox(height: 20),
        ],
        CareSectionTitle('About ${c.firstName}', size: 16),
        const SizedBox(height: 8),
        CareCopy(
          c.about.isEmpty ? c.headline : c.about,
          size: 13.5,
          color: CareColors.ink,
        ),
        if (c.focusLabels.isNotEmpty) ...[
          const SizedBox(height: 14),
          FocusChips(c.focusLabels),
        ],
        const SizedBox(height: 12),
        if (c.yearsExperience != null)
          SummaryLine(
            'Experience',
            '${c.yearsExperience} years of counselling',
          ),
        if (c.languages.isNotEmpty)
          SummaryLine('Languages', c.languages.join(' · ')),
        if (c.ageRange.isNotEmpty || c.gender.isNotEmpty)
          SummaryLine(
            'At a glance',
            [
              if (c.gender.isNotEmpty) helpGenderLabel(c.gender),
              if (c.ageRange.isNotEmpty) helpAgeLabel(c.ageRange),
            ].join(' · '),
          ),
        SummaryLine('Sessions', '${c.slotMinutes} min · Video call'),
      ],
    );
  }

  Widget _sessions(CounsellorDetail detail) {
    final all = [...detail.upcoming, ...detail.past];
    if (all.isEmpty) {
      return CareCopy('No sessions with ${detail.counsellor.firstName} yet.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CareSectionTitle(
          'Your sessions with ${detail.counsellor.firstName}',
          size: 16,
        ),
        const SizedBox(height: 4),
        CareCopy('${detail.past.length} completed', size: 12.5),
        const SizedBox(height: 12),
        for (var i = 0; i < all.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: SessionRow(
              session: all[i],
              title: all[i].status == TalkSessionStatus.booked
                  ? 'Coming up'
                  : 'Session ${all.length - i}',
              onTap: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => SessionDetailsScreen(
                      session: all[i],
                      service: widget.service,
                      backLabel: 'Sessions',
                    ),
                  ),
                );
                if (mounted) _load();
              },
            ),
          ),
      ],
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab(this.label, {required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) =>
      CareChoiceChip(label, selected: selected, onTap: onTap);
}
