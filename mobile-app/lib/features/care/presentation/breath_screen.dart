import 'dart:async';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../../../services/api_config.dart';
import '../content/breathe_content.dart';
import '../content/move_content.dart' show pauseSeconds;
import 'care_theme.dart';
import 'stretch_screen.dart' show StepCard;

/// One mood's remedy: a timed breath with the circle or the box, or a short
/// list of steps. Gentle slows every phase by a third; the phone's reduce
/// motion setting keeps the count and drops the animation.
class BreathScreen extends StatefulWidget {
  const BreathScreen({super.key, required this.mood, this.soundUrl});

  final Mood mood;

  /// A sound to play quietly behind the breath, when Sowaka has one for the mood.
  final String? soundUrl;

  @override
  State<BreathScreen> createState() => _BreathScreenState();
}

class _BreathScreenState extends State<BreathScreen> {
  // Breath engine.
  Timer? _timer;
  int _round = 0;
  int _phase = 0;
  int _tick = 0;
  bool _gentle = false;
  bool _done = false;
  bool _started = false;

  // Step list: runs on its own, like a Move routine. Each step is read for
  // four seconds, a hold counts its own seconds down, and the list
  // scrolls to keep the current step in view.
  static const _stepSeconds = 4;
  int _current = 0;
  int _left = 0;
  bool _stepsDone = false;
  Timer? _stepTimer;
  late final List<GlobalKey> _stepKeys = [
    for (final _ in mood.steps) GlobalKey(),
  ];

  // Background sound.
  VideoPlayerController? _sound;
  bool _muted = false;

  Mood get mood => widget.mood;
  double get _mult => _gentle ? 1.3 : 1;

  @override
  void initState() {
    super.initState();
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

  @override
  void dispose() {
    _timer?.cancel();
    _stepTimer?.cancel();
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
    _timer = Timer(Duration(milliseconds: (1000 * _mult).round()), () {
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

  void _again() {
    if (mood.kind == RemedyKind.breath) {
      _timer?.cancel();
      setState(() {
        _started = false;
        _done = false;
        _round = 0;
        _phase = 0;
        _tick = 0;
      });
      _timer = Timer(const Duration(milliseconds: 450), _start);
    } else {
      _runStep(0);
    }
  }

  void _setGentle(bool value) {
    if (_gentle == value) return;
    setState(() => _gentle = value);
    if (mood.kind == RemedyKind.breath) _again();
  }

  /// Makes step [i] the current one and starts its clock: a hold's own
  /// seconds, or a short reading time for anything else. When it runs out the
  /// next step takes over; after the last, the routine is done.
  void _runStep(int i) {
    _stepTimer?.cancel();
    setState(() {
      _current = i;
      _stepsDone = false;
      _left = mood.isPause(i) ? pauseSeconds(mood.steps[i]) : _stepSeconds;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _showCurrent());
    _stepTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      setState(() => _left = _left - 1);
      if (_left > 0) return;
      timer.cancel();
      if (i + 1 < mood.steps.length) {
        _runStep(i + 1);
      } else {
        setState(() => _stepsDone = true);
      }
    });
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
        const SizedBox(height: 26),
        CarePrimaryButton(
          isBreath ? '↺  Breathe again' : '↺  Do it again',
          pill: true,
          onTap: _again,
        ),
        const SizedBox(height: 4),
        TextButton(
          onPressed: () =>
              Navigator.of(context).popUntil((route) => route.isFirst),
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
    );
  }

  Widget _steps() {
    final label =
        '${_left ~/ 60}:${(_left % 60).toString().padLeft(2, '0')}';
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
    final phaseDuration = Duration(
      milliseconds: ((phase?.seconds ?? 1) * 880 * _mult).round(),
    );
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
        // The pose to hold, from the catalogue's photo or the app's own.
        if ((mood.poseUrl ?? mood.poseAsset) case final pose?) ...[
          _PoseCard(pose),
          const SizedBox(height: 18),
        ],
        if (mood.square && note != null) ...[
          _Note(note),
          const SizedBox(height: 24),
        ],
        if (mood.square)
          _Box(
            phaseIndex: _phase,
            active: phase != null,
            label: label,
            count: count,
            duration: Duration(
              milliseconds: ((phase?.seconds ?? 1) * 1000 * _mult).round(),
            ),
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
        const SizedBox(height: 22),
        if (!mood.square && note != null) ...[
          _Note(note),
          const SizedBox(height: 6),
        ],
        Text(
          mood.square ? 'Breathe around the box' : 'Breathe with the circle',
          style: const TextStyle(
            fontFamily: careFont,
            color: Color(0xFF988C7C),
            fontSize: 14,
          ),
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(3),
          decoration: BoxDecoration(
            color: const Color(0xFFF1ECE3),
            borderRadius: BorderRadius.circular(100),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _SpeedChip(
                'Standard',
                selected: !_gentle,
                onTap: () => _setGentle(false),
              ),
              _SpeedChip(
                'Gentle',
                selected: _gentle,
                onTap: () => _setGentle(true),
              ),
            ],
          ),
        ),
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

class _SpeedChip extends StatelessWidget {
  const _SpeedChip(this.label, {required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: selected ? Colors.white : Colors.transparent,
    borderRadius: BorderRadius.circular(100),
    elevation: selected ? 1 : 0,
    shadowColor: const Color(0x1A2A2420),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(100),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        child: Text(
          label,
          style: TextStyle(
            fontFamily: careFont,
            color: selected ? CareColors.blue : CareColors.warmMuted,
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
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
class _Box extends StatelessWidget {
  const _Box({
    required this.phaseIndex,
    required this.active,
    required this.label,
    required this.count,
    required this.duration,
    required this.reduce,
  });

  final int phaseIndex;
  final bool active;
  final String label;
  final String count;
  final Duration duration;
  final bool reduce;

  @override
  Widget build(BuildContext context) {
    const String? pose = null;
    const size = 216.0;
    final ends = [
      Alignment.topLeft,
      Alignment.topRight,
      Alignment.bottomRight,
      Alignment.bottomLeft,
    ];
    final target = active ? ends[phaseIndex % 4] : Alignment.bottomLeft;
    return SizedBox(
      width: size,
      height: pose == null ? size : size * 1.3,
      child: Stack(
        children: [
          Positioned.fill(
            child: Container(
              margin: const EdgeInsets.all(10),
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: CareColors.blue.withValues(alpha: 0.07),
                borderRadius: BorderRadius.circular(22),
              ),
              child: pose == null
                  ? null
                  : Image.asset(
                      pose,
                      fit: BoxFit.cover,
                      alignment: Alignment.topCenter,
                    ),
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
          Align(
            alignment: pose == null ? Alignment.center : Alignment.bottomCenter,
            child: Container(
              margin: EdgeInsets.only(bottom: pose == null ? 0 : 22),
              padding: pose == null
                  ? EdgeInsets.zero
                  : const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
              decoration: pose == null
                  ? null
                  : BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.88),
                      borderRadius: BorderRadius.circular(18),
                    ),
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
                    style: TextStyle(
                      fontFamily: careFont,
                      color: CareColors.blue,
                      fontSize: pose == null ? 54 : 40,
                      fontWeight: FontWeight.w800,
                      height: 1,
                    ),
                  ),
                ],
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

/// The pose to hold, as a photo above the breath.
class _PoseCard extends StatelessWidget {
  const _PoseCard(this.source);

  /// A `/media` path or https address from the catalogue, or an app asset.
  final String source;

  @override
  Widget build(BuildContext context) {
    final network = source.startsWith('/') || source.startsWith('http');
    return ClipRRect(
      borderRadius: BorderRadius.circular(22),
      child: AspectRatio(
        aspectRatio: 3 / 2,
        child: network
            ? Image.network(
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
              )
            : Image.asset(source, fit: BoxFit.cover),
      ),
    );
  }
}
