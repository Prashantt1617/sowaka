import 'package:flutter/material.dart';

import '../../../care/presentation/care_theme.dart';
import '../../../talk/data/talk_api_service.dart';
import '../../data/help_api_service.dart';
import '../../data/help_models.dart';
import '../../data/help_topics.dart';
import '../counsellor_profile_screen.dart';
import '../help_widgets.dart';
import 'grief_notebook.dart';

/// Grief & loss: three notes written by hand, turned like the pages of a
/// notebook, and a blank page to write on; then the matched counsellor,
/// whose profile is a tap away. Reading is never required first.
class GriefTopicScreen extends StatefulWidget {
  const GriefTopicScreen({
    super.key,
    required this.topic,
    required this.help,
    this.match,
    this.backLabel = 'Help',
  });

  final HelpTopic topic;
  final HelpApiService help;

  /// The match when the caller has it; read from the server otherwise.
  final HelpMatch? match;
  final String backLabel;

  @override
  State<GriefTopicScreen> createState() => _GriefTopicScreenState();
}

class _GriefTopicScreenState extends State<GriefTopicScreen> {
  HelpMatch? _match;
  bool _loadingMatch = false;
  String? _matchError;

  @override
  void initState() {
    super.initState();
    _match = widget.match;
    if (_match == null) _loadMatch();
  }

  Future<void> _loadMatch() async {
    setState(() => _loadingMatch = true);
    try {
      final home = await widget.help.home();
      if (!mounted) return;
      setState(() {
        _match = home.match ?? home.noMatch;
        _loadingMatch = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingMatch = false;
        _matchError = error is TalkApiException
            ? error.message
            : 'Could not load your counsellor.';
      });
    }
  }

  void _openProfile(HelpMatch match) => Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => CounsellorProfileScreen(
        service: widget.help,
        counsellorId: match.counsellor.userId,
        backLabel: widget.topic.name,
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final t = widget.topic;
    final cards = t.list('cards');
    final match = _match;
    return CarePage(
      backLabel: widget.backLabel,
      padding: const EdgeInsets.fromLTRB(0, 8, 0, 32),
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // The app's bar already names the page on the web.
              if (!careWebPages) ...[
                CareEyebrow(t.name),
                const SizedBox(height: 10),
              ],
              CareHeading(t.text('title', 'A place to begin.'), size: 32),
              const SizedBox(height: 8),
              CareCopy(t.text('lede', t.intro)),
            ],
          ),
        ),
        const SizedBox(height: 22),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 22),
          child: GriefNotebook(
            notes: [for (final c in cards) c],
            prompt: t.text('writePrompt', 'What does your loss feel like?'),
          ),
        ),
        const SizedBox(height: 26),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const CareSectionTitle('Your counsellor', size: 22),
              const SizedBox(height: 4),

              const SizedBox(height: 14),
              if (_loadingMatch)
                const CareSpinner()
              else if (match != null)
                // The whole card opens the profile, where booking is.
                CareCard(
                  onTap: () => _openProfile(match),
                  child: Stack(
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(right: 40),
                            child: CounsellorPerson(
                              counsellor: match.counsellor,
                            ),
                          ),
                          const SizedBox(height: 14),
                          CareCopy(
                            t.text(
                              'counsellorNote',
                              'You don’t need to have the right words. Start with what’s on your mind.',
                            ),
                            size: 14,
                            color: CareColors.ink,
                          ),
                        ],
                      ),
                      Positioned(
                        top: 0,
                        right: 0,
                        child: Container(
                          width: 30,
                          height: 30,
                          decoration: const BoxDecoration(
                            color: CareColors.blueTint,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.arrow_forward_rounded,
                            size: 16,
                            color: CareColors.blue,
                          ),
                        ),
                      ),
                    ],
                  ),
                )
              else
                CareNotice(
                  _matchError ??
                      'Answer the four questions on Help and your counsellor will show here.',
                  onRetry: _matchError == null ? null : _loadMatch,
                ),
            ],
          ),
        ),
      ],
    );
  }
}
