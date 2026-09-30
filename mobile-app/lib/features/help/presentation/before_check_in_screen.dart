import 'package:flutter/material.dart';

import '../../care/presentation/care_theme.dart';
import '../../shared/app_toast.dart';
import '../../talk/data/talk_models.dart';
import '../../talk/data/talk_api_service.dart';
import '../data/help_api_service.dart';

/// "How are you feeling right now?", asked once just before joining.
///
/// One tap is enough; the words are optional. Hands back the saved answer,
/// an empty one when they chose to skip, or null when they backed out.
class BeforeCheckInScreen extends StatefulWidget {
  const BeforeCheckInScreen({
    super.key,
    required this.session,
    required this.service,
  });

  final TalkSession session;
  final HelpApiService service;

  @override
  State<BeforeCheckInScreen> createState() => _BeforeCheckInScreenState();
}

class _BeforeCheckInScreenState extends State<BeforeCheckInScreen> {
  String? _feeling;
  final _note = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final feeling = _feeling;
    if (feeling == null || _saving) return;
    setState(() => _saving = true);
    try {
      final saved = await widget.service.checkIn(
        widget.session.id,
        feeling: feeling,
        note: _note.text.trim(),
      );
      if (!mounted) return;
      Navigator.of(context).pop(
        saved.checkIn ??
            SessionCheckIn(feeling: feeling, note: _note.text.trim()),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      showAppToast(
        context,
        error is TalkApiException
            ? error.message
            : 'Could not save that. Try again.',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final first = widget.session.counsellorName.split(' ').first;
    return CarePage(
      backLabel: 'Session',
      children: [
        const CareEyebrow('Before you join'),
        const SizedBox(height: 10),
        const CareHeading('How are you feeling\nright now?', size: 28),
        const SizedBox(height: 10),
        CareCopy(
          'Only you and $first see this. It helps $first meet you where you are.',
          size: 13.5,
        ),
        const SizedBox(height: 22),
        Row(
          children: [
            for (final f in sessionFeelings) ...[
              Expanded(
                child: _FeelingTile(
                  feeling: f,
                  selected: _feeling == f.key,
                  onTap: () => setState(() => _feeling = f.key),
                ),
              ),
              if (f != sessionFeelings.last) const SizedBox(width: 6),
            ],
          ],
        ),
        const SizedBox(height: 18),
        TextField(
          controller: _note,
          maxLength: 300,
          maxLines: 4,
          minLines: 3,
          textCapitalization: TextCapitalization.sentences,
          style: const TextStyle(
            fontFamily: careFont,
            color: CareColors.ink,
            fontSize: 14.5,
            height: 1.4,
          ),
          decoration: InputDecoration(
            hintText: 'Anything on your mind today? (optional)',
            hintStyle: const TextStyle(
              fontFamily: careFont,
              color: CareColors.muted,
            ),
            filled: true,
            fillColor: Colors.white,
            contentPadding: const EdgeInsets.all(14),
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
              borderSide: const BorderSide(color: CareColors.blue),
            ),
          ),
        ),
        const SizedBox(height: 18),
        CarePrimaryButton(
          'Join session',
          icon: Icons.videocam_rounded,
          busy: _saving,
          onTap: _feeling == null ? null : _save,
        ),
        const SizedBox(height: 6),
        Center(
          child: CareLink(
            'Skip and join',
            icon: null,
            onTap: () =>
                Navigator.of(context).pop(const SessionCheckIn(feeling: '')),
          ),
        ),
      ],
    );
  }
}

class _FeelingTile extends StatelessWidget {
  const _FeelingTile({
    required this.feeling,
    required this.selected,
    required this.onTap,
  });

  final SessionFeeling feeling;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? CareColors.blueTint : Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        key: ValueKey('feeling-${feeling.key}'),
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: selected ? CareColors.blue : CareColors.line,
              width: 1.5,
            ),
          ),
          child: Column(
            children: [
              Text(feeling.face, style: const TextStyle(fontSize: 24)),
              const SizedBox(height: 4),
              Text(
                feeling.label,
                style: TextStyle(
                  fontFamily: careFont,
                  color: selected ? CareColors.blue : CareColors.muted,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
