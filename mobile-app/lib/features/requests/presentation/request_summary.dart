import 'package:flutter/material.dart';

import '../../../services/linkified_text.dart';

/// One label/value line on a request summary.
class SummaryRow {
  const SummaryRow(this.label, this.value);

  final String label;
  final String value;
}

/// Everything a submitted request shows, whether it has just been sent or is
/// being looked at later. The two screens differ only by the success header,
/// so they share one description rather than drifting apart.
class RequestSummary {
  const RequestSummary({
    required this.screenTitle,
    required this.successTitle,
    required this.successBody,
    required this.rows,
    this.reason,
    this.documentName,
    this.documentUrl,
  });

  final String screenTitle;
  final String successTitle;
  final String successBody;
  final List<SummaryRow> rows;
  final String? reason;
  final String? documentName;

  /// Short-lived signed link to the stored file, when there is one.
  final String? documentUrl;
}

class RequestSummaryBody extends StatelessWidget {
  const RequestSummaryBody({
    required this.summary,
    required this.showSuccess,
  });

  final RequestSummary summary;
  final bool showSuccess;

  @override
  Widget build(BuildContext context) {
    final reason = summary.reason;
    final document = summary.documentName;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (showSuccess) ...[
          const SizedBox(height: 18),
          Center(
            child: Container(
              width: 64,
              height: 64,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                color: Color(0xFFD7EDF3),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.check_rounded,
                size: 32,
                color: Color(0xFF0571A6),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            summary.successTitle,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF1A1C1E),
              fontSize: 20,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            summary.successBody,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF6A6A6A),
              fontSize: 13.5,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 22),
        ] else
          const SizedBox(height: 8),
        for (final (index, row) in summary.rows.indexed) ...[
          if (index > 0)
            const Divider(height: 1, thickness: 1, color: Color(0xFFE8E8EC)),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  row.label,
                  style: const TextStyle(
                    color: Color(0xFF6A6A6A),
                    fontSize: 13.5,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Text(
                    row.value,
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                      color: Color(0xFF1A1C1E),
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        if (reason != null && reason.isNotEmpty) ...[
          const Divider(height: 1, thickness: 1, color: Color(0xFFE8E8EC)),
          const SizedBox(height: 14),
          const Text(
            'Reason',
            style: TextStyle(color: Color(0xFF6A6A6A), fontSize: 13.5),
          ),
          const SizedBox(height: 6),
          Text(
            reason,
            style: const TextStyle(
              color: Color(0xFF1A1C1E),
              fontSize: 13.5,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 14),
        ],
        if (document != null && document.isNotEmpty) ...[
          const Divider(height: 1, thickness: 1, color: Color(0xFFE8E8EC)),
          const SizedBox(height: 14),
          const Text(
            'Attachment',
            style: TextStyle(color: Color(0xFF6A6A6A), fontSize: 13.5),
          ),
          const SizedBox(height: 8),
          _AttachmentChip(name: document, url: summary.documentUrl),
        ],
      ],
    );
  }
}


/// The attached file. Tapping opens the signed link the server hands back, so
/// the file is fetched straight from storage rather than through the API.
class _AttachmentChip extends StatelessWidget {
  const _AttachmentChip({required this.name, required this.url});

  final String name;
  final String? url;

  @override
  Widget build(BuildContext context) {
    final link = url;
    final openable = link != null && link.isNotEmpty;
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: openable
          ? () async {
              final opened = await openExternalLink(link);
              if (opened || !context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Could not open the attachment')),
              );
            }
          : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            Icon(
              Icons.description_outlined,
              size: 18,
              color: openable ? const Color(0xFF0571A6) : const Color(0xFF6A6A6A),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                name,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: openable
                      ? const Color(0xFF0571A6)
                      : const Color(0xFF1A1C1E),
                  fontSize: 13.5,
                  fontWeight: FontWeight.w600,
                  decoration: openable ? TextDecoration.underline : null,
                  decorationColor: const Color(0xFF9CC8DE),
                ),
              ),
            ),
            if (openable)
              const Icon(
                Icons.open_in_new_rounded,
                size: 15,
                color: Color(0xFF0571A6),
              ),
          ],
        ),
      ),
    );
  }
}
