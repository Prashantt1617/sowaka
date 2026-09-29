import 'package:flutter/material.dart';

/// The ten topics on Help home. Their text comes from the server's Care
/// catalogue, so Sowaka can change a reading or a question without an app
/// release; the list below is what shows when the catalogue cannot be read.
/// Icons stay in the app, keyed by the topic's id.
class HelpTopic {
  const HelpTopic({
    required this.id,
    required this.name,
    required this.intro,
    required this.article,
    required this.question,
    required this.tool,
    required this.toolBody,
  });

  final String id;
  final String name;
  final String intro;
  final String article;
  final String question;
  final String tool;
  final String toolBody;

  IconData get icon => helpTopicIcon(id);

  factory HelpTopic.fromJson(Map<String, dynamic> json) => HelpTopic(
    id: json['id'] as String? ?? '',
    name: json['name'] as String? ?? '',
    intro: json['intro'] as String? ?? '',
    article: json['article'] as String? ?? '',
    question: json['question'] as String? ?? '',
    tool: json['tool'] as String? ?? '',
    toolBody: json['toolBody'] as String? ?? '',
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
    id: 'stress',
    name: 'Stress & overwhelm',
    intro: 'When there is a lot on your mind.',
    article: 'Making sense of what’s weighing on you',
    question: 'What is asking for most of your energy right now?',
    tool: 'One thing at a time',
    toolBody: 'List what is on your mind. Choose one thing you could make smaller, share, or leave for another day.',
  ),
  HelpTopic(
    id: 'burnout',
    name: 'Burnout',
    intro: 'When your energy feels stretched thin.',
    article: 'Noticing what takes—and gives—energy',
    question: 'What has felt especially draining lately?',
    tool: 'Your energy map',
    toolBody: 'Make two lists: things that take energy, and things that give a little back. Notice one change you would like to explore.',
  ),
  HelpTopic(
    id: 'work',
    name: 'Pressure at work',
    intro: 'Deadlines, expectations, and everything in between.',
    article: 'Untangling expectations at work',
    question: 'Which expectation at work feels hardest to carry?',
    tool: 'Prepare a conversation',
    toolBody: 'What is happening? What is the impact on you? What would you like to ask for? Use these three questions to sketch a conversation.',
  ),
  HelpTopic(
    id: 'balance',
    name: 'Work–life balance',
    intro: 'When work keeps spilling into the rest of life.',
    article: 'Where does your workday end?',
    question: 'Where would you like a little more space between work and life?',
    tool: 'A boundary worth trying',
    toolBody: 'Name one boundary you would like to explore, who needs to know about it, and what might make it easier to keep.',
  ),
  HelpTopic(
    id: 'parent',
    name: 'New parenthood',
    intro: 'Finding your way through a new chapter.',
    article: 'Making room for your needs, too',
    question: 'What kind of support would feel useful to you this week?',
    tool: 'Your support circle',
    toolBody: 'Write down the practical help, company, or time you would appreciate. Then think about who you might ask.',
  ),
  HelpTopic(
    id: 'couples',
    name: 'Marriage & relationships',
    intro: 'Newly married, finding a rhythm, or navigating change together.',
    article: 'Getting to know your shared everyday',
    question: 'What would you like your partner to understand about your day?',
    tool: 'A conversation starter',
    toolBody: 'Try finishing these sentences: “Something I appreciate is…” and “Something I would like us to talk about is…”',
  ),
  HelpTopic(
    id: 'family',
    name: 'Family pressure',
    intro: 'Your needs, their expectations, and the space between.',
    article: 'Understanding the expectations you carry',
    question: 'Which family expectation would you like more room to question?',
    tool: 'What matters to you?',
    toolBody: 'Write down what you want, what others are hoping for, and where you might need a clearer conversation.',
  ),
  HelpTopic(
    id: 'loss',
    name: 'Grief & loss',
    intro: 'A place to explore what loss means for you.',
    article: 'There is no single story of loss',
    question: 'What would you like to put into words about your loss?',
    tool: 'A letter, if you feel like it',
    toolBody: 'Write to a person, a part of your life, or yourself. There is no need to finish it, share it, or make it positive.',
  ),
  HelpTopic(
    id: 'money',
    name: 'Money worries',
    intro: 'Space to talk about the pressure money can bring.',
    article: 'The feelings around money',
    question: 'What about money feels most uncertain right now?',
    tool: 'Separate the worry from the next step',
    toolBody: 'Describe what is worrying you, what information you are missing, and one question you would like help answering.',
  ),
  HelpTopic(
    id: 'change',
    name: 'Life changes',
    intro: 'When things are shifting around you.',
    article: 'Finding your footing in a transition',
    question: 'What is changing, and what would you like to hold on to?',
    tool: 'What stays, what changes',
    toolBody: 'List what is changing and what feels steady. Choose one familiar thing you would like to make room for.',
  ),
];
