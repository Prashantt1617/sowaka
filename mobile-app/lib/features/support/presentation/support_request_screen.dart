import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../shared/app_toast.dart';
import '../data/support_api_service.dart';
import '../data/support_models.dart';
import 'support_attachments.dart';
import 'support_ticket_screen.dart';
import 'support_ui.dart';

/// Raising a request (node 2896:32536): what it is about, what happened, and
/// any documents. Pops with the new ticket's thread once the server has it.
class SupportRequestScreen extends StatefulWidget {
  const SupportRequestScreen({super.key, required this.shell});

  final SupportShell shell;

  @override
  State<SupportRequestScreen> createState() => _SupportRequestScreenState();
}

class _SupportRequestScreenState extends State<SupportRequestScreen> {
  final _comment = TextEditingController();
  List<SupportTopic>? _topics;
  Future<List<SupportTopic>>? _topicsLoad;
  SupportTopic? _topic;
  final List<SupportUpload> _files = [];

  @override
  void initState() {
    super.initState();
    _comment.addListener(() => setState(() {}));
    // Read ahead so the sheet opens at once; a failure is reported when the
    // field is tapped, not here.
    _loadTopics().ignore();
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<List<SupportTopic>> _loadTopics() {
    return _topicsLoad ??= widget.shell.api
        .fetchTopics()
        .then((topics) {
          if (mounted) setState(() => _topics = topics);
          return topics;
        })
        .catchError((Object error) {
          // Asked again on the next tap of the field.
          _topicsLoad = null;
          throw error;
        });
  }

  bool get _complete => _topic != null && _comment.text.trim().isNotEmpty;

  Future<void> _pickTopic() async {
    FocusScope.of(context).unfocus();
    List<SupportTopic> topics;
    try {
      topics = _topics ?? await _loadTopics();
    } catch (error) {
      if (mounted) showAppToast(context, '$error');
      return;
    }
    if (!mounted || topics.isEmpty) return;
    final picked = await showSupportTopicSheet(
      context,
      topics: topics,
      selected: _topic,
    );
    if (picked != null && mounted) setState(() => _topic = picked);
  }

  Future<void> _addFiles() async {
    FocusScope.of(context).unfocus();
    final picked = await pickSupportFiles(
      context,
      alreadyChosen: _files.length,
    );
    if (picked.isNotEmpty && mounted) setState(() => _files.addAll(picked));
  }

  /// Straight into the new ticket's thread, with the request shown as sent;
  /// the thread creates the ticket behind it. The form's route gives way to
  /// the thread's and hands back the moment that thread closes.
  void _submit() {
    final topic = _topic;
    if (topic == null || !_complete) return;
    final route = MaterialPageRoute<void>(
      builder: (_) => SupportTicketScreen(
        shell: widget.shell,
        draft: SupportDraft(
          topic: topic,
          text: _comment.text.trim(),
          files: List.of(_files),
        ),
      ),
    );
    Navigator.of(context).pushReplacement(route, result: route.popped);
  }

  @override
  Widget build(BuildContext context) {
    return SupportScaffold(
      shell: widget.shell,
      title: 'Support desk',
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x0A000000),
                  blurRadius: 2,
                  offset: Offset(0, 1),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _FieldLabel('Type of ticket'),
                _TopicField(topic: _topic, onTap: _pickTopic),
                const SizedBox(height: 16),
                const _FieldLabel('Comment'),
                _CommentField(controller: _comment),
                const SizedBox(height: 22),
                const _FieldLabel('Attachment (optional)'),
                _UploadField(onTap: _addFiles),
                for (final (index, file) in _files.indexed) ...[
                  const SizedBox(height: 8),
                  SupportFileRow(
                    file: file,
                    onRemove: () => setState(() => _files.removeAt(index)),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 17),
          _SubmitButton(
            label: 'Submit Ticket',
            enabled: _complete,
            onTap: _submit,
          ),
        ],
      ),
    );
  }
}

/// The topic list as a sheet (node 2896:32710). Returns the one tapped.
Future<SupportTopic?> showSupportTopicSheet(
  BuildContext context, {
  required List<SupportTopic> topics,
  SupportTopic? selected,
}) {
  return showModalBottomSheet<SupportTopic>(
    context: context,
    backgroundColor: Colors.white,
    barrierColor: const Color(0x7D000000),
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (sheetContext) => SafeArea(
      top: false,
      minimum: const EdgeInsets.only(bottom: 21),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(sheetContext).height * .8,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFD1D5DB),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            const SizedBox(height: 4),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                children: [
                  for (final topic in topics) ...[
                    InkWell(
                      key: ValueKey('support-topic-${topic.key}'),
                      onTap: () => Navigator.of(sheetContext).pop(topic),
                      child: Container(
                        height: 41,
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        alignment: Alignment.centerLeft,
                        child: Text(
                          topic.label,
                          style: TextStyle(
                            fontFamily: 'Sora',
                            color: SupportStyle.ink,
                            fontSize: 16,
                            height: 24 / 16,
                            fontWeight: topic.key == selected?.key
                                ? FontWeight.w600
                                : FontWeight.w400,
                          ),
                        ),
                      ),
                    ),
                    if (topic != topics.last)
                      const Divider(
                        height: 1,
                        thickness: 1,
                        indent: 16,
                        endIndent: 16,
                        color: Color(0xFFDDDDDD),
                      ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          fontFamily: 'Sora',
          color: SupportStyle.faint,
          fontSize: 12,
          height: 16 / 12,
          fontWeight: FontWeight.w600,
          letterSpacing: .3,
        ),
      ),
    );
  }
}

class _TopicField extends StatelessWidget {
  const _TopicField({required this.topic, required this.onTap});

  final SupportTopic? topic;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Type of ticket',
      child: InkWell(
        key: const ValueKey('support-topic-field'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          width: double.infinity,
          height: 42,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          alignment: Alignment.centerLeft,
          decoration: BoxDecoration(
            border: Border.all(color: SupportStyle.line),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            topic?.label ?? '',
            style: const TextStyle(
              fontFamily: 'Sora',
              color: SupportStyle.inkStrong,
              fontSize: 14,
              height: 20 / 14,
            ),
          ),
        ),
      ),
    );
  }
}

class _CommentField extends StatelessWidget {
  const _CommentField({required this.controller});

  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 86,
      decoration: BoxDecoration(
        border: Border.all(color: SupportStyle.line),
        borderRadius: BorderRadius.circular(12),
      ),
      child: TextField(
        key: const ValueKey('support-comment'),
        controller: controller,
        expands: true,
        maxLines: null,
        textAlignVertical: TextAlignVertical.top,
        textCapitalization: TextCapitalization.sentences,
        style: const TextStyle(
          fontFamily: 'Sora',
          fontSize: 14,
          height: 20 / 14,
          color: SupportStyle.inkStrong,
        ),
        decoration: const InputDecoration(
          hintText: 'Describe your concern...',
          hintStyle: TextStyle(
            fontFamily: 'Sora',
            fontSize: 14,
            height: 20 / 14,
            color: Color(0x80111827),
          ),
          filled: false,
          isCollapsed: true,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          contentPadding: EdgeInsets.all(12),
        ),
      ),
    );
  }
}

class _UploadField extends StatelessWidget {
  const _UploadField({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      key: const ValueKey('support-upload'),
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: CustomPaint(
        foregroundPainter: const SupportDashedBorderPainter(
          color: SupportStyle.line,
          radius: 12,
        ),
        child: Container(
          width: double.infinity,
          height: 51,
          alignment: Alignment.center,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SvgPicture.asset(
                'assets/icons/upload_receipt.svg',
                width: 16,
                height: 16,
              ),
              const SizedBox(width: 8),
              const Text(
                'Upload document',
                style: TextStyle(
                  fontFamily: 'Sora',
                  color: SupportStyle.faint,
                  fontSize: 12,
                  height: 16 / 12,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The full-width button under the form: live once the form is complete,
/// otherwise the muted blue of something not ready yet.
class _SubmitButton extends StatelessWidget {
  const _SubmitButton({
    required this.label,
    required this.enabled,
    required this.onTap,
  });

  final String label;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: enabled ? SupportStyle.brand : SupportStyle.brandMuted,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        key: const ValueKey('support-submit'),
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(16),
        child: SizedBox(
          height: 49,
          child: Center(
            child: Text(
              label,
              style: const TextStyle(
                fontFamily: 'Sora',
                color: Colors.white,
                fontSize: 16,
                height: 24 / 16,
                fontWeight: FontWeight.w600,
                letterSpacing: -0.16,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
