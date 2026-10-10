part of 'games_home.dart';

// The explore cards' pictures (Figma 3605:31672), put back together from the
// design's own vector pieces at the places its CSS puts them. Each is drawn at
// the design's size and scaled to the box it is given.

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
  const _ArtLetter(this.text, this.x, this.y, {this.size = 9, this.color = GamesStyle.ink2});

  final String text;
  final double x;
  final double y;
  final double size;
  final Color color;
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
                    style: GamesStyle.lilita(letter.size, color: letter.color, height: letter.size),
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

/// Best Photo: the photo with a camera over it (node 3605:31623), tipped 2°.
Widget _photoArt() => Transform.rotate(
  angle: 2 * math.pi / 180,
  child: SvgPicture.asset(
    '${GamesStyle.asset}/art_photo_camera.svg',
    width: 122.88,
    height: 104.99,
  ),
);

/// Most Likely: a silhouette with a dot and a star (node 3605:31650).
Widget _mostLikelyArt() => const _ComposedArt(
  width: 172.593,
  height: 108.786,
  pieces: [
    _ArtPiece('art_likely_dot.svg', 19.42, 12.68, 28.77, 28.77),
    _ArtPiece('art_likely_head.svg', 52.50, 14.85, 67.59, 67.60),
    _ArtPiece('art_likely_body.svg', 38.10, 58.71, 97.09, 51.78),
    _ArtPiece('art_likely_star.svg', 118.66, 11.24, 39.56, 36.68),
  ],
  letters: [_ArtLetter('?', 86.28, 55.80, size: 8.63, color: GamesStyle.yellow2)],
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
/// (node 3690:43101, "Photo & camera illustration").
class _IllustrationTile extends StatelessWidget {
  const _IllustrationTile({required this.color, required this.child, this.padding = 6});

  final Color color;
  final Widget child;
  final double padding;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 97.5,
      height: 97.5,
      child: Center(
        child: Transform.rotate(
          angle: 5 * math.pi / 180,
          child: Container(
            width: 90,
            height: 90,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: GamesStyle.ink, width: 2.5),
              boxShadow: const [BoxShadow(color: GamesStyle.ink, offset: Offset(0, 5))],
            ),
            padding: EdgeInsets.all(padding),
            child: FittedBox(fit: BoxFit.contain, child: child),
          ),
        ),
      ),
    );
  }
}
