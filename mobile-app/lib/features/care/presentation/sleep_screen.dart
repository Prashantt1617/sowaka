import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../data/care_models.dart';
import 'care_theme.dart';
import 'player_screen.dart';

/// Sleep: the night sky, and the sounds to fall asleep to.
class SleepScreen extends StatelessWidget {
  const SleepScreen({super.key, required this.catalog});

  final CareCatalog catalog;

  @override
  Widget build(BuildContext context) {
    final sounds = catalog.sounds;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: const Color(0xFF0B1118),
        body: Stack(
          fit: StackFit.expand,
          children: [
            Image.asset(
              'assets/care/sleep_background.jpg',
              fit: BoxFit.cover,
              alignment: Alignment.topCenter,
            ),
            // A little darker at the top and bottom, so the words read on
            // any part of the sky.
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Color(0x80000000),
                    Color(0x14000000),
                    Color(0x99000000),
                  ],
                  stops: [0, 0.45, 1],
                ),
              ),
            ),
            SafeArea(
              bottom: false,
              child: ListView(
                // Inside the app the page runs under the status bar and the
                // app's back arrow, which float over the sky.
                padding: EdgeInsets.fromLTRB(
                  20,
                  careWebPages && careTopInset > 0 ? careTopInset + 52 : 8,
                  20,
                  32,
                ),
                children: [
                  // The app's bar already says where you are on the web.
                  if (!careWebPages) ...[
                    Row(
                      children: [
                        Expanded(
                          child: CareBackLink(
                            'Care',
                            color: Colors.white70,
                            onTap: () => Navigator.of(context).maybePop(),
                          ),
                        ),
                        const Text(
                          'Sleep',
                          style: TextStyle(
                            fontFamily: careFont,
                            color: Colors.white70,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                  ],
                  const CareHeading(
                    'Let the day\ngently end.',
                    color: Colors.white,
                  ),
                  const SizedBox(height: 10),
                  const CareCopy(
                    'Make a little room for rest.',
                    size: 14,
                    color: Colors.white70,
                  ),
                  const SizedBox(height: 28),
                  if (sounds.isEmpty)
                    const CareCopy(
                      'The sounds are on their way.',
                      size: 14,
                      color: Colors.white70,
                    )
                  else
                    for (final track in sounds)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _SoundRow(
                          track: track,
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => PlayerScreen(
                                track: track,
                                backLabel: 'Sleep',
                                kind: PlayerKind.audio,
                                night: true,
                              ),
                            ),
                          ),
                        ),
                      ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One sound, as a pane of frosted glass over the sky.
class _SoundRow extends StatelessWidget {
  const _SoundRow({required this.track, required this.onTap});

  final CareTrack track;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.10),
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        key: ValueKey('sound-${track.id}'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: Colors.white.withValues(alpha: 0.16)),
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.water_drop_outlined,
                  color: Colors.white,
                  size: 22,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      track.title,
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: Colors.white,
                        fontSize: 15.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      track.meta,
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: Colors.white70,
                        fontSize: 12.5,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: Colors.white54),
            ],
          ),
        ),
      ),
    );
  }
}
