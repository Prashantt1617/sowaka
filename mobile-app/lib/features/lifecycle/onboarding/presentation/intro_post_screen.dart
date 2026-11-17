import 'dart:async';

import 'package:flutter/material.dart';

import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import 'onboarding_kit.dart';

/// A5 · Introduce yourself (6Zs §5.3): a photo, one line (80 characters)
/// and up to three fun facts → a preview in the Connect new-joiner style →
/// Post to Connect (the server makes the post and tells the manager to say
/// hi). Edit from the preview goes back.
class IntroPostScreen extends StatefulWidget {
  const IntroPostScreen({super.key, required this.shell});

  final OnboardingShell shell;

  static const funFactChoices = [
    '☕ Chai over coffee',
    '🥾 Weekend trekker',
    '🎸 Plays guitar',
    '🏏 Cricket on Sundays',
    '📚 Bookworm',
    '🍜 Foodie',
    '🎮 Gamer',
    '🐶 Dog person',
  ];

  @override
  State<IntroPostScreen> createState() => _IntroPostScreenState();
}

enum _IntroView { questions, preview, posted }

class _IntroPostScreenState extends State<IntroPostScreen> {
  IntroPost? _intro;
  String? _error;
  _IntroView _view = _IntroView.questions;
  final _line = TextEditingController();
  final Set<String> _facts = {};
  String? _photo;
  bool _busy = false;

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _line.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final intro = await _shell.api.fetchIntro();
      if (!mounted) return;
      setState(() {
        _intro = intro;
        _error = null;
        _line.text = intro.line;
        _facts
          ..clear()
          ..addAll(intro.funFacts);
        _photo = intro.photoKey ?? _shell.viewerPhotoUrl;
        _view = intro.posted ? _IntroView.posted : _IntroView.questions;
      });
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    }
  }

  IntroPost get _draft => IntroPost(photoKey: _photo, line: _line.text.trim(), funFacts: _facts.toList());

  Future<void> _changePhoto() async {
    final change = _shell.changePhoto;
    if (change == null) return;
    final url = await change(context);
    if (url != null && mounted) {
      setState(() => _photo = url);
      _shell.viewerPhotoUrl = url;
    }
  }

  Future<void> _preview() async {
    setState(() => _busy = true);
    try {
      final saved = await _shell.api.saveIntro(_draft);
      if (mounted) {
        setState(() {
          _intro = saved;
          _view = _IntroView.preview;
        });
      }
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _post() async {
    setState(() => _busy = true);
    try {
      final posted = await _shell.api.postIntro();
      if (mounted) {
        setState(() {
          _intro = posted.posted ? posted : IntroPost(
            photoKey: _photo,
            line: _draft.line,
            funFacts: _draft.funFacts,
            postedAt: _shell.now(),
            connectPostId: posted.connectPostId,
          );
          _view = _IntroView.posted;
        });
      }
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_intro == null) {
      return OnbScaffold(shell: _shell, title: 'Introduce yourself', body: OnbLoadState(error: _error, onRetry: _load));
    }
    final (body, footer) = switch (_view) {
      _IntroView.questions => (
        _questions(),
        OnbPrimaryButton(
          key: const ValueKey('intro-preview'),
          label: 'Preview post',
          busy: _busy,
          onTap: _line.text.trim().isEmpty ? null : _preview,
        ),
      ),
      _IntroView.preview => (
        _previewView(),
        Row(
          children: [
            Expanded(
              child: OnbSecondaryButton(label: 'Edit', onTap: _busy ? null : () => setState(() => _view = _IntroView.questions)),
            ),
            const SizedBox(width: 10),
            Expanded(
              flex: 2,
              child: OnbPrimaryButton(key: const ValueKey('intro-post'), label: 'Post to Connect', busy: _busy, onTap: _post),
            ),
          ],
        ),
      ),
      _IntroView.posted => (
        _postedView(),
        OnbPrimaryButton(label: 'Back to onboarding', onTap: () => Navigator.of(context).pop()),
      ),
    };
    return OnbScaffold(
      shell: _shell,
      title: 'Introduce yourself',
      showNav: false,
      body: Column(
        children: [
          if (_view != _IntroView.posted)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
              child: OnbStoryBar(count: 2, current: _view == _IntroView.questions ? 0 : 1),
            ),
          Expanded(child: body),
        ],
      ),
      footer: OnbFooter(children: [footer]),
    );
  }

  Widget _questions() {
    final choices = {...IntroPostScreen.funFactChoices, ..._facts}.toList();
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
      children: [
        const Text('Say hello to your team', style: OnbText.display),
        const SizedBox(height: 4),
        const Text('This becomes your welcome post on Connect.', style: OnbText.body),
        const SizedBox(height: 18),
        Row(
          children: [
            OnbAvatar(name: _shell.viewerName, photoUrl: _photo, size: 64),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_shell.viewerName, style: OnbText.bodyStrong),
                  Text(_roleLine, style: OnbText.label),
                  if (_shell.changePhoto != null)
                    OnbLink(
                      label: _photo == null ? 'Add photo' : 'Change photo',
                      icon: Icons.photo_camera_outlined,
                      onTap: _changePhoto,
                    ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 18),
        const Text('One line about you', style: OnbText.bodyStrong),
        const SizedBox(height: 8),
        OnbTextArea(
          fieldKey: const ValueKey('intro-line'),
          controller: _line,
          hint: 'Designer who sketches on trains',
          minLines: 1,
          maxLength: IntroPost.maxLine,
          onChanged: (_) => setState(() {}),
        ),
        Align(
          alignment: Alignment.centerRight,
          child: Text('${_line.text.length}/${IntroPost.maxLine}', style: OnbText.label),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            const Expanded(child: Text('Fun facts', style: OnbText.bodyStrong)),
            Text('${_facts.length} of ${IntroPost.maxFacts}', style: OnbText.label),
          ],
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final fact in choices)
              FilterChip(
                label: Text(fact, style: const TextStyle(fontFamily: 'Sora', fontSize: 13)),
                selected: _facts.contains(fact),
                showCheckmark: false,
                selectedColor: OnbColors.tint,
                backgroundColor: Colors.white,
                side: BorderSide(color: _facts.contains(fact) ? OnbColors.primary : OnbColors.line),
                shape: const StadiumBorder(),
                onSelected: (on) => setState(() {
                  if (!on) {
                    _facts.remove(fact);
                  } else if (_facts.length < IntroPost.maxFacts) {
                    _facts.add(fact);
                  } else {
                    showAppToast(context, 'Pick up to ${IntroPost.maxFacts}');
                  }
                }),
              ),
          ],
        ),
      ],
    );
  }

  String get _roleLine => [
    ?_shell.viewerDesignation,
    if (_shell.viewerDepartment != null) '${_shell.viewerDepartment} team',
  ].join(' · ');

  Widget _previewView() => ListView(
    padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
    children: [
      const Text('Your welcome post', style: OnbText.display),
      const SizedBox(height: 4),
      const Text('This is how your team will see it.', style: OnbText.body),
      const SizedBox(height: 16),
      _PostCard(shell: _shell, intro: _draft),
    ],
  );

  Widget _postedView() {
    final intro = _intro!;
    final postId = intro.connectPostId;
    return ListView(
      key: const ValueKey('intro-posted'),
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
      children: [
        const Align(alignment: Alignment.centerLeft, child: OnbTag('Posted', tone: OnbTone.done, icon: Icons.check_rounded)),
        const SizedBox(height: 12),
        _PostCard(shell: _shell, intro: intro),
        if (intro.likes != null || intro.commentCount != null) ...[
          const SizedBox(height: 10),
          Row(
            key: const ValueKey('intro-counts'),
            children: [
              const Icon(Icons.favorite_border_rounded, size: 18, color: OnbColors.icon),
              const SizedBox(width: 4),
              Text('${intro.likes ?? 0}', style: OnbText.bodyStrong),
              const SizedBox(width: 16),
              const Icon(Icons.mode_comment_outlined, size: 18, color: OnbColors.icon),
              const SizedBox(width: 4),
              Text('${intro.commentCount ?? 0}', style: OnbText.bodyStrong),
            ],
          ),
        ],
        for (final comment in intro.comments)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                OnbAvatar(name: comment.name, size: 32),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(comment.name, style: OnbText.bodyStrong),
                      Text(comment.text, style: OnbText.body),
                    ],
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 12),
        if (postId != null && _shell.openPost != null)
          OnbLink(
            label: intro.commentCount == null ? 'See it on Connect' : 'Reply on Connect',
            icon: Icons.open_in_new_rounded,
            onTap: () {
              Navigator.of(context).popUntil((route) => route.isFirst);
              _shell.openPost!(postId);
            },
          ),
      ],
    );
  }
}

/// The Connect new-joiner post as the team sees it: NEW JOINER chip, the
/// photo, name, role, team and joining month, the line in a bubble, the
/// fun facts, Say Hi.
class _PostCard extends StatelessWidget {
  const _PostCard({required this.shell, required this.intro});

  final OnboardingShell shell;
  final IntroPost intro;

  @override
  Widget build(BuildContext context) {
    final joined = onbMonthYear(shell.now());
    return OnbCard(
      key: const ValueKey('intro-card'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const OnbTag('⭐ NEW JOINER', tone: OnbTone.mustDo),
          const SizedBox(height: 14),
          Row(
            children: [
              OnbAvatar(name: shell.viewerName, photoUrl: intro.photoKey, size: 52),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(shell.viewerName, style: OnbText.bodyStrong),
                    if (shell.viewerDesignation != null) Text(shell.viewerDesignation!, style: OnbText.label),
                    Text(
                      [?shell.viewerDepartment, 'Joined $joined'].join(' · '),
                      style: OnbText.label,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: OnbColors.tint, borderRadius: BorderRadius.circular(16)),
            child: Text(
              // Word for word what Connect posts (the server's rule).
              intro.line.trim().isEmpty ? 'Hey everyone! Excited to meet you all 🙌' : IntroPost.messageFor(intro.line),
              style: OnbText.body.copyWith(color: OnbColors.text),
            ),
          ),
          if (intro.funFacts.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(spacing: 6, runSpacing: 6, children: [for (final fact in intro.funFacts) OnbTag(fact)]),
          ],
          const SizedBox(height: 14),
          const OnbTag('Say Hi 👋', tone: OnbTone.count),
        ],
      ),
    );
  }
}
