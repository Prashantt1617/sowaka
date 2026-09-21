import 'package:flutter/material.dart';

import '../data/relay_models.dart';

/// The round in progress.
///
/// One screen for both roles, because the header is the same game either way:
/// the difference is that the lead has somewhere to type and nobody else does.
/// A clue is never rendered on the lead's screen — not hidden, not present.
class RelayPlay extends StatefulWidget {
  const RelayPlay({
    super.key,
    required this.state,
    required this.secondsLeft,
    required this.pointsPerCorrect,
    this.lastResult,
    this.onSubmit,
    this.onSkip,
    this.onTyping,
  });

  final RelayState state;

  /// The round's clock, ticked locally and corrected by every push.
  final int secondsLeft;
  final int pointsPerCorrect;
  final RelayResult? lastResult;
  final void Function(String answer)? onSubmit;
  final VoidCallback? onSkip;
  final VoidCallback? onTyping;

  @override
  State<RelayPlay> createState() => _RelayPlayState();
}

class _RelayPlayState extends State<RelayPlay> {
  final _answer = TextEditingController();

  static const _sky = Color(0xFF4FA3D1);
  static const _skyDeep = Color(0xFF3B8FC4);
  static const _accent = Color(0xFF0571A6);
  static const _ink = Color(0xFF222222);
  static const _muted = Color(0xFF6B7280);

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
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [_sky, _skyDeep],
        ),
      ),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 26, 16, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Center(
                child: Text(
                  'Time remaining',
                  style: TextStyle(
                    fontFamily: 'Sora',
                    color: Colors.white,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: 2),
              Center(
                child: Text(
                  '${widget.secondsLeft} s',
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: Colors.white,
                    fontSize: 34,
                    fontWeight: FontWeight.w700,
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                ),
              ),
              const SizedBox(height: 22),
              Center(
                child: Text(
                  state.prompt,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: Colors.white,
                    fontSize: 23,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(height: 6),
              Center(
                child: Text(
                  'ROUND ${state.round} OF ${state.rounds}',
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: Colors.white,
                    fontSize: 12,
                    letterSpacing: 0.9,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(height: 14),
              _pips(state),
              const SizedBox(height: 14),
              Center(
                child: Text(
                  '+${widget.pointsPerCorrect} points for correct answer',
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: Color(0xFFDCEEF8),
                    fontSize: 12.5,
                  ),
                ),
              ),
              const SizedBox(height: 18),
              if (state.isLeader) ..._leadView(state) else ..._clueView(state),
            ],
          ),
        ),
      ),
    );
  }

  Widget _pips(RelayState state) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var position = 1; position <= state.questionsPerRound; position += 1)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: position == state.questionNumber ? _accent : Colors.white,
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: Text(
                '$position',
                style: TextStyle(
                  fontFamily: 'Sora',
                  color: position == state.questionNumber ? Colors.white : _ink,
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _card({required String label, required List<Widget> children}) {
    return Container(
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 7,
                height: 7,
                decoration: const BoxDecoration(color: _accent, shape: BoxShape.circle),
              ),
              const SizedBox(width: 7),
              Text(
                label,
                style: const TextStyle(
                  fontFamily: 'Sora',
                  color: _accent,
                  fontSize: 12,
                  letterSpacing: 0.9,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ...children,
        ],
      ),
    );
  }

  List<Widget> _leadView(RelayState state) {
    final wrong = widget.lastResult != null &&
        !widget.lastResult!.correct &&
        !widget.lastResult!.skipped;
    return [
      _card(
        label: 'YOUR ANSWER',
        children: [
          const Text(
            'Each teammate has a part of the puzzle. Listen, then enter what the team lands on.',
            style: TextStyle(fontFamily: 'Sora', color: _muted, fontSize: 13.5, height: 1.45),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _answer,
            onChanged: (_) => widget.onTyping?.call(),
            onSubmitted: (_) => _submit(),
            textInputAction: TextInputAction.done,
            style: const TextStyle(fontFamily: 'Sora', fontSize: 15, color: _ink),
            decoration: InputDecoration(
              hintText: 'type the answer',
              hintStyle: const TextStyle(fontFamily: 'Sora', color: Color(0xFF9CA3AF), fontSize: 15),
              filled: true,
              fillColor: const Color(0xFFF6F8FA),
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: Color(0xFFE5E9ED)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: Color(0xFFE5E9ED)),
              ),
              suffixIcon: IconButton(
                onPressed: _submit,
                icon: const Icon(Icons.arrow_forward, color: _accent),
              ),
            ),
          ),
          if (wrong) ...[
            const SizedBox(height: 8),
            const Text(
              'Not it — try again.',
              style: TextStyle(fontFamily: 'Sora', color: Color(0xFFC2402F), fontSize: 13),
            ),
          ],
        ],
      ),
      const SizedBox(height: 14),
      FilledButton(
        onPressed: widget.onSkip,
        style: FilledButton.styleFrom(
          backgroundColor: const Color(0xFFD5EAF6),
          foregroundColor: _ink,
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
        child: const Text(
          'SKIP',
          style: TextStyle(
            fontFamily: 'Sora',
            fontSize: 14.5,
            letterSpacing: 0.8,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      const SizedBox(height: 8),
      const Text(
        "If you skip you can't come back",
        style: TextStyle(fontFamily: 'Sora', color: Color(0xFFDCEEF8), fontSize: 12.5),
      ),
    ];
  }

  List<Widget> _clueView(RelayState state) {
    return [
      if (state.pieces.isEmpty)
        _card(
          label: 'WAITING',
          children: const [
            Text(
              'Nothing on your screen for this one yet — listen to your team.',
              style: TextStyle(fontFamily: 'Sora', color: _muted, fontSize: 13.5, height: 1.45),
            ),
          ],
        )
      else
        for (final piece in state.pieces) ...[
          _card(
            label: piece.label.toUpperCase(),
            children: [
              Text(
                piece.text,
                style: const TextStyle(
                  fontFamily: 'Sora',
                  color: _ink,
                  fontSize: 17,
                  height: 1.4,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Every teammate has a part of the puzzle',
                style: TextStyle(fontFamily: 'Sora', color: _muted, fontSize: 12.5),
              ),
            ],
          ),
          const SizedBox(height: 12),
        ],
      if (state.leadIsAnswering)
        Container(
          decoration: BoxDecoration(
            color: const Color(0xFFD9ECF7),
            borderRadius: BorderRadius.circular(14),
          ),
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              CircleAvatar(
                radius: 15,
                backgroundColor: const Color(0xFFE85D9E),
                child: Text(
                  state.leadName.isEmpty ? '?' : state.leadName.characters.first.toUpperCase(),
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Your team lead is answering',
                    style: TextStyle(
                      fontFamily: 'Sora',
                      color: _ink,
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    state.leadName,
                    style: const TextStyle(fontFamily: 'Sora', color: _muted, fontSize: 12.5),
                  ),
                ],
              ),
            ],
          ),
        ),
    ];
  }
}
