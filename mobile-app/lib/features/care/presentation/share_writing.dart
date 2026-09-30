import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../shared/app_toast.dart';
import 'care_theme.dart';

/// Sends a piece of writing on, the way a photo is shared: WhatsApp, email,
/// or the clipboard. Nothing is sent anywhere until the person picks one.
Future<void> showShareWritingSheet(
  BuildContext context, {
  required String title,
  required String text,
}) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: CareColors.bg,
    showDragHandle: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (sheet) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const CareSectionTitle('Share this'),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: CareColors.line),
              ),
              child: Text(
                text,
                maxLines: 4,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: careFont,
                  color: CareColors.muted,
                  fontSize: 13.5,
                  height: 1.4,
                ),
              ),
            ),
            const SizedBox(height: 14),
            _SheetButton(
              icon: Icons.chat_rounded,
              label: 'WhatsApp',
              onTap: () async {
                Navigator.pop(sheet);
                final message = Uri.encodeComponent('$title\n\n$text');
                if (!await _open('whatsapp://send?text=$message') &&
                    !await _open('https://wa.me/?text=$message')) {
                  if (context.mounted)
                    showAppToast(context, 'WhatsApp is not available here');
                }
              },
            ),
            const SizedBox(height: 10),
            _SheetButton(
              icon: Icons.mail_outline_rounded,
              label: 'Email',
              onTap: () async {
                Navigator.pop(sheet);
                final mail = Uri(
                  scheme: 'mailto',
                  queryParameters: {'subject': title, 'body': text},
                );
                if (!await launchUrl(mail) && context.mounted)
                  showAppToast(context, 'No mail app is set up here');
              },
            ),
            const SizedBox(height: 10),
            _SheetButton(
              icon: Icons.copy_rounded,
              label: 'Copy',
              quiet: true,
              onTap: () async {
                Navigator.pop(sheet);
                await Clipboard.setData(ClipboardData(text: '$title\n\n$text'));
                if (context.mounted) showAppToast(context, 'Copied');
              },
            ),
          ],
        ),
      ),
    ),
  );
}

Future<bool> _open(String url) async {
  try {
    return await launchUrl(
      Uri.parse(url),
      mode: LaunchMode.externalApplication,
    );
  } catch (_) {
    return false;
  }
}

class _SheetButton extends StatelessWidget {
  const _SheetButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.quiet = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool quiet;

  @override
  Widget build(BuildContext context) => Material(
    color: quiet ? Colors.white : CareColors.blue,
    borderRadius: BorderRadius.circular(14),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        height: 48,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          border: quiet ? Border.all(color: CareColors.line) : null,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 18, color: quiet ? CareColors.ink : Colors.white),
            const SizedBox(width: 8),
            Text(
              label,
              style: TextStyle(
                fontFamily: careFont,
                color: quiet ? CareColors.ink : Colors.white,
                fontSize: 14,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// A small "share" action for a card of writing.
class ShareLink extends StatelessWidget {
  const ShareLink({super.key, required this.title, required this.text});

  final String title;
  final String text;

  @override
  Widget build(BuildContext context) => CareLink(
    'Share',
    icon: Icons.ios_share_rounded,
    size: 12.5,
    onTap: () => showShareWritingSheet(context, title: title, text: text),
  );
}
