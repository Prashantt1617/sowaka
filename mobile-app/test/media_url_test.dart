// Pictures of ours are asked for at the width they are drawn, from the
// server's copies, and decoded at it; anyone else's URL is left alone.
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/services/api_config.dart';

void main() {
  const key = '/media/connect%2Fposts%2Fu%2F2026%2F10%2Fabc-IMG.jpg';
  final base = ApiConfig.baseUrl;

  test('a picture of ours asks for its width, its key left as it was', () {
    expect(resolveMediaUrl(key, width: 1080), '$base$key?w=1080');
    expect(resolveMediaUrl('$base$key', width: 256), '$base$key?w=256');
    expect(resolveMediaUrl('$key?w=256', width: 1080), '$base$key?w=1080');
    expect(resolveMediaUrl('$key?w=256', original: true), '$base$key?original=1');
  });

  test('without a width it is only made whole', () {
    expect(resolveMediaUrl(key), '$base$key');
    expect(resolveMediaUrl('$key?w=256'), '$base$key?w=256');
  });

  test('anyone else\'s picture is untouched', () {
    const other = 'https://images.example.com/cat.jpg?size=big';
    expect(resolveMediaUrl(other, width: 256), other);
    expect(resolveMediaUrl(other, original: true), other);
  });

  test('a feed picture is fetched and decoded at 1080; a face keeps its 256', () {
    final picture = mediaImageProvider(key, width: feedImageWidth) as ResizeImage;
    expect(picture.width, 1080);
    expect((picture.imageProvider as dynamic).url, '$base$key?w=1080');
    final face = mediaImageProvider('$key?w=256', width: feedImageWidth) as ResizeImage;
    expect(face.width, 256);
    expect((face.imageProvider as dynamic).url, '$base$key?w=256');
    final avatar = avatarImageProvider(key) as ResizeImage;
    expect(avatar.width, 256);
    expect(avatar.allowUpscaling, isFalse);
  });

  test('the same picture is the same image, so it is fetched and decoded once', () {
    expect(mediaImageProvider(key, width: feedImageWidth), mediaImageProvider(key, width: feedImageWidth));
  });
}
