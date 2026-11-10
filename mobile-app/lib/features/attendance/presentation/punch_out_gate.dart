import 'dart:async';

import 'package:flutter/widgets.dart';

/// How long after punching in a punch-out is accepted; the server refuses one
/// sooner (`PUNCH_OUT_MIN_GAP_MINUTES`).
const punchOutMinGap = Duration(minutes: 30);

/// Shows [child] — the punch-out slider — only once [punchOutMinGap] has
/// passed since [punchIn]. Before that there is nothing on the card to slide,
/// and the slider appears on its own at the moment it opens, with no reload.
class PunchOutGate extends StatefulWidget {
  const PunchOutGate({super.key, required this.punchIn, required this.child});

  final DateTime punchIn;
  final Widget child;

  @override
  State<PunchOutGate> createState() => _PunchOutGateState();
}

class _PunchOutGateState extends State<PunchOutGate> {
  Timer? _opens;

  DateTime get _opensAt => widget.punchIn.add(punchOutMinGap);

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  @override
  void didUpdateWidget(PunchOutGate old) {
    super.didUpdateWidget(old);
    if (old.punchIn != widget.punchIn) _schedule();
  }

  void _schedule() {
    _opens?.cancel();
    final wait = _opensAt.difference(DateTime.now());
    if (wait > Duration.zero) {
      _opens = Timer(wait, () {
        if (mounted) setState(() {});
      });
    }
  }

  @override
  void dispose() {
    _opens?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => DateTime.now().isBefore(_opensAt)
      ? const SizedBox.shrink()
      : widget.child;
}
