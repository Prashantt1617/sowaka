import 'package:flutter/material.dart';

import '../../../services/api_config.dart';
import '../../care/presentation/care_theme.dart';
import '../../talk/data/talk_models.dart';
import '../../talk/presentation/talk_format.dart';

/// A counsellor's face: their photo, or their initials on a soft tile.
class CounsellorFace extends StatelessWidget {
  const CounsellorFace({super.key, required this.counsellor, this.size = 64});

  final Counsellor counsellor;
  final double size;

  @override
  Widget build(BuildContext context) {
    final url = counsellor.photoUrl;
    final initials = counsellor.name
        .trim()
        .split(RegExp(r'\s+'))
        .take(2)
        .map((w) => w.isEmpty ? '' : w[0].toUpperCase())
        .join();
    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: CareColors.peach,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(size * 0.5),
          topRight: Radius.circular(size * 0.5),
          bottomLeft: Radius.circular(size * 0.2),
          bottomRight: Radius.circular(size * 0.2),
        ),
      ),
      child: Text(
        initials,
        style: TextStyle(
          fontFamily: careFont,
          color: CareColors.clay,
          fontSize: size * 0.34,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
    if (url == null || url.isEmpty) return fallback;
    return ClipRRect(
      borderRadius: BorderRadius.only(
        topLeft: Radius.circular(size * 0.5),
        topRight: Radius.circular(size * 0.5),
        bottomLeft: Radius.circular(size * 0.2),
        bottomRight: Radius.circular(size * 0.2),
      ),
      child: Image(
        image: avatarImageProvider(url),
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => fallback,
      ),
    );
  }
}

/// Face, name, 'Counsellor · 8 years of experience', languages.
class CounsellorPerson extends StatelessWidget {
  const CounsellorPerson({
    super.key,
    required this.counsellor,
    this.large = false,
  });

  final Counsellor counsellor;
  final bool large;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        CounsellorFace(counsellor: counsellor, size: large ? 72 : 64),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                counsellor.name,
                style: TextStyle(
                  fontFamily: careFont,
                  color: CareColors.ink,
                  fontSize: large ? 26 : 22,
                  fontWeight: FontWeight.w500,
                  height: 1.15,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '${counsellor.experienceLine}${counsellor.languages.isEmpty ? '' : '\n${counsellor.languages.join(' · ')}'}',
                style: const TextStyle(
                  fontFamily: careFont,
                  color: CareColors.muted,
                  fontSize: 12.5,
                  height: 1.5,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Tick, reason; tick, reason.
class ReasonList extends StatelessWidget {
  const ReasonList(this.reasons, {super.key});

  final List<String> reasons;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      for (final reason in reasons)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(
                padding: EdgeInsets.only(top: 2),
                child: Icon(
                  Icons.check_rounded,
                  size: 16,
                  color: CareColors.blue,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  reason,
                  style: const TextStyle(
                    fontFamily: careFont,
                    color: CareColors.ink,
                    fontSize: 13.5,
                    height: 1.45,
                  ),
                ),
              ),
            ],
          ),
        ),
    ],
  );
}

/// What a counsellor does not meet, said plainly.
class UnmetNote extends StatelessWidget {
  const UnmetNote(this.unmet, {super.key});

  final List<String> unmet;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    decoration: BoxDecoration(
      color: CareColors.peach,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Text(
      'Not met: ${unmet.join(' · ')}',
      style: const TextStyle(
        fontFamily: careFont,
        color: CareColors.clay,
        fontSize: 12.5,
        fontWeight: FontWeight.w600,
        height: 1.4,
      ),
    ),
  );
}

/// The focus areas as small white chips.
class FocusChips extends StatelessWidget {
  const FocusChips(this.labels, {super.key});

  final List<String> labels;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: [
      for (final label in labels)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: CareColors.paper,
            borderRadius: BorderRadius.circular(100),
            border: Border.all(color: CareColors.line),
          ),
          child: Text(
            label,
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.ink,
              fontSize: 12.5,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
    ],
  );
}

/// 'Counsellor   Ananya Rao', one line of a summary.
/// A counsellor as the list shows them: the person, two focus areas at
/// most, and an arrow. The whole card opens their profile.
class CounsellorListCard extends StatelessWidget {
  const CounsellorListCard({
    super.key,
    required this.counsellor,
    required this.onTap,
    this.trailing,
  });

  final Counsellor counsellor;
  final VoidCallback onTap;

  /// Lines under the person and before the arrow row, when a page has more
  /// to say on the same card.
  final List<Widget>? trailing;

  @override
  Widget build(BuildContext context) {
    final c = counsellor;
    return CareCard(
      key: ValueKey('counsellor-${c.userId}'),
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CounsellorPerson(counsellor: c),
          ...?trailing,
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: c.focusLabels.isEmpty
                    ? const SizedBox.shrink()
                    : CareCopy(c.focusLabels.take(2).join(' · '), size: 12.5),
              ),
              const SizedBox(width: 8),
              const Icon(
                Icons.arrow_forward_rounded,
                color: CareColors.blue,
                size: 20,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class SummaryLine extends StatelessWidget {
  const SummaryLine(this.label, this.value, {super.key});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(vertical: 11),
    decoration: const BoxDecoration(
      border: Border(bottom: BorderSide(color: CareColors.line)),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 92,
          child: Text(
            label,
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.muted,
              fontSize: 12.5,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.ink,
              fontSize: 13.5,
              fontWeight: FontWeight.w600,
              height: 1.45,
            ),
          ),
        ),
      ],
    ),
  );
}

/// One past or coming session, as a row on a list.
class SessionRow extends StatelessWidget {
  const SessionRow({
    super.key,
    required this.session,
    required this.onTap,
    this.title,
  });

  final TalkSession session;
  final VoidCallback onTap;
  final String? title;

  @override
  Widget build(BuildContext context) {
    final local = session.startsAt.toLocal();
    final status = switch (session.status) {
      TalkSessionStatus.cancelled => 'Cancelled',
      TalkSessionStatus.completed => 'Completed',
      TalkSessionStatus.booked => 'Booked',
    };
    return Material(
      color: CareColors.paper,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: CareColors.line),
          ),
          child: Row(
            children: [
              Container(
                width: 50,
                padding: const EdgeInsets.symmetric(vertical: 8),
                decoration: BoxDecoration(
                  color: CareColors.sage,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  children: [
                    Text(
                      '${local.day}',
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: CareColors.ink,
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        height: 1,
                      ),
                    ),
                    Text(
                      talkDate(local).split(' ').last,
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: CareColors.muted,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title ?? session.counsellorName,
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: CareColors.ink,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '$status · ${talkTime(session.startsAt)} · Video call',
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: CareColors.muted,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: CareColors.muted),
            ],
          ),
        ),
      ),
    );
  }
}

/// A session that has happened: the same row, which opens on a tap to show
/// how the person felt before it and what they made of it after.
///
/// Closed to start with, so a list of sessions reads as a list rather than a
/// wall; the words are there for whoever wants them.
class SessionHistoryRow extends StatefulWidget {
  const SessionHistoryRow({
    super.key,
    required this.session,
    required this.onOpen,
    this.title,
  });

  final TalkSession session;

  /// The session's own page, from the link inside.
  final VoidCallback onOpen;
  final String? title;

  @override
  State<SessionHistoryRow> createState() => _SessionHistoryRowState();
}

class _SessionHistoryRowState extends State<SessionHistoryRow> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    final checkIn = session.checkIn;
    final review = session.review;
    return Material(
      color: CareColors.paper,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: () => setState(() => _open = !_open),
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: CareColors.line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.title ?? session.counsellorName,
                          style: const TextStyle(
                            fontFamily: careFont,
                            color: CareColors.ink,
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${talkDate(session.startsAt)} · ${talkTime(session.startsAt)} · Video call',
                          style: const TextStyle(
                            fontFamily: careFont,
                            color: CareColors.muted,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  AnimatedRotation(
                    turns: _open ? 0.25 : 0,
                    duration: const Duration(milliseconds: 200),
                    child: const Icon(
                      Icons.chevron_right_rounded,
                      color: CareColors.muted,
                    ),
                  ),
                ],
              ),
              if (_open) ...[
                const SizedBox(height: 12),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: _BeforeAfter(
                        label: 'Before',
                        value: checkIn == null
                            ? ''
                            : '${feelingOf(checkIn.feeling).face} ${feelingOf(checkIn.feeling).label}',
                        note: checkIn?.note ?? '',
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _BeforeAfter(
                        label: 'After',
                        value: review == null
                            ? ''
                            : '${'★' * review.rating}${'☆' * (5 - review.rating)}',
                        note: review?.note ?? '',
                        gold: true,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                CareLink('Open session', size: 12.5, onTap: widget.onOpen),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _BeforeAfter extends StatelessWidget {
  const _BeforeAfter({
    required this.label,
    required this.value,
    required this.note,
    this.gold = false,
  });

  final String label;
  final String value;
  final String note;
  final bool gold;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: CareColors.bg,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CareEyebrow(label),
          const SizedBox(height: 4),
          Text(
            value.isEmpty ? 'Not answered' : value,
            style: TextStyle(
              fontFamily: careFont,
              color: value.isEmpty
                  ? CareColors.muted
                  : gold
                  ? const Color(0xFFE0A526)
                  : CareColors.ink,
              fontSize: 13,
              fontWeight: FontWeight.w700,
              letterSpacing: gold ? 1 : 0,
            ),
          ),
          if (note.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              '“$note”',
              style: const TextStyle(
                fontFamily: careFont,
                color: CareColors.muted,
                fontSize: 12,
                height: 1.4,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A card that leads somewhere: icon, title, copy, a blue tertiary line.
class RouteCard extends StatelessWidget {
  const RouteCard({
    super.key,
    required this.icon,
    required this.title,
    required this.copy,
    required this.action,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String copy;
  final String action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => CareCard(
    onTap: onTap,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: CareColors.blue, size: 26),
        const SizedBox(height: 12),
        CareSectionTitle(title),
        const SizedBox(height: 6),
        CareCopy(copy),
        const SizedBox(height: 10),
        CareLink(action, onTap: onTap),
      ],
    ),
  );
}
