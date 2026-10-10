import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../shared/app_toast.dart';
import '../../shared/image_source_sheet.dart';
import '../data/support_api_service.dart';
import '../data/support_models.dart';

/// Images and PDFs, from the camera, the gallery or Files ("Browse files").
const supportFileExtensions = ['jpg', 'jpeg', 'png', 'heic', 'pdf'];

/// Asks for files to go with a message, keeping to the server's limits: at
/// most [SupportApiService.maxFiles] on one message counting
/// [alreadyChosen], each under 10 MB. Anything over is left out, and said so.
Future<List<SupportUpload>> pickSupportFiles(
  BuildContext context, {
  int alreadyChosen = 0,
}) async {
  final room = SupportApiService.maxFiles - alreadyChosen;
  if (room <= 0) {
    showAppToast(
      context,
      'You can add up to ${SupportApiService.maxFiles} files to one message.',
    );
    return const [];
  }
  final picked = await pickImagesFrom(
    context,
    allowedExtensions: supportFileExtensions,
  );
  if (picked.isEmpty) return const [];
  final fitting = [
    for (final file in picked)
      if (file.size <= SupportApiService.maxFileBytes)
        SupportUpload(name: file.name, size: file.size, path: file.path),
  ];
  final tooBig = picked.length - fitting.length;
  final kept = fitting.take(room).toList();
  if (context.mounted) {
    if (tooBig > 0) {
      showAppToast(
        context,
        tooBig == 1
            ? 'That file is over 10 MB, so it was left out.'
            : '$tooBig files are over 10 MB, so they were left out.',
      );
    } else if (fitting.length > room) {
      showAppToast(
        context,
        'You can add up to ${SupportApiService.maxFiles} files to one message.',
      );
    }
  }
  return kept;
}

/// Opens a file from the thread in the browser or viewer; the link is
/// signed and short-lived, so it is used as soon as it is tapped.
Future<void> openSupportAttachment(
  BuildContext context,
  SupportAttachment attachment,
) async {
  final uri = Uri.tryParse(attachment.url);
  var opened = false;
  if (uri != null && attachment.url.isNotEmpty) {
    try {
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      opened = false;
    }
  }
  if (!opened && context.mounted) {
    showAppToast(context, 'Could not open ${attachment.name}.');
  }
}

/// A file waiting to be sent, with a way to take it off again.
class SupportFileRow extends StatelessWidget {
  const SupportFileRow({super.key, required this.file, required this.onRemove});

  final SupportUpload file;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 36,
      padding: const EdgeInsets.only(left: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F7F9),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          SvgPicture.asset(
            'assets/icons/document_file.svg',
            width: 16,
            height: 16,
            colorFilter: const ColorFilter.mode(
              Color(0xFF6B7280),
              BlendMode.srcIn,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              file.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontFamily: 'Sora',
                color: Color(0xFF111827),
                fontSize: 12,
                height: 16 / 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          IconButton(
            tooltip: 'Remove',
            onPressed: onRemove,
            visualDensity: VisualDensity.compact,
            icon: const Icon(
              Icons.close_rounded,
              size: 16,
              color: Color(0xFF6B7280),
            ),
          ),
        ],
      ),
    );
  }
}

/// The dashed outline of the upload box (node 2896:32536).
class SupportDashedBorderPainter extends CustomPainter {
  const SupportDashedBorderPainter({required this.color, required this.radius});

  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..addRRect(
        RRect.fromRectAndRadius(
          (Offset.zero & size).deflate(.5),
          Radius.circular(radius),
        ),
      );
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    for (final metric in path.computeMetrics()) {
      for (double distance = 0; distance < metric.length; distance += 6) {
        canvas.drawPath(metric.extractPath(distance, distance + 3), paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant SupportDashedBorderPainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.radius != radius;
}
