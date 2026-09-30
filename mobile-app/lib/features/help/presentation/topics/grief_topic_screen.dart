import 'package:flutter/material.dart';

import '../../../care/presentation/care_theme.dart';
import '../../../talk/data/talk_api_service.dart';
import '../../data/help_api_service.dart';
import '../../data/help_models.dart';
import '../../data/help_topics.dart';
import '../counsellor_profile_screen.dart';
import '../help_booking_screen.dart';
import '../help_widgets.dart';

/// Grief & loss: three cards to read at your own pace, then the matched
/// counsellor with an appointment to book. Reading is never required first.
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
  final _pager = PageController(viewportFraction: 0.92);
  int _card = 0;
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

  @override
  void dispose() {
    _pager.dispose();
    super.dispose();
  }

  void _go(int card) {
    final cards = widget.topic.list('cards');
    final target = card.clamp(0, cards.length - 1);
    _pager.animateToPage(
      target,
      duration: const Duration(milliseconds: 320),
      curve: Curves.easeOut,
    );
  }

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
              CareEyebrow(t.name),
              const SizedBox(height: 10),
              CareHeading(t.text('title', 'A place to begin.'), size: 32),
              const SizedBox(height: 8),
              CareCopy(t.text('lede', t.intro)),
            ],
          ),
        ),
        const SizedBox(height: 20),
        SizedBox(
          height: 252,
          child: PageView.builder(
            controller: _pager,
            itemCount: cards.length,
            onPageChanged: (i) => setState(() => _card = i),
            itemBuilder: (_, i) {
              final c = cards[i];
              return Padding(
                padding: EdgeInsets.only(
                  left: i == 0 ? 20 : 6,
                  right: i == cards.length - 1 ? 20 : 6,
                ),
                child: Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: CareColors.sage,
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      CareEyebrow('${c['eyebrow'] ?? ''}'),
                      const SizedBox(height: 8),
                      Text(
                        '${c['title'] ?? ''}',
                        style: const TextStyle(
                          fontFamily: careFont,
                          color: CareColors.ink,
                          fontSize: 22,
                          fontWeight: FontWeight.w700,
                          height: 1.15,
                          letterSpacing: -0.4,
                        ),
                      ),
                      const SizedBox(height: 10),
                      CareCopy(
                        '${c['body'] ?? ''}',
                        size: 14,
                        color: CareColors.ink,
                      ),
                      const SizedBox(height: 10),
                      Text(
                        '${c['note'] ?? ''}',
                        style: const TextStyle(
                          fontFamily: careFont,
                          color: CareColors.blue,
                          fontSize: 13,
                          height: 1.45,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 14),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _Round(
              icon: Icons.arrow_back_rounded,
              enabled: _card > 0,
              onTap: () => _go(_card - 1),
            ),
            const SizedBox(width: 18),
            for (var i = 0; i < cards.length; i++)
              GestureDetector(
                onTap: () => _go(i),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  width: i == _card ? 22 : 7,
                  height: 7,
                  decoration: BoxDecoration(
                    color: i == _card ? CareColors.blue : CareColors.line,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
            const SizedBox(width: 18),
            _Round(
              icon: Icons.arrow_forward_rounded,
              enabled: _card < cards.length - 1,
              onTap: () => _go(_card + 1),
            ),
          ],
        ),
        const SizedBox(height: 6),
        const Center(child: CareMicro('Swipe at your pace')),
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
                CareCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      CounsellorPerson(counsellor: match.counsellor),
                      const SizedBox(height: 14),
                      CareCopy(
                        t.text(
                          'counsellorNote',
                          'You don’t need to have the right words. Start with what’s on your mind.',
                        ),
                        size: 14,
                        color: CareColors.ink,
                      ),
                      const SizedBox(height: 16),
                      CarePrimaryButton(
                        t.text('bookLabel', 'Book an appointment'),
                        icon: Icons.calendar_month_outlined,
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => HelpBookingScreen(
                              service: widget.help,
                              counsellor: match.counsellor,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Center(
                        child: CareLink(
                          'Get to know ${match.counsellor.firstName}',
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => CounsellorProfileScreen(
                                service: widget.help,
                                counsellorId: match.counsellor.userId,
                                backLabel: t.name,
                              ),
                            ),
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
              const SizedBox(height: 10),
              const CareMicro(
                'A session is 40 minutes on video. You can share as much or as little as you feel ready to.',
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Round extends StatelessWidget {
  const _Round({
    required this.icon,
    required this.enabled,
    required this.onTap,
  });

  final IconData icon;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Opacity(
    opacity: enabled ? 1 : 0.35,
    child: Material(
      color: Colors.white,
      shape: const CircleBorder(side: BorderSide(color: CareColors.line)),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: enabled ? onTap : null,
        child: SizedBox(
          width: 40,
          height: 40,
          child: Icon(icon, size: 18, color: CareColors.blue),
        ),
      ),
    ),
  );
}
