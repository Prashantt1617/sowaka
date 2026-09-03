import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Matches bare and schemed links plus e-mail addresses.
///
/// Trailing punctuation is deliberately excluded from the match so a link at
/// the end of a sentence doesn't swallow the full stop.
final _linkPattern = RegExp(
  r'((?:https?://|www\.)[^\s<>"]+[^\s<>"\.,;:!?)\]}]|[\w.+-]+@[\w-]+\.[\w.-]+)',
  caseSensitive: false,
);

/// Opens a URL (or e-mail address) in the platform browser.
///
/// Shared with widgets that render their own link affordance — a recommendation
/// card's preview, say — so tapping a link behaves the same everywhere.
/// Returns false when the value isn't a usable link or nothing could open it.
Future<bool> openExternalLink(String raw) async {
  final uri = _LinkifiedTextState._toUri(raw);
  if (uri == null) return false;
  return launchUrl(
    uri,
    mode: LaunchMode.externalApplication,
  ).catchError((_) => false);
}

/// Renders text with any URLs or e-mail addresses as tappable links.
///
/// Used anywhere user-written copy is shown — post bodies, comments,
/// announcements — so a pasted link is always actionable.
class LinkifiedText extends StatefulWidget {
  const LinkifiedText(
    this.text, {
    super.key,
    required this.style,
    this.linkStyle,
    this.maxLines,
    this.overflow,
    this.textAlign,
  });

  final String text;
  final TextStyle style;
  final TextStyle? linkStyle;
  final int? maxLines;
  final TextOverflow? overflow;
  final TextAlign? textAlign;

  @override
  State<LinkifiedText> createState() => _LinkifiedTextState();
}

class _LinkifiedTextState extends State<LinkifiedText> {
  /// Recognizers own a gesture arena entry, so they must be disposed with the
  /// widget rather than recreated and dropped on every rebuild.
  final _recognizers = <TapGestureRecognizer>[];

  @override
  void dispose() {
    for (final recognizer in _recognizers) {
      recognizer.dispose();
    }
    super.dispose();
  }

  void _clearRecognizers() {
    for (final recognizer in _recognizers) {
      recognizer.dispose();
    }
    _recognizers.clear();
  }

  Future<void> _open(String raw) async {
    final launched = await openExternalLink(raw);
    if (!launched && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text("Couldn't open $raw"),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  static Uri? _toUri(String raw) {
    final value = raw.trim();
    if (value.isEmpty) return null;
    if (value.contains('@') && !value.contains('/')) {
      return Uri.tryParse('mailto:$value');
    }
    final withScheme =
        RegExp(r'^https?://', caseSensitive: false).hasMatch(value)
        ? value
        : 'https://$value';
    return Uri.tryParse(withScheme);
  }

  @override
  Widget build(BuildContext context) {
    _clearRecognizers();
    final matches = _linkPattern.allMatches(widget.text).toList();
    if (matches.isEmpty) {
      return Text(
        widget.text,
        style: widget.style,
        maxLines: widget.maxLines,
        overflow: widget.overflow,
        textAlign: widget.textAlign,
      );
    }

    final linkStyle =
        widget.linkStyle ??
        widget.style.copyWith(
          color: const Color(0xFF0571A6),
          decoration: TextDecoration.underline,
          decorationColor: const Color(0xFF0571A6),
        );

    final spans = <InlineSpan>[];
    var cursor = 0;
    for (final match in matches) {
      if (match.start > cursor) {
        spans.add(TextSpan(text: widget.text.substring(cursor, match.start)));
      }
      final raw = match.group(0)!;
      final recognizer = TapGestureRecognizer()..onTap = () => _open(raw);
      _recognizers.add(recognizer);
      spans.add(TextSpan(text: raw, style: linkStyle, recognizer: recognizer));
      cursor = match.end;
    }
    if (cursor < widget.text.length) {
      spans.add(TextSpan(text: widget.text.substring(cursor)));
    }

    return Text.rich(
      TextSpan(style: widget.style, children: spans),
      maxLines: widget.maxLines,
      overflow: widget.overflow ?? TextOverflow.clip,
      textAlign: widget.textAlign,
    );
  }
}
