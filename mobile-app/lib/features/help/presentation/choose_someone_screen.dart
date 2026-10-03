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
        const CareHeading('How would you\nlike to choose?', size: 30),
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
      ],
    );
  }
}
