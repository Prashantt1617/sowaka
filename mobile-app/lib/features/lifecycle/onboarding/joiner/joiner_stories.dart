import 'dart:async';
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart' show CustomSemanticsAction;
import 'package:flutter/services.dart';
import 'package:printing/printing.dart';
import 'package:video_player/video_player.dart';

import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../presentation/onboarding_kit.dart';
import 'joiner_lens.dart';
import 'joiner_models.dart';
import 'joiner_parts.dart';

// ─── Life at the company: the watch list as stories ────────────────────────
//
// The pre-boarding portal's stories (preboarding-web G2Story), in the app: a
// bar per story on top, the company's HR with Close, then one story full
// screen. A video plays at once and its bar follows it; a picture or a text
// card moves on after a few seconds; the last one closes. Tap the left third
// to go back, anywhere else to go on; press and hold to pause. Each story is
// marked watched as it is shown.

/// A picture, a text card or a PDF stays this long.
const storyCardDuration = Duration(seconds: 6);

/// A press longer than this pauses; it does not move on.
const _holdThreshold = Duration(milliseconds: 300);

/// Behind a video or a picture.
const _storyDark = Color(0xFF0E0E10);

/// The template's text backgrounds (the dashboard's BACKGROUNDS, as the portal paints them).
const _storyBg = <String, Color>{
  'rust': Color(0xFFB23500),
  'blue': Color(0xFF0571A6),
  'ink': Color(0xFF16181D),
  'green': Color(0xFF15803D),
  'purple': Color(0xFF5B3FAF),
  'sand': Color(0xFF9A4A06),
};

const _rustGradient = LinearGradient(
  begin: Alignment(-0.34, -0.94),
  end: Alignment(0.34, 0.94),
  colors: [Color(0xFFD2541B), Color(0xFFB23500), Color(0xFF8A2900)],
  stops: [0, 0.55, 1],
);

/// Opens the stories on [start] (the first not yet watched) and reads the
/// joiner's answer again once they close.
Future<void> openJoinerStories(
  BuildContext context,
  JoinerController c,
  List<JoinerWatch> items, {
  int start = 0,
}) async {
  if (items.isEmpty) return;
  await Navigator.of(context).push<void>(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => JoinerStoriesScreen(c: c, items: items, start: start),
    ),
  );
  unawaited(c.load());
}

// ─── Trainings ──────────────────────────────────────────────────────────────

/// Opens a training: a PDF to read, anything else as a story of its own;
/// either way it is marked watched.
Future<void> openTraining(
  BuildContext context,
  JoinerController c,
  JoinerWatch t,
) async {
  if (!t.isPdf) return openJoinerStories(context, c, [t]);
  unawaited(
    c.api.markWatched(t.id).then((_) => c.load()).catchError((Object _) {}),
  );
  final url = t.url;
  if (url == null) return;
  try {
    final bytes = await c.api.download(url);
    await Printing.sharePdf(bytes: bytes, filename: '${t.title}.pdf');
  } catch (e) {
    if (context.mounted) showAppToast(context, onboardingErrorText(e));
  }
}

/// The template's trainings (a video or a PDF) with Watch or Read, under the
/// company's own name for them (`labels.trainings`).
class JoinerTrainingsScreen extends StatelessWidget {
  const JoinerTrainingsScreen({super.key, required this.c});

  final JoinerController c;

  @override
  Widget build(BuildContext context) => JoinerScaffold(
    c: c,
    title: c.data?.trainingsLabel ?? 'Trainings',
    body: (d) {
      final trainings = JoinerLens(d, c.lens).trainings;
      return JPage(
        onRefresh: c.load,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              JSectionHead(
                title: d.trainingsLabel,
                meta: plural(trainings.length, 'item', 'items'),
              ),
              const SizedBox(height: 8),
              if (trainings.isNotEmpty)
                JListCard(
                  children: withLines([
                    for (final t in trainings)
                      Semantics(
                        button: true,
                        label: [
                          t.title,
                          if (t.length.isNotEmpty) t.length,
                          if (t.watched) 'done',
                          t.isPdf ? 'Read' : 'Watch',
                        ].join('. '),
                        excludeSemantics: true,
                        child: InkWell(
                          key: ValueKey('training-${t.id}'),
                          onTap: () => openTraining(context, c, t),
                          child: Container(
                            constraints: const BoxConstraints(minHeight: 64),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 10,
                            ),
                            child: Row(
                              children: [
                                t.isPdf
                                    ? const JIconChip(
                                        icon: Icons.description_outlined,
                                        tint: OnbColors.blueTint,
                                        color: OnbColors.blue,
                                      )
                                    : const JIconChip(
                                        icon: Icons.play_arrow_rounded,
                                        tint: Color(0xFFFDECE7),
                                        color: OnbColors.rust,
                                      ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        t.title,
                                        style: const TextStyle(
                                          fontSize: 14,
                                          fontWeight: FontWeight.w600,
                                          color: OnbColors.text,
                                        ),
                                      ),
                                      if (t.length.isNotEmpty) ...[
                                        const SizedBox(height: 2),
                                        Text(
                                          t.length,
                                          style: const TextStyle(
                                            fontSize: 12,
                                            color: OnbColors.text3,
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 8),
                                if (t.watched)
                                  const JDoneDot()
                                else
                                  JVerbPill(t.isPdf ? 'Read' : 'Watch'),
                              ],
                            ),
                          ),
                        ),
                      ),
                  ]),
                ),
            ],
          ),
        ],
      );
    },
  );
}

// ─── The stories ────────────────────────────────────────────────────────────

class JoinerStoriesScreen extends StatefulWidget {
  const JoinerStoriesScreen({
    super.key,
    required this.c,
    required this.items,
    this.start = 0,
  });

  final JoinerController c;
  final List<JoinerWatch> items;
  final int start;

  @override
  State<JoinerStoriesScreen> createState() => _JoinerStoriesScreenState();
}

class _JoinerStoriesScreenState extends State<JoinerStoriesScreen>
    with SingleTickerProviderStateMixin {
  late int _at = widget.start.clamp(0, widget.items.length - 1);

  /// A card's clock; a video's bar follows the video instead.
  late final AnimationController _clock =
      AnimationController(vsync: this, duration: storyCardDuration)
        ..addListener(_tick)
        ..addStatusListener((status) {
          if (status == AnimationStatus.completed) _next();
        });

  /// The videos loaded: the one on show and the next (preloaded), by index.
  final Map<int, VideoPlayerController> _videos = {};

  /// Videos that could not be played: shown as a card on the clock.
  final Set<int> _failed = {};

  /// Marked watched in this visit (the server keeps it once anyway).
  final Set<String> _marked = {};

  double _progress = 0;
  bool _paused = false;

  /// A finger is down on the story.
  bool _down = false;

  /// It has been down long enough to be a hold ([_holdThreshold]), which
  /// pauses and does not move on.
  Timer? _holdTimer;
  bool _held = false;

  /// The video on show has ended and moved on (its listener fires again).
  bool _ended = false;

  JoinerWatch get _item => widget.items[_at];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _show(_at);
    });
  }

  @override
  void dispose() {
    _holdTimer?.cancel();
    _clock.dispose();
    for (final v in _videos.values) {
      v.removeListener(_onVideo);
      unawaited(v.dispose());
    }
    super.dispose();
  }

  ({Uri uri, Map<String, String> headers})? _media(JoinerWatch w) {
    final url = w.url;
    return url == null ? null : widget.c.api.media(url);
  }

  /// A video this story plays, once it can.
  VideoPlayerController? _videoAt(int i) =>
      _failed.contains(i) ? null : _videos[i];

  bool _isVideo(int i) =>
      widget.items[i].type == 'video' &&
      _media(widget.items[i]) != null &&
      !_failed.contains(i);

  /// Starts loading story [i]: a video's first bytes, a picture into the cache.
  void _prepare(int i) {
    if (i < 0 || i >= widget.items.length) return;
    final w = widget.items[i];
    final media = _media(w);
    if (media == null) return;
    if (w.type == 'image') {
      unawaited(
        precacheImage(
          NetworkImage(media.uri.toString(), headers: media.headers),
          context,
        ).catchError((Object _) {}),
      );
      return;
    }
    if (w.type != 'video' || _videos.containsKey(i) || _failed.contains(i))
      return;
    final v = VideoPlayerController.networkUrl(
      media.uri,
      httpHeaders: media.headers,
    );
    _videos[i] = v;
    v.addListener(_onVideo);
    v
        .initialize()
        .then((_) {
          if (!mounted) return;
          setState(() {});
          if (i == _at && !_paused) unawaited(v.play());
        })
        .catchError((Object _) {
          if (!mounted) return;
          _videos.remove(i)?.removeListener(_onVideo);
          unawaited(v.dispose());
          setState(() => _failed.add(i));
          // The one on show could not play: it reads as a card on the clock.
          if (i == _at && !_paused) _clock.forward(from: 0);
        });
  }

  void _show(int i) {
    if (!mounted) return;
    setState(() {
      _at = i;
      _progress = 0;
      _ended = false;
    });
    final w = _item;
    if (!w.watched && _marked.add(w.id)) {
      unawaited(widget.c.api.markWatched(w.id).catchError((Object _) {}));
    }
    _clock
      ..stop()
      ..value = 0;
    // Only the one on show and the next stay loaded.
    for (final k in _videos.keys.toList()) {
      if (k == i || k == i + 1) continue;
      final v = _videos.remove(k)!;
      v.removeListener(_onVideo);
      unawaited(v.dispose());
    }
    _prepare(i);
    _prepare(i + 1);
    final v = _videoAt(i);
    if (v != null) {
      if (v.value.isInitialized) {
        unawaited(
          v.seekTo(Duration.zero).then((_) {
            if (mounted && _at == i && !_paused) unawaited(v.play());
          }),
        );
      }
    } else if (!_isVideo(i) && !_paused) {
      _clock.forward(from: 0);
    }
  }

  void _tick() {
    if (!_isVideo(_at)) setState(() => _progress = _clock.value);
  }

  void _onVideo() {
    final v = _videoAt(_at);
    if (v == null || !mounted || !v.value.isInitialized) return;
    final total = v.value.duration.inMilliseconds;
    final now = v.value.position.inMilliseconds;
    if (total > 0) setState(() => _progress = (now / total).clamp(0, 1));
    if (!_ended && total > 0 && now >= total && !v.value.isPlaying) {
      _ended = true;
      _next();
    }
  }

  void _next() {
    if (!mounted) return;
    if (_at < widget.items.length - 1) {
      _videoAt(_at)?.pause();
      _show(_at + 1);
    } else {
      _close();
    }
  }

  void _prev() {
    if (_at > 0) {
      _videoAt(_at)?.pause();
      _show(_at - 1);
    } else {
      _show(0);
    }
  }

  void _close() {
    _clock.stop();
    for (final v in _videos.values) {
      unawaited(v.pause());
    }
    unawaited(Navigator.of(context).maybePop());
  }

  void _pause() {
    if (_paused) return;
    setState(() => _paused = true);
    _clock.stop();
    unawaited(_videoAt(_at)?.pause());
  }

  void _resume() {
    if (!_paused) return;
    setState(() => _paused = false);
    final v = _videoAt(_at);
    if (v != null) {
      if (v.value.isInitialized) unawaited(v.play());
    } else if (!_isVideo(_at)) {
      _clock.forward();
    }
  }

  void _pointerDown(PointerDownEvent e) {
    _down = true;
    _held = false;
    _holdTimer?.cancel();
    _holdTimer = Timer(_holdThreshold, () => _held = true);
    _pause();
  }

  void _pointerUp(PointerUpEvent e, double width) {
    _holdTimer?.cancel();
    if (!_down) return;
    _down = false;
    _resume();
    // A hold pauses; it doesn't move.
    if (_held) return;
    if (e.localPosition.dx < width / 3) {
      _prev();
    } else {
      _next();
    }
  }

  void _pointerCancel(PointerCancelEvent e) {
    _holdTimer?.cancel();
    _down = false;
    _resume();
  }

  Future<void> _readPdf(JoinerWatch w) async {
    final url = w.url;
    if (url == null) return;
    _pause();
    try {
      final bytes = await widget.c.api.download(url);
      await Printing.sharePdf(bytes: bytes, filename: '${w.title}.pdf');
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      if (mounted) _resume();
    }
  }

  @override
  Widget build(BuildContext context) {
    final w = _item;
    final text = w.type == 'text';
    // A picture or a video fills the screen behind the bars, as on Instagram.
    final full =
        (w.type == 'image' || w.type == 'video') &&
        _media(w) != null &&
        !_failed.contains(_at);
    final background = text
        ? (_storyBg[w.bg ?? 'rust'] ?? _storyBg['rust']!)
        : (full ? Colors.black : _storyDark);
    final company = widget.c.data?.companyName ?? '';
    final n = widget.items.length;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        key: const ValueKey('joiner-stories'),
        backgroundColor: background,
        body: Stack(
          fit: StackFit.expand,
          children: [
            if (full) Positioned.fill(child: _fullMedia(w)),
            // Shades so the bars, the name and the caption read on any picture.
            if (full)
              const Positioned(
                top: 0,
                left: 0,
                right: 0,
                height: 180,
                child: _Shade(top: true),
              ),
            if (full)
              const Positioned(
                bottom: 0,
                left: 0,
                right: 0,
                height: 220,
                child: _Shade(top: false),
              ),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: text && (w.bg ?? 'rust') == 'rust'
                    ? _rustGradient
                    : null,
              ),
              child: SafeArea(
                child: Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 12, 0),
                      child: Column(
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(right: 4),
                            child: Row(
                              children: [
                                for (var k = 0; k < n; k++) ...[
                                  if (k > 0) const SizedBox(width: 4),
                                  Expanded(
                                    child: _StoryBar(
                                      key: ValueKey('story-bar-$k'),
                                      value: k < _at
                                          ? 1
                                          : (k == _at ? _progress : 0),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              _CompanyMark(company: company),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      company.isEmpty ? 'HR' : '$company HR',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontSize: 14,
                                        height: 20 / 14,
                                        fontWeight: FontWeight.w600,
                                        color: Colors.white,
                                      ),
                                    ),
                                    const Text(
                                      'Pinned by HR',
                                      style: TextStyle(
                                        fontSize: 12,
                                        height: 16 / 12,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              IconButton(
                                key: const ValueKey('stories-close'),
                                tooltip: 'Close',
                                onPressed: _close,
                                icon: const Icon(
                                  Icons.close_rounded,
                                  color: Colors.white,
                                  size: 24,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    Expanded(
                      child: LayoutBuilder(
                        builder: (context, box) => Semantics(
                          container: true,
                          label: 'Story ${_at + 1} of $n. ${w.title}',
                          customSemanticsActions: {
                            const CustomSemanticsAction(label: 'Next story'):
                                _next,
                            const CustomSemanticsAction(
                              label: 'Previous story',
                            ): _prev,
                          },
                          child: Listener(
                            key: const ValueKey('stories-main'),
                            behavior: HitTestBehavior.opaque,
                            onPointerDown: _pointerDown,
                            onPointerUp: (e) => _pointerUp(e, box.maxWidth),
                            onPointerCancel: _pointerCancel,
                            child: full
                                // The caption over the picture's foot, as Instagram's.
                                ? Align(
                                    alignment: Alignment.bottomCenter,
                                    child: Padding(
                                      padding: const EdgeInsets.fromLTRB(
                                        24,
                                        0,
                                        24,
                                        32,
                                      ),
                                      child: Text(
                                        w.title,
                                        key: ValueKey('story-${w.id}'),
                                        textAlign: TextAlign.center,
                                        style: const TextStyle(
                                          fontSize: 16,
                                          height: 22 / 16,
                                          fontWeight: FontWeight.w600,
                                          color: Colors.white,
                                        ),
                                      ),
                                    ),
                                  )
                                : Padding(
                                    padding: const EdgeInsets.fromLTRB(
                                      32,
                                      24,
                                      32,
                                      48,
                                    ),
                                    child: Center(
                                      child: _content(w, box.maxHeight),
                                    ),
                                  ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// A picture or a video edge to edge: a portrait one fills the screen; any
  /// other sits whole in the middle over a blurred copy of itself (Instagram).
  Widget _fullMedia(JoinerWatch w) {
    final media = _media(w)!;
    if (w.type == 'image') {
      final url = media.uri.toString();
      return Stack(
        key: ValueKey('story-media-${w.id}'),
        fit: StackFit.expand,
        children: [
          ImageFiltered(
            imageFilter: ImageFilter.blur(sigmaX: 30, sigmaY: 30),
            child: Image.network(
              url,
              headers: media.headers,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => const SizedBox.shrink(),
            ),
          ),
          const ColoredBox(color: Color(0x33000000)),
          Image.network(
            url,
            headers: media.headers,
            fit: BoxFit.contain,
            errorBuilder: (_, _, _) => const Center(
              child: Icon(
                Icons.image_outlined,
                size: 56,
                color: Colors.white70,
              ),
            ),
          ),
        ],
      );
    }
    final v = _videoAt(_at);
    if (v == null || !v.value.isInitialized) {
      return const Center(
        child: CircularProgressIndicator(color: Colors.white),
      );
    }
    final size = v.value.size;
    final player = SizedBox(
      width: size.width,
      height: size.height,
      child: VideoPlayer(v),
    );
    if (v.value.aspectRatio < 0.8) {
      return ClipRect(
        key: ValueKey('story-media-${w.id}'),
        child: FittedBox(fit: BoxFit.cover, child: player),
      );
    }
    return Center(
      key: ValueKey('story-media-${w.id}'),
      child: AspectRatio(
        aspectRatio: v.value.aspectRatio,
        child: VideoPlayer(v),
      ),
    );
  }

  Widget _content(JoinerWatch w, double height) {
    const caption = TextStyle(
      fontSize: 16,
      height: 22 / 16,
      color: Colors.white,
    );
    const headline = TextStyle(
      fontSize: 28,
      height: 36 / 28,
      fontWeight: FontWeight.w700,
      color: Colors.white,
    );
    final media = _media(w);
    // A picture or a video HR has not uploaded yet: its title as a card, not
    // a play button that plays nothing.
    if ((w.type == 'image' || w.type == 'video') && media == null) {
      return Text(w.title, key: ValueKey('story-${w.id}'), textAlign: TextAlign.center, style: headline);
    }
    switch (w.type) {
      case 'text':
        return Text(
          w.text ?? w.title,
          key: ValueKey('story-${w.id}'),
          textAlign: TextAlign.center,
          style: headline,
        );
      case 'image' when media != null:
        return Column(
          key: ValueKey('story-${w.id}'),
          mainAxisSize: MainAxisSize.min,
          children: [
            ConstrainedBox(
              constraints: BoxConstraints(maxHeight: height * 0.64),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.network(
                  media.uri.toString(),
                  headers: media.headers,
                  fit: BoxFit.contain,
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(w.title, textAlign: TextAlign.center, style: caption),
          ],
        );
      case 'pdf':
        return Column(
          key: ValueKey('story-${w.id}'),
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.description_outlined,
              size: 56,
              color: Colors.white,
            ),
            const SizedBox(height: 16),
            Text(w.title, textAlign: TextAlign.center, style: headline),
            if (w.length.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(w.length, style: caption),
            ],
            const SizedBox(height: 24),
            FilledButton(
              key: ValueKey('story-read-${w.id}'),
              style: FilledButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: const Color(0xFF0571A6),
                shape: const StadiumBorder(),
              ),
              onPressed: () => _readPdf(w),
              child: const Text(
                'Read',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        );
    }
    final v = _videoAt(_at);
    final Widget art;
    if (v != null && v.value.isInitialized) {
      art = AspectRatio(
        aspectRatio: v.value.aspectRatio,
        child: VideoPlayer(v),
      );
    } else if (v != null) {
      art = const AspectRatio(
        aspectRatio: 16 / 9,
        child: Center(child: CircularProgressIndicator(color: Colors.white)),
      );
    } else {
      // Nothing to play (no file, or it would not load): the title on its own.
      art = AspectRatio(
        aspectRatio: 16 / 9,
        child: Center(
          child: Icon(
            w.type == 'image'
                ? Icons.image_outlined
                : Icons.play_circle_outline_rounded,
            size: 56,
            color: Colors.white70,
          ),
        ),
      );
    }
    return Column(
      key: ValueKey('story-${w.id}'),
      mainAxisSize: MainAxisSize.min,
      children: [
        ConstrainedBox(
          constraints: BoxConstraints(maxHeight: height * 0.62),
          child: ColoredBox(color: Colors.black, child: art),
        ),
        const SizedBox(height: 16),
        Text(w.title, textAlign: TextAlign.center, style: caption),
      ],
    );
  }
}

/// A dark fade at the top or the foot of a full-screen story.
class _Shade extends StatelessWidget {
  const _Shade({required this.top});

  final bool top;

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: top ? Alignment.topCenter : Alignment.bottomCenter,
          end: top ? Alignment.bottomCenter : Alignment.topCenter,
          colors: const [Color(0x8C000000), Color(0x00000000)],
        ),
      ),
    ),
  );
}

class _StoryBar extends StatelessWidget {
  const _StoryBar({super.key, required this.value});

  final double value;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(999),
    child: SizedBox(
      height: 3,
      child: Stack(
        fit: StackFit.expand,
        children: [
          const ColoredBox(color: Color(0x66FFFFFF)),
          FractionallySizedBox(
            alignment: Alignment.centerLeft,
            widthFactor: value.clamp(0, 1),
            child: const ColoredBox(color: Colors.white),
          ),
        ],
      ),
    ),
  );
}

/// The company's mark: its first letter on white.
class _CompanyMark extends StatelessWidget {
  const _CompanyMark({required this.company});

  final String company;

  @override
  Widget build(BuildContext context) => Container(
    width: 40,
    height: 40,
    alignment: Alignment.center,
    decoration: const BoxDecoration(
      color: Colors.white,
      shape: BoxShape.circle,
    ),
    child: Text(
      company.isEmpty ? 'HR' : company.characters.first.toUpperCase(),
      style: const TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w700,
        color: Color(0xFF0571A6),
      ),
    ),
  );
}
