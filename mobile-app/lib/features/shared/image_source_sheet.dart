/// Where a photo comes from, asked once before any picker opens.
///
/// The app used to reach straight for the file browser, which on a phone means
/// digging through Files for something the camera roll already has — or not
/// being able to take the photo at all. This offers the camera and the gallery
/// alongside it.
///
/// On desktop there is no camera and `image_picker`'s gallery is the same file
/// dialog Files already opens, so the sheet is skipped entirely there and the
/// caller's file picker runs unchanged.
library;

import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:image_picker/image_picker.dart';
import '../shared/app_toast.dart';

/// A picked image, in the shape `file_picker` already hands back, so call
/// sites keep reading `.path`, `.name`, `.size` and `.extension` as before.
class PickedImage {
  const PickedImage({
    required this.path,
    required this.name,
    required this.size,
    required this.extension,
  });

  final String path;
  final String name;
  final int size;
  final String? extension;
}

/// True where the camera and the photo library are separate things worth
/// offering. Everywhere else the file dialog is the only real option.
bool get _hasNativeGallery =>
    !kIsWeb && (Platform.isIOS || Platform.isAndroid);

/// Asks where the photo should come from, then returns the chosen file.
///
/// [allowedExtensions] applies to the Files branch only — the camera and the
/// gallery hand back their own formats, which are images by construction.
/// Returns null when the person backs out at any step.
Future<PickedImage?> pickImageFrom(
  BuildContext context, {
  List<String> allowedExtensions = const ['jpg', 'jpeg', 'png'],
}) async {
  if (!_hasNativeGallery) {
    return _pickFromFiles(allowedExtensions);
  }

  final source = await _askSource(context);
  if (source == null) return null;
  if (source == _ImageSource.files) return _pickFromFiles(allowedExtensions);

  try {
    final picked = await ImagePicker().pickImage(
      source: source == _ImageSource.camera
          ? ImageSource.camera
          : ImageSource.gallery,
      // Big enough for any surface the app shows a photo on, and small enough
      // that a 12-megapixel phone capture does not become a 6 MB upload.
      maxWidth: 2048,
      maxHeight: 2048,
      imageQuality: 90,
    );
    if (picked == null) return null;
    return PickedImage(
      path: picked.path,
      name: picked.name,
      size: await File(picked.path).length(),
      extension: picked.name.contains('.')
          ? picked.name.split('.').last.toLowerCase()
          : 'jpg',
    );
  } on PlatformException catch (error) {
    // A denied camera or photo permission arrives here rather than as a crash.
    if (context.mounted) {
      showAppToast(
        context,
        error.code == 'camera_access_denied' || error.code == 'photo_access_denied'
            ? 'Sowaka needs permission for that. Turn it on in Settings.'
            : 'Could not open that. Try another option.',
      );
    }
    return null;
  }
}

/// The same choice, for a surface that accepts several files at once.
///
/// The camera returns the one shot it just took; the gallery and the file
/// browser both allow a multi-selection.
Future<List<PickedImage>> pickImagesFrom(
  BuildContext context, {
  List<String> allowedExtensions = const ['jpg', 'jpeg', 'png'],
}) async {
  if (!_hasNativeGallery) {
    return _pickManyFromFiles(allowedExtensions);
  }

  final source = await _askSource(context);
  if (source == null) return const [];
  if (source == _ImageSource.files) return _pickManyFromFiles(allowedExtensions);

  try {
    final picker = ImagePicker();
    final picked = source == _ImageSource.camera
        ? [
            ?await picker.pickImage(
              source: ImageSource.camera,
              maxWidth: 2048,
              maxHeight: 2048,
              imageQuality: 90,
            ),
          ]
        : await picker.pickMultiImage(
            maxWidth: 2048,
            maxHeight: 2048,
            imageQuality: 90,
          );
    return [
      for (final file in picked)
        PickedImage(
          path: file.path,
          name: file.name,
          size: await File(file.path).length(),
          extension: file.name.contains('.')
              ? file.name.split('.').last.toLowerCase()
              : 'jpg',
        ),
    ];
  } on PlatformException {
    if (context.mounted) {
      showAppToast(context, 'Sowaka needs permission for that. Turn it on in Settings.');
    }
    return const [];
  }
}

Future<List<PickedImage>> _pickManyFromFiles(
  List<String> allowedExtensions,
) async {
  final result = await FilePicker.pickFiles(
    type: FileType.custom,
    allowedExtensions: allowedExtensions,
    withData: false,
    allowMultiple: true,
  );
  return [
    for (final file in result?.files ?? const <PlatformFile>[])
      if (file.path case final path? when path.isNotEmpty)
        PickedImage(
          path: path,
          name: file.name,
          size: file.size,
          extension: file.extension,
        ),
  ];
}

Future<PickedImage?> _pickFromFiles(List<String> allowedExtensions) async {
  final result = await FilePicker.pickFiles(
    type: FileType.custom,
    allowedExtensions: allowedExtensions,
    withData: false,
  );
  final file = result?.files.single;
  final path = file?.path;
  if (file == null || path == null || path.isEmpty) return null;
  return PickedImage(
    path: path,
    name: file.name,
    size: file.size,
    extension: file.extension,
  );
}

enum _ImageSource { camera, gallery, files }

Future<_ImageSource?> _askSource(BuildContext context) {
  return showModalBottomSheet<_ImageSource>(
    context: context,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (sheetContext) => SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 12),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: const Color(0xFFE5E7EB),
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          const SizedBox(height: 18),
          _SourceTile(
            icon: Icons.photo_camera_rounded,
            label: 'Take a photo',
            onTap: () => Navigator.pop(sheetContext, _ImageSource.camera),
          ),
          _SourceTile(
            icon: Icons.photo_library_rounded,
            label: 'Choose from gallery',
            onTap: () => Navigator.pop(sheetContext, _ImageSource.gallery),
          ),
          _SourceTile(
            icon: Icons.folder_outlined,
            label: 'Browse files',
            onTap: () => Navigator.pop(sheetContext, _ImageSource.files),
          ),
          const SizedBox(height: 12),
        ],
      ),
    ),
  );
}

class _SourceTile extends StatelessWidget {
  const _SourceTile({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 15),
        child: Row(
          children: [
            Icon(icon, size: 21, color: const Color(0xFF0571A6)),
            const SizedBox(width: 15),
            Text(
              label,
              style: const TextStyle(
                color: Color(0xFF1A1C1E),
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
