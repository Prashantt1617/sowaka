import 'dart:async';

import 'package:flutter/material.dart';

import '../../../services/linkified_text.dart';
import '../../care/presentation/care_theme.dart';
import '../../shared/app_toast.dart';
import '../../talk/data/talk_models.dart';
import '../../talk/presentation/talk_format.dart';
import '../data/help_api_service.dart';
import 'before_check_in_screen.dart';
import 'counsellor_profile_screen.dart';
import 'help_booking_screen.dart';
import 'help_widgets.dart';

/// One session: the counsellor with the date and time on one card, and the
/// way in when it is time. Before the time the page counts down; from ten
/// minutes before until the end the link shows, and joining asks "how are
/// you feeling?" first. A past session offers the next one with the same
/// counsellor. Chat and Add to calendar are on the page for later.
class SessionDetailsScreen extends StatefulWidget {
  const SessionDetailsScreen({
    super.key,
    required this.session,
    required this.service,
    required this.backLabel,
  });

  final TalkSession session;
  final HelpApiService service;
  final String backLabel;

  @override
  State<SessionDetailsScreen> createState() => _SessionDetailsScreenState();
}

class _SessionDetailsScreenState extends State<SessionDetailsScreen> {
  late TalkSession _session = widget.session;
  Timer? _tick;

  /// How early the link shows.
  static const _joinWindow = Duration(minutes: 10);

  @override
  void initState() {
    super.initState();
    // The countdown and the join window move on their own.
    _tick = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  bool get _upcoming =>
      _session.status == TalkSessionStatus.booked &&
      _session.endsAt.isAfter(DateTime.now());

  /// From ten minutes before the start until the end.
  bool get _canJoin =>
      _upcoming &&
      _session.joinUrl != null &&
      _session.joinUrl!.isNotEmpty &&
      DateTime.now().isAfter(_session.startsAt.subtract(_joinWindow));

  Future<void> _join() async {
    final url = _session.joinUrl;
    if (url == null || url.isEmpty) return;
    // A word on how they are before they go in, once per session.
    if (_session.checkIn == null) {
      final checkIn = await Navigator.of(context).push<SessionCheckIn?>(
        MaterialPageRoute(
          builder: (_) =>
              BeforeCheckInScreen(session: _session, service: widget.service),
          fullscreenDialog: true,
        ),
      );
      if (!mounted) return;
      if (checkIn == null) return;
      if (checkIn.feeling.isNotEmpty) {
        setState(() => _session = _session.withCheckIn(checkIn));
      }
    }
    final opened = await openExternalLink(url);
    if (!opened && mounted) showAppToast(context, 'Could not open the link');
  }

  @override
  Widget build(BuildContext context) {
    final session = _session;
    final upcoming = _upcoming;
    final counsellor = session.counsellor;
    return CarePage(
      backLabel: widget.backLabel,
      children: [
        // The counsellor's own card says whose session this is and when; a
        // title above it only said it again.
        const SizedBox(height: 4),
        // The counsellor's card as the list shows it, with the when and how
        // long on it; the card opens their profile.
        CounsellorListCard(
          counsellor: counsellor,
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => CounsellorProfileScreen(
                service: widget.service,
                counsellorId: counsellor.userId,
                backLabel: 'Session',
              ),
            ),
          ),
          trailing: [
            const SizedBox(height: 12),
            const Divider(color: CareColors.line, height: 1),
            const SizedBox(height: 4),
            SummaryLine('Date', talkDate(session.startsAt)),
            SummaryLine(
              'Time',
              '${talkRange(session.startsAt, session.endsAt)} · your time',
            ),
            SummaryLine(
              'Session',
              '${counsellor.slotMinutes} min · Video call',
            ),
            // How they felt going in, and what they made of it coming out.
            // Only once the session has happened; before that there is
            // nothing to show and the countdown says so.
            if (!upcoming &&
                (session.checkIn != null || session.review != null)) ...[
              const SizedBox(height: 14),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: BeforeAfterBox(
                      label: 'Before',
                      value: session.checkIn == null
                          ? ''
                          : '${feelingOf(session.checkIn!.feeling).face} '
                                '${feelingOf(session.checkIn!.feeling).label}',
                      note: session.checkIn?.note ?? '',
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: BeforeAfterBox(
                      label: 'After',
                      value: session.review == null
                          ? ''
                          : '${'★' * session.review!.rating}'
                                '${'☆' * (5 - session.review!.rating)}',
                      note: session.review?.note ?? '',
                      gold: true,
                    ),
                  ),
                ],
              ),
            ] else if (session.checkIn case final checkIn?)
              SummaryLine(
                'Before',
                '${feelingOf(checkIn.feeling).face} ${feelingOf(checkIn.feeling).label}'
                    '${checkIn.note.isEmpty ? '' : ' · ${checkIn.note}'}',
              ),
          ],
        ),
        const SizedBox(height: 18),
        if (upcoming) ...[
          if (_canJoin)
            CarePrimaryButton(
              'Join session',
              icon: Icons.videocam_rounded,
              onTap: _join,
            )
          else
            // Counting down: the link appears ten minutes before the start.
            Container(
              key: const ValueKey('session-countdown'),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: CareColors.blueTint,
                borderRadius: BorderRadius.circular(18),
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
                      _countdown(session.startsAt),
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
            ),
        ] else if (session.status != TalkSessionStatus.cancelled)
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
                        service: widget.service,
                        counsellor: counsellor,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 14),
        // Two more ways to keep the session close, not wired up yet.
        Row(
          children: [
            Expanded(
              child: _QuietButton(
                'Chat',
                icon: Icons.chat_bubble_outline_rounded,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _QuietButton(
                'Add to calendar',
                icon: Icons.calendar_month_outlined,
              ),
            ),
          ],
        ),
      ],
    );
  }

  /// "Starts in 2 days", "Starts in 1h 20m", "Starts in 12m".
  static String _countdown(DateTime startsAt) {
    final left = startsAt.difference(DateTime.now());
    if (left.isNegative) return 'Starting now';
    if (left.inDays >= 1) {
      return 'Starts in ${left.inDays} day${left.inDays == 1 ? '' : 's'} · the link appears 10 minutes before';
    }
    final h = left.inHours;
    final m = left.inMinutes % 60;
    final when = h > 0 ? '${h}h ${m}m' : '${m}m';
    return 'Starts in $when · the link appears 10 minutes before';
  }
}

/// A disabled outline button: on the page, not yet doing anything.
class _QuietButton extends StatelessWidget {
  const _QuietButton(this.label, {required this.icon});

  final String label;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 13),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(100),
        border: Border.all(color: CareColors.line),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 16, color: CareColors.muted),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.muted,
              fontSize: 13.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}
