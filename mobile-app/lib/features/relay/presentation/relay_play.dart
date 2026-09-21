import 'package:flutter/material.dart';

import '../data/relay_models.dart';
import 'relay_style.dart';

/// The round in progress (Figma 2606:31851 clue, 2638:36748 lead).
///
/// One screen for both roles, because the header is the same game either way:
/// the difference is that the lead has somewhere to type and nobody else does.
/// A clue is never rendered on the lead's screen — not hidden, not present.
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
  final VoidCallback? onSkip;
  final VoidCallback? onTyping;

  @override
  State<RelayPlay> createState() => _RelayPlayState();
}

class _RelayPlayState extends State<RelayPlay> {
  final _answer = TextEditingController();

  @override
  void dispose() {
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
    return RelayBackdrop(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _header(state),
          const SizedBox(height: 18),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  '+${state.pointsPerCorrect} points for correct answer',
                  textAlign: TextAlign.center,
                  style: RelayStyle.sora(13, color: RelayStyle.onBlue, height: 19.5),
                ),
                const SizedBox(height: 16),
                if (state.isLeader) ..._leadView() else ..._clueView(state),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _header(RelayState state) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 39, vertical: 12),
          child: Column(
            children: [
              Text(
                'Time remaining',
                style: RelayStyle.sora(12, weight: FontWeight.w800, color: RelayStyle.surface),
              ),
              Text(
                '${widget.secondsLeft} s',
                style: RelayStyle.sora(
                  32,
                  weight: FontWeight.w800,
                  color: Colors.white,
                  height: 48,
                ).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        Text(
          state.prompt,
          textAlign: TextAlign.center,
          style: RelayStyle.sora(24, weight: FontWeight.w800, color: Colors.white, height: 32),
        ),
        const SizedBox(height: 8),
        Text(
          'ROUND ${state.round} OF ${state.rounds}',
          textAlign: TextAlign.center,
          style: RelayStyle.sora(11, weight: FontWeight.w700, height: 16.5, spacing: 0.6),
        ),
        const SizedBox(height: 12),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var position = 1; position <= state.questionsPerRound; position += 1) ...[
              if (position > 1) const SizedBox(width: 20),
              _Pip(number: position, current: position == state.questionNumber),
            ],
          ],
        ),
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
                style: RelayStyle.sora(
                  11,
                  weight: FontWeight.w700,
                  color: RelayStyle.brand,
                  height: 16.5,
                  spacing: 1,
                ),
              ),
            ],
          ),
          ...children,
        ],
      ),
    );
  }

  List<Widget> _leadView() {
    final result = widget.lastResult;
    final wrong = result != null && !result.correct && !result.skipped;
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
              style: RelayStyle.sora(15),
              decoration: InputDecoration(
                isCollapsed: true,
                border: InputBorder.none,
                hintText: 'type the answer',
                hintStyle: RelayStyle.sora(15, color: RelayStyle.tertiary),
              ),
            ),
          ),
          // The design's thumbs-down, shown when the last try was not it.
          if (wrong)
            Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 8),
              child: Center(child: RelayStyle.svg('wrong_answer', width: 24, height: 24)),
            ),
        ],
      ),
      const SizedBox(height: 16),
      GestureDetector(
        onTap: widget.onSkip,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RelayStyle.tint,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: RelayStyle.tintBorder, width: 1.129),
          ),
          child: Text(
            'SKIP',
            textAlign: TextAlign.center,
            style: RelayStyle.sora(13, weight: FontWeight.w600, height: 19.5),
          ),
        ),
      ),
      const SizedBox(height: 16),
      Text(
        'If you skip you can’t come back',
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
              RelayInitial(
                name: state.leadName,
                size: 31.987,
                fontSize: 11.2,
                gradient: RelayStyle.avatarPink,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Your team lead is answering',
                      style: RelayStyle.sora(13, weight: FontWeight.w600, height: 19.5),
                    ),
                    Text(
                      state.leadName,
                      style: RelayStyle.sora(12, color: RelayStyle.tertiary, height: 18),
                    ),
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
}

class _Pip extends StatelessWidget {
  const _Pip({required this.number, required this.current});

  final int number;
  final bool current;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 44,
      height: 44,
      child: Stack(
        alignment: Alignment.center,
        children: [
          RelayStyle.svg(current ? 'pip_active' : 'pip_idle', width: 44, height: 44),
          Text(
            '$number',
            style: RelayStyle.sora(
              14,
              weight: FontWeight.w600,
              color: current ? Colors.white : RelayStyle.brand,
              height: 22,
            ),
          ),
        ],
      ),
    );
  }
}
