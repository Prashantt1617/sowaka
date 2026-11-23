import 'dart:async';

import 'package:flutter/material.dart';
import 'package:printing/printing.dart';

import '../../../policies/data/policies_api_service.dart';
import '../../../policies/presentation/policies_ack_screen.dart';
import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../presentation/first_punch.dart' show FirstPunchTour;
import '../presentation/links.dart' show openExternalLink;
import '../presentation/onboarding_kit.dart';
import 'joiner_form.dart';
import 'joiner_lens.dart';
import 'joiner_models.dart';
import 'joiner_more.dart' show JoinerTourScreen;
import 'joiner_parts.dart';

/// Tasks (New joiner canvas, App · tasks): "Tasks for you", the template's
/// list by when it is due, what is left from earlier on top ("From Day 1"),
/// COMING UP, a lock with "Opens in …", a tick once done, and each open row
/// ending in its verb: Start, Continue, Review, Read, Sign or Open.
class JoinerTasksScreen extends StatelessWidget {
  const JoinerTasksScreen({super.key, required this.c});

  final JoinerController c;

  @override
  Widget build(BuildContext context) => JoinerScaffold(
    c: c,
    title: 'Tasks',
    body: (d) {
      final lens = JoinerLens(d, c.lens);
      final rows = lens.taskRows;
      return JPage(
        onRefresh: c.load,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              JSectionHead(title: 'Tasks for you', meta: lens.tasksMeta),
              const SizedBox(height: 8),
              if (rows.isNotEmpty)
                JListCard(
                  children: withLines([
                    for (final r in rows) ...[
                      if (r.head != null) JStrip(r.head!),
                      JoinerTaskRow(row: r, onTap: () => openJoinerTask(context, c, r.item)),
                    ],
                  ]),
                ),
            ],
          ),
        ],
      );
    },
  );
}

/// The icon and tint a task wears, by what it is.
(IconData, Color, Color) taskIcon(JoinerTask t) {
  if (t.id.startsWith('letter:')) return (Icons.description_outlined, OnbColors.successTint, jGreenDark);
  if (t.policies) return (Icons.fact_check_outlined, OnbColors.blueTint, OnbColors.blue);
  return switch (t.type) {
    'sign' => (Icons.draw_outlined, const Color(0xFFFDECE7), OnbColors.rust),
    'review' => (Icons.visibility_outlined, OnbColors.violetTint, OnbColors.violet),
    'ack' => (Icons.description_outlined, OnbColors.blueTint, OnbColors.blue),
    'other' || 'form' => (Icons.link_rounded, OnbColors.screen, OnbColors.text2),
    _ => switch (t.screen) {
      'profile' || 'punch' => (Icons.person_outline_rounded, OnbColors.successTint, jGreenDark),
      'payroll' => (Icons.account_balance_outlined, OnbColors.blueTint, OnbColors.blue),
      'leave' || 'overtime' => (Icons.event_outlined, OnbColors.blueTint, OnbColors.blue),
      _ => (Icons.description_outlined, OnbColors.amberTint, OnbColors.amber),
    },
  };
}

class JoinerTaskRow extends StatelessWidget {
  const JoinerTaskRow({super.key, required this.row, required this.onTap});

  final LensRow<JoinerTask> row;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = row.item;
    final (icon, tint, fg) = taskIcon(t);
    final done = row.done;
    final p = (t.progressDone, t.progressTotal);
    final bar = !t.policies && !done && !row.locked && p.$1 != null && p.$2 != null && p.$2! > 0 && p.$1! > 0 ? p.$1! / p.$2! : null;
    final meta = row.sub ?? (t.policies && p.$1 != null ? '${p.$1} of ${p.$2} done' : t.meta);
    final open = !done && !row.locked;
    return Opacity(
      opacity: row.locked ? 0.6 : 1,
      child: Semantics(
        button: !row.locked,
        label: [t.title, ?meta, ?row.pill, if (done) 'done', if (row.locked) 'locked', if (open) t.verb].join('. '),
        excludeSemantics: true,
        child: InkWell(
          key: ValueKey('task-${t.id}'),
          onTap: row.locked ? null : onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 64),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                JIconChip(icon: icon, tint: tint, color: fg),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        t.title,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: done ? OnbColors.text3 : OnbColors.text,
                          decoration: done ? TextDecoration.lineThrough : null,
                        ),
                      ),
                      if (bar != null) ...[
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            Expanded(child: JBar(value: bar, color: fg)),
                            const SizedBox(width: 8),
                            Text('${(bar * 100).round()}%', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: OnbColors.text2)),
                          ],
                        ),
                      ] else if (meta != null && meta.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(meta, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                      ],
                    ],
                  ),
                ),
                if (row.pill != null) ...[const SizedBox(width: 8), JPill(row.pill!, amber: row.amber)],
                if (row.locked) ...[const SizedBox(width: 8), jLock],
                if (done) ...[const SizedBox(width: 8), const JDoneDot()],
                if (open) ...[const SizedBox(width: 8), JVerbPill(t.verb)],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ─── What a tap opens (FINAL-DESIGNS.md §8a "Task taps") ───────────────────

/// Do in Sowaka → its screen (it ticks itself off from the fact); Review →
/// the page and "Looks good"; Read and acknowledge → App policies, or the PDF
/// and "I’ve read this"; Sign → the documents to sign; More tasks → the link.
Future<void> openJoinerTask(BuildContext context, JoinerController c, JoinerTask t) async {
  final shell = c.shell;
  if (t.isLocked) return;
  if (t.policies) {
    final api = shell.api;
    if (api is! HttpOnboardingApi) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => PoliciesAckScreen(source: HttpPoliciesSource(PoliciesApiService(session: api.session)), shell: shell)),
    );
    await c.load();
    return;
  }
  if (t.fileUrl != null) {
    // A PDF to read (a Read and acknowledge row, or the confirmation letter).
    try {
      final bytes = await c.api.download(t.fileUrl!);
      await Printing.sharePdf(bytes: bytes, filename: '${t.title}.pdf');
    } catch (e) {
      if (context.mounted) showAppToast(context, onboardingErrorText(e));
      return;
    }
    if (t.id.startsWith('letter:')) {
      if (!t.isDone && context.mounted) await _act(context, c, t, 'opened');
      return;
    }
    if (!t.isDone && context.mounted) {
      await _confirm(context, c, t, label: 'I’ve read this', action: 'acknowledged');
    }
    return;
  }
  switch (t.type) {
    case 'do':
      if (t.isDone) return;
      if (t.screen == 'punch') {
        await FirstPunchTour.start(context, shell);
        await c.load();
        return;
      }
      if (t.screen == 'tour') {
        await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => JoinerTourScreen(c: c)));
        await c.load();
        return;
      }
      // Its screen opens over this one; Back returns here, and the fact it
      // may now hold ticks the row.
      final screen = t.screen;
      final open = shell.openAppScreen;
      if (screen == null || open == null) return;
      await open(context, screen);
      await c.load();
    case 'review':
      if (t.isDone) return;
      await _confirm(context, c, t, label: 'Looks good', action: 'looks_good', page: t.screen);
    case 'sign':
      await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => JoinerSignScreen(c: c, title: t.title)));
      await c.load();
    case 'form':
      await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => JoinerFormScreen(c: c, taskId: t.id, title: t.title)));
      await c.load();
    case 'other':
      final link = t.link;
      if (link != null) {
        await openExternalLink(context, link);
        if (!t.isDone && context.mounted) await _act(context, c, t, 'opened');
      } else if (!t.isDone) {
        await _confirm(context, c, t, label: 'Mark as done', action: 'done');
      }
  }
}

Future<void> _act(BuildContext context, JoinerController c, JoinerTask t, String action) async {
  try {
    c.set(await c.api.taskAction(t.id, action));
  } catch (e) {
    if (context.mounted) showAppToast(context, onboardingErrorText(e));
  }
}

/// The task's title with its one button ("Looks good", "I’ve read this");
/// a Review row's page opens from it first.
Future<void> _confirm(BuildContext context, JoinerController c, JoinerTask t, {required String label, required String action, String? page}) =>
    showOnbSheet<void>(
      context,
      builder: (sheet) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(t.title, style: OnbText.h1),
            if (t.meta != null) ...[const SizedBox(height: 4), Text(t.meta!, style: OnbText.label)],
            const SizedBox(height: 16),
            if (page != null && c.shell.openAppScreen != null) ...[
              OnbSecondaryButton(
                key: ValueKey('task-page-${t.id}'),
                label: t.verb,
                // The page opens over this sheet: Back returns to it, with
                // "Looks good" still to tap.
                onTap: () => c.shell.openAppScreen!(sheet, page),
              ),
              const SizedBox(height: 10),
            ],
            OnbPrimaryButton(
              key: ValueKey('task-confirm-${t.id}'),
              label: label,
              onTap: () async {
                Navigator.of(sheet).pop();
                await _act(context, c, t, action);
              },
            ),
          ],
        ),
      ),
    );

// ─── Sign your joining documents ────────────────────────────────────────────

/// The Sign task's documents (the portal's letters, signed in the app on
/// Day 1): open each PDF, then sign it with your typed name.
class JoinerSignScreen extends StatefulWidget {
  const JoinerSignScreen({super.key, required this.c, required this.title});

  final JoinerController c;
  final String title;

  @override
  State<JoinerSignScreen> createState() => _JoinerSignScreenState();
}

class _JoinerSignScreenState extends State<JoinerSignScreen> {
  List<JoinerLetter>? _letters;
  String? _error;
  String? _busy;
  final _name = TextEditingController();

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final list = await widget.c.api.letters();
      if (mounted) {
        setState(() {
          _letters = list;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = onboardingErrorText(e));
    }
  }

  Future<void> _run(String id, Future<List<JoinerLetter>> Function() call) async {
    setState(() => _busy = id);
    try {
      final list = await call();
      if (mounted) setState(() => _letters = list);
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _open(JoinerLetter l) => _run(l.id, () async {
    final bytes = await widget.c.api.download('/lifecycle/joiner/letters/${Uri.encodeComponent(l.id)}/pdf');
    await Printing.sharePdf(bytes: bytes, filename: '${l.title}.pdf');
    return widget.c.api.openLetter(l.id);
  });

  @override
  Widget build(BuildContext context) {
    final letters = _letters;
    return OnbScaffold(
      shell: widget.c.shell,
      title: widget.title,
      body: letters == null
          ? OnbLoadState(error: _error, onRetry: _load)
          : JPage(
              children: [
                JListCard(
                  children: withLines([
                    for (final l in letters)
                      Padding(
                        key: ValueKey('letter-${l.id}'),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        child: Row(
                          children: [
                            const JIconChip(icon: Icons.draw_outlined, tint: Color(0xFFFDECE7), color: OnbColors.rust),
                            const SizedBox(width: 12),
                            Expanded(child: Text(l.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text))),
                            if (l.state == 'signed')
                              const JDoneDot()
                            else if (l.state != 'locked')
                              InkWell(
                                onTap: _busy == null ? () => _open(l) : null,
                                borderRadius: BorderRadius.circular(999),
                                child: const JVerbPill('Read'),
                              )
                            else
                              jLock,
                          ],
                        ),
                      ),
                  ]),
                ),
                if (letters.any((l) => l.state == 'opened')) ...[
                  OnbTextArea(controller: _name, hint: 'Type your full name', minLines: 1),
                  OnbPrimaryButton(
                    key: const ValueKey('sign-letters'),
                    label: 'Sign',
                    busy: _busy != null,
                    onTap: () async {
                      final name = _name.text.trim();
                      for (final l in letters.where((l) => l.state == 'opened').toList()) {
                        await _run(l.id, () => widget.c.api.signLetter(l.id, name));
                      }
                    },
                  ),
                ],
              ],
            ),
    );
  }
}
