import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../care/data/care_api_service.dart';
import '../../../care/data/care_models.dart';
import '../../../care/presentation/care_theme.dart';
import '../../../shared/app_toast.dart';
import '../../data/help_topics.dart';
import 'pair_quiz.dart';
import 'love_letter.dart';

/// The note for two: blush paper, rose ink.
class _Rose {
  static const ink = Color(0xFF8E3B55);
  static const soft = Color(0xFFEFB2C0);
  static const stamp = Color(0xFFB0365A);
  static const noteHi = Color(0xFFFFFAF8);
  static const noteLo = Color(0xFFFCEDEE);
  static const back = Color(0xFFF8E1E4);
  static const line = Color(0xFFF0D3D7);
}

const _months = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', //
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

/// Marriage & relationships: time for two. A note to talk from, in five
/// kinds of conversation, stamped once you have talked about it; and a love
/// letter, written by hand, kept privately, shared as a picture.
class CouplesTopicScreen extends StatefulWidget {
  const CouplesTopicScreen({
    super.key,
    required this.topic,
    required this.care,
    required this.catalog,
    this.backLabel = 'Help',
  });

  final HelpTopic topic;
  final CareApiService care;
  final CareCatalog catalog;
  final String backLabel;

  @override
  State<CouplesTopicScreen> createState() => _CouplesTopicScreenState();
}

class _CouplesTopicScreenState extends State<CouplesTopicScreen> {
  int _category = 0;
  int _starter = 0;

  /// The starters talked about today, by a short mark of their words. A
  /// stamp lasts the day, as it always has.
  final Set<String> _talked = {};

  String get _today {
    final d = DateTime.now();
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  String get _todayKey => 'couples:done:$_today';

  /// A starter's mark: 's' and eight hex digits of its words.
  static String _mark(String starter) {
    var h = 0x811c9dc5;
    for (final c in starter.codeUnits) {
      h = ((h ^ c) * 0x01000193) & 0xffffffff;
    }
    return 's${h.toRadixString(16).padLeft(8, '0')}';
  }

  @override
  void initState() {
    super.initState();
    widget.care
        .writings(_todayKey)
        .then((rows) {
          if (!mounted || rows.isEmpty) return;
          final marks = RegExp(r'^s[0-9a-f]{8}$');
          setState(
            () => _talked.addAll(rows.first.fields.keys.where(marks.hasMatch)),
          );
        })
        .catchError((_) {});
  }

  Future<void> _setTalked(String starter, bool talked) async {
    final mark = _mark(starter);
    setState(() => talked ? _talked.add(mark) : _talked.remove(mark));
    try {
      if (_talked.isEmpty) {
        await widget.care.deleteWriting(_todayKey);
      } else {
        await widget.care.putWriting(_todayKey, {
          for (final m in _talked) m: '1',
        });
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => talked ? _talked.remove(mark) : _talked.add(mark));
      showAppToast(
        context,
        error is CareApiException ? error.message : 'Could not save that.',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.topic;
    final kinds = t.list('starters');
    final kind = kinds.isEmpty ? null : kinds[_category % kinds.length];
    final items = kind == null
        ? const <String>[]
        : [for (final s in (kind['items'] as List<dynamic>? ?? const [])) '$s'];
    final starter = items.isEmpty ? '' : items[_starter % items.length];
    return CarePage(
      backLabel: widget.backLabel,
      children: [
        // The app's bar already names the page on the web.
        if (!careWebPages) ...[CareEyebrow(t.name), const SizedBox(height: 10)],
        CareHeading(t.text('title', 'Time for two of you'), size: 30),
        const SizedBox(height: 22),
        // The quizzes for two come first, each hidden until the server can keep it.
        PairQuizCard(
          care: widget.care,
          spec: LoveSpec(
            LoveQuiz(t.content['loveQuiz'] as Map<String, dynamic>?),
          ),
          webBase: widget.catalog.webBase,
        ),
        PairQuizCard(
          care: widget.care,
          spec: AttachmentSpec(
            t.content['attachmentQuiz'] as Map<String, dynamic>?,
          ),
          webBase: widget.catalog.webBase,
        ),
        const SizedBox(height: 6),
        CareSectionTitle(
          t.text('wordsTitle', 'Find the first words'),
          size: 18,
        ),
        const SizedBox(height: 4),
        CareCopy(
          t.text('wordsLede', 'For the things you want to share.'),
          size: 12.5,
        ),
        const SizedBox(height: 12),
        if (kind != null) ...[
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (var i = 0; i < kinds.length; i++)
                _RoseChip(
                  '${kinds[i]['label']}',
                  on: i == _category % kinds.length,
                  onTap: () => setState(() {
                    _category = i;
                    _starter = 0;
                  }),
                ),
            ],
          ),
          const SizedBox(height: 16),
          _TalkNote(
            name: '${kind['name'] ?? kind['label'] ?? ''}',
            starter: starter,
            copy: '${kind['copy'] ?? ''}',
            talked: _talked.contains(_mark(starter)),
            onAnother: () => setState(() => _starter++),
            onTalked: (v) => _setTalked(starter, v),
          ),
        ],
        const SizedBox(height: 34),
        CareSectionTitle(t.text('letterTitle', 'A love letter'), size: 18),
        const SizedBox(height: 4),
        CareCopy(
          t.text('letterLede', 'A thoughtful gesture, in your own words.'),
          size: 12.5,
        ),
        const SizedBox(height: 14),
        LoveLetter(
          care: widget.care,
          prompts: [
            ...t.strings('letterPrompts'),
            if (t.strings('letterPrompts').isEmpty) ...t.strings('letterCues'),
          ],
        ),
      ],
    );
  }
}

class _RoseChip extends StatelessWidget {
  const _RoseChip(this.label, {required this.on, required this.onTap});

  final String label;
  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: on ? _Rose.ink : Colors.white,
    shape: StadiumBorder(
      side: BorderSide(color: on ? _Rose.ink : CareColors.line),
    ),
    child: InkWell(
      customBorder: const StadiumBorder(),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        child: Text(
          label,
          style: TextStyle(
            fontFamily: careFont,
            color: on ? Colors.white : CareColors.ink,
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    ),
  );
}

/// One starter on blush paper, a second sheet tucked behind it. Talked about,
/// it takes a rose ink stamp in its corner; the stamp, or the bar, takes it
/// off again.
class _TalkNote extends StatefulWidget {
  const _TalkNote({
    required this.name,
    required this.starter,
    required this.copy,
    required this.talked,
    required this.onAnother,
    required this.onTalked,
  });

  final String name;
  final String starter;
  final String copy;
  final bool talked;
  final VoidCallback onAnother;
  final ValueChanged<bool> onTalked;

  @override
  State<_TalkNote> createState() => _TalkNoteState();
}

class _TalkNoteState extends State<_TalkNote>
    with SingleTickerProviderStateMixin {
  late final AnimationController _press = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 440),
    value: 1,
  );

  @override
  void didUpdateWidget(covariant _TalkNote old) {
    super.didUpdateWidget(old);
    // The stamp is pressed when this starter becomes talked about.
    if (widget.talked && !old.talked && widget.starter == old.starter) {
      _press.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _press.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    return AnimatedBuilder(
      animation: _press,
      builder: (_, child) {
        // the card gives a little as the stamp lands
        final p = _press.value;
        final dip = p < 0.35 ? p / 0.35 : 1 - (p - 0.35) / 0.65;
        return Transform.translate(
          offset: Offset(0, widget.talked ? 2 * dip.clamp(0.0, 1.0) : 0),
          child: child,
        );
      },
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // the second sheet, tucked behind
          Positioned(
            left: 8,
            right: 4,
            top: 12,
            bottom: -8,
            child: Transform.rotate(
              angle: 2.4 * math.pi / 180,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: _Rose.back,
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(color: _Rose.line),
                ),
              ),
            ),
          ),
          Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: _Rose.line),
              gradient: const LinearGradient(
                begin: Alignment(-0.1, -1),
                end: Alignment(0.1, 1),
                colors: [_Rose.noteHi, _Rose.noteHi, _Rose.noteLo],
                stops: [0, 0.35, 1],
              ),
              boxShadow: [
                BoxShadow(
                  color: _Rose.ink.withValues(alpha: 0.07),
                  blurRadius: 5,
                  offset: const Offset(0, 2),
                ),
                BoxShadow(
                  color: _Rose.ink.withValues(alpha: 0.3),
                  blurRadius: 34,
                  spreadRadius: -20,
                  offset: const Offset(0, 20),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 14, 14, 0),
                  child: Row(
                    children: [
                      const CustomPaint(
                        size: Size(36, 26),
                        painter: _TwoHearts(),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          widget.name.toUpperCase(),
                          style: const TextStyle(
                            fontFamily: careFont,
                            color: _Rose.ink,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 2,
                          ),
                        ),
                      ),
                      _RoundButton(
                        icon: Icons.shuffle_rounded,
                        label: 'Another starter',
                        onTap: widget.onAnother,
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 12, 18, 0),
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 280),
                    transitionBuilder: (child, a) => FadeTransition(
                      opacity: a,
                      child: SlideTransition(
                        position: Tween(
                          begin: const Offset(0, 0.06),
                          end: Offset.zero,
                        ).animate(a),
                        child: child,
                      ),
                    ),
                    child: Column(
                      key: ValueKey(widget.starter),
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          '“${widget.starter}”',
                          style: const TextStyle(
                            fontFamily: careFont,
                            color: CareColors.ink,
                            fontSize: 21,
                            fontWeight: FontWeight.w700,
                            height: 1.3,
                            letterSpacing: -0.3,
                          ),
                        ),
                        if (widget.copy.isNotEmpty) ...[
                          const SizedBox(height: 10),
                          CareCopy(widget.copy, size: 13),
                        ],
                      ],
                    ),
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.only(top: 16, bottom: 14),
                  child: CustomPaint(
                    size: Size(double.infinity, 2),
                    painter: _Tear(),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 0, 18, 16),
                  child: widget.talked
                      ? _TalkedBar(onTap: () => widget.onTalked(false))
                      : _TalkButton(onTap: () => widget.onTalked(true)),
                ),
              ],
            ),
          ),
          if (widget.talked)
            Positioned(
              right: -8,
              bottom: -14,
              child: Semantics(
                button: true,
                label: 'We talked about this. Tap to take the mark off.',
                child: GestureDetector(
                  onTap: () => widget.onTalked(false),
                  child: AnimatedBuilder(
                    animation: _press,
                    builder: (_, child) {
                      final p = Curves.easeOutBack.transform(_press.value);
                      final scale = 1.7 - 0.7 * p;
                      return Opacity(
                        opacity: (_press.value * 1.8).clamp(0.0, 0.9),
                        child: Transform.scale(scale: scale, child: child),
                      );
                    },
                    child: Transform.rotate(
                      angle: -14 * math.pi / 180,
                      child: CustomPaint(
                        size: const Size(92, 92),
                        painter: _StampPainter(
                          '${now.day} ${_months[now.month - 1]}',
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _TalkButton extends StatelessWidget {
  const _TalkButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: _Rose.ink,
    borderRadius: BorderRadius.circular(14),
    child: InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: const SizedBox(
        height: 50,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              'We talked about this',
              style: TextStyle(
                fontFamily: careFont,
                color: Colors.white,
                fontSize: 13.5,
                fontWeight: FontWeight.w700,
              ),
            ),
            SizedBox(width: 8),
            Icon(Icons.favorite_border_rounded, color: Colors.white, size: 17),
          ],
        ),
      ),
    ),
  );
}

/// Talked about: the whole bar takes the mark off again.
class _TalkedBar extends StatelessWidget {
  const _TalkedBar({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'You talked about this. Tap to take the mark off.',
    child: Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: _Rose.line),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          // room on the right for the stamp
          padding: const EdgeInsets.fromLTRB(12, 0, 84, 0),
          child: SizedBox(
            height: 50,
            child: Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: const BoxDecoration(
                    color: _Rose.ink,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.check_rounded,
                    color: Colors.white,
                    size: 16,
                  ),
                ),
                const SizedBox(width: 10),
                const Text(
                  'You talked about this',
                  style: TextStyle(
                    fontFamily: careFont,
                    color: _Rose.ink,
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: label,
    child: Material(
      color: Colors.white,
      shape: const CircleBorder(side: BorderSide(color: _Rose.line)),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: SizedBox(
          width: 40,
          height: 40,
          child: Icon(icon, size: 19, color: _Rose.ink),
        ),
      ),
    ),
  );
}

Path _heart() => Path()
  ..moveTo(12, 21.2)
  ..cubicTo(11.6, 21, 3.2, 16, 2.3, 10.1)
  ..cubicTo(1.7, 6.4, 4.2, 3.5, 7.4, 3.5)
  ..cubicTo(9.4, 3.5, 11, 4.6, 12, 6.2)
  ..cubicTo(13, 4.6, 14.6, 3.5, 16.6, 3.5)
  ..cubicTo(19.8, 3.5, 22.3, 6.4, 21.7, 10.1)
  ..cubicTo(20.8, 16, 12.4, 21, 12, 21.2)
  ..close();

/// Two hearts overlapping: one filled, one drawn.
class _TwoHearts extends CustomPainter {
  const _TwoHearts();

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 36);
    canvas.drawPath(
      _heart().shift(const Offset(0, 1)),
      Paint()..color = _Rose.soft,
    );
    canvas.drawPath(
      _heart().shift(const Offset(11, 1)),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.8
        ..strokeJoin = StrokeJoin.round
        ..color = _Rose.ink,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _TwoHearts old) => false;
}

/// The dashed line across the note, above its button.
class _Tear extends CustomPainter {
  const _Tear();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = _Rose.line
      ..strokeWidth = 1.5;
    for (var x = 0.0; x < size.width; x += 9) {
      canvas.drawLine(
        Offset(x, 1),
        Offset(math.min(x + 5, size.width), 1),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _Tear old) => false;
}

/// A round rose ink stamp: "We talked about this · together ·" around the
/// ring, a heart and the day in the middle.
class _StampPainter extends CustomPainter {
  const _StampPainter(this.day);

  final String day;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 100);
    const c = Offset(50, 50);
    final ink = Paint()
      ..color = _Rose.stamp
      ..style = PaintingStyle.stroke;
    canvas.drawCircle(c, 47, ink..strokeWidth = 2.6);
    canvas.drawCircle(c, 43, ink..strokeWidth = 1);
    canvas.drawCircle(c, 25, ink..strokeWidth = 1);
    // the words around the ring, a letter at a time
    const words = 'WE TALKED ABOUT THIS · TOGETHER · ';
    final step = 2 * math.pi / words.length;
    for (var i = 0; i < words.length; i++) {
      final a = -math.pi * 0.75 + i * step;
      final tp = TextPainter(
        text: TextSpan(
          text: words[i],
          style: const TextStyle(
            fontFamily: careFont,
            color: _Rose.stamp,
            fontSize: 8.6,
            fontWeight: FontWeight.w800,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      canvas.save();
      canvas.translate(c.dx + math.cos(a) * 35, c.dy + math.sin(a) * 35);
      canvas.rotate(a + math.pi / 2);
      tp.paint(canvas, Offset(-tp.width / 2, -tp.height / 2));
      canvas.restore();
    }
    canvas.save();
    canvas.translate(41, 33);
    canvas.scale(0.75);
    canvas.drawPath(_heart(), Paint()..color = _Rose.stamp);
    canvas.restore();
    final date = TextPainter(
      text: TextSpan(
        text: day,
        style: const TextStyle(
          fontFamily: careFont,
          color: _Rose.stamp,
          fontSize: 9.5,
          fontWeight: FontWeight.w800,
          letterSpacing: 1,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    date.paint(canvas, Offset(50 - date.width / 2, 57));
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _StampPainter old) => old.day != day;
}
