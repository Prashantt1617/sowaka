import 'package:flutter/material.dart';

import '../content/breathe_content.dart';
import 'breath_screen.dart';
import 'care_theme.dart';

/// Breathe: how are you feeling? Six moods, each with where it takes you.
class BreatheScreen extends StatelessWidget {
  const BreatheScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return CarePage(
      backLabel: 'Care',
      children: [
        const CareEyebrow('Breathe'),
        const SizedBox(height: 10),
        const CareHeading('How are you\nfeeling?', size: 25, color: CareColors.warmInk),
        const SizedBox(height: 16),
        Container(
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0xFFECE4D6)))),
          child: Column(
            children: [
              for (final mood in moods)
                InkWell(
                  key: ValueKey('mood-${mood.key}'),
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => BreathScreen(mood: mood))),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 19),
                    decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0xFFECE4D6)))),
                    child: Row(
                      children: [
                        Container(
                          width: 9,
                          height: 9,
                          decoration: BoxDecoration(
                            color: mood.color,
                            shape: BoxShape.circle,
                            boxShadow: [BoxShadow(color: mood.color.withValues(alpha: 0.13), spreadRadius: 5)],
                          ),
                        ),
                        const SizedBox(width: 18),
                        Expanded(
                          child: Text(
                            mood.label,
                            style: const TextStyle(fontFamily: careFont, color: CareColors.warmInk, fontSize: 21, fontWeight: FontWeight.w700, height: 1.15, letterSpacing: -0.2),
                          ),
                        ),
                        Text(
                          mood.want.toUpperCase(),
                          style: const TextStyle(fontFamily: careFont, color: Color(0xFFA89A88), fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.1),
                        ),
                        const SizedBox(width: 8),
                        const Icon(Icons.chevron_right_rounded, color: Color(0xFFC9BCA9), size: 20),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
