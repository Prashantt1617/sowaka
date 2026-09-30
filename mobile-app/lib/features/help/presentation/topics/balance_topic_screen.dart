import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../care/content/catalog_content.dart';
import '../../../care/data/care_api_service.dart';
import '../../../care/presentation/care_theme.dart';
import '../../../care/presentation/share_writing.dart';
import '../../../shared/app_toast.dart';
import '../../data/help_topics.dart';
import 'topic_widgets.dart';

/// Work–life balance: six equal areas on a wheel, two optional fields each,
/// kept per area. The wheel is a way in, never a score.
class BalanceTopicScreen extends StatefulWidget {
  const BalanceTopicScreen({
    super.key,
    required this.topic,
    required this.care,
    this.backLabel = 'Help',
  });

  final HelpTopic topic;
  final CareApiService care;
  final String backLabel;

  @override
  State<BalanceTopicScreen> createState() => _BalanceTopicScreenState();
}

class _BalanceTopicScreenState extends State<BalanceTopicScreen> {
  late final List<Map<String, dynamic>> _areas = widget.topic.list('areas');
  late String _selected = _areas.isEmpty ? 'work' : '${_areas.first['id']}';
  final _good = TextEditingController();
  final _attention = TextEditingController();
  final _notes = <String, Map<String, String>>{};
  final _savers = <String, KeptSaver>{};
  bool _loaded = false;
  bool _saved = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final s in _savers.values) {
      s.flush();
      s.dispose();
    }
    _good.dispose();
    _attention.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final rows = await widget.care.writings('balance:');
      if (!mounted) return;
      setState(() {
        for (final w in rows) {
          _notes[w.key.substring('balance:'.length)] = {
            'good': w.field('good'),
            'attention': w.field('attention'),
          };
        }
        _loaded = true;
        _show(_selected);
      });
    } catch (_) {
      if (mounted) setState(() => _loaded = true);
    }
  }

  void _show(String area) {
    final n = _notes[area] ?? const {};
    _good.text = n['good'] ?? '';
    _attention.text = n['attention'] ?? '';
  }

  void _pick(String area) {
    if (area == _selected) return;
    _savers[_selected]?.flush();
    setState(() {
      _selected = area;
      _saved = false;
      _show(area);
    });
  }

  void _changed() {
    final area = _selected;
    final fields = {'good': _good.text, 'attention': _attention.text};
    _notes[area] = fields;
    final saver = _savers.putIfAbsent(
      area,
      () => KeptSaver(
        care: widget.care,
        key: 'balance:$area',
        onSaved: () {
          if (mounted && _selected == area) setState(() => _saved = true);
        },
        onError: (m) {
          if (mounted) showAppToast(context, m);
        },
      ),
    );
    setState(() => _saved = false);
    saver.schedule(fields);
  }

  bool _hasNotes(String area) {
    final n = _notes[area];
    return n != null &&
        ((n['good'] ?? '').trim().isNotEmpty ||
            (n['attention'] ?? '').trim().isNotEmpty);
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.topic;
    final prompts = t.content['prompts'] as Map<String, dynamic>? ?? const {};
    final label =
        _areas.where((a) => a['id'] == _selected).firstOrNull?['label']
            as String? ??
        _selected;
    return CarePage(
      backLabel: widget.backLabel,
      children: [
        CareEyebrow(t.name),
        const SizedBox(height: 10),
        CareHeading(t.text('title', 'My life, right now.'), size: 32),
        const SizedBox(height: 8),
        CareCopy(t.text('lede', t.intro)),
        const SizedBox(height: 18),
        Center(
          child: LifeWheel(
            areas: _areas,
            selected: _selected,
            hasNotes: _hasNotes,
            onPick: _pick,
          ),
        ),
        const SizedBox(height: 8),
        Center(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 7,
                height: 7,
                decoration: const BoxDecoration(
                  color: CareColors.clay,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              CareMicro(t.text('dotNote', 'A dot marks an area with notes')),
            ],
          ),
        ),
        const SizedBox(height: 22),
        const Divider(color: CareColors.line, height: 1),
        const SizedBox(height: 18),
        Row(
          children: [
            Icon(lifeAreaIcon(_selected), color: CareColors.blue, size: 22),
            const SizedBox(width: 10),
            Expanded(child: CareSectionTitle(label, size: 24)),
            if (_hasNotes(_selected))
              ShareLink(
                title: '$label · my life, right now',
                text:
                    'What’s going well here?\n${_good.text}\n\nWhat feels missing or needs more attention?\n${_attention.text}',
              ),
          ],
        ),
        const SizedBox(height: 16),
        if (!_loaded)
          const CareSpinner()
        else ...[
          KeptField(
            label: '${prompts['good'] ?? 'What’s going well here?'}',
            controller: _good,
            hint: 'Write in your own words…',
            onChanged: _changed,
          ),
          const SizedBox(height: 16),
          KeptField(
            label:
                '${prompts['attention'] ?? 'What feels missing or needs more attention?'}',
            controller: _attention,
            hint: 'What would you like more room for?',
            onChanged: _changed,
          ),
          const SizedBox(height: 10),
          KeptNote(saved: _saved),
        ],
      ],
    );
  }
}

/// Six equal sectors around a centre, each a tap target; the chosen one is
/// blue, the rest sage, a dot on any that holds writing.
class LifeWheel extends StatelessWidget {
  const LifeWheel({
    super.key,
    required this.areas,
    required this.selected,
    required this.hasNotes,
    required this.onPick,
    this.size = 300,
  });

  final List<Map<String, dynamic>> areas;
  final String selected;
  final bool Function(String id) hasNotes;
  final ValueChanged<String> onPick;
  final double size;

  @override
  Widget build(BuildContext context) {
    final n = areas.length;
    if (n == 0) return const SizedBox.shrink();
    final r = size / 2;
    final inner = r * 0.34;
    return SizedBox(
      width: size,
      height: size,
      child: Semantics(
        label: 'Areas of life',
        child: GestureDetector(
          onTapUp: (d) {
            final dx = d.localPosition.dx - r, dy = d.localPosition.dy - r;
            final dist = math.sqrt(dx * dx + dy * dy);
            if (dist < inner || dist > r) return;
            // Sector 0 starts at the top and runs clockwise.
            var angle = math.atan2(dy, dx) + math.pi / 2;
            if (angle < 0) angle += 2 * math.pi;
            onPick('${areas[(angle / (2 * math.pi / n)).floor() % n]['id']}');
          },
          child: Stack(
            children: [
              Positioned.fill(
                child: CustomPaint(
                  painter: _WheelPainter(
                    n: n,
                    selected: areas.indexWhere((a) => a['id'] == selected),
                    inner: inner,
                  ),
                ),
              ),
              for (var i = 0; i < n; i++)
                Builder(
                  builder: (_) {
                    final mid = -math.pi / 2 + (i + 0.5) * 2 * math.pi / n;
                    final rr = (r + inner) / 2 + 4;
                    final id = '${areas[i]['id']}';
                    final on = id == selected;
                    return Positioned(
                      left: r + rr * math.cos(mid) - 44,
                      top: r + rr * math.sin(mid) - 30,
                      width: 88,
                      height: 66,
                      child: IgnorePointer(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              lifeAreaIcon(id),
                              size: 18,
                              color: on ? Colors.white : CareColors.ink,
                            ),
                            const SizedBox(height: 3),
                            Text(
                              '${areas[i]['label']}',
                              textAlign: TextAlign.center,
                              maxLines: 2,
                              style: TextStyle(
                                fontFamily: careFont,
                                color: on ? Colors.white : CareColors.ink,
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                height: 1.15,
                              ),
                            ),
                            if (hasNotes(id)) ...[
                              const SizedBox(height: 3),
                              Container(
                                width: 6,
                                height: 6,
                                decoration: BoxDecoration(
                                  color: on ? Colors.white : CareColors.clay,
                                  shape: BoxShape.circle,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    );
                  },
                ),
              Center(
                child: Container(
                  width: inner * 2 - 8,
                  height: inner * 2 - 8,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: const [
                      Icon(
                        Icons.eco_outlined,
                        size: 18,
                        color: CareColors.clay,
                      ),
                      SizedBox(height: 2),
                      Text(
                        'You',
                        style: TextStyle(
                          fontFamily: careFont,
                          color: CareColors.blue,
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WheelPainter extends CustomPainter {
  _WheelPainter({required this.n, required this.selected, required this.inner});

  final int n;
  final int selected;
  final double inner;

  @override
  void paint(Canvas canvas, Size size) {
    final c = Offset(size.width / 2, size.height / 2);
    final r = size.width / 2;
    final sweep = 2 * math.pi / n;
    for (var i = 0; i < n; i++) {
      final start = -math.pi / 2 + i * sweep;
      final path = Path()
        ..moveTo(c.dx + inner * math.cos(start), c.dy + inner * math.sin(start))
        ..arcTo(Rect.fromCircle(center: c, radius: r), start, sweep, false)
        ..arcTo(
          Rect.fromCircle(center: c, radius: inner),
          start + sweep,
          -sweep,
          false,
        )
        ..close();
      canvas.drawPath(
        path,
        Paint()..color = i == selected ? CareColors.blue : CareColors.sage,
      );
      canvas.drawPath(
        path,
        Paint()
          ..color = Colors.white
          ..style = PaintingStyle.stroke
          ..strokeWidth = 3,
      );
    }
  }

  @override
  bool shouldRepaint(_WheelPainter old) =>
      old.selected != selected || old.n != n;
}
