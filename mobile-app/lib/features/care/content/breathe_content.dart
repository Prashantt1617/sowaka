import 'package:flutter/material.dart';

import '../data/care_models.dart' show MoveClip;

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
    this.poseAsset,
    this.poseUrl,
    this.writeSteps = const {},
    this.sitStep,
    this.sitSeconds = 30,
    this.readSeconds = 4,
    this.paged = false,
    this.clips = const [],
    this.photos = const {},
    this.breathHolds = const {},
    this.breathSeconds = 5,
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

  /// A picture of the pose to hold, shown above the breath: the catalogue's
  /// photo where there is one, the app's own otherwise.
  final String? poseAsset;
  final String? poseUrl;

  /// Steps that ask for a few words, by index: how many boxes each has.
  final Map<int, int> writeSteps;

  /// The step that brings back what was written, with a breath to sit
  /// with it.
  final int? sitStep;

  /// How long that step breathes.
  final int sitSeconds;

  /// How long a step with nothing to do or count stays before the next.
  final int readSeconds;

  /// Runs one step a page, the way a Move stretch does, instead of a list.
  final bool paged;

  /// For a paged exercise: the clips its steps play, steps counted from 1.
  final List<MoveClip> clips;

  /// For a paged exercise: a photo for a step, by index, a `/media` path,
  /// https address or app asset. A step with neither clip nor photo is its
  /// words alone.
  final Map<int, String> photos;

  /// For a paged exercise: holds breathed rather than counted, by index: how
  /// many breaths each takes.
  final Map<int, int> breathHolds;

  /// How long one of those breaths takes, half in and half out.
  final int breathSeconds;

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
    sub:
        'A longer exhale switches on your calming response. Let each out-breath be slow and complete.',
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
    sub:
        'Four even sides. Ground through your feet while the breath moves around the box.',
    kind: RemedyKind.breath,
    note:
        'Press both feet firmly into the floor — feel the ground hold you — as you breathe.',
    rounds: 4,
    square: true,
    poseAsset: 'assets/care/pose_anxious.jpg',
    pattern: [
      BreathPhase('Breathe in', 4),
      BreathPhase('Hold', 4),
      BreathPhase('Breathe out', 4),
      BreathPhase('Hold', 4),
    ],
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
      'Place one hand on your heart and take a deep breath.',
      'Type one thing you are grateful for.',
      'Type two more. Small and ordinary still count.',
      'Sit with these for 30 seconds.',
      'Carry that fullness with you.',
    ],
    writeSteps: {1: 1, 2: 2},
    sitStep: 3,
    readSeconds: 6,
  ),
  Mood(
    key: 'scrolling',
    label: 'Can’t stop scrolling',
    want: 'Present',
    color: Color(0xFFB07B26),
    name: '5-4-3-2-1 Sensory Reset',
    sub:
        'Pull your mind out of the feed and back into the room through your senses.',
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
    name: 'Steady Seat Breathing',
    sub: 'Let your body settle first, then a slow, even breath steadies you.',
    kind: RemedyKind.steps,
    steps: [
      'Rest your back on the chair and place your feet on the ground.',
      'Gently roll your shoulders back once, then let them drop.',
      'Unclench your jaw.',
      'Breathe gently in through your nose for 4 counts, then out through '
          'your mouth for 4. Repeat 5 times without holding or forcing your '
          'breath.',
    ],
    pauseSteps: [3],
    readSeconds: 6,
    paged: true,
    clips: [
      MoveClip(
        url:
            '/media/connect%2Fposts%2F4ff86809-85ca-447b-b05f-69d9b5dfdd1b%2F2026%2F09%2F21f91fdf-6ed3-4990-9242-b6d5c34e546c-shoulder_2_.mp4',
        steps: [2],
        until: 4,
      ),
    ],
    photos: {0: 'assets/care/nervous_seated.jpg'},
    breathHolds: {3: 5},
    breathSeconds: 8,
  ),
  Mood(
    key: 'sleep',
    label: 'Can’t switch off',
    want: 'Sleep',
    color: Color(0xFF3F7B78),
    name: '4-6 Breathing',
    sub:
        'A short in-breath and a long out-breath ease you toward rest. Let it slow you all the way down.',
    kind: RemedyKind.breath,
    rounds: 6,
    pattern: [BreathPhase('Breathe in', 4), BreathPhase('Breathe out', 6)],
  ),
];

Mood moodByKey(String key) => moods.firstWhere((m) => m.key == key);
