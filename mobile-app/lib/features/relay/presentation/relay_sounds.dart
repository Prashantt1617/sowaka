import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:video_player/video_player.dart';

import 'relay_style.dart';

/// The two answer sounds: a chime for a correct answer, a buzzer for a wrong
/// one.
///
/// Played through the video player the app already carries for the rules
/// video, which plays audio files just as well — no second media plugin for
/// two short clips. Each is loaded once and rewound for the next play. A sound
/// is a nicety: if one cannot load or play, the game carries on in silence.
class RelaySounds {
  RelaySounds._();

  static final RelaySounds instance = RelaySounds._();

  /// Off under widget tests, where there is no audio platform to talk to.
  static bool enabled = !Platform.environment.containsKey('FLUTTER_TEST');

  final _players = <String, Future<VideoPlayerController?>>{};

  Future<void> correct() => _play('correct.mp3');
  Future<void> incorrect() => _play('incorrect.mp3');

  Future<VideoPlayerController?> _load(String file) async {
    final player = VideoPlayerController.asset(
      '${RelayStyle.asset}/$file',
      // Answer sounds should not stop someone's music or a call.
      videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true),
    );
    try {
      await player.initialize();
      return player;
    } catch (error) {
      debugPrint('Relay sound $file did not load: $error');
      await player.dispose();
      return null;
    }
  }

  Future<void> _play(String file) async {
    if (!enabled) return;
    final player = await (_players[file] ??= _load(file));
    if (player == null) {
      // Try again next time rather than staying silent for the whole game.
      _players.remove(file);
      return;
    }
    try {
      await player.seekTo(Duration.zero);
      await player.play();
    } catch (error) {
      debugPrint('Relay sound $file did not play: $error');
    }
  }

  /// Loads both ahead of the first answer, so the first one isn't late.
  void warmUp() {
    if (!enabled) return;
    for (final file in const ['correct.mp3', 'incorrect.mp3']) {
      _players[file] ??= _load(file);
    }
  }
}
