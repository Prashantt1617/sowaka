import 'package:flutter/material.dart';

import '../data/relay_models.dart';

/// Waiting for kick-off.
///
/// The countdown runs on the phone between pushes and is corrected by every
/// one of them, so a slow message shows a second of drift rather than a clock
/// that stalls. What it counts down to is the server's, not this device's.
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

  static const _sky = Color(0xFF4FA3D1);
  static const _skyDeep = Color(0xFF3B8FC4);
  static const _card = Color(0xFFE9F4FB);
  static const _avatar = Color(0xFF7B61C9);
  static const _joined = Color(0xFF2E9E5B);
  static const _waiting = Color(0xFF8A8F98);

  String get _clock {
    final minutes = (secondsLeft ~/ 60).toString().padLeft(2, '0');
    final seconds = (secondsLeft % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [_sky, _skyDeep],
        ),
      ),
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
              child: Row(
                children: [
                  IconButton(
                    onPressed: onClose,
                    icon: const Icon(Icons.close, color: Colors.white, size: 24),
                  ),
                  const Expanded(
                    child: Text(
                      'Lobby',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontFamily: 'Sora',
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: onHowToPlay,
                    icon: const Icon(Icons.info_outline, color: Colors.white, size: 22),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            const Text(
              'GAME STARTS IN',
              style: TextStyle(
                fontFamily: 'Sora',
                color: Colors.white,
                fontSize: 12,
                letterSpacing: 1.6,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              _clock,
              style: const TextStyle(
                fontFamily: 'Sora',
                color: Colors.white,
                fontSize: 52,
                height: 1.1,
                fontWeight: FontWeight.w700,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(height: 26),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                child: Container(
                  decoration: BoxDecoration(
                    color: _card,
                    borderRadius: BorderRadius.circular(18),
                  ),
                  padding: const EdgeInsets.fromLTRB(18, 18, 18, 14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'YOUR TEAM',
                        style: TextStyle(
                          fontFamily: 'Sora',
                          color: Color(0xFF222222),
                          fontSize: 13,
                          letterSpacing: 0.8,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 12),
                      for (final mate in state.teammates) _row(mate),
                      const SizedBox(height: 6),
                      const Center(
                        child: Text(
                          'Game starts automatically ⚡',
                          style: TextStyle(
                            fontFamily: 'Sora',
                            color: Color(0xFF8A8F98),
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(RelayTeammate mate) {
    // What they will actually be doing, which is the difference that matters:
    // one person types, everyone else has something to say out loud.
    final job = mate.isLeader ? 'Write the answer' : 'Share the clue';
    final label = mate.isLeader
        ? '${mate.name} (Team leader)'
        : mate.name;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              CircleAvatar(
                radius: 19,
                backgroundColor: _avatar,
                child: Text(
                  mate.name.isEmpty ? '?' : mate.name.characters.first.toUpperCase(),
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
              ),
              if (mate.isLeader)
                const Positioned(
                  left: -2,
                  bottom: -2,
                  child: Text('👑', style: TextStyle(fontSize: 14)),
                ),
              Positioned(
                right: 0,
                bottom: 0,
                child: Container(
                  width: 11,
                  height: 11,
                  decoration: BoxDecoration(
                    color: mate.present ? _joined : _waiting,
                    shape: BoxShape.circle,
                    border: Border.all(color: _card, width: 2),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: Color(0xFF222222),
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  job,
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: Color(0xFF8A8F98),
                    fontSize: 12.5,
                  ),
                ),
              ],
            ),
          ),
          Text(
            mate.present ? 'Joined' : 'Waiting...',
            style: TextStyle(
              fontFamily: 'Sora',
              color: mate.present ? _joined : _waiting,
              fontSize: 13.5,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
