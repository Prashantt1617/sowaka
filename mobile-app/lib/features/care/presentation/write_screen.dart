import 'package:flutter/material.dart';

import '../../auth/data/auth_models.dart';
import '../../shared/app_toast.dart';
import '../../talk/presentation/talk_format.dart';
import '../data/care_api_service.dart';
import '../data/care_models.dart';
import 'care_theme.dart';

/// The prompts offered until Sowaka's own arrive in the catalogue.
const defaultWritePrompts = [
  'What’s taking up space in your mind?',
  'What would make today feel a little lighter?',
  'What do you wish someone understood?',
  'What is one small thing you appreciated recently?',
];

/// Write: a prompt to begin, another on request, then a page to write on.
/// What is saved is kept for a week, then emailed and cleared; the screen
/// says so, and lists the week so far.
class WriteScreen extends StatefulWidget {
  const WriteScreen({
    super.key,
    required this.session,
    required this.service,
    this.prompts = const [],
    this.openingPrompt,
    this.context = 'general',
    this.backLabel = 'Care',
    this.eyebrow = 'Write',
    this.title = 'Let your thoughts\nland somewhere.',
    this.copy = 'A few words or a whole page. Start anywhere.',
  });

  final AuthSession session;
  final CareApiService service;
  final List<String> prompts;

  /// A topic's question, when opened from one.
  final String? openingPrompt;

  /// `general`, `topic:<id>` or `tool:<id>`.
  final String context;
  final String backLabel;
  final String eyebrow;
  final String title;
  final String copy;

  @override
  State<WriteScreen> createState() => _WriteScreenState();
}

class _WriteScreenState extends State<WriteScreen> {
  late final List<String> _prompts = [
    ?widget.openingPrompt,
    ...(widget.prompts.isEmpty ? defaultWritePrompts : widget.prompts),
  ];
  int _promptIndex = 0;
  final _controller = TextEditingController();
  bool _writing = false;
  bool _saving = false;
  JournalView? _journal;
  String? _error;

  /// The entry being edited, when one is.
  JournalEntry? _editing;

  @override
  void initState() {
    super.initState();
    _writing = widget.openingPrompt != null;
    _load();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  bool _prefilled = false;

  Future<void> _load() async {
    try {
      final journal = await widget.service.journal();
      if (!mounted) return;
      setState(() {
        _journal = journal;
        _error = null;
        // A topic's or a tool's page picks up where it was left this week.
        if (!_prefilled &&
            widget.context != 'general' &&
            _editing == null &&
            _controller.text.isEmpty) {
          _prefilled = true;
          final previous = journal.entries
              .where((e) => e.context == widget.context)
              .firstOrNull;
          if (previous != null) {
            _editing = previous;
            _writing = true;
            _controller.text = previous.text;
          }
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(
        () => _error = error is CareApiException
            ? error.message
            : 'Could not load your writing.',
      );
    }
  }

  String get _prompt => _prompts[_promptIndex % _prompts.length];

  Future<void> _save() async {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    setState(() => _saving = true);
    try {
      final editing = _editing;
      if (editing != null) {
        await widget.service.updateEntry(editing.id, text);
      } else {
        await widget.service.addEntry(
          text: text,
          prompt: _prompt,
          context: widget.context,
        );
      }
      if (!mounted) return;
      _controller.clear();
      setState(() {
        _editing = null;
        _writing = false;
      });
      showAppToast(context, editing != null ? 'Updated' : 'Saved');
      await _load();
    } catch (error) {
      if (!mounted) return;
      showAppToast(
        context,
        error is CareApiException
            ? error.message
            : 'Could not save. Try again.',
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _delete(JournalEntry entry) async {
    try {
      await widget.service.deleteEntry(entry.id);
      if (!mounted) return;
      if (_editing?.id == entry.id) {
        _controller.clear();
        _editing = null;
      }
      await _load();
    } catch (error) {
      if (!mounted) return;
      showAppToast(
        context,
        error is CareApiException
            ? error.message
            : 'Could not remove it. Try again.',
      );
    }
  }

  void _edit(JournalEntry entry) {
    setState(() {
      _editing = entry;
      _writing = true;
      _controller.text = entry.text;
    });
  }

  @override
  Widget build(BuildContext context) {
    final journal = _journal;
    return CarePage(
      backLabel: widget.backLabel,
      children: [
        CareEyebrow(widget.eyebrow),
        const SizedBox(height: 10),
        CareHeading(widget.title),
        const SizedBox(height: 10),
        CareCopy(widget.copy),
        const SizedBox(height: 22),
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: CareColors.peach,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const CareEyebrow('A prompt to begin', color: CareColors.clay),
              const SizedBox(height: 10),
              Text(
                _prompt,
                style: const TextStyle(
                  fontFamily: careFont,
                  color: CareColors.ink,
                  fontSize: 19,
                  fontWeight: FontWeight.w500,
                  height: 1.3,
                  letterSpacing: -0.3,
                ),
              ),
              const SizedBox(height: 10),
              CareLink(
                'Try another prompt',
                icon: Icons.shuffle_rounded,
                onTap: () => setState(() => _promptIndex++),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        if (!_writing)
          CarePrimaryButton(
            'Start writing',
            icon: Icons.edit_outlined,
            onTap: () => setState(() => _writing = true),
          )
        else ...[
          Text(
            _editing == null ? 'Your words' : 'Editing',
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.ink,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const ValueKey('write-field'),
            controller: _controller,
            minLines: 6,
            maxLines: 14,
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.ink,
              fontSize: 15,
              height: 1.6,
            ),
            decoration: InputDecoration(
              hintText: 'Right now, I’m thinking about…',
              hintStyle: const TextStyle(
                fontFamily: careFont,
                color: CareColors.muted,
              ),
              filled: true,
              fillColor: CareColors.paper,
              contentPadding: const EdgeInsets.all(16),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: const BorderSide(color: CareColors.line),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: const BorderSide(color: CareColors.line),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: const BorderSide(
                  color: CareColors.blue,
                  width: 1.5,
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          CarePrimaryButton(
            _editing == null ? 'Save' : 'Save changes',
            busy: _saving,
            onTap: _save,
          ),
          if (_editing != null)
            TextButton(
              onPressed: () => setState(() {
                _editing = null;
                _controller.clear();
              }),
              child: const Text(
                'Cancel',
                style: TextStyle(
                  fontFamily: careFont,
                  color: CareColors.muted,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
        ],
        const SizedBox(height: 10),
        CareMicro(
          journal == null
              ? 'Kept for 7 days. Every Sunday night we email the week’s writing to you and clear it here. Only you can read it.'
              : 'Kept for 7 days. Every Sunday night we email the week’s writing to ${journal.email} and clear it here. Next on ${talkDate(journal.clearsAt)}. Only you can read it.',
        ),
        const SizedBox(height: 26),
        const CareSectionTitle('This week', size: 16),
        const SizedBox(height: 10),
        if (_error case final message?)
          CareNotice(message, onRetry: _load)
        else if (journal == null)
          const CareSpinner()
        else if (journal.entries.isEmpty)
          const CareCopy(
            'Nothing yet. What you save shows here until Sunday night.',
          )
        else
          for (final entry in journal.entries)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _EntryCard(
                entry: entry,
                onEdit: () => _edit(entry),
                onDelete: () => _delete(entry),
              ),
            ),
      ],
    );
  }
}

class _EntryCard extends StatelessWidget {
  const _EntryCard({
    required this.entry,
    required this.onEdit,
    required this.onDelete,
  });

  final JournalEntry entry;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 8),
      decoration: BoxDecoration(
        color: CareColors.paper,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: CareColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${talkDate(entry.createdAt)} · ${talkTime(entry.createdAt)}${entry.prompt != null ? ' · ${entry.prompt}' : ''}',
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.muted,
              fontSize: 11.5,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            entry.text,
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.ink,
              fontSize: 14,
              height: 1.55,
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(
                onPressed: onEdit,
                child: const Text(
                  'Edit',
                  style: TextStyle(
                    fontFamily: careFont,
                    color: CareColors.blue,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              TextButton(
                onPressed: onDelete,
                child: const Text(
                  'Remove',
                  style: TextStyle(
                    fontFamily: careFont,
                    color: CareColors.muted,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
