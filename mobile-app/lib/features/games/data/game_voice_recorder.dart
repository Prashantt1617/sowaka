import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

/// The games whose pages talk (`Sowaka.voice`); no other page gets the mic.
const voiceGameKeys = {'pool'};

/// The longest walkie-talkie message: recording stops on its own here, and
/// the server refuses anything longer (`VOICE_MAX_MS`).
const gameVoiceMaxDuration = Duration(seconds: 15);

/// A recorded message, ready for the page to send: base64 AAC in an MP4
/// container, which both iPhone and Android web views decode.
class GameVoiceClip {
  const GameVoiceClip({
    required this.data,
    required this.mime,
    required this.ms,
  });

  final String data;
  final String mime;
  final int ms;

  Map<String, Object> toPageJson() => {'data': data, 'mime': mime, 'ms': ms};
}

/// Hold-to-talk recording for a game's page (`Sowaka.voice` on the bridge).
///
/// The page asks for [start] when the mic is pressed and for [stop] when it is
/// let go; [cancel] drops a recording nobody will hear. Voice quality only —
/// 16 kHz mono AAC at 24 kbps, about 45 KB for the longest message — so a
/// clip crosses the game's socket in a moment. The phone keeps playing
/// through the loudspeaker (not the earpiece) and mixes with the game's own
/// sounds while it records.
class GameVoiceRecorder {
  GameVoiceRecorder({AudioRecorder? recorder}) : _made = recorder;

  /// Made at the first message, not with the game: a game nobody talks in
  /// never touches the microphone.
  AudioRecorder? _made;
  AudioRecorder get _recorder => _made ??= AudioRecorder();
  DateTime? _startedAt;
  String? _path;
  Timer? _limit;

  /// The clip the 15-second limit is stopping (or has stopped), for the
  /// page's [stop] that arrives while it does.
  Future<GameVoiceClip?>? _cut;

  bool get recording => _startedAt != null;

  /// Starts recording. False when the person has not let the app use the mic.
  Future<bool> start() async {
    if (recording) return true;
    if (!await _recorder.hasPermission()) return false;
    final dir = await getTemporaryDirectory();
    final path =
        '${dir.path}/game-voice-${DateTime.now().microsecondsSinceEpoch}.m4a';
    await _recorder.start(
      const RecordConfig(
        encoder: AudioEncoder.aacLc,
        sampleRate: 16000,
        numChannels: 1,
        bitRate: 24000,
        iosConfig: IosRecordConfig(
          categoryOptions: [
            IosAudioCategoryOption.defaultToSpeaker,
            IosAudioCategoryOption.allowBluetooth,
            IosAudioCategoryOption.allowBluetoothA2DP,
            IosAudioCategoryOption.mixWithOthers,
          ],
        ),
      ),
      path: path,
    );
    _path = path;
    _cut = null;
    _startedAt = DateTime.now();
    _limit = Timer(gameVoiceMaxDuration, () {
      // Stopping is under way from here: a stop() in the meantime waits on it.
      _cut = _finish().catchError((Object _) => null);
    });
    return true;
  }

  /// Stops and hands back the clip; null when nothing was recorded.
  Future<GameVoiceClip?> stop() async {
    final cut = _cut;
    if (cut != null) {
      _cut = null;
      return cut;
    }
    if (!recording) return null;
    return _finish();
  }

  /// Stops and throws the recording away.
  Future<void> cancel() async {
    _limit?.cancel();
    _cut = null;
    if (!recording) return;
    _startedAt = null;
    final path = await _recorder.stop() ?? _path;
    _deleteQuietly(path);
  }

  Future<GameVoiceClip?> _finish() async {
    _limit?.cancel();
    final started = _startedAt;
    if (started == null) return null;
    _startedAt = null;
    final ms = DateTime.now()
        .difference(started)
        .inMilliseconds
        .clamp(0, gameVoiceMaxDuration.inMilliseconds);
    final path = await _recorder.stop() ?? _path;
    if (path == null) return null;
    try {
      final bytes = await File(path).readAsBytes();
      if (bytes.isEmpty) return null;
      return GameVoiceClip(
        data: base64Encode(bytes),
        mime: 'audio/mp4',
        ms: ms,
      );
    } finally {
      _deleteQuietly(path);
    }
  }

  void _deleteQuietly(String? path) {
    if (path == null) return;
    unawaited(File(path).delete().then((_) {}, onError: (_) {}));
  }

  Future<void> dispose() async {
    await cancel();
    await _made?.dispose();
  }
}
