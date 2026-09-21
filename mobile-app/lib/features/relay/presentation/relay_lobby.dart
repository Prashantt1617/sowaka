import 'package:flutter/material.dart';

import '../data/relay_models.dart';
import 'relay_style.dart';

/// Waiting for kick-off (Figma 2603:31280).
///
/// The countdown runs on the phone between pushes and is corrected by every
/// one of them, so a slow message shows a second of drift rather than a clock
/// that stalls. What it counts down to is the server's moment, not this
/// device's.
class RelayLobby extends StatelessWidget {
  const RelayLobby({
    super.key,
    required this.state,
    required this.secondsLeft,
    this.onClose,
    this.onHowToPlay,
  });

  final RelayState state;

  /// Ticked locally, reset by each state push.
  final int secondsLeft;
  final VoidCallback? onClose;
  final VoidCallback? onHowToPlay;

  String get _clock {
    final minutes = (secondsLeft ~/ 60).toString().padLeft(2, '0');
    final seconds = (secondsLeft % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  @override
  Widget build(BuildContext context) {
    return RelayBackdrop(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              GestureDetector(
                onTap: onClose,
                child: RelayStyle.svg('cross', width: 24, height: 24),
              ),
              Text(
                'Lobby',
                style: RelayStyle.sora(
                  14,
                  weight: FontWeight.w600,
                  color: RelayStyle.onBlue,
                  height: 16.2,
                  spacing: -0.16,
                ),
              ),
              GestureDetector(
                onTap: onHowToPlay,
                child: SizedBox(
                  width: 28,
                  height: 24,
                  child: Center(child: RelayStyle.svg('info', width: 22, height: 22)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
            child: Column(
              children: [
                Text(
                  'GAME STARTS IN',
                  textAlign: TextAlign.center,
                  style: RelayStyle.sora(
                    12,
                    weight: FontWeight.w600,
                    color: RelayStyle.onBlue,
                    height: 18,
                    spacing: 0.5,
                  ),
                ),
                Text(
                  _clock,
                  textAlign: TextAlign.center,
                  style: RelayStyle.sora(
                    48,
                    weight: FontWeight.w800,
                    color: Colors.white,
                    height: 72,
                    spacing: -1,
                  ).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: const Color(0xFFE7F7FF),
              borderRadius: BorderRadius.circular(20),
              boxShadow: const [
                BoxShadow(color: Color(0x08000000), blurRadius: 6, offset: Offset(0, 2)),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'YOUR TEAM',
                  style: RelayStyle.sora(13, weight: FontWeight.w700, height: 19.5),
                ),
                const SizedBox(height: 16),
                for (var i = 0; i < state.teammates.length; i += 1) ...[
                  if (i > 0) const SizedBox(height: 16),
                  _Row(mate: state.teammates[i]),
                ],
                const SizedBox(height: 18),
                Center(
                  child: Text(
                    'Game starts automatically ⚡',
                    textAlign: TextAlign.center,
                    style: RelayStyle.sora(13, color: const Color(0xFF9197A2), height: 19.5),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.mate});

  final RelayTeammate mate;

  @override
  Widget build(BuildContext context) {
    // What they will actually be doing is the useful difference: one person
    // types, everyone else has something to say out loud.
    final job = mate.isLeader ? 'Write the answer' : 'Share the clue';
    final label = mate.isLeader
        ? '${mate.name} (Team leader)'
        : mate.isYou
            ? '${mate.name} (You)'
            : mate.name;
    return SizedBox(
      height: mate.isLeader ? 57 : null,
      child: Row(
        children: [
          SizedBox(
            width: 40,
            height: 40,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                RelayInitial(name: mate.name, size: 40, fontSize: 16.8),
                if (mate.isLeader)
                  Positioned(
                    left: 10,
                    top: 23,
                    child: RelayStyle.svg('crown', width: 20, height: 20),
                  ),
                Positioned(
                  left: 27.87,
                  top: 27.88,
                  child: Container(
                    width: 12,
                    height: 12,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: mate.present ? RelayStyle.online : RelayStyle.tertiary,
                      border: Border.all(color: Colors.white, width: 1.129),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: RelayStyle.sora(12, weight: FontWeight.w600, height: 18),
                ),
                Text(
                  job,
                  style: RelayStyle.sora(
                    10,
                    weight: FontWeight.w600,
                    color: RelayStyle.tertiary,
                    height: 16.2,
                    spacing: -0.16,
                  ),
                ),
              ],
            ),
          ),
          Text(
            mate.present ? 'Joined' : 'Waiting...',
            style: RelayStyle.sora(
              12,
              weight: FontWeight.w600,
              color: mate.present ? RelayStyle.green : RelayStyle.tertiary,
              height: 18,
            ),
          ),
        ],
      ),
    );
  }
}
