// What a face setup and a daily check send, measured: a slow connection
// (about 40 KB/s on the phone that could not finish setup, 12 Nov) must carry
// a setup well inside its limit. The frames are a real photo, framed as a
// selfie camera's 720 × 1280 frame with a face a third of its width, with
// camera-like noise added (noise is what makes a JPEG large). Each burst is
// cut by the app's own functions and sent through the app's own request,
// whose body is weighed; the old sizes (800 px photos at quality 90, 160 px
// crops at 90, and 24 crops at setup) are weighed the same way.
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image/image.dart' as img;
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/face_id/face_camera.dart';
import 'package:mobile_app/features/face_id/face_spoof_check.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/services/api_client.dart';

/// The source photo's face (forehead to chin, ear to ear) and the part of it
/// that becomes the frame.
const _sourceFace = Rect.fromLTWH(390, 140, 115, 125);
const _sourceFrame = Rect.fromLTWH(285, 0, 327, 582);
const _frameW = 720;
const _frameH = 1280;

/// The face box in the frame.
final Rect _face = Rect.fromLTWH(
  (_sourceFace.left - _sourceFrame.left) * _frameW / _sourceFrame.width,
  (_sourceFace.top - _sourceFrame.top) * _frameH / _sourceFrame.height,
  _sourceFace.width * _frameW / _sourceFrame.width,
  _sourceFace.height * _frameH / _sourceFrame.height,
);

img.Image _base() {
  final photo = img.decodeJpg(File('assets/care/pose_anxious.jpg').readAsBytesSync())!;
  final part = img.copyCrop(
    photo,
    x: _sourceFrame.left.round(),
    y: _sourceFrame.top.round(),
    width: _sourceFrame.width.round(),
    height: _sourceFrame.height.round(),
  );
  return img.copyResize(part, width: _frameW, height: _frameH, interpolation: img.Interpolation.linear);
}

/// [base] with a camera's grain, different each frame.
img.Image _noisy(img.Image base, int seed) {
  final random = Random(seed);
  final out = img.Image.from(base);
  for (final p in out) {
    final n = random.nextInt(13) - 6;
    p
      ..r = (p.r + n).clamp(0, 255)
      ..g = (p.g + n).clamp(0, 255)
      ..b = (p.b + n).clamp(0, 255);
  }
  return out;
}

FaceFrame _frameOf(img.Image picture) {
  final bytes = Uint8List(picture.width * picture.height * 4);
  var i = 0;
  for (final p in picture) {
    bytes[i++] = p.b.toInt();
    bytes[i++] = p.g.toInt();
    bytes[i++] = p.r.toInt();
    bytes[i++] = 255;
  }
  return FaceFrame(bytes: bytes, width: picture.width, height: picture.height, stride: picture.width * 4, bgra: true, rotation: 0);
}

/// The selfie before November: framed as now, up to 800 px, quality 90.
Uint8List _oldSelfie(Uint8List jpeg, Rect face) {
  final picture = img.decodeJpg(jpeg)!;
  final side = max(face.width, face.height) * 2.0;
  final left = (face.center.dx - side / 2).clamp(0.0, picture.width - side);
  final top = (face.center.dy + face.height * 0.08 - side / 2).clamp(0.0, picture.height - side);
  var cropped = img.copyCrop(picture, x: left.round(), y: top.round(), width: side.round(), height: side.round());
  if (cropped.width > 800) cropped = img.copyResize(cropped, width: 800, height: 800);
  return Uint8List.fromList(img.encodeJpg(cropped, quality: 90));
}

/// One burst of [FaceSpoofCheck.samples] frames: the selfie and the crops,
/// as sent now and as sent before.
({FaceBurst now, Uint8List oldPhoto, List<Uint8List> oldCrops}) _burst(img.Image base, int seed) {
  final now = <Uint8List>[];
  final old = <Uint8List>[];
  late img.Image last;
  for (var i = 0; i < FaceSpoofCheck.samples; i++) {
    last = _noisy(base, seed * 100 + i);
    final crops = spoofCropsJob((_frameOf(last), _face))!;
    now.add(crops.sent);
    old.add(crops.read); // 160 px at 90: what was sent before
  }
  final frameJpeg = Uint8List.fromList(img.encodeJpg(last, quality: 88));
  return (
    now: FaceBurst(photo: cropToFace(frameJpeg, _face)!, crops: now, report: 'captured front med0.95'),
    oldPhoto: _oldSelfie(frameJpeg, _face),
    oldCrops: old,
  );
}

Future<int> _weigh(http.MultipartRequest request) async => (await request.finalize().toBytes()).length;

http.MultipartRequest _oldRequest(String path, List<Uint8List> photos, List<List<Uint8List>> crops) {
  final request = http.MultipartRequest('POST', Uri.parse('https://example.test$path'))
    ..headers['Authorization'] = 'Bearer t'
    ..fields['challengeId'] = 'ch-1'
    ..fields['challenge'] = 'captured front med0.95';
  for (final (i, photo) in photos.indexed) {
    final name = i == 0 ? 'photo' : 'photo${i + 1}';
    request.files.add(http.MultipartFile.fromBytes(name, photo, filename: '$name.jpg'));
  }
  for (final (b, burst) in crops.indexed) {
    for (final (i, crop) in burst.indexed) {
      request.files.add(http.MultipartFile.fromBytes('crop${b * 8 + i}', crop, filename: 'crop${b * 8 + i}.jpg'));
    }
  }
  return request;
}

AuthSession _session() => AuthSession(
  token: 't',
  user: AuthUser.fromJson({'id': 'u1', 'email': 'a@sowaka.test', 'name': 'A', 'company': 'Sowaka', 'org': 'sowaka'}),
);

void main() {
  test('a setup sends under 250 KB and a check under 80 KB, a fraction of before', () async {
    final base = _base();
    final front = _burst(base, 1);
    // The turned photos: the face mirrored (it sits near the middle), and
    // the front again with other grain.
    final turnA = _burst(img.flipHorizontal(img.Image.from(base)), 2);
    final turnB = _burst(base, 3);

    final sent = <String, int>{};
    final progress = <double>[];
    final api = ManagerApiService(
      session: _session(),
      baseUrl: 'https://example.test',
      client: MockClient((request) async {
        sent[request.url.path] = request.bodyBytes.length;
        return http.Response('{"success":true,"passed":true,"reason":"matched","token":"tok"}', 200);
      }),
    );
    await api.enrolFace(
      front: front.now,
      turned: [turnA.now, turnB.now],
      consentVersion: 'v4',
      challengeId: 'ch-1',
      onProgress: progress.add,
    );
    await api.verifyFace(burst: front.now, challengeId: 'ch-2');
    final enrol = sent['/face/enrol']!;
    final verify = sent['/face/verify']!;

    final oldEnrol = await _weigh(_oldRequest(
      '/face/enrol',
      [front.oldPhoto, turnA.oldPhoto, turnB.oldPhoto],
      [front.oldCrops, turnA.oldCrops, turnB.oldCrops],
    ));
    final oldVerify = await _weigh(_oldRequest('/face/verify', [front.oldPhoto], [front.oldCrops]));

    final photo = img.decodeJpg(front.now.photo)!;
    final crop = img.decodeJpg(front.now.crops.first)!;
    // ignore: avoid_print
    print(
      'face upload sizes (face ${_face.width.round()} px wide in a $_frameW×$_frameH frame):\n'
      '  selfie ${front.oldPhoto.length} B -> ${front.now.photo.length} B (${photo.width}×${photo.height})\n'
      '  crop ${front.oldCrops.first.length} B -> ${front.now.crops.first.length} B (${crop.width}×${crop.height})\n'
      '  setup ${oldEnrol ~/ 1024} KB (3 photos, 24 crops) -> ${enrol ~/ 1024} KB (3 photos, 8 crops)\n'
      '  check ${oldVerify ~/ 1024} KB -> ${verify ~/ 1024} KB',
    );

    expect(photo.width, lessThanOrEqualTo(selfieSide));
    expect((crop.width, crop.height), (FaceSpoofCheck.sentSide, FaceSpoofCheck.sentSide));
    expect(enrol, lessThan(250 * 1024));
    expect(verify, lessThan(80 * 1024));
    expect(enrol, lessThan(oldEnrol ~/ 2));
    expect(progress.first, 0);
    expect(progress.last, 1);
  });

  test('a large camera photo that could not be framed is brought down all the same', () {
    final big = Uint8List.fromList(img.encodeJpg(img.Image(width: 3024, height: 4032)));
    final fitted = img.decodeJpg(fitSelfie(big))!;
    expect((fitted.width, fitted.height), (360, 480));
  });

  group('no answer from the server', () {
    ManagerApiService api(Future<http.Response> Function(http.Request) reply) =>
        ManagerApiService(session: _session(), baseUrl: 'https://example.test', client: MockClient(reply));
    final burst = FaceBurst(photo: Uint8List.fromList([0xff, 0xd8, 0xff]), crops: [Uint8List.fromList([0xff, 0xd8, 0xff])]);
    String? reasonOf(Object error) => ((error as ManagerApiException).details?['face'] as Map?)?['reason'] as String?;

    test('a dropped connection is a slow connection, not the face service', () async {
      final dropping = api((_) async => throw http.ClientException('Connection reset by peer'));
      Object? enrolError;
      Object? verifyError;
      try {
        await dropping.enrolFace(front: burst, consentVersion: 'v4');
      } catch (error) {
        enrolError = error;
      }
      try {
        await dropping.verifyFace(burst: burst);
      } catch (error) {
        verifyError = error;
      }
      expect(reasonOf(enrolError!), 'slow_connection');
      expect(reasonOf(verifyError!), 'slow_connection');
      expect((enrolError as ManagerApiException).message, contains('Wi-Fi'));
    });

    test('a 503 from the server is still the face service unavailable', () async {
      final down = api((_) async => http.Response(
        '{"success":false,"message":"Face check isn\'t available right now.","details":{"face":{"reason":"unavailable","fallback":true}}}',
        503,
      ));
      Object? error;
      try {
        await down.verifyFace(burst: burst);
      } catch (e) {
        error = e;
      }
      expect(reasonOf(error!), 'unavailable');
      expect((error as ManagerApiException).statusCode, 503);
    });

    test('the limits: a minute or two for setup, less for a check', () {
      expect(ManagerApiService.enrolLimit, const Duration(seconds: 120));
      expect(ManagerApiService.verifyLimit, const Duration(seconds: 45));
      // The shared client's own limit is an upload's for a setup with progress.
      final setup = ProgressRequest(http.MultipartRequest('POST', Uri.parse('https://example.test/face/enrol')), (_) {});
      expect(TimedClient.limitFor(setup), TimedClient.upload);
    });
  });
}
