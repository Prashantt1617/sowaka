import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:printing/printing.dart';

import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import 'onboarding_kit.dart';
import 'plant.dart';

/// Probation for the joiner (6Zs §5.5, the v2 screens on the kit): each
/// month's goals from the manager (read-only), the month-end check-in, and
/// the manager's review once it is in.
class ProbationScreen extends StatefulWidget {
  const ProbationScreen({super.key, required this.shell, this.openCheckinFor});

  final OnboardingShell shell;

  /// Opens that month's check-in straight away (from a task or a push).
  final int? openCheckinFor;

  @override
  State<ProbationScreen> createState() => _ProbationScreenState();
}

class _ProbationScreenState extends State<ProbationScreen> {
  ProbationView? _view;
  String? _error;
  bool _openedCheckin = false;

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    unawaited(_first());
  }

  /// Last time's answer from the device at once; the live read replaces it.
  Future<void> _first() async {
    final kept = await _shell.api.fromDevice((api) => api.fetchProbation());
    if (kept != null && mounted && _view == null) {
      setState(() {
        _view = kept;
      });
    }
    await _load();
  }

  Future<void> _load() async {
    try {
      final view = await _shell.api.fetchProbation();
      if (!mounted) return;
      setState(() {
        _view = view;
        _error = null;
      });
      final month = widget.openCheckinFor;
      if (month != null && !_openedCheckin) {
        _openedCheckin = true;
        final target = view.months.where((m) => m.monthNo == month).firstOrNull;
        if (target != null && target.checkinEmployee == null) await _checkin(view, target);
      }
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    }
  }

  Future<void> _checkin(ProbationView view, ProbationMonth month) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => CheckinReelScreen(shell: _shell, month: month, managerName: view.managerName),
      ),
    );
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final view = _view;
    return OnbScaffold(
      shell: _shell,
      title: 'Probation',
      offline: view != null && _error != null,
      body: view == null
          ? OnbLoadState(error: _error, onRetry: _load)
          : view.months.isEmpty
          ? const Padding(
              padding: EdgeInsets.all(24),
              child: Text('Your month-1 goals show here once your manager sets them.', style: OnbText.body),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
                children: [
                  Text(
                    view.totalMonths == null ? 'Your probation' : '${view.totalMonths} months of probation',
                    style: OnbText.h1,
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Goals at the start of each month, a check-in at the end. Your plant grows a leaf once you and your manager have both checked in.',
                    style: OnbText.label,
                  ),
                  const SizedBox(height: 14),
                  for (final month in view.months) ...[
                    _MonthCard(
                      month: month,
                      current: month.monthNo == view.current?.monthNo,
                      managerName: view.managerName,
                      onCheckin: () => _checkin(view, month),
                    ),
                    const SizedBox(height: 12),
                  ],
                ],
              ),
            ),
    );
  }
}

class _MonthCard extends StatelessWidget {
  const _MonthCard({required this.month, required this.current, required this.onCheckin, this.managerName});

  final ProbationMonth month;
  final bool current;
  final String? managerName;
  final VoidCallback onCheckin;

  @override
  Widget build(BuildContext context) {
    final checkedIn = month.checkinEmployee != null;
    return OnbCard(
      key: ValueKey('month-${month.monthNo}'),
      borderColor: current ? OnbColors.brandBorder : OnbColors.line,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text('Month ${month.monthNo}', style: OnbText.h1)),
              if (month.bothCheckedIn)
                const OnbTag('+1 leaf', tone: OnbTone.done)
              else if (checkedIn)
                const OnbTag('Checked in', tone: OnbTone.inReview)
              else if (current)
                const OnbTag('Now', tone: OnbTone.count),
            ],
          ),
          const SizedBox(height: 10),
          Text('GOALS · SET BY ${(managerName ?? 'your manager').toUpperCase()}', style: OnbText.eyebrow),
          const SizedBox(height: 6),
          if (month.goals.isEmpty)
            const Text('Not set yet', style: OnbText.label)
          else
            for (final (index, goal) in month.goals.indexed)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text('${index + 1}. $goal', style: OnbText.body.copyWith(color: OnbColors.text)),
              ),
          if (month.reviewed) ...[
            const SizedBox(height: 10),
            const Text('REVIEW', style: OnbText.eyebrow),
            const SizedBox(height: 4),
            if (month.reviewFeedback.isNotEmpty)
              Wrap(spacing: 6, runSpacing: 6, children: [for (final f in month.reviewFeedback) OnbTag(f, tone: OnbTone.count)]),
            if (month.review != null && month.review!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(month.review!, style: OnbText.body),
            ],
            if (month.askAck && month.checkinEmployee?.ask != null) ...[
              const SizedBox(height: 4),
              Text('“${month.checkinEmployee!.ask}” · ${managerName ?? 'Your manager'} is on it', style: OnbText.label),
            ],
          ],
          if (current && !checkedIn && month.goals.isNotEmpty) ...[
            const SizedBox(height: 12),
            OnbPrimaryButton(
              key: ValueKey('checkin-${month.monthNo}'),
              label: 'Start month ${month.monthNo} check-in',
              onTap: onCheckin,
            ),
          ],
        ],
      ),
    );
  }
}

/// PB1 · the month-end check-in as reels (3Rb v2 "Month 2 check-in"): one
/// reel per goal ("How did it go?", 1–5), then how the month felt, then one
/// win and one ask; ends in "+1 leaf".
class CheckinReelScreen extends StatefulWidget {
  const CheckinReelScreen({super.key, required this.shell, required this.month, this.managerName});

  final OnboardingShell shell;
  final ProbationMonth month;
  final String? managerName;

  static const feelings = [('😣', 'Rough'), ('😐', 'Okay'), ('🙂', 'Good'), ('🤩', 'Great')];

  /// A goal's 1–5, as the v2 reel words it.
  static const goalScale = ['Not yet', 'Getting there', 'On track', 'Strong', 'Nailed it'];

  /// The check-in's words as the server stores them beside the win and ask.
  static String checkinText({required String win, required String ask}) => [
    if (win.trim().isNotEmpty) 'A win: ${win.trim()}',
    if (ask.trim().isNotEmpty) 'Would help: ${ask.trim()}',
  ].join('\n');

  @override
  State<CheckinReelScreen> createState() => _CheckinReelScreenState();
}

class _CheckinReelScreenState extends State<CheckinReelScreen> {
  int _step = 0;
  int? _feeling;
  late final List<int?> _goalRatings = List<int?>.filled(widget.month.goals.length, null);
  final _win = TextEditingController();
  final _ask = TextEditingController();
  bool _busy = false;
  bool _sent = false;

  List<String> get _goals => widget.month.goals;
  int get _steps => _goals.length + 2;
  bool get _onGoal => _step < _goals.length;
  bool get _onFeeling => _step == _goals.length;
  bool get _last => _step == _steps - 1;

  @override
  void dispose() {
    _win.dispose();
    _ask.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    try {
      await widget.shell.api.saveCheckin(
        widget.month.monthNo,
        CheckinReelScreen.checkinText(win: _win.text, ask: _ask.text),
        rating: _feeling,
        goalRatings: _goals.isEmpty ? null : [for (final r in _goalRatings) r ?? 0],
        win: _win.text,
        ask: _ask.text,
      );
      if (mounted) setState(() => _sent = true);
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = 'Month ${widget.month.monthNo} check-in';
    final manager = widget.managerName ?? 'your manager';
    if (_sent) {
      return OnbScaffold(
        shell: widget.shell,
        title: title,
        showNav: false,
        body: ListView(
          key: const ValueKey('checkin-sent'),
          padding: const EdgeInsets.fromLTRB(20, 40, 20, 24),
          children: [
            const Center(child: Plant(stage: 3, size: 120)),
            const SizedBox(height: 12),
            Text('+1 leaf', style: OnbText.displayXl(48), textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text('Sent to $manager. They review it in week 1.', style: OnbText.body, textAlign: TextAlign.center),
          ],
        ),
        footer: OnbFooter(children: [OnbPrimaryButton(label: 'Back to my journey', onTap: () => Navigator.of(context).pop())]),
      );
    }
    final ready = _onGoal
        ? _goalRatings[_step] != null
        : _onFeeling
        ? _feeling != null
        : _win.text.trim().isNotEmpty;
    return OnbScaffold(
      shell: widget.shell,
      title: title,
      showNav: false,
      body: Column(
        children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 0), child: OnbStoryBar(count: _steps, current: _step)),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
              children: [
                Text(
                  _onGoal ? 'GOAL ${_step + 1} OF ${_goals.length}' : 'STEP ${_step + 1} OF $_steps',
                  style: OnbText.eyebrow,
                ),
                const SizedBox(height: 8),
                OnbRise(key: ValueKey('checkin-step-$_step'), child: _stepBody()),
              ],
            ),
          ),
        ],
      ),
      footer: OnbFooter(
        children: [
          OnbPrimaryButton(
            key: const ValueKey('checkin-next'),
            label: _last ? 'Send check-in' : 'Next',
            busy: _busy,
            onTap: !ready ? null : (_last ? _send : () => setState(() => _step++)),
          ),
        ],
      ),
    );
  }

  Widget _stepBody() {
    if (_onGoal) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_goals[_step], style: OnbText.display),
          const SizedBox(height: 4),
          const Text('How did it go?', style: OnbText.label),
          const SizedBox(height: 16),
          for (final (index, label) in CheckinReelScreen.goalScale.indexed)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ChoiceChip(
                key: ValueKey('goal-$_step-rating-${index + 1}'),
                label: Text('${index + 1} · $label'),
                selected: _goalRatings[_step] == index + 1,
                onSelected: (_) => setState(() => _goalRatings[_step] = index + 1),
              ),
            ),
        ],
      );
    }
    if (_onFeeling) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('This month felt…', style: OnbText.display),
          const SizedBox(height: 16),
          Row(
            children: [
              for (final (index, (emoji, label)) in CheckinReelScreen.feelings.indexed)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 3),
                    child: OnbChoiceCardCompact(
                      key: ValueKey('feeling-${index + 1}'),
                      emoji: emoji,
                      label: label,
                      selected: _feeling == index + 1,
                      onTap: () => setState(() => _feeling = index + 1),
                    ),
                  ),
                ),
            ],
          ),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('One win. One ask.', style: OnbText.display),
        const SizedBox(height: 16),
        const Text('A win you’re proud of', style: OnbText.bodyStrong),
        const SizedBox(height: 6),
        OnbTextArea(
          fieldKey: const ValueKey('checkin-win'),
          controller: _win,
          hint: 'Shipped the first version of…',
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 14),
        const Text('Something that would help', style: OnbText.bodyStrong),
        const SizedBox(height: 2),
        const Text('Tools, time, people, clarity… Optional.', style: OnbText.label),
        const SizedBox(height: 6),
        OnbTextArea(fieldKey: const ValueKey('checkin-ask'), controller: _ask, hint: 'Optional'),
      ],
    );
  }
}

/// An emoji-and-word tile for a one-tap rating.
class OnbChoiceCardCompact extends StatelessWidget {
  const OnbChoiceCardCompact({super.key, required this.emoji, required this.label, required this.selected, required this.onTap});

  final String emoji;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: selected,
    label: label,
    child: GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: selected ? OnbColors.tint : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: selected ? OnbColors.primary : OnbColors.line, width: selected ? 1.5 : 1),
        ),
        child: ExcludeSemantics(
          child: Column(
            children: [
              Text(emoji, style: const TextStyle(fontSize: 26)),
              const SizedBox(height: 4),
              Text(label, style: OnbText.label),
            ],
          ),
        ),
      ),
    ),
  );
}

/// PB3 · the confirmation reveal: once HR has sent the letter, the outcome
/// as a moment — the plant in bloom and "Confirmed.", tap to reveal what
/// changes, and the letter. An extension reads plainly, with its letter.
class RevealScreen extends StatefulWidget {
  const RevealScreen({super.key, required this.shell, this.sharePdf});

  final OnboardingShell shell;

  /// Hands the letter to the phone (the share sheet); tests replace it.
  final Future<void> Function(Uint8List bytes, String name)? sharePdf;

  @override
  State<RevealScreen> createState() => _RevealScreenState();
}

class _RevealScreenState extends State<RevealScreen> {
  RevealView? _reveal;
  String? _error;
  bool _revealed = false;
  bool _opening = false;

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    unawaited(_firstReveal());
  }

  /// Last time's answer from the device at once; the live read replaces it.
  Future<void> _firstReveal() async {
    final kept = await _shell.api.fromDevice((api) => api.fetchReveal());
    if (kept != null && mounted && _reveal == null) {
      setState(() {
        _reveal = kept;
        _revealed = kept.seen || kept.outcome != 'confirm';
      });
    }
    await _load();
  }

  Future<void> _load() async {
    try {
      final reveal = await _shell.api.fetchReveal();
      if (mounted) {
        setState(() {
          _reveal = reveal;
          _revealed = reveal.seen || reveal.outcome != 'confirm';
          _error = null;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    }
  }

  Future<void> _tapReveal() async {
    setState(() => _revealed = true);
    try {
      await _shell.api.revealSeen();
    } catch (_) {}
  }

  Future<void> _openLetter(String url) async {
    setState(() => _opening = true);
    try {
      final bytes = await _shell.api.download(url);
      final share = widget.sharePdf ?? (Uint8List b, String name) => Printing.sharePdf(bytes: b, filename: name);
      await share(bytes, 'letter.pdf');
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final reveal = _reveal;
    if (reveal == null) {
      return OnbScaffold(shell: _shell, title: 'Your probation', body: OnbLoadState(error: _error, onRetry: _load));
    }
    final outcome = reveal.outcome;
    final name = _shell.viewerFirstName.toUpperCase();
    final letter = reveal.letterUrl;
    final (stage, headline, line) = switch (outcome) {
      'confirm' => (5, 'Confirmed.', 'Your probation is complete. Welcome aboard, properly.'),
      'extend' => (
        4,
        'Probation extended',
        reveal.extendMonths == null
            ? 'Your probation goes on a little longer. Your manager will set the next goals with you.'
            : 'Your probation goes on for ${reveal.extendMonths} more ${reveal.extendMonths == 1 ? 'month' : 'months'}. Your manager will set the next goals with you.',
      ),
      'not_confirm' => (4, 'About your probation', 'HR will talk to you about what happens next.'),
      _ => (4, 'Not decided yet', 'Your manager and HR decide in your final month. It shows here once they have.'),
    };
    return OnbScaffold(
      shell: _shell,
      title: 'Your probation',
      showNav: false,
      offline: _error != null,
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 32, 20, 24),
        children: [
          if (name.isNotEmpty) Text(name, style: OnbText.eyebrow, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(headline, key: const ValueKey('reveal-headline'), style: OnbText.displayXl(44), textAlign: TextAlign.center),
          const SizedBox(height: 16),
          Center(child: Plant(stage: stage, size: 160)),
          const SizedBox(height: 16),
          if (outcome == 'confirm' && !_revealed)
            Center(
              child: TextButton(
                key: const ValueKey('reveal-tap'),
                onPressed: _tapReveal,
                style: TextButton.styleFrom(foregroundColor: OnbColors.primary),
                child: const Text('TAP TO REVEAL', style: TextStyle(fontFamily: 'Sora', fontWeight: FontWeight.w600, letterSpacing: 1.2)),
              ),
            )
          else ...[
            Text(line, style: OnbText.body, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            if (reveal.designation != null) _RevealCard(label: 'NEW TITLE', value: reveal.designation!),
            // Their own new CTC: the server sends it to the joiner only (3Rb A5 "NEW CTC").
            if (reveal.salary != null)
              _RevealCard(key: const ValueKey('reveal-ctc'), label: 'NEW CTC', value: '${formatRupees(reveal.salary!)} a year'),
            if (reveal.kpis.isNotEmpty || reveal.kpiName != null)
              _RevealCard(
                key: const ValueKey('reveal-kpis'),
                label: 'NEW KPIs',
                value: reveal.kpis.isEmpty
                    ? reveal.kpiName!
                    : '${reveal.kpis.length} ${reveal.kpis.length == 1 ? 'goal' : 'goals'}${reveal.kpiName == null ? '' : ' · ${reveal.kpiName}'}',
                detail: reveal.kpis.isEmpty ? null : reveal.kpis.join(' · '),
              ),
            if (reveal.reportsTo != null) _RevealCard(label: 'REPORTS TO', value: reveal.reportsTo!),
          ],
        ],
      ),
      footer: letter == null || (outcome == 'confirm' && !_revealed)
          ? null
          : OnbFooter(
              children: [OnbPrimaryButton(label: 'Read your letter', busy: _opening, onTap: () => _openLetter(letter))],
            ),
    );
  }
}

class _RevealCard extends StatelessWidget {
  const _RevealCard({super.key, required this.label, required this.value, this.detail});

  final String label;
  final String value;
  final String? detail;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: OnbRise(
      child: OnbCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: OnbText.eyebrow),
            const SizedBox(height: 4),
            Text(value, style: OnbText.h1),
            if (detail != null) ...[const SizedBox(height: 4), Text(detail!, style: OnbText.label)],
          ],
        ),
      ),
    ),
  );
}
