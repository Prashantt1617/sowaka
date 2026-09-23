import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../data/connect_models.dart';
import '../../shared/image_crop_sheet.dart';
import '../../shared/image_source_sheet.dart';

/// The three contest formats, as the picker offers them (node 2227:13493).
enum ContestFormat { caption, content, mostLikely }

extension ContestFormatMeta on ContestFormat {
  String get label => switch (this) {
    ContestFormat.caption => 'Caption Contest',
    ContestFormat.content => 'Content Contest',
    ContestFormat.mostLikely => 'Most likely',
  };

  String get blurb => switch (this) {
    ContestFormat.caption =>
      'Post a picture. Everyone writes one caption, and votes decide the '
          'winner.',
    ContestFormat.content =>
      'Set a task. People go out and catch a photo, and tell the story behind '
          'it.',
    ContestFormat.mostLikely =>
      'Ask a question. Nobody writes anything, they tag the colleague it fits.',
  };

  String get emoji => switch (this) {
    ContestFormat.caption => '\u{1F4AC}',
    ContestFormat.content => '\u{1F4F8}',
    ContestFormat.mostLikely => '\u{1F50D}',
  };

  ConnectPostType get postType => switch (this) {
    ContestFormat.caption => ConnectPostType.captionChallenge,
    ContestFormat.content => ConnectPostType.photoStoryChallenge,
    ContestFormat.mostLikely => ConnectPostType.mostLikely,
  };

  /// The heading a card falls back to when nobody names the contest.
  String get defaultTitle => switch (this) {
    ContestFormat.caption => 'Caption this',
    ContestFormat.content => 'Caught red handed',
    ContestFormat.mostLikely => 'Most Likely',
  };
}

/// What the contest screen hands back: the post to publish, and the picture it
/// carries if the format takes one.
class ContestDraft {
  const ContestDraft({required this.draft, this.photoPath});

  final ConnectPostDraft draft;
  final String? photoPath;
}

const _ink = Color(0xFF222222);
const _inkTertiary = Color(0xFF717171);
const _border = Color(0xFFEBEBEB);
const _surface = Color(0xFFF7F7F9);
const _brand = Color(0xFF0571A6);

/// Setting up a contest (nodes 2227:13382 through 2227:13817).
///
/// One screen for all three formats: the type comes first and decides which
/// fields follow, rather than three near-identical screens to keep in step.
class ContestComposerPage extends StatefulWidget {
  const ContestComposerPage({super.key});

  @override
  State<ContestComposerPage> createState() => _ContestComposerPageState();
}

class _ContestComposerPageState extends State<ContestComposerPage> {
  ContestFormat? _format;
  final _title = TextEditingController();
  final _task = TextEditingController();
  final _label = TextEditingController();
  final _question = TextEditingController();
  DateTime? _closesDate;
  TimeOfDay? _closesTime;
  String? _photoPath;

  @override
  void initState() {
    super.initState();
    for (final controller in [_title, _task, _label, _question]) {
      controller.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    for (final controller in [_title, _task, _label, _question]) {
      controller.dispose();
    }
    super.dispose();
  }

  bool get _canPost {
    final format = _format;
    if (format == null) return false;
    if (_title.text.trim().isEmpty) return false;
    return switch (format) {
      ContestFormat.caption =>
        _task.text.trim().isNotEmpty && _photoPath != null,
      ContestFormat.content => _task.text.trim().isNotEmpty,
      ContestFormat.mostLikely => _question.text.trim().isNotEmpty,
    };
  }

  Future<void> _pickFormat() async {
    final chosen = await showModalBottomSheet<ContestFormat>(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => const _ContestTypeSheet(),
    );
    if (chosen == null || !mounted) return;
    setState(() => _format = chosen);
  }

  Future<void> _pickPhoto() async {
    final picked = await pickImageFrom(context);
    if (picked == null || !mounted) return;
    // Cropped to the card's own well, so what is lined up here is what the
    // feed shows.
    final cropped = await cropImageFile(
      context,
      path: picked.path,
      title: 'Crop the picture',
      initial: CropShape.challengeCard,
      allowShapeChange: false,
    );
    if (cropped == null || !mounted) return;
    setState(() => _photoPath = cropped);
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _closesDate ?? now.add(const Duration(days: 1)),
      firstDate: now,
      // A contest that closes more than six months out is a typo.
      lastDate: DateTime(now.year, now.month + 6, now.day),
    );
    if (picked == null || !mounted) return;
    setState(() => _closesDate = picked);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _closesTime ?? const TimeOfDay(hour: 17, minute: 0),
    );
    if (picked == null || !mounted) return;
    setState(() => _closesTime = picked);
  }

  /// The closing moment, or empty when it was left open. A date without a time
  /// closes at the end of that day rather than at midnight that morning.
  String _closesAtIso() {
    final date = _closesDate;
    if (date == null) return '';
    final time = _closesTime ?? const TimeOfDay(hour: 23, minute: 59);
    return DateTime(
      date.year,
      date.month,
      date.day,
      time.hour,
      time.minute,
    ).toUtc().toIso8601String();
  }

  void _done() {
    final format = _format;
    if (format == null || !_canPost) return;
    final body = <String, dynamic>{
      'title': _title.text.trim(),
      'closesAt': _closesAtIso(),
      if (format == ContestFormat.mostLikely) ...{
        'label': _label.text.trim(),
        'question': _question.text.trim(),
      } else
        'task': _task.text.trim(),
    };
    Navigator.of(context).pop(
      ContestDraft(
        draft: ConnectPostDraft(type: format.postType, body: body),
        photoPath: _photoPath,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final format = _format;
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            _header(),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                children: [
                  const _Label('TYPE'),
                  _TapField(
                    value: format?.label,
                    placeholder: 'Choose contest post type',
                    onTap: _pickFormat,
                  ),
                  if (format != null) ...[
                    const SizedBox(height: 18),
                    const _Label('CONTEST TITLE'),
                    _Input(
                      controller: _title,
                      hint: 'What should be the title of the contest?',
                      maxLength: 80,
                    ),
                    if (format == ContestFormat.mostLikely) ...[
                      const SizedBox(height: 18),
                      const _Label('QUESTION LABEL'),
                      _Input(
                        controller: _label,
                        hint: 'What should be the label of contest?',
                        maxLength: 40,
                      ),
                      const SizedBox(height: 18),
                      const _Label('QUESTION'),
                      _Input(
                        controller: _question,
                        hint:
                            'Ask a question for the contest to pick a colleague?',
                        maxLength: 160,
                        lines: 3,
                      ),
                    ] else ...[
                      const SizedBox(height: 18),
                      const _Label('TASK'),
                      _Input(
                        controller: _task,
                        hint: 'What should be the description of the contest?',
                        maxLength: 400,
                        lines: 3,
                      ),
                    ],
                    if (format == ContestFormat.caption) ...[
                      const SizedBox(height: 18),
                      const _Label('UPLOAD MEDIA'),
                      _PhotoWell(path: _photoPath, onTap: _pickPhoto),
                    ],
                    const SizedBox(height: 18),
                    const _Label('END ON'),
                    Row(
                      children: [
                        Expanded(
                          child: _TapField(
                            value: _closesDate == null
                                ? null
                                : '${_closesDate!.day}/${_closesDate!.month}/${_closesDate!.year}',
                            placeholder: 'Date',
                            icon: Icons.calendar_today_outlined,
                            onTap: _pickDate,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _TapField(
                            value: _closesTime?.format(context),
                            placeholder: 'Time',
                            icon: Icons.schedule_outlined,
                            onTap: _pickTime,
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    return Container(
      height: 60,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Color(0xFFF3F4F6))),
      ),
      child: Row(
        children: [
          InkWell(
            customBorder: const CircleBorder(),
            onTap: () => Navigator.of(context).pop(),
            child: Container(
              width: 36,
              height: 36,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                color: _surface,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.chevron_left, size: 22, color: _ink),
            ),
          ),
          const SizedBox(width: 12),
          const Text(
            'Contest',
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: _ink,
            ),
          ),
          const Spacer(),
          TextButton(
            onPressed: _canPost ? _done : null,
            style: TextButton.styleFrom(
              backgroundColor: _canPost ? _brand : const Color(0xFF96B7C7),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(999),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            ),
            child: const Text(
              'Done',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// The format chooser (node 2227:13493).
class _ContestTypeSheet extends StatelessWidget {
  const _ContestTypeSheet();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFFD1D5DB),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
            const SizedBox(height: 20),
            const Text(
              'Post Type',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w700,
                color: _ink,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              "Choose what type of contest post you'd like to share",
              style: TextStyle(fontSize: 13, height: 1.4, color: _inkTertiary),
            ),
            const SizedBox(height: 16),
            for (final format in ContestFormat.values) ...[
              _FormatCard(format: format),
              const SizedBox(height: 12),
            ],
          ],
        ),
      ),
    );
  }
}

class _FormatCard extends StatelessWidget {
  const _FormatCard({required this.format});

  final ContestFormat format;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () => Navigator.of(context).pop(format),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 36,
              height: 36,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: _surface,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(format.emoji, style: const TextStyle(fontSize: 18)),
            ),
            const SizedBox(height: 10),
            Text(
              format.label,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: _ink,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              format.blurb,
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.4,
                color: _inkTertiary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.6,
          color: _inkTertiary,
        ),
      ),
    );
  }
}

/// A field you tap rather than type into — the type, the date, the time.
class _TapField extends StatelessWidget {
  const _TapField({
    required this.value,
    required this.placeholder,
    required this.onTap,
    this.icon,
  });

  final String? value;
  final String placeholder;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final filled = (value ?? '').isNotEmpty;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Container(
        height: 52,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: _border),
        ),
        child: Row(
          children: [
            if (icon != null) ...[
              Icon(icon, size: 18, color: _inkTertiary),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: Text(
                filled ? value! : placeholder,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 14,
                  color: filled ? _ink : _inkTertiary,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Input extends StatelessWidget {
  const _Input({
    required this.controller,
    required this.hint,
    required this.maxLength,
    this.lines = 1,
  });

  final TextEditingController controller;
  final String hint;
  final int maxLength;
  final int lines;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _border),
      ),
      child: TextField(
        controller: controller,
        maxLines: lines,
        minLines: lines,
        inputFormatters: [LengthLimitingTextInputFormatter(maxLength)],
        style: const TextStyle(fontSize: 14, height: 1.4, color: _ink),
        // The container draws the box. The app's InputDecorationTheme fills
        // and outlines every field by default, so all four border states have
        // to be cleared — setting `border` alone leaves enabled and focused
        // drawing a second, rounder box inside this one.
        decoration: InputDecoration(
          isDense: true,
          filled: false,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          disabledBorder: InputBorder.none,
          contentPadding: EdgeInsets.zero,
          hintText: hint,
          hintStyle: const TextStyle(
            fontSize: 14,
            height: 1.4,
            color: _inkTertiary,
          ),
        ),
      ),
    );
  }
}

class _PhotoWell extends StatelessWidget {
  const _PhotoWell({required this.path, required this.onTap});

  final String? path;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Container(
        height: 132,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: _border),
        ),
        child: path == null
            ? const Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.cloud_upload_outlined,
                    size: 28,
                    color: _inkTertiary,
                  ),
                  SizedBox(height: 8),
                  Text(
                    'Click to upload the media',
                    style: TextStyle(fontSize: 13.5, color: _inkTertiary),
                  ),
                ],
              )
            : ClipRRect(
                borderRadius: BorderRadius.circular(11),
                child: Image.file(
                  File(path!),
                  width: double.infinity,
                  height: 132,
                  fit: BoxFit.cover,
                ),
              ),
      ),
    );
  }
}
