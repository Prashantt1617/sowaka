import 'package:flutter/material.dart';

/// The four topics on Help home. Their text comes from the server's Care
/// catalogue, so Sowaka can change a reading or a question without an app
/// release; the list below is what shows when the catalogue cannot be read.
/// Icons stay in the app, keyed by the topic's id.
class HelpTopic {
  const HelpTopic({
    required this.id,
    required this.name,
    required this.intro,
    this.kind = 'generic',
    this.article = '',
    this.question = '',
    this.tool = '',
    this.toolBody = '',
    this.content = const {},
  });

  final String id;
  final String name;
  final String intro;

  /// Which page the topic draws: grief, balance, parents, couples, or generic.
  final String kind;
  final String article;
  final String question;
  final String tool;
  final String toolBody;

  /// The bespoke page's copy and lists, shaped by `kind`.
  final Map<String, dynamic> content;

  IconData get icon => helpTopicIcon(id);

  String text(String key, [String fallback = '']) =>
      (content[key] as String?) ?? fallback;
  List<Map<String, dynamic>> list(String key) => [
    for (final row in (content[key] as List<dynamic>? ?? const []))
      row as Map<String, dynamic>,
  ];
  List<String> strings(String key) => [
    for (final row in (content[key] as List<dynamic>? ?? const [])) '$row',
  ];

  factory HelpTopic.fromJson(Map<String, dynamic> json) => HelpTopic(
    id: json['id'] as String? ?? '',
    name: json['name'] as String? ?? '',
    intro: json['intro'] as String? ?? '',
    kind: json['kind'] as String? ?? 'generic',
    article: json['article'] as String? ?? '',
    question: json['question'] as String? ?? '',
    tool: json['tool'] as String? ?? '',
    toolBody: json['toolBody'] as String? ?? '',
    content: json['content'] as Map<String, dynamic>? ?? const {},
  );
}

IconData helpTopicIcon(String id) => switch (id) {
  'stress' => Icons.cloud_outlined,
  'burnout' => Icons.battery_2_bar_rounded,
  'work' => Icons.work_outline_rounded,
  'balance' => Icons.balance_rounded,
  'parent' => Icons.child_care_rounded,
  'couples' => Icons.handshake_outlined,
  'family' => Icons.home_outlined,
  'loss' => Icons.local_florist_outlined,
  'money' => Icons.account_balance_wallet_outlined,
  'change' => Icons.eco_outlined,
  _ => Icons.circle_outlined,
};

const helpTopicList = [
  HelpTopic(
    id: 'loss',
    name: 'Grief & loss',
    intro: 'A place to explore what loss means for you.',
    article: 'There is no single story of loss',
    question: 'What would you like to put into words about your loss?',
    tool: 'A letter, if you feel like it',
    toolBody:
        'Write to a person, a part of your life, or yourself. There is no need to finish it, share it, or make it positive.',
  ),
  HelpTopic(
    id: 'balance',
    name: 'Work–life balance',
    intro: 'When work keeps spilling into the rest of life.',
    article: 'Where does your workday end?',
    question: 'Where would you like a little more space between work and life?',
    tool: 'A boundary worth trying',
    toolBody:
        'Name one boundary you would like to explore, who needs to know about it, and what might make it easier to keep.',
  ),
  HelpTopic(
    id: 'couples',
    name: 'Marriage & relationships',
    intro: 'Newly married, finding a rhythm, or navigating change together.',
    article: 'Getting to know your shared everyday',
    question: 'What would you like your partner to understand about your day?',
    tool: 'A conversation starter',
    toolBody:
        'Try finishing these sentences: “Something I appreciate is…” and “Something I would like us to talk about is…”',
  ),
  HelpTopic(
    id: 'parent',
    name: 'New parenthood',
    intro: 'Finding your way through a new chapter.',
    article: 'Making room for your needs, too',
    question: 'What kind of support would feel useful to you this week?',
    tool: 'Your support circle',
    toolBody:
        'Write down the practical help, company, or time you would appreciate. Then think about who you might ask.',
  ),
];
