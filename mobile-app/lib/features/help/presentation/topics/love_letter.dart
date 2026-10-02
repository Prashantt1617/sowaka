import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../../care/data/care_api_service.dart';
import '../../../care/presentation/care_theme.dart';
import '../../../care/presentation/share_writing.dart';
import '../../../shared/app_toast.dart';
import 'grief_notebook.dart' show griefHand;
import 'topic_widgets.dart';

/// Letter paper, fountain-pen ink and sealing wax.
class LetterColors {
  static const paperHi = Color(0xFFFFFBF5);
  static const paperLo = Color(0xFFFAEEE7);
  static const edge = Color(0xFFE9D7CB);
  static const embossHi = Color(0xF2FFFFFF);
  static const embossLo = Color(0x4D96605A);
  static const ink = Color(0xFF1D2B4F);
  static const inkSoft = Color(0xFF3E4F78);
  static const waxHi = Color(0xFFE06A82);
  static const wax = Color(0xFFB3304B);
  static const waxLo = Color(0xFF7A162E);
  static const waxDeep = Color(0xFF8E2038);
  static const rose = Color(0xFF8E3B55);
  static const blushLine = Color(0xFFF0D3D7);
}

TextStyle _hand(double size, Color color) => TextStyle(
  fontFamily: griefHand,
  fontSize: size,
  height: 32 / size,
  color: color,
  fontWeight: FontWeight.w400,
);

const _months = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', //
  'August', 'September', 'October', 'November', 'December',
];

String _dateLine(DateTime d) => '${d.day} ${_months[d.month - 1]} ${d.year}';

/// The person's love letter, written by hand on fine paper: a prompt to
/// begin from (or none), their words in fountain-pen ink, kept privately
/// as they write. The wax seal shares it, as a picture.
class LoveLetter extends StatefulWidget {
  const LoveLetter({super.key, required this.care, required this.prompts});

  final CareApiService care;
  final List<String> prompts;

  @override
  State<LoveLetter> createState() => _LoveLetterState();
}

class _LoveLetterState extends State<LoveLetter> {
  static const _paperHeight = 470.0;

  final _body = TextEditingController();
  final _focus = FocusNode();
  late final KeptSaver _saver = KeptSaver(
    care: widget.care,
    key: 'loveletter:main',
    onSaved: () {
      if (mounted) setState(() => _saved = true);
    },
    onError: (m) {
      if (mounted) showAppToast(context, m);
    },
  );
  int _prompt = 0;
  bool _promptOff = false;
  bool _saved = false;

  @override
  void initState() {
    super.initState();
    widget.care
        .writings('loveletter:main')
        .then((rows) {
          if (!mounted || rows.isEmpty) return;
          final w = rows.first;
          setState(() {
            _body.text = w.field('body');
            // A letter kept before prompts came keeps none; an empty
            // prompt means they chose to write without one.
            if (w.fields.containsKey('prompt')) {
              final p = w.field('prompt');
              _promptOff = p.isEmpty;
              final at = widget.prompts.indexOf(p);
              if (at >= 0) _prompt = at;
            } else if (w.field('body').trim().isNotEmpty) {
              _promptOff = true;
            }
          });
        })
        .catchError((_) {});
  }

  @override
  void dispose() {
    _saver.flush();
    _saver.dispose();
    _body.dispose();
    _focus.dispose();
    super.dispose();
  }

  String? get _promptText => _promptOff || widget.prompts.isEmpty
      ? null
      : widget.prompts[_prompt % widget.prompts.length];

  void _keep() {
    setState(() => _saved = false);
    _saver.schedule({'body': _body.text, 'prompt': _promptText ?? ''});
  }

  void _nextPrompt() {
    setState(() {
      if (_promptOff) {
        _promptOff = false;
      } else {
        _prompt++;
      }
    });
    if (_body.text.trim().isNotEmpty) _keep();
  }

  void _noPrompt() {
    setState(() => _promptOff = true);
    if (_body.text.trim().isNotEmpty) _keep();
  }

  Future<void> _share() async {
    final body = _body.text.trim();
    if (body.isEmpty) {
      showAppToast(context, 'Write a few words first');
      return;
    }
    FocusScope.of(context).unfocus();
    final picture = await letterPicture(
      date: _dateLine(DateTime.now()),
      prompt: _promptText,
      body: body,
    );
    if (!mounted) return;
    final text = [?_promptText, body].join('\n');
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheet) => _ShareSheet(
        picture: picture,
        onShare: () async {
          // Called straight from the tap: a phone shares only from one.
          final shared = await careShareImage?.call(
            picture,
            'love-letter.png',
            'A letter, just for you',
          );
          if (!sheet.mounted) return;
          Navigator.pop(sheet);
          if (shared != true && mounted) {
            await showShareWritingSheet(
              context,
              title: 'A letter, just for you',
              text: text,
            );
          }
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final prompt = _promptText;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: _paperHeight + 30,
          child: Stack(
            children: [
              const Positioned(
                left: 0,
                right: 0,
                top: 0,
                height: _paperHeight,
                child: CustomPaint(painter: LetterPaperPainter()),
              ),
              Positioned(
                top: 50,
                right: 34,
                child: Text(
                  _dateLine(DateTime.now()),
                  style: _hand(18, LetterColors.inkSoft),
                ),
              ),
              Positioned(
                left: 34,
                right: 30,
                top: 84,
                height: _paperHeight - 84 - 42,
                child: GestureDetector(
                  behavior: HitTestBehavior.translucent,
                  onTap: _focus.requestFocus,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (prompt != null)
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: AnimatedSwitcher(
                                duration: const Duration(milliseconds: 250),
                                child: Text(
                                  prompt,
                                  key: ValueKey(prompt),
                                  style: _hand(21, LetterColors.inkSoft),
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            _Round(
                              icon: Icons.shuffle_rounded,
                              label: 'Another prompt',
                              onTap: _nextPrompt,
                            ),
                            const SizedBox(width: 6),
                            _Round(
                              icon: Icons.close_rounded,
                              label: 'Write without a prompt',
                              onTap: _noPrompt,
                            ),
                          ],
                        ),
                      Expanded(
                        child: TextField(
                          controller: _body,
                          focusNode: _focus,
                          expands: true,
                          maxLines: null,
                          keyboardType: TextInputType.multiline,
                          textCapitalization: TextCapitalization.sentences,
                          textAlignVertical: TextAlignVertical.top,
                          cursorColor: LetterColors.ink,
                          style: _hand(21, LetterColors.ink),
                          decoration: const InputDecoration.collapsed(
                            hintText: null,
                          ),
                          onChanged: (_) => _keep(),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              // Without a prompt, the round button sits by the date and
              // brings one back.
              if (prompt == null && widget.prompts.isNotEmpty)
                Positioned(
                  left: 30,
                  top: 46,
                  child: _Round(
                    icon: Icons.shuffle_rounded,
                    label: 'A prompt to begin from',
                    onTap: _nextPrompt,
                  ),
                ),
              Positioned(
                right: 14,
                top: _paperHeight - 46,
                child: Semantics(
                  button: true,
                  label: 'Share your letter',
                  child: GestureDetector(
                    onTap: _share,
                    child: Transform.rotate(
                      angle: -10 * math.pi / 180,
                      child: const CustomPaint(
                        size: Size(72, 72),
                        painter: WaxSealPainter(),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 6),
        KeptNote(saved: _saved),
      ],
    );
  }
}

class _Round extends StatelessWidget {
  const _Round({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: label,
    child: Material(
      color: Colors.white.withValues(alpha: 0.7),
      shape: const CircleBorder(
        side: BorderSide(color: LetterColors.blushLine),
      ),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: SizedBox(
          width: 32,
          height: 32,
          child: Icon(icon, size: 16, color: LetterColors.rose),
        ),
      ),
    ),
  );
}

/// The letter as it will go: a picture, then Share.
class _ShareSheet extends StatelessWidget {
  const _ShareSheet({required this.picture, required this.onShare});

  final Uint8List picture;
  final VoidCallback onShare;

  @override
  Widget build(BuildContext context) {
    final height = MediaQuery.sizeOf(context).height;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Share your letter',
              style: TextStyle(
                fontFamily: careFont,
                color: CareColors.ink,
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 4),
            const CareCopy(
              'It goes as a picture, written just as you see it.',
              size: 12.5,
            ),
            const SizedBox(height: 14),
            Center(
              child: ConstrainedBox(
                constraints: BoxConstraints(maxHeight: height * 0.45),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(6),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x40783C3C),
                        blurRadius: 22,
                        offset: Offset(0, 10),
                      ),
                    ],
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: Image.memory(picture, fit: BoxFit.contain),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(context),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      side: const BorderSide(color: CareColors.line),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    child: const Text(
                      'Cancel',
                      style: TextStyle(
                        fontFamily: careFont,
                        color: CareColors.ink,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: onShare,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      backgroundColor: LetterColors.rose,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    child: const Text(
                      'Share',
                      style: TextStyle(
                        fontFamily: careFont,
                        color: Colors.white,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// The letter drawn as a picture, twice the size for a crisp image: the
/// paper, the date, the prompt if there is one, and the words in the same
/// hand, with a small seal in the corner. The page grows with the letter.
Future<Uint8List> letterPicture({
  required String date,
  required String? prompt,
  required String body,
}) async {
  const w = 360.0, k = 2.0, left = 34.0, right = 34.0;
  TextPainter lay(String text, double size, Color color) => TextPainter(
    text: TextSpan(text: text, style: _hand(size, color)),
    textDirection: TextDirection.ltr,
  )..layout(maxWidth: w - left - right);
  final p = prompt == null ? null : lay(prompt, 21, LetterColors.inkSoft);
  final b = lay(body, 21, LetterColors.ink);
  final d = lay(date, 18, LetterColors.inkSoft);
  final h = math.max(480.0, 92 + (p?.height ?? 0) + b.height + 80);

  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder)..scale(k);
  canvas.drawRect(
    Rect.fromLTWH(0, 0, w, h),
    Paint()..color = const Color(0xFFF7E9EA),
  );
  canvas.save();
  canvas.translate(8, 8);
  const LetterPaperPainter().paint(canvas, Size(w - 16, h - 16));
  canvas.restore();
  d.paint(canvas, Offset(w - right - d.width, 50));
  var y = 88.0;
  if (p != null) {
    p.paint(canvas, Offset(left, y));
    y += p.height;
  }
  b.paint(canvas, Offset(left, y));
  canvas.save();
  canvas.translate(w - 66, h - 66);
  canvas.rotate(-10 * math.pi / 180);
  const WaxSealPainter().paint(canvas, const Size(44, 44));
  canvas.restore();

  final image = await recorder.endRecording().toImage(
    (w * k).round(),
    (h * k).round(),
  );
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  return bytes!.buffer.asUint8List();
}

/// A tiny repeatable random, so the deckled edge is the same every time.
class _Seeded {
  _Seeded(this._s);

  int _s;

  double next() {
    _s = (_s * 1103515245 + 12345) & 0x7fffffff;
    return _s / 0x7fffffff;
  }
}

/// The heart the paper is embossed with.
Path _heart() => Path()
  ..moveTo(12, 21.2)
  ..cubicTo(11.6, 21, 3.2, 16, 2.3, 10.1)
  ..cubicTo(1.7, 6.4, 4.2, 3.5, 7.4, 3.5)
  ..cubicTo(9.4, 3.5, 11, 4.6, 12, 6.2)
  ..cubicTo(13, 4.6, 14.6, 3.5, 16.6, 3.5)
  ..cubicTo(19.8, 3.5, 22.3, 6.4, 21.7, 10.1)
  ..cubicTo(20.8, 16, 12.4, 21, 12, 21.2)
  ..close();

/// Warm cream stock with a torn, deckled edge, a fine grain, a blind
/// embossed double border and two small hearts at the top.
class LetterPaperPainter extends CustomPainter {
  const LetterPaperPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    const m = 2.0;
    final rnd = _Seeded(11);
    final edge = Path();
    var first = true;
    void side(
      double x0,
      double y0,
      double x1,
      double y1,
      double nx,
      double ny,
    ) {
      final len = math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
      final n = math.max(2, (len / 2.6).round());
      final ph = rnd.next() * 6;
      for (var i = 0; i < n; i++) {
        final t = i / n;
        var j = (rnd.next() - 0.5) * 1.8 + math.sin(t * len / 19 + ph) * 0.7;
        if (rnd.next() < 0.05) j -= 1 + rnd.next() * 1.6;
        final x = x0 + (x1 - x0) * t + nx * j;
        final y = y0 + (y1 - y0) * t + ny * j;
        if (first) {
          edge.moveTo(x, y);
          first = false;
        } else {
          edge.lineTo(x, y);
        }
      }
    }

    side(m, m, w - m, m, 0, -1);
    side(w - m, m, w - m, h - m, 1, 0);
    side(w - m, h - m, m, h - m, 0, 1);
    side(m, h - m, m, m, -1, 0);
    edge.close();

    canvas.drawShadow(edge, const Color(0xFF783C3C), 8, false);
    canvas.drawPath(
      edge,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [LetterColors.paperHi, LetterColors.paperLo],
        ).createShader(Offset.zero & size),
    );
    // the grain of the paper
    canvas.save();
    canvas.clipPath(edge);
    final grain = Paint()..color = const Color(0x0A7A5247);
    final g = _Seeded(4);
    for (var i = 0; i < (w * h / 90).round(); i++) {
      canvas.drawCircle(
        Offset(g.next() * w, g.next() * h),
        0.35 + g.next() * 0.5,
        grain,
      );
    }
    canvas.restore();
    canvas.drawPath(
      edge,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 0.8
        ..color = LetterColors.edge,
    );
    void emboss(double inset, double r) {
      final rect = Rect.fromLTWH(inset, inset, w - inset * 2, h - inset * 2);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          rect.shift(const Offset(-0.6, -0.6)),
          Radius.circular(r),
        ),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.3
          ..color = LetterColors.embossHi,
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          rect.shift(const Offset(0.6, 0.6)),
          Radius.circular(r),
        ),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1
          ..color = LetterColors.embossLo,
      );
    }

    emboss(14, 5);
    emboss(19, 3);
    for (final dx in [w / 2 - 13.5, w / 2 - 4.5]) {
      for (final (shift, color, width) in [
        (-0.6, LetterColors.embossHi, 2.2),
        (0.6, LetterColors.embossLo, 1.7),
      ]) {
        canvas.save();
        canvas.translate(dx + shift, 24 + shift);
        canvas.scale(0.62);
        canvas.drawPath(
          _heart(),
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = width
            ..strokeJoin = StrokeJoin.round
            ..color = color,
        );
        canvas.restore();
      }
    }
  }

  @override
  bool shouldRepaint(covariant LetterPaperPainter old) => false;
}

/// A pool of raspberry wax with an uneven rim and a pressed disc, a share
/// mark pressed into it: the letter's share button.
class WaxSealPainter extends CustomPainter {
  const WaxSealPainter();

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 80);
    final rnd = _Seeded(5);
    const n = 40;
    final p1 = rnd.next() * 6, p2 = rnd.next() * 6;
    final pts = <Offset>[
      for (var i = 0; i < n; i++)
        () {
          final a = i / n * math.pi * 2;
          final r =
              34 +
              math.sin(a * 5 + p1) * 1.3 +
              math.sin(a * 9 + p2) * 0.8 +
              (rnd.next() - 0.5) * 1.1;
          return Offset(40 + math.cos(a) * r, 40 + math.sin(a) * r);
        }(),
    ];
    final blob = Path();
    for (var i = 0; i < n; i++) {
      final p = pts[i], q = pts[(i + 1) % n];
      final mid = (p + q) / 2;
      if (i == 0) {
        final last = (pts[n - 1] + p) / 2;
        blob.moveTo(last.dx, last.dy);
      }
      blob.quadraticBezierTo(p.dx, p.dy, mid.dx, mid.dy);
    }
    blob.close();
    const box = Rect.fromLTWH(0, 0, 80, 80);
    canvas.drawShadow(blob, const Color(0xFF460A14), 3, false);
    canvas.drawPath(
      blob,
      Paint()
        ..shader = const RadialGradient(
          center: Alignment(-0.28, -0.4),
          radius: 0.8,
          colors: [LetterColors.waxHi, LetterColors.wax, LetterColors.waxLo],
          stops: [0, 0.45, 1],
        ).createShader(box),
    );
    canvas.drawCircle(
      const Offset(40, 40),
      23,
      Paint()
        ..shader =
            const RadialGradient(
              center: Alignment(0.24, 0.32),
              radius: 0.8,
              colors: [LetterColors.wax, LetterColors.waxDeep],
            ).createShader(
              Rect.fromCircle(center: const Offset(40, 40), radius: 23),
            ),
    );
    canvas.drawCircle(
      const Offset(40.6, 40.6),
      23.4,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2
        ..color = const Color(0x6BFFD7DE),
    );
    canvas.drawCircle(
      const Offset(39.4, 39.4),
      22.6,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2
        ..color = const Color(0x613C000F),
    );
    // the share mark: three dots joined
    void mark(Offset at, Paint fill, Paint? rim) {
      canvas.save();
      canvas.translate(at.dx, at.dy);
      canvas.scale(0.9);
      final dots = [
        const Offset(17.5, 5.5),
        const Offset(6.5, 12),
        const Offset(17.5, 18.5),
      ];
      final lines = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.2
        ..strokeCap = StrokeCap.round
        ..color = fill.color;
      canvas.drawLine(const Offset(9.2, 10.5), const Offset(14.8, 7.2), lines);
      canvas.drawLine(const Offset(9.2, 13.5), const Offset(14.8, 16.8), lines);
      for (final d in dots) {
        canvas.drawCircle(d, 3.4, fill);
        if (rim != null) canvas.drawCircle(d, 3.4, rim);
      }
      canvas.restore();
    }

    mark(
      const Offset(29.6, 29.6),
      Paint()..color = const Color(0x613C000F),
      null,
    );
    mark(
      const Offset(28.8, 28.8),
      Paint()..color = LetterColors.wax,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1
        ..color = const Color(0x80FFCDD7),
    );
    canvas.save();
    canvas.translate(27, 20);
    canvas.rotate(-28 * math.pi / 180);
    canvas.drawOval(
      const Rect.fromLTWH(-9, -4.5, 18, 9),
      Paint()..color = const Color(0x38FFFFFF),
    );
    canvas.restore();
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant WaxSealPainter old) => false;
}
