import 'dart:async';

import 'package:flutter/material.dart';

import '../../../care/data/care_api_service.dart';
import '../../../care/data/care_models.dart';
import '../../../care/presentation/care_theme.dart';
import '../../../care/presentation/player_screen.dart';
import '../../../care/presentation/share_writing.dart';

/// A field that keeps itself: what is typed is saved to the person's kept
/// writing a moment after they stop, and read back next time.
class KeptField extends StatefulWidget {
  const KeptField({
    super.key,
    required this.label,
    required this.controller,
    this.hint = '',
    this.minLines = 4,
    this.onChanged,
  });

  final String label;
  final TextEditingController controller;
  final String hint;
  final int minLines;
  final VoidCallback? onChanged;

  @override
  State<KeptField> createState() => _KeptFieldState();
}

class _KeptFieldState extends State<KeptField> {
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.label,
          style: const TextStyle(
            fontFamily: careFont,
            color: CareColors.ink,
            fontSize: 13.5,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: widget.controller,
          minLines: widget.minLines,
          maxLines: widget.minLines + 8,
          onChanged: (_) => widget.onChanged?.call(),
          style: const TextStyle(
            fontFamily: careFont,
            color: CareColors.ink,
            fontSize: 15,
            height: 1.6,
          ),
          decoration: InputDecoration(
            hintText: widget.hint,
            hintStyle: const TextStyle(
              fontFamily: careFont,
              color: CareColors.muted,
            ),
            filled: true,
            fillColor: Colors.white,
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
              borderSide: const BorderSide(color: CareColors.blue, width: 1.5),
            ),
          ),
        ),
      ],
    );
  }
}

/// Saves a writing key a moment after the last change, and says when it did.
class KeptSaver {
  KeptSaver({
    required this.care,
    required this.key,
    this.onSaved,
    this.onError,
  });

  final CareApiService care;
  final String key;
  final VoidCallback? onSaved;
  final void Function(String message)? onError;
  Timer? _timer;
  Map<String, String> _pending = const {};

  void schedule(Map<String, String> fields) {
    _pending = fields;
    _timer?.cancel();
    _timer = Timer(const Duration(milliseconds: 900), flush);
  }

  Future<void> flush() async {
    _timer?.cancel();
    final fields = _pending;
    if (fields.isEmpty) return;
    try {
      await care.putWriting(key, fields);
      onSaved?.call();
    } catch (error) {
      onError?.call(
        error is CareApiException
            ? error.message
            : 'Could not save. Try again.',
      );
    }
  }

  void dispose() => _timer?.cancel();
}

/// The line under any kept writing.
class KeptNote extends StatelessWidget {
  const KeptNote({super.key, this.saved = false});

  final bool saved;

  @override
  Widget build(BuildContext context) => CareMicro(
    saved
        ? 'Saved. Kept until you remove it. Only you can see it.'
        : 'Kept until you remove it. Only you can see it.',
  );
}

/// A three-frame storyboard, with the clip in its place once there is one.
class StoryboardScreen extends StatefulWidget {
  const StoryboardScreen({
    super.key,
    required this.backLabel,
    required this.eyebrow,
    required this.title,
    required this.meta,
    required this.frames,
    this.url,
    this.footer,
  });

  final String backLabel;
  final String eyebrow;
  final String title;
  final String meta;

  /// Each frame is a heading and a line.
  final List<List<String>> frames;
  final String? url;
  final Widget? footer;

  @override
  State<StoryboardScreen> createState() => _StoryboardScreenState();
}

class _StoryboardScreenState extends State<StoryboardScreen> {
  int _frame = 0;

  @override
  Widget build(BuildContext context) {
    final url = widget.url;
    final frame = widget.frames.isEmpty
        ? const ['', '']
        : widget.frames[_frame.clamp(0, widget.frames.length - 1)];
    return CarePage(
      backLabel: widget.backLabel,
      children: [
        CareEyebrow(widget.eyebrow),
        const SizedBox(height: 10),
        CareHeading(widget.title, size: 26),
        const SizedBox(height: 6),
        CareCopy(widget.meta),
        const SizedBox(height: 18),
        if (url != null && url.isNotEmpty)
          ClipRRect(
            borderRadius: BorderRadius.circular(22),
            child: SizedBox(
              height: 240,
              child: InlineVideo(url: url, title: widget.title),
            ),
          )
        else ...[
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: CareColors.sky,
              borderRadius: BorderRadius.circular(22),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(
                      Icons.play_circle_outline_rounded,
                      color: CareColors.blue,
                      size: 22,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'Frame ${_frame + 1} of ${widget.frames.length} · storyboard',
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: CareColors.blue,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Text(
                  frame.isEmpty ? '' : frame[0],
                  style: const TextStyle(
                    fontFamily: careFont,
                    color: CareColors.ink,
                    fontSize: 21,
                    fontWeight: FontWeight.w700,
                    height: 1.2,
                  ),
                ),
                const SizedBox(height: 8),
                CareCopy(frame[1], size: 14, color: CareColors.ink),
                const SizedBox(height: 18),
                Row(
                  children: [
                    CareChoiceChip(
                      'Previous',
                      selected: false,
                      onTap: () => setState(
                        () => _frame = (_frame - 1).clamp(
                          0,
                          widget.frames.length - 1,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    CareChoiceChip(
                      'Next',
                      selected: true,
                      onTap: () => setState(
                        () => _frame = (_frame + 1).clamp(
                          0,
                          widget.frames.length - 1,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          const CareMicro(
            'The clip is on its way. Until then, the frames tell it.',
          ),
        ],
        if (widget.footer != null) ...[
          const SizedBox(height: 22),
          widget.footer!,
        ],
      ],
    );
  }
}

/// A reading view for a kept piece, with Share.
class ReadingScreen extends StatelessWidget {
  const ReadingScreen({
    super.key,
    required this.backLabel,
    required this.eyebrow,
    required this.title,
    required this.paragraphs,
    this.meta,
    this.shareTitle,
    this.footer,
  });

  final String backLabel;
  final String eyebrow;
  final String title;
  final String? meta;
  final List<String> paragraphs;
  final String? shareTitle;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    return CarePage(
      backLabel: backLabel,
      children: [
        CareEyebrow(eyebrow),
        const SizedBox(height: 10),
        CareHeading(title, size: 26),
        if (meta case final m?) ...[const SizedBox(height: 6), CareCopy(m)],
        const SizedBox(height: 18),
        for (final p in paragraphs) ...[
          CareCopy(p, size: 15, color: CareColors.ink),
          const SizedBox(height: 12),
        ],
        if (shareTitle != null) ...[
          const SizedBox(height: 6),
          Row(
            children: [
              ShareLink(title: shareTitle!, text: paragraphs.join('\n\n')),
            ],
          ),
        ],
        if (footer != null) ...[const SizedBox(height: 22), footer!],
      ],
    );
  }
}

/// A soft card with an eyebrow, a title, a line and an action, in a colour.
class TopicBanner extends StatelessWidget {
  const TopicBanner({
    super.key,
    required this.color,
    required this.eyebrow,
    required this.title,
    required this.copy,
    required this.action,
    required this.onTap,
    this.icon,
  });

  final Color color;
  final String eyebrow;
  final String title;
  final String copy;
  final String action;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Material(
    color: color,
    borderRadius: BorderRadius.circular(22),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(22),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                if (icon != null) ...[
                  Icon(icon, color: CareColors.blue, size: 20),
                  const SizedBox(width: 8),
                ],
                CareEyebrow(eyebrow),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              title,
              style: const TextStyle(
                fontFamily: careFont,
                color: CareColors.ink,
                fontSize: 21,
                fontWeight: FontWeight.w700,
                height: 1.2,
              ),
            ),
            const SizedBox(height: 6),
            CareCopy(copy, size: 13.5),
            const SizedBox(height: 10),
            CareLink(action, onTap: onTap),
          ],
        ),
      ),
    ),
  );
}

/// The date a letter carries, as it is shown.
String longDate(DateTime at) {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  final d = at.toLocal();
  return '${d.day} ${months[d.month - 1]} ${d.year}';
}

/// Rows of kept writing, keyed, for lists.
List<CareWriting> sortedNewest(List<CareWriting> rows) =>
    [...rows]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
