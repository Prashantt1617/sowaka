/// R3 (Action › Off-boarding), its "Before you go" list (shared with the
/// Resignation tab, R2b) and R3b (Handover: upload).
library;

import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:printing/printing.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../shared/app_toast.dart';
import '../../shared/attachment_picker.dart';
import 'exit_interview_screen.dart';
import 'offboarding_api.dart';
import 'offboarding_dates.dart';
import 'offboarding_models.dart';
import 'offboarding_store.dart';
import 'offboarding_ui.dart';

/// What the shell lends a page it opens: its header and tabs, and the way to
/// the payslips and Form 16 ("Save your documents").
class OffboardingChrome {
  const OffboardingChrome({this.header, this.bottomNav, this.onOpenDocuments});

  final Widget? header;
  final Widget? bottomNav;
  final VoidCallback? onOpenDocuments;
}

/// One row of "Before you go".
class BeforeYouGoItem {
  const BeforeYouGoItem({
    required this.key,
    required this.icon,
    required this.title,
    required this.done,
    this.subtitle,
    this.status,
    this.onTap,
    this.counts = true,
  });

  final String key;
  final IconData icon;
  final String title;
  final String? subtitle;
  final bool done;

  /// The words on the right, on the Resignation tab ("To do", "After 31 Dec").
  final String? status;
  final VoidCallback? onTap;

  /// Counted in "n of N done" (the settlement line is not: it is HR's).
  final bool counts;
}

/// Tasks that are the leaver's to see on the page: not the resignation
/// itself, nothing after they have gone, nothing skipped or cancelled.
List<OffboardingTask> _leaverTasks(OffboardingPageData data) => [
  for (final task in data.tasks)
    if (!task.gone &&
        task.phase != 'resignation' &&
        task.phase != 'after_exit' &&
        task.systemKey != 'send_resignation' &&
        task.systemKey != 'offboarding_page')
      task,
];

/// "Before you go", in the template's order: Handover, Return laptop and ID
/// card, Exit interview, Save your documents, and anything HR added.
List<BeforeYouGoItem> beforeYouGoItems(
  BuildContext context, {
  required OffboardingStore store,
  required OffboardingPageData data,
  required String? managerFirst,
  required VoidCallback onChanged,
  VoidCallback? onOpenDocuments,
  bool withSettlement = false,
  OffboardingChrome chrome = const OffboardingChrome(),
}) {
  final who = managerFirst ?? 'your manager';
  final items = <BeforeYouGoItem>[];
  final handover = data.handover;
  for (final task in _leaverTasks(data)) {
    switch (task.systemKey) {
      case 'upload_handover':
        items.add(
          BeforeYouGoItem(
            key: 'handover',
            icon: Icons.inventory_2_outlined,
            title: 'Handover',
            subtitle: handover.items.isEmpty
                ? "Waiting for $who's checklist"
                : '${handover.uploadedCount} of ${handover.items.length} uploaded · from $who',
            done: task.done || handover.done,
            onTap: () async {
              await Navigator.of(context).push<void>(
                MaterialPageRoute(
                  builder: (_) => HandoverScreen(
                    store: store,
                    managerName:
                        data.managerName ?? store.resignation?.managerName,
                    chrome: chrome,
                  ),
                ),
              );
              onChanged();
            },
          ),
        );
      case 'exit_interview':
        final interview = data.interview;
        final when = interview.sent
            ? 'Sent'
            : interview.open || interview.opensAt == null
            ? '4 min'
            : 'Opens ${shortDay(interview.opensAt!)}';
        items.add(
          BeforeYouGoItem(
            key: 'exit-interview',
            icon: Icons.forum_outlined,
            title: 'Exit interview',
            subtitle: '$when · answers go to HR only',
            done: interview.sent || task.done,
            status: interview.sent ? 'Sent' : null,
            onTap: () async {
              await Navigator.of(context).push<void>(
                MaterialPageRoute(
                  builder: (_) => ExitInterviewScreen(
                    store: store,
                    interview: interview,
                    managerFirst: managerFirst,
                    chrome: chrome,
                  ),
                ),
              );
              onChanged();
            },
          ),
        );
      case 'save_documents':
        items.add(
          BeforeYouGoItem(
            key: 'documents',
            icon: Icons.folder_open_outlined,
            title: 'Save your documents',
            subtitle: 'Payslips and Form 16 · before your access ends',
            done: task.done,
            onTap: onOpenDocuments,
          ),
        );
      default:
        final due = task.dueAt;
        items.add(
          BeforeYouGoItem(
            key: task.systemKey ?? task.id,
            icon: task.systemKey == 'return_assets'
                ? Icons.laptop_mac_outlined
                : Icons.task_alt_rounded,
            title: task.title,
            subtitle: [
              ?task.helper,
              if (due != null) 'by ${shortDay(due)}',
            ].join(' · ').ifEmpty(null),
            done: task.done,
          ),
        );
    }
  }
  if (withSettlement) {
    items.add(
      BeforeYouGoItem(
        key: 'settlement',
        icon: Icons.description_outlined,
        title: 'Final settlement',
        subtitle: 'HR emails it as a PDF',
        done: false,
        counts: false,
        status: data.tl == null
            ? 'After your last day'
            : 'After ${shortDay(data.tl!)}',
      ),
    );
  }
  return items;
}

extension on String {
  String? ifEmpty(String? other) => isEmpty ? other : this;
}

/// "n of N done".
String doneCount(List<BeforeYouGoItem> items) {
  final counted = items.where((item) => item.counts).toList();
  return '${counted.where((item) => item.done).length} of ${counted.length} done';
}

/// R2b's card: the rows inside one white card, with "To do" on the right.
class BeforeYouGoCard extends StatelessWidget {
  const BeforeYouGoCard({super.key, required this.items});

  final List<BeforeYouGoItem> items;

  @override
  Widget build(BuildContext context) => OffCard(
    key: const ValueKey('before-you-go-card'),
    padding: const EdgeInsets.fromLTRB(16, 14, 12, 8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Before you go',
                style: offText(15, weight: FontWeight.w600),
              ),
            ),
            Text(
              doneCount(items),
              style: offText(12, color: OffColors.tertiary),
            ),
          ],
        ),
        const SizedBox(height: 4),
        for (final item in items)
          OffTaskRow(
            key: ValueKey('before-${item.key}'),
            icon: item.icon,
            title: item.title,
            subtitle: item.subtitle,
            onTap: item.onTap,
            trailing: Text(
              item.status ?? (item.done ? 'Done' : 'To do'),
              style: offText(
                12,
                weight: FontWeight.w600,
                color: item.done ? OffColors.green : OffColors.secondary,
              ),
            ),
          ),
      ],
    ),
  );
}

/// R3: Action › Off-boarding. Last day, the before-you-go tasks, what is
/// coming up. Nothing on Home, no plant, no confetti.
class OffboardingPage extends StatefulWidget {
  const OffboardingPage({
    super.key,
    required this.store,
    this.chrome = const OffboardingChrome(),
    this.today,
    this.openSection,
  });

  final OffboardingStore store;
  final OffboardingChrome chrome;
  final DateTime? today;

  /// Opened from a push: `handover` (R3b) or `exit_interview` (R5) goes on
  /// top once the page has loaded.
  final String? openSection;

  @override
  State<OffboardingPage> createState() => _OffboardingPageState();
}

class _OffboardingPageState extends State<OffboardingPage> {
  OffboardingPageData? _data;
  String? _error;
  late String? _section = widget.openSection;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    widget.store.addListener(_load);
    _load();
  }

  @override
  void dispose() {
    widget.store.removeListener(_load);
    super.dispose();
  }

  /// Reads the page: on opening, on a pull, after a subscreen, and whenever
  /// the store reads again (a push, the app coming back to the front).
  Future<void> _load() async {
    if (_loading) return;
    _loading = true;
    try {
      final data = await widget.store.api.fetchOffboarding();
      if (mounted) {
        setState(() {
          _data = data;
          _error = null;
        });
        _openSection();
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      _loading = false;
    }
  }

  void _openSection() {
    final section = _section;
    final data = _data;
    if (section == null || data == null) return;
    _section = null;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final key = section == 'exit_interview' ? 'exit-interview' : section;
      _items(
        context,
        data,
      ).where((item) => item.key == key).firstOrNull?.onTap?.call();
    });
  }

  List<BeforeYouGoItem> _items(
    BuildContext context,
    OffboardingPageData data,
  ) => beforeYouGoItems(
    context,
    store: widget.store,
    data: data,
    managerFirst: firstName(
      data.managerName ?? widget.store.resignation?.managerName,
    ),
    onChanged: _load,
    onOpenDocuments: widget.chrome.onOpenDocuments,
    chrome: widget.chrome,
  );

  @override
  Widget build(BuildContext context) {
    final data = _data;
    return OffScaffold(
      key: const ValueKey('offboarding-page'),
      title: 'Off-boarding',
      header: widget.chrome.header,
      bottomNav: widget.chrome.bottomNav,
      onRefresh: () async {
        await Future.wait([widget.store.refresh(), _load()]);
      },
      children: data == null
          ? [
              OffLoadState(
                error: _error,
                onRetry: _error == null
                    ? null
                    : () => setState(() {
                        _error = null;
                        _load();
                      }),
              ),
            ]
          : _content(context, data),
    );
  }

  List<Widget> _content(BuildContext context, OffboardingPageData data) {
    final today = dayOnly(widget.today ?? DateTime.now());
    final resignation = widget.store.resignation;
    final managerName = data.managerName ?? resignation?.managerName;
    final managerFirst = firstName(managerName);
    final tl =
        data.tl ?? widget.store.me.offboarding?.tl ?? resignation?.lastDay;
    final acceptedAt = data.acceptedAt ?? resignation?.hrAcceptedAt;
    final noticeFrom =
        data.noticeFrom ?? resignation?.submittedAt ?? acceptedAt;
    final items = _items(context, data);
    final handoverTask = data.task('upload_handover');
    final handoverDone = handoverTask?.done == true || data.handover.done;
    final handoverDue = handoverTask?.dueAt ?? data.handover.dueAt;
    final lastDayCame = tl != null && !today.isBefore(tl);

    String? weeks;
    if (noticeFrom != null && tl != null) {
      final total = (daysBetween(noticeFrom, tl) / 7).ceil();
      final now = (daysBetween(noticeFrom, today) / 7).ceil().clamp(
        1,
        total < 1 ? 1 : total,
      );
      if (total > 0) weeks = '$now of $total weeks';
    }

    final steps = [
      if (resignation?.submittedAt case final sent?)
        OffStep('Resigned', OffStepState.done, sub: shortDay(sent)),
      OffStep(
        'Accepted',
        acceptedAt == null ? OffStepState.current : OffStepState.done,
        sub: acceptedAt == null ? null : shortDay(acceptedAt),
      ),
      OffStep(
        'Handover',
        handoverDone
            ? OffStepState.done
            : (acceptedAt == null || lastDayCame
                  ? OffStepState.todo
                  : OffStepState.current),
        sub: handoverDone
            ? 'Done'
            : (handoverDue == null ? null : 'by ${shortDay(handoverDue)}'),
      ),
      // The last day is the step under way from Tl itself, handover or not.
      OffStep(
        'Last day',
        lastDayCame ? OffStepState.current : OffStepState.todo,
        sub: tl == null ? null : shortDay(tl),
      ),
    ];

    final footer = handoverTask != null && !handoverDone
        ? '${doneCount(items)} · start with your handover'
        : doneCount(items);

    final comingUp =
        <(DateTime?, String, String)>[
          if (handoverDue != null &&
              !handoverDone &&
              !handoverDue.isBefore(today))
            (
              handoverDue,
              shortDay(handoverDue),
              'Handover due to ${managerFirst ?? 'your manager'}',
            ),
          if (data.interview.opensAt case final opens?
              when !data.interview.open &&
                  !data.interview.sent &&
                  opens.isAfter(today))
            (opens, shortDay(opens), 'Exit interview opens'),
          if (tl != null) (tl, shortDay(tl), 'Last working day'),
          (null, 'After', 'HR emails your settlement PDF'),
        ]..sort(
          (a, b) =>
              a.$1 == null ? 1 : (b.$1 == null ? -1 : a.$1!.compareTo(b.$1!)),
        );

    return [
      OffHeading('Your notice', trailing: weeks),
      OffCard(child: OffStepper(steps)),
      const SizedBox(height: 12),
      OffNoticeCard(
        lastDay: tl,
        acceptedAt: acceptedAt,
        noticeFrom: noticeFrom,
        daysLeft: data.daysLeft,
        footer: footer,
        today: today,
      ),
      const OffHeading('Before you go'),
      for (final item in items) ...[
        OffCard(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
          child: OffTaskRow(
            key: ValueKey('off-task-${item.key}'),
            icon: item.icon,
            title: item.title,
            subtitle: item.subtitle,
            onTap: item.onTap,
            trailing: OffRing(done: item.done),
          ),
        ),
        const SizedBox(height: 10),
      ],
      const OffHeading('Coming up'),
      OffCard(
        key: const ValueKey('off-coming-up'),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Column(
          children: [
            for (final (_, label, what) in comingUp)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 9),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 64,
                      child: Text(
                        label,
                        style: offText(
                          13,
                          weight: FontWeight.w600,
                          color: OffColors.brand,
                        ),
                      ),
                    ),
                    Expanded(child: Text(what, style: offText(13, height: 18))),
                  ],
                ),
              ),
          ],
        ),
      ),
      if (widget.chrome.onOpenDocuments == null &&
          data.documents.isNotEmpty) ...[
        const OffHeading('Your documents'),
        OffCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final doc in data.documents)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Text(doc.label, style: offText(13)),
                ),
            ],
          ),
        ),
      ],
    ];
  }
}

/// Picks the file for a handover item. The system picker otherwise.
typedef HandoverFilePicker =
    Future<PickedAttachment?> Function(BuildContext context);

/// What a handover upload may be: documents, sheets, slides, pictures,
/// recordings and archives, up to 10 MB (CONTRACT decision 12).
const handoverExtensions = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
  'ppt',
  'pptx',
  'txt',
  'jpg',
  'jpeg',
  'png',
  'zip',
  'mp4',
  'mov',
  'm4a',
];
const handoverMaxBytes = 10 * 1024 * 1024;

/// R3b: the manager's checklist and note, and a file or link against each
/// item. Each upload saves on its own; there is no submit.
class HandoverScreen extends StatefulWidget {
  const HandoverScreen({
    super.key,
    required this.store,
    this.managerName,
    this.pickFile,
    this.chrome = const OffboardingChrome(),
  });

  final OffboardingStore store;
  final String? managerName;
  final HandoverFilePicker? pickFile;

  /// The shell's header and tabs, as R3 wears them.
  final OffboardingChrome chrome;

  /// The picker every handover screen uses, in tests.
  @visibleForTesting
  static HandoverFilePicker? testPicker;

  @override
  State<HandoverScreen> createState() => _HandoverScreenState();
}

class _HandoverScreenState extends State<HandoverScreen> {
  HandoverChecklist? _checklist;
  String? _managerName;
  String? _error;
  final _busy = <String>{};

  @override
  void initState() {
    super.initState();
    _managerName = widget.managerName;
    widget.store.addListener(_load);
    _load();
  }

  @override
  void dispose() {
    widget.store.removeListener(_load);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await widget.store.api.fetchOffboarding();
      if (!mounted) return;
      setState(() {
        _checklist = data.handover;
        _managerName = data.managerName ?? _managerName;
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  void _replace(HandoverItem item) {
    final checklist = _checklist;
    if (checklist == null) return;
    setState(() {
      _checklist = HandoverChecklist(
        items: [
          for (final row in checklist.items) row.id == item.id ? item : row,
        ],
        note: checklist.note,
        addedAt: checklist.addedAt,
        dueAt: checklist.dueAt,
        done: checklist.done,
        doneAt: checklist.doneAt,
      );
    });
  }

  Future<void> _run(
    HandoverItem item,
    Future<HandoverItem?> Function() call,
  ) async {
    setState(() => _busy.add(item.id));
    try {
      final updated = await call();
      if (updated != null && mounted) _replace(updated);
    } catch (error) {
      if (mounted) showAppToast(context, error.toString());
    } finally {
      if (mounted) setState(() => _busy.remove(item.id));
    }
  }

  Future<void> _uploadFile(HandoverItem item) async {
    final picker =
        widget.pickFile ??
        HandoverScreen.testPicker ??
        (context) => pickAttachment(
          context,
          allowedExtensions: handoverExtensions,
          maxBytes: handoverMaxBytes,
        );
    final file = await picker(context);
    if (file == null || !mounted) return;
    await _run(
      item,
      () => widget.store.api.uploadHandoverFile(
        item.id,
        fileName: file.name,
        bytes: file.bytes,
      ),
    );
  }

  Future<void> _addLink(HandoverItem item) async {
    final url = await showDialog<String>(
      context: context,
      builder: (_) => const _LinkDialog(),
    );
    if (url == null || !mounted) return;
    await _run(item, () => widget.store.api.linkHandover(item.id, url));
  }

  Future<void> _remove(HandoverItem item) async {
    await _run(item, () async {
      await widget.store.api.removeHandoverUpload(item.id);
      return HandoverItem(id: item.id, title: item.title, done: item.done);
    });
  }

  Future<void> _replaceMenu(HandoverItem item) async {
    // Once the manager has marked the handover done the upload stays; the
    // server refuses removing it.
    final locked = item.done || (_checklist?.done ?? false);
    final choice = await showOffSheet<String>(
      context,
      (context) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const OffSheetHandle(),
          Text(item.title, style: offText(16, weight: FontWeight.w600)),
          const SizedBox(height: 8),
          for (final (key, label, icon) in [
            if (item.upload != null)
              ('open', 'Open', Icons.open_in_new_rounded),
            ('file', 'Upload another file', Icons.upload_file_rounded),
            ('link', 'Use a link instead', Icons.link_rounded),
            if (!locked) ('remove', 'Remove', Icons.delete_outline_rounded),
          ])
            ListTile(
              key: ValueKey('handover-replace-$key'),
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                icon,
                color: key == 'remove' ? OffColors.red : OffColors.brand,
              ),
              title: Text(
                label,
                style: offText(
                  15,
                  color: key == 'remove' ? OffColors.red : OffColors.ink,
                ),
              ),
              onTap: () => Navigator.of(context).pop(key),
            ),
        ],
      ),
    );
    if (!mounted) return;
    switch (choice) {
      case 'open':
        await openHandoverUpload(context, widget.store.api, item);
      case 'file':
        await _uploadFile(item);
      case 'link':
        await _addLink(item);
      case 'remove':
        await _remove(item);
    }
  }

  @override
  Widget build(BuildContext context) {
    final checklist = _checklist;
    final who = firstName(_managerName) ?? 'your manager';
    return OffScaffold(
      key: const ValueKey('handover-screen'),
      title: 'Handover',
      header: widget.chrome.header,
      bottomNav: widget.chrome.bottomNav,
      onRefresh: _load,
      children: checklist == null
          ? [
              OffLoadState(
                error: _error,
                onRetry: _error == null
                    ? null
                    : () => setState(() {
                        _error = null;
                        _load();
                      }),
              ),
            ]
          : [
              OffCard(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    OffAvatar(initialsOf(_managerName)),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Checklist from $who',
                            style: offText(15, weight: FontWeight.w600),
                          ),
                          if ([
                                if (checklist.addedAt case final at?)
                                  'Added ${shortDay(at)}',
                                if (checklist.dueAt case final due?)
                                  'due ${shortDay(due)}',
                              ].join(' · ')
                              case final line when line.isNotEmpty)
                            Text(
                              line,
                              style: offText(12, color: OffColors.secondary),
                            ),
                          if (checklist.note case final note?) ...[
                            const SizedBox(height: 8),
                            Text(
                              note,
                              key: const ValueKey('handover-note'),
                              style: offText(13, height: 19),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              if (checklist.done) ...[
                OffCard(
                  color: OffColors.greenTint,
                  child: Text(
                    '$who marked the handover done.',
                    style: offText(
                      13,
                      color: OffColors.green,
                      weight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              if (checklist.items.isEmpty)
                OffCard(
                  key: const ValueKey('handover-empty'),
                  child: Text(
                    "$who hasn't added the checklist yet. It shows here once they do.",
                    style: offText(13, color: OffColors.secondary, height: 19),
                  ),
                )
              else
                OffCard(
                  key: const ValueKey('handover-items'),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Items',
                              style: offText(15, weight: FontWeight.w600),
                            ),
                          ),
                          Text(
                            '${checklist.uploadedCount} of ${checklist.items.length} uploaded',
                            key: const ValueKey('handover-count'),
                            style: offText(12, color: OffColors.tertiary),
                          ),
                        ],
                      ),
                      for (final item in checklist.items)
                        _HandoverItemRow(
                          item: item,
                          busy: _busy.contains(item.id),
                          onUpload: () => _uploadFile(item),
                          onLink: () => _addLink(item),
                          onReplace: () => _replaceMenu(item),
                          onOpen: () => openHandoverUpload(
                            context,
                            widget.store.api,
                            item,
                          ),
                        ),
                    ],
                  ),
                ),
              OffPrivacyLine('Shared with $who and HR.'),
            ],
    );
  }
}

class _HandoverItemRow extends StatelessWidget {
  const _HandoverItemRow({
    required this.item,
    required this.busy,
    required this.onUpload,
    required this.onLink,
    required this.onReplace,
    required this.onOpen,
  });

  final HandoverItem item;
  final bool busy;
  final VoidCallback onUpload;
  final VoidCallback onLink;
  final VoidCallback onReplace;

  /// Opens what was handed in (the chip).
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final upload = item.upload;
    return Container(
      key: ValueKey('handover-item-${item.id}'),
      padding: const EdgeInsets.only(top: 14, bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: OffRing(done: upload != null),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  style: offText(14, weight: FontWeight.w600, height: 20),
                ),
                const SizedBox(height: 8),
                if (busy)
                  const SizedBox(
                    height: 44,
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.2,
                          color: OffColors.brand,
                        ),
                      ),
                    ),
                  )
                else if (upload != null)
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 10,
                    runSpacing: 6,
                    children: [
                      HandoverUploadChip(
                        key: ValueKey('handover-open-${item.id}'),
                        upload: upload,
                        onTap: onOpen,
                      ),
                      if (upload.at case final at?)
                        Text(
                          'Uploaded ${shortDay(at)}',
                          style: offText(12, color: OffColors.secondary),
                        ),
                      InkWell(
                        key: ValueKey('handover-replace-${item.id}'),
                        onTap: onReplace,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Text(
                            'Replace',
                            style: offText(
                              12,
                              weight: FontWeight.w600,
                              color: OffColors.brand,
                            ),
                          ),
                        ),
                      ),
                    ],
                  )
                else
                  Row(
                    children: [
                      Expanded(
                        child: SizedBox(
                          height: 44,
                          child: OutlinedButton.icon(
                            key: ValueKey('handover-upload-${item.id}'),
                            onPressed: onUpload,
                            icon: const Icon(Icons.upload_rounded, size: 18),
                            label: Text(
                              'Upload file',
                              style: offText(
                                13,
                                weight: FontWeight.w600,
                                color: OffColors.brand,
                              ),
                            ),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: OffColors.brand,
                              backgroundColor: OffColors.tint,
                              side: const BorderSide(
                                color: OffColors.brand,
                                style: BorderStyle.solid,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      SizedBox(
                        height: 44,
                        child: OutlinedButton.icon(
                          key: ValueKey('handover-link-${item.id}'),
                          onPressed: onLink,
                          icon: const Icon(Icons.link_rounded, size: 18),
                          label: Text(
                            'Link',
                            style: offText(
                              13,
                              weight: FontWeight.w600,
                              color: OffColors.ink,
                            ),
                          ),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: OffColors.ink,
                            side: const BorderSide(color: OffColors.line),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A link instead of a file: a shared drive folder, a recording.
class _LinkDialog extends StatefulWidget {
  const _LinkDialog();

  @override
  State<_LinkDialog> createState() => _LinkDialogState();
}

class _LinkDialogState extends State<_LinkDialog> {
  final _controller = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    var value = _controller.text.trim();
    if (value.isEmpty) return;
    if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(value)) {
      value = 'https://$value';
    }
    final uri = Uri.tryParse(value);
    if (uri == null || !uri.host.contains('.')) {
      setState(() => _error = 'Enter a link, like https://drive.example.com/…');
      return;
    }
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    backgroundColor: Colors.white,
    title: Text('Add a link', style: offText(17, weight: FontWeight.w600)),
    content: TextField(
      key: const ValueKey('handover-link-field'),
      controller: _controller,
      autofocus: true,
      keyboardType: TextInputType.url,
      style: offText(14),
      onSubmitted: (_) => _submit(),
      decoration: InputDecoration(hintText: 'https://', errorText: _error),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: Text('Cancel', style: offText(14, color: OffColors.secondary)),
      ),
      TextButton(
        key: const ValueKey('handover-link-save'),
        onPressed: _submit,
        child: Text(
          'Add link',
          style: offText(14, weight: FontWeight.w600, color: OffColors.brand),
        ),
      ),
    ],
  );
}

/// What was handed in against an item, as a chip that opens it: a file's
/// name or a link without its scheme.
class HandoverUploadChip extends StatelessWidget {
  const HandoverUploadChip({super.key, required this.upload, this.onTap});

  final HandoverUpload upload;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: onTap != null,
    label: 'Open ${upload.label}',
    excludeSemantics: true,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: OffColors.inset,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              upload.isLink
                  ? Icons.link_rounded
                  : Icons.insert_drive_file_outlined,
              size: 14,
              color: OffColors.secondary,
            ),
            const SizedBox(width: 6),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 180),
              child: Text(
                upload.label,
                overflow: TextOverflow.ellipsis,
                style: offText(
                  12,
                  weight: FontWeight.w600,
                  color: onTap == null ? OffColors.ink : OffColors.brand,
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// Opens a handover upload for the leaver or their manager: a link in the
/// browser; a file through the server's file endpoint with the session — a
/// short-lived link from storage, or (a development server) the bytes: a
/// PDF in the system viewer, a picture on screen, anything else saved and
/// handed to the phone.
Future<void> openHandoverUpload(
  BuildContext context,
  OffboardingApi api,
  HandoverItem item,
) async {
  final upload = item.upload;
  if (upload == null) return;
  final opener = HandoverOpener.testOverride ?? HandoverOpener.system;
  try {
    if (upload.isLink) {
      final url = upload.url;
      if (url == null || !await opener.launch(Uri.parse(url))) {
        throw const OffboardingApiException('Could not open the link.');
      }
      return;
    }
    final file = await api.fetchHandoverFile(item.id);
    if (!context.mounted) return;
    final name = file.name ?? upload.name ?? 'handover';
    if (file.url case final url?) {
      if (!await opener.launch(Uri.parse(url))) {
        throw OffboardingApiException('Could not open $name.');
      }
      return;
    }
    final bytes = Uint8List.fromList(file.bytes ?? const []);
    await opener.show(context, name, file.contentType ?? '', bytes);
  } catch (error) {
    if (context.mounted) {
      showAppToast(
        context,
        error is OffboardingApiException
            ? error.message
            : 'Could not open ${upload.label}.',
      );
    }
  }
}

/// How an upload reaches the screen; tests put their own in [testOverride].
class HandoverOpener {
  const HandoverOpener({required this.launch, required this.show});

  final Future<bool> Function(Uri uri) launch;
  final Future<void> Function(
    BuildContext context,
    String name,
    String contentType,
    Uint8List bytes,
  )
  show;

  @visibleForTesting
  static HandoverOpener? testOverride;

  static final system = HandoverOpener(
    launch: (uri) => launchUrl(uri, mode: LaunchMode.externalApplication),
    show: (context, name, contentType, bytes) async {
      if (contentType == 'application/pdf') {
        await Printing.sharePdf(bytes: bytes, filename: name);
        return;
      }
      if (contentType.startsWith('image/')) {
        await showDialog<void>(
          context: context,
          builder: (context) => Dialog(
            backgroundColor: Colors.white,
            child: InteractiveViewer(child: Image.memory(bytes)),
          ),
        );
        return;
      }
      final dir = await getTemporaryDirectory();
      final safe = name.replaceAll(RegExp(r'[^\w.\- ]'), '_');
      final path = '${dir.path}/$safe';
      await File(path).writeAsBytes(bytes, flush: true);
      if (!await launchUrl(Uri.file(path))) {
        throw OffboardingApiException('Could not open $name.');
      }
    },
  );
}
