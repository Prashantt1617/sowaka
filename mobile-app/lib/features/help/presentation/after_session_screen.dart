import 'package:flutter/material.dart';

import '../../care/presentation/care_theme.dart';
import '../../shared/app_toast.dart';
import '../../talk/data/talk_api_service.dart';
import '../../talk/data/talk_models.dart';
import '../../talk/presentation/talk_format.dart';
import '../data/help_api_service.dart';
import '../data/help_models.dart';

/// "How did you feel about the session?", asked once the session has ended.
///
/// A rating out of five, a few words if they have any, and — when the session
/// was with someone other than their match — the offer to make that person
/// their counsellor. Hands back true once something was saved.
class AfterSessionScreen extends StatefulWidget {
  const AfterSessionScreen({
    super.key,
    required this.session,
    required this.service,
    this.match,
  });

  final TalkSession session;
  final HelpApiService service;

  /// Who their counsellor is today, so the offer to switch is only made when
  /// this session was with somebody else.
  final HelpMatch? match;

  @override
  State<AfterSessionScreen> createState() => _AfterSessionScreenState();
}

class _AfterSessionScreenState extends State<AfterSessionScreen> {
  int _rating = 0;
  final _note = TextEditingController();
  bool _saving = false;

  /// Null until they answer; true means make this counsellor the match.
  bool? _switchMatch;

  bool get _canSwitch {
    final match = widget.match;
    return match != null && match.counsellor.userId != widget.session.counsellorId;
  }

  String get _first => widget.session.counsellorName.split(' ').first;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_rating == 0 || _saving) return;
    setState(() => _saving = true);
    try {
      await widget.service.review(
        widget.session.id,
        rating: _rating,
        note: _note.text.trim(),
      );
      if (_switchMatch == true) {
        await widget.service.acceptCounsellor(widget.session.counsellorId);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
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
    final session = widget.session;
    final minutes = session.endsAt.difference(session.startsAt).inMinutes;
    return CarePage(
      backLabel: 'Help',
      children: [
        CareEyebrow(
          '${talkDate(session.startsAt)} · $minutes min with $_first',
        ),
        const SizedBox(height: 10),
        const CareHeading('How did you feel\nabout the session?', size: 28),
        const SizedBox(height: 22),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var star = 1; star <= 5; star++)
              IconButton(
                key: ValueKey('star-$star'),
                onPressed: () => setState(() => _rating = star),
                iconSize: 36,
                icon: Icon(
                  star <= _rating ? Icons.star_rounded : Icons.star_outline_rounded,
                  color: star <= _rating
                      ? const Color(0xFFE0A526)
                      : CareColors.line,
                ),
              ),
          ],
        ),
        SizedBox(
          height: 20,
          child: Center(
            child: Text(
              _rating == 0 ? '' : SessionReview.labels[_rating - 1],
              style: const TextStyle(
                fontFamily: careFont,
                color: CareColors.muted,
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
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
            hintText: 'A few words, if you like. What helped, what didn’t.',
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
        if (_canSwitch) ...[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: CareColors.sage,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CareSectionTitle('Make $_first your counsellor?', size: 15),
                const SizedBox(height: 6),
                CareCopy(
                  'Your counsellor is ${widget.match!.counsellor.firstName}. '
                  'Choosing $_first means Help opens with them from now on, and '
                  'your sessions with ${widget.match!.counsellor.firstName} stay in your history.',
                  size: 12.5,
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: CareChoiceChip(
                        'Yes, switch to $_first',
                        selected: _switchMatch == true,
                        onTap: () => setState(() => _switchMatch = true),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: CareChoiceChip(
                        'Keep ${widget.match!.counsellor.firstName}',
                        selected: _switchMatch == false,
                        onTap: () => setState(() => _switchMatch = false),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 18),
        CarePrimaryButton(
          'Save',
          icon: Icons.arrow_forward_rounded,
          busy: _saving,
          onTap: _rating == 0 ? null : _save,
        ),
        const SizedBox(height: 6),
        Center(
          child: CareLink(
            'Not now',
            icon: null,
            onTap: () => Navigator.of(context).pop(false),
          ),
        ),
      ],
    );
  }
}
