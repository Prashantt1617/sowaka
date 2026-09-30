import 'package:flutter/material.dart';

import '../data/care_models.dart';
import 'care_theme.dart';
import 'player_screen.dart';

/// Listen: meditations and affirmations, as two shelves.
class ListenScreen extends StatefulWidget {
  const ListenScreen({super.key, required this.catalog});

  final CareCatalog catalog;

  @override
  State<ListenScreen> createState() => _ListenScreenState();
}

class _ListenScreenState extends State<ListenScreen> {
  bool _affirmations = false;

  @override
  Widget build(BuildContext context) {
    final tracks = _affirmations
        ? widget.catalog.affirmations
        : widget.catalog.meditations;
    final icons = _affirmations
        ? [
            Icons.auto_awesome_outlined,
            Icons.favorite_border_rounded,
            Icons.local_florist_outlined,
          ]
        : [
            Icons.eco_outlined,
            Icons.wb_cloudy_outlined,
            Icons.wb_twilight_rounded,
          ];
    return CarePage(
      backLabel: 'Care',
      children: [
        const CareEyebrow('Listen'),
        const SizedBox(height: 10),
        const CareHeading('A softer place\nto put your attention.'),
        const SizedBox(height: 10),
        const CareCopy('Press pause on the noise for a little while.'),
        const SizedBox(height: 22),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            CareChoiceChip(
              'Meditations',
              selected: !_affirmations,
              onTap: () => setState(() => _affirmations = false),
            ),
            CareChoiceChip(
              'Affirmations',
              selected: _affirmations,
              onTap: () => setState(() => _affirmations = true),
            ),
          ],
        ),
        const SizedBox(height: 18),
        if (tracks.isEmpty)
          const CareNotice(
            'The shelf is being filled. Sowaka’s recordings arrive here.',
          )
        else
          for (var i = 0; i < tracks.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: CareResourceRow(
                title: tracks[i].title,
                meta: tracks[i].meta,
                icon: icons[i % icons.length],
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => PlayerScreen(
                      track: tracks[i],
                      backLabel: _affirmations ? 'Affirmations' : 'Listen',
                      kind: PlayerKind.audio,
                    ),
                  ),
                ),
              ),
            ),
      ],
    );
  }
}
