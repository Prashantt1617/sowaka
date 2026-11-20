import 'package:flutter/material.dart';

import '../../../../services/api_config.dart';
import '../../../care/presentation/player_screen.dart' show InlineVideo;
import '../data/onboarding_models.dart';
import 'onboarding_kit.dart';

/// Two of the onboarding home's tabs (new-joiner artifact, "Each tile opens
/// its own screen"): Watch list and Your profile. Both read the home the
/// page already has; nothing here is the device's own.

// ─── Watch list ─────────────────────────────────────────────────────────────

/// "About `company`": the Meet us videos the portal plays, two to a row.
class OnbWatchScreen extends StatelessWidget {
  const OnbWatchScreen({super.key, required this.shell, required this.home});

  final OnboardingShell shell;
  final OnboardingHome home;

  /// The artboard's card colours, in turn.
  static const _tints = [OnbColors.primary, Color(0xFF15803D), OnbColors.amber, OnbColors.blue, OnbColors.violet];

  Future<void> _play(BuildContext context, OnbVideo video) => Navigator.of(context).push<void>(
    MaterialPageRoute(builder: (_) => _VideoPage(shell: shell, video: video)),
  );

  @override
  Widget build(BuildContext context) {
    final videos = home.watch;
    final company = home.companyName;
    return OnbScaffold(
      shell: shell,
      title: 'Watch list',
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          if (videos.isNotEmpty) ...[
            OnbTabHead(
              title: company == null ? 'About us' : 'About $company',
              meta: videos.length == 1 ? '1 video' : '${videos.length} videos',
            ),
            const SizedBox(height: 8),
            for (var i = 0; i < videos.length; i += 2) ...[
              if (i > 0) const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(child: _VideoCard(video: videos[i], color: _tints[i % _tints.length], onTap: () => _play(context, videos[i]))),
                  const SizedBox(width: 10),
                  Expanded(
                    child: i + 1 < videos.length
                        ? _VideoCard(video: videos[i + 1], color: _tints[(i + 1) % _tints.length], onTap: () => _play(context, videos[i + 1]))
                        : const SizedBox.shrink(),
                  ),
                ],
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _VideoCard extends StatelessWidget {
  const _VideoCard({required this.video, required this.color, required this.onTap});

  final OnbVideo video;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'Play ${video.title}',
    excludeSemantics: true,
    child: Material(
      key: ValueKey('watch-${video.id}'),
      color: color,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          height: 160,
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: const BoxDecoration(color: Color(0x38FFFFFF), shape: BoxShape.circle),
                child: const Icon(Icons.play_arrow_rounded, size: 18, color: Colors.white),
              ),
              Text(
                video.title,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 15, height: 1.25, fontWeight: FontWeight.w700, color: Colors.white),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

/// A video from the list, played as the portal plays it (its own link).
class _VideoPage extends StatelessWidget {
  const _VideoPage({required this.shell, required this.video});

  final OnboardingShell shell;
  final OnbVideo video;

  @override
  Widget build(BuildContext context) {
    final url = video.url.startsWith('/') ? '${ApiConfig.baseUrl}${video.url}' : video.url;
    return OnbScaffold(
      shell: shell,
      title: 'Watch list',
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          ClipRRect(borderRadius: BorderRadius.circular(18), child: InlineVideo(url: url, title: video.title)),
          const SizedBox(height: 12),
          Text(video.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text)),
        ],
      ),
    );
  }
}

// ─── Your profile ───────────────────────────────────────────────────────────

/// "Your profile": the portal's Employee profile sections, each Done or To
/// do, and the count and percent the portal shows.
class OnbProfileScreen extends StatelessWidget {
  const OnbProfileScreen({super.key, required this.shell, required this.profile});

  final OnboardingShell shell;
  final OnbProfileState profile;

  @override
  Widget build(BuildContext context) {
    final pct = profile.percent;
    final all = pct >= 100;
    final sections = profile.sections;
    return OnbScaffold(
      shell: shell,
      title: 'Your profile',
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          OnbCard(
            key: const ValueKey('profile-head'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Expanded(
                      child: Text(all ? 'All done' : 'Your profile', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: OnbColors.text)),
                    ),
                    Text(
                      all ? 'All done' : '${profile.done} of ${profile.total} sections done',
                      style: TextStyle(fontSize: 12, color: all ? OnbColors.successText : OnbColors.text3),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(999),
                        child: SizedBox(
                          height: 8,
                          child: LinearProgressIndicator(
                            value: pct / 100,
                            backgroundColor: OnbColors.line,
                            color: all ? OnbColors.successDot : OnbColors.amber,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text('$pct%', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: OnbColors.text)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (sections.isNotEmpty)
            Container(
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
              child: Column(
                children: [
                  for (final (i, s) in sections.indexed)
                    Container(
                      key: ValueKey('profile-section-${s.key}'),
                      constraints: const BoxConstraints(minHeight: 56),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(border: i == sections.length - 1 ? null : const Border(bottom: BorderSide(color: OnbColors.line))),
                      child: Semantics(
                        label: '${s.title}. ${s.done ? 'Done' : 'To do'}',
                        excludeSemantics: true,
                        child: Row(
                          children: [
                            Container(
                              width: 24,
                              height: 24,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: s.done ? OnbColors.successDot : Colors.white,
                                border: s.done ? null : Border.all(color: OnbColors.lineDark, width: 2),
                              ),
                              child: s.done ? const Icon(Icons.check_rounded, size: 14, color: Colors.white) : null,
                            ),
                            const SizedBox(width: 12),
                            Expanded(child: Text(s.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text))),
                            Text(s.done ? 'Done' : 'To do', style: TextStyle(fontSize: 12, color: s.done ? OnbColors.successText : OnbColors.text3)),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// A tab's heading: the title, and its count on the right.
class OnbTabHead extends StatelessWidget {
  const OnbTabHead({super.key, required this.title, required this.meta});

  final String title;
  final String meta;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.baseline,
    textBaseline: TextBaseline.alphabetic,
    children: [
      Expanded(
        child: Semantics(header: true, child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text))),
      ),
      Text(meta, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text2)),
    ],
  );
}
