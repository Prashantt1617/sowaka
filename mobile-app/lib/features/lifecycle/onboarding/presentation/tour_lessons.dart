import 'dart:async';

import 'package:flutter/material.dart';

import '../data/onboarding_api.dart';
import 'onboarding_kit.dart';

/// The Sowaka tour's lessons (new-joiner artifact, "Sowaka tour · a lesson
/// (spotlight)"): each is a small drawing of the screen it teaches, a step
/// card under it, and one block of the drawing lit per step. One a day, in
/// [joinerTourLessons] order; managers also get [managerTourLessons]. The
/// server keeps which are done (`tour.done`) and the same keys.
class TourLesson {
  const TourLesson({required this.key, required this.title, required this.length, required this.screen, required this.blocks, required this.steps});

  final String key;
  final String title;

  /// "1 min".
  final String length;

  /// The drawn screen's name: "ATTENDANCE".
  final String screen;
  final List<TourBlock> blocks;
  final List<TourStep> steps;
}

class TourStep {
  const TourStep(this.lit, this.title, this.text);

  /// Which block is lit.
  final int lit;
  final String title;
  final String text;
}

sealed class TourBlock {
  const TourBlock();
}

final class TourCard extends TourBlock {
  const TourCard(this.title, this.meta, this.icon);
  final String title;
  final String meta;
  final IconData icon;
}

final class TourSlider extends TourBlock {
  const TourSlider(this.label);
  final String label;
}

final class TourRow extends TourBlock {
  const TourRow(this.title, this.meta, this.pill, this.pillBg, this.pillFg);
  final String title;
  final String meta;
  final String pill;
  final Color pillBg;
  final Color pillFg;
}

final class TourChips extends TourBlock {
  const TourChips(this.chips);
  final List<(String, String)> chips;
}

final class TourField extends TourBlock {
  const TourField(this.label, this.value);
  final String label;
  final String value;
}

final class TourButton extends TourBlock {
  const TourButton(this.label);
  final String label;
}

/// The joiner's lessons, one a day from Day 1.
const joinerTourLessons = <TourLesson>[
  TourLesson(
    key: 'punch',
    title: 'Punch in and out',
    length: '1 min',
    screen: 'ACTIONS',
    blocks: [
      TourCard('Attendance', 'Today', Icons.calendar_today_outlined),
      TourSlider('Slide to Punch In'),
      TourRow('Punched in', '9:31 AM', 'Done', Color(0xFFEAF9EE), Color(0xFF1F9D45)),
    ],
    steps: [
      TourStep(0, 'Find Attendance', 'It’s at the top of Actions.'),
      TourStep(1, 'Slide to punch in', 'Your face is checked as you slide.'),
      TourStep(2, 'Punch out the same way', 'Slide again when you leave for the day.'),
    ],
  ),
  TourLesson(
    key: 'missed',
    title: 'Fix a missed punch',
    length: '1 min',
    screen: 'ATTENDANCE',
    blocks: [
      TourCard('Attendance', 'This month', Icons.calendar_today_outlined),
      TourRow('Yesterday', 'In 9:30 · Out —', 'Missed', Color(0xFFFDECEC), Color(0xFFB23500)),
      TourButton('Request a correction'),
      TourRow('Sent to your manager', 'Waiting for approval', 'Pending', Color(0xFFFFF4E5), Color(0xFFB45309)),
    ],
    steps: [
      TourStep(1, 'Spot the missed punch', 'Days with a missing punch are marked Missed.'),
      TourStep(2, 'Ask for a correction', 'Add the right time and a short reason.'),
      TourStep(3, 'Your manager approves it', 'You’ll get a notification when it’s fixed.'),
    ],
  ),
  TourLesson(
    key: 'leave',
    title: 'Leave policy and applying for leave',
    length: '2 min',
    screen: 'LEAVE',
    blocks: [
      TourChips([('6', 'Casual'), ('4', 'Sick'), ('12', 'Earned')]),
      TourField('Dates', 'Pick a day or a range'),
      TourField('Type', 'Casual leave'),
      TourButton('Send for approval'),
    ],
    steps: [
      TourStep(0, 'Check your balance', 'Your leave policy decides how many days you get.'),
      TourStep(1, 'Pick your dates', 'Then choose the type of leave.'),
      TourStep(3, 'Send it for approval', 'Your manager gets it straight away.'),
    ],
  ),
  TourLesson(
    key: 'overtime',
    title: 'Applying for overtime',
    length: '1 min',
    screen: 'OVERTIME',
    blocks: [
      TourCard('Overtime', 'Request and view hours', Icons.schedule_outlined),
      TourField('Date', 'The day you worked'),
      TourField('Extra hours', '2 h'),
      TourButton('Send for approval'),
    ],
    steps: [
      TourStep(0, 'Open Overtime', 'You’ll find it in Actions.'),
      TourStep(2, 'Add the hours you worked', 'Pick the day and the extra time.'),
      TourStep(3, 'Send for approval', 'Your manager approves it.'),
    ],
  ),
];

/// "For managers", under the joiner's own.
const managerTourLessons = <TourLesson>[
  TourLesson(
    key: 'approveLeave',
    title: 'Approving leave',
    length: '1 min',
    screen: 'TEAMS',
    blocks: [
      TourCard('Requests', 'From your team', Icons.group_outlined),
      TourRow('A teammate', '2 days · Casual', 'New', Color(0xFFE8F4FA), Color(0xFF0571A6)),
      TourButton('Approve'),
    ],
    steps: [
      TourStep(0, 'Open Requests', 'It’s in the Teams tab.'),
      TourStep(1, 'Check the dates', 'You’ll see their balance too.'),
      TourStep(2, 'Approve or decline', 'They’re told right away.'),
    ],
  ),
  TourLesson(
    key: 'approveOvertime',
    title: 'Approving overtime',
    length: '1 min',
    screen: 'TEAMS',
    blocks: [
      TourCard('Requests', 'From your team', Icons.group_outlined),
      TourRow('A teammate', '2 h overtime', 'New', Color(0xFFE8F4FA), Color(0xFF0571A6)),
      TourButton('Approve'),
    ],
    steps: [
      TourStep(0, 'Open Requests', 'It’s in the Teams tab.'),
      TourStep(1, 'Check the hours', 'Compare with their punches.'),
      TourStep(2, 'Approve or decline', 'Approved hours go to payroll.'),
    ],
  ),
];

/// Today's lesson: the first not done, or null when all are.
TourLesson? todaysTourLesson(List<String> done) {
  for (final lesson in joinerTourLessons) {
    if (!done.contains(lesson.key)) return lesson;
  }
  return null;
}

/// Tells the server [lesson] is done; the lessons done after it, or null
/// when it could not be told (the screen keeps its own tick either way).
Future<List<String>?> reportTourLessonDone(OnboardingShell shell, String lesson) async {
  final api = shell.api;
  if (api is! HttpOnboardingApi) return null;
  try {
    return await api.markTourLessonDone(lesson);
  } catch (_) {
    return null;
  }
}

/// A lesson, full screen on the dark ground: close, the eyebrow and title,
/// the step bars, the drawn screen with one block lit, the step card with
/// Back and Next / Done; then "You’ve got it" with Back to the tour and
/// Replay.
class TourLessonScreen extends StatefulWidget {
  const TourLessonScreen({super.key, required this.lesson, this.onDone});

  final TourLesson lesson;

  /// Called once, when the last step's Done is pressed.
  final Future<void> Function(String key)? onDone;

  @override
  State<TourLessonScreen> createState() => _TourLessonScreenState();
}

class _TourLessonScreenState extends State<TourLessonScreen> {
  int _at = 0;
  bool _finished = false;

  static const _ground = Color(0xFF16181D);

  TourLesson get _l => widget.lesson;

  void _next() {
    if (_at == _l.steps.length - 1) {
      setState(() => _finished = true);
      unawaited(widget.onDone?.call(_l.key));
    } else {
      setState(() => _at++);
    }
  }

  @override
  Widget build(BuildContext context) {
    final n = _l.steps.length;
    final step = _l.steps[_at.clamp(0, n - 1)];
    final reduce = MediaQuery.disableAnimationsOf(context);
    return Scaffold(
      backgroundColor: _ground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: Row(
                children: [
                  Semantics(
                    button: true,
                    label: 'Close the lesson',
                    child: InkResponse(
                      key: const ValueKey('lesson-close'),
                      onTap: () => Navigator.of(context).maybePop(),
                      radius: 24,
                      child: Container(
                        width: 40,
                        height: 40,
                        decoration: const BoxDecoration(color: Color(0x1FFFFFFF), shape: BoxShape.circle),
                        child: const Icon(Icons.close_rounded, size: 18, color: Colors.white),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('SOWAKA TOUR', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.1, color: Color(0xFFBEEDFF))),
                        const SizedBox(height: 2),
                        Text(_l.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Semantics(
              label: _finished ? 'Done' : 'Step ${_at + 1} of $n',
              child: ExcludeSemantics(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                  child: Row(
                    children: [
                      for (var i = 0; i < n; i++) ...[
                        if (i > 0) const SizedBox(width: 4),
                        Expanded(
                          child: Container(
                            height: 4,
                            decoration: BoxDecoration(
                              color: _finished || i <= _at ? Colors.white : const Color(0x40FFFFFF),
                              borderRadius: BorderRadius.circular(4),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
            if (!_finished) ...[
              Expanded(
                child: Container(
                  margin: const EdgeInsets.symmetric(horizontal: 16),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: OnbColors.screen, borderRadius: BorderRadius.circular(28)),
                  clipBehavior: Clip.antiAlias,
                  child: ExcludeSemantics(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(_l.screen, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1, color: OnbColors.icon)),
                        for (final (i, block) in _l.blocks.indexed) ...[
                          const SizedBox(height: 12),
                          AnimatedOpacity(
                            duration: reduce ? Duration.zero : const Duration(milliseconds: 250),
                            opacity: i == step.lit ? 1 : 0.25,
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(20),
                                boxShadow: i == step.lit
                                    ? const [
                                        BoxShadow(color: OnbColors.primary, spreadRadius: 3),
                                        BoxShadow(color: Color(0x730571A6), blurRadius: 28, offset: Offset(0, 12), spreadRadius: -8),
                                      ]
                                    : null,
                              ),
                              child: _block(block),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
              Container(
                key: const ValueKey('lesson-step'),
                margin: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Step ${_at + 1} of $n', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.9, color: OnbColors.primary)),
                    const SizedBox(height: 4),
                    Text(step.title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.2, color: OnbColors.text)),
                    const SizedBox(height: 4),
                    Text(step.text, style: const TextStyle(fontSize: 13, color: OnbColors.text2)),
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        if (_at > 0) ...[
                          SizedBox(
                            height: 48,
                            child: OutlinedButton(
                              key: const ValueKey('lesson-back'),
                              onPressed: () => setState(() => _at--),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: OnbColors.text,
                                side: const BorderSide(color: OnbColors.lineDark),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                                padding: const EdgeInsets.symmetric(horizontal: 18),
                                textStyle: OnbText.button(context),
                              ),
                              child: const Text('Back'),
                            ),
                          ),
                          const SizedBox(width: 8),
                        ],
                        Expanded(
                          child: SizedBox(
                            height: 48,
                            child: FilledButton(
                              key: const ValueKey('lesson-next'),
                              onPressed: _next,
                              style: FilledButton.styleFrom(
                                backgroundColor: OnbColors.primary,
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                                textStyle: OnbText.button(context),
                              ),
                              child: Text(_at == n - 1 ? 'Done' : 'Next'),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ] else
              Expanded(
                child: Container(
                  key: const ValueKey('lesson-finished'),
                  margin: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
                  decoration: BoxDecoration(color: const Color(0xFFEAF9EE), borderRadius: BorderRadius.circular(28)),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        width: 96,
                        height: 96,
                        decoration: const BoxDecoration(color: Color(0xFF30D158), shape: BoxShape.circle),
                        child: const Icon(Icons.check_rounded, size: 48, color: Colors.white),
                      ),
                      const SizedBox(height: 12),
                      const Text('You’ve got it', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: -0.5, color: OnbColors.text)),
                      const SizedBox(height: 12),
                      Text(_l.title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, color: OnbColors.text2)),
                      const SizedBox(height: 24),
                      SizedBox(
                        width: double.infinity,
                        height: 52,
                        child: FilledButton(
                          key: const ValueKey('lesson-to-tour'),
                          onPressed: () => Navigator.of(context).maybePop(),
                          style: FilledButton.styleFrom(
                            backgroundColor: OnbColors.primary,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                            textStyle: OnbText.button(context),
                          ),
                          child: const Text('Back to the tour'),
                        ),
                      ),
                      const SizedBox(height: 8),
                      SizedBox(
                        width: double.infinity,
                        height: 48,
                        child: OutlinedButton.icon(
                          key: const ValueKey('lesson-replay'),
                          onPressed: () => setState(() { _at = 0; _finished = false; }),
                          icon: const Icon(Icons.replay_rounded, size: 18),
                          label: const Text('Replay'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: const Color(0xFF1F9D45),
                            backgroundColor: Colors.white,
                            side: const BorderSide(color: Color(0xFFCFE3D6)),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                            textStyle: OnbText.button(context),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _block(TourBlock block) => switch (block) {
    TourCard(:final title, :final meta, :final icon) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: OnbColors.screen, shape: BoxShape.circle, border: Border.all(color: OnbColors.line)),
            child: Icon(icon, size: 20, color: OnbColors.text),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text)),
                Text(meta, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
              ],
            ),
          ),
        ],
      ),
    ),
    TourSlider(:final label) => Container(
      height: 52,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: const Color(0xFF0A84FF), borderRadius: BorderRadius.circular(999)),
      child: Stack(
        alignment: Alignment.center,
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Container(width: 44, height: 44, decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle)),
          ),
          Text(label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Colors.white)),
        ],
      ),
    ),
    TourRow(:final title, :final meta, :final pill, :final pillBg, :final pillFg) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text)),
                Text(meta, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
              ],
            ),
          ),
          Container(
            height: 24,
            padding: const EdgeInsets.symmetric(horizontal: 9),
            alignment: Alignment.center,
            decoration: BoxDecoration(color: pillBg, borderRadius: BorderRadius.circular(999)),
            child: Text(pill, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: pillFg)),
          ),
        ],
      ),
    ),
    TourChips(:final chips) => Row(
      children: [
        for (final (i, (n, t)) in chips.indexed) ...[
          if (i > 0) const SizedBox(width: 8),
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(n, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: OnbColors.primary)),
                  Text(t, style: const TextStyle(fontSize: 11, color: OnbColors.text3)),
                ],
              ),
            ),
          ),
        ],
      ],
    ),
    TourField(:final label, :final value) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, color: OnbColors.text3)),
          Text(value, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: OnbColors.text)),
        ],
      ),
    ),
    TourButton(:final label) => Container(
      height: 52,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: OnbColors.primary, borderRadius: BorderRadius.circular(14)),
      child: Text(label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Colors.white)),
    ),
  };
}
