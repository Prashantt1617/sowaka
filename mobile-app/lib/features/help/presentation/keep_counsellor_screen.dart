import 'package:flutter/material.dart';

import '../../care/presentation/care_theme.dart';
import '../../shared/app_toast.dart';
import '../../talk/data/talk_api_service.dart';
import '../../talk/data/talk_models.dart';
import '../data/help_api_service.dart';
import 'counsellor_profile_screen.dart';
import 'help_widgets.dart';

/// After new preferences, when they fit someone else better: keep the
/// counsellor, or switch. Keeping is the default; the other counsellor's
/// profile is a tap away, and coming back leaves the choice as it was.
class KeepCounsellorScreen extends StatefulWidget {
  const KeepCounsellorScreen({
    super.key,
    required this.service,
    required this.current,
    required this.suggested,
  });

  final HelpApiService service;
  final Counsellor current;
  final Counsellor suggested;

  @override
  State<KeepCounsellorScreen> createState() => _KeepCounsellorScreenState();
}

class _KeepCounsellorScreenState extends State<KeepCounsellorScreen> {
  bool _switch = false;
  bool _saving = false;
  bool _opening = false;

  Future<void> _seeProfile() async {
    if (_opening) return;
    _opening = true;
    try {
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => CounsellorProfileScreen(
            service: widget.service,
            counsellorId: widget.suggested.userId,
            backLabel: 'Back',
          ),
        ),
      );
    } finally {
      _opening = false;
    }
  }

  Future<void> _done() async {
    if (!_switch) {
      Navigator.of(context).pop();
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.service.acceptCounsellor(widget.suggested.userId);
      if (!mounted) return;
      showAppToast(
        context,
        '${widget.suggested.firstName} is now your counsellor',
      );
      Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      showAppToast(
        context,
        error is TalkApiException
            ? error.message
            : 'Could not switch. Try again.',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final now = widget.current, next = widget.suggested;
    final detail = [
      if (next.languages.isNotEmpty) next.languages.join(' · '),
      if (next.yearsExperience != null) '${next.yearsExperience} years',
    ].join(' · ');
    return CarePage(
      backLabel: 'Back',
      children: [
        const CareEyebrow('Your preferences are saved'),
        const SizedBox(height: 10),
        CareHeading('Keep talking to ${now.firstName}?', size: 29),
        const SizedBox(height: 8),
        const CareCopy('Nothing changes unless you want it to.', size: 13.5),
        const SizedBox(height: 18),
        CareCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const CareEyebrow('Your counsellor'),
              const SizedBox(height: 14),
              CounsellorPerson(counsellor: now),
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: CareColors.sage,
                  borderRadius: BorderRadius.circular(100),
                ),
                child: const Text(
                  '✓ Stays your counsellor',
                  style: TextStyle(
                    fontFamily: careFont,
                    color: Color(0xFF4E6B45),
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        // The other counsellor, quietly.
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: CareColors.line),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CounsellorFace(counsellor: next, size: 30),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text.rich(
                      TextSpan(
                        style: const TextStyle(
                          fontFamily: careFont,
                          color: CareColors.muted,
                          fontSize: 11.5,
                          height: 1.45,
                        ),
                        children: [
                          const TextSpan(text: 'With your new preferences, '),
                          TextSpan(
                            text: next.name,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          if (detail.isNotEmpty) TextSpan(text: ' ($detail)'),
                          const TextSpan(
                            text: ' aligns a little more closely.',
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 2),
                    CareLink(
                      'See ${next.firstName}’s profile',
                      onTap: _seeProfile,
                      size: 12,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        _Option(
          title: 'Keep ${now.firstName}',
          sub: 'Your sessions and history stay as they are',
          on: !_switch,
          onTap: () => setState(() => _switch = false),
        ),
        const SizedBox(height: 10),
        _Option(
          title: 'Switch to ${next.firstName}',
          sub: 'Your next booking will be with ${next.firstName}',
          on: _switch,
          onTap: () => setState(() => _switch = true),
        ),
        const SizedBox(height: 22),
        _saving
            ? const CareSpinner()
            : CarePrimaryButton(
                _switch
                    ? 'Switch to ${next.firstName}'
                    : 'Keep ${now.firstName}',
                onTap: _done,
              ),
      ],
    );
  }
}

class _Option extends StatelessWidget {
  const _Option({
    required this.title,
    required this.sub,
    required this.on,
    required this.onTap,
  });

  final String title;
  final String sub;
  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    selected: on,
    button: true,
    child: Material(
      color: on ? CareColors.blueTint : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: on ? CareColors.blue : CareColors.line,
          width: 1.5,
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Icon(
                on ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                color: on ? CareColors.blue : CareColors.line,
                size: 22,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: CareColors.ink,
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      sub,
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: CareColors.muted,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
