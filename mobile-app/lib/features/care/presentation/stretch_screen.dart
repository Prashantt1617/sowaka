import 'dart:async';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../../../services/api_config.dart';
import '../content/move_content.dart';
import '../data/care_models.dart';
import 'care_theme.dart';

/// One stretch, as a routine you can prop the phone up for: one clip at a
/// time, the steps it shows highlighted as it plays, and the next clip on its
/// own when it ends. Swipe left to move on early. A hold with no clip is a
/// countdown; a step with no clip is its words for a few seconds.
class StretchScreen extends StatefulWidget {
  const StretchScreen({
    super.key,
    required this.stretch,
    required this.catalog,
  });

  final Stretch stretch;
  final CareCatalog catalog;

  @override
  State<StretchScreen> createState() => _StretchScreenState();
}

/// What one page of the routine is.
class _Segment {
  const _Segment({required this.steps, this.url, this.holdSeconds});

  /// Zero-based indexes of the steps this page shows.
  final List<int> steps;
  final String? url;

  /// Set when the page is a hold: how long.
  final int? holdSeconds;
}

class _StretchScreenState extends State<StretchScreen> {
  late final List<_Segment> _segments = _plan();
  final _pager = PageController();
  int _page = 0;
  bool _finished = false;

  /// Turns the stretch's steps and Sowaka's clips into pages, in step order.
  List<_Segment> _plan() {
    final s = widget.stretch;
    final clips = widget.catalog.clipsFor(s.key);
    final firstStepOf = <int, MoveClip>{};
    final covered = <int>{};
    for (final clip in clips) {
      final steps = [
        for (final n in clip.steps)
          if (n >= 1 && n <= s.steps.length) n - 1,
      ]..sort();
      if (steps.isEmpty || clip.url.isEmpty) continue;
      firstStepOf[steps.first] = clip;
      covered.addAll(steps);
    }
    final pages = <_Segment>[];
    for (var i = 0; i < s.steps.length; i++) {
      final clip = firstStepOf[i];
      if (clip != null) {
        final steps = [for (final n in clip.steps) n - 1]..sort();
        // A clip of a hold loops for the hold's length, with the countdown over it.
        final hold = steps.length == 1 && s.isPause(steps.first)
            ? pauseSeconds(s.steps[steps.first])
            : null;
        pages.add(_Segment(steps: steps, url: clip.url, holdSeconds: hold));
      } else if (covered.contains(i)) {
        continue;
      } else {
        pages.add(
          _Segment(
            steps: [i],
            holdSeconds: s.isPause(i) ? pauseSeconds(s.steps[i]) : null,
          ),
        );
      }
    }
    return pages;
  }

  @override
  void dispose() {
    _pager.dispose();
    super.dispose();
  }

  void _next() {
    if (!mounted) return;
    if (_page + 1 >= _segments.length) {
      setState(() => _finished = true);
      return;
    }
    _pager.animateToPage(
      _page + 1,
      duration: const Duration(milliseconds: 420),
      curve: Curves.easeInOut,
    );
  }

  void _again() {
    setState(() {
      _finished = false;
      _page = 0;
    });
    _pager.jumpToPage(0);
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.stretch;
    return Scaffold(
      backgroundColor: CareColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
              child: Column(
                children: [
                  CareBackLink(
                    'Move',
                    onTap: () => Navigator.of(context).maybePop(),
                  ),
                  const SizedBox(height: 10),
                  _Tag(s.tag),
                  const SizedBox(height: 10),
                  CareHeading(
                    s.name,
                    size: 26,
                    color: CareColors.warmInk,
                    align: TextAlign.center,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _finished
                        ? 'That’s the whole stretch.'
                        : 'Step ${_segments[_page].steps.first + 1} of ${s.steps.length} · swipe to move on',
                    style: const TextStyle(
                      fontFamily: careFont,
                      color: CareColors.warmMuted,
                      fontSize: 12.5,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      for (var i = 0; i < _segments.length; i++) ...[
                        Expanded(
                          child: Container(
                            height: 4,
                            decoration: BoxDecoration(
                              color: i <= _page && !_finished || _finished
                                  ? CareColors.blue
                                  : CareColors.line,
                              borderRadius: BorderRadius.circular(4),
                            ),
                          ),
                        ),
                        if (i < _segments.length - 1) const SizedBox(width: 4),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            Expanded(
              child: _finished
                  ? _Done(onAgain: _again)
                  : PageView.builder(
                      controller: _pager,
                      itemCount: _segments.length,
                      onPageChanged: (index) => setState(() => _page = index),
                      itemBuilder: (_, index) => _SegmentPage(
                        key: ValueKey('segment-$index'),
                        stretch: s,
                        segment: _segments[index],
                        active: index == _page && !_finished,
                        onDone: index == _page ? _next : () {},
                      ),
                    ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 6, 20, 24),
              child: Column(
                children: [
                  if (_finished)
                    CarePrimaryButton(
                      '↺  Do it again',
                      pill: true,
                      onTap: _again,
                    ),
                  TextButton(
                    onPressed: () => Navigator.of(
                      context,
                    ).popUntil((route) => route.isFirst),
                    child: const Text(
                      'Choose something else',
                      style: TextStyle(
                        fontFamily: careFont,
                        color: CareColors.warmMuted,
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Done extends StatelessWidget {
  const _Done({required this.onAgain});

  final VoidCallback onAgain;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: const [
          Icon(
            Icons.check_circle_outline_rounded,
            color: CareColors.blue,
            size: 56,
          ),
          SizedBox(height: 14),
          CareHeading(
            'Done.',
            size: 28,
            color: CareColors.warmInk,
            align: TextAlign.center,
          ),
          SizedBox(height: 8),
          CareCopy(
            'Notice how it feels now, before you go back to what you were doing.',
            size: 14,
            color: CareColors.warmMuted,
            align: TextAlign.center,
          ),
        ],
      ),
    ),
  );
}

/// One page: the clip, the countdown or the words; the steps under it.
class _SegmentPage extends StatefulWidget {
  const _SegmentPage({
    super.key,
    required this.stretch,
    required this.segment,
    required this.active,
    required this.onDone,
  });

  final Stretch stretch;
  final _Segment segment;
  final bool active;
  final VoidCallback onDone;

  @override
  State<_SegmentPage> createState() => _SegmentPageState();
}

class _SegmentPageState extends State<_SegmentPage> {
  VideoPlayerController? _video;
  bool _videoFailed = false;
  bool _ended = false;
  Timer? _timer;
  int _left = 0;

  /// Which of the page's steps is current, as the clip plays.
  int _current = 0;

  /// One key per step, so the list can bring the current one into view.
  late final List<GlobalKey> _stepKeys = [
    for (final _ in widget.segment.steps) GlobalKey(),
  ];

  /// The clip stays put at the top; the steps scroll under it, and the current
  /// one is brought into view on its own so the phone can sit propped up.
  void _showCurrent() {
    final context = _stepKeys[_current].currentContext;
    if (context == null) return;
    Scrollable.ensureVisible(
      context,
      alignment: 0.1,
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeOut,
    );
  }

  /// A step with no clip and no hold stays this long before moving on.
  static const _readingSeconds = 6;

  @override
  void initState() {
    super.initState();
    final url = widget.segment.url;
    if (url != null) {
      final controller = VideoPlayerController.networkUrl(
        Uri.parse(resolveMediaUrl(url)),
      );
      _video = controller;
      controller
          .initialize()
          .then((_) {
            if (!mounted) return;
            controller.setLooping(widget.segment.holdSeconds != null);
            setState(() {});
            if (widget.active) controller.play();
          })
          .catchError((_) {
            if (mounted) setState(() => _videoFailed = true);
          });
      controller.addListener(_onVideoTick);
      if (widget.active && widget.segment.holdSeconds != null) _startClock();
    } else if (widget.active) {
      _startClock();
    }
  }

  @override
  void didUpdateWidget(covariant _SegmentPage old) {
    super.didUpdateWidget(old);
    if (widget.active == old.active) return;
    final video = _video;
    if (widget.active) {
      _ended = false;
      if (video != null) {
        if (video.value.isInitialized) {
          video.seekTo(Duration.zero);
          video.play();
        }
        if (widget.segment.holdSeconds != null) _startClock();
      } else {
        _startClock();
      }
    } else {
      video?.pause();
      _timer?.cancel();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _video?.removeListener(_onVideoTick);
    _video?.dispose();
    super.dispose();
  }

  void _startClock() {
    _timer?.cancel();
    _left = widget.segment.holdSeconds ?? _readingSeconds;
    setState(() {});
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      setState(() => _left = _left - 1);
      if (_left <= 0) {
        timer.cancel();
        _finish();
      }
    });
  }

  void _onVideoTick() {
    final video = _video;
    if (video == null || !mounted || !video.value.isInitialized) return;
    final duration = video.value.duration.inMilliseconds;
    final position = video.value.position.inMilliseconds;
    final steps = widget.segment.steps.length;
    if (duration > 0 && steps > 1) {
      final current = (position * steps ~/ duration).clamp(0, steps - 1);
      if (current != _current) {
        setState(() => _current = current);
        WidgetsBinding.instance.addPostFrameCallback((_) => _showCurrent());
      }
    } else if (mounted) {
      setState(() {});
    }
    // A looping hold ends on its countdown, not on the clip.
    if (widget.segment.holdSeconds == null &&
        widget.active &&
        duration > 0 &&
        position >= duration - 200 &&
        !video.value.isPlaying &&
        !_ended) {
      _finish();
    }
  }

  void _finish() {
    if (_ended) return;
    _ended = true;
    // A beat to see the last frame or the zero before moving on.
    Future<void>.delayed(const Duration(milliseconds: 900), () {
      if (mounted && widget.active) widget.onDone();
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.stretch;
    final seg = widget.segment;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(22),
            child: AspectRatio(aspectRatio: 3 / 2, child: _media()),
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
            children: [
              for (var i = 0; i < seg.steps.length; i++)
                Padding(
                  key: _stepKeys[i],
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _StepLine(
                    number: seg.steps[i] + 1,
                    text: s.steps[seg.steps[i]],
                    current: i == _current,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _media() {
    final seg = widget.segment;
    final video = _video;
    if (video != null) {
      if (_videoFailed) {
        return const ColoredBox(
          color: CareColors.blueTint,
          child: Center(child: CareCopy('Could not load this clip.')),
        );
      }
      if (!video.value.isInitialized) {
        return const ColoredBox(
          color: CareColors.blueTint,
          child: Center(
            child: CircularProgressIndicator(color: CareColors.blue),
          ),
        );
      }
      return Stack(
        fit: StackFit.expand,
        children: [
          FittedBox(
            fit: BoxFit.cover,
            clipBehavior: Clip.hardEdge,
            child: SizedBox(
              width: video.value.size.width,
              height: video.value.size.height,
              child: VideoPlayer(video),
            ),
          ),
          Positioned(
            left: 12,
            right: 12,
            bottom: 10,
            child: VideoProgressIndicator(
              video,
              allowScrubbing: true,
              padding: EdgeInsets.zero,
              colors: const VideoProgressColors(
                playedColor: CareColors.blue,
                bufferedColor: Colors.white70,
                backgroundColor: Colors.white38,
              ),
            ),
          ),
          if (seg.holdSeconds != null)
            Positioned(
              left: 12,
              top: 12,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 7,
                ),
                decoration: BoxDecoration(
                  color: CareColors.blue,
                  borderRadius: BorderRadius.circular(100),
                ),
                child: Text(
                  'Hold  ${_left ~/ 60}:${(_left % 60).toString().padLeft(2, '0')}',
                  key: const ValueKey('pause-timer'),
                  style: const TextStyle(
                    fontFamily: careFont,
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
          Positioned(
            right: 10,
            top: 10,
            child: Material(
              color: Colors.white.withValues(alpha: 0.85),
              shape: const CircleBorder(),
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: () =>
                    video.value.isPlaying ? video.pause() : video.play(),
                child: SizedBox(
                  width: 40,
                  height: 40,
                  child: Icon(
                    video.value.isPlaying
                        ? Icons.pause_rounded
                        : Icons.play_arrow_rounded,
                    color: CareColors.blue,
                  ),
                ),
              ),
            ),
          ),
        ],
      );
    }
    if (seg.holdSeconds != null) {
      return _Countdown(
        label: '${_left ~/ 60}:${(_left % 60).toString().padLeft(2, '0')}',
      );
    }
    return Container(
      color: CareColors.blueTint,
      alignment: Alignment.center,
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(
            Icons.accessibility_new_rounded,
            color: CareColors.blue,
            size: 40,
          ),
          const SizedBox(height: 12),
          Text(
            widget.stretch.steps[seg.steps.first],
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.warmInk,
              fontSize: 16,
              fontWeight: FontWeight.w600,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Moving on in $_left',
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.warmMuted,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class _StepLine extends StatelessWidget {
  const _StepLine({
    required this.number,
    required this.text,
    required this.current,
  });

  final int number;
  final String text;
  final bool current;

  @override
  Widget build(BuildContext context) => AnimatedContainer(
    duration: const Duration(milliseconds: 250),
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
    decoration: BoxDecoration(
      color: current ? CareColors.blueTint : Colors.white,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: current ? CareColors.blue : CareColors.line),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 28,
          height: 28,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: current ? CareColors.blue : CareColors.blueTint,
            shape: BoxShape.circle,
          ),
          child: Text(
            '$number',
            style: TextStyle(
              fontFamily: careFont,
              color: current ? Colors.white : CareColors.blue,
              fontSize: 12.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontFamily: careFont,
              color: current ? CareColors.warmInk : CareColors.warmMuted,
              fontSize: 14.5,
              fontWeight: FontWeight.w500,
              height: 1.5,
            ),
          ),
        ),
      ],
    ),
  );
}

/// A hold: a breathing blue disc with the seconds left.
class _Countdown extends StatefulWidget {
  const _Countdown({required this.label});

  final String label;

  @override
  State<_Countdown> createState() => _CountdownState();
}

class _CountdownState extends State<_Countdown>
    with SingleTickerProviderStateMixin {
  late final AnimationController _breathe = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 5600),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _breathe.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0x1A0571A6), CareColors.sand],
        ),
      ),
      child: AnimatedBuilder(
        animation: _breathe,
        builder: (_, _) {
          final scale = 1 + 0.16 * Curves.easeInOut.transform(_breathe.value);
          return Stack(
            alignment: Alignment.center,
            children: [
              Container(
                width: 150 * (1 + 0.06 * _breathe.value),
                height: 150 * (1 + 0.06 * _breathe.value),
                decoration: BoxDecoration(
                  color: CareColors.blue.withValues(alpha: 0.16),
                  shape: BoxShape.circle,
                ),
              ),
              Transform.scale(
                scale: scale,
                child: Container(
                  width: 112,
                  height: 112,
                  decoration: BoxDecoration(
                    color: CareColors.blue,
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: CareColors.blue.withValues(alpha: 0.5),
                        blurRadius: 40,
                        offset: const Offset(0, 16),
                      ),
                    ],
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text(
                        'HOLD',
                        style: TextStyle(
                          fontFamily: careFont,
                          color: Colors.white70,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 1.4,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        widget.label,
                        key: const ValueKey('pause-timer'),
                        style: const TextStyle(
                          fontFamily: careFont,
                          color: Colors.white,
                          fontSize: 26,
                          fontWeight: FontWeight.w800,
                          height: 1,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 7),
    decoration: BoxDecoration(
      color: CareColors.blueTint,
      borderRadius: BorderRadius.circular(100),
    ),
    child: Text(
      text.toUpperCase(),
      style: const TextStyle(
        fontFamily: careFont,
        color: CareColors.blue,
        fontSize: 11,
        fontWeight: FontWeight.w800,
        letterSpacing: 0.8,
      ),
    ),
  );
}

/// A numbered step row, blue when open. Used by the mood step lists.
class StepCard extends StatelessWidget {
  const StepCard({
    super.key,
    required this.number,
    required this.text,
    required this.open,
    required this.onTap,
  });

  final int number;
  final String text;
  final bool open;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: open ? CareColors.blueTint : CareColors.sand,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        key: ValueKey('step-$number'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: open ? CareColors.blue : const Color(0xFFF0E9DD),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 30,
                height: 30,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: open ? CareColors.blue : CareColors.blueTint,
                  shape: BoxShape.circle,
                ),
                child: Text(
                  '$number',
                  style: TextStyle(
                    fontFamily: careFont,
                    color: open ? Colors.white : CareColors.blue,
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Text(
                  text,
                  style: const TextStyle(
                    fontFamily: careFont,
                    color: Color(0xFF3A332C),
                    fontSize: 14.5,
                    fontWeight: FontWeight.w500,
                    height: 1.6,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              AnimatedRotation(
                turns: open ? 0.5 : 0,
                duration: const Duration(milliseconds: 250),
                child: Icon(
                  Icons.expand_more_rounded,
                  color: open ? CareColors.blue : const Color(0xFFC2B6A6),
                  size: 20,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
