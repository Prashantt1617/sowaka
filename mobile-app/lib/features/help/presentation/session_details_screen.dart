import 'package:flutter/material.dart';

import '../../../services/linkified_text.dart';
import '../../care/presentation/care_theme.dart';
import '../../shared/app_toast.dart';
import '../../talk/data/talk_models.dart';
import '../../talk/presentation/talk_format.dart';
import '../data/help_api_service.dart';
import 'help_booking_screen.dart';
import 'help_widgets.dart';

/// One session: who, when, how long, and a path to the next one with the
/// same counsellor, or the link to join when it is still to come.
class SessionDetailsScreen extends StatelessWidget {
  const SessionDetailsScreen({
    super.key,
    required this.session,
    required this.service,
    required this.backLabel,
  });

  final TalkSession session;
  final HelpApiService service;
  final String backLabel;

  Future<void> _join(BuildContext context) async {
    final url = session.joinUrl;
    if (url == null || url.isEmpty) return;
    final opened = await openExternalLink(url);
    if (!opened && context.mounted)
      showAppToast(context, 'Could not open the link');
  }

  @override
  Widget build(BuildContext context) {
    final upcoming =
        session.status == TalkSessionStatus.booked &&
        session.endsAt.isAfter(DateTime.now());
    final status = switch (session.status) {
      TalkSessionStatus.cancelled => 'Cancelled',
      TalkSessionStatus.completed => 'Completed',
      TalkSessionStatus.booked => upcoming ? 'Coming up' : 'Completed',
    };
    final counsellor = Counsellor(
      userId: session.counsellorId,
      name: session.counsellorName,
      headline: session.counsellorHeadline,
      slotMinutes: session.endsAt.difference(session.startsAt).inMinutes,
      photoUrl: session.counsellorPhotoUrl,
    );
    return CarePage(
      backLabel: backLabel,
      children: [
        CareEyebrow('Your session · ${session.counsellorName}'),
        const SizedBox(height: 10),
        CareHeading(
          upcoming ? 'Your next session' : 'A session you had',
          size: 28,
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: upcoming ? CareColors.sage : CareColors.blueTint,
            borderRadius: BorderRadius.circular(100),
          ),
          child: Text(
            status,
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.blue,
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(height: 14),
        SummaryLine('Counsellor', session.counsellorName),
        SummaryLine('Date', talkDate(session.startsAt)),
        SummaryLine(
          'Time',
          '${talkRange(session.startsAt, session.endsAt)} · your time',
        ),
        SummaryLine('Session', '${counsellor.slotMinutes} min · Video call'),
        const SizedBox(height: 22),
        if (upcoming && session.joinUrl != null) ...[
          CarePrimaryButton(
            'Join session',
            icon: Icons.videocam_rounded,
            onTap: () => _join(context),
          ),
          if (session.placeholderLink) ...[
            const SizedBox(height: 8),
            const CareMicro(
              'This is a test link from a server without Zoom set up.',
              align: TextAlign.center,
            ),
          ],
        ] else if (!upcoming && session.status != TalkSessionStatus.cancelled)
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: CareColors.sage,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CareSectionTitle('Continue the conversation.'),
                const SizedBox(height: 6),
                CareCopy(
                  'Choose a time for your next session with ${counsellor.firstName}.',
                ),
                const SizedBox(height: 14),
                CarePrimaryButton(
                  'Book with ${counsellor.firstName}',
                  icon: Icons.arrow_forward_rounded,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => HelpBookingScreen(
                        service: service,
                        counsellor: counsellor,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
