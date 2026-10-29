import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/services.dart';

/// The short tones Face ID plays so the person knows what is happening
/// without reading the screen: a new prompt, a step seen, verified, refused.
/// Each comes with a matching haptic. Best effort: a phone with no audio
/// plugin, or one that is silenced, just shows the words.
class FaceSounds {
  FaceSounds._();

  static bool enabled = true;

  /// How a tone is played; a test swaps this to see what was asked for.
  static Future<void> Function(String asset) play = _play;

  static final _player = AudioPlayer()..setReleaseMode(ReleaseMode.stop);

  static Future<void> _play(String asset) async {
    try {
      await _player.stop();
      await _player.play(AssetSource(asset), volume: 1);
    } catch (_) {
      // No player on this phone: the words stand.
    }
  }

  static Future<void> _sound(String asset, Future<void> Function() haptic) async {
    if (!enabled) return;
    try {
      await haptic();
    } catch (_) {}
    await play(asset);
  }

  /// A new prompt is up ("Move your head to the left…", "Blink now").
  static Future<void> prompt() => _sound('sounds/face_prompt.wav', HapticFeedback.lightImpact);

  /// A step was seen: the head turned, back to the camera, the blink.
  static Future<void> step() => _sound('sounds/face_step.wav', HapticFeedback.selectionClick);

  /// Verified, or set up.
  static Future<void> done() => _sound('sounds/face_done.wav', HapticFeedback.mediumImpact);

  /// Refused, timed out, or the light check failed.
  static Future<void> failed() => _sound('sounds/face_fail.wav', HapticFeedback.heavyImpact);
}
