import 'package:flutter/material.dart';

/// Breathe: six moods, as getsowaka.com/breathe has them. Four lead to a
/// timed breath with the circle or the box; two to a short list of steps.
class BreathPhase {
  const BreathPhase(this.label, this.seconds);

  final String label;
  final int seconds;
}

enum RemedyKind { breath, steps }

class Mood {
  const Mood({
    required this.key,
    required this.label,
    required this.want,
    required this.color,
    required this.name,
    required this.sub,
    required this.kind,
    this.note,
    this.pattern = const [],
    this.rounds = 0,
    this.square = false,
    this.steps = const [],
    this.pauseSteps = const [],
  });

  final String key;

  /// 'Angry'
  final String label;

  /// 'Calm': where it takes you.
  final String want;
  final Color color;
  final String name;
  final String sub;
  final RemedyKind kind;

  /// A line to hold in mind while breathing.
  final String? note;
  final List<BreathPhase> pattern;
  final int rounds;

  /// Drawn as the box rather than the circle.
  final bool square;
  final List<String> steps;
  final List<int> pauseSteps;

  String get tag => 'Mood · $label → $want';

  bool isPause(int step) => pauseSteps.contains(step);
}

const moods = [
  Mood(
    key: 'angry',
    label: 'Angry',
    want: 'Calm',
    color: Color(0xFFB03A2E),
    name: 'Long Exhale Breathing',
    sub: 'A longer exhale switches on your calming response. Let each out-breath be slow and complete.',
    kind: RemedyKind.breath,
    rounds: 5,
    pattern: [BreathPhase('Breathe in', 4), BreathPhase('Breathe out', 6)],
  ),
  Mood(
    key: 'anxious',
    label: 'Anxious',
    want: 'Grounded',
    color: Color(0xFFB0502E),
    name: 'Feet Press + Box Breathing',
    sub: 'Four even sides. Ground through your feet while the breath moves around the box.',
    kind: RemedyKind.breath,
    note: 'Press both feet firmly into the floor — feel the ground hold you — as you breathe.',
    rounds: 4,
    square: true,
    pattern: [BreathPhase('Breathe in', 4), BreathPhase('Hold', 4), BreathPhase('Breathe out', 4), BreathPhase('Hold', 4)],
  ),
  Mood(
    key: 'jealous',
    label: 'Jealous',
    want: 'Content',
    color: Color(0xFF566346),
    name: 'Gratitude Pause',
    sub: 'Comparison fades when your attention turns to what is already yours.',
    kind: RemedyKind.steps,
    steps: [
      'Place one hand on your heart and close your eyes.',
      'Take a slow breath and bring to mind one thing you are grateful for.',
      'Name two more — small and ordinary still count.',
      'Rest here and feel the warmth of each one. Hold 20 seconds.',
      'Open your eyes and carry that fullness with you.',
    ],
    pauseSteps: [3],
  ),
  Mood(
    key: 'scrolling',
    label: 'Can’t stop scrolling',
    want: 'Present',
    color: Color(0xFFB07B26),
    name: '5-4-3-2-1 Sensory Reset',
    sub: 'Pull your mind out of the feed and back into the room through your senses.',
    kind: RemedyKind.steps,
    steps: [
      'Look around and name 5 things you can see.',
      'Notice 4 things you can feel — your seat, your feet, the air.',
      'Listen for 3 things you can hear.',
      'Find 2 things you can smell.',
      'Notice 1 thing you can taste. You are here now.',
    ],
  ),
  Mood(
    key: 'nervous',
    label: 'Nervous',
    want: 'Confident',
    color: Color(0xFF8A6AA0),
    name: 'Mountain Pose + Power Breath',
    sub: 'Stand like a mountain and breathe with power — your posture tells your brain you are ready.',
    kind: RemedyKind.breath,
    note: 'Stand tall, feet hip-width apart, shoulders back, crown of your head lifting.',
    rounds: 5,
    pattern: [BreathPhase('Breathe in', 4), BreathPhase('Hold', 2), BreathPhase('Release', 4)],
  ),
  Mood(
    key: 'sleep',
    label: 'Can’t switch off',
    want: 'Sleep',
    color: Color(0xFF3F7B78),
    name: '4-6 Breathing',
    sub: 'A short in-breath and a long out-breath ease you toward rest. Let it slow you all the way down.',
    kind: RemedyKind.breath,
    rounds: 6,
    pattern: [BreathPhase('Breathe in', 4), BreathPhase('Breathe out', 6)],
  ),
];

Mood moodByKey(String key) => moods.firstWhere((m) => m.key == key);
