part of 'games_home.dart';

// The Games home's pictures (Figma 3605:31672 and the live cards), put back
// together from the design's own vector pieces at the places its CSS puts
// them. Each is drawn at the design's size and scaled to the box it is given.

/// One vector piece of a picture, at its place in design points.
class _ArtPiece {
  const _ArtPiece(this.file, this.left, this.top, this.width, this.height, {this.turns = 0});

  final String file;
  final double left;
  final double top;
  final double width;
  final double height;

  /// Clockwise, in degrees.
  final double turns;
}

/// A letter set on a picture, by its middle.
class _ArtLetter {
  const _ArtLetter(this.text, this.x, this.y, {this.size = 9});

  final String text;
  final double x;
  final double y;
  final double size;
}

class _ComposedArt extends StatelessWidget {
  const _ComposedArt({
    required this.width,
    required this.height,
    required this.pieces,
    this.letters = const [],
  });

  final double width;
  final double height;
  final List<_ArtPiece> pieces;
  final List<_ArtLetter> letters;

  @override
  Widget build(BuildContext context) {
    return FittedBox(
      fit: BoxFit.contain,
      child: SizedBox(
        width: width,
        height: height,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            for (final piece in pieces)
              Positioned(
                left: piece.left,
                top: piece.top,
                width: piece.width,
                height: piece.height,
                child: Transform.rotate(
                  angle: piece.turns * math.pi / 180,
                  child: SvgPicture.asset('${GamesStyle.asset}/${piece.file}', fit: BoxFit.fill),
                ),
              ),
            for (final letter in letters)
              Positioned(
                left: letter.x - 10,
                top: letter.y - 10,
                width: 20,
                height: 20,
                child: Center(
                  child: Text(
                    letter.text,
                    style: GamesStyle.lilita(
                      letter.size,
                      color: GamesStyle.ink2,
                      height: letter.size,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Caption This: the moody cat sticker (node 3605:31597).
Widget _moodyCatArt() =>
    SvgPicture.asset('${GamesStyle.asset}/art_moody_cat.svg', width: 128.5, height: 112);

/// Best Photo on its live card (node 3690:43102, "Photo with overlapping
/// camera"): the photo tipped back, the camera over its corner, a sparkle
/// above, placed as the design's CSS places them in its 88 × 91 frame. The
/// tile it sits in shows the top-left 85pt of it.
class _LivePhotoArt extends StatelessWidget {
  const _LivePhotoArt({required this.motion});

  final Animation<double>? motion;

  /// A piece of [width] × [height] centred on [centre], turned and slanted
  /// by the degrees the design gives it (its `rotate` then `skew-x`).
  static Widget _piece(
    String file, {
    required Offset centre,
    required double width,
    required double height,
    required double turn,
    required double skew,
    Widget Function(Widget child)? wrap,
  }) {
    Widget child = Transform(
      alignment: Alignment.center,
      transform: Matrix4.rotationZ(turn * math.pi / 180)
        ..multiply(Matrix4.skewX(skew * math.pi / 180)),
      child: SvgPicture.asset('${GamesStyle.asset}/$file', width: width, height: height),
    );
    if (wrap != null) child = wrap(child);
    return Positioned(
      left: centre.dx - width / 2,
      top: centre.dy - height / 2,
      width: width,
      height: height,
      child: child,
    );
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 88.392,
      height: 90.641,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // inset 16.18% 26.76% 10.14% 5.79%, rotate -9.23°, skew-x -0.44°.
          _piece(
            'art_live_photo.svg',
            centre: const Offset(34.928, 48.058),
            width: 53.7158,
            height: 61.7422,
            turn: -9.23,
            skew: -0.44,
          ),
          // inset 39.36% 3.79% 20.53% 51.33%, rotate 7.18°, skew-x 0.35°;
          // it grows from that box's middle.
          _piece(
            'art_live_camera.svg',
            centre: const Offset(65.207, 53.854),
            width: 38.6177,
            height: 34.5482,
            turn: 7.18,
            skew: 0.35,
            wrap: (child) => _CameraLanding(motion: motion, child: child),
          ),
          // inset 13.27% 15.04% 72.57% 70.8%, the picture 8% past it all round.
          Positioned(
            left: 61.581,
            top: 11.028,
            child: _SparkleBlink(
              motion: motion,
              child: SvgPicture.asset(
                '${GamesStyle.asset}/art_live_sparkle.svg',
                width: 14.5157,
                height: 14.8341,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Most Likely: a silhouette with a dot and a star (node 3605:31650). The
/// design's code also lists a tiny yellow "?" on the neck, but it is not in
/// the design as drawn, so it is left out here too.
Widget _mostLikelyArt() => const _ComposedArt(
  width: 172.593,
  height: 108.786,
  pieces: [
    _ArtPiece('art_likely_dot.svg', 19.42, 12.68, 28.77, 28.77),
    _ArtPiece('art_likely_head.svg', 52.50, 14.85, 67.59, 67.60),
    _ArtPiece('art_likely_body.svg', 38.10, 58.71, 97.09, 51.78),
    _ArtPiece('art_likely_star.svg', 118.66, 11.24, 39.56, 36.68),
  ],
);

/// A team word game: four letter tiles over two dashes (node 3646:36898),
/// spelling [word] — four letters.
Widget _tilesArt(String word) {
  final letters = word.padRight(4).characters.take(4).toList();
  return _ComposedArt(
    width: 172.61,
    height: 108.786,
    pieces: const [
      _ArtPiece('art_tile_cream.svg', 14.38, 33.54, 35.25, 38.83),
      _ArtPiece('art_tile_pink.svg', 48.19, 27.06, 35.23, 38.83),
      _ArtPiece('art_tile_blue.svg', 81.99, 33.54, 35.25, 38.83),
      _ArtPiece('art_tile_purple.svg', 115.79, 27.06, 35.25, 38.83),
      _ArtPiece('art_tile_lines.svg', 44.58, 81.72, 83.44, 4.32),
    ],
    letters: [
      _ArtLetter(letters[0], 32.55, 52.8, size: 15),
      _ArtLetter(letters[1], 66.08, 46.3, size: 15),
      _ArtLetter(letters[2], 99.10, 52.8, size: 15),
      _ArtLetter(letters[3], 134.03, 46.3, size: 15),
    ],
  );
}

/// Odd One Out: a happy face, a sad one, and a card (node 3646:36932).
Widget _oddOneOutArt() => const _ComposedArt(
  width: 172.593,
  height: 108.786,
  pieces: [
    _ArtPiece('art_odd_happy.svg', 25.16, 22.03, 60.41, 60.41),
    _ArtPiece('art_odd_sad.svg', 77.66, 22.03, 60.41, 60.41),
    _ArtPiece('art_odd_eye.svg', 42.42, 42.89, 8.63, 8.62),
    _ArtPiece('art_odd_eye.svg', 58.98, 42.89, 8.63, 8.62),
    _ArtPiece('art_odd_faces.svg', 40.99, 45.05, 79.83, 21.94),
    _ArtPiece('art_odd_card.svg', 122.50, 65.94, 27.33, 30.20, turns: 8),
  ],
  letters: [_ArtLetter('?', 138.78, 83.12, size: 9)],
);

/// A game's picture: the design's for the games it drew, else the one in
/// the catalog (or bundled with the app) over the game's own colour.
class _GamePicture extends StatelessWidget {
  const _GamePicture({required this.game, this.thumbnail, this.background});

  final GameCatalogEntry game;
  final String? thumbnail;
  final Color? background;

  @override
  Widget build(BuildContext context) {
    if (game.key == 'odd-one-out') {
      return ColoredBox(color: background ?? GamesStyle.mintArt, child: _oddOneOutArt());
    }
    final accent = game.accentColor ?? GamesStyle.purple;
    final placeholder = Container(
      color: background ?? accent.withValues(alpha: 0.25),
      alignment: Alignment.center,
      child: Text(
        game.name.characters.first.toUpperCase(),
        style: GamesStyle.lilita(40, color: GamesStyle.ink2),
      ),
    );
    final picture = GameThumbnail.of(game.thumbnail ?? thumbnail);
    return switch (picture) {
      MemoryThumbnail(:final bytes) => Image.memory(
        bytes,
        fit: BoxFit.cover,
        gaplessPlayback: true,
        errorBuilder: (_, _, _) => placeholder,
      ),
      NetworkThumbnail(:final url) => CachedNetworkImage(
        imageUrl: url,
        fit: BoxFit.cover,
        placeholder: (_, _) => placeholder,
        errorWidget: (_, _, _) => placeholder,
      ),
      AssetThumbnail(:final path) => Image.asset(
        path,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => placeholder,
      ),
      SvgThumbnail(:final svg) => SvgPicture.string(
        svg,
        fit: BoxFit.cover,
        placeholderBuilder: (_) => placeholder,
      ),
      NoThumbnail() => placeholder,
    };
  }
}

/// The live card's picture: a rounded tile tipped 5°, its art inside
/// (node 3690:43101, "Photo & camera illustration"), clipped to the tile's
/// inside as the design's `overflow-clip` does. A [rocking] tile rocks on the
/// pane's loop as the design's lobby card does (3690:43069).
class _IllustrationTile extends StatelessWidget {
  const _IllustrationTile({
    required this.color,
    required this.child,
    this.padding = 6,
    this.fitted = true,
    this.rocking,
  });

  final Color color;
  final Widget child;
  final double padding;

  /// Whether [child] is scaled to fit inside [padding]; otherwise it is
  /// drawn at its own size.
  final bool fitted;

  /// The loop to rock on; the tile keeps still at 5° without one.
  final Animation<double>? rocking;

  static const _radius = 24.0;
  static const _stroke = 2.5;

  @override
  Widget build(BuildContext context) {
    final tile = Container(
      width: 90,
      height: 90,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(_radius),
        border: Border.all(color: GamesStyle.ink, width: _stroke),
        boxShadow: const [BoxShadow(color: GamesStyle.ink, offset: Offset(0, 5))],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(_radius - _stroke),
        child: fitted
            ? Padding(
                padding: EdgeInsets.all(padding),
                child: FittedBox(fit: BoxFit.contain, child: child),
              )
            // At its own size from the top-left, the rest cut off, as the
            // design lays the photo out in its tile.
            : OverflowBox(
                alignment: Alignment.topLeft,
                maxWidth: double.infinity,
                maxHeight: double.infinity,
                child: child,
              ),
      ),
    );
    return SizedBox(
      width: 97.5,
      height: 97.5,
      child: Center(child: _Rocking(motion: rocking, child: tile)),
    );
  }
}

// ---------------------------------------------------------------- motion

// The Games pane's loop (Figma's motion on 3573:61034): one 1.5 s timeline,
// round and round, that every moving picture on the pane reads. Each eases
// out over every step, as the design's keyframes do.

/// The lobby card's picture rocking (3690:43069): +5° to -10° by half way,
/// then back to +5°. In turns, as RotationTransition takes them.
final _rock = TweenSequence<double>([
  TweenSequenceItem(
    tween: Tween(begin: 5 / 360, end: -10 / 360).chain(CurveTween(curve: Curves.easeOut)),
    weight: 50,
  ),
  TweenSequenceItem(
    tween: Tween(begin: -10 / 360, end: 5 / 360).chain(CurveTween(curve: Curves.easeOut)),
    weight: 50,
  ),
]);

/// The camera landing (3690:43117): 1.2× to 1× over the first third, then
/// held for the rest of the loop.
final _land = TweenSequence<double>([
  TweenSequenceItem(
    tween: Tween(begin: 1.2, end: 1.0).chain(CurveTween(curve: Curves.easeOut)),
    weight: 100 / 3,
  ),
  TweenSequenceItem(tween: ConstantTween(1.0), weight: 200 / 3),
]);

/// The sparkle blinking back in (3690:43137): unseen to seen over the first
/// 5.9% of the loop (about 89 ms), then held.
final _blink = TweenSequence<double>([
  TweenSequenceItem(
    tween: Tween(begin: 0.0, end: 1.0).chain(CurveTween(curve: Curves.easeOut)),
    weight: 5.908,
  ),
  TweenSequenceItem(tween: ConstantTween(1.0), weight: 94.092),
]);

/// [child] rocking about its middle on [motion]; at rest at +5°, the
/// design's still pose, when there is no motion (reduced motion).
class _Rocking extends StatelessWidget {
  const _Rocking({required this.motion, required this.child});

  final Animation<double>? motion;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final motion = this.motion;
    if (motion == null) return Transform.rotate(angle: 5 * math.pi / 180, child: child);
    return RotationTransition(turns: _rock.animate(motion), child: child);
  }
}

/// [child] landing on [motion], from its middle; its full size at rest.
class _CameraLanding extends StatelessWidget {
  const _CameraLanding({required this.motion, required this.child});

  final Animation<double>? motion;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final motion = this.motion;
    if (motion == null) return child;
    return ScaleTransition(scale: _land.animate(motion), child: child);
  }
}

/// [child] blinking back in on [motion]; fully shown at rest.
class _SparkleBlink extends StatelessWidget {
  const _SparkleBlink({required this.motion, required this.child});

  final Animation<double>? motion;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final motion = this.motion;
    if (motion == null) return child;
    return FadeTransition(opacity: _blink.animate(motion), child: child);
  }
}
