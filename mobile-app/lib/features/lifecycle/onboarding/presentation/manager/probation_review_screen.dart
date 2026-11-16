import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../shared/app_toast.dart';
import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart';
import '../onboarding_kit.dart';

/// PB2 · a probation month as the manager sees it (the v2 "monthly review"
/// on the kit): the month's goals (set at the start, editable until they
/// lock), the joiner's check-in, the manager's own check-in with a rating,
/// and the review. One Save writes what changed.
class ProbationReviewScreen extends StatefulWidget {
  const ProbationReviewScreen({
    super.key,
    required this.shell,
    required this.journeyId,
    required this.month,
    this.initial,
    this.joinerName,
  });

  final OnboardingShell shell;
  final String journeyId;
  final int month;
  final ProbationMonth? initial;
  final String? joinerName;

  static const ratings = [('1', 'Not yet'), ('2', 'Getting there'), ('3', 'On track'), ('4', 'Strong'), ('5', 'Nailed it')];

  @override
  State<ProbationReviewScreen> createState() => _ProbationReviewScreenState();
}

class _ProbationReviewScreenState extends State<ProbationReviewScreen> {
  ProbationMonth? _month;
  String? _name;
  bool _loading = false;
  String? _error;
  final List<TextEditingController> _goals = [];
  final _checkin = TextEditingController();
  final _review = TextEditingController();
  int? _rating;
  bool _busy = false;

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    _name = widget.joinerName;
    _fill(widget.initial);
    if (widget.initial == null || _name == null) unawaited(_load());
  }

  @override
  void dispose() {
    for (final c in _goals) {
      c.dispose();
    }
    _checkin.dispose();
    _review.dispose();
    super.dispose();
  }

  void _fill(ProbationMonth? month) {
    _month = month;
    for (final c in _goals) {
      c.dispose();
    }
    _goals
      ..clear()
      ..addAll([for (final goal in month?.goals ?? const <String>[]) TextEditingController(text: goal)]);
    if (_goals.isEmpty) _goals.add(TextEditingController());
    _checkin.text = month?.checkinManager?.text ?? '';
    _rating = month?.checkinManager?.rating;
    _review.text = month?.review ?? '';
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final detail = await _shell.api.fetchJoiner(widget.journeyId);
      if (!mounted) return;
      setState(() {
        _name = detail.joiner.name;
        final month = detail.probation?.months.where((m) => m.monthNo == widget.month).firstOrNull;
        if (month != null && widget.initial == null) _fill(month);
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool get _goalsLocked => _month?.lockedAt != null;

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await _shell.api.saveProbationMonth(
        widget.journeyId,
        widget.month,
        goals: _goalsLocked ? null : [for (final c in _goals) if (c.text.trim().isNotEmpty) c.text.trim()],
        checkin: _checkin.text.trim().isEmpty && _rating == null
            ? null
            : CheckinEntry(text: _checkin.text.trim(), rating: _rating),
        review: _review.text.trim().isEmpty ? null : _review.text.trim(),
      );
      if (!mounted) return;
      showAppToast(context, 'Saved');
      Navigator.of(context).pop();
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = _name ?? 'New joiner';
    final first = name.split(' ').first;
    final theirs = _month?.checkinEmployee;
    if (_loading && _month == null && _name == null) {
      return OnbScaffold(shell: _shell, title: 'Month ${widget.month}', body: OnbLoadState(error: _error, onRetry: _load));
    }
    return OnbScaffold(
      shell: _shell,
      title: '$first · Month ${widget.month}',
      showNav: false,
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
        children: [
          Row(
            children: [
              const Expanded(child: Text('Goals', style: OnbText.h1)),
              if (_goalsLocked) const OnbTag('Locked', tone: OnbTone.locked, icon: Icons.lock_outline_rounded),
            ],
          ),
          const SizedBox(height: 8),
          if (_goalsLocked)
            for (final (index, goal) in (_month?.goals ?? const <String>[]).indexed)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text('${index + 1}. $goal', style: OnbText.body.copyWith(color: OnbColors.text)),
              )
          else ...[
            for (final (index, controller) in _goals.indexed)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: OnbTextArea(fieldKey: ValueKey('month-goal-$index'), controller: controller, hint: 'Goal ${index + 1}', minLines: 1),
              ),
            if (_goals.length < 5)
              OnbLink(label: 'Add a goal', icon: Icons.add_rounded, onTap: () => setState(() => _goals.add(TextEditingController()))),
          ],
          const SizedBox(height: 20),
          Text('$first’s check-in', style: OnbText.h1),
          const SizedBox(height: 8),
          OnbCard(
            child: theirs == null
                ? Text('$first checks in at the end of the month.', style: OnbText.label)
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (theirs.rating != null)
                        Text('Felt ${_feeling(theirs.rating!)}', style: OnbText.bodyStrong),
                      const SizedBox(height: 4),
                      Text(theirs.text, style: OnbText.body),
                    ],
                  ),
          ),
          const SizedBox(height: 20),
          const Text('Your check-in', style: OnbText.h1),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final (value, label) in ProbationReviewScreen.ratings)
                ChoiceChip(
                  key: ValueKey('rating-$value'),
                  label: Text('$value · $label'),
                  selected: _rating == int.parse(value),
                  onSelected: (_) => setState(() => _rating = int.parse(value)),
                ),
            ],
          ),
          const SizedBox(height: 10),
          OnbTextArea(controller: _checkin, hint: 'How the month went for $first'),
          const SizedBox(height: 20),
          const Text('Review', style: OnbText.h1),
          const SizedBox(height: 8),
          OnbTextArea(fieldKey: const ValueKey('month-review'), controller: _review, hint: 'Great start. Keep going with…'),
          const SizedBox(height: 10),
          Text('$first’s plant grows a leaf once you’ve both checked in.', style: OnbText.label),
        ],
      ),
      footer: OnbFooter(
        children: [OnbPrimaryButton(key: const ValueKey('month-save'), label: 'Save', busy: _busy, onTap: _save)],
      ),
    );
  }

  static String _feeling(int rating) => switch (rating) {
    1 => 'rough',
    2 => 'okay',
    3 => 'good',
    4 => 'great',
    _ => 'great',
  };
}
