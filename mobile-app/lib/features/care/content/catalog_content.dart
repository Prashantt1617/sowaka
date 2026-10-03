import 'package:flutter/material.dart';

import '../data/care_models.dart';
import '../presentation/care_theme.dart';
import 'breathe_content.dart';
import 'move_content.dart';

/// Move and Breathe as the catalogue words them, drawn with the app's own
/// colours, zones and pose pictures. The built-in text stands in when the
/// catalogue has nothing to say.
List<Stretch> stretchesFrom(CareCatalog catalog) {
  if (catalog.stretches.isEmpty) return stretches;
  return [
    for (final base in stretches)
      () {
        final row = catalog.stretches
            .where((r) => r['key'] == base.key)
            .firstOrNull;
        if (row == null) return base;
        final steps = [
          for (final s in (row['steps'] as List<dynamic>? ?? const [])) '$s',
        ];
        return Stretch(
          key: base.key,
          zone: row['zone'] as String? ?? base.zone,
          name: row['name'] as String? ?? base.name,
          sub: row['sub'] as String? ?? base.sub,
          steps: steps.isEmpty ? base.steps : steps,
          // The catalogue counts steps from 1; the app from 0.
          pauseSteps: [
            for (final n in (row['pauseSteps'] as List<dynamic>? ?? const []))
              (n as num).toInt() - 1,
          ],
          imageDir: base.imageDir,
          chipBackground: base.chipBackground,
          chipForeground: base.chipForeground,
          zoneColor: base.zoneColor,
          holdLabel: row['holdLabel'] as String? ?? base.holdLabel,
          holdPing: row['holdPing'] as bool? ?? base.holdPing,
          breathCycles: row['breathCycles'] as bool? ?? base.breathCycles,
        );
      }(),
  ];
}

List<Mood> moodsFrom(CareCatalog catalog) {
  if (catalog.moods.isEmpty) return moods;
  return [
    for (final base in moods)
      () {
        final row = catalog.moods
            .where((r) => r['key'] == base.key)
            .firstOrNull;
        if (row == null) return base;
        final pattern = [
          for (final p in (row['pattern'] as List<dynamic>? ?? const []))
            if (p is List && p.length == 2)
              BreathPhase('${p[0]}', (p[1] as num).toInt()),
        ];
        final steps = [
          for (final s in (row['steps'] as List<dynamic>? ?? const [])) '$s',
        ];
        final isBreath =
            (row['kind'] as String? ??
                (base.kind == RemedyKind.breath ? 'breath' : 'steps')) ==
            'breath';
        return Mood(
          key: base.key,
          label: row['label'] as String? ?? base.label,
          want: row['want'] as String? ?? base.want,
          color: base.color,
          name: row['name'] as String? ?? base.name,
          sub: row['sub'] as String? ?? base.sub,
          kind: isBreath ? RemedyKind.breath : RemedyKind.steps,
          // An empty note in the catalogue means none, not the app's own.
          note: row.containsKey('note')
              ? ((row['note'] as String?)?.trim().isEmpty ?? true
                    ? null
                    : row['note'] as String)
              : base.note,
          pattern: pattern.isEmpty ? base.pattern : pattern,
          rounds: (row['rounds'] as num?)?.toInt() ?? base.rounds,
          square:
              row['square'] == true || (row['square'] == null && base.square),
          steps: steps.isEmpty ? base.steps : steps,
          pauseSteps: [
            for (final n in (row['pauseSteps'] as List<dynamic>? ?? const []))
              (n as num).toInt() - 1,
          ],
          poseAsset: base.poseAsset,
          poseUrl: row['poseUrl'] as String?,
          // The catalogue counts steps from 1; the app from 0.
          writeSteps: row['writeSteps'] is Map
              ? {
                  for (final e in (row['writeSteps'] as Map).entries)
                    if (int.tryParse('${e.key}') case final n? when n > 0)
                      n - 1: (e.value as num).toInt(),
                }
              : base.writeSteps,
          sitStep: row['sitStep'] is num
              ? (row['sitStep'] as num).toInt() - 1
              : base.sitStep,
          sitSeconds: (row['sitSeconds'] as num?)?.toInt() ?? base.sitSeconds,
          readSeconds:
              (row['readSeconds'] as num?)?.toInt() ?? base.readSeconds,
          paged: row['paged'] as bool? ?? base.paged,
          clips: row['clips'] is List
              ? [
                  for (final c in row['clips'] as List)
                    if (c is Map<String, dynamic>) MoveClip.fromJson(c),
                ]
              : base.clips,
          photos: row['photos'] is Map
              ? {
                  for (final e in (row['photos'] as Map).entries)
                    if (int.tryParse('${e.key}') case final n? when n > 0)
                      n - 1: '${e.value}',
                }
              : base.photos,
          breathHolds: row['breathHolds'] is Map
              ? {
                  for (final e in (row['breathHolds'] as Map).entries)
                    if (int.tryParse('${e.key}') case final n? when n > 0)
                      n - 1: (e.value as num).toInt(),
                }
              : base.breathHolds,
          breathSeconds:
              (row['breathSeconds'] as num?)?.toInt() ?? base.breathSeconds,
        );
      }(),
  ];
}

/// A Breathe exercise that runs one step a page, as the stretch Move's
/// screen plays: its photos and clips on top, a breathed hold as the disc.
Stretch stretchFromMood(Mood mood) => Stretch(
  key: mood.key,
  zone: mood.label,
  name: mood.name,
  sub: mood.sub,
  steps: mood.steps,
  pauseSteps: mood.pauseSteps,
  imageDir: '',
  chipBackground: CareColors.blueTint,
  chipForeground: CareColors.blue,
  zoneColor: mood.color,
  tagText: mood.tag,
  photos: mood.photos,
  wordsOnly: true,
  breathHolds: mood.breathHolds,
  breathSeconds: mood.breathSeconds,
);

/// Icons for the six life areas, by id; the words come from the catalogue.
IconData lifeAreaIcon(String id) => switch (id) {
  'work' => Icons.work_rounded,
  'movement' => Icons.directions_run_rounded,
  'hobbies' => Icons.palette_rounded,
  'social' => Icons.groups_rounded,
  'relationship' => Icons.favorite_rounded,
  'family' => Icons.family_restroom_rounded,
  _ => Icons.circle_outlined,
};
