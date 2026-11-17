import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/services/notification_service.dart';
import 'package:mobile_app/services/notification_sounds.dart';

/// A WAV header and a little silence.
List<int> wavBytes([int samples = 100]) {
  final data = samples * 2;
  final out = BytesBuilder();
  void u32(int v) => out.add([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255]);
  void u16(int v) => out.add([v & 255, (v >> 8) & 255]);
  out.add(ascii.encode('RIFF'));
  u32(36 + data);
  out.add(ascii.encode('WAVEfmt '));
  u32(16);
  u16(1);
  u16(1);
  u32(22050);
  u32(44100);
  u16(2);
  u16(16);
  out.add(ascii.encode('data'));
  u32(data);
  out.add(List.filled(data, 0));
  return out.toBytes();
}

class FakeFiles implements SoundFiles {
  final files = <String, List<int>>{};
  Map<String, int> index = {};
  final assets = <String, List<int>>{
    for (final key in builtInNotificationSounds.keys)
      'assets/notification_sounds/$key.caf': [1, 2, 3],
  };
  int writes = 0;

  @override
  Future<String?> folder() async => '/sounds';
  @override
  Future<bool> exists(String path) async => files.containsKey(path);
  @override
  Future<void> write(String path, List<int> bytes) async {
    writes += 1;
    files[path] = bytes;
  }

  @override
  Future<void> delete(String path) async => files.remove(path);
  @override
  Future<List<int>?> asset(String name) async => assets[name];
  @override
  Future<Map<String, int>> readIndex() async => Map.of(index);
  @override
  Future<void> writeIndex(Map<String, int> next) async => index = Map.of(next);
}

class FakeChannels implements SoundChannels {
  final builtIn = <String>{};
  final fromFile = <String, String>{};
  final removed = <String>[];

  @override
  Future<void> ensureBuiltIn(String key, int version, String name) async =>
      builtIn.add(soundChannelId(key, version));
  @override
  Future<void> ensureFile(String key, int version, String name, String path) async =>
      fromFile[soundChannelId(key, version)] = path;
  @override
  Future<void> remove(String key, int version) async {
    final id = soundChannelId(key, version);
    removed.add(id);
    fromFile.remove(id);
  }
}

/// The server: a list of sounds, and their files.
class FakeServer {
  List<Map<String, Object?>> sounds = [];
  int manifestStatus = 200;
  final served = <String, List<int>>{};
  final asked = <String>[];

  MockClient get client => MockClient((request) async {
        asked.add(request.url.path);
        if (request.url.path == '/notifications/sounds') {
          if (request.headers['Authorization'] != 'Bearer tok') return http.Response('{}', 401);
          return http.Response(jsonEncode({'success': true, 'sounds': sounds}), manifestStatus);
        }
        final bytes = served[request.url.path];
        return bytes == null ? http.Response('nope', 404) : http.Response.bytes(bytes, 200);
      });
}

const builtInRows = [
  {'key': 'chime', 'name': 'Chime', 'url': null, 'version': 1, 'builtIn': true},
  {'key': 'pop', 'name': 'Pop', 'url': null, 'version': 1, 'builtIn': true},
];

void main() {
  late FakeFiles files;
  late FakeChannels channels;
  late FakeServer server;
  NotificationSoundSync sync(TargetPlatform platform) => NotificationSoundSync(
        client: server.client,
        files: files,
        channels: channels,
        platform: platform,
        baseUrl: 'https://api.test',
      );

  setUp(() {
    files = FakeFiles();
    channels = FakeChannels();
    server = FakeServer();
  });

  group('Android', () {
    test('every built-in sound is a res/raw channel, reported at version 1', () async {
      final tags = await sync(TargetPlatform.android).sync(token: 'tok');
      expect(channels.builtIn, {for (final key in builtInNotificationSounds.keys) 'snd_${key}_v1'});
      expect(tags, [for (final key in builtInNotificationSounds.keys) '$key@1']..sort());
      expect(files.files, isEmpty, reason: 'built-ins are not copied on Android');
    });

    test('downloads each new sound into its own versioned file and channel', () async {
      server.sounds = [
        ...builtInRows,
        {'key': 'diwali_drum', 'name': 'Diwali drum', 'url': '/notifications/sounds/file/d1', 'version': 1},
        {'key': 'chime', 'name': 'Our chime', 'url': '/notifications/sounds/file/c2', 'version': 2},
      ];
      server.served['/notifications/sounds/file/d1'] = wavBytes();
      server.served['/notifications/sounds/file/c2'] = wavBytes(50);
      final tags = await sync(TargetPlatform.android).sync(token: 'tok');
      expect(files.files.keys, containsAll(['/sounds/diwali_drum_v1.wav', '/sounds/chime_v2.wav']));
      expect(channels.fromFile, {
        'snd_diwali_drum_v1': '/sounds/diwali_drum_v1.wav',
        'snd_chime_v2': '/sounds/chime_v2.wav',
      });
      expect(tags, containsAll(['diwali_drum@1', 'chime@2', 'chime@1']));
      expect(files.index, {'diwali_drum': 1, 'chime': 2});

      // The next start downloads nothing again.
      server.asked.clear();
      files.writes = 0;
      final again = await sync(TargetPlatform.android).sync(token: 'tok');
      expect(server.asked, ['/notifications/sounds']);
      expect(files.writes, 0);
      expect(again, tags);
    });

    test('a new version replaces the old channel and file', () async {
      server.sounds = [
        {'key': 'drum', 'name': 'Drum', 'url': '/f/1', 'version': 1},
      ];
      server.served['/f/1'] = wavBytes();
      await sync(TargetPlatform.android).sync(token: 'tok');
      server.sounds = [
        {'key': 'drum', 'name': 'Drum', 'url': '/f/2', 'version': 2},
      ];
      server.served['/f/2'] = wavBytes(20);
      final tags = await sync(TargetPlatform.android).sync(token: 'tok');
      expect(tags, contains('drum@2'));
      expect(tags, isNot(contains('drum@1')));
      expect(channels.removed, ['snd_drum_v1']);
      expect(files.files.containsKey('/sounds/drum_v1.wav'), isFalse);
      expect(files.files.containsKey('/sounds/drum_v2.wav'), isTrue);
    });

    test('a sound dropped from the list goes, channel and file', () async {
      server.sounds = [
        {'key': 'drum', 'name': 'Drum', 'url': '/f/1', 'version': 1},
      ];
      server.served['/f/1'] = wavBytes();
      await sync(TargetPlatform.android).sync(token: 'tok');
      server.sounds = [...builtInRows];
      final tags = await sync(TargetPlatform.android).sync(token: 'tok');
      expect(tags, isNot(contains('drum@1')));
      expect(channels.removed, ['snd_drum_v1']);
      expect(files.files, isEmpty);
      expect(files.index, isEmpty);
    });

    test('offline: what was downloaded before still counts', () async {
      server.sounds = [
        {'key': 'drum', 'name': 'Drum', 'url': '/f/1', 'version': 1},
      ];
      server.served['/f/1'] = wavBytes();
      await sync(TargetPlatform.android).sync(token: 'tok');
      server.manifestStatus = 500;
      final tags = await sync(TargetPlatform.android).sync(token: 'tok');
      expect(tags, contains('drum@1'));
      expect(files.files.containsKey('/sounds/drum_v1.wav'), isTrue, reason: 'nothing is deleted when the list cannot be read');
    });

    test('a download that is not a WAV is not kept, and an older version stays', () async {
      server.sounds = [
        {'key': 'drum', 'name': 'Drum', 'url': '/f/1', 'version': 1},
      ];
      server.served['/f/1'] = wavBytes();
      await sync(TargetPlatform.android).sync(token: 'tok');
      server.sounds = [
        {'key': 'drum', 'name': 'Drum', 'url': '/f/2', 'version': 2},
      ];
      server.served['/f/2'] = utf8.encode('<html>a captive portal page, not a sound</html>');
      final tags = await sync(TargetPlatform.android).sync(token: 'tok');
      expect(tags, contains('drum@1'));
      expect(tags, isNot(contains('drum@2')));
      expect(files.files.containsKey('/sounds/drum_v2.wav'), isFalse);
      expect(files.index, {'drum': 1});
    });

    test('without a session it reads nothing from the server', () async {
      final tags = await sync(TargetPlatform.android).sync();
      expect(server.asked, isEmpty);
      expect(tags.length, builtInNotificationSounds.length);
    });
  });

  group('iOS', () {
    test('built-ins are copied into Library/Sounds as CAF, downloads kept as WAV', () async {
      server.sounds = [
        ...builtInRows,
        {'key': 'drum', 'name': 'Drum', 'url': 'https://cdn.test/drum.wav', 'version': 3},
      ];
      server.served['/drum.wav'] = wavBytes();
      final tags = await sync(TargetPlatform.iOS).sync(token: 'tok');
      for (final key in builtInNotificationSounds.keys) {
        expect(files.files['/sounds/$key.caf'], [1, 2, 3]);
      }
      expect(files.files.containsKey('/sounds/drum.wav'), isTrue);
      expect(tags, contains('drum@3'));
      expect(channels.builtIn, isEmpty);
      expect(channels.fromFile, isEmpty);
    });

    test('a built-in already copied is not copied again', () async {
      await sync(TargetPlatform.iOS).sync();
      final writes = files.writes;
      await sync(TargetPlatform.iOS).sync();
      expect(files.writes, writes);
    });

    test('a new version overwrites the same file and is not then deleted', () async {
      server.sounds = [
        {'key': 'drum', 'name': 'Drum', 'url': '/f/1', 'version': 1},
      ];
      server.served['/f/1'] = wavBytes();
      await sync(TargetPlatform.iOS).sync(token: 'tok');
      server.sounds = [
        {'key': 'drum', 'name': 'Drum', 'url': '/f/2', 'version': 2},
      ];
      server.served['/f/2'] = wavBytes(7);
      final tags = await sync(TargetPlatform.iOS).sync(token: 'tok');
      expect(tags, contains('drum@2'));
      expect(files.files['/sounds/drum.wav'], wavBytes(7));
    });
  });

  group('the list and the channels', () {
    test('a malformed row is skipped, not fatal', () {
      expect(NotificationSoundEntry.fromJson({'key': 'Bad Key', 'version': 1}), isNull);
      expect(NotificationSoundEntry.fromJson({'key': 'drum', 'version': 0}), isNull);
      expect(NotificationSoundEntry.fromJson('drum'), isNull);
      final ok = NotificationSoundEntry.fromJson({'key': 'drum', 'name': 'Drum', 'version': '2', 'url': '/f'});
      expect(ok?.version, 2);
      expect(ok?.builtIn, isFalse);
      expect(NotificationSoundEntry.fromJson({'key': 'chime', 'version': 1, 'url': null})?.builtIn, isTrue);
    });

    test('channel ids match the server', () {
      expect(soundChannelId('chime', 1), 'snd_chime_v1');
      expect(soundTag('diwali_drum', 3), 'diwali_drum@3');
    });

    test('a push in the foreground uses the server’s channel only if this phone made it', () {
      expect(foregroundChannelFor('snd_chime_v1', ['chime@1', 'pop@1']), 'snd_chime_v1');
      expect(foregroundChannelFor('snd_drum_v2', ['drum@1']), plainChannelId);
      expect(foregroundChannelFor(null, ['chime@1']), plainChannelId);
      expect(foregroundChannelFor(plainChannelId, const []), plainChannelId);
    });

    test('isWav reads the header', () {
      expect(isWav(wavBytes()), isTrue);
      expect(isWav(utf8.encode('RIFF....AVI LIST' * 4)), isFalse);
      expect(isWav([1, 2, 3]), isFalse);
    });
  });
}
