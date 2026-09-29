import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../services/api_config.dart';
import '../../manager/presentation/manager_screen.dart';
import '../data/garden_models.dart';
import 'garden_layout.dart';

/// The garden's accent: the app's blue, as the bar and the primary buttons
/// wear it, with a light tint for selected tiles.
class GardenColors {
  static const blue = Color(0xFF0571A6);
  static const blueTint = Color(0xFFE3F0F7);
}

/// The one tree, everyone's tree: the illustration with whatever has been
/// added to it this season blooming on the canopy. Sprites sit where their
/// note's id puts them, so nothing shifts between opens.
class GardenTree extends StatelessWidget {
  const GardenTree({
    super.key,
    required this.width,
    required this.sprites,
    this.spriteSize = 18,
    this.onSpriteTap,
    this.highlightId,
  });

  final double width;
  final List<GardenSprite> sprites;
  final double spriteSize;
  final void Function(GardenSprite sprite)? onSpriteTap;
  final String? highlightId;

  /// The illustration's own proportions.
  static const aspect = 1.048;

  /// The canopy, as a fraction of the drawn image: centre and radii.
  static const canopyCx = 0.5, canopyCy = 0.33, canopyRx = 0.36, canopyRy = 0.19;

  @override
  Widget build(BuildContext context) {
    final height = width * aspect;
    return SizedBox(
      width: width,
      height: height,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Image.asset('assets/garden/tree.png', width: width, height: height, fit: BoxFit.fill),
          for (final sprite in sprites)
            Positioned(
              left: width * canopyCx + spritePlace(sprite.id).dx * width * canopyRx - spriteSize * .64,
              top: height * canopyCy + spritePlace(sprite.id).dy * height * canopyRy - spriteSize * .64,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: onSpriteTap == null ? null : () => onSpriteTap!(sprite),
                child: _Sprite(kind: sprite.kind, size: spriteSize, selected: sprite.id == highlightId),
              ),
            ),
        ],
      ),
    );
  }
}

class _Sprite extends StatelessWidget {
  const _Sprite({required this.kind, required this.size, required this.selected});

  final String kind;
  final double size;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final image = SvgPicture.asset(kindOf(kind).asset, width: size, height: size);
    // Every sprite sits on a soft white disc, so it reads against the canopy
    // from across the garden; the selected one gets a ring on top of that.
    return Container(
      padding: EdgeInsets.all(size * .14),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .88),
        shape: BoxShape.circle,
        border: selected ? Border.all(color: Colors.white, width: 3) : null,
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: .22), blurRadius: 4, offset: const Offset(0, 2)),
          if (selected) BoxShadow(color: GardenColors.blue.withValues(alpha: .45), spreadRadius: 4),
        ],
      ),
      child: image,
    );
  }
}

/// A kind's sprite at a size, for chips, rows and pickers.
class KindIcon extends StatelessWidget {
  const KindIcon(this.kind, {super.key, this.size = 22});

  final String kind;
  final double size;

  @override
  Widget build(BuildContext context) => SvgPicture.asset(kindOf(kind).asset, width: size, height: size);
}

class PersonFace extends StatelessWidget {
  const PersonFace({super.key, required this.initial, required this.photoUrl, required this.size, this.index = 2});

  final String initial;
  final String? photoUrl;
  final double size;
  final int index;

  @override
  Widget build(BuildContext context) {
    final url = photoUrl;
    if (url == null || url.isEmpty) return AvatarBadge(initial: initial, index: index, size: size);
    return ClipOval(
      child: Image(
        image: avatarImageProvider(url),
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => AvatarBadge(initial: initial, index: index, size: size),
      ),
    );
  }
}

/// The back tile the pushed garden screens wear.
class GardenTopBar extends StatelessWidget {
  const GardenTopBar({super.key, required this.title, this.subtitle, this.onBack, this.trailing, this.transparent = false});

  final String title;
  final String? subtitle;
  final VoidCallback? onBack;
  final Widget? trailing;
  final bool transparent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(16, MediaQuery.paddingOf(context).top + 8, 16, 12),
      decoration: transparent
          ? const BoxDecoration(
              gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xF2FFFFFF), Color(0x00FFFFFF)]),
            )
          : const BoxDecoration(color: Colors.white, border: Border(bottom: BorderSide(color: Color(0xFFF3F4F6)))),
      child: Row(
        children: [
          if (onBack != null) ...[
            Material(
              color: MColors.bg,
              borderRadius: BorderRadius.circular(12),
              child: InkWell(
                onTap: onBack,
                borderRadius: BorderRadius.circular(12),
                child: SizedBox(
                  width: 38,
                  height: 38,
                  child: Center(child: SvgPicture.asset('assets/icons/chevron_back.svg', width: 20, height: 20)),
                ),
              ),
            ),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontFamily: 'Sora', color: MColors.ink, fontSize: 19, fontWeight: FontWeight.w800),
                ),
                if (subtitle case final text?)
                  Text(text, style: const TextStyle(color: MColors.inkSoft, fontSize: 12)),
              ],
            ),
          ),
          if (trailing case final widget?) widget,
        ],
      ),
    );
  }
}

class RoundTile extends StatelessWidget {
  const RoundTile({super.key, required this.child, required this.onTap, this.label});

  final Widget child;
  final VoidCallback onTap;
  final String? label;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        elevation: 2,
        shadowColor: Colors.black26,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: SizedBox(width: 38, height: 38, child: Center(child: child)),
        ),
      ),
    );
  }
}
