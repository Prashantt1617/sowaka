import 'dart:async';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../../../services/api_config.dart';
import '../content/breathe_content.dart';
import '../content/move_content.dart' show pauseSeconds;
import 'care_theme.dart';
import 'stretch_screen.dart' show BreathGuide, StepCard;

/// One mood's remedy: a timed breath with the circle or the box, or a short
/// list of steps. The phone's reduce motion setting keeps the count and
/// drops the animation.
class BreathScreen extends StatefulWidget {
  const BreathScreen({super.key, required this.mood, this.soundUrl});

  final Mood mood;

  /// A sound to play quietly behind the breath, when Sowaka has one for the mood.
  final String? soundUrl;

  @override
  State<BreathScreen> createState() => _BreathScreenState();
}

class _BreathScreenState extends State<BreathScreen>
    with WidgetsBindingObserver {
  // Breath engine.
  Timer? _timer;
  int _round = 0;
  int _phase = 0;
  int _tick = 0;
  bool _done = false;
  bool _started = false;

  // Step list: runs on its own, like a Move routine. Each step is read for
  // a few seconds, a hold counts its own seconds down, a step asking for
  // words waits for them, and the list scrolls to keep the current step in
  // view.
  int _current = 0;
  int _left = 0;
  bool _stepsDone = false;
  Timer? _stepTimer;
  late final List<GlobalKey> _stepKeys = [
    for (final _ in mood.steps) GlobalKey(),
  ];

  // Words typed where a step asks for them: a box per line, kept in memory
  // for this screen only and brought back by the step that sits with them.
  // Nothing typed is saved or sent.
  late final Map<int, List<TextEditingController>> _boxes = {
    for (final e in mood.writeSteps.entries)
      e.key: [for (var b = 0; b < e.value; b++) TextEditingController()],
  };
  final Set<TextEditingController> _kept = {};

  /// When the step that sits with the written lines began breathing.
  DateTime? _sitStarted;

  List<String> get _written => [
    for (final step in _boxes.keys.toList()..sort())
      for (final box in _boxes[step]!)
        if (_kept.contains(box)) box.text.trim(),
  ];

  // Background sound.
  VideoPlayerController? _sound;
  bool _muted = false;

  /// Paused because the page went out of sight, so it picks up on return.
  bool _pausedAway = false;

  Mood get mood => widget.mood;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final url = widget.soundUrl;
    if (url != null && url.isNotEmpty) {
      final sound = VideoPlayerController.networkUrl(
        Uri.parse(resolveMediaUrl(url)),
      );
      _sound = sound;
      sound
          .initialize()
          .then((_) {
            if (!mounted) return;
            sound.setLooping(true);
            // Out of sight before it loaded: wait for the page to return.
            if (WidgetsBinding.instance.lifecycleState !=
                AppLifecycleState.resumed) {
              _pausedAway = true;
              setState(() {});
              return;
            }
            sound.setVolume(0.7);
            sound.play();
            setState(() {});
          })
          .catchError((_) {});
    }
    if (mood.kind == RemedyKind.breath) {
      _timer = Timer(const Duration(milliseconds: 650), _start);
    } else {
      _timer = Timer(const Duration(milliseconds: 650), () => _runStep(0));
    }
  }

  /// A sound behind the breath belongs to this page: it stops when the page
  /// is left or hidden (the app closing the web page, the phone locking)
  /// and comes back with it.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final sound = _sound;
    if (sound == null || !sound.value.isInitialized) return;
    if (state == AppLifecycleState.resumed) {
      if (_pausedAway) {
        _pausedAway = false;
        sound.setVolume(_muted ? 0 : 0.7);
        sound.play();
      }
    } else if (sound.value.isPlaying) {
      _pausedAway = true;
      sound.pause();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _stepTimer?.cancel();
    for (final box in _boxes.values.expand((b) => b)) {
      box.dispose();
    }
    _sound?.pause();
    _sound?.dispose();
    super.dispose();
  }

  void _toggleMute() {
    final sound = _sound;
    if (sound == null) return;
    setState(() => _muted = !_muted);
    sound.setVolume(_muted ? 0 : 0.7);
  }

  void _start() {
    _timer?.cancel();
    setState(() {
      _round = 0;
      _phase = 0;
      _tick = 0;
      _done = false;
      _started = true;
    });
    _step();
  }

  /// Shows the current second, then moves on a second later: 4, 3, 2, 1,
  /// then the next phase, then the next round.
  void _step() {
    if (!mounted) return;
    if (_round >= mood.rounds) {
      setState(() => _done = true);
      return;
    }
    setState(() {});
    _timer = Timer(const Duration(seconds: 1), () {
      _tick++;
      if (_tick >= mood.pattern[_phase].seconds) {
        _tick = 0;
        _phase++;
        if (_phase >= mood.pattern.length) {
          _phase = 0;
          _round++;
        }
      }
      _step();
    });
  }

  /// Makes step [i] the current one and starts its clock: a hold's own
  /// seconds, or a short reading time for anything else. When it runs out the
  /// next step takes over; after the last, the routine is done.
  void _runStep(int i) {
    _stepTimer?.cancel();
    final sitting = i == mood.sitStep && _written.isNotEmpty;
    setState(() {
      _current = i;
      _stepsDone = false;
      _sitStarted = null;
      _left = mood.isPause(i) ? pauseSeconds(mood.steps[i]) : mood.readSeconds;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _showCurrent());
    // A step asking for words waits until every box is done.
    if (_boxes[i] case final boxes? when !boxes.every(_kept.contains)) return;
    if (sitting) {
      _sit(i);
      return;
    }
    _stepTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      setState(() => _left = _left - 1);
      if (_left > 0) return;
      timer.cancel();
      _after(i);
    });
  }

  /// On to the step after [i], or the end of the list.
  void _after(int i) {
    if (i + 1 < mood.steps.length) {
      _runStep(i + 1);
    } else {
      setState(() => _stepsDone = true);
    }
  }

  /// Breathes with what was written for the step's seconds, then moves on.
  void _sit(int i) {
    setState(() => _sitStarted = DateTime.now());
    _stepTimer = Timer(Duration(seconds: mood.sitSeconds), () {
      if (!mounted) return;
      setState(() => _sitStarted = null);
      _after(i);
    });
  }

  /// A box is done: it goes, and once a step's boxes are all done, the list
  /// moves on.
  void _keep(int step, TextEditingController box) {
    if (box.text.trim().isEmpty) return;
    setState(() => _kept.add(box));
    if (_current == step && _boxes[step]!.every(_kept.contains)) _after(step);
  }

  /// Brings the current step into view, so the phone can sit propped up.
  void _showCurrent() {
    final context = _stepKeys[_current].currentContext;
    if (context == null) return;
    Scrollable.ensureVisible(
      context,
      alignment: 0.2,
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    final isBreath = mood.kind == RemedyKind.breath;
    return CarePage(
      backLabel: 'Breathe',
      footer: Padding(
        padding: const EdgeInsets.fromLTRB(20, 6, 20, 24),
        child: TextButton(
          onPressed: () =>
              Navigator.of(context).popUntil((route) => route.isFirst),
          child: const Text(
            'Choose another emotion',
            style: TextStyle(
              fontFamily: careFont,
              color: CareColors.warmMuted,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
      children: [
        Center(
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 15,
                      vertical: 7,
                    ),
                    decoration: BoxDecoration(
                      color: CareColors.blueTint,
                      borderRadius: BorderRadius.circular(100),
                    ),
                    child: Text(
                      mood.tag.toUpperCase(),
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: CareColors.blue,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.8,
                      ),
                    ),
                  ),
                  if (_sound != null) ...[
                    const SizedBox(width: 8),
                    Material(
                      color: CareColors.blueTint,
                      shape: const CircleBorder(),
                      child: InkWell(
                        customBorder: const CircleBorder(),
                        onTap: _toggleMute,
                        child: SizedBox(
                          width: 30,
                          height: 30,
                          child: Icon(
                            _muted
                                ? Icons.volume_off_rounded
                                : Icons.volume_up_rounded,
                            size: 16,
                            color: CareColors.blue,
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 14),
              CareHeading(
                mood.name,
                size: 29,
                color: CareColors.warmInk,
                align: TextAlign.center,
              ),
              if (!isBreath) ...[
                const SizedBox(height: 8),
                CareCopy(
                  mood.sub,
                  size: 14.5,
                  color: CareColors.warmMuted,
                  align: TextAlign.center,
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 20),
        if (isBreath) _breath() else _steps(),
      ],
    );
  }

  Widget _steps() {
    final label = '${_left ~/ 60}:${(_left % 60).toString().padLeft(2, '0')}';
    return Column(
      children: [
        // The pose to hold through the steps, when the catalogue has one.
        if ((mood.poseUrl ?? mood.poseAsset) case final pose?) ...[
          _PoseCard(pose),
          const SizedBox(height: 18),
        ],
        for (var i = 0; i < mood.steps.length; i++) ...[
          KeyedSubtree(
            key: _stepKeys[i],
            child: StepCard(
              number: i + 1,
              text: mood.steps[i],
              open: i == _current,
              chevron: false,
              // A tap jumps to a step; otherwise they run on their own.
              onTap: () => _runStep(i),
              child: _stepExtra(i),
            ),
          ),
          if (_current == i && mood.isPause(i) && !_stepsDone)
            Container(
              margin: const EdgeInsets.only(top: 11),
              height: 120,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: CareColors.blueTint,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: CareColors.blue),
              ),
              child: Text(
                label,
                style: const TextStyle(
                  fontFamily: careFont,
                  color: CareColors.blue,
                  fontSize: 32,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          const SizedBox(height: 11),
        ],
      ],
    );
  }

  /// Inside a step's card: its boxes while it is the current one, or the
  /// written lines once the list reaches the step that sits with them.
  Widget? _stepExtra(int i) {
    if (_boxes[i] case final boxes? when i == _current) {
      final open = [
        for (final b in boxes)
          if (!_kept.contains(b)) b,
      ];
      if (open.isEmpty) return null;
      return Column(
        children: [
          for (final box in open)
            Padding(
              padding: EdgeInsets.only(top: box == open.first ? 0 : 8),
              child: _WriteBox(
                key: ObjectKey(box),
                controller: box,
                autofocus: box == open.first,
                onDone: () => _keep(i, box),
              ),
            ),
        ],
      );
    }
    final written = _written;
    if (i == mood.sitStep && _current >= i && written.isNotEmpty) {
      final started = _sitStarted;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            written.join(', '),
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.ink,
              fontSize: 15,
              fontWeight: FontWeight.w700,
              height: 1.5,
            ),
          ),
          // A breath is five seconds, half in and half out.
          if (i == _current && started != null)
            BreathGuide(
              breaths: (mood.sitSeconds / 5).round().clamp(1, 60),
              seconds: mood.sitSeconds,
              startedAt: started,
            ),
        ],
      );
    }
    return null;
  }

  Widget _breath() {
    final reduce = MediaQuery.of(context).disableAnimations;
    final phase = _started && !_done && _round < mood.rounds
        ? mood.pattern[_phase]
        : null;
    final label = _done ? 'Done' : phase?.label ?? 'Ready';
    final count = _done
        ? '✓'
        : phase == null
        ? '·'
        : '${phase.seconds - _tick}';
    final roundLabel =
        'Round ${(_done ? mood.rounds : _round + 1).clamp(1, mood.rounds)} of ${mood.rounds}';
    final note = mood.note;
    final phaseDuration = Duration(milliseconds: (phase?.seconds ?? 1) * 880);
    return Column(
      children: [
        Text(
          roundLabel,
          key: const ValueKey('round-label'),
          style: const TextStyle(
            fontFamily: careFont,
            color: CareColors.warmFaint,
            fontSize: 13,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.3,
          ),
        ),
        const SizedBox(height: 18),
        // The pose to hold, from the catalogue's photo or the app's own. The
        // box holds it inside the square instead.
        if ((mood.poseUrl ?? mood.poseAsset) case final pose?
            when !mood.square) ...[
          _PoseCard(pose),
          const SizedBox(height: 18),
        ],
        if (mood.square && note != null) ...[
          _Note(note),
          const SizedBox(height: 24),
        ],
        if (mood.square)
          _Box(
            pattern: mood.pattern,
            phaseIndex: _phase,
            active: phase != null,
            done: _done,
            pose: mood.poseUrl ?? mood.poseAsset,
            label: label,
            count: count,
            duration: Duration(milliseconds: (phase?.seconds ?? 1) * 1000),
            reduce: reduce,
          )
        else
          _Circle(
            phaseLabel: label,
            count: count,
            active: phase != null,
            duration: phaseDuration,
            reduce: reduce,
          ),
        if (!mood.square && note != null) ...[
          const SizedBox(height: 22),
          _Note(note),
        ],
      ],
    );
  }
}

class _Note extends StatelessWidget {
  const _Note(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: const BoxConstraints(maxWidth: 290),
    child: Text(
      text,
      textAlign: TextAlign.center,
      style: const TextStyle(
        fontFamily: careFont,
        color: CareColors.warmMuted,
        fontSize: 13.5,
        fontStyle: FontStyle.italic,
        height: 1.55,
      ),
    ),
  );
}

/// The circle: a ring and a core that swell on the in-breath and settle on
/// the out-breath, over most of the phase.
class _Circle extends StatelessWidget {
  const _Circle({
    required this.phaseLabel,
    required this.count,
    required this.active,
    required this.duration,
    required this.reduce,
  });

  final String phaseLabel;
  final String count;
  final bool active;
  final Duration duration;
  final bool reduce;

  bool get _in => active && phaseLabel.toLowerCase().contains('in');

  @override
  Widget build(BuildContext context) {
    final d = reduce ? const Duration(milliseconds: 300) : duration;
    return SizedBox(
      width: 218,
      height: 218,
      child: Stack(
        alignment: Alignment.center,
        children: [
          AnimatedScale(
            scale: reduce ? 1 : (_in ? 1.32 : 1),
            duration: d,
            curve: Curves.easeInOut,
            child: Container(
              width: 218,
              height: 218,
              decoration: BoxDecoration(
                color: CareColors.blue.withValues(alpha: 0.22),
                shape: BoxShape.circle,
              ),
            ),
          ),
          AnimatedScale(
            scale: reduce ? 1 : (_in ? 1.12 : 1),
            duration: d,
            curve: Curves.easeInOut,
            child: Container(
              width: 182,
              height: 182,
              decoration: BoxDecoration(
                color: CareColors.blue,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: CareColors.blue.withValues(alpha: 0.45),
                    blurRadius: 44,
                    offset: const Offset(0, 16),
                  ),
                ],
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    phaseLabel.toUpperCase(),
                    key: const ValueKey('phase-label'),
                    style: const TextStyle(
                      fontFamily: careFont,
                      color: Colors.white70,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.1,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    count,
                    key: const ValueKey('phase-count'),
                    style: const TextStyle(
                      fontFamily: careFont,
                      color: Colors.white,
                      fontSize: 52,
                      fontWeight: FontWeight.w800,
                      height: 1,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The box: a marker travelling one side per phase, up, across, down, back.
/// Box breathing: a dot goes round the square, a side a phase: breathe in
/// up the left, hold along the top, breathe out down the right, hold along
/// the bottom. With a photo of the pose, the photo sits inside the square
/// and each side's phase beside it, the one being breathed showing its
/// seconds; without one, the phase and its seconds sit inside.
class _Box extends StatelessWidget {
  const _Box({
    required this.pattern,
    required this.phaseIndex,
    required this.active,
    required this.done,
    required this.label,
    required this.count,
    required this.duration,
    required this.reduce,
    this.pose,
  });

  final List<BreathPhase> pattern;
  final int phaseIndex;
  final bool active;
  final bool done;
  final String label;
  final String count;
  final Duration duration;
  final bool reduce;

  /// The pose to hold: a `/media` path or https address, or an app asset.
  final String? pose;

  static const _size = 196.0;

  @override
  Widget build(BuildContext context) {
    if (pose == null) return _square();
    BreathPhase? phaseOn(int side) =>
        side < pattern.length ? pattern[side] : null;
    bool breathing(int side) => active && phaseIndex % 4 == side;
    return Column(
      children: [
        _BoxPill(phaseOn(1), current: breathing(1), count: count),
        const SizedBox(height: 10),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 66,
              child: _BoxSide(phaseOn(0), current: breathing(0), count: count),
            ),
            const SizedBox(width: 8),
            _square(),
            const SizedBox(width: 8),
            SizedBox(
              width: 66,
              child: _BoxSide(phaseOn(2), current: breathing(2), count: count),
            ),
          ],
        ),
        const SizedBox(height: 10),
        _BoxPill(phaseOn(3), current: breathing(3), count: count),
      ],
    );
  }

  Widget _square() {
    final pose = this.pose;
    const ends = [
      Alignment.topLeft,
      Alignment.topRight,
      Alignment.bottomRight,
      Alignment.bottomLeft,
    ];
    final target = active ? ends[phaseIndex % 4] : Alignment.bottomLeft;
    return SizedBox(
      width: _size,
      height: _size,
      child: Stack(
        children: [
          Positioned.fill(
            child: Container(
              margin: const EdgeInsets.all(10),
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: pose == null
                    ? CareColors.blue.withValues(alpha: 0.07)
                    : Colors.white,
                borderRadius: BorderRadius.circular(22),
              ),
              child: pose == null ? null : _PoseImage(pose),
            ),
          ),
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(28),
                border: Border.all(
                  color: CareColors.blue.withValues(alpha: 0.34),
                  width: 3,
                ),
              ),
            ),
          ),
          if (pose == null)
            Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    label.toUpperCase(),
                    key: const ValueKey('phase-label'),
                    style: const TextStyle(
                      fontFamily: careFont,
                      color: CareColors.blue,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.1,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    count,
                    key: const ValueKey('phase-count'),
                    style: const TextStyle(
                      fontFamily: careFont,
                      color: CareColors.blue,
                      fontSize: 54,
                      fontWeight: FontWeight.w800,
                      height: 1,
                    ),
                  ),
                ],
              ),
            )
          else if (done)
            Center(
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.92),
                  borderRadius: BorderRadius.circular(100),
                ),
                child: const Text(
                  'Done  ✓',
                  key: ValueKey('phase-label'),
                  style: TextStyle(
                    fontFamily: careFont,
                    color: CareColors.blue,
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
          AnimatedAlign(
            alignment: target,
            duration: reduce ? const Duration(milliseconds: 300) : duration,
            curve: Curves.linear,
            child: Transform.translate(
              offset: Offset(target.x * 10, target.y * 10),
              child: Container(
                width: 20,
                height: 20,
                decoration: BoxDecoration(
                  color: CareColors.blue,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: CareColors.blue.withValues(alpha: 0.18),
                      spreadRadius: 5,
                    ),
                    BoxShadow(
                      color: CareColors.blue.withValues(alpha: 0.5),
                      blurRadius: 16,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A phase along the top or bottom of the box: a small pill, filled with
/// its seconds while it is the one being breathed.
class _BoxPill extends StatelessWidget {
  const _BoxPill(this.phase, {required this.current, required this.count});

  final BreathPhase? phase;
  final bool current;
  final String count;

  @override
  Widget build(BuildContext context) {
    final phase = this.phase;
    if (phase == null) return const SizedBox(height: 28);
    // A set width, so the pill stays small and does not jump as its
    // seconds come and go.
    return Center(
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 250),
        width: 96,
        height: 28,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: current ? CareColors.blue : CareColors.blueTint,
          borderRadius: BorderRadius.circular(100),
        ),
        child: Text(
          current ? '${phase.label} · ${count}s' : phase.label,
          style: TextStyle(
            fontFamily: careFont,
            color: current
                ? Colors.white
                : CareColors.blue.withValues(alpha: 0.55),
            fontSize: 12.5,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

/// A phase beside the left or right of the box, with its seconds under it
/// while it is the one being breathed.
class _BoxSide extends StatelessWidget {
  const _BoxSide(this.phase, {required this.current, required this.count});

  final BreathPhase? phase;
  final bool current;
  final String count;

  @override
  Widget build(BuildContext context) {
    final phase = this.phase;
    if (phase == null) return const SizedBox.shrink();
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          phase.label.replaceFirst(' ', '\n'),
          textAlign: TextAlign.center,
          style: TextStyle(
            fontFamily: careFont,
            color: current
                ? CareColors.blue
                : CareColors.blue.withValues(alpha: 0.45),
            fontSize: 12.5,
            fontWeight: FontWeight.w700,
            height: 1.25,
          ),
        ),
        const SizedBox(height: 4),
        SizedBox(
          height: 34,
          child: current
              ? Text(
                  count,
                  style: const TextStyle(
                    fontFamily: careFont,
                    color: CareColors.blue,
                    fontSize: 28,
                    fontWeight: FontWeight.w800,
                    height: 1.15,
                  ),
                )
              : null,
        ),
      ],
    );
  }
}

/// A box for a few words, up to 250 characters, with its own small Done.
/// Enter works as Done.
class _WriteBox extends StatelessWidget {
  const _WriteBox({
    super.key,
    required this.controller,
    required this.onDone,
    this.autofocus = false,
  });

  final TextEditingController controller;
  final VoidCallback onDone;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    final edge = OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: const BorderSide(color: CareColors.line),
    );
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: TextField(
            controller: controller,
            autofocus: autofocus,
            maxLength: 250,
            minLines: 1,
            maxLines: 5,
            keyboardType: TextInputType.text,
            textInputAction: TextInputAction.done,
            textCapitalization: TextCapitalization.sentences,
            onSubmitted: (_) => onDone(),
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.ink,
              fontSize: 14,
              fontWeight: FontWeight.w500,
              height: 1.45,
            ),
            decoration: InputDecoration(
              counterText: '',
              isDense: true,
              filled: true,
              fillColor: Colors.white,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 11,
              ),
              enabledBorder: edge,
              border: edge,
              focusedBorder: edge.copyWith(
                borderSide: const BorderSide(
                  color: CareColors.blue,
                  width: 1.5,
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        ValueListenableBuilder<TextEditingValue>(
          valueListenable: controller,
          builder: (_, value, _) {
            final ready = value.text.trim().isNotEmpty;
            return Opacity(
              opacity: ready ? 1 : 0.35,
              child: Material(
                color: CareColors.blue,
                borderRadius: BorderRadius.circular(100),
                child: InkWell(
                  onTap: ready ? onDone : null,
                  borderRadius: BorderRadius.circular(100),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                    child: Text(
                      'Done',
                      style: TextStyle(
                        fontFamily: careFont,
                        color: Colors.white,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ],
    );
  }
}

/// The pose to hold, as a photo above the breath.
class _PoseCard extends StatelessWidget {
  const _PoseCard(this.source);

  /// A `/media` path or https address from the catalogue, or an app asset.
  final String source;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(22),
      child: AspectRatio(aspectRatio: 3 / 2, child: _PoseImage(source)),
    );
  }
}

/// A pose photo filling its space: a `/media` path or https address from the
/// catalogue, or an app asset.
class _PoseImage extends StatelessWidget {
  const _PoseImage(this.source);

  final String source;

  @override
  Widget build(BuildContext context) {
    final network = source.startsWith('/') || source.startsWith('http');
    if (!network) return Image.asset(source, fit: BoxFit.cover);
    return Image.network(
      resolveMediaUrl(source),
      fit: BoxFit.cover,
      errorBuilder: (_, _, _) => const ColoredBox(
        color: CareColors.blueTint,
        child: Icon(
          Icons.self_improvement_rounded,
          color: CareColors.blue,
          size: 40,
        ),
      ),
      loadingBuilder: (_, child, progress) => progress == null
          ? child
          : const ColoredBox(color: CareColors.blueTint),
    );
  }
}
