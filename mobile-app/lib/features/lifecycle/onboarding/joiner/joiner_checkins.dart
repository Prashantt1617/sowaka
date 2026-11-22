import 'dart:async';

import 'package:flutter/material.dart';

import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../presentation/onboarding_kit.dart';
import 'joiner_models.dart';
import 'joiner_parts.dart';

/// The home's route name, so a finished check-in can go back to it.
const joinerHomeRoute = 'joiner-home';

void popToJoinerHome(BuildContext context) =>
    Navigator.of(context).popUntil((r) => r.settings.name == joinerHomeRoute || r.isFirst);

/// Check-ins (New joiner canvas, App · check-ins): "Your check-ins", each
/// with "n questions · about a minute" and Start, or Done with a tick.
class JoinerCheckinsScreen extends StatelessWidget {
  const JoinerCheckinsScreen({super.key, required this.c});

  final JoinerController c;

  @override
  Widget build(BuildContext context) => JoinerScaffold(
    c: c,
    title: 'Check-ins',
    body: (d) {
      final list = [...d.checkins.where((x) => x.isOpen), ...d.checkins.where((x) => x.isSent)];
      return JPage(
        onRefresh: c.load,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(header: true, child: const Text('Your check-ins', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text))),
              const SizedBox(height: 8),
              if (list.isNotEmpty)
                JListCard(
                  children: withLines([
                    for (final x in list)
                      Opacity(
                        opacity: x.isSent ? 0.7 : 1,
                        child: Semantics(
                          button: x.isOpen,
                          label: '${x.title}. ${x.isSent ? 'Done' : '${plural(x.questions)} · about a minute. Start'}',
                          excludeSemantics: true,
                          child: InkWell(
                            key: ValueKey('checkin-${x.id}'),
                            onTap: x.isOpen ? () => pushJoiner(context, c, JoinerCheckinScreen(c: c, id: x.id, title: x.title)) : null,
                            child: Container(
                              constraints: const BoxConstraints(minHeight: 64),
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              child: Row(
                                children: [
                                  const JIconChip.chat(tint: OnbColors.violetTint, color: OnbColors.violet),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(x.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text)),
                                        const SizedBox(height: 2),
                                        Text(
                                          x.isSent ? 'Done' : '${plural(x.questions)} · about a minute',
                                          style: const TextStyle(fontSize: 12, color: OnbColors.text3),
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  if (x.isSent) const JDoneDot() else const JVerbPill('Start', filled: true),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                  ]),
                ),
            ],
          ),
        ],
      );
    },
  );

  static String plural(int n) => '$n ${n == 1 ? 'question' : 'questions'}';
}

/// One check-in, one question per screen: "k of N" and its bar, the
/// question, then a rating 1–5 ("Not at all" … "Very") or Yes / No that
/// moves on as soon as it is tapped, or a long answer with Next (Send on
/// the last) and Skip. Back goes to the question before. Then "Thanks".
class JoinerCheckinScreen extends StatefulWidget {
  const JoinerCheckinScreen({super.key, required this.c, required this.id, required this.title});

  final JoinerController c;
  final String id;
  final String title;

  @override
  State<JoinerCheckinScreen> createState() => _JoinerCheckinScreenState();
}

class _JoinerCheckinScreenState extends State<JoinerCheckinScreen> {
  JoinerCheckin? _ci;
  String? _error;
  int _q = 0;
  final Map<String, Object?> _answers = {};
  final _text = TextEditingController();
  bool _sending = false;
  bool _done = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final ci = await widget.c.api.fetchCheckin(widget.id);
      if (mounted) {
        setState(() {
          _ci = ci;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = onboardingErrorText(e));
    }
  }

  List<CheckinQuestion> get _qs => _ci?.questions ?? const [];

  void _show(int q) {
    _q = q;
    final question = q < _qs.length ? _qs[q] : null;
    final v = question == null ? null : _answers[question.id];
    _text.text = v is String ? v : '';
  }

  Future<void> _answer(Object? value) async {
    if (_sending) return;
    final q = _qs[_q];
    _answers[q.id] = value;
    if (_q + 1 < _qs.length) {
      setState(() => _show(_q + 1));
      return;
    }
    await _send();
  }

  Future<void> _send() async {
    setState(() => _sending = true);
    try {
      await widget.c.api.sendCheckin(widget.id, [for (final q in _qs) (questionId: q.id, value: _answers[q.id])]);
      if (mounted) setState(() => _done = true);
      unawaited(widget.c.load());
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _back() {
    if (_done || _q == 0) {
      _done ? popToJoinerHome(context) : Navigator.of(context).pop();
      return;
    }
    setState(() => _show(_q - 1));
  }

  @override
  Widget build(BuildContext context) {
    final ci = _ci;
    return PopScope(
      canPop: _done || _q == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: OnbScaffold(
        shell: widget.c.shell,
        title: ci?.row.title ?? widget.title,
        onBack: _back,
        body: ci == null
            ? OnbLoadState(error: _error, onRetry: _load)
            : _done
            ? _Thanks(firstName: widget.c.data?.firstName ?? '', onHome: () => popToJoinerHome(context))
            : _qs.isEmpty
            ? const SizedBox.shrink()
            : _question(_qs[_q]),
      ),
    );
  }

  Widget _question(CheckinQuestion q) {
    final n = _qs.length;
    final picked = _answers[q.id];
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 28),
      children: [
        Text('${_q + 1} of $n', key: const ValueKey('checkin-pos'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: OnbColors.text3)),
        const SizedBox(height: 8),
        JBar(value: (_q + 1) / n, color: OnbColors.primary),
        const SizedBox(height: 24),
        Semantics(
          header: true,
          liveRegion: true,
          child: Text(
            q.text,
            key: const ValueKey('checkin-question'),
            style: const TextStyle(fontSize: 24, height: 1.3, fontWeight: FontWeight.w800, letterSpacing: -0.24, color: OnbColors.text),
          ),
        ),
        const SizedBox(height: 24),
        switch (q.type) {
          'rating' => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  for (var v = 1; v <= 5; v++) ...[
                    if (v > 1) const SizedBox(width: 8),
                    Expanded(child: JChoice(key: ValueKey('rate-$v'), label: '$v', on: picked == v, height: 60, size: 20, weight: FontWeight.w800, onTap: () => _answer(v))),
                  ],
                ],
              ),
              const SizedBox(height: 8),
              const Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Not at all', style: TextStyle(fontSize: 12, color: OnbColors.text3)),
                  Text('Very', style: TextStyle(fontSize: 12, color: OnbColors.text3)),
                ],
              ),
            ],
          ),
          'yes_no' => Row(
            children: [
              Expanded(child: JChoice(key: const ValueKey('answer-yes'), label: 'Yes', on: picked == 'yes', onTap: () => _answer('yes'))),
              const SizedBox(width: 10),
              Expanded(child: JChoice(key: const ValueKey('answer-no'), label: 'No', on: picked == 'no', onTap: () => _answer('no'))),
            ],
          ),
          'choice' => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (i, o) in q.options.indexed) ...[
                if (i > 0) const SizedBox(height: 10),
                JChoice(key: ValueKey('choice-$i'), label: o, on: picked == o, onTap: () => _answer(o)),
              ],
            ],
          ),
          _ => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                key: const ValueKey('checkin-text'),
                controller: _text,
                minLines: 5,
                maxLines: 8,
                style: const TextStyle(fontSize: 15, color: OnbColors.text),
                decoration: InputDecoration(
                  hintText: 'Type your answer',
                  filled: true,
                  fillColor: Colors.white,
                  contentPadding: const EdgeInsets.all(14),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: OnbColors.lineDark)),
                  focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: OnbColors.primary)),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                height: 52,
                child: FilledButton(
                  key: const ValueKey('checkin-next'),
                  onPressed: _sending ? null : () => _answer(_text.text.trim().isEmpty ? null : _text.text.trim()),
                  style: FilledButton.styleFrom(
                    backgroundColor: OnbColors.primary,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    textStyle: OnbText.button(context, weight: FontWeight.w700),
                  ),
                  child: Text(_q == n - 1 ? 'Send' : 'Next'),
                ),
              ),
              SizedBox(
                height: 40,
                child: TextButton(
                  key: const ValueKey('checkin-skip'),
                  onPressed: _sending ? null : () => _answer(null),
                  style: TextButton.styleFrom(foregroundColor: OnbColors.text2, textStyle: OnbText.button(context, size: 14)),
                  child: const Text('Skip'),
                ),
              ),
            ],
          ),
        },
      ],
    );
  }
}

/// One answer to pick, as the check-ins and forms draw it.
class JChoice extends StatelessWidget {
  const JChoice({super.key, required this.label, required this.on, required this.onTap, this.height = 64, this.size = 17, this.weight = FontWeight.w700});

  final String label;
  final bool on;
  final VoidCallback onTap;
  final double height;
  final double size;
  final FontWeight weight;

  @override
  Widget build(BuildContext context) => Semantics(
    inMutuallyExclusiveGroup: true,
    checked: on,
    button: true,
    label: label,
    excludeSemantics: true,
    child: Material(
      color: on ? OnbColors.primary : Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: on ? BorderSide.none : const BorderSide(color: OnbColors.lineDark)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          height: height,
          child: Center(child: Text(label, style: TextStyle(fontSize: size, fontWeight: weight, color: on ? Colors.white : OnbColors.text))),
        ),
      ),
    ),
  );
}

class _Thanks extends StatelessWidget {
  const _Thanks({required this.firstName, required this.onHome});

  final String firstName;
  final VoidCallback onHome;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(16, 72, 16, 28),
    children: [
      Center(
        child: Container(
          width: 84,
          height: 84,
          decoration: const BoxDecoration(color: OnbColors.successTint, shape: BoxShape.circle),
          child: const Icon(Icons.check_rounded, size: 40, color: OnbColors.successText),
        ),
      ),
      const SizedBox(height: 16),
      Text(
        firstName.isEmpty ? 'Thanks' : 'Thanks, $firstName',
        key: const ValueKey('checkin-thanks'),
        textAlign: TextAlign.center,
        style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: OnbColors.text),
      ),
      const SizedBox(height: 16),
      const Center(
        child: SizedBox(
          width: 280,
          child: Text(
            'Your answers are with HR and your manager.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 15, height: 1.5, color: OnbColors.text2),
          ),
        ),
      ),
      const SizedBox(height: 32),
      OnbPrimaryButton(key: const ValueKey('back-to-onboarding'), label: 'Back to onboarding', onTap: onHome),
    ],
  );
}
