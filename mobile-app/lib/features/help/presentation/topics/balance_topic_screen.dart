import 'package:flutter/material.dart';

import '../../../auth/data/auth_api_service.dart';
import '../../../auth/data/auth_models.dart';
import '../../../care/content/catalog_content.dart';
import '../../../care/data/care_api_service.dart';
import '../../../care/presentation/care_theme.dart';
import '../../../shared/app_toast.dart';
import '../../data/help_topics.dart';
import 'life_wheel.dart';
import 'topic_widgets.dart';

/// Work–life balance: the parts of a person's life on a wheel they turn. The
/// part that comes to the arrow opens three questions, each in its own card:
/// how much it matters right now, what is going well, what feels missing.
/// What matters most gets a larger slice. Every answer is optional and kept
/// for the person alone. The wheel is a way in, never a score.
class BalanceTopicScreen extends StatefulWidget {
  const BalanceTopicScreen({
    super.key,
    required this.topic,
    required this.care,
    this.session,
    this.backLabel = 'Help',
  });

  final HelpTopic topic;
  final CareApiService care;

  /// Whose life it is: their first name heads the page, their photo sits at
  /// the centre of the wheel.
  final AuthSession? session;
  final String backLabel;

  @override
  State<BalanceTopicScreen> createState() => _BalanceTopicScreenState();
}

class _BalanceTopicScreenState extends State<BalanceTopicScreen> {
  late final List<Map<String, dynamic>> _areas = widget.topic.list('areas');
  String? _selected;
  final _good = TextEditingController();
  final _attention = TextEditingController();
  final _notes = <String, Map<String, String>>{};
  final _savers = <String, KeptSaver>{};
  final _panelKey = GlobalKey();
  bool _loaded = false;
  String _name = '';
  String? _photo;

  @override
  void initState() {
    super.initState();
    final user = widget.session?.user;
    _name = user?.name ?? '';
    _photo = user?.profilePhotoUrl;
    // The web pages know only the token: ask who it is.
    final session = widget.session;
    if (session != null && _name.trim().isEmpty) _loadPerson(session.token);
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

  Future<void> _loadPerson(String token) async {
    try {
      final user = await AuthApiService().fetchCurrentUser(token);
      if (!mounted) return;
      setState(() {
        _name = user.name;
        _photo = user.profilePhotoUrl;
      });
    } catch (_) {
      // The page still works as "My life, right now."
    }
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
            'importance': w.field('importance'),
          };
        }
        _loaded = true;
      });
    } catch (_) {
      if (mounted) setState(() => _loaded = true);
    }
  }

  String get _first => _name.trim().split(RegExp(r'\s+')).first;

  String get _initials {
    final parts = _name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    return parts.take(2).map((p) => p[0].toUpperCase()).join();
  }

  /// A very important part weighs twice the rest; equal weights, equal
  /// slices.
  List<double> get _weights => [
    for (final a in _areas)
      _notes['${a['id']}']?['importance'] == 'very' ? 2.0 : 1.0,
  ];

  bool _hasNotes(String area) {
    final n = _notes[area];
    return n != null &&
        ((n['good'] ?? '').trim().isNotEmpty ||
            (n['attention'] ?? '').trim().isNotEmpty);
  }

  void _land(String area) {
    final previous = _selected;
    if (previous != null && previous != area) _savers[previous]?.flush();
    setState(() {
      _selected = area;
      final n = _notes[area] ?? const {};
      _good.text = n['good'] ?? '';
      _attention.text = n['attention'] ?? '';
    });
    // Bring the questions into view under the wheel.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final panel = _panelKey.currentContext;
      if (panel != null) {
        Scrollable.ensureVisible(
          panel,
          duration: const Duration(milliseconds: 450),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _save(String area, Map<String, String> fields) {
    _notes[area] = fields;
    final saver = _savers.putIfAbsent(
      area,
      () => KeptSaver(
        care: widget.care,
        key: 'balance:$area',
        onError: (m) {
          if (mounted) showAppToast(context, m);
        },
      ),
    );
    saver.schedule(fields);
  }

  void _written() {
    final area = _selected;
    if (area == null) return;
    setState(
      () => _save(area, {
        ..._notes[area] ?? const {},
        'good': _good.text,
        'attention': _attention.text,
      }),
    );
  }

  void _rate(String importance) {
    final area = _selected;
    if (area == null) return;
    setState(
      () => _save(area, {
        'good': _good.text,
        'attention': _attention.text,
        ..._notes[area] ?? const {},
        'importance': importance,
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.topic;
    final selected = _selected;
    final area = selected == null
        ? null
        : _areas.where((a) => a['id'] == selected).firstOrNull;
    final title = _first.isEmpty
        ? t.text('title', 'My life, right now.')
        : t
              .text('namedTitle', '{name}’s life, right now.')
              .replaceAll('{name}', _first);
    return CarePage(
      backLabel: widget.backLabel,
      children: [
        // The app's bar already names the page on the web.
        if (!careWebPages) ...[CareEyebrow(t.name), const SizedBox(height: 10)],
        CareHeading(title, size: 31),
        const SizedBox(height: 8),
        CareCopy(
          t.text(
            'lede',
            'Turn the wheel, or tap the part of life you’d like to think about.',
          ),
          size: 13.5,
        ),
        const SizedBox(height: 10),
        Center(
          child: LifeWheel(
            areas: _areas,
            weights: _weights,
            selected: selected,
            hasNotes: _hasNotes,
            onLand: _land,
            photoUrl: _photo,
            initials: _initials,
          ),
        ),
        const SizedBox(height: 18),
        if (area == null || selected == null)
          CareCopy(
            t.text(
              'emptyNote',
              'Wherever it lands, you can write about that part of life. Only if you want to.',
            ),
            size: 13,
            align: TextAlign.center,
          )
        else if (!_loaded)
          const CareSpinner()
        else
          _Panel(
            key: _panelKey,
            id: selected,
            label: '${area['label'] ?? selected}',
            topic: t,
            importance: _notes[selected]?['importance'] ?? '',
            good: _good,
            attention: _attention,
            onRate: _rate,
            onWrite: _written,
          ),
      ],
    );
  }
}

/// The chosen part's name, then its three questions, each in a card.
class _Panel extends StatelessWidget {
  const _Panel({
    super.key,
    required this.id,
    required this.label,
    required this.topic,
    required this.importance,
    required this.good,
    required this.attention,
    required this.onRate,
    required this.onWrite,
  });

  final String id;
  final String label;
  final HelpTopic topic;
  final String importance;
  final TextEditingController good;
  final TextEditingController attention;
  final ValueChanged<String> onRate;
  final VoidCallback onWrite;

  @override
  Widget build(BuildContext context) {
    final color = lifeAreaColor(id);
    final prompts =
        topic.content['prompts'] as Map<String, dynamic>? ?? const {};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: color,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(lifeAreaIcon(id), color: Colors.white, size: 24),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  fontFamily: careFont,
                  color: CareColors.ink,
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.3,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        _Card(
          color: color,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                topic.text(
                  'importanceIntro',
                  'Different parts of life need different amounts of you at different times.',
                ),
                style: const TextStyle(
                  fontFamily: careFont,
                  color: CareColors.ink,
                  fontSize: 13.5,
                  height: 1.55,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                topic.text(
                  'importanceQuestion',
                  'How important is this area for you right now?',
                ),
                style: const TextStyle(
                  fontFamily: careFont,
                  color: CareColors.ink,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w700,
                  height: 1.55,
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _Choice(
                      label: topic.text('veryImportant', 'Very important'),
                      on: importance == 'very',
                      color: color,
                      onTap: () => onRate('very'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _Choice(
                      label: topic.text('canWait', 'Can wait'),
                      on: importance == 'wait',
                      color: color,
                      onTap: () => onRate('wait'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        _Card(
          color: color,
          child: _Question(
            label: '${prompts['good'] ?? 'What’s going well here?'}',
            controller: good,
            color: color,
            onChanged: onWrite,
          ),
        ),
        _Card(
          color: color,
          child: _Question(
            label:
                '${prompts['attention'] ?? 'What feels missing or needs more attention?'}',
            controller: attention,
            color: color,
            onChanged: onWrite,
          ),
        ),
      ],
    );
  }
}

/// A white card with a stripe of its part's colour down the left.
class _Card extends StatelessWidget {
  const _Card({required this.color, required this.child});

  final Color color;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: CareColors.line),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(width: 4, color: color),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
                child: child,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Choice extends StatelessWidget {
  const _Choice({
    required this.label,
    required this.on,
    required this.color,
    required this.onTap,
  });

  final String label;
  final bool on;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: on ? color : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: on ? color : CareColors.line, width: 1.5),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontFamily: careFont,
              color: on ? Colors.white : CareColors.ink,
              fontSize: 13.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}

class _Question extends StatelessWidget {
  const _Question({
    required this.label,
    required this.controller,
    required this.color,
    required this.onChanged,
  });

  final String label;
  final TextEditingController controller;
  final Color color;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    OutlineInputBorder edge(Color c, [double w = 1]) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: BorderSide(color: c, width: w),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontFamily: careFont,
            color: CareColors.ink,
            fontSize: 14,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: controller,
          minLines: 3,
          maxLines: null,
          keyboardType: TextInputType.multiline,
          textCapitalization: TextCapitalization.sentences,
          onChanged: (_) => onChanged(),
          cursorColor: color,
          style: const TextStyle(
            fontFamily: careFont,
            color: CareColors.ink,
            fontSize: 14,
            fontWeight: FontWeight.w500,
            height: 1.5,
          ),
          decoration: InputDecoration(
            isDense: true,
            filled: true,
            fillColor: const Color(0xFFFAFBFC),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 12,
              vertical: 11,
            ),
            enabledBorder: edge(CareColors.line),
            border: edge(CareColors.line),
            focusedBorder: edge(color, 2),
          ),
        ),
      ],
    );
  }
}
