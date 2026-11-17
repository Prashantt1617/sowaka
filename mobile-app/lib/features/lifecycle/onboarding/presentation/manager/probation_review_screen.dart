import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../shared/app_toast.dart';
import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart';
import '../onboarding_kit.dart';

/// PB2 · a probation month as the manager sees it (3Rb v2 "Monthly review"
/// on the kit): the month's goals (editable until they lock), each goal
/// rated by the joiner and by you (GOAL · THEIRS · YOU), what they asked for
/// with "On it", one-tap feedback, the review, and next month's goals, which
/// the review sets. One Save writes what changed.
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

  /// One-tap feedback (the server accepts exactly these).
  static const feedback = ['Great start', 'Keep going', 'Let’s talk', 'Proud of you'];

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
  final List<int?> _goalRatings = [];
  final Set<String> _feedback = {};
  bool _askAck = false;
  final List<TextEditingController> _nextGoals = [];
  bool _nextLocked = false;
  bool _hasNext = false;
  bool _busy = false;

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    _name = widget.joinerName;
    _fill(widget.initial);
    // Always read the joiner: next month's goals come from there.
    unawaited(_load());
  }

  @override
  void dispose() {
    for (final c in _goals) {
      c.dispose();
    }
    for (final c in _nextGoals) {
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
    _goalRatings
      ..clear()
      ..addAll([for (var i = 0; i < (month?.goals.length ?? 0); i++) month?.checkinManager?.ratingFor(i)]);
    _feedback
      ..clear()
      ..addAll(month?.reviewFeedback ?? const []);
    _askAck = month?.askAck ?? false;
  }

  void _fillNext(ProbationMonth? next) {
    for (final c in _nextGoals) {
      c.dispose();
    }
    _nextGoals
      ..clear()
      ..addAll([for (final goal in next?.goals ?? const <String>[]) TextEditingController(text: goal)]);
    if (_nextGoals.isEmpty) _nextGoals.add(TextEditingController());
    _nextLocked = next?.lockedAt != null;
    _hasNext = next != null;
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final detail = await _shell.api.fetchJoiner(widget.journeyId);
      if (!mounted) return;
      setState(() {
        _name = detail.joiner.name;
        final months = detail.probation?.months ?? const <ProbationMonth>[];
        final month = months.where((m) => m.monthNo == widget.month).firstOrNull;
        if (month != null && widget.initial == null) _fill(month);
        _fillNext(months.where((m) => m.monthNo == widget.month + 1).firstOrNull);
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
      final rated = _goalRatings.any((r) => r != null);
      final next = [for (final c in _nextGoals) if (c.text.trim().isNotEmpty) c.text.trim()];
      final reviewing = _review.text.trim().isNotEmpty || _feedback.isNotEmpty;
      await _shell.api.saveProbationMonth(
        widget.journeyId,
        widget.month,
        goals: _goalsLocked ? null : [for (final c in _goals) if (c.text.trim().isNotEmpty) c.text.trim()],
        checkin: _checkin.text.trim().isEmpty && _rating == null && !rated
            ? null
            : CheckinEntry(text: _checkin.text.trim(), rating: _rating, goalRatings: [for (final r in _goalRatings) r ?? 0]),
        review: reviewing ? _review.text.trim() : null,
        feedback: reviewing ? _feedback.toList() : null,
        askAck: reviewing ? _askAck : null,
        // The review sets next month's goals (until that month locks).
        nextGoals: reviewing && _hasNext && !_nextLocked && next.isNotEmpty ? next : null,
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
                      if (theirs.rating != null) Text('Felt “${_feeling(theirs.rating!)}”', style: OnbText.bodyStrong),
                      const SizedBox(height: 4),
                      if (theirs.win != null) Text('A win: ${theirs.win}', style: OnbText.body) else Text(theirs.text, style: OnbText.body),
                    ],
                  ),
          ),
          if ((_month?.goals ?? const <String>[]).isNotEmpty) ...[
            const SizedBox(height: 20),
            Row(
              children: [
                const Expanded(child: Text('GOAL', style: OnbText.eyebrow)),
                SizedBox(width: 56, child: Text(first.toUpperCase(), style: OnbText.eyebrow, textAlign: TextAlign.center)),
                const SizedBox(width: 8),
                const SizedBox(width: 150, child: Text('YOU', style: OnbText.eyebrow, textAlign: TextAlign.center)),
              ],
            ),
            const SizedBox(height: 6),
            for (final (index, goal) in (_month?.goals ?? const <String>[]).indexed)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  children: [
                    Expanded(child: Text(goal, style: OnbText.body.copyWith(color: OnbColors.text))),
                    SizedBox(
                      width: 56,
                      child: Text(
                        theirs?.ratingFor(index)?.toString() ?? '–',
                        key: ValueKey('their-goal-$index'),
                        style: OnbText.bodyStrong,
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 150,
                      child: Wrap(
                        alignment: WrapAlignment.center,
                        spacing: 2,
                        children: [
                          for (var value = 1; value <= 5; value++)
                            Semantics(
                              button: true,
                              selected: index < _goalRatings.length && _goalRatings[index] == value,
                              label: 'Goal ${index + 1}: $value',
                              child: InkWell(
                                key: ValueKey('my-goal-$index-$value'),
                                customBorder: const CircleBorder(),
                                onTap: () => setState(() {
                                  while (_goalRatings.length <= index) {
                                    _goalRatings.add(null);
                                  }
                                  _goalRatings[index] = value;
                                }),
                                child: Container(
                                  width: 26,
                                  height: 26,
                                  alignment: Alignment.center,
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    color: index < _goalRatings.length && _goalRatings[index] == value ? OnbColors.primary : OnbColors.tint,
                                  ),
                                  child: Text(
                                    '$value',
                                    style: OnbText.label.copyWith(
                                      color: index < _goalRatings.length && _goalRatings[index] == value ? Colors.white : OnbColors.primary,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ],
          if (theirs?.ask != null) ...[
            const SizedBox(height: 12),
            OnbCard(
              key: const ValueKey('they-asked'),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${first.toUpperCase()} ASKED', style: OnbText.eyebrow),
                        const SizedBox(height: 4),
                        Text(theirs!.ask!, style: OnbText.bodyStrong),
                      ],
                    ),
                  ),
                  FilterChip(
                    key: const ValueKey('on-it'),
                    label: Text(_askAck ? 'On it ✓' : 'On it'),
                    selected: _askAck,
                    onSelected: (value) => setState(() => _askAck = value),
                  ),
                ],
              ),
            ),
          ],
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
          OnbTextArea(controller: _checkin, hint: 'How the month went for $first (optional)'),
          const SizedBox(height: 20),
          const Text('Review', style: OnbText.h1),
          const SizedBox(height: 8),
          const Text('ONE-TAP FEEDBACK', style: OnbText.eyebrow),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final chip in ProbationReviewScreen.feedback)
                FilterChip(
                  key: ValueKey('feedback-$chip'),
                  label: Text(chip),
                  selected: _feedback.contains(chip),
                  onSelected: (on) => setState(() => on ? _feedback.add(chip) : _feedback.remove(chip)),
                ),
            ],
          ),
          const SizedBox(height: 10),
          OnbTextArea(fieldKey: const ValueKey('month-review'), controller: _review, hint: 'Anything to add (optional)'),
          if (_hasNext) ...[
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(child: Text('Month ${widget.month + 1} goals', style: OnbText.h1)),
                if (_nextLocked) const OnbTag('Locked', tone: OnbTone.locked, icon: Icons.lock_outline_rounded),
              ],
            ),
            const SizedBox(height: 4),
            Text('Your review sets these. $first sees them at the start of month ${widget.month + 1}.', style: OnbText.label),
            const SizedBox(height: 8),
            for (final (index, controller) in _nextGoals.indexed)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: OnbTextArea(
                  fieldKey: ValueKey('next-goal-$index'),
                  controller: controller,
                  hint: 'Goal ${index + 1}',
                  minLines: 1,
                ),
              ),
            if (_nextGoals.length < 5 && !_nextLocked)
              OnbLink(label: 'Add a goal', icon: Icons.add_rounded, onTap: () => setState(() => _nextGoals.add(TextEditingController()))),
          ],
          const SizedBox(height: 10),
          Text('$first’s plant grows a leaf once you’ve both checked in and you’ve reviewed the month.', style: OnbText.label),
        ],
      ),
      footer: OnbFooter(
        children: [OnbPrimaryButton(key: const ValueKey('month-save'), label: _hasNext ? 'Send · set month ${widget.month + 1} goals' : 'Save', busy: _busy, onTap: _save)],
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
