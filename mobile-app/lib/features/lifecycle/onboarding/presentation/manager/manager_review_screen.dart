import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../shared/app_toast.dart';
import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart';
import '../../data/team_joiners_api.dart';
import '../onboarding_kit.dart';
import 'team_kit.dart';

/// A month's self check-in as the manager reviews it (MgrReview, artifact
/// 8C82Qv57Z88eV7VTVQpFGZ): who sent it and when, what they wrote, their
/// progress on the month's goals, your comments (voice typing too) and Send
/// back or Mark as reviewed. Reads the probation month the joiner's check-in
/// and HR's probation panel read; the review is that month's review.
class ManagerReviewScreen extends StatefulWidget {
  const ManagerReviewScreen({super.key, required this.shell, required this.teamApi, required this.journeyId, required this.month, this.title, this.barTitle});

  final OnboardingShell shell;
  final TeamJoinersApi teamApi;
  final String journeyId;
  final int month;

  /// The row's title ("Review Priya’s Month-2 self check-in").
  final String? title;

  /// The header ("All tasks" when opened from View all, else their name).
  final String? barTitle;

  @override
  State<ManagerReviewScreen> createState() => _ManagerReviewScreenState();
}

/// Where a month's self check-in stands (the server's monthReviewState).
TeamReviewState monthReviewState(ProbationMonth? m) {
  if (m == null) return TeamReviewState.waiting;
  if (m.review != null || m.reviewAt != null) return TeamReviewState.reviewed;
  final sent = m.checkinEmployee?.at;
  final back = m.sentBackAt;
  if (back != null && (sent == null || !back.isBefore(sent))) return TeamReviewState.back;
  return m.checkinEmployee != null ? TeamReviewState.ready : TeamReviewState.waiting;
}

/// "today", "yesterday", "3 days ago".
String sentAgo(DateTime at, DateTime now) {
  final days = DateTime(now.year, now.month, now.day).difference(DateTime(at.year, at.month, at.day)).inDays;
  return days <= 0 ? 'today' : days == 1 ? 'yesterday' : '$days days ago';
}

class _ManagerReviewScreenState extends State<ManagerReviewScreen> {
  JoinerDetail? _detail;
  String? _error;
  bool _sending = false;
  final _comment = TextEditingController();
  final _voice = TeamVoice();

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _comment.dispose();
    _voice.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final detail = await widget.shell.api.fetchJoiner(widget.journeyId);
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _error = null;
        final m = _monthOf(detail);
        if (m?.review != null && _comment.text.isEmpty) _comment.text = m!.review!;
      });
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    }
  }

  ProbationMonth? _monthOf(JoinerDetail d) => d.probation?.months.where((m) => m.monthNo == widget.month).firstOrNull;

  Future<void> _answer({required bool reviewed}) async {
    final first = _detail?.joiner.firstName ?? '';
    setState(() => _sending = true);
    try {
      if (reviewed) {
        await widget.teamApi.reviewMonth(widget.journeyId, widget.month, comment: _comment.text);
      } else {
        await widget.teamApi.sendBackMonth(widget.journeyId, widget.month, comment: _comment.text);
      }
      if (!mounted) return;
      showAppToast(context, reviewed ? 'Marked as reviewed' : 'Sent back to $first');
      Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      setState(() => _sending = false);
      showAppToast(context, onboardingErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    final name = detail?.joiner.name ?? '';
    return OnbScaffold(
      shell: widget.shell,
      title: widget.barTitle ?? (name.isEmpty ? 'Joiners' : name),
      body: detail == null ? OnbLoadState(error: _error, onRetry: _load) : _body(detail),
    );
  }

  Widget _body(JoinerDetail detail) {
    final joiner = detail.joiner;
    final first = joiner.firstName;
    final m = _monthOf(detail);
    final state = monthReviewState(m);
    final theirs = m?.checkinEmployee;
    final (label, bg, fg) = switch (state) {
      TeamReviewState.ready => ('Ready to review', TeamColors.blueBg, OnbColors.primary),
      TeamReviewState.reviewed => ('Reviewed', TeamColors.okBg, TeamColors.okFg),
      TeamReviewState.back => ('Sent back', TeamColors.warnBg, TeamColors.warnFg),
      TeamReviewState.waiting => ('Waiting', OnbColors.screen, OnbColors.text3),
    };
    final raw = widget.title ?? 'Review $first’s Month-${widget.month} self check-in';
    final stripped = raw.replaceFirst(RegExp(r'^Review '), '');
    final title = stripped.isEmpty ? stripped : stripped[0].toUpperCase() + stripped.substring(1);
    final sent = theirs?.at == null ? (theirs == null ? 'Not sent yet' : 'Sent') : 'Sent ${sentAgo(theirs!.at!, widget.shell.now())}';
    final answers = <(String, String)>[
      if (theirs?.win != null) ('What went well this month', theirs!.win!),
      if (theirs?.ask != null) ('Support I need', theirs!.ask!),
      if (theirs != null && theirs.win == null && theirs.ask == null && theirs.text.isNotEmpty) ('How the month went', theirs.text),
    ];
    final goals = m?.goals ?? const <String>[];
    final open = state == TeamReviewState.ready;
    Widget card(Widget child, {EdgeInsets padding = const EdgeInsets.all(14)}) => Container(
      padding: padding,
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
      child: child,
    );
    final children = <Widget>[
      Container(
        key: const ValueKey('review-head'),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: OnbColors.line)),
        child: Row(
          children: [
            OnbAvatar(name: joiner.name, photoUrl: joiner.photoUrl, size: 52),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: TeamColors.ink)),
                  const SizedBox(height: 2),
                  Text(sent, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                ],
              ),
            ),
            TeamPill(label, key: const ValueKey('review-state'), background: bg, foreground: fg, height: 26),
          ],
        ),
      ),
      for (final (q, a) in answers)
        card(
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(q, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: OnbColors.text3)),
              const SizedBox(height: 6),
              Text(a, style: const TextStyle(fontSize: 14, height: 1.5, color: TeamColors.ink)),
            ],
          ),
        ),
      if (goals.isNotEmpty)
        card(
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Progress on goals', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: OnbColors.text3)),
              for (final (i, goal) in goals.indexed) ...[
                const SizedBox(height: 10),
                Builder(
                  builder: (_) {
                    // The joiner's own 1–5 rating of the goal.
                    final r = theirs?.ratingFor(i);
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Expanded(child: Text(goal, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: TeamColors.ink))),
                            Text(r == null ? 'Not rated' : '$r of 5', style: const TextStyle(fontSize: 12, color: OnbColors.text2)),
                          ],
                        ),
                        const SizedBox(height: 6),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(999),
                          child: LinearProgressIndicator(
                            value: r == null ? 0 : r / 5,
                            minHeight: 6,
                            backgroundColor: OnbColors.line,
                            color: const Color(0xFF2563EB),
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ],
            ],
          ),
        ),
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Your comments', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: TeamColors.ink)),
          const SizedBox(height: 8),
          TeamNotesField(field: 'review-comment', controller: _comment, voice: _voice, label: 'Your comments', hint: 'What you’d like $first to know', minLines: 3, filled: false),
          const SizedBox(height: 8),
          Text('$first sees your comments.', style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
        ],
      ),
      if (open)
        Row(
          children: [
            Expanded(
              flex: 10,
              child: OnbSecondaryButton(key: const ValueKey('review-send-back'), label: 'Send back', onTap: _sending ? null : () => _answer(reviewed: false)),
            ),
            const SizedBox(width: 10),
            Expanded(
              flex: 14,
              child: OnbPrimaryButton(key: const ValueKey('review-ok'), label: 'Mark as reviewed', busy: _sending, onTap: _sending ? null : () => _answer(reviewed: true)),
            ),
          ],
        ),
    ];
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        for (final (i, c) in children.indexed) ...[if (i > 0) const SizedBox(height: 14), c],
      ],
    );
  }
}
