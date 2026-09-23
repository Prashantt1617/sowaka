import 'package:flutter/material.dart';

import 'relay_style.dart';

/// Where a round's example card is shown. The card is one design (Figma
/// 2722:39855) that each place frames a little differently.
enum RelayDemoPlace {
  /// The How to Play carousel: "Round N" and "Example", clues stacked.
  rules,

  /// The leaderboard's look ahead (2717:39052 / 2777:43446): "Next Round-N",
  /// clues in two columns, "Team lead answers".
  nextRound,

  /// The ⓘ sheet over a question (2777:43597): "Round N" with a close cross.
  info,
}

/// One kind of round, explained by an example rather than a rule.
///
/// Odd One Out and Calculation are the design's own examples; the others are
/// taken from the event's question bank, one item each.
class RelayRoundExample {
  const RelayRoundExample({
    required this.title,
    required this.line,
    required this.clues,
    required this.answer,
    this.boardLine,
    this.sentences = false,
    this.tileTints,
  });

  final String title;
  final String line;

  /// The leaderboard's wording, where the design gives it one.
  final String? boardLine;
  final List<String> clues;
  final String answer;

  /// Clues that are whole sentences wrap at a smaller size rather than
  /// running off a tile drawn for a single word.
  final bool sentences;

  /// The design gives Calculation its own run of tints.
  final List<(Color, Color)>? tileTints;

  static const _fallback = RelayRoundExample(
    title: 'Mystery Round',
    line: 'Put the clues together as a team',
    clues: [],
    answer: '',
  );

  static RelayRoundExample of(String kind) => _examples[kind] ?? _fallback;
}

const _blue = (Color(0xFFE4F6FC), Color(0xFF35A8D7));
const _violet = (Color(0xFFF2EAF9), Color(0xFF9D70C9));
const _amber = (Color(0xFFFFF4D8), Color(0xFFD59C26));
const _pink = (Color(0xFFFCEAF3), Color(0xFFD96DA7));

const _examples = <String, RelayRoundExample>{
  'odd': RelayRoundExample(
    title: 'Odd One Out',
    line: 'Find the clue that doesn’t belong',
    clues: ['Apple', 'Banana', 'Carrot', 'Mango'],
    answer: 'Carrot - The only vegetable',
  ),
  'number': RelayRoundExample(
    title: 'Calculation',
    line: 'Put together each clue to find answer',
    boardLine: 'Every clue is a number, team calculates the answer',
    clues: ['+12', '+8', '-5', '-3'],
    answer: '12',
    tileTints: [_blue, _violet, _amber, _amber],
  ),
  'word': RelayRoundExample(
    title: 'Unscramble',
    line: 'Every clue is a letter, team finds the word',
    clues: ['K', 'O', 'C', 'L', 'C'],
    answer: 'CLOCK',
  ),
  'movie': RelayRoundExample(
    title: 'Plot Picks',
    line: 'Every teammate has a part of the plot',
    sentences: true,
    clues: [
      'A luxury journey becomes a fight for survival.',
      'A blue diamond connects the past to the present.',
      'An iceberg changes everything.',
      'Jack and Rose find love aboard a ship.',
    ],
    answer: 'Titanic',
  ),
  'person': RelayRoundExample(
    title: 'Guess Who',
    line: 'Hints go from vague to obvious',
    sentences: true,
    clues: [
      'Runs like the ground insulted him.',
      'Hairstyle gets discussed often.',
      'Made one throw look easy.',
      'Obsessed with gold.',
      '88.06',
    ],
    answer: 'Neeraj Chopra',
  ),
};

/// A round's example: its name, what to do, the clues as teammates would hold
/// them, and the answer the lead would type.
class RelayRoundDemo extends StatelessWidget {
  const RelayRoundDemo({
    super.key,
    required this.round,
    required this.kind,
    this.place = RelayDemoPlace.rules,
    this.width,
    this.onClose,
    this.fill = false,
  });

  /// 1-based, for the heading and the card's tint.
  final int round;
  final String kind;
  final RelayDemoPlace place;
  final double? width;
  final VoidCallback? onClose;

  /// Stretch to the height it is given, the answer kept at the bottom — so a
  /// row of cards with different examples all come out the same size.
  final bool fill;

  /// Each round's card has its own tint, in playing order.
  static const _tints = [
    Color(0xFFF9E0CB),
    Color(0xFFD7F9CB),
    Color(0xFFCBF9E9),
    Color(0xFFCBCBF9),
    Color(0xFFF9CBE9),
  ];

  static Color tintFor(int round) => _tints[(round - 1).clamp(0, 999) % _tints.length];

  static TextStyle get _tag =>
      RelayStyle.sora(11, weight: FontWeight.w700, color: RelayStyle.brand, height: 16.5, spacing: 1);

  @override
  Widget build(BuildContext context) {
    final example = RelayRoundExample.of(kind);
    return Container(
      width: width,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: tintFor(round),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white, width: 1.129),
      ),
      child: Column(
        mainAxisSize: fill ? MainAxisSize.max : MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _heading(),
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    example.title,
                    style: RelayStyle.sora(18, weight: FontWeight.w600, height: 28),
                  ),
                ),
                if (place != RelayDemoPlace.nextRound) Text('EXAMPLE', style: _tag),
              ],
            ),
          ),
          Text(
            place == RelayDemoPlace.nextRound ? example.boardLine ?? example.line : example.line,
            style: RelayStyle.sora(14, color: const Color(0xFF647E8B), spacing: -0.16),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: place == RelayDemoPlace.nextRound ? _grid(example) : _stack(example),
          ),
          if (fill) const Spacer(),
          _answer(example),
        ],
      ),
    );
  }

  Widget _heading() {
    final label = place == RelayDemoPlace.nextRound ? 'NEXT ROUND-$round' : 'ROUND $round';
    return Row(
      children: [
        Container(
          width: 7.992,
          height: 7.992,
          decoration: const BoxDecoration(color: RelayStyle.brand, shape: BoxShape.circle),
        ),
        const SizedBox(width: 8),
        Expanded(child: Text(label, style: _tag)),
        if (place == RelayDemoPlace.nextRound) Text('EXAMPLE', style: _tag),
        if (place == RelayDemoPlace.info)
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: onClose,
            child: RelayStyle.svg('cross_brand', width: 16, height: 16),
          ),
      ],
    );
  }

  (Color, Color) _tintOf(RelayRoundExample example, int index) {
    final tints = example.tileTints ?? const [_blue, _violet, _amber, _pink];
    return tints[index % tints.length];
  }

  Widget _tile(RelayRoundExample example, int index) {
    final (fill, ink) = _tintOf(example, index);
    return Container(
      width: double.infinity,
      padding: example.sentences
          ? const EdgeInsets.fromLTRB(12, 8, 12, 6)
          : const EdgeInsets.only(top: 8, bottom: 6),
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white),
      ),
      child: Text(
        example.clues[index],
        textAlign: TextAlign.center,
        style: example.sentences
            ? RelayStyle.sora(14, weight: FontWeight.w600, color: ink, height: 20)
            : RelayStyle.sora(22, weight: FontWeight.w700, color: ink),
      ),
    );
  }

  Widget _stack(RelayRoundExample example) {
    return Column(
      children: [
        for (var i = 0; i < example.clues.length; i += 1) ...[
          if (i > 0) const SizedBox(height: 8),
          _tile(example, i),
        ],
      ],
    );
  }

  /// Two to a row, as the leaderboard draws them.
  Widget _grid(RelayRoundExample example) {
    final rows = <Widget>[];
    for (var i = 0; i < example.clues.length; i += 2) {
      if (i > 0) rows.add(const SizedBox(height: 8));
      rows.add(
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: _tile(example, i)),
            const SizedBox(width: 8),
            Expanded(child: i + 1 < example.clues.length ? _tile(example, i + 1) : const SizedBox.shrink()),
          ],
        ),
      );
    }
    return Column(children: rows);
  }

  Widget _answer(RelayRoundExample example) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Stack(
        children: [
          const Positioned.fill(child: ColoredBox(color: Color(0xFFAB9714))),
          Positioned.fill(
            child: Opacity(
              opacity: 0.88,
              child: Image.asset('${RelayStyle.asset}/answer_card.jpg', fit: BoxFit.cover),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 8, 18, 6),
            child: SizedBox(
              width: double.infinity,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    place == RelayDemoPlace.nextRound ? 'TEAM LEAD ANSWERS' : 'THE ANSWER',
                    style: RelayStyle.sora(11, weight: FontWeight.w700, height: 16.5, spacing: 1),
                  ),
                  // One line, as drawn; a long answer shrinks rather than wraps.
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text(
                      example.answer,
                      maxLines: 1,
                      softWrap: false,
                      style: RelayStyle.sora(18, weight: FontWeight.w600, height: 28),
                    ),
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
