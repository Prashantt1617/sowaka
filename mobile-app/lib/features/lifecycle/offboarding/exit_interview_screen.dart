/// R5: the exit interview. Optional, five questions, HR only; opens Tl − 5
/// (the template's setting) and stays open to the last day.
library;

import 'package:flutter/material.dart';

import '../../shared/app_toast.dart';
import 'offboarding_dates.dart';
import 'offboarding_models.dart';
import 'offboarding_page.dart' show OffboardingChrome;
import 'offboarding_store.dart';
import 'offboarding_ui.dart';

/// Question 1's choices: what the app shows, and the key it sends.
const exitInterviewReasons = [
  ('growth', 'Growth'),
  ('pay', 'Pay'),
  ('manager', 'Manager'),
  ('work_life', 'Work-life balance'),
  ('the_work', 'The work itself'),
  ('personal', 'Personal'),
  ('other', 'Other'),
];

const _comeBack = [('yes', 'Yes'), ('maybe', 'Maybe'), ('no', 'No')];

class ExitInterviewScreen extends StatefulWidget {
  const ExitInterviewScreen({
    super.key,
    required this.store,
    required this.interview,
    this.managerFirst,
    this.chrome = const OffboardingChrome(),
  });

  final OffboardingStore store;
  final ExitInterviewState interview;
  final String? managerFirst;

  /// The shell's header and tabs, as R3 wears them.
  final OffboardingChrome chrome;

  @override
  State<ExitInterviewScreen> createState() => _ExitInterviewScreenState();
}

class _ExitInterviewScreenState extends State<ExitInterviewScreen> {
  String? _reason;
  int? _workingHere;
  int? _manager;
  String? _comeBackAnswer;
  final _change = TextEditingController();
  bool _sending = false;
  late bool _sent = widget.interview.sent;

  @override
  void initState() {
    super.initState();
    _change.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _change.dispose();
    super.dispose();
  }

  ExitInterviewAnswers get _answers => ExitInterviewAnswers(
    reason: _reason,
    workingHere: _workingHere,
    manager: _manager,
    comeBack: _comeBackAnswer,
    change: _change.text,
  );

  Future<void> _send() async {
    setState(() => _sending = true);
    try {
      await widget.store.api.sendExitInterview(_answers);
      if (mounted) {
        setState(() {
          _sent = true;
          _sending = false;
        });
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _sending = false);
      showAppToast(context, error.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final who = widget.managerFirst ?? 'Your manager';
    if (_sent) {
      return OffScaffold(
        key: const ValueKey('exit-interview-sent'),
        title: 'Exit interview',
        header: widget.chrome.header,
        bottomNav: widget.chrome.bottomNav,
        children: [
          OffCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Sent to HR', style: offText(18, weight: FontWeight.w700)),
                const SizedBox(height: 6),
                Text(
                  'Thank you. Your answers went to HR only. $who won\'t see them.',
                  style: offText(14, color: OffColors.secondary, height: 20),
                ),
              ],
            ),
          ),
        ],
      );
    }
    if (!widget.interview.open) {
      final opens = widget.interview.opensAt;
      return OffScaffold(
        key: const ValueKey('exit-interview-locked'),
        title: 'Exit interview',
        header: widget.chrome.header,
        bottomNav: widget.chrome.bottomNav,
        children: [
          OffCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  opens == null ? 'Not open yet' : 'Opens ${weekdayDay(opens)}',
                  style: offText(18, weight: FontWeight.w700),
                ),
                const SizedBox(height: 6),
                Text(
                  'It opens a few days before your last day and stays open until then. Your answers go to HR only.',
                  style: offText(14, color: OffColors.secondary, height: 20),
                ),
              ],
            ),
          ),
        ],
      );
    }
    return OffScaffold(
      key: const ValueKey('exit-interview'),
      title: 'Exit interview',
      header: widget.chrome.header,
      bottomNav: widget.chrome.bottomNav,
      bottom: OffPrimaryButton(
        key: const ValueKey('exit-interview-send'),
        label: 'Send to HR',
        busy: _sending,
        onPressed: _answers.isEmpty ? null : _send,
      ),
      children: [
        Text(
          "Your answers go to HR only. ${widget.managerFirst ?? 'Your manager'} won't see them, and they don't affect your settlement or relieving letter. You can skip any question.",
          style: offText(14, color: OffColors.secondary, height: 20),
        ),
        const SizedBox(height: 14),
        _Question(
          number: 1,
          title: "What's the main reason you're leaving?",
          child: _Chips(
            keyPrefix: 'exit-reason',
            options: exitInterviewReasons,
            selected: _reason,
            onChanged: (value) => setState(() => _reason = value),
          ),
        ),
        _Question(
          number: 2,
          title: 'How was working here?',
          child: _Scale(
            keyPrefix: 'exit-working',
            value: _workingHere,
            onChanged: (value) => setState(() => _workingHere = value),
          ),
        ),
        _Question(
          number: 3,
          title: 'How was working with your manager?',
          child: _Scale(
            keyPrefix: 'exit-manager',
            value: _manager,
            onChanged: (value) => setState(() => _manager = value),
          ),
        ),
        _Question(
          number: 4,
          title: 'Would you come back one day?',
          child: _Chips(
            keyPrefix: 'exit-come-back',
            options: _comeBack,
            selected: _comeBackAnswer,
            onChanged: (value) => setState(() => _comeBackAnswer = value),
          ),
        ),
        _Question(
          number: 5,
          title: "Anything you'd change?",
          child: TextField(
            key: const ValueKey('exit-change'),
            controller: _change,
            minLines: 3,
            maxLines: 6,
            maxLength: 2000,
            style: offText(14, height: 20),
            decoration: InputDecoration(
              counterText: '',
              filled: true,
              fillColor: Colors.white,
              contentPadding: const EdgeInsets.all(12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: OffColors.line),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: OffColors.line),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _Question extends StatelessWidget {
  const _Question({
    required this.number,
    required this.title,
    required this.child,
  });

  final int number;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: OffCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          OffOverline('Question $number of 5'),
          const SizedBox(height: 6),
          Text(title, style: offText(15, weight: FontWeight.w600, height: 21)),
          const SizedBox(height: 12),
          child,
        ],
      ),
    ),
  );
}

class _Chips extends StatelessWidget {
  const _Chips({
    required this.keyPrefix,
    required this.options,
    required this.selected,
    required this.onChanged,
  });

  final String keyPrefix;
  final List<(String, String)> options;
  final String? selected;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: [
      for (final (key, label) in options)
        Semantics(
          selected: key == selected,
          button: true,
          child: InkWell(
            key: ValueKey('$keyPrefix-$key'),
            borderRadius: BorderRadius.circular(18),
            // A second tap takes the answer back: every question is optional.
            onTap: () => onChanged(key == selected ? null : key),
            child: Container(
              height: 36,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: key == selected ? OffColors.tint : Colors.white,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(
                  color: key == selected ? OffColors.brand : OffColors.line,
                ),
              ),
              child: Text(
                label,
                style: offText(
                  13,
                  weight: key == selected ? FontWeight.w600 : FontWeight.w400,
                  color: key == selected ? OffColors.brand : OffColors.ink,
                ),
              ),
            ),
          ),
        ),
    ],
  );
}

class _Scale extends StatelessWidget {
  const _Scale({
    required this.keyPrefix,
    required this.value,
    required this.onChanged,
  });

  final String keyPrefix;
  final int? value;
  final ValueChanged<int?> onChanged;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Row(
        children: [
          for (var n = 1; n <= 5; n++) ...[
            if (n > 1) const SizedBox(width: 8),
            Expanded(
              child: Semantics(
                label: '$n of 5',
                selected: n == value,
                button: true,
                child: InkWell(
                  key: ValueKey('$keyPrefix-$n'),
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => onChanged(n == value ? null : n),
                  child: Container(
                    height: 44,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: n == value ? OffColors.brand : Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: n == value ? OffColors.brand : OffColors.line,
                      ),
                    ),
                    child: Text(
                      '$n',
                      style: offText(
                        15,
                        weight: FontWeight.w600,
                        color: n == value ? Colors.white : OffColors.ink,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
      const SizedBox(height: 6),
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text('Not good', style: offText(11, color: OffColors.tertiary)),
          Text('Very good', style: offText(11, color: OffColors.tertiary)),
        ],
      ),
    ],
  );
}
