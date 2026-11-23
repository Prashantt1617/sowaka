import 'dart:async';

import 'package:flutter/material.dart';

import '../../../manager/data/manager_api_service.dart';
import '../../../manager/data/manager_models.dart' show LeaveBalance, LeaveBalanceItem;
import '../data/onboarding_api.dart';
import '../presentation/onboarding_kit.dart';
import '../presentation/tour_lessons.dart';
import 'joiner_details.dart' show JoinerProfileSectionScreen;
import 'joiner_parts.dart';

// ─── Sowaka tour ────────────────────────────────────────────────────────────

TourLesson? lessonOf(String? key) =>
    key == null ? null : [...joinerTourLessons, ...managerTourLessons].where((l) => l.key == key).firstOrNull;

Future<LeaveBalance?> _balance(JoinerController c) async {
  final api = c.shell.api;
  if (api is! HttpOnboardingApi) return null;
  return ManagerApiService(session: api.session).fetchLeaveBalance().then<LeaveBalance?>((b) => b).catchError((Object _) => null);
}

TourFacts _facts(JoinerController c, LeaveBalance? b) {
  double? left(LeaveBalanceItem i) => i.unpaid ? null : i.remaining;
  final manager = c.data?.meetings.where((m) => m.withRole == 'manager' && m.person != null).map((m) => m.person!.name).firstOrNull;
  return TourFacts(
    today: c.shell.now(),
    managerName: manager,
    casual: b == null ? null : left(b.casual),
    sick: b == null ? null : left(b.sick),
    earned: b == null ? null : left(b.earned),
  );
}

/// Plays a lesson (AppLesson): the drawing filled in from her record, Done
/// told to the server. It opens over the screen it was tapped on, and
/// closing it returns there (the home's card to the home, a tour row to the
/// tour). [fromTour] false (the home's card): "Back to the tour" after the
/// last step puts the tour in the lesson's place, and Back from it is the home.
Future<void> playJoinerLesson(BuildContext context, JoinerController c, String key, {bool fromTour = false}) async {
  final lesson = lessonOf(key);
  if (lesson == null) return;
  final navigator = Navigator.of(context);
  final balance = key == 'leave' ? await _balance(c) : null;
  await navigator.push<void>(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => TourLessonScreen(
        lesson: lesson,
        facts: _facts(c, balance),
        onBackToTour: fromTour
            ? null
            : () => unawaited(navigator.pushReplacement<void, void>(MaterialPageRoute(builder: (_) => JoinerTourScreen(c: c)))),
        onDone: (k) async {
          try {
            await c.api.lessonDone(k);
          } catch (_) {
            // Shown again as not done; she can replay it.
          }
          await c.load();
        },
      ),
    ),
  );
  unawaited(c.load());
}

/// Sowaka tour (App · tour): the lessons with their number (a tick once
/// done), Today / Day n / Done and Start, Play or Replay; "For managers"
/// for someone with reports.
class JoinerTourScreen extends StatelessWidget {
  const JoinerTourScreen({super.key, required this.c});

  final JoinerController c;

  @override
  Widget build(BuildContext context) => JoinerScaffold(
    c: c,
    title: 'Sowaka tour',
    body: (d) {
      final t = d.tour;
      List<Widget> rows(List<String> keys, bool manager) => [
        for (final (i, k) in keys.indexed)
          if (lessonOf(k) case final l?)
            _LessonRow(
              lesson: l,
              number: i + 1,
              done: t.done.contains(k),
              today: !manager && t.today == k,
              manager: manager,
              onTap: () => playJoinerLesson(context, c, k, fromTour: true),
            ),
      ];
      return JPage(
        onRefresh: c.load,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              JSectionHead(title: 'Sowaka tour', meta: '${t.doneCount} of ${t.lessons.length} done'),
              const SizedBox(height: 8),
              JListCard(children: withLines(rows(t.lessons, false))),
              if (t.managerLessons.isNotEmpty) ...[
                const Padding(
                  padding: EdgeInsets.fromLTRB(4, 12, 4, 8),
                  child: Text('For managers', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text3)),
                ),
                JListCard(children: withLines(rows(t.managerLessons, true))),
              ],
            ],
          ),
        ],
      );
    },
  );
}

class _LessonRow extends StatelessWidget {
  const _LessonRow({required this.lesson, required this.number, required this.done, required this.today, required this.onTap, this.manager = false});

  final TourLesson lesson;
  final int number;
  final bool done;
  final bool today;
  final bool manager;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (tint, fg) = done ? (OnbColors.successTint, OnbColors.successText) : (today ? (OnbColors.primary, Colors.white) : (OnbColors.screen, OnbColors.text2));
    final meta = done ? 'Done · ${lesson.length}' : (today ? 'Today · ${lesson.length}' : (manager ? lesson.length : 'Day $number · ${lesson.length}'));
    final cta = done ? 'Replay' : (today ? 'Start' : 'Play');
    return Semantics(
      button: true,
      label: '${lesson.title}. $meta. $cta',
      excludeSemantics: true,
      child: InkWell(
        key: ValueKey('lesson-${lesson.key}'),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 68),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(12)),
                child: done ? Icon(Icons.check_rounded, size: 18, color: fg) : Text('$number', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: fg)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(lesson.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text)),
                    const SizedBox(height: 2),
                    Text(meta, style: TextStyle(fontSize: 12, color: today ? OnbColors.primary : OnbColors.text3)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                height: 32,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: today ? OnbColors.primary : Colors.white,
                  borderRadius: BorderRadius.circular(999),
                  border: today ? null : Border.all(color: done ? OnbColors.successLine : OnbColors.lineDark),
                ),
                child: Text(cta, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: today ? Colors.white : (done ? OnbColors.successText : OnbColors.text2))),
              ),
            ],
          ),
        ),
      ),
    );
  }
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
