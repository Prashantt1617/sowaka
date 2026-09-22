import 'dart:async';

import 'package:flutter/material.dart';

import '../data/relay_models.dart';
import 'relay_confetti.dart';
import 'relay_buttons.dart';
import 'relay_style.dart';

/// The round in progress (Figma 2606:31851 clue, 2638:36748 lead, 2682:37522
/// a wrong answer).
///
/// One screen for both roles, because the header is the same game either way:
/// the difference is that the lead has somewhere to type and nobody else does.
/// A clue is never rendered on the lead's screen — not hidden, not present.
///
/// No question closes on its own. The round's clock is the only clock; a team
/// stuck on one moves on with Next Question, and gets a banner and confetti
/// when it lands one.
class RelayPlay extends StatefulWidget {
  const RelayPlay({
    super.key,
    required this.state,
    required this.secondsLeft,
    this.lastResult,
    this.onSubmit,
    this.onSkip,
    this.onTyping,
  });

  final RelayState state;

  /// The round's clock, ticked locally and corrected by every push.
  final int secondsLeft;
  final RelayResult? lastResult;
  final void Function(String answer)? onSubmit;

  /// Moves to the next question for no points. Same as the old skip.
  final VoidCallback? onSkip;
  final VoidCallback? onTyping;

  @override
  State<RelayPlay> createState() => _RelayPlayState();
}

class _RelayPlayState extends State<RelayPlay> {
  final _answer = TextEditingController();

  /// The "incorrect" animation, over the page, for one play-through.
  bool _showWrong = false;
  Timer? _wrongTimer;

  /// One loop of the design's GIF: 67 frames at 30ms.
  static const _wrongFor = Duration(milliseconds: 2100);

  @override
  void initState() {
    super.initState();
    // Opened with a wrong try already on record — show it here too, not only
    // when one arrives as an update.
    final result = widget.lastResult;
    if (result != null && !result.correct && !result.skipped) _flashWrong();
  }

  @override
  void didUpdateWidget(covariant RelayPlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    final result = widget.lastResult;
    if (!identical(result, oldWidget.lastResult) && result != null && !result.correct && !result.skipped) {
      _flashWrong();
    }
    if (widget.state.questionNumber != oldWidget.state.questionNumber) _showWrong = false;
  }

  void _flashWrong() {
    _showWrong = true;
    // A cancellable timer rather than a fire-and-forget delay, so leaving the
    // screen mid-animation does not leave a callback behind.
    _wrongTimer?.cancel();
    _wrongTimer = Timer(_wrongFor, () {
      if (mounted) setState(() => _showWrong = false);
    });
  }

  @override
  void dispose() {
    _wrongTimer?.cancel();
    _answer.dispose();
    super.dispose();
  }

  void _submit() {
    final text = _answer.text.trim();
    if (text.isEmpty) return;
    widget.onSubmit?.call(text);
    _answer.clear();
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final outcome = state.lastOutcome;
    return Stack(
      children: [
        _page(state),
        if (outcome != null)
          Positioned(
            left: 16,
            right: 16,
            bottom: 24,
            child: SafeArea(top: false, child: _correctBanner(outcome)),
          ),
        Positioned.fill(
          child: RelayConfetti(
            trigger: outcome == null ? null : '${state.round}-${state.questionNumber}-${outcome.answer}',
          ),
        ),
        // The design's wrong-answer moment: the page dims and the animation
        // plays once. A tap dismisses it early.
        if (_showWrong)
          Positioned.fill(
            child: GestureDetector(
              onTap: () {
                _wrongTimer?.cancel();
                setState(() => _showWrong = false);
              },
              child: ColoredBox(
                color: const Color(0x73000000),
                child: Align(
                  alignment: const Alignment(0, -0.05),
                  child: Image.asset(
                    '${RelayStyle.asset}/incorrect_answer.gif',
                    width: 339,
                    height: 183,
                    fit: BoxFit.contain,
                    gaplessPlayback: true,
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _page(RelayState state) {
    return RelayBackdrop(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 8),
          _header(state),
          const SizedBox(height: 18 + 12),
          _pips(state),
          const SizedBox(height: 18),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  '+${state.pointsPerCorrect} points for correct answer',
                  textAlign: TextAlign.center,
                  style: RelayStyle.sora(13, color: Colors.white, height: 19.5),
                ),
                const SizedBox(height: 16),
                if (state.isLeader) ..._leadView() else ..._clueView(state),
              ],
            ),
          ),
          // Room for the banner, so it never sits on top of the last button.
          if (state.lastOutcome != null) const SizedBox(height: 72),
        ],
      ),
    );
  }

  Widget _header(RelayState state) {
    return Column(
      children: [
        Text(
          'ROUND ${state.round} OF ${state.rounds}',
          textAlign: TextAlign.center,
          style: RelayStyle.sora(11, weight: FontWeight.w700, color: Colors.white, height: 16.5, spacing: 0.6),
        ),
        const SizedBox(height: 8),
        Text(
          state.prompt,
          textAlign: TextAlign.center,
          style: RelayStyle.sora(32, weight: FontWeight.w800, color: Colors.white, height: 32),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(39, 36, 39, 12),
          child: Column(
            children: [
              Text(
                'Time remaining',
                style: RelayStyle.sora(12, weight: FontWeight.w800, color: RelayStyle.surface),
              ),
              Text(
                '${widget.secondsLeft} s',
                style: RelayStyle.sora(32, weight: FontWeight.w800, color: Colors.white, height: 48)
                    .copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _pips(RelayState state) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var position = 1; position <= state.questionsPerRound; position += 1) ...[
          if (position > 1) const SizedBox(width: 20),
          _Pip(
            number: position,
            look: position <= state.roundOutcomes.length
                ? (state.roundOutcomes[position - 1] == 'correct' ? _PipLook.correct : _PipLook.missed)
                : position == state.questionNumber
                    ? _PipLook.current
                    : _PipLook.upcoming,
          ),
        ],
      ],
    );
  }

  Widget _card({required String label, required List<Widget> children}) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white, width: 1.129),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 7.992,
                height: 7.992,
                decoration: const BoxDecoration(color: RelayStyle.brand, shape: BoxShape.circle),
              ),
              const SizedBox(width: 8),
              Text(
                label,
                style: RelayStyle.sora(11, weight: FontWeight.w700, color: RelayStyle.brand, height: 16.5, spacing: 1),
              ),
            ],
          ),
          ...children,
        ],
      ),
    );
  }

  Widget _bigButton({
    required String label,
    required Color fill,
    required Color ink,
    VoidCallback? onTap,
    bool enabled = true,
  }) {
    return GestureDetector(
      onTap: enabled ? onTap : null,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 150),
        opacity: enabled ? 1 : 0.45,
        child: Container(
          // Full width, as drawn; without it the button shrank to its label.
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: fill,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: RelayStyle.tintBorder, width: 1.129),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: RelayStyle.sora(16, weight: FontWeight.w600, color: ink, height: 16.2, spacing: -0.16),
          ),
        ),
      ),
    );
  }

  List<Widget> _leadView() {
    return [
      _card(
        label: 'YOUR ANSWER',
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 12, bottom: 8),
            child: Text(
              'Each teammate has a part of the puzzle. Listen, then enter what the team lands on.',
              style: RelayStyle.sora(13, color: RelayStyle.tertiary, height: 19.5),
            ),
          ),
          Container(
            height: 51.995,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              color: const Color(0xFFFAFAFA),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFE8E8F0), width: 1.129),
            ),
            alignment: Alignment.centerLeft,
            child: TextField(
              controller: _answer,
              onChanged: (_) => widget.onTyping?.call(),
              onSubmitted: (_) => _submit(),
              textInputAction: TextInputAction.send,
              textCapitalization: TextCapitalization.words,
              autocorrect: false,
              style: RelayStyle.sora(15),
              // Every border and the fill overridden: the app's theme gives text
              // fields a white fill and outlined borders for each state, and
              // turning off only the base one drew a second box inside this.
              decoration: InputDecoration(
                isCollapsed: true,
                filled: false,
                contentPadding: EdgeInsets.zero,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                disabledBorder: InputBorder.none,
                errorBorder: InputBorder.none,
                focusedErrorBorder: InputBorder.none,
                hintText: 'type the answer',
                hintStyle: RelayStyle.sora(15, color: RelayStyle.tertiary),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 12, bottom: 8),
            child: ValueListenableBuilder<TextEditingValue>(
              valueListenable: _answer,
              builder: (context, value, _) => Center(
                child: SizedBox(
                  width: 262,
                  child: RelayCtaButton(
                    label: 'Submit',
                    height: 102,
                    labelPadding: const EdgeInsets.fromLTRB(12, 18, 12, 32),
                    onTap: value.text.trim().isEmpty ? null : _submit,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
      const SizedBox(height: 16),
      _bigButton(
        label: 'NEXT QUESTION',
        fill: RelayStyle.tint,
        ink: RelayStyle.brand,
        onTap: widget.onSkip,
      ),
      const SizedBox(height: 16),
      Text(
        'Stuck? Move on — you can’t come back to it',
        textAlign: TextAlign.center,
        style: RelayStyle.sora(13, color: RelayStyle.onBlue, height: 19.5),
      ),
    ];
  }

  List<Widget> _clueView(RelayState state) {
    return [
      if (state.pieces.isEmpty)
        _card(
          label: 'YOUR CLUE',
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                'Yours is on its way — listen to your team.',
                style: RelayStyle.sora(13, color: RelayStyle.tertiary, height: 19.5),
              ),
            ),
          ],
        )
      else
        for (var i = 0; i < state.pieces.length; i += 1) ...[
          if (i > 0) const SizedBox(height: 16),
          _pieceCard(state.pieces[i]),
        ],
      if (state.leadIsAnswering) ...[
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RelayStyle.tint,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: RelayStyle.tintBorder, width: 1.129),
          ),
          child: Row(
            children: [
              RelayInitial(name: state.leadName, size: 31.987, fontSize: 11.2, gradient: RelayStyle.avatarPink),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Your team lead is answering', style: RelayStyle.sora(13, weight: FontWeight.w600, height: 19.5)),
                    Text(state.leadName, style: RelayStyle.sora(12, color: RelayStyle.tertiary, height: 18)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    ];
  }

  Widget _pieceCard(RelayPiece piece) {
    // A movie clue is a sentence and reads as a quote; a letter or a sum step
    // keeps its own label, because which step it is matters to the answer.
    final isClue = piece.label.toLowerCase().startsWith('clue');
    final sentence = piece.text.trim().contains(' ');
    return _card(
      label: isClue ? 'YOUR CLUE' : piece.label.toUpperCase(),
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Text(
            sentence ? '"${piece.text}"' : piece.text,
            style: RelayStyle.sora(18, weight: FontWeight.w600, height: 28),
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Text(
            isClue ? 'Every teammate has a part of the plot' : 'Every teammate has a part of the puzzle',
            style: RelayStyle.sora(13, color: RelayStyle.tertiary, height: 19.5),
          ),
        ),
      ],
    );
  }

  Widget _correctBanner(RelayOutcome outcome) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: RelayStyle.green,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 12, offset: Offset(0, 4))],
      ),
      child: Row(
        children: [
          const Icon(Icons.check_circle, color: Colors.white, size: 24),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Correct! +${outcome.points} points',
                  style: RelayStyle.sora(14, weight: FontWeight.w700, color: Colors.white, height: 19.5),
                ),
                if (outcome.answer.isNotEmpty)
                  Text(
                    outcome.answer,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: RelayStyle.sora(13, color: Colors.white, height: 18),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

enum _PipLook { correct, missed, current, upcoming }

/// A question's dot: green when got right, grey when skipped or run out,
/// blue for the one being played, white for those still to come.
class _Pip extends StatelessWidget {
  const _Pip({required this.number, required this.look});

  final int number;
  final _PipLook look;

  @override
  Widget build(BuildContext context) {
    final (asset, ink) = switch (look) {
      _PipLook.correct => ('pip_correct', Colors.white),
      _PipLook.missed => ('pip_skipped', RelayStyle.tertiary),
      _PipLook.current => ('pip_active', Colors.white),
      _PipLook.upcoming => ('pip_idle', RelayStyle.brand),
    };
    return SizedBox(
      width: 44,
      height: 44,
      child: Stack(
        alignment: Alignment.center,
        children: [
          RelayStyle.svg(asset, width: 44, height: 44),
          Text('$number', style: RelayStyle.sora(14, weight: FontWeight.w600, color: ink, height: 22)),
        ],
      ),
    );
  }
}
