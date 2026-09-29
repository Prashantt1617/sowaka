import 'package:flutter/material.dart';

import '../../care/presentation/care_theme.dart';
import '../../shared/app_toast.dart';
import '../../talk/data/talk_api_service.dart';
import '../data/help_api_service.dart';
import '../data/help_models.dart';
import 'help_widgets.dart';

/// The first open of Help: four questions, each skippable, then a starting
/// point. Also how the answers are edited later, from Help home.
class HelpOnboarding extends StatefulWidget {
  const HelpOnboarding({
    super.key,
    required this.service,
    required this.onDone,
    this.initial,
    this.startOnReview = false,
    this.onCancel,
  });

  final HelpApiService service;

  /// Called once the person leaves the result for Help home.
  final VoidCallback onDone;

  /// Existing answers, when editing.
  final HelpIntake? initial;

  /// Open on the answer review rather than question one.
  final bool startOnReview;

  /// Back out of editing without saving.
  final VoidCallback? onCancel;

  @override
  State<HelpOnboarding> createState() => _HelpOnboardingState();
}

enum _Screen { questions, result, review }

class _HelpOnboardingState extends State<HelpOnboarding> {
  late HelpIntake _intake = widget.initial ?? HelpIntake.empty;
  late _Screen _screen = widget.startOnReview ? _Screen.review : _Screen.questions;
  int _step = 0;
  bool _editing = false;
  String _message = '';
  bool _saving = false;
  HelpMatchResult? _result;

  static const _labels = ['Your world', 'What’s difficult', 'Your direction', 'Your comfort'];
  static const _questions = [
    'What would you like\nto talk about?',
    'What would you like\nhelp with?',
    'What would you like\nto work towards?',
    'Who would you feel\ncomfortable talking to?',
  ];
  static const _subtitles = [
    'A few things on your mind, or just one.\nYou don’t need to have it all figured out.',
    'What feels hardest about it right now?\nChoose what comes closest.',
    'Start with what matters most to you.\nIt’s okay if this changes.',
    'Share any preferences, or leave them open.\nThese are preferences about your counsellor.',
  ];

  bool get _canContinue => switch (_step) {
    0 => _intake.topics.isNotEmpty,
    1 => _intake.needs.isNotEmpty,
    2 => _intake.goal.isNotEmpty,
    _ => true,
  };

  void _pickTopic(String id) {
    final selected = [..._intake.topics];
    if (selected.contains(id)) {
      selected.remove(id);
    } else if (id == 'unsure') {
      selected
        ..clear()
        ..add('unsure');
    } else {
      selected.remove('unsure');
      if (selected.length < 3) {
        selected.add(id);
      } else {
        _message = 'Choose up to 3. Tap a selected option to change it.';
      }
    }
    setState(() => _intake = _intake.copyWith(topics: selected).reconciled());
  }

  void _pickNeed(String id) {
    final selected = [..._intake.needs];
    if (selected.contains(id)) {
      selected.remove(id);
    } else if (id == 'unsure') {
      selected
        ..clear()
        ..add('unsure');
    } else {
      selected.remove('unsure');
      if (selected.length < 2) {
        selected.add(id);
      } else {
        _message = 'Choose up to 2. Tap a selected option to change it.';
      }
    }
    setState(() => _intake = _intake.copyWith(needs: selected));
  }

  Future<void> _advance() async {
    _message = '';
    if (_editing) {
      setState(() => _editing = false);
      await _save();
      return;
    }
    if (_step < 3) {
      setState(() => _step++);
      return;
    }
    await _save();
  }

  void _skip() {
    _message = '';
    setState(() {
      _intake = switch (_step) {
        0 => _intake.copyWith(topics: const []).reconciled(),
        1 => _intake.copyWith(needs: const []),
        2 => _intake.copyWith(goal: ''),
        _ => _intake.copyWith(languages: const [], ageRange: '', gender: ''),
      };
    });
    _advance();
  }

  void _back() {
    _message = '';
    if (_editing) {
      setState(() {
        _editing = false;
        _screen = _Screen.review;
      });
    } else if (_step > 0) {
      setState(() => _step--);
    } else if (widget.onCancel != null) {
      widget.onCancel!();
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final result = await widget.service.saveIntake(_intake);
      if (!mounted) return;
      setState(() {
        _result = result;
        _screen = _Screen.result;
      });
    } catch (error) {
      if (!mounted) return;
      showAppToast(context, error is TalkApiException ? error.message : 'Could not save your answers. Try again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _accept(String counsellorId) async {
    setState(() => _saving = true);
    try {
      final match = await widget.service.acceptCounsellor(counsellorId);
      if (!mounted) return;
      setState(() => _result = HelpMatchResult(match: match));
    } catch (error) {
      if (!mounted) return;
      showAppToast(context, error is TalkApiException ? error.message : 'Could not save that. Try again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _edit(int step) {
    setState(() {
      _step = step;
      _screen = _Screen.questions;
      _editing = true;
      _message = '';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        switch (_screen) {
          _Screen.questions => _questionScreen(),
          _Screen.review => _reviewScreen(),
          _Screen.result => _resultScreen(),
        },
        if (_saving)
          const Positioned.fill(
            child: ColoredBox(color: Color(0x66FFFFFF), child: Center(child: CircularProgressIndicator(color: CareColors.blue))),
          ),
      ],
    );
  }

  Widget _questionScreen() {
    final step = _step;
    Widget body;
    if (step == 0 || step == 1) {
      final items = step == 0 ? helpTopics : _intake.needsOffered();
      final selected = step == 0 ? _intake.topics : _intake.needs;
      final limit = step == 0 ? 3 : 2;
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('Choose up to $limit', style: const TextStyle(fontFamily: careFont, color: CareColors.muted, fontSize: 12)),
              const Spacer(),
              Text('${selected.length} selected', style: const TextStyle(fontFamily: careFont, color: CareColors.muted, fontSize: 12)),
            ],
          ),
          const SizedBox(height: 10),
          _OptionGrid(
            items: items,
            selected: selected,
            onTap: step == 0 ? _pickTopic : _pickNeed,
          ),
        ],
      );
    } else if (step == 2) {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Choose one to start', style: TextStyle(fontFamily: careFont, color: CareColors.muted, fontSize: 12)),
          const SizedBox(height: 10),
          for (final goal in helpGoals)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _OptionTile(
                option: goal,
                selected: _intake.goal == goal.id,
                onTap: () => setState(() => _intake = _intake.copyWith(goal: _intake.goal == goal.id ? '' : goal.id)),
              ),
            ),
        ],
      );
    } else {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _PrefGroup(
            title: 'Language',
            hint: 'Choose any you’d feel comfortable speaking.',
            chips: [
              CareChoiceChip('No preference', selected: _intake.languages.isEmpty, onTap: () => setState(() => _intake = _intake.copyWith(languages: const []))),
              for (final language in helpLanguages)
                CareChoiceChip(
                  language,
                  selected: _intake.languages.contains(language),
                  onTap: () => setState(() {
                    final list = [..._intake.languages];
                    list.contains(language) ? list.remove(language) : list.add(language);
                    _intake = _intake.copyWith(languages: list);
                  }),
                ),
            ],
          ),
          _PrefGroup(
            title: 'Counsellor’s age',
            chips: [
              CareChoiceChip('No preference', selected: _intake.ageRange.isEmpty, onTap: () => setState(() => _intake = _intake.copyWith(ageRange: ''))),
              for (final age in helpAgeRanges)
                CareChoiceChip(age.label, selected: _intake.ageRange == age.id, onTap: () => setState(() => _intake = _intake.copyWith(ageRange: age.id))),
            ],
          ),
          _PrefGroup(
            title: 'Counsellor’s gender',
            chips: [
              CareChoiceChip('No preference', selected: _intake.gender.isEmpty, onTap: () => setState(() => _intake = _intake.copyWith(gender: ''))),
              for (final gender in helpGenders)
                CareChoiceChip(gender.label, selected: _intake.gender == gender.id, onTap: () => setState(() => _intake = _intake.copyWith(gender: gender.id))),
            ],
          ),
        ],
      );
    }

    return ListView(
      key: ValueKey('onboarding-step-$step'),
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 32),
      children: [
        Row(
          children: [
            Expanded(
              child: step > 0 || _editing || widget.onCancel != null
                  ? CareBackLink('Back', onTap: _back)
                  : const Text('Let’s make this feel like you', style: TextStyle(fontFamily: careFont, color: CareColors.muted, fontSize: 12)),
            ),
            RichText(
              text: TextSpan(
                style: const TextStyle(fontFamily: careFont, color: CareColors.muted, fontSize: 12),
                children: [
                  TextSpan(text: '${step + 1}', style: const TextStyle(color: CareColors.blue, fontWeight: FontWeight.w700)),
                  const TextSpan(text: ' / 4'),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            for (var n = 0; n < 4; n++) ...[
              Expanded(
                child: Container(height: 4, decoration: BoxDecoration(color: n <= step ? CareColors.blue : CareColors.line, borderRadius: BorderRadius.circular(5))),
              ),
              if (n < 3) const SizedBox(width: 6),
            ],
          ],
        ),
        const SizedBox(height: 28),
        CareEyebrow(_labels[step]),
        const SizedBox(height: 10),
        CareHeading(_questions[step], size: 30),
        const SizedBox(height: 12),
        CareCopy(_subtitles[step]),
        const SizedBox(height: 22),
        body,
        if (_message.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(_message, style: const TextStyle(fontFamily: careFont, color: CareColors.clay, fontSize: 12.5)),
        ],
        const SizedBox(height: 26),
        CarePrimaryButton(
          _editing ? 'Done' : step == 3 ? 'See my starting point' : 'Continue',
          icon: Icons.arrow_forward_rounded,
          onTap: _canContinue ? _advance : null,
        ),
        const SizedBox(height: 6),
        Center(
          child: TextButton(
            onPressed: _skip,
            child: Text(step == 3 ? 'Continue without preferences' : 'Skip for now', style: const TextStyle(fontFamily: careFont, color: CareColors.muted, fontSize: 13, fontWeight: FontWeight.w600)),
          ),
        ),
        const SizedBox(height: 6),
        const CareMicro('Your answers stay with you and your counsellor. Nobody at your company sees them.', align: TextAlign.center),
      ],
    );
  }

  Widget _resultScreen() {
    final result = _result;
    final match = result?.match;
    final noMatch = result?.noMatch;
    final blank = _intake.isBlank;
    final topics = _recommendations();
    final goal = helpGoalById(_intake.goal);
    return ListView(
      key: const ValueKey('onboarding-result'),
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 32),
      children: [
        Row(
          children: [
            const Icon(Icons.check_rounded, size: 16, color: CareColors.blue),
            const SizedBox(width: 6),
            const Text('A place to begin', style: TextStyle(fontFamily: careFont, color: CareColors.blue, fontSize: 12.5, fontWeight: FontWeight.w600)),
            const Spacer(),
            CareLink('Edit answers', icon: null, onTap: () => setState(() => _screen = _Screen.review)),
          ],
        ),
        const SizedBox(height: 16),
        const CareEyebrow('Welcome to your space'),
        const SizedBox(height: 10),
        const CareHeading('A little support,\nat your own pace.', size: 30),
        const SizedBox(height: 12),
        CareCopy(blank ? 'Take your time exploring.\nYou can share more whenever you’re ready.' : 'Here’s a starting point from what you shared.\nYou can always choose differently.'),
        const SizedBox(height: 22),
        if (match != null)
          CareCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CareEyebrow(match.unmet.isEmpty ? 'Suggested counsellor' : 'Your counsellor, as chosen'),
                const SizedBox(height: 16),
                CounsellorPerson(counsellor: match.counsellor),
                const SizedBox(height: 16),
                ReasonList(match.reasons),
                if (match.unmet.isNotEmpty) ...[const SizedBox(height: 10), UnmetNote(match.unmet)],
                const SizedBox(height: 18),
                CarePrimaryButton('Go to Help', icon: Icons.arrow_forward_rounded, onTap: widget.onDone),
              ],
            ),
          )
        else if (noMatch != null)
          CareCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CareEyebrow('Let’s keep your preferences in view'),
                const SizedBox(height: 12),
                const CareSectionTitle('Nobody fits every preference you set.'),
                const SizedBox(height: 8),
                CareCopy('The closest is ${noMatch.counsellor.name}. Your choices haven’t been changed.', size: 13.5),
                const SizedBox(height: 14),
                CounsellorPerson(counsellor: noMatch.counsellor),
                const SizedBox(height: 12),
                UnmetNote(noMatch.unmet),
                const SizedBox(height: 10),
                ReasonList(noMatch.reasons),
                const SizedBox(height: 18),
                CarePrimaryButton('Show me who is available anyway', onTap: () => _accept(noMatch.counsellor.userId)),
                const SizedBox(height: 4),
                Center(child: CareLink('Review counsellor preferences', onTap: () => _edit(3))),
              ],
            ),
          )
        else
          CareCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CareSectionTitle('No counsellor is available yet.'),
                const SizedBox(height: 8),
                const CareCopy('Your answers are saved. A counsellor will be suggested as soon as one is.'),
                const SizedBox(height: 16),
                CarePrimaryButton('Go to Help', onTap: widget.onDone),
              ],
            ),
          ),
        const SizedBox(height: 24),
        CareSectionTitle(_intake.topics.isNotEmpty || _intake.needs.isNotEmpty ? 'Topics to start with' : 'A few topics to explore', size: 17),
        const SizedBox(height: 4),
        const CareCopy('Your selected topics come first.'),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final topic in topics)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
                decoration: BoxDecoration(color: CareColors.paper, borderRadius: BorderRadius.circular(14), border: Border.all(color: CareColors.line)),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(topic.icon, size: 16, color: CareColors.blue),
                    const SizedBox(width: 7),
                    Text(topic.label, style: const TextStyle(fontFamily: careFont, color: CareColors.ink, fontSize: 13, fontWeight: FontWeight.w500)),
                  ],
                ),
              ),
          ],
        ),
        if (goal != null) ...[
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(color: CareColors.lilac, borderRadius: BorderRadius.circular(20)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CareEyebrow('What you’d like to work towards'),
                const SizedBox(height: 8),
                Text(goal.label, style: const TextStyle(fontFamily: careFont, color: CareColors.ink, fontSize: 22, fontWeight: FontWeight.w500, height: 1.2)),
              ],
            ),
          ),
        ],
        const SizedBox(height: 20),
        const CareMicro('Your answers stay with you and your counsellor. Nobody at your company sees them.', align: TextAlign.center),
      ],
    );
  }

  List<HelpOption> _recommendations() {
    final ordered = [for (final id in _intake.topics) if (id != 'other' && id != 'unsure') id];
    final goalTopic = switch (_intake.goal) {
      'relationship' => 'relationships',
      '' => null,
      _ => 'self',
    };
    if (goalTopic != null) ordered.add(goalTopic);
    final ids = <String>{...ordered, 'self', 'work', 'relationships', 'change'}.take(4);
    return [for (final id in ids) helpTopicById(id)!];
  }

  Widget _reviewScreen() {
    final rows = [
      ('What you’d like to talk about', _intake.topics.map((id) => helpTopicById(id)?.label).whereType<String>().join(', ')),
      ('What you’d like help with', _intake.needs.map((id) => helpAllNeeds[id]?.label).whereType<String>().join(', ')),
      ('What you’d like to work towards', helpGoalById(_intake.goal)?.label ?? ''),
      (
        'Who you’d feel comfortable with',
        'Language: ${_intake.languages.isEmpty ? 'No preference' : _intake.languages.join(' or ')}\n'
            'Counsellor’s age: ${_intake.ageRange.isEmpty ? 'No preference' : helpAgeLabel(_intake.ageRange)}\n'
            'Counsellor’s gender: ${_intake.gender.isEmpty ? 'No preference' : helpGenderLabel(_intake.gender)}',
      ),
    ];
    final canReturn = _result != null || widget.onCancel != null;
    return ListView(
      key: const ValueKey('onboarding-review'),
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 32),
      children: [
        if (canReturn)
          CareBackLink('Your space', onTap: () {
            if (_result != null) {
              setState(() => _screen = _Screen.result);
            } else {
              widget.onCancel?.call();
            }
          }),
        const SizedBox(height: 14),
        const CareEyebrow('A little about you'),
        const SizedBox(height: 10),
        const CareHeading('Your answers,\nin your own time.', size: 30),
        const SizedBox(height: 12),
        const CareCopy('Change anything that no longer feels right.'),
        const SizedBox(height: 20),
        for (var i = 0; i < rows.length; i++)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 14),
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: CareColors.line))),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${i + 1}. ${rows[i].$1}', style: const TextStyle(fontFamily: careFont, color: CareColors.ink, fontSize: 14, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 4),
                      Text(rows[i].$2.isEmpty ? 'Skipped for now' : rows[i].$2, style: const TextStyle(fontFamily: careFont, color: CareColors.muted, fontSize: 13, height: 1.5)),
                    ],
                  ),
                ),
                CareLink('Edit', icon: null, onTap: () => _edit(i)),
              ],
            ),
          ),
        const SizedBox(height: 22),
        if (_result != null)
          CarePrimaryButton('Back to my space', icon: Icons.arrow_forward_rounded, onTap: () => setState(() => _screen = _Screen.result))
        else
          CarePrimaryButton('Save and see my starting point', icon: Icons.arrow_forward_rounded, onTap: _save),
      ],
    );
  }
}

class _OptionGrid extends StatelessWidget {
  const _OptionGrid({required this.items, required this.selected, required this.onTap});

  final List<HelpOption> items;
  final List<String> selected;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      padding: EdgeInsets.zero,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, mainAxisSpacing: 8, crossAxisSpacing: 8, mainAxisExtent: 64),
      itemCount: items.length,
      itemBuilder: (_, i) => _OptionTile(option: items[i], selected: selected.contains(items[i].id), onTap: () => onTap(items[i].id)),
    );
  }
}

class _OptionTile extends StatelessWidget {
  const _OptionTile({required this.option, required this.selected, required this.onTap});

  final HelpOption option;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final quiet = option.id == 'other' || option.id == 'unsure';
    return Material(
      color: selected ? CareColors.blueTint : CareColors.paper,
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        key: ValueKey('option-${option.id}'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: Container(
          constraints: const BoxConstraints(minHeight: 60),
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(15),
            border: Border.all(color: selected ? CareColors.blue : CareColors.line, style: quiet && !selected ? BorderStyle.solid : BorderStyle.solid),
          ),
          child: Row(
            children: [
              Icon(option.icon, size: 20, color: CareColors.blue),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  option.label,
                  style: TextStyle(fontFamily: careFont, color: quiet && !selected ? CareColors.muted : CareColors.ink, fontSize: 12.5, fontWeight: FontWeight.w500, height: 1.3),
                ),
              ),
              if (selected) const Icon(Icons.check_rounded, size: 16, color: CareColors.blue),
            ],
          ),
        ),
      ),
    );
  }
}

class _PrefGroup extends StatelessWidget {
  const _PrefGroup({required this.title, this.hint, required this.chips});

  final String title;
  final String? hint;
  final List<Widget> chips;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontFamily: careFont, color: CareColors.ink, fontSize: 14, fontWeight: FontWeight.w700)),
          if (hint != null) ...[const SizedBox(height: 3), CareCopy(hint!, size: 12)],
          const SizedBox(height: 10),
          Wrap(spacing: 8, runSpacing: 8, children: chips),
        ],
      ),
    );
  }
}
