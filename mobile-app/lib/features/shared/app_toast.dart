import 'package:flutter/material.dart';

import '../support/support_launcher.dart';

/// The app's own toast.
///
/// Material's default is a grey slab pinned to the very bottom edge in the
/// system font — next to these screens it reads as somebody else's app. This
/// is the same ink, radius and type as the cards, floating clear of the tab
/// bar so it never covers what it is talking about.
void showAppToast(BuildContext context, String message) {
  // A message that sends the person to HR or support carries the way there.
  final toDesk = canRaiseSupportTicket && mentionsHrOrSupport(message);
  final messenger = ScaffoldMessenger.maybeOf(context);
  if (messenger == null) return;
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(
          message,
          style: const TextStyle(
            fontFamily: 'Sora',
            color: Colors.white,
            fontSize: 13.5,
            height: 20 / 13.5,
            fontWeight: FontWeight.w500,
          ),
        ),
        backgroundColor: const Color(0xFF1A1A2E),
        behavior: SnackBarBehavior.floating,
        elevation: 6,
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        duration: Duration(seconds: toDesk ? 6 : 3),
        action: toDesk
            ? SnackBarAction(
                label: 'Raise ticket',
                textColor: const Color(0xFF7CC4F2),
                onPressed: () => raiseSupportTicket(about: message),
              )
            : null,
      ),
    );
}
