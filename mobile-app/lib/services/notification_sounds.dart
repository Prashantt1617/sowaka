import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Notification sounds: which ones this phone has, so the server can pick
/// one per kind of notification (backend notification-look.service.ts).
///
/// A few ship inside the app ([builtInNotificationSounds]): on Android as
/// `res/raw/<key>.wav`, on iOS as `assets/notification_sounds/<key>.caf`,
/// copied into `Library/Sounds`, where iOS looks for a push's `aps.sound`.
/// More come from the server's list (`GET /notifications/sounds`) and are
/// downloaded on start: into `Library/Sounds/<key>.wav` on iOS, and on
/// Android into the app's files with one notification channel per sound and
/// version, since a channel's sound is fixed once the channel is made.
///
/// The phone then reports what it has (`key@version`) with its token, and the
/// server sends the plain push to a phone without the sound it would pick.

/// Shipped in the app. The server's BUILT_IN_SOUNDS names the same keys.
const builtInNotificationSounds = <String, String>{
  'chime': 'Chime',
  'pop': 'Pop',
  'fanfare': 'Fanfare',
  'tick': 'Tick',
  'whoosh': 'Whoosh',
  'bell': 'Bell',
};
const builtInSoundVersion = 1;

/// The largest sound the app will download (the server takes up to 1 MB).
const maxSoundBytes = 1024 * 1024;

/// The Android channel for one sound and version.
String soundChannelId(String key, int version) => 'snd_${key}_v$version';

/// What the phone reports for a sound it has.
String soundTag(String key, int version) => '$key@$version';

/// One entry of the server's list.
@immutable
class NotificationSoundEntry {
  const NotificationSoundEntry({
    required this.key,
    required this.name,
    required this.version,
    required this.builtIn,
    this.url,
  });

  final String key;
  final String name;
  final int version;
  final bool builtIn;

  /// Where to download it (a path on the API); null for a built-in one.
  final String? url;

  static final _key = RegExp(r'^[a-z][a-z0-9_]{1,23}$');

  /// Null for anything malformed, so one bad row never stops the rest.
  static NotificationSoundEntry? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final key = '${raw['key'] ?? ''}';
    final version = raw['version'] is int
        ? raw['version'] as int
        : int.tryParse('${raw['version']}');
    if (!_key.hasMatch(key) || version == null || version < 1) return null;
    final url = raw['url'] is String && (raw['url'] as String).isNotEmpty
        ? raw['url'] as String
        : null;
    return NotificationSoundEntry(
      key: key,
      name: '${raw['name'] ?? key}',
      version: version,
      builtIn: raw['builtIn'] == true || url == null,
      url: url,
    );
  }
}

/// Where sounds are kept on this phone. A fake in tests.
abstract class SoundFiles {
  /// The folder downloaded sounds go into; null where there is none (web).
  Future<String?> folder();
  Future<bool> exists(String path);

  /// Writes the whole file, so a half-written sound is never played.
  Future<void> write(String path, List<int> bytes);
  Future<void> delete(String path);

  /// A sound bundled as a Flutter asset, or null.
  Future<List<int>?> asset(String name);

  /// What was downloaded before: `{key: version}`.
  Future<Map<String, int>> readIndex();
  Future<void> writeIndex(Map<String, int> index);
}

/// Android notification channels, one per sound and version. A fake in tests.
abstract class SoundChannels {
  /// A channel playing `res/raw/<key>`.
  Future<void> ensureBuiltIn(String key, int version, String name);

  /// A channel playing a downloaded file.
  Future<void> ensureFile(String key, int version, String name, String path);
  Future<void> remove(String key, int version);
}

/// The phone's sounds, brought in line with the server's list.
class NotificationSoundSync {
  NotificationSoundSync({
    required this.client,
    required this.files,
    required this.channels,
    required this.platform,
    required this.baseUrl,
  });

  final http.Client client;
  final SoundFiles files;
  final SoundChannels? channels;
  final TargetPlatform platform;
  final String baseUrl;

  bool get _android => platform == TargetPlatform.android;
  bool get _ios => platform == TargetPlatform.iOS;

  /// The file a downloaded sound is kept in. On Android the version is in
  /// the name: the old channel still points at the old file until it goes.
  String fileFor(String folder, String key, int version) =>
      _android ? '$folder/${key}_v$version.wav' : '$folder/$key.wav';

  /// Makes sure every built-in sound and every sound on the server's list is
  /// on the phone, and returns the tags of the sounds it has. [token] signs
  /// the list's request; without it, or should the list not load, only what
  /// is already here is reported. Never throws.
  Future<List<String>> sync({String? token}) async {
    if (!_android && !_ios) return const [];
    final have = <String>{};
    final folder = await _folder();
    if (folder == null) return const [];
    await _builtIns(folder, have);
    final index = await _readIndex();
    final manifest = token == null ? null : await _manifest(token);
    if (manifest == null) {
      // Offline, or not signed in: what was downloaded before still counts.
      for (final entry in index.entries) {
        if (await _exists(fileFor(folder, entry.key, entry.value))) {
          have.add(soundTag(entry.key, entry.value));
        }
      }
      return _sorted(have);
    }
    final next = <String, int>{};
    for (final sound in manifest) {
      if (sound.builtIn || sound.url == null) continue;
      final path = fileFor(folder, sound.key, sound.version);
      final kept = index[sound.key] == sound.version && await _exists(path);
      if (!kept && !await _download(sound, path)) {
        // Not this time: keep an older version if it is still here.
        final older = index[sound.key];
        if (older != null && await _exists(fileFor(folder, sound.key, older))) {
          next[sound.key] = older;
          have.add(soundTag(sound.key, older));
        }
        continue;
      }
      if (_android) {
        try {
          await channels?.ensureFile(sound.key, sound.version, sound.name, path);
        } catch (error) {
          debugPrint('Sound channel not made for ${sound.key}: $error');
          continue;
        }
      }
      next[sound.key] = sound.version;
      have.add(soundTag(sound.key, sound.version));
      final older = index[sound.key];
      if (older != null && older != sound.version) {
        await _retire(folder, sound.key, older, replaced: true);
      }
    }
    // Sounds the server no longer lists: their channels and files go.
    for (final gone in index.entries.where((e) => !next.containsKey(e.key))) {
      await _retire(folder, gone.key, gone.value, replaced: false);
    }
    try {
      await files.writeIndex(next);
    } catch (_) {}
    return _sorted(have);
  }

  Future<void> _builtIns(String folder, Set<String> have) async {
    for (final entry in builtInNotificationSounds.entries) {
      try {
        if (_android) {
          await channels?.ensureBuiltIn(
            entry.key,
            builtInSoundVersion,
            entry.value,
          );
        } else {
          // iOS plays a push's sound from Library/Sounds or the app bundle;
          // the built-ins are Flutter assets, so they are copied there.
          final path = '$folder/${entry.key}.caf';
          if (!await files.exists(path)) {
            final bytes = await files.asset(
              'assets/notification_sounds/${entry.key}.caf',
            );
            if (bytes == null) continue;
            await files.write(path, bytes);
          }
        }
        have.add(soundTag(entry.key, builtInSoundVersion));
      } catch (error) {
        debugPrint('Built-in sound ${entry.key} not set up: $error');
      }
    }
  }

  Future<List<NotificationSoundEntry>?> _manifest(String token) async {
    try {
      final response = await client
          .get(
            Uri.parse('$baseUrl/notifications/sounds'),
            headers: {'Authorization': 'Bearer $token'},
          )
          .timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) return null;
      final body = jsonDecode(response.body);
      final rows = body is Map ? body['sounds'] : null;
      if (rows is! List) return null;
      return rows
          .map(NotificationSoundEntry.fromJson)
          .whereType<NotificationSoundEntry>()
          .toList();
    } catch (error) {
      debugPrint('Notification sounds list not read: $error');
      return null;
    }
  }

  Future<bool> _download(NotificationSoundEntry sound, String path) async {
    try {
      final url = sound.url!.startsWith('http')
          ? sound.url!
          : '$baseUrl${sound.url}';
      final response = await client
          .get(Uri.parse(url))
          .timeout(const Duration(seconds: 20));
      final bytes = response.bodyBytes;
      if (response.statusCode != 200 || !isWav(bytes)) return false;
      if (bytes.length > maxSoundBytes) return false;
      await files.write(path, bytes);
      return true;
    } catch (error) {
      debugPrint('Notification sound ${sound.key} not downloaded: $error');
      return false;
    }
  }

  /// A sound's old version (or one no longer listed): its channel and file go.
  /// On iOS the file has no version in its name, so a version replaced by a
  /// newer one is already gone: only a sound dropped from the list is deleted.
  Future<void> _retire(
    String folder,
    String key,
    int version, {
    required bool replaced,
  }) async {
    try {
      if (_android) {
        await channels?.remove(key, version);
        await files.delete(fileFor(folder, key, version));
      } else if (!replaced) {
        await files.delete(fileFor(folder, key, version));
      }
    } catch (_) {}
  }

  Future<String?> _folder() async {
    try {
      return await files.folder();
    } catch (_) {
      return null;
    }
  }

  Future<bool> _exists(String path) async {
    try {
      return await files.exists(path);
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, int>> _readIndex() async {
    try {
      return await files.readIndex();
    } catch (_) {
      return {};
    }
  }

  static List<String> _sorted(Set<String> tags) => tags.toList()..sort();
}

/// A WAV file's own header ("RIFF....WAVE"), checked before it is kept.
bool isWav(List<int> bytes) {
  if (bytes.length < 44) return false;
  return String.fromCharCodes(bytes.sublist(0, 4)) == 'RIFF' &&
      String.fromCharCodes(bytes.sublist(8, 12)) == 'WAVE';
}

// ---------------------------------------------------------------- the phone

/// The real folder, files and index.
class DeviceSoundFiles implements SoundFiles {
  static const _indexKey = 'notifications.sounds.downloaded';

  @override
  Future<String?> folder() async {
    if (kIsWeb) return null;
    final Directory base;
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      // iOS looks for a push's sound in <app container>/Library/Sounds.
      base = Directory('${(await getLibraryDirectory()).path}/Sounds');
    } else {
      // filesDir/notification_sounds, which NotificationSoundProvider shares.
      base = Directory(
        '${(await getApplicationSupportDirectory()).path}/notification_sounds',
      );
    }
    await base.create(recursive: true);
    return base.path;
  }

  @override
  Future<bool> exists(String path) => File(path).exists();

  @override
  Future<void> write(String path, List<int> bytes) async {
    final part = File('$path.part');
    await part.writeAsBytes(bytes, flush: true);
    await part.rename(path);
  }

  @override
  Future<void> delete(String path) async {
    final file = File(path);
    if (await file.exists()) await file.delete();
  }

  @override
  Future<List<int>?> asset(String name) async {
    try {
      final data = await rootBundle.load(name);
      return data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<Map<String, int>> readIndex() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_indexKey);
    if (raw == null) return {};
    final decoded = jsonDecode(raw);
    if (decoded is! Map) return {};
    return {
      for (final entry in decoded.entries)
        if (entry.value is int) '${entry.key}': entry.value as int,
    };
  }

  @override
  Future<void> writeIndex(Map<String, int> index) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_indexKey, jsonEncode(index));
  }
}

/// Android channels through flutter_local_notifications; a downloaded file's
/// content:// URI comes from MainActivity (NotificationSoundProvider).
class DeviceSoundChannels implements SoundChannels {
  DeviceSoundChannels(this._plugin);

  final FlutterLocalNotificationsPlugin _plugin;
  static const _native = MethodChannel('sowaka/notification_sounds');

  AndroidFlutterLocalNotificationsPlugin? get _android => _plugin
      .resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin
      >();

  AndroidNotificationChannel _channel(
    String key,
    int version,
    String name,
    AndroidNotificationSound sound,
  ) => AndroidNotificationChannel(
    soundChannelId(key, version),
    'Sowaka · $name',
    description: 'Notifications that play the $name sound',
    importance: Importance.high,
    playSound: true,
    sound: sound,
  );

  @override
  Future<void> ensureBuiltIn(String key, int version, String name) async {
    await _android?.createNotificationChannel(
      _channel(key, version, name, RawResourceAndroidNotificationSound(key)),
    );
  }

  @override
  Future<void> ensureFile(
    String key,
    int version,
    String name,
    String path,
  ) async {
    // Asked every start: it also renews the system's read grant on the file.
    final uri = await _native.invokeMethod<String>('contentUri', {
      'path': path,
    });
    if (uri == null) throw StateError('No content URI for $path');
    await _android?.createNotificationChannel(
      _channel(key, version, name, UriAndroidNotificationSound(uri)),
    );
  }

  @override
  Future<void> remove(String key, int version) async {
    await _android?.deleteNotificationChannel(
      channelId: soundChannelId(key, version),
    );
  }
}
