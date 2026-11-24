import 'dart:async';

import 'package:flutter/material.dart';

import '../../../app_tour/app_tour.dart';
import '../data/lifecycle_me_store.dart';
import '../presentation/onboarding_kit.dart';
import 'joiner_details.dart' show JoinerProfileSectionScreen;
import 'joiner_parts.dart';

// ─── Sowaka tour ────────────────────────────────────────────────────────────

/// The Sowaka tour (the spotlight tour over the app) from the joiner's tile,
/// card or task: its start card, back over the tabs. Once she reaches the
/// finish card every lesson the server counts is marked done, so the tile
/// reads Done.
Future<void> startJoinerTour(BuildContext context, JoinerController c) {
  final api = c.api;
  final tour = c.data?.tour;
  final pending = [
    if (tour != null)
      for (final k in [...tour.lessons, ...tour.managerLessons])
        if (!tour.done.contains(k)) k,
  ];
  return AppTour.start(
    context,
    onComplete: () async {
      for (final k in pending) {
        try {
          await api.lessonDone(k);
        } catch (_) {
          // Shown as not done; the tour can be taken again from the tile.
        }
      }
      unawaited(LifecycleMeStore.instance.refresh(c.shell.api));
    },
  );
}

// ─── Devices and accesses ───────────────────────────────────────────────────

IconData deviceIcon(String title) {
  final t = title.toLowerCase();
  if (t.contains('laptop') || t.contains('computer')) return Icons.laptop_outlined;
  if (t.contains('email') || t.contains('mail')) return Icons.mail_outline_rounded;
  if (t.contains('wi-fi') || t.contains('wifi')) return Icons.wifi_rounded;
  if (t.contains('sowaka') || t.contains('app')) return Icons.phone_iphone_rounded;
  return Icons.key_outlined;
}

/// Devices and accesses (App · access): each with Ready or Setting up.
class JoinerDevicesScreen extends StatelessWidget {
  const JoinerDevicesScreen({super.key, required this.c});

  final JoinerController c;

  @override
  Widget build(BuildContext context) => JoinerScaffold(
    c: c,
    title: 'Devices and accesses',
    body: (d) {
      final ready = d.devices.where((x) => x.ready).length;
      return JPage(
        onRefresh: c.load,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              JSectionHead(title: 'Your devices and accesses', meta: '$ready of ${d.devices.length} ready'),
              const SizedBox(height: 8),
              if (d.devices.isNotEmpty)
                JListCard(
                  children: withLines([
                    for (final x in d.devices)
                      Container(
                        key: ValueKey('device-${x.id}'),
                        constraints: const BoxConstraints(minHeight: 56),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        child: Row(
                          children: [
                            JIconChip(icon: deviceIcon(x.title), tint: OnbColors.screen, color: OnbColors.text2),
                            const SizedBox(width: 12),
                            Expanded(child: Text(x.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text))),
                            Container(
                              height: 26,
                              padding: const EdgeInsets.symmetric(horizontal: 10),
                              alignment: Alignment.center,
                              decoration: BoxDecoration(color: x.ready ? OnbColors.successTint : OnbColors.amberTint, borderRadius: BorderRadius.circular(999)),
                              child: Text(
                                x.ready ? 'Ready' : 'Setting up',
                                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: x.ready ? OnbColors.successText : OnbColors.amber),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ]),
                ),
            ],
          ),
        ],
      );
    },
  );
}

// ─── Your profile ───────────────────────────────────────────────────────────

/// Your profile (App · profile): how far along, then the seven sections,
/// each Done, To do or By HR.
class JoinerProfileScreen extends StatelessWidget {
  const JoinerProfileScreen({super.key, required this.c});

  final JoinerController c;

  @override
  Widget build(BuildContext context) => JoinerScaffold(
    c: c,
    title: 'Your profile',
    body: (d) {
      final p = d.profile;
      final full = p.pct >= 100;
      return JPage(
        onRefresh: c.load,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: OnbColors.line)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: [
                        Expanded(child: Text(full ? 'All done' : 'Your profile', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: OnbColors.text))),
                        Text(full ? 'All done' : '${p.done} of ${p.total} sections done', style: TextStyle(fontSize: 12, color: full ? OnbColors.successText : OnbColors.text3)),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(child: JBar(value: p.pct / 100, color: full ? OnbColors.successDot : OnbColors.amber, height: 8)),
                        const SizedBox(width: 10),
                        Text('${p.pct}%', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: OnbColors.text)),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              JListCard(
                children: withLines([
                  for (final s in p.sections)
                    InkWell(
                      key: ValueKey('section-${s.key}'),
                      // Each section opens over this screen (canvas: every row is a link): one
                      // left empty before joining is filled here once, the rest read only. Back
                      // returns here, read again.
                      onTap: () => pushJoiner(context, c, JoinerProfileSectionScreen(c: c, section: s.key, title: s.title)),
                      child: Container(
                        constraints: const BoxConstraints(minHeight: 56),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        child: Row(
                          children: [
                            s.state == 'todo'
                                ? Container(
                                    width: 24,
                                    height: 24,
                                    decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: OnbColors.lineDark, width: 2)),
                                  )
                                : const JDoneDot(size: 24),
                            const SizedBox(width: 12),
                            Expanded(child: Text(s.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text))),
                            Text(
                              switch (s.state) {
                                'done' => 'Done',
                                'by_hr' => 'By HR',
                                _ => 'To do',
                              },
                              style: TextStyle(fontSize: 12, color: s.state == 'todo' ? OnbColors.text3 : OnbColors.successText),
                            ),
                          ],
                        ),
                      ),
                    ),
                ]),
              ),
            ],
          ),
        ],
      );
    },
  );
}
