import 'package:flutter/material.dart';

import 'network_status.dart';

/// "No internet connection." across the top while the server cannot be
/// reached. One line, nothing to tap; it leaves on its own when the
/// connection is back. The same bar over a blank screen and over content
/// that loaded earlier, which stays readable underneath.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key});

  static const background = Color(0xFF996300);
  static const foreground = Color(0xFFFFF5DC);

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: NetworkStatus.offline,
      builder: (context, offline, _) {
        if (!offline) return const SizedBox.shrink();
        return Material(
          color: background,
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                children: [
                  const Icon(Icons.wifi_off_rounded, size: 16, color: foreground),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'No internet connection.',
                      style: const TextStyle(
                        fontFamily: 'Sora',
                        color: foreground,
                        fontSize: 13,
                        height: 18 / 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// A screen with the banner above it. While the banner shows, the content
/// below no longer pads for the status bar — the banner already did.
class OfflineAware extends StatelessWidget {
  const OfflineAware({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: NetworkStatus.offline,
      builder: (context, offline, _) => Column(
        children: [
          const OfflineBanner(),
          Expanded(
            child: offline
                ? MediaQuery.removePadding(context: context, removeTop: true, child: child)
                : child,
          ),
        ],
      ),
    );
  }
}

/// The screen for a launch with no connection and nothing loaded yet: the
/// banner over a skeleton of the home — the shape of the page in grey, so
/// it reads as "loading, not broken", as the feed apps do it.
class OfflineSkeletonScreen extends StatelessWidget {
  const OfflineSkeletonScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const OfflineBanner(),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
            child: Row(
              children: [
                const _Bone(width: 99, height: 28, radius: 8),
                const Spacer(),
                const _Bone(width: 24, height: 24, radius: 12),
                const SizedBox(width: 16),
                const _Bone(width: 40, height: 40, radius: 20),
              ],
            ),
          ),
          const Divider(height: 1, color: Color(0xFFF3F4F6)),
          Expanded(
            child: ListView(
              physics: const NeverScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              children: const [
                _SkeletonCard(lines: [0.0]),
                SizedBox(height: 12),
                _SkeletonCard(lines: [0.4, 0.85, 0.6]),
                SizedBox(height: 12),
                _SkeletonCard(lines: [0.4, 0.7]),
                SizedBox(height: 12),
                _SkeletonCard(lines: [0.4, 0.85, 0.85]),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A grey block standing in for text or an image.
class _Bone extends StatelessWidget {
  const _Bone({required this.width, required this.height, this.radius = 6});
  final double? width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) => Container(
    width: width,
    height: height,
    decoration: BoxDecoration(
      color: const Color(0xFFEBEBEB),
      borderRadius: BorderRadius.circular(radius),
    ),
  );
}

/// A card's worth of bones: an avatar beside a name line, then the lines
/// given as fractions of the width. An empty first line draws the composer.
class _SkeletonCard extends StatelessWidget {
  const _SkeletonCard({required this.lines});
  final List<double> lines;

  @override
  Widget build(BuildContext context) {
    final composer = lines.length == 1 && lines.first == 0.0;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEBEBEB)),
      ),
      child: composer
          ? const Row(
              children: [
                _Bone(width: 44, height: 44, radius: 22),
                SizedBox(width: 12),
                Expanded(child: _Bone(width: null, height: 44, radius: 22)),
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    _Bone(width: 36, height: 36, radius: 18),
                    SizedBox(width: 10),
                    _Bone(width: 120, height: 12),
                  ],
                ),
                const SizedBox(height: 14),
                for (final (index, fraction) in lines.indexed) ...[
                  if (index > 0) const SizedBox(height: 8),
                  FractionallySizedBox(
                    widthFactor: fraction,
                    alignment: Alignment.centerLeft,
                    child: const _Bone(width: null, height: 10),
                  ),
                ],
              ],
            ),
    );
  }
}
