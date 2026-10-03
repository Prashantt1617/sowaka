import 'package:flutter/material.dart';

/// Move: six stretches, as getsowaka.com/breathe has them. A step opens to
/// a video where Sowaka has provided one, the site's photo until then; a
/// pause step opens to a countdown parsed from its own words.
class Stretch {
  const Stretch({
    required this.key,
    required this.zone,
    required this.name,
    required this.sub,
    required this.steps,
    required this.pauseSteps,
    required this.imageDir,
    required this.chipBackground,
    required this.chipForeground,
    required this.zoneColor,
    this.holdLabel = 'Hold',
    this.holdPing = false,
    this.breathCycles = false,
    this.tagText,
    this.photos = const {},
    this.wordsOnly = false,
    this.breathHolds = const {},
    this.breathSeconds = 5,
  });

  final String key;

  /// The chip and the tag: 'Neck'.
  final String zone;
  final String name;
  final String sub;
  final List<String> steps;

  /// Zero-based indexes of the steps that are a hold, not a move.
  final List<int> pauseSteps;

  /// The site's photo folder; `https://www.getsowaka.com/breathe/image/<dir>/<n>.jpeg`.
  final String imageDir;
  final Color chipBackground;
  final Color chipForeground;
  final Color zoneColor;

  /// The word on a hold's countdown: 'Hold', or 'Breathe' where the hold is
  /// a rest with the eyes closed.
  final String holdLabel;

  /// A ping when a hold ends, for a hold done with the eyes closed.
  final bool holdPing;

  /// A hold counted in breaths ('3 deep breaths') shows each breath in and
  /// out, not seconds.
  final bool breathCycles;

  /// The chip over the name, when it is not the body zone.
  final String? tagText;

  /// A photo for a step without a clip, by index: a `/media` path, https
  /// address or app asset.
  final Map<int, String> photos;

  /// A step with neither clip nor photo shows its words alone, with no box
  /// above them.
  final bool wordsOnly;

  /// Holds breathed rather than counted, by index: how many breaths each.
  final Map<int, int> breathHolds;

  /// How long one of those breaths takes, half in and half out.
  final int breathSeconds;

  String get tag => tagText ?? 'Body · $zone';

  String photoUrl(int step) =>
      'https://www.getsowaka.com/breathe/image/$imageDir/${step + 1}.jpeg';

  bool isPause(int step) => pauseSteps.contains(step);
}

const stretches = [
  Stretch(
    key: 'eyes',
    zone: 'Eyes',
    name: 'Palming & Reset',
    sub: 'Your eyes are muscles too — give them a moment of rest.',
    steps: [
      'Rub your palms together quickly until they feel warm.',
      'Close your eyes and cup your warm palms gently over them.',
      'Keep your eyes closed, slowly breathe for 30 sec. Open your eyes when you hear a ping.',
      'Open your eyes. Trace a slow figure-eight in the air with your gaze.',
    ],
    pauseSteps: [2],
    imageDir: 'eyes',
    chipBackground: Color(0xFFF5ECDB),
    chipForeground: Color(0xFFB07B26),
    zoneColor: Color(0xFFC98A2E),
    holdLabel: 'Breathe',
    holdPing: true,
  ),
  Stretch(
    key: 'neck',
    zone: 'Neck',
    name: 'Neck Release',
    sub: 'Unwind hours of desk tension in under two minutes.',
    steps: [
      'Sit tall. Slowly drop your right ear toward your right shoulder.',
      'Hold for 3 deep breaths — feel the left side of your neck soften.',
      'Roll your chin slowly down to your chest. Breathe.',
      'Continue over to your left shoulder. Hold for 3 breaths.',
      'Add 3 shoulder rolls forward, 3 back. Shake it out.',
    ],
    pauseSteps: [1, 3],
    imageDir: 'neck',
    chipBackground: Color(0xFFEDE5F0),
    chipForeground: Color(0xFF7A5C90),
    zoneColor: Color(0xFF8A6AA0),
    breathCycles: true,
  ),
  Stretch(
    key: 'shoulders',
    zone: 'Shoulders',
    name: 'Shoulder Release',
    sub: 'Melt the tension you carry up around your ears.',
    steps: [
      'Roll both shoulders up toward your ears, then back and down — 5 slow rolls.',
      'Reverse — roll them forward and down 5 times.',
      'Bring your right arm across your chest; draw it in with your left hand. Hold 20 seconds.',
      'Switch — left arm across your chest. Hold 20 seconds.',
      'Reach both arms overhead, interlace your fingers and press your palms to the sky. Hold 3 breaths.',
    ],
    pauseSteps: [2, 3],
    imageDir: 'shoulder',
    chipBackground: Color(0xFFE2E9F2),
    chipForeground: Color(0xFF4A6488),
    zoneColor: Color(0xFF5E7CA3),
  ),
  Stretch(
    key: 'spine',
    zone: 'Spine & Back',
    name: 'Full Spine Sequence',
    sub: 'Stretch your spine in every direction it can move.',
    steps: [
      'Flexion — round your spine forward, tuck your chin, draw your navel in. Hold 3 breaths.',
      'Extension — arch back, lift your chest and gaze gently upward. Hold 3 breaths.',
      'Side bend left — reach your right arm overhead and lean left. Hold 3 breaths.',
      'Side bend right — reach your left arm overhead and lean right. Hold 3 breaths.',
      'Rotation left — sit tall and twist gently to the left. Hold 3 breaths.',
      'Rotation right — sit tall and twist gently to the right. Hold 3 breaths.',
      'Return to centre and rest. Let your spine settle for 30 seconds.',
    ],
    pauseSteps: [6],
    imageDir: 'spineaandback',
    chipBackground: Color(0xFFF6E2D6),
    chipForeground: Color(0xFFB0502E),
    zoneColor: Color(0xFFBE5A36),
    breathCycles: true,
  ),
  Stretch(
    key: 'wrists',
    zone: 'Wrists',
    name: 'Wrist Reset',
    sub: 'Essential for anyone who types or scrolls all day.',
    steps: [
      'Extend both arms in front of you, palms facing down.',
      'Make slow circles with both wrists — 5 in each direction.',
      'Shake your hands out loosely for 5 seconds.',
      'Press your palms together at chest height.',
      'Slowly lower your hands toward your waist, palms together. Hold 20s.',
    ],
    pauseSteps: [4],
    imageDir: 'wrist',
    chipBackground: Color(0xFFDEEBE9),
    chipForeground: Color(0xFF3F7B78),
    zoneColor: Color(0xFF4F8C89),
  ),
  Stretch(
    key: 'legs',
    zone: 'Legs',
    name: 'Legs Reset',
    sub: 'Your legs carry you everywhere — give them this.',
    steps: [
      'Sit at the very edge of your chair.',
      'Straighten your right leg, heel resting on the floor.',
      'Sit tall and hinge slowly forward from your hips — not your back.',
      'Reach toward your foot. Hold 20 seconds, breathing deeply.',
      'Switch legs. Repeat twice on each side.',
      'Chair squats — stand in front of the seat, feet hip-width apart.',
      'Lower slowly as if to sit, lightly tap the seat, then stand tall. Do 10 reps.',
      'Stand and rest, hands on hips. Breathe for 20 seconds.',
    ],
    pauseSteps: [3, 7],
    imageDir: 'legs',
    chipBackground: Color(0xFFE8EBDF),
    chipForeground: Color(0xFF566346),
    zoneColor: Color(0xFF7E8B6E),
  ),
];

Stretch stretchByKey(String key) => stretches.firstWhere((s) => s.key == key);

/// Seconds to hold for a pause step, read from its own instruction: '20
/// seconds' is 20, '3 breaths' is 15, anything else is half a minute.
int pauseSeconds(String text) {
  final t = text.toLowerCase();
  final seconds = RegExp(r'(\d+)\s*(?:s\b|sec|second)').firstMatch(t);
  if (seconds != null) return int.parse(seconds.group(1)!);
  final breaths = holdBreaths(text);
  if (breaths != null) return breaths * 5;
  return 30;
}

/// Breaths a hold counts in its own words: '3 deep breaths' is 3. Null when
/// it is timed some other way.
int? holdBreaths(String text) {
  final t = text.toLowerCase();
  if (RegExp(r'(\d+)\s*(?:s\b|sec|second)').hasMatch(t)) return null;
  final breaths = RegExp(r'(\d+)\s*(?:deep\s*)?breath').firstMatch(t);
  return breaths == null ? null : int.parse(breaths.group(1)!);
}

/// One tappable zone on the silhouette, in the artwork's 860 by 1594 space.
class BodyZone {
  const BodyZone({
    required this.stretchKey,
    required this.ellipses,
    required this.dots,
  });

  final String stretchKey;

  /// (cx, cy, rx, ry)
  final List<List<double>> ellipses;

  /// (cx, cy)
  final List<List<double>> dots;
}

const bodyZones = [
  BodyZone(
    stretchKey: 'eyes',
    ellipses: [
      [415, 120, 82, 100],
    ],
    dots: [
      [415, 120],
    ],
  ),
  BodyZone(
    stretchKey: 'neck',
    ellipses: [
      [415, 268, 78, 66],
    ],
    dots: [
      [415, 268],
    ],
  ),
  BodyZone(
    stretchKey: 'shoulders',
    ellipses: [
      [312, 350, 78, 54],
      [522, 332, 78, 54],
    ],
    dots: [
      [312, 350],
      [522, 332],
    ],
  ),
  BodyZone(
    stretchKey: 'spine',
    ellipses: [
      [428, 620, 80, 172],
    ],
    dots: [
      [428, 598],
    ],
  ),
  BodyZone(
    stretchKey: 'wrists',
    ellipses: [
      [120, 700, 66, 52],
      [765, 655, 66, 52],
    ],
    dots: [
      [120, 700],
      [765, 655],
    ],
  ),
  BodyZone(
    stretchKey: 'legs',
    ellipses: [
      [445, 1180, 104, 274],
    ],
    dots: [
      [445, 1180],
    ],
  ),
];

const bodyArtWidth = 860.0;
const bodyArtHeight = 1594.0;
