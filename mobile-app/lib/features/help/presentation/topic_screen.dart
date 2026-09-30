import 'package:flutter/material.dart';

import '../../auth/data/auth_models.dart';
import '../../care/data/care_api_service.dart';
import '../../care/data/care_models.dart';
import '../../care/presentation/care_theme.dart';
import '../../care/presentation/player_screen.dart';
import '../../care/presentation/write_screen.dart';
import '../data/help_api_service.dart';
import '../data/help_topics.dart';
import 'counsellor_profile_screen.dart';

/// A topic: understand it, try something, talk it through.
class TopicScreen extends StatefulWidget {
  const TopicScreen({
    super.key,
    required this.topic,
    required this.care,
    required this.catalog,
    required this.session,
    this.service,
    this.matchedCounsellorId,
    this.showCounsellor = true,
    this.backLabel = 'Help',
  });

  final HelpTopic topic;

  /// Needed only where the counsellor links show.
  final HelpApiService? service;
  final CareApiService care;
  final CareCatalog catalog;
  final AuthSession session;
  final String? matchedCounsellorId;

  /// On the web there is no Help tab to hand over to.
  final bool showCounsellor;
  final String backLabel;

  @override
  State<TopicScreen> createState() => _TopicScreenState();
}

class _TopicScreenState extends State<TopicScreen> {
  CareCatalog get _catalog => widget.catalog;

  void _counsellor() {
    final id = widget.matchedCounsellorId;
    final service = widget.service;
    if (id == null || service == null) {
      Navigator.of(context).pop();
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => CounsellorProfileScreen(
          service: service,
          counsellorId: id,
          backLabel: widget.topic.name,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.topic;
    return CarePage(
      backLabel: widget.backLabel,
      children: [
        const CareEyebrow('Explore'),
        const SizedBox(height: 10),
        CareHeading(t.name, size: 30),
        const SizedBox(height: 10),
        CareCopy(t.intro),
        if (widget.showCounsellor) ...[
          const SizedBox(height: 14),
          CareLink(
            'Discuss this with your counsellor',
            icon: Icons.arrow_forward_rounded,
            onTap: _counsellor,
          ),
        ],
        const SizedBox(height: 22),
        const CareSectionTitle('Understand', size: 17),
        const SizedBox(height: 10),
        CareResourceRow(
          title: t.article,
          meta: '3 min · Read',
          icon: Icons.menu_book_outlined,
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => _ArticleScreen(
                topic: t,
                care: widget.care,
                session: widget.session,
                onCounsellor: widget.showCounsellor ? _counsellor : null,
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        CareResourceRow(
          title: 'A small moment of perspective',
          meta: '2 min · Video',
          icon: Icons.play_circle_outline_rounded,
          tint: CareColors.sky,
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => PlayerScreen(
                track: CareTrack(
                  id: 'topic-${t.id}',
                  title: 'A small moment of perspective',
                  meta: '2 min · ${t.name}',
                  url: _catalog.topicVideos[t.id],
                ),
                backLabel: t.name,
                kind: PlayerKind.video,
              ),
            ),
          ),
        ),
        const SizedBox(height: 22),
        const CareSectionTitle('Try something', size: 17),
        const SizedBox(height: 10),
        CareResourceRow(
          title: t.tool,
          meta: 'A practical reflection',
          icon: Icons.edit_note_rounded,
          tint: CareColors.sage,
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => WriteScreen(
                session: widget.session,
                service: widget.care,
                prompts: _catalog.prompts,
                openingPrompt: t.question,
                context: 'tool:${t.id}',
                backLabel: t.name,
                eyebrow: 'Try something',
                title: t.tool,
                copy: t.toolBody,
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        CareResourceRow(
          title: 'Put it into words',
          meta: 'A prompt for you · Write',
          icon: Icons.edit_outlined,
          tint: CareColors.peach,
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => WriteScreen(
                session: widget.session,
                service: widget.care,
                prompts: _catalog.prompts,
                openingPrompt: t.question,
                context: 'topic:${t.id}',
                backLabel: t.name,
              ),
            ),
          ),
        ),
        if (widget.showCounsellor) ...[
          const SizedBox(height: 22),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: CareColors.sage,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CareSectionTitle('Talk it through.'),
                const SizedBox(height: 6),
                const CareCopy(
                  'Bring what’s on your mind to your next conversation with your counsellor.',
                ),
                const SizedBox(height: 14),
                CarePrimaryButton(
                  'View your counsellor',
                  icon: Icons.arrow_forward_rounded,
                  onTap: _counsellor,
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _ArticleScreen extends StatelessWidget {
  const _ArticleScreen({
    required this.topic,
    required this.care,
    required this.session,
    this.onCounsellor,
  });

  final HelpTopic topic;
  final CareApiService care;
  final AuthSession session;
  final VoidCallback? onCounsellor;

  @override
  Widget build(BuildContext context) {
    return CarePage(
      backLabel: topic.name,
      children: [
        const CareEyebrow('Understand'),
        const SizedBox(height: 10),
        CareHeading(topic.article, size: 28),
        const SizedBox(height: 16),
        CareCopy(
          '${topic.intro} You can begin by noticing what this experience looks like for you, without needing an immediate answer.',
          size: 14.5,
          color: CareColors.ink,
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: CareColors.lilac,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Text(
            topic.question,
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.ink,
              fontSize: 16,
              fontWeight: FontWeight.w500,
              height: 1.4,
            ),
          ),
        ),
        const SizedBox(height: 16),
        const CareCopy(
          'You might want to put your thoughts into words, explore a practical reflection, or talk them through with someone.',
          size: 14.5,
          color: CareColors.ink,
        ),
        const SizedBox(height: 22),
        CarePrimaryButton(
          'Reflect in Write',
          icon: Icons.edit_outlined,
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => WriteScreen(
                session: session,
                service: care,
                openingPrompt: topic.question,
                context: 'topic:${topic.id}',
                backLabel: topic.article,
              ),
            ),
          ),
        ),
        if (onCounsellor case final open?) ...[
          const SizedBox(height: 10),
          Center(child: CareLink('View your counsellor', onTap: open)),
        ],
      ],
    );
  }
}
