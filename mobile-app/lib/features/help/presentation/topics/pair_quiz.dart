import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import '../../../../services/api_config.dart';
import '../../../care/data/care_api_service.dart';
import '../../../care/presentation/care_theme.dart';
import '../../../shared/app_toast.dart';

/// The quizzes for two on Time for two of you: love languages and attachment
/// styles. Each person answers on their own phone, then both results show
/// side by side. The employee answers in the app; their partner on a private
/// link, with no account. Only the two of them see the results; never the
/// company.

const _languages = ['W', 'Q', 'A', 'T', 'G'];

class _Rose {
  static const ink = Color(0xFF8E3B55);
  static const soft = Color(0xFFEFB2C0);
  static const noteHi = Color(0xFFFFFAF8);
  static const noteLo = Color(0xFFFCEDEE);
  static const line = Color(0xFFF0D3D7);
  static const wa = Color(0xFF25D366);
  static const waInk = Color(0xFF0B3D20);
}

Color _colour(String k) => switch (k) {
  'W' => const Color(0xFFE0763E),
  'Q' => const Color(0xFF3B82F6),
  'A' => const Color(0xFF22A06B),
  'T' => const Color(0xFFD9487B),
  _ => const Color(0xFF8B5CF6),
};

/// The quiz's words, from the catalogue, with the original standing in.
class LoveQuiz {
  LoveQuiz(Map<String, dynamic>? raw)
    : questions = _pairs(raw?['questions']),
      names = _map(raw?['names'], _defaultNames),
      means = _map(raw?['means'], _defaultMeans),
      how = _map(raw?['how'], _defaultHow);

  /// Twenty pairs: each a language and its line.
  final List<List<(String, String)>> questions;
  final Map<String, String> names;
  final Map<String, String> means;
  final Map<String, String> how;

  String name(String k) => names[k] ?? k;
  String top(List<String> top) =>
      top.length == 5 ? 'All five, equally' : top.map(name).join(' & ');

  static List<List<(String, String)>> _pairs(dynamic raw) {
    final out = <List<(String, String)>>[];
    if (raw is List) {
      for (final q in raw) {
        if (q is List &&
            q.length == 2 &&
            q.every((o) => o is List && o.length == 2)) {
          out.add([for (final o in q) ('${(o as List)[0]}', '${o[1]}')]);
        }
      }
    }
    return out.length == 20 ? out : _defaultQuestions;
  }

  static Map<String, String> _map(dynamic raw, Map<String, String> fallback) {
    if (raw is! Map) return fallback;
    return {...fallback, for (final e in raw.entries) '${e.key}': '${e.value}'};
  }
}

const _defaultNames = {
  'W': 'Words of affirmation',
  'Q': 'Quality time',
  'A': 'Acts of service',
  'T': 'Physical touch',
  'G': 'Receiving gifts',
};
const _defaultMeans = {
  'W':
      'Kind words land deepest: hearing that you are appreciated, admired, encouraged.',
  'Q':
      'Undivided attention is what feels like love: time together, phones down.',
  'A':
      'Help speaks loudest: a chore handled, a load lifted, a plan taken care of.',
  'T': 'Closeness says it best: a hug, a hand held, sitting near each other.',
  'G': 'A thoughtful gift, big or small, says “I was thinking of you.”',
};
const _defaultHow = {
  'W':
      'Say it out loud: what you admire, what you are grateful for. A text in the middle of the day counts.',
  'Q':
      'Plan time with nothing else in it. Put the phone away and ask about their day, then really listen.',
  'A':
      'Notice the chore they dread and do it before they ask. Take something off their plate this week.',
  'T':
      'A hug hello and goodbye, a hand on the shoulder, sitting close on the couch.',
  'G':
      'Small and personal beats big: their favourite snack, something they mentioned once.',
};
const _defaultQuestions = [
  [
    ('W', 'Hearing someone say they’re proud of you'),
    ('Q', 'Spending an evening together with phones put away'),
  ],
  [
    ('A', 'Someone handling a chore you’ve been dreading'),
    ('T', 'A long hug at the end of a hard day'),
  ],
  [
    ('G', 'A small souvenir someone picked up thinking of you'),
    ('W', 'A note telling you what they love about you'),
  ],
  [
    ('Q', 'A long walk with deep conversation'),
    ('A', 'Someone cooking you dinner when you’re exhausted'),
  ],
  [
    ('T', 'Holding hands while you’re out together'),
    ('G', 'A surprise gift for no particular reason'),
  ],
  [
    ('W', 'A heartfelt compliment in front of others'),
    ('A', 'Someone running an errand so you don’t have to'),
  ],
  [
    ('Q', 'A weekend trip with just the two of you'),
    ('T', 'Cuddling on the couch during a movie'),
  ],
  [
    ('G', 'Something you mentioned once, remembered and bought'),
    ('Q', 'Someone clearing their schedule to be with you'),
  ],
  [
    ('A', 'Someone fixing something that’s been broken for weeks'),
    ('G', 'A thoughtful birthday present'),
  ],
  [
    ('T', 'A reassuring hand on your shoulder'),
    ('W', 'Hearing “I appreciate you” out of the blue'),
  ],
  [
    ('Q', 'Someone giving you their full, undistracted attention'),
    ('W', 'A kind text message during your workday'),
  ],
  [
    ('T', 'A back rub after a long day'),
    ('A', 'Someone doing the dishes without being asked'),
  ],
  [
    ('W', 'Encouraging words before something difficult'),
    ('G', 'A little treat left for you to find'),
  ],
  [
    ('A', 'Help getting ready for a stressful event'),
    ('Q', 'Trying a new activity together'),
  ],
  [
    ('G', 'A handwritten card with a small present'),
    ('T', 'A kiss hello and goodbye every day'),
  ],
  [
    ('A', 'Someone taking a task off your plate'),
    ('W', 'Being told you’re doing a great job'),
  ],
  [
    ('T', 'Sitting close together, even in silence'),
    ('Q', 'A long, unhurried meal together'),
  ],
  [
    ('Q', 'Someone showing up for something important to you'),
    ('G', 'A gift that shows they really know you'),
  ],
  [
    ('G', 'Flowers or a favourite snack brought home'),
    ('A', 'Someone planning the details so you can relax'),
  ],
  [
    ('W', 'A thoughtful message on a hard day'),
    ('T', 'Being held when you’re upset'),
  ],
];

class _Choice extends StatelessWidget {
  const _Choice(this.text, {required this.onTap, this.selected = false});

  final String text;
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(
          color: selected ? _Rose.ink : CareColors.line,
          width: 1.5,
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
          child: Text(
            text,
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.ink,
              fontSize: 16,
              fontWeight: FontWeight.w600,
              height: 1.4,
            ),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// The pieces.

class _NoteCard extends StatelessWidget {
  const _NoteCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(22),
      border: Border.all(color: _Rose.line),
      gradient: const LinearGradient(
        begin: Alignment(-0.1, -1),
        end: Alignment(0.1, 1),
        colors: [_Rose.noteHi, _Rose.noteHi, _Rose.noteLo],
        stops: [0, 0.35, 1],
      ),
      boxShadow: [
        BoxShadow(
          color: _Rose.ink.withValues(alpha: 0.07),
          blurRadius: 5,
          offset: const Offset(0, 2),
        ),
        BoxShadow(
          color: _Rose.ink.withValues(alpha: 0.3),
          blurRadius: 34,
          spreadRadius: -22,
          offset: const Offset(0, 20),
        ),
      ],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    ),
  );
}

class _Eyebrow extends StatelessWidget {
  const _Eyebrow(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text.toUpperCase(),
    style: const TextStyle(
      fontFamily: careFont,
      color: _Rose.ink,
      fontSize: 11,
      fontWeight: FontWeight.w700,
      letterSpacing: 2,
    ),
  );
}

class _Face extends StatelessWidget {
  const _Face(this.text, {required this.partner});

  final String text;
  final bool partner;

  @override
  Widget build(BuildContext context) => Container(
    width: 40,
    height: 40,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: partner ? _Rose.noteLo : _Rose.ink,
      border: partner ? Border.all(color: _Rose.soft, width: 1.5) : null,
    ),
    child: Text(
      text,
      style: TextStyle(
        fontFamily: careFont,
        color: partner ? _Rose.ink : Colors.white,
        fontSize: 14,
        fontWeight: FontWeight.w800,
      ),
    ),
  );
}

class _PersonRow extends StatelessWidget {
  const _PersonRow({
    required this.face,
    required this.title,
    required this.status,
    required this.done,
    this.action,
  });

  final Widget face;
  final String title;
  final String status;
  final bool done;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: _Rose.line),
    ),
    // On a narrow phone the button drops under the words rather than over them.
    child: Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      alignment: WrapAlignment.spaceBetween,
      runSpacing: 10,
      spacing: 12,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            face,
            const SizedBox(width: 12),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 150),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontFamily: careFont,
                      color: CareColors.ink,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    status,
                    style: TextStyle(
                      fontFamily: careFont,
                      color: done ? _Rose.ink : CareColors.muted,
                      fontSize: 12,
                      fontWeight: done ? FontWeight.w700 : FontWeight.w400,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        ?action,
      ],
    ),
  );
}

enum _PillKind { rose, whatsapp, ghost }

class _Pill extends StatelessWidget {
  const _Pill(this.label, {required this.kind, required this.onTap});

  final String label;
  final _PillKind kind;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (kind) {
      _PillKind.rose => (_Rose.ink, Colors.white),
      _PillKind.whatsapp => (_Rose.wa, _Rose.waInk),
      _PillKind.ghost => (Colors.white, _Rose.ink),
    };
    return Material(
      color: bg,
      shape: StadiumBorder(
        side: kind == _PillKind.ghost
            ? const BorderSide(color: _Rose.line)
            : BorderSide.none,
      ),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (kind != _PillKind.rose && label != 'Retake') ...[
                Icon(Icons.chat_rounded, size: 15, color: fg),
                const SizedBox(width: 6),
              ],
              Text(
                label,
                style: TextStyle(
                  fontFamily: careFont,
                  color: fg,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Wide extends StatelessWidget {
  const _Wide(this.label, {required this.onTap, this.ghost = false});

  final String label;
  final VoidCallback onTap;
  final bool ghost;

  @override
  Widget build(BuildContext context) => Material(
    color: ghost ? Colors.white : _Rose.ink,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(14),
      side: ghost ? const BorderSide(color: _Rose.line) : BorderSide.none,
    ),
    child: InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: SizedBox(
        height: 50,
        child: Center(
          child: Text(
            label,
            style: TextStyle(
              fontFamily: careFont,
              color: ghost ? _Rose.ink : Colors.white,
              fontSize: 14,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    ),
  );
}

class _Waiting extends StatelessWidget {
  const _Waiting(this.lead, this.rest);

  final String lead;
  final String rest;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: _Rose.soft),
    ),
    child: Text.rich(
      TextSpan(
        style: const TextStyle(
          fontFamily: careFont,
          color: CareColors.muted,
          fontSize: 13,
          height: 1.45,
        ),
        children: [
          TextSpan(
            text: '$lead ',
            style: const TextStyle(
              color: CareColors.ink,
              fontWeight: FontWeight.w700,
            ),
          ),
          TextSpan(text: rest),
        ],
      ),
    ),
  );
}

class _Tile extends StatelessWidget {
  const _Tile({required this.label, required this.value, required this.colour});

  final String label;
  final String value;
  final Color colour;

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minHeight: 120),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: colour,
      borderRadius: BorderRadius.circular(18),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        Text(
          label.toUpperCase(),
          style: const TextStyle(
            fontFamily: careFont,
            color: Colors.white70,
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.5,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(
            fontFamily: careFont,
            color: Colors.white,
            fontSize: 16,
            fontWeight: FontWeight.w800,
            height: 1.25,
          ),
        ),
      ],
    ),
  );
}

class _Tip extends StatelessWidget {
  const _Tip({required this.colour, required this.title, required this.text});

  final Color colour;
  final String title;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    clipBehavior: Clip.antiAlias,
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: CareColors.line),
    ),
    child: IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(width: 4, color: colour),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontFamily: careFont,
                      color: CareColors.ink,
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  CareCopy(text, size: 13),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// What makes each quiz its own: its words, its questions, its results.

abstract class PairQuizSpec {
  /// 'love' or 'attachment': the server's name for it.
  String get kind;

  /// The card's eyebrow, and the label of its fold: 'Your love languages'.
  String get title;
  String get heading;
  String get line;
  String get length;
  int get count;

  /// The WhatsApp message, with the partner's link.
  String invite(String url);
  String partnerHeading(String from);
  String get partnerIntro;

  /// A line under results, where the quiz needs one.
  String? get gentle => null;

  /// The few words on a person's row once they have taken it.
  String summary(Map raw);

  /// One question: its words and its answers.
  Widget question(int i, String? current, ValueChanged<String> onAnswer);
  Widget result(Map raw);
  Widget together(
    Map me,
    Map them, {
    required bool viewerIsEmployee,
    required String partnerName,
    required String employeeName,
  });
}

/// Love languages: twenty pairs, choose one of each.
class LoveSpec extends PairQuizSpec {
  LoveSpec(this.quiz);

  final LoveQuiz quiz;

  @override
  String get kind => 'love';
  @override
  String get title => 'Your love languages';
  @override
  String get heading => 'How do you two feel most loved?';
  @override
  String get line =>
      'Knowing what makes your partner feel loved is the first step to showing it.';
  @override
  String get length => 'About 3 minutes';
  @override
  int get count => quiz.questions.length;
  @override
  String invite(String url) =>
      'I just found my love language. Want to find yours? It takes 3 minutes, then we can see both. $url';
  @override
  String partnerHeading(String from) =>
      '$from invited you to find your love language';
  @override
  String get partnerIntro =>
      'Twenty quick choices, about three minutes. When you finish, you’ll both see how each of you feels most loved.';

  List<String> _top(Map r) => [
    for (final t in (r['top'] as List? ?? const [])) '$t',
  ];

  @override
  String summary(Map raw) => quiz.top(_top(raw));

  @override
  Widget question(int i, String? current, ValueChanged<String> onAnswer) {
    final q = quiz.questions[i];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const CareCopy('Which would make you feel more loved?', size: 13),
        const SizedBox(height: 10),
        _Choice(
          q[0].$2,
          selected: current == q[0].$1,
          onTap: () => onAnswer(q[0].$1),
        ),
        const Padding(
          padding: EdgeInsets.only(bottom: 10),
          child: Center(
            child: Text(
              'OR',
              style: TextStyle(
                fontFamily: careFont,
                color: CareColors.muted,
                fontSize: 11,
                fontWeight: FontWeight.w700,
                letterSpacing: 2,
              ),
            ),
          ),
        ),
        _Choice(
          q[1].$2,
          selected: current == q[1].$1,
          onTap: () => onAnswer(q[1].$1),
        ),
      ],
    );
  }

  @override
  Widget result(Map raw) {
    final top = _top(raw);
    final s = raw['scores'] as Map? ?? const {};
    final ranked = [
      for (final k in _languages) MapEntry(k, (s[k] as num?)?.toInt() ?? 0),
    ]..sort((a, b) => b.value.compareTo(a.value));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _Eyebrow('Your love language'),
        const SizedBox(height: 4),
        _Big(quiz.top(top)),
        const SizedBox(height: 6),
        CareCopy(quiz.means[top.firstOrNull] ?? '', size: 13),
        const SizedBox(height: 12),
        for (final e in ranked)
          _Bar(
            label: quiz.name(e.key),
            value: '${e.value} of 8',
            share: e.value / 8,
            colour: _colour(e.key),
          ),
      ],
    );
  }

  @override
  Widget together(
    Map me,
    Map them, {
    required bool viewerIsEmployee,
    required String partnerName,
    required String employeeName,
  }) {
    final mk = _top(me).first, tk = _top(them).first;
    final same = mk == tk;
    final other = viewerIsEmployee ? partnerName : employeeName;
    final (left, right) = viewerIsEmployee ? (me, them) : (them, me);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Big(
          same ? 'You speak the same one' : 'Two ways of feeling loved',
          size: 24,
        ),
        const SizedBox(height: 12),
        _Tiles(
          leftLabel: viewerIsEmployee ? 'You' : employeeName,
          leftValue: quiz.top(_top(left)),
          leftColour: _colour(_top(left).first),
          rightLabel: viewerIsEmployee ? partnerName : 'You',
          rightValue: quiz.top(_top(right)),
          rightColour: _colour(_top(right).first),
        ),
        const SizedBox(height: 12),
        _Match(
          same
              ? [
                  const TextSpan(text: 'You both feel most loved through '),
                  _rose(quiz.name(mk).toLowerCase()),
                  const TextSpan(
                    text:
                        '. Giving it is easy when it is what you would want too.',
                  ),
                ]
              : [
                  const TextSpan(text: 'You feel most loved through '),
                  _rose(quiz.name(mk).toLowerCase()),
                  TextSpan(text: '; $other, through '),
                  _rose(quiz.name(tk).toLowerCase()),
                  const TextSpan(
                    text:
                        '. Love often gets given in our own language. Try theirs this week.',
                  ),
                ],
        ),
        const SizedBox(height: 16),
        _Heading('To show $other love'),
        const SizedBox(height: 8),
        _Tip(
          colour: _colour(tk),
          title: quiz.name(tk),
          text: quiz.how[tk] ?? '',
        ),
        const SizedBox(height: 14),
        const _Heading('What makes you feel loved'),
        const SizedBox(height: 8),
        _Tip(
          colour: _colour(mk),
          title: quiz.name(mk),
          text: quiz.means[mk] ?? '',
        ),
      ],
    );
  }
}

/// Attachment styles: ten statements, each rated from 1 to 5.
class AttachmentSpec extends PairQuizSpec {
  AttachmentSpec(Map<String, dynamic>? raw)
    : statements = _strings(raw?['statements'], _attStatements),
      names = _attMap(raw?['names'], _attNames),
      means = _attMap(raw?['means'], _attMeans),
      tries = _attMap(raw?['try'], _attTry),
      pairs = _attMap(raw?['pairs'], _attPairs),
      _gentle = raw?['gentle'] as String? ?? _attGentle;

  final List<String> statements;
  final Map<String, String> names;
  final Map<String, String> means;
  final Map<String, String> tries;
  final Map<String, String> pairs;
  final String _gentle;

  static List<String> _strings(dynamic raw, List<String> fallback) =>
      raw is List && raw.length == 10 ? [for (final x in raw) '$x'] : fallback;
  static Map<String, String> _attMap(
    dynamic raw,
    Map<String, String> fallback,
  ) => raw is Map
      ? {...fallback, for (final e in raw.entries) '${e.key}': '${e.value}'}
      : fallback;

  static const _order = ['secure', 'anxious', 'avoidant', 'fearful'];

  static Color _styleColour(String k) => switch (k) {
    'secure' => const Color(0xFF3B7BD9),
    'anxious' => const Color(0xFFC9467A),
    'avoidant' => const Color(0xFF7E57D6),
    _ => const Color(0xFFCF6A34),
  };

  @override
  String get kind => 'attachment';
  @override
  String get title => 'Your attachment styles';
  @override
  String get heading => 'How do you two handle closeness?';
  @override
  String get line =>
      'Understanding how each of you handles closeness makes it easier to look after each other.';
  @override
  String get length => 'About 2 minutes';
  @override
  int get count => statements.length;
  @override
  String invite(String url) =>
      'I just took a short quiz on how we each feel about closeness. Want to take it too? Ten questions, about 2 minutes, then we can see both. $url';
  @override
  String partnerHeading(String from) =>
      '$from invited you to see how you each handle closeness';
  @override
  String get partnerIntro =>
      'Ten statements, about two minutes. When you finish, you’ll both see your attachment styles side by side, and one small thing each of you can try.';
  @override
  String? get gentle => _gentle;

  String _style(Map r) => '${r['style'] ?? 'secure'}';
  double _n(Map r, String k) => (r[k] as num?)?.toDouble() ?? 0;

  @override
  String summary(Map raw) => names[_style(raw)] ?? '';

  @override
  Widget question(int i, String? current, ValueChanged<String> onAnswer) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            statements[i],
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.ink,
              fontSize: 19,
              fontWeight: FontWeight.w700,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 22),
          _AgreeSlider(
            initial: int.tryParse(current ?? ''),
            last: i == count - 1,
            onDone: (v) => onAnswer('$v'),
          ),
        ],
      );

  @override
  Widget result(Map raw) {
    final k = _style(raw);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _Eyebrow('Your style'),
        const SizedBox(height: 4),
        _Big(names[k] ?? k),
        const SizedBox(height: 6),
        CareCopy(means[k] ?? '', size: 13),
        const SizedBox(height: 12),
        _Bar(
          label: 'Attachment anxiety',
          value: '${_n(raw, 'anxiety').toStringAsFixed(1)} / 5',
          share: (_n(raw, 'anxiety') - 1) / 4,
          colour: _styleColour(k),
          midpoint: true,
        ),
        _Bar(
          label: 'Attachment avoidance',
          value: '${_n(raw, 'avoidance').toStringAsFixed(1)} / 5',
          share: (_n(raw, 'avoidance') - 1) / 4,
          colour: _styleColour(k),
          midpoint: true,
        ),
        const CareMicro(
          'The mark is the midpoint, 3. Above it counts as high. A score close to 3 sits near the line between two styles.',
        ),
        const SizedBox(height: 8),
        CareMicro(_gentle),
      ],
    );
  }

  @override
  Widget together(
    Map me,
    Map them, {
    required bool viewerIsEmployee,
    required String partnerName,
    required String employeeName,
  }) {
    final mk = _style(me), tk = _style(them);
    final key =
        ([mk, tk]
              ..sort((a, b) => _order.indexOf(a).compareTo(_order.indexOf(b))))
            .join('+');
    final other = viewerIsEmployee ? partnerName : employeeName;
    final (left, right) = viewerIsEmployee ? (mk, tk) : (tk, mk);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Big(
          mk == tk
              ? 'You see closeness in a similar way'
              : 'Two ways of feeling close',
          size: 24,
        ),
        const SizedBox(height: 12),
        _Tiles(
          leftLabel: viewerIsEmployee ? 'You' : employeeName,
          leftValue: names[left] ?? left,
          leftColour: _styleColour(left),
          rightLabel: viewerIsEmployee ? partnerName : 'You',
          rightValue: names[right] ?? right,
          rightColour: _styleColour(right),
        ),
        const SizedBox(height: 12),
        _Match([_rose('Together. '), TextSpan(text: pairs[key] ?? '')]),
        const SizedBox(height: 16),
        const _Heading('Something to try'),
        const SizedBox(height: 8),
        _Tip(
          colour: _styleColour(mk),
          title: 'For you · ${names[mk]}',
          text: tries[mk] ?? '',
        ),
        const SizedBox(height: 10),
        _Tip(
          colour: _styleColour(tk),
          title: 'For $other · ${names[tk]}',
          text: tries[tk] ?? '',
        ),
        const SizedBox(height: 10),
        CareMicro(_gentle),
      ],
    );
  }
}

const _attStatements = [
  'I often worry that the people I’m close to don’t care about me as much as I care about them.',
  'I feel uncomfortable when someone wants to get very emotionally close to me.',
  'If someone I love is distant or slow to reply, I assume something is wrong between us.',
  'I find it easy to turn to people I’m close to for comfort and support.',
  'I need a lot of reassurance that I’m loved and wanted.',
  'I prefer not to depend on others, even when I’m struggling.',
  'I worry about being abandoned or replaced.',
  'It’s hard for me to open up about my feelings, even to people I trust.',
  'I feel secure that the people close to me will be there when I need them.',
  'When a relationship gets serious, I feel an urge to pull back or keep my space.',
];
const _attNames = {
  'secure': 'Secure',
  'anxious': 'Anxious',
  'avoidant': 'Avoidant',
  'fearful': 'Fearful-avoidant',
};
const _attMeans = {
  'secure':
      'Closeness and independence both feel fairly comfortable to you. You tend to trust that the people you love will be there, without needing a lot of reassurance.',
  'anxious':
      'Closeness matters a great deal to you, and you may sometimes wonder whether others care as much as you do. Small signs of distance can feel big, and reassurance helps you settle.',
  'avoidant':
      'You value your independence and like to handle things yourself. When someone wants a lot of emotional closeness, a little space can feel safer than leaning in.',
  'fearful':
      'You want closeness and also want to protect yourself from getting hurt, so you can feel pulled both ways: drawn toward people, then wanting some distance.',
};
const _attTry = {
  'secure':
      'Your steadiness helps you both. Keep saying what you feel and need out loud, so your partner never has to guess.',
  'anxious':
      'When worry starts, say it gently instead of watching for signs: “I’m feeling a bit unsure, can we check in?” Asking is allowed.',
  'avoidant':
      'When you need space, say so and say when you’ll be back: “I need an hour, then let’s talk.” It keeps the door open.',
  'fearful':
      'Notice the pull and the push without blaming yourself. Share one small feeling at a time, at a pace that feels safe.',
};
const _attPairs = {
  'secure+secure':
      'You both tend to feel safe with closeness and with time apart. That gives you a steady base. Keep checking in, even when things feel easy.',
  'secure+anxious':
      'One of you tends to feel settled; the other can worry when things go quiet. Small, steady signs of care, like a quick message or keeping to plans, go a long way.',
  'secure+avoidant':
      'One of you is happy to lean in; the other likes room to breathe. Patience and an open door, without pressure, help closeness grow at its own pace.',
  'secure+fearful':
      'One of you tends to feel steady; the other can feel pulled between wanting closeness and wanting distance. Calm, predictable care helps trust build over time.',
  'anxious+anxious':
      'You both care deeply about closeness, and you can both worry when things feel uncertain. Reassure each other often, and say a worry out loud before it grows.',
  'anxious+avoidant':
      'When unsure, one of you reaches for closeness and the other looks for space. It is a common pattern, and it can turn into one following while the other steps back. Naming it together, kindly, takes much of the sting out.',
  'anxious+fearful':
      'You both feel things deeply and can both worry about getting hurt. Gentle reassurance and patience on both sides help you feel safe with each other.',
  'avoidant+avoidant':
      'You both value independence and room to breathe. That can feel easy, but feelings can also go unsaid. Make a little regular time to share how you’re really doing.',
  'avoidant+fearful':
      'You both tend to protect yourselves with some distance. Closeness may come slowly, and that is okay. Small, low-pressure moments of openness help.',
  'fearful+fearful':
      'You both want closeness and can both feel wary of it. Go gently, be patient with the push and pull, and notice the small moments of trust.',
};
const _attGentle =
    'A reflection tool, not a clinical assessment. Styles are tendencies, not labels: they can differ between relationships and change over time.';

/// Which quiz a partner's link is for, from the catalogue's words.
PairQuizSpec pairQuizSpecFor(String kind, Map<String, dynamic> content) =>
    kind == 'attachment'
    ? AttachmentSpec(content['attachmentQuiz'] as Map<String, dynamic>?)
    : LoveSpec(LoveQuiz(content['loveQuiz'] as Map<String, dynamic>?));

// ---------------------------------------------------------------------------
// The server.

class _Pair {
  const _Pair({this.mine, this.partner, this.code});

  final Map? mine;
  final Map? partner;
  final String? code;

  static _Pair fromJson(Map<String, dynamic> json) {
    final q = json['quiz'] as Map? ?? const {};
    return _Pair(
      mine: q['mine'] as Map?,
      partner: q['partner'] as Map?,
      code: (q['link'] as Map?)?['code'] as String?,
    );
  }
}

class _PairApi {
  _PairApi(this.care, this.kind);

  final CareApiService care;
  final String kind;

  Future<_Pair> _call(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    final uri = Uri.parse('${ApiConfig.baseUrl}/care/quiz/$kind$path');
    final headers = {
      'Authorization': 'Bearer ${care.session.token}',
      'Content-Type': 'application/json',
    };
    final r = switch (method) {
      'PUT' => await http.put(
        uri,
        headers: headers,
        body: jsonEncode(body ?? const {}),
      ),
      'POST' => await http.post(
        uri,
        headers: headers,
        body: jsonEncode(body ?? const {}),
      ),
      _ => await http.get(uri, headers: headers),
    };
    final json = r.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(r.body) as Map<String, dynamic>;
    if (r.statusCode < 200 || r.statusCode >= 300) {
      throw CareApiException(
        json['message'] as String? ?? 'Something went wrong. Try again.',
        statusCode: r.statusCode,
      );
    }
    return _Pair.fromJson(json);
  }

  Future<_Pair> get() => _call('GET', '');
  Future<_Pair> saveMine(String answers) =>
      _call('PUT', '/mine', {'answers': answers});
  Future<_Pair> link() => _call('POST', '/link');
}

/// The link the partner opens: this site's own address.
String _partnerUrl(String webBase, String code) {
  final base = webBase.isNotEmpty ? webBase : Uri.base.origin;
  return '${base.replaceAll(RegExp(r'/+$'), '')}/together/$code';
}

/// Sends the link: the phone's own share sheet where the page can open it,
/// WhatsApp otherwise.
Future<void> _sendLink(BuildContext context, String text) async {
  if (await careShareText?.call(text) == true) return;
  final wa = 'https://wa.me/?text=${Uri.encodeComponent(text)}';
  if (careOpenUrl != null) {
    careOpenUrl!(wa);
    return;
  }
  if (!await launchUrl(Uri.parse(wa), mode: LaunchMode.externalApplication) &&
      context.mounted) {
    showAppToast(context, 'WhatsApp is not available here');
  }
}

// ---------------------------------------------------------------------------
// The card, the quiz and the partner's page, the same for both quizzes.

/// A card at the bottom of Time for two of you: you and your partner, each
/// with their step, and both results folded away until opened.
class PairQuizCard extends StatefulWidget {
  const PairQuizCard({
    super.key,
    required this.care,
    required this.spec,
    required this.webBase,
  });

  final CareApiService care;
  final PairQuizSpec spec;
  final String webBase;

  @override
  State<PairQuizCard> createState() => _PairQuizCardState();
}

class _PairQuizCardState extends State<PairQuizCard> {
  late final _api = _PairApi(widget.care, widget.spec.kind);
  _Pair _pair = const _Pair();
  bool _ready = false;

  /// Hidden where the server cannot keep a quiz yet.
  bool _available = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final pair = await _api.get();
      if (!mounted) return;
      setState(() {
        _pair = pair;
        _ready = true;
      });
    } catch (e) {
      // Not there on this server yet, or not for this person: stay hidden.
      if (!mounted) return;
      setState(() {
        _available =
            e is CareApiException && e.statusCode != 404 && e.statusCode != 401;
        _ready = true;
      });
    }
  }

  Future<void> _take() async {
    final answers = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => _QuizScreen(spec: widget.spec)),
    );
    if (answers == null || !mounted) return;
    try {
      final pair = await _api.saveMine(answers);
      if (mounted) setState(() => _pair = pair);
    } catch (e) {
      if (mounted)
        showAppToast(
          context,
          e is CareApiException ? e.message : 'Could not save that.',
        );
    }
  }

  Future<void> _share() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final pair = await _api.link();
      if (!mounted) return;
      setState(() => _pair = pair);
      final code = pair.code;
      if (code != null)
        await _sendLink(
          context,
          widget.spec.invite(_partnerUrl(widget.webBase, code)),
        );
    } catch (e) {
      if (mounted)
        showAppToast(
          context,
          e is CareApiException ? e.message : 'Could not make the link.',
        );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready || !_available) return const SizedBox.shrink();
    final spec = widget.spec;
    final mine = _pair.mine, theirs = _pair.partner;
    final named = '${theirs?['name'] ?? ''}'.trim();
    final partner = named.isNotEmpty ? named : 'Your partner';
    final invited = _pair.code != null;
    // Its own space below, so a hidden card leaves no gap.
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: _NoteCard(
        children: [
          _Eyebrow(spec.title),
          const SizedBox(height: 8),
          Text(
            spec.heading,
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.ink,
              fontSize: 20,
              fontWeight: FontWeight.w800,
              height: 1.25,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 6),
          CareCopy(spec.line, size: 13),
          const SizedBox(height: 14),
          _PersonRow(
            face: const _Face('P', partner: false),
            title: 'You',
            status: mine == null ? spec.length : spec.summary(mine),
            done: mine != null,
            action: mine == null
                ? _Pill('Take the test', kind: _PillKind.rose, onTap: _take)
                : _Pill('Retake', kind: _PillKind.ghost, onTap: _take),
          ),
          const SizedBox(height: 10),
          _PersonRow(
            face: const _Face('♡', partner: true),
            title: partner,
            status: theirs != null
                ? spec.summary(theirs)
                : invited
                ? 'Waiting for them'
                : 'No app needed',
            done: theirs != null,
            action: theirs != null
                ? null
                : _Pill(
                    invited ? 'Send again' : 'Share test link',
                    kind: invited ? _PillKind.ghost : _PillKind.whatsapp,
                    onTap: _share,
                  ),
          ),
          if (mine != null || theirs != null) ...[
            const SizedBox(height: 12),
            _OpenRow(
              label: spec.title,
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => _ResultsScreen(
                    title: spec.title,
                    child: mine != null && theirs != null
                        ? Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              spec.together(
                                mine,
                                theirs,
                                viewerIsEmployee: true,
                                partnerName: partner,
                                employeeName: 'You',
                              ),
                              const SizedBox(height: 16),
                              spec.result(mine),
                            ],
                          )
                        : mine != null
                        ? Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              spec.result(mine),
                              const SizedBox(height: 10),
                              const CareCopy(
                                'Your partner’s shows here, beside yours, once they take it.',
                                size: 13,
                              ),
                            ],
                          )
                        : CareCopy(
                            '$partner has taken it. Take yours to see both side by side.',
                            size: 13,
                          ),
                  ),
                ),
              ),
            ),
          ],
          const SizedBox(height: 10),
          const CareMicro(
            'Only you and your partner see these results. Never your company.',
          ),
        ],
      ),
    );
  }
}

/// One question at a time; Back keeps the answer given.
class _QuizFlow extends StatefulWidget {
  const _QuizFlow({required this.spec, required this.onDone});

  final PairQuizSpec spec;
  final ValueChanged<String> onDone;

  @override
  State<_QuizFlow> createState() => _QuizFlowState();
}

class _QuizFlowState extends State<_QuizFlow> {
  late final List<String?> _answers = List.filled(widget.spec.count, null);
  int _i = 0;
  bool _moving = false;

  void _answer(String v) {
    if (_moving) return; // a quick second tap only changes the answer
    setState(() => _answers[_i] = v);
    if (_i == widget.spec.count - 1) {
      widget.onDone(_answers.map((a) => a ?? '').join());
      return;
    }
    _moving = true;
    Future<void>.delayed(const Duration(milliseconds: 180), () {
      if (!mounted) return;
      setState(() {
        _i++;
        _moving = false;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final total = widget.spec.count;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Text(
              'Question ${_i + 1} of $total',
              style: const TextStyle(
                fontFamily: careFont,
                color: CareColors.muted,
                fontSize: 12.5,
              ),
            ),
            const Spacer(),
            if (_i > 0)
              TextButton(
                onPressed: () => setState(() => _i--),
                child: const Text(
                  '← Back',
                  style: TextStyle(
                    fontFamily: careFont,
                    color: _Rose.ink,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              )
            else
              const SizedBox(height: 40),
          ],
        ),
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: LinearProgressIndicator(
            value: _i / total,
            minHeight: 6,
            color: _Rose.ink,
            backgroundColor: _Rose.line,
          ),
        ),
        const SizedBox(height: 22),
        KeyedSubtree(
          key: ValueKey(_i),
          child: widget.spec.question(_i, _answers[_i], _answer),
        ),
      ],
    );
  }
}

class _QuizScreen extends StatelessWidget {
  const _QuizScreen({required this.spec});

  final PairQuizSpec spec;

  @override
  Widget build(BuildContext context) => CarePage(
    backLabel: 'Back',
    children: [
      _QuizFlow(spec: spec, onDone: (a) => Navigator.of(context).pop(a)),
    ],
  );
}

/// The partner's page, from the WhatsApp link: no account, the link is the
/// key. The quiz is whichever the link is for.
class PairPartnerScreen extends StatefulWidget {
  const PairPartnerScreen({
    super.key,
    required this.code,
    required this.content,
  });

  final String code;

  /// Time for two of you's words, which hold both quizzes'.
  final Map<String, dynamic> content;

  @override
  State<PairPartnerScreen> createState() => _PairPartnerScreenState();
}

class _PairPartnerScreenState extends State<PairPartnerScreen> {
  final _name = TextEditingController();
  PairQuizSpec? _spec;
  String? _from;
  Map? _theirs, _mine;
  String? _error;
  bool _quiz = false;

  Uri get _uri =>
      Uri.parse('${ApiConfig.baseUrl}/care/quiz/partner/${widget.code}');

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _take(http.Response r) {
    final json = r.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(r.body) as Map<String, dynamic>;
    if (r.statusCode < 200 || r.statusCode >= 300) {
      setState(
        () => _error =
            json['message'] as String? ??
            'This link has expired. Ask for a new one.',
      );
      return;
    }
    final q = json['quiz'] as Map? ?? const {};
    setState(() {
      _spec = pairQuizSpecFor('${q['kind'] ?? 'love'}', widget.content);
      _from = '${q['from'] ?? 'Your partner'}';
      _theirs = q['theirs'] as Map?;
      _mine = q['partner'] as Map?;
      final name = '${_mine?['name'] ?? ''}';
      if (name.isNotEmpty && _name.text.isEmpty) _name.text = name;
    });
  }

  Future<void> _load() async {
    try {
      _take(await http.get(_uri));
    } catch (_) {
      if (mounted)
        setState(
          () => _error = 'Could not reach Sowaka. Try again in a moment.',
        );
    }
  }

  Future<void> _done(String answers) async {
    setState(() => _quiz = false);
    try {
      final r = await http.put(
        _uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'answers': answers, 'name': _name.text}),
      );
      if (mounted) _take(r);
    } catch (_) {
      if (mounted) showAppToast(context, 'Could not save that. Try again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final error = _error, spec = _spec, from = _from;
    final mine = _mine, theirs = _theirs;
    return CarePage(
      children: [
        if (error != null)
          _NoteCard(
            children: [
              const _Eyebrow('Sowaka · for two'),
              const SizedBox(height: 8),
              CareCopy(error, size: 14),
            ],
          )
        else if (spec == null || from == null)
          const CareSpinner()
        else if (_quiz)
          _QuizFlow(spec: spec, onDone: _done)
        else if (mine == null)
          _NoteCard(
            children: [
              const _Eyebrow('Sowaka · for two'),
              const SizedBox(height: 8),
              Text(
                spec.partnerHeading(from),
                style: const TextStyle(
                  fontFamily: careFont,
                  color: CareColors.ink,
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  height: 1.25,
                ),
              ),
              const SizedBox(height: 6),
              CareCopy(spec.partnerIntro, size: 13),
              const SizedBox(height: 14),
              const Text(
                'Your first name (optional)',
                style: TextStyle(
                  fontFamily: careFont,
                  color: CareColors.ink,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              TextField(
                controller: _name,
                maxLength: 40,
                textCapitalization: TextCapitalization.words,
                style: const TextStyle(fontFamily: careFont, fontSize: 15),
                decoration: InputDecoration(
                  counterText: '',
                  isDense: true,
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: CareColors.line),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: CareColors.line),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              _Wide('Start', onTap: () => setState(() => _quiz = true)),
              const SizedBox(height: 12),
              CareMicro(
                'Only you and $from see your answers. Nothing is shared with anyone else, and you don’t need an account.'
                '${spec.gentle == null ? '' : ' This is a reflection tool, not a clinical assessment.'}',
              ),
            ],
          )
        else
          _NoteCard(
            children: [
              if (theirs != null) ...[
                _Eyebrow(spec.title),
                const SizedBox(height: 4),
                spec.together(
                  // their own first: "me" is whoever is looking
                  mine,
                  theirs,
                  viewerIsEmployee: false,
                  partnerName: 'You',
                  employeeName: from,
                ),
                const SizedBox(height: 16),
                spec.result(mine),
              ] else ...[
                spec.result(mine),
                const SizedBox(height: 14),
                _Waiting(
                  '$from hasn’t taken it yet.',
                  'Come back to this link and you’ll see both of yours side by side.',
                ),
              ],
              const SizedBox(height: 14),
              _Wide(
                'Retake the test',
                ghost: true,
                onTap: () => setState(() => _quiz = true),
              ),
            ],
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Small pieces of the results.

class _Big extends StatelessWidget {
  const _Big(this.text, {this.size = 25});

  final String text;
  final double size;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: TextStyle(
      fontFamily: careFont,
      color: CareColors.ink,
      fontSize: size,
      fontWeight: FontWeight.w800,
      height: 1.2,
      letterSpacing: -0.4,
    ),
  );
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: const TextStyle(
      fontFamily: careFont,
      color: CareColors.ink,
      fontSize: 17,
      fontWeight: FontWeight.w800,
    ),
  );
}

TextSpan _rose(String text) => TextSpan(
  text: text,
  style: const TextStyle(color: _Rose.ink, fontWeight: FontWeight.w700),
);

class _Match extends StatelessWidget {
  const _Match(this.spans);

  final List<InlineSpan> spans;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: _Rose.noteLo,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: _Rose.line),
    ),
    child: Text.rich(
      TextSpan(
        style: const TextStyle(
          fontFamily: careFont,
          color: CareColors.ink,
          fontSize: 13,
          height: 1.55,
        ),
        children: spans,
      ),
    ),
  );
}

class _Tiles extends StatelessWidget {
  const _Tiles({
    required this.leftLabel,
    required this.leftValue,
    required this.leftColour,
    required this.rightLabel,
    required this.rightValue,
    required this.rightColour,
  });

  final String leftLabel, leftValue, rightLabel, rightValue;
  final Color leftColour, rightColour;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Expanded(
        child: _Tile(label: leftLabel, value: leftValue, colour: leftColour),
      ),
      const SizedBox(width: 10),
      Expanded(
        child: _Tile(label: rightLabel, value: rightValue, colour: rightColour),
      ),
    ],
  );
}

/// A score as a bar; with a mark at the midpoint where the quiz has one.
class _Bar extends StatelessWidget {
  const _Bar({
    required this.label,
    required this.value,
    required this.share,
    required this.colour,
    this.midpoint = false,
  });

  final String label;
  final String value;
  final double share;
  final Color colour;
  final bool midpoint;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            if (!midpoint) ...[
              Container(
                width: 12,
                height: 12,
                decoration: BoxDecoration(
                  color: colour,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
            ],
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  fontFamily: careFont,
                  color: CareColors.ink,
                  fontSize: 12.5,
                ),
              ),
            ),
            Text(
              value,
              style: const TextStyle(
                fontFamily: careFont,
                color: CareColors.muted,
                fontSize: 12.5,
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        SizedBox(
          height: 8,
          child: Stack(
            fit: StackFit.expand,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: LinearProgressIndicator(
                  value: share.clamp(0.0, 1.0),
                  minHeight: 8,
                  color: colour,
                  backgroundColor: const Color(0xFFEEE7E9),
                ),
              ),
              if (midpoint)
                const Align(
                  alignment: Alignment.center,
                  child: SizedBox(
                    width: 2,
                    height: 12,
                    child: ColoredBox(color: CareColors.ink),
                  ),
                ),
            ],
          ),
        ),
      ],
    ),
  );
}

/// How much someone agrees, on a slider from strongly disagree to strongly
/// agree: five stops, named in words rather than numbers. Next shows once
/// they have moved it, so nobody lands on the middle by not answering.
class _AgreeSlider extends StatefulWidget {
  const _AgreeSlider({
    required this.initial,
    required this.last,
    required this.onDone,
  });

  /// The answer given before, when they came back to this one.
  final int? initial;
  final bool last;
  final ValueChanged<int> onDone;

  @override
  State<_AgreeSlider> createState() => _AgreeSliderState();
}

class _AgreeSliderState extends State<_AgreeSlider> {
  static const _words = [
    'Strongly disagree',
    'Disagree',
    'Not sure',
    'Agree',
    'Strongly agree',
  ];

  late int? _value = widget.initial;

  @override
  Widget build(BuildContext context) {
    final value = _value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: Text(
            value == null ? 'Move the slider' : _words[value - 1],
            style: TextStyle(
              fontFamily: careFont,
              color: value == null ? CareColors.muted : _Rose.ink,
              fontSize: 17,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        const SizedBox(height: 6),
        SliderTheme(
          data: SliderTheme.of(context).copyWith(
            trackHeight: 6,
            activeTrackColor: value == null ? _Rose.line : _Rose.ink,
            inactiveTrackColor: _Rose.line,
            thumbColor: value == null ? Colors.white : _Rose.ink,
            overlayColor: _Rose.ink.withValues(alpha: 0.12),
            activeTickMarkColor: Colors.white,
            inactiveTickMarkColor: _Rose.soft,
            thumbShape: const RoundSliderThumbShape(
              enabledThumbRadius: 13,
              elevation: 3,
            ),
            showValueIndicator: ShowValueIndicator.never,
          ),
          child: Slider(
            min: 1,
            max: 5,
            divisions: 4,
            value: (value ?? 3).toDouble(),
            semanticFormatterCallback: (v) => _words[v.round() - 1],
            onChanged: (v) => setState(() => _value = v.round()),
          ),
        ),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 6),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Strongly disagree',
                style: TextStyle(
                  fontFamily: careFont,
                  color: CareColors.muted,
                  fontSize: 11.5,
                ),
              ),
              Text(
                'Strongly agree',
                style: TextStyle(
                  fontFamily: careFont,
                  color: CareColors.muted,
                  fontSize: 11.5,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        AnimatedOpacity(
          opacity: value == null ? 0.35 : 1,
          duration: const Duration(milliseconds: 200),
          child: IgnorePointer(
            ignoring: value == null,
            child: _Wide(
              widget.last ? 'See my result' : 'Next',
              onTap: () => widget.onDone(value!),
            ),
          ),
        ),
      ],
    );
  }
}

/// The row under the two of you that opens both results on a page of
/// their own.
class _OpenRow extends StatelessWidget {
  const _OpenRow({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(18),
      side: const BorderSide(color: _Rose.line),
    ),
    child: InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
        child: Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  fontFamily: careFont,
                  color: _Rose.ink,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: _Rose.ink),
          ],
        ),
      ),
    ),
  );
}

/// Both results, on a page of their own.
class _ResultsScreen extends StatelessWidget {
  const _ResultsScreen({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => CarePage(
    backLabel: 'Back',
    children: [
      _Eyebrow(title),
      const SizedBox(height: 14),
      _NoteCard(children: [child]),
    ],
  );
}
