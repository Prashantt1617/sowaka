import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';

import 'relay_style.dart';

/// The confetti for a correct answer — the designer's "CONFETTI" Lottie, with
/// cannons from both sides and a shower from the top.
///
/// Played once per correct answer and gone when it lands. It ignores touches,
/// so it never gets between a player and the next question.
class RelayConfetti extends StatefulWidget {
  const RelayConfetti({super.key, required this.trigger});

  /// A new value fires a new burst; the same value never fires twice.
  final Object? trigger;

  @override
  State<RelayConfetti> createState() => _RelayConfettiState();
}

class _RelayConfettiState extends State<RelayConfetti> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this);
  bool _loaded = false;

  @override
  void didUpdateWidget(covariant RelayConfetti oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.trigger != null && widget.trigger != oldWidget.trigger) _burst();
  }

  void _burst() {
    // Before the file has loaded there is no length to play; the load itself
    // starts the burst.
    if (_loaded) _controller.forward(from: 0);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) => Visibility(
          visible: _controller.isAnimating,
          maintainState: true,
          maintainAnimation: true,
          maintainSize: true,
          child: child!,
        ),
        child: Lottie.asset(
          '${RelayStyle.asset}/confetti.json',
          controller: _controller,
          fit: BoxFit.cover,
          alignment: Alignment.center,
          onLoaded: (composition) {
            _controller.duration = composition.duration;
            _loaded = true;
            if (widget.trigger != null) _controller.forward(from: 0);
          },
        ),
      ),
    );
  }
}
