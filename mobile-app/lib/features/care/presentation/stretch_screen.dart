import 'dart:async';

import 'package:flutter/material.dart';

import '../content/move_content.dart';
import '../data/care_models.dart';
import 'care_theme.dart';
import 'player_screen.dart';

/// One stretch: numbered steps. A step opens to its video (the site's photo
/// until Sowaka's clip arrives); a pause step opens to a countdown.
class StretchScreen extends StatefulWidget {
  const StretchScreen({super.key, required this.stretch, required this.catalog});

  final Stretch stretch;
  final CareCatalog catalog;

  @override
  State<StretchScreen> createState() => _StretchScreenState();
}

class _StretchScreenState extends State<StretchScreen> {
  int _open = 0;
  int? _left;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _startIfPause(0);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _startIfPause(int step) {
    _timer?.cancel();
    if (!widget.stretch.isPause(step)) {
      _left = null;
      return;
    }
    _left = pauseSeconds(widget.stretch.steps[step]);
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      setState(() {
        _left = (_left ?? 1) - 1;
        if ((_left ?? 0) <= 0) {
          _left = 0;
          timer.cancel();
        }
      });
    });
  }

  void _toggle(int step) {
    setState(() {
      if (_open == step) {
        _open = -1;
        _timer?.cancel();
        _left = null;
      } else {
        _open = step;
        _startIfPause(step);
      }
    });
  }

  void _again() {
    setState(() {
      _open = 0;
      _startIfPause(0);
    });
  }

  String get _timerLabel {
    final n = _left ?? pauseSeconds(widget.stretch.steps[_open]);
    return '${n ~/ 60}:${(n % 60).toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.stretch;
    return CarePage(
      backLabel: 'Move',
      children: [
        Center(
          child: Column(
            children: [
              _Tag(s.tag),
              const SizedBox(height: 14),
              CareHeading(s.name, size: 29, color: CareColors.warmInk, align: TextAlign.center),
              const SizedBox(height: 8),
              CareCopy(s.sub, size: 14.5, color: CareColors.warmMuted, align: TextAlign.center),
            ],
          ),
        ),
        const SizedBox(height: 20),
        for (var i = 0; i < s.steps.length; i++) ...[
          _StepCard(number: i + 1, text: s.steps[i], open: _open == i, onTap: () => _toggle(i)),
          if (_open == i)
            _Panel(
              child: s.isPause(i)
                  ? _PauseCountdown(label: _timerLabel)
                  : _StepMedia(
                      videoUrl: widget.catalog.moveVideo(s.key, i + 1),
                      photoUrl: s.photoUrl(i),
                      title: '${s.name} · step ${i + 1}',
                    ),
            ),
          const SizedBox(height: 11),
        ],
        const SizedBox(height: 16),
        CarePrimaryButton('↺  Do it again', pill: true, onTap: _again),
        const SizedBox(height: 4),
        TextButton(
          onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst),
          child: const Text('Choose something else', style: TextStyle(fontFamily: careFont, color: CareColors.warmMuted, fontSize: 14, fontWeight: FontWeight.w600)),
        ),
      ],
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 7),
    decoration: BoxDecoration(color: CareColors.blueTint, borderRadius: BorderRadius.circular(100)),
    child: Text(
      text.toUpperCase(),
      style: const TextStyle(fontFamily: careFont, color: CareColors.blue, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.8),
    ),
  );
}

/// A numbered step row, blue when open. Shared with the mood step lists.
class StepCard extends StatelessWidget {
  const StepCard({super.key, required this.number, required this.text, required this.open, required this.onTap});

  final int number;
  final String text;
  final bool open;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => _StepCard(number: number, text: text, open: open, onTap: onTap);
}

class _StepCard extends StatelessWidget {
  const _StepCard({required this.number, required this.text, required this.open, required this.onTap});

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
            border: Border.all(color: open ? CareColors.blue : const Color(0xFFF0E9DD)),
          ),
          child: Row(
            children: [
              Container(
                width: 30,
                height: 30,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: open ? CareColors.blue : CareColors.blueTint, shape: BoxShape.circle),
                child: Text('$number', style: TextStyle(fontFamily: careFont, color: open ? Colors.white : CareColors.blue, fontSize: 13, fontWeight: FontWeight.w800)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Text(text, style: const TextStyle(fontFamily: careFont, color: Color(0xFF3A332C), fontSize: 14.5, fontWeight: FontWeight.w500, height: 1.6)),
              ),
              const SizedBox(width: 8),
              AnimatedRotation(
                turns: open ? 0.5 : 0,
                duration: const Duration(milliseconds: 250),
                child: Icon(Icons.expand_more_rounded, color: open ? CareColors.blue : const Color(0xFFC2B6A6), size: 20),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(top: 11),
    clipBehavior: Clip.antiAlias,
    decoration: BoxDecoration(
      color: CareColors.sand,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: CareColors.blue),
      boxShadow: const [BoxShadow(color: Color(0x33A89A88), blurRadius: 30, offset: Offset(0, 14))],
    ),
    child: child,
  );
}

/// The countdown on a pause step: a breathing blue disc with the time left.
class _PauseCountdown extends StatefulWidget {
  const _PauseCountdown({required this.label});

  final String label;

  @override
  State<_PauseCountdown> createState() => _PauseCountdownState();
}

class _PauseCountdownState extends State<_PauseCountdown> with SingleTickerProviderStateMixin {
  late final AnimationController _breathe = AnimationController(vsync: this, duration: const Duration(milliseconds: 5600))..repeat(reverse: true);

  @override
  void dispose() {
    _breathe.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 210,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0x1A0571A6), CareColors.sand]),
      ),
      child: AnimatedBuilder(
        animation: _breathe,
        builder: (_, _) {
          final scale = 1 + 0.16 * Curves.easeInOut.transform(_breathe.value);
          return Stack(
            alignment: Alignment.center,
            children: [
              Container(
                width: 144 * (1 + 0.06 * _breathe.value),
                height: 144 * (1 + 0.06 * _breathe.value),
                decoration: BoxDecoration(color: CareColors.blue.withValues(alpha: 0.16), shape: BoxShape.circle),
              ),
              Transform.scale(
                scale: scale,
                child: Container(
                  width: 108,
                  height: 108,
                  decoration: BoxDecoration(
                    color: CareColors.blue,
                    shape: BoxShape.circle,
                    boxShadow: [BoxShadow(color: CareColors.blue.withValues(alpha: 0.5), blurRadius: 40, offset: const Offset(0, 16))],
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text('BREATHE', style: TextStyle(fontFamily: careFont, color: Colors.white70, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 1.4)),
                      const SizedBox(height: 2),
                      Text(widget.label, key: const ValueKey('pause-timer'), style: const TextStyle(fontFamily: careFont, color: Colors.white, fontSize: 25, fontWeight: FontWeight.w800, height: 1)),
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

/// The step's clip, or the site's photo with a note until the clip exists.
class _StepMedia extends StatelessWidget {
  const _StepMedia({required this.videoUrl, required this.photoUrl, required this.title});

  final String? videoUrl;
  final String photoUrl;
  final String title;

  @override
  Widget build(BuildContext context) {
    final video = videoUrl;
    if (video != null && video.isNotEmpty) {
      return SizedBox(height: 236, child: InlineVideo(url: video, title: title));
    }
    return SizedBox(
      height: 210,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Image.network(
            photoUrl,
            fit: BoxFit.cover,
            errorBuilder: (_, _, _) => const ColoredBox(color: CareColors.blueTint, child: Icon(Icons.accessibility_new_rounded, color: CareColors.blue, size: 40)),
            loadingBuilder: (_, child, progress) => progress == null ? child : const ColoredBox(color: CareColors.blueTint),
          ),
          Positioned(
            right: 12,
            bottom: 12,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
              decoration: BoxDecoration(color: CareColors.blue.withValues(alpha: 0.92), borderRadius: BorderRadius.circular(100)),
              child: const Text('Video on its way', style: TextStyle(fontFamily: careFont, color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
            ),
          ),
        ],
      ),
    );
  }
}
