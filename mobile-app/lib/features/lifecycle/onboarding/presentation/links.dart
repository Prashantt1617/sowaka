import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart' show LaunchMode, launchUrl;

import '../../../shared/app_toast.dart';

/// "Add to calendar" / "Book 15 minutes": a calendar event to save, through
/// the phone's browser (no calendar permission, any calendar app).
Uri calendarEventUri({required String title, DateTime? start, DateTime? end, String? place, String? details}) {
  String stamp(DateTime time) {
    final utc = time.toUtc();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${utc.year}${two(utc.month)}${two(utc.day)}T${two(utc.hour)}${two(utc.minute)}00Z';
  }

  final from = start;
  final to = end ?? from?.add(const Duration(minutes: 30));
  return Uri.https('calendar.google.com', '/calendar/render', {
    'action': 'TEMPLATE',
    'text': title,
    if (from != null && to != null) 'dates': '${stamp(from)}/${stamp(to)}',
    if (place != null && place.isNotEmpty) 'location': place,
    if (details != null && details.isNotEmpty) 'details': details,
  });
}

/// Opens [link] outside the app; says so when it cannot.
Future<void> openExternalLink(BuildContext context, String link) async {
  final uri = Uri.tryParse(link.contains('://') ? link : 'https://$link');
  var opened = false;
  if (uri != null) {
    try {
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {}
  }
  if (!opened && context.mounted) showAppToast(context, 'Could not open the link.');
}
