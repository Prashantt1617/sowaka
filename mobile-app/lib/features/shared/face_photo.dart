import 'package:flutter/material.dart';

import '../../services/api_config.dart';

/// A person's face: their photo in a circle of [size] when [photoUrl] is set,
/// and [fallback] (the initials, or the row's own icon, as each screen draws
/// it) when it is not, while it loads, and if it fails. So a screen keeps its
/// own look for someone with no photo, and shows the photo for everyone else.
class FacePhoto extends StatelessWidget {
  const FacePhoto({
    super.key,
    required this.photoUrl,
    required this.size,
    required this.fallback,
    this.semanticLabel,
  });

  final String? photoUrl;
  final double size;
  final Widget fallback;
  final String? semanticLabel;

  /// Whether [url] is something to load.
  static bool has(String? url) => url != null && url.trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final url = photoUrl?.trim();
    if (url == null || url.isEmpty) return fallback;
    return ClipOval(
      child: SizedBox(
        width: size,
        height: size,
        child: Image(
          image: avatarImageProvider(url),
          width: size,
          height: size,
          fit: BoxFit.cover,
          semanticLabel: semanticLabel,
          errorBuilder: (_, _, _) => fallback,
          frameBuilder: (_, child, frame, wasSyncLoaded) =>
              frame == null && !wasSyncLoaded ? fallback : child,
        ),
      ),
    );
  }
}
