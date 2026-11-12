/// A file to go with a request — a leave note, a receipt, a payroll proof —
/// from the camera, the gallery or Files, as the feed's photos are chosen.
///
/// The servers behind these uploads take PDF, JPEG and PNG and check the
/// bytes, not the name, so a photo is always handed back as one of those:
/// JPEG and PNG as they are, anything else the phone gives (WebP, or a HEIC
/// the gallery did not convert) re-encoded as JPEG, and one over the size
/// limit shrunk until it fits.
library;

import 'dart:io';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;

import 'app_toast.dart';
import 'image_source_sheet.dart';

/// What a request attachment may be, unless a surface says otherwise.
const attachmentExtensions = ['pdf', 'jpg', 'jpeg', 'png'];

/// The servers' limit on one attachment.
const attachmentMaxBytes = 5 * 1024 * 1024;

const _photoExtensions = {'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'};

/// A chosen attachment, read into memory and ready to send.
class PickedAttachment {
  const PickedAttachment({required this.name, required this.bytes});

  final String name;
  final Uint8List bytes;

  int get size => bytes.length;

  /// The `file_picker` shape the request forms already keep.
  PlatformFile toPlatformFile() =>
      PlatformFile(name: name, size: size, bytes: bytes);
}

/// Asks where the attachment comes from — Take a photo, Choose from gallery,
/// and Choose file where [allowedExtensions] takes more than photos — then
/// returns it. On desktop, where there is no camera, Files opens straight
/// away. Null when the person backs out or the file cannot be used (which
/// is said in a toast).
Future<PickedAttachment?> pickAttachment(
  BuildContext context, {
  List<String> allowedExtensions = attachmentExtensions,
  int maxBytes = attachmentMaxBytes,
}) async {
  if (!hasNativeGallery) {
    return pickAttachmentFrom(
      context,
      ImageSourceChoice.files,
      allowedExtensions: allowedExtensions,
      maxBytes: maxBytes,
    );
  }
  final takesDocuments = allowedExtensions.any(
    (extension) => !_photoExtensions.contains(extension.toLowerCase()),
  );
  final source = await askImageSource(
    context,
    offerFiles: takesDocuments,
    filesLabel: 'Choose file',
  );
  if (source == null || !context.mounted) return null;
  return pickAttachmentFrom(
    context,
    source,
    allowedExtensions: allowedExtensions,
    maxBytes: maxBytes,
  );
}

/// The attachment from one [source], for surfaces that show their own
/// buttons instead of the sheet. Camera and gallery fall back to Files on
/// desktop.
Future<PickedAttachment?> pickAttachmentFrom(
  BuildContext context,
  ImageSourceChoice source, {
  List<String> allowedExtensions = attachmentExtensions,
  int maxBytes = attachmentMaxBytes,
}) async {
  if (source == ImageSourceChoice.files || !hasNativeGallery) {
    return _fromFiles(context, allowedExtensions, maxBytes);
  }
  final photo = await takeOrChoosePhoto(context, source);
  if (photo == null || !context.mounted) return null;
  final bytes = await photo.readAsBytes();
  if (!context.mounted) return null;
  final fitted = await _fit(bytes, maxBytes);
  if (!context.mounted) return null;
  if (fitted == null) {
    showAppToast(context, _unusablePhoto);
    return null;
  }
  return PickedAttachment(name: _photoName(fitted.$2), bytes: fitted.$1);
}

const _unusablePhoto =
    "That photo can't be attached. Take a new one, or choose a JPEG, PNG "
    'or PDF.';

Future<PickedAttachment?> _fromFiles(
  BuildContext context,
  List<String> allowedExtensions,
  int maxBytes,
) async {
  final PlatformFile file;
  try {
    final result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: allowedExtensions,
      // Bytes, not just a name: the file has to reach the server.
      withData: true,
    );
    if (result == null || result.files.isEmpty) return null;
    file = result.files.single;
  } catch (_) {
    if (context.mounted) {
      showAppToast(context, 'Could not open the file picker.');
    }
    return null;
  }
  var bytes = file.bytes;
  final path = file.path;
  if (bytes == null && path != null && path.isNotEmpty) {
    try {
      bytes = await File(path).readAsBytes();
    } catch (_) {
      bytes = null;
    }
  }
  if (!context.mounted) return null;
  if (bytes == null) {
    showAppToast(context, 'Could not read the selected file.');
    return null;
  }
  if (bytes.length <= maxBytes) {
    return PickedAttachment(name: file.name, bytes: bytes);
  }
  // A big photo from Files is shrunk as one from the gallery would be; any
  // other file over the limit has to be chosen again.
  final extension = (file.extension ?? '').toLowerCase();
  if (_photoExtensions.contains(extension)) {
    final fitted = await _fit(bytes, maxBytes);
    if (!context.mounted) return null;
    if (fitted != null) {
      final stem = file.name.contains('.')
          ? file.name.substring(0, file.name.lastIndexOf('.'))
          : file.name;
      return PickedAttachment(name: '$stem.${fitted.$2}', bytes: fitted.$1);
    }
  }
  showAppToast(
    context,
    'Choose a file smaller than ${maxBytes ~/ (1024 * 1024)} MB.',
  );
  return null;
}

/// [bytes] as they are when they are already a JPEG or PNG within
/// [maxBytes]; otherwise re-encoded off the UI thread. With the extension
/// that now fits them, or null when they cannot be made to.
Future<(Uint8List, String)?> _fit(Uint8List bytes, int maxBytes) async {
  final kind = photoKind(bytes);
  if (kind != null && bytes.length <= maxBytes) return (bytes, kind);
  final jpeg = await Isolate.run(() => fitPhotoAsJpeg(bytes, maxBytes));
  return jpeg == null ? null : (jpeg, 'jpg');
}

/// "jpg" or "png" for the two photo formats every upload server takes, by
/// their first bytes; null for anything else.
@visibleForTesting
String? photoKind(Uint8List bytes) {
  if (bytes.length >= 3 &&
      bytes[0] == 0xff &&
      bytes[1] == 0xd8 &&
      bytes[2] == 0xff) {
    return 'jpg';
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length) {
    for (var i = 0; i < png.length; i++) {
      if (bytes[i] != png[i]) return null;
    }
    return 'png';
  }
  return null;
}

/// [bytes] decoded and saved as a JPEG of at most [maxBytes], upright,
/// smaller each try; null when the format cannot be read here (HEIC, which
/// the camera and gallery already convert, is one).
@visibleForTesting
Uint8List? fitPhotoAsJpeg(Uint8List bytes, int maxBytes) {
  final decoded = img.decodeImage(bytes);
  if (decoded == null) return null;
  final upright = img.bakeOrientation(decoded);
  for (final (side, quality) in const [
    (2048, 85),
    (1600, 80),
    (1200, 75),
    (900, 70),
  ]) {
    final longest = upright.width > upright.height
        ? upright.width
        : upright.height;
    final sized = longest <= side
        ? upright
        : upright.width >= upright.height
        ? img.copyResize(upright, width: side)
        : img.copyResize(upright, height: side);
    final jpeg = img.encodeJpg(sized, quality: quality);
    if (jpeg.length <= maxBytes) return jpeg;
  }
  return null;
}

/// "photo-2026-11-12-1405.jpg": never the phone's own file name
/// ("image_picker_AE62…").
String _photoName(String extension) {
  final now = DateTime.now();
  String two(int n) => n.toString().padLeft(2, '0');
  return 'photo-${now.year}-${two(now.month)}-${two(now.day)}-'
      '${two(now.hour)}${two(now.minute)}.$extension';
}
