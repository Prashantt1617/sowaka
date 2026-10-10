import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../../services/api_config.dart';

/// The profile design's type and colours (Sowaka Connect › Profile), set in
/// Sora as Figma draws them. The rest of the app defaults to Plus Jakarta
/// Sans, so every style here names its family.
abstract final class ProfileStyle {
  static const brand = Color(0xFF0571A6);
  static const ink = Color(0xFF222222);
  static const inkStrong = Color(0xFF111827);
  static const secondary = Color(0xFF484848);
  static const tertiary = Color(0xFF717171);
  static const muted = Color(0xFF6B7280);
  static const faint = Color(0xFF9CA3AF);
  static const line = Color(0xFFEBEBEB);
  static const surface = Color(0xFFF7F7F9);
  static const green = Color(0xFF16A45B);
  static const red = Color(0xFFDC2626);

  static TextStyle sora(
    double size, {
    FontWeight weight = FontWeight.w400,
    Color color = ink,
    double? height,
    double spacing = 0,
  }) => TextStyle(
    fontFamily: 'Sora',
    fontSize: size,
    fontWeight: weight,
    color: color,
    height: height == null ? null : height / size,
    letterSpacing: spacing,
  );
}

/// A profile photo by URL: stored ones cached on disk, the inline `data:`
/// ones some older accounts still carry decoded in place.
ImageProvider profilePhotoProvider(String url) {
  if (url.startsWith('data:')) {
    return MemoryImage(base64Decode(url.split(',').last));
  }
  return CachedNetworkImageProvider(resolveMediaUrl(url));
}

/// A round photo, or the person's initials on a soft disc when there is none
/// or it fails to load.
class ProfilePhoto extends StatelessWidget {
  const ProfilePhoto({
    super.key,
    required this.name,
    required this.url,
    required this.size,
  });

  final String name;
  final String? url;
  final double size;

  static const _discs = [
    [Color(0xFF0571A6), Color(0xFF38BDF8)],
    [Color(0xFF43E97B), Color(0xFF38F9D7)],
    [Color(0xFF7C3AED), Color(0xFFA78BFA)],
    [Color(0xFFD97706), Color(0xFFFBBF24)],
    [Color(0xFFDB2777), Color(0xFFF472B6)],
    [Color(0xFF059669), Color(0xFF34D399)],
  ];

  @override
  Widget build(BuildContext context) {
    final initials = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .take(2)
        .map((part) => part[0].toUpperCase())
        .join();
    final colors = _discs[name.hashCode.abs() % _discs.length];
    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: colors,
        ),
      ),
      child: Text(
        initials.isEmpty ? '?' : initials,
        style: ProfileStyle.sora(
          size * .34,
          weight: FontWeight.w700,
          color: Colors.white,
        ),
      ),
    );
    final link = url;
    if (link == null || link.isEmpty) return fallback;
    return ClipOval(
      child: Image(
        image: profilePhotoProvider(link),
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => fallback,
        loadingBuilder: (context, child, progress) =>
            progress == null ? child : fallback,
      ),
    );
  }
}

/// A quiet line where a section has nothing to show, or could not load.
class ProfileEmptyNote extends StatelessWidget {
  const ProfileEmptyNote(this.text, {super.key, this.onRetry});

  final String text;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 28),
    child: Column(
      children: [
        Text(
          text,
          textAlign: TextAlign.center,
          style: ProfileStyle.sora(
            13,
            weight: FontWeight.w500,
            color: const Color(0xFF9197A2),
            height: 18.2,
          ),
        ),
        if (onRetry case final retry?) ...[
          const SizedBox(height: 8),
          TextButton(
            onPressed: retry,
            child: Text(
              'Try again',
              style: ProfileStyle.sora(
                13,
                weight: FontWeight.w600,
                color: ProfileStyle.brand,
              ),
            ),
          ),
        ],
      ],
    ),
  );
}
