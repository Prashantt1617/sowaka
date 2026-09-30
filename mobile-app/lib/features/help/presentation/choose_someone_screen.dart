import 'package:flutter/material.dart';

import '../../care/presentation/care_theme.dart';
import '../data/help_api_service.dart';
import 'help_booking_screen.dart';
import 'help_widgets.dart';

/// Choose someone else: a counsellor first, or a time first. Exploring never
/// changes the match; only a booking is made at the end.
class ChooseSomeoneScreen extends StatelessWidget {
  const ChooseSomeoneScreen({super.key, required this.service, this.matchedId});

  final HelpApiService service;

  /// Left out of the lists: they are the match already.
  final String? matchedId;

  @override
  Widget build(BuildContext context) {
    return CarePage(
      backLabel: 'Help',
      children: [
        const CareEyebrow('Choose someone else'),
        const SizedBox(height: 10),
        const CareHeading('What would you\nlike to choose first?', size: 30),
        const SizedBox(height: 12),
        const CareCopy(
          'Find your next conversation in the way that works for you.',
        ),
        const SizedBox(height: 22),
        RouteCard(
          key: const ValueKey('route-counsellor'),
          icon: Icons.person_search_outlined,
          title: 'A counsellor',
          copy: 'Find someone whose approach feels right,\nthen choose a time.',
          action: 'Browse counsellors',
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => HelpBookingScreen(
                service: service,
                mode: HelpBookingMode.counsellorFirst,
                matchedId: matchedId,
              ),
            ),
          ),
        ),
        const SizedBox(height: 14),
        RouteCard(
          key: const ValueKey('route-time'),
          icon: Icons.calendar_month_outlined,
          title: 'A time',
          copy: 'Choose a convenient slot,\nthen see who’s available.',
          action: 'Choose a time',
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => HelpBookingScreen(
                service: service,
                mode: HelpBookingMode.timeFirst,
                matchedId: matchedId,
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        const CareMicro(
          'Your current counsellor and session history stay in place while you explore.',
        ),
      ],
    );
  }
}
