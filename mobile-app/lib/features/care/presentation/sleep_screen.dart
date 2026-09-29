import 'package:flutter/material.dart';

import '../data/care_models.dart';
import 'care_theme.dart';
import 'player_screen.dart';

/// Sleep: guided rest, stories, sounds.
class SleepScreen extends StatefulWidget {
  const SleepScreen({super.key, required this.catalog});

  final CareCatalog catalog;

  @override
  State<SleepScreen> createState() => _SleepScreenState();
}

class _SleepScreenState extends State<SleepScreen> {
  String _shelf = 'Guided rest';

  @override
  Widget build(BuildContext context) {
    final tracks = switch (_shelf) {
      'Stories' => widget.catalog.stories,
      'Sounds' => widget.catalog.sounds,
      _ => widget.catalog.rest,
    };
    final icon = switch (_shelf) {
      'Stories' => Icons.auto_stories_outlined,
      'Sounds' => Icons.water_drop_outlined,
      _ => Icons.nightlight_outlined,
    };
    return CarePage(
      backLabel: 'Care',
      children: [
        const CareEyebrow('Sleep'),
        const SizedBox(height: 10),
        const CareHeading('Let the day\ngently end.'),
        const SizedBox(height: 10),
        const CareCopy('Make a little room for rest.'),
        const SizedBox(height: 22),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final shelf in const ['Guided rest', 'Stories', 'Sounds'])
              CareChoiceChip(shelf, selected: _shelf == shelf, onTap: () => setState(() => _shelf = shelf)),
          ],
        ),
        const SizedBox(height: 18),
        if (tracks.isEmpty)
          const CareNotice('The shelf is being filled. Sowaka’s recordings arrive here.')
        else
          for (final track in tracks)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: CareResourceRow(
                title: track.title,
                meta: track.meta,
                icon: icon,
                tint: CareColors.night,
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => PlayerScreen(track: track, backLabel: 'Sleep', kind: PlayerKind.audio))),
              ),
            ),
      ],
    );
  }
}
