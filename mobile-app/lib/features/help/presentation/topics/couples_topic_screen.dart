import 'package:flutter/material.dart';

import '../../../care/data/care_api_service.dart';
import '../../../care/data/care_models.dart';
import '../../../care/presentation/care_theme.dart';
import '../../../care/presentation/share_writing.dart';
import '../../../shared/app_toast.dart';
import '../../data/help_topics.dart';
import 'topic_widgets.dart';

/// Marriage & relationships: one question a day, conversation starters, a
/// love letter, and short lessons for two.
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
  /// Refresh moves along the pool for today only.
  int _offset = 0;
  int _category = 0;
  int _starter = 0;
  bool _talked = false;
  bool _hasLetter = false;

  String get _today {
    final d = DateTime.now();
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  List<String> get _questions => widget.topic.strings('questions');

  /// The same question for everyone on the same day: days since a fixed
  /// epoch, around the pool.
  int get _dayIndex {
    final days = DateTime.now().difference(DateTime(2026, 1, 1)).inDays;
    return _questions.isEmpty ? 0 : (days + _offset) % _questions.length;
  }

  String get _question => _questions.isEmpty ? '' : _questions[_dayIndex];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final marks = await widget.care.writings('couples:done:$_today');
      final letters = await widget.care.writings('loveletter:main');
      if (!mounted) return;
      setState(() {
        _talked = marks.any((w) => w.field('question') == _question);
        _hasLetter =
            letters.isNotEmpty && letters.first.field('body').trim().isNotEmpty;
      });
    } catch (_) {}
  }

  Future<void> _toggleTalked() async {
    final key = 'couples:done:$_today';
    final next = !_talked;
    setState(() => _talked = next);
    try {
      if (next) {
        await widget.care.putWriting(key, {'question': _question});
      } else {
        await widget.care.deleteWriting(key);
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _talked = !next);
      showAppToast(
        context,
        error is CareApiException ? error.message : 'Could not save that.',
      );
    }
  }

  Future<void> _push(Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.topic;
    final starters = t.list('starters');
    final cat = starters.isEmpty ? null : starters[_category % starters.length];
    final items = cat == null
        ? const <String>[]
        : [for (final s in (cat['items'] as List<dynamic>? ?? const [])) '$s'];
    final starter = items.isEmpty ? '' : items[_starter % items.length];
    final shorts = t.list('shorts');
    return CarePage(
      backLabel: widget.backLabel,
      children: [
        CareEyebrow(t.name),
        const SizedBox(height: 10),
        CareHeading(t.text('title', 'A little closer, every day.'), size: 30),
        const SizedBox(height: 8),
        CareCopy(t.text('lede', t.intro)),
        const SizedBox(height: 22),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: CareColors.sky,
            borderRadius: BorderRadius.circular(24),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: const [
                  Expanded(child: CareEyebrow('Today’s question')),
                  Icon(Icons.forum_outlined, color: CareColors.blue, size: 20),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                _question,
                style: const TextStyle(
                  fontFamily: careFont,
                  color: CareColors.ink,
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  height: 1.25,
                  letterSpacing: -0.3,
                ),
              ),
              const SizedBox(height: 10),
              CareCopy(
                _talked
                    ? 'You made a little space for each other.'
                    : 'Take turns. Listen. See where it takes you.',
                size: 13,
              ),
              const SizedBox(height: 16),
              CarePrimaryButton(
                _talked ? 'We talked about this' : 'We talked about this',
                icon: _talked ? Icons.check_rounded : Icons.circle_outlined,
                onTap: _toggleTalked,
              ),
              const SizedBox(height: 6),
              Center(
                child: CareLink(
                  'Refresh question',
                  icon: Icons.refresh_rounded,
                  onTap: () => setState(() => _offset++),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 26),
        const CareSectionTitle('Find the first words', size: 18),
        const SizedBox(height: 4),
        const CareCopy('For the things you want to share.', size: 12.5),
        const SizedBox(height: 12),
        if (cat != null)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: CareColors.line),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (var i = 0; i < starters.length; i++)
                      CareChoiceChip(
                        '${starters[i]['label']}',
                        selected: i == _category % starters.length,
                        onTap: () => setState(() {
                          _category = i;
                          _starter = 0;
                        }),
                      ),
                  ],
                ),
                const SizedBox(height: 14),
                Text(
                  '“$starter”',
                  style: const TextStyle(
                    fontFamily: careFont,
                    color: CareColors.ink,
                    fontSize: 17,
                    fontWeight: FontWeight.w500,
                    height: 1.35,
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    CareLink(
                      'Try this opener',
                      onTap: () => _push(
                        _OpenerScreen(
                          category: cat,
                          starter: starter,
                          backLabel: t.name,
                        ),
                      ),
                    ),
                    const Spacer(),
                    IconButton(
                      onPressed: () => setState(() => _starter++),
                      icon: const Icon(
                        Icons.shuffle_rounded,
                        color: CareColors.blue,
                      ),
                      tooltip: 'Another starter',
                    ),
                  ],
                ),
              ],
            ),
          ),
        const SizedBox(height: 26),
        const CareSectionTitle('Make time for us', size: 18),
        const SizedBox(height: 4),
        const CareCopy('A thoughtful gesture, in your own words.', size: 12.5),
        const SizedBox(height: 12),
        TopicBanner(
          color: CareColors.peach,
          eyebrow: 'Something to do',
          title: 'A letter, just for them',
          copy: 'You don’t need perfect words. Start with one thing you mean.',
          action: _hasLetter ? 'Revisit your letter' : 'Write a love letter',
          icon: Icons.mail_outline_rounded,
          onTap: () => _push(_LoveLetterScreen(topic: t, care: widget.care)),
        ),
        const SizedBox(height: 26),
        const CareSectionTitle('Little lessons for two', size: 18),
        const SizedBox(height: 4),
        const CareCopy('A fresh perspective, in a minute or less.', size: 12.5),
        const SizedBox(height: 12),
        for (var i = 0; i < shorts.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: CareResourceRow(
              title: '${shorts[i]['title']}',
              meta: '${shorts[i]['topic']} · ${shorts[i]['time']}',
              icon: Icons.play_circle_outline_rounded,
              tint: i.isEven ? CareColors.sage : CareColors.lilac,
              onTap: () => _push(
                _ShortScreen(
                  topic: t,
                  shorts: shorts,
                  index: i,
                  catalog: widget.catalog,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _OpenerScreen extends StatelessWidget {
  const _OpenerScreen({
    required this.category,
    required this.starter,
    required this.backLabel,
  });

  final Map<String, dynamic> category;
  final String starter;
  final String backLabel;

  @override
  Widget build(BuildContext context) {
    return CarePage(
      backLabel: backLabel,
      children: [
        const CareEyebrow('A conversation starter'),
        const SizedBox(height: 10),
        CareHeading('${category['name'] ?? ''}', size: 28),
        const SizedBox(height: 8),
        CareCopy('${category['copy'] ?? ''}'),
        const SizedBox(height: 20),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: CareColors.peach,
            borderRadius: BorderRadius.circular(22),
          ),
          child: Text(
            '“$starter”',
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.ink,
              fontSize: 22,
              fontWeight: FontWeight.w600,
              height: 1.3,
            ),
          ),
        ),
        const SizedBox(height: 16),
        const CareCopy(
          'Use your own words. Then make room for your partner’s experience too.',
          size: 14,
          color: CareColors.ink,
        ),
        const SizedBox(height: 8),
        const CareMicro(
          'If now isn’t a good moment, agree on a time to come back to it together.',
        ),
      ],
    );
  }
}

/// A love letter, kept, with three cues; Finish for now shows it to read.
class _LoveLetterScreen extends StatefulWidget {
  const _LoveLetterScreen({required this.topic, required this.care});

  final HelpTopic topic;
  final CareApiService care;

  @override
  State<_LoveLetterScreen> createState() => _LoveLetterScreenState();
}

class _LoveLetterScreenState extends State<_LoveLetterScreen> {
  final _body = TextEditingController();
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
  bool _loaded = false;
  bool _saved = false;

  @override
  void initState() {
    super.initState();
    widget.care
        .writings('loveletter:main')
        .then((rows) {
          if (!mounted) return;
          if (rows.isNotEmpty) _body.text = rows.first.field('body');
          setState(() => _loaded = true);
        })
        .catchError((_) {
          if (mounted) setState(() => _loaded = true);
        });
  }

  @override
  void dispose() {
    _saver.flush();
    _saver.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    if (_body.text.trim().isEmpty) {
      showAppToast(context, 'Write a few words first');
      return;
    }
    await _saver.flush();
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ReadingScreen(
          backLabel: 'Keep writing',
          eyebrow: 'Your letter · only you can see it',
          title: 'A letter, just for them',
          paragraphs: _body.text.trim().split(RegExp(r'\n\s*\n')),
          shareTitle: 'A letter, just for you',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cues = widget.topic.strings('letterCues');
    return CarePage(
      backLabel: widget.topic.name,
      children: [
        const CareEyebrow('Something to do · on your own'),
        const SizedBox(height: 10),
        const CareHeading('A letter,\njust for them.', size: 28),
        const SizedBox(height: 8),
        const CareCopy(
          'A few honest lines can be enough. Keep it for yourself, or share it when you choose.',
        ),
        const SizedBox(height: 18),
        if (cues.isNotEmpty)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: CareColors.peach,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CareEyebrow(
                  'A few places to begin',
                  color: CareColors.clay,
                ),
                const SizedBox(height: 8),
                for (final c in cues)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text(
                      c,
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: CareColors.ink,
                        fontSize: 14,
                        height: 1.5,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        const SizedBox(height: 16),
        if (!_loaded)
          const CareSpinner()
        else ...[
          KeptField(
            label: 'Your letter',
            controller: _body,
            hint: 'Dear you,',
            minLines: 8,
            onChanged: () {
              setState(() => _saved = false);
              _saver.schedule({'body': _body.text});
            },
          ),
          const SizedBox(height: 8),
          KeptNote(saved: _saved),
          const SizedBox(height: 14),
          CarePrimaryButton(
            'Finish for now',
            icon: Icons.check_rounded,
            onTap: _finish,
          ),
          const SizedBox(height: 8),
          if (_body.text.trim().isNotEmpty)
            Center(
              child: ShareLink(
                title: 'A letter, just for you',
                text: _body.text,
              ),
            ),
        ],
      ],
    );
  }
}

/// A short lesson: its storyboard or clip, a starter to try, and the next one.
class _ShortScreen extends StatelessWidget {
  const _ShortScreen({
    required this.topic,
    required this.shorts,
    required this.index,
    required this.catalog,
  });

  final HelpTopic topic;
  final List<Map<String, dynamic>> shorts;
  final int index;
  final CareCatalog catalog;

  @override
  Widget build(BuildContext context) {
    final s = shorts[index];
    final id = '${s['id']}';
    final starters = topic.list('starters');
    return StoryboardScreen(
      backLabel: topic.name,
      eyebrow: '${s['topic']} · ${s['time']}',
      title: '${s['title']}',
      meta: '${s['cover']}',
      frames: [
        for (final f in (s['frames'] as List<dynamic>? ?? const []))
          [for (final x in (f as List<dynamic>)) '$x'],
      ],
      url: (s['url'] as String?) ?? catalog.topicVideos[id],
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: CareColors.peach,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CareEyebrow(
                  'Try the conversation starter',
                  color: CareColors.clay,
                ),
                const SizedBox(height: 8),
                Text(
                  '“${s['try']}”',
                  style: const TextStyle(
                    fontFamily: careFont,
                    color: CareColors.ink,
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 6),
                if (starters.isNotEmpty)
                  CareLink(
                    'Open it',
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => _OpenerScreen(
                          category: starters.last,
                          starter: '${s['try']}',
                          backLabel: '${s['title']}',
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (index + 1 < shorts.length) ...[
            const SizedBox(height: 14),
            CarePrimaryButton(
              'Next short',
              icon: Icons.arrow_forward_rounded,
              onTap: () => Navigator.of(context).pushReplacement(
                MaterialPageRoute(
                  builder: (_) => _ShortScreen(
                    topic: topic,
                    shorts: shorts,
                    index: index + 1,
                    catalog: catalog,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
