/// HR's "Start a tour" post (`app_tour`), posted from the dashboard's
/// Engagement › Feed: a picture, a title, a caption and one full-width button
/// that opens the Sowaka tour from its start card. It sits inside the
/// standard post card, so the company's author row above it and the likes and
/// comments under it are every other post's.
///
/// One widget with one picture slot and three text slots, so the Figma design
/// HR is sending replaces this file alone.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../../services/api_config.dart';
import '../../app_tour/app_tour.dart';
import '../../app_tour/app_tour_animations.dart';
import '../data/connect_models.dart';

/// What the card says when the post leaves a slot empty.
abstract final class AppTourPostDefaults {
  static const title = 'Take the Sowaka tour';
  static const actionLabel = 'Get tour';
}

class AppTourPostCard extends StatelessWidget {
  const AppTourPostCard({super.key, required this.post, this.onGetTour});

  final ConnectPost post;

  /// Instead of starting the tour (tests).
  final VoidCallback? onGetTour;

  String _text(String key) {
    final value = post.body[key];
    return value is String ? value.trim() : '';
  }

  String get title => _text('title').isEmpty ? AppTourPostDefaults.title : _text('title');

  String get caption => _text('caption');

  String get actionLabel => _text('actionLabel').isEmpty ? AppTourPostDefaults.actionLabel : _text('actionLabel');

  /// HR's picture, when the post carries one.
  String? get imageUrl {
    final url = _text('mediaUrl');
    return _text('mediaKind') == 'image' && url.isNotEmpty ? url : null;
  }

  @override
  Widget build(BuildContext context) {
    final url = imageUrl;
    return Padding(
      key: const ValueKey('app-tour-post'),
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: AspectRatio(
              aspectRatio: 16 / 9,
              child: url == null ? const AppTourPostArt() : _Picture(url: url),
            ),
          ),
          const SizedBox(height: 14),
          Text(title, style: tourText(18, FontWeight.w800, TourInk.ink, height: 24 / 18)),
          if (caption.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(caption, style: tourText(15, FontWeight.w400, TourInk.body, height: 22 / 15)),
          ],
          const SizedBox(height: 16),
          SizedBox(
            height: 48,
            child: FilledButton(
              key: const ValueKey('app-tour-post-start'),
              onPressed: onGetTour ?? () => unawaited(AppTour.start(context)),
              style: FilledButton.styleFrom(
                backgroundColor: TourInk.blue,
                foregroundColor: Colors.white,
                shape: const StadiumBorder(),
                textStyle: tourText(15, FontWeight.w800, Colors.white),
              ),
              child: Text(actionLabel),
            ),
          ),
        ],
      ),
    );
  }
}

/// HR's picture, the tour's own art while it loads or if it cannot.
class _Picture extends StatelessWidget {
  const _Picture({required this.url});

  final String url;

  @override
  Widget build(BuildContext context) => Image(
    image: mediaImageProvider(url, width: feedImageWidth),
    fit: BoxFit.cover,
    frameBuilder: (context, child, frame, sync) => frame == null && !sync ? const AppTourPostArt() : child,
    errorBuilder: (context, error, stack) => const AppTourPostArt(),
  );
}

/// Until HR uploads a picture (or the Figma design arrives): the tour start
/// card's globe and paper plane, still, on the tour's pale blue.
class AppTourPostArt extends StatelessWidget {
  const AppTourPostArt({super.key});

  @override
  Widget build(BuildContext context) => const ColoredBox(
    key: ValueKey('app-tour-post-art'),
    color: TourInk.panel,
    child: Center(
      child: ExcludeSemantics(
        child: SizedBox(
          width: 104,
          height: 104,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned.fill(child: Image(image: AssetImage(AppTourGlobe.globeAsset))),
              // Where the start card's plane sits, at this size.
              Positioned(
                left: 44,
                top: 8,
                width: 59,
                height: 64,
                child: Image(image: AssetImage(AppTourGlobe.planeAsset)),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
