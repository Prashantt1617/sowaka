import 'dart:async';

import 'package:flutter/material.dart';

import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import 'onboarding_kit.dart';

/// A7 · the Day-7 survey, and the same four questions as the M3 and M6
/// pulse (6Zs §5.3): an emoji scale, a choice, a scale, an optional line.
/// HR reads every answer; the manager only ever sees a team summary.
class SurveyScreen extends StatefulWidget {
  const SurveyScreen({super.key, required this.shell});

  final OnboardingShell shell;

  static const scale = [('😞', 'Bad'), ('😕', 'Meh'), ('🙂', 'Okay'), ('😀', 'Good'), ('🤩', 'Great')];
  static const choices = [('yes', 'Yes, everything'), ('mostly', 'Mostly'), ('no', 'No, I was missing things')];

  @override
  State<SurveyScreen> createState() => _SurveyScreenState();
}

class _SurveyScreenState extends State<SurveyScreen> {
  SurveyState? _survey;
  String? _error;
  final _answers = SurveyAnswers();
  final _fix = TextEditingController();
  int _question = 0;
  bool _busy = false;
  bool _sent = false;

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    unawaited(_first());
  }

  @override
  void dispose() {
    _fix.dispose();
    super.dispose();
  }

  /// Last time's answer from the device at once; the live read replaces it.
  Future<void> _first() async {
    final kept = await _shell.api.fromDevice((api) => api.fetchSurvey());
    if (kept != null && mounted && _survey == null) {
      setState(() {
        _survey = kept;
        _sent = kept.sent;
      });
    }
    await _load();
  }

  Future<void> _load() async {
    try {
      final survey = await _shell.api.fetchSurvey();
      if (mounted) {
        setState(() {
          _survey = survey;
          _sent = survey.sent;
          _error = null;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    }
  }

  Future<void> _send() async {
    _answers.q4 = _fix.text;
    setState(() => _busy = true);
    try {
      await _shell.api.sendSurvey(_answers);
      if (mounted) setState(() => _sent = true);
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final survey = _survey;
    final title = survey?.title ?? 'Your first week';
    if (survey == null) {
      return OnbScaffold(shell: _shell, title: title, body: OnbLoadState(error: _error, onRetry: _load));
    }
    if (_sent) return _thanks(title);
    if (!survey.open) {
      return OnbScaffold(
        shell: _shell,
        title: title,
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            survey.opensAt == null
                ? 'This survey isn’t open yet. We’ll let you know when it is.'
                : 'This survey opens ${onbDay(survey.opensAt!)}. We’ll let you know.',
            style: OnbText.body,
          ),
        ),
      );
    }
    final last = _question == 3;
    return OnbScaffold(
      shell: _shell,
      title: title,
      showNav: false,
      background: Colors.white,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
            child: OnbStoryBar(count: 4, current: _question),
          ),
          Expanded(
            child: ListView(
              key: ValueKey('question-$_question'),
              padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
              children: [
                Text(
                  'Question ${_question + 1} of 4',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text3),
                ),
                const SizedBox(height: 4),
                OnbRise(child: _questionBody(survey)),
              ],
            ),
          ),
        ],
      ),
      footer: OnbFooter(
        children: [
          OnbPrimaryButton(
            key: const ValueKey('survey-next'),
            label: last ? 'Send answers' : 'Next',
            busy: _busy,
            onTap: !_answers.answered(_question)
                ? null
                : last
                ? _send
                : () => setState(() => _question++),
          ),
        ],
      ),
    );
  }

  Widget _questionBody(SurveyState survey) => switch (_question) {
    0 => _scale(
      'How was ${survey.periodWord}?',
      _answers.q1,
      (value) => setState(() => _answers.q1 = value),
    ),
    1 => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Did you have what you needed on Day 1?', style: _SurveyText.title),
        const SizedBox(height: 16),
        for (final (value, label) in SurveyScreen.choices)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: OnbChoiceCard(
              key: ValueKey('choice-$value'),
              title: label,
              selected: _answers.q2 == value,
              onTap: () => setState(() => _answers.q2 = value),
            ),
          ),
      ],
    ),
    2 => _scale('Do you know what’s expected of you?', _answers.q3, (value) => setState(() => _answers.q3 = value)),
    _ => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('What should we fix for the next person?', style: _SurveyText.title),
        const SizedBox(height: 16),
        OnbTextArea(
          fieldKey: const ValueKey('survey-fix'),
          controller: _fix,
          hint: 'Optional. Anything that got in your way or surprised you.',
          minLines: 4,
        ),
      ],
    ),
  };

  Widget _scale(String question, int? value, ValueChanged<int> onPick) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(question, style: _SurveyText.title),
      const SizedBox(height: 20),
      Row(
        children: [
          for (final (index, (emoji, label)) in SurveyScreen.scale.indexed)
            Expanded(
              child: Semantics(
                button: true,
                selected: value == index + 1,
                label: label,
                child: GestureDetector(
                  key: ValueKey('scale-${index + 1}'),
                  onTap: () => onPick(index + 1),
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    decoration: BoxDecoration(
                      color: value == index + 1 ? OnbColors.tint : Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: value == index + 1 ? OnbColors.primary : OnbColors.line,
                        width: value == index + 1 ? 2 : 1,
                      ),
                    ),
                    child: ExcludeSemantics(
                      child: Column(
                        children: [
                          Text(emoji, style: const TextStyle(fontSize: 30)),
                          const SizedBox(height: 6),
                          Text(label, style: OnbText.label.copyWith(fontSize: 11, color: OnbColors.text2)),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    ],
  );

  Widget _thanks(String title) => OnbScaffold(
    shell: _shell,
    title: title,
    body: ListView(
      key: const ValueKey('survey-thanks'),
      padding: const EdgeInsets.fromLTRB(20, 48, 20, 24),
      children: [
        const Text('🙏', style: TextStyle(fontSize: 56), textAlign: TextAlign.center),
        const SizedBox(height: 12),
        Text(
          _shell.viewerFirstName.isEmpty ? 'Thanks' : 'Thanks, ${_shell.viewerFirstName}',
          style: OnbText.display,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        const Text(
          'HR reads every answer. Your manager only sees a summary, never your name.',
          style: OnbText.body,
          textAlign: TextAlign.center,
        ),
      ],
    ),
    footer: OnbFooter(children: [OnbPrimaryButton(label: 'Done', onTap: () => Navigator.of(context).pop())]),
  );
}

abstract final class _SurveyText {
  static const title = TextStyle(fontSize: 28, height: 1.1, fontWeight: FontWeight.w800, letterSpacing: -0.56, color: OnbColors.text);
}
