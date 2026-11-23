import 'dart:async';

import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import 'package:video_player/video_player.dart';

import '../../../manager/data/manager_api_service.dart';
import '../../../manager/data/manager_models.dart' show LeaveBalance, LeaveBalanceItem;
import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../presentation/onboarding_kit.dart';
import '../presentation/tour_lessons.dart';
import 'joiner_lens.dart';
import 'joiner_models.dart';
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
/// told to the server. From the home's card it opens over the tour, so
/// closing it lands on the tour, as the canvas's close does.
Future<void> playJoinerLesson(BuildContext context, JoinerController c, String key, {bool overTour = true}) async {
  final lesson = lessonOf(key);
  if (lesson == null) return;
  final navigator = Navigator.of(context);
  if (overTour) unawaited(navigator.push<void>(MaterialPageRoute(builder: (_) => JoinerTourScreen(c: c))));
  final balance = key == 'leave' ? await _balance(c) : null;
  await navigator.push<void>(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => TourLessonScreen(
        lesson: lesson,
        facts: _facts(c, balance),
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
              onTap: () => playJoinerLesson(context, c, k, overTour: false),
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

// ─── Watch list ─────────────────────────────────────────────────────────────

const _tints = [OnbColors.primary, jGreenDark, OnbColors.amber, OnbColors.blue, OnbColors.violet];

Color watchColor(JoinerWatch w, int i) => switch (w.bg) {
  'rust' => OnbColors.rust,
  'blue' => OnbColors.primary,
  'ink' => OnbColors.text,
  'green' => jGreenDark,
  'purple' => OnbColors.violet,
  'sand' => OnbColors.amber,
  _ => _tints[i % _tints.length],
};

/// Opens an item and marks it watched (the server keeps it once).
Future<void> openWatch(BuildContext context, JoinerController c, JoinerWatch w) async {
  unawaited(c.api.markWatched(w.id).then((_) => c.load()).catchError((Object _) {}));
  if (w.isPdf) {
    final url = w.url;
    if (url == null) return;
    try {
      final bytes = await c.api.download(url);
      await Printing.sharePdf(bytes: bytes, filename: '${w.title}.pdf');
    } catch (e) {
      if (context.mounted) showAppToast(context, onboardingErrorText(e));
    }
    return;
  }
  await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => _WatchPage(c: c, item: w)));
}

/// Watch list (App · watch): "About" and the company, its videos as coloured
/// tiles, and Trainings (a video or a PDF) with Watch or Read.
class JoinerWatchScreen extends StatelessWidget {
  const JoinerWatchScreen({super.key, required this.c});

  final JoinerController c;

  @override
  Widget build(BuildContext context) => JoinerScaffold(
    c: c,
    title: 'Watch list',
    body: (d) {
      final lens = JoinerLens(d, c.lens);
      final videos = lens.videos;
      final trainings = lens.trainings;
      return JPage(
        onRefresh: c.load,
        children: [
          if (videos.isNotEmpty)
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                JSectionHead(title: 'About ${d.companyName}', meta: plural(videos.length, 'video', 'videos')),
                const SizedBox(height: 8),
                for (var i = 0; i < videos.length; i += 2) ...[
                  if (i > 0) const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(child: _WatchTile(item: videos[i], color: watchColor(videos[i], i), onTap: () => openWatch(context, c, videos[i]))),
                      const SizedBox(width: 10),
                      Expanded(
                        child: i + 1 < videos.length
                            ? _WatchTile(item: videos[i + 1], color: watchColor(videos[i + 1], i + 1), onTap: () => openWatch(context, c, videos[i + 1]))
                            : const SizedBox.shrink(),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          if (trainings.isNotEmpty)
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                JSectionHead(title: 'Trainings', meta: plural(trainings.length, 'training', 'trainings')),
                const SizedBox(height: 8),
                JListCard(
                  children: withLines([
                    for (final t in trainings)
                      Semantics(
                        button: true,
                        label: '${t.title}. ${t.length}. ${t.isPdf ? 'Read' : 'Watch'}',
                        excludeSemantics: true,
                        child: InkWell(
                          key: ValueKey('training-${t.id}'),
                          onTap: () => openWatch(context, c, t),
                          child: Container(
                            constraints: const BoxConstraints(minHeight: 64),
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            child: Row(
                              children: [
                                t.isPdf
                                    ? const JIconChip(icon: Icons.description_outlined, tint: OnbColors.blueTint, color: OnbColors.blue)
                                    : const JIconChip(icon: Icons.play_arrow_rounded, tint: Color(0xFFFDECE7), color: OnbColors.rust),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(t.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text)),
                                      if (t.length.isNotEmpty) ...[
                                        const SizedBox(height: 2),
                                        Text(t.length, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                                      ],
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 8),
                                JVerbPill(t.isPdf ? 'Read' : 'Watch'),
                              ],
                            ),
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

class _WatchTile extends StatelessWidget {
  const _WatchTile({required this.item, required this.color, required this.onTap});

  final JoinerWatch item;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'Play ${item.title}. ${item.length}',
    excludeSemantics: true,
    child: Material(
      key: ValueKey('watch-${item.id}'),
      color: color,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          height: 160,
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: const BoxDecoration(color: Color(0x38FFFFFF), shape: BoxShape.circle),
                    child: const Icon(Icons.play_arrow_rounded, size: 18, color: Colors.white),
                  ),
                  const Spacer(),
                  Text(item.length, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Colors.white)),
                ],
              ),
              Text(item.title, maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15, height: 1.25, fontWeight: FontWeight.w700, color: Colors.white)),
            ],
          ),
        ),
      ),
    ),
  );
}

/// One watch-list item: the video (played from the server with her sign-in),
/// the image, or the text on its colour.
class _WatchPage extends StatefulWidget {
  const _WatchPage({required this.c, required this.item});

  final JoinerController c;
  final JoinerWatch item;

  @override
  State<_WatchPage> createState() => _WatchPageState();
}

class _WatchPageState extends State<_WatchPage> {
  VideoPlayerController? _video;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    final url = widget.item.url;
    final media = url == null ? null : widget.c.api.media(url);
    if (widget.item.type == 'video' && media != null) {
      final v = VideoPlayerController.networkUrl(media.uri, httpHeaders: media.headers);
      _video = v;
      v.initialize().then((_) {
        if (mounted) setState(() {});
        unawaited(v.play());
      }).catchError((Object _) {
        if (mounted) setState(() => _failed = true);
      });
    }
  }

  @override
  void dispose() {
    unawaited(_video?.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final w = widget.item;
    final v = _video;
    final url = w.url;
    final media = url == null ? null : widget.c.api.media(url);
    Widget art;
    if (v != null) {
      art = _failed
          ? const AspectRatio(aspectRatio: 16 / 9, child: ColoredBox(color: Colors.black, child: Center(child: Icon(Icons.error_outline_rounded, color: Colors.white))))
          : v.value.isInitialized
          ? GestureDetector(
              onTap: () => setState(() => v.value.isPlaying ? v.pause() : v.play()),
              child: AspectRatio(aspectRatio: v.value.aspectRatio, child: VideoPlayer(v)),
            )
          : const AspectRatio(aspectRatio: 16 / 9, child: ColoredBox(color: Colors.black, child: Center(child: CircularProgressIndicator(color: Colors.white))));
    } else if (w.type == 'image' && media != null) {
      art = Image.network(media.uri.toString(), headers: media.headers, fit: BoxFit.cover);
    } else {
      art = Container(
        padding: const EdgeInsets.all(20),
        color: watchColor(w, 0),
        constraints: const BoxConstraints(minHeight: 200),
        alignment: Alignment.center,
        child: Text(w.text ?? '', textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, height: 1.35, fontWeight: FontWeight.w700, color: Colors.white)),
      );
    }
    return OnbScaffold(
      shell: widget.c.shell,
      title: 'Watch list',
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          ClipRRect(borderRadius: BorderRadius.circular(18), child: art),
          const SizedBox(height: 12),
          Text(w.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text)),
        ],
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
                      // Each section opens the profile, where it is filled in (canvas: every row is a link).
                      onTap: c.shell.openAppScreen == null ? null : () => c.shell.openAppScreen!('profile'),
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
                          const SizedBox(width: 4),
                          const Icon(Icons.chevron_right_rounded, size: 18, color: OnbColors.text3),
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
