import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../services/api_config.dart';
import '../../../services/linkified_text.dart';
import '../../auth/data/auth_models.dart';
import '../../manager/presentation/manager_screen.dart';
import '../../manager_shell/presentation/app_home_header.dart';
import '../../shared/app_toast.dart';
import '../data/talk_api_service.dart';
import '../data/talk_models.dart';
import 'talk_booking_screen.dart';
import 'talk_format.dart';

/// Talk: book a counsellor, then see the session you have coming up and the
/// ones you have had. Two doors in at the top, one starting from the person
/// and one from the time; everything under them is the person's own history.
class TalkTab extends StatefulWidget {
  const TalkTab({
    super.key,
    required this.session,
    required this.profileAction,
    required this.onNotifications,
    this.service,
  });

  final AuthSession session;
  final Widget profileAction;
  final VoidCallback onNotifications;

  /// Supplied by tests; the tab makes its own otherwise.
  final TalkApiService? service;

  @override
  State<TalkTab> createState() => _TalkTabState();
}

class _TalkTabState extends State<TalkTab> {
  late final TalkApiService _service =
      widget.service ?? TalkApiService(session: widget.session);
  TalkSessions _sessions = TalkSessions.empty;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final sessions = await _service.sessions();
      if (!mounted) return;
      setState(() {
        _sessions = sessions;
        _loading = false;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error is TalkApiException
            ? error.message
            : 'Could not load your sessions.';
      });
    }
  }

  Future<void> _book(TalkBookingMode mode) async {
    final booked = await Navigator.of(context).push<TalkSession>(
      MaterialPageRoute(
        builder: (_) => TalkBookingScreen(
          session: widget.session,
          mode: mode,
          service: _service,
        ),
      ),
    );
    if (booked == null || !mounted) return;
    showAppToast(
      context,
      'Booked with ${booked.counsellorName} for ${talkDate(booked.startsAt)}',
    );
    await _load();
  }

  Future<void> _join(TalkSession session) async {
    final url = session.joinUrl;
    if (url == null || url.isEmpty) return;
    final opened = await openExternalLink(url);
    if (!opened && mounted) showAppToast(context, 'Could not open the link');
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: MColors.bg,
      child: Column(
        children: [
          AppHomeHeader(
            profileAction: widget.profileAction,
            onNotifications: widget.onNotifications,
          ),
          Expanded(
            child: RefreshIndicator(
              color: MColors.terra,
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  // Side by side and the same height, whichever title wraps.
                  IntrinsicHeight(
                    child: Row(
                      spacing: 12,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Expanded(
                          child: _TalkDoor(
                            icon: Icons.person_search_rounded,
                            title: 'Choose a counsellor',
                            subtitle: 'Pick who, then when',
                            onTap: () => _book(TalkBookingMode.byCounsellor),
                          ),
                        ),
                        Expanded(
                          child: _TalkDoor(
                            icon: Icons.event_available_rounded,
                            title: 'Book a slot',
                            subtitle: 'Pick when, then who',
                            onTap: () => _book(TalkBookingMode.bySlot),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),
                  const _SectionHeading('Upcoming sessions'),
                  if (_loading)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 28),
                      child: Center(
                        child: CircularProgressIndicator(color: MColors.terra),
                      ),
                    )
                  else if (_error case final message?)
                    _Note(message, onRetry: _load)
                  else if (_sessions.upcoming.isEmpty)
                    const _Note(
                      'No session booked yet. Choose a counsellor or a slot '
                      'above to book one.',
                    )
                  else
                    for (final session in _sessions.upcoming)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: _UpcomingCard(
                          session: session,
                          onJoin: () => _join(session),
                        ),
                      ),
                  const SizedBox(height: 22),
                  const _SectionHeading('Past sessions'),
                  if (!_loading && _error == null)
                    if (_sessions.past.isEmpty)
                      const _Note('Nothing yet.')
                    else
                      for (final session in _sessions.past)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: _PastRow(session: session),
                        ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TalkDoor extends StatelessWidget {
  const _TalkDoor({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableCard(
      onTap: onTap,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: MColors.terraTint,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: MColors.terra, size: 21),
          ),
          const SizedBox(height: 12),
          Text(
            title,
            style: const TextStyle(
              fontFamily: 'Sora',
              color: MColors.ink,
              fontSize: 14.5,
              fontWeight: FontWeight.w700,
              height: 1.25,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            subtitle,
            style: const TextStyle(color: MColors.inkSoft, fontSize: 12.5),
          ),
        ],
      ),
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading(this.title);

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        title,
        style: const TextStyle(
          fontFamily: 'Sora',
          color: MColors.ink,
          fontSize: 17,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note(this.text, {this.onRetry});

  final String text;
  final Future<void> Function()? onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: MColors.line),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                color: MColors.inkSoft,
                fontSize: 13.5,
                height: 1.4,
              ),
            ),
          ),
          if (onRetry != null)
            TextButton(
              onPressed: onRetry,
              child: const Text(
                'Retry',
                style: TextStyle(color: MColors.terra, fontWeight: FontWeight.w700),
              ),
            ),
        ],
      ),
    );
  }
}

class _CounsellorFace extends StatelessWidget {
  const _CounsellorFace({
    required this.initial,
    required this.photoUrl,
    required this.size,
  });

  final String initial;
  final String? photoUrl;
  final double size;

  @override
  Widget build(BuildContext context) {
    final url = photoUrl;
    if (url == null || url.isEmpty) {
      return AvatarBadge(initial: initial, index: 3, size: size);
    }
    return ClipOval(
      child: Image(
        image: avatarImageProvider(url),
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) =>
            AvatarBadge(initial: initial, index: 3, size: size),
      ),
    );
  }
}

class _UpcomingCard extends StatelessWidget {
  const _UpcomingCard({required this.session, required this.onJoin});

  final TalkSession session;
  final VoidCallback onJoin;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: MColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _CounsellorFace(
                initial: session.counsellorInitial,
                photoUrl: session.counsellorPhotoUrl,
                size: 44,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      session.counsellorName,
                      style: const TextStyle(
                        fontFamily: 'Sora',
                        color: MColors.ink,
                        fontSize: 15.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (session.counsellorHeadline.isNotEmpty)
                      Text(
                        session.counsellorHeadline,
                        style: const TextStyle(
                          color: MColors.inkSoft,
                          fontSize: 12.5,
                        ),
                      ),
                  ],
                ),
              ),
              if (session.placeholderLink)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: MColors.goldTint,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: const Text(
                    'Test link',
                    style: TextStyle(
                      color: MColors.gold,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              const Icon(
                Icons.calendar_today_rounded,
                size: 15,
                color: MColors.inkFaint,
              ),
              const SizedBox(width: 6),
              Text(
                talkDate(session.startsAt),
                style: const TextStyle(
                  color: MColors.ink,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 14),
              const Icon(
                Icons.schedule_rounded,
                size: 15,
                color: MColors.inkFaint,
              ),
              const SizedBox(width: 6),
              Text(
                talkRange(session.startsAt, session.endsAt),
                style: const TextStyle(
                  color: MColors.ink,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          if (session.joinUrl != null) ...[
            const SizedBox(height: 14),
            ActionButton(
              label: 'Join session',
              icon: Icons.videocam_rounded,
              background: MColors.terra,
              foreground: Colors.white,
              onTap: onJoin,
            ),
          ],
        ],
      ),
    );
  }
}

class _PastRow extends StatelessWidget {
  const _PastRow({required this.session});

  final TalkSession session;

  @override
  Widget build(BuildContext context) {
    final cancelled = session.status == TalkSessionStatus.cancelled;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: MColors.line),
      ),
      child: Row(
        children: [
          _CounsellorFace(
            initial: session.counsellorInitial,
            photoUrl: session.counsellorPhotoUrl,
            size: 36,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  session.counsellorName,
                  style: const TextStyle(
                    color: MColors.ink,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  '${talkDate(session.startsAt)} · ${talkTime(session.startsAt)}',
                  style: const TextStyle(color: MColors.inkSoft, fontSize: 12.5),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
            decoration: BoxDecoration(
              color: cancelled ? MColors.rejectTint : MColors.approveTint,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              cancelled ? 'Cancelled' : 'Completed',
              style: TextStyle(
                color: cancelled ? MColors.rejectInk : MColors.approveInk,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The back tile the pushed screens wear, shared with the booking screen.
class TalkTopBar extends StatelessWidget {
  const TalkTopBar({super.key, required this.title, required this.onBack});

  final String title;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(
        16,
        MediaQuery.paddingOf(context).top + 8,
        18,
        12,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFF3F4F6))),
      ),
      child: Row(
        children: [
          Material(
            color: MColors.bg,
            borderRadius: BorderRadius.circular(12),
            child: InkWell(
              onTap: onBack,
              borderRadius: BorderRadius.circular(12),
              child: SizedBox(
                width: 38,
                height: 38,
                child: Center(
                  child: SvgPicture.asset(
                    'assets/icons/chevron_back.svg',
                    width: 20,
                    height: 20,
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              title,
              style: const TextStyle(
                color: MColors.ink,
                fontSize: 19,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
