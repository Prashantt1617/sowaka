import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../care/data/care_api_service.dart';
import '../../../care/data/care_models.dart';
import '../../../care/presentation/care_theme.dart';
import '../../../care/presentation/share_writing.dart';
import '../../../shared/app_toast.dart';
import '../../data/help_topics.dart';
import 'topic_widgets.dart';

/// New parenthood: stories to read and one of your own, letters to a child,
/// two collections open to everyone, and short video concepts.
class ParentsTopicScreen extends StatefulWidget {
  const ParentsTopicScreen({
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
  State<ParentsTopicScreen> createState() => _ParentsTopicScreenState();
}

class _ParentsTopicScreenState extends State<ParentsTopicScreen> {
  String _category = 'Rest';
  int _letters = 0;

  @override
  void initState() {
    super.initState();
    _countLetters();
  }

  Future<void> _countLetters() async {
    try {
      final rows = await widget.care.writings('letter:');
      if (mounted) setState(() => _letters = rows.length);
    } catch (_) {}
  }

  Future<void> _push(Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
    if (mounted) _countLetters();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.topic;
    final stories = t.list('stories');
    final videos = t.list('videos');
    final collections =
        t.content['collections'] as Map<String, dynamic>? ?? const {};
    final prompts = t.strings('letterPrompts');
    final categories = <String>[];
    for (final v in videos) {
      final c = '${v['category']}';
      if (!categories.contains(c)) categories.add(c);
    }
    final shown = [
      for (final v in videos)
        if ('${v['category']}' == _category) v,
    ];
    final featured = stories.isEmpty ? null : stories.first;
    return CarePage(
      backLabel: widget.backLabel,
      children: [
        // The app's bar already names the page on the web.
        if (!careWebPages) ...[CareEyebrow(t.name), const SizedBox(height: 10)],
        CareHeading(
          t.text('title', 'You’re growing into this, too.'),
          size: 30,
        ),
        const SizedBox(height: 8),
        CareCopy(t.text('lede', t.intro)),
        const SizedBox(height: 26),
        Row(
          children: [
            const Expanded(
              child: CareSectionTitle('Parenthood, honestly', size: 18),
            ),
            if (stories.length > 1)
              CareLink(
                'More stories',
                onTap: () => _push(_StoriesScreen(topic: t, care: widget.care)),
              ),
          ],
        ),
        const SizedBox(height: 4),
        const CareCopy(
          'Room for the feelings you don’t always say aloud.',
          size: 12.5,
        ),
        const SizedBox(height: 12),
        if (featured != null)
          TopicBanner(
            color: CareColors.sage,
            eyebrow: 'A story to sit with',
            title: '${featured['title']}',
            copy: '${featured['teaser']} · Fictional example',
            action: 'Read the story',
            icon: Icons.format_quote_rounded,
            onTap: () => _push(_StoryRead(story: featured, backLabel: t.name)),
          ),
        const SizedBox(height: 10),
        CarePrimaryButton(
          'Write my story',
          icon: Icons.edit_outlined,
          onTap: () => _push(_StoryWrite(care: widget.care, backLabel: t.name)),
        ),
        const SizedBox(height: 26),
        TopicBanner(
          color: CareColors.peach,
          eyebrow: 'Dear little one',
          title: 'What happened today?',
          copy: prompts.isEmpty
              ? 'These days move quickly. Keep one piece of today.'
              : 'These days move quickly. Keep one piece of today.\n“${prompts.first}”',
          action: 'Write today’s letter',
          icon: Icons.mail_outline_rounded,
          onTap: () => _push(
            _LetterWrite(
              care: widget.care,
              prompts: prompts,
              backLabel: t.name,
            ),
          ),
        ),
        const SizedBox(height: 6),
        Center(
          child: CareLink(
            _letters == 0 ? 'Your letters' : 'Your letters so far ($_letters)',
            onTap: () => _push(
              _LettersList(
                care: widget.care,
                prompts: prompts,
                backLabel: t.name,
              ),
            ),
          ),
        ),
        const SizedBox(height: 26),
        const CareSectionTitle('A little space for you', size: 18),
        const SizedBox(height: 4),
        const CareCopy('Explore whichever feels useful today.', size: 12.5),
        const SizedBox(height: 12),
        for (final entry in collections.entries) ...[
          TopicBanner(
            color: entry.key == 'mother' ? CareColors.lilac : CareColors.sky,
            eyebrow: '${(entry.value as Map)['label'] ?? ''}',
            title: '${(entry.value as Map)['title'] ?? ''}',
            copy: '${(entry.value as Map)['copy'] ?? ''}',
            action: 'Open',
            icon: entry.key == 'mother'
                ? Icons.volunteer_activism_outlined
                : Icons.eco_outlined,
            onTap: () => _push(
              entry.key == 'mother'
                  ? _MotherScreen(
                      topic: t,
                      care: widget.care,
                      collection: entry.value as Map<String, dynamic>,
                    )
                  : _DadScreen(
                      topic: t,
                      care: widget.care,
                      collection: entry.value as Map<String, dynamic>,
                    ),
            ),
          ),
          const SizedBox(height: 10),
        ],
        const SizedBox(height: 16),
        const CareSectionTitle('What would help today?', size: 18),
        const SizedBox(height: 4),
        const CareCopy(
          'Small moments of rest, movement, and understanding.',
          size: 12.5,
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final c in categories)
              CareChoiceChip(
                c,
                selected: c == _category,
                onTap: () => setState(() => _category = c),
              ),
          ],
        ),
        const SizedBox(height: 12),
        for (final v in shown)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: CareResourceRow(
              title: '${v['title']}',
              meta: '${v['duration']} · ${v['label']}',
              icon: Icons.play_circle_outline_rounded,
              tint: CareColors.sky,
              onTap: () => _push(videoScreen(v, t.name, widget.catalog)),
            ),
          ),
      ],
    );
  }
}

/// A video concept: the clip when the catalogue has one, its storyboard otherwise.
Widget videoScreen(
  Map<String, dynamic> v,
  String backLabel,
  CareCatalog catalog,
) {
  final id = '${v['id']}';
  return StoryboardScreen(
    backLabel: backLabel,
    eyebrow: '${v['category'] ?? 'Video'}',
    title: '${v['title']}',
    meta: '${v['duration']} · ${v['label']}',
    frames: [
      for (final f in (v['frames'] as List<dynamic>? ?? const []))
        [for (final s in (f is List ? f : const [])) '$s'],
    ],
    url: (v['url'] as String?) ?? catalog.topicVideos[id],
  );
}

class _StoriesScreen extends StatelessWidget {
  const _StoriesScreen({required this.topic, required this.care});

  final HelpTopic topic;
  final CareApiService care;

  @override
  Widget build(BuildContext context) {
    return CarePage(
      backLabel: topic.name,
      children: [
        const CareEyebrow('Parenthood, honestly'),
        const SizedBox(height: 10),
        const CareHeading('Stories to sit with.', size: 28),
        const SizedBox(height: 8),
        const CareCopy(
          'Fictional examples, written to make room for what is rarely said aloud.',
        ),
        const SizedBox(height: 18),
        for (final s in topic.list('stories'))
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: CareResourceRow(
              title: '${s['title']}',
              meta: '${s['teaser']} · Fictional example',
              icon: Icons.format_quote_rounded,
              tint: CareColors.sage,
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => _StoryRead(story: s, backLabel: 'Stories'),
                ),
              ),
            ),
          ),
        const SizedBox(height: 10),
        CarePrimaryButton(
          'Write my story',
          icon: Icons.edit_outlined,
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => _StoryWrite(care: care, backLabel: 'Stories'),
            ),
          ),
        ),
      ],
    );
  }
}

class _StoryRead extends StatelessWidget {
  const _StoryRead({required this.story, required this.backLabel});

  final Map<String, dynamic> story;
  final String backLabel;

  @override
  Widget build(BuildContext context) => ReadingScreen(
    backLabel: backLabel,
    eyebrow: 'Fictional example · 1 min read',
    title: '${story['title']}',
    meta: '${story['teaser']}',
    paragraphs: [
      for (final p in (story['body'] as List<dynamic>? ?? const [])) '$p',
    ],
  );
}

/// One story of your own, kept privately; edit it any time.
class _StoryWrite extends StatefulWidget {
  const _StoryWrite({required this.care, required this.backLabel});

  final CareApiService care;
  final String backLabel;

  @override
  State<_StoryWrite> createState() => _StoryWriteState();
}

class _StoryWriteState extends State<_StoryWrite> {
  final _title = TextEditingController();
  final _body = TextEditingController();
  bool _loaded = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    widget.care
        .writings('story:main')
        .then((rows) {
          if (!mounted) return;
          if (rows.isNotEmpty) {
            _title.text = rows.first.field('title');
            _body.text = rows.first.field('body');
          }
          setState(() => _loaded = true);
        })
        .catchError((_) {
          if (mounted) setState(() => _loaded = true);
        });
  }

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _keep() async {
    if (_body.text.trim().isEmpty) {
      showAppToast(context, 'Write a few words first');
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.care.putWriting('story:main', {
        'title': _title.text.trim(),
        'body': _body.text.trim(),
      });
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => ReadingScreen(
            backLabel: 'Write my story',
            eyebrow: 'Your story · private',
            title: _title.text.trim().isEmpty ? 'My story' : _title.text.trim(),
            paragraphs: _body.text.trim().split(RegExp(r'\n\s*\n')),
            shareTitle: _title.text.trim().isEmpty
                ? 'My story'
                : _title.text.trim(),
          ),
        ),
      );
    } catch (error) {
      if (mounted)
        showAppToast(
          context,
          error is CareApiException
              ? error.message
              : 'Could not keep it. Try again.',
        );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return CarePage(
      backLabel: widget.backLabel,
      children: [
        const CareEyebrow('Your experience, in your words'),
        const SizedBox(height: 10),
        const CareHeading('Where would you like to begin?', size: 28),
        const SizedBox(height: 8),
        const CareCopy(
          '“Something I didn’t expect about becoming a parent was…”',
        ),
        const SizedBox(height: 20),
        if (!_loaded)
          const CareSpinner()
        else ...[
          KeptField(
            label: 'Give it a title (optional)',
            controller: _title,
            hint: 'A little piece of my experience',
            minLines: 1,
          ),
          const SizedBox(height: 16),
          KeptField(
            label: 'Your story',
            controller: _body,
            hint: 'There’s no right way to tell it…',
            minLines: 8,
          ),
          const SizedBox(height: 14),
          CarePrimaryButton(
            'Keep it private',
            icon: Icons.lock_outline_rounded,
            busy: _saving,
            onTap: _keep,
          ),
          const SizedBox(height: 10),
          const KeptNote(),
        ],
      ],
    );
  }
}

/// The letters, newest first.
class _LettersList extends StatefulWidget {
  const _LettersList({
    required this.care,
    required this.prompts,
    required this.backLabel,
  });

  final CareApiService care;
  final List<String> prompts;
  final String backLabel;

  @override
  State<_LettersList> createState() => _LettersListState();
}

class _LettersListState extends State<_LettersList> {
  List<CareWriting>? _rows;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = await widget.care.writings('letter:');
      if (mounted) setState(() => _rows = sortedNewest(rows));
    } catch (error) {
      if (mounted)
        setState(
          () => _error = error is CareApiException
              ? error.message
              : 'Could not load your letters.',
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return CarePage(
      backLabel: widget.backLabel,
      children: [
        const CareEyebrow('Dear little one'),
        const SizedBox(height: 10),
        const CareHeading('A little collection\nof your days.', size: 28),
        const SizedBox(height: 8),
        const CareCopy(
          'For the moments you want to remember. Write whenever you feel like it.',
        ),
        const SizedBox(height: 18),
        CarePrimaryButton(
          'Write a letter',
          icon: Icons.edit_outlined,
          onTap: () async {
            await Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => _LetterWrite(
                  care: widget.care,
                  prompts: widget.prompts,
                  backLabel: 'Your letters',
                ),
              ),
            );
            _load();
          },
        ),
        const SizedBox(height: 20),
        if (_error case final m?)
          CareNotice(m, onRetry: _load)
        else if (rows == null)
          const CareSpinner()
        else if (rows.isEmpty)
          const CareCopy(
            'Your first letter can begin today. A funny face. A sleepy afternoon. Something you’re learning together.',
          )
        else
          for (final w in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: CareResourceRow(
                title: w.field('subject').isEmpty
                    ? 'A little piece of today'
                    : w.field('subject'),
                meta:
                    '${longDate(w.createdAt)} · ${w.field('body').replaceAll('\n', ' ').substring(0, w.field('body').length.clamp(0, 60))}${w.field('body').length > 60 ? '…' : ''}',
                icon: Icons.mail_outline_rounded,
                tint: CareColors.peach,
                onTap: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => _LetterRead(care: widget.care, letter: w),
                    ),
                  );
                  _load();
                },
              ),
            ),
      ],
    );
  }
}

class _LetterRead extends StatelessWidget {
  const _LetterRead({required this.care, required this.letter});

  final CareApiService care;
  final CareWriting letter;

  @override
  Widget build(BuildContext context) {
    final subject = letter.field('subject').isEmpty
        ? 'A little piece of today'
        : letter.field('subject');
    return ReadingScreen(
      backLabel: 'Your letters',
      eyebrow: 'Dear little one · ${longDate(letter.createdAt)}',
      title: subject,
      meta: letter.field('prompt').isEmpty ? null : letter.field('prompt'),
      paragraphs: letter.field('body').split(RegExp(r'\n\s*\n')),
      shareTitle: subject,
      footer: Center(
        child: TextButton(
          onPressed: () async {
            try {
              await care.deleteWriting(letter.key);
              if (context.mounted) Navigator.of(context).pop();
            } catch (_) {
              if (context.mounted)
                showAppToast(context, 'Could not remove it. Try again.');
            }
          },
          child: const Text(
            'Remove this letter',
            style: TextStyle(
              fontFamily: careFont,
              color: CareColors.muted,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}

/// A dated letter: a subject, a body, a prompt to start from.
class _LetterWrite extends StatefulWidget {
  const _LetterWrite({
    required this.care,
    required this.prompts,
    required this.backLabel,
    this.openingPrompt,
  });

  final CareApiService care;
  final List<String> prompts;
  final String backLabel;
  final String? openingPrompt;

  @override
  State<_LetterWrite> createState() => _LetterWriteState();
}

class _LetterWriteState extends State<_LetterWrite> {
  final _subject = TextEditingController();
  final _body = TextEditingController();
  int _prompt = 0;
  bool _saving = false;

  String get _promptText =>
      widget.openingPrompt ??
      (widget.prompts.isEmpty
          ? 'Something you did today that I want to remember…'
          : widget.prompts[_prompt % widget.prompts.length]);

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _keep() async {
    if (_body.text.trim().isEmpty) {
      showAppToast(context, 'Write a few words first');
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.care.putWriting(
        'letter:${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}-${math.Random().nextInt(1 << 30).toRadixString(36)}',
        {
          'subject': _subject.text.trim().isEmpty
              ? 'A little piece of today'
              : _subject.text.trim(),
          'body': _body.text.trim(),
          'prompt': _promptText,
          'date': DateTime.now().toIso8601String(),
        },
      );
      if (!mounted) return;
      showAppToast(context, 'Kept in your letters');
      Navigator.of(context).pop();
    } catch (error) {
      if (mounted)
        showAppToast(
          context,
          error is CareApiException
              ? error.message
              : 'Could not keep it. Try again.',
        );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return CarePage(
      backLabel: widget.backLabel,
      children: [
        CareEyebrow('Dear little one · ${longDate(DateTime.now())}'),
        const SizedBox(height: 10),
        const CareHeading('A little piece\nof today.', size: 28),
        const SizedBox(height: 8),
        const CareCopy(
          'An ordinary moment now. A memory for your child, someday.',
        ),
        const SizedBox(height: 18),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: CareColors.peach,
            borderRadius: BorderRadius.circular(18),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const CareEyebrow('A place to begin', color: CareColors.clay),
              const SizedBox(height: 8),
              Text(
                _promptText,
                style: const TextStyle(
                  fontFamily: careFont,
                  color: CareColors.ink,
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                  height: 1.4,
                ),
              ),
              if (widget.openingPrompt == null &&
                  widget.prompts.length > 1) ...[
                const SizedBox(height: 6),
                CareLink(
                  'Another prompt',
                  icon: Icons.shuffle_rounded,
                  onTap: () => setState(() => _prompt++),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 16),
        KeptField(
          label: 'Subject',
          controller: _subject,
          hint: 'A little piece of today',
          minLines: 1,
        ),
        const SizedBox(height: 16),
        KeptField(
          label: 'Your letter',
          controller: _body,
          hint: 'Dear little one, today…',
          minLines: 7,
        ),
        const SizedBox(height: 14),
        CarePrimaryButton(
          'Keep in my letters',
          icon: Icons.mail_outline_rounded,
          busy: _saving,
          onTap: _keep,
        ),
        const SizedBox(height: 10),
        const KeptNote(),
      ],
    );
  }
}

/// Me, alongside motherhood: two free fields, kept, then recommended videos.
class _MotherScreen extends StatefulWidget {
  const _MotherScreen({
    required this.topic,
    required this.care,
    required this.collection,
  });

  final HelpTopic topic;
  final CareApiService care;
  final Map<String, dynamic> collection;

  @override
  State<_MotherScreen> createState() => _MotherScreenState();
}

class _MotherScreenState extends State<_MotherScreen> {
  final _feel = TextEditingController();
  final _need = TextEditingController();
  late final KeptSaver _saver = KeptSaver(
    care: widget.care,
    key: 'mother:main',
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
        .writings('mother:main')
        .then((rows) {
          if (!mounted) return;
          if (rows.isNotEmpty) {
            _feel.text = rows.first.field('feel');
            _need.text = rows.first.field('need');
          }
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
    _feel.dispose();
    _need.dispose();
    super.dispose();
  }

  void _changed() {
    setState(() => _saved = false);
    _saver.schedule({'feel': _feel.text, 'need': _need.text});
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.topic;
    final prompts =
        t.content['motherPrompts'] as Map<String, dynamic>? ?? const {};
    final videos = t.list('videos');
    final picks = [
      for (final i
          in (widget.collection['videos'] as List<dynamic>? ?? const []))
        if ((i as num).toInt() < videos.length) videos[(i).toInt()],
    ];
    return CarePage(
      backLabel: t.name,
      children: [
        CareEyebrow('${widget.collection['label'] ?? 'For mothers'}'),
        const SizedBox(height: 10),
        CareHeading(
          '${widget.collection['title'] ?? 'Me, alongside motherhood'}',
          size: 28,
        ),
        const SizedBox(height: 8),
        CareCopy('${widget.collection['copy'] ?? ''}'),
        const SizedBox(height: 20),
        if (!_loaded)
          const CareSpinner()
        else ...[
          KeptField(
            label: '${prompts['feel'] ?? 'How do you feel?'}',
            controller: _feel,
            hint: 'In your own words…',
            onChanged: _changed,
          ),
          const SizedBox(height: 16),
          KeptField(
            label: '${prompts['need'] ?? 'What do you need?'}',
            controller: _need,
            hint: 'Company, practical help, a quieter room, time to rest…',
            onChanged: _changed,
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: KeptNote(saved: _saved)),
              if (_feel.text.trim().isNotEmpty || _need.text.trim().isNotEmpty)
                ShareLink(
                  title: 'Me, alongside motherhood',
                  text:
                      'How do you feel?\n${_feel.text}\n\nWhat do you need?\n${_need.text}',
                ),
            ],
          ),
        ],
        if (picks.isNotEmpty) ...[
          const SizedBox(height: 26),
          const CareSectionTitle('Recommended for you', size: 17),
          const SizedBox(height: 12),
          for (final v in picks)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: CareResourceRow(
                title: '${v['title']}',
                meta: '${v['duration']} · ${v['label']}',
                icon: Icons.play_circle_outline_rounded,
                tint: CareColors.sky,
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => videoScreen(
                      v,
                      '${widget.collection['title']}',
                      const CareCatalog(),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ],
    );
  }
}

/// Finding my way as Dad: everyday moments, each with a prompt that opens the letter.
class _DadScreen extends StatefulWidget {
  const _DadScreen({
    required this.topic,
    required this.care,
    required this.collection,
  });

  final HelpTopic topic;
  final CareApiService care;
  final Map<String, dynamic> collection;

  @override
  State<_DadScreen> createState() => _DadScreenState();
}

class _DadScreenState extends State<_DadScreen> {
  int _open = -1;

  @override
  Widget build(BuildContext context) {
    final t = widget.topic;
    final moments = t.list('moments');
    final stories = t.list('stories');
    final videos = t.list('videos');
    final storyIndex = (widget.collection['story'] as num?)?.toInt();
    final story = storyIndex != null && storyIndex < stories.length
        ? stories[storyIndex]
        : null;
    final picks = [
      for (final i
          in (widget.collection['videos'] as List<dynamic>? ?? const []))
        if ((i as num).toInt() < videos.length) videos[(i).toInt()],
    ];
    return CarePage(
      backLabel: t.name,
      children: [
        CareEyebrow('${widget.collection['label'] ?? 'For fathers'}'),
        const SizedBox(height: 10),
        CareHeading(
          '${widget.collection['title'] ?? 'Finding my way as Dad'}',
          size: 28,
        ),
        const SizedBox(height: 8),
        CareCopy('${widget.collection['copy'] ?? ''}'),
        const SizedBox(height: 24),
        const CareSectionTitle('A moment that’s ours', size: 18),
        const SizedBox(height: 4),
        const CareCopy(
          'Pick an everyday moment. A few words about it become a letter.',
          size: 12.5,
        ),
        const SizedBox(height: 12),
        for (var i = 0; i < moments.length; i++) ...[
          Material(
            color: _open == i ? CareColors.blueTint : Colors.white,
            borderRadius: BorderRadius.circular(16),
            child: InkWell(
              onTap: () => setState(() => _open = _open == i ? -1 : i),
              borderRadius: BorderRadius.circular(16),
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: _open == i ? CareColors.blue : CareColors.line,
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${moments[i]['moment']}',
                      style: const TextStyle(
                        fontFamily: careFont,
                        color: CareColors.ink,
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (_open == i) ...[
                      const SizedBox(height: 8),
                      CareCopy(
                        '${moments[i]['prompt']}',
                        size: 14,
                        color: CareColors.ink,
                      ),
                      const SizedBox(height: 8),
                      CareLink(
                        'Write a few words',
                        icon: Icons.edit_outlined,
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => _LetterWrite(
                              care: widget.care,
                              prompts: t.strings('letterPrompts'),
                              backLabel: 'Finding my way as Dad',
                              openingPrompt: '${moments[i]['prompt']}',
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
        ],
        if (story != null) ...[
          const SizedBox(height: 18),
          TopicBanner(
            color: CareColors.sage,
            eyebrow: 'A story to sit with',
            title: '${story['title']}',
            copy: '${story['teaser']} · Fictional example',
            action: 'Read the story',
            icon: Icons.format_quote_rounded,
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => _StoryRead(
                  story: story,
                  backLabel: 'Finding my way as Dad',
                ),
              ),
            ),
          ),
        ],
        if (picks.isNotEmpty) ...[
          const SizedBox(height: 24),
          const CareSectionTitle('Recommended for you', size: 17),
          const SizedBox(height: 12),
          for (final v in picks)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: CareResourceRow(
                title: '${v['title']}',
                meta: '${v['duration']} · ${v['label']}',
                icon: Icons.play_circle_outline_rounded,
                tint: CareColors.sky,
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => videoScreen(
                      v,
                      '${widget.collection['title']}',
                      const CareCatalog(),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ],
    );
  }
}
