import 'dart:async';

import 'package:flutter/material.dart';

import '../../../shared/app_toast.dart';
import '../../../shared/attachment_picker.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart' show lifecycleYmd;
import '../presentation/onboarding_kit.dart';
import 'joiner_checkins.dart' show JChoice;
import 'joiner_models.dart';
import 'joiner_parts.dart';

/// "Fill in a form" (canvas note d2): HR's questions, each one of five
/// answer types (short answer, long answer, choice, date, file). One
/// renderer for every company: the question text, its answer, Submit. The
/// answers are saved to the joiner's profile and shown read-only after.
class JoinerFormScreen extends StatefulWidget {
  const JoinerFormScreen({super.key, required this.c, required this.taskId, required this.title});

  final JoinerController c;
  final String taskId;
  final String title;

  @override
  State<JoinerFormScreen> createState() => _JoinerFormScreenState();
}

class _JoinerFormScreenState extends State<JoinerFormScreen> {
  JoinerForm? _form;
  String? _error;
  final Map<String, String?> _picked = {};
  final Map<String, String> _fileNames = {};
  final Map<String, TextEditingController> _text = {};
  String? _uploading;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    for (final t in _text.values) {
      t.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final form = await widget.c.api.fetchForm(widget.taskId);
      if (mounted) {
        setState(() {
          _form = form;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = onboardingErrorText(e));
    }
  }

  TextEditingController _controller(String id) => _text.putIfAbsent(id, TextEditingController.new);

  Future<void> _pickDate(CheckinQuestion q) async {
    final now = DateTime.now();
    final current = DateTime.tryParse(_picked[q.id] ?? '');
    final day = await showDatePicker(context: context, initialDate: current ?? now, firstDate: DateTime(1900), lastDate: DateTime(now.year + 10));
    if (day == null || !mounted) return;
    setState(() => _picked[q.id] = lifecycleYmd(day));
  }

  Future<void> _pickFile(CheckinQuestion q) async {
    final file = await pickAttachment(context);
    if (file == null || !mounted) return;
    setState(() => _uploading = q.id);
    try {
      final up = await widget.c.api.uploadFormFile(widget.taskId, file.name, file.bytes);
      if (mounted) {
        setState(() {
          _picked[q.id] = up.fileId;
          _fileNames[up.fileId] = up.name;
        });
      }
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      if (mounted) setState(() => _uploading = null);
    }
  }

  Future<void> _submit(JoinerForm form) async {
    setState(() => _sending = true);
    try {
      final answers = {
        for (final q in form.questions)
          q.id: switch (q.type) {
            'short' || 'long' => _controller(q.id).text.trim().isEmpty ? null : _controller(q.id).text.trim(),
            _ => _picked[q.id],
          },
      };
      final sent = await widget.c.api.sendForm(widget.taskId, answers);
      if (mounted) setState(() => _form = sent);
      unawaited(widget.c.load());
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final form = _form;
    return OnbScaffold(
      shell: widget.c.shell,
      title: form?.title ?? widget.title,
      body: form == null
          ? OnbLoadState(error: _error, onRetry: _load)
          : JPage(
              children: [
                for (final q in form.questions)
                  Column(
                    key: ValueKey('form-q-${q.id}'),
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(q.text, style: OnbText.bodyStrong),
                      const SizedBox(height: 8),
                      form.sent ? _answerText(form, q) : _input(q),
                    ],
                  ),
                if (!form.sent)
                  OnbPrimaryButton(
                    key: const ValueKey('form-submit'),
                    label: 'Submit',
                    busy: _sending,
                    onTap: _uploading == null ? () => _submit(form) : null,
                  ),
              ],
            ),
    );
  }

  /// After Submit: the saved answer, read-only.
  Widget _answerText(JoinerForm form, CheckinQuestion q) {
    final v = form.answers[q.id];
    final text = v == null
        ? '—'
        : switch (q.type) {
            'date' => _day(v),
            'file' => form.files[v] ?? _fileNames[v] ?? '—',
            _ => v,
          };
    return Text(text, key: ValueKey('form-a-${q.id}'), style: OnbText.body);
  }

  Widget _input(CheckinQuestion q) => switch (q.type) {
    'short' => OnbTextArea(fieldKey: ValueKey('form-in-${q.id}'), controller: _controller(q.id), minLines: 1),
    'long' => OnbTextArea(fieldKey: ValueKey('form-in-${q.id}'), controller: _controller(q.id), minLines: 4),
    'choice' => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, o) in q.options.indexed) ...[
          if (i > 0) const SizedBox(height: 8),
          JChoice(
            key: ValueKey('form-in-${q.id}-$i'),
            label: o,
            on: _picked[q.id] == o,
            height: 52,
            size: 15,
            weight: FontWeight.w600,
            onTap: () => setState(() => _picked[q.id] = o),
          ),
        ],
      ],
    ),
    'date' => _Field(
      key: ValueKey('form-in-${q.id}'),
      label: q.text,
      value: _picked[q.id] == null ? null : _day(_picked[q.id]!),
      icon: Icons.calendar_today_outlined,
      onTap: () => _pickDate(q),
    ),
    _ => _Field(
      key: ValueKey('form-in-${q.id}'),
      label: q.text,
      value: _picked[q.id] == null ? null : _fileNames[_picked[q.id]],
      icon: Icons.attach_file_rounded,
      busy: _uploading == q.id,
      onTap: _uploading == null ? () => _pickFile(q) : null,
    ),
  };
}

/// YYYY-MM-DD as "2 Apr 1999".
String _day(String ymd) {
  final d = DateTime.tryParse(ymd);
  return d == null ? ymd : '${d.day} ${onbMonthYear(d)}';
}

/// A tappable field in the kit's input style: the picked date or file, and its icon.
class _Field extends StatelessWidget {
  const _Field({super.key, required this.label, required this.value, required this.icon, required this.onTap, this.busy = false});

  final String label;
  final String? value;
  final IconData icon;
  final VoidCallback? onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: [label, ?value].join('. '),
    excludeSemantics: true,
    child: Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: OnbColors.lineDark)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 52),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Expanded(child: Text(value ?? '', style: const TextStyle(fontSize: 14, color: OnbColors.text))),
              const SizedBox(width: 8),
              busy
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : Icon(icon, size: 20, color: OnbColors.icon),
            ],
          ),
        ),
      ),
    ),
  );
}
