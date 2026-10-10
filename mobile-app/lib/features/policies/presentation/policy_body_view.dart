import 'package:flutter/material.dart';

import '../data/policies_models.dart';

/// A policy's text as the Policies page shows it: each paragraph a white
/// card, as the built-in policies have always been drawn, with headings
/// between them and bullets inside. See [parsePolicyBody] for the format.
class PolicyBodyView extends StatelessWidget {
  PolicyBodyView({super.key, required String body})
    : blocks = parsePolicyBody(body);

  final List<PolicyBlock> blocks;

  static const _text = TextStyle(
    color: Color(0xFF2A2A2A),
    fontSize: 14.5,
    height: 1.6,
  );

  static const _heading = TextStyle(
    color: Color(0xFF2A2420),
    fontSize: 16,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.2,
  );

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var index = 0; index < blocks.length; index++)
          switch (blocks[index]) {
            PolicyHeading(:final text) => Padding(
              padding: EdgeInsets.only(top: index == 0 ? 0 : 8, bottom: 10),
              child: Semantics(
                header: true,
                child: Text(text, style: _heading),
              ),
            ),
            PolicyCard(:final lines) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _PolicyCardView(lines: lines),
            ),
          },
      ],
    );
  }
}

class _PolicyCardView extends StatelessWidget {
  const _PolicyCardView({required this.lines});

  final List<PolicyLine> lines;

  /// Runs of plain lines kept together, so their breaks read as one
  /// paragraph; each bullet its own row.
  List<Widget> _rows() {
    final rows = <Widget>[];
    final plain = <String>[];
    void flush() {
      if (plain.isEmpty) return;
      final text = Text(plain.join('\n'), style: PolicyBodyView._text);
      rows.add(
        rows.isEmpty
            ? text
            : Padding(padding: const EdgeInsets.only(top: 4), child: text),
      );
      plain.clear();
    }

    for (final line in lines) {
      if (!line.bullet) {
        plain.add(line.text);
        continue;
      }
      flush();
      rows.add(
        Padding(
          padding: EdgeInsets.only(top: rows.isEmpty ? 0 : 4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(
                width: 18,
                child: Text('•', style: PolicyBodyView._text),
              ),
              Expanded(child: Text(line.text, style: PolicyBodyView._text)),
            ],
          ),
        ),
      );
    }
    flush();
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .04),
            blurRadius: 2,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: _rows(),
      ),
    );
  }
}
